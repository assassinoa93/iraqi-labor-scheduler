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
}

export interface Violation {
  empId: string;
  day: number;
  rule: string;
  article: string;
  message: string;
}

export type Schedule = Record<string, Record<number, string>>;
