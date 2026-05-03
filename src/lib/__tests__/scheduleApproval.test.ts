import { describe, it, expect } from 'vitest';
import {
  isValidTransition, availableActionsFor, effectiveStatus,
  buildHistoryEntry, stampPrefixForAction,
} from '../scheduleApproval';
import type { ApprovalStatus, ApprovalAction } from '../firestoreSchedules';
import type { Role } from '../auth';

// Exhaustive coverage of the (status × action × role) matrix. The state
// machine is the foundation everything else builds on, so being thorough
// here catches regressions before they reach the UI.

const ALL_STATUSES: ApprovalStatus[] = ['draft', 'submitted', 'rejected', 'locked', 'saved'];
const ALL_ACTIONS: ApprovalAction[] = ['submit', 'lock', 'save', 'send-back', 'reopen'];
const ALL_ROLES: Role[] = ['super_admin', 'admin', 'manager', 'supervisor'];

describe('isValidTransition — happy paths', () => {
  // The seven valid transitions documented in the v5.0 plan.

  it('supervisor can submit from draft', () => {
    const r = isValidTransition({ from: 'draft', action: 'submit', role: 'supervisor' });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('submitted');
  });

  it('supervisor can submit from rejected (resubmit after send-back)', () => {
    const r = isValidTransition({ from: 'rejected', action: 'submit', role: 'supervisor' });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('submitted');
  });

  it('manager can lock submitted', () => {
    const r = isValidTransition({ from: 'submitted', action: 'lock', role: 'manager' });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('locked');
  });

  it('admin can lock submitted (overrides manager-only)', () => {
    const r = isValidTransition({ from: 'submitted', action: 'lock', role: 'admin' });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('locked');
  });

  it('admin can save from locked', () => {
    const r = isValidTransition({ from: 'locked', action: 'save', role: 'admin' });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('saved');
  });

  it('manager send-back from submitted lands in rejected with rejectedFrom=manager', () => {
    const r = isValidTransition({ from: 'submitted', action: 'send-back', role: 'manager' });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('rejected');
    expect(r.rejectedFrom).toBe('manager');
  });

  it('admin send-back from submitted lands in rejected with rejectedFrom=admin', () => {
    const r = isValidTransition({ from: 'submitted', action: 'send-back', role: 'admin' });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('rejected');
    expect(r.rejectedFrom).toBe('admin');
  });

  it('admin send-back from locked lands back in submitted (one step back to manager)', () => {
    const r = isValidTransition({ from: 'locked', action: 'send-back', role: 'admin' });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('submitted');
    expect(r.rejectedFrom).toBe('admin');
  });

  it('admin can reopen saved', () => {
    const r = isValidTransition({ from: 'saved', action: 'reopen', role: 'admin' });
    expect(r.ok).toBe(true);
    expect(r.to).toBe('draft');
  });

  it('super_admin can do everything from anywhere', () => {
    expect(isValidTransition({ from: 'draft', action: 'submit', role: 'super_admin' }).ok).toBe(true);
    expect(isValidTransition({ from: 'submitted', action: 'lock', role: 'super_admin' }).ok).toBe(true);
    expect(isValidTransition({ from: 'submitted', action: 'send-back', role: 'super_admin' }).ok).toBe(true);
    expect(isValidTransition({ from: 'locked', action: 'save', role: 'super_admin' }).ok).toBe(true);
    expect(isValidTransition({ from: 'locked', action: 'send-back', role: 'super_admin' }).ok).toBe(true);
    expect(isValidTransition({ from: 'saved', action: 'reopen', role: 'super_admin' }).ok).toBe(true);
  });
});

describe('isValidTransition — role-based denials', () => {
  it('manager cannot submit (only supervisor + super-admin can)', () => {
    expect(isValidTransition({ from: 'draft', action: 'submit', role: 'manager' }).ok).toBe(false);
    expect(isValidTransition({ from: 'draft', action: 'submit', role: 'admin' }).ok).toBe(false);
  });

  it('supervisor cannot lock', () => {
    const r = isValidTransition({ from: 'submitted', action: 'lock', role: 'supervisor' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/manager/i);
  });

  it('manager cannot save (admin tier only)', () => {
    const r = isValidTransition({ from: 'locked', action: 'save', role: 'manager' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/admin/i);
  });

  it('supervisor cannot save', () => {
    expect(isValidTransition({ from: 'locked', action: 'save', role: 'supervisor' }).ok).toBe(false);
  });

  it('supervisor cannot send-back from any state', () => {
    expect(isValidTransition({ from: 'submitted', action: 'send-back', role: 'supervisor' }).ok).toBe(false);
    expect(isValidTransition({ from: 'locked', action: 'send-back', role: 'supervisor' }).ok).toBe(false);
  });

  it('manager cannot send-back from locked (admin only)', () => {
    const r = isValidTransition({ from: 'locked', action: 'send-back', role: 'manager' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/admin/i);
  });

  it('supervisor cannot reopen saved', () => {
    expect(isValidTransition({ from: 'saved', action: 'reopen', role: 'supervisor' }).ok).toBe(false);
  });

  it('manager cannot reopen saved', () => {
    expect(isValidTransition({ from: 'saved', action: 'reopen', role: 'manager' }).ok).toBe(false);
  });
});

describe('isValidTransition — invalid state transitions', () => {
  it('cannot submit from submitted', () => {
    expect(isValidTransition({ from: 'submitted', action: 'submit', role: 'supervisor' }).ok).toBe(false);
  });

  it('cannot submit from locked', () => {
    expect(isValidTransition({ from: 'locked', action: 'submit', role: 'supervisor' }).ok).toBe(false);
  });

  it('cannot submit from saved', () => {
    expect(isValidTransition({ from: 'saved', action: 'submit', role: 'supervisor' }).ok).toBe(false);
  });

  it('cannot lock from draft', () => {
    expect(isValidTransition({ from: 'draft', action: 'lock', role: 'manager' }).ok).toBe(false);
  });

  it('cannot lock from locked (already locked)', () => {
    expect(isValidTransition({ from: 'locked', action: 'lock', role: 'manager' }).ok).toBe(false);
  });

  it('cannot save from draft', () => {
    expect(isValidTransition({ from: 'draft', action: 'save', role: 'admin' }).ok).toBe(false);
  });

  it('cannot save from submitted (must lock first)', () => {
    expect(isValidTransition({ from: 'submitted', action: 'save', role: 'admin' }).ok).toBe(false);
  });

  it('cannot save from saved (already saved)', () => {
    expect(isValidTransition({ from: 'saved', action: 'save', role: 'admin' }).ok).toBe(false);
  });

  it('cannot send-back from draft', () => {
    expect(isValidTransition({ from: 'draft', action: 'send-back', role: 'admin' }).ok).toBe(false);
  });

  it('cannot send-back from saved', () => {
    expect(isValidTransition({ from: 'saved', action: 'send-back', role: 'admin' }).ok).toBe(false);
  });

  it('cannot send-back from rejected', () => {
    expect(isValidTransition({ from: 'rejected', action: 'send-back', role: 'admin' }).ok).toBe(false);
  });

  it('cannot reopen from draft / submitted / locked / rejected', () => {
    for (const s of ['draft', 'submitted', 'locked', 'rejected'] as ApprovalStatus[]) {
      expect(isValidTransition({ from: s, action: 'reopen', role: 'admin' }).ok).toBe(false);
    }
  });
});

describe('isValidTransition — exhaustive matrix sanity', () => {
  // We expect exactly N valid (status × action × role) combinations.
  // If this count drifts unexpectedly, it signals a state-machine change
  // that wasn't reflected in the plan.
  it('produces a stable count of valid transitions across all triples', () => {
    let validCount = 0;
    for (const s of ALL_STATUSES) {
      for (const a of ALL_ACTIONS) {
        for (const r of ALL_ROLES) {
          if (isValidTransition({ from: s, action: a, role: r }).ok) validCount++;
        }
      }
    }
    // Manually counted from the v5.0 transition matrix:
    //   submit:    draft+rejected (2 states) × supervisor+super (2 roles) = 4
    //   lock:      submitted (1) × manager+admin+super (3) = 3
    //   save:      locked (1) × admin+super (2) = 2
    //   send-back: submitted (1) × manager+admin+super (3) = 3
    //              + locked (1) × admin+super (2) = 2
    //   reopen:    saved (1) × admin+super (2) = 2
    //   TOTAL = 4 + 3 + 2 + 3 + 2 + 2 = 16
    expect(validCount).toBe(16);
  });

  it('every invalid result carries a human-readable reason', () => {
    for (const s of ALL_STATUSES) {
      for (const a of ALL_ACTIONS) {
        for (const r of ALL_ROLES) {
          const result = isValidTransition({ from: s, action: a, role: r });
          if (!result.ok) {
            expect(result.reason).toBeTruthy();
            expect(typeof result.reason).toBe('string');
          }
        }
      }
    }
  });
});

describe('availableActionsFor', () => {
  it('supervisor in draft can edit cells + submit, no other actions', () => {
    const a = availableActionsFor('draft', 'supervisor');
    expect(a.canEditCells).toBe(true);
    expect(a.canSubmit).toBe(true);
    expect(a.canLock).toBe(false);
    expect(a.canSave).toBe(false);
    expect(a.canSendBack).toBe(false);
    expect(a.canReopen).toBe(false);
  });

  it('supervisor in submitted is fully read-only', () => {
    const a = availableActionsFor('submitted', 'supervisor');
    expect(a.canEditCells).toBe(false);
    expect(a.canSubmit).toBe(false);
    expect(a.canLock).toBe(false);
    expect(a.canSendBack).toBe(false);
  });

  it('manager in submitted can lock + send-back, cannot edit cells', () => {
    const a = availableActionsFor('submitted', 'manager');
    expect(a.canEditCells).toBe(false);
    expect(a.canLock).toBe(true);
    expect(a.canSendBack).toBe(true);
    expect(a.canSubmit).toBe(false);
    expect(a.canSave).toBe(false);
  });

  it('admin in locked can save + send-back, cannot edit cells', () => {
    const a = availableActionsFor('locked', 'admin');
    expect(a.canEditCells).toBe(false);
    expect(a.canSave).toBe(true);
    expect(a.canSendBack).toBe(true);
    expect(a.canLock).toBe(false);
    expect(a.canReopen).toBe(false);
  });

  it('admin in saved can only reopen', () => {
    const a = availableActionsFor('saved', 'admin');
    expect(a.canEditCells).toBe(false);
    expect(a.canReopen).toBe(true);
    expect(a.canLock).toBe(false);
    expect(a.canSave).toBe(false);
    expect(a.canSendBack).toBe(false);
  });

  it('rejected schedule is editable for the supervisor (resubmit flow)', () => {
    const a = availableActionsFor('rejected', 'supervisor');
    expect(a.canEditCells).toBe(true);
    expect(a.canSubmit).toBe(true);
  });

  it('null role (offline mode) gets unrestricted cell editing', () => {
    const a = availableActionsFor('draft', null);
    expect(a.canEditCells).toBe(true);
    expect(a.canSubmit).toBe(false);  // no auth = no workflow
  });
});

describe('effectiveStatus', () => {
  it('returns draft when approval block is missing (backward compat)', () => {
    expect(effectiveStatus(undefined)).toBe('draft');
  });

  it('returns the explicit status when present', () => {
    expect(effectiveStatus({ status: 'locked' })).toBe('locked');
    expect(effectiveStatus({ status: 'saved' })).toBe('saved');
  });
});

describe('stampPrefixForAction', () => {
  it('maps submit → submitted', () => {
    expect(stampPrefixForAction('submit', 'submitted')).toBe('submitted');
  });

  it('maps lock → locked', () => {
    expect(stampPrefixForAction('lock', 'locked')).toBe('locked');
  });

  it('maps save → saved', () => {
    expect(stampPrefixForAction('save', 'saved')).toBe('saved');
  });

  it('maps send-back → rejected', () => {
    expect(stampPrefixForAction('send-back', 'rejected')).toBe('rejected');
  });

  it('returns null for reopen (no dedicated stamp; uses history)', () => {
    expect(stampPrefixForAction('reopen', 'draft')).toBe(null);
  });
});

describe('buildHistoryEntry', () => {
  it('captures all required fields with optional notes + destinationStatus', () => {
    const entry = buildHistoryEntry({
      action: 'lock',
      actor: 'uid-123',
      actorEmail: 'manager@example.com',
      role: 'manager',
      notes: 'Looks good',
      destinationStatus: 'locked',
    });
    expect(entry.action).toBe('lock');
    expect(entry.actor).toBe('uid-123');
    expect(entry.actorEmail).toBe('manager@example.com');
    expect(entry.role).toBe('manager');
    expect(entry.notes).toBe('Looks good');
    expect(entry.destinationStatus).toBe('locked');
    expect(typeof entry.ts).toBe('number');
  });

  it('omits notes when not provided', () => {
    const entry = buildHistoryEntry({
      action: 'submit',
      actor: 'uid-1',
      actorEmail: null,
      role: 'supervisor',
    });
    expect(entry.notes).toBeUndefined();
    expect(entry.destinationStatus).toBeUndefined();
  });

  it('handles null actorEmail gracefully', () => {
    const entry = buildHistoryEntry({
      action: 'submit', actor: 'uid-1', actorEmail: null, role: 'supervisor',
    });
    expect(entry.actorEmail).toBe(null);
  });
});
