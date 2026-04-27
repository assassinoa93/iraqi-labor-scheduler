import { getDaysInMonth } from 'date-fns';
import { Employee, Shift, Station, PublicHoliday, Config } from '../types';
import { baseHourlyRate } from './payroll';

// Synthetic seed config used to pre-compute the hourly rate for the demo
// employees below. Real users get their config from `DEFAULT_CONFIG` (which
// matches this exactly) — keeping it inline avoids a forward reference.
const SEED_WEEKLY_CAP = 48;

export const INITIAL_SHIFTS: Shift[] = [
  { code: 'FS', name: 'Full Shift', start: '11:00', end: '19:00', durationHrs: 7.5, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: 'Standard day shift' },
  { code: 'MX', name: 'Mixed Shift', start: '15:00', end: '23:00', durationHrs: 7.5, breakMin: 30, isIndustrial: false, isHazardous: false, isWork: true, description: 'Evening operation shift' },
  { code: 'P1', name: 'Part-Time 1', start: '11:00', end: '15:00', durationHrs: 4, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: true, description: 'Peak morning support' },
  { code: 'P2', name: 'Part-Time 2', start: '15:00', end: '19:00', durationHrs: 4, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: true, description: 'Mid-day transition support' },
  { code: 'P3', name: 'Part-Time 3', start: '19:00', end: '23:00', durationHrs: 4, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: true, description: 'Closing peak support' },
  { code: 'OFF', name: 'Day Off', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Regular weekly rest' },
  { code: 'AL', name: 'Annual Leave', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Approved vacation' },
  { code: 'SL', name: 'Sick Leave', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Medical leave' },
  { code: 'PH', name: 'Public Holiday', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'National holiday' },
  // Maternity leave (Art. 87) — 14 weeks paid leave for women. The auto-
  // scheduler stamps this code on every day in the configured range.
  { code: 'MAT', name: 'Maternity Leave', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Protected maternity leave (Art. 87)' },
];

export const INITIAL_EMPLOYEES: Employee[] = [
  ...Array.from({ length: 35 }, (_, i) => ({
    empId: `EMP-${1000 + i}`,
    name: `Operator ${i + 1}`,
    role: 'Machine Operator',
    department: 'Games',
    contractType: 'Permanent',
    contractedWeeklyHrs: 48,
    shiftEligibility: 'All',
    isHazardous: false,
    isIndustrialRotating: false,
    hourExempt: false,
    fixedRestDay: 0,
    phone: `+964-770-000-${i.toString().padStart(4, '0')}`,
    hireDate: '2022-01-01',
    notes: '',
    eligibleStations: ['ST-M1', 'ST-M2', 'ST-M3', 'ST-M4', 'ST-M5', 'ST-M6', 'ST-M7', 'ST-M8', 'ST-M9', 'ST-M10'],
    holidayBank: 0,
    annualLeaveBalance: 21,
    baseMonthlySalary: 1200000,
    baseHourlyRate: Math.round(baseHourlyRate({ baseMonthlySalary: 1200000, contractedWeeklyHrs: 48 }, { standardWeeklyHrsCap: SEED_WEEKLY_CAP })),
    overtimeHours: 0,
    category: 'Standard' as const
  })),
  ...Array.from({ length: 12 }, (_, i) => ({
    empId: `EMP-${2000 + i}`,
    name: `Cashier ${i + 1}`,
    role: 'Cashier',
    department: 'Cash',
    contractType: 'Permanent',
    contractedWeeklyHrs: 48,
    shiftEligibility: 'All',
    isHazardous: false,
    isIndustrialRotating: false,
    hourExempt: false,
    fixedRestDay: 0,
    phone: `+964-770-000-${(i + 40).toString().padStart(4, '0')}`,
    hireDate: '2022-01-01',
    notes: '',
    eligibleStations: ['ST-C1', 'ST-C2', 'ST-C3', 'ST-C4'],
    holidayBank: 0,
    annualLeaveBalance: 21,
    baseMonthlySalary: 1000000,
    baseHourlyRate: Math.round(baseHourlyRate({ baseMonthlySalary: 1000000, contractedWeeklyHrs: 48 }, { standardWeeklyHrsCap: SEED_WEEKLY_CAP })),
    overtimeHours: 0,
    category: 'Standard' as const
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    empId: `EMP-${3000 + i}`,
    name: `Driver ${i + 1}`,
    role: 'Driver',
    department: 'Transport',
    contractType: 'Permanent',
    contractedWeeklyHrs: 56,
    shiftEligibility: 'All',
    isHazardous: false,
    isIndustrialRotating: false,
    hourExempt: false,
    fixedRestDay: 0,
    phone: `+964-770-000-${(i + 60).toString().padStart(4, '0')}`,
    hireDate: '2023-06-01',
    notes: 'Transport / driver — Art. 88',
    eligibleStations: [],
    holidayBank: 0,
    annualLeaveBalance: 21,
    baseMonthlySalary: 1400000,
    baseHourlyRate: Math.round(baseHourlyRate({ baseMonthlySalary: 1400000, contractedWeeklyHrs: 56 }, { standardWeeklyHrsCap: SEED_WEEKLY_CAP })),
    overtimeHours: 0,
    category: 'Driver' as const
  }))
];

export const INITIAL_STATIONS: Station[] = [
  { id: 'ST-C1', name: 'Cashier Point 1', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#7c3aed', description: 'Payment processing 1' },
  { id: 'ST-C2', name: 'Cashier Point 2', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#8b5cf6', description: 'Payment processing 2' },
  { id: 'ST-C3', name: 'Cashier Point 3', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#a78bfa', description: 'Payment processing 3' },
  { id: 'ST-C4', name: 'Cashier Point 4', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#c4b5fd', description: 'Payment processing 4' },
  { id: 'ST-M1', name: 'Ice Hockey', normalMinHC: 1, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#2563eb', description: 'Air hockey station' },
  { id: 'ST-M2', name: 'Arcade Zone', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#059669', description: 'Video games area' },
  { id: 'ST-M3', name: 'Giant Slide', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#10b981', description: 'Inflatable slide' },
  { id: 'ST-M4', name: 'Bumping Cars', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#d97706', description: 'Safe collision cars' },
  { id: 'ST-M5', name: 'Carousel', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#ea580c', description: 'Merry-go-round' },
  { id: 'ST-M6', name: 'VR Simulator', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#0891b2', description: 'Virtual reality pods' },
  { id: 'ST-M7', name: 'Bowling Alley', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#475569', description: 'Family bowling lanes' },
  { id: 'ST-M8', name: 'Trampoline Park', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#db2777', description: 'Active jumping area' },
  { id: 'ST-M9', name: 'Mini-Train', normalMinHC: 1, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#dc2626', description: 'Mall tour train' },
  { id: 'ST-M10', name: 'Claw Machine', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#f59e0b', description: 'Prize pickers' },
  // Vehicle / driver assets — gated to category=Driver via requiredRoles. Operating
  // times define when each vehicle needs a driver assigned by the auto-scheduler.
  { id: 'ST-V1', name: 'Delivery Van A', normalMinHC: 1, peakMinHC: 1, requiredRoles: ['Driver'], openingTime: '08:00', closingTime: '17:00', color: '#0f766e', description: 'Daytime parts and supply runs' },
  { id: 'ST-V2', name: 'Delivery Van B', normalMinHC: 0, peakMinHC: 1, requiredRoles: ['Driver'], openingTime: '14:00', closingTime: '22:00', color: '#0e7490', description: 'Afternoon / evening logistics' },
  { id: 'ST-V3', name: 'Mall Shuttle', normalMinHC: 1, peakMinHC: 1, requiredRoles: ['Driver'], openingTime: '10:00', closingTime: '23:00', color: '#1d4ed8', description: 'Customer shuttle (full operating window)' },
  { id: 'ST-V4', name: 'Service Pickup', normalMinHC: 0, peakMinHC: 1, requiredRoles: ['Driver'], openingTime: '06:00', closingTime: '12:00', color: '#92400e', description: 'Early-morning supply pickup' },
];

// Iraqi public holidays for the current planning year. Religious holidays are
// estimates and should be edited when the official lunar dates are announced.
// All carry the same Art. 74 reference because that's the article that grants
// double-pay or compensatory rest for work on a public holiday.
export const INITIAL_HOLIDAYS: PublicHoliday[] = [
  { date: '2026-01-01', name: 'New Year Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { date: '2026-01-06', name: 'Army Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { date: '2026-03-20', name: 'Eid al-Fitr (Estimated)', type: 'Religious', legalReference: 'Art. 74', isFixed: false },
  { date: '2026-03-21', name: 'Nowruz', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { date: '2026-03-22', name: 'Eid al-Fitr Holiday', type: 'Religious', legalReference: 'Art. 74', isFixed: false },
  { date: '2026-05-01', name: 'Labor Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { date: '2026-05-27', name: 'Eid al-Adha (Estimated)', type: 'Religious', legalReference: 'Art. 74', isFixed: false },
  { date: '2026-05-28', name: 'Eid al-Adha Holiday', type: 'Religious', legalReference: 'Art. 74', isFixed: false },
  { date: '2026-06-16', name: 'Islamic New Year', type: 'Religious', legalReference: 'Art. 74', isFixed: false },
  { date: '2026-06-25', name: 'Ashura', type: 'Religious', legalReference: 'Art. 74', isFixed: false },
  { date: '2026-07-14', name: 'Republic Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { date: '2026-08-25', name: 'Mawlid al-Nabi', type: 'Religious', legalReference: 'Art. 74', isFixed: false },
  { date: '2026-10-03', name: 'Independence Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { date: '2026-12-10', name: 'Victory Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { date: '2026-12-25', name: 'Christmas Day', type: 'Religious', legalReference: 'Art. 74', isFixed: true },
];

export const DEFAULT_CONFIG: Config = {
  company: 'Workforce Unit',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  daysInMonth: getDaysInMonth(new Date()),
  weekendPolicy: 'Friday Only',
  weeklyRestDayPrimary: 6,
  continuousShiftsMode: 'OFF',
  coverageMin: 5,
  maxConsecWorkDays: 6,
  standardDailyHrsCap: 8,
  hazardousDailyHrsCap: 7,
  standardWeeklyHrsCap: 48,
  hazardousWeeklyHrsCap: 36,
  minRestBetweenShiftsHrs: 11,
  driverDailyHrsCap: 9,
  driverWeeklyHrsCap: 56,
  driverContinuousDrivingHrsCap: 4.5,
  driverMinDailyRestHrs: 11,
  driverMaxConsecWorkDays: 6,
  shopOpeningTime: '11:00',
  shopClosingTime: '23:00',
  peakDays: [5, 6, 7],
  holidays: [],
  otRateDay: 1.5,
  otRateNight: 2.0,
  // Ramadan reduced-hours window. Empty by default; set the dates in the
  // Variables tab to activate. 6h follows the customary practice; the user
  // can override via the same tab if their sector permits a different cap.
  ramadanStart: '',
  ramadanEnd: '',
  ramadanDailyHrsCap: 6,
};
