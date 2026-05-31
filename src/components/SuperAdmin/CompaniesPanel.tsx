/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3.3 — Super Admin → Companies panel.
 *
 * Lightweight wrapper around the existing CompanySwitcher's add/rename/delete
 * mutators. These don't need the Admin SDK — super_admin has full Firestore
 * rules access — but the panel surfaces them in one place alongside the
 * other AIO management ops so the super-admin doesn't have to bounce
 * between sidebar and tab.
 */

import React, { useState } from 'react';
import { Building2, Plus, Pencil, Trash2, AlertCircle, X } from 'lucide-react';
import type { Company } from '../../types';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';

interface Props {
  companies: Company[];
  // App.tsx's deleteCompany already drives the in-app ConfirmModal — this
  // panel just calls it and lets the parent handle confirmation + cascade.
  onAdd: (name: string) => Promise<void> | void;
  onRename: (id: string, name: string) => Promise<void> | void;
  onDelete: (id: string) => void;
}

export function CompaniesPanel({ companies, onAdd, onRename, onDelete }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Company | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(newName.trim());
      setNewName('');
      setCreating(false);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? t('superAdmin.companies.error.create'));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (id: string, name: string) => {
    setBusy(true);
    setError(null);
    try {
      await onRename(id, name);
      setEditing(null);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? t('superAdmin.companies.error.rename'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (c: Company) => {
    // App.tsx's deleteCompany() already opens the in-app ConfirmModal; we
    // delegate and let it own the confirmation flow + cascade cleanup.
    setError(null);
    try {
      onDelete(c.id);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? t('superAdmin.companies.error.delete'));
    }
  };

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{t('superAdmin.companies.title')}</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-widest font-mono">
          {t('superAdmin.companies.subtitle', { count: companies.length })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            disabled={busy}
            className="apple-press px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 disabled:opacity-60"
          >
            <Plus className="w-3 h-3" />
            {t('superAdmin.companies.new')}
          </button>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}
            className="flex gap-2 items-center"
          >
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('superAdmin.companies.namePlaceholder')}
              className="px-3 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="apple-press px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono disabled:opacity-60"
            >
              {busy ? t('superAdmin.companies.adding') : t('superAdmin.companies.add')}
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(''); }}
              className="apple-press px-3 py-2 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono"
            >
              {t('superAdmin.companies.cancel')}
            </button>
          </form>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 mt-0.5 shrink-0" />
          <p className="text-[11px] text-rose-700 dark:text-rose-200 font-medium flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-rose-500 dark:text-rose-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {companies.length === 0 ? (
        <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
          <Building2 className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            {t('superAdmin.companies.empty')}
          </p>
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
          {companies.map((c) => (
            <CompanyRow
              key={c.id}
              company={c}
              isEditing={editing?.id === c.id}
              busy={busy}
              t={t}
              onEdit={() => setEditing(c)}
              onCancelEdit={() => setEditing(null)}
              onRename={(name) => handleRename(c.id, name)}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CompanyRow({ company, isEditing, busy, t, onEdit, onCancelEdit, onRename, onDelete }: {
  company: Company; isEditing: boolean; busy: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onEdit: () => void; onCancelEdit: () => void; onRename: (name: string) => void; onDelete: () => void;
}) {
  const [name, setName] = useState(company.name);
  React.useEffect(() => { setName(company.name); }, [company.name, isEditing]);

  if (isEditing) {
    return (
      <form
        onSubmit={(e) => { e.preventDefault(); onRename(name.trim()); }}
        className="flex items-center gap-2 px-4 py-2.5"
      >
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        <button
          type="submit"
          disabled={busy || !name.trim() || name === company.name}
          className="apple-press px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono disabled:opacity-60"
        >
          {t('superAdmin.companies.save')}
        </button>
        <button
          type="button"
          onClick={onCancelEdit}
          className="apple-press px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono"
        >
          {t('superAdmin.companies.cancel')}
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">{company.name}</p>
        <p className="text-[9px] text-slate-400 dark:text-slate-500 font-mono truncate">{company.id}</p>
      </div>
      <button
        onClick={onEdit}
        className={cn(
          "apple-press p-1.5 rounded-md bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800",
          busy && "opacity-60 cursor-wait",
        )}
        title={t('superAdmin.companies.rename.tooltip')}
      >
        <Pencil className="w-3 h-3" />
      </button>
      <button
        onClick={onDelete}
        className={cn(
          "apple-press p-1.5 rounded-md bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-300 border border-rose-100 dark:border-rose-500/30 hover:bg-rose-100 dark:hover:bg-rose-500/20",
          busy && "opacity-60 cursor-wait",
        )}
        title={t('superAdmin.companies.delete.tooltip')}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}
