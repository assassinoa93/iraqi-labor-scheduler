import React, { useState } from 'react';
import { Download, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { Employee, PublicHoliday, Schedule, Shift, Config } from '../types';
import { Card } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { DEFAULT_MONTHLY_SALARY_IQD, baseHourlyRate, monthlyHourCap } from '../lib/payroll';
import { LeaveManagerModal } from '../components/LeaveManagerModal';
import { listAllLeaveRangesIncludingPainted } from '../lib/leaves';

interface PayrollTabProps {
  employees: Employee[];
  schedule: Schedule;
  shifts: Shift[];
  holidays: PublicHoliday[];
  config: Config;
  onExport: () => void;
  onUpdateEmployee: (next: Employee) => void;
}

export function PayrollTab({ employees, schedule, shifts, holidays, config, onExport, onUpdateEmployee }: PayrollTabProps) {
  const { t } = useI18n();
  const holidayDates = new Set(holidays.map(h => h.date));
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));
  const [leaveEditFor, setLeaveEditFor] = useState<Employee | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight">{t('payroll.title')}</h2>
          <p className="text-sm text-slate-500">{t('payroll.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onExport}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-sm"
          >
            <Download className="w-3 h-3" />
            {t('payroll.exportDraft')}
          </button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('payroll.col.employee')}</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('payroll.col.hours')}</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest underline decoration-blue-500/30">{t('payroll.col.holidayBank')}</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest underline decoration-emerald-500/30">{t('payroll.col.annualLeave')}</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('payroll.col.leaves')}</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('payroll.col.baseSalary')}</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('payroll.col.hourlyRate')}</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('payroll.col.otEligibility')}</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('payroll.col.otAmount')}</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('payroll.col.netPayable')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map(emp => {
                const empSched = schedule[emp.empId] || {};
                let totalHours = 0;
                let holidayOTHours = 0;

                Object.entries(empSched).forEach(([day, entry]) => {
                  const dateStr = format(new Date(config.year, config.month - 1, parseInt(day)), 'yyyy-MM-dd');
                  const isHoli = holidayDates.has(dateStr);
                  const shift = shiftByCode.get(entry.shiftCode);
                  if (shift?.isWork) {
                    totalHours += shift.durationHrs;
                    if (isHoli) holidayOTHours += shift.durationHrs;
                  }
                });

                const baseMonthly = emp.baseMonthlySalary || DEFAULT_MONTHLY_SALARY_IQD;
                const hourlyRate = baseHourlyRate(emp, config);

                const cap = monthlyHourCap(config);
                const standardOTHours = Math.max(0, totalHours - cap - holidayOTHours);

                const standardOTPay = standardOTHours * hourlyRate * (config.otRateDay ?? 1.5);
                // Holiday hours always pay 2× per Art. 74 (cash premium) AND
                // the worker is also owed a comp rest day. Tracked separately
                // via emp.holidayBank — paid both, not "either/or".
                const holidayOTPay = holidayOTHours * hourlyRate * (config.otRateNight ?? 2.0);

                const isOtEligible = totalHours > cap;

                return (
                  <tr key={emp.empId} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-slate-800">{emp.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{emp.empId}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm font-bold text-slate-600">{totalHours.toFixed(1)}h</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-black tracking-tight",
                        emp.holidayBank > 0 ? "bg-blue-100 text-blue-700 shadow-sm" : "bg-slate-100 text-slate-400"
                      )}>
                        {emp.holidayBank} {t('payroll.days')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-black tracking-tight",
                        emp.annualLeaveBalance < 5 ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700 shadow-sm"
                      )}>
                        {emp.annualLeaveBalance} {t('payroll.days')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        const ranges = listAllLeaveRangesIncludingPainted(emp, schedule, config);
                        return (
                          <button
                            onClick={() => setLeaveEditFor(emp)}
                            title={ranges.length === 0 ? t('payroll.leavesNone') : ranges.map(r => `${r.type}: ${r.start} → ${r.end}`).join('\n')}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-all text-[10px] font-bold text-slate-700 uppercase tracking-tight"
                          >
                            <Calendar className="w-3 h-3 text-slate-500" />
                            {ranges.length > 0 ? `${ranges.length} · ` : ''}
                            {t('payroll.manageLeaves')}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs font-bold text-slate-600">{baseMonthly.toLocaleString()} IQD</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{Math.round(hourlyRate).toLocaleString()} IQD</td>
                    <td className="px-6 py-4">
                      <div className={cn(
                        "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded w-fit",
                        isOtEligible ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                      )}>
                        {isOtEligible ? t('payroll.qualified') : t('payroll.standard')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs font-bold text-emerald-600">+{Math.round(standardOTPay + holidayOTPay).toLocaleString()}</div>
                      <div className="text-[9px] text-slate-400 font-mono truncate">
                        {standardOTHours > 0 && `${standardOTHours.toFixed(1)}h @ ${Math.round((config.otRateDay ?? 1.5) * 100)}% `}
                        {holidayOTHours > 0 && `(incl. ${holidayOTHours.toFixed(1)}h @ ${Math.round((config.otRateNight ?? 2.0) * 100)}%)`}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-black text-slate-900 tracking-tighter">
                        {Math.round(baseMonthly + standardOTPay + holidayOTPay).toLocaleString()}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <LeaveManagerModal
        isOpen={leaveEditFor !== null}
        employee={leaveEditFor}
        onClose={() => setLeaveEditFor(null)}
        onSave={(next) => {
          onUpdateEmployee(next);
          setLeaveEditFor(null);
        }}
      />

      {/* HolidayCompensationModal was removed in v1.14.0 — Iraqi Labor Law
          Art. 74 entitles workers to BOTH the 2× cash premium AND a comp
          rest day, not a choice between them. The choose-comps toggle
          modeled the wrong legal interpretation.
      <HolidayCompensationModal
        isOpen={compEditFor !== null}
        employee={compEditFor}
        schedule={schedule}
        shifts={shifts}
        holidays={holidays}
        config={config}
        onClose={() => setCompEditFor(null)}
        onSave={(next) => {
          onUpdateEmployee(next);
          setCompEditFor(null);
        }}
      /> */}
    </div>
  );
}
