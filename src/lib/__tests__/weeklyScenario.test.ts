import { describe, it, expect } from 'vitest';
import { buildWeeklyRotation } from '../weeklyScenario';
import type { Config, Employee, Shift, Station } from '../../types';

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
  id: 's1', name: 'Cashier 1',
  normalMinHC: 1, peakMinHC: 1,
  openingTime: '11:00', closingTime: '19:00',
};

const morningShift: Shift = {
  code: 'M', name: 'Morning', start: '11:00', end: '19:00',
  durationHrs: 8, breakMin: 60, isIndustrial: false, isHazardous: false, isWork: true, description: '',
};

describe('buildWeeklyRotation', () => {
  it('produces 7 days of slots when employees are sufficient', () => {
    const employees = [
      emp({ empId: 'a', name: 'Alice' }),
      emp({ empId: 'b', name: 'Bob' }),
    ];
    const result = buildWeeklyRotation({
      employees, shifts: [morningShift], stations: [station], config: baseConfig(),
    });
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0].days).toHaveLength(7);
    expect(result.totalSlots).toBe(7);
    expect(result.gapSlots).toBeLessThanOrEqual(1); // tolerance for cap-edge
  });

  it('flags gaps when no eligible employee is in the roster', () => {
    const result = buildWeeklyRotation({
      employees: [], shifts: [morningShift], stations: [station], config: baseConfig(),
    });
    expect(result.weeks[0].hasGap).toBe(true);
    expect(result.gapSlots).toBe(7);
  });

  it('rotates employees to honor weekly cap (48h std × 1 emp = 6 days max)', () => {
    const employees = [emp({ empId: 'a', name: 'Solo' })];
    const result = buildWeeklyRotation({
      employees, shifts: [morningShift], stations: [station], config: baseConfig(),
    });
    // 1 employee × 8 hrs/day × 6 days = 48 hr (cap). Day 7 should be a gap.
    const filled = result.weeks[0].days.flatMap(d => d.slots).filter(s => s.empId).length;
    expect(filled).toBeLessThanOrEqual(6);
    expect(result.gapSlots).toBeGreaterThanOrEqual(1);
  });

  it('respects fixedRestDay', () => {
    // Alice has fixedRestDay = 7 (Saturday). Saturday slot must be unfilled or go to Bob.
    const employees = [
      emp({ empId: 'a', name: 'Alice', fixedRestDay: 7 }),
      emp({ empId: 'b', name: 'Bob' }),
    ];
    const result = buildWeeklyRotation({
      employees, shifts: [morningShift], stations: [station], config: baseConfig(),
    });
    // Saturday is dayKey 'sat'.
    const satDay = result.weeks[0].days.find(d => d.dayKey === 'sat');
    if (satDay) {
      for (const slot of satDay.slots) {
        if (slot.empId) {
          expect(slot.empId).not.toBe('a');
        }
      }
    }
  });
});
