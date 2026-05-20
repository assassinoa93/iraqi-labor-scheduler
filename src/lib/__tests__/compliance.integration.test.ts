import { describe, it, expect } from 'vitest';
import { ComplianceEngine } from '../compliance';
import { Employee, Shift, PublicHoliday, Config, Schedule } from '../../types';

// v5.22.1 — integration scenarios that exercise rule interactions across
// month boundaries, leave windows, and driver-specific caps. The unit
// suite in compliance.test.ts pins individual rules; this file pins the
// composite cases where two or more rules contend (e.g. weekly cap
// counting hours from the previous month, OT and annual leave on the
// same week, driver weekly cap vs. continuous-driving cap).

const baseConfig: Config = {
  company: 'Integration Test Co',
  year: 2026,
  month: 2, // February — chosen so January (prev) and March (next) are
            // each fully populatable in the cross-month scenarios.
  daysInMonth: 28,
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
  driverDailyHrsCap: 9,
  driverWeeklyHrsCap: 56,
  driverContinuousDrivingHrsCap: 4.5,
  driverMinDailyRestHrs: 11,
  driverMaxConsecWorkDays: 6,
  shopOpeningTime: '06:00',
  shopClosingTime: '22:00',
  peakDays: [5, 6, 7],
  holidays: [],
  otRateDay: 1.5,
  otRateNight: 2.0,
};

const baseEmployee: Employee = {
  empId: 'EMP-1',
  name: 'Integration Worker',
  role: 'Operator',
  department: 'Ops',
  contractType: 'Permanent',
  contractedWeeklyHrs: 48,
  shiftEligibility: 'All',
  isHazardous: false,
  isIndustrialRotating: false,
  hourExempt: false,
  fixedRestDay: 6,
  phone: '',
  hireDate: '2024-01-01',
  notes: '',
  eligibleStations: [],
  holidayBank: 0,
  annualLeaveBalance: 21,
  baseMonthlySalary: 1_200_000,
  baseHourlyRate: 6_250,
  overtimeHours: 0,
  category: 'Standard',
};

const FS: Shift = { code: 'FS', name: 'Full', start: '09:00', end: '17:00', durationHrs: 8, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: '' };
const OFF: Shift = { code: 'OFF', name: 'Off', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };
const AL: Shift = { code: 'AL', name: 'Annual Leave', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };
const DRIVE_8: Shift = { code: 'D8', name: 'Drive 8h', start: '06:00', end: '14:00', durationHrs: 8, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: '' };
const DRIVE_LONG: Shift = { code: 'DLONG', name: 'Long drive', start: '06:00', end: '17:00', durationHrs: 11, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: true, description: '' };

const monthKey = (year: number, month: number) => `scheduler_schedule_${year}_${month}`;

// ─── Month-boundary: rolling weekly cap ────────────────────────────────

describe('ComplianceEngine integration — weekly cap rolls across month boundary', () => {
  it('flags a 7-day rolling window that spans Jan→Feb when prior-month visibility is provided', () => {
    // Worker did 5×8h on Jan 28-31 (4 days)…
    const janSched: Schedule = {
      'EMP-1': {
        28: { shiftCode: 'FS' }, 29: { shiftCode: 'FS' },
        30: { shiftCode: 'FS' }, 31: { shiftCode: 'FS' },
      },
    };
    // …then 4×8h on Feb 1-3 (3 more days). 7 days × 8h = 56h > 48h cap.
    const febSched: Schedule = {
      'EMP-1': {
        1: { shiftCode: 'FS' }, 2: { shiftCode: 'FS' }, 3: { shiftCode: 'FS' },
      },
    };
    const allSchedules = { [monthKey(2026, 1)]: janSched };
    const v = ComplianceEngine.check([baseEmployee], [FS], [], baseConfig, febSched, allSchedules);
    expect(v.find(x => x.rule === 'Weekly hours cap')).toBeDefined();
  });

  it('does NOT flag the same Feb-only week when prior-month visibility is missing', () => {
    // Same Feb assignments, but without the Jan map the engine can only see
    // 3×8h = 24h. No flag expected — the engine doesn't fabricate carryover.
    const febSched: Schedule = {
      'EMP-1': {
        1: { shiftCode: 'FS' }, 2: { shiftCode: 'FS' }, 3: { shiftCode: 'FS' },
      },
    };
    const v = ComplianceEngine.check([baseEmployee], [FS], [], baseConfig, febSched);
    expect(v.find(x => x.rule === 'Weekly hours cap')).toBeUndefined();
  });
});

// ─── Month-boundary: consecutive-day streak ───────────────────────────

describe('ComplianceEngine integration — consecutive-day streak spans months', () => {
  it('flags a 7-day work streak that spans Jan→Feb when the prior-month map is provided', () => {
    // Jan 27-31 = 5 worked days, then Feb 1-2 = 2 more. Streak = 7, exceeds
    // the 6-day cap. Cross-month visibility is what makes this catchable.
    const janSched: Schedule = {
      'EMP-1': {
        27: { shiftCode: 'FS' }, 28: { shiftCode: 'FS' }, 29: { shiftCode: 'FS' },
        30: { shiftCode: 'FS' }, 31: { shiftCode: 'FS' },
      },
    };
    const febSched: Schedule = {
      'EMP-1': { 1: { shiftCode: 'FS' }, 2: { shiftCode: 'FS' } },
    };
    const allSchedules = { [monthKey(2026, 1)]: janSched };
    const v = ComplianceEngine.check([baseEmployee], [FS], [], baseConfig, febSched, allSchedules);
    expect(v.find(x => x.rule === 'Consecutive work days')).toBeDefined();
  });
});

// ─── Annual leave + OT interaction ─────────────────────────────────────

describe('ComplianceEngine integration — annual leave + weekly cap', () => {
  it('does not flag the weekly cap when AL fills the back half of the week (40h worked)', () => {
    const onLeave = { ...baseEmployee, annualLeaveStart: '2026-02-12', annualLeaveEnd: '2026-02-15' };
    // 4×8h on Mon-Thu, then AL Fri-Sun. 32h of paid leave shouldn't push
    // the worker over the 48h cap.
    const sched: Schedule = {
      'EMP-1': {
        9: { shiftCode: 'FS' }, 10: { shiftCode: 'FS' },
        11: { shiftCode: 'FS' }, 12: { shiftCode: 'AL' },
        13: { shiftCode: 'AL' }, 14: { shiftCode: 'AL' }, 15: { shiftCode: 'AL' },
      },
    };
    const v = ComplianceEngine.check([onLeave], [FS, AL], [], baseConfig, sched);
    expect(v.find(x => x.rule === 'Weekly hours cap')).toBeUndefined();
  });

  it('flags a work shift scheduled inside the annual-leave window (manual override)', () => {
    const onLeave = { ...baseEmployee, annualLeaveStart: '2026-02-12', annualLeaveEnd: '2026-02-15' };
    // Manager pulls EMP-1 in on Feb 13 despite the active AL window —
    // platform should surface that as a leave-window violation.
    const sched: Schedule = {
      'EMP-1': {
        12: { shiftCode: 'AL' }, 13: { shiftCode: 'FS' }, 14: { shiftCode: 'AL' },
      },
    };
    const v = ComplianceEngine.check([onLeave], [FS, AL], [], baseConfig, sched);
    const finding = v.find(x => x.rule.toLowerCase().includes('leave'));
    expect(finding).toBeDefined();
  });
});

// ─── Driver-specific cap stack ─────────────────────────────────────────

describe('ComplianceEngine integration — driver caps interact', () => {
  const driver: Employee = { ...baseEmployee, category: 'Driver' };

  it('flags both the daily driver cap (Art. 88) and any consecutive-day streak together', () => {
    // 8×11h drives = 88h with no rest day. Should produce a daily cap
    // hit AND a consecutive-day breach in the same evaluation pass.
    const sched: Schedule = { 'EMP-1': {} };
    for (let d = 1; d <= 8; d++) sched['EMP-1'][d] = { shiftCode: 'DLONG' };
    const v = ComplianceEngine.check([driver], [DRIVE_LONG], [], baseConfig, sched);
    const daily = v.find(x => x.rule === 'Daily hours cap');
    const consecutive = v.find(x => x.rule === 'Consecutive work days');
    expect(daily?.article).toBe('(Art. 88)');
    expect(consecutive).toBeDefined();
  });

  it('passes a 7×8h driver week (56h) — at the driver weekly cap, not over', () => {
    // 7×8h = 56h, exactly the driver weekly cap. No cap violation, but
    // the worker hit 7 consecutive days → the rest-day rule still fires
    // (drivers don't escape Art. 71 §5). This is a "one rule fires, one
    // doesn't" composite case.
    const sched: Schedule = { 'EMP-1': {} };
    for (let d = 1; d <= 7; d++) sched['EMP-1'][d] = { shiftCode: 'D8' };
    const v = ComplianceEngine.check([driver], [DRIVE_8], [], baseConfig, sched);
    expect(v.find(x => x.rule === 'Weekly hours cap')).toBeUndefined();
    expect(v.find(x => x.rule === 'Weekly rest day')).toBeDefined();
  });

  it('uses driverMaxConsecWorkDays (not the standard 6) when set lower for drivers', () => {
    const config: Config = { ...baseConfig, driverMaxConsecWorkDays: 5 };
    // 6 consecutive days exceeds the 5-day driver-specific cap even though
    // it's within the 6-day standard cap. Verifies that the driver cap
    // is read for driver-category workers.
    const sched: Schedule = { 'EMP-1': {} };
    for (let d = 1; d <= 6; d++) sched['EMP-1'][d] = { shiftCode: 'D8' };
    const v = ComplianceEngine.check([driver], [DRIVE_8], [], config, sched);
    expect(v.find(x => x.rule === 'Consecutive work days')).toBeDefined();
  });
});

// ─── Comp-day owed across the month boundary ───────────────────────────

describe('ComplianceEngine integration — late-month holiday comp window spills into next month', () => {
  it('finds an OFF day in the next month that closes the comp window', () => {
    // PH on day 25 with a comp day landing day 5 of next month (offset 8
    // from the holiday: Feb 26→27→28→Mar 1→2→3→4→5). Past the 7-day
    // recommended threshold but well inside the 30-day max window → soft
    // "Comp day late" note, NOT a "Comp day owed".
    const holiday: PublicHoliday = { date: '2026-02-25', name: 'Test', type: 'National', legalReference: 'Art. 74' };
    const febSched = {
      'EMP-1': Object.fromEntries(
        [25, 26, 27, 28].map(d => [d, { shiftCode: 'FS' }]),
      ),
    };
    // Give the engine a comfortable window of next-month visibility so it
    // can confidently conclude that the OFF on Mar 5 is the comp day.
    const marSched: Schedule = { 'EMP-1': {} };
    for (let d = 1; d <= 10; d++) marSched['EMP-1'][d] = { shiftCode: d === 5 ? 'OFF' : 'FS' };
    const allSchedules = { [monthKey(2026, 3)]: marSched };
    const v = ComplianceEngine.check([baseEmployee], [FS, OFF], [holiday], baseConfig, febSched, allSchedules);
    expect(v.find(x => x.rule === 'Comp day owed')).toBeUndefined();
    expect(v.find(x => x.rule === 'Comp day late')).toBeDefined();
  });
});
