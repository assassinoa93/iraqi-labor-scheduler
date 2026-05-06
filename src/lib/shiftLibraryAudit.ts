/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.19.0 — Shift Library Audit.
 *
 * Detects three classes of cruft in the company's shift library so the
 * supervisor can prune what's no longer needed without breaking
 * anything live:
 *
 *   1. UNUSED — the shift code doesn't appear in the active month's
 *      schedule and (when allSchedules is provided) hasn't appeared in
 *      the trailing 3 months either. Safe to delete.
 *
 *   2. REDUNDANT — another work shift covers the same hour range with
 *      the same flags (isWork / isHazardous / isIndustrial). The
 *      auto-scheduler treats them interchangeably; keeping both adds
 *      noise without value.
 *
 *   3. SUBSUMED — a shorter shift's hour range is fully contained in a
 *      longer shift's range, both work-shifts with identical flags.
 *      The shorter one is redundant unless deliberately kept for shift
 *      preference / break differences.
 *
 * Output is purely advisory. The auditor never deletes — it surfaces
 * findings so the supervisor can confirm. System shifts (OFF/AL/SL/
 * MAT/PH/CP) are never flagged. Shifts that ARE in use are never
 * flagged as unused, even if they're also redundant.
 */

import type { Shift, Schedule } from '../types';
import { isSystemShift } from './systemShifts';

export type AuditFindingKind = 'unused' | 'redundant' | 'subsumed';

export interface AuditFinding {
  kind: AuditFindingKind;
  shiftCode: string;
  shiftName: string;
  // For redundant / subsumed findings, the OTHER shift involved.
  otherCode?: string;
  otherName?: string;
  // Plain-language explanation surfaced in the UI.
  reason: string;
  // Conservative recommendation: keep / merge / delete.
  recommendation: 'keep' | 'merge' | 'delete';
  // Usage count (work-shift assignments) across `allSchedules` if provided,
  // otherwise across the active schedule only. 0 = never used.
  usageCount: number;
  // Months scanned for usage. UI displays this so the supervisor knows
  // the recency of the "unused" claim.
  monthsScanned: number;
}

export interface AuditResult {
  findings: AuditFinding[];
  // High-level summary numbers for the audit-panel header.
  totalShifts: number;
  workShifts: number;
  flaggedCount: number;
  unusedCount: number;
  redundantCount: number;
  subsumedCount: number;
}

export interface AuditArgs {
  shifts: Shift[];
  // Active month's schedule. Required.
  schedule: Schedule;
  // Optional history. When provided, "unused" requires a shift be missing
  // from EVERY schedule in `lookbackMonths`. When omitted, only the
  // active schedule is consulted (less reliable).
  allSchedules?: Record<string, Schedule>;
  lookbackMonths?: number;     // default 3
}

function parseHourFloor(hhmm: string | undefined): number {
  if (!hhmm) return NaN;
  const [hStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  return Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : NaN;
}
function parseHourCeil(hhmm: string | undefined): number {
  if (!hhmm) return NaN;
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  if (!Number.isFinite(h)) return NaN;
  if (m > 0) return Math.max(1, Math.min(24, h + 1));
  return Math.max(0, Math.min(24, h));
}

// Sum usages of each shift code across one or more schedules.
function countUsage(shifts: Shift[], schedules: Schedule[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of shifts) out.set(s.code, 0);
  for (const sched of schedules) {
    for (const empSched of Object.values(sched)) {
      for (const entry of Object.values(empSched)) {
        if (!entry) continue;
        out.set(entry.shiftCode, (out.get(entry.shiftCode) || 0) + 1);
      }
    }
  }
  return out;
}

export function auditShiftLibrary(args: AuditArgs): AuditResult {
  const { shifts, schedule, allSchedules, lookbackMonths = 3 } = args;

  // Gather schedules to scan: active month + (up to) lookbackMonths most
  // recent entries from allSchedules. Keys look like
  // `scheduler_schedule_2026_5`. We sort by year/month descending and
  // take the top N.
  const schedules: Schedule[] = [schedule];
  let monthsScanned = 1;
  if (allSchedules) {
    const entries = Object.entries(allSchedules)
      .map(([k, v]) => {
        const m = k.match(/_(\d{4})_(\d{1,2})$/);
        if (!m) return null;
        return { y: parseInt(m[1]), m: parseInt(m[2]), v };
      })
      .filter((x): x is { y: number; m: number; v: Schedule } => !!x)
      .sort((a, b) => (b.y * 100 + b.m) - (a.y * 100 + a.m));
    for (const e of entries.slice(0, lookbackMonths)) {
      schedules.push(e.v);
      monthsScanned++;
    }
  }

  const usage = countUsage(shifts, schedules);
  const findings: AuditFinding[] = [];

  // ── Unused detection ─────────────────────────────────────────────────
  for (const sh of shifts) {
    if (isSystemShift(sh.code)) continue;
    const count = usage.get(sh.code) || 0;
    if (count === 0) {
      findings.push({
        kind: 'unused',
        shiftCode: sh.code,
        shiftName: sh.name,
        reason: `Not referenced in the active schedule${monthsScanned > 1 ? ` or the prior ${monthsScanned - 1} month(s)` : ''}.`,
        recommendation: 'delete',
        usageCount: count,
        monthsScanned,
      });
    }
  }

  // ── Redundant + subsumed detection ──────────────────────────────────
  // Build the (work) shift list with parsed hours, sorted longest first.
  // For each pair (i < j), check identical-window (redundant) and
  // contains-relationship (subsumed). Skip system shifts on both sides.
  type Parsed = { shift: Shift; startHour: number; endHour: number };
  const parsed: Parsed[] = shifts
    .filter(s => s.isWork && !isSystemShift(s.code))
    .map(s => ({ shift: s, startHour: parseHourFloor(s.start), endHour: parseHourCeil(s.end) }))
    .filter(p => Number.isFinite(p.startHour) && Number.isFinite(p.endHour) && p.endHour > p.startHour)
    .sort((a, b) => (b.endHour - b.startHour) - (a.endHour - a.startHour));

  // Avoid double-flagging: once a shift is flagged as redundant against
  // shift X, don't also flag it as subsumed by X.
  const flaggedAgainst = new Map<string, Set<string>>();
  const flagPair = (a: string, b: string) => {
    if (!flaggedAgainst.has(a)) flaggedAgainst.set(a, new Set());
    flaggedAgainst.get(a)!.add(b);
  };
  const isFlaggedAgainst = (a: string, b: string): boolean =>
    !!flaggedAgainst.get(a)?.has(b) || !!flaggedAgainst.get(b)?.has(a);

  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i];
      const b = parsed[j];
      // Different work flags / hazardous flags / industrial flags →
      // semantically different shifts. Don't flag.
      if (a.shift.isHazardous !== b.shift.isHazardous) continue;
      if (a.shift.isIndustrial !== b.shift.isIndustrial) continue;
      if (isFlaggedAgainst(a.shift.code, b.shift.code)) continue;

      // Identical-window check.
      if (a.startHour === b.startHour && a.endHour === b.endHour) {
        // Pick the LESS-USED one to flag — supervisor will keep the
        // mainstream variant.
        const aUsage = usage.get(a.shift.code) || 0;
        const bUsage = usage.get(b.shift.code) || 0;
        const flag = aUsage <= bUsage ? a : b;
        const keep = flag === a ? b : a;
        findings.push({
          kind: 'redundant',
          shiftCode: flag.shift.code,
          shiftName: flag.shift.name,
          otherCode: keep.shift.code,
          otherName: keep.shift.name,
          reason: `Same hour window (${flag.shift.start}–${flag.shift.end}) and same flags as "${keep.shift.name}" (${keep.shift.code}). The auto-scheduler picks between them by length only — both interchange.`,
          recommendation: aUsage === 0 && bUsage === 0 ? 'delete' : 'merge',
          usageCount: usage.get(flag.shift.code) || 0,
          monthsScanned,
        });
        flagPair(a.shift.code, b.shift.code);
        continue;
      }
      // Subsumed check: b is shorter and fully contained inside a.
      if (b.startHour >= a.startHour && b.endHour <= a.endHour && (b.endHour - b.startHour) < (a.endHour - a.startHour)) {
        findings.push({
          kind: 'subsumed',
          shiftCode: b.shift.code,
          shiftName: b.shift.name,
          otherCode: a.shift.code,
          otherName: a.shift.name,
          reason: `"${b.shift.name}" (${b.shift.start}–${b.shift.end}, ${b.endHour - b.startHour}h) is fully covered by the longer "${a.shift.name}" (${a.shift.start}–${a.shift.end}, ${a.endHour - a.startHour}h). Keep the short one only if you need its different break or preference; otherwise the longer shift covers the same window.`,
          recommendation: (usage.get(b.shift.code) || 0) === 0 ? 'delete' : 'keep',
          usageCount: usage.get(b.shift.code) || 0,
          monthsScanned,
        });
        flagPair(a.shift.code, b.shift.code);
      }
    }
  }

  const workShifts = parsed.length;
  const totalShifts = shifts.length;
  return {
    findings,
    totalShifts,
    workShifts,
    flaggedCount: findings.length,
    unusedCount: findings.filter(f => f.kind === 'unused').length,
    redundantCount: findings.filter(f => f.kind === 'redundant').length,
    subsumedCount: findings.filter(f => f.kind === 'subsumed').length,
  };
}
