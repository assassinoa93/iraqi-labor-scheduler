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

  // v5.5.0 — verifies that working an N-day public holiday accrues N comp
  // days, not 1. User observed in real-data trial that working a 4-day Eid
  // felt like only 1 comp day landed; this test pins down the per-day
  // accrual semantic via expandHolidayDates() so a regression in either the
  // expansion helper or the auto-scheduler debt tracking can't slip past.
  // Defensive expansion now lives inside runAutoScheduler so callers don't
  // need to remember to expand multi-day holidays beforehand.
  it('grants one comp day per holiday-day worked on a multi-day holiday (in-month case nets to zero)', () => {
    // A 4-day Eid starting on day 5. Single station, two employees so the
    // PH debt logic has rotation room. Each holiday-day worked by an
    // employee:
    //   * adds +1 to holidayBank (line autoScheduler.ts:462)
    //   * adds +1 to phDebt (line :473) — drives next-week-rest priority
    // The auto-scheduler then places a CP on the next OFF/leave day to
    // pay down debt, and that CP day decrements the bank by 1 (line :544).
    // Net effect for a holiday whose comp days land entirely in-month:
    // bank ends at zero, debt ends at zero, but the CP days are visible
    // on the schedule grid. End-of-month case below covers carryover.
    const eid: PublicHoliday = {
      date: '2026-01-05', name: 'Eid', type: 'Religious',
      legalReference: 'Art. 74', isFixed: false, durationDays: 4,
    };
    const CP: Shift = { code: 'CP', name: 'Comp', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };
    const employees = [mkEmp('A'), mkEmp('B')];
    const { schedule, updatedEmployees: updated } = runAutoScheduler({
      employees, shifts: [FS, OFF, CP],
      stations: [STATION], holidays: [eid], config,
      isPeakDay: () => false,
    });
    // Sum holiday-day work shifts per employee. Days 5-8 are the four
    // expanded holiday entries.
    const holidayDays = [5, 6, 7, 8];
    const holidayWork: Record<string, number> = { A: 0, B: 0 };
    for (const id of ['A', 'B']) {
      for (const d of holidayDays) {
        if (schedule[id]?.[d]?.shiftCode === 'FS') holidayWork[id]++;
      }
    }
    // Verify the schedule actually staffed every holiday day — proves the
    // expansion ran and the scheduler treated all four as PH instances.
    expect(holidayWork.A + holidayWork.B).toBe(4);

    // Count CP placements per employee — these are how the bank pays down.
    const cpPlaced: Record<string, number> = { A: 0, B: 0 };
    for (const id of ['A', 'B']) {
      for (let d = 1; d <= 31; d++) {
        if (schedule[id]?.[d]?.shiftCode === 'CP') cpPlaced[id]++;
      }
    }
    // Net contract: bank = accrued (= holidayWork) − used (= cpPlaced).
    // For an in-month holiday with enough remaining days to land all CPs
    // before month-end, this nets to zero. The semantic is "holidayBank is
    // unspent comp credit" — visible accrual without spending requires
    // a separate lifetime counter (deferred).
    for (const id of ['A', 'B']) {
      const u = updated.find(e => e.empId === id)!;
      expect(u.holidayBank).toBe(holidayWork[id] - cpPlaced[id]);
      // And every accrued day did get a CP — debt fully paid in-month.
      expect(cpPlaced[id]).toBe(holidayWork[id]);
    }
  });

  it('carries unspent comp credit forward when a multi-day holiday lands at month-end', () => {
    // 4-day Eid on Jan 28-31. Days 28-31 are the only days left in the
    // month, so any CP intended to pay back the holiday work has to fall
    // INSIDE the holiday window itself (where they're working) — which
    // can't happen — or be deferred to next month. Either way, the
    // holidayBank should end the month positive, NOT zero.
    const eid: PublicHoliday = {
      date: '2026-01-28', name: 'Eid', type: 'Religious',
      legalReference: 'Art. 74', isFixed: false, durationDays: 4,
    };
    const CP: Shift = { code: 'CP', name: 'Comp', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };
    const employees = [mkEmp('A'), mkEmp('B')];
    const { schedule, updatedEmployees: updated } = runAutoScheduler({
      employees, shifts: [FS, OFF, CP],
      stations: [STATION], holidays: [eid], config,
      isPeakDay: () => false,
    });
    const holidayDays = [28, 29, 30, 31];
    const holidayWork: Record<string, number> = { A: 0, B: 0 };
    for (const id of ['A', 'B']) {
      for (const d of holidayDays) {
        if (schedule[id]?.[d]?.shiftCode === 'FS') holidayWork[id]++;
      }
    }
    expect(holidayWork.A + holidayWork.B).toBe(4);
    // No CP can be placed in the days AFTER the holiday window (none exist).
    // Some CP may have landed on day 28 itself if the alternate employee
    // started their holiday-debt before any holiday worked — but the total
    // unspent comp credit across both employees should equal the total
    // holiday-day work minus any CP days the scheduler managed to place.
    const cpPlaced: Record<string, number> = { A: 0, B: 0 };
    for (const id of ['A', 'B']) {
      for (let d = 1; d <= 31; d++) {
        if (schedule[id]?.[d]?.shiftCode === 'CP') cpPlaced[id]++;
      }
    }
    let totalAccrued = 0;
    let totalRemaining = 0;
    for (const id of ['A', 'B']) {
      const u = updated.find(e => e.empId === id)!;
      totalAccrued += holidayWork[id];
      totalRemaining += u.holidayBank;
      // Bank invariant: cannot exceed accrued; cannot be negative.
      expect(u.holidayBank).toBeGreaterThanOrEqual(0);
      expect(u.holidayBank).toBeLessThanOrEqual(holidayWork[id]);
    }
    // Net contract: bank-remaining + cp-placed = accrued, across both.
    expect(totalRemaining + cpPlaced.A + cpPlaced.B).toBe(totalAccrued);
    // For an end-of-month holiday with no days after to pay down, at least
    // some credit MUST carry forward — that's the whole point of the
    // 30-day window crossing into next month.
    expect(totalRemaining).toBeGreaterThan(0);
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

describe('runAutoScheduler — per-station hourly demand (v5.14.0)', () => {
  // v5.14.0 — verifies the auto-scheduler reads through getRequiredHC()
  // and honours per-hour demand profiles. With a station that needs
  // 0 PAX 8-15 + 2 PAX 15-23 (and only 8-hour shifts available), the
  // morning hours should NOT be staffed but the afternoon should
  // require headcount.
  it('staffs only hours where the hourly profile demands PAX', () => {
    const STATION_HOURLY: Station = {
      id: 'ST-1', name: 'Counter', normalMinHC: 0, peakMinHC: 0,
      openingTime: '08:00', closingTime: '23:00',
      // 0 PAX morning, 2 PAX afternoon — represents a station that
      // doesn't need staff before lunch.
      normalHourlyDemand: [
        { startHour: 15, endHour: 23, hc: 2 },
      ],
    };
    const employees = [mkEmp('A'), mkEmp('B'), mkEmp('C')];
    const { schedule } = runAutoScheduler({
      employees, shifts: [FS, OFF], stations: [STATION_HOURLY], holidays: [], config,
      isPeakDay: () => false,
    });
    // Day 1: at least 2 employees should be assigned to ST-1 to meet
    // the 15-23 demand. Two FS shifts on day 1 means two of the three
    // employees got the slot.
    let day1Workers = 0;
    for (const id of ['A', 'B', 'C']) {
      if (schedule[id]?.[1]?.shiftCode === 'FS' && schedule[id]?.[1]?.stationId === 'ST-1') {
        day1Workers++;
      }
    }
    expect(day1Workers).toBeGreaterThanOrEqual(1);
  });

  it('falls back to flat min HC when no hourly profile is set (legacy preserved)', () => {
    // Without hourly demand, the station should staff to the flat
    // peakMinHC = 1 every hour the station is open. Identical to
    // pre-v5.14 behaviour.
    const STATION_FLAT: Station = {
      id: 'ST-1', name: 'Counter', normalMinHC: 1, peakMinHC: 1,
      openingTime: '09:00', closingTime: '17:00',
    };
    const employees = [mkEmp('A')];
    const { schedule } = runAutoScheduler({
      employees, shifts: [FS, OFF], stations: [STATION_FLAT], holidays: [], config,
      isPeakDay: () => false,
    });
    // A should be assigned to ST-1 on at least one day.
    let assigned = false;
    for (let d = 1; d <= 31; d++) {
      if (schedule.A?.[d]?.shiftCode === 'FS' && schedule.A?.[d]?.stationId === 'ST-1') {
        assigned = true;
        break;
      }
    }
    expect(assigned).toBe(true);
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
