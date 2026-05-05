import { describe, it, expect } from 'vitest';
import { getRequiredHC, totalDailyHeadcountHours, peakDailyHC, validateHourlyDemand, nextSlotDefaults } from '../stationDemand';
import type { Station } from '../../types';

const flatStation: Station = {
  id: 'ST-1', name: 'Cashier', normalMinHC: 1, peakMinHC: 2,
  openingTime: '08:00', closingTime: '23:00', color: '#3B82F6',
};

const hourlyStation: Station = {
  ...flatStation,
  id: 'ST-2',
  // Cashier needing 1/2/3 PAX across three windows on normal days
  // and a flat 3 PAX everywhere on peak days.
  normalHourlyDemand: [
    { startHour: 11, endHour: 15, hc: 1 },
    { startHour: 15, endHour: 19, hc: 2 },
    { startHour: 19, endHour: 23, hc: 3 },
  ],
  peakHourlyDemand: [
    { startHour: 11, endHour: 23, hc: 3 },
  ],
};

describe('getRequiredHC', () => {
  it('returns the flat min HC when no hourly profile is configured', () => {
    expect(getRequiredHC(flatStation, 12, false)).toBe(1);
    expect(getRequiredHC(flatStation, 12, true)).toBe(2);
    expect(getRequiredHC(flatStation, 0, false)).toBe(1); // outside hours, but flat applies everywhere
  });

  it('returns the slot HC when an hourly profile covers the hour', () => {
    expect(getRequiredHC(hourlyStation, 12, false)).toBe(1); // 11-15 slot
    expect(getRequiredHC(hourlyStation, 16, false)).toBe(2); // 15-19 slot
    expect(getRequiredHC(hourlyStation, 20, false)).toBe(3); // 19-23 slot
  });

  it('returns 0 for hours outside any configured slot (explicit-zero gap semantics)', () => {
    // Normal day: 0-10 has no slot → 0; 23 boundary (endHour exclusive) → 0
    expect(getRequiredHC(hourlyStation, 5, false)).toBe(0);
    expect(getRequiredHC(hourlyStation, 23, false)).toBe(0);
  });

  it('uses the peak profile when isPeakDay is true', () => {
    // Peak profile is flat 3 PAX 11-23.
    expect(getRequiredHC(hourlyStation, 12, true)).toBe(3);
    expect(getRequiredHC(hourlyStation, 20, true)).toBe(3);
    expect(getRequiredHC(hourlyStation, 5, true)).toBe(0);
  });

  it('endHour is exclusive — hour === endHour falls in the next slot or 0', () => {
    // 15 is the start of the second slot, not the end of the first.
    expect(getRequiredHC(hourlyStation, 15, false)).toBe(2);
  });
});

describe('totalDailyHeadcountHours', () => {
  it('multiplies flat HC by the operating window for legacy stations', () => {
    // 8-23 = 15 hours, 1 PAX/hr = 15 PAX-hrs on normal days
    expect(totalDailyHeadcountHours(flatStation, false, 8, 23)).toBe(15);
    expect(totalDailyHeadcountHours(flatStation, true, 8, 23)).toBe(30);
  });

  it('sums variable HC across hourly slots correctly', () => {
    // Normal: 1×4 + 2×4 + 3×4 = 24 PAX-hrs
    expect(totalDailyHeadcountHours(hourlyStation, false, 8, 23)).toBe(24);
    // Peak: 3×12 = 36 PAX-hrs
    expect(totalDailyHeadcountHours(hourlyStation, true, 8, 23)).toBe(36);
  });
});

describe('peakDailyHC', () => {
  it('returns the flat min HC for legacy stations', () => {
    expect(peakDailyHC(flatStation, false)).toBe(1);
    expect(peakDailyHC(flatStation, true)).toBe(2);
  });

  it('returns the maximum slot HC for hourly-demand stations', () => {
    expect(peakDailyHC(hourlyStation, false)).toBe(3); // worst window in normal profile
    expect(peakDailyHC(hourlyStation, true)).toBe(3);  // flat 3 in peak profile
  });
});

describe('validateHourlyDemand', () => {
  it('passes well-formed slots', () => {
    expect(validateHourlyDemand([
      { startHour: 11, endHour: 15, hc: 1 },
      { startHour: 15, endHour: 19, hc: 2 },
    ])).toBe(null);
  });

  it('flags overlapping slots', () => {
    expect(validateHourlyDemand([
      { startHour: 11, endHour: 16, hc: 1 },
      { startHour: 15, endHour: 19, hc: 2 },
    ])).toMatch(/overlap/i);
  });

  it('flags end <= start', () => {
    expect(validateHourlyDemand([{ startHour: 15, endHour: 15, hc: 1 }])).toMatch(/end hour/i);
  });

  it('flags out-of-range hours', () => {
    expect(validateHourlyDemand([{ startHour: 25, endHour: 27, hc: 1 }])).toMatch(/start hour/i);
    expect(validateHourlyDemand([{ startHour: 0, endHour: 25, hc: 1 }])).toMatch(/end hour/i);
  });

  it('flags negative HC', () => {
    expect(validateHourlyDemand([{ startHour: 0, endHour: 5, hc: -1 }])).toMatch(/headcount/i);
  });
});

describe('nextSlotDefaults', () => {
  it('starts at 8am with a 4-hour run when the slot list is empty', () => {
    expect(nextSlotDefaults([])).toEqual({ startHour: 8, endHour: 12, hc: 1 });
  });

  it('starts where the previous slot ended', () => {
    expect(nextSlotDefaults([{ startHour: 11, endHour: 15, hc: 2 }]))
      .toEqual({ startHour: 15, endHour: 19, hc: 1 });
  });

  it('caps the new slot end at 24 (end-of-day)', () => {
    // Last slot ends at 22 → next would naturally run 22-26, must clamp to 24.
    expect(nextSlotDefaults([{ startHour: 18, endHour: 22, hc: 2 }]))
      .toEqual({ startHour: 22, endHour: 24, hc: 1 });
  });

  it('caps the new slot start at 23 when the previous slot ends at 24', () => {
    // Last slot already covers up to end-of-day; next slot can't start at 24.
    // Start clamps to 23, end stays at 24 (since 23+4=27 also clamps to 24).
    expect(nextSlotDefaults([{ startHour: 20, endHour: 24, hc: 1 }]))
      .toEqual({ startHour: 23, endHour: 24, hc: 1 });
  });

  it('uses the LAST slot in the list as the anchor (not the max-end)', () => {
    // Defensive: even if slots are ordered weirdly, we anchor off the
    // tail. Validation will reject overlap separately, so this is the
    // pragmatic "I just clicked Add another slot" behaviour.
    expect(nextSlotDefaults([
      { startHour: 18, endHour: 22, hc: 2 },
      { startHour: 8, endHour: 12, hc: 1 },
    ])).toEqual({ startHour: 12, endHour: 16, hc: 1 });
  });
});
