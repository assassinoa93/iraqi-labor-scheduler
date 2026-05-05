import { Employee, Shift, Station, PublicHoliday, Config, Schedule, Violation } from '../types';
import { monthlyHourCap, baseHourlyRate } from './payroll';
import { runAutoScheduler } from './autoScheduler';
import { peakDailyHC } from './stationDemand';
import { ComplianceEngine } from './compliance';
import { estimateFines, FineEstimate, RULE_KEYS } from './fines';
import { format } from 'date-fns';

// Three flavours of staffing recommendation surfaced on the dashboard:
//   - eliminateOT: hire just enough to get monthly OT to ~zero
//   - optimalCoverage: hire just enough to fill peak-hour station gaps
//   - bestOfBoth: enough to do both — neither understaffed nor reliant on OT
//
// Each mode reports the additional headcount and the expected monthly IQD
// effect (savings for OT-elimination, cost for hires above OT-elimination).
// Each mode also breaks the headcount down per station so the supervisor can
// see *where* the new hires would go and *why* — answering "I need 4 more"
// with "1 cashier (12h/mo OT here), 2 ride operators (peak shortfall)…".

export interface StationHire {
  stationId: string;
  stationName: string;
  hires: number;
  // Why this station drives the recommendation. 'ot' = the existing roster is
  // burning overtime hours covering this station; 'gap' = peak-hour staffing
  // shortfall (someone needs to be here who isn't); 'both' = both factors
  // apply.
  reason: 'ot' | 'gap' | 'both';
  // Evidence the supervisor can sanity-check: monthly OT hours attributed to
  // this station and the peak-hour FTE shortfall.
  otHours: number;
  coverageGap: number;
}

export interface StaffingMode {
  /** How many net new hires this mode recommends. */
  hiresNeeded: number;
  /** Monthly OT cost saved (positive) by adding those hires. */
  monthlyOTSaved: number;
  /** v5.17.0 — monthly fines avoided (positive) by eliminating the
   *  violations this mode is expected to clear. Estimated from the
   *  current violation set + Config.fineRates; the simulation can
   *  measure actual remainingFines for ground truth. */
  monthlyFinesAvoided: number;
  /** Monthly base-salary cost added (positive) by hiring those people. */
  monthlySalaryAdded: number;
  /** Net monthly delta: (monthlyOTSaved + monthlyFinesAvoided) - monthlySalaryAdded.
   *  Can be negative — when negative, the recommendation is "spend X to
   *  buy compliance + coverage" rather than "save X". */
  netMonthlyDelta: number;
  /** Coverage % the mode targets (1.0 = full coverage). */
  targetCoveragePct: number;
  /** Per-station breakdown of where those hires would land. Sums to hiresNeeded. */
  perStation: StationHire[];
}

export interface StaffingAdvisory {
  eliminateOT: StaffingMode;
  optimalCoverage: StaffingMode;
  bestOfBoth: StaffingMode;
  /** Average monthly salary used for the cost projection. */
  avgMonthlySalary: number;
  /** v5.17.0 — current potential fines (today, before any hiring).
   *  Surfaced separately so the dashboard can show it as a standalone
   *  "you are exposed to ~X IQD/month in fines" headline alongside
   *  the per-mode "fines avoided" deltas. */
  currentPotentialFines: FineEstimate;
}

export interface StaffingArgs {
  employees: Employee[];
  schedule: Schedule;
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  isPeakDay: (day: number) => boolean;
  /** Total OT hours from the active month, computed in App.tsx. */
  totalOTHours: number;
  /** Total OT pay for the active month (IQD). */
  totalOTPay: number;
  /** Per-station peak-hour gap, already computed by the dashboard. Each unit
   *  is one missing FTE during peak hours at that station. */
  stationGaps: Array<{ stationId: string; stationName: string; gap: number }>;
  /** v5.17.0 — current month's compliance violations. The advisory uses
   *  these to estimate per-mode fines avoided (see StaffingMode.monthlyFinesAvoided).
   *  Optional with `[]` default so legacy call sites still compile;
   *  fines-avoided will be 0 when omitted. */
  currentViolations?: Violation[];
}

// v5.17.0 — per-employee monthly cap. Drivers and hazardous workers have
// different weekly caps under Iraqi Labor Law (Art. 88 / 70), so a single
// flat cap from `monthlyHourCap(config)` would mis-attribute OT for those
// categories. We mirror the compliance engine's cap selection so the
// advisory's OT attribution matches the rule the engine actually fires.
//
//   - hourExempt: no cap → never accrues OT (treated as 0).
//   - Driver category: weekly cap × 4 (default 56 × 4 = 224).
//   - Hazardous flag: weekly cap × 4 (default 36 × 4 = 144).
//   - Standard: standardWeeklyHrsCap × 4 (default 48 × 4 = 192).
function monthlyCapFor(emp: Employee, config: Config): number {
  if (emp.hourExempt) return Number.POSITIVE_INFINITY;
  if (emp.category === 'Driver') {
    const weekly = config.driverWeeklyHrsCap ?? 56;
    return weekly * 4;
  }
  if (emp.isHazardous) {
    return (config.hazardousWeeklyHrsCap ?? 36) * 4;
  }
  return monthlyHourCap(config);
}

// Distribute each employee's monthly OT across the stations they worked at,
// proportionally to hours spent there. Returns Map<stationId, otHours>.
//
// Rationale: an employee who exceeds the monthly cap was over-scheduled. The
// "blame" for that OT lives with the stations that consumed their hours. If
// 60% of A's hours were at ST-C1 and 40% at ST-C2, then 60% of A's OT comes
// from ST-C1 — hiring at ST-C1 would relieve more pressure than at ST-C2.
//
// v5.17.0 — uses per-employee caps via monthlyCapFor() so driver and
// hazardous categories are attributed correctly. Pre-v5.17 every employee
// was measured against the standard 48h × 4 cap, which under-attributed
// OT for hazardous workers (real cap = 144h, not 192h) and over-attributed
// for drivers (real cap = 224h, not 192h).
function attributeOTToStations(
  employees: Employee[], schedule: Schedule, shifts: Shift[], config: Config,
): Map<string, number> {
  const stationOT = new Map<string, number>();
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));

  for (const emp of employees) {
    const cap = monthlyCapFor(emp, config);
    const empSched = schedule[emp.empId] || {};
    const perStationHours = new Map<string, number>();
    let totalHrs = 0;

    for (const entry of Object.values(empSched)) {
      const shift = shiftByCode.get(entry.shiftCode);
      if (!shift?.isWork) continue;
      const stKey = entry.stationId || '__unassigned__';
      perStationHours.set(stKey, (perStationHours.get(stKey) || 0) + shift.durationHrs);
      totalHrs += shift.durationHrs;
    }

    const empOT = Math.max(0, totalHrs - cap);
    if (empOT === 0 || totalHrs === 0) continue;

    for (const [stId, hrs] of perStationHours) {
      const share = hrs / totalHrs;
      stationOT.set(stId, (stationOT.get(stId) || 0) + empOT * share);
    }
  }

  return stationOT;
}

// v5.17.0 — rule-key sets used to attribute fines-avoidance per mode.
// These are the violations that ADDING HEADCOUNT can mechanically
// eliminate. Other rule keys (Art. 86 women's industrial night work,
// Art. 87 maternity, Art. 84 sick leave, Art. 88 continuous-driving
// breaks) reflect EDIT mistakes — paint a leave day, paint a 12h
// driver shift — and won't go away just because there are more people
// available. Keeping them out of the fines-avoided estimate prevents
// over-claiming compliance ROI from a hire.
const OT_DRIVEN_RULE_KEYS = new Set<string>([
  RULE_KEYS.DAILY_HOURS_CAP,
  RULE_KEYS.WEEKLY_HOURS_CAP,
  RULE_KEYS.MIN_REST_BETWEEN_SHIFTS,
  RULE_KEYS.CONSECUTIVE_WORK_DAYS,
  RULE_KEYS.WEEKLY_REST_DAY,
]);

// Sum the IQD subtotals from a FineEstimate that match a given rule-key
// set. Used to slice the current potential fines into the portion each
// mode is expected to clear.
function sumFinesByRuleKeys(estimate: FineEstimate, ruleKeys: Set<string>): number {
  let total = 0;
  for (const entry of estimate.byRule) {
    if (ruleKeys.has(entry.ruleKey)) total += entry.subtotal;
  }
  return total;
}

export function computeStaffingAdvisory({
  employees, shifts, stations, holidays, config, isPeakDay,
  schedule, totalOTHours, totalOTPay, stationGaps,
  currentViolations = [],
}: StaffingArgs): StaffingAdvisory {
  void shifts; void holidays; void isPeakDay; void baseHourlyRate;
  const cap = monthlyHourCap(config);

  // v5.17.0 — fines avoidance is sliced from the current violation set
  // by rule-key category. We compute the current potential fines once
  // and reuse it for every mode's avoidance estimate. The total is
  // surfaced on the StaffingAdvisory itself so the dashboard can show
  // the standalone "you are exposed to X IQD/month in fines" number.
  const currentPotentialFines = estimateFines(currentViolations, config);
  // OT-driven violations (cap breaches, missing rest, missed weekly
  // rest day, consecutive work days) all stem from over-scheduling
  // existing staff. Adding headcount that absorbs those hours
  // mechanically clears them. We use the FULL current fine total for
  // these rules as the "avoided" estimate when the mode hires enough
  // to eliminate the OT pool — partial reductions aren't modeled here
  // because the simulation gives the supervisor the actual measured
  // remainder via simulateWithExtraHires.
  const otDrivenFinesAvoidable = sumFinesByRuleKeys(currentPotentialFines, OT_DRIVEN_RULE_KEYS);

  // Average monthly salary across the existing roster — used as the cost
  // proxy for marginal hires. Empty roster falls back to the 1.5M IQD default
  // (the same anchor payroll.ts uses when seeding new employees).
  // Average monthly salary across the existing roster — used as the cost
  // proxy for marginal hires. Empty roster falls back to the 1.5M IQD default
  // (the same anchor payroll.ts uses when seeding new employees).
  const avgMonthlySalary = employees.length > 0
    ? Math.round(employees.reduce((s, e) => s + (e.baseMonthlySalary || 0), 0) / employees.length)
    : 1_500_000;

  // ── Per-station data sources ────────────────────────────────────────────
  // OT: distributed across stations by hours-worked.
  const stationOTMap = attributeOTToStations(employees, schedule, shifts, config);
  // Gap: from the dashboard's peak-hour shortfall. Each unit is one FTE.
  const stationGapMap = new Map(stationGaps.map(g => [g.stationId, g.gap]));
  const stationNameLookup = new Map(stations.map(s => [s.id, s.name]));

  // Build the union of stations that have either OT pressure or a coverage gap.
  const candidateStationIds = new Set<string>();
  for (const id of stationOTMap.keys()) {
    if (id !== '__unassigned__') candidateStationIds.add(id);
  }
  for (const id of stationGapMap.keys()) candidateStationIds.add(id);

  // Precompute per-station hires for each strategy.
  const otHiresByStation = new Map<string, number>();
  const gapHiresByStation = new Map<string, number>();
  const ottHrsByStation = new Map<string, number>();

  for (const stId of candidateStationIds) {
    const stOT = stationOTMap.get(stId) || 0;
    const stGap = stationGapMap.get(stId) || 0;
    ottHrsByStation.set(stId, stOT);
    // Each FTE absorbs `cap` hours of OT. Round up so a partial FTE still
    // closes the gap.
    otHiresByStation.set(stId, stOT > 0 ? Math.ceil(stOT / Math.max(1, cap)) : 0);
    gapHiresByStation.set(stId, stGap > 0 ? Math.ceil(stGap) : 0);
  }

  const buildPerStation = (
    pickHires: (stId: string) => number,
  ): StationHire[] => {
    const out: StationHire[] = [];
    for (const stId of candidateStationIds) {
      const hires = pickHires(stId);
      if (hires <= 0) continue;
      const stOT = ottHrsByStation.get(stId) || 0;
      const stGap = stationGapMap.get(stId) || 0;
      const reason: StationHire['reason'] =
        stOT > 0 && stGap > 0 ? 'both' : stOT > 0 ? 'ot' : 'gap';
      out.push({
        stationId: stId,
        stationName: stationNameLookup.get(stId) || stId,
        hires, reason,
        otHours: Math.round(stOT * 10) / 10,
        coverageGap: stGap,
      });
    }
    // Largest hires first; tiebreak by station name for stable display.
    out.sort((a, b) => b.hires - a.hires || a.stationName.localeCompare(b.stationName));
    return out;
  };

  // ── Mode 1: Eliminate OT ────────────────────────────────────────────────
  // This mode hires enough to absorb the over-cap pool entirely → all
  // OT-driven violations (cap breaches, missing rest, weekly rest day,
  // consec days) clear → fines for those rules drop to zero.
  const otHires = Math.ceil(totalOTHours / Math.max(1, cap));
  const eliminateOTPerStation = buildPerStation(stId => otHiresByStation.get(stId) || 0);
  const eliminateOT: StaffingMode = {
    hiresNeeded: Math.max(otHires, eliminateOTPerStation.reduce((s, p) => s + p.hires, 0)),
    monthlyOTSaved: Math.round(totalOTPay),
    monthlyFinesAvoided: otDrivenFinesAvoidable,
    monthlySalaryAdded: 0, // filled below
    netMonthlyDelta: 0,
    targetCoveragePct: 1.0,
    perStation: eliminateOTPerStation,
  };
  eliminateOT.monthlySalaryAdded = eliminateOT.hiresNeeded * avgMonthlySalary;
  eliminateOT.netMonthlyDelta =
    eliminateOT.monthlyOTSaved + eliminateOT.monthlyFinesAvoided - eliminateOT.monthlySalaryAdded;

  // ── Mode 2: Optimal Coverage ────────────────────────────────────────────
  // Coverage-gap hiring fills under-staffed peak windows. It does NOT
  // mechanically absorb OT (those workers might still be under cap), so
  // we don't claim OT savings here. Fines avoidance: zero by default
  // because peak-gap hiring doesn't directly resolve overwork rules
  // (it might reduce them indirectly, but conservative is right —
  // simulation gives the actual measurement).
  const totalCoverageGap = stationGaps.reduce((s, g) => s + g.gap, 0);
  const coverageHiresAggregate = Math.max(0, Math.ceil(totalCoverageGap));
  const coveragePerStation = buildPerStation(stId => gapHiresByStation.get(stId) || 0);
  const optimalCoverage: StaffingMode = {
    hiresNeeded: Math.max(coverageHiresAggregate, coveragePerStation.reduce((s, p) => s + p.hires, 0)),
    monthlyOTSaved: 0,
    monthlyFinesAvoided: 0,
    monthlySalaryAdded: 0,
    netMonthlyDelta: 0,
    targetCoveragePct: 1.0,
    perStation: coveragePerStation,
  };
  optimalCoverage.monthlySalaryAdded = optimalCoverage.hiresNeeded * avgMonthlySalary;
  optimalCoverage.netMonthlyDelta =
    optimalCoverage.monthlyOTSaved + optimalCoverage.monthlyFinesAvoided - optimalCoverage.monthlySalaryAdded;

  // ── Mode 3: Best of Both ────────────────────────────────────────────────
  // Per station, take the larger of the two mode totals — one FTE can cover a
  // peak gap OR absorb OT but not necessarily both. This is the conservative
  // ceiling that satisfies whichever pressure dominates each station. Since
  // it always covers at least the eliminateOT slots, OT-driven fines clear
  // here too.
  const bestPerStation = buildPerStation(stId => Math.max(
    otHiresByStation.get(stId) || 0,
    gapHiresByStation.get(stId) || 0,
  ));
  const bestTotal = bestPerStation.reduce((s, p) => s + p.hires, 0);
  const bestOfBoth: StaffingMode = {
    hiresNeeded: Math.max(otHires, coverageHiresAggregate, bestTotal),
    monthlyOTSaved: Math.round(totalOTPay),
    monthlyFinesAvoided: otDrivenFinesAvoidable,
    monthlySalaryAdded: 0,
    netMonthlyDelta: 0,
    targetCoveragePct: 1.0,
    perStation: bestPerStation,
  };
  bestOfBoth.monthlySalaryAdded = bestOfBoth.hiresNeeded * avgMonthlySalary;
  bestOfBoth.netMonthlyDelta =
    bestOfBoth.monthlyOTSaved + bestOfBoth.monthlyFinesAvoided - bestOfBoth.monthlySalaryAdded;

  return { eliminateOT, optimalCoverage, bestOfBoth, avgMonthlySalary, currentPotentialFines };
}

// Validate a recommendation by actually running the auto-scheduler with
// phantom hires and reporting what the resulting OT / coverage would be.
//
// Used by the "Simulate" button on the StaffingAdvisoryCard so the math isn't
// just back-of-envelope: the supervisor can sanity-check the recommendation
// against a real run before approving headcount.
export interface SimulationResult {
  /** Hours still over the monthly cap after the phantom hires are added. */
  remainingOTHours: number;
  /** Hours worked on a public holiday in the simulated schedule. Hires
   *  cannot eliminate this pool — it's reported so the supervisor sees that
   *  even a "clean" hire result still carries holiday-premium cost. */
  remainingHolidayHours: number;
  remainingCoverageGapDays: number;
  scheduledShifts: number;
  /** Number of phantom hires injected for this run. */
  phantomHires: number;
  /** v5.17.0 — count of hard violations remaining in the simulated
   *  schedule (severity='violation' only; info findings excluded). */
  remainingViolations: number;
  /** v5.17.0 — IQD/month estimate of fines exposure remaining after the
   *  phantom hires + auto-rerun. Computed by running ComplianceEngine on
   *  the simulated schedule and applying the same Config.fineRates the
   *  current advisory uses. The supervisor compares this to the current
   *  potential fines to see actual measured fine reduction. */
  remainingFines: number;
}

export function simulateWithExtraHires(
  args: StaffingArgs,
  perStation: StationHire[],
): SimulationResult {
  const { employees, shifts, stations, holidays, config, isPeakDay } = args;
  if (shifts.length === 0 || stations.length === 0 || perStation.length === 0) {
    return {
      remainingOTHours: 0, remainingHolidayHours: 0, remainingCoverageGapDays: 0,
      scheduledShifts: 0, phantomHires: 0,
      remainingViolations: 0, remainingFines: 0,
    };
  }

  // Build phantom employees, pinned to the station that drives each hire so
  // the scheduler routes them to the right queue. Hire id is namespaced so
  // it never collides with a real empId.
  const phantoms: Employee[] = [];
  let phantomIdx = 0;
  for (const ph of perStation) {
    const station = stations.find(s => s.id === ph.stationId);
    if (!station) continue;
    const isDriverStation = station.requiredRoles?.includes('Driver');
    for (let i = 0; i < ph.hires; i++) {
      phantomIdx++;
      phantoms.push({
        empId: `__SIM_${phantomIdx}`,
        name: `Sim ${phantomIdx}`,
        role: isDriverStation ? 'Driver' : 'Standard',
        department: 'Simulation',
        contractType: 'Permanent',
        contractedWeeklyHrs: 48,
        shiftEligibility: 'All',
        isHazardous: false,
        isIndustrialRotating: false,
        hourExempt: false,
        fixedRestDay: 0,
        phone: '',
        hireDate: format(new Date(config.year, config.month - 1, 1), 'yyyy-MM-dd'),
        notes: 'Simulation phantom — not persisted',
        eligibleStations: [station.id],
        holidayBank: 0,
        annualLeaveBalance: 21,
        baseMonthlySalary: 1_500_000,
        baseHourlyRate: 7_812,
        overtimeHours: 0,
        category: isDriverStation ? 'Driver' : 'Standard',
      });
    }
  }

  if (phantoms.length === 0) {
    return {
      remainingOTHours: 0, remainingHolidayHours: 0, remainingCoverageGapDays: 0,
      scheduledShifts: 0, phantomHires: 0,
      remainingViolations: 0, remainingFines: 0,
    };
  }

  const augmented = [...employees, ...phantoms];
  const { schedule } = runAutoScheduler({
    employees: augmented, shifts, stations, holidays, config, isPeakDay,
  });

  // Measure the simulated outcome.
  const cap = monthlyHourCap(config);
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));
  const holidayDateSet = new Set(holidays
    .filter(h => h.date.startsWith(`${config.year}-${String(config.month).padStart(2, '0')}-`))
    .map(h => h.date));

  let remainingOTHours = 0;
  let remainingHolidayHours = 0;
  let scheduledShifts = 0;

  for (const emp of augmented) {
    let hrs = 0;
    let holiHrs = 0;
    const empSched = schedule[emp.empId] || {};
    for (const [dayStr, entry] of Object.entries(empSched)) {
      const sh = shiftByCode.get(entry.shiftCode);
      if (!sh?.isWork) continue;
      hrs += sh.durationHrs;
      scheduledShifts++;
      const ds = format(new Date(config.year, config.month - 1, parseInt(dayStr)), 'yyyy-MM-dd');
      if (holidayDateSet.has(ds)) holiHrs += sh.durationHrs;
    }
    if (hrs > cap) remainingOTHours += hrs - cap;
    remainingHolidayHours += holiHrs;
  }

  // Remaining coverage gap: count (day, station) pairs where peak-hour HC < required.
  let remainingCoverageGapDays = 0;
  for (let d = 1; d <= config.daysInMonth; d++) {
    for (const st of stations) {
      const peak = isPeakDay(d);
      // v5.14.0 — peakDailyHC respects per-station hourly demand: for
      // a variable-demand station it returns the worst-hour HC; for a
      // flat-min-HC station it just returns the legacy value.
      const required = peakDailyHC(st, peak);
      if (required <= 0) continue;
      let count = 0;
      for (const emp of augmented) {
        const entry = schedule[emp.empId]?.[d];
        if (!entry?.stationId || entry.stationId !== st.id) continue;
        const sh = shiftByCode.get(entry.shiftCode);
        if (sh?.isWork) count++;
      }
      if (count < required) remainingCoverageGapDays++;
    }
  }

  // v5.17.0 — run the compliance engine on the simulated schedule so the
  // supervisor sees ACTUAL measured violation reduction, not just an
  // estimate. Same engine, same config the live dashboard uses, so the
  // numbers reconcile. We don't pass `allSchedules` (cross-month rolling
  // context) because the simulation is single-month — neighbouring months
  // would be from the live data, not the simulation, and would muddy the
  // measurement.
  const simViolations = ComplianceEngine.check(augmented, shifts, holidays, config, schedule);
  const hardSimViolations = simViolations.filter(v => (v.severity ?? 'violation') === 'violation');
  const remainingViolations = hardSimViolations.reduce((s, v) => s + (v.count ?? 1), 0);
  const remainingFinesEstimate = estimateFines(simViolations, config);

  return {
    remainingOTHours,
    remainingHolidayHours,
    remainingCoverageGapDays,
    scheduledShifts,
    phantomHires: phantoms.length,
    remainingViolations,
    remainingFines: remainingFinesEstimate.total,
  };
}
