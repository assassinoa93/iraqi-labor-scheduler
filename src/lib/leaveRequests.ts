/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.24.0 — Leave request workflow (pure data layer).
 *
 * Submission, listing, approval, and rejection of leave requests. Pure
 * functions over the LeaveRequest[] queue stored on CompanyData; no
 * Firestore / IndexedDB dependencies, so the same path serves both
 * Offline Demo and Online (Firestore-synced) modes.
 *
 * Approval stamps the leave onto the employee's `leaveRanges`, which
 * the rest of the platform (scheduler, compliance engine, leave-balance
 * projector) already reads through `lib/leaves.ts`. The request itself
 * stays in the queue as an audit record after the decision.
 *
 * Self-service flow (when a non-admin login UI exists):
 *   employee → submitLeaveRequest → pending
 *                                    │
 *                                    ↓
 *   manager  → approveLeaveRequest → approved + LeaveRange stamped
 *           or rejectLeaveRequest  → rejected (no LeaveRange written)
 */

import type { Employee, LeaveRange, LeaveRequest, LeaveRequestStatus, LeaveType } from '../types';

/** Stable, monotonic id for a new LeaveRequest. Includes a high-entropy
 *  suffix so concurrent submissions on the same ms don't collide. */
function generateRequestId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `lvreq-${t}-${r}`;
}

export interface SubmitArgs {
  empId: string;
  type: LeaveType;
  start: string;   // YYYY-MM-DD inclusive
  end: string;     // YYYY-MM-DD inclusive
  reason: string;
  createdBy: string;
}

/** Validate + build a new LeaveRequest. Throws an Error with a stable
 *  `.code` when the inputs are inconsistent so the caller can map the
 *  message to the i18n dictionary instead of relying on the throw text. */
export function buildLeaveRequest(args: SubmitArgs): LeaveRequest {
  const { empId, type, start, end, reason, createdBy } = args;
  if (!empId) throw Object.assign(new Error('Employee id is required.'), { code: 'EMP_REQUIRED' });
  if (!start || !end) throw Object.assign(new Error('Start and end dates are required.'), { code: 'DATES_REQUIRED' });
  if (start > end) throw Object.assign(new Error('Start date must be on or before the end date.'), { code: 'DATES_INVERTED' });
  if (!reason || !reason.trim()) throw Object.assign(new Error('A reason is required.'), { code: 'REASON_REQUIRED' });
  return {
    id: generateRequestId(),
    empId,
    type,
    start,
    end,
    reason: reason.trim(),
    status: 'pending',
    createdAt: Date.now(),
    createdBy,
  };
}

/** Append a new request to the queue. Pure — returns the next queue. */
export function submitLeaveRequest(
  queue: LeaveRequest[] | undefined,
  args: SubmitArgs,
): { next: LeaveRequest[]; request: LeaveRequest } {
  const request = buildLeaveRequest(args);
  return { next: [...(queue ?? []), request], request };
}

/** Mark a pending request approved. Throws when the request doesn't
 *  exist or is already decided so callers can surface a friendly error. */
export function approveLeaveRequest(
  queue: LeaveRequest[] | undefined,
  id: string,
  decidedBy: string,
): { next: LeaveRequest[]; request: LeaveRequest } {
  const list = queue ?? [];
  const idx = list.findIndex(r => r.id === id);
  if (idx === -1) throw Object.assign(new Error('Leave request not found.'), { code: 'NOT_FOUND' });
  if (list[idx].status !== 'pending') {
    throw Object.assign(new Error('Leave request has already been decided.'), { code: 'ALREADY_DECIDED' });
  }
  const updated: LeaveRequest = {
    ...list[idx],
    status: 'approved',
    decidedAt: Date.now(),
    decidedBy,
  };
  const next = list.map((r, i) => i === idx ? updated : r);
  return { next, request: updated };
}

export function rejectLeaveRequest(
  queue: LeaveRequest[] | undefined,
  id: string,
  decidedBy: string,
  reason: string,
): { next: LeaveRequest[]; request: LeaveRequest } {
  if (!reason || !reason.trim()) {
    throw Object.assign(new Error('A rejection reason is required.'), { code: 'REASON_REQUIRED' });
  }
  const list = queue ?? [];
  const idx = list.findIndex(r => r.id === id);
  if (idx === -1) throw Object.assign(new Error('Leave request not found.'), { code: 'NOT_FOUND' });
  if (list[idx].status !== 'pending') {
    throw Object.assign(new Error('Leave request has already been decided.'), { code: 'ALREADY_DECIDED' });
  }
  const updated: LeaveRequest = {
    ...list[idx],
    status: 'rejected',
    decidedAt: Date.now(),
    decidedBy,
    decisionReason: reason.trim(),
  };
  const next = list.map((r, i) => i === idx ? updated : r);
  return { next, request: updated };
}

/** Filter the queue by status. Defaults to pending — the queue's
 *  most-frequently-displayed view. */
export function filterByStatus(
  queue: LeaveRequest[] | undefined,
  status: LeaveRequestStatus = 'pending',
): LeaveRequest[] {
  return (queue ?? []).filter(r => r.status === status);
}

/** Map an approved LeaveRequest into the LeaveRange shape the rest of
 *  the platform already consumes. The LeaveRange ID mirrors the request
 *  id with a `lvr-` prefix so an admin can trace it back. */
export function leaveRangeFromRequest(req: LeaveRequest): LeaveRange {
  // maternity is a valid LeaveType but we surface it separately in the
  // request UI (sick/annual/unpaid would be the typical self-service
  // surface). Either way the mapping is direct because LeaveType is
  // shared.
  return {
    id: `lvr-${req.id}`,
    type: req.type,
    start: req.start,
    end: req.end,
    notes: req.reason,
  };
}

/** Stamp the approved request as a LeaveRange on the employee. Returns
 *  the next employees array (pure). When the employee already has an
 *  identical range (same id), the existing range is kept untouched. */
export function applyApprovedRequestToEmployees(
  employees: Employee[],
  req: LeaveRequest,
): Employee[] {
  const range = leaveRangeFromRequest(req);
  return employees.map(e => {
    if (e.empId !== req.empId) return e;
    const ranges = e.leaveRanges ?? [];
    if (ranges.some(r => r.id === range.id)) return e;
    return { ...e, leaveRanges: [...ranges, range] };
  });
}
