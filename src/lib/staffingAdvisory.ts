import { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../types';
import { monthlyHourCap, baseHourlyRate } from './payroll';
import { runAutoScheduler } from './autoScheduler';
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
  /** Monthly base-salary cost added (positive) by hiring those people. */
  monthlySalaryAdded: number;
  /** Net monthly savings: monthlyOTSaved - monthlySalaryAdded. Can be negative. */
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
}

// Distribute each employee's monthly OT across the stations they worked at,
// proportionally to hours spent there. Returns Map<stationId, otHours>.
//
// Rationale: an employee who exceeds the monthly cap was over-scheduled. The
// "blame" for that OT lives with the stations that consumed their hours. If
// 60% of A's hours were at ST-C1 and 40% at ST-C2, then 60% of A's OT comes
// from ST-C1 — hiring at ST-C1 would relieve more pressure than at ST-C2.
function attributeOTToStations(
  employees: Employee[], schedule: Schedule, shifts: Shift[], config: Config,
): Map<string, number> {
  const stationOT = new Map<string, number>();
  const cap = monthlyHourCap(config);
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));

  for (const emp of employees) {
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

export function computeStaffingAdvisory({
  employees, shifts, stations, holidays, config, isPeakDay,
  schedule, totalOTHours, totalOTPay, stationGaps,
}: StaffingArgs): StaffingAdvisory {
  void shifts; void holidays; void isPeakDay; void baseHourlyRate;
  const cap = monthlyHourCap(config);
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
  const otHires = Math.ceil(totalOTHours / Math.max(1, cap));
  const eliminateOTPerStation = buildPerStation(stId => otHiresByStation.get(stId) || 0);
  const eliminateOT: StaffingMode = {
    hiresNeeded: Math.max(otHires, eliminateOTPerStation.reduce((s, p) => s + p.hires, 0)),
    monthlyOTSaved: Math.round(totalOTPay),
    monthlySalaryAdded: 0, // filled below
    netMonthlyDelta: 0,
    targetCoveragePct: 1.0,
    perStation: eliminateOTPerStation,
  };
  eliminateOT.monthlySalaryAdded = eliminateOT.hiresNeeded * avgMonthlySalary;
  eliminateOT.netMonthlyDelta = eliminateOT.monthlyOTSaved - eliminateOT.monthlySalaryAdded;

  // ── Mode 2: Optimal Coverage ────────────────────────────────────────────
  const totalCoverageGap = stationGaps.reduce((s, g) => s + g.gap, 0);
  const coverageHiresAggregate = Math.max(0, Math.ceil(totalCoverageGap));
  const coveragePerStation = buildPerStation(stId => gapHiresByStation.get(stId) || 0);
  const optimalCoverage: StaffingMode = {
    hiresNeeded: Math.max(coverageHiresAggregate, coveragePerStation.reduce((s, p) => s + p.hires, 0)),
    monthlyOTSaved: 0,
    monthlySalaryAdded: 0,
    netMonthlyDelta: 0,
    targetCoveragePct: 1.0,
    perStation: coveragePerStation,
  };
  optimalCoverage.monthlySalaryAdded = optimalCoverage.hiresNeeded * avgMonthlySalary;
  optimalCoverage.netMonthlyDelta = -optimalCoverage.monthlySalaryAdded;

  // ── Mode 3: Best of Both ────────────────────────────────────────────────
  // Per station, take the larger of the two mode totals — one FTE can cover a
  // peak gap OR absorb OT but not necessarily both. This is the conservative
  // ceiling that satisfies whichever pressure dominates each station.
  const bestPerStation = buildPerStation(stId => Math.max(
    otHiresByStation.get(stId) || 0,
    gapHiresByStation.get(stId) || 0,
  ));
  const bestTotal = bestPerStation.reduce((s, p) => s + p.hires, 0);
  const bestOfBoth: StaffingMode = {
    hiresNeeded: Math.max(otHires, coverageHiresAggregate, bestTotal),
    monthlyOTSaved: Math.round(totalOTPay),
    monthlySalaryAdded: 0,
    netMonthlyDelta: 0,
    targetCoveragePct: 1.0,
    perStation: bestPerStation,
  };
  bestOfBoth.monthlySalaryAdded = bestOfBoth.hiresNeeded * avgMonthlySalary;
  bestOfBoth.netMonthlyDelta = bestOfBoth.monthlyOTSaved - bestOfBoth.monthlySalaryAdded;

  return { eliminateOT, optimalCoverage, bestOfBoth, avgMonthlySalary };
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
}

export function simulateWithExtraHires(
  args: StaffingArgs,
  perStation: StationHire[],
): SimulationResult {
  const { employees, shifts, stations, holidays, config, isPeakDay } = args;
  if (shifts.length === 0 || stations.length === 0 || perStation.length === 0) {
    return { remainingOTHours: 0, remainingHolidayHours: 0, remainingCoverageGapDays: 0, scheduledShifts: 0, phantomHires: 0 };
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
    return { remainingOTHours: 0, remainingHolidayHours: 0, remainingCoverageGapDays: 0, scheduledShifts: 0, phantomHires: 0 };
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
      const required = peak ? st.peakMinHC : st.normalMinHC;
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

  return { remainingOTHours, remainingHolidayHours, remainingCoverageGapDays, scheduledShifts, phantomHires: phantoms.length };
}
