import React, { useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';
import { recordSnapshot, readHistory, ComplianceSnapshot } from '../lib/complianceHistory';

interface Props {
  companyId: string;
  compliancePct: number;
  violations: number;
  coveragePct: number;
}

// Mini sparkline + delta card for the dashboard. Reads the last 30 days of
// snapshots from localStorage and renders an inline SVG path. On mount it
// also writes today's reading so the trend self-populates as the user uses
// the app — no setup required, no server-side persistence.
export function ComplianceTrendCard({ companyId, compliancePct, violations, coveragePct }: Props) {
  const { t } = useI18n();

  // Persist today's snapshot whenever the inputs change. Per-day dedup is
  // handled inside recordSnapshot so this fires safely on every render.
  useEffect(() => {
    if (!companyId) return;
    recordSnapshot(companyId, { compliancePct, violations, coveragePct });
  }, [companyId, compliancePct, violations, coveragePct]);

  const history = useMemo<ComplianceSnapshot[]>(() => readHistory(companyId), [companyId, compliancePct, violations, coveragePct]);

  if (history.length < 2) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-slate-50 text-slate-400 rounded-xl flex items-center justify-center">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('trend.title')}</p>
            <p className="text-xs text-slate-400">{t('trend.bootstrap')}</p>
          </div>
        </div>
      </div>
    );
  }

  const first = history[0];
  const last = history[history.length - 1];
  const delta = last.compliancePct - first.compliancePct;
  const tone = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

  // Build the sparkline path from compliancePct values. SVG viewbox is fixed
  // at 100×30; scale x by entry count, y is inverted (compliance high = top).
  const W = 100;
  const H = 30;
  const min = Math.min(...history.map(s => s.compliancePct));
  const max = Math.max(...history.map(s => s.compliancePct));
  const range = Math.max(1, max - min);
  const path = history
    .map((s, i) => {
      const x = (i / Math.max(1, history.length - 1)) * W;
      const y = H - ((s.compliancePct - min) / range) * H;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            tone === 'up' ? "bg-emerald-50 text-emerald-700" : tone === 'down' ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-500",
          )}>
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('trend.title')}</p>
            <p className="text-xs text-slate-700 font-bold">
              {t('trend.range', { days: history.length })}
            </p>
          </div>
        </div>
        <div className={cn(
          "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest",
          tone === 'up' ? "bg-emerald-50 text-emerald-700" : tone === 'down' ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-500",
        )}>
          {tone === 'up' ? <TrendingUp className="w-3 h-3" /> : tone === 'down' ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          {delta > 0 ? '+' : ''}{delta.toFixed(0)} pts
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none">
        <path
          d={path}
          fill="none"
          stroke={tone === 'up' ? '#059669' : tone === 'down' ? '#e11d48' : '#94a3b8'}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-400">
        <span>{first.date} · {first.compliancePct}%</span>
        <span>{last.date} · {last.compliancePct}%</span>
      </div>
    </div>
  );
}
