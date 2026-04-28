import { Employee, LeaveRange, LeaveType } from '../types';

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
