import { describe, it, expect } from 'vitest';
import type { Employee, LeaveRequest } from '../../types';
import {
  applyApprovedRequestToEmployees,
  approveLeaveRequest,
  buildLeaveRequest,
  filterByStatus,
  leaveRangeFromRequest,
  rejectLeaveRequest,
  submitLeaveRequest,
} from '../leaveRequests';

const baseArgs = {
  empId: 'EMP-1',
  type: 'annual' as const,
  start: '2026-06-01',
  end: '2026-06-05',
  reason: 'Family event',
  createdBy: 'user@example.com',
};

describe('buildLeaveRequest', () => {
  it('builds a pending request with monotonic id and trimmed reason', () => {
    const r = buildLeaveRequest({ ...baseArgs, reason: '  Family event   ' });
    expect(r.id).toMatch(/^lvreq-/);
    expect(r.status).toBe('pending');
    expect(r.reason).toBe('Family event');
    expect(typeof r.createdAt).toBe('number');
  });

  it('rejects missing empId', () => {
    expect(() => buildLeaveRequest({ ...baseArgs, empId: '' }))
      .toThrowError(/Employee id/);
  });

  it('rejects missing dates', () => {
    expect(() => buildLeaveRequest({ ...baseArgs, start: '' })).toThrowError();
    expect(() => buildLeaveRequest({ ...baseArgs, end: '' })).toThrowError();
  });

  it('rejects inverted ranges', () => {
    expect(() => buildLeaveRequest({ ...baseArgs, start: '2026-06-10', end: '2026-06-05' }))
      .toThrowError(/start date/i);
  });

  it('rejects empty reason', () => {
    expect(() => buildLeaveRequest({ ...baseArgs, reason: '   ' }))
      .toThrowError(/reason/i);
  });
});

describe('submitLeaveRequest', () => {
  it('appends to an undefined queue without mutating', () => {
    const { next, request } = submitLeaveRequest(undefined, baseArgs);
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(request);
  });

  it('appends to an existing queue', () => {
    const existing: LeaveRequest[] = [
      { id: 'lvreq-x', empId: 'A', type: 'sick', start: '2026-01-01', end: '2026-01-02', reason: 'flu', status: 'pending', createdAt: 1, createdBy: 'u' },
    ];
    const { next } = submitLeaveRequest(existing, baseArgs);
    expect(next).toHaveLength(2);
    expect(existing).toHaveLength(1); // input not mutated
  });
});

describe('approveLeaveRequest', () => {
  const seed = (overrides: Partial<LeaveRequest> = {}): LeaveRequest[] => [{
    id: 'lvreq-1', empId: 'A', type: 'annual', start: '2026-06-01', end: '2026-06-05',
    reason: 'r', status: 'pending', createdAt: 1, createdBy: 'u', ...overrides,
  }];

  it('flips a pending request to approved with decidedBy + decidedAt', () => {
    const { next, request } = approveLeaveRequest(seed(), 'lvreq-1', 'manager@x');
    expect(request.status).toBe('approved');
    expect(request.decidedBy).toBe('manager@x');
    expect(typeof request.decidedAt).toBe('number');
    expect(next[0]).toBe(request);
  });

  it('throws when the request is missing', () => {
    expect(() => approveLeaveRequest(seed(), 'nope', 'm@x'))
      .toThrowError(/not found/i);
  });

  it('throws when the request is already decided', () => {
    expect(() => approveLeaveRequest(seed({ status: 'approved' }), 'lvreq-1', 'm@x'))
      .toThrowError(/already/i);
  });
});

describe('rejectLeaveRequest', () => {
  const seed = (): LeaveRequest[] => [{
    id: 'lvreq-1', empId: 'A', type: 'annual', start: '2026-06-01', end: '2026-06-05',
    reason: 'r', status: 'pending', createdAt: 1, createdBy: 'u',
  }];

  it('flips status to rejected with the decision reason recorded', () => {
    const { request } = rejectLeaveRequest(seed(), 'lvreq-1', 'manager@x', 'Operational conflict');
    expect(request.status).toBe('rejected');
    expect(request.decisionReason).toBe('Operational conflict');
    expect(request.decidedBy).toBe('manager@x');
  });

  it('requires a non-empty rejection reason', () => {
    expect(() => rejectLeaveRequest(seed(), 'lvreq-1', 'm@x', '   '))
      .toThrowError(/reason/i);
  });
});

describe('filterByStatus', () => {
  const seed: LeaveRequest[] = [
    { id: '1', empId: 'A', type: 'annual', start: '2026-06-01', end: '2026-06-05', reason: 'r', status: 'pending', createdAt: 1, createdBy: 'u' },
    { id: '2', empId: 'B', type: 'sick',   start: '2026-06-02', end: '2026-06-03', reason: 'r', status: 'approved', createdAt: 2, createdBy: 'u' },
    { id: '3', empId: 'C', type: 'annual', start: '2026-07-01', end: '2026-07-02', reason: 'r', status: 'rejected', createdAt: 3, createdBy: 'u' },
  ];
  it('defaults to pending', () => {
    expect(filterByStatus(seed)).toEqual([seed[0]]);
  });
  it('returns the requested status only', () => {
    expect(filterByStatus(seed, 'approved')).toEqual([seed[1]]);
    expect(filterByStatus(seed, 'rejected')).toEqual([seed[2]]);
  });
  it('returns [] for an undefined queue', () => {
    expect(filterByStatus(undefined)).toEqual([]);
  });
});

describe('leaveRangeFromRequest', () => {
  it('mirrors fields and prefixes the id with lvr-', () => {
    const req: LeaveRequest = {
      id: 'lvreq-abc', empId: 'X', type: 'annual', start: '2026-06-01', end: '2026-06-05',
      reason: 'Family', status: 'approved', createdAt: 1, createdBy: 'u', decidedAt: 2, decidedBy: 'm',
    };
    const range = leaveRangeFromRequest(req);
    expect(range.id).toBe('lvr-lvreq-abc');
    expect(range.type).toBe('annual');
    expect(range.start).toBe('2026-06-01');
    expect(range.end).toBe('2026-06-05');
    expect(range.notes).toBe('Family');
  });
});

describe('applyApprovedRequestToEmployees', () => {
  const baseEmp: Employee = {
    empId: 'A', name: 'Alice', role: 'Cashier', department: 'Ops', contractType: 'Permanent',
    contractedWeeklyHrs: 48, shiftEligibility: '', isHazardous: false, isIndustrialRotating: false,
    hourExempt: false, fixedRestDay: 5, phone: '', hireDate: '2024-01-01', notes: '',
    eligibleStations: [], holidayBank: 0, annualLeaveBalance: 20, baseMonthlySalary: 1_000_000,
    baseHourlyRate: 0, overtimeHours: 0,
  };
  const approved: LeaveRequest = {
    id: 'lvreq-1', empId: 'A', type: 'annual', start: '2026-06-01', end: '2026-06-05',
    reason: 'r', status: 'approved', createdAt: 1, createdBy: 'u', decidedAt: 2, decidedBy: 'm',
  };

  it('appends a LeaveRange to the matching employee', () => {
    const next = applyApprovedRequestToEmployees([baseEmp], approved);
    expect(next[0].leaveRanges).toHaveLength(1);
    expect(next[0].leaveRanges?.[0].id).toBe('lvr-lvreq-1');
  });

  it('leaves non-matching employees untouched (referential equality)', () => {
    const other: Employee = { ...baseEmp, empId: 'B', name: 'Bob' };
    const next = applyApprovedRequestToEmployees([baseEmp, other], approved);
    expect(next[1]).toBe(other);
  });

  it('is idempotent when the same request is applied twice', () => {
    const after1 = applyApprovedRequestToEmployees([baseEmp], approved);
    const after2 = applyApprovedRequestToEmployees(after1, approved);
    expect(after2[0].leaveRanges).toHaveLength(1);
  });
});
