import { Employee, LeaveRange, LeaveType, Schedule, Config } from '../types';
import { format } from 'date-fns';

// Single source of truth for "is this employee on leave on this date".
// Reads `leaveRanges` first; falls back to the legacy single-range fields
// (maternityLeaveStart/End, sickLeaveStart/End, annualLeaveStart/End) for
// pre-1.7 records that haven't been re-saved yet. Returns null when the
// employee has no active leave on the given date.
export function getEmployeeLeaveOnDate(emp: Employee, dateStr: string): LeaveRange | null {
  if (Array.isArray(emp.leaveRanges)) {
    for (const r of emp.leaveRanges) {
      if (r && r.start && r.end && dateStr >= r.start && dateStr <= r.end) return r;
    }
  }
  // Legacy single-range fallback. Returns synthetic LeaveRange objects so
  // callers can treat them uniformly.
  if (emp.maternityLeaveStart && emp.maternityLeaveEnd && dateStr >= emp.maternityLeaveStart && dateStr <= emp.maternityLeaveEnd) {
    return { id: '__legacy_maternity', type: 'maternity', start: emp.maternityLeaveStart, end: emp.maternityLeaveEnd };
  }
  if (emp.sickLeaveStart && emp.sickLeaveEnd && dateStr >= emp.sickLeaveStart && dateStr <= emp.sickLeaveEnd) {
    return { id: '__legacy_sick', type: 'sick', start: emp.sickLeaveStart, end: emp.sickLeaveEnd };
  }
  if (emp.annualLeaveStart && emp.annualLeaveEnd && dateStr >= emp.annualLeaveStart && dateStr <= emp.annualLeaveEnd) {
    return { id: '__legacy_annual', type: 'annual', start: emp.annualLeaveStart, end: emp.annualLeaveEnd };
  }
  return null;
}

// Convenience predicates — small wrappers so call sites read clearly without
// duplicating the per-type comparisons everywhere.
export function isOnLeaveType(emp: Employee, dateStr: string, type: LeaveType): boolean {
  const found = getEmployeeLeaveOnDate(emp, dateStr);
  return !!found && found.type === type;
}

// Returns every leave range on the employee, including legacy single-range
// fields converted to LeaveRange objects. Used by the LeaveManagerModal to
// present a unified list. Sorted by start date ascending.
export function listAllLeaveRanges(emp: Employee): LeaveRange[] {
  const out: LeaveRange[] = [];
  if (Array.isArray(emp.leaveRanges)) out.push(...emp.leaveRanges);
  // Surface legacy fields as additional rows so users editing for the first
  // time can see (and decide to keep, edit, or replace) the historical entry.
  if (emp.maternityLeaveStart && emp.maternityLeaveEnd) {
    out.push({ id: '__legacy_maternity', type: 'maternity', start: emp.maternityLeaveStart, end: emp.maternityLeaveEnd });
  }
  if (emp.sickLeaveStart && emp.sickLeaveEnd) {
    out.push({ id: '__legacy_sick', type: 'sick', start: emp.sickLeaveStart, end: emp.sickLeaveEnd });
  }
  if (emp.annualLeaveStart && emp.annualLeaveEnd) {
    out.push({ id: '__legacy_annual', type: 'annual', start: emp.annualLeaveStart, end: emp.annualLeaveEnd });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// Generate a small, monotonic-enough id for new leave ranges. Not crypto —
// just unique within the employee's list so React can use it as a key.
export function newLeaveRangeId(): string {
  return `lv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// v5.5.0 — count days of leave of a given type that overlap [fromDateStr,
// toDateStr] (both inclusive). Used by the Payroll tab to project
// "annual leave balance as of X date" — supervisor sees what each
// employee's balance will be after planned consumption between today
// and the chosen target date. Reads from the canonical `leaveRanges`
// array AND the legacy single-range fields so projections work on
// records that haven't been migrated yet. Painted-but-unadopted cells
// aren't counted because they only exist in-month and projecting
// across multiple months would mean walking allSchedules — out of scope
// for this projection. Adopt them via the LeaveManagerModal to include.
export function countLeaveDaysOfTypeInRange(
  emp: Employee,
  type: LeaveType,
  fromDateStr: string,
  toDateStr: string,
): number {
  if (toDateStr < fromDateStr) return 0;
  const ranges: Array<{ start: string; end: string }> = [];
  if (Array.isArray(emp.leaveRanges)) {
    for (const r of emp.leaveRanges) {
      if (r && r.type === type && r.start && r.end) ranges.push({ start: r.start, end: r.end });
    }
  }
  if (type === 'annual' && emp.annualLeaveStart && emp.annualLeaveEnd) {
    ranges.push({ start: emp.annualLeaveStart, end: emp.annualLeaveEnd });
  }
  if (type === 'sick' && emp.sickLeaveStart && emp.sickLeaveEnd) {
    ranges.push({ start: emp.sickLeaveStart, end: emp.sickLeaveEnd });
  }
  if (type === 'maternity' && emp.maternityLeaveStart && emp.maternityLeaveEnd) {
    ranges.push({ start: emp.maternityLeaveStart, end: emp.maternityLeaveEnd });
  }
  let total = 0;
  for (const r of ranges) {
    const ovStart = r.start > fromDateStr ? r.start : fromDateStr;
    const ovEnd = r.end < toDateStr ? r.end : toDateStr;
    if (ovEnd >= ovStart) {
      const days = Math.floor((new Date(ovEnd).getTime() - new Date(ovStart).getTime()) / 86400000) + 1;
      total += days;
    }
  }
  return total;
}

// Walk an employee's painted schedule cells in the active month and derive
// LeaveRange entries from contiguous runs of AL / SL / MAT codes (v1.15).
// Pre-1.15 the leave-history view in the Roster + Credits & Payroll tabs
// only showed entries the user had created via the LeaveManagerModal —
// but the supervisor often paints leaves directly on the schedule grid,
// which previously left no trace in the leave history. This helper closes
// that gap by reading the schedule and emitting synthetic ranges so both
// surfaces stay consistent. Synthetic ranges use ids prefixed with
// `__sched_` so callers can tell them apart from manually-created ones.
export function deriveLeaveRangesFromSchedule(
  emp: Employee, schedule: Schedule, config: Config,
): LeaveRange[] {
  const empSched = schedule[emp.empId] || {};
  const codeToType: Record<string, LeaveType> = { AL: 'annual', SL: 'sick', MAT: 'maternity' };
  const out: LeaveRange[] = [];
  type Run = { type: LeaveType; startDay: number; endDay: number };
  let active: Run | null = null;
  for (let day = 1; day <= config.daysInMonth; day++) {
    const entry = empSched[day];
    const t = entry?.shiftCode ? codeToType[entry.shiftCode] : undefined;
    if (t) {
      if (active && active.type === t) {
        active.endDay = day;
      } else {
        if (active) {
          out.push({
            id: `__sched_${active.type}_${active.startDay}`,
            type: active.type,
            start: format(new Date(config.year, config.month - 1, active.startDay), 'yyyy-MM-dd'),
            end: format(new Date(config.year, config.month - 1, active.endDay), 'yyyy-MM-dd'),
            notes: 'Painted on schedule',
          });
        }
        active = { type: t, startDay: day, endDay: day };
      }
    } else if (active) {
      out.push({
        id: `__sched_${active.type}_${active.startDay}`,
        type: active.type,
        start: format(new Date(config.year, config.month - 1, active.startDay), 'yyyy-MM-dd'),
        end: format(new Date(config.year, config.month - 1, active.endDay), 'yyyy-MM-dd'),
        notes: 'Painted on schedule',
      });
      active = null;
    }
  }
  if (active) {
    out.push({
      id: `__sched_${active.type}_${active.startDay}`,
      type: active.type,
      start: format(new Date(config.year, config.month - 1, active.startDay), 'yyyy-MM-dd'),
      end: format(new Date(config.year, config.month - 1, active.endDay), 'yyyy-MM-dd'),
      notes: 'Painted on schedule',
    });
  }
  return out;
}

// Same as `listAllLeaveRanges` but also folds in the synthetic ranges
// derived from the active month's painted schedule, with deduplication
// against any manually-created range that overlaps the same dates.
// Callers that have access to the schedule + config should prefer this so
// leaves painted on the grid show up in the leave-history view.
export function listAllLeaveRangesIncludingPainted(
  emp: Employee, schedule: Schedule, config: Config,
): LeaveRange[] {
  const manual = listAllLeaveRanges(emp);
  const painted = deriveLeaveRangesFromSchedule(emp, schedule, config);
  // Drop a painted range if a manual range fully covers it (avoid duplicates).
  const filteredPainted = painted.filter(p => !manual.some(m =>
    m.type === p.type && m.start <= p.start && m.end >= p.end));
  return [...manual, ...filteredPainted].sort((a, b) => a.start.localeCompare(b.start));
}

// When the user commits the leave editor, write back a clean `leaveRanges`
// array AND clear the legacy single-range fields so we don't double-count.
// Returns a new Employee record with the updated leave state.
export function applyLeaveRanges(emp: Employee, ranges: LeaveRange[]): Employee {
  return {
    ...emp,
    leaveRanges: ranges,
    maternityLeaveStart: undefined,
    maternityLeaveEnd: undefined,
    sickLeaveStart: undefined,
    sickLeaveEnd: undefined,
    annualLeaveStart: undefined,
    annualLeaveEnd: undefined,
  };
}
