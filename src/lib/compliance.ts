import { Employee, Shift, PublicHoliday, Config, Violation, Schedule } from '../types';
import { differenceInHours, parse, isValid, addDays, format, isSameDay } from 'date-fns';

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

    employees.forEach(emp => {
      const empSchedule = schedule[emp.empId] || {};
      const days = Array.from({ length: config.daysInMonth }, (_, i) => i + 1);

      // Rule: Daily hours cap (Art. 67 & 68)
      if (!emp.hourExempt) {
        days.forEach(day => {
          const shiftCode = empSchedule[day];
          const shift = shiftMap.get(shiftCode);
          if (shift && shift.isWork) {
            const cap = (emp.isHazardous || shift.isHazardous) ? config.hazardousDailyHrsCap : config.standardDailyHrsCap;
            if (shift.durationHrs > cap) {
              violations.push({
                empId: emp.empId,
                day,
                rule: "Daily hours cap",
                article: (emp.isHazardous || shift.isHazardous) ? "(Art. 68)" : "(Art. 67)",
                message: `Worked ${shift.durationHrs}hrs. Cap is ${cap}hrs for ${emp.isHazardous ? 'hazardous work' : 'normal work'}.`
              });
            }
          }
        });
      }

      // Rule: Rest between shifts (Art. 71)
      if (!emp.hourExempt) {
        for (let day = 1; day < config.daysInMonth; day++) {
          const shift1Code = empSchedule[day];
          const shift2Code = empSchedule[day + 1];
          const s1 = shiftMap.get(shift1Code);
          const s2 = shiftMap.get(shift2Code);

          if (s1?.isWork && s2?.isWork) {
            // Very simplified rest check: 24hrs - duration of shift 1 + time before shift 2 starts
            // For a robust check, we'd need to parse actual start/end times across midnight.
            // Under Art 71, rest should typically be 11-12 hours.
            // Here we check if the gap is enough based on a 24h cycle
            const finishTime = parse(s1.end, 'HH:mm', new Date());
            const startTimeNext = parse(s2.start, 'HH:mm', addDays(new Date(), 1));
            const gap = differenceInHours(startTimeNext, finishTime);

            if (gap < config.minRestBetweenShiftsHrs) {
              violations.push({
                empId: emp.empId,
                day: day + 1,
                rule: "Min rest between shifts",
                article: "(Art. 71)",
                message: `Rest period of ${gap}hrs is below the required ${config.minRestBetweenShiftsHrs}hrs.`
              });
            }
          }
        }
      }

      // Prepare work sequence
      const workData = days.map(day => {
        const shiftCode = empSchedule[day];
        const shift = shiftMap.get(shiftCode);
        return {
          day,
          hrs: shift?.isWork ? shift.durationHrs : 0,
          isWork: !!(shift?.isWork),
        };
      });

      // Rule: Weekly hours cap (Art. 70)
      // Rule: Weekly rest day (Art. 72)
      if (!emp.hourExempt) {
        for (let i = 0; i <= workData.length - 7; i++) {
          const window = workData.slice(i, i + 7);
          const totalHrs = window.reduce((sum, d) => sum + d.hrs, 0);
          const hasRest = window.some(d => !d.isWork);

          const weeklyCap = emp.isHazardous ? config.hazardousWeeklyHrsCap : config.standardWeeklyHrsCap;
          if (totalHrs > weeklyCap) {
            violations.push({
              empId: emp.empId,
              day: window[0].day,
              rule: "Weekly hours cap",
              article: "(Art. 70)",
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

      // Rule: Consecutive work days (Art. 71 §5, 72)
      let consecutive = 0;
      workData.forEach((d, idx) => {
        if (d.isWork) {
          consecutive++;
        } else {
          consecutive = 0;
        }

        if (consecutive > config.maxConsecWorkDays) {
          violations.push({
            empId: emp.empId,
            day: d.day,
            rule: "Consecutive work days",
            article: "(Art. 71 §5, 72)",
            message: `Student worked ${consecutive} consecutive days. Max allowed is ${config.maxConsecWorkDays}.`
          });
        }
      });

      // Rule: Holiday OT flag (Art. 74)
      days.forEach(day => {
        const shiftCode = empSchedule[day];
        const shift = shiftMap.get(shiftCode);
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

    return violations;
  }
}
