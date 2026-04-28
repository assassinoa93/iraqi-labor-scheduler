import { describe, it, expect } from 'vitest';
import { runAutoScheduler } from '../autoScheduler';
import { Employee, Shift, Station, PublicHoliday, Config } from '../../types';

// January 2026 has 31 days; January 1 falls on a Thursday so day 1 is dow=5.
const config: Config = {
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
  shopClosingTime: '17:00',
  peakDays: [],
  holidays: [],
  otRateDay: 1.5,
  otRateNight: 2.0,
};

const FS: Shift = { code: 'FS', name: 'Full', start: '09:00', end: '17:00', durationHrs: 8, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: '' };
const OFF: Shift = { code: 'OFF', name: 'Off', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };

const STATION: Station = {
  id: 'ST-1', name: 'Counter', normalMinHC: 1, peakMinHC: 1,
  openingTime: '09:00', closingTime: '17:00',
};

const mkEmp = (id: string): Employee => ({
  empId: id, name: id, role: 'Operator', department: 'Ops',
  contractType: 'Permanent', contractedWeeklyHrs: 48, shiftEligibility: 'All',
  isHazardous: false, isIndustrialRotating: false, hourExempt: false,
  fixedRestDay: 0, // rotating rest — no hard-pinned rest day so PH-debt sort matters
  phone: '', hireDate: '2024-01-01', notes: '',
  eligibleStations: ['ST-1'], holidayBank: 0, annualLeaveBalance: 21,
  baseMonthlySalary: 1_500_000, baseHourlyRate: 7_812,
  overtimeHours: 0, category: 'Standard',
});

describe('runAutoScheduler — PH comp-day debt tracking', () => {
  it('assigns a worker to a holiday day when the station requires coverage', () => {
    // peakMinHC=1 means even on a holiday the station needs one body. The
    // scheduler treats the PH-work as legal (Art. 74) and bills the comp via
    // the holiday-bank accumulator + phDebt rotation bias.
    const holiday: PublicHoliday = { date: '2026-01-05', name: 'Test', type: 'National', legalReference: 'Art. 74' };
    const employees = [mkEmp('A'), mkEmp('B')];
    const { schedule } = runAutoScheduler({
      employees, shifts: [FS, OFF], stations: [STATION], holidays: [holiday], config,
      isPeakDay: () => false,
    });
    const day5Codes = ['A', 'B'].map(id => schedule[id]?.[5]?.shiftCode);
    expect(day5Codes).toContain('FS');
  });

  it('rotates the PH-debtor to OFF within the comp window when an alternative is available', () => {
    // Two employees, single-station, peakMinHC=1 — only one needs to work each
    // day. With a holiday on day 1, whoever works it should be deprioritised
    // for the next ~7 days so they get their comp rest. We assert the PH
    // worker has at least one OFF in days 2..8 (the 7-day comp window).
    const holiday: PublicHoliday = { date: '2026-01-01', name: 'Test', type: 'National', legalReference: 'Art. 74' };
    const employees = [mkEmp('A'), mkEmp('B')];
    const { schedule } = runAutoScheduler({
      employees, shifts: [FS, OFF], stations: [STATION], holidays: [holiday], config,
      isPeakDay: () => false,
    });
    // Identify whoever was assigned the holiday work shift on day 1.
    const phWorker = ['A', 'B'].find(id => schedule[id]?.[1]?.shiftCode === 'FS');
    expect(phWorker).toBeDefined();
    // They should get at least one OFF in days 2-8 (the comp window).
    const compWindow = [2, 3, 4, 5, 6, 7, 8];
    const compWorkerOffs = compWindow.filter(d => schedule[phWorker!]?.[d]?.shiftCode === 'OFF');
    expect(compWorkerOffs.length).toBeGreaterThan(0);
  });

  it('keeps total monthly hours roughly balanced between two equivalent employees', () => {
    // Even with a holiday on day 1, the PH debt should keep the workload
    // distributed evenly — neither employee should end up with more than
    // ~16h (two full shifts) extra over the month-long greedy run.
    const holiday: PublicHoliday = { date: '2026-01-01', name: 'Test', type: 'National', legalReference: 'Art. 74' };
    const employees = [mkEmp('A'), mkEmp('B')];
    const { schedule } = runAutoScheduler({
      employees, shifts: [FS, OFF], stations: [STATION], holidays: [holiday], config,
      isPeakDay: () => false,
    });
    const totalHours = (id: string) => {
      let h = 0;
      for (let d = 1; d <= 31; d++) {
        if (schedule[id]?.[d]?.shiftCode === 'FS') h += 8;
      }
      return h;
    };
    const hA = totalHours('A');
    const hB = totalHours('B');
    expect(Math.abs(hA - hB)).toBeLessThanOrEqual(16);
  });

  it('writes OFF on every non-work day so the schedule grid is fully populated', () => {
    const employees = [mkEmp('A'), mkEmp('B')];
    const { schedule } = runAutoScheduler({
      employees, shifts: [FS, OFF], stations: [STATION], holidays: [], config,
      isPeakDay: () => false,
    });
    // Every (employee, day) pair should have an entry.
    for (const id of ['A', 'B']) {
      for (let d = 1; d <= 31; d++) {
        expect(schedule[id]?.[d]?.shiftCode).toBeDefined();
      }
    }
  });
});

describe('runAutoScheduler — preserveExisting mode', () => {
  it('does not overwrite a manually-painted leave cell', () => {
    const employees = [mkEmp('A'), mkEmp('B')];
    const preserveExisting = {
      A: { 5: { shiftCode: 'AL' as const } },
    };
    const { schedule } = runAutoScheduler({
      employees, shifts: [FS, OFF, { ...FS, code: 'AL', isWork: false, durationHrs: 0 }],
      stations: [STATION], holidays: [], config,
      isPeakDay: () => false,
      preserveExisting,
    });
    expect(schedule.A?.[5]?.shiftCode).toBe('AL');
  });
});
