import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { PeriodDelta } from '../lib/periodComparison';

interface DeltaChipProps {
  delta: PeriodDelta;
  // Formats the absolute value for the "new this month" case (previous === 0,
  // so there is no meaningful percentage). Defaults to the locale number
  // formatter. Percentages stay ASCII to match the existing KPI strips.
  formatAbs?: (n: number) => string;
  // For cost metrics (OT, fines) lower is better, so a DECREASE is good
  // (green) and an increase is bad (red). Set false for metrics where higher
  // is better (e.g. coverage %), flipping the colour mapping.
  lowerIsBetter?: boolean;
  // Forces neutral (slate) colouring while still showing the directional
  // arrow + magnitude. Use for metrics whose direction carries no inherent
  // good/bad verdict (e.g. total Net Payable can drop because someone left).
  neutral?: boolean;
  size?: 'xs' | 'sm';
  className?: string;
}

// v5.34 — "vs last month" pill. Direction is conveyed by BOTH the arrow icon
// (up / down / flat) and the colour, and the full change is spelled out in the
// aria-label, so the meaning survives for colour-blind and screen-reader users
// — not colour alone.
export function DeltaChip({ delta, formatAbs, lowerIsBetter = true, neutral = false, size = 'sm', className }: DeltaChipProps) {
  const { t, fmt } = useI18n();
  const fmtN = formatAbs ?? ((n: number) => fmt.num(Math.round(n)));

  const iconCls = size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  const baseCls = cn(
    'inline-flex items-center gap-1 rounded-full font-black tabular-nums whitespace-nowrap',
    size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5',
  );

  // No prior month scheduled → render a muted, explicit placeholder rather
  // than a misleading "0%".
  if (!delta.hasPrevious) {
    return (
      <span
        className={cn(baseCls, 'bg-slate-100 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500', className)}
        title={t('delta.noPrior')}
      >
        <Minus className={iconCls} aria-hidden="true" />
        {t('delta.noPrior')}
      </span>
    );
  }

  // good === true → green, false → red, null → neutral (flat or forced).
  const good = (neutral || delta.direction === 'flat')
    ? null
    : (delta.direction === 'down') === lowerIsBetter;
  const tone = good === null
    ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
    : good
      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-200'
      : 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-200';

  const Icon = delta.direction === 'up' ? TrendingUp : delta.direction === 'down' ? TrendingDown : Minus;
  const magnitude = delta.pct != null ? `${Math.abs(delta.pct)}%` : fmtN(Math.abs(delta.absolute));
  const label = delta.direction === 'flat'
    ? (delta.pct === 0 ? '0%' : '—')
    : magnitude;
  const aria = delta.direction === 'flat'
    ? t('delta.aria.flat')
    : delta.direction === 'up'
      ? t('delta.aria.up', { magnitude })
      : t('delta.aria.down', { magnitude });

  return (
    <span className={cn(baseCls, tone, className)} title={t('delta.vsLastMonth')} aria-label={aria}>
      <Icon className={iconCls} aria-hidden="true" />
      {label}
    </span>
  );
}
