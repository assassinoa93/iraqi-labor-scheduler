/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3.3 — Super Admin → Connection panel.
 *
 * Status of the service-account JSON link plus a "Link / Relink" button
 * that opens a native file picker (the picker lives in the Electron main
 * process so the renderer never sees the file path until it's picked).
 *
 * If the bridge isn't loaded (e.g. browser-only build / non-Electron),
 * the panel renders an "unavailable" placeholder so the rest of the
 * Super Admin tab still works.
 */

import React, { useEffect, useState } from 'react';
import { Link2, AlertCircle, CheckCircle2, RefreshCw, FilePlus2, ExternalLink } from 'lucide-react';
import * as adminApi from '../../lib/adminApi';
import { getActiveConfig } from '../../lib/firebase';
import { cn } from '../../lib/utils';

// Deep-link to the Service Accounts tab of the active project's settings.
// If we don't know the projectId yet (shouldn't happen by the time this panel
// renders, but be defensive), fall back to the Console root.
function serviceAccountsConsoleUrl(): string {
  const projectId = getActiveConfig()?.projectId;
  return projectId
    ? `https://console.firebase.google.com/project/${projectId}/settings/serviceaccounts/adminsdk`
    : 'https://console.firebase.google.com/';
}

export function ConnectionPanel() {
  const [status, setStatus] = useState<{ linked: boolean; path: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = async () => {
    if (!adminApi.isAvailable()) {
      setStatus({ linked: false, path: null });
      return;
    }
    try {
      const s = await adminApi.isLinked();
      setStatus(s);
    } catch (e) {
      setStatus({ linked: false, path: null });
    }
  };

  useEffect(() => { void refresh(); }, []);

  const handleLink = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await adminApi.linkServiceAccount();
      setInfo(`Linked to project ${result.projectId}.`);
      await refresh();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'CANCELLED') {
        // User dismissed the file picker — not an error worth surfacing.
      } else {
        setError(err.message ?? 'Failed to link service account');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!adminApi.isAvailable()) {
    return (
      <Section title="Connection" subtitle="Firebase project + service-account link">
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-xl">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
              Admin features unavailable
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-200/80 leading-relaxed">
              The Admin SDK bridge isn't loaded in this build. Open the app via the Electron desktop installer to enable user management and database cleanup.
            </p>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Connection" subtitle="Firebase project + service-account link">
      {status?.linked ? (
        <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-xl">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300 mt-0.5 shrink-0" />
          <div className="space-y-1 flex-1 min-w-0">
            <p className="text-xs font-bold text-emerald-800 dark:text-emerald-200">
              Service account linked
            </p>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed font-mono break-all">
              {status.path}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
          <Link2 className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
              Service account not linked
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Generate a service-account JSON in{' '}
              <a
                href={serviceAccountsConsoleUrl()}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-baseline gap-1 text-blue-600 dark:text-blue-300 underline hover:no-underline font-medium"
              >
                Firebase Console → Project Settings → Service Accounts
                <ExternalLink className="w-3 h-3 self-center" />
              </a>
              {' '}(<strong>Generate new private key</strong>), then link the downloaded file with the button below. It stays on your machine only — never bundled with the app.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handleLink}
          disabled={busy}
          className={cn(
            "apple-press px-5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-2 transition-colors",
            status?.linked
              ? "bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              : "bg-blue-600 text-white border border-blue-700 hover:bg-blue-700",
            busy && "opacity-60 cursor-wait",
          )}
        >
          {status?.linked ? <RefreshCw className="w-3 h-3" /> : <FilePlus2 className="w-3 h-3" />}
          {busy ? 'Linking…' : status?.linked ? 'Relink service account' : 'Link service account'}
        </button>
      </div>

      {info && (
        <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">{info}</div>
      )}
      {error && (
        <div className="flex items-start gap-2 text-[11px] text-rose-700 dark:text-rose-300 font-medium">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
    </Section>
  );
}

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
