/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.34 — period-over-period delta helpers backing the "vs last month" chips
 * on the Coverage/OT KPIs and the Payroll grand-total header.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDelta,
  previousMonthOf,
  previousScheduleKey,
  previousMonthConfig,
} from '../periodComparison';
import type { Config } from '../../types';

describe('previousMonthOf', () => {
  it('steps back one month within the same year', () => {
    expect(previousMonthOf(2026, 6)).toEqual({ year: 2026, month: 5 });
  });

  it('rolls back across the year boundary from January', () => {
    expect(previousMonthOf(2026, 1)).toEqual({ year: 2025, month: 12 });
  });
});

describe('previousScheduleKey', () => {
  it('matches the App.tsx scheduler_schedule_<year>_<month> convention', () => {
    expect(previousScheduleKey(2026, 6)).toBe('scheduler_schedule_2026_5');
    expect(previousScheduleKey(2026, 1)).toBe('scheduler_schedule_2025_12');
  });
});

describe('previousMonthConfig', () => {
  const base = {
    year: 2026,
    month: 3, // March → previous = February
    daysInMonth: 31,
    standardWeeklyHrsCap: 48,
    otRateDay: 1.5,
  } as unknown as Config;

  it('pivots year/month and recomputes daysInMonth for the prior month', () => {
    const prev = previousMonthConfig(base);
    expect(prev.year).toBe(2026);
    expect(prev.month).toBe(2);
    expect(prev.daysInMonth).toBe(28); // Feb 2026 is not a leap year
  });

  it('crosses the year boundary and keeps all other config fields', () => {
    const prev = previousMonthConfig({ ...base, year: 2026, month: 1 });
    expect(prev.year).toBe(2025);
    expect(prev.month).toBe(12);
    expect(prev.daysInMonth).toBe(31);
    expect(prev.standardWeeklyHrsCap).toBe(48);
    expect(prev.otRateDay).toBe(1.5);
  });

  it('recomputes a leap-February correctly', () => {
    const prev = previousMonthConfig({ ...base, year: 2024, month: 3 });
    expect(prev.daysInMonth).toBe(29);
  });
});

describe('computeDelta', () => {
  it('reports growth as up with a positive percent', () => {
    const d = computeDelta(150, 100);
    expect(d.direction).toBe('up');
    expect(d.absolute).toBe(50);
    expect(d.pct).toBe(50);
    expect(d.hasPrevious).toBe(true);
  });

  it('reports a decrease as down with a negative percent', () => {
    const d = computeDelta(80, 100);
    expect(d.direction).toBe('down');
    expect(d.absolute).toBe(-20);
    expect(d.pct).toBe(-20);
  });

  it('treats an equal value as flat', () => {
    const d = computeDelta(100, 100);
    expect(d.direction).toBe('flat');
    expect(d.absolute).toBe(0);
    expect(d.pct).toBe(0);
  });

  it('treats sub-unit floating-point noise as flat', () => {
    const d = computeDelta(100.3, 100);
    expect(d.direction).toBe('flat');
  });

  it('returns null pct when the previous value is zero (new this month)', () => {
    const d = computeDelta(500, 0);
    expect(d.pct).toBeNull();
    expect(d.direction).toBe('up');
    expect(d.absolute).toBe(500);
  });

  it('rounds the percentage to one decimal place', () => {
    const d = computeDelta(133, 100);
    expect(d.pct).toBe(33);
    const d2 = computeDelta(133.7, 100);
    expect(d2.pct).toBe(33.7);
  });

  it('flags absence of prior-month data via hasPrevious', () => {
    const d = computeDelta(500, 0, false);
    expect(d.hasPrevious).toBe(false);
  });
});
