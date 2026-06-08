// Period-over-period comparison (v5.34).
//
// "Is OT up or down vs last month?" — answered *live* against the previous
// month's schedule, which is already in memory (allSchedules is keyed by
// month). Deliberately NOT a new persisted snapshot: a stored
// previous-period number would be offline-only (breaking dual-mode parity)
// and would drift the moment anyone edited a past month. Computing the delta
// on the fly keeps both data layers identical and always-correct.
//
// This module is pure (depends only on the Config type) so it unit-tests
// without any React / Firestore / disk. The heavier "recompute last month's
// OT / payroll" lives in the consuming tab via the existing analyzeOT /
// computePayrollRow engines fed `previousMonthConfig` + the prior schedule.

import type { Config } from '../types';

export interface PeriodDelta {
  current: number;
  previous: number;
  // current - previous (raw, unrounded). Positive = grew, negative = shrank.
  absolute: number;
  // Percent change vs the previous value. null when previous === 0 (a change
  // from nothing has no meaningful percentage — the UI shows the absolute
  // instead and labels it "new").
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
  // false → there is no prior-month data to compare against at all (first
  // month, or the previous month was never scheduled). The UI renders a
  // muted "no prior month" chip rather than a misleading 0%.
  hasPrevious: boolean;
}

// The previous calendar month for a 1-based (year, month). Uses the Date
// constructor's month-overflow handling so January rolls back to the prior
// December correctly. `month - 2` because the constructor is 0-based and we
// want one month earlier (e.g. 1-based March=3 → index 1 = February).
export function previousMonthOf(year: number, month: number): { year: number; month: number } {
  const d = new Date(year, month - 2, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// allSchedules key for a (year, month). MUST match App.tsx's `scheduleKey`
// (`scheduler_schedule_${year}_${month}`) — the on-the-fly delta reads the
// prior schedule straight out of the same map.
export function previousScheduleKey(year: number, month: number): string {
  const p = previousMonthOf(year, month);
  return `scheduler_schedule_${p.year}_${p.month}`;
}

// Config pivoted onto the previous calendar month. year / month / daysInMonth
// are moved back one month so cap math and YYYY-MM date-prefix filters operate
// on the right period; every other field (weekly caps, OT rates, holiday
// comp-mode, …) is inherited unchanged. The analysis engines filter the
// holiday list by date prefix internally, so the company-wide holiday array
// can be passed as-is alongside this config.
export function previousMonthConfig(config: Config): Config {
  const p = previousMonthOf(config.year, config.month);
  // Day 0 of the *next* month = last day of the target month.
  const daysInMonth = new Date(p.year, p.month, 0).getDate();
  return { ...config, year: p.year, month: p.month, daysInMonth };
}

// Sub-unit differences (< half an IQD / half an hour) are display noise — all
// our compared metrics are whole IQD or rounded hours — so treat them as flat
// instead of rendering a "+0%" up-arrow from floating-point dust.
const FLAT_EPSILON = 0.5;

export function computeDelta(current: number, previous: number, hasPrevious = true): PeriodDelta {
  const absolute = current - previous;
  let direction: PeriodDelta['direction'] = 'flat';
  if (absolute > FLAT_EPSILON) direction = 'up';
  else if (absolute < -FLAT_EPSILON) direction = 'down';
  const pct = previous !== 0
    ? Math.round((absolute / Math.abs(previous)) * 1000) / 10
    : null;
  return { current, previous, absolute, pct, direction, hasPrevious };
}
