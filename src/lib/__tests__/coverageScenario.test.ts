import { describe, it, expect } from 'vitest';
import { buildCoverageScenarios, summarizeScenarios } from '../coverageScenario';
import type { Config, Shift, Station, Employee } from '../../types';

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
  peakDays: [5, 6, 7],
  otRateDay: 1.5,
  otRateNight: 2.0,
});

const station = (over: Partial<Station>): Station => ({
  id: over.id || 's1',
  name: over.name || 'Cashier 1',
  normalMinHC: 1,
  peakMinHC: 2,
  openingTime: '11:00',
  closingTime: '23:00',
  ...over,
});

const shift = (over: Partial<Shift> & { code: string; start: string; end: string }): Shift => ({
  name: over.code,
  durationHrs: 8,
  breakMin: 60,
  isIndustrial: false,
  isHazardous: false,
  isWork: true,
  description: '',
  ...over,
});

describe('buildCoverageScenarios', () => {
  it('produces a timeline with open + close steps for a single covering shift', () => {
    const stations = [station({ openingTime: '11:00', closingTime: '19:00' })];
    const shifts = [shift({ code: 'M', start: '11:00', end: '19:00' })];
    const out = buildCoverageScenarios({ stations, shifts, config: baseConfig() });
    expect(out).toHaveLength(1);
    const sc = out[0];
    expect(sc.coveringShifts).toHaveLength(1);
    expect(sc.timeline[0].kind).toBe('open');
    expect(sc.timeline[sc.timeline.length - 1].kind).toBe('close');
    expect(sc.uncoveredHours).toBe(0);
  });

  it('detects gap hours when no shift covers part of the demand window', () => {
    const stations = [station({ openingTime: '11:00', closingTime: '23:00', peakMinHC: 2 })];
    const shifts = [shift({ code: 'M', start: '11:00', end: '15:00' })];
    const out = buildCoverageScenarios({ stations, shifts, config: baseConfig() });
    const sc = out[0];
    // Hours 15..22 (8 hrs) have demand but no shift on the floor.
    expect(sc.uncoveredHours).toBeGreaterThan(0);
    expect(sc.timeline.some(t => t.kind === 'gap')).toBe(true);
  });

  it('computes peak concurrent HC across overlapping shifts', () => {
    const stations = [station({ openingTime: '11:00', closingTime: '23:00', peakMinHC: 2 })];
    const shifts = [
      shift({ code: 'M', start: '11:00', end: '19:00' }),
      shift({ code: 'C', start: '15:00', end: '23:00' }),
    ];
    const out = buildCoverageScenarios({ stations, shifts, config: baseConfig() });
    const sc = out[0];
    // 15:00–19:00 has both M and C on the floor → 2 shifts × peak HC 2 = 4 concurrent.
    expect(sc.peakConcurrentHC).toBe(4);
    expect(sc.uncoveredHours).toBe(0);
  });

  it('roster-required formula honors weekly rest + leave buffer', () => {
    const stations = [station({ openingTime: '11:00', closingTime: '19:00', peakMinHC: 1, normalMinHC: 1 })];
    const shifts = [shift({ code: 'M', start: '11:00', end: '19:00' })];
    const out = buildCoverageScenarios({
      stations, shifts, config: baseConfig(),
      daysOpenPerWeek: 7,
      restDaysPerEmployeePerWeek: 1,
      annualLeaveDaysPerEmployee: 21,
      sickAndCompBufferPct: 0.05,
    });
    const sc = out[0];
    // 1 concurrent × 7 days / 6 workdays = 1.17 raw / (1 - 0.107) ≈ 1.31 → ceil 2.
    expect(sc.rosterRequired.bufferedRoster).toBe(2);
    expect(sc.rosterRequired.workDaysPerEmployeePerWeek).toBe(6);
  });

  it('skips system shifts (OFF/AL) when building the timeline', () => {
    const stations = [station({ openingTime: '11:00', closingTime: '19:00', peakMinHC: 1, normalMinHC: 1 })];
    const shifts: Shift[] = [
      shift({ code: 'M', start: '11:00', end: '19:00' }),
      // OFF is a system shift — must NOT count as floor coverage.
      shift({ code: 'OFF', start: '11:00', end: '19:00', isWork: false }),
    ];
    const out = buildCoverageScenarios({ stations, shifts, config: baseConfig() });
    expect(out[0].coveringShifts.map(s => s.code)).toEqual(['M']);
  });

  it('honours the holiday tier (holidayMinHC) when isHoliday is set (v5.36)', () => {
    // Station needs 2 PAX on a peak day but 3 on a public holiday.
    const stations = [station({ openingTime: '11:00', closingTime: '19:00', peakMinHC: 2, normalMinHC: 1, holidayMinHC: 3 })];
    const shifts = [shift({ code: 'M', start: '11:00', end: '19:00' })];
    const cfg = baseConfig();

    const holiday = buildCoverageScenarios({ stations, shifts, config: cfg, isPeakDay: true, isHoliday: true });
    // 1 shift on the floor × holiday HC 3 = 3 concurrent.
    expect(holiday[0].peakConcurrentHC).toBe(3);

    const peak = buildCoverageScenarios({ stations, shifts, config: cfg, isPeakDay: true, isHoliday: false });
    expect(peak[0].peakConcurrentHC).toBe(2);
  });

  it('falls back to the peak tier on a holiday when the station has no holiday override', () => {
    const stations = [station({ openingTime: '11:00', closingTime: '19:00', peakMinHC: 2, normalMinHC: 1 })];
    const shifts = [shift({ code: 'M', start: '11:00', end: '19:00' })];
    const out = buildCoverageScenarios({ stations, shifts, config: baseConfig(), isPeakDay: true, isHoliday: true });
    expect(out[0].peakConcurrentHC).toBe(2); // no holidayMinHC → peak fallback
  });

  it('summarizeScenarios aggregates across stations', () => {
    const stations = [
      station({ id: 'a', name: 'A', openingTime: '11:00', closingTime: '19:00', peakMinHC: 1 }),
      station({ id: 'b', name: 'B', openingTime: '11:00', closingTime: '23:00', peakMinHC: 2 }),
    ];
    const shifts = [shift({ code: 'M', start: '11:00', end: '19:00' })];
    const scs = buildCoverageScenarios({ stations, shifts, config: baseConfig() });
    const employees: Employee[] = [];
    const sum = summarizeScenarios(scs, employees);
    expect(sum.stationCount).toBe(2);
    expect(sum.stationsWithGaps).toBe(1); // station B has 19–23 gap
    expect(sum.largestGap?.stationName).toBe('B');
  });
});
