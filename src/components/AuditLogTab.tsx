import React, { useEffect, useState, useMemo } from 'react';
import { format } from 'date-fns';
import { History, Plus, Edit3, Trash2, Filter, RefreshCw, Download } from 'lucide-react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { subscribeAuditLog, type AuditEntryDoc } from '../lib/audit';
import { ConfirmModal } from './ConfirmModal';

export interface AuditEntry {
  ts: number;
  domain: string;
  op: 'add' | 'remove' | 'modify' | 'replace';
  targetId?: string;
  label?: string;
  summary: string;
  // Phase 2.3b — populated when reading from Firestore (Online mode);
  // absent for legacy Express-emitted entries (Offline mode).
  companyId?: string;
  actorEmail?: string;
}

// v2.1.4 — domain → i18n key map. Pre-2.1.4 the labels were hardcoded
// English; the table read in Arabic UI mixed RTL surroundings with
// English chips. Added stationGroups now that those persist (v2.1.4 B1).
const DOMAIN_LABEL_KEY: Record<string, string> = {
  employees: 'audit.domain.employees',
  shifts: 'audit.domain.shifts',
  stations: 'audit.domain.stations',
  stationGroups: 'audit.domain.stationGroups',
  holidays: 'audit.domain.holidays',
  config: 'audit.domain.config',
  schedule: 'audit.domain.schedule',
  companies: 'audit.domain.companies',
  system: 'audit.domain.system',
};

const opIcon = (op: AuditEntry['op']) => {
  if (op === 'add') return <Plus className="w-3 h-3" />;
  if (op === 'remove') return <Trash2 className="w-3 h-3" />;
  if (op === 'replace') return <RefreshCw className="w-3 h-3" />;
  return <Edit3 className="w-3 h-3" />;
};

const opTone = (op: AuditEntry['op']) => {
  if (op === 'add') return 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border-emerald-100 dark:border-emerald-500/30';
  if (op === 'remove') return 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-200 border-red-100 dark:border-red-500/30';
  if (op === 'replace') return 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200 border-blue-100 dark:border-blue-500/30';
  return 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-200 border-amber-100 dark:border-amber-500/30';
};

export function AuditLogTab() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDomain, setFilterDomain] = useState<string>('all');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [infoState, setInfoState] = useState<{ open: boolean; title: string; body: string }>({ open: false, title: '', body: '' });

  const load = () => {
    setLoading(true);
    fetch('/api/audit')
      .then(r => r.json())
      .then((data: { entries?: AuditEntry[] }) => {
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const clearLog = () => {
    fetch('/api/audit/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(() => {
        setEntries([]);
        setInfoState({ open: true, title: t('audit.cleared.title'), body: t('audit.cleared.body') });
      })
      .catch(() => {
        setInfoState({ open: true, title: t('info.error.title'), body: t('audit.cleared.failed') });
      });
  };

  // Phase 2.3b — dual-mode read. Online mode subscribes to Firestore
  // /audit (real-time updates from any client + server-side filtering by
  // role); Offline mode keeps the existing Express /api/audit fetch.
  useEffect(() => {
    if (!isAuthenticated) {
      load();
      return;
    }
    setLoading(true);
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        unsub = await subscribeAuditLog((docs: AuditEntryDoc[]) => {
          if (cancelled) return;
          setEntries(docs.map((d) => ({
            ts: d.ts,
            domain: d.domain,
            op: d.op,
            targetId: d.targetId ?? undefined,
            label: d.label ?? undefined,
            summary: d.summary,
            companyId: d.companyId ?? undefined,
            actorEmail: d.actorEmail ?? undefined,
          })));
          setLoading(false);
        });
      } catch (err) {
        console.error('[AuditLogTab] subscribe failed:', err);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [isAuthenticated]);

  const domains = useMemo(() => {
    const s = new Set<string>();
    entries.forEach(e => s.add(e.domain));
    return Array.from(s).sort();
  }, [entries]);

  const filtered = useMemo(
    () => filterDomain === 'all' ? entries : entries.filter(e => e.domain === filterDomain),
    [entries, filterDomain]
  );

  const exportCsv = () => {
    const header = ['Timestamp', 'Domain', 'Operation', 'Target', 'Summary'];
    const rows = entries.map(e => [
      new Date(e.ts).toISOString(),
      e.domain,
      e.op,
      e.label || e.targetId || '',
      // CSV-escape the summary
      `"${e.summary.replace(/"/g, '""')}"`,
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Audit_Log_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  // Group by day for nicer reading
  const grouped = useMemo(() => {
    const m = new Map<string, AuditEntry[]>();
    for (const e of filtered) {
      const dayKey = format(new Date(e.ts), 'yyyy-MM-dd');
      if (!m.has(dayKey)) m.set(dayKey, []);
      m.get(dayKey)!.push(e);
    }
    return Array.from(m.entries());
  }, [filtered]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-100 uppercase tracking-tight">{t('audit.title')}</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium uppercase tracking-widest font-mono">
            {t('audit.subtitle')} · {entries.length} / 2000
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="apple-press flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            {t('action.refresh')}
          </button>
          <button
            onClick={exportCsv}
            disabled={entries.length === 0}
            className="apple-press flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100 dark:border-emerald-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 dark:hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-200 disabled:opacity-40"
          >
            <Download className="w-3 h-3" />
            {t('audit.exportCsv')}
          </button>
          <button
            onClick={() => setConfirmClearOpen(true)}
            disabled={entries.length === 0}
            className="apple-press flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/15 border border-red-100 dark:border-red-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 dark:hover:bg-red-500/25 text-red-700 dark:text-red-200 disabled:opacity-40"
          >
            <Trash2 className="w-3 h-3" />
            {t('audit.clear')}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmClearOpen}
        title={t('audit.confirmClear.title')}
        message={t('audit.confirmClear.body')}
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={clearLog}
      />
      <ConfirmModal
        isOpen={infoState.open}
        title={infoState.title}
        message={infoState.body}
        onConfirm={() => setInfoState(s => ({ ...s, open: false }))}
        onClose={() => setInfoState(s => ({ ...s, open: false }))}
        infoOnly
      />

      <div className="flex items-center gap-2 flex-wrap p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 rounded-xl">
        <Filter className="w-3 h-3 text-slate-400 dark:text-slate-500" />
        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('audit.filter')}</span>
        <button
          onClick={() => setFilterDomain('all')}
          className={cn(
            'px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all',
            filterDomain === 'all'
              ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
              : 'bg-white dark:bg-slate-800/60 text-slate-500 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
          )}
        >
          {t('audit.filter.all')} ({entries.length})
        </button>
        {domains.map(d => (
          <button
            key={d}
            onClick={() => setFilterDomain(d)}
            className={cn(
              'px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all',
              filterDomain === d
                ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                : 'bg-white dark:bg-slate-800/60 text-slate-500 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
            )}
          >
            {DOMAIN_LABEL_KEY[d] ? t(DOMAIN_LABEL_KEY[d]) : d} ({entries.filter(e => e.domain === d).length})
          </button>
        ))}
      </div>

      {filtered.length === 0 && !loading && (
        <div className="p-12 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/60 text-center">
          <History className="w-10 h-10 text-slate-200 dark:text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-[10px]">{t('audit.empty')}</p>
          <p className="text-[10px] text-slate-300 dark:text-slate-600 font-medium uppercase tracking-tighter mt-1">{t('audit.emptyHint')}</p>
        </div>
      )}

      <div className="space-y-6">
        {grouped.map(([day, dayEntries]) => (
          <div key={day} className="space-y-2">
            {/* v3.0 — sticky day header surface uses the page-bg token via
                the global override pass; pre-3.0 it hardcoded `#F3F4F6`
                which became invisible against the dark sunken surface. */}
            <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest sticky top-0 bg-[#F3F4F6] dark:bg-[#0d1117] py-1">
              {format(new Date(day), 'EEEE, MMMM d, yyyy')} <span className="text-slate-300 dark:text-slate-600">· {dayEntries.length === 1 ? t('audit.changes.one') : t('audit.changes.many', { count: dayEntries.length })}</span>
            </p>
            <div className="space-y-1.5">
              {dayEntries.map((e, i) => (
                <div key={`${e.ts}-${i}`} className="flex items-start gap-3 p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-700/60 hover:border-slate-200 dark:hover:border-slate-600 transition-colors">
                  <div className={cn('flex items-center justify-center w-7 h-7 rounded-md border shrink-0', opTone(e.op))}>
                    {opIcon(e.op)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{e.summary}</p>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 text-[9px] font-mono uppercase tracking-widest">
                        {DOMAIN_LABEL_KEY[e.domain] ? t(DOMAIN_LABEL_KEY[e.domain]) : e.domain}
                      </span>
                    </div>
                    {e.targetId && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">{e.targetId}</p>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 shrink-0">{format(new Date(e.ts), 'HH:mm:ss')}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
