import React, { useState, useRef } from 'react';
import { Download, Calendar, ChevronLeft, ChevronRight, Upload, FileSpreadsheet } from 'lucide-react';
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
  // v1.16: month navigation. Same handlers App.tsx uses for the Schedule
  // and Compliance Dashboard tabs — pivots all data on the active month
  // so credits / OT figures match what the supervisor is reviewing.
  prevMonth: () => void;
  nextMonth: () => void;
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Parse a CSV-with-quoting line into fields. Handles "" inside quoted
// strings; doesn't try to handle embedded line breaks in cells (none of
// the importable fields can contain them).
const parseCSVLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQ = false; continue; }
      cur += c;
    } else {
      if (c === '"' && cur === '') { inQ = true; continue; }
      if (c === ',') { out.push(cur); cur = ''; continue; }
      cur += c;
    }
  }
  out.push(cur);
  return out;
};

export function PayrollTab({ employees, schedule, shifts, holidays, config, onExport, onUpdateEmployee, prevMonth, nextMonth }: PayrollTabProps) {
  const { t } = useI18n();
  const holidayDates = new Set(holidays.map(h => h.date));
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));
  const [leaveEditFor, setLeaveEditFor] = useState<Employee | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Per-row CSV export. Columns map 1:1 to the visible payroll table so
  // the user can paste into HRIS systems (SAP, Kayan HR) where the
  // column names match. Numeric fields are unformatted (raw IQD / hours)
  // for clean import.
  const exportPayrollCSV = () => {
    const cap = monthlyHourCap(config);
    const headers = [
      'Employee ID', 'Name', 'Total Hours', 'Holiday Bank Days', 'Annual Leave Days',
      'Base Monthly Salary', 'Hourly Rate', 'Standard OT Hours', 'Holiday OT Hours',
      'Standard OT Pay (IQD)', 'Holiday OT Pay (IQD)', 'Net Payable (IQD)',
      'Year', 'Month',
    ];
    const rows = employees.map(emp => {
      const empSched = schedule[emp.empId] || {};
      let totalHours = 0;
      let holidayOTHours = 0;
      Object.entries(empSched).forEach(([day, entry]) => {
        const dateStr = format(new Date(config.year, config.month - 1, parseInt(day)), 'yyyy-MM-dd');
        const isHoli = holidayDates.has(dateStr);
        const sh = shiftByCode.get(entry.shiftCode);
        if (sh?.isWork) {
          totalHours += sh.durationHrs;
          if (isHoli) holidayOTHours += sh.durationHrs;
        }
      });
      const baseMonthly = emp.baseMonthlySalary || DEFAULT_MONTHLY_SALARY_IQD;
      const hourlyRate = baseHourlyRate(emp, config);
      const standardOTHours = Math.max(0, totalHours - cap - holidayOTHours);
      const standardOTPay = Math.round(standardOTHours * hourlyRate * (config.otRateDay ?? 1.5));
      const holidayOTPay = Math.round(holidayOTHours * hourlyRate * (config.otRateNight ?? 2.0));
      const netPayable = baseMonthly + standardOTPay + holidayOTPay;
      return [
        emp.empId, emp.name, totalHours.toFixed(1), emp.holidayBank, emp.annualLeaveBalance,
        baseMonthly, Math.round(hourlyRate), standardOTHours.toFixed(1), holidayOTHours.toFixed(1),
        standardOTPay, holidayOTPay, netPayable, config.year, config.month,
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Payroll_Export_${config.year}_${String(config.month).padStart(2, '0')}.csv`;
    a.click();
  };

  // Import path. Updates `holidayBank`, `annualLeaveBalance`, and
  // `baseMonthlySalary` for matching `Employee ID` rows. Other columns
  // (computed payroll values) are read-only — re-importing them is a
  // no-op since the values are recalculated from the schedule.
  const importPayrollCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length < 2) {
        setImportMsg(t('payroll.import.empty'));
        return;
      }
      const header = parseCSVLine(lines[0]).map(h => h.trim());
      const idIdx = header.findIndex(h => h.toLowerCase() === 'employee id');
      if (idIdx === -1) {
        setImportMsg(t('payroll.import.missingId'));
        return;
      }
      const findIdx = (label: string) => header.findIndex(h => h.toLowerCase() === label.toLowerCase());
      const bankIdx = findIdx('Holiday Bank Days');
      const alIdx = findIdx('Annual Leave Days');
      const salIdx = findIdx('Base Monthly Salary');
      const empById = new Map(employees.map(e => [e.empId, e]));
      let updated = 0;
      let skipped = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const id = (cols[idIdx] || '').trim();
        const emp = id ? empById.get(id) : undefined;
        if (!emp) { skipped++; continue; }
        const next: Employee = { ...emp };
        if (bankIdx !== -1) {
          const v = parseFloat(cols[bankIdx]);
          if (Number.isFinite(v)) next.holidayBank = v;
        }
        if (alIdx !== -1) {
          const v = parseFloat(cols[alIdx]);
          if (Number.isFinite(v)) next.annualLeaveBalance = v;
        }
        if (salIdx !== -1) {
          const v = parseFloat(cols[salIdx]);
          if (Number.isFinite(v) && v >= 0) next.baseMonthlySalary = v;
        }
        onUpdateEmployee(next);
        updated++;
      }
      setImportMsg(t('payroll.import.summary', { updated, skipped }));
      setTimeout(() => setImportMsg(null), 6000);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
            <button onClick={prevMonth} aria-label={t('action.prevMonth')} className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-center px-4 w-40 font-mono">
              <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">{config.year}</p>
              <p className="text-xl font-black text-slate-800 tracking-tighter uppercase whitespace-nowrap">
                {format(new Date(config.year, config.month - 1, 1), 'MMMM')}
              </p>
            </div>
            <button onClick={nextMonth} aria-label={t('action.nextMonth')} className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">{t('payroll.title')}</h2>
            <p className="text-sm text-slate-500">{t('payroll.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onExport}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-sm"
          >
            <Download className="w-3 h-3" />
            {t('payroll.exportDraft')}
          </button>
          <button
            onClick={exportPayrollCSV}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-sm"
            title={t('payroll.export.tooltip')}
          >
            <FileSpreadsheet className="w-3 h-3" />
            {t('payroll.export.csv')}
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
            title={t('payroll.import.tooltip')}
          >
            <Upload className="w-3 h-3 text-emerald-600" />
            {t('payroll.import.csv')}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importPayrollCSV(f);
              if (importInputRef.current) importInputRef.current.value = '';
            }}
          />
        </div>
      </div>

      {importMsg && (
        <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-widest">
          {importMsg}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse">
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
        schedule={schedule}
        config={config}
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
