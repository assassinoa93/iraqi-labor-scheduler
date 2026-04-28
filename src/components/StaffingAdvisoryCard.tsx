import React, { useState } from 'react';
import { TrendingDown, ShieldCheck, Crown, ArrowRight, Info } from 'lucide-react';
import { StaffingAdvisory, StaffingMode } from '../lib/staffingAdvisory';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

interface Props {
  advisory: StaffingAdvisory;
  /** Current OT hours — used as the "today" baseline in the headline. */
  currentOTHours: number;
  /** Current monthly OT spend (IQD). */
  currentOTPay: number;
}

type ModeKey = 'eliminateOT' | 'optimalCoverage' | 'bestOfBoth';

// Three-tab advisory card on the Dashboard. Lets the supervisor flip
// between hiring strategies and see the headcount + IQD impact of each
// before committing. Replaces the single "Strategic Growth Path" card.
export function StaffingAdvisoryCard({ advisory, currentOTHours, currentOTPay }: Props) {
  const { t } = useI18n();
  const [activeMode, setActiveMode] = useState<ModeKey>('bestOfBoth');

  const modes: Array<{ key: ModeKey; icon: React.ComponentType<{ className?: string }>; tone: string; data: StaffingMode; titleKey: string; bodyKey: string }> = [
    { key: 'eliminateOT', icon: TrendingDown, tone: 'emerald', data: advisory.eliminateOT, titleKey: 'advisory.mode.eliminateOT.title', bodyKey: 'advisory.mode.eliminateOT.body' },
    { key: 'optimalCoverage', icon: ShieldCheck, tone: 'blue', data: advisory.optimalCoverage, titleKey: 'advisory.mode.optimalCoverage.title', bodyKey: 'advisory.mode.optimalCoverage.body' },
    { key: 'bestOfBoth', icon: Crown, tone: 'indigo', data: advisory.bestOfBoth, titleKey: 'advisory.mode.bestOfBoth.title', bodyKey: 'advisory.mode.bestOfBoth.body' },
  ];

  const active = modes.find(m => m.key === activeMode)!;
  const ActiveIcon = active.icon;

  const fmtIQD = (n: number) => Math.abs(n).toLocaleString();

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Mode-tab header */}
      <div className="flex items-stretch border-b border-slate-100 bg-slate-50">
        {modes.map(m => {
          const Icon = m.icon;
          const isActive = m.key === activeMode;
          return (
            <button
              key={m.key}
              onClick={() => setActiveMode(m.key)}
              className={cn(
                "flex-1 px-4 py-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all border-b-2",
                isActive
                  ? `bg-white text-${m.tone}-700 border-${m.tone}-500`
                  : "text-slate-400 border-transparent hover:text-slate-700 hover:bg-white/50"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t(m.titleKey)}</span>
            </button>
          );
        })}
      </div>

      <div className="p-6 space-y-5">
        {/* Active mode summary */}
        <div className="flex items-start gap-4">
          <div className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
            active.tone === 'emerald' && "bg-emerald-50 text-emerald-700",
            active.tone === 'blue' && "bg-blue-50 text-blue-700",
            active.tone === 'indigo' && "bg-indigo-50 text-indigo-700",
          )}>
            <ActiveIcon className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('advisory.section.eyebrow')}</p>
            <h3 className="text-lg font-bold text-slate-800 tracking-tight">{t(active.titleKey)}</h3>
            <p className="text-xs text-slate-500 leading-relaxed mt-1">{t(active.bodyKey)}</p>
          </div>
        </div>

        {/* KPIs for the active mode */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{t('advisory.kpi.hires')}</p>
            <p className={cn(
              "text-2xl font-black mt-1",
              active.tone === 'emerald' && "text-emerald-700",
              active.tone === 'blue' && "text-blue-700",
              active.tone === 'indigo' && "text-indigo-700",
            )}>
              +{active.data.hiresNeeded}
            </p>
          </div>
          <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
            <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">{t('advisory.kpi.otSaved')}</p>
            <p className="text-base font-black text-emerald-700 mt-1">{fmtIQD(active.data.monthlyOTSaved)}</p>
            <p className="text-[9px] text-emerald-600 font-medium">IQD / mo</p>
          </div>
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg">
            <p className="text-[9px] font-black text-rose-700 uppercase tracking-widest">{t('advisory.kpi.salaryAdded')}</p>
            <p className="text-base font-black text-rose-700 mt-1">{fmtIQD(active.data.monthlySalaryAdded)}</p>
            <p className="text-[9px] text-rose-600 font-medium">IQD / mo</p>
          </div>
        </div>

        {/* Net delta */}
        <div className={cn(
          "p-4 rounded-xl border flex items-center justify-between",
          active.data.netMonthlyDelta >= 0
            ? "bg-emerald-50 border-emerald-200"
            : "bg-amber-50 border-amber-200"
        )}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('advisory.kpi.netMonthly')}</p>
            <p className={cn(
              "text-2xl font-black mt-1",
              active.data.netMonthlyDelta >= 0 ? "text-emerald-700" : "text-amber-700",
            )}>
              {active.data.netMonthlyDelta >= 0 ? '+' : '−'}{fmtIQD(active.data.netMonthlyDelta)} IQD
            </p>
          </div>
          <ArrowRight className={cn(
            "w-6 h-6",
            active.data.netMonthlyDelta >= 0 ? "text-emerald-500" : "text-amber-500",
          )} />
        </div>

        {/* Footnote */}
        <div className="flex items-start gap-2 text-[10px] text-slate-500 leading-relaxed">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          <p>
            {t('advisory.footnote', {
              ot: currentOTHours.toFixed(0),
              spend: currentOTPay.toLocaleString(),
              avg: advisory.avgMonthlySalary.toLocaleString(),
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
