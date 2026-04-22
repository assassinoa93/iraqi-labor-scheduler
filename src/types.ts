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
  fixedRestDay: number; // 1=Sunday, 2=Monday, ..., 7=Saturday
  phone: string;
  hireDate: string;
  notes: string;
  eligibleStations: string[]; // IDs of stations
  holidayCredits: number; // Balance of extra off days earned (Days)
  baseMonthlySalary: number; // Fixed monthly wage
  baseHourlyRate: number; // Rate specifically for OT calculations
  overtimeHours: number; // Cumulative overtime hours for the month
}

export interface Station {
  id: string;
  name: string;
  minHC: number; // Min Headcount required per hour
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
  // New Operational Settings
  shopOpeningTime: string; // e.g. "11:00"
  shopClosingTime: string; // e.g. "23:00"
  holidays?: PublicHoliday[]; // Current month's holidays
}

export interface Violation {
  empId: string;
  day: number;
  rule: string;
  article: string;
  message: string;
}

export interface ScheduleEntry {
  shiftCode: string;
  stationId?: string;
}

export type Schedule = Record<string, Record<number, ScheduleEntry>>;
