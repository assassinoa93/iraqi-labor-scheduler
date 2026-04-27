export type EmployeeCategory = 'Standard' | 'Driver';

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
  eligibleStations: string[]; // IDs of stations
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
}

export interface Station {
  id: string;
  name: string;
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

export interface PublicHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  type: string;
  legalReference: string;
  isFixed?: boolean; // True for fixed-Gregorian holidays; false for lunar/movable
}

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
}

export interface Violation {
  empId: string;
  day: number;
  rule: string;
  article: string;
  message: string;
  count?: number;
}

export interface ScheduleEntry {
  shiftCode: string;
  stationId?: string;
}

export type Schedule = Record<string, Record<number, ScheduleEntry>>;
