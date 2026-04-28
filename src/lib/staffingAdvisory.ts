import { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../types';
import { parseHour } from './time';
import { monthlyHourCap, baseHourlyRate } from './payroll';

// Three flavours of staffing recommendation surfaced on the dashboard:
//   - eliminateOT: hire just enough to get monthly OT to ~zero
//   - optimalCoverage: hire just enough to fill peak-hour station gaps
//   - bestOfBoth: enough to do both — neither understaffed nor reliant on OT
//
// Each mode reports the additional headcount and the expected monthly IQD
// effect (savings for OT-elimination, cost for hires above OT-elimination).
// All numbers are rough — the goal is to let the supervisor weigh tradeoffs,
// not to replace a real workforce-planning tool.

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
  /** Sum of headcount gaps across stations during peak hours (per
   *  staffingGapsByStation). Each unit roughly represents one missing FTE. */
  totalCoverageGap: number;
}

export function computeStaffingAdvisory({
  employees, shifts, stations, holidays, config, isPeakDay,
  schedule, totalOTHours, totalOTPay, totalCoverageGap,
}: StaffingArgs): StaffingAdvisory {
  void shifts; void stations; void holidays; void schedule;
  const cap = monthlyHourCap(config);
  // Average monthly salary across the existing roster — used as the cost
  // proxy for marginal hires. If the roster is empty we fall back to the
  // payroll module default via baseHourlyRate(emp, config) wouldn't help,
  // so use a sensible Iraqi wage default (1.5M IQD) as the floor.
  const avgMonthlySalary = employees.length > 0
    ? Math.round(employees.reduce((s, e) => s + (e.baseMonthlySalary || 0), 0) / employees.length)
    : 1_500_000;

  // Mode 1: Eliminate OT — convert all OT hours into regular FTE slots.
  // Each new FTE absorbs `cap` hours/month of currently-OT work.
  const otHires = Math.ceil(totalOTHours / Math.max(1, cap));
  const eliminateOT: StaffingMode = {
    hiresNeeded: otHires,
    monthlyOTSaved: Math.round(totalOTPay),
    monthlySalaryAdded: otHires * avgMonthlySalary,
    netMonthlyDelta: Math.round(totalOTPay) - otHires * avgMonthlySalary,
    targetCoveragePct: 1.0, // OT elimination assumes coverage stays where it is
  };

  // Mode 2: Optimal coverage — close the peak-hour gap. Each unit of gap
  // is one missing FTE during peak hours; we round up.
  const coverageHires = Math.max(0, Math.ceil(totalCoverageGap));
  const optimalCoverage: StaffingMode = {
    hiresNeeded: coverageHires,
    monthlyOTSaved: 0, // Coverage hires don't directly reduce OT (different problem)
    monthlySalaryAdded: coverageHires * avgMonthlySalary,
    netMonthlyDelta: -coverageHires * avgMonthlySalary,
    targetCoveragePct: 1.0,
  };

  // Mode 3: Best of both — total hires needed to satisfy whichever is
  // larger, since each FTE covers either a coverage slot or an OT slot
  // but not necessarily both. Use the max as a conservative ceiling.
  const bestOfBothHires = Math.max(otHires, coverageHires);
  const bestOfBoth: StaffingMode = {
    hiresNeeded: bestOfBothHires,
    monthlyOTSaved: Math.round(totalOTPay),
    monthlySalaryAdded: bestOfBothHires * avgMonthlySalary,
    netMonthlyDelta: Math.round(totalOTPay) - bestOfBothHires * avgMonthlySalary,
    targetCoveragePct: 1.0,
  };

  // Suppress noise: a station-only call where nobody works the schedule yet
  // would produce isPeakDay-driven phantom gaps. Keep the sanity guard light
  // — the dashboard already shows zeros gracefully.
  void isPeakDay; void baseHourlyRate; void parseHour;

  return { eliminateOT, optimalCoverage, bestOfBoth, avgMonthlySalary };
}
