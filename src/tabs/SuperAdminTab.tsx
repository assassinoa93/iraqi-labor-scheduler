/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3.3 — Super Admin tab.
 *
 * The all-in-one (AIO) management surface that lets the super-admin avoid
 * the Firebase Console entirely after first-time setup. Four panels:
 *
 *   1. Connection — service-account JSON status + link/relink.
 *   2. Users      — list, create, set role + companies, disable / enable,
 *                   reset password, delete.
 *   3. Companies  — quick add / rename / delete (delegates to the existing
 *                   Firestore companies API; super_admin has full rules
 *                   access so no Admin SDK needed for these).
 *   4. Database   — audit-log retention controls (purge >90/180/365 days
 *                   or a custom date), powered by the Admin SDK so it can
 *                   bypass the immutability rule on /audit.
 *
 * Visible only to `role === 'super_admin'` — gated by tabAllowed() and an
 * extra defensive check at the top of this component.
 */

import React from 'react';
import { useAuth } from '../lib/auth';
import { ConnectionPanel } from '../components/SuperAdmin/ConnectionPanel';
import { CompaniesPanel } from '../components/SuperAdmin/CompaniesPanel';
import { DatabasePanel } from '../components/SuperAdmin/DatabasePanel';
import { QuotaPanel } from '../components/SuperAdmin/QuotaPanel';
import type { Company } from '../types';

interface Props {
  companies: Company[];
  // Signatures match App.tsx's existing addCompany/renameCompany/deleteCompany.
  // `deleteCompany` shows its own ConfirmModal via App's setConfirmState — the
  // CompaniesPanel doesn't double-confirm.
  onAddCompany: (name: string) => Promise<void> | void;
  onRenameCompany: (id: string, name: string) => Promise<void> | void;
  onDeleteCompany: (id: string) => void;
}

export function SuperAdminTab({ companies, onAddCompany, onRenameCompany, onDeleteCompany }: Props) {
  const { role } = useAuth();
  if (role !== 'super_admin') {
    return (
      <div className="p-8">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          You don't have permission to view this tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10 max-w-6xl">
      <div>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-100 uppercase tracking-tight mb-1">
          Super Admin
        </h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium uppercase tracking-widest font-mono">
          Manage users, companies, and database — all from inside the app
        </p>
      </div>

      <ConnectionPanel />
      <QuotaPanel />
      <CompaniesPanel
        companies={companies}
        onAdd={onAddCompany}
        onRename={onRenameCompany}
        onDelete={onDeleteCompany}
      />
      <DatabasePanel />
    </div>
  );
}
