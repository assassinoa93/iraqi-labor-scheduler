import { describe, it, expect } from 'vitest';
import { optimizeForLiability } from '../liabilityOptimizer';
import type { Config, Employee, Shift, Station, Schedule, PublicHoliday } from '../../types';

const baseConfig = (): Config => ({
  company: 'Test',
  year: 2026, month: 5, daysInMonth: 31,
  weekendPolicy: 'fri-sat',
  weeklyRestDayPrimary: 6,
  continuousShiftsMode: 'OFF',
  coverageMin: 1,
  maxConsecWorkDays: 6,
  standardDailyHrsCap: 8,
  hazardousDailyHrsCap: 6,
  standardWeeklyHrsCap: 48,
  hazardousWeeklyHrsCap: 36,
  minRestBetweenShiftsHrs: 11,
  shopOpeningTime: '11:00',
  shopClosingTime: '23:00',
  peakDays: [],
  otRateDay: 1.5,
  otRateNight: 2.0,
});

const emp = (over: Partial<Employee> & { empId: string; name: string }): Employee => ({
  role: 'Standard',
  department: '',
  contractType: 'Open-ended',
  contractedWeeklyHrs: 48,
  shiftEligibility: 'all',
  isHazardous: false,
  isIndustrialRotating: false,
  hourExempt: false,
  fixedRestDay: 0,
  phone: '', hireDate: '', notes: '',
  eligibleStations: ['s1'],
  holidayBank: 0,
  annualLeaveBalance: 21,
  baseMonthlySalary: 1_500_000,
  baseHourlyRate: 0,
  overtimeHours: 0,
  category: 'Standard',
  ...over,
});

const station = (id: string): Station => ({
  id, name: id,
  normalMinHC: 1, peakMinHC: 1,
  openingTime: '11:00', closingTime: '19:00',
});

const workShift: Shift = {
  code: 'M', name: 'Morning', start: '11:00', end: '19:00',
  durationHrs: 8, breakMin: 60, isIndustrial: false, isHazardous: false, isWork: true, description: '',
};
const offShift: Shift = {
  code: 'OFF', name: 'Off', start: '00:00', end: '00:00',
  durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '',
};

describe('optimizeForLiability', () => {
  it('does nothing when no employee is over cap', () => {
    const employees = [emp({ empId: 'a', name: 'A' }), emp({ empId: 'b', name: 'B' })];
    // Cap is 192 (48 × 4). 8 hr × 5 days = 40 hr each — well under.
    const schedule: Schedule = {
      a: { 1: { shiftCode: 'M', stationId: 's1' }, 2: { shiftCode: 'M', stationId: 's1' }, 3: { shiftCode: 'OFF' } },
      b: { 1: { shiftCode: 'OFF' }, 2: { shiftCode: 'OFF' }, 3: { shiftCode: 'M', stationId: 's1' } },
    };
    const result = optimizeForLiability({
      schedule, employees, shifts: [workShift, offShift], stations: [station('s1')], holidays: [], config: baseConfig(),
    });
    expect(result.swaps).toHaveLength(0);
  });

  it('swaps an over-cap shift with an under-cap employee on OFF', () => {
    const employees = [emp({ empId: 'a', name: 'A' }), emp({ empId: 'b', name: 'B' })];
    // Build a schedule where A has 200h (over the 192 cap) and B has 40h.
    // Day 31 = A's last (over-cap-tipping) shift; B is OFF.
    const schedule: Schedule = { a: {}, b: {} };
    // Give A 25 work days (200 hr).
    for (let d = 1; d <= 25; d++) schedule.a[d] = { shiftCode: 'M', stationId: 's1' };
    schedule.a[26] = { shiftCode: 'OFF' };
    // Give B 5 work days (40 hr) and OFF on day 26.
    for (let d = 1; d <= 5; d++) schedule.b[d] = { shiftCode: 'M', stationId: 's1' };
    for (let d = 6; d <= 26; d++) schedule.b[d] = { shiftCode: 'OFF' };

    const result = optimizeForLiability({
      schedule, employees, shifts: [workShift, offShift], stations: [station('s1')], holidays: [], config: baseConfig(),
    });
    // Expect at least one swap.
    expect(result.swaps.length).toBeGreaterThan(0);
    expect(result.totalOverCapHoursSaved).toBeGreaterThan(0);
    // The swap should be from A → B with reason 'over-cap'.
    expect(result.swaps.some(s => s.fromEmpId === 'a' && s.toEmpId === 'b' && s.reason === 'over-cap')).toBe(true);
  });

  it('respects locked (preserveExisting) cells', () => {
    const employees = [emp({ empId: 'a', name: 'A' }), emp({ empId: 'b', name: 'B' })];
    const schedule: Schedule = { a: {}, b: {} };
    for (let d = 1; d <= 25; d++) schedule.a[d] = { shiftCode: 'M', stationId: 's1' };
    schedule.a[26] = { shiftCode: 'OFF' };
    for (let d = 1; d <= 26; d++) schedule.b[d] = { shiftCode: 'OFF' };

    // Lock day 25 — A's over-cap shift is "untouchable".
    const preserveExisting: Schedule = { a: { 25: schedule.a[25] } };

    const result = optimizeForLiability({
      schedule, employees, shifts: [workShift, offShift], stations: [station('s1')], holidays: [], config: baseConfig(),
      preserveExisting,
    });
    // Day 25 should not appear in the swap log even if optimizer wanted to swap it.
    expect(result.swaps.find(s => s.day === 25)).toBeUndefined();
  });

  it('never produces a swap that breaks the destination employee\'s cap', () => {
    const employees = [emp({ empId: 'a', name: 'A' }), emp({ empId: 'b', name: 'B' })];
    // Both at 188h — A slightly over (190), B slightly under (188).
    // A swap would push B to 196 = over cap, so it should be rejected.
    const schedule: Schedule = { a: {}, b: {} };
    for (let d = 1; d <= 24; d++) {
      schedule.a[d] = { shiftCode: 'M', stationId: 's1' };
      schedule.b[d] = { shiftCode: 'M', stationId: 's1' };
    }
    schedule.a[25] = { shiftCode: 'M', stationId: 's1' }; // A: 200 (over cap 192)
    schedule.b[25] = { shiftCode: 'OFF' };               // B: 192 (at cap)

    const result = optimizeForLiability({
      schedule, employees, shifts: [workShift, offShift], stations: [station('s1')], holidays: [], config: baseConfig(),
    });
    // Verify B never exceeds cap in the result.
    let bHours = 0;
    for (const e of Object.values(result.schedule.b)) {
      if (e.shiftCode === 'M') bHours += 8;
    }
    expect(bHours).toBeLessThanOrEqual(192);
  });
});

void Object.fromEntries(([] as [string, PublicHoliday[]][]));
