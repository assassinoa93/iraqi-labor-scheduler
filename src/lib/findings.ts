/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.25 — single source of truth for how compliance findings are SPLIT,
 * COUNTED, GROUPED, TITLED, and SCORED. Before this module each surface
 * (Dashboard, Reports, Schedule preview, PDF, approval modals) did its own
 * thing: four different ways to count "violations", four compliance-score
 * formulas, raw English rule names, and the info/violation split honoured in
 * only two places. Everything now routes through here so the same finding is
 * always presented identically across every tab.
 *
 * Pairs with `FindingsList` (the shared UI) and the engine's translatable
 * `messageKey` / `messageParams` (compliance.ts).
 */
import type { Violation } from '../types';
import { RULE_LABEL_I18N_KEYS } from './fines';

export type FindingSeverity = 'violation' | 'info';

// Title i18n keys for the info-severity notes. These findings carry no
// `ruleKey` (they aren't fineable rule breaches), so we map them by their
// stable English `rule` string instead.
const NOTE_TITLE_KEYS: Record<string, string> = {
  'Public holiday worked': 'finding.note.publicHolidayWorked',
  'Comp day owed': 'finding.note.compDayOwed',
  'Comp day late': 'finding.note.compDayLate',
};

export function findingSeverity(v: Violation): FindingSeverity {
  return (v.severity ?? 'violation') === 'info' ? 'info' : 'violation';
}

/** i18n key for a finding's short title (translated rule / note label).
 *  Empty string when no key is registered — callers fall back to the raw
 *  English `rule`. */
export function findingTitleKey(v: Violation): string {
  if (v.ruleKey && RULE_LABEL_I18N_KEYS[v.ruleKey]) return RULE_LABEL_I18N_KEYS[v.ruleKey];
  return NOTE_TITLE_KEYS[v.rule] ?? '';
}

/** Render a finding's title in the active locale; falls back to the raw
 *  English rule name when no i18n key is registered (custom rules). */
export function findingTitle(v: Violation, t: (k: string) => string): string {
  const key = findingTitleKey(v);
  return key ? t(key) : v.rule;
}

/** Render a finding's detail line in the active locale; prefers the engine's
 *  translatable messageKey/messageParams, falls back to the English message.
 *  Pass `fmtDigits` (the i18n `fmt.digits`) so the interpolated numbers render
 *  in Arabic-Indic digits when that locale/pref is active — keeps the detail
 *  consistent with the rest of the localized UI. */
export function findingDetail(
  v: Violation,
  t: (k: string, vars?: Record<string, string | number>) => string,
  fmtDigits?: (s: string) => string,
): string {
  const raw = v.messageKey ? t(v.messageKey, v.messageParams) : v.message;
  return fmtDigits ? fmtDigits(raw) : raw;
}

/** Split a raw finding list into hard violations and info notes. The single
 *  place this split is computed — every surface consumes the result so notes
 *  never silently disappear and violations never accidentally include notes. */
export function splitFindings(all: Violation[]): { violations: Violation[]; notes: Violation[] } {
  const violations: Violation[] = [];
  const notes: Violation[] = [];
  for (const v of all) {
    if (findingSeverity(v) === 'info') notes.push(v);
    else violations.push(v);
  }
  return { violations, notes };
}

/** Total occurrences across a finding list (sum of grouped `count`). THE
 *  canonical count used by every KPI, badge, score, and report — replaces
 *  the previous mix of instance-sum / row-count / per-employee-count. */
export function countInstances(list: Violation[]): number {
  return list.reduce((s, v) => s + (v.count || 1), 0);
}

export interface FindingGroup {
  /** Stable grouping id — ruleKey for violations, rule string for notes. */
  key: string;
  /** Raw English rule (stable identifier; not for display). */
  rule: string;
  /** i18n key for the translated title. */
  titleKey: string;
  severity: FindingSeverity;
  article: string;
  /** The underlying findings in this group (for the expandable detail). */
  items: Violation[];
  /** Sum of `count` across the group. */
  instances: number;
  /** Distinct employees affected. */
  employees: number;
}

/** Group findings by rule so the UI shows ONE row per rule type (with an
 *  occurrence count + affected-employee count) instead of a flat, noisy dump
 *  — this is what keeps the now-unfiltered weekly-cap (and other per-window
 *  rules) from overwhelming the report. Sorted: violations before notes,
 *  then by instance count descending. */
export function groupFindings(list: Violation[]): FindingGroup[] {
  const map = new Map<string, FindingGroup>();
  for (const v of list) {
    const sev = findingSeverity(v);
    const key = sev === 'violation' ? (v.ruleKey ?? v.rule) : v.rule;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        rule: v.rule,
        titleKey: findingTitleKey(v),
        severity: sev,
        article: v.article,
        items: [],
        instances: 0,
        employees: 0,
      };
      map.set(key, g);
    }
    g.items.push(v);
    g.instances += v.count || 1;
  }
  for (const g of map.values()) {
    g.employees = new Set(g.items.map((i) => i.empId)).size;
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'violation' ? -1 : 1;
    return b.instances - a.instances;
  });
}

/** The ONE compliance-score formula (0-100, higher is better). Heuristic
 *  base of three checks per employee-day (daily cap, rest-between-shifts,
 *  weekly rest). Every surface that shows a "compliance %" uses this so the
 *  number can't disagree between the Dashboard, the preview modal, the
 *  approval dialog, and Reports. */
export function complianceScore(
  employeeCount: number,
  daysInMonth: number,
  violationInstances: number,
): number {
  const totalChecks = employeeCount * daysInMonth * 3;
  if (totalChecks === 0) return 100;
  return Math.max(0, Math.min(100, Math.round(100 - (violationInstances / totalChecks) * 100)));
}

/** Consistent severity → colour-tone token used by every findings surface so
 *  a violation never renders green and a note never renders red. */
export function findingTone(severity: FindingSeverity): 'rose' | 'blue' {
  return severity === 'violation' ? 'rose' : 'blue';
}
