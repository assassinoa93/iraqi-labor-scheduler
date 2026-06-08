import { Employee, Config, Schedule, Shift, PublicHoliday } from '../types';
import { getEmployeeLeaveOnDate } from './leaves';
import { computeHolidayPay, HolidayPayBreakdown } from './holidayCompPay';

// Single fallback used when an employee record predates the salary field
// (legacy CSV imports, very old backups). Real records always have
// `baseMonthlySalary` set on save.
export const DEFAULT_MONTHLY_SALARY_IQD = 1_500_000;

// Iraqi payroll convention: monthly hours = weekly cap × 4. Drivers have a
// higher weekly cap (56 vs 48) so their per-hour rate is computed against a
// larger denominator. Falls back to the standard weekly cap when an employee
// record is missing `contractedWeeklyHrs`.
export function monthlyHoursDivisor(
  emp: Pick<Employee, 'contractedWeeklyHrs'> | { contractedWeeklyHrs?: number },
  config: Pick<Config, 'standardWeeklyHrsCap'>,
): number {
  const weekly = emp.contractedWeeklyHrs && emp.contractedWeeklyHrs > 0
    ? emp.contractedWeeklyHrs
    : config.standardWeeklyHrsCap;
  return weekly * 4;
}

// Hourly rate used to compute OT premiums. Matches the formula shown to the
// user in the EmployeeModal "AUTO" badge.
export function baseHourlyRate(
  emp: Pick<Employee, 'baseMonthlySalary' | 'contractedWeeklyHrs'>,
  config: Pick<Config, 'standardWeeklyHrsCap'>,
): number {
  const monthly = emp.baseMonthlySalary && emp.baseMonthlySalary > 0
    ? emp.baseMonthlySalary
    : DEFAULT_MONTHLY_SALARY_IQD;
  return monthly / monthlyHoursDivisor(emp, config);
}

// Monthly hour cap = standard weekly cap × 4. Anything above this becomes
// overtime under Iraqi labor law (Art. 70).
export function monthlyHourCap(config: Pick<Config, 'standardWeeklyHrsCap'>): number {
  return config.standardWeeklyHrsCap * 4;
}

// v5.25 — per-employee monthly OT cap, category-aware. Drivers and hazardous
// workers have different weekly caps under Iraqi Labor Law (Art. 88 / 70), so
// a flat monthlyHourCap mis-attributes their OT. This is the single source of
// truth for cap selection, shared by otAnalysis.ts and staffingAdvisory.ts so
// their hour pools and hire counts reconcile.
//   - hourExempt: no cap (Infinity) → never accrues OT.
//   - Driver:    driverWeeklyHrsCap × 4 (default 56 × 4 = 224).
//   - Hazardous: hazardousWeeklyHrsCap × 4 (default 36 × 4 = 144).
//   - Standard:  standardWeeklyHrsCap × 4 (default 48 × 4 = 192).
export function monthlyCapFor(emp: Employee, config: Config): number {
  if (emp.hourExempt) return Number.POSITIVE_INFINITY;
  if (emp.category === 'Driver') {
    return (config.driverWeeklyHrsCap ?? 56) * 4;
  }
  if (emp.isHazardous) {
    return (config.hazardousWeeklyHrsCap ?? 36) * 4;
  }
  return monthlyHourCap(config);
}

// Sum of worked hours for an employee in the active month with
// leave-overlap days excluded. v2.1.3: a v1.6 backup may carry a legacy
// `annualLeaveStart/End` field that the schedule grid was never
// re-painted to honour — the cell still contains the pre-leave shift
// code. Reading the schedule blindly would inflate Net Payable (and
// over-cap OT) by the legacy leave hours. The leave check delegates to
// `getEmployeeLeaveOnDate` so it covers both v1.7 multi-range
// `leaveRanges` and the legacy single-range fields uniformly.
export function computeWorkedHours(
  emp: Employee,
  schedule: Schedule,
  shifts: Shift[],
  config: Pick<Config, 'year' | 'month'>,
): number {
  const empSched = schedule[emp.empId] || {};
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));
  const yyyy = String(config.year);
  const mm = String(config.month).padStart(2, '0');
  let total = 0;
  for (const [dayStr, entry] of Object.entries(empSched)) {
    const day = Number(dayStr);
    if (!Number.isFinite(day)) continue;
    const shift = shiftByCode.get(entry.shiftCode);
    if (!shift?.isWork) continue;
    const dateStr = `${yyyy}-${mm}-${String(day).padStart(2, '0')}`;
    if (getEmployeeLeaveOnDate(emp, dateStr)) continue;
    total += shift.durationHrs;
  }
  return total;
}

// v5.34 — canonical per-employee payroll figures for one month. Extracted
// verbatim from PayrollTab's inline row computation so the same numbers can be
// reused without duplication: the on-screen table, the period-over-period
// "vs last month" delta (run against the prior schedule + previousMonthConfig),
// and — once verified against the on-screen figures — the PDF compliance
// report (which currently re-derives pay inline and over-bills). The math is
// intentionally identical to the pre-v5.34 PayrollTab so this refactor changes
// NO displayed value:
//   standardOTHours = max(0, totalHours − monthlyHourCap − premiumHolidayHours)
// uses the flat monthlyHourCap (NOT the category-aware monthlyCapFor); aligning
// the cap is a separate, numbers-changing step flagged for review.
export interface PayrollRow {
  totalHours: number;
  baseMonthly: number;
  hourlyRate: number;
  standardOTHours: number;
  standardOTPay: number;
  holidayBreakdown: HolidayPayBreakdown;
  otAmount: number;
  netPayable: number;
}

export function computePayrollRow(
  emp: Employee,
  schedule: Schedule,
  shifts: Shift[],
  holidays: PublicHoliday[],
  config: Config,
  allSchedules?: Record<string, Schedule>,
): PayrollRow {
  const cap = monthlyHourCap(config);
  const totalHours = computeWorkedHours(emp, schedule, shifts, config);
  const baseMonthly = emp.baseMonthlySalary || DEFAULT_MONTHLY_SALARY_IQD;
  const hourlyRate = baseHourlyRate(emp, config);
  const holidayBreakdown = computeHolidayPay(emp, schedule, shifts, holidays, config, hourlyRate, allSchedules);
  const standardOTHours = Math.max(0, totalHours - cap - holidayBreakdown.premiumHolidayHours);
  const standardOTPay = standardOTHours * hourlyRate * (config.otRateDay ?? 1.5);
  const otAmount = standardOTPay + holidayBreakdown.premiumPay;
  const netPayable = baseMonthly + otAmount;
  return { totalHours, baseMonthly, hourlyRate, standardOTHours, standardOTPay, holidayBreakdown, otAmount, netPayable };
}
