import { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../types';
import { format } from 'date-fns';
import { monthlyHourCap, baseHourlyRate } from './payroll';
import { computeHolidayPay } from './holidayCompPay';

// OT breakdown for a single month, split into the two pools that drive
// premium pay under Iraqi Labor Law.
//
//   1. Over-cap OT (Art. 67 / 68 / 70):
//      Hours worked beyond the monthly cap. Paid at otRateDay (1.5×). HIRES
//      can absorb this — every new FTE relieves up to `cap` hours of
//      over-cap pressure from the existing roster.
//
//   2. Holiday-premium OT (Art. 74):
//      Every hour worked on a public holiday. Paid at otRateNight (2×).
//      Hires CANNOT eliminate this — someone has to work the holiday — but
//      a comp day granted within 7 days converts the 2× premium to a 1×
//      cost (the law allows pay-in-lieu OR a rest day).
//
// The pre-v1.10 advisory only tracked over-cap OT. That meant a clean run
// where everyone is exactly at-cap could still produce millions of IQD in
// premium pay (all from holidays) without any "hiring needed" recommendation.
// This module exposes both pools separately so the UI can attribute the
// total cost honestly and recommend the right mitigation per pool.

export interface EmployeeOT {
  empId: string;
  empName: string;
  totalHours: number;
  cap: number;
  overCapHours: number;       // hours > monthly cap (paid at otRateDay)
  // Total hours worked on a public holiday this month. v2.1 splits this
  // into two cost lanes (see `premiumHolidayHours` below) per the user's
  // Art. 74 reading: comp day OR cash, not both.
  holidayHours: number;
  // Subset of `holidayHours` where the 2× cash premium is owed (cash-ot
  // mode, or comp-day mode with no CP scheduled within the window). The
  // remaining hours are paid at the regular wage because the supervisor
  // already granted the comp rest day.
  premiumHolidayHours: number;
  // The over-cap pool excluding premium-rate holiday hours (avoids
  // double-charging the 1.5× over-cap rate against hours already paid at
  // 2× per Art. 74).
  payableOverCapHours: number;
  overCapPay: number;         // IQD: payableOverCapHours * hourly * otRateDay
  holidayPay: number;         // IQD: premiumHolidayHours * hourly * otRateNight
  totalOTPay: number;         // overCapPay + holidayPay
  // Per-holiday-date breakdown so the UI can list which holidays the
  // employee worked. Date strings are YYYY-MM-DD.
  holidayDates: Array<{ date: string; hours: number }>;
  // Per-station distribution of the employee's hours. Used to attribute OT
  // pressure to specific stations.
  hoursByStation: Map<string, number>;
}

export interface StationOT {
  stationId: string;
  stationName: string;
  // Total work hours at this station for the month (across all employees).
  totalHours: number;
  // Over-cap OT attributed to this station (proportional to each
  // contributor's hours-spent-here ÷ their total monthly hours).
  overCapHours: number;
  // Holiday hours worked at this station.
  holidayHours: number;
  // IQD pools, computed from the hour pools above using each contributor's
  // baseHourlyRate.
  overCapPay: number;
  holidayPay: number;
  totalOTPay: number;
  // Number of distinct employees who burned OT at this station (any pool).
  contributors: number;
}

export interface OTAnalysis {
  // Top-line totals.
  totalOverCapHours: number;
  totalHolidayHours: number;
  totalOverCapPay: number;
  totalHolidayPay: number;
  totalOTPay: number;
  // Cap (monthly hour cap) used for the analysis. Reported so the UI can
  // explain "X hours above the {cap}h cap".
  cap: number;
  // Per-employee + per-station detail. Both sorted descending by totalOTPay.
  byEmployee: EmployeeOT[];
  byStation: StationOT[];
  // Public holiday days that fall in the active month. The UI surfaces these
  // alongside the holiday-pool breakdown ("Holiday hours from these 3
  // holidays: Eid al-Fitr, Eid al-Adha, …").
  holidaysThisMonth: PublicHoliday[];
}

// Cheap helper — same date-format convention used everywhere else.
const dateStrFor = (year: number, month: number, day: number): string =>
  format(new Date(year, month - 1, day), 'yyyy-MM-dd');

export function analyzeOT(
  employees: Employee[], schedule: Schedule, shifts: Shift[], stations: Station[],
  holidays: PublicHoliday[], config: Config,
  // v2.1.1 — full schedule map so the comp-window check can cross the
  // month boundary. Without this, late-month holidays where the comp
  // day lands in the next month would incorrectly report premium owed.
  allSchedules?: Record<string, Schedule>,
): OTAnalysis {
  const cap = monthlyHourCap(config);
  const otRateDay = config.otRateDay ?? 1.5;
  const otRateNight = config.otRateNight ?? 2.0;
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));
  const stationByCode = new Map(stations.map(s => [s.id, s]));

  // Filter holidays to the active month for display + premium attribution.
  // Assumes holidays use YYYY-MM-DD format.
  const monthPrefix = `${config.year}-${String(config.month).padStart(2, '0')}-`;
  const holidaysThisMonth = holidays.filter(h => h.date.startsWith(monthPrefix));
  const holidayDateSet = new Set(holidaysThisMonth.map(h => h.date));

  const byEmployee: EmployeeOT[] = [];
  // Aggregate buckets — we'll fill them as we walk each employee, then turn
  // into StationOT[] at the end.
  type StationAcc = {
    totalHours: number; overCapHours: number; holidayHours: number;
    overCapPay: number; holidayPay: number; contributorIds: Set<string>;
  };
  const stationAcc = new Map<string, StationAcc>();
  const ensureStation = (id: string): StationAcc => {
    let acc = stationAcc.get(id);
    if (!acc) {
      acc = { totalHours: 0, overCapHours: 0, holidayHours: 0, overCapPay: 0, holidayPay: 0, contributorIds: new Set() };
      stationAcc.set(id, acc);
    }
    return acc;
  };

  for (const emp of employees) {
    const empSched = schedule[emp.empId] || {};
    const hoursByStation = new Map<string, number>();
    let totalHours = 0;
    let holidayHours = 0;
    // Per-station holiday-hours bucket so we attribute the 2× cash premium
    // to the station the employee actually worked at on the holiday.
    const holidayHoursByStation = new Map<string, number>();
    const premiumHolidayHoursByStation = new Map<string, number>();
    // Per-date breakdown so the UI can list each holiday the employee
    // worked.
    const holidayDateBuckets = new Map<string, number>();

    const hourly = baseHourlyRate(emp, config);
    // v2.1.1 — single-source comp-window check. Splits PH hours into
    // total + premium-owed via the shared `computeHolidayPay` helper,
    // which crosses the month boundary when allSchedules is provided.
    const breakdown = computeHolidayPay(emp, schedule, shifts, holidays, config, hourly, allSchedules);
    const premiumHolidayHours = breakdown.premiumHolidayHours;
    const premiumByDate = new Map(breakdown.perHoliday.map(p => [p.date, p.premiumOwed]));

    for (const [dayStr, entry] of Object.entries(empSched)) {
      const shift = shiftByCode.get(entry.shiftCode);
      if (!shift?.isWork) continue;
      const stKey = entry.stationId || '__unassigned__';
      hoursByStation.set(stKey, (hoursByStation.get(stKey) || 0) + shift.durationHrs);
      totalHours += shift.durationHrs;
      const ds = dateStrFor(config.year, config.month, parseInt(dayStr));
      if (holidayDateSet.has(ds)) {
        holidayHours += shift.durationHrs;
        holidayDateBuckets.set(ds, (holidayDateBuckets.get(ds) || 0) + shift.durationHrs);
        holidayHoursByStation.set(stKey, (holidayHoursByStation.get(stKey) || 0) + shift.durationHrs);
        if (premiumByDate.get(ds)) {
          premiumHolidayHoursByStation.set(stKey, (premiumHolidayHoursByStation.get(stKey) || 0) + shift.durationHrs);
        }
      }
    }

    if (totalHours === 0) continue;

    const overCapHours = Math.max(0, totalHours - cap);
    // Subtract premium-rate holiday hours from the over-cap pool — those
    // are already covered at the higher 2× rate. Non-premium holiday
    // hours (comp granted) stay eligible for the 1.5× over-cap pool.
    const payableOverCapHours = Math.max(0, overCapHours - premiumHolidayHours);
    const overCapPay = payableOverCapHours * hourly * otRateDay;
    const holidayPay = breakdown.premiumPay;
    const totalOTPay = overCapPay + holidayPay;

    if (overCapHours > 0 || holidayHours > 0) {
      byEmployee.push({
        empId: emp.empId,
        empName: emp.name,
        totalHours,
        cap,
        overCapHours,
        holidayHours,
        premiumHolidayHours,
        payableOverCapHours,
        overCapPay,
        holidayPay,
        totalOTPay,
        holidayDates: Array.from(holidayDateBuckets.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, hours]) => ({ date, hours })),
        hoursByStation,
      });
    }

    // ── Distribute OT to stations ──
    // Over-cap pool: proportional share by hours-worked at each station.
    if (payableOverCapHours > 0) {
      for (const [stId, hrs] of hoursByStation) {
        if (stId === '__unassigned__') continue;
        const share = hrs / totalHours;
        const acc = ensureStation(stId);
        const stOC = payableOverCapHours * share;
        acc.overCapHours += stOC;
        acc.overCapPay += stOC * hourly * otRateDay;
        acc.contributorIds.add(emp.empId);
      }
    }
    // Holiday pool: direct attribution to station the worker was on that
    // day. Pay only the subset where the premium is owed (cash-ot mode or
    // comp-day mode with no CP scheduled inside the window).
    for (const [stId, hrs] of holidayHoursByStation) {
      if (stId === '__unassigned__') continue;
      const acc = ensureStation(stId);
      acc.holidayHours += hrs;
      acc.contributorIds.add(emp.empId);
    }
    for (const [stId, hrs] of premiumHolidayHoursByStation) {
      if (stId === '__unassigned__') continue;
      const acc = ensureStation(stId);
      acc.holidayPay += hrs * hourly * otRateNight;
    }
    // Always count total hours at the station for context.
    for (const [stId, hrs] of hoursByStation) {
      if (stId === '__unassigned__') continue;
      const acc = ensureStation(stId);
      acc.totalHours += hrs;
    }
  }

  byEmployee.sort((a, b) => b.totalOTPay - a.totalOTPay);

  const byStation: StationOT[] = [];
  for (const [stId, acc] of stationAcc) {
    if (acc.overCapHours <= 0 && acc.holidayHours <= 0) continue;
    byStation.push({
      stationId: stId,
      stationName: stationByCode.get(stId)?.name || stId,
      totalHours: acc.totalHours,
      overCapHours: Math.round(acc.overCapHours * 10) / 10,
      holidayHours: acc.holidayHours,
      overCapPay: Math.round(acc.overCapPay),
      holidayPay: Math.round(acc.holidayPay),
      totalOTPay: Math.round(acc.overCapPay + acc.holidayPay),
      contributors: acc.contributorIds.size,
    });
  }
  byStation.sort((a, b) => b.totalOTPay - a.totalOTPay);

  // Top-level totals.
  const totalOverCapHours = byEmployee.reduce((s, e) => s + e.payableOverCapHours, 0);
  const totalHolidayHours = byEmployee.reduce((s, e) => s + e.holidayHours, 0);
  const totalOverCapPay = byEmployee.reduce((s, e) => s + e.overCapPay, 0);
  const totalHolidayPay = byEmployee.reduce((s, e) => s + e.holidayPay, 0);
  const totalOTPay = totalOverCapPay + totalHolidayPay;

  return {
    totalOverCapHours: Math.round(totalOverCapHours * 10) / 10,
    totalHolidayHours,
    totalOverCapPay: Math.round(totalOverCapPay),
    totalHolidayPay: Math.round(totalHolidayPay),
    totalOTPay: Math.round(totalOTPay),
    cap,
    byEmployee,
    byStation,
    holidaysThisMonth,
  };
}

// Mitigation suggestion. Three flavours surface in the analysis tab.
export interface OTMitigation {
  id: 'hire-overcap' | 'comp-day-holiday' | 'rebalance';
  // Estimated IQD savings if the mitigation is applied. May be approximate —
  // hiring estimates assume the new FTE perfectly absorbs over-cap hours;
  // comp-day estimates assume the supervisor grants the rest day so the 2×
  // premium drops to 0 (the rest day is unpaid; the regular wage was already
  // paid for the holiday work). Caller may want to display these as ranges.
  estimatedSavings: number;
  // Headcount or comp-day count this mitigation requires.
  count: number;
}

export function suggestMitigations(analysis: OTAnalysis, avgMonthlySalary: number): OTMitigation[] {
  const out: OTMitigation[] = [];

  // Hire to absorb over-cap OT. Each new FTE absorbs up to `cap` over-cap
  // hours; net savings = saved OT pay minus the new salary cost.
  if (analysis.totalOverCapHours > 0) {
    const hires = Math.ceil(analysis.totalOverCapHours / Math.max(1, analysis.cap));
    const saved = analysis.totalOverCapPay;
    const cost = hires * avgMonthlySalary;
    out.push({ id: 'hire-overcap', estimatedSavings: saved - cost, count: hires });
  }

  // Holiday-pool mitigation. v2.1 — under the "either / or" reading, a
  // comp day actually erases the 2× premium for those hours, so this row
  // now shows the projected savings from completing the rotation. Counts
  // PH-work days where the premium is currently owed (no CP within the
  // configured window) and projects the cash that would be saved if a
  // comp day were granted.
  const totalPremiumHours = analysis.byEmployee.reduce((s, e) => s + (e.premiumHolidayHours || 0), 0);
  if (totalPremiumHours > 0) {
    const projectedSavings = analysis.totalHolidayPay; // entire premium pool
    let compDays = 0;
    for (const e of analysis.byEmployee) {
      const ph = e.premiumHolidayHours || 0;
      if (ph > 0) compDays += Math.max(1, Math.round(ph / 8));
    }
    out.push({ id: 'comp-day-holiday', estimatedSavings: projectedSavings, count: compDays });
  }

  // Re-running the scheduler in strict mode (level 1) sometimes spreads
  // hours more evenly. We can't predict the savings without running it, so
  // this entry has count=1 (one re-run) and estimatedSavings=0.
  if (analysis.totalOverCapHours > 0) {
    out.push({ id: 'rebalance', estimatedSavings: 0, count: 1 });
  }

  return out;
}
