import { describe, it, expect } from 'vitest';
import { computeWorkedHours, computePayrollRow } from '../payroll';
import { Employee, Shift, Schedule, Config, PublicHoliday } from '../../types';

const FS: Shift = { code: 'FS', name: 'Full', start: '09:00', end: '17:00', durationHrs: 8, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: '' };
const OFF: Shift = { code: 'OFF', name: 'Off', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };
const AL: Shift = { code: 'AL', name: 'Annual', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: '' };

const baseEmp: Employee = {
  empId: 'EMP-1', name: 'Test', role: 'Operator', department: 'Ops',
  contractType: 'Permanent', contractedWeeklyHrs: 48, shiftEligibility: 'All',
  isHazardous: false, isIndustrialRotating: false, hourExempt: false,
  fixedRestDay: 6, phone: '', hireDate: '2024-01-01', notes: '',
  eligibleStations: [], holidayBank: 0, annualLeaveBalance: 21,
  baseMonthlySalary: 1_500_000, baseHourlyRate: 7_812,
  overtimeHours: 0, category: 'Standard',
};

const cfg = { year: 2026, month: 1 };

describe('computeWorkedHours — leave-overlap exclusion', () => {
  it('sums work hours when no leave is active', () => {
    const schedule: Schedule = { 'EMP-1': { 1: { shiftCode: 'FS' }, 2: { shiftCode: 'FS' }, 3: { shiftCode: 'OFF' } } };
    expect(computeWorkedHours(baseEmp, schedule, [FS, OFF], cfg)).toBe(16);
  });

  it('excludes hours overlapping a v1.7 leaveRanges entry', () => {
    const emp = { ...baseEmp, leaveRanges: [{ id: 'l1', type: 'annual' as const, start: '2026-01-02', end: '2026-01-03' }] };
    const schedule: Schedule = { 'EMP-1': { 1: { shiftCode: 'FS' }, 2: { shiftCode: 'FS' }, 3: { shiftCode: 'FS' } } };
    expect(computeWorkedHours(emp, schedule, [FS], cfg)).toBe(8);
  });

  it('excludes hours overlapping a legacy single-range annualLeave field', () => {
    // v1.6 backup: schedule grid still shows FS shifts on the leave dates
    // because the supervisor edited the leave field before re-running the
    // auto-scheduler. Without this fix the table reported 24h worked when
    // 16h were on leave.
    const emp = { ...baseEmp, annualLeaveStart: '2026-01-02', annualLeaveEnd: '2026-01-03' };
    const schedule: Schedule = { 'EMP-1': { 1: { shiftCode: 'FS' }, 2: { shiftCode: 'FS' }, 3: { shiftCode: 'FS' } } };
    expect(computeWorkedHours(emp, schedule, [FS], cfg)).toBe(8);
  });

  it('excludes hours overlapping legacy sickLeave + maternityLeave fields', () => {
    const emp = {
      ...baseEmp,
      sickLeaveStart: '2026-01-05', sickLeaveEnd: '2026-01-05',
      maternityLeaveStart: '2026-01-10', maternityLeaveEnd: '2026-01-12',
    };
    const schedule: Schedule = {
      'EMP-1': {
        4: { shiftCode: 'FS' },
        5: { shiftCode: 'FS' },
        10: { shiftCode: 'FS' }, 11: { shiftCode: 'FS' }, 12: { shiftCode: 'FS' },
        13: { shiftCode: 'FS' },
      },
    };
    expect(computeWorkedHours(emp, schedule, [FS], cfg)).toBe(16);
  });

  it('does not double-subtract a day already painted as AL on the schedule', () => {
    // AL.isWork === false, so it's already excluded by the shift check.
    // The leave-overlap guard is just a belt for the suspenders.
    const emp = { ...baseEmp, leaveRanges: [{ id: 'l1', type: 'annual' as const, start: '2026-01-02', end: '2026-01-02' }] };
    const schedule: Schedule = { 'EMP-1': { 1: { shiftCode: 'FS' }, 2: { shiftCode: 'AL' } } };
    expect(computeWorkedHours(emp, schedule, [FS, AL], cfg)).toBe(8);
  });

  it('returns 0 for an employee with no schedule entries', () => {
    expect(computeWorkedHours(baseEmp, {}, [FS], cfg)).toBe(0);
  });
});

// v5.34/v5.35 — computePayrollRow is the single pay engine now shared by the
// Payroll table, the period-over-period delta, and the PDF compliance report.
// These tests lock the two behaviours that the PDF previously got wrong (it
// re-derived pay inline and over-billed): (1) holiday hours under comp-day mode
// with a comp day granted are NOT charged the 2× premium; (2) leave-overlap
// days are excluded from worked hours. hourly = 1,500,000 / (48×4) = 7,812.5;
// cap = 192h.
const fullCfg = {
  year: 2026, month: 1, daysInMonth: 31,
  standardWeeklyHrsCap: 48, hazardousWeeklyHrsCap: 36, driverWeeklyHrsCap: 56,
  otRateDay: 1.5, otRateNight: 2.0,
  holidayCompMode: 'cash-ot', holidayCompWindowDays: 30,
  carryForwardUnspentCompDays: false,
} as unknown as Config;

const NEW_YEAR: PublicHoliday[] = [
  { date: '2026-01-01', name: 'New Year', type: 'public', legalReference: '' },
];

describe('computePayrollRow', () => {
  it('baseline: under cap, no holiday, no leave → zero OT, net = base salary', () => {
    const schedule: Schedule = { 'EMP-1': { 1: { shiftCode: 'FS' }, 2: { shiftCode: 'FS' } } };
    const r = computePayrollRow(baseEmp, schedule, [FS], [], fullCfg);
    expect(r.totalHours).toBe(16);
    expect(r.otAmount).toBe(0);
    expect(r.netPayable).toBe(1_500_000);
  });

  it('over the monthly cap → standard OT at the day rate', () => {
    // 25 × 8h = 200h, 8h over the 192h cap → 8 × 7812.5 × 1.5 = 93,750.
    const days: Record<number, { shiftCode: string }> = {};
    for (let d = 1; d <= 25; d++) days[d] = { shiftCode: 'FS' };
    const schedule: Schedule = { 'EMP-1': days };
    const r = computePayrollRow(baseEmp, schedule, [FS], [], fullCfg);
    expect(r.totalHours).toBe(200);
    expect(r.cap).toBe(192);
    expect(r.standardOTHours).toBe(8);
    expect(Math.round(r.otAmount)).toBe(93_750);
  });

  it('v5.37: uses the Driver cap (224h) not the flat 192h → less standard OT', () => {
    // A driver working 216h is UNDER their 224h cap, so zero standard OT.
    // Pre-v5.37 (flat 192h cap) this billed 24h of phantom OT.
    const driver = { ...baseEmp, category: 'Driver' as const, contractedWeeklyHrs: 56 };
    const days: Record<number, { shiftCode: string }> = {};
    for (let d = 1; d <= 27; d++) days[d] = { shiftCode: 'FS' }; // 27 × 8 = 216h
    const r = computePayrollRow(driver, { 'EMP-1': days }, [FS], [], fullCfg);
    expect(r.totalHours).toBe(216);
    expect(r.cap).toBe(224);
    expect(r.standardOTHours).toBe(0);
    expect(r.otAmount).toBe(0);
  });

  it('v5.37: uses the hazardous cap (144h) → MORE standard OT than the flat cap', () => {
    // A hazardous worker has a LOWER cap (144h), so 152h worked is 8h over.
    // Pre-v5.37 (flat 192h cap) this was 0 OT.
    const haz = { ...baseEmp, isHazardous: true };
    const days: Record<number, { shiftCode: string }> = {};
    for (let d = 1; d <= 19; d++) days[d] = { shiftCode: 'FS' }; // 19 × 8 = 152h
    const r = computePayrollRow(haz, { 'EMP-1': days }, [FS], [], fullCfg);
    expect(r.totalHours).toBe(152);
    expect(r.cap).toBe(144);
    expect(r.standardOTHours).toBe(8);
  });

  it('v5.37: hour-exempt employees never accrue OT (infinite cap)', () => {
    const exempt = { ...baseEmp, hourExempt: true };
    const days: Record<number, { shiftCode: string }> = {};
    for (let d = 1; d <= 28; d++) days[d] = { shiftCode: 'FS' }; // 224h
    const r = computePayrollRow(exempt, { 'EMP-1': days }, [FS], [], fullCfg);
    expect(r.cap).toBe(Number.POSITIVE_INFINITY);
    expect(r.standardOTHours).toBe(0);
    expect(r.otAmount).toBe(0);
  });

  it('cash-ot mode: a worked holiday is billed the 2× premium', () => {
    const schedule: Schedule = { 'EMP-1': { 1: { shiftCode: 'FS' } } };
    const r = computePayrollRow(baseEmp, schedule, [FS], NEW_YEAR, fullCfg);
    // 8h × 7812.5 × 2.0 = 125,000 premium; under cap so no standard OT.
    expect(Math.round(r.otAmount)).toBe(125_000);
    expect(r.holidayBreakdown.premiumHolidayHours).toBe(8);
  });

  it('comp-day mode with a comp day granted: NO 2× premium (the PDF over-bill fix)', () => {
    const compDayCfg = { ...fullCfg, holidayCompMode: 'comp-day' } as Config;
    // Worked the holiday (Jan 1), OFF the next day within the comp window →
    // the rest day IS the compensation, so no cash premium is owed. The old
    // inline PDF math would have charged 8 × 7812.5 × 2 = 125,000.
    const schedule: Schedule = { 'EMP-1': { 1: { shiftCode: 'FS' }, 2: { shiftCode: 'OFF' } } };
    const r = computePayrollRow(baseEmp, schedule, [FS, OFF], NEW_YEAR, compDayCfg);
    expect(r.holidayBreakdown.premiumHolidayHours).toBe(0);
    expect(r.otAmount).toBe(0);
    expect(r.netPayable).toBe(1_500_000);
  });

  it('excludes leave-overlap days from worked hours (no inflated OT/net)', () => {
    const emp = { ...baseEmp, leaveRanges: [{ id: 'l1', type: 'annual' as const, start: '2026-01-02', end: '2026-01-02' }] };
    const schedule: Schedule = { 'EMP-1': { 1: { shiftCode: 'FS' }, 2: { shiftCode: 'FS' } } };
    const r = computePayrollRow(emp, schedule, [FS], [], fullCfg);
    expect(r.totalHours).toBe(8); // Jan 2 on annual leave excluded
    expect(r.otAmount).toBe(0);
  });
});
