import { describe, it, expect } from 'vitest';
import { ComplianceEngine } from '../compliance';
import { Employee, Shift, PublicHoliday, Config, Schedule } from '../../types';

// Minimal config for tests — January 2026 (31 days), starts on Thursday.
const baseConfig: Config = {
  company: 'Test Co',
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
  driverDailyHrsCap: 9,
  driverWeeklyHrsCap: 56,
  driverContinuousDrivingHrsCap: 4.5,
  driverMinDailyRestHrs: 11,
  driverMaxConsecWorkDays: 6,
  shopOpeningTime: '09:00',
  shopClosingTime: '21:00',
  peakDays: [5, 6, 7],
  holidays: [],
  otRateDay: 1.5,
  otRateNight: 2.0,
};

const baseEmployee: Employee = {
  empId: 'EMP-1',
  name: 'Test Worker',
  role: 'Operator',
  department: 'Ops',
  contractType: 'Permanent',
  contractedWeeklyHrs: 48,
  shiftEligibility: 'All',
  isHazardous: false,
  isIndustrialRotating: false,
  hourExempt: false,
  fixedRestDay: 6, // Friday
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
const LONG: Shift = { code: 'LONG', name: 'Long', start: '09:00', end: '21:00', durationHrs: 12, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: '' };
const OFF: Shift = { code: 'OFF', name: 'Off', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };
const HAZ: Shift = { code: 'HAZ', name: 'Hazardous', start: '09:00', end: '17:00', durationHrs: 8, breakMin: 30, isIndustrial: false, isHazardous: true, isWork: true, description: '' };
const DRIVE_LONG: Shift = { code: 'DLONG', name: 'Long drive', start: '06:00', end: '17:00', durationHrs: 11, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: true, description: '' };

const buildSchedule = (assignments: Record<number, string>): Schedule => ({
  'EMP-1': Object.fromEntries(Object.entries(assignments).map(([d, code]) => [d, { shiftCode: code }])),
});

describe('ComplianceEngine — daily hours cap', () => {
  it('passes a normal 8h shift', () => {
    const sched = buildSchedule({ 1: 'FS', 2: 'OFF' });
    const v = ComplianceEngine.check([baseEmployee], [FS, OFF], [], baseConfig, sched);
    expect(v.find(x => x.rule === 'Daily hours cap')).toBeUndefined();
  });

  it('flags a 12h shift exceeding the standard 8h cap', () => {
    const sched = buildSchedule({ 1: 'LONG' });
    const v = ComplianceEngine.check([baseEmployee], [LONG], [], baseConfig, sched);
    const daily = v.find(x => x.rule === 'Daily hours cap');
    expect(daily).toBeDefined();
    expect(daily?.article).toBe('(Art. 67)');
  });

  it('uses the hazardous cap (7h) when the employee is flagged hazardous', () => {
    const haz = { ...baseEmployee, isHazardous: true };
    const sched = buildSchedule({ 1: 'FS' }); // 8h
    const v = ComplianceEngine.check([haz], [FS], [], baseConfig, sched);
    const daily = v.find(x => x.rule === 'Daily hours cap');
    expect(daily?.article).toBe('(Art. 68)');
  });

  it('skips the cap entirely for hour-exempt staff', () => {
    const exempt = { ...baseEmployee, hourExempt: true };
    const sched = buildSchedule({ 1: 'LONG' });
    const v = ComplianceEngine.check([exempt], [LONG], [], baseConfig, sched);
    expect(v.find(x => x.rule === 'Daily hours cap')).toBeUndefined();
  });

  it('uses the driver cap (9h) for transport workers', () => {
    const driver = { ...baseEmployee, category: 'Driver' as const };
    // 11h drive shift exceeds the 9h driver cap → Art. 88 violation
    const sched = buildSchedule({ 1: 'DLONG' });
    const v = ComplianceEngine.check([driver], [DRIVE_LONG], [], baseConfig, sched);
    const daily = v.find(x => x.rule === 'Daily hours cap');
    expect(daily?.article).toBe('(Art. 88)');
  });
});

describe('ComplianceEngine — weekly hours cap', () => {
  it('passes 6×8h = 48h (at the cap)', () => {
    const sched = buildSchedule({ 1: 'FS', 2: 'FS', 3: 'FS', 4: 'FS', 5: 'FS', 6: 'FS', 7: 'OFF' });
    const v = ComplianceEngine.check([baseEmployee], [FS, OFF], [], baseConfig, sched);
    expect(v.find(x => x.rule === 'Weekly hours cap')).toBeUndefined();
  });

  it('flags 7×8h = 56h over the rolling 7-day window', () => {
    const sched = buildSchedule({ 1: 'FS', 2: 'FS', 3: 'FS', 4: 'FS', 5: 'FS', 6: 'FS', 7: 'FS' });
    const v = ComplianceEngine.check([baseEmployee], [FS], [], baseConfig, sched);
    expect(v.find(x => x.rule === 'Weekly hours cap')).toBeDefined();
  });
});

describe('ComplianceEngine — weekly rest day', () => {
  it('flags 7 consecutive working days as missing weekly rest', () => {
    const sched = buildSchedule({ 1: 'FS', 2: 'FS', 3: 'FS', 4: 'FS', 5: 'FS', 6: 'FS', 7: 'FS' });
    const v = ComplianceEngine.check([baseEmployee], [FS], [], baseConfig, sched);
    expect(v.find(x => x.rule === 'Weekly rest day')).toBeDefined();
  });
});

describe('ComplianceEngine — consecutive work days', () => {
  it('flags >6 consecutive days of work', () => {
    const sched = buildSchedule({ 1: 'FS', 2: 'FS', 3: 'FS', 4: 'FS', 5: 'FS', 6: 'FS', 7: 'FS', 8: 'FS' });
    const v = ComplianceEngine.check([baseEmployee], [FS], [], baseConfig, sched);
    expect(v.find(x => x.rule === 'Consecutive work days')).toBeDefined();
  });
});

describe('ComplianceEngine — public holiday worked', () => {
  it('emits an info-severity finding (NOT a violation) for work on a holiday without OT/PH shift code', () => {
    const holidays: PublicHoliday[] = [{ date: '2026-01-05', name: 'Test Holiday', type: 'National', legalReference: 'Art. 74' }];
    const sched = buildSchedule({ 5: 'FS' });
    const v = ComplianceEngine.check([baseEmployee], [FS], holidays, baseConfig, sched);
    const phFinding = v.find(x => x.rule === 'Public holiday worked');
    expect(phFinding).toBeDefined();
    // Working a public holiday is legal under Art. 74 (it just requires
    // double pay or a comp day). The platform aids the supervisor by noting
    // the eligibility rather than flagging it as a rule breach.
    expect(phFinding?.severity).toBe('info');
  });
});

describe('ComplianceEngine — comp day owed (Art. 74)', () => {
  const holiday: PublicHoliday = { date: '2026-01-05', name: 'Test Holiday', type: 'National', legalReference: 'Art. 74' };
  // v1.11+: warning fires only when the supervisor has explicitly opted into
  // comp-day-in-lieu for that date (holidayCompensations contains it). If
  // they're paying the 2× cash premium (date NOT in the list), Art. 74 is
  // satisfied by the cash and no OFF day is required.
  const empOptedIntoComp = (dates: string[]): Employee => ({ ...baseEmployee, holidayCompensations: dates });

  it('fires when comp was chosen but no OFF/leave in the next 7 days', () => {
    const sched = buildSchedule({
      5: 'FS', 6: 'FS', 7: 'FS', 8: 'FS', 9: 'FS', 10: 'FS', 11: 'FS', 12: 'FS',
    });
    const v = ComplianceEngine.check([empOptedIntoComp(['2026-01-05'])], [FS], [holiday], baseConfig, sched);
    const compFinding = v.find(x => x.rule === 'Comp day owed');
    expect(compFinding).toBeDefined();
    expect(compFinding?.article).toBe('(Art. 74)');
    expect(compFinding?.severity).toBe('info');
  });

  it('does NOT fire when supervisor is paying the cash premium (default, date not opted-in)', () => {
    // Pre-v1.11 default behaviour: empty holidayCompensations means the
    // supervisor is paying double, which satisfies Art. 74 — no warning.
    const sched = buildSchedule({
      5: 'FS', 6: 'FS', 7: 'FS', 8: 'FS', 9: 'FS', 10: 'FS', 11: 'FS', 12: 'FS',
    });
    const v = ComplianceEngine.check([baseEmployee], [FS], [holiday], baseConfig, sched);
    expect(v.find(x => x.rule === 'Comp day owed')).toBeUndefined();
  });

  it('does not fire when an OFF day appears within the 7-day window (and comp was chosen)', () => {
    const sched = buildSchedule({
      5: 'FS', 6: 'FS', 7: 'OFF', 8: 'FS', 9: 'FS', 10: 'FS', 11: 'FS', 12: 'FS',
    });
    const v = ComplianceEngine.check([empOptedIntoComp(['2026-01-05'])], [FS, OFF], [holiday], baseConfig, sched);
    expect(v.find(x => x.rule === 'Comp day owed')).toBeUndefined();
  });

  it('does not fire when an empty (unscheduled) day is within the window', () => {
    const sched = buildSchedule({
      5: 'FS', 7: 'FS', 8: 'FS', 9: 'FS', 10: 'FS', 11: 'FS', 12: 'FS',
    });
    const v = ComplianceEngine.check([empOptedIntoComp(['2026-01-05'])], [FS], [holiday], baseConfig, sched);
    expect(v.find(x => x.rule === 'Comp day owed')).toBeUndefined();
  });

  it('does not fire when the window crosses the month boundary and next month is unknown', () => {
    const lateHoliday: PublicHoliday = { date: '2026-01-28', name: 'Late', type: 'National', legalReference: 'Art. 74' };
    const sched = buildSchedule({
      28: 'FS', 29: 'FS', 30: 'FS', 31: 'FS',
    });
    const v = ComplianceEngine.check([empOptedIntoComp(['2026-01-28'])], [FS], [lateHoliday], baseConfig, sched);
    expect(v.find(x => x.rule === 'Comp day owed')).toBeUndefined();
  });

  it('peeks into next month when a late-month PH window crosses the boundary', () => {
    const lateHoliday: PublicHoliday = { date: '2026-01-28', name: 'Late', type: 'National', legalReference: 'Art. 74' };
    const sched = buildSchedule({ 28: 'FS', 29: 'FS', 30: 'FS', 31: 'FS' });
    const nextSched: Schedule = {
      'EMP-1': { 1: { shiftCode: 'FS' }, 2: { shiftCode: 'FS' }, 3: { shiftCode: 'FS' }, 4: { shiftCode: 'FS' } },
    };
    const allSchedules = { 'scheduler_schedule_2026_2': nextSched };
    const v = ComplianceEngine.check([empOptedIntoComp(['2026-01-28'])], [FS], [lateHoliday], baseConfig, sched, allSchedules);
    expect(v.find(x => x.rule === 'Comp day owed')).toBeDefined();
  });

  it('does not fire when an OFF appears in the next month within the 7-day window', () => {
    const lateHoliday: PublicHoliday = { date: '2026-01-28', name: 'Late', type: 'National', legalReference: 'Art. 74' };
    const sched = buildSchedule({ 28: 'FS', 29: 'FS', 30: 'FS', 31: 'FS' });
    const nextSched: Schedule = {
      'EMP-1': { 1: { shiftCode: 'FS' }, 2: { shiftCode: 'OFF' }, 3: { shiftCode: 'FS' } },
    };
    const allSchedules = { 'scheduler_schedule_2026_2': nextSched };
    const v = ComplianceEngine.check([empOptedIntoComp(['2026-01-28'])], [FS, OFF], [lateHoliday], baseConfig, sched, allSchedules);
    expect(v.find(x => x.rule === 'Comp day owed')).toBeUndefined();
  });

  it('does not fire when the holiday day itself was OFF (no PH-work occurred)', () => {
    const sched = buildSchedule({ 5: 'OFF', 6: 'FS', 7: 'FS', 8: 'FS', 9: 'FS', 10: 'FS', 11: 'FS', 12: 'FS' });
    const v = ComplianceEngine.check([baseEmployee], [FS, OFF], [holiday], baseConfig, sched);
    expect(v.find(x => x.rule === 'Comp day owed')).toBeUndefined();
    // And no PH-worked finding either.
    expect(v.find(x => x.rule === 'Public holiday worked')).toBeUndefined();
  });
});

describe('ComplianceEngine — Ramadan reduced hours', () => {
  it('flags an 8h shift during Ramadan when the cap is 6h', () => {
    const config: Config = { ...baseConfig, ramadanStart: '2026-01-01', ramadanEnd: '2026-01-31', ramadanDailyHrsCap: 6 };
    const sched = buildSchedule({ 1: 'FS' });
    const v = ComplianceEngine.check([baseEmployee], [FS], [], config, sched);
    const daily = v.find(x => x.rule === 'Daily hours cap');
    expect(daily?.article).toBe('(Ramadan)');
  });

  it('does not flag a 6h shift during Ramadan', () => {
    const SHORT: Shift = { ...FS, code: 'SHORT', durationHrs: 6, end: '15:00' };
    const config: Config = { ...baseConfig, ramadanStart: '2026-01-01', ramadanEnd: '2026-01-31', ramadanDailyHrsCap: 6 };
    const sched = buildSchedule({ 1: 'SHORT' });
    const v = ComplianceEngine.check([baseEmployee], [SHORT], [], config, sched);
    expect(v.find(x => x.rule === 'Daily hours cap')).toBeUndefined();
  });

  it('keeps Art. 67 cap when the day is outside the Ramadan window', () => {
    const config: Config = { ...baseConfig, ramadanStart: '2026-02-01', ramadanEnd: '2026-02-28', ramadanDailyHrsCap: 6 };
    const sched = buildSchedule({ 1: 'FS' });
    const v = ComplianceEngine.check([baseEmployee], [FS], [], config, sched);
    expect(v.find(x => x.rule === 'Daily hours cap')).toBeUndefined();
  });
});

describe('ComplianceEngine — maternity leave (Art. 87)', () => {
  it('flags a work shift assigned during maternity leave', () => {
    const onLeave: Employee = { ...baseEmployee, maternityLeaveStart: '2026-01-01', maternityLeaveEnd: '2026-01-31' };
    const sched = buildSchedule({ 1: 'FS' });
    const v = ComplianceEngine.check([onLeave], [FS], [], baseConfig, sched);
    const mat = v.find(x => x.rule === 'Worked during maternity leave');
    expect(mat).toBeDefined();
    expect(mat?.article).toBe('(Art. 87)');
  });

  it('does not flag work outside the leave window', () => {
    const onLeave: Employee = { ...baseEmployee, maternityLeaveStart: '2026-02-01', maternityLeaveEnd: '2026-02-28' };
    const sched = buildSchedule({ 1: 'FS', 2: 'OFF' });
    const v = ComplianceEngine.check([onLeave], [FS, OFF], [], baseConfig, sched);
    expect(v.find(x => x.rule === 'Worked during maternity leave')).toBeUndefined();
  });
});

describe('ComplianceEngine — sick leave (Art. 84)', () => {
  it('flags a work shift assigned during sick leave', () => {
    const onLeave: Employee = { ...baseEmployee, sickLeaveStart: '2026-01-01', sickLeaveEnd: '2026-01-31' };
    const sched = buildSchedule({ 1: 'FS' });
    const v = ComplianceEngine.check([onLeave], [FS], [], baseConfig, sched);
    const sl = v.find(x => x.rule === 'Worked during sick leave');
    expect(sl).toBeDefined();
    expect(sl?.article).toBe('(Art. 84)');
  });

  it('does not flag work outside the sick-leave window', () => {
    const onLeave: Employee = { ...baseEmployee, sickLeaveStart: '2026-02-01', sickLeaveEnd: '2026-02-28' };
    const sched = buildSchedule({ 1: 'FS', 2: 'OFF' });
    const v = ComplianceEngine.check([onLeave], [FS, OFF], [], baseConfig, sched);
    expect(v.find(x => x.rule === 'Worked during sick leave')).toBeUndefined();
  });
});

describe('ComplianceEngine — violation grouping', () => {
  it('groups identical violations into a single entry with a count', () => {
    const sched = buildSchedule({ 1: 'LONG', 2: 'OFF', 3: 'LONG', 4: 'OFF' });
    const v = ComplianceEngine.check([baseEmployee], [LONG, OFF], [], baseConfig, sched);
    const grouped = v.find(x => x.rule === 'Daily hours cap');
    expect(grouped?.count).toBe(2);
  });
});
