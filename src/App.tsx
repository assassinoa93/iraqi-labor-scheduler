/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, Suspense, lazy } from 'react';
import {
  Users,
  Calendar,
  Clock,
  FileSpreadsheet,
  Settings,
  Download,
  Trash2,
  BarChart3,
  Flag,
  Database,
  X,
  Layout,
  Scale,
  FlaskConical,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Employee,
  Shift,
  PublicHoliday,
  Config,
  Violation,
  Schedule,
  Station,
  Company,
  CompanyData,
} from './types';
import { ComplianceEngine, previewAssignmentWarnings } from './lib/compliance';
import { format, getDaysInMonth, addMonths, subMonths } from 'date-fns';
import {
  INITIAL_SHIFTS, INITIAL_EMPLOYEES, INITIAL_STATIONS, INITIAL_HOLIDAYS,
  DEFAULT_CONFIG, INITIAL_COMPANIES, DEFAULT_COMPANY_ID,
} from './lib/initialData';
import { APP_VERSION } from './lib/appMeta';
import { DEFAULT_MONTHLY_SALARY_IQD, baseHourlyRate, monthlyHourCap } from './lib/payroll';
import { parseHour, getOperatingHoursForDow } from './lib/time';
import { cn } from './lib/utils';
import { runAutoScheduler } from './lib/autoScheduler';
import { TabButton } from './components/Primitives';
import { EmployeeModal } from './components/EmployeeModal';
import { StationModal } from './components/StationModal';
import { ShiftModal } from './components/ShiftModal';
import { HolidayModal } from './components/HolidayModal';
import { ConfirmModal } from './components/ConfirmModal';
import { SchedulePreviewModal, buildPreviewStats } from './components/SchedulePreviewModal';
import { LocaleSwitcher } from './components/LocaleSwitcher';
import { CompanySwitcher } from './components/CompanySwitcher';
import { SimulationDeltaPanel, SimDeltaMetric } from './components/SimulationDeltaPanel';
import { CoverageHintToast } from './components/CoverageHintToast';
import { detectCoverageGap, findSwapCandidates, CoverageGap, CoverageSuggestion } from './lib/coverageHints';
import {
  normalizeEmployees, normalizeShifts, normalizeStations, normalizeHolidays,
  normalizeConfig, normalizeAllSchedules, normalizeCompanies,
} from './lib/migration';
import { useI18n } from './lib/i18n';
import type { DayOfWeek } from './types';

// Tabs are code-split: each becomes its own chunk that loads only when the user
// clicks the corresponding sidebar item. Cuts the initial bundle materially —
// the dashboard ships first, the rest are pulled in on demand.
const DashboardTab = lazy(() => import('./tabs/DashboardTab').then(m => ({ default: m.DashboardTab })));
const RosterTab = lazy(() => import('./tabs/RosterTab').then(m => ({ default: m.RosterTab })));
const PayrollTab = lazy(() => import('./tabs/PayrollTab').then(m => ({ default: m.PayrollTab })));
const ScheduleTab = lazy(() => import('./tabs/ScheduleTab').then(m => ({ default: m.ScheduleTab })));
const HolidaysTab = lazy(() => import('./tabs/HolidaysTab').then(m => ({ default: m.HolidaysTab })));
const LayoutTab = lazy(() => import('./tabs/LayoutTab').then(m => ({ default: m.LayoutTab })));
const ShiftsTab = lazy(() => import('./tabs/ShiftsTab').then(m => ({ default: m.ShiftsTab })));
const ReportsTab = lazy(() => import('./tabs/ReportsTab').then(m => ({ default: m.ReportsTab })));
const SettingsTab = lazy(() => import('./tabs/SettingsTab').then(m => ({ default: m.SettingsTab })));
const VariablesTab = lazy(() => import('./components/VariablesTab').then(m => ({ default: m.VariablesTab })));
const AuditLogTab = lazy(() => import('./components/AuditLogTab').then(m => ({ default: m.AuditLogTab })));

// Empty placeholder used when a company has no per-domain data yet.
const emptyCompanyData = (): CompanyData => ({
  employees: [],
  shifts: INITIAL_SHIFTS,
  stations: [],
  holidays: [],
  config: { ...DEFAULT_CONFIG },
  allSchedules: {},
});

// CSV-escape a single cell: wraps in double quotes and doubles internal quotes
// so that names containing commas, quotes, or newlines round-trip correctly.
const csvCell = (s: string | number): string => {
  const str = String(s ?? '');
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

// Schedule entry / month migration is handled by lib/migration.ts so the
// load and import paths share a single source of truth for backward compat.

export default function App() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dataLoaded, setDataLoaded] = useState(false);

  // Companies registry. The first load seeds INITIAL_COMPANIES if the server
  // returned nothing; per-domain data is also keyed by companyId.
  const [companies, setCompaniesState] = useState<Company[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string>('');
  const [companyData, setCompanyData] = useState<Record<string, CompanyData>>({});

  // Simulation mode keeps a frozen baseline of `companyData`, `companies`, and
  // `activeCompanyId`. While active, edits stay in the in-memory state only —
  // the auto-save effect skips persistence so the user can model "what if"
  // without polluting their saved schedule.
  const [simMode, setSimMode] = useState(false);
  const [simBaseline, setSimBaseline] = useState<{
    companies: Company[];
    activeCompanyId: string;
    companyData: Record<string, CompanyData>;
  } | null>(null);

  // The active company's data slice. Falls back to an empty placeholder when
  // a company exists in the registry but has no rows yet (e.g. just created).
  const data: CompanyData = companyData[activeCompanyId] ?? emptyCompanyData();
  const { employees, shifts, holidays, config, stations, allSchedules } = data;
  const scheduleKey = `scheduler_schedule_${config.year}_${config.month}`;
  const schedule: Schedule = allSchedules[scheduleKey] ?? {};

  // Auto-save status, surfaced in the top bar so the user can see at a glance
  // whether the last edit has reached the server.
  type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Domain setters scoped to the active company. Each accepts either a
  // value or an updater function and merges the result back into companyData.
  type Updater<T> = T | ((prev: T) => T);
  const updateActive = React.useCallback(<K extends keyof CompanyData>(key: K, updater: Updater<CompanyData[K]>) => {
    setCompanyData(prev => {
      const current = prev[activeCompanyId] ?? emptyCompanyData();
      const next = typeof updater === 'function'
        ? (updater as (p: CompanyData[K]) => CompanyData[K])(current[key])
        : updater;
      return { ...prev, [activeCompanyId]: { ...current, [key]: next } };
    });
  }, [activeCompanyId]);

  const setEmployees = React.useCallback((u: Updater<Employee[]>) => updateActive('employees', u), [updateActive]);
  const setShifts = React.useCallback((u: Updater<Shift[]>) => updateActive('shifts', u), [updateActive]);
  const setStations = React.useCallback((u: Updater<Station[]>) => updateActive('stations', u), [updateActive]);
  const setHolidays = React.useCallback((u: Updater<PublicHoliday[]>) => updateActive('holidays', u), [updateActive]);
  const setConfig = React.useCallback((u: Updater<Config>) => updateActive('config', u), [updateActive]);
  const setAllSchedules = React.useCallback((u: Updater<Record<string, Schedule>>) => updateActive('allSchedules', u), [updateActive]);

  type ScheduleUpdater = Schedule | ((prev: Schedule) => Schedule);
  const setSchedule = React.useCallback((updater: ScheduleUpdater) => {
    setAllSchedules(prev => {
      const current = prev[scheduleKey] ?? {};
      const next = typeof updater === 'function' ? (updater as (p: Schedule) => Schedule)(current) : updater;
      return { ...prev, [scheduleKey]: next };
    });
  }, [scheduleKey, setAllSchedules]);

  // Initial data fetch. Hydrates `companies`, sets the active company from
  // localStorage if present, and unpacks the per-domain Record<companyId, T>
  // shape into the in-memory CompanyData map.
  useEffect(() => {
    fetch('/api/data')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => {
        // Companies registry — seed INITIAL_COMPANIES if the server has none.
        let resolvedCompanies: Company[] = INITIAL_COMPANIES;
        let resolvedActive: string = DEFAULT_COMPANY_ID;
        if (data.companies && Array.isArray(data.companies.companies) && data.companies.companies.length > 0) {
          resolvedCompanies = normalizeCompanies(data.companies.companies);
          resolvedActive = data.companies.activeCompanyId || resolvedCompanies[0].id;
        }
        const stickyActive = window.localStorage.getItem('iraqi-scheduler-active-company');
        if (stickyActive && resolvedCompanies.some(c => c.id === stickyActive)) {
          resolvedActive = stickyActive;
        }

        // Build per-company data from the namespaced shape. Each domain is a
        // Record<companyId, T> coming from the server; missing entries fall
        // back to either the seed (employees/stations) or sensible empties.
        // Every domain is run through the migration normalisers so older
        // releases' on-disk shape upgrades cleanly into the current schema.
        const map: Record<string, CompanyData> = {};
        for (const c of resolvedCompanies) {
          const rawEmps = data.employees?.[c.id] ?? (c.id === DEFAULT_COMPANY_ID ? INITIAL_EMPLOYEES : []);
          const rawShifts = data.shifts?.[c.id] ?? INITIAL_SHIFTS;
          const rawStations = data.stations?.[c.id] ?? (c.id === DEFAULT_COMPANY_ID ? INITIAL_STATIONS : []);
          const rawHolidays = data.holidays?.[c.id] ?? (c.id === DEFAULT_COMPANY_ID ? INITIAL_HOLIDAYS : []);
          const rawConfig = data.config?.[c.id] ?? {};
          const rawSchedules = data.allSchedules?.[c.id] ?? {};
          map[c.id] = {
            employees: normalizeEmployees(rawEmps),
            shifts: normalizeShifts(rawShifts),
            stations: normalizeStations(rawStations),
            holidays: normalizeHolidays(rawHolidays),
            config: normalizeConfig(rawConfig),
            allSchedules: normalizeAllSchedules(rawSchedules),
          };
        }
        setCompaniesState(resolvedCompanies);
        setActiveCompanyId(resolvedActive);
        setCompanyData(map);
        setDataLoaded(true);
      })
      .catch(err => {
        // Server unreachable on first load — fall back to defaults so the
        // app stays usable. Subsequent saves will still attempt to reach
        // the server and surface errors via the save badge.
        console.error('[Scheduler] Initial /api/data failed; falling back to defaults:', err);
        setCompaniesState(INITIAL_COMPANIES);
        setActiveCompanyId(DEFAULT_COMPANY_ID);
        setCompanyData({
          [DEFAULT_COMPANY_ID]: {
            employees: INITIAL_EMPLOYEES,
            shifts: INITIAL_SHIFTS,
            stations: INITIAL_STATIONS,
            holidays: INITIAL_HOLIDAYS,
            config: { ...DEFAULT_CONFIG },
            allSchedules: {},
          },
        });
        setDataLoaded(true);
        setSaveState('error');
      });
  }, []);

  // Persist active company id so a reload returns to the same context.
  useEffect(() => {
    if (!activeCompanyId) return;
    window.localStorage.setItem('iraqi-scheduler-active-company', activeCompanyId);
  }, [activeCompanyId]);

  // Post-update notice. The Electron main process snapshots the data folder
  // before the new version touches it; we surface a one-time confirmation so
  // the user knows their data is intact and where the rollback snapshot lives.
  useEffect(() => {
    if (!dataLoaded) return;
    fetch('/api/update-status')
      .then(r => r.ok ? r.json() : null)
      .then((status: null | { justUpdatedFrom: string | null; justUpdatedTo: string | null; mostRecentSnapshot: string | null }) => {
        if (!status || !status.justUpdatedTo) return;
        showInfo(
          t('info.updated.title', { version: status.justUpdatedTo }),
          t('info.updated.body', {
            from: status.justUpdatedFrom || 'previous',
            to: status.justUpdatedTo,
            snapshot: status.mostRecentSnapshot || t('info.updated.snapshotMissing'),
          }),
        );
        fetch('/api/update-status/ack', { method: 'POST' }).catch(() => {});
      })
      .catch(() => {/* non-critical */});
    // Run once after data load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded]);

  // Persistence sync to server. Sends the namespaced (Record<companyId, T>)
  // shape that the server now expects. Skipped during simulation mode so the
  // sandbox doesn't pollute on-disk state.
  useEffect(() => {
    if (!dataLoaded) return;
    if (simMode) return;
    const employeesByCo: Record<string, Employee[]> = {};
    const shiftsByCo: Record<string, Shift[]> = {};
    const holidaysByCo: Record<string, PublicHoliday[]> = {};
    const stationsByCo: Record<string, Station[]> = {};
    const configByCo: Record<string, Config> = {};
    const allSchedulesByCo: Record<string, Record<string, Schedule>> = {};
    for (const id of Object.keys(companyData)) {
      const cd = companyData[id];
      employeesByCo[id] = cd.employees;
      shiftsByCo[id] = cd.shifts;
      holidaysByCo[id] = cd.holidays;
      stationsByCo[id] = cd.stations;
      configByCo[id] = cd.config;
      allSchedulesByCo[id] = cd.allSchedules;
    }
    const body = {
      companies: { companies, activeCompanyId },
      employees: employeesByCo,
      shifts: shiftsByCo,
      holidays: holidaysByCo,
      stations: stationsByCo,
      config: configByCo,
      allSchedules: allSchedulesByCo,
    };

    setSaveState('pending');
    const timeout = setTimeout(() => {
      setSaveState('saving');
      fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(() => {
          setSaveState('saved');
          setLastSavedAt(Date.now());
        })
        .catch(err => {
          console.error('[Scheduler] Auto-save failed:', err);
          setSaveState('error');
        });
    }, 500);

    return () => clearTimeout(timeout);
  }, [companies, activeCompanyId, companyData, dataLoaded, simMode]);

  // Operational State
  const [paintMode, setPaintMode] = useState<{ shiftCode: string; stationId?: string } | null>(null);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [isStationModalOpen, setIsStationModalOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [scheduleRoleFilter, setScheduleRoleFilter] = useState<string>('all');
  const [paintWarnings, setPaintWarnings] = useState<{ empName: string; warnings: string[] } | null>(null);
  const paintWarningTimerRef = React.useRef<number | null>(null);
  // Coverage-gap suggestion toast. Populated when a manual paint vacates a
  // station-bound work shift; the toast lists swap candidates and offers a
  // one-click rebalance. Non-blocking — the user can always dismiss it.
  const [coverageHint, setCoverageHint] = useState<{ gap: CoverageGap; suggestions: CoverageSuggestion[] } | null>(null);
  // Cells the user just edited via the toast's swap action. Rendered with a
  // pulsing highlight in the schedule grid for ~5 seconds so the user can
  // see exactly which rows moved when the rebalance completes. Stored as
  // `${empId}:${day}` keys.
  const [recentlyChangedCells, setRecentlyChangedCells] = useState<Set<string>>(new Set());
  const recentlyChangedTimerRef = React.useRef<number | null>(null);
  const flashRecentlyChanged = React.useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setRecentlyChangedCells(prev => {
      const next = new Set(prev);
      keys.forEach(k => next.add(k));
      return next;
    });
    if (recentlyChangedTimerRef.current) window.clearTimeout(recentlyChangedTimerRef.current);
    recentlyChangedTimerRef.current = window.setTimeout(() => setRecentlyChangedCells(new Set()), 5000);
  }, []);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const backupInputRef = React.useRef<HTMLInputElement>(null);

  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);

  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<PublicHoliday | null>(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);

  // Lightweight info dialog — single OK button, no destructive action. Used
  // in place of native `alert()` so the message respects RTL layout and the
  // app's visual language. Title can be empty for plain-text confirmations.
  const [infoState, setInfoState] = useState<{ isOpen: boolean; title: string; message: string }>({
    isOpen: false, title: '', message: '',
  });
  const showInfo = React.useCallback((title: string, message: string) => {
    setInfoState({ isOpen: true, title, message });
  }, []);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    extraAction?: { label: string; onClick: () => void; icon?: any };
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const violations = useMemo(() => {
    const rawViolations = ComplianceEngine.check(employees, shifts, holidays, config, schedule, allSchedules);
    return rawViolations.filter(v => v.rule !== 'Weekly hours cap');
  }, [schedule, employees, shifts, config, holidays, allSchedules]);

  // Shared peak-day helper used by both the auto-scheduler and the coverage heatmap.
  const isPeakDay = React.useCallback((day: number): boolean => {
    const date = new Date(config.year, config.month - 1, day);
    const dayOfWeek = date.getDay() + 1; // 1=Sun, 7=Sat
    const holidayDates = new Set(holidays.map(h => h.date));
    return config.peakDays.includes(dayOfWeek) || holidayDates.has(format(date, 'yyyy-MM-dd'));
  }, [config, holidays]);

  // Schedule staleness — finds entries that reference shift codes / station ids
  // / employee ids that no longer exist. Surfaces a banner so the user can
  // re-run auto-scheduler instead of silently working with broken assignments.
  const scheduleStaleness = useMemo(() => {
    const validShifts = new Set(shifts.map(s => s.code));
    const validStations = new Set(stations.map(s => s.id));
    const validEmps = new Set(employees.map(e => e.empId));
    const orphanedEmpIds = new Set<string>();
    const orphanedShiftCodes = new Set<string>();
    const orphanedStationIds = new Set<string>();
    for (const empId of Object.keys(schedule)) {
      if (!validEmps.has(empId)) {
        orphanedEmpIds.add(empId);
        continue;
      }
      const days = schedule[empId];
      for (const dayStr of Object.keys(days)) {
        const entry = days[Number(dayStr)];
        if (!validShifts.has(entry.shiftCode)) orphanedShiftCodes.add(entry.shiftCode);
        if (entry.stationId && !validStations.has(entry.stationId)) orphanedStationIds.add(entry.stationId);
      }
    }
    const issues = orphanedEmpIds.size + orphanedShiftCodes.size + orphanedStationIds.size;
    return {
      isStale: issues > 0,
      orphanedEmpIds: Array.from(orphanedEmpIds),
      orphanedShiftCodes: Array.from(orphanedShiftCodes),
      orphanedStationIds: Array.from(orphanedStationIds),
    };
  }, [schedule, employees, shifts, stations]);

  const handleSaveEmployee = (emp: Employee) => {
    if (editingEmployee) {
      setEmployees(prev => prev.map(e => e.empId === editingEmployee.empId ? emp : e));
      // After a leave-date change, scan the active month for newly-vacated
      // station-bound work shifts. Pick the most-impactful one (largest peak
      // requirement) and surface a single hint so the user isn't spammed.
      const newlyOnLeave: number[] = [];
      const expandedRange = (
        oldStart: string | undefined, oldEnd: string | undefined,
        newStart: string | undefined, newEnd: string | undefined,
      ): { start: string; end: string } | null => {
        if (!newStart || !newEnd) return null;
        if (oldStart === newStart && oldEnd === newEnd) return null;
        return { start: newStart, end: newEnd };
      };
      const al = expandedRange(editingEmployee.annualLeaveStart, editingEmployee.annualLeaveEnd, emp.annualLeaveStart, emp.annualLeaveEnd);
      const sl = expandedRange(editingEmployee.sickLeaveStart, editingEmployee.sickLeaveEnd, emp.sickLeaveStart, emp.sickLeaveEnd);
      const mat = expandedRange(editingEmployee.maternityLeaveStart, editingEmployee.maternityLeaveEnd, emp.maternityLeaveStart, emp.maternityLeaveEnd);
      const ranges = [al, sl, mat].filter((r): r is { start: string; end: string } => !!r);
      if (ranges.length > 0) {
        for (let day = 1; day <= config.daysInMonth; day++) {
          const ds = format(new Date(config.year, config.month - 1, day), 'yyyy-MM-dd');
          if (ranges.some(r => ds >= r.start && ds <= r.end)) newlyOnLeave.push(day);
        }
        // Choose the single most-impactful affected day (highest required HC)
        // and surface a hint for it. Subsequent gaps surface naturally as the
        // user repaints.
        let best: { day: number; gap: CoverageGap } | null = null;
        for (const d of newlyOnLeave) {
          const prevEntry = schedule[emp.empId]?.[d];
          const gap = detectCoverageGap({
            employees, shifts, stations, holidays, config, schedule,
            empId: emp.empId, day: d, prevEntry, newEntry: undefined, isPeakDay,
          });
          if (!gap) continue;
          const need = isPeakDay(d) ? gap.station.peakMinHC : gap.station.normalMinHC;
          if (!best || need > (isPeakDay(best.day) ? best.gap.station.peakMinHC : best.gap.station.normalMinHC)) {
            best = { day: d, gap };
          }
        }
        if (best) {
          const suggestions = findSwapCandidates(best.gap, {
            employees, shifts, stations, holidays, config, schedule, isPeakDay,
          });
          setCoverageHint({ gap: best.gap, suggestions });
        }
      }
    } else {
      setEmployees(prev => [...prev, emp]);
    }
    setIsEmployeeModalOpen(false);
    setEditingEmployee(null);
  };

  const handleDeleteEmployee = (empId: string) => {
    setConfirmState({
      isOpen: true,
      title: t('confirm.removeEmp.title'),
      message: t('confirm.removeEmp.body', { id: empId }),
      onConfirm: () => {
        setEmployees(prev => prev.filter(e => e.empId !== empId));
        setSchedule(prev => {
          const next = { ...prev };
          delete next[empId];
          return next;
        });
        setSelectedEmployees(prev => {
          const next = new Set(prev);
          next.delete(empId);
          return next;
        });
      }
    });
  };

  const handleSaveShift = (shift: Shift) => {
    if (editingShift) {
      setShifts(prev => prev.map(s => s.code === editingShift.code ? shift : s));
    } else {
      setShifts(prev => [...prev, shift]);
    }
    setIsShiftModalOpen(false);
    setEditingShift(null);
  };

  const moveShift = (index: number, direction: 'up' | 'down') => {
    setShifts(prev => {
      const next = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleDeleteShift = (code: string) => {
    setConfirmState({
      isOpen: true,
      title: t('confirm.deleteShift.title'),
      message: t('confirm.deleteShift.body', { code }),
      onConfirm: () => {
        setShifts(prev => prev.filter(s => s.code !== code));
      }
    });
  };

  const toggleEmployeeSelection = (id: string) => {
    setSelectedEmployees(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    setConfirmState({
      isOpen: true,
      title: t('confirm.bulkRemove.title'),
      message: t('confirm.bulkRemove.body', { count: selectedEmployees.size }),
      onConfirm: () => {
        setEmployees(prev => prev.filter(e => !selectedEmployees.has(e.empId)));
        setSchedule(prev => {
          const next = { ...prev };
          selectedEmployees.forEach(id => delete next[id]);
          return next;
        });
        setSelectedEmployees(new Set());
      }
    });
  };

  const handleClearAllData = () => {
    setConfirmState({
      isOpen: true,
      title: t('confirm.factoryReset.title'),
      message: t('confirm.factoryReset.body'),
      extraAction: {
        label: t('confirm.factoryReset.backupFirst'),
        onClick: exportBackup,
        icon: Download
      },
      onConfirm: () => {
        fetch('/api/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' })
        })
          .then(r => r.ok ? r.json() : Promise.reject(r))
          .then(() => {
            localStorage.clear();
            showInfo(t('confirm.factoryReset.title'), t('info.factoryReset.body'));
            setTimeout(() => window.location.reload(), 1500);
          })
          .catch(() => showInfo(t('info.error.title'), t('info.factoryReset.failed')));
      }
    });
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      showInfo(t('info.error.title'), t('info.backup.invalidFile'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const raw = JSON.parse(event.target?.result as string);

        // Two valid backup shapes:
        //  1. Multi-company shape (post v1.6): top-level companies + per-domain Record<companyId, T>.
        //  2. Legacy single-company shape (pre v1.6): bare arrays / objects.
        const isMulti = raw.companies && raw.employees && typeof raw.employees === 'object' && !Array.isArray(raw.employees);

        if (!isMulti && (!raw.employees || !raw.shifts || !raw.config)) {
          throw new Error("Invalid backup format: Missing required fields (employees, shifts, config).");
        }

        setConfirmState({
          isOpen: true,
          title: t('confirm.importBackup.title'),
          message: t('confirm.importBackup.body'),
          onConfirm: () => {
            if (isMulti) {
              const importedCompanies = normalizeCompanies(raw.companies.companies || INITIAL_COMPANIES);
              const importedActive: string = raw.companies.activeCompanyId || importedCompanies[0]?.id || DEFAULT_COMPANY_ID;
              const map: Record<string, CompanyData> = {};
              for (const c of importedCompanies) {
                map[c.id] = {
                  employees: normalizeEmployees(raw.employees?.[c.id] ?? []),
                  shifts: normalizeShifts(raw.shifts?.[c.id] ?? INITIAL_SHIFTS),
                  stations: normalizeStations(raw.stations?.[c.id] ?? []),
                  holidays: normalizeHolidays(raw.holidays?.[c.id] ?? []),
                  config: normalizeConfig(raw.config?.[c.id] ?? {}),
                  allSchedules: normalizeAllSchedules(raw.allSchedules?.[c.id] ?? {}),
                };
              }
              setCompaniesState(importedCompanies);
              setActiveCompanyId(importedActive);
              setCompanyData(map);
            } else {
              // Legacy backup — wrap under DEFAULT_COMPANY_ID. Run through
              // the same migration normalisers so old field shapes upgrade.
              const cfg = normalizeConfig(raw.config ?? {});
              const allSched: Record<string, Schedule> = raw.allSchedules
                ? normalizeAllSchedules(raw.allSchedules)
                : (raw.schedule ? { [`scheduler_schedule_${cfg.year}_${cfg.month}`]: normalizeAllSchedules({ tmp: raw.schedule }).tmp } : {});
              const cd: CompanyData = {
                employees: normalizeEmployees(raw.employees ?? []),
                shifts: normalizeShifts(raw.shifts ?? INITIAL_SHIFTS),
                stations: normalizeStations(raw.stations ?? INITIAL_STATIONS),
                holidays: normalizeHolidays(raw.holidays ?? []),
                config: cfg,
                allSchedules: allSched,
              };
              setCompaniesState(INITIAL_COMPANIES);
              setActiveCompanyId(DEFAULT_COMPANY_ID);
              setCompanyData({ [DEFAULT_COMPANY_ID]: cd });
            }
            // Force one save and reload so the audit log captures the migration.
            setTimeout(() => window.location.reload(), 800);
          }
        });

      } catch (err) {
        showInfo(t('info.error.title'), t('info.backup.parseFailed', { msg: err instanceof Error ? err.message : 'Unknown error' }));
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  const handleQuitApp = () => {
    setConfirmState({
      isOpen: true,
      title: t('confirm.shutdown.title'),
      message: t('confirm.shutdown.body'),
      onConfirm: () => {
        // Force one last sync, then close the local server.
        const employeesByCo: Record<string, Employee[]> = {};
        const shiftsByCo: Record<string, Shift[]> = {};
        const holidaysByCo: Record<string, PublicHoliday[]> = {};
        const stationsByCo: Record<string, Station[]> = {};
        const configByCo: Record<string, Config> = {};
        const allSchedulesByCo: Record<string, Record<string, Schedule>> = {};
        for (const id of Object.keys(companyData)) {
          const cd = companyData[id];
          employeesByCo[id] = cd.employees;
          shiftsByCo[id] = cd.shifts;
          holidaysByCo[id] = cd.holidays;
          stationsByCo[id] = cd.stations;
          configByCo[id] = cd.config;
          allSchedulesByCo[id] = cd.allSchedules;
        }
        const body = {
          companies: { companies, activeCompanyId },
          employees: employeesByCo, shifts: shiftsByCo, holidays: holidaysByCo,
          stations: stationsByCo, config: configByCo, allSchedules: allSchedulesByCo,
        };
        fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(() => {
          fetch('/api/shutdown', { method: 'POST' })
            .then(() => {
              showInfo(t('confirm.shutdown.title'), t('info.shutdown.body'));
              setTimeout(() => window.close(), 1000);
            });
        });
      }
    });
  };

  const loadSampleData = () => {
    setStations(INITIAL_STATIONS);
    setEmployees(INITIAL_EMPLOYEES);
    setSchedule({});
    showInfo(t('info.seed.title'), t('info.seed.body'));
  };

  const exportBackup = () => {
    // Multi-company backup: includes everything we persist on the server.
    const employeesByCo: Record<string, Employee[]> = {};
    const shiftsByCo: Record<string, Shift[]> = {};
    const holidaysByCo: Record<string, PublicHoliday[]> = {};
    const stationsByCo: Record<string, Station[]> = {};
    const configByCo: Record<string, Config> = {};
    const allSchedulesByCo: Record<string, Record<string, Schedule>> = {};
    for (const id of Object.keys(companyData)) {
      const cd = companyData[id];
      employeesByCo[id] = cd.employees;
      shiftsByCo[id] = cd.shifts;
      holidaysByCo[id] = cd.holidays;
      stationsByCo[id] = cd.stations;
      configByCo[id] = cd.config;
      allSchedulesByCo[id] = cd.allSchedules;
    }
    const data = {
      companies: { companies, activeCompanyId },
      employees: employeesByCo, shifts: shiftsByCo, holidays: holidaysByCo,
      stations: stationsByCo, config: configByCo, allSchedules: allSchedulesByCo,
      version: APP_VERSION,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Scheduler_Backup_${format(new Date(), 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      const newEmployees: Employee[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 2) continue;

        const [id, name, role, dept, type, hrs, salary, category] = cols;
        const cat = category?.trim() === 'Driver' ? 'Driver' : 'Standard';
        newEmployees.push({
          empId: id || `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
          name: name || 'Unnamed',
          role: role || 'General Staff',
          department: dept || 'Warehouse',
          contractType: type || 'Permanent',
          contractedWeeklyHrs: parseInt(hrs) || 48,
          shiftEligibility: 'All',
          isHazardous: false,
          isIndustrialRotating: true,
          hourExempt: false,
          fixedRestDay: 0,
          phone: '',
          hireDate: format(new Date(), 'yyyy-MM-dd'),
          notes: 'Imported via CSV',
          eligibleStations: [],
          holidayBank: 0,
          annualLeaveBalance: 21,
          baseMonthlySalary: parseInt(salary) || DEFAULT_MONTHLY_SALARY_IQD,
          baseHourlyRate: Math.round(
            baseHourlyRate(
              { baseMonthlySalary: parseInt(salary) || DEFAULT_MONTHLY_SALARY_IQD, contractedWeeklyHrs: parseInt(hrs) || 48 },
              config,
            ),
          ),
          overtimeHours: 0,
          category: cat
        });
      }

      if (newEmployees.length > 0) {
        setEmployees(prev => [...prev, ...newEmployees]);
        showInfo(t('info.csvImport.title'), t('info.csvImport.body', { count: newEmployees.length }));
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const exportScheduleCSV = () => {
    const headers = ['Employee ID', 'Name', ...Array.from({ length: config.daysInMonth }, (_, i) => `Day ${i + 1}`)];
    const rows = employees.map(emp => {
      const cells: string[] = [csvCell(emp.empId), csvCell(emp.name)];
      for (let i = 1; i <= config.daysInMonth; i++) {
        const entry = schedule[emp.empId]?.[i];
        cells.push(csvCell(typeof entry === 'string' ? entry : entry?.shiftCode || ''));
      }
      return cells.join(',');
    });
    const csvContent = [headers.map(csvCell).join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Schedule_Export_${config.year}_${config.month}.csv`;
    a.click();
  };

  const downloadRosterTemplate = () => {
    const csvContent = "Employee ID,Employee Name,Role,Department,Contract Type,Weekly Hours,Base Salary,Category\nEMP-1100,John Doe,Operator,Warehouse,Permanent,48,1500000,Standard\nEMP-3100,Ali Driver,Driver,Transport,Permanent,56,1400000,Driver";
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Roster_Import_Template.csv';
    a.click();
  };

  const handleSaveStation = (st: Station) => {
    if (selectedStation) {
      setStations(prev => prev.map(s => s.id === selectedStation.id ? st : s));
    } else {
      setStations(prev => [...prev, st]);
    }
    setIsStationModalOpen(false);
    setSelectedStation(null);
  };

  const nextMonth = () => {
    const next = addMonths(new Date(config.year, config.month - 1, 1), 1);
    setConfig(prev => ({
      ...prev,
      year: next.getFullYear(),
      month: next.getMonth() + 1,
      daysInMonth: getDaysInMonth(next),
    }));
  };

  const prevMonth = () => {
    const prev = subMonths(new Date(config.year, config.month - 1, 1), 1);
    setConfig(last => ({
      ...last,
      year: prev.getFullYear(),
      month: prev.getMonth() + 1,
      daysInMonth: getDaysInMonth(prev),
    }));
  };

  // Preview-then-apply for the auto-scheduler.
  const [pendingScheduleResult, setPendingScheduleResult] = useState<{
    schedule: Schedule;
    employees: Employee[];
    stats: ReturnType<typeof buildPreviewStats>;
  } | null>(null);
  const [scheduleUndoStack, setScheduleUndoStack] = useState<Array<{ schedule: Schedule; employees: Employee[]; appliedAt: number }>>([]);

  // `mode` controls whether the scheduler builds a fresh schedule
  // (`fresh`) or fills around the user's existing entries (`preserve`).
  // The "Optimal (Preserve Absences)" button on the Schedule tab passes
  // `preserve` so manual leave / vacation / shift edits stay locked.
  const handleRunAutoScheduler = (mode: 'fresh' | 'preserve' = 'fresh') => {
    try {
      const { schedule: newSchedule, updatedEmployees } = runAutoScheduler({
        employees, shifts, stations, holidays, config, isPeakDay,
        // Pass the entire allSchedules map so the rolling-7-day window can
        // see the trailing days of the prior month.
        allSchedules,
        // In preserve mode, the existing month's schedule is treated as a
        // set of locked cells the algorithm fills around.
        preserveExisting: mode === 'preserve' ? schedule : undefined,
      });

      const previewViolations = ComplianceEngine
        .check(updatedEmployees, shifts, holidays, config, newSchedule, allSchedules)
        .filter(v => v.rule !== 'Weekly hours cap');

      let totalRequired = 0;
      let totalFilled = 0;
      for (const st of stations) {
        const open = parseHour(st.openingTime);
        const close = parseHour(st.closingTime);
        for (let day = 1; day <= config.daysInMonth; day++) {
          const peak = isPeakDay(day);
          const need = peak ? st.peakMinHC : st.normalMinHC;
          if (need <= 0) continue;
          totalRequired += need;
          for (let h = open; h < close; h++) {
            let covered = 0;
            for (const emp of updatedEmployees) {
              const a = newSchedule[emp.empId]?.[day];
              if (!a || a.stationId !== st.id) continue;
              const sh = shifts.find(s => s.code === a.shiftCode);
              if (!sh) continue;
              const sH = parseHour(sh.start);
              const eH = parseHour(sh.end);
              if (h >= sH && h < eH) { covered++; break; }
            }
            if (covered >= need) { totalFilled += need; break; }
          }
        }
      }

      const stats = buildPreviewStats(
        newSchedule, shifts, updatedEmployees, previewViolations,
        config.daysInMonth, totalRequired, totalFilled,
      );

      setPendingScheduleResult({ schedule: newSchedule, employees: updatedEmployees, stats });
    } catch (e) {
      showInfo(t('info.error.title'), e instanceof Error ? e.message : 'Auto-scheduler failed.');
    }
  };

  const applyPendingSchedule = () => {
    if (!pendingScheduleResult) return;
    setScheduleUndoStack(prev => [
      { schedule, employees, appliedAt: Date.now() },
      ...prev,
    ].slice(0, 5));
    setEmployees(pendingScheduleResult.employees);
    setSchedule(pendingScheduleResult.schedule);
    setPendingScheduleResult(null);
  };

  const undoLastSchedule = () => {
    if (scheduleUndoStack.length === 0) return;
    const [last, ...rest] = scheduleUndoStack;
    setEmployees(last.employees);
    setSchedule(last.schedule);
    setScheduleUndoStack(rest);
  };

  // PDF lazy-load. Pulls jspdf + jspdf-autotable + html2canvas only on first use.
  const handleExportPDF = async () => {
    const { generatePDFReport } = await import('./lib/pdfReport');
    generatePDFReport(employees, schedule, shifts, { ...config, holidays }, violations, stations, t);
  };

  const handleSaveHoliday = (holi: PublicHoliday) => {
    setHolidays(prev => {
      const idx = prev.findIndex(h => h.date === holi.date);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = holi;
        return next;
      }
      return [...prev, holi];
    });
    setIsHolidayModalOpen(false);
  };

  // Hourly coverage analysis. Honors per-day-of-week opening/closing
  // overrides on Config so a Friday with a 10am→2am window is heat-mapped
  // beyond the default close hour.
  const hourlyCoverage = useMemo(() => {
    // Pick the union of [open, close) across every day so the heatmap has a
    // single x-axis. Days with shorter windows simply leave their later
    // hours zeroed out.
    let unionStart = 24;
    let unionEnd = 0;
    for (let dow = 1; dow <= 7; dow++) {
      const { open, close } = getOperatingHoursForDow(config, dow as DayOfWeek);
      const o = parseHour(open);
      const c = parseHour(close);
      if (o < unionStart) unionStart = o;
      if (c > unionEnd) unionEnd = c;
    }
    if (unionStart >= unionEnd) {
      unionStart = parseHour(config.shopOpeningTime || '11:00');
      unionEnd = parseHour(config.shopClosingTime || '23:00');
    }
    const hours = Array.from({ length: Math.max(0, unionEnd - unionStart) }, (_, i) => unionStart + i);

    const coverage: Record<number, Record<number, number>> = {};
    const dailyRequirements: Record<number, Record<number, number>> = {};
    const shiftMap = new Map<string, Shift>(shifts.map(s => [s.code, s]));

    for (let d = 1; d <= config.daysInMonth; d++) {
      const date = new Date(config.year, config.month - 1, d);
      const dow = (date.getDay() + 1) as DayOfWeek;
      const { open: openStr, close: closeStr } = getOperatingHoursForDow(config, dow);
      const dayOpen = parseHour(openStr);
      const dayClose = parseHour(closeStr);
      coverage[d] = {};
      dailyRequirements[d] = {};
      const peak = isPeakDay(d);

      hours.forEach(h => {
        coverage[d][h] = 0;
        // Outside the day's operating window → no requirement.
        const insideDayWindow = h >= dayOpen && h < dayClose;
        dailyRequirements[d][h] = insideDayWindow
          ? stations.reduce((sum, st) => {
              const oh = parseHour(st.openingTime);
              const ch = parseHour(st.closingTime);
              if (h >= oh && h < ch) return sum + (peak ? st.peakMinHC : st.normalMinHC);
              return sum;
            }, 0)
          : 0;
      });

      employees.forEach(emp => {
        const entry = schedule[emp.empId]?.[d];
        const scode = entry?.shiftCode;
        const shift = shiftMap.get(scode || '') as Shift | undefined;
        if (shift && shift.isWork) {
          const sH = parseHour(shift.start);
          const eH = parseHour(shift.end);
          hours.forEach(h => {
             if (h >= sH && h < eH) coverage[d][h]++;
          });
        }
      });
    }
    return { hours, coverage, requirements: dailyRequirements };
  }, [employees, schedule, shifts, config, stations, isPeakDay]);

  const staffingGapsByStation = useMemo(() => {
    type StationGap = { stationId: string; stationName: string; gap: number; roleHint?: string };
    const out: StationGap[] = [];
    const shiftMap = new Map(shifts.map(s => [s.code, s]));
    const isGenericRole = (r: string) => r === 'Standard' || r === '';

    for (const st of stations) {
      const open = parseHour(st.openingTime);
      const close = parseHour(st.closingTime);
      let maxStationGap = 0;

      for (let day = 1; day <= config.daysInMonth; day++) {
        const peak = isPeakDay(day);
        const required = peak ? st.peakMinHC : st.normalMinHC;
        if (required <= 0) continue;

        for (let h = open; h < close; h++) {
          let covered = 0;
          for (const emp of employees) {
            const a = schedule[emp.empId]?.[day];
            if (!a || a.stationId !== st.id) continue;
            const sh = shiftMap.get(a.shiftCode);
            if (!sh) continue;
            const sH = parseHour(sh.start);
            const eH = parseHour(sh.end);
            if (h >= sH && h < eH) covered++;
          }
          const gap = required - covered;
          if (gap > maxStationGap) maxStationGap = gap;
        }
      }

      if (maxStationGap <= 0) continue;

      const explicit = st.requiredRoles?.find(r => !isGenericRole(r));
      out.push({
        stationId: st.id,
        stationName: st.name,
        gap: maxStationGap,
        roleHint: explicit,
      });
    }

    return out.sort((a, b) => b.gap - a.gap);
  }, [employees, stations, schedule, shifts, config, isPeakDay]);

  const rosterRoles = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { if (e.role) set.add(e.role); });
    const list = Array.from(set).sort();
    if (list.includes('Driver')) {
      return ['Driver', ...list.filter(r => r !== 'Driver')];
    }
    return list;
  }, [employees]);

  const filteredScheduleEmployees = useMemo(() => {
    const q = scheduleFilter.trim().toLowerCase();
    return employees.filter(e => {
      if (scheduleRoleFilter !== 'all' && e.role !== scheduleRoleFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.empId.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q)
      );
    });
  }, [employees, scheduleFilter, scheduleRoleFilter]);

  const coverageMetrics = useMemo(() => {
    let totalRequired = 0;
    let totalCovered = 0;
    let peakRequired = 0;
    let peakCovered = 0;
    for (let day = 1; day <= config.daysInMonth; day++) {
      const peak = isPeakDay(day);
      const dayCoverage = hourlyCoverage.coverage[day] || {};
      const dayRequirements = hourlyCoverage.requirements[day] || {};
      for (const hour of hourlyCoverage.hours) {
        const need = dayRequirements[hour] || 0;
        if (need <= 0) continue;
        const got = Math.min(need, dayCoverage[hour] || 0);
        totalRequired += need;
        totalCovered += got;
        if (peak) {
          peakRequired += need;
          peakCovered += got;
        }
      }
    }
    return {
      overall: totalRequired === 0 ? 100 : Math.round((totalCovered / totalRequired) * 100),
      peak: peakRequired === 0 ? 100 : Math.round((peakCovered / peakRequired) * 100),
    };
  }, [config.daysInMonth, hourlyCoverage, isPeakDay]);
  const peakStabilityPercent = coverageMetrics.peak;
  const overallCoveragePercent = coverageMetrics.overall;

  // Total OT hours and pay for the active schedule. Surfaced in the simulation
  // delta panel and the Dashboard FTE forecast.
  const otSummary = useMemo(() => {
    const cap = monthlyHourCap(config);
    const otRateDay = config.otRateDay ?? 1.5;
    const otRateNight = config.otRateNight ?? 2.0;
    const holidayDateSet = new Set(holidays.map(h => h.date));
    const shiftByCode = new Map(shifts.map(s => [s.code, s]));
    let totalOTHours = 0;
    let totalOTPay = 0;
    let totalWorkHours = 0;
    for (const emp of employees) {
      const empSched = schedule[emp.empId] || {};
      let totalHrs = 0;
      let holiHrs = 0;
      for (const [dayStr, entry] of Object.entries(empSched)) {
        const dateStr = format(new Date(config.year, config.month - 1, parseInt(dayStr)), 'yyyy-MM-dd');
        const shift = shiftByCode.get(entry.shiftCode);
        if (!shift?.isWork) continue;
        totalHrs += shift.durationHrs;
        if (holidayDateSet.has(dateStr)) holiHrs += shift.durationHrs;
      }
      totalWorkHours += totalHrs;
      const hourly = baseHourlyRate(emp, config);
      const stdOT = Math.max(0, totalHrs - cap - holiHrs);
      totalOTHours += Math.max(0, totalHrs - cap);
      totalOTPay += stdOT * hourly * otRateDay + holiHrs * hourly * otRateNight;
    }
    const potentialHires = Math.ceil(totalOTHours / Math.max(1, cap));
    return { totalOTHours, totalOTPay, potentialHires, totalWorkHours };
  }, [employees, schedule, shifts, holidays, config]);

  // Run coverage-gap detection after a paint that may have removed a station
  // assignment. If a gap is found, queue up swap suggestions for the toast.
  const surfaceCoverageHint = React.useCallback(
    (empId: string, day: number, prevEntry: { shiftCode: string; stationId?: string } | undefined, newEntry: { shiftCode: string; stationId?: string } | undefined) => {
      const gap = detectCoverageGap({
        employees, shifts, stations, holidays, config, schedule,
        empId, day, prevEntry, newEntry, isPeakDay,
      });
      if (!gap) return;
      const suggestions = findSwapCandidates(gap, {
        employees, shifts, stations, holidays, config, schedule, isPeakDay,
      });
      setCoverageHint({ gap, suggestions });
    },
    [employees, shifts, stations, holidays, config, schedule, isPeakDay],
  );

  const handleCellClick = (empId: string, day: number) => {
    const prev = schedule[empId]?.[day];
    if (paintMode) {
      const emp = employees.find(e => e.empId === empId);
      if (emp) {
        const warnings = previewAssignmentWarnings(emp, day, paintMode.shiftCode, schedule, shifts, holidays, config);
        if (warnings.length > 0) {
          setPaintWarnings({ empName: emp.name, warnings });
          if (paintWarningTimerRef.current) window.clearTimeout(paintWarningTimerRef.current);
          paintWarningTimerRef.current = window.setTimeout(() => setPaintWarnings(null), 5000);
        } else {
          setPaintWarnings(null);
        }
      }
      const next = { shiftCode: paintMode.shiftCode, stationId: paintMode.stationId };
      setSchedule(p => ({
        ...p,
        [empId]: {
          ...(p[empId] || {}),
          [day]: next,
        }
      }));
      surfaceCoverageHint(empId, day, prev, next);
    } else {
      const entry = schedule[empId]?.[day];
      const current = typeof entry === 'string' ? entry : entry?.shiftCode || '';
      const idx = shifts.findIndex(s => s.code === current);
      const nextShift = shifts[(idx + 1) % shifts.length];
      const next = { shiftCode: nextShift.code };
      setSchedule(p => ({
        ...p,
        [empId]: {
          ...(p[empId] || {}),
          [day]: next,
        }
      }));
      surfaceCoverageHint(empId, day, prev, next);
    }
  };

  // User picked a swap candidate from the coverage hint toast. Move the
  // vacated shift onto the chosen employee. The move overwrites whatever
  // they had on that day — usually OFF, occasionally another work shift
  // (the toast warned about this when the candidate was already assigned).
  // Both the original cell (the one that opened the gap) and the chosen
  // candidate's cell flash briefly so the user sees what moved.
  const acceptCoverageSwap = (replacementEmpId: string) => {
    if (!coverageHint) return;
    const { gap } = coverageHint;
    setSchedule(prev => ({
      ...prev,
      [replacementEmpId]: {
        ...(prev[replacementEmpId] || {}),
        [gap.day]: { shiftCode: gap.vacatedShiftCode, stationId: gap.station.id },
      },
    }));
    flashRecentlyChanged([
      `${replacementEmpId}:${gap.day}`,
      `${gap.vacatedEmpId}:${gap.day}`,
    ]);
    setCoverageHint(null);
  };

  // Live-refresh the open coverage-hint toast as the schedule evolves. The
  // user might keep editing after the toast appears — without this, the
  // candidate list goes stale (shows employees who are no longer off, or
  // omits employees who just became free). If the gap has been filled by
  // another edit, dismiss the toast so it stops asking the user to fix
  // something that no longer exists.
  useEffect(() => {
    if (!coverageHint) return;
    const { gap } = coverageHint;
    // Has the gap been filled in the meantime? Count current work-shift
    // assignments at the same station on the same day.
    const stationFilled = employees.some(e => {
      const entry = schedule[e.empId]?.[gap.day];
      if (!entry || entry.stationId !== gap.station.id) return false;
      const sh = shifts.find(s => s.code === entry.shiftCode);
      return !!sh?.isWork;
    });
    if (stationFilled) {
      setCoverageHint(null);
      return;
    }
    // Still gapped — refresh suggestions against the current schedule.
    const fresh = findSwapCandidates(gap, {
      employees, shifts, stations, holidays, config, schedule, isPeakDay,
    });
    // Avoid infinite loops: only update if the suggestion list actually changed.
    const prevKey = coverageHint.suggestions.map(s => s.empId).join('|');
    const nextKey = fresh.map(s => s.empId).join('|');
    if (prevKey !== nextKey) {
      setCoverageHint({ gap, suggestions: fresh });
    }
  }, [schedule, employees, shifts, stations, holidays, config, isPeakDay, coverageHint]);

  // Multi-company actions ---
  const switchCompany = (id: string) => {
    if (id === activeCompanyId) return;
    if (simMode) {
      // Don't let the user jump between companies mid-simulation — the
      // baseline snapshot only covers the slice they entered with.
      showInfo(t('sim.banner.title'), t('sim.locked.companyChange'));
      return;
    }
    setActiveCompanyId(id);
    setPaintMode(null);
    setPendingScheduleResult(null);
    setScheduleUndoStack([]);
    setSelectedEmployees(new Set());
  };

  const addCompany = (name: string) => {
    const id = `co-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setCompaniesState(prev => [...prev, { id, name, color: '#4f46e5' }]);
    setCompanyData(prev => ({
      ...prev,
      [id]: {
        ...emptyCompanyData(),
        config: { ...DEFAULT_CONFIG, company: name },
      },
    }));
  };

  const renameCompany = (id: string, name: string) => {
    setCompaniesState(prev => prev.map(c => c.id === id ? { ...c, name } : c));
    setCompanyData(prev => prev[id]
      ? { ...prev, [id]: { ...prev[id], config: { ...prev[id].config, company: name } } }
      : prev);
  };

  const deleteCompany = (id: string) => {
    if (companies.length <= 1) {
      showInfo(t('company.cannotDelete.title'), t('company.cannotDelete.body'));
      return;
    }
    const target = companies.find(c => c.id === id);
    setConfirmState({
      isOpen: true,
      title: t('company.confirmDelete.title'),
      message: t('company.confirmDelete.body', { name: target?.name || id }),
      onConfirm: () => {
        const remaining = companies.filter(c => c.id !== id);
        setCompaniesState(remaining);
        setCompanyData(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (activeCompanyId === id) setActiveCompanyId(remaining[0].id);
      },
    });
  };

  const handleDeleteHoliday = (date: string) => {
    setConfirmState({
      isOpen: true,
      title: t('confirm.removeHoliday.title'),
      message: t('confirm.removeHoliday.body', { date }),
      onConfirm: () => {
        setHolidays(prev => prev.filter(h => h.date !== date));
      }
    });
  };

  // --- Simulation mode ---
  const enterSimMode = () => {
    if (simMode) return;
    setSimBaseline({
      companies: structuredClone(companies),
      activeCompanyId,
      companyData: structuredClone(companyData),
    });
    setSimMode(true);
  };
  const exitSimMode = () => {
    if (!simMode || !simBaseline) return;
    // Discard sim changes — restore baseline.
    setCompaniesState(simBaseline.companies);
    setActiveCompanyId(simBaseline.activeCompanyId);
    setCompanyData(simBaseline.companyData);
    setSimBaseline(null);
    setSimMode(false);
  };
  const applySimMode = () => {
    if (!simMode) return;
    // Keep current sim state; drop baseline so the next save persists it.
    setSimBaseline(null);
    setSimMode(false);
  };
  const resetSimMode = () => {
    if (!simMode || !simBaseline) return;
    setCompaniesState(simBaseline.companies);
    setActiveCompanyId(simBaseline.activeCompanyId);
    setCompanyData(simBaseline.companyData);
  };

  // Compute baseline metrics for the sim delta panel. Mirrors the live OT
  // summary + coverage but pulled from the frozen baseline snapshot.
  const simMetrics: SimDeltaMetric[] = useMemo(() => {
    if (!simMode || !simBaseline) return [];
    const baselineActive = simBaseline.companyData[simBaseline.activeCompanyId];
    if (!baselineActive) return [];
    const baseScheduleKey = `scheduler_schedule_${baselineActive.config.year}_${baselineActive.config.month}`;
    const baseSchedule = baselineActive.allSchedules[baseScheduleKey] ?? {};
    const baseShiftByCode = new Map(baselineActive.shifts.map(s => [s.code, s]));
    const baseHolidayDates = new Set(baselineActive.holidays.map(h => h.date));
    const baseCap = monthlyHourCap(baselineActive.config);
    let baseOTHrs = 0;
    let baseOTPay = 0;
    for (const emp of baselineActive.employees) {
      const empSched = baseSchedule[emp.empId] || {};
      let totalHrs = 0;
      let holiHrs = 0;
      for (const [dayStr, entry] of Object.entries(empSched)) {
        const dateStr = format(new Date(baselineActive.config.year, baselineActive.config.month - 1, parseInt(dayStr)), 'yyyy-MM-dd');
        const shift = baseShiftByCode.get(entry.shiftCode);
        if (!shift?.isWork) continue;
        totalHrs += shift.durationHrs;
        if (baseHolidayDates.has(dateStr)) holiHrs += shift.durationHrs;
      }
      const hourly = baseHourlyRate(emp, baselineActive.config);
      const stdOT = Math.max(0, totalHrs - baseCap - holiHrs);
      baseOTHrs += Math.max(0, totalHrs - baseCap);
      baseOTPay += stdOT * hourly * (baselineActive.config.otRateDay ?? 1.5) + holiHrs * hourly * (baselineActive.config.otRateNight ?? 2.0);
    }
    const baseViolations = ComplianceEngine
      .check(baselineActive.employees, baselineActive.shifts, baselineActive.holidays, baselineActive.config, baseSchedule, baselineActive.allSchedules)
      .filter(v => v.rule !== 'Weekly hours cap')
      .reduce((s, v) => s + (v.count || 1), 0);

    const fmtIQD = (n: number) => `${Math.round(n).toLocaleString()}`;
    return [
      { label: t('sim.metric.workforce'), baseline: baselineActive.employees.length, sim: employees.length, higherIsBetter: true },
      { label: t('sim.metric.coverage'), baseline: 0, sim: overallCoveragePercent, higherIsBetter: true, formatter: (n: number) => `${n}%` },
      { label: t('sim.metric.otHours'), baseline: Math.round(baseOTHrs), sim: Math.round(otSummary.totalOTHours), higherIsBetter: false, formatter: (n: number) => `${n}h` },
      { label: t('sim.metric.otPay'), baseline: Math.round(baseOTPay), sim: Math.round(otSummary.totalOTPay), higherIsBetter: false, formatter: fmtIQD },
      { label: t('sim.metric.violations'), baseline: baseViolations, sim: violations.reduce((s, v) => s + (v.count || 1), 0), higherIsBetter: false },
    ];
    // Coverage on baseline isn't recomputed here — it would need its own
    // hourlyCoverage pass. We surface live coverage delta only (baseline shown as 0 for rendering).
  }, [simMode, simBaseline, employees.length, overallCoveragePercent, otSummary, violations, t]);

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportCSV}
        className="hidden"
        accept=".csv"
      />
      <input
        type="file"
        ref={backupInputRef}
        onChange={handleImportBackup}
        className="hidden"
        accept=".json"
      />
      <div className="flex h-screen bg-[#F3F4F6] font-sans text-slate-800 overflow-hidden">
      {/* Left Navigation Rail */}
      <aside className="w-64 bg-[#1E293B] flex flex-col border-r border-slate-700 shrink-0">
        <div className="p-6 border-b border-slate-700 bg-[#0F172A]">
          <h1 className="text-white font-bold tracking-tight text-lg uppercase">{t('sidebar.brand.line1')}</h1>
          <p className="text-blue-400 text-[10px] uppercase tracking-widest font-bold mt-1">{t('sidebar.brand.line2')} v{APP_VERSION}</p>
        </div>

        {/* Company switcher */}
        {dataLoaded && (
          <div className="p-3 border-b border-slate-700/60">
            <CompanySwitcher
              companies={companies}
              activeCompanyId={activeCompanyId}
              onSwitch={switchCompany}
              onAdd={addCompany}
              onRename={renameCompany}
              onDelete={deleteCompany}
              locked={simMode}
            />
          </div>
        )}

        <nav className="flex-1 py-4 overflow-y-auto">
          <TabButton active={activeTab === 'dashboard'} label={t('tab.dashboard')} index="01" icon={BarChart3} onClick={() => setActiveTab('dashboard')} />
          <TabButton active={activeTab === 'roster'} label={t('tab.roster')} index="02" icon={Users} onClick={() => setActiveTab('roster')} />
          <TabButton active={activeTab === 'shifts'} label={t('tab.shifts')} index="03" icon={Clock} onClick={() => setActiveTab('shifts')} />
          <TabButton active={activeTab === 'payroll'} label={t('tab.payroll')} index="04" icon={BarChart3} onClick={() => setActiveTab('payroll')} />
          <TabButton active={activeTab === 'holidays'} label={t('tab.holidays')} index="05" icon={Flag} onClick={() => setActiveTab('holidays')} />
          <TabButton active={activeTab === 'layout'} label={t('tab.layout')} index="06" icon={Layout} onClick={() => setActiveTab('layout')} />
          <TabButton active={activeTab === 'schedule'} label={t('tab.schedule')} index="07" icon={Calendar} onClick={() => setActiveTab('schedule')} />
          <TabButton active={activeTab === 'reports'} label={t('tab.reports')} index="08" icon={FileSpreadsheet} onClick={() => setActiveTab('reports')} />
          <TabButton active={activeTab === 'variables'} label={t('tab.variables')} index="09" icon={Scale} onClick={() => setActiveTab('variables')} />
          <TabButton active={activeTab === 'audit'} label={t('tab.audit')} index="10" icon={Database} onClick={() => setActiveTab('audit')} />
          <TabButton active={activeTab === 'settings'} label={t('tab.settings')} index="11" icon={Settings} onClick={() => setActiveTab('settings')} />
        </nav>

        <div className="p-4 border-t border-slate-700 bg-[#0F172A]/50 space-y-2">
          <LocaleSwitcher />
          <button
            onClick={handleClearAllData}
            className="w-full flex items-center gap-3 px-4 py-2 text-[10px] font-black text-rose-400 uppercase tracking-widest hover:bg-rose-500/10 rounded-lg transition-all"
          >
            <Trash2 className="w-4 h-4" />
            {t('sidebar.factoryReset')}
          </button>
          <button
            onClick={handleQuitApp}
            className="w-full flex items-center gap-3 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg shadow-red-900/20"
          >
            <X className="w-4 h-4" />
            {t('sidebar.quitApp')}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Toolbar */}
        <header className={cn(
          "h-16 border-b px-8 flex items-center justify-between shrink-0 transition-colors",
          simMode ? "bg-indigo-50 border-indigo-200" : "bg-white border-slate-200"
        )}>
          <div className="flex gap-2">
            <button
              onClick={exportScheduleCSV}
              className="px-5 py-1.5 bg-slate-900 border border-slate-700 rounded text-[10px] font-bold text-white uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg active:scale-95 flex items-center gap-2"
            >
              <Download className="w-3 h-3" />
              {t('toolbar.exportSchedule')}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-1.5 bg-white border border-slate-300 rounded text-[10px] font-bold text-slate-700 uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm active:scale-95 flex items-center gap-2"
            >
              <FileSpreadsheet className="w-3 h-3 text-emerald-600" />
              {t('toolbar.massImport')}
            </button>
            <button
              onClick={downloadRosterTemplate}
              className="px-5 py-1.5 bg-white border border-slate-300 rounded text-[10px] font-bold text-slate-700 uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm active:scale-95"
            >
              {t('toolbar.csvTemplate')}
            </button>
            <button
              onClick={simMode ? exitSimMode : enterSimMode}
              className={cn(
                "px-5 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all shadow-sm active:scale-95 flex items-center gap-2 border",
                simMode
                  ? "bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700"
                  : "bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50"
              )}
            >
              <FlaskConical className="w-3 h-3" />
              {simMode ? t('sim.toolbar.exit') : t('sim.toolbar.enter')}
            </button>
          </div>
          <div className="flex items-center gap-3" aria-live="polite">
            {(() => {
              const dotColor =
                simMode ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)] animate-pulse' :
                saveState === 'error' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]' :
                saveState === 'saving' ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse' :
                saveState === 'pending' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
                'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
              const label =
                simMode ? t('sim.toolbar.statusLabel') :
                saveState === 'error' ? t('toolbar.saveError') :
                saveState === 'saving' ? t('toolbar.saving') :
                saveState === 'pending' ? t('toolbar.savePending') :
                lastSavedAt ? t('toolbar.savedAt', { time: format(new Date(lastSavedAt), 'HH:mm:ss') }) :
                t('toolbar.statusLabel');
              return (
                <>
                  <div className={cn("h-2.5 w-2.5 rounded-full", dotColor)} />
                  <span className="text-[10px] text-slate-500 font-mono tracking-tighter uppercase font-bold">{label}</span>
                </>
              );
            })()}
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <Suspense fallback={
              <div className="flex items-center justify-center py-32">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">{t('app.loadingTab')}</div>
              </div>
            }>
            {activeTab === 'dashboard' && (
              <DashboardTab
                employees={employees}
                shifts={shifts}
                holidays={holidays}
                config={config}
                schedule={schedule}
                stations={stations}
                violations={violations}
                staffingGapsByStation={staffingGapsByStation}
                hourlyCoverage={hourlyCoverage}
                peakStabilityPercent={peakStabilityPercent}
                overallCoveragePercent={overallCoveragePercent}
                isStatsModalOpen={isStatsModalOpen}
                setIsStatsModalOpen={setIsStatsModalOpen}
                prevMonth={prevMonth}
                nextMonth={nextMonth}
                onGoToRoster={() => setActiveTab('roster')}
                onLoadSample={loadSampleData}
              />
            )}

            {activeTab === 'payroll' && (
              <PayrollTab
                employees={employees}
                schedule={schedule}
                shifts={shifts}
                holidays={holidays}
                config={config}
                onExport={exportScheduleCSV}
              />
            )}

            {activeTab === 'roster' && (
              <RosterTab
                employees={employees}
                stations={stations}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                selectedEmployees={selectedEmployees}
                toggleEmployeeSelection={toggleEmployeeSelection}
                setSelectedEmployees={setSelectedEmployees}
                onAddNew={() => { setEditingEmployee(null); setIsEmployeeModalOpen(true); }}
                onEdit={(emp) => { setEditingEmployee(emp); setIsEmployeeModalOpen(true); }}
                onDelete={handleDeleteEmployee}
                onBulkDelete={handleBulkDelete}
                onLoadSample={loadSampleData}
              />
            )}

            {activeTab === 'layout' && (
              <LayoutTab
                stations={stations}
                employees={employees}
                onAddNew={() => { setSelectedStation(null); setIsStationModalOpen(true); }}
                onEdit={(st) => { setSelectedStation(st); setIsStationModalOpen(true); }}
                onDelete={(st) => setConfirmState({
                  isOpen: true,
                  title: t('confirm.removeStation.title'),
                  message: t('confirm.removeStation.body', { name: st.name }),
                  onConfirm: () => setStations(prev => prev.filter(s => s.id !== st.id)),
                })}
              />
            )}

            {activeTab === 'schedule' && (
              <ScheduleTab
                employees={employees}
                filteredEmployees={filteredScheduleEmployees}
                shifts={shifts}
                holidays={holidays}
                config={config}
                schedule={schedule}
                paintMode={paintMode}
                setPaintMode={setPaintMode}
                scheduleFilter={scheduleFilter}
                setScheduleFilter={setScheduleFilter}
                scheduleRoleFilter={scheduleRoleFilter}
                setScheduleRoleFilter={setScheduleRoleFilter}
                rosterRoles={rosterRoles}
                scheduleUndoStack={scheduleUndoStack}
                prevMonth={prevMonth}
                nextMonth={nextMonth}
                onCellClick={handleCellClick}
                onUndo={undoLastSchedule}
                onRunAuto={handleRunAutoScheduler}
                paintWarnings={paintWarnings}
                onDismissPaintWarnings={() => setPaintWarnings(null)}
                staleness={scheduleStaleness}
                recentlyChangedCells={recentlyChangedCells}
              />
            )}

            {activeTab === 'shifts' && (
              <ShiftsTab
                shifts={shifts}
                onAddNew={() => { setEditingShift(null); setIsShiftModalOpen(true); }}
                onEdit={(s) => { setEditingShift(s); setIsShiftModalOpen(true); }}
                onDelete={handleDeleteShift}
                onMove={moveShift}
              />
            )}

            {activeTab === 'holidays' && (
              <HolidaysTab
                holidays={holidays}
                onAddNew={() => setIsHolidayModalOpen(true)}
                onDelete={(holi) => setConfirmState({
                  isOpen: true,
                  title: t('confirm.eraseHoliday.title'),
                  message: t('confirm.eraseHoliday.body', { name: holi.name }),
                  onConfirm: () => setHolidays(prev => prev.filter(h => h.date !== holi.date)),
                })}
              />
            )}

            {activeTab === 'reports' && (
              <ReportsTab
                employees={employees}
                schedule={schedule}
                shifts={shifts}
                config={config}
                violations={violations}
                onExportPDF={handleExportPDF}
                onExportCSV={exportScheduleCSV}
              />
            )}

            {activeTab === 'variables' && (
              <VariablesTab config={config} setConfig={setConfig} />
            )}

            {activeTab === 'audit' && <AuditLogTab />}

            {activeTab === 'settings' && (
              <SettingsTab
                config={config}
                setConfig={setConfig}
                onExportBackup={exportBackup}
                onImportBackup={() => backupInputRef.current?.click()}
                onFactoryReset={handleClearAllData}
              />
            )}
            </Suspense>
          </motion.div>
        </AnimatePresence>
        </div>
      </main>

      <EmployeeModal
        isOpen={isEmployeeModalOpen}
        onClose={() => setIsEmployeeModalOpen(false)}
        onSave={handleSaveEmployee}
        employee={editingEmployee}
        stations={stations}
        shifts={shifts}
        config={config}
      />

      <StationModal
        isOpen={isStationModalOpen}
        onClose={() => setIsStationModalOpen(false)}
        onSave={handleSaveStation}
        station={selectedStation}
      />

      <HolidayModal
        isOpen={isHolidayModalOpen}
        onClose={() => setIsHolidayModalOpen(false)}
        onSave={handleSaveHoliday}
        holiday={editingHoliday}
      />

      <ShiftModal
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        onSave={handleSaveShift}
        shift={editingShift}
        config={config}
      />

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={confirmState.onConfirm}
        extraAction={confirmState.extraAction}
        onClose={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />

      <ConfirmModal
        isOpen={infoState.isOpen}
        title={infoState.title || t('info.notice.title')}
        message={infoState.message}
        onConfirm={() => setInfoState(prev => ({ ...prev, isOpen: false }))}
        onClose={() => setInfoState(prev => ({ ...prev, isOpen: false }))}
        infoOnly
      />

      <SchedulePreviewModal
        isOpen={pendingScheduleResult !== null}
        stats={pendingScheduleResult?.stats ?? null}
        monthLabel={format(new Date(config.year, config.month - 1, 1), 'MMMM yyyy')}
        onClose={() => setPendingScheduleResult(null)}
        onApply={applyPendingSchedule}
      />

      <SimulationDeltaPanel
        isActive={simMode}
        metrics={simMetrics}
        onExit={exitSimMode}
        onApply={applySimMode}
        onReset={resetSimMode}
      />

      <CoverageHintToast
        hint={coverageHint}
        onDismiss={() => setCoverageHint(null)}
        onPickReplacement={acceptCoverageSwap}
      />
    </div>
    </>
  );
}
