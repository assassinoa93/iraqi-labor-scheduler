/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — AI session scope.
 *
 * The user locked "scope is per-session" — set once at session start,
 * mid-session changes only via explicit user action (Scope-bar pill or
 * accepting an AI-proposed widen). No silent widening between turns.
 *
 * Each scope is a per-domain window:
 *   - schedules / payroll: month range (YYYY-MM inclusive)
 *   - leave: from/to date range plus an `asOf` for current balances
 *   - wfp: a target year (full-year, per the locked WFP shape)
 *   - holidays: implicit (the year(s) covered by schedules + wfp)
 *
 * Persistence: sessionStorage so the scope survives a tab refresh but
 * not a full app restart. Multi-session resume (when the chat panel
 * lands in phase 4) will move this to the per-session record.
 */

import { useEffect, useState } from 'react';

export interface MonthRange {
  fromYear: number;
  fromMonth: number; // 1..12
  toYear: number;
  toMonth: number;   // 1..12
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export interface AiScope {
  schedules: MonthRange | null;
  payroll: MonthRange | null;
  leave: { range: DateRange | null; asOf: string };
  wfp: { year: number } | null;
}

const SCOPE_KEY = 'ils.ai.scope';
const SCOPE_EVENT = 'ils:ai-scope-changed';

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyScope(): AiScope {
  return {
    schedules: null,
    payroll: null,
    leave: { range: null, asOf: isoToday() },
    wfp: null,
  };
}

export function readScope(): AiScope {
  try {
    const raw = sessionStorage.getItem(SCOPE_KEY);
    if (!raw) return emptyScope();
    const parsed = JSON.parse(raw) as Partial<AiScope>;
    return {
      ...emptyScope(),
      ...parsed,
      // Defensive merge — leave is a nested object so an old snapshot
      // could be missing one of the two fields.
      leave: { ...emptyScope().leave, ...(parsed.leave ?? {}) },
    };
  } catch {
    return emptyScope();
  }
}

export function writeScope(s: AiScope): void {
  sessionStorage.setItem(SCOPE_KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent(SCOPE_EVENT));
}

export function clearScope(): void {
  sessionStorage.removeItem(SCOPE_KEY);
  window.dispatchEvent(new CustomEvent(SCOPE_EVENT));
}

export function useAiScope(): [AiScope, (next: AiScope) => void, () => void] {
  const [scope, setScope] = useState<AiScope>(readScope);
  useEffect(() => {
    const onChange = () => setScope(readScope());
    window.addEventListener(SCOPE_EVENT, onChange);
    return () => window.removeEventListener(SCOPE_EVENT, onChange);
  }, []);
  const update = (next: AiScope) => {
    writeScope(next);
    setScope(next);
  };
  const clear = () => {
    clearScope();
    setScope(emptyScope());
  };
  return [scope, update, clear];
}

// ─── Formatters ─────────────────────────────────────────────────────────

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatMonthRange(r: MonthRange | null): string {
  if (!r) return '—';
  if (r.fromYear === r.toYear && r.fromMonth === r.toMonth) {
    return `${MONTH_NAMES_SHORT[r.fromMonth - 1]} ${r.fromYear}`;
  }
  if (r.fromYear === r.toYear) {
    return `${MONTH_NAMES_SHORT[r.fromMonth - 1]}–${MONTH_NAMES_SHORT[r.toMonth - 1]} ${r.fromYear}`;
  }
  return `${MONTH_NAMES_SHORT[r.fromMonth - 1]} ${r.fromYear} – ${MONTH_NAMES_SHORT[r.toMonth - 1]} ${r.toYear}`;
}

export function formatDateRange(r: DateRange | null): string {
  if (!r) return '—';
  if (r.from === r.to) return r.from;
  return `${r.from} → ${r.to}`;
}
