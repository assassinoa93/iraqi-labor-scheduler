import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Download, Calendar, Upload, FileSpreadsheet, Search, Layers, AlertTriangle } from 'lucide-react';
import { Employee, PublicHoliday, Schedule, Shift, Config } from '../types';
import { Card, SortableHeader, SortDir, MonthYearPicker } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { DEFAULT_MONTHLY_SALARY_IQD, baseHourlyRate, monthlyHourCap, computeWorkedHours } from '../lib/payroll';
import { listAllLeaveRangesIncludingPainted, countLeaveDaysOfTypeInRange, projectHolidayBank } from '../lib/leaves';
import { format } from 'date-fns';
import { computeHolidayPay, HolidayPayBreakdown } from '../lib/holidayCompPay';

type PayrollSortKey =
  | 'name' | 'totalHours' | 'holidayBank' | 'annualLeave'
  | 'baseMonthly' | 'hourlyRate' | 'otAmount' | 'netPayable';

interface PayrollTabProps {
  employees: Employee[];
  schedule: Schedule;
  shifts: Shift[];
  holidays: PublicHoliday[];
  config: Config;
  // v2.1.1 — full schedule map so the comp-window check can peek into
  // next month for late-month holidays (a CP on Feb 3 satisfies the
  // window for a Jan 28 holiday). Without this, every late-month
  // holiday would falsely report premium owed.
  allSchedules?: Record<string, Schedule>;
  onExport: () => void;
  onUpdateEmployee: (next: Employee) => void;
  // v1.16: month navigation. Same handlers App.tsx uses for the Schedule
  // and Compliance Dashboard tabs — pivots all data on the active month
  // so credits / OT figures match what the supervisor is reviewing.
  prevMonth: () => void;
  nextMonth: () => void;
  setActiveMonth: (year: number, month: number) => void;
  // v5.5.0 — LeaveManagerModal opening lifted to App.tsx so the same
  // modal is reachable from EmployeeModal too. The Payroll row's leaves
  // button now just calls back into App with the target employee.
  onOpenLeaveManager: (emp: Employee) => void;
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

export function PayrollTab({ employees, schedule, shifts, holidays, config, allSchedules, onExport, onUpdateEmployee, prevMonth, nextMonth, setActiveMonth, onOpenLeaveManager }: PayrollTabProps) {
  const { t } = useI18n();
  const importInputRef = useRef<HTMLInputElement>(null);
  const balanceImportInputRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<PayrollSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // v5.5.0 — date-sensitive balance projection. When set, the Annual Leave
  // column shows projected balance as of `asOfDate` = current balance −
  // annual-leave days planned in [today, asOfDate]. Lets the supervisor
  // anticipate balance ahead of an upcoming leave window.
  // v5.8.1 — `asOfDate` now follows the active month. The user noted that
  // picking June at the top kept the projection date on the previous
  // selection. Default behaviour is "show me the balance at the end of
  // whatever month I'm reviewing"; the user can still tweak the day
  // manually after the auto-set.
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const lastDayOfActiveMonth = useMemo(() => {
    // Day 0 of next month = last day of current month — the standard
    // JS-Date trick. Format with date-fns to keep YYYY-MM-DD shape.
    const lastDay = new Date(config.year, config.month, 0);
    return format(lastDay, 'yyyy-MM-dd');
  }, [config.year, config.month]);
  const [asOfDate, setAsOfDate] = useState<string>(lastDayOfActiveMonth);
  // Re-sync whenever the active month changes — month picker is the
  // source of truth, the picker input echoes it. Only the year+month
  // are dependencies, so a manual mid-month tweak by the user persists
  // across re-renders within the same month.
  useEffect(() => {
    setAsOfDate(lastDayOfActiveMonth);
  }, [lastDayOfActiveMonth]);
  const isProjecting = asOfDate > todayStr;
  // v5.7.0 — search + filter + group-by, parity with the Roster tab. The
  // user explicitly flagged that any surface displaying employee data
  // should support these. groupBy is 'none' | 'department' | 'role' |
  // 'category' (Standard / Driver). Sort still works inside each group;
  // group headers separate the sections so figures roll up per group.
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [groupBy, setGroupBy] = useState<'none' | 'department' | 'role' | 'category'>('none');
  // Derive role + department option lists from the current roster so the
  // pickers show only values that actually exist (no stale options).
  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { if (e.role) set.add(e.role); });
    return Array.from(set).sort();
  }, [employees]);
  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { if (e.department) set.add(e.department); });
    return Array.from(set).sort();
  }, [employees]);

  const handleSort = (k: string) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k as PayrollSortKey); setSortDir('asc'); }
  };

  // Compute every per-employee payroll figure once. Sorting then reads
  // straight from this array — no need to recompute holiday breakdowns
  // or hourly rate per sort change.
  type Row = {
    emp: Employee;
    totalHours: number;
    baseMonthly: number;
    hourlyRate: number;
    standardOTHours: number;
    standardOTPay: number;
    holidayBreakdown: HolidayPayBreakdown;
    otAmount: number;
    netPayable: number;
  };
  const rows = useMemo<Row[]>(() => {
    const cap = monthlyHourCap(config);
    return employees.map(emp => {
      const totalHours = computeWorkedHours(emp, schedule, shifts, config);
      const baseMonthly = emp.baseMonthlySalary || DEFAULT_MONTHLY_SALARY_IQD;
      const hourlyRate = baseHourlyRate(emp, config);
      const holidayBreakdown = computeHolidayPay(emp, schedule, shifts, holidays, config, hourlyRate, allSchedules);
      const standardOTHours = Math.max(0, totalHours - cap - holidayBreakdown.premiumHolidayHours);
      const standardOTPay = standardOTHours * hourlyRate * (config.otRateDay ?? 1.5);
      const otAmount = standardOTPay + holidayBreakdown.premiumPay;
      const netPayable = baseMonthly + otAmount;
      return { emp, totalHours, baseMonthly, hourlyRate, standardOTHours, standardOTPay, holidayBreakdown, otAmount, netPayable };
    });
  }, [employees, schedule, shifts, holidays, config, allSchedules]);

  // v5.7.0 — filter pipeline: search (name / id / dept) → role filter →
  // dept filter → sort. Same shape as RosterTab so the two tabs stay
  // mentally consistent.
  const filteredRows = useMemo<Row[]>(() => {
    const q = searchTerm.toLowerCase().trim();
    return rows.filter(r => {
      if (roleFilter !== 'all' && r.emp.role !== roleFilter) return false;
      if (deptFilter !== 'all' && r.emp.department !== deptFilter) return false;
      if (!q) return true;
      return r.emp.name.toLowerCase().includes(q)
        || r.emp.empId.toLowerCase().includes(q)
        || r.emp.department.toLowerCase().includes(q);
    });
  }, [rows, searchTerm, roleFilter, deptFilter]);

  const sortedRows = useMemo<Row[]>(() => {
    if (!sortKey) return filteredRows;
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const sorted = [...filteredRows].sort((a, b) => {
      let va: number | string;
      let vb: number | string;
      switch (sortKey) {
        case 'name': va = a.emp.name.toLowerCase(); vb = b.emp.name.toLowerCase(); break;
        case 'totalHours': va = a.totalHours; vb = b.totalHours; break;
        case 'holidayBank': va = a.emp.holidayBank; vb = b.emp.holidayBank; break;
        case 'annualLeave': va = a.emp.annualLeaveBalance; vb = b.emp.annualLeaveBalance; break;
        case 'baseMonthly': va = a.baseMonthly; vb = b.baseMonthly; break;
        case 'hourlyRate': va = a.hourlyRate; vb = b.hourlyRate; break;
        case 'otAmount': va = a.otAmount; vb = b.otAmount; break;
        case 'netPayable': va = a.netPayable; vb = b.netPayable; break;
      }
      if (va < vb) return -1 * dirMul;
      if (va > vb) return 1 * dirMul;
      return 0;
    });
    return sorted;
  }, [filteredRows, sortKey, sortDir]);

  // v5.7.0 — group-by partitioning. When groupBy is set, sortedRows are
  // bucketed into groups (preserving the active sort within each group)
  // and rendered with a sticky group header above each section. Each
  // group header carries small per-group rollups (count + total OT pay +
  // total net payable) so the supervisor can compare group spend at a
  // glance without re-sorting the whole table.
  type GroupedSection = {
    key: string;
    label: string;
    rows: Row[];
    totalOTPay: number;
    totalNetPayable: number;
  };
  const groupedSections = useMemo<GroupedSection[]>(() => {
    if (groupBy === 'none') return [];
    const buckets = new Map<string, Row[]>();
    for (const r of sortedRows) {
      let key: string;
      if (groupBy === 'department') key = r.emp.department || '—';
      else if (groupBy === 'role') key = r.emp.role || '—';
      else key = r.emp.category || 'Standard';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    }
    const sections: GroupedSection[] = [];
    for (const [key, rs] of buckets) {
      sections.push({
        key,
        label: key,
        rows: rs,
        totalOTPay: rs.reduce((s, r) => s + r.otAmount, 0),
        totalNetPayable: rs.reduce((s, r) => s + r.netPayable, 0),
      });
    }
    sections.sort((a, b) => a.label.localeCompare(b.label));
    return sections;
  }, [sortedRows, groupBy]);
  const filtersActive = searchTerm !== '' || roleFilter !== 'all' || deptFilter !== 'all';

  // Per-row CSV export. Columns map 1:1 to the visible payroll table so
  // the user can paste into HRIS systems (SAP, Kayan HR) where the
  // column names match. Numeric fields are unformatted (raw IQD / hours)
  // for clean import. Honours the active sort so the export matches what
  // the user sees on screen.
  const exportPayrollCSV = () => {
    const headers = [
      'Employee ID', 'Name', 'Total Hours', 'Holiday Bank Days', 'Annual Leave Days',
      'Base Monthly Salary', 'Hourly Rate', 'Standard OT Hours',
      'Holiday Hours Worked', 'Holiday Premium Hours (2× owed)',
      'Standard OT Pay (IQD)', 'Holiday OT Pay (IQD)', 'Net Payable (IQD)',
      'Year', 'Month',
    ];
    const csvRows = sortedRows.map(r => [
      r.emp.empId, r.emp.name, r.totalHours.toFixed(1), r.emp.holidayBank, r.emp.annualLeaveBalance,
      r.baseMonthly, Math.round(r.hourlyRate), r.standardOTHours.toFixed(1),
      r.holidayBreakdown.totalHolidayHours.toFixed(1), r.holidayBreakdown.premiumHolidayHours.toFixed(1),
      Math.round(r.standardOTPay), Math.round(r.holidayBreakdown.premiumPay), Math.round(r.netPayable),
      config.year, config.month,
    ]);
    const csv = [headers, ...csvRows].map(r => r.map(csvCell).join(',')).join('\n');
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
        // v2.1.2 — guard non-negative for all three balances. Negative
        // values surfaced as a "credit deficit" in payroll which is
        // never the supervisor's intent.
        if (bankIdx !== -1) {
          const v = parseFloat(cols[bankIdx]);
          if (Number.isFinite(v) && v >= 0) next.holidayBank = v;
        }
        if (alIdx !== -1) {
          const v = parseFloat(cols[alIdx]);
          if (Number.isFinite(v) && v >= 0) next.annualLeaveBalance = v;
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
          <MonthYearPicker
            year={config.year}
            month={config.month}
            onChange={setActiveMonth}
            onPrev={prevMonth}
            onNext={nextMonth}
          />
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">{t('payroll.title')}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('payroll.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onExport}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-slate-700 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-800 dark:hover:bg-slate-600 transition-all shadow-sm"
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
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all shadow-sm"
            title={t('payroll.import.tooltip')}
          >
            <Upload className="w-3 h-3 text-emerald-600 dark:text-emerald-300" />
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
          {/* v5.5.0 — minimal 2-column annual-leave-balance updater. Same
              import logic as the full payroll CSV (it accepts partial
              column sets), but the friendlier UI advertises the simpler
              format so HR can drop in just `Employee ID,Annual Leave Days`. */}
          <button
            onClick={() => {
              const headers = ['Employee ID', 'Annual Leave Days'];
              const csvRows = employees.map(e => [e.empId, e.annualLeaveBalance]);
              const csv = [headers, ...csvRows].map(r => r.map(csvCell).join(',')).join('\n');
              const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'AnnualLeave_Balance_Template.csv';
              a.click();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all shadow-sm"
            title={t('payroll.balance.template.tooltip')}
          >
            <Download className="w-3 h-3" />
            {t('payroll.balance.template')}
          </button>
          <button
            onClick={() => balanceImportInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-200 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-emerald-100 dark:hover:bg-emerald-500/25 transition-all shadow-sm"
            title={t('payroll.balance.upload.tooltip')}
          >
            <Upload className="w-3 h-3" />
            {t('payroll.balance.upload')}
          </button>
          <input
            ref={balanceImportInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importPayrollCSV(f);
              if (balanceImportInputRef.current) balanceImportInputRef.current.value = '';
            }}
          />
        </div>
      </div>

      {/* v5.5.0 — date-sensitive projection bar. Setting a future date
          re-renders the Annual Leave column with the projected balance
          (current − planned annual leaves between today and the date),
          so the supervisor can verify "if I approve a 14-day leave for
          Ali starting Sep 1, what's his balance on Oct 1?" without
          mental arithmetic. Today's date keeps the view at "as of now". */}
      <div className="flex items-center gap-3 flex-wrap p-3 rounded-xl bg-blue-50/40 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30">
        <span className="text-[10px] font-black text-blue-700 dark:text-blue-200 uppercase tracking-widest">{t('payroll.balance.asOf')}</span>
        <input
          type="date"
          value={asOfDate}
          // No `min` so the supervisor can pick any day in the active
          // month — including past days (the projection helpers degrade
          // gracefully to "no projection" when asOfDate <= today).
          onChange={(e) => setAsOfDate(e.target.value || lastDayOfActiveMonth)}
          className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono"
        />
        {/* v5.8.1 — reset reverts to month-end (the synced default), not
            today. The user expects the projection to follow the month
            picker, so "reset" should re-anchor to the same point the
            month change would set. */}
        {asOfDate !== lastDayOfActiveMonth && (
          <button
            onClick={() => setAsOfDate(lastDayOfActiveMonth)}
            className="text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 uppercase tracking-widest"
          >
            {t('payroll.balance.resetMonthEnd')}
          </button>
        )}
        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium ms-auto">
          {isProjecting ? t('payroll.balance.projecting') : t('payroll.balance.current')}
        </p>
      </div>

      {importMsg && (
        <div role="status" className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-200 rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-widest">
          {importMsg}
        </div>
      )}

      {/* v5.7.0 — search + role/dept filter + group-by, parity with the
          Roster tab. The user explicitly flagged that any tab showing
          employee data should support these. Active filter count appears
          above the table when narrowed; group headers show per-group OT
          + Net Payable rollups when groupBy is active. */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder={t('payroll.filter.searchPlaceholder')}
            className="w-full ps-9 pe-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-1 focus:ring-blue-500 outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label={t('payroll.filter.role')}
          className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
        >
          <option value="all">{t('payroll.filter.allRoles')}</option>
          {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          aria-label={t('payroll.filter.dept')}
          className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
        >
          <option value="all">{t('payroll.filter.allDepts')}</option>
          {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="flex items-center gap-1.5 ms-auto">
          <Layers className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('payroll.filter.groupBy')}</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
            aria-label={t('payroll.filter.groupBy')}
            className="px-2 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
          >
            <option value="none">{t('payroll.filter.groupBy.none')}</option>
            <option value="department">{t('payroll.filter.groupBy.department')}</option>
            <option value="role">{t('payroll.filter.groupBy.role')}</option>
            <option value="category">{t('payroll.filter.groupBy.category')}</option>
          </select>
        </div>
        {filtersActive && (
          <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            {sortedRows.length}/{rows.length}
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700">
                <SortableHeader label={t('payroll.col.employee')} sortKey="name" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortableHeader label={t('payroll.col.hours')} sortKey="totalHours" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortableHeader label={t('payroll.col.holidayBank')} sortKey="holidayBank" currentKey={sortKey} direction={sortDir} onSort={handleSort} className="underline decoration-blue-500/30" />
                <SortableHeader label={t('payroll.col.annualLeave')} sortKey="annualLeave" currentKey={sortKey} direction={sortDir} onSort={handleSort} className="underline decoration-emerald-500/30" />
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('payroll.col.leaves')}</th>
                <SortableHeader label={t('payroll.col.baseSalary')} sortKey="baseMonthly" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortableHeader label={t('payroll.col.hourlyRate')} sortKey="hourlyRate" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('payroll.col.otEligibility')}</th>
                <SortableHeader label={t('payroll.col.otAmount')} sortKey="otAmount" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortableHeader label={t('payroll.col.netPayable')} sortKey="netPayable" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {/* v5.7.0 — when groupBy is active, render a header row above
                  each group section with per-group rollups. Sorting still
                  applies inside each group; the headers just punctuate the
                  visual flow. */}
              {(() => {
                // The actual per-row JSX — extracted into an IIFE so the
                // grouped + ungrouped paths share one renderer instead of
                // duplicating the ~80-line cell layout.
                const renderRow = ({ emp, totalHours, baseMonthly, hourlyRate, standardOTHours, holidayBreakdown, otAmount, netPayable }: Row) => {
                  const totalHolidayHours = holidayBreakdown.totalHolidayHours;
                  const premiumHolidayHours = holidayBreakdown.premiumHolidayHours;
                  const isOtEligible = totalHours > monthlyHourCap(config);

                  // v5.8.0 — OT carry-over detection. Use case the user
                  // flagged: comp-day mode + a late-month holiday → premium
                  // currently shown as owed because the comp window extends
                  // into next month → schedule the next month and the CP
                  // lands → premium clears → OT zeroes out. Without the
                  // hint the supervisor doesn't know they can resolve the
                  // OT just by generating next month's schedule, so they
                  // either accept phantom OT pay or hand-pay it.
                  // Rule:
                  //   * mode is NOT 'cash-ot' (cash-ot is final, no comp
                  //     to chase)
                  //   * at least one in-month holiday has premium owed
                  //     because its comp window extends past month-end
                  //   * next month either has no schedule for this
                  //     employee OR has no CP cells inside the window
                  // When all three hold, render an amber AlertTriangle
                  // badge with a hint string.
                  const compWindowDays = config.holidayCompWindowDays ?? 30;
                  const globalMode = config.holidayCompMode ?? 'comp-day';
                  // nextMonthKey same shape the cross-month helpers use.
                  const nextDate = new Date(config.year, config.month, 1);
                  const nextMonthKey = `scheduler_schedule_${nextDate.getFullYear()}_${nextDate.getMonth() + 1}`;
                  const nextEmpSched = allSchedules?.[nextMonthKey]?.[emp.empId];
                  // Does this employee have any CP placement in the next
                  // month inside the comp window? Cheap scan — most months
                  // have only a handful of relevant entries.
                  const hasNextMonthCP = nextEmpSched
                    ? Object.entries(nextEmpSched).some(([day, entry]) => {
                        const d = parseInt(day, 10);
                        return Number.isFinite(d) && d <= compWindowDays && entry.shiftCode === 'CP';
                      })
                    : false;
                  const showCarryoverHint =
                    globalMode !== 'cash-ot' &&
                    otAmount > 0 &&
                    holidayBreakdown.perHoliday.some(ph => {
                      if (!ph.premiumOwed) return false;
                      // Per-holiday compMode override may force cash-ot
                      // even under a comp-day default — those don't carry
                      // over so skip them. (computeHolidayPay already
                      // returns premiumOwed=true for both reasons; we
                      // approximate by checking the global mode here.)
                      const m = /^\d{4}-\d{2}-(\d{2})$/.exec(ph.date);
                      if (!m) return false;
                      const dayOfMonth = parseInt(m[1], 10);
                      const windowExtendsIntoNext = dayOfMonth + compWindowDays > config.daysInMonth;
                      return windowExtendsIntoNext;
                    }) &&
                    !hasNextMonthCP;
                  return (
                    <tr key={emp.empId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{emp.name}</div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">{emp.empId}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm font-bold text-slate-600 dark:text-slate-300">{totalHours.toFixed(1)}h</td>
                    <td className="px-6 py-4">
                      {(() => {
                        // v5.8.0 — same as-of-date projection as the
                        // Annual Leave column, applied to holidayBank.
                        // Walks every available month schedule between
                        // today and asOfDate, counting holiday-day
                        // accruals (+1) and CP placements (-1). Result
                        // shows "current + accrued − used" as a
                        // footnote when any change is in flight.
                        const proj = isProjecting && allSchedules
                          ? projectHolidayBank(emp, allSchedules, shifts, holidays, todayStr, asOfDate)
                          : { accrued: 0, used: 0, projected: emp.holidayBank };
                        const showFootnote = isProjecting && (proj.accrued > 0 || proj.used > 0);
                        return (
                          <div className="space-y-0.5">
                            <span className={cn(
                              'px-3 py-1 rounded-full text-[10px] font-black tracking-tight',
                              proj.projected > 0 ? 'bg-blue-100 dark:bg-blue-500/25 text-blue-700 dark:text-blue-200 shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500',
                            )}>
                              {proj.projected} {t('payroll.days')}
                            </span>
                            {showFootnote && (
                              <p className="text-[8px] font-mono text-slate-400 dark:text-slate-500 ps-1">
                                {emp.holidayBank}
                                {proj.accrued > 0 && ` + ${proj.accrued}`}
                                {proj.used > 0 && ` − ${proj.used}`}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        // v5.5.0 — when the user picked a future asOfDate,
                        // show projected balance = current − planned annual
                        // leaves between today and that date. The base
                        // (un-projected) value still appears below as a
                        // small footnote so the supervisor can see both
                        // numbers at once.
                        const consumedDays = isProjecting
                          ? countLeaveDaysOfTypeInRange(emp, 'annual', todayStr, asOfDate)
                          : 0;
                        const projected = Math.max(0, emp.annualLeaveBalance - consumedDays);
                        const lowBalance = projected < 5;
                        return (
                          <div className="space-y-0.5">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-black tracking-tight",
                              lowBalance ? "bg-orange-100 dark:bg-orange-500/25 text-orange-700 dark:text-orange-200" : "bg-emerald-100 dark:bg-emerald-500/25 text-emerald-700 dark:text-emerald-200 shadow-sm",
                            )}>
                              {projected} {t('payroll.days')}
                            </span>
                            {isProjecting && consumedDays > 0 && (
                              <p className="text-[8px] font-mono text-slate-400 dark:text-slate-500 ps-1">
                                {emp.annualLeaveBalance} − {consumedDays}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        const ranges = listAllLeaveRangesIncludingPainted(emp, schedule, config);
                        return (
                          <button
                            onClick={() => onOpenLeaveManager(emp)}
                            title={ranges.length === 0
                              ? t('payroll.leavesNone')
                              : ranges.map(r => t('payroll.leaveRange.line', {
                                  type: t(`payroll.leaveType.${r.type}`),
                                  start: r.start,
                                  end: r.end,
                                })).join('\n')}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-all text-[10px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight"
                          >
                            <Calendar className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                            {ranges.length > 0 ? `${ranges.length} · ` : ''}
                            {t('payroll.manageLeaves')}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs font-bold text-slate-600 dark:text-slate-300">{baseMonthly.toLocaleString()} IQD</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-500 dark:text-slate-400">{Math.round(hourlyRate).toLocaleString()} IQD</td>
                    <td className="px-6 py-4">
                      <div className={cn(
                        "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded w-fit",
                        isOtEligible ? "bg-emerald-100 dark:bg-emerald-500/25 text-emerald-700 dark:text-emerald-200" : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                      )}>
                        {isOtEligible ? t('payroll.qualified') : t('payroll.standard')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs font-bold text-emerald-600 dark:text-emerald-300">+{Math.round(otAmount).toLocaleString()}</div>
                      <div className="text-[9px] text-slate-400 dark:text-slate-500 font-mono truncate">
                        {standardOTHours > 0 && `${standardOTHours.toFixed(1)}h @ ${Math.round((config.otRateDay ?? 1.5) * 100)}% `}
                        {premiumHolidayHours > 0 && `(incl. ${premiumHolidayHours.toFixed(1)}h @ ${Math.round((config.otRateNight ?? 2.0) * 100)}%)`}
                        {totalHolidayHours > 0 && premiumHolidayHours === 0 && (
                          <span className="text-emerald-600 dark:text-emerald-300">{` (${totalHolidayHours.toFixed(1)}h holiday — comp day granted)`}</span>
                        )}
                      </div>
                      {/* v5.8.0 — OT carry-over hint badge. Surfaces when
                          the OT showing here is provisional: it'll clear
                          once next month's schedule is generated and the
                          comp days land. Tooltip explains the resolution
                          path so the supervisor knows what to do. */}
                      {showCarryoverHint && (
                        <div
                          className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-100 text-[8px] font-black uppercase tracking-widest"
                          title={t('payroll.ot.carryover.tooltip')}
                        >
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {t('payroll.ot.carryover.badge')}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-black text-slate-900 dark:text-slate-50 tracking-tighter">
                        {Math.round(netPayable).toLocaleString()}
                      </div>
                    </td>
                  </tr>
                  );
                };
                if (groupBy === 'none') {
                  return sortedRows.map(renderRow);
                }
                // Render a group header row above each group's rows. The
                // header carries per-group OT and Net Payable totals so
                // the supervisor sees group spend at a glance.
                return groupedSections.flatMap(section => [
                  <tr key={`__group_${section.key}`} className="bg-slate-100 dark:bg-slate-800/60 border-y border-slate-200 dark:border-slate-700">
                    <td colSpan={10} className="px-6 py-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{section.label}</span>
                        <span className="text-[9px] font-mono text-slate-500 dark:text-slate-400">
                          {t('payroll.group.headcount', { count: section.rows.length })}
                        </span>
                        <span className="ms-auto text-[9px] font-mono text-slate-500 dark:text-slate-400">
                          {t('payroll.group.otRollup', { ot: Math.round(section.totalOTPay).toLocaleString() })}
                          {' · '}
                          {t('payroll.group.netRollup', { net: Math.round(section.totalNetPayable).toLocaleString() })}
                        </span>
                      </div>
                    </td>
                  </tr>,
                  ...section.rows.map(renderRow),
                ]);
              })()}
            </tbody>
          </table>
        </div>
      </Card>

      {/* v5.5.0 — LeaveManagerModal moved to App.tsx so the same modal can
          be opened from the EmployeeModal too. The Payroll-row "Leaves"
          button calls back into App via onOpenLeaveManager. */}
    </div>
  );
}
