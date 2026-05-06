/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.19.0 — Coverage gap detection for the auto-shift generator.
 *
 * Why: pre-v5.19 `generateOptimalShifts` only deduplicated by shift CODE
 * (AG1, AG2, …) — running the generator twice produced AG3/AG4 covering
 * the same hours as AG1/AG2 already did. Supervisors got a flood of
 * redundant shifts. This module is the single source of truth for
 * "what hours of the day are already covered by the existing work shift
 * library?" so the generator can short-circuit when current shifts are
 * already adequate.
 *
 * The coverage profile is per-hour (24 entries). An hour is "covered" if
 * AT LEAST ONE existing work shift is on the floor at that hour. We
 * intentionally don't track HC depth here — the generator's job is to
 * propose shift TYPES that cover an open window; whether to staff each
 * one with N people is a separate decision driven by hourly demand and
 * the auto-scheduler.
 */

import type { Shift } from '../types';
import { isSystemShift } from './systemShifts';

export interface CoverageProfile {
  // 24 booleans, index = hour-of-day. true ⇒ at least one work shift covers it.
  coveredByHour: boolean[];
  // Same length as input (excluding system / non-work shifts), giving the
  // start/end span used. Lets the UI surface "Morning shift 06:00–14:00
  // covers your open window" without re-parsing.
  coveringShifts: Array<{ code: string; name: string; startHour: number; endHour: number }>;
}

// "Demand window" = a contiguous run of hours where peak HC > 0. The
// gap detector takes those windows + the existing coverage profile and
// emits the SUB-windows that aren't yet covered. e.g. station open
// 11:00–23:00, existing shifts cover 11–19 but nothing covers 19–23 →
// returns one gap [{ start: 19, end: 23 }].
export interface CoverageGap {
  start: number;
  end: number;
}

// Parse a "HH:mm" timestamp into an hour-of-day in [0, 24]. End-of-day
// "23:59" rounds to 24 so the closer shift's coverage extends through the
// last hour. Anything malformed returns NaN — caller skips that shift.
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

// Build a 24-hour coverage profile from the existing work shifts. System
// shifts (OFF/AL/SL/MAT/PH/CP) and non-work shifts are excluded — they
// represent absences, not floor coverage. Cross-midnight shifts (e.g.
// 22:00–06:00) wrap correctly.
export function computeCoverageProfile(existingShifts: Shift[]): CoverageProfile {
  const coveredByHour = new Array(24).fill(false) as boolean[];
  const coveringShifts: CoverageProfile['coveringShifts'] = [];

  for (const shift of existingShifts) {
    if (!shift.isWork) continue;
    if (isSystemShift(shift.code)) continue;
    const startHour = parseHourFloor(shift.start);
    const endHour = parseHourCeil(shift.end);
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) continue;
    if (startHour === endHour) continue;

    // Cross-midnight (close <= open) wraps through hour 24.
    if (endHour > startHour) {
      for (let h = startHour; h < endHour && h < 24; h++) coveredByHour[h] = true;
    } else {
      for (let h = startHour; h < 24; h++) coveredByHour[h] = true;
      for (let h = 0; h < endHour && h < 24; h++) coveredByHour[h] = true;
    }
    coveringShifts.push({ code: shift.code, name: shift.name, startHour, endHour });
  }

  return { coveredByHour, coveringShifts };
}

// Given a demand window [start, end) and the existing coverage profile,
// return the contiguous sub-windows where coverage is missing. If the
// existing shifts already cover every hour in the window, returns [].
export function findCoverageGaps(
  windowStart: number,
  windowEnd: number,
  profile: CoverageProfile,
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  let cur = -1;
  for (let h = windowStart; h < windowEnd && h < 24; h++) {
    if (!profile.coveredByHour[h]) {
      if (cur === -1) cur = h;
    } else if (cur !== -1) {
      gaps.push({ start: cur, end: h });
      cur = -1;
    }
  }
  if (cur !== -1) gaps.push({ start: cur, end: Math.min(windowEnd, 24) });
  return gaps;
}

// Compute the percentage of demand-window hours already covered by
// existing shifts. Used by the UI to phrase the verdict — 100% ⇒
// "current setup adequate", >0 but <100 ⇒ "partial — N gap hours",
// 0 ⇒ "no existing coverage". `windows` is the list of demand windows
// (peak-demand contiguous runs) the generator works against.
export function summarizeCoverage(
  windows: Array<{ start: number; end: number }>,
  profile: CoverageProfile,
): {
  totalDemandHours: number;
  coveredHours: number;
  uncoveredHours: number;
  pctCovered: number;       // 0..100
} {
  let totalDemandHours = 0;
  let coveredHours = 0;
  for (const w of windows) {
    for (let h = w.start; h < w.end && h < 24; h++) {
      totalDemandHours++;
      if (profile.coveredByHour[h]) coveredHours++;
    }
  }
  const uncoveredHours = totalDemandHours - coveredHours;
  const pctCovered = totalDemandHours === 0
    ? 100
    : Math.round((coveredHours / totalDemandHours) * 100);
  return { totalDemandHours, coveredHours, uncoveredHours, pctCovered };
}
