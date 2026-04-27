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
} from './types';
import { ComplianceEngine, previewAssignmentWarnings } from './lib/compliance';
import { format, getDaysInMonth, addMonths, subMonths } from 'date-fns';
import { INITIAL_SHIFTS, INITIAL_EMPLOYEES, INITIAL_STATIONS, INITIAL_HOLIDAYS, DEFAULT_CONFIG } from './lib/initialData';
import { APP_VERSION } from './lib/appMeta';
import { DEFAULT_MONTHLY_SALARY_IQD, baseHourlyRate } from './lib/payroll';
import { parseHour } from './lib/time';
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
import { useI18n } from './lib/i18n';

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


export default function App() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dataLoaded, setDataLoaded] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>(INITIAL_SHIFTS);
  const [holidays, setHolidays] = useState<PublicHoliday[]>(INITIAL_HOLIDAYS);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [stations, setStations] = useState<Station[]>([]);
  
  const [allSchedules, setAllSchedules] = useState<Record<string, Schedule>>({});
  const scheduleKey = `scheduler_schedule_${config.year}_${config.month}`;
  // Auto-save status, surfaced in the top bar so the user can see at a glance
  // whether the last edit has reached the server.
  type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // The current month's schedule is derived from `allSchedules` — single source
  // of truth. Holding it as a separate `useState` previously created a race on
  // month change: the sync-back effect would write the *old* month's schedule
  // into the *new* month's slot (because `scheduleKey` had just rolled forward),
  // clobbering whatever the user had saved for the new month.
  const schedule: Schedule = allSchedules[scheduleKey] ?? {};

  type ScheduleUpdater = Schedule | ((prev: Schedule) => Schedule);
  const setSchedule = React.useCallback((updater: ScheduleUpdater) => {
    setAllSchedules(prev => {
      const current = prev[scheduleKey] ?? {};
      const next = typeof updater === 'function' ? (updater as (p: Schedule) => Schedule)(current) : updater;
      return { ...prev, [scheduleKey]: next };
    });
  }, [scheduleKey]);

  // Migrate any legacy string-typed schedule entries to the {shiftCode} object
  // shape. Older backups stored just the shift code as a string; we normalise
  // once at load time so downstream code never has to handle both shapes.
  // The input type intentionally allows the legacy (string) entry shape — the
  // output is uniformly { shiftCode } so callers can rely on the modern type.
  type LegacyEntry = string | { shiftCode: string; stationId?: string };
  type LegacyMonth = Record<string, Record<string, LegacyEntry>>;
  type LegacySchedules = Record<string, LegacyMonth>;

  const migrateSchedules = (raw: LegacySchedules): Record<string, Schedule> => {
    const out: Record<string, Schedule> = {};
    for (const monthKey of Object.keys(raw)) {
      const month = raw[monthKey] || {};
      const migrated: Schedule = {};
      for (const empId of Object.keys(month)) {
        const days = month[empId] || {};
        const newDays: Schedule[string] = {};
        for (const dayStr of Object.keys(days)) {
          const day = Number(dayStr);
          const v = days[dayStr];
          newDays[day] = typeof v === 'string' ? { shiftCode: v } : v;
        }
        migrated[empId] = newDays;
      }
      out[monthKey] = migrated;
    }
    return out;
  };

  // Initial Data Fetch
  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json())
      .then(data => {
        if (data.employees) setEmployees(data.employees);
        else setEmployees(INITIAL_EMPLOYEES);

        if (data.shifts) setShifts(data.shifts);
        if (data.holidays) setHolidays(data.holidays);
        if (data.config) setConfig(prev => ({ ...prev, ...data.config }));
        if (data.stations) setStations(data.stations);
        else setStations(INITIAL_STATIONS);

        if (data.allSchedules) {
          setAllSchedules(migrateSchedules(data.allSchedules));
        }
        setDataLoaded(true);
      });
  }, []);

  // Persistence Sync to Server
  useEffect(() => {
    if (!dataLoaded) return;
    const body = { employees, shifts, holidays, config, stations, allSchedules };

    setSaveState('pending');
    // Debounce saves slightly to avoid server spam
    const timeout = setTimeout(() => {
      setSaveState('saving');
      fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(() => {
          setSaveState('saved');
          setLastSavedAt(Date.now());
        })
        .catch(err => {
          console.error('[Scheduler] Auto-save failed:', err);
          setSaveState('error');
          // Non-blocking: next change will retry automatically
        });
    }, 500);

    return () => clearTimeout(timeout);
  }, [employees, shifts, holidays, config, stations, allSchedules, dataLoaded]);

  // Operational State
  const [paintMode, setPaintMode] = useState<{ shiftCode: string; stationId?: string } | null>(null);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [isStationModalOpen, setIsStationModalOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [scheduleRoleFilter, setScheduleRoleFilter] = useState<string>('all');
  // Transient warnings shown when paint-mode assignment would breach a cap.
  // Set on click, auto-cleared after a few seconds. Non-blocking so the user
  // can still proceed if they're deliberately overriding.
  const [paintWarnings, setPaintWarnings] = useState<{ empName: string; warnings: string[] } | null>(null);
  const paintWarningTimerRef = React.useRef<number | null>(null);
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
  
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    extraAction?: {
      label: string;
      onClick: () => void;
      icon?: any;
    };
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const violations = useMemo(() => {
    const rawViolations = ComplianceEngine.check(employees, shifts, holidays, config, schedule);
    // User request: OT calculations clear the "Weekly hours cap" violation
    return rawViolations.filter(v => v.rule !== "Weekly hours cap");
  }, [schedule, employees, shifts, config, holidays]);

  // Shared peak-day helper used by both the auto-scheduler and the coverage heatmap
  const isPeakDay = React.useCallback((day: number): boolean => {
    const date = new Date(config.year, config.month - 1, day);
    const dayOfWeek = date.getDay() + 1; // 1=Sun, 7=Sat
    const holidayDates = new Set(holidays.map(h => h.date));
    return config.peakDays.includes(dayOfWeek) || holidayDates.has(format(date, 'yyyy-MM-dd'));
  }, [config]);

  const dailyCoverage = useMemo(() => {
    const coverage: Record<number, number> = {};
    const shiftMap = new Map<string, Shift>(shifts.map(s => [s.code, s]));
    
    for (let day = 1; day <= config.daysInMonth; day++) {
      let count = 0;
      employees.forEach(emp => {
        const entry = schedule[emp.empId]?.[day];
        const code = typeof entry === 'string' ? entry : entry?.shiftCode;
        if (code && shiftMap.get(code)?.isWork) count++;
      });
      coverage[day] = count;
    }
    return coverage;
  }, [employees, schedule, shifts, config.daysInMonth]);

  const handleSaveEmployee = (emp: Employee) => {
    if (editingEmployee) {
      setEmployees(prev => prev.map(e => e.empId === editingEmployee.empId ? emp : e));
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
    const newShifts = [...shifts];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newShifts.length) return;
    [newShifts[index], newShifts[targetIndex]] = [newShifts[targetIndex], newShifts[index]];
    setShifts(newShifts);
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
        // Server requires this exact token to perform a destructive wipe.
        // See server.ts /api/reset.
        fetch('/api/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' })
        })
          .then(r => r.ok ? r.json() : Promise.reject(r))
          .then(() => {
            localStorage.clear();
            alert('All data has been cleared on server and browser. The page will now reload.');
            window.location.reload();
          })
          .catch(() => alert('Reset failed. Please try again or check the server logs.'));
      }
    });
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      alert("Please select a valid .json backup file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        
        // Simple validation
        if (!data.employees || !data.shifts || !data.config) {
          throw new Error("Invalid backup format: Missing required fields (employees, shifts, config).");
        }

        setConfirmState({
          isOpen: true,
          title: t('confirm.importBackup.title'),
          message: t('confirm.importBackup.body'),
          onConfirm: () => {
            // Restore states
            setEmployees(data.employees);
            setShifts(data.shifts);
            setHolidays(data.holidays || []);
            setConfig(data.config);
            setStations(data.stations || INITIAL_STATIONS);
            
            // Restore schedules. Modern backups carry the full per-month map;
            // legacy backups only carry the active month, in which case we
            // store it under the imported config's month key (not the current
            // scheduleKey, which still points at the pre-import month).
            if (data.allSchedules) {
              setAllSchedules(data.allSchedules);
            } else if (data.schedule && data.config?.year != null && data.config?.month != null) {
              const importKey = `scheduler_schedule_${data.config.year}_${data.config.month}`;
              setAllSchedules(prev => ({ ...prev, [importKey]: data.schedule }));
            }

            // Persistence Sync to Server immediately
            const body = { 
              employees: data.employees, 
              shifts: data.shifts, 
              holidays: data.holidays || [], 
              config: data.config, 
              stations: data.stations || INITIAL_STATIONS, 
              allSchedules: data.allSchedules || {} 
            };
            
            fetch('/api/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            })
            .then(() => {
              alert('Migration successful. Data has been synced to the local server.');
              window.location.reload();
            });
          }
        });

      } catch (err) {
        alert("Error parsing backup file: " + (err instanceof Error ? err.message : "Unknown error"));
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
        // Force one last sync
        const body = { employees, shifts, holidays, config, stations, allSchedules };
        fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(() => {
          fetch('/api/shutdown', { method: 'POST' })
            .then(() => {
              alert('Server is shutting down. You can now close this browser tab.');
              window.close();
            });
        });
      }
    });
  };

  const loadSampleData = () => {
    setStations(INITIAL_STATIONS);
    setEmployees(INITIAL_EMPLOYEES);
    setSchedule({});
    alert('Balanced Seed: 35 Operators (Games with 1 or 2 HC) and 8 Cashiers. Use Auto-Scheduler to populate.');
  };

  const exportBackup = () => {
    // Include allSchedules so ALL months are preserved — not just the current view
    const data = { employees, shifts, holidays, config, stations, allSchedules };
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

      // Skip header assuming format: ID,Name,Role,Department,Type,Hours...
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
        alert(`Successfully imported ${newEmployees.length} personnel records.`);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const exportScheduleCSV = () => {
    const headers = ['Employee ID', 'Name', ...Array.from({ length: config.daysInMonth }, (_, i) => `Day ${i + 1}`)];
    const rows = employees.map(emp => {
      const row = [emp.empId, emp.name];
      for (let i = 1; i <= config.daysInMonth; i++) {
        const entry = schedule[emp.empId]?.[i];
        row.push(typeof entry === 'string' ? entry : entry?.shiftCode || '');
      }
      return row.join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
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
      daysInMonth: getDaysInMonth(next)
    }));
  };

  const prevMonth = () => {
    const prev = subMonths(new Date(config.year, config.month - 1, 1), 1);
    setConfig(last => ({
      ...last,
      year: prev.getFullYear(),
      month: prev.getMonth() + 1,
      daysInMonth: getDaysInMonth(prev)
    }));
  };

  // Preview-then-apply for the auto-scheduler. Holds the candidate result and
  // its compliance impact in state until the user approves it. Applying also
  // snapshots the previous (employees, schedule) tuple onto an undo stack.
  const [pendingScheduleResult, setPendingScheduleResult] = useState<{
    schedule: Schedule;
    employees: Employee[];
    stats: ReturnType<typeof buildPreviewStats>;
  } | null>(null);
  const [scheduleUndoStack, setScheduleUndoStack] = useState<Array<{ schedule: Schedule; employees: Employee[]; appliedAt: number }>>([]);

  const handleRunAutoScheduler = () => {
    try {
      const { schedule: newSchedule, updatedEmployees } = runAutoScheduler({
        employees, shifts, stations, holidays, config, isPeakDay,
      });

      // Build preview stats by running the compliance engine against the
      // candidate schedule (without mutating live state).
      const previewViolations = ComplianceEngine
        .check(updatedEmployees, shifts, holidays, config, newSchedule)
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
        config.daysInMonth, totalRequired, totalFilled
      );

      setPendingScheduleResult({ schedule: newSchedule, employees: updatedEmployees, stats });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Auto-scheduler failed.');
    }
  };

  const applyPendingSchedule = () => {
    if (!pendingScheduleResult) return;
    // Push current state onto the undo stack (cap at 5 entries) before replacing.
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

  // PDF generation pulls in jspdf + jspdf-autotable + html2canvas (~360KB).
  // Dynamic import means none of that is in the initial bundle — it only
  // downloads when the user clicks "Generate PDF" the first time.
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

  // Hourly coverage analysis based on config.shopOpeningTime / shopClosingTime
  const hourlyCoverage = useMemo(() => {
    const startHour = parseHour(config.shopOpeningTime || '11:00');
    const endHour = parseHour(config.shopClosingTime || '23:00');
    const hours = Array.from({ length: Math.max(0, endHour - startHour) }, (_, i) => startHour + i);
    
    const coverage: Record<number, Record<number, number>> = {}; // day -> hour -> count
    const requirements: Record<number, number> = {}; // hour -> minStaffSum
    const shiftMap = new Map<string, Shift>(shifts.map(s => [s.code, s]));

    // isPeakDay is provided by the shared useCallback above

    // Calculate dynamic requirements based on active stations
    hours.forEach(h => {
      requirements[h] = stations.reduce((sum, st) => {
        const oh = parseHour(st.openingTime);
        const ch = parseHour(st.closingTime);
        // Note: For requirements map, we'll use peak HC as the "ideal" line or maybe just normal?
        // Actually requirements logic needs to be per-day now if we want accurate gaps.
        // Let's modify hourlyCoverage to return requirements as Record<number, Record<number, number>> (day -> hour -> req)
        return sum; // Placeholder, see below
      }, 0);
    });

    const dailyRequirements: Record<number, Record<number, number>> = {};

    for (let d = 1; d <= config.daysInMonth; d++) {
      coverage[d] = {};
      dailyRequirements[d] = {};
      const peak = isPeakDay(d);
      
      hours.forEach(h => {
        coverage[d][h] = 0;
        dailyRequirements[d][h] = stations.reduce((sum, st) => {
          const oh = parseHour(st.openingTime);
          const ch = parseHour(st.closingTime);
          if (h >= oh && h < ch) return sum + (peak ? st.peakMinHC : st.normalMinHC);
          return sum;
        }, 0);
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
  }, [employees, schedule, shifts, config, stations]);

  // Station-attributed staffing gap. For each station whose peak coverage is
  // short of its `peakMinHC`, surface the worst-hour shortfall as "this station
  // needs +N more headcount." We don't try to attribute the gap to a role
  // (that's always a guess); the station name is the source of truth and the
  // user knows what role belongs there. A `roleHint` is included only when
  // the station explicitly lists a non-generic role in `requiredRoles`, since
  // that's a fact set by the user, not an inference.
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

    // Largest gap first so the most urgent stations float to the top.
    return out.sort((a, b) => b.gap - a.gap);
  }, [employees, stations, schedule, shifts, config, isPeakDay]);

  // Roles available in the role-filter dropdown above the schedule grid. Sorted
  // alphabetically so the menu is stable across renders even as the roster
  // shifts. "Driver" is forced to the front because it's the most common
  // operational filter in this domain.
  const rosterRoles = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { if (e.role) set.add(e.role); });
    const list = Array.from(set).sort();
    if (list.includes('Driver')) {
      return ['Driver', ...list.filter(r => r !== 'Driver')];
    }
    return list;
  }, [employees]);

  // Employees the schedule grid actually renders, after applying the in-tab
  // search box (matches name / id / department) and the role dropdown.
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

  // Coverage % helpers. `overallCoveragePercent` looks at every day; `peakStability`
  // restricts to peak days (weekends/holidays per config.peakDays + holiday calendar).
  // Both compare actual hourly coverage to the per-station minimum-headcount
  // requirements, and return 100 when there is nothing to cover (degenerate case
  // — empty schedule or no peak days configured).
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

  const handleCellClick = (empId: string, day: number) => {
    if (paintMode) {
      // Run a focused dry-run check before committing the paint. Warnings are
      // displayed non-blocking so the manager can still override — most paint
      // operations are deliberate corrections, not mistakes.
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
      setSchedule(prev => ({
        ...prev,
        [empId]: {
          ...(prev[empId] || {}),
          [day]: { shiftCode: paintMode.shiftCode, stationId: paintMode.stationId }
        }
      }));
    } else {
      // Original cycle logic
      const entry = schedule[empId]?.[day];
      const current = typeof entry === 'string' ? entry : entry?.shiftCode || '';
      const idx = shifts.findIndex(s => s.code === current);
      const nextShift = shifts[(idx + 1) % shifts.length];
      setSchedule(prev => ({
        ...prev,
        [empId]: {
          ...(prev[empId] || {}),
          [day]: { shiftCode: nextShift.code }
        }
      }));
    }
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
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0">
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
          </div>
          <div className="flex items-center gap-3" aria-live="polite">
            {(() => {
              // Visual map for each save state. The "saved" pulse fades quickly
              // so it doesn't feel chatty on every keystroke.
              const dotColor =
                saveState === 'error' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]' :
                saveState === 'saving' ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse' :
                saveState === 'pending' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
                'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
              const label =
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

      <SchedulePreviewModal
        isOpen={pendingScheduleResult !== null}
        stats={pendingScheduleResult?.stats ?? null}
        monthLabel={format(new Date(config.year, config.month - 1, 1), 'MMMM yyyy')}
        onClose={() => setPendingScheduleResult(null)}
        onApply={applyPendingSchedule}
      />
    </div>
    </>
  );
}
