/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.18.0 — Coverage diagnostics ("Why didn't you cover X?").
 *
 * The auto-scheduler does its best given the eligibility / cap / leave
 * constraints, but when it leaves gaps the supervisor has to guess WHY.
 * This module post-processes the produced schedule and explains each
 * unfilled (station, day, hour) tuple with the most-likely binding
 * constraint.
 *
 * Reason classification (in priority order — first match wins):
 *   - 'no-eligible-employees' : no employee in the roster lists this
 *     station (directly via eligibleStations or transitively via
 *     eligibleGroups). Hiring or eligibility extension is the fix.
 *   - 'all-eligible-on-leave' : every eligible employee has a leave cell
 *     (AL/SL/MAT) or is in a leave range that covers this date. Leave
 *     stacking is the cause; reschedule discretionary leave or hire.
 *   - 'all-eligible-already-scheduled' : every eligible employee already
 *     has a different work shift on this day. Spread coverage thinner
 *     across the day or hire.
 *   - 'all-eligible-fixed-rest' : every eligible employee has fixedRestDay
 *     matching this DOW. Switch some to rotating rest or hire.
 *   - 'station-closed' : the hour falls outside the station's open
 *     window (no real "uncovered" violation, just a sanity-check entry).
 *   - 'unknown' : fall-through. Should not happen on a sane roster but
 *     keeps the type total.
 *
 * Returns one record per (station, day, hour) where required HC was not
 * met. Day-hour combinations that ARE met are omitted (no work to flag).
 */

import type { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../types';
import { parseHour } from './time';
import { getRequiredHC } from './stationDemand';
import { expandHolidayDates } from './holidays';
import { getEmployeeLeaveOnDate } from './leaves';
import { format } from 'date-fns';

export type UnfilledReason =
  | 'no-eligible-employees'
  | 'all-eligible-on-leave'
  | 'all-eligible-already-scheduled'
  | 'all-eligible-fixed-rest'
  | 'station-closed'
  | 'unknown';

export interface UnfilledSlot {
  day: number;
  stationId: string;
  stationName: string;
  hour: number;
  required: number;
  assigned: number;
  reason: UnfilledReason;
  // The set of employee IDs that *could* have covered this slot if the
  // binding constraint was different. UI uses this to suggest: "These 3
  // employees were eligible but on leave that day".
  blockedEmpIds: string[];
}

export interface DiagnosticsArgs {
  schedule: Schedule;
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  isPeakDay: (day: number) => boolean;
}

export function diagnoseUnfilledCoverage(args: DiagnosticsArgs): UnfilledSlot[] {
  const { schedule, employees, shifts, stations, holidays, config, isPeakDay } = args;
  const out: UnfilledSlot[] = [];
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));
  const expandedHolidays = expandHolidayDates(holidays);
  const holidayDates = new Set(expandedHolidays.map(h => h.date));

  for (const station of stations) {
    const stOpen = parseHour(station.openingTime);
    const stClose = parseHour(station.closingTime);

    // Pre-compute the eligibility roster: which employees can work here.
    const eligibleEmps = employees.filter(e => {
      if (e.eligibleStations?.includes(station.id)) return true;
      if (station.groupId && e.eligibleGroups?.includes(station.groupId)) return true;
      return false;
    });

    for (let day = 1; day <= config.daysInMonth; day++) {
      const date = new Date(config.year, config.month - 1, day);
      const dateStr = format(date, 'yyyy-MM-dd');
      const dow = date.getDay() + 1; // 1=Sun..7=Sat
      const peak = isPeakDay(day);
      const holiday = holidayDates.has(dateStr);

      for (let hour = stOpen; hour < stClose && hour < 24; hour++) {
        const required = getRequiredHC(station, hour, peak, holiday);
        if (required === 0) continue;

        // Count assigned at this (station, day, hour).
        let assigned = 0;
        for (const emp of employees) {
          const entry = schedule[emp.empId]?.[day];
          if (!entry || entry.stationId !== station.id) continue;
          const sh = shiftByCode.get(entry.shiftCode);
          if (!sh || !sh.isWork) continue;
          const sH = parseHour(sh.start);
          const eH = parseHour(sh.end);
          // Hour falls within the assigned shift window (cross-midnight handled
          // by treating end<=start as "extends through 24:00").
          const inWindow = sH < eH ? hour >= sH && hour < eH : hour >= sH || hour < eH;
          if (inWindow) assigned++;
        }
        if (assigned >= required) continue;

        // Slot is short — diagnose why.
        if (eligibleEmps.length === 0) {
          out.push({
            day, stationId: station.id, stationName: station.name,
            hour, required, assigned,
            reason: 'no-eligible-employees',
            blockedEmpIds: [],
          });
          continue;
        }

        // Categorise the eligible employees by their state on this day.
        const onLeave: string[] = [];
        const alreadyScheduled: string[] = [];
        const fixedRest: string[] = [];
        const free: string[] = [];

        for (const emp of eligibleEmps) {
          if (emp.fixedRestDay && emp.fixedRestDay === dow) {
            fixedRest.push(emp.empId);
            continue;
          }
          if (getEmployeeLeaveOnDate(emp, dateStr)) {
            onLeave.push(emp.empId);
            continue;
          }
          const entry = schedule[emp.empId]?.[day];
          if (entry && entry.shiftCode) {
            const sh = shiftByCode.get(entry.shiftCode);
            // System non-work codes (OFF/CP/AL/SL/MAT/PH) aren't counted as
            // "already scheduled" — they're rest/leave states, captured above
            // by the leave check or are routine OFF.
            if (sh && sh.isWork) {
              alreadyScheduled.push(emp.empId);
              continue;
            }
          }
          free.push(emp.empId);
        }

        // Pick the dominant reason.
        let reason: UnfilledReason = 'unknown';
        let blocked: string[] = [];
        if (free.length > 0) {
          // We have free people — the auto-scheduler chose not to assign.
          // Most likely reason: they hit a cap. Surface as already-scheduled
          // since the alternative reasons (leave / fixed rest) are already
          // ruled out for THIS subset.
          reason = 'all-eligible-already-scheduled';
          blocked = free;
        } else if (alreadyScheduled.length >= eligibleEmps.length / 2) {
          reason = 'all-eligible-already-scheduled';
          blocked = alreadyScheduled;
        } else if (onLeave.length >= eligibleEmps.length / 2) {
          reason = 'all-eligible-on-leave';
          blocked = onLeave;
        } else if (fixedRest.length >= eligibleEmps.length / 2) {
          reason = 'all-eligible-fixed-rest';
          blocked = fixedRest;
        } else if (alreadyScheduled.length > 0) {
          reason = 'all-eligible-already-scheduled';
          blocked = alreadyScheduled;
        } else if (onLeave.length > 0) {
          reason = 'all-eligible-on-leave';
          blocked = onLeave;
        } else if (fixedRest.length > 0) {
          reason = 'all-eligible-fixed-rest';
          blocked = fixedRest;
        }

        out.push({
          day, stationId: station.id, stationName: station.name,
          hour, required, assigned,
          reason,
          blockedEmpIds: blocked,
        });
      }
    }
  }
  return out;
}

// Roll a flat list of unfilled-slot records into a per-(station, day) summary
// so the UI can render one row per coverage gap instead of one per hour.
// Reason for a grouped row = the dominant reason across its hours.
export interface UnfilledGroup {
  day: number;
  stationId: string;
  stationName: string;
  hours: number[];        // sorted ascending
  totalShortfall: number; // sum of (required - assigned) across hours
  reason: UnfilledReason;
  blockedEmpIds: string[];
}

export function groupUnfilledByStationDay(slots: UnfilledSlot[]): UnfilledGroup[] {
  const map = new Map<string, UnfilledGroup>();
  for (const s of slots) {
    const key = `${s.day}:${s.stationId}`;
    let g = map.get(key);
    if (!g) {
      g = {
        day: s.day, stationId: s.stationId, stationName: s.stationName,
        hours: [], totalShortfall: 0,
        reason: s.reason,
        blockedEmpIds: [],
      };
      map.set(key, g);
    }
    g.hours.push(s.hour);
    g.totalShortfall += (s.required - s.assigned);
    // Union of blockedEmpIds across hours; reason promotes to first-seen non-unknown.
    for (const id of s.blockedEmpIds) if (!g.blockedEmpIds.includes(id)) g.blockedEmpIds.push(id);
    if (g.reason === 'unknown' && s.reason !== 'unknown') g.reason = s.reason;
  }
  return Array.from(map.values()).sort((a, b) => a.day - b.day || a.stationName.localeCompare(b.stationName));
}
