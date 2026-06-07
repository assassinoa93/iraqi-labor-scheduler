/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.27 — Configurable approval chain + no-halt fallback.
 *
 * The schedule approval state machine ([scheduleApproval.ts]) is a fixed
 * 4-state flow: draft → submitted → locked → saved, with three forward
 * transitions — submit / lock / save. Pre-v5.27 each transition was owned by
 * a HARDCODED role (supervisor/manager submit, manager lock, admin save), so a
 * company with no `manager` user could never get a submitted schedule locked
 * (only a super-admin override could), and one with no `admin` could never
 * finalize. The chain silently halted.
 *
 * v5.27 keeps the same 4 states but:
 *   1. makes the OWNER of each forward transition configurable per workspace
 *      (super-admin), and
 *   2. adds an automatic FALLBACK — when the configured owner role has no user
 *      in the workspace, the step folds onto the nearest PRESENT higher-
 *      authority role (admin absorbs the manager's validation; if neither
 *      manager nor admin exists, the supervisor's submit completes it).
 *      super_admin is always the ultimate override, so the chain never halts.
 *
 * This module is PURE (no storage / Firestore) so it is unit-testable and runs
 * identically on the super-admin UI preview and wherever the effective chain is
 * persisted/read. Offline Demo mode does not use the approval workflow at all
 * (role === null), so this is Online-mode only — dual-mode parity is satisfied
 * by Offline opting out, exactly as the existing workflow already does.
 */
import type { Role } from './auth';

/** The three forward transitions, named by intent (state machine: submit→lock→save). */
export type ApprovalStepId = 'submit' | 'validate' | 'finalize';

export interface ApprovalStep {
  id: ApprovalStepId;
  /** Configured owner role for this step. */
  role: Role;
}

export interface WorkspaceApprovalConfig {
  /** Owners for the three forward transitions (submit / validate→lock / finalize→save). */
  steps: ApprovalStep[];
  /**
   * When true (default), a step whose configured owner role has no user in the
   * workspace folds onto the nearest present higher-authority role, so the
   * chain never halts. When false, the strict pre-v5.27 behaviour is preserved
   * (only a super-admin can act for an absent role).
   */
  autoFallback: boolean;
}

/** Canonical default: supervisor submits → manager validates → admin finalizes. */
export const DEFAULT_APPROVAL_CONFIG: WorkspaceApprovalConfig = {
  steps: [
    { id: 'submit', role: 'supervisor' },
    { id: 'validate', role: 'manager' },
    { id: 'finalize', role: 'admin' },
  ],
  autoFallback: true,
};

/** Authority ladder, low → high. super_admin is the ultimate override. */
const AUTHORITY: readonly Role[] = ['supervisor', 'manager', 'admin', 'super_admin'];

/** Roles that have at least one user in the workspace (for fallback resolution). */
export function presentRolesFrom(users: ReadonlyArray<{ role: Role }>): Set<Role> {
  return new Set(users.map((u) => u.role));
}

/**
 * Resolve the role that effectively owns a transition whose configured owner is
 * `configured`, given the roles present in the workspace. Folds up to the
 * nearest present higher-authority role, else down, else super_admin.
 */
function resolveOwner(configured: Role, present: ReadonlySet<Role>, autoFallback: boolean): Role {
  if (present.has(configured)) return configured;
  if (!autoFallback) return configured; // strict — only a super-admin override can act
  const idx = AUTHORITY.indexOf(configured);
  for (let i = idx + 1; i < AUTHORITY.length; i++) {
    if (present.has(AUTHORITY[i])) return AUTHORITY[i]; // fold up to higher authority
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (present.has(AUTHORITY[i])) return AUTHORITY[i]; // else fold down
  }
  return 'super_admin'; // nothing present — super-admin is the always-available override
}

/** The effective owner of each forward transition after fallback. */
export interface EffectiveChain {
  submit: Role;
  lock: Role;
  save: Role;
}

/**
 * The single source of truth for "who owns each approval transition in this
 * workspace, right now" — combines the (super-admin) config with the roles
 * actually present, applying the no-halt fallback. scheduleApproval's
 * validator consumes this instead of hardcoding manager/admin.
 */
export function resolveEffectiveChain(
  config: WorkspaceApprovalConfig,
  presentRoles: ReadonlySet<Role>,
): EffectiveChain {
  const ownerOf = (id: ApprovalStepId, fallbackRole: Role): Role => {
    const step = config.steps.find((s) => s.id === id);
    return resolveOwner(step?.role ?? fallbackRole, presentRoles, config.autoFallback);
  };
  return {
    submit: ownerOf('submit', 'supervisor'),
    lock: ownerOf('validate', 'manager'),
    save: ownerOf('finalize', 'admin'),
  };
}
