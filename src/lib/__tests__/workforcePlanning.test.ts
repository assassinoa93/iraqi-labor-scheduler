import { describe, it, expect } from 'vitest';
import { analyzeWorkforce, analyzeWorkforceAnnual, buildAnnualRollup, PART_TIME_MONTHLY_HOURS } from '../workforcePlanning';
import { Employee, Shift, Station, PublicHoliday, Config } from '../../types';

const config: Config = {
  company: 'Test', year: 2026, month: 1, daysInMonth: 31,
  weekendPolicy: 'Friday Only', weeklyRestDayPrimary: 6,
  continuousShiftsMode: 'OFF', coverageMin: 1, maxConsecWorkDays: 6,
  standardDailyHrsCap: 8, hazardousDailyHrsCap: 7,
  standardWeeklyHrsCap: 48, hazardousWeeklyHrsCap: 36,
  minRestBetweenShiftsHrs: 11, shopOpeningTime: '11:00', shopClosingTime: '23:00',
  peakDays: [5, 6, 7], holidays: [], otRateDay: 1.5, otRateNight: 2.0,
};

// peakDays = [5, 6, 7] in our 1=Sun..7=Sat convention → Thu, Fri, Sat.
// In Jan 2026 (Thu start): peak days are days 1,2,3,8,9,10,15,16,17,22,23,24,29,30,31 = 15 peak days, 16 non-peak.
const isPeakDay = (day: number) => {
  const dow = new Date(2026, 0, day).getDay() + 1;
  return [5, 6, 7].includes(dow);
};

const mkEmp = (id: string, role: string = 'Standard', category: 'Standard' | 'Driver' = 'Standard'): Employee => ({
  empId: id, name: id, role, department: 'Ops',
  contractType: 'Permanent', contractedWeeklyHrs: 48, shiftEligibility: 'All',
  isHazardous: false, isIndustrialRotating: false, hourExempt: false,
  fixedRestDay: 6, phone: '', hireDate: '2024-01-01', notes: '',
  eligibleStations: [], holidayBank: 0, annualLeaveBalance: 21,
  baseMonthlySalary: 1_500_000, baseHourlyRate: 7_812,
  overtimeHours: 0, category,
});

describe('analyzeWorkforce — empty / degenerate', () => {
  it('returns zeros when no stations exist', () => {
    const plan = analyzeWorkforce({
      employees: [], shifts: [], stations: [], holidays: [], config, isPeakDay,
    });
    expect(plan.totalIdealFTE).toBe(0);
    expect(plan.totalRecommendedFTE).toBe(0);
    expect(plan.byRole).toHaveLength(0);
  });

  it('emits zero-demand role rows for current employees with no station match', () => {
    // Roster has 2 cashiers but no stations need cashiers. v1.14: action
    // is 'hold' (never 'release') because Iraqi Labor Law makes releases
    // hard. Delta still shows the negative gap so HR can plan around it.
    const plan = analyzeWorkforce({
      employees: [mkEmp('A', 'Cashier'), mkEmp('B', 'Cashier')],
      shifts: [], stations: [], holidays: [], config, isPeakDay,
    });
    const cashierRow = plan.byRole.find(r => r.role === 'Cashier');
    expect(cashierRow).toBeDefined();
    expect(cashierRow?.action).toBe('hold');
    expect(cashierRow?.delta).toBe(-2);
  });
});

describe('analyzeWorkforce — flat demand → all FTE', () => {
  // Single station that needs 1 person every day, 12h open window.
  const flatStation: Station = {
    id: 'ST-A', name: 'Counter', normalMinHC: 1, peakMinHC: 1,
    openingTime: '11:00', closingTime: '23:00',
  };

  it('recommends FTE-only when peak and non-peak demand are equal', () => {
    const plan = analyzeWorkforce({
      employees: [], shifts: [], stations: [flatStation], holidays: [], config, isPeakDay,
    });
    const role = plan.byRole.find(r => r.role === 'Standard');
    expect(role).toBeDefined();
    expect(role?.recommendedPartTime).toBe(0);
    expect(role?.recommendedFTE).toBeGreaterThan(0);
    // 31 days × 12h = 372h. With 192h cap → 2 FTE.
    expect(role?.recommendedFTE).toBe(2);
  });

  it('flags hire when current roster is below the recommendation', () => {
    const plan = analyzeWorkforce({
      employees: [mkEmp('A')], shifts: [], stations: [flatStation], holidays: [], config, isPeakDay,
    });
    const role = plan.byRole.find(r => r.role === 'Standard');
    expect(role?.action).toBe('hire');
    expect(role?.delta).toBeGreaterThan(0);
  });

  it('flags hold (not release) when current roster exceeds the recommendation', () => {
    // v1.14: never recommends release. Surplus shows as hold + negative delta.
    const plan = analyzeWorkforce({
      employees: Array.from({ length: 5 }, (_, i) => mkEmp(`E${i}`)),
      shifts: [], stations: [flatStation], holidays: [], config, isPeakDay,
    });
    const role = plan.byRole.find(r => r.role === 'Standard');
    expect(role?.action).toBe('hold');
    expect(role?.delta).toBeLessThan(0);
  });
});

describe('analyzeWorkforce — peak-heavy demand (mode=optimal)', () => {
  // Station that needs 2 on peak days only. Non-peak needs nobody.
  const peakOnlyStation: Station = {
    id: 'ST-B', name: 'Surge Booth', normalMinHC: 0, peakMinHC: 2,
    openingTime: '11:00', closingTime: '23:00',
  };

  it('switches to part-time-only when demand only exists on peak days (optimal mode)', () => {
    const plan = analyzeWorkforce({
      employees: [], shifts: [], stations: [peakOnlyStation], holidays: [], config, isPeakDay,
      mode: 'optimal',
    });
    const role = plan.byRole.find(r => r.role === 'Standard');
    expect(role).toBeDefined();
    expect(role?.recommendedFTE).toBe(0);
    expect(role?.recommendedPartTime).toBeGreaterThan(0);
  });

  it('uses part-timers when peak lift exceeds the threshold (optimal mode)', () => {
    const liftedStation: Station = {
      id: 'ST-C', name: 'Lift', normalMinHC: 1, peakMinHC: 2,
      openingTime: '11:00', closingTime: '23:00',
    };
    const plan = analyzeWorkforce({
      employees: [], shifts: [], stations: [liftedStation], holidays: [], config, isPeakDay,
      mode: 'optimal',
    });
    const role = plan.byRole.find(r => r.role === 'Standard');
    expect(role?.recommendedPartTime).toBeGreaterThan(0);
  });

  it('conservative mode never uses part-timers, even when peak lift would justify it', () => {
    // Same scenario as above; conservative refuses PT and recommends FTE only.
    const liftedStation: Station = {
      id: 'ST-C', name: 'Lift', normalMinHC: 1, peakMinHC: 2,
      openingTime: '11:00', closingTime: '23:00',
    };
    const plan = analyzeWorkforce({
      employees: [], shifts: [], stations: [liftedStation], holidays: [], config, isPeakDay,
      mode: 'conservative',
    });
    const role = plan.byRole.find(r => r.role === 'Standard');
    expect(role?.recommendedPartTime).toBe(0);
    expect(role?.recommendedFTE).toBeGreaterThan(0);
  });
});

describe('buildAnnualRollup', () => {
  const station: Station = {
    id: 'ST-A', name: 'Counter', normalMinHC: 1, peakMinHC: 1,
    openingTime: '11:00', closingTime: '23:00',
  };
  const isPeakDayFor = (cfg: Config) => (day: number) => {
    const dow = new Date(cfg.year, cfg.month - 1, day).getDay() + 1;
    return [5, 6, 7].includes(dow);
  };

  it('rolls up to one row per role with peak-month-driven recommendation in conservative mode', () => {
    const annual = analyzeWorkforceAnnual({
      employees: [], shifts: [], stations: [station], holidays: [], baseConfig: config, isPeakDayFor,
      mode: 'conservative',
    });
    const rollup = buildAnnualRollup(annual, [], 'conservative');
    expect(rollup.byRole.length).toBeGreaterThan(0);
    const role = rollup.byRole[0];
    expect(role.recommendedPartTime).toBe(0); // conservative never uses PT
    // Recommended FTE = peak-month FTE need (the max across the year)
    expect(role.recommendedFTE).toBe(role.peakMonthFTE);
  });

  it('reports a non-zero legal-safety premium when conservative > optimal', () => {
    // Station with peak surge → optimal would use PT, conservative carries
    // peak FTE through valleys → the cost diff is the legal-safety premium.
    const surgeStation: Station = {
      id: 'ST-S', name: 'Surge', normalMinHC: 1, peakMinHC: 3,
      openingTime: '11:00', closingTime: '23:00',
    };
    const annual = analyzeWorkforceAnnual({
      employees: [], shifts: [], stations: [surgeStation], holidays: [], baseConfig: config, isPeakDayFor,
      mode: 'conservative',
    });
    const rollup = buildAnnualRollup(annual, [], 'conservative');
    expect(rollup.legalSafetyPremium).toBeGreaterThan(0);
  });

  it('never recommends release — surplus surfaces as hold action with negative delta', () => {
    const annual = analyzeWorkforceAnnual({
      employees: Array.from({ length: 10 }, (_, i) => mkEmp(`E${i}`)),
      shifts: [], stations: [station], holidays: [], baseConfig: config, isPeakDayFor,
      mode: 'conservative',
    });
    const rollup = buildAnnualRollup(annual, Array.from({ length: 10 }, (_, i) => mkEmp(`E${i}`)), 'conservative');
    expect(rollup.byRole.every(r => r.action !== 'hire' || r.delta > 0)).toBe(true);
    expect(rollup.byRole.some(r => r.delta < 0)).toBe(true);
    // Every negative-delta role uses hold, never release.
    rollup.byRole.filter(r => r.delta < 0).forEach(r => expect(r.action).toBe('hold'));
  });
});

describe('analyzeWorkforce — driver caps follow Art. 88', () => {
  const driverStation: Station = {
    id: 'ST-V1', name: 'Van', normalMinHC: 1, peakMinHC: 1,
    openingTime: '08:00', closingTime: '20:00', requiredRoles: ['Driver'],
  };

  it('uses driverWeeklyHrsCap × 4 (default 224h) for driver FTE math', () => {
    const plan = analyzeWorkforce({
      employees: [], shifts: [], stations: [driverStation], holidays: [], config, isPeakDay,
    });
    const role = plan.byRole.find(r => r.role === 'Driver');
    expect(role).toBeDefined();
    expect(role?.cap).toBe(56 * 4); // 224
    // 31 days × 12h = 372h / 224h = ceil(1.66) = 2 FTE
    expect(role?.idealFTE).toBe(2);
  });

  it('separates driver demand from standard demand when stations are mixed', () => {
    const cashier: Station = {
      id: 'ST-C1', name: 'Counter', normalMinHC: 1, peakMinHC: 1,
      openingTime: '11:00', closingTime: '23:00',
    };
    const plan = analyzeWorkforce({
      employees: [], shifts: [], stations: [driverStation, cashier], holidays: [], config, isPeakDay,
    });
    const driverRole = plan.byRole.find(r => r.role === 'Driver');
    const stdRole = plan.byRole.find(r => r.role === 'Standard');
    expect(driverRole?.idealFTE).toBeGreaterThan(0);
    expect(stdRole?.idealFTE).toBeGreaterThan(0);
  });
});

describe('analyzeWorkforce — payroll delta', () => {
  it('reports negative monthlyDelta when the recommendation has fewer FTE', () => {
    const station: Station = {
      id: 'ST-A', name: 'Counter', normalMinHC: 1, peakMinHC: 1,
      openingTime: '11:00', closingTime: '23:00',
    };
    // 5 employees but only 2 FTE actually needed → release saves money.
    const plan = analyzeWorkforce({
      employees: Array.from({ length: 5 }, (_, i) => mkEmp(`E${i}`)),
      shifts: [], stations: [station], holidays: [], config, isPeakDay,
    });
    expect(plan.monthlyDelta).toBeLessThan(0);
  });

  it('exposes the part-time monthly hours constant for the UI', () => {
    expect(PART_TIME_MONTHLY_HOURS).toBe(96);
  });
});

describe('analyzeWorkforceAnnual', () => {
  const station: Station = {
    id: 'ST-A', name: 'Counter', normalMinHC: 1, peakMinHC: 1,
    openingTime: '11:00', closingTime: '23:00',
  };
  const isPeakDayFor = (cfg: Config) => (day: number) => {
    const dow = new Date(cfg.year, cfg.month - 1, day).getDay() + 1;
    return [5, 6, 7].includes(dow);
  };

  it('returns 12 monthly summaries', () => {
    const annual = analyzeWorkforceAnnual({
      employees: [], shifts: [], stations: [station], holidays: [], baseConfig: config, isPeakDayFor,
    });
    expect(annual.byMonth).toHaveLength(12);
    expect(annual.byMonth[0].monthIndex).toBe(1);
    expect(annual.byMonth[11].monthIndex).toBe(12);
  });

  it('aggregates annual hours across every month', () => {
    const annual = analyzeWorkforceAnnual({
      employees: [], shifts: [], stations: [station], holidays: [], baseConfig: config, isPeakDayFor,
    });
    expect(annual.annualRequiredHours).toBeGreaterThan(0);
    // Sum of monthly hours equals the annual aggregate.
    const sum = annual.byMonth.reduce((s, m) => s + m.monthlyRequiredHours, 0);
    expect(annual.annualRequiredHours).toBeCloseTo(sum, 1);
  });

  it('identifies a peak month and a valley month', () => {
    const annual = analyzeWorkforceAnnual({
      employees: [], shifts: [], stations: [station], holidays: [], baseConfig: config, isPeakDayFor,
    });
    expect(annual.peakMonthIndex).toBeGreaterThanOrEqual(1);
    expect(annual.peakMonthIndex).toBeLessThanOrEqual(12);
    const peakHrs = annual.byMonth[annual.peakMonthIndex - 1].monthlyRequiredHours;
    const valleyHrs = annual.byMonth[annual.valleyMonthIndex - 1].monthlyRequiredHours;
    expect(peakHrs).toBeGreaterThanOrEqual(valleyHrs);
  });

  it('exposes a savings table for every start month with descending remaining months', () => {
    const annual = analyzeWorkforceAnnual({
      employees: [], shifts: [], stations: [station], holidays: [], baseConfig: config, isPeakDayFor,
    });
    expect(annual.savingsByStartMonth).toHaveLength(12);
    expect(annual.savingsByStartMonth[0].remainingMonths).toBe(12); // start in Jan = 12 months affected
    expect(annual.savingsByStartMonth[11].remainingMonths).toBe(1); // start in Dec = 1 month
  });

  it('computes annualDelta = recommended × 12 minus current × 12', () => {
    const annual = analyzeWorkforceAnnual({
      employees: Array.from({ length: 5 }, (_, i) => mkEmp(`E${i}`)),
      shifts: [], stations: [station], holidays: [], baseConfig: config, isPeakDayFor,
    });
    // 5 employees × 1.5M IQD × 12 = 90M IQD current annual
    expect(annual.annualCurrentSalary).toBe(5 * 1_500_000 * 12);
    // Recommendation has fewer FTE → annualDelta should be negative
    expect(annual.annualDelta).toBeLessThan(0);
  });

  it('returns positive savings when implementing the recommendation in January (full year impact)', () => {
    const annual = analyzeWorkforceAnnual({
      employees: Array.from({ length: 5 }, (_, i) => mkEmp(`E${i}`)),
      shifts: [], stations: [station], holidays: [], baseConfig: config, isPeakDayFor,
    });
    const janRow = annual.savingsByStartMonth[0];
    expect(janRow.savings).toBeGreaterThan(0);
    // December savings should be smaller (only one month of impact)
    const decRow = annual.savingsByStartMonth[11];
    expect(decRow.savings).toBeLessThan(janRow.savings);
  });
});
