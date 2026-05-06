import { describe, it, expect } from 'vitest';
import { simulateWhatIf } from '../whatIfSimulator';
import type { Config, Employee, Shift, Station, Schedule } from '../../types';

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

const station: Station = {
  id: 's1', name: 'Cashier',
  normalMinHC: 1, peakMinHC: 1,
  openingTime: '11:00', closingTime: '19:00',
};
const workShift: Shift = {
  code: 'M', name: 'Morning', start: '11:00', end: '19:00',
  durationHrs: 8, breakMin: 60, isIndustrial: false, isHazardous: false, isWork: true, description: '',
};
const offShift: Shift = {
  code: 'OFF', name: 'Off', start: '00:00', end: '00:00',
  durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '',
};

describe('simulateWhatIf', () => {
  it('hire change adds N synthetic employees and increases payroll', () => {
    const employees = [emp({ empId: 'a', name: 'A' })];
    const schedule: Schedule = {};
    const result = simulateWhatIf({
      baseEmployees: employees,
      shifts: [workShift, offShift],
      stations: [station],
      holidays: [],
      config: baseConfig(),
      isPeakDay: () => false,
      baseSchedule: schedule,
      changes: [{ kind: 'hire', count: 2, role: 'Standard' }],
    });
    expect(result.syntheticEmployees).toHaveLength(2);
    expect(result.delta.rosterSize).toBe(2);
    expect(result.delta.monthlyPayroll).toBeGreaterThan(0);
  });

  it('release change removes N employees and decreases payroll', () => {
    const employees = [
      emp({ empId: 'a', name: 'A' }),
      emp({ empId: 'b', name: 'B' }),
      emp({ empId: 'c', name: 'C' }),
    ];
    const schedule: Schedule = {};
    const result = simulateWhatIf({
      baseEmployees: employees,
      shifts: [workShift, offShift],
      stations: [station],
      holidays: [],
      config: baseConfig(),
      isPeakDay: () => false,
      baseSchedule: schedule,
      changes: [{ kind: 'release', count: 1, role: 'Standard' }],
    });
    expect(result.delta.rosterSize).toBe(-1);
    expect(result.delta.monthlyPayroll).toBeLessThan(0);
  });

  it('cross-train change updates eligibleGroups without changing roster size', () => {
    const employees = [emp({ empId: 'a', name: 'A', eligibleGroups: [] })];
    const schedule: Schedule = {};
    const result = simulateWhatIf({
      baseEmployees: employees,
      shifts: [workShift, offShift],
      stations: [station],
      holidays: [],
      config: baseConfig(),
      isPeakDay: () => false,
      baseSchedule: schedule,
      changes: [{ kind: 'cross-train', empId: 'a', addEligibleGroups: ['g1'] }],
    });
    expect(result.delta.rosterSize).toBe(0);
    expect(result.delta.monthlyPayroll).toBe(0);
  });

  it('produces a verdict string summarising the deltas', () => {
    const employees = [emp({ empId: 'a', name: 'A' })];
    const result = simulateWhatIf({
      baseEmployees: employees,
      shifts: [workShift, offShift],
      stations: [station],
      holidays: [],
      config: baseConfig(),
      isPeakDay: () => false,
      baseSchedule: {},
      changes: [{ kind: 'hire', count: 1, role: 'Standard' }],
    });
    expect(typeof result.verdict).toBe('string');
    expect(result.verdict.length).toBeGreaterThan(0);
  });
});
