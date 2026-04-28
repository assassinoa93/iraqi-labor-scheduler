import { Employee, Shift, PublicHoliday, Config, Schedule } from '../types';
import { format } from 'date-fns';
import { monthlyHourCap } from './payroll';

export interface EmployeeRunningStats {
  totalHrs: number;          // Total work hours in the active month
  monthlyCap: number;        // Cap derived from contract / config
  weeklyHrsRolling: number;  // Max hours in any rolling 7-day window
  weeklyCap: number;
  longestStreakDays: number; // Longest consecutive work-day streak
  maxConsecCap: number;
  lastWorkedDay: number | null;
  daysWorked: number;
  daysOff: number;
  daysOnLeave: number;       // Cells stamped with non-work codes that look like leave (SL/AL/MAT/OFF)
}

const LEAVE_CODES = new Set(['SL', 'AL', 'MAT', 'OFF']);

// Lightweight per-employee summary for the active month. Computed on the
// fly because the schedule changes frequently; the work is O(daysInMonth)
// per employee, well under the perf budget for a tooltip.
export function computeEmployeeRunningStats(
  emp: Employee,
  schedule: Schedule,
  shifts: Shift[],
  holidays: PublicHoliday[],
  config: Config,
): EmployeeRunningStats {
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));
  const empSched = schedule[emp.empId] || {};
  let totalHrs = 0;
  let daysWorked = 0;
  let daysOnLeave = 0;
  let longestStreak = 0;
  let currentStreak = 0;
  let lastWorkedDay: number | null = null;

  for (let d = 1; d <= config.daysInMonth; d++) {
    const entry = empSched[d];
    if (!entry) {
      currentStreak = 0;
      continue;
    }
    const sh = shiftByCode.get(entry.shiftCode);
    if (sh?.isWork) {
      totalHrs += sh.durationHrs;
      daysWorked++;
      lastWorkedDay = d;
      currentStreak++;
      if (currentStreak > longestStreak) longestStreak = currentStreak;
    } else {
      currentStreak = 0;
      if (LEAVE_CODES.has(entry.shiftCode)) daysOnLeave++;
    }
  }

  // Rolling 7-day max (Iraqi Labor Law's weekly cap is enforced as any
  // rolling window, not Sun-Sat). Slide a 7-day window across the month.
  let weeklyHrsRolling = 0;
  for (let start = 1; start <= config.daysInMonth; start++) {
    let win = 0;
    for (let d = start; d < start + 7 && d <= config.daysInMonth; d++) {
      const entry = empSched[d];
      const sh = entry ? shiftByCode.get(entry.shiftCode) : undefined;
      if (sh?.isWork) win += sh.durationHrs;
    }
    if (win > weeklyHrsRolling) weeklyHrsRolling = win;
  }

  const isDriver = emp.category === 'Driver';
  const weeklyCap = isDriver ? (config.driverWeeklyHrsCap ?? 56) : (emp.isHazardous ? config.hazardousWeeklyHrsCap : config.standardWeeklyHrsCap);
  const maxConsecCap = isDriver ? (config.driverMaxConsecWorkDays ?? 6) : config.maxConsecWorkDays;

  return {
    totalHrs,
    monthlyCap: monthlyHourCap(config),
    weeklyHrsRolling,
    weeklyCap,
    longestStreakDays: longestStreak,
    maxConsecCap,
    lastWorkedDay,
    daysWorked,
    daysOff: config.daysInMonth - daysWorked - daysOnLeave,
    daysOnLeave,
  };
}

// Render a one-line summary suitable for use in a `title` tooltip. Designed
// to read like a labor-law dashboard glance: hours-vs-cap, weekly window,
// longest streak, last day worked.
export function formatEmployeeStatsTooltip(stats: EmployeeRunningStats): string {
  const parts: string[] = [];
  parts.push(`Hours: ${stats.totalHrs.toFixed(1)} / ${stats.monthlyCap}`);
  parts.push(`Peak weekly: ${stats.weeklyHrsRolling.toFixed(1)} / ${stats.weeklyCap}`);
  parts.push(`Longest streak: ${stats.longestStreakDays} / ${stats.maxConsecCap} days`);
  if (stats.lastWorkedDay) parts.push(`Last worked: day ${stats.lastWorkedDay}`);
  parts.push(`Worked ${stats.daysWorked}d · Off ${stats.daysOff}d · Leave ${stats.daysOnLeave}d`);
  return parts.join('\n');
}
