/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.24.0 — End-of-Service Gratuity calculator (Iraqi Labor Law Art. 137).
 *
 * The statute grants a separation gratuity tiered on years of service:
 *   - For each of the FIRST five years of service: half a month's wage
 *   - For each year BEYOND five years of service: one month's wage
 *
 * Calculated on the employee's last drawn monthly wage (we use
 * `baseMonthlySalary` from the Employee record — the same field that
 * powers payroll). Partial years are pro-rated on a 365-day basis so
 * an employee with 5 years and 6 months gets 2.5 months (5 × 0.5) for
 * the first five plus 0.5 months (0.5 × 1.0) for the half-year above
 * five = 3.0 months of wage in total.
 *
 * This module is reporting-only: it estimates the company's gratuity
 * liability at a snapshot date. The platform does NOT process or
 * disburse the actual payment.
 *
 * Forfeiture under Art. 138 (gross misconduct etc.) is out of scope —
 * the caller chooses whether to display gratuity for a given employee.
 */

import type { Employee } from '../types';

/**
 * Years of service between `hireDate` and `asOfDate`. Returns a positive
 * decimal; negative results (asOf before hire) clamp to zero so the UI
 * doesn't show a paradoxical negative balance.
 *
 * Both inputs are ISO YYYY-MM-DD strings. Uses 365.25 days/year to
 * smooth leap-year drift over multi-year tenures.
 */
export function yearsOfService(hireDate: string, asOfDate: string): number {
  const hire = Date.parse(hireDate);
  const asOf = Date.parse(asOfDate);
  if (!Number.isFinite(hire) || !Number.isFinite(asOf)) return 0;
  const diffMs = asOf - hire;
  if (diffMs <= 0) return 0;
  const days = diffMs / 86_400_000;
  return days / 365.25;
}

export interface GratuityBreakdown {
  /** Total estimated liability in IQD (or whatever currency the monthly
   *  wage is expressed in — the calculator is currency-agnostic). */
  totalAmount: number;
  /** Years of service as of the snapshot date (decimal). */
  yearsServed: number;
  /** Years credited at the half-month rate (the first 5 years tier). */
  firstTierYears: number;
  /** Years credited at the one-month rate (years beyond 5). */
  secondTierYears: number;
  /** Monetary share earned in the half-month tier. */
  firstTierAmount: number;
  /** Monetary share earned in the full-month tier. */
  secondTierAmount: number;
  /** Total expressed as a multiple of the monthly wage, for the UI
   *  to render "X.X × monthly". */
  monthsOfWage: number;
}

const FIRST_TIER_CAP_YEARS = 5;
const FIRST_TIER_RATE_PER_YEAR = 0.5;  // half a month per year
const SECOND_TIER_RATE_PER_YEAR = 1.0; // one month per year

/**
 * Estimate the end-of-service gratuity a single employee has accrued
 * up to `asOfDate`. Returns zero across the board when the employee
 * has no positive tenure or no monthly wage.
 */
export function computeGratuity(
  employee: Pick<Employee, 'hireDate' | 'baseMonthlySalary'>,
  asOfDate: string,
): GratuityBreakdown {
  const yearsServed = yearsOfService(employee.hireDate ?? '', asOfDate);
  const monthly = Math.max(0, employee.baseMonthlySalary ?? 0);

  const firstTierYears = Math.min(yearsServed, FIRST_TIER_CAP_YEARS);
  const secondTierYears = Math.max(0, yearsServed - FIRST_TIER_CAP_YEARS);

  const firstTierAmount = firstTierYears * FIRST_TIER_RATE_PER_YEAR * monthly;
  const secondTierAmount = secondTierYears * SECOND_TIER_RATE_PER_YEAR * monthly;
  const totalAmount = firstTierAmount + secondTierAmount;
  const monthsOfWage = monthly > 0 ? totalAmount / monthly : 0;

  return {
    totalAmount,
    yearsServed,
    firstTierYears,
    secondTierYears,
    firstTierAmount,
    secondTierAmount,
    monthsOfWage,
  };
}

export interface CompanyGratuitySummary {
  /** Total gratuity liability across all employees (IQD). */
  totalLiability: number;
  /** Average liability per employee with positive tenure. */
  avgPerEmployee: number;
  /** Number of employees contributing a non-zero amount. */
  contributors: number;
  /** Top-five employees by individual liability, useful for the dashboard. */
  topFive: Array<{ empId: string; name: string; amount: number; yearsServed: number }>;
}

/**
 * Aggregate the gratuity liability for an entire roster at a snapshot
 * date. The CFO question this answers: "If we settled every contract
 * today, what would Art. 137 owe in total?"
 */
export function computeCompanyGratuity(
  employees: Array<Pick<Employee, 'empId' | 'name' | 'hireDate' | 'baseMonthlySalary'>>,
  asOfDate: string,
): CompanyGratuitySummary {
  let totalLiability = 0;
  let contributors = 0;
  const perEmployee: Array<{ empId: string; name: string; amount: number; yearsServed: number }> = [];
  for (const emp of employees) {
    const g = computeGratuity(emp, asOfDate);
    if (g.totalAmount > 0) {
      contributors++;
      totalLiability += g.totalAmount;
    }
    perEmployee.push({
      empId: emp.empId,
      name: emp.name,
      amount: g.totalAmount,
      yearsServed: g.yearsServed,
    });
  }
  const avgPerEmployee = contributors > 0 ? totalLiability / contributors : 0;
  const topFive = perEmployee
    .filter(p => p.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  return { totalLiability, avgPerEmployee, contributors, topFive };
}
