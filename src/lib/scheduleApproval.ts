/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.0 — Schedule approval state machine.
 *
 * Strict one-step-forward / one-step-back validation chain:
 *
 *   draft  ─submit→  submitted  ─lock→  locked  ─save→  saved
 *     ↑                  │                │              │
 *     │                  │ send-back       │ send-back   │ reopen (admin only,
 *     │                  ▼                 ▼             │  with tiered
 *     │              rejected ───→ draft              tiered   safeguards based
 *     │              (auto on first edit)             /        on hrisSync state)
 *     └─────────────────────────────────────────────/
 *
 * Each validator can EITHER proceed forward OR send back to the immediately
 * previous user — never skip a step. This forces every reviewer to see every
 * change before it advances. See the v5.0 plan for the design rationale.
 *
 * Cell content (the `entries` map on the schedule doc) is editable only when
 * `status === 'draft'`. In every other state the schedule grid renders
 * read-only for everyone, which is what makes "send back" meaningful — a
 * reviewer who wants changes can't stealth-edit; they send back with notes.
 *
 * ── Mode applicability ───────────────────────────────────────────────────
 * The approval workflow is **Online-mode only by design**. Offline Demo
 * mode is single-user — there's no second pair of eyes to validate against.
 * In that mode `useAuth().role === null`, which makes `availableActionsFor`
 * return all-false action flags + cells-always-editable. The banner
 * self-hides on (role===null && status==='draft'), no transitions are
 * exposed, and the legacy single-user UX is preserved unchanged. Dual-mode
 * parity is satisfied by Offline mode opting OUT of the workflow entirely
 * rather than implementing a degenerate single-user version of it.
 */

import type { Role } from './auth';
import type {
  ApprovalStatus, ApprovalAction, ApprovalBlock,
  ApprovalHistoryEntry,
} from './firestoreSchedules';

// ── State-machine validation ───────────────────────────────────────────────

export interface TransitionParams {
  from: ApprovalStatus;
  action: ApprovalAction;
  role: Role;
}

export interface TransitionResult {
  ok: boolean;
  /** Where the action lands, when ok. */
  to?: ApprovalStatus;
  /** When ok && action is 'send-back': which level sent it back. */
  rejectedFrom?: 'manager' | 'admin';
  /** Human-readable reason when !ok. */
  reason?: string;
}

/**
 * The single source of truth for "can role X take action Y on a schedule
 * currently in state Z?" — every renderer-side transition function and every
 * server-side equivalent must consult this validator.
 *
 * Returns the resulting state on success so call sites don't have to
 * re-derive it. Returns `reason` on failure so the UI can show why the
 * action was refused (helpful when a stale subscription caused a click on
 * an obsolete state).
 */
export function isValidTransition(p: TransitionParams): TransitionResult {
  const { from, action, role } = p;

  // v5.1.1 — strict role-per-action with two refinements after end-to-end
  // testing of v5.0.2:
  //   supervisor: submit (own work)
  //   manager:    submit (on behalf of supervisor), lock, send-back from submitted
  //   admin:      save, send-back from locked, reopen — NO cell edits, NO auto-scheduler
  //   super_admin: all (overrides every gate; audit log records actor)
  // Why manager can submit too: in real ops the supervisor occasionally
  // isn't around (sick day, vacation), and the workflow shouldn't grind
  // to a halt. Manager fills in + submits; the lock step is still the
  // manager's own approval, but the audit log shows who actually did
  // each piece. Admin remains strictly read-only on cells — they
  // monitor, send back, save, reopen. Cell edits stay with the people
  // who plan operations.
  const isSuper = role === 'super_admin';

  switch (action) {
    case 'submit':
      if (role !== 'supervisor' && role !== 'manager' && !isSuper) {
        return { ok: false, reason: 'Only supervisor or manager (or super-admin) may submit a schedule.' };
      }
      if (from !== 'draft' && from !== 'rejected') {
        return { ok: false, reason: `Cannot submit from "${from}". Only draft / rejected schedules may be submitted.` };
      }
      return { ok: true, to: 'submitted' };

    case 'lock':
      // Manager exclusively owns submitted→locked. Super-admin override
      // exists only as the "act for any role" emergency hatch.
      if (role !== 'manager' && !isSuper) {
        return { ok: false, reason: 'Only the manager (or super-admin) may lock a submitted schedule.' };
      }
      if (from !== 'submitted') {
        return { ok: false, reason: `Cannot lock from "${from}". Only submitted schedules may be locked.` };
      }
      return { ok: true, to: 'locked' };

    case 'save':
      // Admin (or super-admin) only.
      if (role !== 'admin' && !isSuper) {
        return { ok: false, reason: 'Only the admin (or super-admin) may finalize a schedule.' };
      }
      if (from !== 'locked') {
        return { ok: false, reason: `Cannot save from "${from}". Only locked schedules may be finalized.` };
      }
      return { ok: true, to: 'saved' };

    case 'send-back':
      // Two distinct cases, each owned by exactly one role tier:
      //   submitted → rejected   (manager rejects, supervisor receives)
      //   locked    → submitted  (admin sends back to manager)
      if (from === 'submitted') {
        if (role !== 'manager' && !isSuper) {
          return { ok: false, reason: 'Only the manager (or super-admin) may send a submitted schedule back to the supervisor.' };
        }
        // rejectedFrom distinguishes manager-initiated rejection from
        // super-admin emergency send-back. Both land in 'rejected'.
        const rejectedFrom: 'manager' | 'admin' = role === 'manager' ? 'manager' : 'admin';
        return { ok: true, to: 'rejected', rejectedFrom };
      }
      if (from === 'locked') {
        if (role !== 'admin' && !isSuper) {
          return { ok: false, reason: 'Only the admin (or super-admin) may send a locked schedule back to the manager.' };
        }
        return { ok: true, to: 'submitted', rejectedFrom: 'admin' };
      }
      return { ok: false, reason: `Cannot send back from "${from}". Only submitted or locked schedules can be sent back.` };

    case 'reopen':
      // Admin (or super-admin) only. Supervisors and managers cannot
      // reopen a saved (archived) schedule — saved is the official record.
      if (role !== 'admin' && !isSuper) {
        return { ok: false, reason: 'Only the admin (or super-admin) may reopen a saved schedule.' };
      }
      if (from !== 'saved') {
        return { ok: false, reason: `Cannot reopen from "${from}". Only saved schedules can be reopened.` };
      }
      return { ok: true, to: 'draft' };

    default: {
      // TypeScript exhaustiveness — if a new action is added to the union
      // and isn't handled here, the compiler flags this branch.
      const _exhaustive: never = action;
      return { ok: false, reason: `Unknown action: ${String(_exhaustive)}` };
    }
  }
}

// ── Convenience: compute the field-name prefix used to stamp at/by/notes ──
//
// The Firestore doc has parallel fields like `submittedAt/By/Notes`,
// `lockedAt/By/Notes`, etc. The transition functions write to whichever
// stamp pair matches the destination state. This helper normalises the
// mapping in one place.

export function stampPrefixForAction(
  action: ApprovalAction,
  to: ApprovalStatus,
): 'submitted' | 'locked' | 'saved' | 'rejected' | null {
  if (action === 'submit') return 'submitted';
  if (action === 'lock') return 'locked';
  if (action === 'save') return 'saved';
  if (action === 'send-back') return 'rejected';
  if (action === 'reopen') return null;   // reopen has no dedicated stamp; relies on history
  // No to-state-specific stamp for any other action.
  void to;
  return null;
}

// ── Effective-status resolver ──────────────────────────────────────────────
//
// Pre-v5.0 schedule docs have no `approval` field. They should read as
// 'draft' so the UI behaves identically to the legacy single-user flow.
// Centralised here so every consumer is aligned.

export function effectiveStatus(approval: ApprovalBlock | undefined): ApprovalStatus {
  return approval?.status ?? 'draft';
}

// ── Action-availability helper for the UI ──────────────────────────────────

export interface AvailableActions {
  canSubmit: boolean;
  canLock: boolean;
  canSave: boolean;
  canSendBack: boolean;
  canReopen: boolean;
  canEditCells: boolean;        // grid is editable only in draft (or rejected, which auto-clears)
}

export function availableActionsFor(
  status: ApprovalStatus,
  role: Role | null,
): AvailableActions {
  // Offline mode (role === null) — full access, single-user product.
  if (role === null) {
    return {
      canSubmit: false, canLock: false, canSave: false, canSendBack: false, canReopen: false,
      canEditCells: true,
    };
  }
  // v5.1.1 — admin is monitor-only. They can save / send back / reopen
  // through the workflow, but they cannot paint cells or run the
  // auto-scheduler — those manipulate operational data that supervisors
  // and managers own. Pre-v5.1.1 this gate was status-only, which let an
  // admin paint cells in any draft schedule.
  const stateAllowsEdit = status === 'draft' || status === 'rejected';
  const roleAllowsEdit = role !== 'admin';
  const canEditCells = stateAllowsEdit && roleAllowsEdit;
  return {
    canSubmit:   isValidTransition({ from: status, action: 'submit', role }).ok,
    canLock:     isValidTransition({ from: status, action: 'lock', role }).ok,
    canSave:     isValidTransition({ from: status, action: 'save', role }).ok,
    canSendBack: isValidTransition({ from: status, action: 'send-back', role }).ok,
    canReopen:   isValidTransition({ from: status, action: 'reopen', role }).ok,
    canEditCells,
  };
}

// ── Actor display formatter ────────────────────────────────────────────────
//
// v5.0.2 — every UI surface that attributes an approval action to a person
// (banner, action modals, pending-approvals queue, history viewer) calls
// through this so the formatting is consistent: prefer "Name · Position",
// fall back to just name, then to UID, then to 'unknown'. Pre-v5.0.2
// records have only the UID — they degrade gracefully.

export function formatApprovalActor(
  name: string | null | undefined,
  position: string | null | undefined,
  uid: string | null | undefined,
): string {
  if (name && position) return `${name} · ${position}`;
  if (name) return name;
  return uid ?? 'unknown';
}

// ── History entry construction (for the renderer-side transaction body) ────
//
// Firestore's serverTimestamp() can't sit inside an arrayUnion payload —
// the SDK rejects it. We use a millisecond client timestamp inside history
// entries; the parent stamp pair (submittedAt/lockedAt/etc.) carries the
// authoritative serverTimestamp for reliable ordering. History is for UX +
// the snapshot manifest, not for primary-key ordering.

export function buildHistoryEntry(params: {
  action: ApprovalAction;
  actor: string;
  actorEmail: string | null;
  // v5.0.2 — captured at action time so the audit trail keeps a stable
  // identity even if the user is later renamed or re-positioned.
  actorName?: string;
  actorPosition?: string;
  role: Role;
  notes?: string;
  destinationStatus?: ApprovalStatus;
}): ApprovalHistoryEntry {
  return {
    action: params.action,
    ts: Date.now(),
    actor: params.actor,
    actorEmail: params.actorEmail,
    role: params.role,
    ...(params.actorName ? { actorName: params.actorName } : {}),
    ...(params.actorPosition ? { actorPosition: params.actorPosition } : {}),
    ...(params.notes ? { notes: params.notes } : {}),
    ...(params.destinationStatus ? { destinationStatus: params.destinationStatus } : {}),
  };
}
