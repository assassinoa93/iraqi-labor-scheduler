/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3.2 / 3.6 — Typed renderer-side wrapper around `window.adminApi.*`.
 *
 * Every call is auto-scoped to the currently-active Firebase project
 * (looked up from getActiveStoredEntry()) so multi-database super-admins
 * don't have to thread projectId manually. The IPC handlers in main load
 * the corresponding `<userData>/firebase-admin/<projectId>/serviceAccount.json`.
 *
 * `isAvailable()` lets components render gracefully in non-Electron
 * environments (e.g. browser-only test builds, Storybook).
 */

import { getFirebaseAuth } from './firebase';
import { getActiveStoredEntry } from './firebaseConfigStorage';
import type { TabPerms } from './tabAccess';

export type Role = 'super_admin' | 'admin' | 'supervisor';

// Re-export so consumers of adminApi don't have to import from two places.
export type { TabPerms } from './tabAccess';

export interface AdminUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  role: Role | null;
  companies: string[];
  tabPerms: TabPerms | null;
}

export interface AuditStats {
  total: number;
  oldestTs: number | null;
}

export interface QuotaMetric {
  used: number | null;
  limit: number;
  error?: { code: string; message: string };
}

export interface QuotaUsage {
  reads: QuotaMetric;
  writes: QuotaMetric;
  deletes: QuotaMetric;
  fetchedAt: number;
  cached: boolean;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  role: Role;
  companies?: string[];
  displayName?: string;
  tabPerms?: TabPerms | null;
}

export interface SetUserRolePayload {
  uid: string;
  role: Role;
  companies?: string[];
  // null = clear; undefined = leave alone; object = replace.
  tabPerms?: TabPerms | null;
}

interface AdminApi {
  isLinked(projectId: string | null): Promise<{ linked: boolean; path: string | null }>;
  linkServiceAccount(projectId: string | null): Promise<{ path: string; projectId: string }>;
  bootstrapFirstSuperAdmin(projectId: string, uid: string): Promise<{ uid: string; email: string | null; role: 'super_admin' }>;
  bootstrapSuperAdminAccount(projectId: string, payload: { email: string; password: string; displayName?: string }): Promise<{ uid: string; email: string; role: 'super_admin' }>;
  listUsers(projectId: string, idToken: string): Promise<AdminUser[]>;
  createUser(projectId: string, idToken: string, payload: CreateUserPayload): Promise<{ uid: string; email: string | null; role: Role; companies: string[]; tabPerms: TabPerms | null }>;
  setUserRole(projectId: string, idToken: string, payload: SetUserRolePayload): Promise<{ uid: string; role: Role; companies: string[]; tabPerms: TabPerms | null }>;
  disableUser(projectId: string, idToken: string, uid: string): Promise<{ uid: string; disabled: true }>;
  enableUser(projectId: string, idToken: string, uid: string): Promise<{ uid: string; disabled: false }>;
  resetPassword(projectId: string, idToken: string, uid: string): Promise<{ uid: string; tempPassword: string }>;
  deleteUser(projectId: string, idToken: string, uid: string): Promise<{ uid: string; deleted: true }>;
  purgeAuditOlderThan(projectId: string, idToken: string, ts: number): Promise<{ deleted: number }>;
  auditStats(projectId: string, idToken: string): Promise<AuditStats>;
  quotaUsage(projectId: string, idToken: string, force?: boolean): Promise<QuotaUsage>;
  wipeLocalSecrets(): Promise<{ removed: string[] }>;
}

declare global {
  interface Window {
    adminApi?: AdminApi;
  }
}

export function isAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.adminApi;
}

function bridge(): AdminApi {
  if (!window.adminApi) {
    throw new Error('Admin API bridge is not loaded. This feature requires Electron.');
  }
  return window.adminApi;
}

function activeProjectId(): string {
  const entry = getActiveStoredEntry();
  if (!entry) {
    const err = new Error('No active database. Connect a Firebase project first.');
    (err as Error & { code: string }).code = 'NO_ACTIVE_PROJECT';
    throw err;
  }
  return entry.config.projectId;
}

async function token(): Promise<string> {
  const auth = await getFirebaseAuth();
  if (!auth.currentUser) throw new Error('Not signed in');
  return auth.currentUser.getIdToken(false);
}

// ── Linking (no token required — gates on file presence) ──────────────────

export const isLinked = () => {
  const entry = getActiveStoredEntry();
  return bridge().isLinked(entry ? entry.config.projectId : null);
};

export const linkServiceAccount = () => {
  const entry = getActiveStoredEntry();
  return bridge().linkServiceAccount(entry ? entry.config.projectId : null);
};

export const bootstrapFirstSuperAdmin = (uid: string) =>
  bridge().bootstrapFirstSuperAdmin(activeProjectId(), uid);

export const bootstrapSuperAdminAccount = (payload: { email: string; password: string; displayName?: string }) =>
  bridge().bootstrapSuperAdminAccount(activeProjectId(), payload);

// ── Users ─────────────────────────────────────────────────────────────────

export async function listUsers(): Promise<AdminUser[]> {
  return bridge().listUsers(activeProjectId(), await token());
}
export async function createUser(payload: CreateUserPayload) {
  return bridge().createUser(activeProjectId(), await token(), payload);
}
export async function setUserRole(payload: SetUserRolePayload) {
  return bridge().setUserRole(activeProjectId(), await token(), payload);
}
export async function disableUser(uid: string) {
  return bridge().disableUser(activeProjectId(), await token(), uid);
}
export async function enableUser(uid: string) {
  return bridge().enableUser(activeProjectId(), await token(), uid);
}
export async function resetPassword(uid: string) {
  return bridge().resetPassword(activeProjectId(), await token(), uid);
}
export async function deleteUser(uid: string) {
  return bridge().deleteUser(activeProjectId(), await token(), uid);
}

// ── Database cleanup ──────────────────────────────────────────────────────

export async function purgeAuditOlderThan(ts: number) {
  return bridge().purgeAuditOlderThan(activeProjectId(), await token(), ts);
}
export async function auditStats(): Promise<AuditStats> {
  return bridge().auditStats(activeProjectId(), await token());
}
export async function quotaUsage(force = false): Promise<QuotaUsage> {
  return bridge().quotaUsage(activeProjectId(), await token(), force);
}

// ── Local-secrets wipe (factory reset) ────────────────────────────────────

export async function wipeLocalSecrets(): Promise<{ removed: string[] }> {
  if (!isAvailable()) return { removed: [] };
  return bridge().wipeLocalSecrets();
}
