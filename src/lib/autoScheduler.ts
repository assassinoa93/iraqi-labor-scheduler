import { format } from 'date-fns';
import { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../types';
import { parseHourBounds, type HourBounds } from './time';

interface RunArgs {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  isPeakDay: (day: number) => boolean;
}

export interface RunResult {
  schedule: Schedule;
  updatedEmployees: Employee[];
}

/**
 * Build a full month schedule by greedy day-by-day, hour-by-hour station fill.
 *
 * Three escalating strictness levels:
 *  1. Legal — respects all caps + fixed rest day + max consecutive days
 *  2. Continuity — allows OT and consecutive-day breaches but still respects fixed rest
 *  3. Emergency — only "not already working today" + station eligibility
 *
 * Drivers (category === 'Driver') use Art. 88 caps and only land on stations
 * whose requiredRoles list includes 'Driver'. Rotating-rest staff (fixedRestDay === 0)
 * are governed by maxConsecWorkDays + the rolling-7-day weekly cap; the candidate
 * sort prefers those who recently rested, distributing rest naturally across the week.
 */
export function runAutoScheduler({ employees, shifts, stations, holidays, config, isPeakDay }: RunArgs): RunResult {
  const newSchedule: Schedule = {};
  const workShifts = shifts.filter(s => s.isWork);

  if (workShifts.length === 0 || stations.length === 0) {
    throw new Error('Auto-scheduler requires shifts and stations defined.');
  }

  // Indexes built once and reused. `shiftByCode` replaces every `shifts.find()`
  // inside the hot loop. `shiftBounds` and `stationBounds` cache the parsed
  // HH:mm → integer-hour conversion.
  const shiftByCode = new Map<string, Shift>(shifts.map(s => [s.code, s]));
  const shiftBounds = new Map<string, HourBounds>(shifts.map(s => [s.code, parseHourBounds(s.start, s.end)]));
  const stationBounds = new Map<string, HourBounds>(stations.map(st => [st.id, parseHourBounds(st.openingTime, st.closingTime)]));
  // Workshift list pre-sorted longest-first; each entry's hour bounds are
  // baked in so we can skip the runtime split during validShifts filtering.
  const workShiftsSorted = [...workShifts]
    .map(s => ({ shift: s, bounds: shiftBounds.get(s.code)! }))
    .sort((a, b) => b.shift.durationHrs - a.shift.durationHrs);

  const consecutiveWork = new Map<string, number>();
  const totalHoursWorked = new Map<string, number>();
  const usedHolidayBankThisMonth = new Map<string, number>();
  const updatedEmployees = [...employees];
  const empIndexById = new Map<string, number>(updatedEmployees.map((e, i) => [e.empId, i]));

  employees.forEach(emp => {
    newSchedule[emp.empId] = {};
    consecutiveWork.set(emp.empId, 0);
    totalHoursWorked.set(emp.empId, 0);
    usedHolidayBankThisMonth.set(emp.empId, 0);
  });

  const holidayDates = new Set(holidays.map(h => h.date));

  const driverCfg = {
    dailyHrsCap: config.driverDailyHrsCap ?? 9,
    weeklyHrsCap: config.driverWeeklyHrsCap ?? 56,
    maxConsecWorkDays: config.driverMaxConsecWorkDays ?? 6,
  };

  const ramadanCap = config.ramadanDailyHrsCap ?? 6;

  const isOnMaternityLeave = (emp: Employee, dateStr: string): boolean => {
    if (!emp.maternityLeaveStart || !emp.maternityLeaveEnd) return false;
    return dateStr >= emp.maternityLeaveStart && dateStr <= emp.maternityLeaveEnd;
  };

  const isOnSickLeave = (emp: Employee, dateStr: string): boolean => {
    if (!emp.sickLeaveStart || !emp.sickLeaveEnd) return false;
    return dateStr >= emp.sickLeaveStart && dateStr <= emp.sickLeaveEnd;
  };

  const isRamadan = (dateStr: string): boolean => {
    if (!config.ramadanStart || !config.ramadanEnd) return false;
    return dateStr >= config.ramadanStart && dateStr <= config.ramadanEnd;
  };

  // Per-day index: stationId → Set<empId> already covering at least part of
  // the station's window. Built incrementally as we assign, so the headcount
  // check at any (hour, station) is O(empsAtStation) instead of O(employees).
  let dayAssignmentsByStation = new Map<string, Set<string>>();

  const headcountAtHour = (stationId: string, hour: number): number => {
    const empSet = dayAssignmentsByStation.get(stationId);
    if (!empSet) return 0;
    let n = 0;
    for (const empId of empSet) {
      // We index by station so all entries here are already at this station.
      // Just check the shift's hour bounds (cached).
      const empSchedule = newSchedule[empId];
      const assignment = empSchedule[currentDay];
      if (!assignment) continue;
      const b = shiftBounds.get(assignment.shiftCode);
      if (b && hour >= b.open && hour < b.close) n++;
    }
    return n;
  };

  const evaluate = (
    emp: Employee, day: number, shift: Shift, stationId: string,
    level: 1 | 2 | 3, peak: boolean, station: Station, dayOfWeek: number,
    dateStr: string,
  ): boolean => {
    if (newSchedule[emp.empId][day]) return false;

    // Protected leaves are non-negotiable across every relaxation level —
    // even emergency-mode level 3 won't assign to someone on leave.
    if (isOnMaternityLeave(emp, dateStr)) return false;
    if (isOnSickLeave(emp, dateStr)) return false;

    const driver = emp.category === 'Driver';
    if (driver) {
      if (!station.requiredRoles?.includes('Driver')) return false;
    } else {
      const isEligible = emp.eligibleStations.length === 0 || emp.eligibleStations.includes(stationId);
      if (!isEligible) return false;
      if (station.requiredRoles?.length && !station.requiredRoles.some(r => r === emp.role || r === 'Standard')) return false;
    }

    if (driver && shift.durationHrs > driverCfg.dailyHrsCap && level < 3) return false;

    // Ramadan reduced-hours mode: enforce the lower cap for non-driver, non-
    // hazardous staff at strictness levels 1 and 2. Level 3 (emergency) lets
    // it slide so coverage gaps don't leave a station unstaffed.
    if (level < 3 && !driver && !emp.isHazardous && !shift.isHazardous && isRamadan(dateStr)) {
      if (shift.durationHrs > ramadanCap) return false;
    }

    if (!peak && level < 3) {
      const currentBank = emp.holidayBank - (usedHolidayBankThisMonth.get(emp.empId) || 0);
      if (currentBank > 0 && dayOfWeek !== emp.fixedRestDay) {
        return false;
      }
    }

    const consecCap = driver ? driverCfg.maxConsecWorkDays : config.maxConsecWorkDays;

    if (level === 1) {
      // fixedRestDay === 0 means rotating; rest is enforced via maxConsecWorkDays + rolling-7 below.
      if (emp.fixedRestDay !== 0 && dayOfWeek === emp.fixedRestDay) return false;
      if ((consecutiveWork.get(emp.empId) || 0) >= consecCap) return false;

      // Rolling 7-day window: walk the assigned days backwards using the cached
      // shiftByCode lookup instead of `shifts.find()` per day.
      let rolling = 0;
      for (let d = Math.max(1, day - 6); d < day; d++) {
        const entry = newSchedule[emp.empId][d];
        if (!entry) continue;
        const s = shiftByCode.get(entry.shiftCode);
        if (s) rolling += s.durationHrs;
      }
      const cap = driver
        ? driverCfg.weeklyHrsCap
        : (emp.isHazardous ? config.hazardousWeeklyHrsCap : config.standardWeeklyHrsCap);
      if (rolling + shift.durationHrs > cap) return false;
    }

    if (level === 2) {
      if (emp.fixedRestDay !== 0 && dayOfWeek === emp.fixedRestDay) return false;
    }

    return true;
  };

  // Sort once; the cashier-priority rule is stable across the whole run.
  const sortedStations = [...stations].sort((a, b) => {
    const isA = a.id.startsWith('ST-C');
    const isB = b.id.startsWith('ST-C');
    if (isA !== isB) return isA ? -1 : 1;
    return 0;
  });

  // Reusable per-iteration scratch — avoids re-allocating a 24-element array
  // for every day of the schedule.
  const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);

  // `currentDay` is closed over by `headcountAtHour` so the helper doesn't need
  // to take a day parameter on every call from the hot loop.
  let currentDay = 1;

  for (let day = 1; day <= config.daysInMonth; day++) {
    currentDay = day;
    dayAssignmentsByStation = new Map<string, Set<string>>();
    const date = new Date(config.year, config.month - 1, day);
    const dateStr = format(date, 'yyyy-MM-dd');
    const isHoliday = holidayDates.has(dateStr);
    const peak = isPeakDay(day);
    const dayOfWeek = date.getDay() + 1;

    for (const hour of HOURS_24) {
      for (const st of sortedStations) {
        const stBounds = stationBounds.get(st.id)!;
        if (hour < stBounds.open || hour >= stBounds.close) continue;

        const requiredHC = peak ? st.peakMinHC : st.normalMinHC;
        if (requiredHC <= 0) continue;

        let currentHC = headcountAtHour(st.id, hour);
        if (currentHC >= requiredHC) continue;

        // Cache the valid-shifts list for this hour. workShiftsSorted is already
        // longest-first so we just filter by hour bounds.
        const validShifts: Shift[] = [];
        for (const ws of workShiftsSorted) {
          if (hour >= ws.bounds.open && hour < ws.bounds.close) validShifts.push(ws.shift);
        }
        if (validShifts.length === 0) continue;

        const sortedPool = [...employees].sort((a, b) => {
          const hA = totalHoursWorked.get(a.empId) || 0;
          const hB = totalHoursWorked.get(b.empId) || 0;
          if (Math.abs(hA - hB) > 4) return hA - hB;
          const cA = consecutiveWork.get(a.empId) || 0;
          const cB = consecutiveWork.get(b.empId) || 0;
          return cA - cB;
        });

        while (currentHC < requiredHC) {
          let assigned = false;
          for (const level of [1, 2, 3] as (1 | 2 | 3)[]) {
            for (const targetShift of validShifts) {
              const candidate = sortedPool.find(e =>
                evaluate(e, day, targetShift, st.id, level, peak, st, dayOfWeek, dateStr),
              );
              if (candidate) {
                newSchedule[candidate.empId][day] = { shiftCode: targetShift.code, stationId: st.id };
                totalHoursWorked.set(candidate.empId, (totalHoursWorked.get(candidate.empId) || 0) + targetShift.durationHrs);
                consecutiveWork.set(candidate.empId, (consecutiveWork.get(candidate.empId) || 0) + 1);

                let stSet = dayAssignmentsByStation.get(st.id);
                if (!stSet) {
                  stSet = new Set<string>();
                  dayAssignmentsByStation.set(st.id, stSet);
                }
                stSet.add(candidate.empId);

                if (isHoliday) {
                  const idx = empIndexById.get(candidate.empId);
                  if (idx !== undefined) {
                    updatedEmployees[idx] = { ...updatedEmployees[idx], holidayBank: (updatedEmployees[idx].holidayBank || 0) + 1 };
                  }
                }

                assigned = true;
                currentHC++;
                break;
              }
            }
            if (assigned) break;
          }
          if (!assigned) break; // Could not fill station
        }
      }
    }

    // After-day pass: fill OFF (or MAT/SL for protected-leave dates) and
    // decay the holiday bank where applicable. empIndexById replaces the
    // previous O(n) `findIndex` per employee.
    for (const e of employees) {
      if (newSchedule[e.empId][day]) continue;
      const onMaternity = isOnMaternityLeave(e, dateStr);
      const onSick = !onMaternity && isOnSickLeave(e, dateStr);
      const onLeave = onMaternity || onSick;
      const code = onMaternity ? 'MAT' : onSick ? 'SL' : 'OFF';
      newSchedule[e.empId][day] = { shiftCode: code };
      consecutiveWork.set(e.empId, 0);

      // Protected-leave days do not consume the holiday bank — the employee
      // is on legally protected leave, not off duty.
      if (!peak && dayOfWeek !== e.fixedRestDay && !onLeave) {
        const idx = empIndexById.get(e.empId);
        if (idx !== undefined && updatedEmployees[idx].holidayBank > 0) {
          updatedEmployees[idx].holidayBank -= 1;
          usedHolidayBankThisMonth.set(e.empId, (usedHolidayBankThisMonth.get(e.empId) || 0) + 1);
        }
      }
    }
  }

  return { schedule: newSchedule, updatedEmployees };
}
