/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.18.0 — Suggest hourly demand from historical schedules.
 *
 * The auto-shift generator (lib/shiftGenerator.ts) and the auto-scheduler
 * both consume station hourly demand to size shifts and assign employees.
 * Today the supervisor types those numbers in by intuition, which is brittle
 * — three months in the operator typically realises the cashier station
 * needs 3 PAX at 19:00 not the 2 they entered, but that insight isn't fed
 * back into the configuration.
 *
 * This helper reverses the flow: given the company's `allSchedules`, it
 * computes the per-hour observed coverage at a station across past months
 * and returns recommended HourlyDemandSlot[] that — if applied — would
 * roughly reproduce historical staffing. The supervisor reviews and
 * commits in HourlyDemandEditor.
 *
 * Algorithm:
 *   1. Walk every schedule month under `allSchedules`. For each (employee,
 *      day) cell whose entry stamps `stationId === target.id` AND the
 *      shift code maps to a work shift, expand the shift's start..end
 *      window into per-hour buckets [normal | peak] (driven by
 *      isPeakDay(date) — same predicate the auto-scheduler uses).
 *   2. Per (hour, day-type) bucket, increment a counter. Track distinct
 *      day counts per type so we can divide for averages.
 *   3. For each hour, recommended HC = ceil(observed coverage / distinct
 *      days). Use ceil so we don't accidentally suggest "1 PAX" for an
 *      hour that needed 1.4 average — under-staffing is more painful
 *      than slight over-staffing.
 *   4. Group consecutive hours with the same recommended HC into slots so
 *      the editor doesn't need 24 rows.
 *
 * Returns {} when no historical data exists, so callers know to fall back
 * to the manual editor.
 */

import type { Employee, Schedule, Shift, PublicHoliday, Config, Station, HourlyDemandSlot } from '../types';
import { parseHour } from './time';
import { expandHolidayDates } from './holidays';

export interface SuggestArgs {
  station: Station;
  allSchedules: Record<string, Schedule>;
  shifts: Shift[];
  holidays: PublicHoliday[];
  config: Pick<Config, 'peakDays'>;
}

export interface DemandSuggestion {
  normal: HourlyDemandSlot[];
  peak: HourlyDemandSlot[];
  // Diagnostics for the preview UI.
  monthsAnalyzed: number;
  normalDayCount: number;
  peakDayCount: number;
  // True if no work-shift cells were found at this station in any
  // historical schedule. The UI surfaces a "no history yet" message
  // instead of empty arrays so the supervisor knows the suggestion is
  // empty for a reason and not because the algorithm broke.
  noData: boolean;
}

export function suggestHourlyDemandFromHistory(args: SuggestArgs): DemandSuggestion {
  const { station, allSchedules, shifts, holidays, config } = args;

  const shiftByCode = new Map(shifts.map(s => [s.code, s]));
  const expandedHolidays = expandHolidayDates(holidays);
  const holidayDates = new Set(expandedHolidays.map(h => h.date));
  const peakDayOfWeek = new Set(config.peakDays || []);

  // 24-element sums + day counts per type. We accumulate "PAX-hours
  // observed" per hour then divide by the distinct-day counter.
  const normalSums = new Array<number>(24).fill(0);
  const peakSums = new Array<number>(24).fill(0);
  const seenNormalDays = new Set<string>();
  const seenPeakDays = new Set<string>();
  let monthsAnalyzed = 0;
  let cellsWithStation = 0;

  for (const [key, sched] of Object.entries(allSchedules)) {
    const m = /^scheduler_schedule_(\d{4})_(\d{1,2})$/.exec(key);
    if (!m) continue;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const daysInMonth = new Date(year, month, 0).getDate();
    monthsAnalyzed++;

    // For each day, classify normal vs peak first (cheap), then walk
    // every employee's cell at that day. The day-type set guarantees
    // we don't double-count the same calendar day across different
    // employee rows.
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dow = date.getDay() + 1; // 1=Sun..7=Sat
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isPeak = peakDayOfWeek.has(dow) || holidayDates.has(dateStr);

      // Did this station have any staffing on this day at all? If not,
      // skip (don't count it toward the day denominator either — a
      // closed-store day would otherwise drag the average down).
      let dayHadStation = false;

      for (const empId of Object.keys(sched || {})) {
        const empSched = sched[empId];
        if (!empSched) continue;
        const entry = empSched[day];
        if (!entry || entry.stationId !== station.id) continue;
        const shift = shiftByCode.get(entry.shiftCode);
        if (!shift || !shift.isWork) continue;

        dayHadStation = true;
        cellsWithStation++;
        const startHour = parseHour(shift.start);
        const endHourRaw = parseHour(shift.end);
        // Cross-midnight shift: shift.end < shift.start treated as wrapping.
        // For demand-from-history we only count the active calendar day's
        // hours — the next-day tail belongs to the following day's bucket.
        const endHour = endHourRaw <= startHour ? 24 : endHourRaw;
        for (let h = startHour; h < endHour && h < 24; h++) {
          if (isPeak) peakSums[h]++;
          else normalSums[h]++;
        }
      }

      if (dayHadStation) {
        if (isPeak) seenPeakDays.add(dateStr);
        else seenNormalDays.add(dateStr);
      }
    }
  }

  if (cellsWithStation === 0) {
    return {
      normal: [], peak: [],
      monthsAnalyzed, normalDayCount: 0, peakDayCount: 0,
      noData: true,
    };
  }

  const normalAvg = normalSums.map(sum =>
    seenNormalDays.size > 0 ? Math.ceil(sum / seenNormalDays.size) : 0
  );
  const peakAvg = peakSums.map(sum =>
    seenPeakDays.size > 0 ? Math.ceil(sum / seenPeakDays.size) : 0
  );

  return {
    normal: groupHourlyArrayIntoSlots(normalAvg),
    peak: groupHourlyArrayIntoSlots(peakAvg),
    monthsAnalyzed,
    normalDayCount: seenNormalDays.size,
    peakDayCount: seenPeakDays.size,
    noData: false,
  };
}

// Walk a 24-element HC array and emit contiguous-run slots wherever HC > 0.
// Hours with hc=0 are gaps (the editor reads no slot at h as "0 needed").
// Adjacent hours with the same hc are merged so the editor stays compact.
export function groupHourlyArrayIntoSlots(hourly: number[]): HourlyDemandSlot[] {
  const out: HourlyDemandSlot[] = [];
  let cur: HourlyDemandSlot | null = null;
  for (let h = 0; h < 24; h++) {
    const hc = Math.max(0, hourly[h] | 0);
    if (hc === 0) {
      if (cur) { out.push(cur); cur = null; }
      continue;
    }
    if (cur && cur.hc === hc) {
      cur.endHour = h + 1;
    } else {
      if (cur) out.push(cur);
      cur = { startHour: h, endHour: h + 1, hc };
    }
  }
  if (cur) out.push(cur);
  return out;
}
