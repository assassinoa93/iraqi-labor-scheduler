import { describe, it, expect } from 'vitest';
import { estimateFines, getEffectiveFineRate, RULE_KEYS, DEFAULT_FINE_RATES } from '../fines';
import type { Config, Violation } from '../../types';

const baseConfig: Config = {
  company: 'Test', year: 2026, month: 1, daysInMonth: 31,
  weekendPolicy: 'Friday Only', weeklyRestDayPrimary: 6,
  continuousShiftsMode: 'OFF', coverageMin: 1, maxConsecWorkDays: 6,
  standardDailyHrsCap: 8, hazardousDailyHrsCap: 7,
  standardWeeklyHrsCap: 48, hazardousWeeklyHrsCap: 36,
  minRestBetweenShiftsHrs: 11,
  shopOpeningTime: '09:00', shopClosingTime: '21:00',
  peakDays: [5, 6, 7], holidays: [],
  otRateDay: 1.5, otRateNight: 2.0,
  fineRates: { ...DEFAULT_FINE_RATES },
};

const v = (ruleKey: string, count: number, severity: 'violation' | 'info' = 'violation'): Violation => ({
  empId: 'E1', day: 5, rule: ruleKey, ruleKey, article: '', message: '', count, severity,
});

describe('getEffectiveFineRate', () => {
  it('returns the Config override when set', () => {
    const cfg: Config = { ...baseConfig, fineRates: { [RULE_KEYS.DAILY_HOURS_CAP]: 750_000 } };
    expect(getEffectiveFineRate(RULE_KEYS.DAILY_HOURS_CAP, cfg)).toBe(750_000);
  });

  it('falls back to DEFAULT_FINE_RATES when Config has no override', () => {
    const cfg: Config = { ...baseConfig, fineRates: {} };
    expect(getEffectiveFineRate(RULE_KEYS.DAILY_HOURS_CAP, cfg))
      .toBe(DEFAULT_FINE_RATES[RULE_KEYS.DAILY_HOURS_CAP]);
  });

  it('falls back to DEFAULT_FINE_RATES when fineRates is undefined entirely', () => {
    const cfg: Config = { ...baseConfig, fineRates: undefined };
    expect(getEffectiveFineRate(RULE_KEYS.WORKED_DURING_MATERNITY, cfg))
      .toBe(DEFAULT_FINE_RATES[RULE_KEYS.WORKED_DURING_MATERNITY]);
  });

  it('returns 0 for unknown rule keys', () => {
    expect(getEffectiveFineRate('totallyMadeUpRule', baseConfig)).toBe(0);
  });

  it('clamps negative override values to 0', () => {
    const cfg: Config = { ...baseConfig, fineRates: { [RULE_KEYS.DAILY_HOURS_CAP]: -500 } };
    expect(getEffectiveFineRate(RULE_KEYS.DAILY_HOURS_CAP, cfg)).toBe(0);
  });
});

describe('estimateFines', () => {
  it('returns zero total + empty breakdown for an empty violation list', () => {
    const result = estimateFines([], baseConfig);
    expect(result.total).toBe(0);
    expect(result.byRule).toHaveLength(0);
  });

  it('multiplies occurrences by rate per rule', () => {
    const result = estimateFines([
      v(RULE_KEYS.DAILY_HOURS_CAP, 4),
      v(RULE_KEYS.WEEKLY_HOURS_CAP, 2),
    ], baseConfig);
    // 4 × 250k + 2 × 250k = 1.5M
    expect(result.total).toBe(1_500_000);
    expect(result.byRule.find(r => r.ruleKey === RULE_KEYS.DAILY_HOURS_CAP)?.subtotal).toBe(1_000_000);
    expect(result.byRule.find(r => r.ruleKey === RULE_KEYS.WEEKLY_HOURS_CAP)?.subtotal).toBe(500_000);
  });

  it('aggregates multiple violations of the same rule', () => {
    const result = estimateFines([
      v(RULE_KEYS.DAILY_HOURS_CAP, 1),
      v(RULE_KEYS.DAILY_HOURS_CAP, 1),
      v(RULE_KEYS.DAILY_HOURS_CAP, 1),
    ], baseConfig);
    expect(result.byRule).toHaveLength(1);
    expect(result.byRule[0].occurrences).toBe(3);
    expect(result.byRule[0].subtotal).toBe(750_000);
  });

  it('skips info-severity findings entirely', () => {
    const result = estimateFines([
      v(RULE_KEYS.DAILY_HOURS_CAP, 5, 'info'),
      v(RULE_KEYS.WEEKLY_HOURS_CAP, 3, 'violation'),
    ], baseConfig);
    expect(result.total).toBe(750_000);
    expect(result.byRule).toHaveLength(1);
    expect(result.byRule[0].ruleKey).toBe(RULE_KEYS.WEEKLY_HOURS_CAP);
  });

  it('treats missing count as 1', () => {
    const result = estimateFines([
      { empId: 'E1', day: 5, rule: 'Daily hours cap', ruleKey: RULE_KEYS.DAILY_HOURS_CAP, article: '', message: '' },
    ], baseConfig);
    expect(result.byRule[0].occurrences).toBe(1);
    expect(result.total).toBe(250_000);
  });

  it('falls back to deriving ruleKey from rule string when ruleKey is missing', () => {
    const result = estimateFines([
      { empId: 'E1', day: 5, rule: 'Daily hours cap', article: '', message: '', count: 2 },
    ], baseConfig);
    expect(result.total).toBe(500_000);
  });

  it('skips violations with neither ruleKey nor a recognised rule string', () => {
    const result = estimateFines([
      { empId: 'E1', day: 5, rule: 'Some custom rule we never saw', article: '', message: '', count: 5 },
    ], baseConfig);
    expect(result.total).toBe(0);
  });

  it('respects per-rule Config overrides', () => {
    const cfg: Config = { ...baseConfig, fineRates: {
      [RULE_KEYS.DAILY_HOURS_CAP]: 1_000_000, // 4× the seed
    }};
    const result = estimateFines([v(RULE_KEYS.DAILY_HOURS_CAP, 3)], cfg);
    expect(result.total).toBe(3_000_000);
  });

  it('returns the Pareto-sorted breakdown (largest first)', () => {
    const result = estimateFines([
      v(RULE_KEYS.WEEKLY_HOURS_CAP, 1),                  // 250k
      v(RULE_KEYS.WORKED_DURING_MATERNITY, 1),           // 1M
      v(RULE_KEYS.WORKED_DURING_SICK_LEAVE, 1),          // 500k
    ], baseConfig);
    expect(result.byRule.map(r => r.ruleKey)).toEqual([
      RULE_KEYS.WORKED_DURING_MATERNITY,
      RULE_KEYS.WORKED_DURING_SICK_LEAVE,
      RULE_KEYS.WEEKLY_HOURS_CAP,
    ]);
  });
});
