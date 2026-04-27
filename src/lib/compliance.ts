import { Employee, Shift, PublicHoliday, Config, Violation, Schedule } from '../types';
import { differenceInHours, parse, addDays, format } from 'date-fns';

// Driver defaults — used when Config doesn't yet carry driver fields (older saves).
const DRIVER_DEFAULTS = {
  dailyHrsCap: 9,
  weeklyHrsCap: 56,
  continuousDrivingHrsCap: 4.5,
  minDailyRestHrs: 11,
  maxConsecWorkDays: 6,
};

const RAMADAN_DEFAULT_DAILY_CAP = 6;

const isDriver = (emp: Employee) => emp.category === 'Driver';

// True iff the YYYY-MM-DD `dateStr` falls within the inclusive maternity
// leave range on the employee. Either field missing → no active leave.
const isOnMaternityLeave = (emp: Employee, dateStr: string): boolean => {
  if (!emp.maternityLeaveStart || !emp.maternityLeaveEnd) return false;
  return dateStr >= emp.maternityLeaveStart && dateStr <= emp.maternityLeaveEnd;
};

// Sick leave equivalent of the above. Same string-comparison trick: ISO dates
// sort lexicographically the same way they sort chronologically.
const isOnSickLeave = (emp: Employee, dateStr: string): boolean => {
  if (!emp.sickLeaveStart || !emp.sickLeaveEnd) return false;
  return dateStr >= emp.sickLeaveStart && dateStr <= emp.sickLeaveEnd;
};

// Cheap, focused check used by the paint-mode warning toast. Mirrors the
// rules ComplianceEngine.check enforces, but only for the single (employee,
// day, shift) tuple being assigned — no scan of the whole month, no grouping.
// Returns short human-readable messages; an empty array means "no conflict
// detected for this paint." Intended for inline UX feedback, not the source
// of truth for compliance reporting.
export function previewAssignmentWarnings(
  emp: Employee,
  day: number,
  shiftCode: string,
  schedule: Schedule,
  shifts: Shift[],
  holidays: PublicHoliday[],
  config: Config,
): string[] {
  const warnings: string[] = [];
  const shift = shifts.find(s => s.code === shiftCode);
  if (!shift) return warnings;

  const dateStr = format(new Date(config.year, config.month - 1, day), 'yyyy-MM-dd');

  if (isOnMaternityLeave(emp, dateStr)) {
    warnings.push(`On maternity leave (${emp.maternityLeaveStart} → ${emp.maternityLeaveEnd}) — Art. 87`);
  }
  if (isOnSickLeave(emp, dateStr)) {
    warnings.push(`On sick leave (${emp.sickLeaveStart} → ${emp.sickLeaveEnd}) — Art. 84`);
  }

  // Only the work-shift checks apply when a non-work code is being painted
  // (OFF, AL, etc. don't trigger duration limits).
  if (!shift.isWork || emp.hourExempt) {
    return warnings;
  }

  const driver = isDriver(emp);
  const driverCfg = {
    dailyHrsCap: config.driverDailyHrsCap ?? DRIVER_DEFAULTS.dailyHrsCap,
    weeklyHrsCap: config.driverWeeklyHrsCap ?? DRIVER_DEFAULTS.weeklyHrsCap,
    minDailyRestHrs: config.driverMinDailyRestHrs ?? DRIVER_DEFAULTS.minDailyRestHrs,
    maxConsecWorkDays: config.driverMaxConsecWorkDays ?? DRIVER_DEFAULTS.maxConsecWorkDays,
  };
  const ramadanCap = config.ramadanDailyHrsCap ?? RAMADAN_DEFAULT_DAILY_CAP;

  // Daily cap
  let dailyCap: number;
  let dailyCapLabel: string;
  if (driver) { dailyCap = driverCfg.dailyHrsCap; dailyCapLabel = 'driver (Art. 88)'; }
  else if (emp.isHazardous || shift.isHazardous) { dailyCap = config.hazardousDailyHrsCap; dailyCapLabel = 'hazardous (Art. 68)'; }
  else if (isRamadanDay(config, dateStr)) { dailyCap = ramadanCap; dailyCapLabel = 'Ramadan'; }
  else { dailyCap = config.standardDailyHrsCap; dailyCapLabel = 'Art. 67'; }

  if (shift.durationHrs > dailyCap) {
    warnings.push(`${shift.durationHrs}h shift exceeds ${dailyCap}h daily cap (${dailyCapLabel})`);
  }

  // Rolling 7-day weekly cap
  const empSchedule = schedule[emp.empId] || {};
  const shiftMap = new Map(shifts.map(s => [s.code, s]));
  let rollingHrs = shift.durationHrs;
  for (let d = Math.max(1, day - 6); d <= Math.min(config.daysInMonth, day + 6); d++) {
    if (d === day) continue;
    const code = empSchedule[d]?.shiftCode;
    const sh = code ? shiftMap.get(code) : undefined;
    if (sh?.isWork && Math.abs(d - day) <= 6) rollingHrs += sh.durationHrs;
  }
  const weeklyCap = driver
    ? driverCfg.weeklyHrsCap
    : (emp.isHazardous ? config.hazardousWeeklyHrsCap : config.standardWeeklyHrsCap);
  if (rollingHrs > weeklyCap) {
    warnings.push(`Would push 7-day rolling total to ${rollingHrs.toFixed(1)}h, over the ${weeklyCap}h cap`);
  }

  // Min rest between shifts (look only at the immediately previous day; the
  // engine itself looks at both neighbours, but for paint feedback the prior
  // day is the one the user can act on).
  const prevCode = empSchedule[day - 1]?.shiftCode;
  const prevShift = prevCode ? shiftMap.get(prevCode) : undefined;
  if (prevShift?.isWork) {
    const finishTime = parse(prevShift.end || '00:00', 'HH:mm', new Date());
    const startTime = parse(shift.start || '00:00', 'HH:mm', addDays(new Date(), 1));
    const gap = differenceInHours(startTime, finishTime);
    const minRest = driver ? driverCfg.minDailyRestHrs : config.minRestBetweenShiftsHrs;
    if (gap < minRest) {
      warnings.push(`Only ${gap}h rest after yesterday's shift — needs ≥ ${minRest}h`);
    }
  }

  // Consecutive work days — count back from this day.
  let consec = 1;
  for (let d = day - 1; d >= 1; d--) {
    const code = empSchedule[d]?.shiftCode;
    const sh = code ? shiftMap.get(code) : undefined;
    if (sh?.isWork) consec++;
    else break;
  }
  const consecCap = driver ? driverCfg.maxConsecWorkDays : config.maxConsecWorkDays;
  if (consec > consecCap) {
    warnings.push(`Would be day ${consec} of consecutive work — cap is ${consecCap}`);
  }

  // Holiday work without OT/PH code
  const isHoli = holidays.some(h => h.date === dateStr);
  if (isHoli && !shift.code.includes('OT') && !shift.code.includes('PH')) {
    warnings.push(`Working a public holiday — Art. 74 requires an OT or PH shift code for double pay`);
  }

  return warnings;
}

// True iff the date falls inside the configured Ramadan window. ISO YYYY-MM-DD
// strings compare lexicographically as dates so we don't need to parse them.
const isRamadanDay = (config: Config, dateStr: string): boolean => {
  if (!config.ramadanStart || !config.ramadanEnd) return false;
  return dateStr >= config.ramadanStart && dateStr <= config.ramadanEnd;
};

export class ComplianceEngine {
  static check(
    employees: Employee[],
    shifts: Shift[],
    holidays: PublicHoliday[],
    config: Config,
    schedule: Schedule
  ): Violation[] {
    const violations: Violation[] = [];
    const shiftMap = new Map(shifts.map(s => [s.code, s]));
    const holidayDates = new Set(holidays.map(h => h.date));

    const driverCfg = {
      dailyHrsCap: config.driverDailyHrsCap ?? DRIVER_DEFAULTS.dailyHrsCap,
      weeklyHrsCap: config.driverWeeklyHrsCap ?? DRIVER_DEFAULTS.weeklyHrsCap,
      continuousDrivingHrsCap: config.driverContinuousDrivingHrsCap ?? DRIVER_DEFAULTS.continuousDrivingHrsCap,
      minDailyRestHrs: config.driverMinDailyRestHrs ?? DRIVER_DEFAULTS.minDailyRestHrs,
      maxConsecWorkDays: config.driverMaxConsecWorkDays ?? DRIVER_DEFAULTS.maxConsecWorkDays,
    };

    const ramadanCap = config.ramadanDailyHrsCap ?? RAMADAN_DEFAULT_DAILY_CAP;

    employees.forEach(emp => {
      const empSchedule = schedule[emp.empId] || {};
      const days = Array.from({ length: config.daysInMonth }, (_, i) => i + 1);
      const driver = isDriver(emp);
      const dateStrFor = (day: number) => format(new Date(config.year, config.month - 1, day), 'yyyy-MM-dd');

      // Rule: Daily hours cap (Art. 67 & 68 / Art. 88 for drivers / Ramadan reduced-hours)
      if (!emp.hourExempt) {
        days.forEach(day => {
          const entry = empSchedule[day];
          const shiftCode = entry?.shiftCode;
          const shift = shiftMap.get(shiftCode || '');
          if (!shift || !shift.isWork) return;
          // Maternity / sick leave days: skip cap checks entirely. The
          // auto-scheduler shouldn't have placed work on these days, but if a
          // manual edit does, the violation surfaces under a dedicated rule.
          const dateStr = dateStrFor(day);
          if (isOnMaternityLeave(emp, dateStr)) {
            violations.push({
              empId: emp.empId,
              day,
              rule: "Worked during maternity leave",
              article: "(Art. 87)",
              message: "Employee is on maternity leave but has a work shift assigned.",
            });
            return;
          }
          if (isOnSickLeave(emp, dateStr)) {
            violations.push({
              empId: emp.empId,
              day,
              rule: "Worked during sick leave",
              article: "(Art. 84)",
              message: "Employee is on sick leave but has a work shift assigned.",
            });
            return;
          }
          {
            let cap: number;
            let article: string;
            let category: string;
            if (driver) {
              cap = driverCfg.dailyHrsCap;
              article = "(Art. 88)";
              category = "transport / driver";
            } else if (emp.isHazardous || shift.isHazardous) {
              cap = config.hazardousDailyHrsCap;
              article = "(Art. 68)";
              category = "hazardous work";
            } else if (isRamadanDay(config, dateStr)) {
              cap = ramadanCap;
              article = "(Ramadan)";
              category = "Ramadan reduced hours";
            } else {
              cap = config.standardDailyHrsCap;
              article = "(Art. 67)";
              category = "normal work";
            }
            if (shift.durationHrs > cap) {
              violations.push({
                empId: emp.empId,
                day,
                rule: "Daily hours cap",
                article,
                message: `Worked ${shift.durationHrs}hrs. Cap is ${cap}hrs for ${category}.`
              });
            }

            // Rule: Continuous driving cap (drivers only, Art. 88 + Ministry of Transport)
            if (driver && shift.durationHrs > driverCfg.continuousDrivingHrsCap && (shift.breakMin || 0) < 30) {
              violations.push({
                empId: emp.empId,
                day,
                rule: "Continuous driving without break",
                article: "(Art. 88)",
                message: `Driver shift of ${shift.durationHrs}hrs exceeds ${driverCfg.continuousDrivingHrsCap}hrs continuous-driving cap with break <30min.`
              });
            }
          }
        });
      }

      // Rule: Rest between shifts (Art. 71 / Art. 88 for drivers)
      if (!emp.hourExempt) {
        const minRest = driver ? driverCfg.minDailyRestHrs : config.minRestBetweenShiftsHrs;
        const restArticle = driver ? "(Art. 88)" : "(Art. 71)";
        for (let day = 1; day < config.daysInMonth; day++) {
          const entry1 = empSchedule[day];
          const entry2 = empSchedule[day + 1];
          const shift1Code = entry1?.shiftCode;
          const shift2Code = entry2?.shiftCode;
          const s1 = shiftMap.get(shift1Code || '');
          const s2 = shiftMap.get(shift2Code || '');

          if (s1?.isWork && s2?.isWork) {
            const finishTime = parse(s1.end || '00:00', 'HH:mm', new Date());
            const startTimeNext = parse(s2.start || '00:00', 'HH:mm', addDays(new Date(), 1));
            const gap = differenceInHours(startTimeNext, finishTime);

            if (gap < minRest) {
              violations.push({
                empId: emp.empId,
                day: day + 1,
                rule: "Min rest between shifts",
                article: restArticle,
                message: `Rest period of ${gap}hrs is below the required ${minRest}hrs.`
              });
            }
          }
        }
      }

      // Prepare work sequence
      const workData = days.map(day => {
        const entry = empSchedule[day];
        const shiftCode = entry?.shiftCode;
        const shift = shiftMap.get(shiftCode || '');
        return {
          day,
          hrs: shift?.isWork ? shift.durationHrs : 0,
          isWork: !!(shift?.isWork),
        };
      });

      // Rule: Weekly hours cap (Art. 70 / Art. 88 for drivers)
      // Rule: Weekly rest day (Art. 72)
      if (!emp.hourExempt) {
        for (let i = 0; i <= workData.length - 7; i++) {
          const window = workData.slice(i, i + 7);
          const totalHrs = window.reduce((sum, d) => sum + d.hrs, 0);
          const hasRest = window.some(d => !d.isWork);

          const weeklyCap = driver
            ? driverCfg.weeklyHrsCap
            : (emp.isHazardous ? config.hazardousWeeklyHrsCap : config.standardWeeklyHrsCap);
          const weeklyArticle = driver ? "(Art. 88)" : "(Art. 70)";
          if (totalHrs > weeklyCap) {
            violations.push({
              empId: emp.empId,
              day: window[0].day,
              rule: "Weekly hours cap",
              article: weeklyArticle,
              message: `7-day rolling total of ${totalHrs}hrs exceeds ${weeklyCap}hrs limit.`
            });
          }

          if (!hasRest) {
            violations.push({
              empId: emp.empId,
              day: window[6].day,
              rule: "Weekly rest day",
              article: "(Art. 72)",
              message: "No rest day provided in a rolling 7-day period."
            });
          }
        }
      }

      // Rule: Consecutive work days (Art. 71 §5, 72 / Art. 88 for drivers)
      const consecCap = driver ? driverCfg.maxConsecWorkDays : config.maxConsecWorkDays;
      const consecArticle = driver ? "(Art. 88)" : "(Art. 71 §5, 72)";
      let consecutive = 0;
      workData.forEach((d, idx) => {
        if (d.isWork) {
          consecutive++;
        } else {
          consecutive = 0;
        }

        if (consecutive > consecCap) {
          violations.push({
            empId: emp.empId,
            day: d.day,
            rule: "Consecutive work days",
            article: consecArticle,
            message: `Personnel worked ${consecutive} consecutive days. Max allowed is ${consecCap}.`
          });
        }
      });

      // Rule: Holiday OT flag (Art. 74)
      days.forEach(day => {
        const entry = empSchedule[day];
        const shiftCode = entry?.shiftCode;
        const shift = shiftMap.get(shiftCode || '');
        if (shift && shift.isWork) {
          const dStr = format(new Date(config.year, config.month - 1, day), 'yyyy-MM-dd');
          if (holidayDates.has(dStr)) {
            if (!shift.code.includes('OT') && !shift.code.includes('PH')) {
              violations.push({
                empId: emp.empId,
                day,
                rule: "Holiday OT flag",
                article: "(Art. 74)",
                message: "Worked on a public holiday without an explicit OT or PH designation."
              });
            }
          }
        }
      });
    });

    const groupedViolations: Violation[] = [];
    const seenMap = new Map<string, Violation>();

    violations.forEach(v => {
      // Create a unique key for grouping. We include the message to ensure 
      // different types of infractions of the same rule are still distinct 
      // (e.g. Worked 10hrs vs Worked 12hrs), but identical repeated ones group.
      const key = `${v.empId}|${v.rule}|${v.article}|${v.message}`;
      
      if (seenMap.has(key)) {
        const existing = seenMap.get(key)!;
        existing.count = (existing.count || 1) + 1;
      } else {
        const violationWithCount = { ...v, count: 1 };
        seenMap.set(key, violationWithCount);
        groupedViolations.push(violationWithCount);
      }
    });

    return groupedViolations;
  }
}
