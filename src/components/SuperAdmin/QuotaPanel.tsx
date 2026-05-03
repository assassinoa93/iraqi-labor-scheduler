/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v4.2 — Super Admin → Quota panel.
 *
 * Shows live Firestore usage from Cloud Monitoring so the super-admin can
 * see how close the project is to the Spark plan's daily limits BEFORE
 * users hit "quota exhausted" errors. Fetches via the Admin SDK bridge
 * (admin-bridge.cjs) using the linked service-account JSON's default
 * monitoring.viewer permission.
 *
 * Auto-refreshes every 60s while the panel is mounted; the bridge has its
 * own 30s in-process cache so multiple panel mounts don't multiply API
 * calls. A "Refresh now" button forces a fresh fetch.
 *
 * Also surfaces the most recent local quota-exhausted detection (stamped
 * by App.tsx into localStorage when a Firestore write returns
 * resource-exhausted) — gives the super-admin retroactive visibility
 * even if Cloud Monitoring's data is delayed.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, Activity, AlertTriangle } from 'lucide-react';
import * as adminApi from '../../lib/adminApi';
import type { QuotaUsage, QuotaMetric } from '../../lib/adminApi';
import { cn } from '../../lib/utils';

const POLL_MS = 60_000;

interface MetricRow {
  key: 'reads' | 'writes' | 'deletes';
  label: string;
  helper: string;
}

const ROWS: MetricRow[] = [
  { key: 'reads',   label: 'Document reads',   helper: 'Snapshot listeners + one-shot gets across all clients in the last 24h.' },
  { key: 'writes',  label: 'Document writes',  helper: 'setDoc / updateDoc / batched commits across all clients in the last 24h.' },
  { key: 'deletes', label: 'Document deletes', helper: 'Includes audit-log purges and any client-side delete calls.' },
];

export function QuotaPanel() {
  const [usage, setUsage] = useState<QuotaUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror localStorage's last-exhausted timestamp (set by App.tsx whenever
  // a Firestore write returns resource-exhausted). Surfacing this gives the
  // super-admin an early signal even before Cloud Monitoring's metrics tick.
  const [lastLocalExhaust, setLastLocalExhaust] = useState<{ at: number; resetAt: string } | null>(() => {
    try {
      const at = window.localStorage.getItem('iraqi-scheduler-quota-last-exhausted');
      const resetAt = window.localStorage.getItem('iraqi-scheduler-quota-last-reset-at');
      if (at && resetAt) return { at: Number(at), resetAt };
    } catch { /* ignore */ }
    return null;
  });

  const refresh = async (force = false) => {
    if (!adminApi.isAvailable()) return;
    setLoading(true);
    setError(null);
    try {
      const u = await adminApi.quotaUsage(force);
      setUsage(u);
      // Re-read local exhaust marker — refreshing the panel is also a good
      // moment to pick up any flag that landed since mount.
      try {
        const at = window.localStorage.getItem('iraqi-scheduler-quota-last-exhausted');
        const resetAt = window.localStorage.getItem('iraqi-scheduler-quota-last-reset-at');
        setLastLocalExhaust(at && resetAt ? { at: Number(at), resetAt } : null);
      } catch { /* ignore */ }
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      setError(err.message ?? 'Failed to fetch quota usage');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!adminApi.isAvailable()) {
    return (
      <Section>
        <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
          <AlertCircle className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            Quota stats are unavailable in this build. Use the Electron desktop installer.
          </p>
        </div>
      </Section>
    );
  }

  const fetchedAtLabel = usage?.fetchedAt
    ? new Date(usage.fetchedAt).toLocaleTimeString()
    : '—';

  return (
    <Section>
      {lastLocalExhaust && (
        <LocalExhaustBanner stamp={lastLocalExhaust} />
      )}

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            <Activity className="w-3 h-3 inline-block me-1 -mt-0.5" />
            Rolling 24-hour usage · Spark plan free tier
            {usage && <> · last fetched <span className="font-mono">{fetchedAtLabel}</span></>}
            {usage?.cached && <span className="text-slate-400 dark:text-slate-500"> (cached)</span>}
          </p>
        </div>
        <button
          onClick={() => void refresh(true)}
          disabled={loading}
          className="apple-press px-4 py-1.5 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 flex items-center gap-1.5"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          Refresh now
        </button>
      </div>

      <div className="space-y-3">
        {ROWS.map((row) => (
          <MetricBar key={row.key} row={row} metric={usage?.[row.key]} />
        ))}
      </div>

      <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
        Cloud Monitoring data lags real time by ~3–5 minutes. If users start hitting "database usage limit reached" before this panel shows red, that's why — the local exhaust banner above is the immediate signal.
      </p>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 mt-0.5 shrink-0" />
          <div className="space-y-1 flex-1 min-w-0">
            <p className="text-[11px] text-rose-700 dark:text-rose-200 font-medium">{error}</p>
            <p className="text-[10px] text-rose-600 dark:text-rose-200/80">
              The Cloud Monitoring API may not be enabled on this Firebase project. The Admin SDK service account needs the <code className="font-mono">monitoring.viewer</code> role — typically granted by default when Firebase generates the service account.
            </p>
          </div>
        </div>
      )}
    </Section>
  );
}

function MetricBar({ row, metric }: { row: MetricRow; metric: QuotaMetric | undefined }) {
  const used = metric?.used;
  const limit = metric?.limit ?? 0;
  const ratio = used !== null && used !== undefined && limit > 0 ? Math.min(used / limit, 1.2) : 0;
  const pct = Math.round(ratio * 100);
  const tone =
    ratio >= 1 ? 'rose' :
    ratio >= 0.8 ? 'amber' :
    ratio >= 0.5 ? 'blue' :
    'emerald';
  const fillCls = useMemo(() => ({
    rose:    'bg-rose-500 dark:bg-rose-400',
    amber:   'bg-amber-500 dark:bg-amber-400',
    blue:    'bg-blue-500 dark:bg-blue-400',
    emerald: 'bg-emerald-500 dark:bg-emerald-400',
  })[tone], [tone]);
  const labelCls = useMemo(() => ({
    rose:    'text-rose-700 dark:text-rose-300',
    amber:   'text-amber-700 dark:text-amber-300',
    blue:    'text-blue-700 dark:text-blue-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
  })[tone], [tone]);

  const apiError = metric?.error;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">{row.label}</p>
        <p className="text-[10px] font-mono">
          {apiError ? (
            <span className="text-rose-600 dark:text-rose-300">unavailable</span>
          ) : used === null || used === undefined ? (
            <span className="text-slate-400 dark:text-slate-500">—</span>
          ) : (
            <>
              <span className={cn("font-bold", labelCls)}>{used.toLocaleString()}</span>
              <span className="text-slate-400 dark:text-slate-500"> / {limit.toLocaleString()} ({pct}%)</span>
            </>
          )}
        </p>
      </div>
      <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all duration-500 rounded-full", fillCls)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">{row.helper}</p>
      {apiError && (
        <p className="text-[10px] text-rose-600 dark:text-rose-300 font-mono leading-relaxed">
          {apiError.code}: {apiError.message}
        </p>
      )}
    </div>
  );
}

function LocalExhaustBanner({ stamp }: { stamp: { at: number; resetAt: string } }) {
  const ageMin = Math.round((Date.now() - stamp.at) / 60_000);
  const ageLabel = ageMin < 1 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;
  const reset = new Date(stamp.resetAt);
  const resetLabel = reset.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return (
    <div className="flex items-start gap-3 p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl">
      <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-300 mt-0.5 shrink-0" />
      <div className="space-y-1 flex-1 min-w-0">
        <p className="text-xs font-bold text-rose-800 dark:text-rose-200">
          A quota-exhausted error was reported {ageLabel}
        </p>
        <p className="text-[11px] text-rose-700 dark:text-rose-200/80 leading-relaxed">
          Users are receiving the "database usage limit reached" message. Quota resets at <strong>{resetLabel}</strong>. Consider upgrading the Firebase plan to Blaze (pay-as-you-go) if this becomes recurring — the daily Spark caps don't move.
        </p>
      </div>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Firebase quota</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-widest font-mono">
          Live Firestore usage · Spark plan free-tier limits
        </p>
      </div>
      {children}
    </section>
  );
}
