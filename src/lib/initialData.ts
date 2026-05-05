import { getDaysInMonth } from 'date-fns';
import { Employee, Shift, Station, StationGroup, PublicHoliday, Config, Company } from '../types';
import { baseHourlyRate } from './payroll';
import { DEFAULT_FINE_RATES } from './fines';

// Default company id — kept stable across versions so legacy single-company
// backups and on-disk migrations land in the same slot. Mirrored on the
// server (server.ts).
export const DEFAULT_COMPANY_ID = 'co-default';

// Initial companies list seeded on first launch. Single entry — users can
// add more via the company switcher in the sidebar.
export const INITIAL_COMPANIES: Company[] = [
  { id: DEFAULT_COMPANY_ID, name: 'Workforce Unit', color: '#2563eb' },
];

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
  // v2.1 — Compensation rest day (Art. 74). Distinct from OFF so the
  // user can see at a glance which non-work days the auto-scheduler
  // granted as comp days for prior public-holiday work. Payroll treats
  // CP as non-work (no daily wage burn beyond the regular monthly
  // salary), and the compliance engine recognises CP as satisfying the
  // comp-day-owed check after a PH-work day.
  { code: 'CP', name: 'Compensation', start: '00:00', end: '00:00', durationHrs: 0, breakMin: 0, isIndustrial: false, isHazardous: false, isWork: false, description: 'Comp rest day for prior PH work (Art. 74)' },
];

// Vehicle stations the seeded drivers are eligible for. Drivers are still
// gated by `requiredRoles: ['Driver']` on the station itself (so non-driver
// staff can't land here), but listing the vehicles in `eligibleStations`
// makes the assignment visible in the EmployeeModal and the Roster tab —
// previously drivers showed "Unassigned" even though the auto-scheduler was
// happily routing them to vehicles.
const VEHICLE_STATION_IDS = ['ST-V1', 'ST-V2', 'ST-V3', 'ST-V4'];
const CASHIER_STATION_IDS = ['ST-C1', 'ST-C2', 'ST-C3', 'ST-C4'];
const MACHINE_STATION_IDS = ['ST-M1', 'ST-M2', 'ST-M3', 'ST-M4', 'ST-M5', 'ST-M6', 'ST-M7', 'ST-M8', 'ST-M9', 'ST-M10'];

// v2.0.0 — sample station groups. These mirror the typical venue layout
// (cashier counters, ride/game machines, vehicles) and let new installs
// land with a sensible kanban setup so the supervisor can see how groups
// + station-level eligibility work without hand-rolling them.
export const GROUP_CASHIERS = 'grp-cashiers';
export const GROUP_MACHINES = 'grp-machines';
export const GROUP_VEHICLES = 'grp-vehicles';
export const INITIAL_STATION_GROUPS: StationGroup[] = [
  { id: GROUP_CASHIERS, name: 'Cashier Counters', color: '#7c3aed', description: 'Front-of-house payment processing' },
  { id: GROUP_MACHINES, name: 'Game Machines', color: '#059669', description: 'Rides, machines, and play stations' },
  { id: GROUP_VEHICLES, name: 'Vehicles', color: '#0e7490', description: 'Drivers and vehicle assets' },
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
    eligibleStations: MACHINE_STATION_IDS,
    eligibleGroups: [GROUP_MACHINES],
    holidayBank: 0,
    annualLeaveBalance: 21,
    baseMonthlySalary: 1200000,
    baseHourlyRate: Math.round(baseHourlyRate({ baseMonthlySalary: 1200000, contractedWeeklyHrs: 48 }, { standardWeeklyHrsCap: SEED_WEEKLY_CAP })),
    overtimeHours: 0,
    category: 'Standard' as const,
    // Operators default to male — the seeded shifts aren't industrial so
    // Art. 86 wouldn't fire either way, but defaulting matches the realistic
    // gender split in the user's own venue (entertainment / games).
    gender: 'M' as const,
  })),
  // Cashiers: deliberately mixed-gender so Art. 86 has someone to protect
  // when the user creates an industrial-flagged shift (e.g. for a kitchen
  // or warehouse station). Alternates female / male on even / odd indices.
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
    eligibleStations: CASHIER_STATION_IDS,
    eligibleGroups: [GROUP_CASHIERS],
    holidayBank: 0,
    annualLeaveBalance: 21,
    baseMonthlySalary: 1000000,
    baseHourlyRate: Math.round(baseHourlyRate({ baseMonthlySalary: 1000000, contractedWeeklyHrs: 48 }, { standardWeeklyHrsCap: SEED_WEEKLY_CAP })),
    overtimeHours: 0,
    category: 'Standard' as const,
    gender: (i % 2 === 0 ? 'F' : 'M') as 'F' | 'M',
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
    // Make the vehicle assignment visible in the EmployeeModal /
    // RosterTab. The scheduler already routes drivers to these via the
    // station's `requiredRoles: ['Driver']`, but populating the field here
    // means each driver row shows the vehicles it can drive instead of
    // rendering as "Unassigned".
    eligibleStations: VEHICLE_STATION_IDS,
    eligibleGroups: [GROUP_VEHICLES],
    holidayBank: 0,
    annualLeaveBalance: 21,
    baseMonthlySalary: 1400000,
    baseHourlyRate: Math.round(baseHourlyRate({ baseMonthlySalary: 1400000, contractedWeeklyHrs: 56 }, { standardWeeklyHrsCap: SEED_WEEKLY_CAP })),
    overtimeHours: 0,
    category: 'Driver' as const,
    gender: 'M' as const,
  }))
];

export const INITIAL_STATIONS: Station[] = [
  // Cashier counters group — payment processing.
  { id: 'ST-C1', name: 'Cashier Point 1', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#7c3aed', description: 'Payment processing 1', groupId: GROUP_CASHIERS },
  { id: 'ST-C2', name: 'Cashier Point 2', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#8b5cf6', description: 'Payment processing 2', groupId: GROUP_CASHIERS },
  { id: 'ST-C3', name: 'Cashier Point 3', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#a78bfa', description: 'Payment processing 3', groupId: GROUP_CASHIERS },
  { id: 'ST-C4', name: 'Cashier Point 4', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#c4b5fd', description: 'Payment processing 4', groupId: GROUP_CASHIERS },
  // Game machines / rides group — operators rotate across these.
  { id: 'ST-M1', name: 'Ice Hockey', normalMinHC: 1, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#2563eb', description: 'Air hockey station', groupId: GROUP_MACHINES },
  { id: 'ST-M2', name: 'Arcade Zone', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#059669', description: 'Video games area', groupId: GROUP_MACHINES },
  { id: 'ST-M3', name: 'Giant Slide', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#10b981', description: 'Inflatable slide', groupId: GROUP_MACHINES },
  { id: 'ST-M4', name: 'Bumping Cars', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#d97706', description: 'Safe collision cars', groupId: GROUP_MACHINES },
  { id: 'ST-M5', name: 'Carousel', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#ea580c', description: 'Merry-go-round', groupId: GROUP_MACHINES },
  { id: 'ST-M6', name: 'VR Simulator', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#0891b2', description: 'Virtual reality pods', groupId: GROUP_MACHINES },
  { id: 'ST-M7', name: 'Bowling Alley', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#475569', description: 'Family bowling lanes', groupId: GROUP_MACHINES },
  { id: 'ST-M8', name: 'Trampoline Park', normalMinHC: 1, peakMinHC: 2, openingTime: '11:00', closingTime: '23:00', color: '#db2777', description: 'Active jumping area', groupId: GROUP_MACHINES },
  { id: 'ST-M9', name: 'Mini-Train', normalMinHC: 1, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#dc2626', description: 'Mall tour train', groupId: GROUP_MACHINES },
  { id: 'ST-M10', name: 'Claw Machine', normalMinHC: 0, peakMinHC: 1, openingTime: '11:00', closingTime: '23:00', color: '#f59e0b', description: 'Prize pickers', groupId: GROUP_MACHINES },
  // Vehicle / driver assets — gated to category=Driver via requiredRoles.
  // Operating times define when each vehicle needs a driver assigned.
  { id: 'ST-V1', name: 'Delivery Van A', normalMinHC: 1, peakMinHC: 1, requiredRoles: ['Driver'], openingTime: '08:00', closingTime: '17:00', color: '#0f766e', description: 'Daytime parts and supply runs', groupId: GROUP_VEHICLES },
  { id: 'ST-V2', name: 'Delivery Van B', normalMinHC: 0, peakMinHC: 1, requiredRoles: ['Driver'], openingTime: '14:00', closingTime: '22:00', color: '#0e7490', description: 'Afternoon / evening logistics', groupId: GROUP_VEHICLES },
  { id: 'ST-V3', name: 'Mall Shuttle', normalMinHC: 1, peakMinHC: 1, requiredRoles: ['Driver'], openingTime: '10:00', closingTime: '23:00', color: '#1d4ed8', description: 'Customer shuttle (full operating window)', groupId: GROUP_VEHICLES },
  { id: 'ST-V4', name: 'Service Pickup', normalMinHC: 0, peakMinHC: 1, requiredRoles: ['Driver'], openingTime: '06:00', closingTime: '12:00', color: '#92400e', description: 'Early-morning supply pickup', groupId: GROUP_VEHICLES },
];

// Iraqi public holidays for the current planning year. Religious holidays are
// estimates and should be edited when the official lunar dates are announced.
// All carry the same Art. 74 reference because that's the article that grants
// double-pay or compensatory rest for work on a public holiday.
// v2.2.0 — seed entries now carry stable ids matching their date so
// post-2.2.0 backups generated from a fresh seed look identical to
// pre-2.2.0 data after the migration normalizer's date→id backfill.
export const INITIAL_HOLIDAYS: PublicHoliday[] = [
  { id: '2026-01-01', date: '2026-01-01', name: 'New Year Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { id: '2026-01-06', date: '2026-01-06', name: 'Army Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  // Eid al-Fitr — typically a 3-day Iraqi public holiday. Modeled as one
  // entry with durationDays=3 instead of three separate single-day entries
  // so the HolidayModal lets the user shift the whole window when the
  // moon-sighted start date moves between Gregorian years.
  { id: '2026-03-20', date: '2026-03-20', name: 'Eid al-Fitr', type: 'Religious', legalReference: 'Art. 74', isFixed: false, durationDays: 3 },
  { id: '2026-03-21', date: '2026-03-21', name: 'Nowruz', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { id: '2026-05-01', date: '2026-05-01', name: 'Labor Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  // Eid al-Adha — typically a 4-day Iraqi public holiday (Eid + 3 days of
  // Tashriq). Same single-entry-with-durationDays model as Eid al-Fitr.
  { id: '2026-05-27', date: '2026-05-27', name: 'Eid al-Adha', type: 'Religious', legalReference: 'Art. 74', isFixed: false, durationDays: 4 },
  { id: '2026-06-16', date: '2026-06-16', name: 'Islamic New Year', type: 'Religious', legalReference: 'Art. 74', isFixed: false },
  { id: '2026-06-25', date: '2026-06-25', name: 'Ashura', type: 'Religious', legalReference: 'Art. 74', isFixed: false },
  { id: '2026-07-14', date: '2026-07-14', name: 'Republic Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { id: '2026-08-25', date: '2026-08-25', name: 'Mawlid al-Nabi', type: 'Religious', legalReference: 'Art. 74', isFixed: false },
  { id: '2026-10-03', date: '2026-10-03', name: 'Independence Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { id: '2026-12-10', date: '2026-12-10', name: 'Victory Day', type: 'National', legalReference: 'Art. 74', isFixed: true },
  { id: '2026-12-25', date: '2026-12-25', name: 'Christmas Day', type: 'Religious', legalReference: 'Art. 74', isFixed: true },
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
  // Art. 86 — women's night work in industrial undertakings. Enabled by
  // default with the standard 22:00–07:00 window so the rule fires the
  // moment a user creates an industrial-flagged shift (existing seed shifts
  // are non-industrial so the rule has no effect on them today). Toggle
  // off in Variables if your sector falls under a Ministerial exemption.
  enforceArt86NightWork: true,
  art86NightStart: '22:00',
  art86NightEnd: '07:00',
  // v2.1 Art. 74 model. Default to comp-day rotation with a 30-day max
  // window (1 month) and a 7-day recommended threshold. The auto-
  // scheduler aims to land the CP within the recommended window; the
  // compliance engine accepts up to the max before flagging "owed".
  holidayCompMode: 'comp-day',
  holidayCompWindowDays: 30,
  holidayCompRecommendedDays: 7,
  // v5.17.0 — Fine rates per rule (IQD per occurrence). Defaults are
  // mid-range placeholders aligned with the Iraqi Labor Law 37/2015
  // penalty framework (typically 250,000–1,000,000 IQD per violation
  // depending on severity). The user refines these in the Variables
  // tab to match their establishment's amounts. Spread the centralised
  // map so adding new rule types in fines.ts auto-flows into the seed
  // without a parallel edit here.
  fineRates: { ...DEFAULT_FINE_RATES },
};
