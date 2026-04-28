import { describe, it, expect } from 'vitest';
import { detectCoverageGap, findSwapCandidates } from '../coverageHints';
import { Employee, Shift, Station, PublicHoliday, Config } from '../../types';

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

// Cashier station with normalMinHC=0 (matches the seed pattern).
const cashier: Station = {
  id: 'ST-C1', name: 'Cashier', normalMinHC: 0, peakMinHC: 1,
  openingTime: '09:00', closingTime: '17:00',
};

// Vehicle station with normalMinHC=1 (matches the driver seed pattern).
const vehicle: Station = {
  id: 'ST-V1', name: 'Van A', normalMinHC: 1, peakMinHC: 1,
  openingTime: '09:00', closingTime: '17:00', requiredRoles: ['Driver'],
};

const mkEmp = (id: string, overrides: Partial<Employee> = {}): Employee => ({
  empId: id, name: id, role: 'Cashier', department: 'Front',
  contractType: 'Permanent', contractedWeeklyHrs: 48, shiftEligibility: 'All',
  isHazardous: false, isIndustrialRotating: false, hourExempt: false,
  fixedRestDay: 6, phone: '', hireDate: '2024-01-01', notes: '',
  eligibleStations: ['ST-C1'], holidayBank: 0, annualLeaveBalance: 21,
  baseMonthlySalary: 1_500_000, baseHourlyRate: 7_812,
  overtimeHours: 0, category: 'Standard', ...overrides,
});

describe('detectCoverageGap — strict mode (manual paint)', () => {
  it('suppresses gap when station normalMinHC=0 on a non-peak day', () => {
    // Cashier worked the cashier station on a non-peak day → station does NOT
    // require headcount that day, so a manual paint clearing it is silent.
    const gap = detectCoverageGap({
      employees: [mkEmp('A')], shifts: [FS, OFF], stations: [cashier],
      holidays: [], config, schedule: {},
      empId: 'A', day: 5,
      prevEntry: { shiftCode: 'FS', stationId: 'ST-C1' },
      newEntry: { shiftCode: 'OFF' },
      isPeakDay: () => false,
    });
    expect(gap).toBeUndefined();
  });

  it('fires gap on a peak day when peakMinHC=1', () => {
    const gap = detectCoverageGap({
      employees: [mkEmp('A')], shifts: [FS, OFF], stations: [cashier],
      holidays: [], config, schedule: {},
      empId: 'A', day: 5,
      prevEntry: { shiftCode: 'FS', stationId: 'ST-C1' },
      newEntry: { shiftCode: 'OFF' },
      isPeakDay: () => true,
    });
    expect(gap?.station.id).toBe('ST-C1');
  });

  it('suppresses gap when prevEntry has no stationId', () => {
    const gap = detectCoverageGap({
      employees: [mkEmp('A')], shifts: [FS, OFF], stations: [cashier],
      holidays: [], config, schedule: {},
      empId: 'A', day: 5,
      prevEntry: { shiftCode: 'FS' },
      newEntry: { shiftCode: 'OFF' },
      isPeakDay: () => true,
    });
    expect(gap).toBeUndefined();
  });
});

describe('detectCoverageGap — permissive mode (leave pipeline)', () => {
  it('fires gap for a cashier on a non-peak day even though normalMinHC=0', () => {
    // Regression: pre-fix, leaves on cashier stations on non-peak days
    // produced no swap suggestions because the station did not "require"
    // headcount. The leave-pipeline now uses permissive mode so the
    // supervisor still sees substitute candidates.
    const gap = detectCoverageGap({
      employees: [mkEmp('A')], shifts: [FS, OFF], stations: [cashier],
      holidays: [], config, schedule: {},
      empId: 'A', day: 5,
      prevEntry: { shiftCode: 'FS', stationId: 'ST-C1' },
      newEntry: undefined,
      isPeakDay: () => false,
      permissive: true,
    });
    expect(gap?.station.id).toBe('ST-C1');
    expect(gap?.vacatedShiftCode).toBe('FS');
  });

  it('infers a station from emp.eligibleStations when prevEntry has no stationId', () => {
    const gap = detectCoverageGap({
      employees: [mkEmp('A', { eligibleStations: ['ST-C1'] })],
      shifts: [FS, OFF], stations: [cashier],
      holidays: [], config, schedule: {},
      empId: 'A', day: 5,
      prevEntry: { shiftCode: 'FS' }, // no stationId attached
      newEntry: undefined,
      isPeakDay: () => false,
      permissive: true,
    });
    expect(gap?.station.id).toBe('ST-C1');
  });

  it('fires gap for a driver on a vehicle station (existing driver behaviour preserved)', () => {
    const driver = mkEmp('D', { category: 'Driver', eligibleStations: ['ST-V1'], role: 'Driver' });
    const gap = detectCoverageGap({
      employees: [driver], shifts: [FS, OFF], stations: [vehicle],
      holidays: [], config, schedule: {},
      empId: 'D', day: 5,
      prevEntry: { shiftCode: 'FS', stationId: 'ST-V1' },
      newEntry: undefined,
      isPeakDay: () => false,
      permissive: true,
    });
    expect(gap?.station.id).toBe('ST-V1');
  });

  it('still suppresses when the prev shift was already non-work', () => {
    const gap = detectCoverageGap({
      employees: [mkEmp('A')], shifts: [FS, OFF], stations: [cashier],
      holidays: [], config, schedule: {},
      empId: 'A', day: 5,
      prevEntry: { shiftCode: 'OFF', stationId: 'ST-C1' },
      newEntry: undefined,
      isPeakDay: () => false,
      permissive: true,
    });
    expect(gap).toBeUndefined();
  });
});

describe('findSwapCandidates', () => {
  it('returns substitute cashiers for a vacated cashier shift', () => {
    const a = mkEmp('A', { eligibleStations: ['ST-C1', 'ST-C2'] });
    const b = mkEmp('B', { eligibleStations: ['ST-C1', 'ST-C2'] });
    const c = mkEmp('C', { eligibleStations: ['ST-C1', 'ST-C2'] });
    const gap = detectCoverageGap({
      employees: [a, b, c], shifts: [FS, OFF], stations: [cashier],
      holidays: [], config, schedule: {},
      empId: 'A', day: 5,
      prevEntry: { shiftCode: 'FS', stationId: 'ST-C1' },
      newEntry: undefined,
      isPeakDay: () => false,
      permissive: true,
    });
    expect(gap).toBeDefined();
    const suggestions = findSwapCandidates(gap!, {
      employees: [a, b, c], shifts: [FS, OFF], stations: [cashier],
      holidays: [], config, schedule: {}, isPeakDay: () => false,
    });
    expect(suggestions.length).toBe(2);
    expect(suggestions.map(s => s.empId).sort()).toEqual(['B', 'C']);
    expect(suggestions[0].isRecommended).toBe(true);
  });
});
