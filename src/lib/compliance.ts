import { Employee, Shift, PublicHoliday, Config, Violation, Schedule } from '../types';
import { differenceInHours, parse, isValid, addDays, format, isSameDay } from 'date-fns';

// Driver defaults — used when Config doesn't yet carry driver fields (older saves).
const DRIVER_DEFAULTS = {
  dailyHrsCap: 9,
  weeklyHrsCap: 56,
  continuousDrivingHrsCap: 4.5,
  minDailyRestHrs: 11,
  maxConsecWorkDays: 6,
};

const isDriver = (emp: Employee) => emp.category === 'Driver';

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

    employees.forEach(emp => {
      const empSchedule = schedule[emp.empId] || {};
      const days = Array.from({ length: config.daysInMonth }, (_, i) => i + 1);
      const driver = isDriver(emp);

      // Rule: Daily hours cap (Art. 67 & 68 / Art. 88 for drivers)
      if (!emp.hourExempt) {
        days.forEach(day => {
          const entry = empSchedule[day];
          const shiftCode = entry?.shiftCode;
          const shift = shiftMap.get(shiftCode || '');
          if (shift && shift.isWork) {
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
