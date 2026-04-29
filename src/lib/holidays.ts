// v2.5.0 — Holiday helpers.
//
// Two transformations live here:
//
//  1. `expandHolidayDates(holidays)` — materialises multi-day holidays
//     (Eid Al-Fitr / Eid Al-Adha typically span 2-3 days) into one
//     synthetic single-day record per covered date. Existing consumers
//     match by `holiday.date === dateStr` or filter via
//     `holiday.date.startsWith('YYYY-MM-')`; pre-expanding at the entry
//     point lets all of those keep working unchanged.
//
//  2. `projectHolidaysToYear(holidays, year)` — projects fixed-date
//     holidays (Iraq National Day, Labour Day, etc.) to a different
//     year by replacing the year prefix. Movable Islamic holidays carry
//     `isFixed === false` and are only included if their date already
//     falls in the target year — without a Hijri calendar lookup we
//     can't auto-shift those, so we skip them and let the supervisor
//     add the correct dates manually for forecasting future years.
//
// Both helpers are pure and idempotent: feeding their output back in
// returns the same shape, which keeps memo dependency chains stable.

import { addDays, format, parseISO } from 'date-fns';
import { PublicHoliday } from '../types';

// Fan a holiday list into one entry per calendar day covered. Single-day
// holidays pass through with no change; a 3-day holiday becomes 3
// entries with consecutive dates and the same name/legalReference/etc.
// The synthetic entries share the parent's `id` so any code keying off
// id sees them as one logical holiday.
export function expandHolidayDates(holidays: PublicHoliday[]): PublicHoliday[] {
  const out: PublicHoliday[] = [];
  for (const h of holidays) {
    const days = Math.max(1, Math.min(14, h.durationDays ?? 1));
    if (days === 1) {
      out.push(h);
      continue;
    }
    // Parse the start date and emit one record per offset day.
    let base: Date;
    try {
      base = parseISO(h.date);
      if (Number.isNaN(base.getTime())) { out.push(h); continue; }
    } catch {
      out.push(h);
      continue;
    }
    for (let i = 0; i < days; i++) {
      const d = i === 0 ? base : addDays(base, i);
      out.push({
        ...h,
        date: format(d, 'yyyy-MM-dd'),
      });
    }
  }
  return out;
}

// Project user-defined holidays to a target year for forecast/scenario
// planning. Fixed-Gregorian holidays (isFixed=true) shift to the same
// month/day in the target year; movable holidays (isFixed=false) only
// pass through if their `date` is already in the target year.
//
// Returns a new array — does NOT mutate the input. Holidays are
// pre-expanded to single-day entries via `expandHolidayDates` so the
// projection respects multi-day spans correctly.
export function projectHolidaysToYear(
  holidays: PublicHoliday[],
  targetYear: number,
): { projected: PublicHoliday[]; skippedMovable: number } {
  let skippedMovable = 0;
  const projected: PublicHoliday[] = [];
  // Project the source holidays first (NOT the expanded versions) so
  // multi-day holidays stay multi-day after projection.
  for (const h of holidays) {
    if (h.isFixed === false) {
      // Movable — only include if already in target year.
      if (h.date.startsWith(`${targetYear}-`)) {
        projected.push(h);
      } else {
        skippedMovable++;
      }
      continue;
    }
    // Fixed (or unspecified, treated as fixed). Replace the year prefix.
    const parts = h.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) {
      // Malformed — skip silently.
      continue;
    }
    projected.push({
      ...h,
      date: `${targetYear}-${parts[2]}-${parts[3]}`,
    });
  }
  return { projected, skippedMovable };
}
