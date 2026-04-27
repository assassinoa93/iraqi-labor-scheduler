import { Employee, Config } from '../types';

// Single fallback used when an employee record predates the salary field
// (legacy CSV imports, very old backups). Real records always have
// `baseMonthlySalary` set on save.
export const DEFAULT_MONTHLY_SALARY_IQD = 1_500_000;

// Iraqi payroll convention: monthly hours = weekly cap × 4. Drivers have a
// higher weekly cap (56 vs 48) so their per-hour rate is computed against a
// larger denominator. Falls back to the standard weekly cap when an employee
// record is missing `contractedWeeklyHrs`.
export function monthlyHoursDivisor(
  emp: Pick<Employee, 'contractedWeeklyHrs'> | { contractedWeeklyHrs?: number },
  config: Pick<Config, 'standardWeeklyHrsCap'>,
): number {
  const weekly = emp.contractedWeeklyHrs && emp.contractedWeeklyHrs > 0
    ? emp.contractedWeeklyHrs
    : config.standardWeeklyHrsCap;
  return weekly * 4;
}

// Hourly rate used to compute OT premiums. Matches the formula shown to the
// user in the EmployeeModal "AUTO" badge.
export function baseHourlyRate(
  emp: Pick<Employee, 'baseMonthlySalary' | 'contractedWeeklyHrs'>,
  config: Pick<Config, 'standardWeeklyHrsCap'>,
): number {
  const monthly = emp.baseMonthlySalary && emp.baseMonthlySalary > 0
    ? emp.baseMonthlySalary
    : DEFAULT_MONTHLY_SALARY_IQD;
  return monthly / monthlyHoursDivisor(emp, config);
}

// Monthly hour cap = standard weekly cap × 4. Anything above this becomes
// overtime under Iraqi labor law (Art. 70).
export function monthlyHourCap(config: Pick<Config, 'standardWeeklyHrsCap'>): number {
  return config.standardWeeklyHrsCap * 4;
}
