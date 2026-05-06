/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.19.0 — Coverage Scenario Simulator (Workforce Planning).
 *
 * Translates a station's hourly demand profile + the existing shift
 * library into a NARRATIVE walkthrough of how a single peak day would
 * unfold:
 *
 *   "Cashier Counter 1 (open 11:00–23:00, peak min 2 PAX):
 *      • 11:00 — Morning shift (M, 11:00–19:00) starts → 2 employees on floor
 *      • 15:00 — Closing shift (C, 15:00–23:00) overlaps  → 4 employees on floor (peak window)
 *      • 19:00 — Morning shift ends                       → 2 employees on floor
 *      • 23:00 — Closing shift ends, station closes
 *    To run this every day with weekly rest + 8% comp/leave buffer
 *    you need ≈ 4 employees."
 *
 * The output is structured (not pre-rendered text) so the UI can render
 * it as a timeline component instead of a paragraph.
 *
 * The roster-required calculation is the bridge between WFP's headcount
 * recommendations and the daily timeline:
 *   roster needed per station = peak_concurrent_HC × days_open_per_week
 *                                  / (workdays_per_employee_per_week × adjustment_for_leave)
 *   workdays_per_employee_per_week = 7 - rest_days_per_week        (typically 7-1=6)
 *   adjustment_for_leave = 1 - (annual_leave_days / 365) - sick_buffer   (typically 0.92)
 *
 * Why "info" not "violation": this is a planning tool surfacing the
 * mathematical headcount required to maintain coverage given Art. 71
 * weekly rest. The supervisor decides whether to honor it; the platform
 * only reports.
 */

import type { Employee, Shift, Station, Config, StationGroup } from '../types';
import { isSystemShift } from './systemShifts';
import { getRequiredHC } from './stationDemand';

// One step in the per-station daily timeline. Each step represents an
// hour-of-day where coverage CHANGED (a shift started, a shift ended,
// or both). Steps are emitted in chronological order, starting at the
// station's opening hour and ending at its closing hour.
export interface CoverageStep {
  // Hour-of-day this step occurs at (0..24, 24 = end-of-day).
  hour: number;
  // 'open' = station opens / first shift starts.
  // 'shift-start' = an additional shift overlaps.
  // 'shift-end' = a shift ends.
  // 'gap' = the station has demand at this hour but no shift covers it.
  // 'close' = station closes.
  kind: 'open' | 'shift-start' | 'shift-end' | 'gap' | 'close';
  // Shift codes that started AT this hour (kind = open / shift-start).
  startedShifts: string[];
  // Shift codes that ended AT this hour (kind = shift-end / close).
  endedShifts: string[];
  // Shift codes ON THE FLOOR after this step (i.e. started but not yet
  // ended). Used to compute "concurrent shifts on the floor".
  shiftsOnFloor: string[];
  // Required HC at this hour (the station's peak min HC for the relevant
  // hour, sourced via getRequiredHC).
  requiredHC: number;
  // Concurrent shift TYPES on the floor × the recommended HC the
  // generator surfaced. NOTE: this is a logical "if you staff each
  // shift type to its recommended HC, this many people are present"
  // figure — actual scheduling is the auto-scheduler's job.
  concurrentEmployeesIfStaffedToHC: number;
}

export interface StationScenario {
  stationId: string;
  stationName: string;
  // Station's open window (hours-of-day). For overnight stations the
  // closingHour is < openingHour; UI handles the wrap.
  openingHour: number;
  closingHour: number;
  // Shifts that touch this station's open window. Filtered down to
  // work shifts (excludes OFF/AL/SL/MAT/PH/CP). Each entry is the
  // shift's code + name + parsed start/end hours.
  coveringShifts: Array<{ code: string; name: string; startHour: number; endHour: number }>;
  // Step-by-step timeline of the day. See CoverageStep.
  timeline: CoverageStep[];
  // The single highest concurrent-HC moment in the day.
  peakConcurrentHC: number;
  // Hours where demand exists but no shift covers (kind === 'gap'
  // entries' total span).
  uncoveredHours: number;
  // Hours where required HC > 0 across the day.
  totalDemandHours: number;
  // Roster-required calculation. See module docstring for the formula.
  rosterRequired: {
    perDayPeakHC: number;       // peak headcount needed at any one hour
    daysOpenPerWeek: number;    // 1..7
    workDaysPerEmployeePerWeek: number; // 7 - restDaysPerWeek
    leaveBufferPct: number;     // 0..1, e.g. 0.08 → 8% buffer
    rawRoster: number;          // peak × days / workdays (before buffer)
    bufferedRoster: number;     // rawRoster / (1 - leaveBufferPct), ceiled
    explanation: string;        // human-readable justification
  };
  // Group membership (if any) — surfaces in the UI so the per-station
  // walkthrough rolls up into the supervisor's mental "Cashier counters"
  // bucket without needing a separate group-level scenario.
  groupId?: string;
  groupName?: string;
  groupColor?: string;
}

export interface ScenarioBuildArgs {
  stations: Station[];
  shifts: Shift[];
  config: Config;
  // Whether to compute the scenario for a peak day (true) or normal day
  // (false). Defaults to peak — that's the worst-case the supervisor
  // plans for; normal days are easier to cover.
  isPeakDay?: boolean;
  // Annual leave days per FTE per year (Iraqi Labor Law Art. 43 minimum
  // is 21 days). Defaults to 21 + small sick buffer.
  annualLeaveDaysPerEmployee?: number;
  // Estimated sick + comp days as a fraction of working days. Default 5%.
  sickAndCompBufferPct?: number;
  // Days per week the venue is open. Default 7 (entertainment venues
  // usually open every day; the user can override for office hours).
  daysOpenPerWeek?: number;
  // Rest days per employee per week (Art. 71 minimum is 1). Default 1.
  restDaysPerEmployeePerWeek?: number;
  stationGroups?: StationGroup[];
  // Optional: filter to a subset of stations. Used by the WFP UI when
  // drilling into a single group.
  stationIds?: string[];
}

// Parse "HH:mm" into an hour-of-day in [0, 24]. Mirrors the helpers in
// shiftCoverage.ts but kept local so this module has no dependency on
// the generator module (clean import graph).
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

// Returns the shifts whose hour-range overlaps the station's open
// window. Cross-midnight shifts (close <= open) are SPLIT into two
// virtual ranges — the segment before midnight and the segment after.
// We surface only the segment that overlaps the station's open window.
function shiftsCoveringStation(station: Station, shifts: Shift[]): StationScenario['coveringShifts'] {
  const stOpen = parseHourFloor(station.openingTime);
  const stClose = parseHourCeil(station.closingTime);
  if (!Number.isFinite(stOpen) || !Number.isFinite(stClose)) return [];

  const out: StationScenario['coveringShifts'] = [];
  for (const sh of shifts) {
    if (!sh.isWork || isSystemShift(sh.code)) continue;
    const sStart = parseHourFloor(sh.start);
    const sEnd = parseHourCeil(sh.end);
    if (!Number.isFinite(sStart) || !Number.isFinite(sEnd)) continue;
    if (sStart === sEnd) continue;

    // Same-day shift: overlap test is straightforward.
    if (sEnd > sStart) {
      if (rangesOverlap(sStart, sEnd, stOpen, stClose)) {
        out.push({ code: sh.code, name: sh.name, startHour: sStart, endHour: sEnd });
      }
    } else {
      // Cross-midnight: split into [sStart, 24] + [0, sEnd]. Either
      // segment can overlap the station's open window. Add at most one
      // entry — using the segment that overlaps (preserve the original
      // shift hours for display).
      if (rangesOverlap(sStart, 24, stOpen, stClose) || rangesOverlap(0, sEnd, stOpen, stClose)) {
        out.push({ code: sh.code, name: sh.name, startHour: sStart, endHour: sEnd });
      }
    }
  }
  // Sort by start hour for a left-to-right timeline.
  out.sort((a, b) => a.startHour - b.startHour);
  return out;
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

// Build the per-station scenario.
function buildOneScenario(
  station: Station,
  args: Required<Pick<ScenarioBuildArgs, 'shifts' | 'config' | 'isPeakDay' | 'annualLeaveDaysPerEmployee' | 'sickAndCompBufferPct' | 'daysOpenPerWeek' | 'restDaysPerEmployeePerWeek'>>,
  groupsById: Map<string, StationGroup>,
): StationScenario {
  const stOpen = parseHourFloor(station.openingTime);
  const stClose = parseHourCeil(station.closingTime);
  const coveringShifts = shiftsCoveringStation(station, args.shifts);

  // Walk hour-by-hour from open to close. At each hour, determine which
  // shifts STARTED here, which ENDED here, and the resulting "on floor"
  // set. We treat cross-midnight as same-day for the timeline (the
  // station rarely spans midnight in our user's domain) — refinement
  // for true overnight venues left for v5.20+.
  const timeline: CoverageStep[] = [];
  const onFloor = new Set<string>();
  const totalSpan = stClose > stOpen ? stClose - stOpen : (24 - stOpen) + stClose;
  let totalDemandHours = 0;
  let uncoveredHours = 0;
  let peakConcurrentHC = 0;

  for (let i = 0; i <= totalSpan; i++) {
    const hour = ((stOpen + i) % 24);
    const startedShifts: string[] = [];
    const endedShifts: string[] = [];

    for (const sh of coveringShifts) {
      if (sh.startHour === hour) {
        onFloor.add(sh.code);
        startedShifts.push(sh.code);
      }
    }
    // Process ends AFTER starts so a same-hour boundary keeps the
    // shift on the floor for that hour (matches "shift covers hour h
    // if startHour ≤ h < endHour" semantics).
    for (const sh of coveringShifts) {
      if (sh.endHour === hour && i > 0) {
        onFloor.delete(sh.code);
        endedShifts.push(sh.code);
      }
    }

    // requiredHC = the station's required HC at this hour (from hourly
    // profile or flat fallback). Last hour (closing) = no demand —
    // skip it.
    const isLast = (i === totalSpan);
    const requiredHC = isLast ? 0 : getRequiredHC(station, hour, args.isPeakDay);
    if (requiredHC > 0) totalDemandHours++;

    // "Concurrent if staffed to required HC": if every shift on the
    // floor right now is staffed at the station's required HC, this is
    // how many bodies are present. A simple multiplication — not the
    // shift-generator's recommendedHC, since each shift's HC is set by
    // the supervisor downstream. For the timeline narrative we use the
    // station's requiredHC as the per-shift target.
    const concurrent = onFloor.size * Math.max(1, requiredHC);
    peakConcurrentHC = Math.max(peakConcurrentHC, concurrent);

    // Determine kind of step.
    let kind: CoverageStep['kind'];
    if (i === 0) kind = 'open';
    else if (isLast) kind = 'close';
    else if (requiredHC > 0 && onFloor.size === 0) {
      kind = 'gap';
      uncoveredHours++;
    }
    else if (startedShifts.length > 0) kind = 'shift-start';
    else if (endedShifts.length > 0) kind = 'shift-end';
    else continue;     // Hour passed with no change in coverage state.

    timeline.push({
      hour,
      kind,
      startedShifts,
      endedShifts,
      shiftsOnFloor: Array.from(onFloor),
      requiredHC,
      concurrentEmployeesIfStaffedToHC: concurrent,
    });
  }

  // Roster-required formula. See module docstring.
  const rawRoster = peakConcurrentHC * args.daysOpenPerWeek
    / Math.max(1, 7 - args.restDaysPerEmployeePerWeek);
  const leaveBufferPct = Math.min(0.5,
    (args.annualLeaveDaysPerEmployee / 365) + args.sickAndCompBufferPct);
  const bufferedRoster = Math.ceil(rawRoster / Math.max(0.5, 1 - leaveBufferPct));
  const explanation =
    `${peakConcurrentHC} concurrent staff × ${args.daysOpenPerWeek} days/week ÷ ${7 - args.restDaysPerEmployeePerWeek} workdays/employee = ${rawRoster.toFixed(1)} raw FTE. With a ${Math.round(leaveBufferPct * 100)}% buffer for annual leave + sick/comp, you need ≈ ${bufferedRoster} employees on this station's roster to keep coverage continuous through every week of the year.`;

  const group = station.groupId ? groupsById.get(station.groupId) : undefined;

  return {
    stationId: station.id,
    stationName: station.name,
    openingHour: stOpen,
    closingHour: stClose,
    coveringShifts,
    timeline,
    peakConcurrentHC,
    uncoveredHours,
    totalDemandHours,
    rosterRequired: {
      perDayPeakHC: peakConcurrentHC,
      daysOpenPerWeek: args.daysOpenPerWeek,
      workDaysPerEmployeePerWeek: 7 - args.restDaysPerEmployeePerWeek,
      leaveBufferPct,
      rawRoster,
      bufferedRoster,
      explanation,
    },
    groupId: group?.id,
    groupName: group?.name,
    groupColor: group?.color,
  };
}

export function buildCoverageScenarios(args: ScenarioBuildArgs): StationScenario[] {
  const required: Required<Pick<ScenarioBuildArgs, 'shifts' | 'config' | 'isPeakDay' | 'annualLeaveDaysPerEmployee' | 'sickAndCompBufferPct' | 'daysOpenPerWeek' | 'restDaysPerEmployeePerWeek'>> = {
    shifts: args.shifts,
    config: args.config,
    isPeakDay: args.isPeakDay ?? true,
    annualLeaveDaysPerEmployee: args.annualLeaveDaysPerEmployee ?? 21,
    sickAndCompBufferPct: args.sickAndCompBufferPct ?? 0.05,
    daysOpenPerWeek: args.daysOpenPerWeek ?? 7,
    restDaysPerEmployeePerWeek: args.restDaysPerEmployeePerWeek ?? 1,
  };
  const groupsById = new Map<string, StationGroup>();
  if (args.stationGroups) {
    for (const g of args.stationGroups) groupsById.set(g.id, g);
  }
  const filterIds = args.stationIds ? new Set(args.stationIds) : null;
  return args.stations
    .filter(st => filterIds === null || filterIds.has(st.id))
    .filter(st => Number.isFinite(parseHourFloor(st.openingTime)) && Number.isFinite(parseHourCeil(st.closingTime)))
    .map(st => buildOneScenario(st, required, groupsById))
    .filter(s => s.totalDemandHours > 0 || s.coveringShifts.length > 0);
}

// Top-level summary across every scenario. Used by the UI for the
// header card ("Across 12 stations: 3 have coverage gaps; total roster
// required is 47 employees vs current eligible of 38").
export interface ScenarioSummary {
  stationCount: number;
  stationsWithGaps: number;
  totalUncoveredHours: number;
  totalRosterRequired: number;
  // The single largest gap (in hours) across all scenarios — used to
  // surface the "biggest single coverage hole" callout.
  largestGap: { stationName: string; hours: number } | null;
}

export function summarizeScenarios(scenarios: StationScenario[], _employees: Employee[]): ScenarioSummary {
  let stationsWithGaps = 0;
  let totalUncoveredHours = 0;
  let totalRosterRequired = 0;
  let largestGap: ScenarioSummary['largestGap'] = null;

  for (const sc of scenarios) {
    if (sc.uncoveredHours > 0) {
      stationsWithGaps++;
      totalUncoveredHours += sc.uncoveredHours;
      if (!largestGap || sc.uncoveredHours > largestGap.hours) {
        largestGap = { stationName: sc.stationName, hours: sc.uncoveredHours };
      }
    }
    totalRosterRequired += sc.rosterRequired.bufferedRoster;
  }

  return {
    stationCount: scenarios.length,
    stationsWithGaps,
    totalUncoveredHours,
    totalRosterRequired,
    largestGap,
  };
}
