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
import type { LeaveRequest } from '../../types';

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
