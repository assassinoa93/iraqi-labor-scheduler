/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Scoped query functions (the AI's tool layer, read side).
 *
 * Each function takes a slice of CompanyData plus scope arguments and
 * returns a compact, AI-friendly aggregate. Designed to be called either:
 *   - directly from the chat-panel tool-use loop (phase 4), or
 *   - from the Tool Inspector preview in AIServicesTab (phase 3).
 *
 * Design rules:
 *   1. **Pure** over CompanyData. No async, no I/O. Profile mutations
 *      live in the writer half (`mutations.ts`) because they need the
 *      dual-mode store.
 *   2. **Aggregate, don't dump**. Raw cell-level data is too big for
 *      LLM consumption. Each function returns rolled-up summaries —
 *      hours per employee per month, coverage gap per station, etc.
 *   3. **Tagged provenance**. Every record carries `kind: 'actual' |
 *      'plan'` and `asOf`/`horizon` so the model never confuses past
 *      with planned.
 *   4. **Reuse existing helpers**. Don't re-derive payroll math here —
 *      call into `lib/payroll`, `lib/compliance`, etc. so the AI sees
 *      the same numbers the rest of the app does.
 */

import { addMonths, format, parseISO, isValid } from 'date-fns';
import type { CompanyData, Employee, Violation, LeaveRange } from '../../../types';
import { computeWorkedHours, baseHourlyRate, monthlyHourCap } from '../../payroll';
import { ComplianceEngine } from '../../compliance';
import { getEmployeeLeaveOnDate } from '../../leaves';
import { expandHolidayDates, projectHolidaysToYear } from '../../holidays';
import { scheduleKeyFor } from '../dataSurvey';
import type { StationProfile } from '../profiles';

// ─── Shared types ───────────────────────────────────────────────────────

export interface MonthRangeArg {
  fromYear: number;
  fromMonth: number;
  toYear: number;
  toMonth: number;
}

export interface MonthlyEmployeeStats {
  empId: string;
  name: string;
  year: number;
  month: number;
  /** Total hours worked, leave days excluded. */
  hoursWorked: number;
  /** Hours over the monthly cap = OT-eligible hours. */
  otHours: number;
  /** Days the employee was assigned a work-coded shift. */
  workDays: number;
  /** Per-leave-type day count this month (annual / sick / maternity / other). */
  leaveDays: { annual: number; sick: number; maternity: number; other: number };
  /** Holiday-work day count (a work shift on a public-holiday date). */
  holidayWorkDays: number;
  kind: 'actual';
  asOf: string; // YYYY-MM-DD when this snapshot was computed
}

export interface MonthlyPayrollEntry {
  empId: string;
  name: string;
  year: number;
  month: number;
  /** Base monthly salary as configured on the employee record (IQD). */
  baseSalary: number;
  /** Effective hourly rate used for OT premiums. */
  hourlyRate: number;
  /** Hours worked at regular rate (≤ monthly cap). */
  regularHours: number;
  /** Hours over the monthly cap. */
  otHours: number;
  /** Estimated OT cost = otHours × hourlyRate × otRateDay (a flat estimate;
   *  exact night/holiday split lives in the Payroll tab, not here). */
  estimatedOtCost: number;
  /** Total estimated payroll (base + estimatedOtCost). */
  estimatedTotal: number;
  kind: 'actual';
  asOf: string;
}

export interface ComplianceMonthSummary {
  year: number;
  month: number;
  totalFindings: number;
  violationCount: number;
  infoCount: number;
  /** Up to N most-frequent ruleKeys this month. */
  topRules: Array<{ ruleKey: string | undefined; rule: string; count: number }>;
  /** Per-employee finding count, descending. Truncated. */
  topEmployees: Array<{ empId: string; name: string; count: number }>;
  kind: 'actual';
  asOf: string;
}

export interface LeaveBalanceSnapshot {
  empId: string;
  name: string;
  annualLeaveBalance: number;
  holidayBank: number;
  /** If currently on leave, the active range. */
  activeLeave: { type: string; start: string; end: string } | null;
  asOf: string;
}

export interface LeaveHistoryEntry {
  empId: string;
  name: string;
  type: string;
  start: string;
  end: string;
  days: number;
}

export interface StationSummary {
  id: string;
  name: string;
  groupId: string | undefined;
  normalMinHC: number;
  peakMinHC: number;
  holidayMinHC: number | undefined;
  openingTime: string;
  closingTime: string;
  requiredRoles: string[];
  /** Total hourly demand = sum of slot HCs × slot duration. Null when no
   *  hourly profile is set (the flat min HC fallback applies). */
  normalHourlyDemandTotal: number | null;
  peakHourlyDemandTotal: number | null;
  /** Profile snapshot if one exists, else null. */
  profile: StationProfile | null;
}

export interface EmployeeSummary {
  empId: string;
  name: string;
  role: string;
  department: string;
  contractType: string;
  contractedWeeklyHrs: number;
  category: string;
  baseMonthlySalary: number;
  hireDate: string;
  eligibleStations: string[];
  eligibleGroups: string[];
  holidayBank: number;
  annualLeaveBalance: number;
}

export interface WfpForecast {
  year: number;
  /** Currently-rostered headcount snapshot. */
  currentHC: number;
  currentByRole: Record<string, number>;
  currentByCategory: Record<string, number>;
  /** Holiday days projected into the target year (used by WFP rollups). */
  projectedHolidayCount: number;
  /** Weekly hours cap (Iraqi Labor Law) — context for OT projection. */
  standardWeeklyHrsCap: number;
  /** Active leave windows that fall inside the target year. */
  scheduledLeaveDays: number;
  kind: 'plan';
  horizon: string; // 'YYYY-01-01..YYYY-12-31'
}

// ─── Internal helpers ───────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function* iterateMonths(range: MonthRangeArg): Generator<{ year: number; month: number }> {
  const fromKey = range.fromYear * 12 + (range.fromMonth - 1);
  const toKey = range.toYear * 12 + (range.toMonth - 1);
  if (toKey < fromKey) return;
  for (let k = fromKey; k <= toKey; k++) {
    yield { year: Math.floor(k / 12), month: (k % 12) + 1 };
  }
}

function findEmployee(employees: Employee[], empId: string): Employee | undefined {
  return employees.find((e) => e.empId === empId);
}

function safeName(emp: Employee | undefined, empId: string): string {
  return emp?.name ?? empId;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// Counts the days an employee was on each leave type during a month.
function countMonthlyLeaveDays(
  emp: Employee,
  year: number,
  month: number,
): { annual: number; sick: number; maternity: number; other: number } {
  const out = { annual: 0, sick: 0, maternity: 0, other: 0 };
  const days = daysInMonth(year, month);
  for (let d = 1; d <= days; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const r = getEmployeeLeaveOnDate(emp, dateStr);
    if (!r) continue;
    if (r.type === 'annual') out.annual++;
    else if (r.type === 'sick') out.sick++;
    else if (r.type === 'maternity') out.maternity++;
    else out.other++;
  }
  return out;
}

function inclusiveDayCount(start: string, end: string): number {
  const a = parseISO(start);
  const b = parseISO(end);
  if (!isValid(a) || !isValid(b)) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

function pickProfile(profiles: Record<string, StationProfile>, stationId: string): StationProfile | null {
  return profiles[stationId] ?? null;
}

// ─── Query functions ────────────────────────────────────────────────────

/**
 * Per-employee, per-month rollup for every month in the window.
 * Drives the payroll, OT-pressure, and overall workload story.
 */
export function getSchedules(
  data: CompanyData,
  range: MonthRangeArg,
): MonthlyEmployeeStats[] {
  const out: MonthlyEmployeeStats[] = [];
  const asOf = todayIso();
  const expandedHolidays = expandHolidayDates(data.holidays);
  const holidayDates = new Set(expandedHolidays.map((h) => h.date));
  const cap = monthlyHourCap(data.config);
  const shiftByCode = new Map(data.shifts.map((s) => [s.code, s]));

  for (const { year, month } of iterateMonths(range)) {
    const sched = data.allSchedules?.[scheduleKeyFor(year, month)] ?? {};
    const days = daysInMonth(year, month);
    const monthCfg = { ...data.config, year, month, daysInMonth: days };

    for (const emp of data.employees) {
      const empSched = sched[emp.empId] ?? {};
      // Re-use the canonical worked-hours math from lib/payroll so the AI
      // sees the same number the Payroll tab would render.
      const hoursWorked = computeWorkedHours(emp, sched, data.shifts, monthCfg);
      const otHours = Math.max(0, hoursWorked - cap);
      let workDays = 0;
      let holidayWorkDays = 0;
      for (const [dStr, entry] of Object.entries(empSched)) {
        const d = Number(dStr);
        if (!Number.isFinite(d)) continue;
        const shift = shiftByCode.get(entry.shiftCode);
        if (!shift?.isWork) continue;
        // Drop leave-overlap days from work counts (matches computeWorkedHours).
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (getEmployeeLeaveOnDate(emp, dateStr)) continue;
        workDays++;
        if (holidayDates.has(dateStr)) holidayWorkDays++;
      }
      out.push({
        empId: emp.empId,
        name: emp.name,
        year, month,
        hoursWorked,
        otHours,
        workDays,
        leaveDays: countMonthlyLeaveDays(emp, year, month),
        holidayWorkDays,
        kind: 'actual',
        asOf,
      });
    }
  }
  return out;
}

/** Per-employee, per-month payroll estimate over the window. */
export function getPayroll(
  data: CompanyData,
  range: MonthRangeArg,
): MonthlyPayrollEntry[] {
  const out: MonthlyPayrollEntry[] = [];
  const asOf = todayIso();
  const cap = monthlyHourCap(data.config);
  const otRateDay = data.config.otRateDay ?? 1.5;

  for (const { year, month } of iterateMonths(range)) {
    const sched = data.allSchedules?.[scheduleKeyFor(year, month)] ?? {};
    const days = daysInMonth(year, month);
    const monthCfg = { ...data.config, year, month, daysInMonth: days };

    for (const emp of data.employees) {
      const hoursWorked = computeWorkedHours(emp, sched, data.shifts, monthCfg);
      const regularHours = Math.min(cap, hoursWorked);
      const otHours = Math.max(0, hoursWorked - cap);
      const hourlyRate = baseHourlyRate(emp, data.config);
      const estimatedOtCost = otHours * hourlyRate * otRateDay;
      const baseSalary = emp.baseMonthlySalary || 0;
      out.push({
        empId: emp.empId,
        name: emp.name,
        year, month,
        baseSalary,
        hourlyRate: Math.round(hourlyRate),
        regularHours,
        otHours,
        estimatedOtCost: Math.round(estimatedOtCost),
        estimatedTotal: Math.round(baseSalary + estimatedOtCost),
        kind: 'actual',
        asOf,
      });
    }
  }
  return out;
}

/** One compliance summary per month in the window. Reuses ComplianceEngine. */
export function getCompliance(
  data: CompanyData,
  range: MonthRangeArg,
  topN = 5,
): ComplianceMonthSummary[] {
  const out: ComplianceMonthSummary[] = [];
  const asOf = todayIso();
  const expandedHolidays = expandHolidayDates(data.holidays);

  for (const { year, month } of iterateMonths(range)) {
    const sched = data.allSchedules?.[scheduleKeyFor(year, month)] ?? {};
    const days = daysInMonth(year, month);
    const monthCfg = { ...data.config, year, month, daysInMonth: days };
    const findings: Violation[] = ComplianceEngine.check(
      data.employees,
      data.shifts,
      expandedHolidays,
      monthCfg,
      sched,
      data.allSchedules,
    );

    const violationCount = findings.filter((f) => f.severity !== 'info').length;
    const infoCount = findings.length - violationCount;

    const ruleCounts = new Map<string, { ruleKey: string | undefined; rule: string; count: number }>();
    for (const f of findings) {
      const key = f.ruleKey ?? f.rule;
      const cur = ruleCounts.get(key);
      if (cur) cur.count++;
      else ruleCounts.set(key, { ruleKey: f.ruleKey, rule: f.rule, count: 1 });
    }
    const topRules = Array.from(ruleCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);

    const empCounts = new Map<string, number>();
    for (const f of findings) empCounts.set(f.empId, (empCounts.get(f.empId) ?? 0) + 1);
    const topEmployees = Array.from(empCounts.entries())
      .map(([empId, count]) => ({ empId, name: safeName(findEmployee(data.employees, empId), empId), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);

    out.push({
      year, month,
      totalFindings: findings.length,
      violationCount,
      infoCount,
      topRules,
      topEmployees,
      kind: 'actual',
      asOf,
    });
  }
  return out;
}

/**
 * Snapshot of every employee's leave balance + active leave on the asOf date.
 * Pure read of `Employee` records — no schedule scan needed.
 */
export function getLeaveBalances(data: CompanyData, asOf: string): LeaveBalanceSnapshot[] {
  return data.employees.map((emp) => {
    const active = getEmployeeLeaveOnDate(emp, asOf);
    return {
      empId: emp.empId,
      name: emp.name,
      annualLeaveBalance: emp.annualLeaveBalance ?? 0,
      holidayBank: emp.holidayBank ?? 0,
      activeLeave: active ? { type: active.type, start: active.start, end: active.end } : null,
      asOf,
    };
  });
}

/**
 * Every leave range across every employee that intersects [from, to].
 * Includes legacy single-range fields for pre-1.7 records.
 */
export function getLeaveHistory(
  data: CompanyData,
  from: string,
  to: string,
): LeaveHistoryEntry[] {
  const out: LeaveHistoryEntry[] = [];
  const overlap = (start: string, end: string) => start <= to && end >= from;
  for (const emp of data.employees) {
    const ranges: LeaveRange[] = emp.leaveRanges ?? [];
    for (const r of ranges) {
      if (!r.start || !r.end) continue;
      if (!overlap(r.start, r.end)) continue;
      out.push({
        empId: emp.empId, name: emp.name,
        type: r.type, start: r.start, end: r.end,
        days: inclusiveDayCount(r.start, r.end),
      });
    }
    // Legacy fallbacks — synthesize so the AI still sees pre-v1.7 leave.
    const legacy: Array<[string | undefined, string | undefined, string]> = [
      [emp.maternityLeaveStart, emp.maternityLeaveEnd, 'maternity'],
      [emp.sickLeaveStart, emp.sickLeaveEnd, 'sick'],
      [emp.annualLeaveStart, emp.annualLeaveEnd, 'annual'],
    ];
    for (const [start, end, type] of legacy) {
      if (!start || !end) continue;
      if (!overlap(start, end)) continue;
      out.push({
        empId: emp.empId, name: emp.name,
        type, start, end, days: inclusiveDayCount(start, end),
      });
    }
  }
  // Sort chronologically — easier for the AI to summarize "most recent leave".
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}

/** Every station in the workspace, with its profile attached if one exists. */
export function getStations(
  data: CompanyData,
  profiles: Record<string, StationProfile>,
): StationSummary[] {
  const sumHourly = (slots: { startHour: number; endHour: number; hc: number }[] | undefined): number | null => {
    if (!slots || slots.length === 0) return null;
    let total = 0;
    for (const s of slots) total += (s.endHour - s.startHour) * s.hc;
    return total;
  };
  return data.stations.map((s) => ({
    id: s.id,
    name: s.name,
    groupId: s.groupId,
    normalMinHC: s.normalMinHC,
    peakMinHC: s.peakMinHC,
    holidayMinHC: s.holidayMinHC,
    openingTime: s.openingTime,
    closingTime: s.closingTime,
    requiredRoles: s.requiredRoles ?? [],
    normalHourlyDemandTotal: sumHourly(s.normalHourlyDemand),
    peakHourlyDemandTotal: sumHourly(s.peakHourlyDemand),
    profile: pickProfile(profiles, s.id),
  }));
}

export function getStationProfile(
  profiles: Record<string, StationProfile>,
  stationId: string,
): StationProfile | null {
  return pickProfile(profiles, stationId);
}

/** Compact employee roster — drops the heavy leave-range arrays. */
export function getEmployees(data: CompanyData): EmployeeSummary[] {
  return data.employees.map((e) => ({
    empId: e.empId,
    name: e.name,
    role: e.role,
    department: e.department,
    contractType: e.contractType,
    contractedWeeklyHrs: e.contractedWeeklyHrs,
    category: e.category ?? 'Standard',
    baseMonthlySalary: e.baseMonthlySalary ?? 0,
    hireDate: e.hireDate ?? '',
    eligibleStations: e.eligibleStations ?? [],
    eligibleGroups: e.eligibleGroups ?? [],
    holidayBank: e.holidayBank ?? 0,
    annualLeaveBalance: e.annualLeaveBalance ?? 0,
  }));
}

/**
 * Workforce-planning forecast for a target year.
 *
 * Phase 3 returns a structural forecast (current HC by role / category +
 * projected holiday count + scheduled-leave-days inside the year). Phase 4's
 * chat panel can ask follow-up tools (getSchedules, getPayroll) to extend
 * the picture; the WFP tab itself runs the deeper hour-by-hour projection
 * and isn't easy to call from a pure context yet.
 */
export function getWFP(data: CompanyData, year: number): WfpForecast {
  const currentByRole: Record<string, number> = {};
  const currentByCategory: Record<string, number> = {};
  for (const e of data.employees) {
    const role = e.role || 'unspecified';
    currentByRole[role] = (currentByRole[role] ?? 0) + 1;
    const cat = e.category ?? 'Standard';
    currentByCategory[cat] = (currentByCategory[cat] ?? 0) + 1;
  }

  // Project holidays into the target year using the same helper the WFP
  // tab uses. Many holidays in this dataset are Hijri-determined and drift
  // ~11 days/year, so the projection is the right basis for any forecast.
  let projectedHolidayCount: number;
  try {
    const { projected } = projectHolidaysToYear(data.holidays, year);
    projectedHolidayCount = expandHolidayDates(projected).length;
  } catch {
    projectedHolidayCount = expandHolidayDates(data.holidays).length;
  }

  // Sum leave days across every employee's leaveRanges that intersect the
  // target year.
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  let scheduledLeaveDays = 0;
  for (const emp of data.employees) {
    for (const r of emp.leaveRanges ?? []) {
      if (!r.start || !r.end) continue;
      if (r.end < yStart || r.start > yEnd) continue;
      const start = r.start < yStart ? yStart : r.start;
      const end = r.end > yEnd ? yEnd : r.end;
      scheduledLeaveDays += inclusiveDayCount(start, end);
    }
  }

  return {
    year,
    currentHC: data.employees.length,
    currentByRole,
    currentByCategory,
    projectedHolidayCount,
    standardWeeklyHrsCap: data.config.standardWeeklyHrsCap,
    scheduledLeaveDays,
    kind: 'plan',
    horizon: `${yStart}..${yEnd}`,
  };
}

// ─── Convenience formatters ─────────────────────────────────────────────

/** Format a YYYY-MM-DD using the same locale-free Western-Arabic the rest
 *  of the data layer uses, so the AI sees stable strings across users. */
export function formatYmd(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** Step the given month forward by `n` months (calendar arithmetic). */
export function stepMonth(year: number, month: number, n: number): { year: number; month: number } {
  const d = addMonths(new Date(year, month - 1, 1), n);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
