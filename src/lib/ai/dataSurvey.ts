/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — listAvailableData()
 *
 * Pure function the AI tool layer (and the AIServicesTab overview card)
 * calls to enumerate what data exists in the active workspace and over
 * what windows. It's the AI's "menu" — the model uses the result to
 * propose a sensible default scope ("I see schedules from Jan 2024 to
 * today, leave history through Apr 2026, WFP defaults to 2026") in the
 * scope-first conversation pattern.
 *
 * Strictly read-only over CompanyData. No I/O, no side effects, no
 * dependencies on auth or storage — easy to unit-test and easy to call
 * from anywhere in the renderer.
 */

import type { CompanyData, Employee, LeaveRange, StationGroup } from '../../types';
import type { StationProfile } from './profiles';

export interface MonthKey {
  year: number;
  month: number; // 1..12
}

/**
 * Compact station entry for the survey. Carries enough context for the AI
 * to reason about staffing structure without calling getStations() —
 * critically, includes the (often-Arabic) name + group + profiled flag
 * so the model can group similar stations into one interview question
 * instead of asking about each one individually.
 */
export interface SurveyStation {
  id: string;
  name: string;
  groupId?: string;
  groupName?: string;
  /** True if a profile is on file with confidence >= 40. */
  profiled: boolean;
  normalMinHC: number;
  peakMinHC: number;
}

export interface SurveyStationGroup {
  groupId: string | null;
  groupName: string;
  count: number;
  profiledCount: number;
  /** Station ids in this group — lets the AI fire a single chip block
   *  that covers an entire group instead of one per station. */
  ids: string[];
}

export interface DataSurvey {
  stations: {
    count: number;
    profiledCount: number;
    /** Per-station entries — the AI's primary handle on the workplace
     *  structure. Names may be in Arabic; preserve verbatim. */
    list: SurveyStation[];
    /** Group rollups — sized 1..N depending on how the user has
     *  organized their stations. Ungrouped stations land under
     *  groupId=null / groupName='Ungrouped'. */
    byGroup: SurveyStationGroup[];
  };
  employees: { count: number; activeContractCount: number };
  shifts: { count: number; workShiftCount: number };
  schedules: {
    earliest: MonthKey | null;
    latest: MonthKey | null;
    /** Distinct YYYY-MM keys present in CompanyData.allSchedules. */
    monthCount: number;
  };
  payroll: {
    /** Same window as schedules — payroll is computed, not separately stored. */
    earliest: MonthKey | null;
    latest: MonthKey | null;
    monthCount: number;
  };
  leave: {
    earliest: string | null; // YYYY-MM-DD
    latest: string | null;   // YYYY-MM-DD
    /** Total range entries across all employees (multi-range + legacy single). */
    totalRanges: number;
  };
  holidays: {
    earliest: string | null;
    latest: string | null;
    count: number;
  };
  wfp: {
    /** WFP forecasts off live employees + holidays for any chosen year.
     *  No stored history; the "default" year is whatever the user's
     *  config is currently set to. */
    defaultYear: number;
  };
  config: {
    /** Surfaced for the AI so it can mention the active company by name. */
    companyName: string;
    /** Iraqi Labor Law caps the AI should avoid citing wrong values for. */
    standardWeeklyHrsCap: number;
    standardDailyHrsCap: number;
  };
}

// Schedule keys are `scheduler_schedule_${year}_${month}` where month is
// 1-based and not zero-padded — same format used by autoScheduler.ts,
// compliance.ts (prev/next month helpers), demandHistory.ts and audit.ts.
const SCHEDULE_KEY_RE = /^scheduler_schedule_(\d{4})_(\d{1,2})$/;

function monthKeyFromString(key: string): MonthKey | null {
  const m = SCHEDULE_KEY_RE.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || mo < 1 || mo > 12) return null;
  return { year: y, month: mo };
}

/** Build the canonical schedule key from a (year, month) pair. */
export function scheduleKeyFor(year: number, month: number): string {
  return `scheduler_schedule_${year}_${month}`;
}

function compareMonthKeys(a: MonthKey, b: MonthKey): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

function countEmployeeLeaveRanges(employees: Employee[]): {
  earliest: string | null; latest: string | null; totalRanges: number;
} {
  let earliest: string | null = null;
  let latest: string | null = null;
  let totalRanges = 0;
  const consider = (start?: string, end?: string) => {
    if (start) {
      totalRanges++;
      if (!earliest || start < earliest) earliest = start;
      const e = end || start;
      if (!latest || e > latest) latest = e;
    }
  };
  for (const emp of employees) {
    // Multi-range field — preferred since v1.7.
    const ranges: LeaveRange[] = emp.leaveRanges ?? [];
    for (const r of ranges) consider(r.start, r.end);
    // Legacy single-range fallbacks (annual/sick/maternity).
    consider(emp.annualLeaveStart, emp.annualLeaveEnd);
    consider(emp.sickLeaveStart, emp.sickLeaveEnd);
    consider(emp.maternityLeaveStart, emp.maternityLeaveEnd);
  }
  return { earliest, latest, totalRanges };
}

const PROFILE_CONFIDENCE_THRESHOLD = 40;

/**
 * Survey the workspace. Pass the full profile map (not just a count) so
 * the survey can produce a per-station `profiled` flag and group rollups
 * the AI uses to batch interview questions across similar stations
 * instead of asking about each one individually.
 *
 * Backward-compat: a number argument still works (treated as
 * `profiledCount` for the aggregate field; per-station flags default to
 * false). Internal callers should pass the full map.
 */
export function listAvailableData(
  data: CompanyData,
  profilesOrCount: Record<string, StationProfile> | number = {},
): DataSurvey {
  const profiles: Record<string, StationProfile> = typeof profilesOrCount === 'object'
    ? profilesOrCount
    : {};
  const fallbackProfiledCount = typeof profilesOrCount === 'number' ? profilesOrCount : null;

  // ── Stations / employees / shifts ───────────────────────────────────
  const stationCount = data.stations.length;
  const employeeCount = data.employees.length;
  const activeContractCount = data.employees.filter(
    (e) => (e.contractType || '').toLowerCase() !== 'terminated',
  ).length;
  const shiftCount = data.shifts.length;
  // `isWork` separates real work shifts from leave codes (OFF, AL, SL, ...).
  const workShiftCount = data.shifts.filter((s) => s.isWork).length;

  // ── Per-station list + group rollup ────────────────────────────────
  // Build a name lookup so SurveyStation.groupName can be filled from
  // the station's groupId. Stations without a groupId fall under a
  // synthetic "Ungrouped" bucket so the AI can talk about them.
  const groupById = new Map<string, StationGroup>();
  for (const g of data.stationGroups ?? []) groupById.set(g.id, g);

  const stationList: SurveyStation[] = data.stations.map((s) => {
    const profile = profiles[s.id];
    return {
      id: s.id,
      name: s.name,
      groupId: s.groupId,
      groupName: s.groupId ? groupById.get(s.groupId)?.name : undefined,
      profiled: !!(profile && profile.confidence >= PROFILE_CONFIDENCE_THRESHOLD),
      normalMinHC: s.normalMinHC,
      peakMinHC: s.peakMinHC,
    };
  });

  const groupBuckets = new Map<string, SurveyStationGroup>();
  const UNGROUPED_KEY = '__ungrouped__';
  for (const st of stationList) {
    const key = st.groupId ?? UNGROUPED_KEY;
    let bucket = groupBuckets.get(key);
    if (!bucket) {
      bucket = {
        groupId: st.groupId ?? null,
        groupName: st.groupName ?? 'Ungrouped',
        count: 0,
        profiledCount: 0,
        ids: [],
      };
      groupBuckets.set(key, bucket);
    }
    bucket.count++;
    bucket.ids.push(st.id);
    if (st.profiled) bucket.profiledCount++;
  }
  // Sort bigger groups first — the AI will mention these first.
  const byGroup = Array.from(groupBuckets.values()).sort((a, b) => b.count - a.count);

  // Use the per-station profiled flag when we have the full map; fall
  // back to the legacy count argument when callers only pass a number.
  const profiledStationCount = fallbackProfiledCount !== null
    ? fallbackProfiledCount
    : stationList.filter((s) => s.profiled).length;

  // ── Schedules ──────────────────────────────────────────────────────
  const scheduleKeys = Object.keys(data.allSchedules ?? {});
  const monthKeys = scheduleKeys
    .map(monthKeyFromString)
    .filter((k): k is MonthKey => k !== null);
  monthKeys.sort(compareMonthKeys);
  const earliestSched = monthKeys[0] ?? null;
  const latestSched = monthKeys[monthKeys.length - 1] ?? null;

  // ── Leave ──────────────────────────────────────────────────────────
  const leaveSummary = countEmployeeLeaveRanges(data.employees);

  // ── Holidays ───────────────────────────────────────────────────────
  const holidayDates = (data.holidays ?? [])
    .map((h) => h.date)
    .filter((d) => typeof d === 'string' && d.length >= 10)
    .sort();
  const earliestHol = holidayDates[0] ?? null;
  const latestHol = holidayDates[holidayDates.length - 1] ?? null;

  // ── WFP ────────────────────────────────────────────────────────────
  // No stored WFP — it's computed at view time. Default to the active
  // config year so the AI's first scope question can prefill sensibly.
  const defaultYear = data.config.year ?? new Date().getFullYear();

  return {
    stations: {
      count: stationCount,
      profiledCount: profiledStationCount,
      list: stationList,
      byGroup,
    },
    employees: { count: employeeCount, activeContractCount },
    shifts: { count: shiftCount, workShiftCount },
    schedules: {
      earliest: earliestSched,
      latest: latestSched,
      monthCount: monthKeys.length,
    },
    payroll: {
      earliest: earliestSched,
      latest: latestSched,
      monthCount: monthKeys.length,
    },
    leave: leaveSummary,
    holidays: {
      earliest: earliestHol,
      latest: latestHol,
      count: holidayDates.length,
    },
    wfp: { defaultYear },
    config: {
      companyName: data.config.company,
      standardWeeklyHrsCap: data.config.standardWeeklyHrsCap,
      standardDailyHrsCap: data.config.standardDailyHrsCap,
    },
  };
}

/**
 * Suggest a sensible default AI scope from a survey. The chat panel's
 * first message proposes this as a starting point that the user can
 * adjust before any tool calls fire.
 */
export function suggestDefaultScope(survey: DataSurvey): {
  schedules: { fromYear: number; fromMonth: number; toYear: number; toMonth: number } | null;
  payroll: { fromYear: number; fromMonth: number; toYear: number; toMonth: number } | null;
  leaveAsOf: string;
  wfpYear: number;
} {
  // Default schedule window: the most recent 3 months we have data for.
  let schedules:
    | { fromYear: number; fromMonth: number; toYear: number; toMonth: number }
    | null = null;
  if (survey.schedules.latest) {
    const to = survey.schedules.latest;
    // Walk back two months for a 3-month window, but never before earliest.
    const earliest = survey.schedules.earliest ?? to;
    let yr = to.year;
    let mo = to.month - 2;
    while (mo < 1) { mo += 12; yr -= 1; }
    if (yr < earliest.year || (yr === earliest.year && mo < earliest.month)) {
      yr = earliest.year;
      mo = earliest.month;
    }
    schedules = { fromYear: yr, fromMonth: mo, toYear: to.year, toMonth: to.month };
  }
  // Payroll mirrors schedules in this app.
  const payroll = schedules ? { ...schedules } : null;
  const leaveAsOf = new Date().toISOString().slice(0, 10);
  const wfpYear = survey.wfp.defaultYear;
  return { schedules, payroll, leaveAsOf, wfpYear };
}
