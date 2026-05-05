import { describe, expect, it } from 'vitest';
import { diagnoseUnfilledCoverage, groupUnfilledByStationDay } from '../coverageDiagnostics';
import type { Config, Schedule, Shift, Station, Employee } from '../../types';

const cfg = (over: Partial<Config> = {}): Config => ({
  company: 'Test',
  year: 2026, month: 5, daysInMonth: 7,
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
  shopClosingTime: '19:00',
  peakDays: [],
  otRateDay: 1.5,
  otRateNight: 2.0,
  ...over,
});

const station = (over: Partial<Station> = {}): Station => ({
  id: over.id || 's1',
  name: over.name || 'Cashier',
  normalMinHC: over.normalMinHC ?? 1,
  peakMinHC: over.peakMinHC ?? 1,
  openingTime: over.openingTime || '11:00',
  closingTime: over.closingTime || '19:00',
  ...over,
});

const employee = (over: Partial<Employee>): Employee => ({
  empId: over.empId || 'e1',
  name: over.name || 'Alice',
  role: 'Cashier',
  department: 'Floor',
  contractType: 'Permanent',
  contractedWeeklyHrs: 48,
  shiftEligibility: 'All',
  isHazardous: false,
  isIndustrialRotating: true,
  hourExempt: false,
  fixedRestDay: 0,
  phone: '',
  hireDate: '2020-01-01',
  notes: '',
  eligibleStations: ['s1'],
  holidayBank: 0,
  annualLeaveBalance: 21,
  baseMonthlySalary: 1_500_000,
  baseHourlyRate: 8000,
  overtimeHours: 0,
  category: 'Standard',
  ...over,
});

const morningShift: Shift = {
  code: 'M1', name: 'Morning', start: '11:00', end: '19:00',
  durationHrs: 8, breakMin: 60,
  isIndustrial: false, isHazardous: false, isWork: true, description: '',
};

const al: Shift = {
  code: 'AL', name: 'Annual Leave', start: '00:00', end: '00:00',
  durationHrs: 0, breakMin: 0,
  isIndustrial: false, isHazardous: false, isWork: false, description: '',
};

const noPeak = (_d: number) => false;

describe('diagnoseUnfilledCoverage', () => {
  it('returns empty when coverage is fully met', () => {
    const sched: Schedule = { e1: { 1: { shiftCode: 'M1', stationId: 's1' } } };
    const result = diagnoseUnfilledCoverage({
      schedule: sched,
      employees: [employee({ empId: 'e1' })],
      shifts: [morningShift, al],
      stations: [station()],
      holidays: [],
      config: cfg({ daysInMonth: 1 }),
      isPeakDay: noPeak,
    });
    expect(result).toHaveLength(0);
  });

  it('flags no-eligible-employees when nobody can work the station', () => {
    const sched: Schedule = {};
    const result = diagnoseUnfilledCoverage({
      schedule: sched,
      employees: [employee({ empId: 'e1', eligibleStations: ['OTHER'] })],
      shifts: [morningShift],
      stations: [station()],
      holidays: [],
      config: cfg({ daysInMonth: 1 }),
      isPeakDay: noPeak,
    });
    expect(result.length).toBe(8); // 11..18 hours, 8 slots
    expect(result.every(r => r.reason === 'no-eligible-employees')).toBe(true);
    expect(result[0].assigned).toBe(0);
    expect(result[0].required).toBe(1);
  });

  it('flags all-eligible-on-leave when the only eligible person is on AL', () => {
    const sched: Schedule = { e1: { 1: { shiftCode: 'AL', stationId: undefined } } };
    const result = diagnoseUnfilledCoverage({
      schedule: sched,
      employees: [employee({
        empId: 'e1',
        leaveRanges: [{ id: 'r1', type: 'annual', start: '2026-05-01', end: '2026-05-01' }],
      })],
      shifts: [morningShift, al],
      stations: [station()],
      holidays: [],
      config: cfg({ daysInMonth: 1 }),
      isPeakDay: noPeak,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(r => r.reason === 'all-eligible-on-leave')).toBe(true);
    expect(result[0].blockedEmpIds).toContain('e1');
  });

  it('flags all-eligible-already-scheduled when everyone is on a different work shift', () => {
    // Two stations, two employees both eligible for s1 only. Both already
    // assigned to a work shift on day 1 but at the WRONG station. The
    // gap at s1 is then "all eligible already scheduled (elsewhere)".
    const sched: Schedule = {
      e1: { 1: { shiftCode: 'M1', stationId: 'OTHER' } },
      e2: { 1: { shiftCode: 'M1', stationId: 'OTHER' } },
    };
    const result = diagnoseUnfilledCoverage({
      schedule: sched,
      employees: [
        employee({ empId: 'e1', eligibleStations: ['s1'] }),
        employee({ empId: 'e2', eligibleStations: ['s1'] }),
      ],
      shifts: [morningShift],
      stations: [station()],
      holidays: [],
      config: cfg({ daysInMonth: 1 }),
      isPeakDay: noPeak,
    });
    expect(result.every(r => r.reason === 'all-eligible-already-scheduled')).toBe(true);
  });

  it('flags all-eligible-fixed-rest when everyone has fixedRestDay matching DOW', () => {
    // 2026-05-01 is a Friday → DOW=6 in the 1=Sun..7=Sat convention.
    const sched: Schedule = {};
    const result = diagnoseUnfilledCoverage({
      schedule: sched,
      employees: [employee({ empId: 'e1', fixedRestDay: 6 })],
      shifts: [morningShift],
      stations: [station()],
      holidays: [],
      config: cfg({ daysInMonth: 1 }),
      isPeakDay: noPeak,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].reason).toBe('all-eligible-fixed-rest');
  });

  it('groups per-hour slots by station+day with summed shortfall', () => {
    const slots = [
      { day: 1, stationId: 's1', stationName: 'Cashier', hour: 11, required: 2, assigned: 1, reason: 'all-eligible-already-scheduled' as const, blockedEmpIds: ['e1'] },
      { day: 1, stationId: 's1', stationName: 'Cashier', hour: 12, required: 2, assigned: 1, reason: 'all-eligible-already-scheduled' as const, blockedEmpIds: ['e1'] },
      { day: 1, stationId: 's1', stationName: 'Cashier', hour: 13, required: 2, assigned: 0, reason: 'all-eligible-already-scheduled' as const, blockedEmpIds: ['e1', 'e2'] },
      { day: 2, stationId: 's1', stationName: 'Cashier', hour: 11, required: 1, assigned: 0, reason: 'no-eligible-employees' as const, blockedEmpIds: [] },
    ];
    const groups = groupUnfilledByStationDay(slots);
    expect(groups).toHaveLength(2);
    expect(groups[0].hours).toEqual([11, 12, 13]);
    expect(groups[0].totalShortfall).toBe(1 + 1 + 2);
    expect(groups[0].blockedEmpIds).toEqual(['e1', 'e2']);
    expect(groups[1].day).toBe(2);
    expect(groups[1].reason).toBe('no-eligible-employees');
  });
});
