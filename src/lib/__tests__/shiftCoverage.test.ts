import { describe, it, expect } from 'vitest';
import { computeCoverageProfile, findCoverageGaps, summarizeCoverage } from '../shiftCoverage';
import type { Shift } from '../../types';

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

describe('computeCoverageProfile', () => {
  it('marks each hour covered by at least one work shift', () => {
    const profile = computeCoverageProfile([shift({ code: 'M', start: '11:00', end: '19:00' })]);
    for (let h = 0; h < 11; h++) expect(profile.coveredByHour[h]).toBe(false);
    for (let h = 11; h < 19; h++) expect(profile.coveredByHour[h]).toBe(true);
    for (let h = 19; h < 24; h++) expect(profile.coveredByHour[h]).toBe(false);
  });

  it('excludes system shifts from the coverage profile', () => {
    const profile = computeCoverageProfile([shift({ code: 'OFF', start: '11:00', end: '19:00', isWork: false })]);
    for (let h = 11; h < 19; h++) expect(profile.coveredByHour[h]).toBe(false);
    expect(profile.coveringShifts).toHaveLength(0);
  });

  it('handles cross-midnight shifts (22:00–06:00)', () => {
    const profile = computeCoverageProfile([shift({ code: 'N', start: '22:00', end: '06:00' })]);
    expect(profile.coveredByHour[22]).toBe(true);
    expect(profile.coveredByHour[23]).toBe(true);
    expect(profile.coveredByHour[0]).toBe(true);
    expect(profile.coveredByHour[5]).toBe(true);
    expect(profile.coveredByHour[6]).toBe(false);
    expect(profile.coveredByHour[10]).toBe(false);
  });

  it('overlapping shifts mark same hours covered without breaking', () => {
    const profile = computeCoverageProfile([
      shift({ code: 'M', start: '11:00', end: '19:00' }),
      shift({ code: 'C', start: '15:00', end: '23:00' }),
    ]);
    for (let h = 11; h < 23; h++) expect(profile.coveredByHour[h]).toBe(true);
  });
});

describe('findCoverageGaps', () => {
  it('returns empty when window is fully covered', () => {
    const profile = computeCoverageProfile([shift({ code: 'M', start: '11:00', end: '19:00' })]);
    expect(findCoverageGaps(11, 19, profile)).toEqual([]);
  });

  it('finds a single gap at the end of an open window', () => {
    const profile = computeCoverageProfile([shift({ code: 'M', start: '11:00', end: '19:00' })]);
    expect(findCoverageGaps(11, 23, profile)).toEqual([{ start: 19, end: 23 }]);
  });

  it('finds multiple gaps split by an existing shift', () => {
    const profile = computeCoverageProfile([shift({ code: 'M', start: '13:00', end: '17:00' })]);
    expect(findCoverageGaps(11, 22, profile)).toEqual([
      { start: 11, end: 13 },
      { start: 17, end: 22 },
    ]);
  });
});

describe('summarizeCoverage', () => {
  it('reports 100% coverage when all demand hours are covered', () => {
    const profile = computeCoverageProfile([shift({ code: 'M', start: '11:00', end: '19:00' })]);
    const sum = summarizeCoverage([{ start: 11, end: 19 }], profile);
    expect(sum.pctCovered).toBe(100);
    expect(sum.uncoveredHours).toBe(0);
  });

  it('reports partial coverage with both numbers when only some hours are covered', () => {
    const profile = computeCoverageProfile([shift({ code: 'M', start: '11:00', end: '15:00' })]);
    const sum = summarizeCoverage([{ start: 11, end: 19 }], profile);
    expect(sum.coveredHours).toBe(4);
    expect(sum.uncoveredHours).toBe(4);
    expect(sum.pctCovered).toBe(50);
  });
});
