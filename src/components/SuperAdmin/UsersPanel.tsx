/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3.3 — Super Admin → Users panel.
 *
 * Routine user management without leaving the app:
 *   - List all Auth users + their custom-claim role + scoped companies
 *   - Create a new user (email + temp password + role + companies)
 *   - Edit role (and re-scope companies for supervisors)
 *   - Disable / enable an account (revokes the refresh token so the next
 *     launch is blocked at login)
 *   - Reset password (Admin SDK generates a new temp password to share
 *     securely; user must change it on next login via the app's
 *     "first login" flow — currently they're prompted via Settings)
 *   - Delete a user (Auth + /users/{uid} doc)
 *
 * The list is loaded on mount; mutating ops re-fetch after success so the
 * UI reflects server-side state.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Users as UsersIcon, AlertCircle, Plus, Pencil, Trash2, Power, KeyRound,
  CheckCircle2, X, Copy, Check, ExternalLink,
} from 'lucide-react';
import * as adminApi from '../../lib/adminApi';
import type { AdminUser, Role, TabPerms } from '../../lib/adminApi';
import type { Company } from '../../types';
import { useAuth } from '../../lib/auth';
import { getActiveConfig } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import { GRANTABLE_TABS, type TabAccess } from '../../lib/tabAccess';
import { useConfirm } from '../ConfirmModal';

// Mirrors the helper in ConnectionPanel — a deep link to the active project's
// Service Accounts tab so the user can act on the "not linked" error without
// hunting through Firebase Console.
function serviceAccountsConsoleUrl(): string {
  const projectId = getActiveConfig()?.projectId;
  return projectId
    ? `https://console.firebase.google.com/project/${projectId}/settings/serviceaccounts/adminsdk`
    : 'https://console.firebase.google.com/';
}

interface Props {
  companies: Company[];
}

export function UsersPanel({ companies }: Props) {
  const { user: currentUser } = useAuth();
  const currentUid = currentUser?.uid ?? null;
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [tempPasswordFor, setTempPasswordFor] = useState<{ uid: string; email: string | null; password: string } | null>(null);
  const { confirm, slot: confirmSlot } = useConfirm();

  const refresh = async () => {
    if (!adminApi.isAvailable()) return;
    setLoading(true);
    setError(null);
    try {
      const list = await adminApi.listUsers();
      setUsers(list);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      setError(err.message ?? 'Failed to load users');
      // NOT_LINKED is the most common — just leave users as null and let
      // the panel render the "link service account first" message.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const handleDisable = async (u: AdminUser) => {
    // Self-protection: disabling your own account locks you out instantly —
    // refresh-token is revoked, sign-in fails, and there's no other
    // super-admin available to re-enable you on this install. Always block.
    if (u.uid === currentUid) {
      setError("You can't disable your own super-admin account from here. Ask another super-admin to do it, or use the Firebase Console.");
      return;
    }
    setLoading(true);
    try {
      if (u.disabled) await adminApi.enableUser(u.uid);
      else await adminApi.disableUser(u.uid);
      await refresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? 'Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (u: AdminUser) => {
    setLoading(true);
    try {
      const res = await adminApi.resetPassword(u.uid);
      setTempPasswordFor({ uid: u.uid, email: u.email, password: res.tempPassword });
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (u: AdminUser) => {
    if (u.uid === currentUid) {
      setError("You can't delete your own super-admin account from here. Ask another super-admin, or use the Firebase Console.");
      return;
    }
    const ok = await confirm({
      title: `Delete ${u.email ?? u.uid}?`,
      message: 'This permanently removes the Auth account and the /users/{uid} doc. This cannot be undone.',
    });
    if (!ok) return;
    setLoading(true);
    try {
      await adminApi.deleteUser(u.uid);
      await refresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? 'Failed to delete user');
    } finally {
      setLoading(false);
    }
  };

  if (!adminApi.isAvailable()) {
    return (
      <Section title="Users" subtitle="Create / disable / reset / delete">
        <Unavailable />
      </Section>
    );
  }

  return (
    <Section title="Users" subtitle="Create / disable / reset / delete">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
          {users === null ? '—' : `${users.length} user${users.length === 1 ? '' : 's'}`}
          {loading && ' · loading…'}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setCreateOpen(true)}
            disabled={loading}
            className="apple-press px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 disabled:opacity-60"
          >
            <Plus className="w-3 h-3" />
            New user
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="apple-press px-4 py-1.5 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 mt-0.5 shrink-0" />
          <div className="space-y-1 flex-1 min-w-0">
            <p className="text-[11px] text-rose-700 dark:text-rose-200 font-medium">{error}</p>
            {error.toLowerCase().includes('not linked') && (
              <p className="text-[10px] text-rose-600 dark:text-rose-200/80 leading-relaxed">
                Generate a service-account JSON in{' '}
                <a
                  href={serviceAccountsConsoleUrl()}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-baseline gap-1 text-rose-700 dark:text-rose-200 underline hover:no-underline font-medium"
                >
                  Firebase Console → Project Settings → Service Accounts
                  <ExternalLink className="w-3 h-3 self-center" />
                </a>
                , then link it from <strong>Super Admin → Connection</strong>.
              </p>
            )}
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 dark:text-rose-300 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {users && users.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr className="text-left">
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Companies</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.uid === currentUid;
                const selfDisabledTitle = "You can't change this on your own account from here. Ask another super-admin.";
                return (
                <tr key={u.uid} className={cn(
                  "border-t border-slate-100 dark:border-slate-800 align-top",
                  isSelf && "bg-blue-50/30 dark:bg-blue-500/5",
                )}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-slate-800 dark:text-slate-100 truncate max-w-[220px]" title={u.email ?? ''}>
                        {u.email ?? '(no email)'}
                      </div>
                      {isSelf && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-200 text-[8px] font-bold uppercase tracking-wider shrink-0">
                          You
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[260px]">{u.uid}</div>
                  </Td>
                  <Td>
                    <RoleBadge role={u.role} />
                  </Td>
                  <Td>
                    <CompaniesCell companyIds={u.companies} companies={companies} role={u.role} />
                  </Td>
                  <Td>
                    {u.disabled
                      ? <span className="px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-200 text-[9px] font-bold uppercase tracking-wider">Disabled</span>
                      : <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 text-[9px] font-bold uppercase tracking-wider">Active</span>}
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1.5 flex-wrap">
                      <IconBtn
                        label={isSelf ? `Edit your display name (role + permissions are locked on your own account)` : 'Edit role'}
                        onClick={() => setEditing(u)}
                      ><Pencil className="w-3 h-3" /></IconBtn>
                      <IconBtn
                        label={isSelf ? selfDisabledTitle : (u.disabled ? 'Enable' : 'Disable')}
                        onClick={() => handleDisable(u)}
                        disabled={isSelf}
                      ><Power className="w-3 h-3" /></IconBtn>
                      <IconBtn label="Reset password" onClick={() => handleResetPassword(u)}><KeyRound className="w-3 h-3" /></IconBtn>
                      <IconBtn
                        label={isSelf ? selfDisabledTitle : 'Delete'}
                        tone="danger"
                        onClick={() => handleDelete(u)}
                        disabled={isSelf}
                      ><Trash2 className="w-3 h-3" /></IconBtn>
                    </div>
                  </Td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {users && users.length === 0 && (
        <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
          <UsersIcon className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            No users yet. Click <strong>New user</strong> to create the first account.
          </p>
        </div>
      )}

      {createOpen && (
        <UserFormModal
          mode="create"
          companies={companies}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (form) => {
            const res = await adminApi.createUser({
              email: form.email,
              password: form.password!,
              role: form.role,
              companies: form.companies,
              displayName: form.displayName || undefined,
              tabPerms: form.tabPerms,
            });
            await refresh();
            setTempPasswordFor({ uid: res.uid, email: res.email, password: form.password! });
            setCreateOpen(false);
          }}
        />
      )}

      {editing && (
        <UserFormModal
          mode="edit"
          companies={companies}
          initial={editing}
          isSelf={editing.uid === currentUid}
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            await adminApi.setUserRole({
              uid: editing.uid,
              role: form.role,
              companies: form.companies,
              tabPerms: form.tabPerms,
            });
            await refresh();
            setEditing(null);
          }}
        />
      )}

      {tempPasswordFor && (
        <TempPasswordModal
          email={tempPasswordFor.email}
          password={tempPasswordFor.password}
          onClose={() => setTempPasswordFor(null)}
        />
      )}

      {confirmSlot}
    </Section>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

interface SectionProps { title: string; subtitle: string; children: React.ReactNode }
function Section({ title, subtitle, children }: SectionProps) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-widest font-mono">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function Unavailable() {
  return (
    <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
      <AlertCircle className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
        Admin operations are unavailable in this build. Use the Electron desktop installer.
      </p>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={cn(
      "px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400",
      align === 'right' && 'text-right',
    )}>
      {children}
    </th>
  );
}
function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return <td className={cn("px-3 py-2.5", align === 'right' && 'text-right')}>{children}</td>;
}

function IconBtn({ children, label, onClick, tone, disabled }: { children: React.ReactNode; label: string; onClick: () => void; tone?: 'danger'; disabled?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "apple-press p-1.5 rounded-md border transition-colors",
        tone === 'danger'
          ? "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-100 dark:border-rose-500/30 hover:bg-rose-100 dark:hover:bg-rose-500/20"
          : "bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800",
        disabled && "opacity-40 cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800/60",
      )}
    >
      {children}
    </button>
  );
}

function RoleBadge({ role }: { role: Role | null }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    super_admin: { bg: 'bg-purple-50 dark:bg-purple-500/15', fg: 'text-purple-700 dark:text-purple-200', label: 'Super admin' },
    admin: { bg: 'bg-blue-50 dark:bg-blue-500/15', fg: 'text-blue-700 dark:text-blue-200', label: 'Admin' },
    supervisor: { bg: 'bg-emerald-50 dark:bg-emerald-500/15', fg: 'text-emerald-700 dark:text-emerald-200', label: 'Supervisor' },
  };
  if (!role) {
    return <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[9px] font-bold uppercase tracking-wider">No role</span>;
  }
  const cfg = map[role];
  return <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider", cfg.bg, cfg.fg)}>{cfg.label}</span>;
}

function CompaniesCell({ companyIds, companies, role }: { companyIds: string[]; companies: Company[]; role: Role | null }) {
  if (role === 'super_admin' || role === 'admin') {
    return <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">All companies</span>;
  }
  if (!companyIds || companyIds.length === 0) {
    return <span className="text-[10px] text-rose-600 dark:text-rose-300 font-medium">No companies assigned</span>;
  }
  const byId = new Map(companies.map(c => [c.id, c.name]));
  const labels = companyIds.map(id => byId.get(id) ?? id);
  if (labels.length <= 3) {
    return <span className="text-[10px] text-slate-600 dark:text-slate-300">{labels.join(', ')}</span>;
  }
  return (
    <span className="text-[10px] text-slate-600 dark:text-slate-300" title={labels.join(', ')}>
      {labels.slice(0, 2).join(', ')} +{labels.length - 2} more
    </span>
  );
}

// ── User form modal (create + edit) ──────────────────────────────────────

interface UserFormValues {
  email: string;
  password?: string;
  displayName: string;
  role: Role;
  companies: string[];
  // null means "use role default for every tab" (no override stored on
  // the user doc). An object means "explicit override per tab" — missing
  // keys still fall back to the role default in the UI's tabAccess(),
  // but the editor below always emits a complete map for clarity.
  tabPerms: TabPerms | null;
}

interface UserFormProps {
  mode: 'create' | 'edit';
  companies: Company[];
  initial?: AdminUser;
  /** True when the row being edited is the currently-signed-in user. Locks
   * role + companies + tabPerms so a super-admin can't accidentally demote
   * themselves out of access. */
  isSelf?: boolean;
  onClose: () => void;
  onSubmit: (form: UserFormValues) => Promise<void>;
}

function UserFormModal({ mode, companies, initial, isSelf, onClose, onSubmit }: UserFormProps) {
  const [form, setForm] = useState<UserFormValues>(() => ({
    email: initial?.email ?? '',
    password: mode === 'create' ? generateSuggestedPassword() : undefined,
    displayName: initial?.displayName ?? '',
    role: (initial?.role ?? 'supervisor') as Role,
    companies: initial?.companies ?? [],
    tabPerms: initial?.tabPerms ?? null,
  }));
  const [showCustomPerms, setShowCustomPerms] = useState(!!initial?.tabPerms);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Self-edit is intentionally read-only — submit just closes the modal.
    // Defense-in-depth against DOM-tampered re-enabling of the role select:
    // even if the user manages to set form.role to something else, we never
    // dispatch the call. To actually demote yourself, ask another super-
    // admin or use the Firebase Console.
    if (isSelf) {
      onClose();
      return;
    }
    if (mode === 'create' && (!form.email || !form.password)) {
      setError('Email and password are required.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(form);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? 'Failed to save user');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} title={mode === 'create' ? 'New user' : `Edit user: ${initial?.email ?? initial?.uid}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {isSelf && (
          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg">
            <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-300 mt-0.5 shrink-0" />
            <p className="text-[11px] text-blue-800 dark:text-blue-200 leading-relaxed">
              You're editing your own account. Role and per-tab permissions are locked to prevent accidentally locking yourself out of the system. To demote yourself, ask another super-admin or use the Firebase Console.
            </p>
          </div>
        )}
        {mode === 'create' && (
          <>
            <Field label="Email" required>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                required
              />
            </Field>
            <Field label="Temporary password" required helper="Share securely with the user; they should change it on first login.">
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                required
              />
            </Field>
            <Field label="Display name (optional)">
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </Field>
          </>
        )}

        <Field label="Role" required>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role, companies: e.target.value === 'supervisor' ? form.companies : [] })}
            disabled={isSelf}
            className={cn(
              "w-full px-3 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40",
              isSelf && "opacity-60 cursor-not-allowed",
            )}
          >
            <option value="supervisor">Supervisor — operational tabs only, scoped companies</option>
            <option value="admin">Admin — all companies, all tabs (Variables read-only)</option>
            <option value="super_admin">Super admin — full access, can manage other users</option>
          </select>
        </Field>

        {form.role === 'supervisor' && (
          <Field label="Allowed companies" helper="The supervisor will see only these companies in the switcher.">
            <CompanyMultiSelect
              companies={companies}
              selected={form.companies}
              onChange={(ids) => setForm({ ...form, companies: ids })}
            />
          </Field>
        )}

        {form.role !== 'super_admin' && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Per-tab permissions
              </label>
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCustomPerms}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setShowCustomPerms(next);
                    if (!next) {
                      // Switching back to role-default clears the override.
                      setForm((f) => ({ ...f, tabPerms: null }));
                    } else if (!form.tabPerms) {
                      // Initialize override with current role defaults so the
                      // grid shows a sensible starting point the super-admin
                      // can tweak from.
                      const init: TabPerms = {};
                      for (const t of GRANTABLE_TABS) init[t.key] = t.default;
                      setForm((f) => ({ ...f, tabPerms: init }));
                    }
                  }}
                />
                Customize
              </label>
            </div>
            {showCustomPerms && form.tabPerms ? (
              <TabPermsGrid
                value={form.tabPerms}
                onChange={(next) => setForm({ ...form, tabPerms: next })}
              />
            ) : (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                Using the role default. Tabs not allowed for the role won't appear in this user's sidebar; some tabs may render read-only. Toggle <strong>Customize</strong> to override per tab.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg">
            <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 mt-0.5 shrink-0" />
            <p className="text-[11px] text-rose-700 dark:text-rose-200 font-medium">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="apple-press px-4 py-2 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="apple-press px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono disabled:opacity-60"
          >
            {submitting ? 'Saving…' : mode === 'create' ? 'Create user' : isSelf ? 'Close' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CompanyMultiSelect({ companies, selected, onChange }: {
  companies: Company[]; selected: string[]; onChange: (ids: string[]) => void;
}) {
  const set = useMemo(() => new Set(selected), [selected]);
  const toggle = (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };
  return (
    <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-2 space-y-1 bg-white dark:bg-slate-800/60">
      {companies.length === 0 && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic px-2 py-1">
          No companies yet — create some first.
        </p>
      )}
      {companies.map(c => (
        <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
          <input
            type="checkbox"
            checked={set.has(c.id)}
            onChange={() => toggle(c.id)}
            className="rounded"
          />
          <span className="text-[11px] text-slate-700 dark:text-slate-200">{c.name}</span>
          <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono ml-auto">{c.id}</span>
        </label>
      ))}
    </div>
  );
}

function TempPasswordModal({ email, password, onClose }: { email: string | null; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore — user can select+copy manually */ }
  };
  return (
    <Modal onClose={onClose} title="Temporary password">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
            Copy this now — it won't be shown again. Share securely (Signal, in-person). The user should change it on first login.
          </p>
        </div>
        <Field label="User">
          <p className="text-xs font-mono text-slate-800 dark:text-slate-100 px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
            {email ?? '(no email)'}
          </p>
        </Field>
        <Field label="Temporary password">
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={password}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                "apple-press px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 transition-colors",
                copied
                  ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border border-emerald-100 dark:border-emerald-500/30"
                  : "bg-blue-600 hover:bg-blue-700 text-white",
              )}
            >
              {copied ? <><Check className="w-3 h-3" />Copied</> : <><Copy className="w-3 h-3" />Copy</>}
            </button>
          </div>
        </Field>
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="apple-press px-5 py-2 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, required, helper, children }: { label: string; required?: boolean; helper?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {label}{required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
      {helper && <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">{helper}</p>}
    </div>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  // Plain modal — no AnimatePresence to avoid the StrictMode pitfall noted
  // in feedback_react_animatepresence.md.
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function TabPermsGrid({ value, onChange }: { value: TabPerms; onChange: (next: TabPerms) => void }) {
  const setOne = (key: string, v: TabAccess) => {
    onChange({ ...value, [key]: v });
  };
  const bulk = (v: TabAccess) => {
    const next: TabPerms = {};
    for (const t of GRANTABLE_TABS) next[t.key] = v;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <BulkBtn onClick={() => bulk('full')} label="All full" />
        <BulkBtn onClick={() => bulk('read')} label="All read-only" />
        <BulkBtn onClick={() => bulk('none')} label="All hidden" />
      </div>
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800/40">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60 text-left">
              <th className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Tab</th>
              <th className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 w-[180px]">Access</th>
            </tr>
          </thead>
          <tbody>
            {GRANTABLE_TABS.map((t) => {
              const v = value[t.key] ?? t.default;
              return (
                <tr key={t.key} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{t.label}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-0 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
                      <PermBtn current={v} value="none" onClick={() => setOne(t.key, 'none')} label="Hidden" />
                      <PermBtn current={v} value="read" onClick={() => setOne(t.key, 'read')} label="Read" />
                      <PermBtn current={v} value="full" onClick={() => setOne(t.key, 'full')} label="Full" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
        <strong>Hidden</strong> = tab does not appear in the sidebar.
        <strong className="ml-2">Read</strong> = tab visible, all add/edit/delete actions are disabled.
        <strong className="ml-2">Full</strong> = read + write + delete.
      </p>
    </div>
  );
}

function PermBtn({ current, value, onClick, label }: { current: TabAccess; value: TabAccess; onClick: () => void; label: string }) {
  const tone = value === 'none'
    ? { active: 'bg-slate-700 text-white', inactive: 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800' }
    : value === 'read'
    ? { active: 'bg-amber-500 text-white', inactive: 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10' }
    : { active: 'bg-emerald-600 text-white', inactive: 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10' };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest font-mono transition-colors border-l border-slate-200 dark:border-slate-700 first:border-l-0",
        current === value ? tone.active : tone.inactive,
      )}
    >
      {label}
    </button>
  );
}

function BulkBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="apple-press px-2.5 py-1 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      {label}
    </button>
  );
}

function generateSuggestedPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  let out = '';
  // 12 chars — short enough to type, enough entropy at this alphabet (~70 bits).
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
