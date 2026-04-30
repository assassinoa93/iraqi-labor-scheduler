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
  BarChart3,
  Flag,
  Database,
  X,
  Layout,
  Scale,
  FlaskConical,
  TrendingUp,
  Building2,
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
  StationGroup,
  Company,
  CompanyData,
} from './types';
import { ComplianceEngine, previewAssignmentWarnings } from './lib/compliance';
import { format, getDaysInMonth, addMonths, subMonths } from 'date-fns';
import {
  INITIAL_SHIFTS, INITIAL_EMPLOYEES, INITIAL_STATIONS, INITIAL_STATION_GROUPS, INITIAL_HOLIDAYS,
  DEFAULT_CONFIG, INITIAL_COMPANIES, DEFAULT_COMPANY_ID,
} from './lib/initialData';
import { APP_VERSION } from './lib/appMeta';
import { DEFAULT_MONTHLY_SALARY_IQD, baseHourlyRate, monthlyHourCap, computeWorkedHours } from './lib/payroll';
import { computeHolidayPay } from './lib/holidayCompPay';
import { isSystemShift } from './lib/systemShifts';
import { expandHolidayDates } from './lib/holidays';
import { parseHour, getOperatingHoursForDow } from './lib/time';
import { cn } from './lib/utils';
import { runAutoScheduler } from './lib/autoScheduler';
import { TabButton, SidebarGroup } from './components/Primitives';
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
import { SuggestionPane, RecentChange } from './components/SuggestionPane';
import { BulkAssignModal } from './components/BulkAssignModal';
import { PrintScheduleView } from './components/PrintScheduleView';
import { detectCoverageGap, findSwapCandidates, CoverageGap, CoverageSuggestion } from './lib/coverageHints';
import { getEmployeeLeaveOnDate } from './lib/leaves';
import {
  normalizeEmployees, normalizeShifts, normalizeStations, normalizeHolidays,
  normalizeConfig, normalizeAllSchedules, normalizeCompanies,
} from './lib/migration';
import { useI18n } from './lib/i18n';
import { useAuth, tabAllowed } from './lib/auth';
import { clearMode } from './lib/mode';
import {
  subscribeCompanies as fsSubscribeCompanies,
  addCompany as fsAddCompany,
  renameCompany as fsRenameCompany,
  deleteCompany as fsDeleteCompany,
} from './lib/firestoreCompanies';
import {
  subscribeEmployees, syncEmployees,
  subscribeShifts, syncShifts,
  subscribeStations, syncStations,
  subscribeStationGroups, syncStationGroups,
  subscribeHolidays, syncHolidays,
  subscribeConfig, syncConfig,
} from './lib/firestoreDomains';
import type { DayOfWeek } from './types';

// Tabs are code-split: each becomes its own chunk that loads only when the user
// clicks the corresponding sidebar item. Cuts the initial bundle materially —
// the dashboard ships first, the rest are pulled in on demand.
const DashboardTab = lazy(() => import('./tabs/DashboardTab').then(m => ({ default: m.DashboardTab })));
const CoverageOTAnalysisTab = lazy(() => import('./tabs/CoverageOTAnalysisTab').then(m => ({ default: m.CoverageOTAnalysisTab })));
const WorkforcePlanningTab = lazy(() => import('./tabs/WorkforcePlanningTab').then(m => ({ default: m.WorkforcePlanningTab })));
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
  stationGroups: [],
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
  // Online-mode auth context. In Offline mode no AuthProvider is mounted, so
  // useAuth() returns the default (role=null, isAuthenticated=false) and
  // every tab visibility / company filter check becomes a no-op — i.e. the
  // single-user product behaves exactly as before.
  const { user, role, allowedCompanies, signOut, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dataLoaded, setDataLoaded] = useState(false);

  // If the current tab becomes disallowed (e.g. supervisor signs in while
  // activeTab is set to 'workforce' from a previous super-admin session),
  // bounce to the Dashboard which everyone can see.
  useEffect(() => {
    if (!tabAllowed(activeTab, role)) {
      setActiveTab('dashboard');
    }
  }, [activeTab, role]);

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
  const { employees, shifts, holidays: rawHolidays, config, stations, allSchedules } = data;
  // v1.16: station groups live alongside stations. Pre-1.16 saves don't
  // include this; default to an empty list so consumers can treat it
  // uniformly without null-checks.
  const stationGroups = data.stationGroups ?? [];
  // v2.5.0 — multi-day holidays. The HolidaysTab edits the raw list (one
  // record per holiday with `durationDays`); every other consumer (auto-
  // scheduler, compliance, payroll, workforce planner, …) wants to ask
  // "is THIS date a holiday?" — they expect one record per covered day.
  // We expand once at the entry point so downstream date-matching code
  // (`h.date === dateStr`) keeps working without per-call expansion.
  const holidays = useMemo(() => expandHolidayDates(rawHolidays), [rawHolidays]);
  const scheduleKey = `scheduler_schedule_${config.year}_${config.month}`;
  const schedule: Schedule = allSchedules[scheduleKey] ?? {};

  // Auto-save status, surfaced in the top bar so the user can see at a glance
  // whether the last edit has reached the server.
  type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Domain setters scoped to the active company. Each accepts either a
  // value or an updater function and merges the result back into companyData.
  // Phase 2.2 — when in Online mode, also dispatches a Firestore sync for
  // the changed key (queued via microtask so it doesn't run inside the
  // setState reducer; StrictMode's double-fire is safe because Firestore
  // setDoc/deleteDoc are idempotent).
  type Updater<T> = T | ((prev: T) => T);
  const updateActive = React.useCallback(<K extends keyof CompanyData>(key: K, updater: Updater<CompanyData[K]>) => {
    setCompanyData(prev => {
      const current = prev[activeCompanyId] ?? emptyCompanyData();
      const priorValue = current[key];
      const next = typeof updater === 'function'
        ? (updater as (p: CompanyData[K]) => CompanyData[K])(current[key])
        : updater;
      if (isAuthenticated && activeCompanyId && !simMode) {
        const cid = activeCompanyId;
        const actor = user?.uid ?? null;
        queueMicrotask(() => {
          const sync: Promise<void> | null = (() => {
            switch (key) {
              case 'employees':     return syncEmployees(cid, priorValue as Employee[], next as Employee[], actor);
              case 'shifts':        return syncShifts(cid, priorValue as Shift[], next as Shift[], actor);
              case 'stations':      return syncStations(cid, priorValue as Station[], next as Station[], actor);
              case 'stationGroups': return syncStationGroups(cid, priorValue as StationGroup[] | undefined, next as StationGroup[] | undefined, actor);
              case 'holidays':      return syncHolidays(cid, priorValue as PublicHoliday[], next as PublicHoliday[], actor);
              case 'config':        return syncConfig(cid, priorValue as Config, next as Config, actor);
              case 'allSchedules':  return null; // Phase 2.3
              default:              return null;
            }
          })();
          sync?.catch((err) => console.error(`[Scheduler] Firestore ${String(key)} sync failed:`, err));
        });
      }
      return { ...prev, [activeCompanyId]: { ...current, [key]: next } };
    });
  }, [activeCompanyId, isAuthenticated, user, simMode]);

  const setEmployees = React.useCallback((u: Updater<Employee[]>) => updateActive('employees', u), [updateActive]);
  const setShifts = React.useCallback((u: Updater<Shift[]>) => updateActive('shifts', u), [updateActive]);
  const setStations = React.useCallback((u: Updater<Station[]>) => updateActive('stations', u), [updateActive]);
  const setStationGroups = React.useCallback((u: Updater<StationGroup[] | undefined>) => updateActive('stationGroups', u), [updateActive]);
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
          // v2.0.0: station groups. Pre-2.0 saves don't have them; default
          // companies seed the new groups so the kanban view in Stations
          // ships pre-populated. Custom companies start empty.
          const rawGroups = data.stationGroups?.[c.id] ?? (c.id === DEFAULT_COMPANY_ID ? INITIAL_STATION_GROUPS : []);
          map[c.id] = {
            employees: normalizeEmployees(rawEmps),
            shifts: normalizeShifts(rawShifts),
            stations: normalizeStations(rawStations),
            holidays: normalizeHolidays(rawHolidays),
            stationGroups: Array.isArray(rawGroups) ? rawGroups : [],
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
            stationGroups: INITIAL_STATION_GROUPS,
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

  // Phase 2.1 — companies registry from Firestore.
  // In Online mode the Express /api/data fetch above still seeds initial
  // local state, but Firestore's onSnapshot is the source of truth and
  // overwrites the companies list with the authoritative cloud copy.
  // Per-domain data (employees, shifts, schedules, …) still rides Express
  // until Phase 2.2/2.3 swap those in. Offline mode does not subscribe —
  // useAuth() returns isAuthenticated=false there.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        unsub = await fsSubscribeCompanies(
          (list) => {
            if (cancelled) return;
            setCompaniesState(list);
            // Seed an empty per-domain slice for any company we don't yet
            // have local state for (e.g. created on another machine).
            // Phase 2.2 will move per-domain data to Firestore too — until
            // then the placeholder keeps the active-company switch from
            // hitting an undefined CompanyData.
            setCompanyData((prev) => {
              const next = { ...prev };
              let changed = false;
              for (const c of list) {
                if (!next[c.id]) {
                  next[c.id] = { ...emptyCompanyData(), config: { ...DEFAULT_CONFIG, company: c.name } };
                  changed = true;
                }
              }
              return changed ? next : prev;
            });
            // If the persisted activeCompanyId doesn't exist in the live
            // list (deleted on another machine, or first-time login on a
            // fresh project), switch to the first available so the UI
            // doesn't get stuck on a non-existent company.
            if (list.length && !list.some((c) => c.id === activeCompanyId)) {
              setActiveCompanyId(list[0].id);
            }
          },
          (err) => {
            console.error('[Scheduler] Firestore companies subscribe failed:', err);
            // Don't surface as a save error — the offline cache + Express
            // fallback keeps the app usable. Phase 2.4 adds a connection
            // status indicator.
          },
        );
      } catch (err) {
        console.error('[Scheduler] Firestore subscribe init failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
    // activeCompanyId is intentionally NOT a dep — we only want to react
    // to mode changes (auth toggles), not to every company switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Phase 2.2 — per-company domain subscriptions (employees / shifts /
  // stations / stationGroups / holidays / config). When the active company
  // changes the previous subscriptions tear down and we re-subscribe to the
  // new company's subcollections. Each onSnapshot writes the live data into
  // companyData[activeCompanyId][domain], replacing whatever the Express
  // initial fetch seeded. Schedules + audit are Phase 2.3.
  useEffect(() => {
    if (!isAuthenticated || !activeCompanyId) return;
    const cid = activeCompanyId;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const updateDomain = <K extends keyof CompanyData>(key: K, value: CompanyData[K]) => {
      if (cancelled || cid !== activeCompanyId) return;
      setCompanyData((prev) => {
        const cur = prev[cid] ?? emptyCompanyData();
        return { ...prev, [cid]: { ...cur, [key]: value } };
      });
    };
    (async () => {
      try {
        const subs = [
          await subscribeEmployees(cid, (items) => updateDomain('employees', items)),
          await subscribeShifts(cid, (items) => updateDomain('shifts', items)),
          await subscribeStations(cid, (items) => updateDomain('stations', items)),
          await subscribeStationGroups(cid, (items) => updateDomain('stationGroups', items)),
          await subscribeHolidays(cid, (items) => updateDomain('holidays', items)),
          await subscribeConfig(cid, (cfg) => {
            // If the doc doesn't exist yet (first edit on this company in
            // Online mode), keep whatever the local default seeded — the
            // first user edit will syncConfig and create the doc.
            if (cfg) updateDomain('config', cfg);
          }),
        ];
        if (cancelled) {
          subs.forEach((u) => u());
          return;
        }
        unsubs.push(...subs);
      } catch (err) {
        console.error('[Scheduler] Firestore domain subscription init failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, activeCompanyId]);

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
  // sandbox doesn't pollute on-disk state. Phase 2.2 — also skipped in
  // Online mode: Firestore is the source of truth there, and the auto-save
  // would otherwise overwrite the user's local Express data with whatever
  // the (possibly empty) Firestore subscription returned, losing any
  // existing offline rosters.
  useEffect(() => {
    if (!dataLoaded) return;
    if (simMode) return;
    if (isAuthenticated) return;
    const employeesByCo: Record<string, Employee[]> = {};
    const shiftsByCo: Record<string, Shift[]> = {};
    const holidaysByCo: Record<string, PublicHoliday[]> = {};
    const stationsByCo: Record<string, Station[]> = {};
    const stationGroupsByCo: Record<string, StationGroup[]> = {};
    const configByCo: Record<string, Config> = {};
    const allSchedulesByCo: Record<string, Record<string, Schedule>> = {};
    for (const id of Object.keys(companyData)) {
      const cd = companyData[id];
      employeesByCo[id] = cd.employees;
      shiftsByCo[id] = cd.shifts;
      holidaysByCo[id] = cd.holidays;
      stationsByCo[id] = cd.stations;
      stationGroupsByCo[id] = cd.stationGroups ?? [];
      configByCo[id] = cd.config;
      allSchedulesByCo[id] = cd.allSchedules;
    }
    const body = {
      companies: { companies, activeCompanyId },
      employees: employeesByCo,
      shifts: shiftsByCo,
      holidays: holidaysByCo,
      stations: stationsByCo,
      stationGroups: stationGroupsByCo,
      config: configByCo,
      allSchedules: allSchedulesByCo,
    };

    setSaveState('pending');
    const timeout = setTimeout(() => {
      setSaveState('saving');
      // One-shot audit suppression after factory reset. The flag is set by
      // handleClearAllData before the page reload; consumed here so the
      // first save (which would otherwise diff against an empty server
      // state and emit dozens of "added X" entries) writes silently.
      const skipAudit = window.localStorage.getItem('iraqi-scheduler-skip-next-audit') === '1';
      if (skipAudit) window.localStorage.removeItem('iraqi-scheduler-skip-next-audit');
      fetch('/api/save' + (skipAudit ? '?skipAudit=1' : ''), {
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
  }, [companies, activeCompanyId, companyData, dataLoaded, simMode, isAuthenticated]);

  // Operational State
  const [paintMode, setPaintMode] = useState<{ shiftCode: string; stationId?: string } | null>(null);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [isStationModalOpen, setIsStationModalOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState('');
  // v2.2.0 — extra schedule filters. `violationsOnly` narrows the visible
  // roster to employees with at least one severity:'violation' entry in
  // the current month so the supervisor can spot where the issues are.
  // `groupByStation` clusters rows by each employee's primary station
  // (most-frequent stationId in the visible month) so the "per station"
  // mental model becomes scannable without re-architecting the grid.
  const [scheduleViolationsOnly, setScheduleViolationsOnly] = useState(false);
  const [scheduleGroupByStation, setScheduleGroupByStation] = useState(false);
  const [scheduleRoleFilter, setScheduleRoleFilter] = useState<string>('all');
  const [paintWarnings, setPaintWarnings] = useState<{ empName: string; warnings: string[] } | null>(null);
  const paintWarningTimerRef = React.useRef<number | null>(null);
  // Coverage-gap suggestion queue (v1.12). Pre-1.12 we only kept the most
  // recent gap, which meant that painting absences for two employees in
  // sequence dropped the first suggestion the moment the second paint fired.
  // The queue preserves all open gaps; the SuggestionPane shows the head
  // entry as the "active" suggestion, with a count + drill-down for the
  // rest. The live-refresh effect prunes entries when a gap is genuinely
  // closed (reassigned, or another worker filled the slot at peak headcount).
  type PendingHint = {
    id: string; // `${vacatedEmpId}:${day}:${stationId}` — uniquely identifies the gap
    gap: CoverageGap;
    suggestions: CoverageSuggestion[];
    ts: number; // creation time, used for mass-change detection + ordering
  };
  const [coverageHints, setCoverageHints] = useState<PendingHint[]>([]);
  const activeCoverageHint = coverageHints[0] || null;
  const hintIdFor = (gap: CoverageGap) => `${gap.vacatedEmpId}:${gap.day}:${gap.station.id}`;
  // Queue helpers — keep call sites ergonomic by hiding the dedupe rules
  // here. `pushHint` drops duplicates (same vacatedEmp + day + station)
  // because rapid drag-paint can fire the same gap multiple times for the
  // same cell, and we don't want phantom queue inflation.
  const pushHint = React.useCallback((gap: CoverageGap, suggestions: CoverageSuggestion[]) => {
    const id = hintIdFor(gap);
    setCoverageHints(prev => {
      if (prev.some(h => h.id === id)) {
        // Refresh the suggestions list on the existing entry rather than
        // pushing a duplicate; otherwise rapid sweep-paint over the same
        // cell would stack the hint over and over.
        return prev.map(h => h.id === id ? { ...h, suggestions } : h);
      }
      return [...prev, { id, gap, suggestions, ts: Date.now() }];
    });
  }, []);
  const dismissHintById = React.useCallback((id: string) => {
    setCoverageHints(prev => prev.filter(h => h.id !== id));
  }, []);
  // Mass-change detection. When ≥3 distinct gaps open within 8 s, surface a
  // single "bulk operation detected" banner above the active hint that
  // offers to re-run the auto-scheduler in preserve-absences mode. The
  // detector reads only from `coverageHints[].ts` so it's automatic — no
  // extra event tracking required.
  const MASS_CHANGE_THRESHOLD = 3;
  const MASS_CHANGE_WINDOW_MS = 8000;
  const massChangeDetected = useMemo(() => {
    if (coverageHints.length < MASS_CHANGE_THRESHOLD) return false;
    const cutoff = Date.now() - MASS_CHANGE_WINDOW_MS;
    return coverageHints.filter(h => h.ts >= cutoff).length >= MASS_CHANGE_THRESHOLD;
  }, [coverageHints]);
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
  const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false);

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
    // v2.1.2: render as a single-button informational dialog when set —
    // matches the existing ConfirmModal `infoOnly` prop. Used for "you
    // can't delete this shift" notices.
    infoOnly?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // `findings` is the full output of the compliance engine — both hard
  // violations and informational notes (severity: 'info'). `violations` is
  // the subset surfaced as actual rule breaches in KPIs and the violation
  // table; `infoFindings` are notes the supervisor needs to be aware of
  // (e.g. holiday worked → eligible for double pay) but which are NOT rule
  // breaches and don't lower the compliance score.
  const findings = useMemo(() => {
    const raw = ComplianceEngine.check(employees, shifts, holidays, config, schedule, allSchedules);
    return raw.filter(v => v.rule !== 'Weekly hours cap');
  }, [schedule, employees, shifts, config, holidays, allSchedules]);
  const violations = useMemo(() => findings.filter(v => (v.severity ?? 'violation') === 'violation'), [findings]);
  const infoFindings = useMemo(() => findings.filter(v => v.severity === 'info'), [findings]);

  // Shared peak-day helper used by both the auto-scheduler and the coverage heatmap.
  const isPeakDay = React.useCallback((day: number): boolean => {
    const date = new Date(config.year, config.month - 1, day);
    const dayOfWeek = date.getDay() + 1; // 1=Sun, 7=Sat
    const holidayDates = new Set(holidays.map(h => h.date));
    return config.peakDays.includes(dayOfWeek) || holidayDates.has(format(date, 'yyyy-MM-dd'));
  }, [config, holidays]);

  // Same logic, factory variant — given any config (with arbitrary year/
  // month), build a per-day predicate. Used by the annual workforce
  // planner so each month's analysis honours the user's peak-day settings
  // and the holiday list (filtered per-month inside the analyzer).
  const isPeakDayFor = React.useCallback((cfg: Config) => (day: number): boolean => {
    const date = new Date(cfg.year, cfg.month - 1, day);
    const dayOfWeek = date.getDay() + 1;
    const holidayDates = new Set(holidays.map(h => h.date));
    return (cfg.peakDays || []).includes(dayOfWeek) || holidayDates.has(format(date, 'yyyy-MM-dd'));
  }, [holidays]);

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

  // Per-session change log surfaced in the right-side SuggestionPane. Each
  // entry has its own undo button so the user can revert a specific change
  // without disturbing the rest of the session's edits. Capped at 50 to
  // bound DOM size.
  const [recentChanges, setRecentChanges] = useState<RecentChange[]>([]);
  // Suggestion-pane collapse state. The 340px right rail is too aggressive on
  // narrow laptop displays (1366×768 cuts the schedule grid in half), so we
  // start collapsed below 1280px and track resize crossings — but only until
  // the user manually toggles, after which their preference wins for the
  // rest of the session.
  const PANE_BREAKPOINT_PX = 1280;
  const [paneCollapsed, setPaneCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < PANE_BREAKPOINT_PX;
  });
  const paneUserOverrideRef = React.useRef(false);
  useEffect(() => {
    const onResize = () => {
      if (paneUserOverrideRef.current) return;
      setPaneCollapsed(window.innerWidth < PANE_BREAKPOINT_PX);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const recordRecentChange = React.useCallback((edit: Omit<RecentChange, 'id' | 'ts' | 'empName'>) => {
    const emp = employees.find(e => e.empId === edit.empId);
    setRecentChanges(prev => [
      {
        ...edit,
        empName: emp?.name || edit.empId,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
      },
      ...prev,
    ].slice(0, 50));
  }, [employees]);
  // Undo a single recorded change by id. Restores the pre-change cell state
  // and removes the entry from the log. Doesn't touch the per-cell undo stack
  // because that's a different stream (the user can have edits in either or
  // both sources).
  const undoRecentChange = React.useCallback((id: string) => {
    setRecentChanges(prev => {
      const target = prev.find(c => c.id === id);
      if (!target) return prev;
      setSchedule(curr => {
        const empBucket = { ...(curr[target.empId] || {}) };
        if (target.prevCode) {
          empBucket[target.day] = { shiftCode: target.prevCode };
        } else {
          delete empBucket[target.day];
        }
        return { ...curr, [target.empId]: empBucket };
      });
      return prev.filter(c => c.id !== id);
    });
  }, [setSchedule]);

  // Stamp the appropriate leave code (AL / SL / MAT) onto every schedule
  // cell that just transitioned from "no leave" to "on leave" for this
  // employee. Single source of truth: editing leaves in the LeaveManagerModal
  // is enough — the schedule grid updates to match automatically, no
  // double-input needed. Existing AL/SL/MAT cells are left alone; existing
  // work shifts get overwritten because the user has just declared the
  // employee absent on that day.
  const stampLeaveOntoSchedule = React.useCallback((prevEmp: Employee, nextEmp: Employee) => {
    const codeFor = (type: 'annual' | 'sick' | 'maternity') => type === 'annual' ? 'AL' : type === 'sick' ? 'SL' : 'MAT';
    const stampedDays: Array<{ day: number; prevCode: string; nextCode: string }> = [];
    setSchedule(prevSched => {
      const empBucket = { ...(prevSched[nextEmp.empId] || {}) };
      let changed = false;
      for (let day = 1; day <= config.daysInMonth; day++) {
        const ds = format(new Date(config.year, config.month - 1, day), 'yyyy-MM-dd');
        const wasOnLeave = getEmployeeLeaveOnDate(prevEmp, ds);
        const nowOnLeave = getEmployeeLeaveOnDate(nextEmp, ds);
        if (!wasOnLeave && nowOnLeave) {
          const desired = codeFor(nowOnLeave.type);
          const prevCode = empBucket[day]?.shiftCode || '';
          if (prevCode !== desired) {
            stampedDays.push({ day, prevCode, nextCode: desired });
            empBucket[day] = { shiftCode: desired };
            changed = true;
          }
        }
      }
      if (!changed) return prevSched;
      return { ...prevSched, [nextEmp.empId]: empBucket };
    });
    // Record each stamped day in the SuggestionPane log so the user can see
    // what got auto-painted and undo individual entries if a leave date was
    // entered by mistake.
    for (const s of stampedDays) {
      recordRecentChange({ empId: nextEmp.empId, day: s.day, prevCode: s.prevCode, nextCode: s.nextCode, source: 'leave-stamp' });
    }
  }, [config.year, config.month, config.daysInMonth, setSchedule, recordRecentChange]);

  // Surface a single coverage-hint toast for the most impactful day where the
  // given employee just transitioned from "available" to "on leave". Diffs the
  // employee's leave state across the entire active month using the unified
  // helper so it works whether leaves were edited via the legacy single-range
  // fields or the new multi-range LeaveManagerModal. Picks the day with the
  // highest required headcount (peak vs normal) and only surfaces one toast —
  // the rest surface naturally as the user repaints.
  const surfaceLeaveCoverageHint = React.useCallback((prevEmp: Employee, nextEmp: Employee) => {
    const newlyOnLeave: number[] = [];
    for (let day = 1; day <= config.daysInMonth; day++) {
      const ds = format(new Date(config.year, config.month - 1, day), 'yyyy-MM-dd');
      const wasOnLeave = !!getEmployeeLeaveOnDate(prevEmp, ds);
      const isOnLeave = !!getEmployeeLeaveOnDate(nextEmp, ds);
      if (!wasOnLeave && isOnLeave) newlyOnLeave.push(day);
    }
    if (newlyOnLeave.length === 0) return;
    let best: { day: number; gap: CoverageGap } | null = null;
    for (const d of newlyOnLeave) {
      const prevEntry = schedule[nextEmp.empId]?.[d];
      // Permissive mode: leave additions should always surface candidate
      // substitutes regardless of the station's minimum-headcount threshold.
      // Without this, cashier-station leaves on non-peak days yielded zero
      // suggestions because normalMinHC is 0 — only drivers (whose vehicle
      // stations have normalMinHC=1) ever surfaced hints.
      const gap = detectCoverageGap({
        employees, shifts, stations, holidays, config, schedule,
        empId: nextEmp.empId, day: d, prevEntry, newEntry: undefined, isPeakDay,
        permissive: true,
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
      pushHint(best.gap, suggestions);
    }
  }, [employees, shifts, stations, holidays, config, schedule, isPeakDay, pushHint]);

  const handleSaveEmployee = (emp: Employee) => {
    if (editingEmployee) {
      setEmployees(prev => prev.map(e => e.empId === editingEmployee.empId ? emp : e));
      stampLeaveOntoSchedule(editingEmployee, emp);
      surfaceLeaveCoverageHint(editingEmployee, emp);
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

  // System-required shift codes the auto-scheduler / payroll / migration
  // depend on. Deleting CP silently breaks the v2.1 comp-day rotation;
  // deleting OFF / AL / SL / MAT / PH breaks the after-day pass and the
  // leave system. The migration would re-add them on next load anyway,
  // but the in-flight schedule between delete and reload would have
  // dangling shift codes — so block instead of letting the user slip
  // into an inconsistent state.
  const handleDeleteShift = (code: string) => {
    if (isSystemShift(code)) {
      setConfirmState({
        isOpen: true,
        title: t('confirm.deleteShift.protectedTitle'),
        message: t('confirm.deleteShift.protectedBody', { code }),
        onConfirm: () => {},
        infoOnly: true,
      });
      return;
    }
    // Count usage across every persisted schedule so we can warn the
    // user before turning live cells into stale shift-code references.
    let usageCount = 0;
    for (const monthSched of Object.values(allSchedules || {})) {
      for (const empSched of Object.values(monthSched)) {
        for (const entry of Object.values(empSched)) {
          if (entry?.shiftCode === code) usageCount++;
        }
      }
    }
    if (usageCount > 0) {
      setConfirmState({
        isOpen: true,
        title: t('confirm.deleteShift.inUseTitle'),
        message: t('confirm.deleteShift.inUseBody', { code, count: usageCount }),
        onConfirm: () => {
          setShifts(prev => prev.filter(s => s.code !== code));
        },
      });
      return;
    }
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

  const handleBulkAssignShift = (shiftCode: string, fromDay: number, toDay: number, overwrite: boolean) => {
    setSchedule(prev => {
      const next = { ...prev };
      for (const empId of selectedEmployees) {
        const empBucket = { ...(next[empId] || {}) };
        for (let d = fromDay; d <= toDay; d++) {
          if (!overwrite && empBucket[d]) continue;
          empBucket[d] = { shiftCode };
        }
        next[empId] = empBucket;
      }
      return next;
    });
    // Bulk assignments could touch hundreds of cells — clearing the per-cell
    // undo stack avoids partial-state confusion. The user can use the existing
    // schedule-level undo (Auto-Schedule undo stack) if available.
    setCellUndoStack([]);
    setIsBulkAssignOpen(false);
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
            // The renderer will fall back to INITIAL data on the next load and
            // immediately auto-save it. Mark that one save so the server
            // skips the diff — otherwise the audit log fills with dozens of
            // "added employee" entries that drown out the single "Factory
            // reset" entry the server just wrote.
            localStorage.setItem('iraqi-scheduler-skip-next-audit', '1');
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
                  // v2.0.0: optional groups list. Pre-2.0 backups land
                  // with no groups; the kanban view shows everything in
                  // "Ungrouped" until the user creates groups.
                  stationGroups: Array.isArray(raw.stationGroups?.[c.id]) ? raw.stationGroups[c.id] : [],
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
                stationGroups: Array.isArray(raw.stationGroups) ? raw.stationGroups : INITIAL_STATION_GROUPS,
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
        const stationGroupsByCo: Record<string, StationGroup[]> = {};
        const configByCo: Record<string, Config> = {};
        const allSchedulesByCo: Record<string, Record<string, Schedule>> = {};
        for (const id of Object.keys(companyData)) {
          const cd = companyData[id];
          employeesByCo[id] = cd.employees;
          shiftsByCo[id] = cd.shifts;
          holidaysByCo[id] = cd.holidays;
          stationsByCo[id] = cd.stations;
          stationGroupsByCo[id] = cd.stationGroups ?? [];
          configByCo[id] = cd.config;
          allSchedulesByCo[id] = cd.allSchedules;
        }
        const body = {
          companies: { companies, activeCompanyId },
          employees: employeesByCo, shifts: shiftsByCo, holidays: holidaysByCo,
          stations: stationsByCo, stationGroups: stationGroupsByCo, config: configByCo, allSchedules: allSchedulesByCo,
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
    // v2.0.0: also seed the kanban groups so a fresh sample lands with the
    // pre-populated Cashier Counters / Game Machines / Vehicles columns.
    setStationGroups(INITIAL_STATION_GROUPS);
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
    const stationGroupsByCo: Record<string, StationGroup[]> = {};
    const configByCo: Record<string, Config> = {};
    const allSchedulesByCo: Record<string, Record<string, Schedule>> = {};
    for (const id of Object.keys(companyData)) {
      const cd = companyData[id];
      employeesByCo[id] = cd.employees;
      shiftsByCo[id] = cd.shifts;
      holidaysByCo[id] = cd.holidays;
      stationsByCo[id] = cd.stations;
      stationGroupsByCo[id] = cd.stationGroups ?? [];
      configByCo[id] = cd.config;
      allSchedulesByCo[id] = cd.allSchedules;
    }
    const data = {
      companies: { companies, activeCompanyId },
      employees: employeesByCo, shifts: shiftsByCo, holidays: holidaysByCo,
      stations: stationsByCo, stationGroups: stationGroupsByCo,
      config: configByCo, allSchedules: allSchedulesByCo,
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

  // v2.2.0 — single source-of-truth setter for active month. The prev /
  // next helpers delegate so the cell-undo-stack reset and daysInMonth
  // recompute live in one place. The MonthYearPicker calls
  // `setActiveMonth(year, month)` directly when the user jumps to a
  // non-adjacent month from the popover.
  const setActiveMonth = (year: number, month: number) => {
    const target = new Date(year, month - 1, 1);
    setConfig(prev => ({
      ...prev,
      year: target.getFullYear(),
      month: target.getMonth() + 1,
      daysInMonth: getDaysInMonth(target),
    }));
    // Per-cell undo entries are scoped to the active month — drop them so
    // Ctrl+Z doesn't try to revert paints from a month that's no longer open.
    setCellUndoStack([]);
  };

  const nextMonth = () => {
    const next = addMonths(new Date(config.year, config.month - 1, 1), 1);
    setActiveMonth(next.getFullYear(), next.getMonth() + 1);
  };

  const prevMonth = () => {
    const prev = subMonths(new Date(config.year, config.month - 1, 1), 1);
    setActiveMonth(prev.getFullYear(), prev.getMonth() + 1);
  };

  // Preview-then-apply for the auto-scheduler. `runId` is a fresh nonce on
  // every run; passed as the React key on the modal so consecutive runs
  // always remount cleanly even if the modal was already open.
  const [pendingScheduleResult, setPendingScheduleResult] = useState<{
    schedule: Schedule;
    employees: Employee[];
    stats: ReturnType<typeof buildPreviewStats>;
    runId: number;
  } | null>(null);
  const [scheduleUndoStack, setScheduleUndoStack] = useState<Array<{ schedule: Schedule; employees: Employee[]; appliedAt: number }>>([]);

  // `mode` controls whether the scheduler builds a fresh schedule
  // (`fresh`) or fills around the user's existing entries (`preserve`).
  // The "Optimal (Preserve Absences)" button on the Schedule tab passes
  // `preserve` so manual leave / vacation / shift edits stay locked.
  // v2.2.0 — `range` is an ISO-date pair (YYYY-MM-DD). When omitted,
  // runs across the full active month with the existing preview-and-
  // apply flow. When supplied:
  //   • Single-month range → preview-and-apply, day-clamped.
  //   • Cross-month range → split into per-month invocations, stitched
  //     via `allSchedules`, applied directly with a summary toast (a
  //     multi-month preview modal would be too dense to be useful).
  const handleRunAutoScheduler = (mode: 'fresh' | 'preserve' = 'fresh', range?: { start: string; end: string }) => {
    try {
      // Default path: no range → existing full-month preview-and-apply.
      if (!range) {
        runSingleMonthAuto(mode);
        return;
      }

      const startDate = new Date(range.start + 'T00:00:00');
      const endDate = new Date(range.end + 'T00:00:00');
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
        showInfo(t('info.error.title'), t('schedule.runAuto.range.invalid'));
        return;
      }

      const sameMonth = startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth();

      // Single-month range: invoke the regular preview-and-apply path
      // with day clamps. Switch the active month if the range targets a
      // different month than the one currently displayed so the preview
      // makes sense.
      if (sameMonth) {
        const targetYear = startDate.getFullYear();
        const targetMonth = startDate.getMonth() + 1;
        if (targetYear !== config.year || targetMonth !== config.month) {
          setActiveMonth(targetYear, targetMonth);
          // Defer one tick so the config update lands before the run.
          setTimeout(() => runSingleMonthAuto(mode, { startDay: startDate.getDate(), endDay: endDate.getDate() }), 0);
        } else {
          runSingleMonthAuto(mode, { startDay: startDate.getDate(), endDay: endDate.getDate() });
        }
        return;
      }

      // Cross-month: orchestrate per-month invocations. Each month's
      // result is folded back into the running `allSchedules` so the
      // next month's rolling-7-day check sees the just-scheduled
      // trailing days of the prior month.
      let workingAllSchedules: Record<string, Schedule> = { ...allSchedules };
      let workingEmployees: Employee[] = employees;
      const aggregatedShortfall: Array<{ empId: string; debtDays: number }> = [];

      const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const stopMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      let monthsProcessed = 0;
      let totalDays = 0;

      while (cursor.getTime() <= stopMonth.getTime()) {
        const yr = cursor.getFullYear();
        const mo = cursor.getMonth() + 1;
        const dim = getDaysInMonth(cursor);
        const monthKey = `scheduler_schedule_${yr}_${mo}`;

        const isFirstMonth = yr === startDate.getFullYear() && mo === startDate.getMonth() + 1;
        const isLastMonth = yr === endDate.getFullYear() && mo === endDate.getMonth() + 1;
        const monthStartDay = isFirstMonth ? startDate.getDate() : 1;
        const monthEndDay = isLastMonth ? endDate.getDate() : dim;
        totalDays += monthEndDay - monthStartDay + 1;

        const monthConfig: Config = { ...config, year: yr, month: mo, daysInMonth: dim };
        const monthSchedule = workingAllSchedules[monthKey] || {};

        // Per-month preserve. Same logic as the single-month path: in
        // preserve mode every cell is locked; in fresh mode only the
        // out-of-range cells are locked.
        let monthPreserve: Schedule | undefined;
        if (mode === 'preserve') {
          monthPreserve = monthSchedule;
        } else if (monthStartDay > 1 || monthEndDay < dim) {
          const filtered: Schedule = {};
          for (const [empId, days] of Object.entries(monthSchedule)) {
            const kept: Record<number, typeof days[number]> = {};
            for (const [dStr, entry] of Object.entries(days)) {
              const d = Number(dStr);
              if (d < monthStartDay || d > monthEndDay) kept[d] = entry;
            }
            if (Object.keys(kept).length > 0) filtered[empId] = kept;
          }
          monthPreserve = filtered;
        }

        const { schedule: monthOut, updatedEmployees, compDayShortfall } = runAutoScheduler({
          employees: workingEmployees,
          shifts, stations, holidays,
          config: monthConfig,
          isPeakDay: isPeakDayFor(monthConfig),
          allSchedules: workingAllSchedules,
          preserveExisting: monthPreserve,
          startDay: monthStartDay,
          endDay: monthEndDay,
        });

        workingAllSchedules = { ...workingAllSchedules, [monthKey]: monthOut };
        workingEmployees = updatedEmployees;
        aggregatedShortfall.push(...compDayShortfall);
        monthsProcessed++;

        cursor.setMonth(cursor.getMonth() + 1);
      }

      // Apply directly. Snapshot the prior state into the undo stack so
      // the user can roll back the entire multi-month run as a single
      // step, matching the single-month path's safety net.
      setScheduleUndoStack(prev => [
        { schedule, employees, appliedAt: Date.now() },
        ...prev,
      ].slice(0, 5));
      setEmployees(workingEmployees);
      setAllSchedules(workingAllSchedules);
      setCellUndoStack([]);

      // Summary toast. Aggregate compDayShortfall into the message so
      // the user knows whether any month couldn't fully rotate Art. 74
      // comp days; they can navigate to that month to see the warning
      // banner the preview modal usually surfaces.
      const shortfallMsg = aggregatedShortfall.length > 0
        ? ` ${t('info.compDayShortfall.suffix', { count: aggregatedShortfall.length })}`
        : '';
      showInfo(
        t('action.runAutoSchedule'),
        t('schedule.runAuto.range.applied', { days: totalDays, months: monthsProcessed }) + shortfallMsg,
      );
    } catch (e) {
      showInfo(t('info.error.title'), e instanceof Error ? e.message : 'Auto-scheduler failed.');
    }
  };

  // Single-month auto-schedule with optional within-month day clamps.
  // Carries the existing preview-then-apply UX so the user reviews
  // stats before committing.
  const runSingleMonthAuto = (mode: 'fresh' | 'preserve', range?: { startDay: number; endDay: number }) => {
    const startDay = range?.startDay ?? 1;
    const endDay = range?.endDay ?? config.daysInMonth;
    let effectivePreserve: Schedule | undefined;
    if (mode === 'preserve') {
      effectivePreserve = schedule;
    } else if (range && (startDay > 1 || endDay < config.daysInMonth)) {
      const filtered: Schedule = {};
      for (const [empId, days] of Object.entries(schedule)) {
        const kept: Record<number, typeof days[number]> = {};
        for (const [dStr, entry] of Object.entries(days)) {
          const d = Number(dStr);
          if (d < startDay || d > endDay) kept[d] = entry;
        }
        if (Object.keys(kept).length > 0) filtered[empId] = kept;
      }
      effectivePreserve = filtered;
    }

    const { schedule: newSchedule, updatedEmployees, compDayShortfall } = runAutoScheduler({
      employees, shifts, stations, holidays, config, isPeakDay,
      allSchedules,
      preserveExisting: effectivePreserve,
      startDay, endDay,
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
      compDayShortfall,
    );

    setPendingScheduleResult({ schedule: newSchedule, employees: updatedEmployees, stats, runId: Date.now() });
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
    // Per-cell undo entries reference the prior schedule's cells. After a
    // wholesale auto-scheduler apply they're meaningless, so drop them.
    setCellUndoStack([]);
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
    // v2.2.0 — match by stable `id` instead of `date`. The user can now
    // freely edit a holiday's date without orphaning the entry, and a
    // brand-new entry's id is assigned in the modal's empty() factory.
    // Falls back to date matching when id is missing — a defensive guard
    // for any code path that might construct a holiday without going
    // through the normalizer (shouldn't happen in practice).
    const targetId = holi.id ?? holi.date;
    setHolidays(prev => {
      const idx = prev.findIndex(h => (h.id ?? h.date) === targetId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = holi;
        return next;
      }
      return [...prev, holi];
    });
    setIsHolidayModalOpen(false);
    setEditingHoliday(null);
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
    let list = employees.filter(e => {
      if (scheduleRoleFilter !== 'all' && e.role !== scheduleRoleFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.empId.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q)
      );
    });

    if (scheduleViolationsOnly) {
      // Only severity:'violation' entries count — info findings (e.g. "PH
      // worked", "comp day late") are not violations.
      const hasViolation = new Set<string>();
      for (const v of violations) {
        if ((v.severity ?? 'violation') === 'violation') hasViolation.add(v.empId);
      }
      list = list.filter(e => hasViolation.has(e.empId));
    }

    if (scheduleGroupByStation) {
      // Compute each employee's primary station = the stationId they're
      // assigned to most often in the visible month. Employees with no
      // station assignments fall into an "unassigned" bucket sorted last.
      const stationOrder = new Map(stations.map((s, i) => [s.id, i]));
      const primaryStation = (empId: string): string => {
        const empSched = schedule[empId] || {};
        const counts = new Map<string, number>();
        for (const entry of Object.values(empSched)) {
          if (entry.stationId) counts.set(entry.stationId, (counts.get(entry.stationId) || 0) + 1);
        }
        let best = '';
        let bestN = 0;
        for (const [sid, n] of counts) {
          if (n > bestN) { bestN = n; best = sid; }
        }
        return best;
      };
      list = [...list].sort((a, b) => {
        const sa = primaryStation(a.empId);
        const sb = primaryStation(b.empId);
        if (sa === sb) return a.name.localeCompare(b.name);
        if (!sa) return 1; // unassigned last
        if (!sb) return -1;
        const oa = stationOrder.get(sa) ?? 999;
        const ob = stationOrder.get(sb) ?? 999;
        return oa - ob;
      });
    }

    return list;
  }, [employees, scheduleFilter, scheduleRoleFilter, scheduleViolationsOnly, scheduleGroupByStation, violations, schedule, stations]);

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
  // v2.1.4 — routed through `computeHolidayPay` so the Art. 74 either-or
  // model is honoured here too. Pre-2.1.4 the simulation panel always
  // billed holiday hours at 2× regardless of comp-day grant, contradicting
  // PayrollTab + DashboardTab which were fixed in v2.1.1. Same fix applies
  // to `simMetrics` baseline below. `computeWorkedHours` also subtracts
  // legacy leave-overlap days so totalWorkHours matches PayrollTab.
  const otSummary = useMemo(() => {
    const cap = monthlyHourCap(config);
    const otRateDay = config.otRateDay ?? 1.5;
    let totalOTHours = 0;
    let totalOTPay = 0;
    let totalWorkHours = 0;
    for (const emp of employees) {
      const totalHrs = computeWorkedHours(emp, schedule, shifts, config);
      totalWorkHours += totalHrs;
      const hourly = baseHourlyRate(emp, config);
      const breakdown = computeHolidayPay(emp, schedule, shifts, holidays, config, hourly, allSchedules);
      const stdOT = Math.max(0, totalHrs - cap - breakdown.premiumHolidayHours);
      totalOTHours += Math.max(0, totalHrs - cap);
      totalOTPay += stdOT * hourly * otRateDay + breakdown.premiumPay;
    }
    const potentialHires = Math.ceil(totalOTHours / Math.max(1, cap));
    return { totalOTHours, totalOTPay, potentialHires, totalWorkHours };
  }, [employees, schedule, shifts, holidays, config, allSchedules]);

  // Run coverage-gap detection after a paint that may have removed a station
  // assignment. If a gap is found, queue up swap suggestions for the toast.
  // Manual paint runs in *permissive* mode so a paint over a working cell
  // always surfaces substitute candidates regardless of the station's minimum
  // — pre-v1.10 only peak days or stations with normalMinHC>0 fired a hint,
  // which left cashier paints on non-peak days silently producing OT.
  const surfaceCoverageHint = React.useCallback(
    (empId: string, day: number, prevEntry: { shiftCode: string; stationId?: string } | undefined, newEntry: { shiftCode: string; stationId?: string } | undefined) => {
      const gap = detectCoverageGap({
        employees, shifts, stations, holidays, config, schedule,
        empId, day, prevEntry, newEntry, isPeakDay,
        permissive: true,
      });
      if (!gap) return;
      const suggestions = findSwapCandidates(gap, {
        employees, shifts, stations, holidays, config, schedule, isPeakDay,
      });
      pushHint(gap, suggestions);
    },
    [employees, shifts, stations, holidays, config, schedule, isPeakDay, pushHint],
  );

  // Per-cell undo stack — each entry captures the prior contents of a single
  // (empId, day) cell so Ctrl+Z can revert one paint at a time. A bundled
  // entry (e.g. shift+click range fill) records every cell it touched so
  // a single undo restores the entire range.
  type CellEdit = { empId: string; day: number; prev: { shiftCode: string; stationId?: string } | undefined };
  const [cellUndoStack, setCellUndoStack] = useState<Array<{ edits: CellEdit[] }>>([]);

  const pushCellUndo = React.useCallback((edits: CellEdit[]) => {
    if (edits.length === 0) return;
    // Cap depth at 50 — one paint per second for nearly a minute, plenty for
    // the "oops, I mispainted that" use case.
    setCellUndoStack(prev => [{ edits }, ...prev].slice(0, 50));
  }, []);

  const undoLastCell = React.useCallback(() => {
    setCellUndoStack(prev => {
      if (prev.length === 0) return prev;
      const [last, ...rest] = prev;
      setSchedule(curr => {
        const next: typeof curr = { ...curr };
        for (const edit of last.edits) {
          const empBucket = { ...(next[edit.empId] || {}) };
          if (edit.prev === undefined) {
            delete empBucket[edit.day];
          } else {
            empBucket[edit.day] = edit.prev;
          }
          next[edit.empId] = empBucket;
        }
        return next;
      });
      return rest;
    });
  }, [setSchedule]);

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
      // Skip pushing undo when nothing actually changes (drag-paint sweeps
      // back over a cell that's already correct shouldn't bloat the stack).
      if (!prev || prev.shiftCode !== next.shiftCode || prev.stationId !== next.stationId) {
        pushCellUndo([{ empId, day, prev }]);
        recordRecentChange({ empId, day, prevCode: prev?.shiftCode || '', nextCode: next.shiftCode, source: 'paint' });
      }
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
      pushCellUndo([{ empId, day, prev }]);
      recordRecentChange({ empId, day, prevCode: prev?.shiftCode || '', nextCode: next.shiftCode, source: 'cycle' });
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

  // Shift+click range fill: paints every cell in the rectangle from
  // (anchorEmpId, anchorDay) to (empId, day). The two endpoints define the
  // employee-ordering rectangle (so users can drag down a roster column or
  // across a date row). Records all touched cells as a single undo entry so
  // Ctrl+Z reverts the whole range in one step.
  const handleCellRangeFill = (anchorEmpId: string, anchorDay: number, empId: string, day: number) => {
    if (!paintMode) return;
    const indexById = new Map(filteredScheduleEmployees.map((e, i) => [e.empId, i]));
    const anchorIdx = indexById.get(anchorEmpId);
    const targetIdx = indexById.get(empId);
    if (anchorIdx === undefined || targetIdx === undefined) return;
    const [empStart, empEnd] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    const [dStart, dEnd] = anchorDay < day ? [anchorDay, day] : [day, anchorDay];
    const next = { shiftCode: paintMode.shiftCode, stationId: paintMode.stationId };
    const edits: CellEdit[] = [];
    setSchedule(p => {
      const updated = { ...p };
      for (let i = empStart; i <= empEnd; i++) {
        const e = filteredScheduleEmployees[i];
        const empBucket = { ...(updated[e.empId] || {}) };
        for (let d = dStart; d <= dEnd; d++) {
          const prev = empBucket[d];
          if (!prev || prev.shiftCode !== next.shiftCode || prev.stationId !== next.stationId) {
            edits.push({ empId: e.empId, day: d, prev });
            empBucket[d] = next;
          }
        }
        updated[e.empId] = empBucket;
      }
      return updated;
    });
    pushCellUndo(edits);
  };

  // User picked a swap candidate from the coverage hint toast. Move the
  // vacated shift onto the chosen employee. The move overwrites whatever
  // they had on that day — usually OFF, occasionally another work shift
  // (the toast warned about this when the candidate was already assigned).
  // Both the original cell (the one that opened the gap) and the chosen
  // candidate's cell flash briefly so the user sees what moved.
  const acceptCoverageSwap = (replacementEmpId: string) => {
    if (!activeCoverageHint) return;
    const { gap, id: hintId } = activeCoverageHint;
    const prevReplacementEntry = schedule[replacementEmpId]?.[gap.day];
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
    // Record the swap as a recent change so the user can undo it from the
    // SuggestionPane along with their other edits.
    recordRecentChange({
      empId: replacementEmpId,
      day: gap.day,
      prevCode: prevReplacementEntry?.shiftCode || '',
      nextCode: gap.vacatedShiftCode,
      source: 'swap',
    });
    // Remove just the head of the queue so the next pending gap surfaces.
    dismissHintById(hintId);
  };

  // Live-refresh the open coverage-hint as the schedule evolves. The user
  // might keep editing after the hint appears — without this the candidate
  // list goes stale (shows employees who are no longer off, or omits people
  // who just became free).
  //
  // Auto-dismiss policy (v1.10.1):
  //   ONLY when the user has explicitly closed the gap (`reassigned` — i.e.
  //   the originally-vacated employee got their station-bound work shift
  //   back, typical of an undo). We do NOT dismiss based on "some other
  //   employee is at this station" because:
  //     - peakMinHC > 1 stations may have remaining workers but still need
  //       a replacement.
  //     - Auto-scheduled multi-shift days have overlapping coverage at the
  //       same station — pre-1.10.1 the dismiss heuristic kept treating
  //       those as "filled" and flashed the hint off the moment any paint
  //       fired.
  //     - A station with normalMinHC=0 on a non-peak day still wants the
  //       supervisor to see substitutes (permissive-mode intent).
  //
  // Net effect: hints persist until the user explicitly dismisses (X
  // button), picks a candidate (acceptCoverageSwap), or undoes the paint
  // that opened the gap. Subsequent paints replace the displayed hint with
  // the most recent gap, but the previous one is treated as "still open"
  // until acted on — matching the supervisor's mental model.
  useEffect(() => {
    if (coverageHints.length === 0) return;
    setCoverageHints(prev => {
      let mutated = false;
      const next: PendingHint[] = [];
      for (const h of prev) {
        // Drop hints whose vacated cell came back to the station as a work
        // shift (typical Ctrl+Z scenario). The gap is genuinely closed.
        const currentVacatedEntry = schedule[h.gap.vacatedEmpId]?.[h.gap.day];
        const reassigned =
          currentVacatedEntry?.stationId === h.gap.station.id &&
          !!shifts.find(s => s.code === currentVacatedEntry.shiftCode)?.isWork;
        if (reassigned) { mutated = true; continue; }
        // Refresh suggestions; only commit when empId order changed so we
        // don't spin in a useEffect loop.
        const fresh = findSwapCandidates(h.gap, {
          employees, shifts, stations, holidays, config, schedule, isPeakDay,
        });
        const prevKey = h.suggestions.map(s => s.empId).join('|');
        const nextKey = fresh.map(s => s.empId).join('|');
        if (prevKey !== nextKey) {
          mutated = true;
          next.push({ ...h, suggestions: fresh });
        } else {
          next.push(h);
        }
      }
      return mutated ? next : prev;
    });
  }, [schedule, employees, shifts, stations, holidays, config, isPeakDay, coverageHints.length]);

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
    setCellUndoStack([]);
    setSelectedEmployees(new Set());
  };

  // Phase 2.1 — dual-mode dispatch: Online writes through Firestore (and the
  // onSnapshot subscription in the effect above pushes the canonical state
  // back into React); Offline keeps the existing local-state path verbatim.
  const addCompany = async (name: string) => {
    if (isAuthenticated) {
      try {
        const id = await fsAddCompany(name, user?.uid ?? null, '#4f46e5');
        // Per-domain placeholder — Phase 2.2 will move this to Firestore.
        setCompanyData(prev => prev[id] ? prev : ({
          ...prev,
          [id]: {
            ...emptyCompanyData(),
            config: { ...DEFAULT_CONFIG, company: name },
          },
        }));
        setActiveCompanyId(id);
      } catch (err) {
        console.error('[Scheduler] Firestore addCompany failed:', err);
      }
      return;
    }
    // Offline path — unchanged.
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

  const renameCompany = async (id: string, name: string) => {
    if (isAuthenticated) {
      try {
        await fsRenameCompany(id, name, user?.uid ?? null);
      } catch (err) {
        console.error('[Scheduler] Firestore renameCompany failed:', err);
        return;
      }
      // Optimistically sync the embedded `config.company` label.
      // Phase 2.2 will move config.company to Firestore as well.
      setCompanyData(prev => prev[id]
        ? { ...prev, [id]: { ...prev[id], config: { ...prev[id].config, company: name } } }
        : prev);
      return;
    }
    // Offline path — unchanged.
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
      onConfirm: async () => {
        if (isAuthenticated) {
          try {
            await fsDeleteCompany(id, user?.uid ?? null);
            // Soft-delete in Firestore — the onSnapshot filter hides
            // archived rows from the switcher. Per-domain data stays in
            // memory; Phase 2.2 will cascade-clean the subcollections on
            // hard delete from the Super Admin tab.
            if (activeCompanyId === id) {
              const remaining = companies.filter(c => c.id !== id);
              if (remaining.length) setActiveCompanyId(remaining[0].id);
            }
          } catch (err) {
            console.error('[Scheduler] Firestore deleteCompany failed:', err);
          }
          return;
        }
        // Offline path — unchanged.
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
  // v2.1.4 — same `computeHolidayPay` routing as the live `otSummary` so
  // the sim panel's "OT Pay" baseline number matches PayrollTab/Dashboard
  // for the same data, including comp-day grants.
  const simMetrics: SimDeltaMetric[] = useMemo(() => {
    if (!simMode || !simBaseline) return [];
    const baselineActive = simBaseline.companyData[simBaseline.activeCompanyId];
    if (!baselineActive) return [];
    const baseScheduleKey = `scheduler_schedule_${baselineActive.config.year}_${baselineActive.config.month}`;
    const baseSchedule = baselineActive.allSchedules[baseScheduleKey] ?? {};
    const baseCap = monthlyHourCap(baselineActive.config);
    let baseOTHrs = 0;
    let baseOTPay = 0;
    for (const emp of baselineActive.employees) {
      const totalHrs = computeWorkedHours(emp, baseSchedule, baselineActive.shifts, baselineActive.config);
      const hourly = baseHourlyRate(emp, baselineActive.config);
      const breakdown = computeHolidayPay(
        emp, baseSchedule, baselineActive.shifts, baselineActive.holidays,
        baselineActive.config, hourly, baselineActive.allSchedules,
      );
      const stdOT = Math.max(0, totalHrs - baseCap - breakdown.premiumHolidayHours);
      baseOTHrs += Math.max(0, totalHrs - baseCap);
      baseOTPay += stdOT * hourly * (baselineActive.config.otRateDay ?? 1.5) + breakdown.premiumPay;
    }
    const baseViolations = ComplianceEngine
      .check(baselineActive.employees, baselineActive.shifts, baselineActive.holidays, baselineActive.config, baseSchedule, baselineActive.allSchedules)
      .filter(v => v.rule !== 'Weekly hours cap')
      .reduce((s, v) => s + (v.count || 1), 0);

    const fmtIQD = (n: number) => `${Math.round(n).toLocaleString()}`;
    // v2.1.2 — coverage metric removed from the sim panel. Pre-2.1.2 it
    // hardcoded `baseline: 0` and reported a fake +N% gain on every sim
    // run regardless of actual change. Computing the baseline correctly
    // would require a parallel hourlyCoverage pass over the baseline
    // schedule, which is expensive enough to defer. Until then the four
    // metrics below (workforce / OT hours / OT pay / violations) are
    // honestly comparable.
    return [
      { label: t('sim.metric.workforce'), baseline: baselineActive.employees.length, sim: employees.length, higherIsBetter: true },
      { label: t('sim.metric.otHours'), baseline: Math.round(baseOTHrs), sim: Math.round(otSummary.totalOTHours), higherIsBetter: false, formatter: (n: number) => `${n}h` },
      { label: t('sim.metric.otPay'), baseline: Math.round(baseOTPay), sim: Math.round(otSummary.totalOTPay), higherIsBetter: false, formatter: fmtIQD },
      { label: t('sim.metric.violations'), baseline: baseViolations, sim: violations.reduce((s, v) => s + (v.count || 1), 0), higherIsBetter: false },
    ];
  }, [simMode, simBaseline, employees.length, otSummary, violations, t]);

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
      <div className="flex h-screen bg-[#F3F4F6] dark:bg-[#0d1117] font-sans text-slate-800 dark:text-slate-100 overflow-hidden">
      {/* Left Navigation Rail. v2.6 design-pass — sidebar follows the
          claude.ai/design package's "macOS Big Sur" pattern:
            • 248px width (was 256px), reduces dead space on 1366×768
              laptops while keeping nav labels intact
            • Brand area pairs a monochrome calendar-check mark with the
              wordmark, replacing the all-caps text-only header
            • Subtle inset shadow at the inline-end edge so the rail
              "leans into" the content panel */}
      <aside className="w-[248px] bg-[#0f172a] flex flex-col border-r border-white/[0.04] shrink-0 shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)]">
        <div className="px-5 pt-5 pb-4 flex items-center gap-3 border-b border-white/[0.04]">
          <div
            className="w-9 h-9 rounded-[10px] bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0"
            aria-hidden
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <rect x="3.5" y="5" width="17" height="15" rx="3" />
              <path d="M3.5 9.5h17" />
              <path d="M8 3v3" />
              <path d="M16 3v3" />
              <path d="M9 14.5l2 2 4-4.5" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-white font-semibold tracking-tight text-[15px] leading-tight truncate">
              {t('sidebar.brand.line1')} {t('sidebar.brand.line2')}
            </h1>
            <p className="text-slate-500 text-[10px] font-mono mt-0.5">v{APP_VERSION}</p>
          </div>
        </div>

        {/* Company switcher */}
        {dataLoaded && (
          <div className="p-3 border-b border-slate-800/80">
            <CompanySwitcher
              companies={allowedCompanies ? companies.filter(c => allowedCompanies.includes(c.id)) : companies}
              activeCompanyId={activeCompanyId}
              onSwitch={switchCompany}
              onAdd={addCompany}
              onRename={renameCompany}
              onDelete={deleteCompany}
              locked={simMode || (role !== null && role !== 'super_admin')}
            />
          </div>
        )}

        {/* v1.15: tabs grouped by usage frequency. Operations (daily) →
            Analytics (weekly) → Setup (occasional) → System (rare). */}
        <nav className="flex-1 py-4 overflow-y-auto sidebar-scrollbar">
          <SidebarGroup label={t('sidebar.group.operations')}>
            {tabAllowed('dashboard', role) && <TabButton active={activeTab === 'dashboard'} label={t('tab.dashboard')} index="01" icon={BarChart3} onClick={() => setActiveTab('dashboard')} />}
            {tabAllowed('schedule', role) && <TabButton active={activeTab === 'schedule'} label={t('tab.schedule')} index="02" icon={Calendar} onClick={() => setActiveTab('schedule')} />}
            {tabAllowed('roster', role) && <TabButton active={activeTab === 'roster'} label={t('tab.roster')} index="03" icon={Users} onClick={() => setActiveTab('roster')} />}
            {tabAllowed('payroll', role) && <TabButton active={activeTab === 'payroll'} label={t('tab.payroll')} index="04" icon={BarChart3} onClick={() => setActiveTab('payroll')} />}
          </SidebarGroup>
          <SidebarGroup label={t('sidebar.group.analytics')}>
            {tabAllowed('coverageOT', role) && <TabButton active={activeTab === 'coverageOT'} label={t('tab.coverageOT')} index="05" icon={TrendingUp} onClick={() => setActiveTab('coverageOT')} />}
            {tabAllowed('workforce', role) && <TabButton active={activeTab === 'workforce'} label={t('tab.workforce')} index="06" icon={Building2} onClick={() => setActiveTab('workforce')} />}
            {tabAllowed('reports', role) && <TabButton active={activeTab === 'reports'} label={t('tab.reports')} index="07" icon={FileSpreadsheet} onClick={() => setActiveTab('reports')} />}
          </SidebarGroup>
          <SidebarGroup label={t('sidebar.group.setup')}>
            {tabAllowed('layout', role) && <TabButton active={activeTab === 'layout'} label={t('tab.layout')} index="08" icon={Layout} onClick={() => setActiveTab('layout')} />}
            {tabAllowed('shifts', role) && <TabButton active={activeTab === 'shifts'} label={t('tab.shifts')} index="09" icon={Clock} onClick={() => setActiveTab('shifts')} />}
            {tabAllowed('holidays', role) && <TabButton active={activeTab === 'holidays'} label={t('tab.holidays')} index="10" icon={Flag} onClick={() => setActiveTab('holidays')} />}
            {tabAllowed('variables', role) && <TabButton active={activeTab === 'variables'} label={t('tab.variables')} index="11" icon={Scale} onClick={() => setActiveTab('variables')} />}
          </SidebarGroup>
          <SidebarGroup label={t('sidebar.group.system')}>
            {tabAllowed('audit', role) && <TabButton active={activeTab === 'audit'} label={t('tab.audit')} index="12" icon={Database} onClick={() => setActiveTab('audit')} />}
            {tabAllowed('settings', role) && <TabButton active={activeTab === 'settings'} label={t('tab.settings')} index="13" icon={Settings} onClick={() => setActiveTab('settings')} />}
          </SidebarGroup>
        </nav>

        <div className="p-4 border-t border-slate-800/80 bg-[#0d1117]/60 space-y-2">
          <LocaleSwitcher />
          <button
            onClick={handleQuitApp}
            className="w-full flex items-center gap-3 px-4 py-2.5 bg-red-500/15 hover:bg-red-500/25 text-red-300 hover:text-red-200 border border-red-500/25 hover:border-red-500/40 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all"
          >
            <X className="w-4 h-4" />
            {t('sidebar.quitApp')}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#F3F4F6] dark:bg-[#0d1117]">
        {/* Top Toolbar — v2.6 Apple-pane polish: translucent surface with a
            subtle backdrop blur and a hairline bottom border so the bar
            reads as elevated chrome rather than a hard panel. */}
        <header className={cn(
          "h-16 border-b px-8 flex items-center justify-between shrink-0 transition-colors backdrop-blur-md",
          simMode
            ? "bg-indigo-50/80 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30"
            : "bg-white/80 dark:bg-[#161b22]/85 border-slate-200 dark:border-slate-800/80"
        )}>
          <div className="flex gap-2">
            <button
              onClick={exportScheduleCSV}
              className="apple-press px-5 py-1.5 bg-slate-900 dark:bg-slate-700 border border-slate-700 dark:border-slate-600 rounded-lg text-[10px] font-bold text-white uppercase tracking-widest hover:bg-slate-800 dark:hover:bg-slate-600 shadow-md flex items-center gap-2"
            >
              <Download className="w-3 h-3" />
              {t('toolbar.exportSchedule')}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="apple-press px-5 py-1.5 bg-white dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-lg text-[10px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm flex items-center gap-2"
            >
              <FileSpreadsheet className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              {t('toolbar.massImport')}
            </button>
            <button
              onClick={downloadRosterTemplate}
              className="apple-press px-5 py-1.5 bg-white dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-lg text-[10px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm"
            >
              {t('toolbar.csvTemplate')}
            </button>
            <button
              onClick={simMode ? exitSimMode : enterSimMode}
              className={cn(
                "apple-press px-5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-sm flex items-center gap-2 border",
                simMode
                  ? "bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700"
                  : "bg-white dark:bg-slate-800/60 text-indigo-600 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/40 hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
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
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono tracking-tighter uppercase font-bold">{label}</span>
                </>
              );
            })()}
          </div>
        </header>

        <div className={cn(
          "flex-1 overflow-auto p-8 transition-[padding] duration-200",
          // The suggestion pane is fixed-positioned to the inline-end edge
          // of the viewport (visual right in LTR, visual left in RTL).
          // Shift the content's inline-end padding so the grid doesn't
          // slide under the pane in either direction.
          activeTab === 'schedule' && !paneCollapsed && "pe-[356px]"
        )}>
          <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.998 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Suspense fallback={
              <div className="flex items-center justify-center py-32">
                <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest animate-pulse">{t('app.loadingTab')}</div>
              </div>
            }>
            {activeTab === 'dashboard' && (
              <DashboardTab
                employees={employees}
                shifts={shifts}
                holidays={holidays}
                config={config}
                schedule={schedule}
                allSchedules={allSchedules}
                stations={stations}
                isPeakDay={isPeakDay}
                violations={violations}
                staffingGapsByStation={staffingGapsByStation}
                hourlyCoverage={hourlyCoverage}
                peakStabilityPercent={peakStabilityPercent}
                overallCoveragePercent={overallCoveragePercent}
                isStatsModalOpen={isStatsModalOpen}
                setIsStatsModalOpen={setIsStatsModalOpen}
                prevMonth={prevMonth}
                nextMonth={nextMonth}
                setActiveMonth={setActiveMonth}
                onGoToRoster={() => setActiveTab('roster')}
                onLoadSample={loadSampleData}
                activeCompanyId={activeCompanyId}
              />
            )}

            {activeTab === 'coverageOT' && (
              <CoverageOTAnalysisTab
                employees={employees}
                shifts={shifts}
                stations={stations}
                holidays={holidays}
                config={config}
                schedule={schedule}
                allSchedules={allSchedules}
                prevMonth={prevMonth}
                nextMonth={nextMonth}
                setActiveMonth={setActiveMonth}
                onGoToRoster={() => setActiveTab('roster')}
                onGoToSchedule={() => setActiveTab('schedule')}
              />
            )}

            {activeTab === 'workforce' && (
              <WorkforcePlanningTab
                employees={employees}
                shifts={shifts}
                stations={stations}
                stationGroups={stationGroups}
                holidays={holidays}
                config={config}
                schedule={schedule}
                isPeakDayFor={isPeakDayFor}
                onGoToRoster={() => setActiveTab('roster')}
                onGoToLayout={() => setActiveTab('layout')}
              />
            )}

            {activeTab === 'payroll' && (
              <PayrollTab
                employees={employees}
                schedule={schedule}
                allSchedules={allSchedules}
                shifts={shifts}
                holidays={holidays}
                config={config}
                prevMonth={prevMonth}
                nextMonth={nextMonth}
                setActiveMonth={setActiveMonth}
                onExport={exportScheduleCSV}
                onUpdateEmployee={(next) => {
                  // Diff against the prior employee record so we can:
                  //   1. Stamp the leave code (AL/SL/MAT) onto the schedule
                  //      cells in the new leave window — single source of
                  //      truth, no double-input.
                  //   2. Fire the coverage-hint toast for the most-impactful
                  //      newly-vacated day so the supervisor sees swap
                  //      candidates without having to hunt for them.
                  const prev = employees.find(e => e.empId === next.empId);
                  setEmployees(arr => arr.map(e => e.empId === next.empId ? next : e));
                  if (prev) {
                    stampLeaveOntoSchedule(prev, next);
                    surfaceLeaveCoverageHint(prev, next);
                  }
                }}
              />
            )}

            {activeTab === 'roster' && (
              <RosterTab
                employees={employees}
                stations={stations}
                stationGroups={stationGroups}
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
                onBulkAssignShift={() => setIsBulkAssignOpen(true)}
              />
            )}

            {activeTab === 'layout' && (
              <LayoutTab
                stations={stations}
                employees={employees}
                stationGroups={stationGroups}
                onAddNew={() => { setSelectedStation(null); setIsStationModalOpen(true); }}
                onEdit={(st) => { setSelectedStation(st); setIsStationModalOpen(true); }}
                onDelete={(st) => setConfirmState({
                  isOpen: true,
                  title: t('confirm.removeStation.title'),
                  message: t('confirm.removeStation.body', { name: st.name }),
                  onConfirm: () => setStations(prev => prev.filter(s => s.id !== st.id)),
                })}
                onUpdateStation={(st) => setStations(prev => prev.map(s => s.id === st.id ? st : s))}
                onSaveGroups={(groups) => setStationGroups(groups)}
              />
            )}

            {activeTab === 'schedule' && (
              <ScheduleTab
                employees={employees}
                filteredEmployees={filteredScheduleEmployees}
                stations={stations}
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
                scheduleViolationsOnly={scheduleViolationsOnly}
                setScheduleViolationsOnly={setScheduleViolationsOnly}
                scheduleGroupByStation={scheduleGroupByStation}
                setScheduleGroupByStation={setScheduleGroupByStation}
                violationCount={violations.filter(v => (v.severity ?? 'violation') === 'violation').length}
                rosterRoles={rosterRoles}
                scheduleUndoStack={scheduleUndoStack}
                prevMonth={prevMonth}
                nextMonth={nextMonth}
                setActiveMonth={setActiveMonth}
                onCellClick={handleCellClick}
                onCellRangeFill={handleCellRangeFill}
                onUndo={undoLastSchedule}
                onUndoCell={undoLastCell}
                cellUndoDepth={cellUndoStack.length}
                onRunAuto={handleRunAutoScheduler}
                canRunAuto={employees.length > 0 && stations.length > 0}
                runAutoDisabledReason={
                  employees.length === 0 && stations.length === 0
                    ? t('schedule.runAuto.disabled.bothEmpty')
                    : employees.length === 0
                      ? t('schedule.runAuto.disabled.noEmployees')
                      : stations.length === 0
                        ? t('schedule.runAuto.disabled.noStations')
                        : undefined
                }
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
                holidays={rawHolidays}
                config={config}
                onAddNew={() => { setEditingHoliday(null); setIsHolidayModalOpen(true); }}
                onEdit={(holi) => { setEditingHoliday(holi); setIsHolidayModalOpen(true); }}
                onDelete={(holi) => setConfirmState({
                  isOpen: true,
                  title: t('confirm.eraseHoliday.title'),
                  message: t('confirm.eraseHoliday.body', { name: holi.name }),
                  onConfirm: () => {
                    const targetId = holi.id ?? holi.date;
                    setHolidays(prev => prev.filter(h => (h.id ?? h.date) !== targetId));
                  },
                })}
                onUpdate={(holi) => {
                  const targetId = holi.id ?? holi.date;
                  setHolidays(prev => prev.map(h => (h.id ?? h.date) === targetId ? holi : h));
                }}
                onSetAllCompModes={(mode) => setHolidays(prev => prev.map(h => ({ ...h, compMode: mode })))}
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
              <VariablesTab config={config} setConfig={setConfig} readOnly={role === 'admin'} />
            )}

            {activeTab === 'audit' && <AuditLogTab />}

            {activeTab === 'settings' && (
              <SettingsTab
                config={config}
                setConfig={setConfig}
                onExportBackup={exportBackup}
                onImportBackup={() => backupInputRef.current?.click()}
                onFactoryReset={handleClearAllData}
                isAuthenticated={isAuthenticated}
                onSignOut={async () => { await signOut(); }}
                onSwitchMode={() => { clearMode(); location.reload(); }}
                allowDestructive={role === null || role === 'super_admin'}
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
        stationGroups={stationGroups}
        shifts={shifts}
        config={config}
      />

      <StationModal
        isOpen={isStationModalOpen}
        onClose={() => setIsStationModalOpen(false)}
        onSave={handleSaveStation}
        station={selectedStation}
        availableRoles={rosterRoles}
      />

      <HolidayModal
        isOpen={isHolidayModalOpen}
        onClose={() => { setIsHolidayModalOpen(false); setEditingHoliday(null); }}
        onSave={handleSaveHoliday}
        holiday={editingHoliday}
        defaultCompMode={config.holidayCompMode ?? 'comp-day'}
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
        infoOnly={confirmState.infoOnly}
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

      {/* The mount key changes on every new auto-scheduler run (`runId` is a
          fresh Date.now() per run). This forces React to remount the modal on
          every consecutive open so it can never get stuck in a partially-
          animated state from a prior preview. */}
      <SchedulePreviewModal
        key={pendingScheduleResult ? `preview-${pendingScheduleResult.runId}` : 'preview-empty'}
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

      {/* Live-suggestion right rail. Only shown on the Schedule tab where it
          actually has context to act on. Replaces the bottom-right
          CoverageHintToast for that tab; the toast is still mounted as a
          fallback for the few seconds between tab switches when the pane
          isn't visible. */}
      {activeTab === 'schedule' ? (
        <SuggestionPane
          hint={activeCoverageHint ? { gap: activeCoverageHint.gap, suggestions: activeCoverageHint.suggestions } : null}
          pendingCount={Math.max(0, coverageHints.length - 1)}
          massChangeDetected={massChangeDetected}
          onDismissHint={() => activeCoverageHint && dismissHintById(activeCoverageHint.id)}
          onPickReplacement={acceptCoverageSwap}
          onRunOptimal={() => {
            // Mass-change CTA: re-run the auto-scheduler in preserve-existing
            // mode so the absences the user just painted stay locked while
            // the algorithm re-fills the rest. Clears the pending-hint queue
            // since they're about to be re-evaluated.
            setCoverageHints([]);
            handleRunAutoScheduler('preserve');
          }}
          recentChanges={recentChanges}
          onUndoChange={undoRecentChange}
          onClearChanges={() => setRecentChanges([])}
          collapsed={paneCollapsed}
          onToggleCollapsed={() => {
            paneUserOverrideRef.current = true;
            setPaneCollapsed(c => !c);
          }}
        />
      ) : (
        <CoverageHintToast
          hint={activeCoverageHint ? { gap: activeCoverageHint.gap, suggestions: activeCoverageHint.suggestions } : null}
          onDismiss={() => activeCoverageHint && dismissHintById(activeCoverageHint.id)}
          onPickReplacement={acceptCoverageSwap}
        />
      )}

      <BulkAssignModal
        isOpen={isBulkAssignOpen}
        onClose={() => setIsBulkAssignOpen(false)}
        selectedCount={selectedEmployees.size}
        shifts={shifts}
        daysInMonth={config.daysInMonth}
        onApply={handleBulkAssignShift}
      />

      {/* Print-only view of the master schedule. Hidden via CSS in normal display
          mode; @media print swaps it in so users can print all employees on a
          single A3 landscape sheet without the virtualised grid clipping rows. */}
      <PrintScheduleView
        employees={employees}
        shifts={shifts}
        holidays={holidays}
        config={config}
        schedule={schedule}
      />
    </div>
    </>
  );
}
