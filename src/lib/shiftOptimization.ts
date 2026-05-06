/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.19.2 — Shift Library Optimization (prescriptive).
 *
 * Builds an "optimal alternative" shift library for a given demand
 * profile and compares it to the supervisor's current library, surfacing
 * a one-click migration plan. Distinct from gap-filling
 * (`generateOptimalShifts` with the current library): this module
 * answers "what would the IDEAL shift library look like for this
 * demand, irrespective of what I have today?" and lets the supervisor
 * adopt the result wholesale.
 *
 * Why this exists separately:
 *   - Gap-filling keeps the existing library and patches holes. Good
 *     for incremental tuning; bad when the existing library has
 *     structural problems (12-hour shifts that violate the daily cap,
 *     two shifts both spanning the entire window with redundant flags).
 *   - Library optimization re-derives the shift set from the demand
 *     curve alone, applying the same rules the auto-scheduler relies on
 *     (≤ daily cap, staggered openers + closers for windows > cap,
 *     mid-window shifts only when span > 2× cap). The result is a
 *     library the auto-scheduler can use without OT-pressure surprises.
 *
 * How the proposal is built:
 *   1. Run generateOptimalShifts() with an EMPTY existingShifts list →
 *      the unrestricted ideal output.
 *   2. Match each proposed shift against the current library by
 *      hours + work-flags. Exact matches go into `toKeep`; others go
 *      into `toAdd`. Current work shifts that don't appear in the
 *      proposal go into `toDelete`.
 *   3. System shifts (OFF/AL/SL/MAT/PH/CP) are always preserved —
 *      they're protected by the auto-scheduler / leave system.
 *   4. Quality issues from the current library (over-cap, redundant,
 *      subsumed) are checked against the proposal: ones the proposal
 *      eliminates land in `fixedIssues`; ones it can't (none, in
 *      practice) land in `remainingIssues`.
 *
 * Limitations:
 *   - Doesn't preserve user-tuned non-default fields (description,
 *     break minutes beyond default 60). The supervisor can re-edit
 *     after adopting if those tweaks matter.
 *   - "Coverage equivalent" check is HOUR-LEVEL only. Two libraries
 *     that cover the same hours but with different concurrency
 *     patterns are treated as equivalent here (the auto-scheduler
 *     handles concurrency at staffing time).
 */

import type { Shift, Station, Config } from '../types';
import { isSystemShift } from './systemShifts';
import {
  generateOptimalShifts,
  type ExistingIssue,
} from './shiftGenerator';

export interface ShiftDiffEntry {
  shift: Shift;
  // Why the shift is in this bucket. Surfaced in the UI tooltip.
  reason: string;
}

export interface OptimizationProposal {
  // The ideal shift library for this demand profile, sized correctly
  // (every shift ≤ daily cap, no redundancy, no subsumption).
  proposedLibrary: Shift[];
  // The current work shifts (pre-optimization). System shifts are
  // excluded from the diff because they survive the migration.
  currentWorkShifts: Shift[];

  // Migration plan — what the user would experience if they adopt the
  // proposal. The Adopt action removes everything in `toDelete` and
  // appends everything in `toAdd`. `toKeep` is informational — those
  // shifts already match the proposal.
  toDelete: ShiftDiffEntry[];
  toAdd: ShiftDiffEntry[];
  toKeep: ShiftDiffEntry[];

  // Quality issues on the CURRENT library that the proposal fixes.
  fixedIssues: ExistingIssue[];
  // Quality issues that survive the migration (theoretical — empty in
  // practice because the proposal is built to avoid them, but kept
  // for future-proofing if the proposal generator ever loosens its
  // constraints).
  remainingIssues: ExistingIssue[];

  // High-level deltas for the UI headline.
  delta: {
    // proposed shift count − current work shift count. Negative means
    // the proposal is leaner; positive means the proposal recommends
    // splitting one current shift into multiple staggered pieces.
    shiftCountDelta: number;
    // Number of issues the proposal fixes (over-cap, redundant, subsumed).
    fixedOverCap: number;
    fixedRedundant: number;
    fixedSubsumed: number;
    // Average shift duration before / after — UI shows this so the
    // supervisor sees "your library averages 11h, the proposal
    // averages 7.5h".
    currentAvgDuration: number;
    proposedAvgDuration: number;
    // Demand windows in the dataset — same for both libraries (they
    // both target the same demand). Surfaced for context.
    demandWindowCount: number;
    demandHourTotal: number;
    // Coverage parity — both libraries cover every demand hour. Should
    // always be true; if false, something went wrong in proposal
    // generation and the UI should warn the user.
    coverageEquivalent: boolean;
  };

  // Plain-language summary for the headline banner. e.g. "Replacing 2
  // shifts with 4 staggered ones eliminates 1 over-cap shift and 1
  // redundancy."
  summary: string;
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

// Two shifts are considered "equivalent" for migration purposes if
// they have the same start hour, end hour, and the same work / hazard
// / industrial flags. Cosmetic fields (name, description, break) are
// ignored — the auto-scheduler doesn't read them, so a hand-named
// "Morning" with the same hours is interchangeable with the proposal's
// "Auto · Open 11:00–19:00".
function shiftKey(s: Shift): string {
  const sH = parseHourFloor(s.start);
  const eH = parseHourCeil(s.end);
  const w = s.isWork ? '1' : '0';
  const hz = s.isHazardous ? '1' : '0';
  const ind = s.isIndustrial ? '1' : '0';
  return `${sH}-${eH}-${w}${hz}${ind}`;
}

export function buildOptimizationProposal(
  stations: Station[],
  config: Config,
  currentShifts: Shift[],
): OptimizationProposal {
  // Run generator with an empty library to get the unrestricted
  // proposal. The result `existingIssues` reflects an empty input so
  // it's always empty here — we recompute the issues against the
  // CURRENT library separately (call generator a second time with
  // current shifts to populate them).
  const fromScratch = generateOptimalShifts(stations, config, []);
  const proposedLibrary: Shift[] = fromScratch.generated;

  // Re-run with the current library so we have the issue list for
  // diffing. This is the same call AutoGenerateShiftsModal already
  // makes for the "Fill gaps" tab.
  const currentRun = generateOptimalShifts(stations, config, currentShifts);
  const currentIssues: ExistingIssue[] = currentRun.existingIssues;

  // Bucket current shifts by whether they appear in the proposal.
  // System shifts are excluded from the diff (they're preserved
  // unconditionally on adopt).
  //
  // Matching rule: each proposal SLOT can only be claimed by ONE
  // current shift. If two current shifts match the same proposal slot
  // (e.g. duplicates with identical hours + flags), the first one
  // claims and the rest go into `toDelete` as redundant. Otherwise
  // we'd silently keep both, defeating the optimization goal.
  const currentWorkShifts = currentShifts.filter(s => s.isWork && !isSystemShift(s.code));

  const toKeep: ShiftDiffEntry[] = [];
  const toDelete: ShiftDiffEntry[] = [];
  const toAdd: ShiftDiffEntry[] = [];
  // Counts how many proposal slots remain unclaimed for each key.
  // Decrement on each match so a duplicate current shift doesn't
  // re-claim the same slot.
  const proposalSlotCount = new Map<string, number>();
  for (const ps of proposedLibrary) {
    const k = shiftKey(ps);
    proposalSlotCount.set(k, (proposalSlotCount.get(k) || 0) + 1);
  }

  for (const sh of currentWorkShifts) {
    const k = shiftKey(sh);
    const remaining = proposalSlotCount.get(k) || 0;
    if (remaining > 0) {
      toKeep.push({ shift: sh, reason: 'Already matches the optimal proposal — kept as-is.' });
      proposalSlotCount.set(k, remaining - 1);
    } else {
      const issue = currentIssues.find(i => i.shiftCode === sh.code);
      const reason = issue
        ? issue.message
        : 'Not in the optimal set — its hours are already covered, or another shift in your library claims this slot.';
      toDelete.push({ shift: sh, reason });
    }
  }
  // Remaining slots (after kept shifts claimed) are net-new additions.
  for (const ps of proposedLibrary) {
    const k = shiftKey(ps);
    const remaining = proposalSlotCount.get(k) || 0;
    if (remaining > 0) {
      toAdd.push({
        shift: ps,
        reason: 'New optimal shift — sized to the demand window and within the daily cap.',
      });
      proposalSlotCount.set(k, remaining - 1);
    }
  }

  // Issues fixed = current issues whose flagged shift is in `toDelete`
  // (i.e., the migration removes the offending shift).
  const deletedCodes = new Set(toDelete.map(d => d.shift.code));
  const fixedIssues = currentIssues.filter(i => deletedCodes.has(i.shiftCode));
  const remainingIssues = currentIssues.filter(i => !deletedCodes.has(i.shiftCode));

  // Average duration on each side. Useful headline number for the UI
  // ("your library averages 10.5h, the proposal averages 7.5h").
  const avg = (arr: Shift[]): number => {
    if (arr.length === 0) return 0;
    return arr.reduce((s, sh) => s + sh.durationHrs, 0) / arr.length;
  };
  const currentAvgDuration = avg(currentWorkShifts);
  const proposedAvgDuration = avg(proposedLibrary);

  const fixedOverCap = fixedIssues.filter(i => i.kind === 'over-cap').length;
  const fixedRedundant = fixedIssues.filter(i => i.kind === 'redundant').length;
  const fixedSubsumed = fixedIssues.filter(i => i.kind === 'subsumed').length;

  // Coverage parity — both libraries should reach 100% of demand
  // hours. The proposal's existingCoverage tracks against the empty
  // library it was built from, so we re-compute by checking the
  // current run's coverage at gap=0.
  const coverageEquivalent =
    currentRun.existingCoverage.uncoveredHours === 0
    || currentRun.verdict === 'adequate';

  // Plain-language summary.
  const parts: string[] = [];
  if (toAdd.length > 0 && toDelete.length > 0) {
    parts.push(`Replace ${toDelete.length} shift(s) with ${toAdd.length} optimal shift(s)`);
  } else if (toAdd.length > 0) {
    parts.push(`Add ${toAdd.length} shift(s) to optimize the library`);
  } else if (toDelete.length > 0) {
    parts.push(`Remove ${toDelete.length} surplus shift(s)`);
  } else {
    parts.push('Library already matches the optimal proposal');
  }
  if (fixedOverCap > 0) parts.push(`removes ${fixedOverCap} over-cap shift${fixedOverCap > 1 ? 's' : ''}`);
  if (fixedRedundant > 0) parts.push(`eliminates ${fixedRedundant} redundancy(ies)`);
  if (fixedSubsumed > 0) parts.push(`drops ${fixedSubsumed} subsumed shift${fixedSubsumed > 1 ? 's' : ''}`);
  const summary = parts.join('; ') + '.';

  return {
    proposedLibrary,
    currentWorkShifts,
    toDelete,
    toAdd,
    toKeep,
    fixedIssues,
    remainingIssues,
    delta: {
      shiftCountDelta: proposedLibrary.length - currentWorkShifts.length,
      fixedOverCap,
      fixedRedundant,
      fixedSubsumed,
      currentAvgDuration: Number(currentAvgDuration.toFixed(1)),
      proposedAvgDuration: Number(proposedAvgDuration.toFixed(1)),
      demandWindowCount: fromScratch.demandWindows.length,
      demandHourTotal: fromScratch.existingCoverage.totalDemandHours,
      coverageEquivalent,
    },
    summary,
  };
}
