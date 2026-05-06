/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.19.0 — Liability-aware post-pass for the auto-scheduler.
 *
 * The base auto-scheduler builds a legal schedule but doesn't actively
 * minimise OT spend. This module is a SECOND pass that walks the
 * already-produced schedule and swaps assignments where doing so would
 * reduce a specific liability without breaking any law or coverage:
 *
 *   1. Over-cap OT swap — if employee A is over the monthly cap and
 *      employee B is under, swap A's last shift with a B-OFF day. The
 *      new B-shift must be one B is eligible for, must keep B under
 *      cap, and must not break consecutive-day rules. Coverage is
 *      preserved because the assignment moves wholesale.
 *
 *   2. Holiday-premium swap — same pattern but on holiday dates. Pulls
 *      a single PH-work assignment off A (who already accumulated more
 *      PH hours than the median) and gives it to B.
 *
 *   3. Comp-day rotation — if A worked a holiday and the auto-scheduler
 *      couldn't land a CP within the configured window because A had
 *      no eligible OFF day, look for a B-OFF day inside the window
 *      that A could swap into; A gets the OFF, B picks up the work.
 *
 * Reporting: every successful swap is recorded so the UI can show
 * "Saved 16 OT hours and 1 comp-day shortfall by reassigning 4 shifts".
 *
 * Conservatism principles:
 *   - Never break a hard cap, even if doing so saves money.
 *   - Never reduce coverage. Every swap is HC-neutral by construction.
 *   - Never violate eligibility (station's requiredRoles, employee's
 *     eligibleStations / eligibleGroups).
 *   - Never push an employee on protected leave (AL/SL/MAT) into work.
 *   - Never modify preserved (pre-locked) cells. The optimiser only
 *     touches cells the auto-scheduler itself produced.
 */

import { format } from 'date-fns';
import type { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../types';
import { parseHourBounds } from './time';
import { monthlyHourCap } from './payroll';
import { getEmployeeLeaveOnDate } from './leaves';
import { expandHolidayDates } from './holidays';
import { isSystemShift } from './systemShifts';

export interface OptimizerArgs {
  schedule: Schedule;
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  // Optional: locked cells that must not be touched. Mirrors the
  // auto-scheduler's preserveExisting input. Defaults to {}.
  preserveExisting?: Schedule;
  // Hard cap on the number of swap iterations to keep latency bounded
  // even on pathological inputs. Default 200; in practice the loop
  // converges in <50 iterations on real-data months.
  maxIterations?: number;
}

export interface OptimizerSwap {
  day: number;
  fromEmpId: string;
  fromEmpName: string;
  toEmpId: string;
  toEmpName: string;
  shiftCode: string;
  stationId?: string;
  // Reason the swap was performed.
  reason: 'over-cap' | 'holiday-premium' | 'comp-rotation';
  // Estimated hours saved on the originating employee's at-risk pool.
  hoursSaved: number;
}

export interface OptimizerResult {
  schedule: Schedule;
  swaps: OptimizerSwap[];
  // Aggregate counters for the UI.
  totalOverCapHoursSaved: number;
  totalHolidayHoursSaved: number;
  compRotationsAdded: number;
  iterations: number;
}

/**
 * Run the liability post-pass. Returns the (possibly mutated) schedule
 * along with a swap log. Idempotent — applying it twice on the same
 * input is a no-op once no profitable swap remains.
 */
export function optimizeForLiability(args: OptimizerArgs): OptimizerResult {
  const { schedule, employees, shifts, stations, holidays: rawHolidays, config, preserveExisting = {}, maxIterations = 200 } = args;

  const holidays = expandHolidayDates(rawHolidays);
  const cap = monthlyHourCap(config);
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));
  const stationById = new Map(stations.map(s => [s.id, s]));
  const empById = new Map(employees.map(e => [e.empId, e]));
  const holidayDates = new Set(holidays.map(h => h.date));
  const compWindowDays = Math.max(1, config.holidayCompWindowDays ?? 30);
  const driverDailyCap = config.driverDailyHrsCap ?? 9;
  const maxConsec = config.maxConsecWorkDays;
  const driverMaxConsec = config.driverMaxConsecWorkDays ?? maxConsec;

  // Deep clone the schedule so we never mutate the caller's data.
  const out: Schedule = {};
  for (const [empId, days] of Object.entries(schedule)) {
    out[empId] = {};
    for (const [d, e] of Object.entries(days)) out[empId][parseInt(d)] = { ...e };
  }

  const swaps: OptimizerSwap[] = [];

  // Cells the supervisor pre-locked must not be touched.
  const isLocked = (empId: string, day: number): boolean => {
    return !!preserveExisting?.[empId]?.[day];
  };

  // Compute total monthly hours for an employee (work shifts only).
  const monthlyHours = (empId: string): number => {
    let total = 0;
    const days = out[empId] || {};
    for (const entry of Object.values(days)) {
      const sh = shiftByCode.get(entry.shiftCode);
      if (sh?.isWork) total += sh.durationHrs;
    }
    return total;
  };

  // Consecutive-work run ending on `day` for `empId` (excluding `day`).
  const consecutiveBefore = (empId: string, day: number): number => {
    let n = 0;
    for (let d = day - 1; d >= 1; d--) {
      const e = out[empId]?.[d];
      const sh = e ? shiftByCode.get(e.shiftCode) : undefined;
      if (sh?.isWork) n++;
      else break;
    }
    return n;
  };
  // Consecutive-work run starting AFTER `day`.
  const consecutiveAfter = (empId: string, day: number): number => {
    let n = 0;
    for (let d = day + 1; d <= config.daysInMonth; d++) {
      const e = out[empId]?.[d];
      const sh = e ? shiftByCode.get(e.shiftCode) : undefined;
      if (sh?.isWork) n++;
      else break;
    }
    return n;
  };

  // Eligibility check — mirrors autoScheduler's same logic so swaps
  // never produce assignments the original pass would have refused.
  const eligibleForStation = (emp: Employee, station: Station): boolean => {
    const driver = emp.category === 'Driver';
    if (driver) return !!station.requiredRoles?.includes('Driver');
    if (station.requiredRoles?.includes('Driver')) return false;
    const hasAny = (emp.eligibleStations?.length ?? 0) > 0 || (emp.eligibleGroups?.length ?? 0) > 0;
    if (hasAny) {
      const directOk = emp.eligibleStations?.includes(station.id) ?? false;
      const groupOk = !!station.groupId && (emp.eligibleGroups?.includes(station.groupId) ?? false);
      if (!directOk && !groupOk) return false;
    }
    if (station.requiredRoles?.length && !station.requiredRoles.some(r => r === emp.role || r === 'Standard')) return false;
    return true;
  };

  const onAnyLeave = (emp: Employee, dateStr: string): boolean => !!getEmployeeLeaveOnDate(emp, dateStr);

  // Try a single A-to-B swap on `day`: A gives up its work shift, B
  // takes it. Returns true on success.
  const trySwap = (
    fromEmp: Employee, toEmp: Employee, day: number, reason: OptimizerSwap['reason'],
  ): boolean => {
    if (fromEmp.empId === toEmp.empId) return false;
    if (isLocked(fromEmp.empId, day) || isLocked(toEmp.empId, day)) return false;

    const fromCell = out[fromEmp.empId]?.[day];
    const toCell = out[toEmp.empId]?.[day];
    if (!fromCell || !toCell) return false;
    const fromShift = shiftByCode.get(fromCell.shiftCode);
    const toShift = shiftByCode.get(toCell.shiftCode);
    if (!fromShift?.isWork) return false;
    // toCell must be a non-work cell (OFF/CP). Don't swap into protected
    // leave (AL/SL/MAT) — the employee is on leave, can't be reassigned.
    if (!toShift) return false;
    if (toShift.isWork) return false;
    if (['AL', 'SL', 'MAT', 'PH'].includes(toShift.code)) return false;

    const station = fromCell.stationId ? stationById.get(fromCell.stationId) : undefined;
    if (!station) return false;
    if (!eligibleForStation(toEmp, station)) return false;

    // Date string for leave + holiday checks.
    const date = new Date(config.year, config.month - 1, day);
    const dateStr = format(date, 'yyyy-MM-dd');
    if (onAnyLeave(toEmp, dateStr)) return false;
    const dow = date.getDay() + 1;
    if (toEmp.fixedRestDay !== 0 && dow === toEmp.fixedRestDay) return false;

    // Cap math: A loses fromShift hours, B gains them.
    const driverTo = toEmp.category === 'Driver';
    const dailyCap = driverTo ? driverDailyCap : config.standardDailyHrsCap;
    if (fromShift.durationHrs > dailyCap) return false;

    const toMonthly = monthlyHours(toEmp.empId);
    const fromMonthly = monthlyHours(fromEmp.empId);
    // Reject if the swap would push B over cap or wouldn't actually
    // reduce A's at-risk pool.
    if (toMonthly + fromShift.durationHrs > cap) return false;
    if (fromMonthly <= cap && reason === 'over-cap') {
      // No over-cap savings if A wasn't over to begin with.
      return false;
    }

    // Consecutive-work check on B with the new shift in place. Compute
    // the run that would form if B works on `day`.
    const consecB = consecutiveBefore(toEmp.empId, day) + 1 + consecutiveAfter(toEmp.empId, day);
    const consecCap = driverTo ? driverMaxConsec : maxConsec;
    if (consecB > consecCap) return false;

    // Apply the swap: A → toCell.shiftCode (typically OFF), B → fromCell.
    out[fromEmp.empId][day] = { shiftCode: toCell.shiftCode };
    out[toEmp.empId][day] = { shiftCode: fromCell.shiftCode, stationId: fromCell.stationId };

    swaps.push({
      day,
      fromEmpId: fromEmp.empId,
      fromEmpName: fromEmp.name,
      toEmpId: toEmp.empId,
      toEmpName: toEmp.name,
      shiftCode: fromCell.shiftCode,
      stationId: fromCell.stationId,
      reason,
      hoursSaved: fromShift.durationHrs,
    });
    return true;
  };

  // ── Pass 1 — Over-cap swaps ─────────────────────────────────────────
  // Walk highest-hours employees first; for each over-cap day in the
  // back half of the month, look for someone with fewer monthly hours
  // who has an OFF cell that day they're eligible to take.
  let iterations = 0;
  let totalOverCapSaved = 0;
  let foundProfitable = true;
  while (foundProfitable && iterations < maxIterations) {
    foundProfitable = false;
    iterations++;

    // Sort by current monthly hours, descending. Top of list = at-risk.
    const sortedEmps = [...employees].sort(
      (a, b) => monthlyHours(b.empId) - monthlyHours(a.empId),
    );

    outer:
    for (const fromEmp of sortedEmps) {
      const fromHours = monthlyHours(fromEmp.empId);
      if (fromHours <= cap) break; // sorted desc, so no one beyond is over.

      // Walk THIS employee's days from latest to earliest. The latest
      // shift is the marginal one — the one whose removal saves the
      // most against the cap math.
      for (let day = config.daysInMonth; day >= 1; day--) {
        const cell = out[fromEmp.empId]?.[day];
        if (!cell) continue;
        if (isLocked(fromEmp.empId, day)) continue;
        const sh = shiftByCode.get(cell.shiftCode);
        if (!sh?.isWork) continue;

        // Find any OFF/CP cell on the same day among employees with lower hours.
        for (const toEmp of [...sortedEmps].reverse()) {
          if (monthlyHours(toEmp.empId) >= fromHours) break;
          if (trySwap(fromEmp, toEmp, day, 'over-cap')) {
            totalOverCapSaved += sh.durationHrs;
            foundProfitable = true;
            continue outer;
          }
        }
      }
    }
  }

  // ── Pass 2 — Holiday-premium swaps ─────────────────────────────────
  // Goal: reduce the spread of holiday hours across the roster so the
  // 2× premium is more evenly distributed. We don't eliminate holiday
  // hours (someone has to work the holiday) but evening out who pays
  // the premium prevents one employee from accumulating the entire
  // holiday-OT pool.
  let totalHolidaySaved = 0;
  foundProfitable = true;
  while (foundProfitable && iterations < maxIterations) {
    foundProfitable = false;
    iterations++;

    // Holiday hours per employee.
    const holidayHoursByEmp = new Map<string, number>();
    for (const emp of employees) {
      let hh = 0;
      for (let d = 1; d <= config.daysInMonth; d++) {
        const c = out[emp.empId]?.[d];
        if (!c) continue;
        const sh = shiftByCode.get(c.shiftCode);
        if (!sh?.isWork) continue;
        const ds = format(new Date(config.year, config.month - 1, d), 'yyyy-MM-dd');
        if (holidayDates.has(ds)) hh += sh.durationHrs;
      }
      holidayHoursByEmp.set(emp.empId, hh);
    }

    const sortedByHoliday = [...employees].sort(
      (a, b) => (holidayHoursByEmp.get(b.empId) || 0) - (holidayHoursByEmp.get(a.empId) || 0),
    );
    if (sortedByHoliday.length < 2) break;
    const top = sortedByHoliday[0];
    const bottom = sortedByHoliday[sortedByHoliday.length - 1];
    const topHours = holidayHoursByEmp.get(top.empId) || 0;
    const bottomHours = holidayHoursByEmp.get(bottom.empId) || 0;
    // Stop if the spread is already ≤ one shift's worth.
    if (topHours - bottomHours < (config.standardDailyHrsCap || 8)) break;

    // Look for a holiday day where `top` is working and `bottom` is OFF.
    let swapped = false;
    for (let day = 1; day <= config.daysInMonth && !swapped; day++) {
      const ds = format(new Date(config.year, config.month - 1, day), 'yyyy-MM-dd');
      if (!holidayDates.has(ds)) continue;
      const c = out[top.empId]?.[day];
      const sh = c ? shiftByCode.get(c.shiftCode) : undefined;
      if (!sh?.isWork) continue;
      if (trySwap(top, bottom, day, 'holiday-premium')) {
        totalHolidaySaved += sh.durationHrs;
        swapped = true;
        foundProfitable = true;
      }
    }
  }

  // ── Pass 3 — Comp rotation gap-filling ──────────────────────────────
  // For each PH-work day, ensure the worker gets an OFF/CP within the
  // comp window. If they don't (because the auto-scheduler couldn't
  // land it), look for a same-window OFF cell to swap.
  let compRotations = 0;
  for (const emp of employees) {
    const days = out[emp.empId] || {};
    for (let day = 1; day <= config.daysInMonth; day++) {
      const c = days[day];
      if (!c) continue;
      const sh = shiftByCode.get(c.shiftCode);
      if (!sh?.isWork) continue;
      const ds = format(new Date(config.year, config.month - 1, day), 'yyyy-MM-dd');
      if (!holidayDates.has(ds)) continue;
      // Look for a non-work cell within `compWindowDays`.
      let hasComp = false;
      for (let k = 1; k <= compWindowDays && day + k <= config.daysInMonth; k++) {
        const next = days[day + k];
        if (!next) continue;
        const nsh = shiftByCode.get(next.shiftCode);
        if (nsh && !nsh.isWork && !['AL', 'SL', 'MAT'].includes(nsh.code)) {
          hasComp = true;
          break;
        }
      }
      if (hasComp) continue;

      // No comp landed — try to swap a work cell within the window with
      // someone else's OFF/CP. Find emps whose OFF day in the window
      // could absorb emp's work shift.
      for (let k = 1; k <= compWindowDays && day + k <= config.daysInMonth; k++) {
        const targetDay = day + k;
        const myCell = days[targetDay];
        if (!myCell) continue;
        const mySh = shiftByCode.get(myCell.shiftCode);
        if (!mySh?.isWork) continue; // I'm working that day; need to give it away
        if (isLocked(emp.empId, targetDay)) continue;

        // Find a different employee whose targetDay cell is OFF/CP and
        // who can take my shift.
        for (const other of employees) {
          if (other.empId === emp.empId) continue;
          const oCell = out[other.empId]?.[targetDay];
          const oSh = oCell ? shiftByCode.get(oCell.shiftCode) : undefined;
          if (!oSh || oSh.isWork) continue;
          if (isSystemShift(oSh.code) && ['AL', 'SL', 'MAT', 'PH'].includes(oSh.code)) continue;
          if (trySwap(emp, other, targetDay, 'comp-rotation')) {
            compRotations++;
            break;
          }
        }
      }
    }
  }

  return {
    schedule: out,
    swaps,
    totalOverCapHoursSaved: totalOverCapSaved,
    totalHolidayHoursSaved: totalHolidaySaved,
    compRotationsAdded: compRotations,
    iterations,
  };
}

// Helpers re-exported for tests + the UI report.
export function summarizeOptimizerSavings(
  result: OptimizerResult,
  config: Config,
  avgHourlyRate: number,
): {
  hoursSaved: number;
  iqdSaved: number;
  swapCount: number;
} {
  const otRateDay = config.otRateDay ?? 1.5;
  const otRateNight = config.otRateNight ?? 2.0;
  const overCapIQD = result.totalOverCapHoursSaved * avgHourlyRate * otRateDay;
  const holidayIQD = result.totalHolidayHoursSaved * avgHourlyRate * (otRateNight - 1);
  const compIQD = result.compRotationsAdded * 8 * avgHourlyRate * (otRateNight - 1);
  return {
    hoursSaved: result.totalOverCapHoursSaved + result.totalHolidayHoursSaved,
    iqdSaved: Math.round(overCapIQD + holidayIQD + compIQD),
    swapCount: result.swaps.length,
  };
}

void parseHourBounds;
