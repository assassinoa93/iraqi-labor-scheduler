/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3.3 — Super Admin → Database panel.
 *
 * Audit-log retention controls. The /audit collection's rule forbids
 * client-side update/delete (entries are immutable to ordinary users).
 * Purges go through the Admin SDK bridge, which bypasses rules.
 *
 * Schedule-archive and disabled-user cleanup are deferred — the audit
 * log is by far the fastest-growing collection at this app's scale, so
 * shipping audit retention covers the realistic cleanup need.
 */

import React, { useEffect, useState } from 'react';
import { Database, AlertCircle, RefreshCw, Trash2 } from 'lucide-react';
import * as adminApi from '../../lib/adminApi';
import type { AuditStats } from '../../lib/adminApi';
import { cn } from '../../lib/utils';
import { useConfirm } from '../ConfirmModal';

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '90 days', days: 90 },
  { label: '180 days', days: 180 },
  { label: '1 year', days: 365 },
];

export function DatabasePanel() {
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [purging, setPurging] = useState<number | null>(null); // days threshold
  const { confirm, slot: confirmSlot } = useConfirm();

  const refresh = async () => {
    if (!adminApi.isAvailable()) return;
    setLoading(true);
    setError(null);
    try {
      const s = await adminApi.auditStats();
      setStats(s);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      setError(err.message ?? 'Failed to load audit stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const handlePurge = async (days: number) => {
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
    const ok = await confirm({
      title: `Purge audit older than ${days} days?`,
      message: `Permanently deletes every audit entry older than ${cutoffDate}. This cannot be undone.`,
    });
    if (!ok) return;
    setPurging(days);
    setError(null);
    setInfo(null);
    try {
      const res = await adminApi.purgeAuditOlderThan(cutoffMs);
      setInfo(`Deleted ${res.deleted} audit entr${res.deleted === 1 ? 'y' : 'ies'}.`);
      await refresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? 'Purge failed');
    } finally {
      setPurging(null);
    }
  };

  if (!adminApi.isAvailable()) {
    return (
      <Section>
        <Unavailable />
      </Section>
    );
  }

  const oldestText = stats?.oldestTs
    ? new Date(stats.oldestTs).toISOString().slice(0, 10)
    : null;

  return (
    <Section>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            {stats === null ? 'Loading…' : (
              <>
                <span className="text-slate-800 dark:text-slate-100 font-bold">{stats.total.toLocaleString()}</span>{' '}
                audit entr{stats.total === 1 ? 'y' : 'ies'}
                {oldestText && <> · oldest from <span className="font-mono">{oldestText}</span></>}
              </>
            )}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading || purging !== null}
          className="apple-press px-4 py-1.5 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 flex items-center gap-1.5"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Purge audit older than
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => handlePurge(p.days)}
              disabled={purging !== null}
              className={cn(
                "apple-press px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 transition-colors",
                "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-200 border border-rose-100 dark:border-rose-500/30 hover:bg-rose-100 dark:hover:bg-rose-500/20",
                purging !== null && "opacity-60 cursor-wait",
              )}
            >
              <Trash2 className="w-3 h-3" />
              {purging === p.days ? 'Purging…' : p.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
          Audit entries are immutable for everyone except the super-admin (via this panel). Purged entries are gone permanently — back up the audit log first if you need a record (Audit Log tab → export).
        </p>
      </div>

      {info && (
        <div className="flex items-start gap-2 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-lg">
          <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-300 mt-0.5 shrink-0" />
          <p className="text-[11px] text-emerald-700 dark:text-emerald-200 font-medium">{info}</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 mt-0.5 shrink-0" />
          <p className="text-[11px] text-rose-700 dark:text-rose-200 font-medium">{error}</p>
        </div>
      )}

      {confirmSlot}
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Database</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-widest font-mono">
          Audit log retention
        </p>
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
        Database operations are unavailable in this build. Use the Electron desktop installer.
      </p>
    </div>
  );
}
