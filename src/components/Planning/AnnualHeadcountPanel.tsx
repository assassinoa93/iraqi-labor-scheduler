import React from 'react';
import {
  ArrowDown, ArrowUp, Briefcase, Clock4, Minus, Users,
} from 'lucide-react';
import { Card } from '../Primitives';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';
import type { PlanMode } from '../../lib/workforcePlanning';

// v2.6.0 — Annual Headcount Plan panel (extracted to its own file in
// v5.23.0).
//
// Splits FTE and PT into two parallel columns so the supervisor reads
// the year's demand without merging the two contract types. Each column
// shows:
//   • Big "current → recommended" headline + delta arrow (skipped in
//     ideal-only view, where the recommendation stands alone)
//   • A 4-tile grid: Average, Median, Peak (with month name), Valley
//     (with month name) — month names are pulled from the byMonth series
//     so the reader sees not just "you peak at 8" but "you peak at 8 in
//     April, valley at 4 in August".
//   • A short rationale line that swaps with the planner mode
//     (peak-driven vs average-driven).
//
// Input: the `headcountStats` object computed in the parent component.
export interface HeadcountColumnStats {
  current: number;
  recommended: number;
  delta: number;
  avg: number;
  median: number;
  peak: number;
  valley: number;
  peakMonth: string;
  valleyMonth: string;
}

export interface HeadcountStats {
  fte: HeadcountColumnStats;
  pt: HeadcountColumnStats;
}

export function AnnualHeadcountPanel({
  stats, mode, idealOnly,
}: {
  stats: HeadcountStats;
  mode: PlanMode;
  idealOnly: boolean;
}) {
  const { t } = useI18n();
  // PT column is mostly relevant in optimal mode; conservative mode
  // recommends 0 PT by design (peak-driven FTE absorbs surge). Render
  // the column either way so the supervisor sees the current PT count
  // even when the recommendation drives it to zero.
  return (
    <Card className="overflow-hidden">
      <div className="p-5 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40 flex items-center gap-3">
        <Users className="w-4 h-4 text-blue-600 dark:text-blue-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
            {t('workforce.headcount.title')}
          </h3>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            {mode === 'conservative'
              ? t('workforce.headcount.subtitle.conservative')
              : t('workforce.headcount.subtitle.optimal')}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border",
            mode === 'conservative'
              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30"
              : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30",
          )}
        >
          {mode === 'conservative' ? t('workforce.mode.conservative.label') : t('workforce.mode.optimal.label')}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 dark:divide-slate-700/60">
        <HeadcountColumn
          icon={<Briefcase className="w-4 h-4" />}
          tone="blue"
          label={t('workforce.headcount.fte.label')}
          subLabel={t('workforce.headcount.fte.sub')}
          stats={stats.fte}
          unit={t('workforce.headcount.unit.fte')}
          idealOnly={idealOnly}
          rationale={mode === 'conservative'
            ? t('workforce.headcount.rationale.fte.conservative')
            : t('workforce.headcount.rationale.fte.optimal')}
        />
        <HeadcountColumn
          icon={<Clock4 className="w-4 h-4" />}
          tone="purple"
          label={t('workforce.headcount.pt.label')}
          subLabel={t('workforce.headcount.pt.sub')}
          stats={stats.pt}
          unit={t('workforce.headcount.unit.pt')}
          idealOnly={idealOnly}
          rationale={mode === 'conservative'
            ? t('workforce.headcount.rationale.pt.conservative')
            : t('workforce.headcount.rationale.pt.optimal')}
        />
      </div>
    </Card>
  );
}

// One column of the AnnualHeadcountPanel. `tone` drives the accent
// colour (blue for FTE, purple for PT). `idealOnly` flips the headline
// from "current → recommended" to just the recommendation.
function HeadcountColumn({
  icon, tone, label, subLabel, stats, unit, idealOnly, rationale,
}: {
  icon: React.ReactNode;
  tone: 'blue' | 'purple';
  label: string;
  subLabel: string;
  stats: HeadcountColumnStats;
  unit: string;
  idealOnly: boolean;
  rationale: string;
}) {
  const { t } = useI18n();
  const accentText = tone === 'blue'
    ? 'text-blue-700 dark:text-blue-200'
    : 'text-purple-700 dark:text-purple-200';
  const accentBg = tone === 'blue'
    ? 'bg-blue-50 dark:bg-blue-500/15 border-blue-100 dark:border-blue-500/30'
    : 'bg-purple-50 dark:bg-purple-500/15 border-purple-100 dark:border-purple-500/30';
  const iconWrap = tone === 'blue'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200'
    : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200';

  // Round to 1dp so .333 / .667 medians and averages stay readable
  // without lying about the precision (the underlying analyzer rounds
  // headcount to whole people; the avg/median can land between).
  const fmt = (n: number) => Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0';

  // Delta arrow + colour. A positive delta (need to hire) is rose;
  // negative (release surplus) is amber-warning in optimal mode and
  // emerald-clean in conservative mode (where surplus = idle, not a
  // legal action). Zero is slate.
  const dPos = stats.delta > 0;
  const dNeg = stats.delta < 0;
  const deltaToneClass = dPos
    ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/30'
    : dNeg
      ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/30'
      : 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700';
  const DeltaIcon = dPos ? ArrowUp : dNeg ? ArrowDown : Minus;

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center", iconWrap)}>{icon}</span>
        <div className="min-w-0">
          <p className={cn("text-[11px] font-black uppercase tracking-widest", accentText)}>{label}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">{subLabel}</p>
        </div>
      </div>

      {idealOnly ? (
        <div>
          <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">
            {t('workforce.headcount.recommended')}
          </p>
          <p className={cn("text-5xl font-black tracking-tight tabular-nums", accentText)}>
            {stats.recommended}
          </p>
          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-wider">{unit}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">
              {t('workforce.headcount.current')}
            </p>
            <p className="text-3xl font-black text-slate-800 dark:text-slate-100 tabular-nums">{stats.current}</p>
            <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-0.5 uppercase tracking-wider">{unit}</p>
          </div>
          <div>
            <p className={cn("text-[9px] font-black uppercase tracking-widest mb-1", accentText)}>
              {t('workforce.headcount.recommended')}
            </p>
            <p className={cn("text-3xl font-black tabular-nums", accentText)}>{stats.recommended}</p>
            <p className={cn("text-[9px] font-bold mt-0.5 uppercase tracking-wider", accentText)}>{unit}</p>
          </div>
        </div>
      )}

      {!idealOnly && (
        <div className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
          deltaToneClass,
        )}>
          <DeltaIcon className="w-3 h-3" />
          {stats.delta > 0 ? `+${stats.delta}` : stats.delta < 0 ? `−${Math.abs(stats.delta)}` : '0'}
          <span className="font-mono">{unit}</span>
        </div>
      )}

      {/* Year-summary tiles. Avg + median centre the demand profile;
          peak + valley anchor the extremes. The month name on
          peak/valley turns "you peak at 8" into "you peak at 8 in April"
          which is what the supervisor actually plans against. */}
      <div className={cn("rounded-xl p-3 border space-y-2.5", accentBg)}>
        <p className={cn("text-[9px] font-black uppercase tracking-widest", accentText)}>
          {t('workforce.headcount.profile.title')}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ProfileTile
            label={t('workforce.headcount.profile.avg')}
            value={fmt(stats.avg)}
            tone="neutral"
            tooltip={t('workforce.headcount.profile.avg.tooltip')}
          />
          <ProfileTile
            label={t('workforce.headcount.profile.median')}
            value={fmt(stats.median)}
            tone="neutral"
            tooltip={t('workforce.headcount.profile.median.tooltip')}
          />
          <ProfileTile
            label={t('workforce.headcount.profile.peak')}
            value={String(stats.peak)}
            month={stats.peakMonth}
            tone="rose"
            tooltip={t('workforce.headcount.profile.peak.tooltip')}
          />
          <ProfileTile
            label={t('workforce.headcount.profile.valley')}
            value={String(stats.valley)}
            month={stats.valleyMonth}
            tone="emerald"
            tooltip={t('workforce.headcount.profile.valley.tooltip')}
          />
        </div>
      </div>

      <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{rationale}</p>
    </div>
  );
}

// One stat tile inside the year-summary grid. Renders the value, an
// optional month sub-label (peak/valley get one), and a short header.
// Small palette — neutral / rose (peak) / emerald (valley) — so the
// supervisor visually parses the four numbers at a glance.
function ProfileTile({
  label, value, month, tone, tooltip,
}: {
  label: string;
  value: string;
  month?: string;
  tone: 'neutral' | 'rose' | 'emerald';
  tooltip?: string;
}) {
  const headerCls =
    tone === 'rose' ? 'text-rose-700 dark:text-rose-300'
    : tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-slate-500 dark:text-slate-400';
  const valueCls =
    tone === 'rose' ? 'text-rose-700 dark:text-rose-200'
    : tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-200'
    : 'text-slate-800 dark:text-slate-100';
  return (
    <div title={tooltip} className="bg-white dark:bg-slate-900/50 rounded-lg px-2.5 py-2 border border-slate-200 dark:border-slate-700/60">
      <p className={cn("text-[8px] font-black uppercase tracking-widest mb-0.5", headerCls)}>{label}</p>
      <p className={cn("text-xl font-black tabular-nums leading-none", valueCls)}>{value}</p>
      {month && (
        <p className="text-[8px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mt-0.5">{month}</p>
      )}
    </div>
  );
}
