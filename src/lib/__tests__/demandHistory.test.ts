import { describe, expect, it } from 'vitest';
import { suggestHourlyDemandFromHistory, groupHourlyArrayIntoSlots } from '../demandHistory';
import type { Config, Schedule, Shift, Station } from '../../types';

const station = (id = 's1'): Station => ({
  id, name: 'Cashier', normalMinHC: 1, peakMinHC: 2,
  openingTime: '11:00', closingTime: '23:00',
});

const shift = (over: Partial<Shift>): Shift => ({
  code: over.code || 'M1', name: over.name || 'Morning',
  start: over.start || '11:00', end: over.end || '19:00',
  durationHrs: 8, breakMin: 60,
  isIndustrial: false, isHazardous: false, isWork: true, description: '',
});

const cfg = (peakDays: number[] = []): Pick<Config, 'peakDays'> => ({ peakDays });

describe('groupHourlyArrayIntoSlots', () => {
  it('returns empty array for all-zero input', () => {
    expect(groupHourlyArrayIntoSlots(new Array(24).fill(0))).toEqual([]);
  });

  it('merges consecutive equal hours into one slot', () => {
    const arr = new Array(24).fill(0);
    arr[11] = 2; arr[12] = 2; arr[13] = 2;
    expect(groupHourlyArrayIntoSlots(arr)).toEqual([{ startHour: 11, endHour: 14, hc: 2 }]);
  });

  it('splits at HC changes', () => {
    const arr = new Array(24).fill(0);
    arr[11] = 1; arr[12] = 1; arr[13] = 2; arr[14] = 2;
    expect(groupHourlyArrayIntoSlots(arr)).toEqual([
      { startHour: 11, endHour: 13, hc: 1 },
      { startHour: 13, endHour: 15, hc: 2 },
    ]);
  });

  it('treats zero gaps as separate slots', () => {
    const arr = new Array(24).fill(0);
    arr[8] = 1; arr[15] = 2; arr[16] = 2;
    expect(groupHourlyArrayIntoSlots(arr)).toEqual([
      { startHour: 8, endHour: 9, hc: 1 },
      { startHour: 15, endHour: 17, hc: 2 },
    ]);
  });
});

describe('suggestHourlyDemandFromHistory', () => {
  it('returns noData=true when no schedules exist', () => {
    const result = suggestHourlyDemandFromHistory({
      station: station(), allSchedules: {}, shifts: [shift({})], holidays: [], config: cfg(),
    });
    expect(result.noData).toBe(true);
    expect(result.normal).toHaveLength(0);
  });

  it('returns noData=true when no cell stamps the station', () => {
    const allSchedules: Record<string, Schedule> = {
      scheduler_schedule_2026_01: {
        e1: { 1: { shiftCode: 'M1', stationId: 'OTHER' }, 2: { shiftCode: 'M1', stationId: 'OTHER' } },
      },
    };
    const result = suggestHourlyDemandFromHistory({
      station: station('s1'), allSchedules, shifts: [shift({})], holidays: [], config: cfg(),
    });
    expect(result.noData).toBe(true);
  });

  it('counts coverage from one shift across one month', () => {
    // 31 days in Jan; one employee works M1 (11-19) at s1 every weekday.
    const monthSched: Schedule = {};
    monthSched['e1'] = {};
    for (let d = 1; d <= 31; d++) {
      monthSched['e1'][d] = { shiftCode: 'M1', stationId: 's1' };
    }
    const result = suggestHourlyDemandFromHistory({
      station: station('s1'),
      allSchedules: { scheduler_schedule_2026_01: monthSched },
      shifts: [shift({})],
      holidays: [],
      config: cfg([]),
    });
    expect(result.noData).toBe(false);
    expect(result.normalDayCount).toBe(31);
    // All 31 days had 1 PAX 11-19. Average ceil(31/31) = 1.
    expect(result.normal).toEqual([{ startHour: 11, endHour: 19, hc: 1 }]);
    expect(result.peak).toEqual([]);
  });

  it('separates peak from normal days', () => {
    const monthSched: Schedule = {};
    monthSched['e1'] = {};
    monthSched['e2'] = {};
    // Jan 2026: Jan 1 is Thursday. Set peak day = Friday (DOW 6).
    // Jan 2 = Friday, Jan 9 = Friday, Jan 16 = Friday, Jan 23 = Friday, Jan 30 = Friday.
    // 1 PAX every day from e1; 2 PAX on Fridays from e2.
    for (let d = 1; d <= 31; d++) {
      monthSched['e1'][d] = { shiftCode: 'M1', stationId: 's1' };
      const dow = new Date(2026, 0, d).getDay();
      if (dow === 5) {
        monthSched['e2'][d] = { shiftCode: 'M1', stationId: 's1' };
      }
    }
    const result = suggestHourlyDemandFromHistory({
      station: station('s1'),
      allSchedules: { scheduler_schedule_2026_01: monthSched },
      shifts: [shift({})],
      holidays: [],
      config: cfg([6]), // 6 = Friday in 1=Sun..7=Sat
    });
    expect(result.noData).toBe(false);
    expect(result.normal).toEqual([{ startHour: 11, endHour: 19, hc: 1 }]);
    // Fridays: 2 PAX 11-19. ceil(2 / 5 friday) — wait, need to check actually.
    // The peak buckets sum 2 PAX × 5 fridays × 8 hours = 80 PAX-hours.
    // Per hour 11-19: 2 each friday × 5 = 10 PAX-hours. Distinct peak days = 5.
    // ceil(10 / 5) = 2 per hour. So peak slot is 11-19 with hc=2.
    expect(result.peak).toEqual([{ startHour: 11, endHour: 19, hc: 2 }]);
  });

  it('skips non-work shift codes (CP/AL/SL etc.)', () => {
    const monthSched: Schedule = {};
    monthSched['e1'] = {};
    for (let d = 1; d <= 31; d++) {
      monthSched['e1'][d] = { shiftCode: 'AL', stationId: 's1' };
    }
    const allSchedules: Record<string, Schedule> = { scheduler_schedule_2026_01: monthSched };
    const al: Shift = {
      code: 'AL', name: 'Annual Leave',
      start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0,
      isIndustrial: false, isHazardous: false, isWork: false, description: '',
    };
    const result = suggestHourlyDemandFromHistory({
      station: station('s1'), allSchedules, shifts: [al], holidays: [], config: cfg(),
    });
    expect(result.noData).toBe(true);
  });

  it('handles cross-midnight shifts by clamping to current day', () => {
    // Night shift 22:00 → 06:00 → on each calendar day we count 22, 23
    // (the 00-06 tail belongs to the next day's bucket).
    const night: Shift = shift({ code: 'N1', name: 'Night', start: '22:00', end: '06:00', durationHrs: 8 });
    const monthSched: Schedule = { e1: {} };
    for (let d = 1; d <= 10; d++) {
      monthSched['e1'][d] = { shiftCode: 'N1', stationId: 's1' };
    }
    const result = suggestHourlyDemandFromHistory({
      station: station('s1'),
      allSchedules: { scheduler_schedule_2026_01: monthSched },
      shifts: [night],
      holidays: [],
      config: cfg(),
    });
    expect(result.noData).toBe(false);
    expect(result.normal).toEqual([{ startHour: 22, endHour: 24, hc: 1 }]);
  });
});
