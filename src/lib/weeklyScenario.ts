/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.19.0 — Weekly Rotation Simulator (Workforce Planning).
 *
 * Builds a 7-day rotation showing WHICH employees would rotate through
 * each shift on each day, given the existing roster + shift library +
 * station eligibility. Bridges the abstract single-day scenario (already
 * built in coverageScenario.ts) to the operational reality of "who
 * actually clocks in on Tuesday morning?"
 *
 * Why this exists: the WFP recommendation says "you need 4 cashiers".
 * The single-day scenario shows where they go on a peak day. But
 * neither tells the supervisor whether the EXISTING 4 cashiers can
 * actually rotate to keep coverage up while honoring weekly rest
 * (Art. 71). This module simulates that rotation explicitly.
 *
 * Algorithm (deterministic + explainable):
 *   1. For each station, identify the eligible employees (direct or
 *      via group).
 *   2. For each (day, shift) slot the station needs covered, pick the
 *      eligible employee with the LEAST hours-so-far in the simulation
 *      who isn't already booked, hasn't violated a fixed rest day,
 *      hasn't broken consecutive-days, and is under the weekly cap.
 *   3. If no candidate exists, mark the slot as a gap.
 *   4. Insert OFF days greedily — once an employee is booked 6 days
 *      in a row, force their 7th to OFF.
 *
 * The output is a structured weekly grid (station → day → list of
 * (shiftCode, empId) pairs) plus a summary of gap days and the
 * implied roster size required to cover the week.
 */

import type { Employee, Shift, Station, StationGroup, Config } from '../types';
import { isSystemShift } from './systemShifts';
import { getRequiredHC } from './stationDemand';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = typeof DAY_KEYS[number];

export interface WeeklySlot {
  shiftCode: string;
  shiftName: string;
  startHour: number;
  endHour: number;
  // Assigned employee (or null if no one could be found).
  empId: string | null;
  empName: string | null;
  // Reason for empty assignment, if any.
  gapReason?: 'no-eligible' | 'all-on-rest' | 'all-on-leave' | 'all-at-cap';
}

export interface WeeklyDay {
  dayIndex: number;       // 0..6 (Sun..Sat)
  dayKey: DayKey;
  slots: WeeklySlot[];
  isPeak: boolean;
}

export interface WeeklyStationRotation {
  stationId: string;
  stationName: string;
  groupId?: string;
  groupName?: string;
  days: WeeklyDay[];
  // The unique set of employees who appeared in the rotation. The
  // count of this set is the EFFECTIVE rotation size needed for the
  // station's week. Compare against the WFP recommendation to spot
  // mismatches.
  rotationEmpIds: string[];
  // Per-day-per-employee: who's resting (in rotationEmpIds but not
  // assigned to any slot today). Lets the UI render "Sun: A working,
  // B resting" without recomputing from the slots array.
  restByDay: Record<DayKey, string[]>;
  // Day-by-day employee handoff narrative. Each entry is a one-line
  // story like "Sun M=Alice → C=Bob → handoff at 15:00".
  narrative: string[];
  // True if any slot in the rotation was unfillable (a real coverage
  // hole given the current roster). Drives the rose-tinted callout
  // in the UI.
  hasGap: boolean;
  // Rotation efficiency: total slot-hours / total employee-hours-on-roster.
  // 1.0 = perfect (every employee works close to cap). <0.7 = the
  // rotation has a lot of slack that could absorb attrition or
  // cross-coverage of another station.
  rotationEfficiency: number;
}

export interface WeeklyRotationResult {
  weeks: WeeklyStationRotation[];
  // Summary: how many stations have gaps, total gap-slot count, etc.
  totalSlots: number;
  filledSlots: number;
  gapSlots: number;
  // Total roster across all stations (counted per station — same employee
  // may appear in multiple stations' rotations because cross-eligibility).
  totalRotationSize: number;
  // Aggregate efficiency.
  averageEfficiency: number;
}

export interface WeeklyArgs {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  stationGroups?: StationGroup[];
  config: Config;
  // 0..6, the day index considered "first day of the week" for the
  // rotation (defaults to 6 = Saturday for Iraqi venues).
  weekStart?: number;
  // Predicate used to decide whether to apply peak demand for a given
  // day-of-week (1..7). Pre-bound by the caller; defaults to
  // `config.peakDays` membership.
  isPeakDow?: (dow: number) => boolean;
  // Filter to specific stations (used when drilling into a group).
  stationIds?: string[];
}

function defaultIsPeakDow(config: Config, dow: number): boolean {
  return (config.peakDays || []).includes(dow);
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

// Returns the ordered set of (shiftCode, hour-range, requiredHC) tuples
// that need to be staffed for the station on the given day type. We
// pick shifts whose hour range overlaps the station's open window,
// then for each hour the station has demand we pick the LONGEST shift
// that brackets that hour. Resulting slot list is the (deduplicated)
// minimum set of shift slots needed to keep the floor covered.
function slotsForStationDay(
  station: Station, shifts: Shift[], isPeak: boolean,
): Array<{ shiftCode: string; shiftName: string; startHour: number; endHour: number; requiredHC: number }> {
  const stOpen = parseHourFloor(station.openingTime);
  const stClose = parseHourCeil(station.closingTime);
  if (!Number.isFinite(stOpen) || !Number.isFinite(stClose) || stClose <= stOpen) return [];

  const workShifts = shifts
    .filter(s => s.isWork && !isSystemShift(s.code))
    .map(s => ({
      shift: s,
      startHour: parseHourFloor(s.start),
      endHour: parseHourCeil(s.end),
    }))
    .filter(x => Number.isFinite(x.startHour) && Number.isFinite(x.endHour) && x.endHour > x.startHour)
    .sort((a, b) => (b.endHour - b.startHour) - (a.endHour - a.startHour));

  // Walk hours; for each demand hour, pick the longest shift covering
  // it that we haven't already added.
  const picked = new Map<string, { shiftCode: string; shiftName: string; startHour: number; endHour: number; requiredHC: number }>();
  for (let h = stOpen; h < stClose && h < 24; h++) {
    const need = getRequiredHC(station, h, isPeak);
    if (need <= 0) continue;
    let assigned = false;
    for (const { shift, startHour, endHour } of workShifts) {
      if (h < startHour || h >= endHour) continue;
      const key = shift.code;
      if (!picked.has(key)) {
        picked.set(key, {
          shiftCode: shift.code,
          shiftName: shift.name,
          startHour, endHour,
          requiredHC: need,
        });
      } else {
        // Update requiredHC to the max across the hours this shift
        // brackets — a station that needs 1 PAX 11–15 and 3 PAX 19–22
        // staffs the closer shift to 3, not 1.
        const existing = picked.get(key)!;
        existing.requiredHC = Math.max(existing.requiredHC, need);
      }
      assigned = true;
      break;
    }
    void assigned;
  }
  return Array.from(picked.values()).sort((a, b) => a.startHour - b.startHour);
}

function eligibleEmpsForStation(emps: Employee[], station: Station): Employee[] {
  const driver = (e: Employee) => e.category === 'Driver';
  return emps.filter(e => {
    if (driver(e)) return !!station.requiredRoles?.includes('Driver');
    if (station.requiredRoles?.includes('Driver')) return false;
    const hasAny = (e.eligibleStations?.length ?? 0) > 0 || (e.eligibleGroups?.length ?? 0) > 0;
    if (hasAny) {
      const directOk = e.eligibleStations?.includes(station.id) ?? false;
      const groupOk = !!station.groupId && (e.eligibleGroups?.includes(station.groupId) ?? false);
      if (!directOk && !groupOk) return false;
    }
    if (station.requiredRoles?.length && !station.requiredRoles.some(r => r === e.role || r === 'Standard')) return false;
    return true;
  });
}

export function buildWeeklyRotation(args: WeeklyArgs): WeeklyRotationResult {
  const { employees, shifts, stations, stationGroups = [], config } = args;
  const weekStart = args.weekStart ?? 6; // Saturday (1=Sun, 7=Sat)
  const isPeakDow = args.isPeakDow || ((dow: number) => defaultIsPeakDow(config, dow));
  const standardWeeklyCap = config.standardWeeklyHrsCap || 48;
  const driverWeeklyCap = config.driverWeeklyHrsCap || 56;
  const maxConsec = config.maxConsecWorkDays || 6;
  const driverMaxConsec = config.driverMaxConsecWorkDays || maxConsec;
  const groupsById = new Map(stationGroups.map(g => [g.id, g]));

  const filterIds = args.stationIds ? new Set(args.stationIds) : null;
  const targetStations = stations.filter(st => filterIds === null || filterIds.has(st.id));

  const weeks: WeeklyStationRotation[] = [];
  let totalSlots = 0;
  let filledSlots = 0;
  let gapSlots = 0;
  let totalRotation = 0;
  let efficiencySum = 0;

  for (const station of targetStations) {
    // Per-employee weekly tracking, scoped to this station's rotation.
    // (An employee cross-eligible for multiple stations is tracked
    // separately per station — that's intentional, the weekly
    // rotation simulator answers "what does THIS station's week look
    // like?" rather than the multi-station fleet view.)
    const eligible = eligibleEmpsForStation(employees, station);
    const hoursThisWeek = new Map<string, number>(eligible.map(e => [e.empId, 0]));
    const consecCount = new Map<string, number>(eligible.map(e => [e.empId, 0]));
    const empAssignedToday = new Set<string>();

    const days: WeeklyDay[] = [];
    const restByDay: Record<DayKey, string[]> = {
      sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [],
    };
    const narrative: string[] = [];
    const allRotationEmpIds = new Set<string>();
    let stationHasGap = false;

    for (let i = 0; i < 7; i++) {
      const dowIndex = (weekStart - 1 + i) % 7; // 0=Sun..6=Sat (date-fns convention)
      const dow = dowIndex + 1; // 1=Sun..7=Sat (config.peakDays convention)
      const peak = isPeakDow(dow);
      const slotDefs = slotsForStationDay(station, shifts, peak);

      // For consecutive-day tracking, decide who's working this morning
      // BEFORE we start picking; everyone who didn't work yesterday gets
      // their consec reset.
      empAssignedToday.clear();

      const slots: WeeklySlot[] = [];
      // Sort slot defs by start hour so handoffs read naturally.
      for (const def of slotDefs) {
        for (let n = 0; n < def.requiredHC; n++) {
          totalSlots++;
          // Candidate selection.
          const candidates = eligible
            .filter(e => !empAssignedToday.has(e.empId))
            .filter(e => {
              if (e.fixedRestDay && e.fixedRestDay !== 0 && e.fixedRestDay === dow) return false;
              const driver = e.category === 'Driver';
              const cap = driver ? driverWeeklyCap : standardWeeklyCap;
              const consecCap = driver ? driverMaxConsec : maxConsec;
              const wHrs = (hoursThisWeek.get(e.empId) || 0);
              const dur = def.endHour - def.startHour;
              if (wHrs + dur > cap) return false;
              if ((consecCount.get(e.empId) || 0) >= consecCap) return false;
              return true;
            })
            .sort((a, b) => (hoursThisWeek.get(a.empId) || 0) - (hoursThisWeek.get(b.empId) || 0));

          const chosen = candidates[0] || null;
          if (!chosen) {
            stationHasGap = true;
            gapSlots++;
            slots.push({
              shiftCode: def.shiftCode,
              shiftName: def.shiftName,
              startHour: def.startHour,
              endHour: def.endHour,
              empId: null,
              empName: null,
              gapReason: eligible.length === 0 ? 'no-eligible' : 'all-at-cap',
            });
            continue;
          }
          empAssignedToday.add(chosen.empId);
          allRotationEmpIds.add(chosen.empId);
          const dur = def.endHour - def.startHour;
          hoursThisWeek.set(chosen.empId, (hoursThisWeek.get(chosen.empId) || 0) + dur);
          // Note: consec is updated at end of day after we determine
          // who actually worked.
          filledSlots++;
          slots.push({
            shiftCode: def.shiftCode,
            shiftName: def.shiftName,
            startHour: def.startHour,
            endHour: def.endHour,
            empId: chosen.empId,
            empName: chosen.name,
          });
        }
      }

      // Update consecutive-work counters after the day's picks.
      for (const e of eligible) {
        if (empAssignedToday.has(e.empId)) {
          consecCount.set(e.empId, (consecCount.get(e.empId) || 0) + 1);
        } else {
          // Day off resets the streak.
          consecCount.set(e.empId, 0);
        }
      }

      const dayKey = DAY_KEYS[dowIndex];
      restByDay[dayKey] = eligible
        .filter(e => allRotationEmpIds.has(e.empId) && !empAssignedToday.has(e.empId))
        .map(e => e.empId);

      days.push({
        dayIndex: dowIndex,
        dayKey,
        slots,
        isPeak: peak,
      });

      // Narrative line: "Sat (peak): M=Alice → C=Bob (handoff 15:00) — Charlie resting".
      if (slots.length > 0 || restByDay[dayKey].length > 0) {
        const work = slots.map(s => `${s.shiftCode}=${s.empName ?? '∅'}`).join(' → ');
        const restNames = restByDay[dayKey]
          .map(id => eligible.find(e => e.empId === id)?.name)
          .filter(Boolean)
          .join(', ');
        const restPart = restNames ? ` — ${restNames} resting` : '';
        narrative.push(`${dayKey.toUpperCase()}${peak ? ' (peak)' : ''}: ${work || '∅'}${restPart}`);
      }
    }

    const totalSlotHours = days.reduce((s, d) =>
      s + d.slots.reduce((ss, sl) => ss + (sl.endHour - sl.startHour), 0), 0);
    const totalRosterHours = Array.from(hoursThisWeek.values()).reduce((s, h) => s + h, 0);
    const efficiency = totalRosterHours > 0
      ? Math.min(1, totalSlotHours / Math.max(totalRosterHours, 1))
      : 0;

    const group = station.groupId ? groupsById.get(station.groupId) : undefined;
    const rotation: WeeklyStationRotation = {
      stationId: station.id,
      stationName: station.name,
      groupId: group?.id,
      groupName: group?.name,
      days,
      rotationEmpIds: Array.from(allRotationEmpIds),
      restByDay,
      narrative,
      hasGap: stationHasGap,
      rotationEfficiency: efficiency,
    };
    weeks.push(rotation);
    totalRotation += rotation.rotationEmpIds.length;
    efficiencySum += efficiency;
  }

  return {
    weeks,
    totalSlots,
    filledSlots,
    gapSlots,
    totalRotationSize: totalRotation,
    averageEfficiency: weeks.length > 0 ? efficiencySum / weeks.length : 0,
  };
}
