import { describe, it, expect } from 'vitest';
import { analyzeOT, suggestMitigations } from '../otAnalysis';
import { baseHourlyRate } from '../payroll';
import { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../../types';

const config: Config = {
  company: 'Test', year: 2026, month: 1, daysInMonth: 31,
  weekendPolicy: 'Friday Only', weeklyRestDayPrimary: 6,
  continuousShiftsMode: 'OFF', coverageMin: 1, maxConsecWorkDays: 6,
  standardDailyHrsCap: 8, hazardousDailyHrsCap: 7,
  standardWeeklyHrsCap: 48, hazardousWeeklyHrsCap: 36,
  minRestBetweenShiftsHrs: 11, shopOpeningTime: '09:00', shopClosingTime: '17:00',
  peakDays: [], holidays: [], otRateDay: 1.5, otRateNight: 2.0,
};

const FS: Shift = { code: 'FS', name: 'Full', start: '09:00', end: '17:00', durationHrs: 8, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: '' };
const OFF: Shift = { code: 'OFF', name: 'Off', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };

const STATION_A: Station = { id: 'ST-A', name: 'Station A', normalMinHC: 1, peakMinHC: 1, openingTime: '09:00', closingTime: '17:00' };
const STATION_B: Station = { id: 'ST-B', name: 'Station B', normalMinHC: 1, peakMinHC: 1, openingTime: '09:00', closingTime: '17:00' };

const mkEmp = (id: string, salary: number = 1_500_000): Employee => ({
  empId: id, name: id, role: 'Operator', department: 'Ops',
  contractType: 'Permanent', contractedWeeklyHrs: 48, shiftEligibility: 'All',
  isHazardous: false, isIndustrialRotating: false, hourExempt: false,
  fixedRestDay: 6, phone: '', hireDate: '2024-01-01', notes: '',
  eligibleStations: [], holidayBank: 0, annualLeaveBalance: 21,
  baseMonthlySalary: salary, baseHourlyRate: Math.round(salary / 192),
  overtimeHours: 0, category: 'Standard',
});

// Helper: build a schedule of N FS shifts at a given station for an employee.
const sched = (empId: string, stationId: string, days: number[]): Schedule => ({
  [empId]: Object.fromEntries(days.map(d => [d, { shiftCode: 'FS', stationId }])),
});

describe('analyzeOT — empty / clean', () => {
  it('returns zeros when there is no schedule', () => {
    const a = analyzeOT([mkEmp('A')], {}, [FS, OFF], [STATION_A], [], config);
    expect(a.totalOTPay).toBe(0);
    expect(a.totalOverCapHours).toBe(0);
    expect(a.totalHolidayHours).toBe(0);
    expect(a.byEmployee).toHaveLength(0);
    expect(a.byStation).toHaveLength(0);
  });

  it('returns zeros when nobody is over the cap and no holidays were worked', () => {
    // 24 days × 8h = 192h = exactly the monthly cap. No holidays scheduled.
    const days = Array.from({ length: 24 }, (_, i) => i + 1);
    const a = analyzeOT([mkEmp('A')], sched('A', 'ST-A', days), [FS, OFF], [STATION_A], [], config);
    expect(a.totalOTPay).toBe(0);
  });
});

describe('analyzeOT — over-cap pool', () => {
  it('counts hours above the monthly cap as over-cap OT (paid at 1.5x)', () => {
    // 25 days × 8h = 200h. Cap = 192. 8h over.
    const days = Array.from({ length: 25 }, (_, i) => i + 1);
    const emp = mkEmp('A', 1_500_000);
    const hourly = baseHourlyRate(emp, config);
    const a = analyzeOT([emp], sched('A', 'ST-A', days), [FS, OFF], [STATION_A], [], config);

    expect(a.totalOverCapHours).toBe(8);
    expect(a.totalHolidayHours).toBe(0);
    // 8h * hourly * 1.5 (rounding-tolerant)
    expect(a.totalOverCapPay).toBe(Math.round(8 * hourly * 1.5));
    expect(a.byEmployee[0].overCapHours).toBe(8);
    expect(a.byEmployee[0].holidayHours).toBe(0);
  });

  it('attributes over-cap OT to the station the employee actually worked at', () => {
    // 25 days × 8h = 200h. 20 days at ST-A, 5 days at ST-B. 8h over the cap.
    // Station-A share = 160/200 = 0.8 → 6.4h. Station-B share = 0.2 → 1.6h.
    const aDays = Array.from({ length: 20 }, (_, i) => i + 1);
    const bDays = Array.from({ length: 5 }, (_, i) => i + 21);
    const schedule: Schedule = {
      A: {
        ...Object.fromEntries(aDays.map(d => [d, { shiftCode: 'FS', stationId: 'ST-A' }])),
        ...Object.fromEntries(bDays.map(d => [d, { shiftCode: 'FS', stationId: 'ST-B' }])),
      },
    };
    const a = analyzeOT([mkEmp('A')], schedule, [FS, OFF], [STATION_A, STATION_B], [], config);

    const stA = a.byStation.find(s => s.stationId === 'ST-A');
    const stB = a.byStation.find(s => s.stationId === 'ST-B');
    expect(stA?.overCapHours).toBeCloseTo(6.4, 1);
    expect(stB?.overCapHours).toBeCloseTo(1.6, 1);
  });
});

describe('analyzeOT — holiday-premium pool', () => {
  it('counts every holiday hour worked (paid at 2.0x) regardless of cap', () => {
    // Worked exactly 8h on a holiday — under the monthly cap, but the
    // holiday premium still applies.
    const holiday: PublicHoliday = { date: '2026-01-05', name: 'Test', type: 'National', legalReference: 'Art. 74' };
    const emp = mkEmp('A', 1_500_000);
    const hourly = baseHourlyRate(emp, config);
    const a = analyzeOT([emp], sched('A', 'ST-A', [5]), [FS, OFF], [STATION_A], [holiday], config);

    expect(a.totalHolidayHours).toBe(8);
    expect(a.totalOverCapHours).toBe(0);
    // 8 * hourly * 2.0
    expect(a.totalHolidayPay).toBe(Math.round(8 * hourly * 2.0));
    expect(a.byEmployee[0].holidayHours).toBe(8);
  });

  it('attributes holiday hours directly to the station worked', () => {
    const holiday: PublicHoliday = { date: '2026-01-05', name: 'Test', type: 'National', legalReference: 'Art. 74' };
    const a = analyzeOT([mkEmp('A')], sched('A', 'ST-A', [5]), [FS, OFF], [STATION_A], [holiday], config);
    const stA = a.byStation.find(s => s.stationId === 'ST-A');
    expect(stA?.holidayHours).toBe(8);
  });

  it('lists the active month\'s holidays in the result', () => {
    const holidays: PublicHoliday[] = [
      { date: '2026-01-05', name: 'In-month', type: 'National', legalReference: 'Art. 74' },
      { date: '2026-02-15', name: 'Out-of-month', type: 'National', legalReference: 'Art. 74' },
    ];
    const a = analyzeOT([mkEmp('A')], sched('A', 'ST-A', [5]), [FS, OFF], [STATION_A], holidays, config);
    expect(a.holidaysThisMonth).toHaveLength(1);
    expect(a.holidaysThisMonth[0].name).toBe('In-month');
  });
});

describe('analyzeOT — does not double-count holiday hours', () => {
  it('subtracts holiday hours from the over-cap pool when the employee worked both', () => {
    // Worked 25 days × 8h = 200h. 16h of those were on holidays. 8h over-cap.
    // payableOverCap = max(0, 8 - 16) = 0. Holiday pool covers everything.
    const holidays: PublicHoliday[] = [
      { date: '2026-01-01', name: 'H1', type: 'National', legalReference: 'Art. 74' },
      { date: '2026-01-02', name: 'H2', type: 'National', legalReference: 'Art. 74' },
    ];
    const days = Array.from({ length: 25 }, (_, i) => i + 1);
    const a = analyzeOT([mkEmp('A')], sched('A', 'ST-A', days), [FS, OFF], [STATION_A], holidays, config);

    expect(a.totalHolidayHours).toBe(16);
    // overCapHours raw = 8, but payableOverCapHours = max(0, 8 - 16) = 0.
    expect(a.totalOverCapHours).toBe(0);
    // Pay: 0 × 1.5 + 16 × hourly × 2.0
    expect(a.totalOverCapPay).toBe(0);
    expect(a.totalHolidayPay).toBeGreaterThan(0);
  });

  // v5.5.0 — the previous test only covered the case where premium is owed
  // (no CP scheduled). The user's real-data trial hit the OTHER branch:
  // working a 4-day holiday end-of-month, comp days landed in next month
  // (premium NOT owed) — but the worker was still billed 1.5× over-cap on
  // the 4 holiday days that inflated total hours past the cap. v5.5
  // subtracts compensatedHolidayHours too, so the comp day fully absorbs
  // those hours from the OT pool.
  it('subtracts compensated holiday hours too — comp day means no 1.5× OT either', () => {
    // 4-day holiday at end of month (Jan 28-31). Worker covers all 4 days.
    // Earlier in the month they worked 24 normal days. Total = 28 work days
    // × 8h = 224h. Cap = 192. Raw over-cap = 32h. 32h on holidays.
    const holidays: PublicHoliday[] = [
      { date: '2026-01-28', name: 'Eid d1', type: 'Religious', legalReference: 'Art. 74' },
      { date: '2026-01-29', name: 'Eid d2', type: 'Religious', legalReference: 'Art. 74' },
      { date: '2026-01-30', name: 'Eid d3', type: 'Religious', legalReference: 'Art. 74' },
      { date: '2026-01-31', name: 'Eid d4', type: 'Religious', legalReference: 'Art. 74' },
    ];
    const CP: Shift = { code: 'CP', name: 'Comp', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };
    // Work day 1-24, hold day 28-31. Days 25-27 unscheduled (off).
    const workDays = [...Array.from({ length: 24 }, (_, i) => i + 1), 28, 29, 30, 31];
    const schedule: Schedule = sched('A', 'ST-A', workDays);
    // Comp days planned in February (next month).
    const nextSched: Schedule = { A: { 5: { shiftCode: 'CP' }, 12: { shiftCode: 'CP' }, 19: { shiftCode: 'CP' }, 26: { shiftCode: 'CP' } } };
    const allSchedules = { 'scheduler_schedule_2026_2': nextSched };

    const a = analyzeOT([mkEmp('A')], schedule, [FS, OFF, CP], [STATION_A], holidays, config, allSchedules);

    expect(a.totalHolidayHours).toBe(32);
    // All 4 holidays have a CP within window → premium NOT owed → premiumHours = 0.
    expect(a.totalHolidayPay).toBe(0);
    // Raw over-cap = 224 - 192 = 32. Subtract premium (0) + compensated (32) → 0.
    // Pre-v5.5 this would have been 32 (the bug). Post-v5.5: 0.
    expect(a.totalOverCapHours).toBe(0);
    expect(a.totalOverCapPay).toBe(0);
  });
});

describe('analyzeOT — Art. 74 comp-day vs cash-ot (v2.1)', () => {
  const holiday: PublicHoliday = { date: '2026-01-05', name: 'Test', type: 'National', legalReference: 'Art. 74' };

  it('pays 2× when no comp day is scheduled within the window', () => {
    // Default mode is comp-day, but with no CP/OFF granted after the
    // holiday the premium is owed.
    const emp = mkEmp('A', 1_500_000);
    const hourly = baseHourlyRate(emp, config);
    const a = analyzeOT([emp], sched('A', 'ST-A', [5]), [FS, OFF], [STATION_A], [holiday], config);
    expect(a.totalHolidayHours).toBe(8);
    expect(a.totalHolidayPay).toBe(Math.round(8 * hourly * 2.0));
  });

  it('pays 1× (no premium) when a CP comp day lands inside the window', () => {
    // CP scheduled 3 days after the holiday — premium is NOT owed.
    const CP: Shift = { code: 'CP', name: 'Comp', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };
    const emp = mkEmp('A', 1_500_000);
    const schedule: Schedule = {
      A: {
        5: { shiftCode: 'FS', stationId: 'ST-A' },
        8: { shiftCode: 'CP' },
      },
    };
    const a = analyzeOT([emp], schedule, [FS, OFF, CP], [STATION_A], [holiday], config);
    expect(a.totalHolidayHours).toBe(8);
    expect(a.totalHolidayPay).toBe(0);
  });

  it('pays 2× when the holiday is in cash-ot mode regardless of CP', () => {
    const cashHoliday: PublicHoliday = { ...holiday, compMode: 'cash-ot' };
    const CP: Shift = { code: 'CP', name: 'Comp', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };
    const emp = mkEmp('A', 1_500_000);
    const hourly = baseHourlyRate(emp, config);
    const schedule: Schedule = {
      A: {
        5: { shiftCode: 'FS', stationId: 'ST-A' },
        8: { shiftCode: 'CP' },
      },
    };
    const a = analyzeOT([emp], schedule, [FS, OFF, CP], [STATION_A], [cashHoliday], config);
    expect(a.totalHolidayHours).toBe(8);
    expect(a.totalHolidayPay).toBe(Math.round(8 * hourly * 2.0));
  });

  it('exposes per-date holiday breakdown for the UI', () => {
    const holidays: PublicHoliday[] = [
      { date: '2026-01-05', name: 'H1', type: 'National', legalReference: 'Art. 74' },
      { date: '2026-01-12', name: 'H2', type: 'National', legalReference: 'Art. 74' },
    ];
    const emp = mkEmp('A', 1_500_000);
    const a = analyzeOT([emp], sched('A', 'ST-A', [5, 12]), [FS, OFF], [STATION_A], holidays, config);
    const dates = a.byEmployee[0].holidayDates;
    expect(dates).toHaveLength(2);
    expect(dates.map(d => d.date).sort()).toEqual(['2026-01-05', '2026-01-12']);
  });
});

describe('suggestMitigations', () => {
  it('proposes hires when there is over-cap pressure', () => {
    const holidays: PublicHoliday[] = [];
    const days = Array.from({ length: 25 }, (_, i) => i + 1);
    const a = analyzeOT([mkEmp('A'), mkEmp('B')], sched('A', 'ST-A', days), [FS, OFF], [STATION_A], holidays, config);
    const mits = suggestMitigations(a, 1_500_000);
    const hire = mits.find(m => m.id === 'hire-overcap');
    expect(hire).toBeDefined();
    expect(hire?.count).toBeGreaterThanOrEqual(1);
  });

  it('proposes comp days when holiday hours were worked', () => {
    const holidays: PublicHoliday[] = [{ date: '2026-01-05', name: 'H', type: 'National', legalReference: 'Art. 74' }];
    const a = analyzeOT([mkEmp('A')], sched('A', 'ST-A', [5]), [FS, OFF], [STATION_A], holidays, config);
    const mits = suggestMitigations(a, 1_500_000);
    expect(mits.find(m => m.id === 'comp-day-holiday')).toBeDefined();
  });

  it('returns no mitigations on a clean run', () => {
    const a = analyzeOT([mkEmp('A')], {}, [FS, OFF], [STATION_A], [], config);
    expect(suggestMitigations(a, 1_500_000)).toHaveLength(0);
  });
});
