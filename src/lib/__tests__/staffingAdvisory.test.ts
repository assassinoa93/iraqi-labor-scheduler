import { describe, it, expect } from 'vitest';
import { computeStaffingAdvisory, StaffingArgs } from '../staffingAdvisory';
import { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../../types';

const baseConfig: Config = {
  company: 'Test',
  year: 2026,
  month: 1,
  daysInMonth: 31,
  weekendPolicy: 'Friday Only',
  weeklyRestDayPrimary: 6,
  continuousShiftsMode: 'OFF',
  coverageMin: 1,
  maxConsecWorkDays: 6,
  standardDailyHrsCap: 8,
  hazardousDailyHrsCap: 7,
  standardWeeklyHrsCap: 48,
  hazardousWeeklyHrsCap: 36,
  minRestBetweenShiftsHrs: 11,
  shopOpeningTime: '09:00',
  shopClosingTime: '21:00',
  peakDays: [5, 6, 7],
  holidays: [],
  otRateDay: 1.5,
  otRateNight: 2.0,
};

const mkEmp = (id: string, salary: number): Employee => ({
  empId: id, name: id, role: 'Operator', department: 'Ops',
  contractType: 'Permanent', contractedWeeklyHrs: 48, shiftEligibility: 'All',
  isHazardous: false, isIndustrialRotating: false, hourExempt: false,
  fixedRestDay: 6, phone: '', hireDate: '2024-01-01', notes: '',
  eligibleStations: [], holidayBank: 0, annualLeaveBalance: 21,
  baseMonthlySalary: salary, baseHourlyRate: Math.round(salary / 192),
  overtimeHours: 0, category: 'Standard',
});

const baseArgs = (overrides: Partial<StaffingArgs> = {}): StaffingArgs => ({
  employees: [mkEmp('E1', 1_200_000), mkEmp('E2', 1_500_000)],
  schedule: {} as Schedule,
  shifts: [] as Shift[],
  stations: [] as Station[],
  holidays: [] as PublicHoliday[],
  config: baseConfig,
  isPeakDay: () => false,
  totalOTHours: 0,
  totalOTPay: 0,
  stationGaps: [],
  ...overrides,
});

describe('computeStaffingAdvisory — eliminateOT mode', () => {
  it('recommends zero hires when there is no OT', () => {
    const advisory = computeStaffingAdvisory(baseArgs({ totalOTHours: 0 }));
    expect(advisory.eliminateOT.hiresNeeded).toBe(0);
    expect(advisory.eliminateOT.monthlyOTSaved).toBe(0);
  });

  it('rounds up to one hire when OT is below a single FTE cap', () => {
    // 192h monthly cap, 50h OT → ceil(50/192) = 1
    const advisory = computeStaffingAdvisory(baseArgs({ totalOTHours: 50, totalOTPay: 500_000 }));
    expect(advisory.eliminateOT.hiresNeeded).toBe(1);
    expect(advisory.eliminateOT.monthlyOTSaved).toBe(500_000);
  });

  it('scales hires linearly with OT volume', () => {
    // 192h cap × 3 = 576h → 3 hires
    const advisory = computeStaffingAdvisory(baseArgs({ totalOTHours: 576, totalOTPay: 5_760_000 }));
    expect(advisory.eliminateOT.hiresNeeded).toBe(3);
  });

  it('flags net positive when OT cost exceeds added salary', () => {
    // 1 hire @ avg salary 1.35M, OT savings 2M → net +650k
    const advisory = computeStaffingAdvisory(baseArgs({ totalOTHours: 100, totalOTPay: 2_000_000 }));
    expect(advisory.eliminateOT.netMonthlyDelta).toBeGreaterThan(0);
  });

  it('flags net negative when added salary exceeds OT savings', () => {
    // 5 hires worth of OT, but OT cost is small → net negative
    const advisory = computeStaffingAdvisory(baseArgs({ totalOTHours: 1000, totalOTPay: 100_000 }));
    expect(advisory.eliminateOT.netMonthlyDelta).toBeLessThan(0);
  });
});

describe('computeStaffingAdvisory — optimalCoverage mode', () => {
  it('recommends zero hires when there is no coverage gap', () => {
    const advisory = computeStaffingAdvisory(baseArgs({ stationGaps: [] }));
    expect(advisory.optimalCoverage.hiresNeeded).toBe(0);
  });

  it('rounds the coverage gap up to a whole hire', () => {
    const advisory = computeStaffingAdvisory(baseArgs({
      stationGaps: [{ stationId: 'ST-A', stationName: 'A', gap: 2.3 }],
    }));
    expect(advisory.optimalCoverage.hiresNeeded).toBe(3);
  });

  it('reports salary added but no OT savings (different problem)', () => {
    const advisory = computeStaffingAdvisory(baseArgs({
      stationGaps: [{ stationId: 'ST-A', stationName: 'A', gap: 2 }],
    }));
    expect(advisory.optimalCoverage.monthlyOTSaved).toBe(0);
    expect(advisory.optimalCoverage.monthlySalaryAdded).toBeGreaterThan(0);
    expect(advisory.optimalCoverage.netMonthlyDelta).toBeLessThan(0);
  });

  it('clamps a negative coverage gap to zero', () => {
    const advisory = computeStaffingAdvisory(baseArgs({
      stationGaps: [{ stationId: 'ST-A', stationName: 'A', gap: -5 }],
    }));
    expect(advisory.optimalCoverage.hiresNeeded).toBe(0);
  });

  it('breaks down the hires per station with reason=gap', () => {
    const stations: Station[] = [
      { id: 'ST-A', name: 'Cashier 1', normalMinHC: 1, peakMinHC: 1, openingTime: '09:00', closingTime: '17:00' },
      { id: 'ST-B', name: 'Cashier 2', normalMinHC: 1, peakMinHC: 1, openingTime: '09:00', closingTime: '17:00' },
    ];
    const advisory = computeStaffingAdvisory(baseArgs({
      stations,
      stationGaps: [
        { stationId: 'ST-A', stationName: 'Cashier 1', gap: 2 },
        { stationId: 'ST-B', stationName: 'Cashier 2', gap: 1 },
      ],
    }));
    expect(advisory.optimalCoverage.perStation).toHaveLength(2);
    expect(advisory.optimalCoverage.perStation[0].stationName).toBe('Cashier 1');
    expect(advisory.optimalCoverage.perStation[0].hires).toBe(2);
    expect(advisory.optimalCoverage.perStation[0].reason).toBe('gap');
  });
});

describe('computeStaffingAdvisory — bestOfBoth mode', () => {
  it('takes the max of the OT-elim and coverage hires', () => {
    // OT → 2 hires, coverage → 5 hires → bestOfBoth = 5
    const advisory = computeStaffingAdvisory(baseArgs({
      totalOTHours: 384, // 2 FTE
      totalOTPay: 2_000_000,
      stationGaps: [{ stationId: 'ST-A', stationName: 'A', gap: 5 }],
    }));
    expect(advisory.eliminateOT.hiresNeeded).toBe(2);
    expect(advisory.optimalCoverage.hiresNeeded).toBe(5);
    expect(advisory.bestOfBoth.hiresNeeded).toBe(5);
  });

  it('credits the full OT savings even when the coverage path drives the number', () => {
    const advisory = computeStaffingAdvisory(baseArgs({
      totalOTHours: 100,
      totalOTPay: 1_000_000,
      stationGaps: [{ stationId: 'ST-A', stationName: 'A', gap: 4 }],
    }));
    expect(advisory.bestOfBoth.monthlyOTSaved).toBe(1_000_000);
  });

  it('matches eliminateOT when there is no coverage gap', () => {
    const advisory = computeStaffingAdvisory(baseArgs({
      totalOTHours: 200,
      totalOTPay: 1_500_000,
      stationGaps: [],
    }));
    expect(advisory.bestOfBoth.hiresNeeded).toBe(advisory.eliminateOT.hiresNeeded);
  });
});

describe('computeStaffingAdvisory — avgMonthlySalary', () => {
  it('averages across the existing roster', () => {
    const advisory = computeStaffingAdvisory(baseArgs());
    // (1.2M + 1.5M) / 2 = 1.35M
    expect(advisory.avgMonthlySalary).toBe(1_350_000);
  });

  it('falls back to the 1.5M IQD default when the roster is empty', () => {
    const advisory = computeStaffingAdvisory(baseArgs({ employees: [] }));
    expect(advisory.avgMonthlySalary).toBe(1_500_000);
  });
});
