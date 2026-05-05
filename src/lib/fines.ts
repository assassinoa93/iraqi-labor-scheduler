/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.17.0 — Fine estimation for the staffing advisory's "fines avoided"
 * calculation. Each compliance violation that the engine emits with
 * `severity: 'violation'` is mapped to a per-occurrence IQD amount via
 * `Config.fineRates` and summed.
 *
 * Why this exists:
 *   The staffing advisory previously framed hiring purely as
 *   "OT cost saved vs new salaries". That misses the bigger lever: a
 *   schedule that breaches Art. 67/68/70/71/72/74/86/87/88 caps exposes
 *   the establishment to Iraqi Labor Law penalties. Adding a fines-
 *   avoided line gives a more honest cost picture so the supervisor can
 *   weigh "hire 14 → save 2.5M OT premium" against "hire 14 → also
 *   avoid 8M in projected fines = 10.5M total benefit".
 *
 * Why operator-set defaults (not authoritative amounts):
 *   The Iraqi Labor Law 37/2015 penalties chapter sets penalty RANGES
 *   (typically 250,000 – 1,000,000 IQD per violation) but the exact
 *   amount applied in any given case is set by the labor inspector and
 *   varies with severity, repeat-offender status, and judicial
 *   discretion. We seed sensible MIDPOINTS aligned with the law's
 *   framework so the feature works out-of-box, then expose every rate
 *   in the Variables tab so the user can refine with their labor
 *   counsel for amounts that apply to their establishment.
 *
 * Defaults (placeholder midpoints — refine in Variables tab):
 *   - Daily/weekly cap breaches (Art. 67/68/70):     250,000 IQD
 *   - Min rest between shifts (Art. 71):             250,000 IQD
 *   - Consecutive work days (Art. 71 §5, 72):        250,000 IQD
 *   - Weekly rest day (Art. 72):                     250,000 IQD
 *   - Driver-specific (Art. 88):                     250,000 IQD
 *   - Continuous driving (Art. 88):                  250,000 IQD
 *   - Worked during sick leave (Art. 84):            500,000 IQD
 *   - Worked during annual leave:                    250,000 IQD
 *   - Worked during maternity leave (Art. 87):     1,000,000 IQD
 *   - Women's industrial night work (Art. 86):     1,000,000 IQD
 */

import type { Violation, Config } from '../types';

// Stable machine keys for every rule the compliance engine emits.
// Keep these in sync with the `ruleKey` field set in src/lib/compliance.ts.
// The string values are stable contracts — never change them once shipped
// or fineRates from older saves stop matching. New rules can be added.
export const RULE_KEYS = {
  DAILY_HOURS_CAP: 'dailyHoursCap',
  WEEKLY_HOURS_CAP: 'weeklyHoursCap',
  MIN_REST_BETWEEN_SHIFTS: 'minRestBetweenShifts',
  CONSECUTIVE_WORK_DAYS: 'consecutiveWorkDays',
  WEEKLY_REST_DAY: 'weeklyRestDay',
  CONTINUOUS_DRIVING_NO_BREAK: 'continuousDrivingNoBreak',
  WORKED_DURING_MATERNITY: 'workedDuringMaternity',
  WORKED_DURING_SICK_LEAVE: 'workedDuringSickLeave',
  WORKED_DURING_ANNUAL_LEAVE: 'workedDuringAnnualLeave',
  WOMENS_NIGHT_WORK_INDUSTRIAL: 'womensNightWorkIndustrial',
} as const;

export type RuleKey = (typeof RULE_KEYS)[keyof typeof RULE_KEYS];

// Default fine amounts in IQD per occurrence. Mid-range placeholders
// aligned with the Iraqi Labor Law 37/2015 penalty framework. The user
// adjusts these in the Variables tab to match the amounts that actually
// apply in their jurisdiction / case history.
export const DEFAULT_FINE_RATES: Record<string, number> = {
  [RULE_KEYS.DAILY_HOURS_CAP]: 250_000,
  [RULE_KEYS.WEEKLY_HOURS_CAP]: 250_000,
  [RULE_KEYS.MIN_REST_BETWEEN_SHIFTS]: 250_000,
  [RULE_KEYS.CONSECUTIVE_WORK_DAYS]: 250_000,
  [RULE_KEYS.WEEKLY_REST_DAY]: 250_000,
  [RULE_KEYS.CONTINUOUS_DRIVING_NO_BREAK]: 250_000,
  [RULE_KEYS.WORKED_DURING_MATERNITY]: 1_000_000,
  [RULE_KEYS.WORKED_DURING_SICK_LEAVE]: 500_000,
  [RULE_KEYS.WORKED_DURING_ANNUAL_LEAVE]: 250_000,
  [RULE_KEYS.WOMENS_NIGHT_WORK_INDUSTRIAL]: 1_000_000,
};

// Article citation per rule key — used by the Variables tab to label
// each fine-rate row with its statute reference. Article strings are
// not translated since they're cross-language legal citations.
export const RULE_ARTICLES: Record<string, string> = {
  [RULE_KEYS.DAILY_HOURS_CAP]: 'Art. 67 / 68',
  [RULE_KEYS.WEEKLY_HOURS_CAP]: 'Art. 70',
  [RULE_KEYS.MIN_REST_BETWEEN_SHIFTS]: 'Art. 71',
  [RULE_KEYS.CONSECUTIVE_WORK_DAYS]: 'Art. 71 §5, 72',
  [RULE_KEYS.WEEKLY_REST_DAY]: 'Art. 72',
  [RULE_KEYS.CONTINUOUS_DRIVING_NO_BREAK]: 'Art. 88',
  [RULE_KEYS.WORKED_DURING_MATERNITY]: 'Art. 87',
  [RULE_KEYS.WORKED_DURING_SICK_LEAVE]: 'Art. 84',
  [RULE_KEYS.WORKED_DURING_ANNUAL_LEAVE]: 'Annual Leave',
  [RULE_KEYS.WOMENS_NIGHT_WORK_INDUSTRIAL]: 'Art. 86',
};

// Display label key per rule key — UI translates via i18n. Falls back
// to the rule key itself when no i18n key is registered.
export const RULE_LABEL_I18N_KEYS: Record<string, string> = {
  [RULE_KEYS.DAILY_HOURS_CAP]: 'fines.rule.dailyHoursCap',
  [RULE_KEYS.WEEKLY_HOURS_CAP]: 'fines.rule.weeklyHoursCap',
  [RULE_KEYS.MIN_REST_BETWEEN_SHIFTS]: 'fines.rule.minRestBetweenShifts',
  [RULE_KEYS.CONSECUTIVE_WORK_DAYS]: 'fines.rule.consecutiveWorkDays',
  [RULE_KEYS.WEEKLY_REST_DAY]: 'fines.rule.weeklyRestDay',
  [RULE_KEYS.CONTINUOUS_DRIVING_NO_BREAK]: 'fines.rule.continuousDrivingNoBreak',
  [RULE_KEYS.WORKED_DURING_MATERNITY]: 'fines.rule.workedDuringMaternity',
  [RULE_KEYS.WORKED_DURING_SICK_LEAVE]: 'fines.rule.workedDuringSickLeave',
  [RULE_KEYS.WORKED_DURING_ANNUAL_LEAVE]: 'fines.rule.workedDuringAnnualLeave',
  [RULE_KEYS.WOMENS_NIGHT_WORK_INDUSTRIAL]: 'fines.rule.womensNightWorkIndustrial',
};

// Legacy fallback: if a Violation predates v5.17 and lacks a `ruleKey`,
// derive one from the human-readable `rule` string using a best-effort
// lookup. Returns null when there's no match (caller treats as
// "no fine — unknown rule"). Pre-v5.17 saves don't carry ruleKey on
// stored violations, but in practice violations are recomputed live by
// the compliance engine on every render so this only fires for any
// custom callers that build Violations by hand.
const RULE_NAME_TO_KEY: Record<string, RuleKey> = {
  'Daily hours cap': RULE_KEYS.DAILY_HOURS_CAP,
  'Weekly hours cap': RULE_KEYS.WEEKLY_HOURS_CAP,
  'Min rest between shifts': RULE_KEYS.MIN_REST_BETWEEN_SHIFTS,
  'Consecutive work days': RULE_KEYS.CONSECUTIVE_WORK_DAYS,
  'Weekly rest day': RULE_KEYS.WEEKLY_REST_DAY,
  'Continuous driving without break': RULE_KEYS.CONTINUOUS_DRIVING_NO_BREAK,
  'Worked during maternity leave': RULE_KEYS.WORKED_DURING_MATERNITY,
  'Worked during sick leave': RULE_KEYS.WORKED_DURING_SICK_LEAVE,
  'Worked during annual leave': RULE_KEYS.WORKED_DURING_ANNUAL_LEAVE,
  "Women's night work in industrial undertakings": RULE_KEYS.WOMENS_NIGHT_WORK_INDUSTRIAL,
};

function deriveRuleKey(v: Violation): string | null {
  if (v.ruleKey) return v.ruleKey;
  return RULE_NAME_TO_KEY[v.rule] ?? null;
}

// Resolve the effective fine rate for a rule, falling back through
// (1) Config override → (2) DEFAULT_FINE_RATES → (3) zero. The zero
// fallback means rules we haven't catalogued (custom rules added later,
// info-severity findings) contribute nothing to the total — safer than
// inventing a per-rule estimate.
export function getEffectiveFineRate(ruleKey: string, config: Config): number {
  const override = config.fineRates?.[ruleKey];
  if (typeof override === 'number' && Number.isFinite(override)) return Math.max(0, override);
  const seed = DEFAULT_FINE_RATES[ruleKey];
  return typeof seed === 'number' ? seed : 0;
}

export interface FineBreakdownEntry {
  ruleKey: string;
  // Total occurrences across all employees (sum of `count`s).
  occurrences: number;
  // IQD per occurrence used for this run.
  ratePerOccurrence: number;
  // occurrences × ratePerOccurrence.
  subtotal: number;
}

export interface FineEstimate {
  total: number;
  byRule: FineBreakdownEntry[];
}

// Estimate total fines for a violation set. Only `severity: 'violation'`
// entries contribute — `info` findings (worked a public holiday with comp
// owed, etc.) are operational notes, not legal breaches. Each violation's
// `count` field (set by the compliance engine when grouping repeats)
// multiplies the per-occurrence rate.
export function estimateFines(violations: Violation[], config: Config): FineEstimate {
  const occurrencesByRule = new Map<string, number>();
  for (const v of violations) {
    if ((v.severity ?? 'violation') !== 'violation') continue;
    const key = deriveRuleKey(v);
    if (!key) continue;
    const occ = Math.max(1, v.count ?? 1);
    occurrencesByRule.set(key, (occurrencesByRule.get(key) || 0) + occ);
  }

  const byRule: FineBreakdownEntry[] = [];
  let total = 0;
  for (const [ruleKey, occurrences] of occurrencesByRule) {
    const ratePerOccurrence = getEffectiveFineRate(ruleKey, config);
    const subtotal = occurrences * ratePerOccurrence;
    byRule.push({ ruleKey, occurrences, ratePerOccurrence, subtotal });
    total += subtotal;
  }
  // Largest first so the breakdown reads as a Pareto.
  byRule.sort((a, b) => b.subtotal - a.subtotal || b.occurrences - a.occurrences);
  return { total, byRule };
}
