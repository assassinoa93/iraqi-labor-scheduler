import React, { useEffect, useState, useMemo } from 'react';
import { format } from 'date-fns';
import { History, Plus, Edit3, Trash2, Filter, RefreshCw, Download } from 'lucide-react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

export interface AuditEntry {
  ts: number;
  domain: string;
  op: 'add' | 'remove' | 'modify' | 'replace';
  targetId?: string;
  label?: string;
  summary: string;
}

const DOMAIN_LABEL: Record<string, string> = {
  employees: 'Employee',
  shifts: 'Shift',
  stations: 'Station / Asset',
  holidays: 'Holiday',
  config: 'Config',
  schedule: 'Schedule',
};

const opIcon = (op: AuditEntry['op']) => {
  if (op === 'add') return <Plus className="w-3 h-3" />;
  if (op === 'remove') return <Trash2 className="w-3 h-3" />;
  if (op === 'replace') return <RefreshCw className="w-3 h-3" />;
  return <Edit3 className="w-3 h-3" />;
};

const opTone = (op: AuditEntry['op']) => {
  if (op === 'add') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (op === 'remove') return 'bg-red-50 text-red-700 border-red-100';
  if (op === 'replace') return 'bg-blue-50 text-blue-700 border-blue-100';
  return 'bg-amber-50 text-amber-700 border-amber-100';
};

export function AuditLogTab() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDomain, setFilterDomain] = useState<string>('all');

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

  useEffect(() => { load(); }, []);

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
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">{t('audit.title')}</h3>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-widest font-mono">
            {t('audit.subtitle')} · {entries.length} / 2000
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all text-slate-700"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            {t('action.refresh')}
          </button>
          <button
            onClick={exportCsv}
            disabled={entries.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 transition-all text-emerald-700 disabled:opacity-40"
          >
            <Download className="w-3 h-3" />
            {t('audit.exportCsv')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap p-4 bg-slate-50 border border-slate-100 rounded-xl">
        <Filter className="w-3 h-3 text-slate-400" />
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('audit.filter')}</span>
        <button
          onClick={() => setFilterDomain('all')}
          className={cn(
            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all",
            filterDomain === 'all' ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-100"
          )}
        >
          All ({entries.length})
        </button>
        {domains.map(d => (
          <button
            key={d}
            onClick={() => setFilterDomain(d)}
            className={cn(
              "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all",
              filterDomain === d ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-100"
            )}
          >
            {DOMAIN_LABEL[d] || d} ({entries.filter(e => e.domain === d).length})
          </button>
        ))}
      </div>

      {filtered.length === 0 && !loading && (
        <div className="p-12 bg-white rounded-xl border border-slate-200 text-center">
          <History className="w-10 h-10 text-slate-200 mx-auto mb-4" />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">{t('audit.empty')}</p>
          <p className="text-[10px] text-slate-300 font-medium uppercase tracking-tighter mt-1">{t('audit.emptyHint')}</p>
        </div>
      )}

      <div className="space-y-6">
        {grouped.map(([day, dayEntries]) => (
          <div key={day} className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 bg-[#F3F4F6] py-1">
              {format(new Date(day), 'EEEE, MMMM d, yyyy')} <span className="text-slate-300">· {dayEntries.length} change{dayEntries.length === 1 ? '' : 's'}</span>
            </p>
            <div className="space-y-1.5">
              {dayEntries.map((e, i) => (
                <div key={`${e.ts}-${i}`} className="flex items-start gap-3 p-3 bg-white rounded-lg border border-slate-100 hover:border-slate-200 transition-colors">
                  <div className={cn("flex items-center justify-center w-7 h-7 rounded-md border shrink-0", opTone(e.op))}>
                    {opIcon(e.op)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-xs font-bold text-slate-800">{e.summary}</p>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-mono uppercase tracking-widest">
                        {DOMAIN_LABEL[e.domain] || e.domain}
                      </span>
                    </div>
                    {e.targetId && (
                      <p className="text-[10px] text-slate-400 font-mono">{e.targetId}</p>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">{format(new Date(e.ts), 'HH:mm:ss')}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
