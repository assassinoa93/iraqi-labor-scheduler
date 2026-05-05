export type EmployeeCategory = 'Standard' | 'Driver';
export type Gender = 'M' | 'F';

export interface Employee {
  empId: string;
  name: string;
  role: string;
  department: string;
  contractType: string;
  contractedWeeklyHrs: number;
  shiftEligibility: string;
  isHazardous: boolean;
  isIndustrialRotating: boolean;
  hourExempt: boolean;
  // 0 = no fixed rest day (rotating: auto-scheduler distributes rest across the week);
  // 1=Sunday, 2=Monday, ..., 7=Saturday
  fixedRestDay: number;
  phone: string;
  hireDate: string;
  notes: string;
  eligibleStations: string[]; // IDs of stations (legacy + per-station overrides)
  // v1.16: group-level eligibility. When a group ID appears here, the
  // employee is eligible for every station whose `groupId` equals it.
  // Stored as IDs so renaming a group doesn't break references. The auto-
  // scheduler unions eligibleGroups → all stations in those groups with
  // eligibleStations to compute final eligibility, so existing data works
  // as-is and groups are purely additive.
  eligibleGroups?: string[];
  holidayBank: number; // Balance of extra off days earned from working holidays (Days)
  annualLeaveBalance: number; // Regular vacations balance (Days)
  baseMonthlySalary: number; // Fixed monthly wage
  baseHourlyRate: number; // Rate specifically for OT calculations
  overtimeHours: number; // Cumulative overtime hours for the month
  // Drivers fall under the transport-worker provisions of the Iraqi Labor Law
  // (Art. 88) and follow stricter daily/weekly driving caps and continuous
  // driving limits than standard staff. Default 'Standard' for backward compat
  // with v1.1 data files.
  category?: EmployeeCategory;
  // Optional gender. When 'F' the EmployeeModal shows the maternity panel and
  // the compliance engine enforces Art. 86 (night work in industrial
  // undertakings) on industrial-flagged shifts overlapping the configured
  // night window. Missing → both behaviours skipped (backward compat).
  gender?: Gender;
  // Maternity leave (Art. 87): 14 weeks paid leave for women. Stored as a
  // [start, end] inclusive YYYY-MM-DD range. The auto-scheduler skips the
  // employee on these days; the compliance engine treats each day as a
  // protected leave (no daily/weekly checks fire). Both fields together or
  // both empty — partial values are treated as no active leave.
  maternityLeaveStart?: string;
  maternityLeaveEnd?: string;
  // Sick leave (Art. 84): paid medical leave. Same semantics as maternity —
  // [start, end] inclusive YYYY-MM-DD range, both filled or both empty. The
  // auto-scheduler stamps SL on these days and skips the employee for any
  // assignment; the compliance engine flags manual work shifts as a
  // violation against the protected-leave rule.
  sickLeaveStart?: string;
  sickLeaveEnd?: string;
  // Annual / approved vacation. Same date-range semantics. When active the
  // auto-scheduler stamps `AL` on those days; manual work shifts during the
  // window surface as a violation. The balance (annualLeaveBalance) is NOT
  // automatically debited — it remains a tracked counter only.
  annualLeaveStart?: string;
  annualLeaveEnd?: string;
  // Soft auto-scheduler preferences. The candidate-sort biases towards
  // `preferredShiftCodes` and away from `avoidShiftCodes` at strictness level
  // 1; levels 2 and 3 ignore preferences so coverage is never sacrificed.
  preferredShiftCodes?: string[];
  avoidShiftCodes?: string[];
  // Multi-range leave windows. Replaces the single-range *LeaveStart/*LeaveEnd
  // fields above (which are kept for backward-compat with pre-1.7 saves and
  // are read as fallback by getEmployeeLeaveOnDate). Each range carries its
  // own type so a single employee can have multiple non-contiguous sick
  // leaves, an annual block in summer, etc., all in the same record.
  leaveRanges?: LeaveRange[];
  // Public-holiday compensation choices. Iraqi Labor Law (Art. 74) lets the
  // supervisor pick between paying 2× for holiday work OR granting a
  // compensation day off in lieu (the worked hours then pay 1× regular,
  // matching the cost of a normal day). Each entry is a YYYY-MM-DD date
  // for which the supervisor has elected to grant a comp day instead of
  // the cash premium. Holidays NOT in this list default to the 2× cash
  // premium (Art. 74 default). The auto-scheduler's after-day pass still
  // drains `holidayBank` when an OFF day appears post-holiday — that
  // machinery is unchanged; this field is purely the "did the supervisor
  // pick comp day over double pay?" toggle that drives the IQD math.
  holidayCompensations?: string[];
}

export type LeaveType = 'annual' | 'sick' | 'maternity';

export interface LeaveRange {
  id: string;
  type: LeaveType;
  start: string; // YYYY-MM-DD inclusive
  end: string;   // YYYY-MM-DD inclusive
  notes?: string;
}

// Station groups (v1.16). Stations of the same physical/operational type
// (cashier counters, game machines, vehicles) belong to a group. Employees
// declare eligibility at the GROUP level (eligibleGroups), so a single
// "cashier" employee covers every cashier station automatically. The
// auto-scheduler still operates at station granularity — group is just
// metadata that drives eligibility expansion + workforce-planning rollup.
export interface StationGroup {
  id: string;
  name: string;
  // Optional accent colour for the kanban container in the Stations tab.
  color?: string;
  // Optional description shown above the group's station list.
  description?: string;
  // v2.2.0 — preset icon name (key into GROUP_ICON_PALETTE in
  // groupIcons.tsx). Pre-2.2.0 saves don't have it; rendering falls
  // back to the default `boxes` icon.
  icon?: string;
}

export interface Station {
  id: string;
  name: string;
  // Optional group membership. When set, employees with this group in
  // their `eligibleGroups` are automatically eligible for this station.
  // Pre-1.16 stations have `groupId` = undefined; the auto-scheduler
  // falls back to direct `eligibleStations` checks (legacy behaviour).
  groupId?: string;
  normalMinHC: number; // Min Headcount for normal days
  peakMinHC: number;   // Min Headcount for peak days
  requiredRoles?: string[]; // Roles allowed to work here
  openingTime: string; // HH:mm
  closingTime: string; // HH:mm
  color?: string;
  description?: string;
}

export interface Shift {
  code: string;
  name: string;
  start: string; // HH:mm
  end: string; // HH:mm
  durationHrs: number;
  breakMin: number;
  isIndustrial: boolean;
  isHazardous: boolean;
  isWork: boolean;
  description: string;
}

// v2.1 — Art. 74 holiday-OT model. Three modes, each reflecting a
// different interpretation / compliance posture super-admins can pick:
//   • `comp-day` (default) — practitioner reading: worker is owed EITHER
//     a compensation rest day OR the 2× cash premium, not both. The
//     auto-scheduler tries to land a CP within `holidayCompWindowDays`;
//     payroll only pays the 2× premium when no comp day landed inside
//     the window. Most cost-conservative.
//   • `cash-ot` — skip the comp rotation entirely and pay 2× cash for
//     every holiday-work hour. Useful when the team can't absorb the
//     CP shuffle without breaking coverage.
//   • `both` (v5.1.7) — strict-text reading of Art. 74: worker is owed
//     a comp rest day AND the 2× premium. Auto-scheduler still grants
//     a CP (same as `comp-day`); payroll always pays the premium (same
//     as `cash-ot`). Maximum compliance posture; most expensive option.
//
// Per-holiday overrides on PublicHoliday.compMode take precedence over
// the company-wide default.
export type HolidayCompMode = 'comp-day' | 'cash-ot' | 'both';

export interface PublicHoliday {
  // v2.2.0 — stable identity that survives a date edit. Pre-2.2.0
  // holidays were keyed by `date`, so renaming the date of an existing
  // holiday would orphan it (the editor's findIndex(h => h.date ===
  // editingDate) failed once date had changed). The migration normaliser
  // backfills `id` from `date` for legacy records, so existing entries
  // keep working under their date as a reasonable default identifier.
  // Optional in the type to keep test fixtures lightweight; the
  // normalizer + HolidayModal guarantee every persisted record has one
  // before reaching App.tsx. Library functions key off `date` and don't
  // depend on `id`.
  id?: string;
  date: string; // YYYY-MM-DD — first (or only) day of the holiday
  name: string;
  type: string;
  legalReference: string;
  isFixed?: boolean; // True for fixed-Gregorian holidays; false for lunar/movable
  // v2.6.0 — set on synthetic projected records produced by
  // `projectHolidaysToYear`. True means the date is a same-month/day
  // approximation of a movable holiday (Hijri-determined dates drift
  // ~11 days per Gregorian year). The Workforce Planning forecast
  // surfaces an "approximate" badge so the supervisor knows which
  // numbers are guaranteed exact and which are best-effort.
  isApproximation?: boolean;
  // Optional per-holiday override of the global Art. 74 mode. When unset,
  // the holiday inherits `config.holidayCompMode`. Use this to flip a
  // single holiday to 'cash-ot' when the team can't absorb the comp-day
  // rotation (e.g. a holiday inside a peak week with no spare HC).
  compMode?: HolidayCompMode;
  // v2.5.0 — multi-day holidays. Eid Al-Fitr / Eid Al-Adha typically
  // span 2-3 days; pre-2.5 the user had to add three separate holiday
  // records to model that. This field is the LENGTH of the holiday in
  // days starting at `date` (inclusive). Default 1 (single-day) when
  // missing — the migration normalizer backfills it explicitly. The
  // `expandHolidayDates()` helper in `lib/holidays.ts` materialises the
  // multi-day holiday into one synthetic entry per covered date, so
  // existing date-matching code (`h.date === dateStr`) continues to
  // work after the entry point swaps to expanded list.
  durationDays?: number;
}

// Optional per-day-of-week opening/closing override. Days are 1=Sun..7=Sat to
// match the rest of the app's day-of-week convention.
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type OperatingHoursByDow = Partial<Record<DayOfWeek, { open: string; close: string }>>;

export interface Config {
  company: string;
  year: number;
  month: number;
  daysInMonth: number;
  weekendPolicy: string;
  weeklyRestDayPrimary: number;
  weeklyRestDaySecondary?: number;
  continuousShiftsMode: 'ON' | 'OFF';
  coverageMin: number;
  maxConsecWorkDays: number;
  // Iraqi Labor Law Constants
  standardDailyHrsCap: number; // Art. 67
  hazardousDailyHrsCap: number; // Art. 68
  standardWeeklyHrsCap: number; // Art. 70
  hazardousWeeklyHrsCap: number; // Art. 70
  minRestBetweenShiftsHrs: number; // Art. 71
  // Driver-specific caps (Art. 88 + transport-worker regulations).
  // Optional for backward compat — readers should fall back to defaults.
  driverDailyHrsCap?: number;        // Daily on-duty cap (default 9)
  driverWeeklyHrsCap?: number;       // Weekly on-duty cap (default 56)
  driverContinuousDrivingHrsCap?: number; // Max continuous duty before mandatory break (default 4.5)
  driverMinDailyRestHrs?: number;    // Min rest between two duty days (default 11)
  driverMaxConsecWorkDays?: number;  // Max consecutive driving days (default 6)
  // New Operational Settings
  shopOpeningTime: string; // e.g. "11:00"
  shopClosingTime: string; // e.g. "23:00"
  // Optional override per day of the week. Falls back to shopOpeningTime /
  // shopClosingTime when an entry is missing. Used by the dashboard heatmap
  // and coverage % metrics so peak-day stretches can have longer hours than
  // the default. Stations still keep their own per-station opening hours.
  operatingHoursByDayOfWeek?: OperatingHoursByDow;
  peakDays: number[]; // e.g. [5, 6, 7] for Thu, Fri, Sat (1=Sun)
  holidays?: PublicHoliday[]; // Current month's holidays
  // Labor Law Multipliers
  otRateDay: number; // e.g. 1.5
  otRateNight: number; // e.g. 2.0
  // Ramadan reduced-hours mode. When the current day falls between
  // [ramadanStart, ramadanEnd] inclusive, the daily cap is replaced by
  // `ramadanDailyHrsCap` (typically 6 instead of 8). The fields are optional
  // for backward-compat with pre-1.5 data files; if either date is missing,
  // Ramadan mode is treated as off.
  ramadanStart?: string;          // YYYY-MM-DD
  ramadanEnd?: string;            // YYYY-MM-DD
  ramadanDailyHrsCap?: number;    // Default 6
  // Art. 86 — women's night work in industrial undertakings. Disabled by
  // default to avoid surprising users; toggle in the Variables tab. When
  // enabled the compliance engine flags any shift assigned to a female
  // employee that is `isIndustrial=true` and overlaps [start, end].
  enforceArt86NightWork?: boolean;
  art86NightStart?: string; // HH:mm — default '22:00'
  art86NightEnd?: string;   // HH:mm — default '07:00'
  // v2.1 — Art. 74 holiday OT model. `comp-day` (default) tells the auto-
  // scheduler to grant a CP rest day within `holidayCompWindowDays`; the
  // payroll then treats the holiday hours as regular pay (no 2× premium).
  // `cash-ot` skips the comp rotation and pays 2× cash for holiday hours.
  // Per-holiday overrides on PublicHoliday.compMode take precedence.
  holidayCompMode?: HolidayCompMode;
  // Maximum allowed delay between a PH-work day and the comp rest day, in
  // days. Default 30 (one month). The compliance engine flags the comp
  // day "owed" if no CP/OFF/leave appears in this window after the PH-work
  // day. The recommended threshold (7) is a softer bar — comp days landed
  // beyond 7 days surface a `recommendation` info note but don't block.
  holidayCompWindowDays?: number;
  holidayCompRecommendedDays?: number; // Default 7
  // v5.12.0 — when true (default), holidays whose comp window expires
  // without a CP landing roll the unspent comp credit into the
  // employee's holidayBank for redemption in subsequent months instead
  // of falling back to the 2× cash premium. Closer to how the practice
  // actually works in Iraqi shops where the supervisor wants to defer
  // comp redemption rather than write a OT cheque.
  // When false: legacy behaviour — premium owed if window expires
  // (right call when closing the business or finalising a payroll
  // cycle where deferred comp can't be honoured).
  carryForwardUnspentCompDays?: boolean;
}

// Severity tiers for compliance findings:
//   - 'violation' (default): hard rule breach. Counts toward the dashboard
//     violation KPI and the compliance score. Filtered into the violations
//     table in red.
//   - 'info': a noted-for-the-supervisor event that is NOT a rule breach
//     (e.g. worked a public holiday — that's compensable, not illegal).
//     Surfaces in the report as a separate "Notes" section, doesn't lower
//     compliance score, doesn't count as a violation in any KPI.
export type ViolationSeverity = 'violation' | 'info';

export interface Violation {
  empId: string;
  day: number;
  rule: string;
  article: string;
  message: string;
  count?: number;
  severity?: ViolationSeverity;
}

export interface ScheduleEntry {
  shiftCode: string;
  stationId?: string;
}

export type Schedule = Record<string, Record<number, ScheduleEntry>>;

// Lightweight company / branch identifier. Each company owns its own roster,
// shifts, stations, holidays, config, and schedules. The `audit.json` log is
// shared across companies but every entry carries a companyId so callers can
// filter.
export interface Company {
  id: string;
  name: string;
  color?: string;
}

// In-memory shape of a single company's full data. The persisted shape on
// disk uses one Record<companyId, …> file per domain (employees.json,
// shifts.json, etc.) for incremental atomic writes.
export interface CompanyData {
  employees: Employee[];
  shifts: Shift[];
  holidays: PublicHoliday[];
  stations: Station[];
  // v1.16: optional list of station groups (kanban categories). Pre-1.16
  // companies don't have any; everything just keeps working at station
  // granularity. Defining groups unlocks group-level employee eligibility
  // and the cleaner workforce-planning rollup.
  stationGroups?: StationGroup[];
  config: Config;
  allSchedules: Record<string, Schedule>;
}
