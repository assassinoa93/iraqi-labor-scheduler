import { Employee, Shift, Station, StationGroup, PublicHoliday, Config } from '../types';
import { format, getDaysInMonth } from 'date-fns';
import { parseHour, getOperatingHoursForDow } from './time';
import { monthlyHourCap } from './payroll';
import { totalDailyHeadcountHours } from './stationDemand';

// Mirrored from compliance.ts (which keeps this private). Driver caps under
// Iraqi Labor Law Art. 88 — 56h weekly. Mirroring is fine: the constant
// rarely changes and we'd otherwise need to widen the export.
const DRIVER_WEEKLY_CAP_DEFAULT = 56;

// Compute the ideal workforce composition for a venue, given its stations,
// operating windows, peak/non-peak split, and public holidays. This is the
// "what should my roster look like for optimal coverage with least cost?"
// answer surfaced on the Workforce Planning tab.
//
// Approach (per role):
//   1. Sum the demand-hours each station with that role contributes for each
//      day of the active month. Day's hours = open window × required HC,
//      using peakMinHC on peak days / holidays and normalMinHC otherwise.
//   2. Split demand into peak vs non-peak so the recommendation can mix
//      FTEs (carry the non-peak baseline) with part-timers (cover the peak
//      surge). When peak demand is materially higher than non-peak, a PT
//      strategy is cheaper than scaling FTE for peak — that's the levered
//      recommendation here.
//   3. Compare to the current roster (employees grouped by role/category)
//      and emit a hire/release/hold action with the IQD impact.
//
// All math is per-month in the active config (config.year, config.month).

export const PART_TIME_MONTHLY_HOURS = 96; // 24h/week × 4 — common Iraqi PT contract
export const PART_TIME_MONTHLY_SALARY_IQD_RATIO = 0.5; // PT salary roughly 50% of FTE
export const PEAK_LIFT_THRESHOLD = 1.25; // peak ÷ non-peak ratio above which PT mix kicks in

// Recommendation modes (v1.14):
//   - 'optimal'      : cost-minimising mix (FTE baseline + PT for peak surge).
//                      Theoretically cheapest but requires releasing surplus
//                      FTE in valley months and contracting PT for peak —
//                      both are HARD under Iraqi Labor Law (Art. 36, Art.
//                      40 — fixed-term contracts that renew become open-
//                      ended; releasing requires Minister of Labor approval).
//   - 'conservative' : pure FTE, hire-to-peak, never release. Carries
//                      excess capacity through valley months as paid idle
//                      time; cheaper than the legal/social cost of
//                      releasing & re-hiring across the year. Default
//                      recommendation in our sector.
export type PlanMode = 'conservative' | 'optimal';

export type WorkforceRole = 'Driver' | 'Standard' | string; // concrete role names also allowed

export interface StationDemand {
  stationId: string;
  stationName: string;
  monthlyHours: number;
  peakHours: number;
  nonPeakHours: number;
  // Average required HC per peak/non-peak day (peakMinHC and normalMinHC) —
  // helps the UI explain "why N FTE for this station?".
  peakMinHC: number;
  normalMinHC: number;
  openHrsPerDay: number;
}

export interface RoleDemand {
  role: WorkforceRole;
  // Cap used for FTE math. Drivers use Art. 88 weekly × 4; everyone else
  // uses standard cap (Art. 67/70). Hazardous staff would need a different
  // cap but stations don't carry that flag — supervisor handles manually.
  cap: number;
  monthlyRequiredHours: number;
  peakRequiredHours: number;
  nonPeakRequiredHours: number;
  byStation: StationDemand[];
  // Recommendation
  idealFTE: number;          // ceil(monthly / cap) — the "all FTE" answer
  recommendedFTE: number;    // FTE component of the suggested mix
  recommendedPartTime: number; // PT component of the suggested mix
  // Short text explaining why this mix was chosen.
  reasoning: string;
  // Current roster comparison (filled in after merge).
  currentCount: number;
  delta: number;             // positive = need to hire; negative = excess
  action: 'hire' | 'release' | 'hold';
}

export interface WorkforcePlan {
  byRole: RoleDemand[];
  totalIdealFTE: number;
  totalRecommendedFTE: number;
  totalRecommendedPartTime: number;
  totalCurrentEmployees: number;
  // Estimated monthly payroll for the recommended mix vs the current roster.
  recommendedMonthlySalary: number;
  currentMonthlySalary: number;
  monthlyDelta: number;      // recommended - current (negative = save money)
}

interface AnalyzeArgs {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  // Pull in venue-wide opening windows; per-station openTime/closeTime
  // overrides take precedence when present.
  isPeakDay: (day: number) => boolean;
  // Optional: which recommendation strategy to use. Defaults to
  // 'conservative' since it's the sector-default Iraqi-law-safe option.
  mode?: PlanMode;
}

// Length of a station's open window in hours, handling overnight (close < open)
// by wrapping through midnight. e.g. 22:00–05:00 → 7 hours.
function stationOpenHours(st: Station): number {
  const open = parseHour(st.openingTime);
  const close = parseHour(st.closingTime);
  if (close > open) return close - open;
  // Overnight close (e.g. 22:00 → 05:00 = 7h)
  return (24 - open) + close;
}

// Compute each station's monthly demand split by peak vs non-peak. Adds a
// comp-day overhead pool (v1.16): every hour worked on a public holiday
// creates a 1-hour comp-rest-day obligation in the following 7 days
// (Art. 74 = both 2× pay AND comp day). The replacement coverage during
// that comp day is real workforce demand, so we fold it into the
// monthly hours total. Without this, the planner under-counted the FTE
// need for venues that operate on holidays.
function stationDemand(args: AnalyzeArgs): Map<string, StationDemand> {
  const { stations, config, isPeakDay, holidays } = args;
  const out = new Map<string, StationDemand>();
  const daysInMonth = getDaysInMonth(new Date(config.year, config.month - 1, 1));
  const monthPrefix = `${config.year}-${String(config.month).padStart(2, '0')}-`;
  const holidaysThisMonth = new Set(
    holidays.filter(h => h.date.startsWith(monthPrefix)).map(h => h.date),
  );

  for (const st of stations) {
    let peakHours = 0;
    let nonPeakHours = 0;
    let holidayWorkHours = 0;
    const openHrs = stationOpenHours(st);
    if (openHrs <= 0) {
      out.set(st.id, {
        stationId: st.id, stationName: st.name,
        monthlyHours: 0, peakHours: 0, nonPeakHours: 0,
        peakMinHC: st.peakMinHC, normalMinHC: st.normalMinHC,
        openHrsPerDay: 0,
      });
      continue;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const peak = isPeakDay(day);
      // v5.14.0 — sum hourly demand across the operating window. For
      // stations with a flat min HC this still equals openHrs × minHC
      // (legacy result preserved). For stations with an hourly profile
      // this correctly reflects the variable demand — e.g. cashier
      // station 11–23 with 1/2/3 PAX across three windows produces
      // 1×4 + 2×4 + 3×4 = 24 PAX-hrs, not the legacy openHrs × peakMinHC.
      const dayHours = totalDailyHeadcountHours(st, peak, Math.floor(parseHour(st.openingTime)), Math.ceil(parseHour(st.closingTime)));
      if (dayHours <= 0) continue;
      if (peak) peakHours += dayHours;
      else nonPeakHours += dayHours;
      // Track holiday-specific work hours. Each one becomes 1 hour of
      // comp-day absence to cover later in the month — added to the
      // peak pool since those absences typically need urgent backfill.
      const ds = format(new Date(config.year, config.month - 1, day), 'yyyy-MM-dd');
      if (holidaysThisMonth.has(ds)) holidayWorkHours += dayHours;
    }
    // Comp-day overhead = hours of replacement coverage owed because
    // someone has to cover the comp-day-taker's normal shift. Add to the
    // peak pool (these absences cluster in the days right after holidays,
    // which usually overlap peak weekend stretches).
    peakHours += holidayWorkHours;
    out.set(st.id, {
      stationId: st.id, stationName: st.name,
      monthlyHours: peakHours + nonPeakHours,
      peakHours, nonPeakHours,
      peakMinHC: st.peakMinHC, normalMinHC: st.normalMinHC,
      openHrsPerDay: openHrs,
    });
  }
  void format; void getOperatingHoursForDow;
  return out;
}

// Group station demand by role: Driver stations (requiredRoles includes
// 'Driver') roll up to 'Driver'. All others roll up to either the explicit
// `requiredRoles[0]` concrete role (e.g. 'Cashier') or to 'Standard' if
// none specified. This matches the auto-scheduler's eligibility model.
function rollupByRole(stations: Station[], demand: Map<string, StationDemand>): Map<string, StationDemand[]> {
  const out = new Map<string, StationDemand[]>();
  const isGenericRole = (r: string) => r === '' || r === 'Standard';
  for (const st of stations) {
    const d = demand.get(st.id);
    if (!d || d.monthlyHours <= 0) continue;
    let role: string;
    if (st.requiredRoles?.includes('Driver')) {
      role = 'Driver';
    } else {
      const explicit = st.requiredRoles?.find(r => !isGenericRole(r));
      role = explicit || 'Standard';
    }
    if (!out.has(role)) out.set(role, []);
    out.get(role)!.push(d);
  }
  return out;
}

// Decide FTE/PT mix for a role. Behaviour depends on the requested
// recommendation mode:
//   - 'conservative' : pure FTE math. ceil(monthlyRequiredHours / cap).
//                      Never recommends part-timers. Used as the safer
//                      year-round target — releases are legally hard, so
//                      the conservative number is the FTE count we'd
//                      need at peak demand and would carry through the
//                      valleys.
//   - 'optimal'      : the cost-minimising mix. If peak demand is
//                      > PEAK_LIFT_THRESHOLD × non-peak demand, route
//                      the surge to part-timers (paid pro-rata) and
//                      size FTEs to the non-peak baseline. Otherwise
//                      fill everything with FTEs since the load is flat.
function recommendMix(monthlyRequiredHours: number, peakHrs: number, nonPeakHrs: number, cap: number, mode: PlanMode): {
  recommendedFTE: number;
  recommendedPartTime: number;
  reasoning: string;
} {
  if (monthlyRequiredHours <= 0) {
    return { recommendedFTE: 0, recommendedPartTime: 0, reasoning: '' };
  }

  const idealFTE = Math.ceil(monthlyRequiredHours / cap);

  // Conservative mode: always pure FTE, hire-to-demand. Never PT.
  if (mode === 'conservative') {
    return {
      recommendedFTE: idealFTE,
      recommendedPartTime: 0,
      reasoning: 'Conservative mode — pure FTE roster (Iraqi labor law makes releases hard, so we size for peak and carry through valleys).',
    };
  }

  // Optimal mode below.
  if (peakHrs === 0) {
    return {
      recommendedFTE: idealFTE,
      recommendedPartTime: 0,
      reasoning: 'Flat demand — pure FTE coverage.',
    };
  }
  if (nonPeakHrs === 0) {
    const ptCount = Math.ceil(peakHrs / PART_TIME_MONTHLY_HOURS);
    return {
      recommendedFTE: 0,
      recommendedPartTime: ptCount,
      reasoning: 'Demand only on peak days — part-time covers the surge without paying for idle time.',
    };
  }

  const lift = peakHrs / nonPeakHrs;
  if (lift < PEAK_LIFT_THRESHOLD) {
    return {
      recommendedFTE: idealFTE,
      recommendedPartTime: 0,
      reasoning: `Peak only ${(lift * 100).toFixed(0)}% of non-peak demand — FTE-only is efficient.`,
    };
  }

  const fteCount = Math.ceil(nonPeakHrs / cap);
  const ftePeakCoverage = fteCount * cap;
  const fteHoursAvailableForPeak = Math.max(0, ftePeakCoverage - nonPeakHrs);
  const peakUncovered = Math.max(0, peakHrs - fteHoursAvailableForPeak);
  const ptCount = Math.ceil(peakUncovered / PART_TIME_MONTHLY_HOURS);

  return {
    recommendedFTE: fteCount,
    recommendedPartTime: ptCount,
    reasoning: `Peak demand is ${(lift * 100).toFixed(0)}% of non-peak — ${fteCount} FTE for the baseline + ${ptCount} part-timer(s) for the surge is cheaper than scaling FTE.`,
  };
}

// Count current employees by role. Drivers go to 'Driver'; others go to
// their `role` field if it's set and concrete, otherwise to 'Standard'.
// This mirrors `rollupByRole` so the comparison is apples-to-apples.
function currentByRole(employees: Employee[]): Map<string, number> {
  const out = new Map<string, number>();
  const isGenericRole = (r: string) => r === '' || r === 'Standard';
  for (const e of employees) {
    let key: string;
    if (e.category === 'Driver') key = 'Driver';
    else if (e.role && !isGenericRole(e.role)) key = e.role;
    else key = 'Standard';
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

export function analyzeWorkforce(args: AnalyzeArgs): WorkforcePlan {
  const { employees, stations, config, mode = 'conservative' } = args;
  const stdCap = monthlyHourCap(config);
  const driverCap = (config.driverWeeklyHrsCap ?? DRIVER_WEEKLY_CAP_DEFAULT) * 4;

  const demand = stationDemand(args);
  const grouped = rollupByRole(stations, demand);
  const current = currentByRole(employees);

  // Average IQD/mo — used to estimate the savings/cost of the recommended
  // mix vs the current roster.
  const avgFTESalary = employees.length > 0
    ? Math.round(employees.reduce((s, e) => s + (e.baseMonthlySalary || 0), 0) / employees.length)
    : 1_500_000;
  const avgPartTimeSalary = Math.round(avgFTESalary * PART_TIME_MONTHLY_SALARY_IQD_RATIO);

  const byRole: RoleDemand[] = [];
  // Track which roles we've handled so we can also emit "release" rows for
  // current roles with zero recommended demand.
  const handledRoles = new Set<string>();

  for (const [role, stationsForRole] of grouped) {
    const monthlyRequiredHours = stationsForRole.reduce((s, x) => s + x.monthlyHours, 0);
    const peakRequiredHours = stationsForRole.reduce((s, x) => s + x.peakHours, 0);
    const nonPeakRequiredHours = stationsForRole.reduce((s, x) => s + x.nonPeakHours, 0);
    const cap = role === 'Driver' ? driverCap : stdCap;
    const idealFTE = Math.ceil(monthlyRequiredHours / cap);
    const mix = recommendMix(monthlyRequiredHours, peakRequiredHours, nonPeakRequiredHours, cap, mode);
    const currentCount = current.get(role) || 0;
    const recommendedTotal = mix.recommendedFTE + mix.recommendedPartTime;
    const delta = recommendedTotal - currentCount;
    // Iraqi Labor Law (Art. 36, 40 — fixed-term renewals become open-ended;
    // releases require Minister of Labor approval). When current exceeds
    // recommended, we surface 'hold' rather than 'release' — the supervisor
    // carries the surplus through valley months instead of triggering a
    // legally-fraught termination process. Only the optimal-mode annual
    // analysis ever surfaces a 'release' action, and even then only
    // alongside a clear legal-cost warning.
    const action: RoleDemand['action'] = delta > 0 ? 'hire' : 'hold';
    byRole.push({
      role, cap,
      monthlyRequiredHours, peakRequiredHours, nonPeakRequiredHours,
      byStation: [...stationsForRole].sort((a, b) => b.monthlyHours - a.monthlyHours),
      idealFTE,
      recommendedFTE: mix.recommendedFTE,
      recommendedPartTime: mix.recommendedPartTime,
      reasoning: mix.reasoning,
      currentCount, delta, action,
    });
    handledRoles.add(role);
  }
  // Roles present in the roster but not represented by any station demand
  // (typical: leftover role labels after a station rename). Surface as
  // "release" candidates so the supervisor knows to consolidate.
  for (const [role, count] of current) {
    if (handledRoles.has(role)) continue;
    byRole.push({
      role, cap: role === 'Driver' ? driverCap : stdCap,
      monthlyRequiredHours: 0, peakRequiredHours: 0, nonPeakRequiredHours: 0,
      byStation: [],
      idealFTE: 0,
      recommendedFTE: 0, recommendedPartTime: 0,
      reasoning: 'No station demand for this role this month — consider reassigning. Releasing is legally complex (Minister of Labor approval required).',
      currentCount: count, delta: -count, action: 'hold',
    });
  }

  // Sort by absolute delta so the biggest changes float to the top.
  byRole.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const totalIdealFTE = byRole.reduce((s, r) => s + r.idealFTE, 0);
  const totalRecommendedFTE = byRole.reduce((s, r) => s + r.recommendedFTE, 0);
  const totalRecommendedPartTime = byRole.reduce((s, r) => s + r.recommendedPartTime, 0);
  const totalCurrentEmployees = employees.length;
  const recommendedMonthlySalary = totalRecommendedFTE * avgFTESalary + totalRecommendedPartTime * avgPartTimeSalary;
  const currentMonthlySalary = employees.reduce((s, e) => s + (e.baseMonthlySalary || 0), 0);
  const monthlyDelta = recommendedMonthlySalary - currentMonthlySalary;

  return {
    byRole,
    totalIdealFTE,
    totalRecommendedFTE,
    totalRecommendedPartTime,
    totalCurrentEmployees,
    recommendedMonthlySalary,
    currentMonthlySalary,
    monthlyDelta,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Annual workforce analysis (v1.13)
// ────────────────────────────────────────────────────────────────────────────
//
// `analyzeWorkforceAnnual` runs the monthly analyzer for every month of a
// given year and aggregates the results. It surfaces:
//   - Per-month plans (so the supervisor can spot which months drive the
//     recommendation — e.g. "Ramadan reduces demand, but Eid spikes peak
//     coverage and pulls the headcount up")
//   - Annual totals + averages
//   - The peak month + valley month
//   - "Implement starting in month X" rollup that estimates the annual IQD
//     savings if the supervisor adopts the recommendation from a chosen
//     month onwards (instead of the start of the year)
//
// Holidays are fed through wholesale; the analyzer filters them per-month
// itself by date prefix. PeakDays config + holiday list = peak detection
// per month.

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface MonthlyPlanSummary {
  monthIndex: number;        // 1..12 (1 = January)
  monthName: string;         // 'Jan', 'Feb', …
  monthlyRequiredHours: number;
  recommendedFTE: number;
  recommendedPartTime: number;
  recommendedMonthlySalary: number;
  // The complete monthly plan for drill-down. UI may keep just the summary
  // when rendering the at-a-glance row and lazy-load the full plan when the
  // supervisor expands a month.
  plan: WorkforcePlan;
}

export interface AnnualWorkforcePlan {
  year: number;
  byMonth: MonthlyPlanSummary[];
  // Annual aggregates.
  annualRequiredHours: number;
  annualRecommendedSalary: number;
  // For benchmarking: the current monthly salary × 12. The annual
  // recommended salary minus this is the year's payroll delta.
  annualCurrentSalary: number;
  annualDelta: number;
  // Average headcount across the year.
  avgRecommendedFTE: number;
  avgRecommendedPartTime: number;
  // Highest-demand month (peak) + lowest-demand month (valley) — the
  // analyzer doesn't know about Ramadan/Eid by name but the demand curve
  // makes those visible.
  peakMonthIndex: number;
  valleyMonthIndex: number;
  // Implementation-from-month savings table. Maps each starting month to
  // the IQD saved if the recommendation is adopted from that month forward
  // (i.e. months before stay on the current roster, months from start
  // onward switch to the recommended mix). Use this to surface "implement
  // in May → save X IQD this year" alongside other start months.
  savingsByStartMonth: Array<{ monthIndex: number; monthName: string; remainingMonths: number; savings: number }>;
}

export interface AnalyzeAnnualArgs {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  baseConfig: Config;        // year is taken from here; month is overridden internally
  // Peak-day predicate factory: given a config (with the active year/month),
  // return the per-day predicate. The factory pattern lets the caller
  // re-use the existing `isPeakDay` logic from App.tsx without rebuilding
  // the date math from scratch.
  isPeakDayFor: (config: Config) => (day: number) => boolean;
  mode?: PlanMode;
}

// Annual rollup — a single set of per-role recommendations for the year as
// a whole, NOT a per-month plan. This is what the supervisor presents to HR
// or the CEO: "for the year, you need X FTE of role Y; here's why."
//
// Rollup rules:
//   - Conservative mode: per role, take the MAX FTE count required across
//     any month. That's the year-round headcount needed to cover peak
//     demand without releases. Carries the excess through valleys —
//     accepts the idle-time cost as the price of legal stability.
//   - Optimal mode: per role, take the AVERAGE FTE/PT across months.
//     Assumes the supervisor is willing to scale the workforce up/down
//     across the year (legally hard, surfaces with explicit warnings).
export interface AnnualRollupRole {
  role: WorkforceRole;
  // Aggregated demand-hours across all months.
  annualRequiredHours: number;
  peakMonthIndex: number;            // 1..12, the month driving the rec
  peakMonthFTE: number;              // FTE recommendation for that month
  // Year-round recommendation (= max for conservative, avg-rounded for optimal)
  recommendedFTE: number;
  recommendedPartTime: number;
  reasoning: string;
  currentCount: number;
  delta: number;
  // v2.5.0 — 'release' for optimal mode (with caveats). Conservative
  // never recommends release and keeps the type's runtime values to
  // 'hire' / 'hold' for that branch.
  action: 'hire' | 'hold' | 'release';
}

// Per-station rollup row (v1.15). Anchors the recommendation to the
// station/asset rather than the volatile role label — venues rename roles
// over time but stations are stable physical assets. Each row tells the
// supervisor "Cashier Point 1 needs N FTE; you currently have M employees
// eligible to staff it".
export interface AnnualRollupStation {
  stationId: string;
  stationName: string;
  // The role gating the station (e.g. 'Driver' for vehicle stations) or
  // null when any eligible employee can work there.
  roleHint: string | null;
  annualRequiredHours: number;
  peakMonthIndex: number;
  peakMonthFTE: number;            // FTE need at the busiest month
  recommendedFTE: number;          // year-round recommendation
  recommendedPartTime: number;
  reasoning: string;
  // v2.6.0 — per-month FTE/PT need for the year. Length 12, index 0 = Jan.
  // Lets the UI compute the same 5-number summary (avg / median / peak /
  // valley) per station that the top-level Annual Headcount Plan panel
  // shows for the company as a whole. Pre-2.6 this data was discarded
  // after the recommendation was reduced to a single number.
  monthlyFTE: number[];
  monthlyPartTime: number[];
  // Current count of employees ELIGIBLE to staff this station (i.e.
  // station appears in their eligibleStations or they match requiredRoles).
  currentEligibleCount: number;
  // v2.3.0 — split the current count into PT and FT so the comparative
  // KPI reads "3 FT + 1 PT / 5 FT + 0 PT" instead of "4 / 5". PT is
  // anyone with `contractedWeeklyHrs < config.standardWeeklyHrsCap`.
  currentFTECount: number;
  currentPartTimeCount: number;
  // v2.5.0 — the fair-share supply available to this station alone.
  // currentEligibleCount counts every employee whose eligibility set
  // INCLUDES this station, so a venue with 35 cashiers eligible for
  // 10 cashier stations would show "35 eligible / 2 needed" on each
  // station (misleading — the 35 are spread across ALL 10 stations).
  // effectiveSupplyFTE / PT divide each employee's contribution by the
  // total stations they cover, so the same example shows "3.5 / 2"
  // (correct: each station gets 1/10 of each operator's capacity).
  effectiveSupplyFTE: number;
  effectiveSupplyPartTime: number;
  delta: number;                   // recommended - currentEligibleCount
  // v2.5.0 — added 'release' for optimal mode when the current roster
  // exceeds recommended. Conservative still uses only 'hire' / 'hold'
  // (Iraqi Labor Law makes releases legally fraught and the
  // conservative target carries excess through valleys instead).
  action: 'hire' | 'hold' | 'release';
}

// Per-group rollup (v1.16). Groups are the supervisor's mental model —
// "I need N cashiers across all 4 cashier counters" is more useful than
// "I need 1 at C1, 1 at C2, 1 at C3, 1 at C4". Stations roll up into the
// parent group; the group row aggregates demand and current eligibility
// across its member stations. Groups with no demand or no member
// stations are omitted from the rollup output.
export interface AnnualRollupGroup {
  groupId: string;
  groupName: string;
  groupColor?: string;
  // v2.2.0 — preset icon name (key into GROUP_ICON_PALETTE). Surfaces
  // the chosen icon in the workforce-planning rollup so the group's
  // visual identity matches its kanban header in the Stations tab.
  groupIcon?: string;
  stationIds: string[];
  annualRequiredHours: number;
  peakMonthIndex: number;
  peakMonthFTE: number;
  recommendedFTE: number;
  recommendedPartTime: number;
  reasoning: string;
  // v2.6.0 — per-month FTE/PT need across the year (length 12, idx 0 = Jan).
  // Same purpose as AnnualRollupStation.monthlyFTE — drives the per-group
  // demand-profile UI (avg / median / peak / valley split for FT and PT).
  monthlyFTE: number[];
  monthlyPartTime: number[];
  // Number of CURRENT employees who can staff this group via either
  // eligibleGroups membership or eligibleStations covering ≥1 of its
  // member stations. The supervisor reads this as "I have X people
  // ready to cover any cashier station today".
  currentEligibleCount: number;
  // v2.3.0 — current count split FT / PT (PT = contractedWeeklyHrs <
  // config.standardWeeklyHrsCap). Surfaced in the comparative KPI so the
  // reader sees the supply mix at a glance.
  currentFTECount: number;
  currentPartTimeCount: number;
  delta: number;
  // v2.5.0 — 'release' surfaces in optimal mode when delta < 0. See
  // AnnualRollupStation.action for the full rationale.
  action: 'hire' | 'hold' | 'release';
}

export interface AnnualRollup {
  byRole: AnnualRollupRole[];
  byStation: AnnualRollupStation[];
  byGroup: AnnualRollupGroup[];
  // Year-level totals.
  totalRecommendedFTE: number;
  totalRecommendedPartTime: number;
  totalCurrentEmployees: number;
  // Pure ideal cost: sum of all months' recommended salaries (per-month
  // optimal mix). Used as the baseline against which the conservative
  // rollup is compared so the supervisor sees what they're "paying" for
  // the legal safety.
  annualOptimalSalary: number;
  // Conservative cost: peak-FTE-count × 12 × avgFTESalary. Always ≥ optimal.
  annualConservativeSalary: number;
  // Cost of legal safety = conservative − optimal. Never negative.
  legalSafetyPremium: number;
}

export function analyzeWorkforceAnnual({
  employees, shifts, stations, holidays, baseConfig, isPeakDayFor, mode = 'conservative',
}: AnalyzeAnnualArgs): AnnualWorkforcePlan {
  const byMonth: MonthlyPlanSummary[] = [];
  let annualRequiredHours = 0;
  let annualRecommendedSalary = 0;

  for (let m = 1; m <= 12; m++) {
    const daysInMonth = new Date(baseConfig.year, m, 0).getDate();
    const monthCfg: Config = { ...baseConfig, month: m, daysInMonth };
    const monthIsPeakDay = isPeakDayFor(monthCfg);
    const plan = analyzeWorkforce({
      employees, shifts, stations, holidays, config: monthCfg, isPeakDay: monthIsPeakDay, mode,
    });
    const monthRequired = plan.byRole.reduce((s, r) => s + r.monthlyRequiredHours, 0);
    annualRequiredHours += monthRequired;
    annualRecommendedSalary += plan.recommendedMonthlySalary;
    byMonth.push({
      monthIndex: m,
      monthName: MONTH_NAMES[m - 1],
      monthlyRequiredHours: monthRequired,
      recommendedFTE: plan.totalRecommendedFTE,
      recommendedPartTime: plan.totalRecommendedPartTime,
      recommendedMonthlySalary: plan.recommendedMonthlySalary,
      plan,
    });
  }

  const avgRecommendedFTE = byMonth.reduce((s, m) => s + m.recommendedFTE, 0) / 12;
  const avgRecommendedPartTime = byMonth.reduce((s, m) => s + m.recommendedPartTime, 0) / 12;

  // Peak / valley months by required hours.
  let peakMonthIndex = 1;
  let valleyMonthIndex = 1;
  for (const m of byMonth) {
    if (m.monthlyRequiredHours > byMonth[peakMonthIndex - 1].monthlyRequiredHours) peakMonthIndex = m.monthIndex;
    if (m.monthlyRequiredHours < byMonth[valleyMonthIndex - 1].monthlyRequiredHours) valleyMonthIndex = m.monthIndex;
  }

  // Current monthly salary stays constant across the year (no historical
  // payroll changes are modelled). Annual current = monthly × 12.
  const monthlyCurrentSalary = employees.reduce((s, e) => s + (e.baseMonthlySalary || 0), 0);
  const annualCurrentSalary = monthlyCurrentSalary * 12;
  const annualDelta = annualRecommendedSalary - annualCurrentSalary;

  // Implementation-from-month: for each potential start month, sum the
  // delta from that month onward. Months before stay on current; months
  // from start onward switch to recommended. The supervisor uses this to
  // pick when to roll out the change — the further into the year, the
  // smaller the savings (fewer months of impact).
  const savingsByStartMonth = byMonth.map(m => {
    let savings = 0;
    for (let i = m.monthIndex - 1; i < 12; i++) {
      // If recommended < current, byMonth[i].recommendedMonthlySalary -
      // monthlyCurrentSalary is negative. We invert sign so "savings" is
      // a positive number when it's saving money.
      savings += monthlyCurrentSalary - byMonth[i].recommendedMonthlySalary;
    }
    return {
      monthIndex: m.monthIndex,
      monthName: m.monthName,
      remainingMonths: 13 - m.monthIndex,
      savings: Math.round(savings),
    };
  });

  return {
    year: baseConfig.year,
    byMonth,
    annualRequiredHours,
    annualRecommendedSalary: Math.round(annualRecommendedSalary),
    annualCurrentSalary: Math.round(annualCurrentSalary),
    annualDelta: Math.round(annualDelta),
    avgRecommendedFTE,
    avgRecommendedPartTime,
    peakMonthIndex,
    valleyMonthIndex,
    savingsByStartMonth,
  };
}

// Build a single-row-per-role rollup of the year. Conservative mode picks
// the per-role MAX FTE across the 12 months (peak-driven); optimal mode
// uses the rounded average. Both modes never recommend release — the
// supervisor holds excess capacity through valleys (Art. 36/40 of the
// Iraqi Labor Law makes releases legally fraught, see comments at the top
// of this module).
export function buildAnnualRollup(
  annual: AnnualWorkforcePlan,
  employees: Employee[],
  stations: Station[],
  mode: PlanMode,
  stationGroups: StationGroup[] = [],
  // v2.3.0 — optional config so the FT/PT classifier honours the venue's
  // configured weekly cap rather than the Iraqi default. Tests omit it
  // and the helper falls back to 48h (Art. 70 standard).
  config?: Pick<Config, 'standardWeeklyHrsCap'>,
): AnnualRollup {
  // Walk each role across all 12 months, picking up the per-role demand.
  type RolePerMonth = {
    role: string;
    cap: number;
    perMonth: Array<{ idx: number; fte: number; pt: number; required: number }>;
    annualRequired: number;
  };
  const byRoleAcc = new Map<string, RolePerMonth>();
  for (const m of annual.byMonth) {
    for (const r of m.plan.byRole) {
      let acc = byRoleAcc.get(r.role);
      if (!acc) {
        acc = { role: r.role, cap: r.cap, perMonth: [], annualRequired: 0 };
        byRoleAcc.set(r.role, acc);
      }
      acc.perMonth.push({
        idx: m.monthIndex,
        fte: r.recommendedFTE,
        pt: r.recommendedPartTime,
        required: r.monthlyRequiredHours,
      });
      acc.annualRequired += r.monthlyRequiredHours;
    }
  }

  // Current roster grouped by role (same logic as currentByRole).
  const isGenericRole = (r: string) => r === '' || r === 'Standard';
  const current = new Map<string, number>();
  for (const e of employees) {
    let key: string;
    if (e.category === 'Driver') key = 'Driver';
    else if (e.role && !isGenericRole(e.role)) key = e.role;
    else key = 'Standard';
    current.set(key, (current.get(key) || 0) + 1);
  }

  // Avg salary for cost calculations.
  const avgFTESalary = employees.length > 0
    ? Math.round(employees.reduce((s, e) => s + (e.baseMonthlySalary || 0), 0) / employees.length)
    : 1_500_000;
  const avgPartTimeSalary = Math.round(avgFTESalary * PART_TIME_MONTHLY_SALARY_IQD_RATIO);

  const byRole: AnnualRollupRole[] = [];
  let totalRecommendedFTE = 0;
  let totalRecommendedPartTime = 0;

  for (const [role, acc] of byRoleAcc) {
    if (acc.perMonth.length === 0) continue;
    // Find the peak month for this role.
    let peakIdx = acc.perMonth[0].idx;
    let peakFTE = acc.perMonth[0].fte;
    let peakPT = acc.perMonth[0].pt;
    for (const p of acc.perMonth) {
      if (p.fte + p.pt > peakFTE + peakPT) {
        peakIdx = p.idx;
        peakFTE = p.fte;
        peakPT = p.pt;
      }
    }
    const recommendedFTE = mode === 'conservative'
      ? peakFTE
      : Math.round(acc.perMonth.reduce((s, p) => s + p.fte, 0) / acc.perMonth.length);
    const recommendedPartTime = mode === 'conservative'
      ? 0  // conservative never uses PT
      : Math.round(acc.perMonth.reduce((s, p) => s + p.pt, 0) / acc.perMonth.length);
    const currentCount = current.get(role) || 0;
    const delta = (recommendedFTE + recommendedPartTime) - currentCount;
    // v2.5.0 — optimal mode surfaces 'release' for surplus roles so
    // the supervisor sees the true cost-minimising answer. Conservative
    // continues to mask surplus as 'hold' (carry through valleys, no
    // release attempted under Iraqi Labor Law).
    const action: AnnualRollupRole['action'] = delta > 0
      ? 'hire'
      : (delta < 0 && mode === 'optimal' ? 'release' : 'hold');

    const reasoning = mode === 'conservative'
      ? `Conservative target = peak month (${MONTH_NAMES[peakIdx - 1]}) FTE need = ${peakFTE}. Hire to that level and hold through valley months — releases are legally hard under Art. 36/40 (fixed-term renewals become open-ended, dismissals require Minister of Labor approval).`
      : action === 'release'
        ? `Optimal target = ${recommendedFTE} FTE${recommendedPartTime > 0 ? ` + ${recommendedPartTime} PT` : ''}. Current roster of ${currentCount} exceeds annual demand by ${Math.abs(delta)}. Reducing requires Minister of Labor approval (Art. 40); fixed-term PT contracts can be allowed to expire without renewal (Art. 36) but FTE releases are slow and reputational. Treat this as a recruitment-freeze signal rather than a layoff list.`
        : `Optimal target = average across the year. ${recommendedFTE} FTE baseline + ${recommendedPartTime} part-timer(s) for peak surge. Cheaper than the conservative approach but assumes the supervisor can scale headcount up/down — usually requires fixed-term PT contracts that don't trigger Art. 36 open-end conversion.`;

    byRole.push({
      role,
      annualRequiredHours: acc.annualRequired,
      peakMonthIndex: peakIdx,
      peakMonthFTE: peakFTE,
      recommendedFTE,
      recommendedPartTime,
      reasoning,
      currentCount,
      delta,
      action,
    });
    totalRecommendedFTE += recommendedFTE;
    totalRecommendedPartTime += recommendedPartTime;
  }
  // Roles in the roster but with no demand this year — surface as hold.
  for (const [role, count] of current) {
    if (byRoleAcc.has(role)) continue;
    byRole.push({
      role,
      annualRequiredHours: 0,
      peakMonthIndex: 1,
      peakMonthFTE: 0,
      recommendedFTE: 0,
      recommendedPartTime: 0,
      reasoning: 'No station demand for this role anywhere in the year — consider reassignment. Releasing requires Minister of Labor approval under Iraqi Labor Law.',
      currentCount: count,
      delta: -count,
      action: 'hold',
    });
  }
  byRole.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Cost calculations: conservative cost = peak-FTE × 12 × salary.
  const annualConservativeSalary = byRole.reduce(
    (s, r) => s + r.peakMonthFTE * avgFTESalary * 12, 0);
  // Optimal cost: re-derive the optimal mix from each month's required-
  // hours data so we get the right answer regardless of which mode was
  // used to build `annual`. Without this re-derivation, calling
  // `buildAnnualRollup` with a conservative-mode annual would produce
  // legalSafetyPremium=0 (because every month's data already reflects
  // the conservative pure-FTE recommendation).
  let annualOptimalSalary = 0;
  for (const m of annual.byMonth) {
    for (const r of m.plan.byRole) {
      const optimalMix = recommendMix(
        r.monthlyRequiredHours, r.peakRequiredHours, r.nonPeakRequiredHours, r.cap, 'optimal');
      annualOptimalSalary += optimalMix.recommendedFTE * avgFTESalary
        + optimalMix.recommendedPartTime * avgPartTimeSalary;
    }
  }
  const legalSafetyPremium = Math.max(0, Math.round(annualConservativeSalary - annualOptimalSalary));

  // ── Per-station rollup (v1.15) ──────────────────────────────────────────
  // Anchor the recommendation to stations rather than role labels (roles
  // change names; stations are stable physical assets). For each station,
  // walk the year's monthly demand and compute the year-round FTE need
  // following the same conservative/optimal logic.
  const stationDemandPerMonth = new Map<string, Array<{ idx: number; fte: number; pt: number; required: number }>>();
  for (const m of annual.byMonth) {
    for (const r of m.plan.byRole) {
      for (const st of r.byStation) {
        let arr = stationDemandPerMonth.get(st.stationId);
        if (!arr) { arr = []; stationDemandPerMonth.set(st.stationId, arr); }
        // Per-station per-month FTE = ceil(stationMonthlyHours / cap)
        const mix = recommendMix(
          st.monthlyHours, st.peakHours, st.nonPeakHours, r.cap, mode);
        arr.push({
          idx: m.monthIndex,
          fte: mix.recommendedFTE,
          pt: mix.recommendedPartTime,
          required: st.monthlyHours,
        });
      }
    }
  }

  // v2.3.0 — FT/PT split helper. PT = contractedWeeklyHrs strictly less
  // than the venue's standard weekly cap (Art. 70, default 48h).
  const weeklyCapForFT = config?.standardWeeklyHrsCap ?? 48;
  const isPT = (e: Employee) => (e.contractedWeeklyHrs || weeklyCapForFT) < weeklyCapForFT;

  // v2.5.0 — eligibility now honours eligibleGroups (the previous
  // helper only looked at eligibleStations, so a group-only employee
  // showed as ineligible everywhere — the rollup undercounted supply).
  const employeeEligibleFor = (e: Employee, st: Station): boolean => {
    if (st.requiredRoles?.includes('Driver')) {
      return e.category === 'Driver';
    }
    const directly = e.eligibleStations.length === 0 || e.eligibleStations.includes(st.id);
    const viaGroup = !!(st.groupId && (e.eligibleGroups || []).includes(st.groupId));
    if (!directly && !viaGroup) return false;
    if (st.requiredRoles?.length && !st.requiredRoles.some(r => r === e.role || r === 'Standard')) return false;
    return true;
  };

  // v2.5.0 — pre-compute how many stations each employee is eligible
  // for. Drives the fair-share `effectiveSupply` math: an employee
  // covering 10 cashier stations contributes 1/10 to each station's
  // effective supply, so a station with 35 eligible operators across a
  // 10-station group reads as "3.5 effective FTE" instead of the
  // misleading "35 eligible" double-count.
  const eligibleStationCountByEmp = new Map<string, number>();
  for (const e of employees) {
    let n = 0;
    for (const st of stations) if (employeeEligibleFor(e, st)) n++;
    eligibleStationCountByEmp.set(e.empId, n);
  }

  // Eligibility: how many current employees can staff each station today,
  // split FT / PT (raw count) PLUS effective fair-share supply (raw / N
  // stations the employee covers).
  const eligibilityCount = (st: Station): {
    total: number; fte: number; pt: number;
    effFte: number; effPt: number;
  } => {
    let fte = 0, pt = 0, effFte = 0, effPt = 0;
    for (const e of employees) {
      if (!employeeEligibleFor(e, st)) continue;
      const span = Math.max(1, eligibleStationCountByEmp.get(e.empId) || 1);
      const share = 1 / span;
      if (isPT(e)) { pt++; effPt += share; }
      else { fte++; effFte += share; }
    }
    return {
      total: fte + pt,
      fte, pt,
      effFte: Math.round(effFte * 10) / 10, // 1 decimal precision
      effPt: Math.round(effPt * 10) / 10,
    };
  };

  const byStation: AnnualRollupStation[] = [];
  for (const st of stations) {
    const months = stationDemandPerMonth.get(st.id);
    if (!months || months.length === 0) continue;
    const annualReq = months.reduce((s, p) => s + p.required, 0);
    if (annualReq <= 0) continue;
    let peakIdx = months[0].idx;
    let peakFTE = months[0].fte;
    let peakPT = months[0].pt;
    for (const p of months) {
      if (p.fte + p.pt > peakFTE + peakPT) {
        peakIdx = p.idx;
        peakFTE = p.fte;
        peakPT = p.pt;
      }
    }
    const recommendedFTE = mode === 'conservative'
      ? peakFTE
      : Math.round(months.reduce((s, p) => s + p.fte, 0) / months.length);
    const recommendedPartTime = mode === 'conservative'
      ? 0
      : Math.round(months.reduce((s, p) => s + p.pt, 0) / months.length);
    // v2.6.0 — dense 12-element arrays so the UI can compute its own
    // 5-number summary (avg / median / peak / valley) per contract type.
    // Months that didn't appear in stationDemandPerMonth (no demand)
    // backfill to 0 — preserving the index alignment with the byMonth
    // series.
    const monthlyFTEArr = Array(12).fill(0);
    const monthlyPartTimeArr = Array(12).fill(0);
    for (const p of months) {
      if (p.idx >= 1 && p.idx <= 12) {
        monthlyFTEArr[p.idx - 1] = p.fte;
        monthlyPartTimeArr[p.idx - 1] = p.pt;
      }
    }
    const eligibility = eligibilityCount(st);
    const currentEligible = eligibility.total;
    // v2.5.0 — delta + action measure effective supply against demand.
    // A station with 35 employees in a 10-station pool has 3.5 effective
    // FTE per station — comparing 35 to 2 needed is misleading because
    // each employee can only cover ~1/10th of the time. Optimal mode
    // raises the surplus as 'release'; conservative folds it into 'hold'.
    const effectiveSupply = eligibility.effFte + eligibility.effPt;
    const delta = Math.round((recommendedFTE + recommendedPartTime - effectiveSupply) * 10) / 10;
    const action: AnnualRollupStation['action'] = delta > 0
      ? 'hire'
      : (delta < 0 && mode === 'optimal' ? 'release' : 'hold');
    const roleHint = st.requiredRoles?.find(r => r !== 'Standard' && r !== '') || null;
    // v2.5.0 — reasoning narrates the fair-share supply so the
    // supervisor can sanity-check why "35 eligible / 2 needed" reads
    // as "hold" instead of "release". Optimal mode flags the legal
    // caveats explicitly when surfacing a release.
    const reasoning = mode === 'conservative'
      ? `Station peaks in ${MONTH_NAMES[peakIdx - 1]} needing ${peakFTE} FTE. Hire to that level and hold through valleys; releases are legally hard under Iraqi Labor Law. Effective supply today: ${effectiveSupply} FTE (${currentEligible} eligible across the pool, fair-share allocated).`
      : action === 'release'
        ? `Optimal mode: peak need ${peakFTE} FTE; effective supply ${effectiveSupply}. Surplus of ${Math.abs(delta)} FTE-equivalents — consider not renewing fixed-term PT contracts (Art. 36) or freezing replacements. FTE dismissals require Minister of Labor approval (Art. 40).`
        : `Avg ${recommendedFTE} FTE + ${recommendedPartTime} part-time across the year. Peak month is ${MONTH_NAMES[peakIdx - 1]}. Effective supply: ${effectiveSupply} FTE (${currentEligible} eligible).`;
    byStation.push({
      stationId: st.id,
      stationName: st.name,
      roleHint,
      annualRequiredHours: annualReq,
      peakMonthIndex: peakIdx,
      peakMonthFTE: peakFTE,
      recommendedFTE,
      recommendedPartTime,
      reasoning,
      monthlyFTE: monthlyFTEArr,
      monthlyPartTime: monthlyPartTimeArr,
      currentEligibleCount: currentEligible,
      currentFTECount: eligibility.fte,
      currentPartTimeCount: eligibility.pt,
      effectiveSupplyFTE: eligibility.effFte,
      effectiveSupplyPartTime: eligibility.effPt,
      delta,
      action,
    });
  }
  byStation.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // ── Per-group rollup (v1.16) ────────────────────────────────────────────
  // Aggregate station demand into the parent groups. The recommendation is
  // computed from each month's TOTAL group demand (not by summing
  // per-station FTE counts) so the cap math reflects pooling efficiency:
  // 200 hours of demand split across 5 stations with ceil-rounding wastes
  // capacity if treated as 5 separate FTE buckets.
  const byGroup: AnnualRollupGroup[] = [];
  for (const grp of stationGroups) {
    const memberStations = stations.filter(s => s.groupId === grp.id);
    if (memberStations.length === 0) continue;
    // Per-month aggregate demand for this group.
    const groupDemandPerMonth: Array<{ idx: number; required: number; peakHrs: number; nonPeakHrs: number; cap: number }> = [];
    for (const m of annual.byMonth) {
      let monthRequired = 0;
      let monthPeak = 0;
      let monthNonPeak = 0;
      let monthCap = 0;
      for (const r of m.plan.byRole) {
        for (const st of r.byStation) {
          if (memberStations.some(ms => ms.id === st.stationId)) {
            monthRequired += st.monthlyHours;
            monthPeak += st.peakHours;
            monthNonPeak += st.nonPeakHours;
            monthCap = Math.max(monthCap, r.cap);
          }
        }
      }
      if (monthRequired > 0) {
        groupDemandPerMonth.push({ idx: m.monthIndex, required: monthRequired, peakHrs: monthPeak, nonPeakHrs: monthNonPeak, cap: monthCap });
      }
    }
    if (groupDemandPerMonth.length === 0) continue;

    const annualReq = groupDemandPerMonth.reduce((s, p) => s + p.required, 0);
    // Peak month = the month whose aggregate group demand is highest.
    let peakIdx = groupDemandPerMonth[0].idx;
    let peakReq = groupDemandPerMonth[0].required;
    for (const p of groupDemandPerMonth) {
      if (p.required > peakReq) { peakReq = p.required; peakIdx = p.idx; }
    }
    const peakMonth = groupDemandPerMonth.find(p => p.idx === peakIdx)!;
    const peakMix = recommendMix(peakMonth.required, peakMonth.peakHrs, peakMonth.nonPeakHrs, peakMonth.cap, mode);
    const peakMonthFTE = peakMix.recommendedFTE + peakMix.recommendedPartTime;

    // v2.6.0 — dense per-month FTE/PT for the group. Computed in the
    // active mode (conservative collapses PT to 0 by definition; optimal
    // uses recommendMix).  Populated regardless of which branch wins so
    // the UI always has the curve to render.
    const monthlyFTEArr = Array(12).fill(0);
    const monthlyPartTimeArr = Array(12).fill(0);
    for (const p of groupDemandPerMonth) {
      const mix = recommendMix(p.required, p.peakHrs, p.nonPeakHrs, p.cap, mode);
      if (p.idx >= 1 && p.idx <= 12) {
        monthlyFTEArr[p.idx - 1] = mix.recommendedFTE;
        monthlyPartTimeArr[p.idx - 1] = mix.recommendedPartTime;
      }
    }

    let recommendedFTE: number;
    let recommendedPartTime: number;
    if (mode === 'conservative') {
      recommendedFTE = peakMix.recommendedFTE;
      recommendedPartTime = 0;
    } else {
      // Optimal: average across months. Reuse the per-month curve we
      // already built above instead of recomputing.
      const ftes = groupDemandPerMonth.map(p => monthlyFTEArr[p.idx - 1]);
      const pts = groupDemandPerMonth.map(p => monthlyPartTimeArr[p.idx - 1]);
      recommendedFTE = Math.round(ftes.reduce((s, x) => s + x, 0) / ftes.length);
      recommendedPartTime = Math.round(pts.reduce((s, x) => s + x, 0) / pts.length);
    }

    // Eligible employees for this group: employees with the group in
    // eligibleGroups OR with any member station in eligibleStations.
    const memberStationIds = new Set(memberStations.map(s => s.id));
    const eligibleEmployees = employees.filter(e =>
      (e.eligibleGroups || []).includes(grp.id)
      || e.eligibleStations.some(s => memberStationIds.has(s))
    );
    const eligibleCount = eligibleEmployees.length;
    let groupFTE = 0, groupPT = 0;
    for (const e of eligibleEmployees) {
      if (isPT(e)) groupPT++;
      else groupFTE++;
    }
    const delta = (recommendedFTE + recommendedPartTime) - eligibleCount;
    // v2.5.0 — optimal mode raises 'release' for surplus groups so the
    // supervisor sees the cost-minimising answer with explicit caveats.
    // Conservative still uses 'hold' to mirror the Art. 36/40 reality.
    const action: AnnualRollupGroup['action'] = delta > 0
      ? 'hire'
      : (delta < 0 && mode === 'optimal' ? 'release' : 'hold');
    const reasoning = mode === 'conservative'
      ? `${memberStations.length} station(s) under "${grp.name}" peak together in ${MONTH_NAMES[peakIdx - 1]} requiring ${peakMonthFTE} FTE pooled. Conservative carries that headcount through valley months.`
      : action === 'release'
        ? `Group "${grp.name}" pools ${memberStations.length} stations needing ${recommendedFTE} FTE${recommendedPartTime > 0 ? ` + ${recommendedPartTime} PT` : ''} on average. Current pool: ${eligibleCount} (${groupFTE} FT + ${groupPT} PT). Surplus of ${Math.abs(delta)} — favour letting fixed-term PT (Art. 36) expire over FTE dismissals (Art. 40, requires Minister of Labor approval).`
        : `Year-average across ${memberStations.length} station(s) gives ${recommendedFTE} FTE + ${recommendedPartTime} part-time. Peak in ${MONTH_NAMES[peakIdx - 1]} needs ${peakMonthFTE}.`;
    byGroup.push({
      groupId: grp.id,
      groupName: grp.name,
      groupColor: grp.color,
      groupIcon: grp.icon,
      stationIds: memberStations.map(s => s.id),
      annualRequiredHours: annualReq,
      peakMonthIndex: peakIdx,
      peakMonthFTE,
      recommendedFTE,
      recommendedPartTime,
      reasoning,
      monthlyFTE: monthlyFTEArr,
      monthlyPartTime: monthlyPartTimeArr,
      currentEligibleCount: eligibleCount,
      currentFTECount: groupFTE,
      currentPartTimeCount: groupPT,
      delta,
      action,
    });
  }
  byGroup.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    byRole,
    byStation,
    byGroup,
    totalRecommendedFTE,
    totalRecommendedPartTime,
    totalCurrentEmployees: employees.length,
    annualOptimalSalary: Math.round(annualOptimalSalary),
    annualConservativeSalary: Math.round(annualConservativeSalary),
    legalSafetyPremium,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Monthly hiring roadmap (v2.4.0)
// ────────────────────────────────────────────────────────────────────────────
//
// `buildHiringRoadmap` turns the annual demand curve into an actionable
// month-by-month recruitment plan. The total "+N FTE / +M PT" answer
// from the rollup tells the supervisor *how many* to hire; this function
// answers *when*.
//
// Algorithm (per mode):
//
//   Conservative:
//     • FTE never decreases (Iraqi Labor Law Art. 36/40 makes releases
//       hard). PT never used.
//     • Walk Jan→Dec. For each month, look at NEXT month's demand and
//       hire just enough this month to cover it (lead time = 1 month so
//       new hires are productive when demand lands).
//     • Any current shortfall vs Jan demand becomes an "urgent" Jan add.
//     • Once running FTE reaches the annual peak, no further hires.
//
//   Optimal:
//     • FTE follows the same just-in-time logic (still no releases —
//       even optimal mode treats FTE as effectively permanent).
//     • PT scales freely up AND down. PT contracts ramped 1 month before
//       a surge (lead=1) and ended in the month their demand drops.
//     • Result: smaller FTE baseline + PT pulses around peaks.
//
// Savings vs naive baseline: the baseline is "hire every needed FTE
// (and PT for optimal mode) in January and hold all year". The smart
// plan defers as much as possible without missing demand. Difference =
// money saved by phasing. Always ≥ 0 (you never lose money by deferring
// non-binding hires).
//
// Output: 12 monthly steps with adds/releases/end-of-month roster/cost,
// plus annual totals and the savings figure.

export interface MonthlyHiringStep {
  monthIndex: number;        // 1..12
  monthName: string;         // 'Jan', 'Feb', …
  fteAdds: number;           // FTE hired in this month (productive next month)
  ptAdds: number;            // PT contracts started this month
  ptReleases: number;        // PT contracts ended this month (optimal mode only)
  fteEnd: number;            // FTE roster after this month's actions
  ptEnd: number;             // PT roster after this month's actions
  monthlyRequiredFTE: number; // recommended FTE need for this month (for context)
  monthlyRequiredPT: number;  // recommended PT need for this month
  monthlyCost: number;        // payroll cost (IQD) for this month under the plan
  reasoning: string;          // short rationale ("ramp ahead of May peak", "hold through valley", …)
}

export interface HiringRoadmap {
  steps: MonthlyHiringStep[];
  // Annual aggregates.
  totalFTEAdds: number;
  totalPTAdds: number;
  totalPTReleases: number;
  // Cost comparison.
  smartAnnualCost: number;     // sum of monthlyCost across the 12 steps
  baselineAnnualCost: number;  // peak roster × 12 (hire-all-in-Jan baseline)
  savingsVsBaseline: number;   // baseline − smart, ≥ 0
  // Steady-state targets (peak = year-round target in conservative mode).
  peakFTE: number;
  peakPT: number;
  // Lead-month assumption used (default 1).
  leadMonths: number;
  // The starting roster the plan was based on.
  startingFTE: number;
  startingPT: number;
}

export interface BuildHiringRoadmapArgs {
  annual: AnnualWorkforcePlan;
  employees: Employee[];
  mode: PlanMode;
  config: Pick<Config, 'standardWeeklyHrsCap'>;
  // How many months early to place hires before the demand month they
  // cover. 1 = hire in April for May peak. Default 1; the supervisor
  // can call with 2 for slower onboarding pipelines.
  leadMonths?: number;
}

export function buildHiringRoadmap(args: BuildHiringRoadmapArgs): HiringRoadmap {
  const { annual, employees, mode, config, leadMonths = 1 } = args;

  // FT vs PT classification matches buildAnnualRollup so the figures
  // line up across views.
  const weeklyCapForFT = config.standardWeeklyHrsCap || 48;
  const isPT = (e: Employee) => (e.contractedWeeklyHrs || weeklyCapForFT) < weeklyCapForFT;
  const startingPT = employees.filter(isPT).length;
  const startingFTE = employees.length - startingPT;

  // Average salaries — same formula as analyzeWorkforce so cost figures
  // are comparable to the rollup totals.
  const avgFTESalary = employees.length > 0
    ? Math.round(employees.reduce((s, e) => s + (e.baseMonthlySalary || 0), 0) / employees.length)
    : 1_500_000;
  const avgPTSalary = Math.round(avgFTESalary * PART_TIME_MONTHLY_SALARY_IQD_RATIO);

  // Walk the year, computing fteAdds / ptAdds / ptReleases per month.
  const N = 12;
  const fteAdds = new Array<number>(N).fill(0);
  const ptAdds = new Array<number>(N).fill(0);
  const ptReleases = new Array<number>(N).fill(0);

  let runningFTE = startingFTE;
  let runningPT = startingPT;

  // Step 1 — handle Jan urgency (any shortfall vs Jan demand is hired in
  // Jan immediately; there's no "month 0" to hire in advance).
  const reqFTEJan = annual.byMonth[0].recommendedFTE;
  if (runningFTE < reqFTEJan) {
    fteAdds[0] += reqFTEJan - runningFTE;
    runningFTE = reqFTEJan;
  }
  if (mode === 'optimal') {
    const reqPTJan = annual.byMonth[0].recommendedPartTime;
    const ptDelta = reqPTJan - runningPT;
    if (ptDelta > 0) { ptAdds[0] += ptDelta; runningPT += ptDelta; }
    else if (ptDelta < 0) { ptReleases[0] += -ptDelta; runningPT += ptDelta; }
  }

  // Step 2 — walk months 0..(N-leadMonths-1), hiring leadMonths early
  // for the demand in (i + leadMonths). PT also follows lead for adds;
  // releases happen in the month BEFORE the demand drops so the count
  // is lower next month (also lead-aligned).
  for (let i = 0; i < N - leadMonths; i++) {
    const demandMonth = i + leadMonths;
    const reqFTE = annual.byMonth[demandMonth].recommendedFTE;
    if (runningFTE < reqFTE) {
      const add = reqFTE - runningFTE;
      fteAdds[i] += add;
      runningFTE += add;
    }
    if (mode === 'optimal') {
      const reqPT = annual.byMonth[demandMonth].recommendedPartTime;
      const delta = reqPT - runningPT;
      if (delta > 0) { ptAdds[i] += delta; runningPT += delta; }
      else if (delta < 0) {
        // Release in CURRENT month so headcount drops by demandMonth.
        ptReleases[i] += -delta;
        runningPT += delta;
      }
    }
  }

  // Step 3 — months [N-leadMonths .. N-1] don't get pre-positioned hires
  // (no demand month beyond Dec to hire for); leave their adds at 0.
  // BUT we still need to satisfy their OWN demand. If by this point
  // runningFTE/PT are below required for any of these months, those
  // demands were missed by the lead-window logic — fold them into the
  // earliest available month.
  for (let i = N - leadMonths; i < N; i++) {
    const reqFTE = annual.byMonth[i].recommendedFTE;
    if (runningFTE < reqFTE) {
      const shortfall = reqFTE - runningFTE;
      // Place the urgent hire in the latest pre-window month so it's at
      // least one month early. Fall back to month i if there's no slack.
      const placeIn = Math.max(0, i - leadMonths);
      fteAdds[placeIn] += shortfall;
      runningFTE += shortfall;
    }
    if (mode === 'optimal') {
      const reqPT = annual.byMonth[i].recommendedPartTime;
      const delta = reqPT - runningPT;
      if (delta > 0) {
        const placeIn = Math.max(0, i - leadMonths);
        ptAdds[placeIn] += delta;
        runningPT += delta;
      } else if (delta < 0) {
        ptReleases[Math.max(0, i - 1)] += -delta;
        runningPT += delta;
      }
    }
  }

  // Step 4 — build roster + cost per month + reasoning.
  const peakFTE = annual.byMonth.reduce((m, b) => Math.max(m, b.recommendedFTE), 0);
  const peakPT = mode === 'optimal'
    ? annual.byMonth.reduce((m, b) => Math.max(m, b.recommendedPartTime), 0)
    : 0;
  let fteRunning = startingFTE;
  let ptRunning = startingPT;
  const steps: MonthlyHiringStep[] = [];
  let smartAnnualCost = 0;
  for (let i = 0; i < N; i++) {
    fteRunning += fteAdds[i];
    ptRunning += ptAdds[i];
    // Releases at end of month → paid this month, gone next.
    const monthlyFte = fteRunning;
    const monthlyPt = ptRunning; // before releases this month
    const monthlyCost = monthlyFte * avgFTESalary + monthlyPt * avgPTSalary;
    smartAnnualCost += monthlyCost;
    ptRunning -= ptReleases[i];

    const m = annual.byMonth[i];
    const reasoning = explainStep({
      monthName: m.monthName,
      monthIndex: i + 1,
      mode,
      fteAdd: fteAdds[i],
      ptAdd: ptAdds[i],
      ptRelease: ptReleases[i],
      fteEnd: fteRunning,
      ptEnd: ptRunning,
      requiredFTE: m.recommendedFTE,
      requiredPT: m.recommendedPartTime,
      peakMonthIndex: annual.peakMonthIndex,
      valleyMonthIndex: annual.valleyMonthIndex,
      isPeakLead: (i + leadMonths) === annual.peakMonthIndex - 1,
      leadMonths,
    });

    steps.push({
      monthIndex: i + 1,
      monthName: m.monthName,
      fteAdds: fteAdds[i],
      ptAdds: ptAdds[i],
      ptReleases: ptReleases[i],
      fteEnd: fteRunning,
      ptEnd: ptRunning,
      monthlyRequiredFTE: m.recommendedFTE,
      monthlyRequiredPT: m.recommendedPartTime,
      monthlyCost,
      reasoning,
    });
  }

  const baselineAnnualCost = (peakFTE * avgFTESalary + peakPT * avgPTSalary) * 12;
  const savingsVsBaseline = Math.max(0, baselineAnnualCost - smartAnnualCost);

  return {
    steps,
    totalFTEAdds: fteAdds.reduce((s, x) => s + x, 0),
    totalPTAdds: ptAdds.reduce((s, x) => s + x, 0),
    totalPTReleases: ptReleases.reduce((s, x) => s + x, 0),
    smartAnnualCost: Math.round(smartAnnualCost),
    baselineAnnualCost: Math.round(baselineAnnualCost),
    savingsVsBaseline: Math.round(savingsVsBaseline),
    peakFTE,
    peakPT,
    leadMonths,
    startingFTE,
    startingPT,
  };
}

// Per-step rationale text. Picks the most useful sentence from a few
// natural action archetypes — "ramp ahead of peak", "release after peak",
// "no action — coverage holds", etc. The supervisor reads these to
// understand WHY a month has the numbers it has.
function explainStep(args: {
  monthName: string;
  monthIndex: number;
  mode: PlanMode;
  fteAdd: number; ptAdd: number; ptRelease: number;
  fteEnd: number; ptEnd: number;
  requiredFTE: number; requiredPT: number;
  peakMonthIndex: number; valleyMonthIndex: number;
  isPeakLead: boolean;
  leadMonths: number;
}): string {
  const {
    monthName, monthIndex, mode, fteAdd, ptAdd, ptRelease,
    fteEnd, ptEnd, requiredFTE, requiredPT,
    peakMonthIndex, valleyMonthIndex, isPeakLead, leadMonths,
  } = args;

  const isPeak = monthIndex === peakMonthIndex;
  const isValley = monthIndex === valleyMonthIndex;
  const peakName = MONTH_NAMES[peakMonthIndex - 1];

  const parts: string[] = [];
  if (fteAdd > 0) {
    if (isPeakLead) {
      parts.push(`Ramp ${fteAdd} FTE for ${peakName} peak — onboard now so they're productive when demand lands.`);
    } else if (monthIndex === 1 && fteEnd === requiredFTE && fteAdd >= requiredFTE) {
      parts.push(`Urgent Jan hires (${fteAdd} FTE) — current roster is short of even Jan demand.`);
    } else {
      parts.push(`Hire ${fteAdd} FTE this month (${leadMonths}-month lead before next demand step-up).`);
    }
  }
  if (ptAdd > 0) {
    parts.push(`Start ${ptAdd} part-time contract(s) — covers the upcoming surge without locking in permanent payroll.`);
  }
  if (ptRelease > 0) {
    parts.push(`End ${ptRelease} part-time contract(s) — surge has passed, scale back to baseline.`);
  }
  if (fteAdd === 0 && ptAdd === 0 && ptRelease === 0) {
    if (fteEnd >= requiredFTE && ptEnd >= requiredPT) {
      if (isValley) {
        parts.push(`Valley month — current roster (${fteEnd} FTE${mode === 'optimal' && ptEnd > 0 ? ` + ${ptEnd} PT` : ''}) covers demand. Use slack for training, leave rotation, or process work.`);
      } else if (isPeak) {
        parts.push(`Peak month — roster is at target (${fteEnd} FTE${mode === 'optimal' && ptEnd > 0 ? ` + ${ptEnd} PT` : ''}). Hold tight.`);
      } else {
        parts.push(`Hold — coverage matches demand, no change needed.`);
      }
    } else {
      parts.push(`${monthName} — coverage gap (need ${requiredFTE} FTE, have ${fteEnd}). Plan retroactively if possible.`);
    }
  }
  return parts.join(' ');
}
