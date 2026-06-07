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
import { AlertCircle, RefreshCw, Activity, AlertTriangle, ExternalLink, Copy, Check, ShieldAlert } from 'lucide-react';
import * as adminApi from '../../lib/adminApi';
import type { QuotaUsage, QuotaMetric, QuotaErrorCause } from '../../lib/adminApi';
import { getActiveConfig } from '../../lib/firebase';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../lib/utils';

// GCP Console deep links — keyed off the active project so each link lands
// the user in the right project's settings, not a generic Console root.
function gcpEnableMonitoringApiUrl(projectId: string | undefined): string {
  return projectId
    ? `https://console.cloud.google.com/apis/library/monitoring.googleapis.com?project=${projectId}`
    : 'https://console.cloud.google.com/apis/library/monitoring.googleapis.com';
}
function gcpIamUrl(projectId: string | undefined): string {
  return projectId
    ? `https://console.cloud.google.com/iam-admin/iam?project=${projectId}`
    : 'https://console.cloud.google.com/iam-admin/iam';
}
// v5.0.2 — Blaze upgrade deep-link. Cloud Monitoring requires the project
// to have billing enabled (Blaze plan); on Spark it 403s with BILLING_DISABLED.
function gcpBillingEnableUrl(projectId: string | undefined): string {
  return projectId
    ? `https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`
    : 'https://console.cloud.google.com/billing';
}
function firebaseUpgradeUrl(projectId: string | undefined): string {
  return projectId
    ? `https://console.firebase.google.com/project/${projectId}/usage/details`
    : 'https://console.firebase.google.com/';
}

const POLL_MS = 60_000;

interface MetricRow {
  key: 'reads' | 'writes' | 'deletes';
  labelKey: string;
  helperKey: string;
}

const ROWS: MetricRow[] = [
  { key: 'reads',   labelKey: 'superAdmin.quota.metric.reads.label',   helperKey: 'superAdmin.quota.metric.reads.helper' },
  { key: 'writes',  labelKey: 'superAdmin.quota.metric.writes.label',  helperKey: 'superAdmin.quota.metric.writes.helper' },
  { key: 'deletes', labelKey: 'superAdmin.quota.metric.deletes.label', helperKey: 'superAdmin.quota.metric.deletes.helper' },
];

export function QuotaPanel() {
  const { t } = useI18n();
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
      setError(err.message ?? t('superAdmin.quota.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => window.clearInterval(id);
    // Mount-only quota poller. `refresh` closes over admin API state but
    // re-runs would tear down and re-create the interval on every render
    // (the function identity isn't memoised), which would reset the
    // polling cadence and double-fetch on parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!adminApi.isAvailable()) {
    return (
      <Section>
        <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
          <AlertCircle className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            {t('superAdmin.quota.unavailable')}
          </p>
        </div>
      </Section>
    );
  }

  const fetchedAtLabel = usage?.fetchedAt
    ? new Date(usage.fetchedAt).toLocaleTimeString()
    : '—';

  // If every metric came back with the same setup-required error, show a
  // single actionable setup card instead of three identical "unavailable"
  // bars. Most users hit this on first install — the default Firebase
  // service account doesn't include monitoring.viewer, and Cloud Monitoring
  // API may not be enabled on the project either.
  const dominantCause: QuotaErrorCause | null = (() => {
    if (!usage) return null;
    const causes = ROWS.map((r) => usage[r.key]?.error?.cause).filter(Boolean) as QuotaErrorCause[];
    if (causes.length !== ROWS.length) return null;
    const allSame = causes.every((c) => c === causes[0]);
    return allSame ? causes[0] : null;
  })();

  const setupRequired =
    dominantCause === 'API_NOT_ENABLED' ||
    dominantCause === 'PERMISSION_DENIED' ||
    dominantCause === 'BILLING_REQUIRED';

  return (
    <Section>
      {lastLocalExhaust && (
        <LocalExhaustBanner stamp={lastLocalExhaust} />
      )}

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            <Activity className="w-3 h-3 inline-block me-1 -mt-0.5" />
            {t('superAdmin.quota.rollingUsage')}
            {usage && <> · <span className="font-mono">{t('superAdmin.quota.lastFetched', { time: fetchedAtLabel })}</span></>}
            {usage?.cached && <span className="text-slate-500 dark:text-slate-400"> {t('superAdmin.quota.cached')}</span>}
          </p>
        </div>
        <button
          onClick={() => void refresh(true)}
          disabled={loading}
          className="apple-press px-4 py-1.5 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 flex items-center gap-1.5"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          {t('superAdmin.quota.refreshNow')}
        </button>
      </div>

      {setupRequired && usage && (
        <SetupRequiredCard
          cause={dominantCause!}
          serviceAccountEmail={usage.serviceAccountEmail}
          onRecheck={() => void refresh(true)}
        />
      )}

      {!setupRequired && (
        <>
          <div className="space-y-3">
            {ROWS.map((row) => (
              <MetricBar key={row.key} row={row} metric={usage?.[row.key]} />
            ))}
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('superAdmin.quota.lagNote')}
          </p>
        </>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 mt-0.5 shrink-0" />
          <p className="text-[11px] text-rose-700 dark:text-rose-200 font-medium">{error}</p>
        </div>
      )}
    </Section>
  );
}

function SetupRequiredCard({ cause, serviceAccountEmail, onRecheck }: {
  cause: QuotaErrorCause;
  serviceAccountEmail: string;
  onRecheck: () => void;
}) {
  const { t } = useI18n();
  const projectId = getActiveConfig()?.projectId;
  const [copied, setCopied] = useState(false);
  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(serviceAccountEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // v5.0.2 — three distinct setup paths now (was two). Each maps to one
  // GCP Console action; the renderer picks the right copy + steps from
  // the structured cause the bridge produced.
  const isApiDisabled = cause === 'API_NOT_ENABLED';
  const isBillingRequired = cause === 'BILLING_REQUIRED';

  const headlineCopy = isBillingRequired
    ? t('superAdmin.quota.setup.billing.headline')
    : t('superAdmin.quota.setup.default.headline');
  const bodyCopy = isBillingRequired
    ? t('superAdmin.quota.setup.billing.body')
    : isApiDisabled
      ? t('superAdmin.quota.setup.apiDisabled.body')
      : t('superAdmin.quota.setup.permission.body');

  return (
    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-200">{headlineCopy}</p>
          <p className="text-[11px] text-amber-700 dark:text-amber-200/80 leading-relaxed">{bodyCopy}</p>
        </div>
      </div>

      {isBillingRequired ? (
        <ol className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed list-decimal list-inside space-y-1.5 ms-1">
          <li>
            {t('superAdmin.quota.setup.openPrefix')}{' '}
            <a
              href={firebaseUpgradeUrl(projectId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-baseline gap-1 underline hover:no-underline font-medium"
            >
              {t('superAdmin.quota.setup.billing.step1.link')}
              <ExternalLink className="w-3 h-3 self-center" />
            </a>{' '}
            {t('superAdmin.quota.setup.billing.step1.body', { projectId: projectId ?? '…' })}
          </li>
          <li>
            <LinkSentence
              template={t('superAdmin.quota.setup.billing.step2.body')}
              href={gcpBillingEnableUrl(projectId)}
              linkText={t('superAdmin.quota.setup.billing.step2.link')}
            />
          </li>
          <li>{t('superAdmin.quota.setup.billing.step3')}</li>
          <li className="text-amber-700 dark:text-amber-200/80 italic list-none ms-0 pt-1">
            {t('superAdmin.quota.setup.billing.note')}
          </li>
        </ol>
      ) : isApiDisabled ? (
        <ol className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed list-decimal list-inside space-y-1.5 ms-1">
          <li>
            {t('superAdmin.quota.setup.openPrefix')}{' '}
            <a
              href={gcpEnableMonitoringApiUrl(projectId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-baseline gap-1 underline hover:no-underline font-medium"
            >
              {t('superAdmin.quota.setup.apiDisabled.step1.link')}
              <ExternalLink className="w-3 h-3 self-center" />
            </a>{' '}
            {t('superAdmin.quota.setup.apiDisabled.step1.body', { projectId: projectId ?? '…' })}
          </li>
          <li>{t('superAdmin.quota.setup.apiDisabled.step2')}</li>
          <li>{t('superAdmin.quota.setup.recheckStep')}</li>
        </ol>
      ) : (
        <ol className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed list-decimal list-inside space-y-1.5 ms-1">
          <li>
            {t('superAdmin.quota.setup.openPrefix')}{' '}
            <a
              href={gcpIamUrl(projectId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-baseline gap-1 underline hover:no-underline font-medium"
            >
              {t('superAdmin.quota.setup.permission.step1.link')}
              <ExternalLink className="w-3 h-3 self-center" />
            </a>{' '}
            {t('superAdmin.quota.setup.permission.step1.body', { projectId: projectId ?? '…' })}
          </li>
          <li>
            {t('superAdmin.quota.setup.permission.step2')}
            <div className="flex gap-2 mt-1.5 mb-0.5">
              <code className="flex-1 px-2 py-1.5 text-[10px] font-mono text-amber-900 dark:text-amber-100 bg-amber-100/60 dark:bg-amber-500/20 border border-amber-200 dark:border-amber-500/30 rounded break-all">
                {serviceAccountEmail || t('superAdmin.quota.setup.permission.unknownEmail')}
              </code>
              <button
                onClick={handleCopyEmail}
                disabled={!serviceAccountEmail}
                className={cn(
                  "apple-press px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 transition-colors shrink-0 disabled:opacity-60",
                  copied
                    ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-500/30"
                    : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800",
                )}
              >
                {copied ? <><Check className="w-3 h-3" />{t('superAdmin.quota.setup.copied')}</> : <><Copy className="w-3 h-3" />{t('superAdmin.quota.setup.copy')}</>}
              </button>
            </div>
          </li>
          <li>{t('superAdmin.quota.setup.permission.step3')}</li>
          <li>{t('superAdmin.quota.setup.recheckStep')}</li>
        </ol>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        <p className="text-[10px] text-amber-700 dark:text-amber-200/70 leading-relaxed">
          {t('superAdmin.quota.setup.footerNote')}
        </p>
        <button
          onClick={onRecheck}
          className="apple-press px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5"
        >
          <RefreshCw className="w-3 h-3" />
          {t('superAdmin.quota.setup.recheck')}
        </button>
      </div>
    </div>
  );
}

function MetricBar({ row, metric }: { row: MetricRow; metric: QuotaMetric | undefined }) {
  const { t } = useI18n();
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
        <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">{t(row.labelKey)}</p>
        <p className="text-[10px] font-mono">
          {apiError ? (
            <span className="text-rose-600 dark:text-rose-300">{t('superAdmin.quota.metric.unavailable')}</span>
          ) : used === null || used === undefined ? (
            <span className="text-slate-500 dark:text-slate-400">—</span>
          ) : (
            <span className={cn("font-bold", labelCls)}>
              {t('superAdmin.quota.metric.usage', {
                used: used.toLocaleString(),
                limit: limit.toLocaleString(),
                pct,
              })}
            </span>
          )}
        </p>
      </div>
      <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all duration-500 rounded-full", fillCls)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{t(row.helperKey)}</p>
      {apiError && (
        <p className="text-[10px] text-rose-600 dark:text-rose-300 font-mono leading-relaxed">
          {apiError.code}: {apiError.message}
        </p>
      )}
    </div>
  );
}

function LocalExhaustBanner({ stamp }: { stamp: { at: number; resetAt: string } }) {
  const { t } = useI18n();
  const ageMin = Math.round((Date.now() - stamp.at) / 60_000);
  const ageLabel = ageMin < 1
    ? t('superAdmin.quota.localExhaust.age.now')
    : ageMin < 60
      ? t('superAdmin.quota.localExhaust.age.minutes', { count: ageMin })
      : t('superAdmin.quota.localExhaust.age.hours', { count: Math.round(ageMin / 60) });
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
          {t('superAdmin.quota.localExhaust.title', { age: ageLabel })}
        </p>
        <p className="text-[11px] text-rose-700 dark:text-rose-200/80 leading-relaxed">
          {t('superAdmin.quota.localExhaust.body', { resetTime: resetLabel })}
        </p>
      </div>
    </div>
  );
}

// Renders a translated sentence that contains a single `{link}` placeholder,
// substituting an inline anchor for the placeholder so the link text and any
// surrounding punctuation (e.g. a trailing period) stay localized and in the
// grammatically correct position for both LTR and RTL.
function LinkSentence({ template, href, linkText }: { template: string; href: string; linkText: string }) {
  const [before, after = ''] = template.split('{link}');
  return (
    <>
      {before}
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-baseline gap-1 underline hover:no-underline font-medium"
      >
        {linkText}
        <ExternalLink className="w-3 h-3 self-center" />
      </a>
      {after}
    </>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{t('superAdmin.quota.title')}</p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-widest font-mono">
          {t('superAdmin.quota.subtitle')}
        </p>
      </div>
      {children}
    </section>
  );
}
