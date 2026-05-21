import { describe, it, expect } from 'vitest';
import {
  computeCompanyGratuity,
  computeGratuity,
  yearsOfService,
} from '../gratuity';

describe('yearsOfService', () => {
  it('returns 0 when hire is in the future', () => {
    expect(yearsOfService('2027-01-01', '2026-05-21')).toBe(0);
  });

  it('returns 0 when either input is malformed', () => {
    expect(yearsOfService('not-a-date', '2026-05-21')).toBe(0);
    expect(yearsOfService('2020-01-01', 'nope')).toBe(0);
  });

  it('returns ~1.0 for one calendar year', () => {
    const y = yearsOfService('2025-05-21', '2026-05-21');
    expect(y).toBeGreaterThan(0.99);
    expect(y).toBeLessThan(1.01);
  });

  it('handles multi-year tenures across leap-year boundaries', () => {
    const y = yearsOfService('2020-01-01', '2026-01-01');
    expect(y).toBeGreaterThan(5.99);
    expect(y).toBeLessThan(6.01);
  });
});

describe('computeGratuity', () => {
  it('returns all zeros when tenure is zero', () => {
    const g = computeGratuity({ hireDate: '2027-01-01', baseMonthlySalary: 1_500_000 }, '2026-05-21');
    expect(g.totalAmount).toBe(0);
    expect(g.yearsServed).toBe(0);
    expect(g.firstTierAmount).toBe(0);
    expect(g.secondTierAmount).toBe(0);
    expect(g.monthsOfWage).toBe(0);
  });

  it('first-year tenure yields half a month (Art. 137 tier-1 rate)', () => {
    const g = computeGratuity({ hireDate: '2025-05-21', baseMonthlySalary: 1_000_000 }, '2026-05-21');
    // ~1.0 years × 0.5 × 1M = ~500k
    expect(g.firstTierYears).toBeCloseTo(1, 1);
    expect(g.secondTierYears).toBe(0);
    expect(g.totalAmount).toBeGreaterThan(490_000);
    expect(g.totalAmount).toBeLessThan(510_000);
    expect(g.monthsOfWage).toBeCloseTo(0.5, 2);
  });

  it('caps the half-month tier at five years', () => {
    const g = computeGratuity({ hireDate: '2018-05-21', baseMonthlySalary: 1_000_000 }, '2026-05-21');
    // ~8 years served: 5 at half + 3 at full = 2.5 + 3 = 5.5 months
    expect(g.firstTierYears).toBeCloseTo(5, 2);
    expect(g.secondTierYears).toBeCloseTo(3, 1);
    expect(g.totalAmount).toBeGreaterThan(5_400_000);
    expect(g.totalAmount).toBeLessThan(5_600_000);
    expect(g.monthsOfWage).toBeCloseTo(5.5, 1);
  });

  it('5-year-exactly tenure stays entirely in the half-month tier', () => {
    const g = computeGratuity({ hireDate: '2021-05-21', baseMonthlySalary: 1_000_000 }, '2026-05-21');
    expect(g.firstTierYears).toBeCloseTo(5, 2);
    expect(g.secondTierYears).toBeLessThan(0.05);
    // 5 × 0.5 × 1M = 2.5M
    expect(g.totalAmount).toBeGreaterThan(2_450_000);
    expect(g.totalAmount).toBeLessThan(2_550_000);
  });

  it('half-year past the tier boundary blends the two rates correctly', () => {
    // 5.5 years total: 5 at half + 0.5 at full = 2.5 + 0.5 = 3.0 months
    const g = computeGratuity({ hireDate: '2020-11-21', baseMonthlySalary: 1_000_000 }, '2026-05-21');
    expect(g.firstTierYears).toBeCloseTo(5, 1);
    expect(g.secondTierYears).toBeCloseTo(0.5, 1);
    expect(g.monthsOfWage).toBeCloseTo(3.0, 1);
  });

  it('coerces a missing baseMonthlySalary to zero (no liability)', () => {
    const g = computeGratuity({ hireDate: '2020-01-01', baseMonthlySalary: 0 }, '2026-05-21');
    expect(g.totalAmount).toBe(0);
    expect(g.monthsOfWage).toBe(0);
    // But yearsServed is still tracked — UI may want to show tenure even
    // when the wage record is blank.
    expect(g.yearsServed).toBeGreaterThan(5);
  });

  it('handles missing hireDate gracefully (no tenure → no liability)', () => {
    const g = computeGratuity({ hireDate: '', baseMonthlySalary: 1_000_000 }, '2026-05-21');
    expect(g.totalAmount).toBe(0);
    expect(g.yearsServed).toBe(0);
  });
});

describe('computeCompanyGratuity', () => {
  const asOf = '2026-05-21';

  it('returns zeros across the board for an empty roster', () => {
    const s = computeCompanyGratuity([], asOf);
    expect(s.totalLiability).toBe(0);
    expect(s.avgPerEmployee).toBe(0);
    expect(s.contributors).toBe(0);
    expect(s.topFive).toEqual([]);
  });

  it('aggregates positive liabilities and skips zero contributors', () => {
    const s = computeCompanyGratuity([
      { empId: 'A', name: 'A', hireDate: '2020-05-21', baseMonthlySalary: 1_000_000 },
      { empId: 'B', name: 'B', hireDate: '2027-01-01', baseMonthlySalary: 1_000_000 }, // future hire
      { empId: 'C', name: 'C', hireDate: '2024-05-21', baseMonthlySalary: 0 },          // no wage
    ], asOf);
    expect(s.contributors).toBe(1);
    expect(s.totalLiability).toBeGreaterThan(0);
    expect(s.avgPerEmployee).toBe(s.totalLiability);
    expect(s.topFive).toHaveLength(1);
    expect(s.topFive[0].empId).toBe('A');
  });

  it('returns the top five contributors sorted descending', () => {
    const roster = Array.from({ length: 8 }, (_, i) => ({
      empId: `E${i}`,
      name: `Emp ${i}`,
      hireDate: '2018-01-01',
      baseMonthlySalary: 1_000_000 + i * 100_000,
    }));
    const s = computeCompanyGratuity(roster, asOf);
    expect(s.topFive).toHaveLength(5);
    expect(s.topFive[0].empId).toBe('E7');
    expect(s.topFive[4].empId).toBe('E3');
    // Strictly descending.
    for (let i = 0; i < s.topFive.length - 1; i++) {
      expect(s.topFive[i].amount).toBeGreaterThanOrEqual(s.topFive[i + 1].amount);
    }
  });
});
