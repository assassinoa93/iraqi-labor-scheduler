import { describe, it, expect } from 'vitest';
import { buildOptimizationProposal } from '../shiftOptimization';
import type { Config, Shift, Station } from '../../types';

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

const shift = (over: Partial<Shift> & { code: string; start: string; end: string; durationHrs: number }): Shift => ({
  name: over.code,
  breakMin: 60,
  isIndustrial: false,
  isHazardous: false,
  isWork: true,
  description: '',
  ...over,
});

describe('buildOptimizationProposal', () => {
  it('returns "library already optimal" when current matches proposal', () => {
    // 11–23 window with 8h daily cap → proposal is 2 staggered shifts
    // (11–19 + 15–23). If current library has exactly that, no change.
    const stations = [station({})];
    const current: Shift[] = [
      shift({ code: 'M', start: '11:00', end: '19:00', durationHrs: 8 }),
      shift({ code: 'C', start: '15:00', end: '23:00', durationHrs: 8 }),
    ];
    const proposal = buildOptimizationProposal(stations, baseConfig(), current);
    expect(proposal.toAdd).toHaveLength(0);
    expect(proposal.toDelete).toHaveLength(0);
    expect(proposal.toKeep.length).toBeGreaterThanOrEqual(1);
  });

  it('proposes splitting a 12h shift into two 8h staggered shifts', () => {
    const stations = [station({})];
    // MX is a 12h shift covering the whole window — over the 8h cap.
    const current: Shift[] = [
      shift({ code: 'MX', start: '11:00', end: '23:00', durationHrs: 12 }),
    ];
    const proposal = buildOptimizationProposal(stations, baseConfig(), current);
    expect(proposal.toDelete.map(d => d.shift.code)).toContain('MX');
    expect(proposal.toAdd.length).toBeGreaterThanOrEqual(2);
    // Issue MX violates cap; the proposal should fix that.
    expect(proposal.delta.fixedOverCap).toBe(1);
    expect(proposal.fixedIssues.find(i => i.shiftCode === 'MX')).toBeTruthy();
  });

  it('flags two same-window shifts as redundant + drops one', () => {
    const stations = [station({})];
    const current: Shift[] = [
      shift({ code: 'A', start: '11:00', end: '19:00', durationHrs: 8 }),
      shift({ code: 'B', start: '11:00', end: '19:00', durationHrs: 8 }),
    ];
    const proposal = buildOptimizationProposal(stations, baseConfig(), current);
    // One of A/B should be removed.
    expect(proposal.toDelete.length).toBeGreaterThanOrEqual(1);
    expect(proposal.delta.fixedRedundant).toBe(1);
  });

  it('preserves coverage equivalence', () => {
    const stations = [station({})];
    const current: Shift[] = [
      shift({ code: 'MX', start: '11:00', end: '23:00', durationHrs: 12 }),
    ];
    const proposal = buildOptimizationProposal(stations, baseConfig(), current);
    expect(proposal.delta.coverageEquivalent).toBe(true);
  });

  it('builds a non-empty summary string', () => {
    const stations = [station({})];
    const current: Shift[] = [
      shift({ code: 'MX', start: '11:00', end: '23:00', durationHrs: 12 }),
    ];
    const proposal = buildOptimizationProposal(stations, baseConfig(), current);
    expect(typeof proposal.summary).toBe('string');
    expect(proposal.summary.length).toBeGreaterThan(0);
  });

  it('ignores system shifts in the diff (OFF / AL / SL / MAT / PH / CP)', () => {
    const stations = [station({})];
    const current: Shift[] = [
      shift({ code: 'M', start: '11:00', end: '19:00', durationHrs: 8 }),
      shift({ code: 'C', start: '15:00', end: '23:00', durationHrs: 8 }),
      // System shifts shouldn't appear in toDelete or toKeep — they're filtered out.
      shift({ code: 'OFF', start: '00:00', end: '00:00', durationHrs: 0, isWork: false }),
      shift({ code: 'AL', start: '00:00', end: '00:00', durationHrs: 0, isWork: false }),
    ];
    const proposal = buildOptimizationProposal(stations, baseConfig(), current);
    const allDiffCodes = [...proposal.toAdd, ...proposal.toDelete, ...proposal.toKeep].map(e => e.shift.code);
    expect(allDiffCodes).not.toContain('OFF');
    expect(allDiffCodes).not.toContain('AL');
  });
});
