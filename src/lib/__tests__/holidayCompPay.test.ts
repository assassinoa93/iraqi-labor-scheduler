import { describe, it, expect } from 'vitest';
import { computeHolidayPay } from '../holidayCompPay';
import { Employee, Shift, PublicHoliday, Config, Schedule } from '../../types';

const baseConfig: Config = {
  company: 'Test', year: 2026, month: 1, daysInMonth: 31,
  weekendPolicy: 'Friday Only', weeklyRestDayPrimary: 6,
  continuousShiftsMode: 'OFF', coverageMin: 1, maxConsecWorkDays: 6,
  standardDailyHrsCap: 8, hazardousDailyHrsCap: 7,
  standardWeeklyHrsCap: 48, hazardousWeeklyHrsCap: 36,
  minRestBetweenShiftsHrs: 11, shopOpeningTime: '09:00', shopClosingTime: '17:00',
  peakDays: [], holidays: [], otRateDay: 1.5, otRateNight: 2.0,
  holidayCompMode: 'comp-day', holidayCompWindowDays: 30, holidayCompRecommendedDays: 7,
};

const FS: Shift = { code: 'FS', name: 'Full', start: '09:00', end: '17:00', durationHrs: 8, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: '' };
const OFF: Shift = { code: 'OFF', name: 'Off', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };
const CP: Shift = { code: 'CP', name: 'Comp', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };

const emp: Employee = {
  empId: 'EMP-1', name: 'Test', role: 'Operator', department: 'Ops',
  contractType: 'Permanent', contractedWeeklyHrs: 48, shiftEligibility: 'All',
  isHazardous: false, isIndustrialRotating: false, hourExempt: false,
  fixedRestDay: 6, phone: '', hireDate: '2024-01-01', notes: '',
  eligibleStations: [], holidayBank: 0, annualLeaveBalance: 21,
  baseMonthlySalary: 1_500_000, baseHourlyRate: 7_812,
  overtimeHours: 0, category: 'Standard',
};

const HOURLY = 7_812;

describe('computeHolidayPay — comp-day mode', () => {
  it('charges no premium when a CP lands inside the window', () => {
    const holiday: PublicHoliday = { date: '2026-01-05', name: 'H', type: 'National', legalReference: 'Art. 74' };
    const schedule: Schedule = { 'EMP-1': { 5: { shiftCode: 'FS' }, 8: { shiftCode: 'CP' } } };
    const r = computeHolidayPay(emp, schedule, [FS, CP], [holiday], baseConfig, HOURLY);
    expect(r.totalHolidayHours).toBe(8);
    expect(r.premiumHolidayHours).toBe(0);
    expect(r.premiumPay).toBe(0);
    expect(r.perHoliday[0]?.compDayOffset).toBe(3);
  });

  it('treats a regular OFF as a comp day inside the window', () => {
    const holiday: PublicHoliday = { date: '2026-01-05', name: 'H', type: 'National', legalReference: 'Art. 74' };
    const schedule: Schedule = { 'EMP-1': { 5: { shiftCode: 'FS' }, 12: { shiftCode: 'OFF' } } };
    const r = computeHolidayPay(emp, schedule, [FS, OFF], [holiday], baseConfig, HOURLY);
    expect(r.premiumHolidayHours).toBe(0);
  });

  it('charges 2× when no comp day lands within 30 days', () => {
    const holiday: PublicHoliday = { date: '2026-01-05', name: 'H', type: 'National', legalReference: 'Art. 74' };
    const schedule: Schedule = { 'EMP-1': {} };
    for (let d = 5; d <= 31; d++) schedule['EMP-1'][d] = { shiftCode: 'FS' };
    const r = computeHolidayPay(emp, schedule, [FS], [holiday], baseConfig, HOURLY);
    expect(r.premiumHolidayHours).toBe(8);
    expect(r.premiumPay).toBe(8 * HOURLY * 2);
  });

  it('crosses the month boundary when a CP lands in next month inside the window', () => {
    // Holiday on Jan 28; CP on Feb 3 (offset 6 days). Without
    // allSchedules the helper can't see Feb → would over-bill premium.
    const lateHoliday: PublicHoliday = { date: '2026-01-28', name: 'Late', type: 'National', legalReference: 'Art. 74' };
    const schedule: Schedule = { 'EMP-1': { 28: { shiftCode: 'FS' } } };
    for (let d = 29; d <= 31; d++) schedule['EMP-1'][d] = { shiftCode: 'FS' };
    const nextSched: Schedule = { 'EMP-1': {} };
    for (let d = 1; d <= 2; d++) nextSched['EMP-1'][d] = { shiftCode: 'FS' };
    nextSched['EMP-1'][3] = { shiftCode: 'CP' };
    const allSchedules = { 'scheduler_schedule_2026_2': nextSched };

    // Without allSchedules → premium owed (false negative).
    const without = computeHolidayPay(emp, schedule, [FS, CP], [lateHoliday], baseConfig, HOURLY);
    expect(without.premiumHolidayHours).toBe(8);

    // With allSchedules → CP found, no premium.
    const withCross = computeHolidayPay(emp, schedule, [FS, CP], [lateHoliday], baseConfig, HOURLY, allSchedules);
    expect(withCross.premiumHolidayHours).toBe(0);
    expect(withCross.perHoliday[0]?.compDayOffset).toBe(6);
  });
});

describe('computeHolidayPay — cash-ot mode override', () => {
  it('always charges 2× when the holiday is in cash-ot mode regardless of CP', () => {
    const cashHoliday: PublicHoliday = { date: '2026-01-05', name: 'Cash', type: 'National', legalReference: 'Art. 74', compMode: 'cash-ot' };
    const schedule: Schedule = { 'EMP-1': { 5: { shiftCode: 'FS' }, 6: { shiftCode: 'CP' } } };
    const r = computeHolidayPay(emp, schedule, [FS, CP], [cashHoliday], baseConfig, HOURLY);
    expect(r.premiumHolidayHours).toBe(8);
    expect(r.premiumPay).toBe(8 * HOURLY * 2);
  });

  it('charges 2× globally when config default is cash-ot', () => {
    const cashConfig = { ...baseConfig, holidayCompMode: 'cash-ot' as const };
    const holiday: PublicHoliday = { date: '2026-01-05', name: 'H', type: 'National', legalReference: 'Art. 74' };
    const schedule: Schedule = { 'EMP-1': { 5: { shiftCode: 'FS' }, 6: { shiftCode: 'OFF' } } };
    const r = computeHolidayPay(emp, schedule, [FS, OFF], [holiday], cashConfig, HOURLY);
    expect(r.premiumHolidayHours).toBe(8);
  });

  it('lets a per-holiday compMode=comp-day override a global cash-ot default', () => {
    const cashConfig = { ...baseConfig, holidayCompMode: 'cash-ot' as const };
    const holiday: PublicHoliday = { date: '2026-01-05', name: 'H', type: 'National', legalReference: 'Art. 74', compMode: 'comp-day' };
    const schedule: Schedule = { 'EMP-1': { 5: { shiftCode: 'FS' }, 8: { shiftCode: 'CP' } } };
    const r = computeHolidayPay(emp, schedule, [FS, CP], [holiday], cashConfig, HOURLY);
    expect(r.premiumHolidayHours).toBe(0);
  });
});

describe('computeHolidayPay — bookkeeping', () => {
  it('returns zeros when the employee did not work the holiday', () => {
    const holiday: PublicHoliday = { date: '2026-01-05', name: 'H', type: 'National', legalReference: 'Art. 74' };
    const schedule: Schedule = { 'EMP-1': { 5: { shiftCode: 'OFF' } } };
    const r = computeHolidayPay(emp, schedule, [FS, OFF], [holiday], baseConfig, HOURLY);
    expect(r.totalHolidayHours).toBe(0);
    expect(r.perHoliday).toHaveLength(0);
  });

  it('skips holidays outside the active month', () => {
    const otherMonth: PublicHoliday = { date: '2026-02-15', name: 'Out', type: 'National', legalReference: 'Art. 74' };
    const schedule: Schedule = { 'EMP-1': { 5: { shiftCode: 'FS' } } };
    const r = computeHolidayPay(emp, schedule, [FS], [otherMonth], baseConfig, HOURLY);
    expect(r.totalHolidayHours).toBe(0);
    expect(r.perHoliday).toHaveLength(0);
  });
});
