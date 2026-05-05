// Single source of truth for the Art. 74 holiday-OT model.
//
// Three modes (set globally via config.holidayCompMode, overridable per
// holiday via PublicHoliday.compMode):
//
//   • 'comp-day' (default, practitioner reading) — worker is owed EITHER
//     a comp rest day OR the 2× cash premium, not both. Premium fires
//     only when no CP / OFF / leave landed inside the configured window.
//   • 'cash-ot' — skip comp rotation, pay 2× cash on every holiday hour.
//   • 'both' (v5.1.7, strict-text reading) — worker is owed a comp rest
//     day AND the 2× premium. The supervisor still sees comp-day status
//     (so they can spot windows that didn't land), but payroll always
//     charges the 2× premium regardless.
//
// Pre-2.1 the same gating logic lived inline in three places:
// PayrollTab (always 2×), DashboardTab (always 2×), otAnalysis (correct
// but month-bound). v2.1.1 hoists it here so a holiday late in the
// month can see next month's CP, and so changing the mode in Variables
// updates every screen the same way.
//
// CALLERS PASS `allSchedules` so the look-ahead can cross the month
// boundary. When omitted, the helper is restricted to the current month
// — it errs on the side of "premium owed" if it can't see what comes
// after the boundary, which matches the conservative compliance read.

import { format } from 'date-fns';
import { Employee, Shift, PublicHoliday, Config, Schedule } from '../types';

export interface HolidayPayBreakdown {
  // Total scheduled hours on public-holiday dates, regardless of mode.
  totalHolidayHours: number;
  // Subset where the 2× premium is owed (cash-ot mode, or comp-day mode
  // with no CP/OFF/leave landing inside the window).
  premiumHolidayHours: number;
  // Subset where a comp day satisfies Art. 74 → 1× pay (no premium).
  compensatedHolidayHours: number;
  // IQD owed in 2× holiday pay. Caller multiplies elsewhere if needed.
  premiumPay: number;
  // v5.12.0 — when carryForwardUnspentCompDays is true, holidays whose
  // comp window expired land here instead of premiumHolidayHours. The
  // unspent comp credit accrues to the employee's holidayBank for
  // redemption in subsequent months rather than firing a 2× cash bill.
  // Caller surfaces this as "X CP days carried forward to next month".
  carriedForwardCompDays: number;
  // Per-holiday-date detail so callers can render the timeline.
  perHoliday: Array<{
    date: string;          // YYYY-MM-DD
    hours: number;
    premiumOwed: boolean;
    compDayOffset: number | null; // days to first non-work entry; null = none found
    // v5.12.0 — true when this holiday's comp credit is being carried
    // forward (premium NOT owed because of carryForwardUnspentCompDays).
    carriedForward: boolean;
  }>;
}

const dateStrFor = (year: number, month: number, day: number): string =>
  format(new Date(year, month - 1, day), 'yyyy-MM-dd');

const nextMonthScheduleKey = (year: number, month: number): string => {
  const d = new Date(year, month, 1);
  return `scheduler_schedule_${d.getFullYear()}_${d.getMonth() + 1}`;
};

const prevMonthDays = (year: number, month: number): number =>
  new Date(year, month - 1, 0).getDate();

// Walk forward from `holidayDay` looking for an explicit non-work entry
// (CP, OFF, AL, SL, MAT, …). Crosses the month boundary when next-month
// schedule is available. Returns the offset in days if found, or null
// when the window expires without a comp day.
function findCompDayOffset(
  empSched: Schedule[string],
  nextEmpSched: Schedule[string] | undefined,
  holidayDay: number,
  daysInCurrentMonth: number,
  windowDays: number,
  shiftByCode: Map<string, Shift>,
): number | null {
  for (let look = 1; look <= windowDays; look++) {
    const targetDay = holidayDay + look;
    let entry;
    if (targetDay <= daysInCurrentMonth) {
      entry = empSched[targetDay];
    } else if (nextEmpSched) {
      const nextDay = targetDay - daysInCurrentMonth;
      entry = nextEmpSched[nextDay];
    } else {
      // Hit the boundary with no next-month visibility — stop scanning.
      // Conservative read: caller treats "no comp found" as premium owed.
      return null;
    }
    if (!entry) continue; // missing entry: keep looking
    const shift = shiftByCode.get(entry.shiftCode);
    if (!shift) continue;
    if (!shift.isWork) return look; // CP / OFF / AL / SL / MAT all qualify
  }
  return null;
}

export function computeHolidayPay(
  emp: Employee,
  schedule: Schedule,
  shifts: Shift[],
  holidays: PublicHoliday[],
  config: Config,
  hourlyRate: number,
  allSchedules?: Record<string, Schedule>,
): HolidayPayBreakdown {
  const otRateNight = config.otRateNight ?? 2.0;
  const compModeDefault = config.holidayCompMode ?? 'comp-day';
  const compWindowMax = Math.max(1, config.holidayCompWindowDays ?? 30);
  // v5.12.0 — default true so the supervisor's natural workflow ("plan
  // next month and let the comp days land there") doesn't surface as
  // OT until they explicitly opt out (e.g. when closing the business
  // and there's no future month to redeem against).
  const carryForward = config.carryForwardUnspentCompDays ?? true;
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));
  const holidayByDate = new Map(holidays.map(h => [h.date, h]));

  const monthPrefix = `${config.year}-${String(config.month).padStart(2, '0')}-`;
  const empSched = schedule[emp.empId] || {};
  const nextSched = allSchedules?.[nextMonthScheduleKey(config.year, config.month)];
  const nextEmpSched = nextSched?.[emp.empId];

  let totalHolidayHours = 0;
  let premiumHolidayHours = 0;
  let carriedForwardCompDays = 0;
  const perHoliday: HolidayPayBreakdown['perHoliday'] = [];

  // Walk only the holidays that fall inside the active month — those are
  // the ones we charge against the current payroll cycle.
  for (const holiday of holidays) {
    if (!holiday.date.startsWith(monthPrefix)) continue;
    const m = /^\d{4}-\d{2}-(\d{2})$/.exec(holiday.date);
    if (!m) continue;
    const holidayDay = parseInt(m[1], 10);

    // Did the employee actually work this holiday? Sum the duration so
    // multi-shift days (rare but possible) bill correctly.
    const entry = empSched[holidayDay];
    if (!entry) continue;
    const shift = shiftByCode.get(entry.shiftCode);
    if (!shift?.isWork) continue;
    const hours = shift.durationHrs;
    totalHolidayHours += hours;

    // Effective Art. 74 mode for this specific holiday.
    const effMode = holiday.compMode ?? compModeDefault;
    let premiumOwed: boolean;
    let compDayOffset: number | null = null;

    // v5.1.7 — three modes branch here:
    //   cash-ot: premium always; we don't bother computing comp offset.
    //   comp-day: premium only if no comp landed in window.
    //   both:    premium always AND we still compute comp offset so the
    //            supervisor can see whether the comp day landed (the
    //            scheduler is supposed to grant one regardless of payroll).
    let carriedForwardHere = false;
    if (effMode === 'cash-ot') {
      premiumOwed = true;
    } else if (effMode === 'both') {
      compDayOffset = findCompDayOffset(
        empSched, nextEmpSched, holidayDay, config.daysInMonth, compWindowMax, shiftByCode,
      );
      premiumOwed = true;
    } else {
      // comp-day (default + practitioner reading)
      compDayOffset = findCompDayOffset(
        empSched, nextEmpSched, holidayDay, config.daysInMonth, compWindowMax, shiftByCode,
      );
      // v5.12.0 — when carryForward is on AND the window expired
      // without a comp day landing, treat the unspent comp credit as
      // an accrual rather than firing a 2× cash bill. The supervisor
      // sees this as "X CP days carried forward to next month" so
      // they know to plan next month's schedule with that capacity in
      // mind. When carryForward is off (closing the business / final
      // payroll cycle), legacy behaviour kicks in: window expired =
      // premium owed.
      if (compDayOffset === null && carryForward) {
        premiumOwed = false;
        carriedForwardHere = true;
        carriedForwardCompDays += 1;
      } else {
        premiumOwed = compDayOffset === null;
      }
    }

    if (premiumOwed) premiumHolidayHours += hours;
    perHoliday.push({
      date: holiday.date,
      hours,
      premiumOwed,
      compDayOffset,
      carriedForward: carriedForwardHere,
    });
  }

  const compensatedHolidayHours = totalHolidayHours - premiumHolidayHours;
  const premiumPay = premiumHolidayHours * hourlyRate * otRateNight;

  return {
    totalHolidayHours,
    premiumHolidayHours,
    compensatedHolidayHours,
    carriedForwardCompDays,
    premiumPay,
    perHoliday,
  };
}

// Convenience wrapper for the case where the caller only wants the IQD
// number and doesn't need the per-holiday breakdown.
export function computeHolidayPremiumPay(
  emp: Employee,
  schedule: Schedule,
  shifts: Shift[],
  holidays: PublicHoliday[],
  config: Config,
  hourlyRate: number,
  allSchedules?: Record<string, Schedule>,
): number {
  return computeHolidayPay(emp, schedule, shifts, holidays, config, hourlyRate, allSchedules).premiumPay;
}

// Eslint won't flag this, but list the helpers consciously: prevMonthDays
// is exported for tests that synthesize cross-month fixtures.
export { prevMonthDays };
