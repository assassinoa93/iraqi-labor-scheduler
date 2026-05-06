/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-tab permission model.
 *
 * Three levels of access per tab — kept deliberately coarse so the
 * super-admin's per-user permissions UI stays manageable:
 *
 *   'none'  → tab is invisible in the sidebar; data routes return 403
 *   'read'  → tab visible, all add/edit/delete actions are hidden or
 *             disabled
 *   'full'  → tab visible, full read/write/delete authority
 *
 * Storage shape (in /users/{uid} Firestore doc):
 *
 *   tabPerms: {
 *     schedule: 'full',
 *     roster:   'read',
 *     // missing key → use role default (TAB_DEFAULTS_BY_ROLE)
 *   } | null   // null → use role default for every tab
 *
 * Why coarse? Most workflows want a binary "can edit / can't edit" plus
 * a "can see at all" gate. The super-admin can fine-tune per user; the
 * surface stays one dropdown per tab instead of a 3×N checkbox grid.
 *
 * Why on the user doc, not in custom claims?
 * Custom claims are capped at ~1KB and drive Firestore Security Rules.
 * Per-tab perms are a UI-layer affordance — Rules already enforce the
 * server-side role/company gates. Putting tabPerms in /users/{uid}
 * keeps claims small and lets the super-admin update perms without
 * forcing a token refresh.
 */

import type { Role } from './adminApi';

export type TabAccess = 'none' | 'read' | 'full';
export type TabPerms = Record<string, TabAccess>;

/**
 * Role-default tab access. Used when a user doesn't have an explicit
 * `tabPerms` override. Mirrors the legacy TAB_PERMISSIONS map but
 * upgraded to the read/full distinction (admin's Variables read-only
 * already encoded here, no longer special-cased in App.tsx).
 */
export const TAB_DEFAULTS_BY_ROLE: Record<Role, Record<string, TabAccess>> = {
  super_admin: {
    dashboard: 'full', schedule: 'full', roster: 'full', payroll: 'full',
    coverageOT: 'full', workforce: 'full', reports: 'full',
    layout: 'full', shifts: 'full', holidays: 'full', variables: 'full',
    audit: 'full', settings: 'full',
    // v5.20.0 — AI Services (BYOK OpenRouter). Visible to manager/admin/
    // super_admin so anyone in the planning hierarchy can use it; the
    // per-user encrypted key gate is the second filter.
    aiServices: 'full',
    superAdmin: 'full', userManagement: 'full',
  },
  // v5.1.1 — Holidays + Variables are per-company governance config
  // (Iraqi Labor Law caps, public holiday calendar, Ramadan window).
  // Editing them changes the rules every other role plays under, so
  // they're now super_admin-only on edit. Pre-v5.1.1 admin could edit
  // holidays + supervisor could too, which let operational users alter
  // governance config silently. Read access stays open so everyone can
  // see the rules in effect.
  admin: {
    dashboard: 'full', schedule: 'full', roster: 'full', payroll: 'full',
    coverageOT: 'full', workforce: 'full', reports: 'full',
    layout: 'full', shifts: 'full',
    holidays: 'read',
    variables: 'read',
    audit: 'full', settings: 'full',
    // v5.20.0 — admins manage their own AI key + use the assistant.
    aiServices: 'full',
    // No Super Admin / User Management for plain admins.
  },
  // v5.0 — first-tier validator. Sees the schedule + dashboard + audit log
  // (so they can review what was changed before locking) and operational
  // tabs read-only. Schedule grid itself enforces "no cell edits outside
  // draft state" so a 'full' on schedule still means "can lock / send back",
  // not "can stealth-edit cells while reviewing".
  manager: {
    dashboard: 'full', schedule: 'full', coverageOT: 'full',
    reports: 'full', audit: 'full', settings: 'full',
    roster: 'read', holidays: 'read', shifts: 'read', layout: 'read',
    payroll: 'read', workforce: 'read', variables: 'read',
    // v5.20.0 — managers are part of the planning loop the AI assists
    // with, so they get full access to AI Services with their own key.
    aiServices: 'full',
    // No Super Admin / User Management for managers.
  },
  supervisor: {
    dashboard: 'full', schedule: 'full', roster: 'full',
    coverageOT: 'full',
    layout: 'full', shifts: 'full',
    // v5.1.1 — supervisors keep read access to the holiday calendar so
    // they can plan around it, but can't edit it (governance config).
    holidays: 'read',
    // v5.1.3 — Variables tab visible (read) so supervisors can edit the
    // operating-window subsection (default open/close + per-day overrides).
    // The tab itself stays read-only for governance fields; the operating-
    // window subsection has its own write-gate inside VariablesTab.
    variables: 'read',
    settings: 'full',
    // v5.20.0 — supervisors are not in the planning hierarchy the AI
    // assistant is designed for. Hidden by default; super-admin can
    // grant per-user via tabPerms if a particular supervisor needs it.
    aiServices: 'none',
    // Supervisors don't see payroll/workforce/reports/audit by default —
    // super-admin can grant per-user.
  },
};

export function tabAccess(
  tab: string,
  role: Role | null,
  tabPerms: TabPerms | null,
): TabAccess {
  // Offline / no-auth: full access — preserves the v3.0.0 single-user
  // experience for Offline Demo mode.
  if (role === null) return 'full';

  // Per-user override always wins when present.
  if (tabPerms && Object.prototype.hasOwnProperty.call(tabPerms, tab)) {
    const v = tabPerms[tab];
    if (v === 'none' || v === 'read' || v === 'full') return v;
  }

  return TAB_DEFAULTS_BY_ROLE[role]?.[tab] ?? 'none';
}

export function canRead(tab: string, role: Role | null, tabPerms: TabPerms | null): boolean {
  return tabAccess(tab, role, tabPerms) !== 'none';
}
export function canWrite(tab: string, role: Role | null, tabPerms: TabPerms | null): boolean {
  return tabAccess(tab, role, tabPerms) === 'full';
}

/**
 * Tabs that the super-admin's permissions UI lets them grant per-user.
 * superAdmin / userManagement are intentionally excluded — they're
 * super-admin-only and not delegable.
 */
export const GRANTABLE_TABS: Array<{ key: string; label: string; default: TabAccess }> = [
  { key: 'dashboard',  label: 'Dashboard',          default: 'full' },
  { key: 'schedule',   label: 'Master Schedule',    default: 'full' },
  { key: 'roster',     label: 'Roster',             default: 'full' },
  { key: 'payroll',    label: 'Payroll',            default: 'none' },
  { key: 'coverageOT', label: 'Coverage / OT',      default: 'full' },
  { key: 'workforce',  label: 'Workforce Planning', default: 'none' },
  { key: 'reports',    label: 'Reports',            default: 'none' },
  { key: 'layout',     label: 'Layout',             default: 'full' },
  { key: 'shifts',     label: 'Shifts',             default: 'full' },
  // v5.1.1 — Holidays + Variables default to read-only for non-super_admin
  // users since they're governance config. Super-admin can still grant
  // 'full' per user when a delegate genuinely needs to edit them.
  { key: 'holidays',   label: 'Holidays',           default: 'read' },
  { key: 'variables',  label: 'Legal Variables',    default: 'read' },
  { key: 'audit',      label: 'Audit Log',          default: 'none' },
  { key: 'settings',   label: 'System Settings',    default: 'full' },
  // v5.20.0 — AI Services. Default 'none' for the supervisor row so the
  // grant UI shows it as off-by-default for them but can be flipped on
  // per user; manager/admin/super_admin already have it via role defaults.
  { key: 'aiServices', label: 'AI Services (Beta)', default: 'none' },
];
