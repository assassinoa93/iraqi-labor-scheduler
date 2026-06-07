/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.27.0 — data-trust batch. Covers the two new pure helpers added with the
 * batch: identifier validation (prevents silent Firestore-doc overwrites and
 * illegal doc ids) and the leave-request audit diff (now that the queue is a
 * persisted, audited domain in both modes).
 */
import { describe, it, expect } from 'vitest';
import { validateIdentifier } from '../utils';
import { diffLeaveRequests } from '../audit';
import { remainingAnnualLeave, inclusiveDayCount } from '../leaves';
import type { Employee, LeaveRequest } from '../../types';

const baseEmp = (over: Partial<Employee>): Employee => ({
  empId: 'EMP-1', name: 'A', role: '', department: '', contractType: 'Permanent',
  contractedWeeklyHrs: 48, shiftEligibility: 'All', isHazardous: false,
  isIndustrialRotating: false, hourExempt: false, fixedRestDay: 0, phone: '',
  hireDate: '2020-01-01', notes: '', eligibleStations: [], holidayBank: 0,
  annualLeaveBalance: 21, baseMonthlySalary: 0, baseHourlyRate: 0, overtimeHours: 0,
  ...over,
});

describe('validateIdentifier', () => {
  it('accepts a unique, well-formed id', () => {
    expect(validateIdentifier('EMP-9', ['EMP-1', 'EMP-2'])).toBeNull();
  });

  it('rejects an empty / whitespace-only id', () => {
    expect(validateIdentifier('', [])).toBe('validate.id.required');
    expect(validateIdentifier('   ', [])).toBe('validate.id.required');
  });

  it('rejects a slash (would split a Firestore doc path)', () => {
    expect(validateIdentifier('A/B', [])).toBe('validate.id.slash');
  });

  it('rejects the reserved "." and ".." doc ids', () => {
    expect(validateIdentifier('.', [])).toBe('validate.id.dots');
    expect(validateIdentifier('..', [])).toBe('validate.id.dots');
  });

  it('rejects an exact duplicate (would overwrite the existing record)', () => {
    expect(validateIdentifier('EMP-1', ['EMP-1', 'EMP-2'])).toBe('validate.id.duplicate');
  });

  it('rejects a case-insensitive duplicate', () => {
    expect(validateIdentifier('emp-1', ['EMP-1'])).toBe('validate.id.duplicate');
  });

  it('ignores surrounding whitespace when comparing against existing ids', () => {
    expect(validateIdentifier('  EMP-1  ', ['EMP-1'])).toBe('validate.id.duplicate');
  });

  it('allows re-saving an unchanged id when existingIds excludes self', () => {
    // The caller passes OTHER ids only, so the edited record never collides
    // with itself.
    expect(validateIdentifier('EMP-1', ['EMP-2', 'EMP-3'])).toBeNull();
  });
});

describe('diffLeaveRequests', () => {
  const req = (over: Partial<LeaveRequest>): LeaveRequest => ({
    id: 'lvreq-1',
    empId: 'EMP-1',
    type: 'annual',
    start: '2026-06-01',
    end: '2026-06-03',
    reason: 'Eid',
    status: 'pending',
    createdAt: 1,
    createdBy: 'offline',
    ...over,
  });

  it('emits an add entry for a newly submitted request', () => {
    const entries = diffLeaveRequests([], [req({})]);
    expect(entries).toHaveLength(1);
    expect(entries[0].op).toBe('add');
    expect(entries[0].domain).toBe('leaveRequests');
    expect(entries[0].summary).toContain('Submitted');
    expect(entries[0].summary).toContain('EMP-1');
  });

  it('emits a modify entry rendering the new status on a decision', () => {
    const before = [req({ status: 'pending' })];
    const after = [req({ status: 'approved', decidedAt: 2, decidedBy: 'mgr' })];
    const entries = diffLeaveRequests(before, after);
    expect(entries).toHaveLength(1);
    expect(entries[0].op).toBe('modify');
    expect(entries[0].summary).toContain('Approved');
  });

  it('emits a remove entry when a request disappears', () => {
    const entries = diffLeaveRequests([req({})], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].op).toBe('remove');
  });

  it('treats undefined queues as empty (no churn)', () => {
    expect(diffLeaveRequests(undefined, undefined)).toEqual([]);
    expect(diffLeaveRequests(undefined, [])).toEqual([]);
  });

  it('emits nothing when the queue is unchanged', () => {
    const q = [req({})];
    expect(diffLeaveRequests(q, [req({})])).toEqual([]);
  });
});

describe('inclusiveDayCount', () => {
  it('counts a single day as 1', () => {
    expect(inclusiveDayCount('2026-06-01', '2026-06-01')).toBe(1);
  });
  it('counts an inclusive multi-day range', () => {
    expect(inclusiveDayCount('2026-06-01', '2026-06-05')).toBe(5);
  });
  it('returns 0 for an inverted or empty range', () => {
    expect(inclusiveDayCount('2026-06-05', '2026-06-01')).toBe(0);
    expect(inclusiveDayCount('', '2026-06-01')).toBe(0);
  });
});

describe('remainingAnnualLeave', () => {
  it('returns the full entitlement when no annual leave is booked', () => {
    expect(remainingAnnualLeave(baseEmp({ annualLeaveBalance: 21 }), '2026-06-01')).toBe(21);
  });

  it('subtracts annual leave booked anywhere in the same year', () => {
    const emp = baseEmp({
      annualLeaveBalance: 21,
      leaveRanges: [{ id: 'r1', type: 'annual', start: '2026-08-01', end: '2026-08-10' }], // 10 days
    });
    // counts the whole year, so a future August booking still reduces it
    expect(remainingAnnualLeave(emp, '2026-06-01')).toBe(11);
  });

  it('ignores leave in other years and non-annual types', () => {
    const emp = baseEmp({
      annualLeaveBalance: 21,
      leaveRanges: [
        { id: 'r1', type: 'annual', start: '2025-08-01', end: '2025-08-10' }, // prior year
        { id: 'r2', type: 'sick', start: '2026-03-01', end: '2026-03-10' },   // not annual
      ],
    });
    expect(remainingAnnualLeave(emp, '2026-06-01')).toBe(21);
  });

  it('floors at 0 on overdraw and never mutates the stored balance', () => {
    const emp = baseEmp({
      annualLeaveBalance: 5,
      leaveRanges: [{ id: 'r1', type: 'annual', start: '2026-02-01', end: '2026-02-20' }], // 20 days
    });
    expect(remainingAnnualLeave(emp, '2026-06-01')).toBe(0);
    expect(emp.annualLeaveBalance).toBe(5); // unchanged
  });
});
