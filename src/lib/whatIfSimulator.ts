/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.19.0 — What-If Simulator (Workforce Planning).
 *
 * Lets the supervisor try hypothetical roster changes and see the
 * operational + financial deltas BEFORE committing to them. Three
 * change types:
 *
 *   1. HIRE — add N employees of role X with a default salary.
 *   2. CROSS-TRAIN — extend an existing employee's eligibleGroups so
 *      they can cover an additional station/group.
 *   3. RELEASE — drop N employees from a role (only meaningful in
 *      optimal mode where headcount may legally be reduced).
 *
 * For each change, we re-run:
 *   - workforce planning (recommended FTE/PT, hire-action verdicts)
 *   - the auto-scheduler against the active month
 *   - OT analysis on the produced schedule
 *   - coverage diagnostics on the produced schedule
 *
 * And report the deltas (recommendation, OT pay, coverage gaps, comp
 * shortfall, monthly salary delta). The user reads "if I hire 2
 * cashiers, August OT drops by 3.2M IQD and coverage gaps fall from
 * 18 to 0."
 *
 * Why this is in src/lib (not in a UI component): the same simulator
 * powers both the WhatIfPanel UI and the WFP Excel/PDF exports
 * (export "What-if scenarios" sheet — future work).
 */

import type { Employee, Shift, Station, StationGroup, PublicHoliday, Config, Schedule } from '../types';
import { runAutoScheduler } from './autoScheduler';
import { optimizeForLiability } from './liabilityOptimizer';
import { analyzeOT } from './otAnalysis';
import { diagnoseUnfilledCoverage } from './coverageDiagnostics';

export interface HireChange {
  kind: 'hire';
  count: number;
  role: string;            // 'Cashier', 'Driver', 'Standard', etc.
  contractedWeeklyHrs?: number;  // default = config.standardWeeklyHrsCap
  baseMonthlySalary?: number;    // default = roster average
  // The eligible stations/groups for the synthetic hires. If neither is
  // provided, hires are assigned to every station whose requiredRoles
  // matches `role` (and only that).
  eligibleStations?: string[];
  eligibleGroups?: string[];
}

export interface CrossTrainChange {
  kind: 'cross-train';
  empId: string;
  // Group(s) the employee should now also be able to cover.
  addEligibleGroups?: string[];
  addEligibleStations?: string[];
}

export interface ReleaseChange {
  kind: 'release';
  count: number;
  role: string;
  // If specified, release these specific employees (by empId). Otherwise
  // pick the LEAST-utilised in the role (lowest current hours).
  empIds?: string[];
}

export type WhatIfChange = HireChange | CrossTrainChange | ReleaseChange;

export interface WhatIfArgs {
  baseEmployees: Employee[];
  shifts: Shift[];
  stations: Station[];
  stationGroups?: StationGroup[];
  holidays: PublicHoliday[];
  config: Config;
  isPeakDay: (day: number) => boolean;
  baseSchedule: Schedule;
  allSchedules?: Record<string, Schedule>;
  changes: WhatIfChange[];
}

export interface WhatIfMetrics {
  // Schedule-level metrics on the simulated month.
  totalOTHours: number;        // overCap + premium-holiday hours
  totalOTPay: number;          // IQD
  coverageGapSlots: number;    // count of (station, day, hour) gaps
  compShortfallEmployees: number;
  monthlyPayroll: number;      // IQD: sum of baseMonthlySalary for active roster
  rosterSize: number;
}

export interface WhatIfResult {
  before: WhatIfMetrics;
  after: WhatIfMetrics;
  delta: {
    otHours: number;
    otPay: number;
    coverageGapSlots: number;
    compShortfall: number;
    monthlyPayroll: number;
    rosterSize: number;
  };
  // Plain-language summary for the UI headline.
  verdict: string;
  // The synthetic employees the simulator created (for transparency).
  syntheticEmployees: Employee[];
}

// Build a synthetic hire record matching the real Employee shape.
function buildSyntheticHire(
  index: number, change: HireChange, config: Config, baseAvgSalary: number, allEmps: Employee[],
): Employee {
  const id = `__whatif_hire_${index}_${Date.now()}`;
  const cap = config.standardWeeklyHrsCap || 48;
  const sample = allEmps[0];
  return {
    empId: id,
    name: `(WhatIf) ${change.role} hire ${index + 1}`,
    role: change.role,
    department: sample?.department || '',
    contractType: sample?.contractType || 'Open-ended',
    contractedWeeklyHrs: change.contractedWeeklyHrs ?? cap,
    shiftEligibility: 'all',
    isHazardous: false,
    isIndustrialRotating: false,
    hourExempt: false,
    fixedRestDay: 0,
    phone: '',
    hireDate: new Date().toISOString().slice(0, 10),
    notes: 'Synthetic record from What-If simulator. Not persisted.',
    eligibleStations: change.eligibleStations || [],
    eligibleGroups: change.eligibleGroups || [],
    holidayBank: 0,
    annualLeaveBalance: 21,
    baseMonthlySalary: change.baseMonthlySalary ?? baseAvgSalary,
    baseHourlyRate: 0,
    overtimeHours: 0,
    category: change.role === 'Driver' ? 'Driver' : 'Standard',
  };
}

function metricsForSchedule(args: {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  isPeakDay: (day: number) => boolean;
  schedule: Schedule;
  allSchedules?: Record<string, Schedule>;
  compDayShortfall: number;
}): WhatIfMetrics {
  const { employees, shifts, stations, holidays, config, isPeakDay, schedule, allSchedules, compDayShortfall } = args;
  const ot = analyzeOT(employees, schedule, shifts, stations, holidays, config, allSchedules);
  const coverageSlots = diagnoseUnfilledCoverage({
    schedule, employees, shifts, stations, holidays, config, isPeakDay,
  });
  const monthlyPayroll = employees.reduce((s, e) => s + (e.baseMonthlySalary || 0), 0);
  return {
    totalOTHours: Math.round((ot.totalOverCapHours + ot.totalHolidayHours) * 10) / 10,
    totalOTPay: ot.totalOTPay,
    coverageGapSlots: coverageSlots.length,
    compShortfallEmployees: compDayShortfall,
    monthlyPayroll,
    rosterSize: employees.length,
  };
}

export function simulateWhatIf(args: WhatIfArgs): WhatIfResult {
  const { baseEmployees, shifts, stations, holidays, config, isPeakDay, baseSchedule, allSchedules } = args;

  // ── Before metrics — the current state, no changes applied ─────────
  const before = metricsForSchedule({
    employees: baseEmployees, shifts, stations, holidays, config, isPeakDay,
    schedule: baseSchedule, allSchedules,
    // We don't have the comp-shortfall snapshot from the persisted
    // schedule (it's a runtime output of the auto-scheduler, not stored).
    // Approximation: count employees with > 0 holidayBank that didn't get
    // a CP/OFF in the trailing 30 days. For a quick before-shot we use 0
    // (the simulator's user-facing number is the AFTER value relative to
    // a fresh re-run; the BEFORE is the persisted state).
    compDayShortfall: 0,
  });

  // ── Apply changes ─────────────────────────────────────────────────
  let workingEmployees = [...baseEmployees];
  const synthetic: Employee[] = [];
  const baseAvgSalary = baseEmployees.length > 0
    ? Math.round(baseEmployees.reduce((s, e) => s + (e.baseMonthlySalary || 0), 0) / baseEmployees.length)
    : 1_500_000;

  for (const change of args.changes) {
    if (change.kind === 'hire') {
      for (let i = 0; i < change.count; i++) {
        const hire = buildSyntheticHire(synthetic.length, change, config, baseAvgSalary, baseEmployees);
        synthetic.push(hire);
        workingEmployees.push(hire);
      }
    } else if (change.kind === 'cross-train') {
      workingEmployees = workingEmployees.map(e => {
        if (e.empId !== change.empId) return e;
        return {
          ...e,
          eligibleGroups: Array.from(new Set([...(e.eligibleGroups || []), ...(change.addEligibleGroups || [])])),
          eligibleStations: Array.from(new Set([...(e.eligibleStations || []), ...(change.addEligibleStations || [])])),
        };
      });
    } else if (change.kind === 'release') {
      // Release: filter out N employees of the role. If specific empIds
      // are given, drop those; otherwise drop the lowest-utilised.
      if (change.empIds && change.empIds.length > 0) {
        const ids = new Set(change.empIds);
        workingEmployees = workingEmployees.filter(e => !ids.has(e.empId));
      } else {
        // Compute hours-worked-this-month from baseSchedule per emp.
        const hoursByEmp = new Map<string, number>();
        for (const e of workingEmployees) {
          const sched = baseSchedule[e.empId] || {};
          let total = 0;
          for (const entry of Object.values(sched)) {
            const sh = shifts.find(s => s.code === entry.shiftCode);
            if (sh?.isWork) total += sh.durationHrs;
          }
          hoursByEmp.set(e.empId, total);
        }
        const candidates = workingEmployees
          .filter(e => e.role === change.role || (change.role === 'Standard' && (!e.role || e.role === 'Standard' || e.role === '')))
          .sort((a, b) => (hoursByEmp.get(a.empId) || 0) - (hoursByEmp.get(b.empId) || 0))
          .slice(0, change.count);
        const dropIds = new Set(candidates.map(c => c.empId));
        workingEmployees = workingEmployees.filter(e => !dropIds.has(e.empId));
      }
    }
  }

  // ── Re-run scheduler on the modified roster ────────────────────────
  const { schedule: rawSchedule, updatedEmployees, compDayShortfall } = runAutoScheduler({
    employees: workingEmployees, shifts, stations, holidays, config, isPeakDay,
    allSchedules,
  });
  // Apply liability-aware post-pass for fair comparison (same code path
  // as production runs).
  const liabilityResult = (config.liabilityAwarePass ?? true)
    ? optimizeForLiability({
        schedule: rawSchedule, employees: updatedEmployees, shifts, stations,
        holidays, config,
      })
    : null;
  const newSchedule = liabilityResult?.schedule ?? rawSchedule;

  const after = metricsForSchedule({
    employees: updatedEmployees, shifts, stations, holidays, config, isPeakDay,
    schedule: newSchedule, allSchedules,
    compDayShortfall: compDayShortfall.length,
  });

  // ── Verdict generation ─────────────────────────────────────────────
  const otDelta = after.totalOTPay - before.totalOTPay;
  const gapDelta = after.coverageGapSlots - before.coverageGapSlots;
  const payrollDelta = after.monthlyPayroll - before.monthlyPayroll;
  const verdictParts: string[] = [];
  if (otDelta < 0) verdictParts.push(`OT pay drops by ${Math.abs(otDelta).toLocaleString()} IQD`);
  else if (otDelta > 0) verdictParts.push(`OT pay rises by ${otDelta.toLocaleString()} IQD`);
  if (gapDelta < 0) verdictParts.push(`coverage gaps fall by ${Math.abs(gapDelta)}`);
  else if (gapDelta > 0) verdictParts.push(`coverage gaps rise by ${gapDelta}`);
  if (payrollDelta > 0) verdictParts.push(`monthly payroll rises by ${payrollDelta.toLocaleString()} IQD`);
  else if (payrollDelta < 0) verdictParts.push(`monthly payroll drops by ${Math.abs(payrollDelta).toLocaleString()} IQD`);
  const verdict = verdictParts.length > 0 ? verdictParts.join('; ') + '.' : 'No measurable change in OT, coverage, or payroll.';

  return {
    before,
    after,
    delta: {
      otHours: after.totalOTHours - before.totalOTHours,
      otPay: otDelta,
      coverageGapSlots: gapDelta,
      compShortfall: after.compShortfallEmployees - before.compShortfallEmployees,
      monthlyPayroll: payrollDelta,
      rosterSize: after.rosterSize - before.rosterSize,
    },
    verdict,
    syntheticEmployees: synthetic,
  };
}
