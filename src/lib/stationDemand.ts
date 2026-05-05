/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.14.0 — Single source of truth for "how many people does this station
 * need at this hour on this day type?".
 *
 * The Station type carries TWO representations:
 *   * Flat: `normalMinHC` / `peakMinHC` — single value applied to every
 *     hour (legacy, simple). Pre-v5.14 stations only have these.
 *   * Hourly: `normalHourlyDemand` / `peakHourlyDemand` — list of
 *     `[startHour, endHour) → hc` slots. When non-empty, OVERRIDES the
 *     flat value across the entire 24-hour day. Gaps between slots are
 *     interpreted as "0 PAX needed there" (explicit-zero semantics —
 *     supervisor opted into per-hour granularity, must specify each
 *     covered window).
 *
 * Every consumer that asks "how many do I need here right now?" goes
 * through `getRequiredHC()` so the two paths can't diverge. Auto-scheduler
 * + workforce planning + staffing advisory all read via this helper.
 *
 * Design notes:
 *   * `endHour` is exclusive — `{ startHour: 15, endHour: 19 }` covers
 *     hours 15, 16, 17, 18 (not 19). `endHour: 24` represents end-of-day.
 *   * Slots are checked in array order; the first matching slot wins.
 *     Validation in the editor prevents overlap, but the helper is
 *     defensive — order-first means a deliberate "override slot at the
 *     top" pattern would work if someone wired it that way.
 *   * Empty array vs undefined are both treated as "no hourly profile".
 */

import type { Station, HourlyDemandSlot } from '../types';

export function getRequiredHC(
  station: Station,
  hour: number,
  isPeakDay: boolean,
): number {
  const slots = isPeakDay ? station.peakHourlyDemand : station.normalHourlyDemand;
  if (slots && slots.length > 0) {
    for (const s of slots) {
      if (hour >= s.startHour && hour < s.endHour) return Math.max(0, s.hc | 0);
    }
    // Hour falls in a gap → explicit zero (supervisor opted into hourly
    // granularity; gaps are intentional "no demand" windows).
    return 0;
  }
  // Legacy: flat value applies to every hour the station is open.
  return isPeakDay ? station.peakMinHC : station.normalMinHC;
}

// Sum of headcount-hours required for a station on a single day. Used by
// workforce planning + staffing advisory to compute monthly demand.
// Walks 0–23, summing requiredHC for each hour. With the legacy flat
// model this just multiplies by hours-of-operation, which is what those
// modules used to compute inline. With hourly demand it produces the
// correct figure for variable profiles automatically.
export function totalDailyHeadcountHours(
  station: Station,
  isPeakDay: boolean,
  openingHour: number,
  closingHour: number,
): number {
  let total = 0;
  for (let h = openingHour; h < closingHour; h++) {
    total += getRequiredHC(station, h, isPeakDay);
  }
  return total;
}

// Returns true if any slot has a non-zero HC for this day type. Used
// to detect "this station has variable demand and isn't represented by
// the flat value alone" — drives UI affordances like the "hourly" badge.
export function hasHourlyDemandConfigured(
  station: Station,
  isPeakDay: boolean,
): boolean {
  const slots = isPeakDay ? station.peakHourlyDemand : station.normalHourlyDemand;
  return Array.isArray(slots) && slots.length > 0;
}

// Day-level peak: the maximum required HC across all 24 hours for a
// given day type. Used by surfaces that need a single per-day number
// (coverage-gap counters, advisory rollups) but want the worst-case
// view rather than averaging away the busy windows. With the legacy
// flat model this is just normalMinHC / peakMinHC; with hourly demand
// it's the max(hc) across the configured slots.
export function peakDailyHC(
  station: Station,
  isPeakDay: boolean,
): number {
  const slots = isPeakDay ? station.peakHourlyDemand : station.normalHourlyDemand;
  if (slots && slots.length > 0) {
    return slots.reduce((max, s) => Math.max(max, Math.max(0, s.hc | 0)), 0);
  }
  return isPeakDay ? station.peakMinHC : station.normalMinHC;
}

// v5.15.0 — returns the tuple a brand-new slot should default to: starts
// where the last slot ends (or 8am for an empty list) and runs 4 hours,
// capped at the 0–24 range. Saves the supervisor a typo-prone "set start
// to 11" step in the common build-up-from-empty workflow. Lives here
// (next to validateHourlyDemand) so both the StationModal editor and the
// BulkAddStationsModal defaults panel pull from the same authoritative
// source.
export function nextSlotDefaults(existing: HourlyDemandSlot[]): HourlyDemandSlot {
  const lastEnd = existing.length > 0 ? existing[existing.length - 1].endHour : 8;
  const startHour = Math.min(23, lastEnd);
  const endHour = Math.min(24, startHour + 4);
  return { startHour, endHour, hc: 1 };
}

// Validation: returns null if the slot list is well-formed, or an error
// message string. Used by the editor to gate save.
export function validateHourlyDemand(slots: HourlyDemandSlot[]): string | null {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!Number.isFinite(s.startHour) || !Number.isFinite(s.endHour)) {
      return `Slot ${i + 1}: hours must be numbers`;
    }
    if (s.startHour < 0 || s.startHour > 23) {
      return `Slot ${i + 1}: start hour must be 0–23`;
    }
    if (s.endHour < 1 || s.endHour > 24) {
      return `Slot ${i + 1}: end hour must be 1–24`;
    }
    if (s.startHour >= s.endHour) {
      return `Slot ${i + 1}: end hour must be after start hour`;
    }
    if (s.hc < 0 || !Number.isFinite(s.hc)) {
      return `Slot ${i + 1}: headcount must be ≥ 0`;
    }
  }
  // Overlap check — N² is fine for the typical 4–6 slots per station.
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      if (a.startHour < b.endHour && b.startHour < a.endHour) {
        return `Slots ${i + 1} and ${j + 1} overlap — adjust the hours so they don't conflict`;
      }
    }
  }
  return null;
}
