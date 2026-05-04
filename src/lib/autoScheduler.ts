import { format } from 'date-fns';
import { Employee, Shift, Station, PublicHoliday, Config, Schedule, HolidayCompMode } from '../types';
import { parseHourBounds, parseHour, type HourBounds } from './time';
import { getEmployeeLeaveOnDate } from './leaves';
import { expandHolidayDates } from './holidays';

interface RunArgs {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  isPeakDay: (day: number) => boolean;
  // Optional: prior month's allSchedules. When provided, the rolling-7-day
  // check at the start of the month sees the trailing days of the previous
  // month so the cap doesn't reset arbitrarily on day 1.
  allSchedules?: Record<string, Schedule>;
  // Optional: an existing schedule whose entries should be preserved instead
  // of overwritten. Drives the "Optimal Schedule (Preserve Absences)" mode —
  // the user inputs leaves / vacations / shift overrides manually, then asks
  // the scheduler to fill the rest of the month around them. Any cell with
  // a non-empty entry in `preserveExisting` is locked: the algorithm won't
  // touch it, won't reassign the employee on that day, and counts the
  // entry's hours toward the rolling-7-day window.
  preserveExisting?: Schedule;
  // v2.2.0 — optional day range to scope the run within the active
  // month. Defaults to the full month. The caller is responsible for
  // pre-populating `preserveExisting` with cells OUTSIDE the range when
  // fresh mode is desired (so out-of-range cells survive the rebuild) —
  // App.tsx orchestrates this for both fresh + preserve modes.
  startDay?: number;
  endDay?: number;
}

export interface RunResult {
  schedule: Schedule;
  updatedEmployees: Employee[];
  // v1.16: residual comp-day debt at the end of the run. Each entry is an
  // employee whose PH-work days inside this month never received an
  // OFF/leave within the comp window — i.e. the schedule could not fully
  // satisfy Art. 74's comp-rest-day requirement, usually because the
  // current HC is too thin to spare anyone for OFF on the busy days
  // following the holiday. Consumers (preview modal, workforce planner)
  // surface this as a compliance + capacity signal.
  compDayShortfall: Array<{ empId: string; debtDays: number }>;
}

const ART86_DEFAULT_NIGHT_START = '22:00';
const ART86_DEFAULT_NIGHT_END = '07:00';

const shiftOverlapsNightWindow = (shiftStart: string, shiftEnd: string, nightStart: string, nightEnd: string): boolean => {
  const sH = parseHour(shiftStart);
  const eH = parseHour(shiftEnd);
  const nS = parseHour(nightStart);
  const nE = parseHour(nightEnd);
  const shiftHours: number[] = [];
  if (sH < eH) {
    for (let h = sH; h < eH; h++) shiftHours.push(h);
  } else {
    for (let h = sH; h < 24; h++) shiftHours.push(h);
    for (let h = 0; h < eH; h++) shiftHours.push(h);
  }
  const inNight = (h: number) => (nS < nE ? h >= nS && h < nE : h >= nS || h < nE);
  return shiftHours.some(inNight);
};

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
export function runAutoScheduler({ employees, shifts, stations, holidays: rawHolidays, config, isPeakDay, allSchedules, preserveExisting, startDay, endDay }: RunArgs): RunResult {
  const newSchedule: Schedule = {};
  const workShifts = shifts.filter(s => s.isWork);

  if (workShifts.length === 0 || stations.length === 0) {
    throw new Error('Auto-scheduler requires shifts and stations defined.');
  }

  // v5.5.0 — defensively fan multi-day holidays here so a caller that
  // forgets to pre-expand still gets correct per-day comp accrual. Pre-v5.5
  // App.tsx was the only caller and it expanded via the `holidays` memo at
  // App.tsx:227, but a unit test (and any future caller) hitting
  // runAutoScheduler with the raw HolidaysTab list would silently lose the
  // per-day +1 accrual on multi-day holidays — manifesting as the user's
  // real-data report "I worked a 4-day Eid but only got 1 comp day."
  // expandHolidayDates is idempotent — single-day holidays pass through
  // unchanged so re-expanding an already-expanded list is a no-op.
  const holidays = expandHolidayDates(rawHolidays);

  // v2.2.0 — clamp the active range to a sane window inside the month.
  // Defaults to the full month so existing callers behave identically.
  const rangeStart = Math.max(1, startDay ?? 1);
  const rangeEnd = Math.min(config.daysInMonth, endDay ?? config.daysInMonth);

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

  // Pre-compute the trailing-6 days of the previous month for each employee
  // so the level-1 rolling-7 check at the start of the month doesn't ignore
  // hours that are still inside the rolling window.
  const prevMonthKey = (() => {
    const d = new Date(config.year, config.month - 2, 1);
    return `scheduler_schedule_${d.getFullYear()}_${d.getMonth() + 1}`;
  })();
  const prevDays = new Date(config.year, config.month - 1, 0).getDate();
  const prevSchedule: Schedule = (allSchedules && allSchedules[prevMonthKey]) || {};
  const carriedHoursForDay = (empId: string, day: number, addedHrs: number): number => {
    // Sum hours already worked in the rolling-7 window ending on `day`. Includes
    // up to (day-1) days of the current month plus carry-in from the prior month.
    let rolling = addedHrs;
    for (let d = Math.max(1, day - 6); d < day; d++) {
      const entry = newSchedule[empId][d];
      if (!entry) continue;
      const s = shiftByCode.get(entry.shiftCode);
      if (s) rolling += s.durationHrs;
    }
    if (day <= 6) {
      // Pull carry-in from the previous month: days (prevDays - (5 - day))..prevDays
      const carryStart = Math.max(1, prevDays - (6 - day));
      for (let d = carryStart; d <= prevDays; d++) {
        const entry = prevSchedule[empId]?.[d];
        if (!entry) continue;
        const s = shiftByCode.get(entry.shiftCode);
        if (s?.isWork) rolling += s.durationHrs;
      }
    }
    return rolling;
  };

  const consecutiveWork = new Map<string, number>();
  const totalHoursWorked = new Map<string, number>();
  const usedHolidayBankThisMonth = new Map<string, number>();
  // Tracks unmet comp-day debt per employee: incremented on each PH-work
  // assignment and decremented when the employee gets an OFF/leave within
  // the next 7 days. Used by the candidate sort to push PH-debtors DOWN in
  // work priority so they naturally rotate to OFF first, satisfying the
  // "comp day in the following week" expectation for Art. 74.
  const phDebt = new Map<string, number>();
  // Per-employee circular log of the day each PH-work occurred (last 14
  // days). Lets us decay debt when a comp window has fully elapsed.
  const phWorkDays = new Map<string, number[]>();
  const updatedEmployees = [...employees];
  const empIndexById = new Map<string, number>(updatedEmployees.map((e, i) => [e.empId, i]));

  employees.forEach(emp => {
    newSchedule[emp.empId] = {};
    // Seed consecutiveWork with the trailing run from the previous month so a
    // 5-in-a-row finish on day 31 of the prior month is honored on day 1.
    let runIn = 0;
    const empPrev = prevSchedule[emp.empId] || {};
    for (let d = prevDays; d >= 1; d--) {
      const entry = empPrev[d];
      const s = entry ? shiftByCode.get(entry.shiftCode) : undefined;
      if (s?.isWork) runIn++;
      else break;
    }
    consecutiveWork.set(emp.empId, runIn);
    totalHoursWorked.set(emp.empId, 0);
    usedHolidayBankThisMonth.set(emp.empId, 0);

    // Pre-populate preserved entries. Each one becomes a locked cell that
    // the main loop's `evaluate(... newSchedule[emp.empId][day])` check will
    // skip. We also seed the running totals so the algorithm doesn't blow
    // past caps when filling the *rest* of the month around the locked rows.
    if (preserveExisting) {
      const empExisting = preserveExisting[emp.empId] || {};
      for (let d = 1; d <= config.daysInMonth; d++) {
        const entry = empExisting[d];
        if (!entry) continue;
        newSchedule[emp.empId][d] = { ...entry };
        const s = shiftByCode.get(entry.shiftCode);
        if (s?.isWork) {
          totalHoursWorked.set(emp.empId, (totalHoursWorked.get(emp.empId) || 0) + s.durationHrs);
        }
      }
    }
  });

  const holidayDates = new Set(holidays.map(h => h.date));

  const driverCfg = {
    dailyHrsCap: config.driverDailyHrsCap ?? 9,
    weeklyHrsCap: config.driverWeeklyHrsCap ?? 56,
    maxConsecWorkDays: config.driverMaxConsecWorkDays ?? 6,
  };

  const ramadanCap = config.ramadanDailyHrsCap ?? 6;
  const art86NightStart = config.art86NightStart || ART86_DEFAULT_NIGHT_START;
  const art86NightEnd = config.art86NightEnd || ART86_DEFAULT_NIGHT_END;
  // v2.1 — Art. 74 model. Three modes:
  //   'comp-day' (default, practitioner): rotate a CP within the window;
  //     payroll only pays 2× when no comp landed.
  //   'cash-ot': skip comp rotation; payroll always pays 2×.
  //   'both' (v5.1.7, strict text): grant CP AND payroll always pays 2×.
  // For the auto-scheduler, 'comp-day' and 'both' behave identically —
  // both want a CP rotated in. Only 'cash-ot' suppresses the rotation.
  const compMode = config.holidayCompMode ?? 'comp-day';
  const compWindowDays = Math.max(1, config.holidayCompWindowDays ?? 30);
  // CP shift code is granted as the comp day. Falls back to OFF when CP
  // isn't in the company's shifts list (defensive — the migration always
  // backfills it, but keep the scheduler resilient).
  const hasCPShift = shifts.some(s => s.code === 'CP');
  const compCode = hasCPShift ? 'CP' : 'OFF';
  // Per-holiday effective mode lookup. Build once so we don't filter the
  // holidays array in the hot loop.
  const holidayModeByDate = new Map<string, HolidayCompMode>();
  for (const h of holidays) holidayModeByDate.set(h.date, h.compMode ?? compMode);
  // Helper: does this holiday want a comp-day rotation? True for
  // 'comp-day' AND 'both'. The hot loop below uses this so we don't
  // re-derive the gate on every iteration.
  const wantsCompRotation = (dateStr: string): boolean => {
    const m = holidayModeByDate.get(dateStr) ?? compMode;
    return m === 'comp-day' || m === 'both';
  };

  // Per-type leave predicates delegate to the unified helper which handles
  // both v1.7 multi-range leaves AND legacy single-range fields.
  const isOnMaternityLeave = (emp: Employee, dateStr: string): boolean => {
    const r = getEmployeeLeaveOnDate(emp, dateStr);
    return !!r && r.type === 'maternity';
  };
  const isOnSickLeave = (emp: Employee, dateStr: string): boolean => {
    const r = getEmployeeLeaveOnDate(emp, dateStr);
    return !!r && r.type === 'sick';
  };
  const isOnAnnualLeave = (emp: Employee, dateStr: string): boolean => {
    const r = getEmployeeLeaveOnDate(emp, dateStr);
    return !!r && r.type === 'annual';
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
    if (isOnAnnualLeave(emp, dateStr)) return false;

    const driver = emp.category === 'Driver';
    if (driver) {
      if (!station.requiredRoles?.includes('Driver')) return false;
    } else {
      // v1.16: eligibility = direct station list ∪ groups containing this
      // station. The "any station" fallback only kicks in when BOTH lists
      // are empty (legacy pre-1.16 employees). Otherwise the employee
      // must have an explicit match — otherwise someone with only a
      // group declared would accidentally fall through to the open path.
      const hasAny = emp.eligibleStations.length > 0 || (emp.eligibleGroups || []).length > 0;
      if (hasAny) {
        const directOk = emp.eligibleStations.includes(stationId);
        const groupOk = !!station.groupId && (emp.eligibleGroups || []).includes(station.groupId);
        if (!directOk && !groupOk) return false;
      }
      if (station.requiredRoles?.length && !station.requiredRoles.some(r => r === emp.role || r === 'Standard')) return false;
    }

    if (driver && shift.durationHrs > driverCfg.dailyHrsCap && level < 3) return false;

    // Ramadan reduced-hours mode: enforce the lower cap for non-driver, non-
    // hazardous staff at strictness levels 1 and 2. Level 3 (emergency) lets
    // it slide so coverage gaps don't leave a station unstaffed.
    if (level < 3 && !driver && !emp.isHazardous && !shift.isHazardous && isRamadan(dateStr)) {
      if (shift.durationHrs > ramadanCap) return false;
    }

    // Art. 86 — women's night work in industrial undertakings. Hard rule at
    // levels 1 and 2; level 3 (emergency) lets coverage win.
    if (level < 3 && config.enforceArt86NightWork && emp.gender === 'F' && shift.isIndustrial) {
      if (shiftOverlapsNightWindow(shift.start, shift.end, art86NightStart, art86NightEnd)) return false;
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

      // Rolling 7-day window — pulls in the trailing days of the prior month
      // so the cap doesn't reset on day 1.
      const rolling = carriedHoursForDay(emp.empId, day, shift.durationHrs);
      const cap = driver
        ? driverCfg.weeklyHrsCap
        : (emp.isHazardous ? config.hazardousWeeklyHrsCap : config.standardWeeklyHrsCap);
      if (rolling > cap) return false;

      // Soft preference: at level 1 only, reject explicitly-avoided shifts.
      // The candidate-sort handles the positive bias.
      if (emp.avoidShiftCodes?.includes(shift.code)) return false;
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

  for (let day = rangeStart; day <= rangeEnd; day++) {
    currentDay = day;
    dayAssignmentsByStation = new Map<string, Set<string>>();
    const date = new Date(config.year, config.month - 1, day);
    const dateStr = format(date, 'yyyy-MM-dd');
    const isHoliday = holidayDates.has(dateStr);
    const peak = isPeakDay(day);
    const dayOfWeek = date.getDay() + 1;

    // Bring preserved work-shift entries into today's headcount index so the
    // main fill loop sees them as already covering their station — otherwise
    // we'd over-staff stations the user has manually pre-filled.
    if (preserveExisting) {
      for (const e of employees) {
        const entry = newSchedule[e.empId]?.[day];
        if (!entry?.stationId) continue;
        const s = shiftByCode.get(entry.shiftCode);
        if (!s?.isWork) continue;
        let stSet = dayAssignmentsByStation.get(entry.stationId);
        if (!stSet) {
          stSet = new Set<string>();
          dayAssignmentsByStation.set(entry.stationId, stSet);
        }
        stSet.add(e.empId);
      }
    }

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

        // Candidate sort: balance hours-worked first; bias towards employees
        // whose preferences include one of the valid shifts so they land on
        // their preferred shifts when other constraints permit. Employees
        // with unmet PH comp-day debt sort LATER so they get rotated to OFF
        // first, naturally satisfying the next-week comp-day expectation.
        const validShiftCodes = new Set(validShifts.map(s => s.code));
        const sortedPool = [...employees].sort((a, b) => {
          const hA = totalHoursWorked.get(a.empId) || 0;
          const hB = totalHoursWorked.get(b.empId) || 0;
          if (Math.abs(hA - hB) > 4) return hA - hB;
          // PH comp-day priority: someone with unpaid PH debt should rest
          // before being given another shift. Heavily weighted because comp
          // day timing is a compliance concern, not a soft preference.
          const debtA = phDebt.get(a.empId) || 0;
          const debtB = phDebt.get(b.empId) || 0;
          if (debtA !== debtB) return debtA - debtB;
          // Soft shift-code preference bias.
          const prefA = (a.preferredShiftCodes || []).some(c => validShiftCodes.has(c)) ? 1 : 0;
          const prefB = (b.preferredShiftCodes || []).some(c => validShiftCodes.has(c)) ? 1 : 0;
          if (prefA !== prefB) return prefB - prefA;
          const cA = consecutiveWork.get(a.empId) || 0;
          const cB = consecutiveWork.get(b.empId) || 0;
          return cA - cB;
        });

        while (currentHC < requiredHC) {
          let assigned = false;
          for (const level of [1, 2, 3] as (1 | 2 | 3)[]) {
            // Order valid shifts by the candidate's preference at level 1,
            // then by length. At levels 2/3 we ignore preference so coverage
            // is never sacrificed.
            for (const targetShift of validShifts) {
              const candidate = sortedPool.find(e => {
                if (level === 1 && e.preferredShiftCodes?.length) {
                  // At level 1, if the employee has any preference list and
                  // none of the valid shifts is preferred, push them down.
                  const hasPreferredHere = (e.preferredShiftCodes || []).some(c => validShiftCodes.has(c));
                  const isThisPreferred = (e.preferredShiftCodes || []).includes(targetShift.code);
                  if (hasPreferredHere && !isThisPreferred) return false;
                }
                return evaluate(e, day, targetShift, st.id, level, peak, st, dayOfWeek, dateStr);
              });
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
                  // Track comp-day debt for any holiday whose mode
                  // wants a comp rotation (`comp-day` and v5.1.7's
                  // `both`). `cash-ot` skips: payroll absorbs the 2×
                  // premium and there's no comp day to schedule.
                  if (wantsCompRotation(dateStr)) {
                    if (!phWorkDays.has(candidate.empId)) phWorkDays.set(candidate.empId, []);
                    const log = phWorkDays.get(candidate.empId)!;
                    if (log[log.length - 1] !== day) {
                      log.push(day);
                      phDebt.set(candidate.empId, (phDebt.get(candidate.empId) || 0) + 1);
                    }
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

    // After-day pass: fill OFF (or MAT/SL/AL for protected-leave dates) and
    // decay the holiday bank where applicable. empIndexById replaces the
    // previous O(n) `findIndex` per employee.
    for (const e of employees) {
      if (newSchedule[e.empId][day]) continue;
      const onMaternity = isOnMaternityLeave(e, dateStr);
      const onSick = !onMaternity && isOnSickLeave(e, dateStr);
      const onAnnual = !onMaternity && !onSick && isOnAnnualLeave(e, dateStr);
      const onLeave = onMaternity || onSick || onAnnual;

      // Comp-day satisfaction: an OFF / leave day after a tracked PH-work
      // pays down one unit of debt. Window expanded to `compWindowDays`
      // (default 30, configurable) so the supervisor has up to a month
      // to land the rest day. The recommended threshold (7 days) is what
      // the candidate sort still biases towards — anything further out is
      // legal but flagged later by the compliance engine as a soft note.
      const log = phWorkDays.get(e.empId);
      let payingDownDebt = false;
      if (log && log.length > 0) {
        while (log.length > 0 && log[0] < day - compWindowDays) log.shift();
        if (log.length > 0) {
          log.shift();
          const newDebt = Math.max(0, (phDebt.get(e.empId) || 0) - 1);
          phDebt.set(e.empId, newDebt);
          payingDownDebt = true;
        }
      }

      // Mark the rest day as CP iff the employee owes comp from a prior
      // PH-work and they're not on protected leave today. Otherwise it's
      // just a regular OFF (or leave) day. CP fills the same scheduling
      // role as OFF (non-work, breaks consecutive-work runs) but is
      // distinct so payroll + reports can attribute it as the comp day.
      const code = onMaternity ? 'MAT' : onSick ? 'SL' : onAnnual ? 'AL' : (payingDownDebt ? compCode : 'OFF');
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

  // v1.16: residual comp-day debt = anyone who worked a PH this month and
  // ended the month with debt > 0 (no OFF/leave appeared within their
  // 7-day comp window). This surfaces "insufficient HC to fully comply
  // with comp-day rotation" so the workforce planner and the preview
  // modal can flag it.
  const compDayShortfall: Array<{ empId: string; debtDays: number }> = [];
  for (const [empId, debt] of phDebt) {
    if (debt > 0) compDayShortfall.push({ empId, debtDays: debt });
  }

  return { schedule: newSchedule, updatedEmployees, compDayShortfall };
}
