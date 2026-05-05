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
  ShieldCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Employee,
  EmployeeCategory,
  Gender,
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
import { LeaveManagerModal } from './components/LeaveManagerModal';
import { StationModal } from './components/StationModal';
import { BulkAddStationsModal } from './components/BulkAddStationsModal';
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
import { BulkEditEmployeesModal, BulkEditPatch } from './components/BulkEditEmployeesModal';
import { PrintScheduleView } from './components/PrintScheduleView';
import { detectCoverageGap, findSwapCandidates, CoverageGap, CoverageSuggestion } from './lib/coverageHints';
import { suggestHourlyDemandFromHistory } from './lib/demandHistory';
import { PlanEverythingWizard } from './components/PlanEverythingWizard';
import { getEmployeeLeaveOnDate } from './lib/leaves';
import {
  normalizeEmployees, normalizeShifts, normalizeStations, normalizeHolidays,
  normalizeConfig, normalizeAllSchedules, normalizeCompanies,
} from './lib/migration';
import { useI18n } from './lib/i18n';
import { useAuth, tabAllowed, tabWritable } from './lib/auth';
import { clearMode, getMode } from './lib/mode';
import { useFirestoreSync } from './lib/firestoreSync';
import { detectQuotaExhausted } from './lib/firestoreErrors';
import { getActiveStoredEntry } from './lib/firebaseConfigStorage';
import { factoryResetClean } from './lib/factoryReset';
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
  seedCompanyDefaults,
} from './lib/firestoreDomains';
import {
  subscribeMonth as fsSubscribeMonth,
  subscribeMonthApproval as fsSubscribeMonthApproval,
  syncMonth as fsSyncMonth,
  scheduleKeyToFirestoreId,
  submitForApproval as fsSubmitForApproval,
  lockSchedule as fsLockSchedule,
  saveSchedule as fsSaveSchedule,
  sendBackToSupervisor as fsSendBackToSupervisor,
  sendBackToManager as fsSendBackToManager,
  reopenSchedule as fsReopenSchedule,
  getLatestSnapshot as fsGetLatestSnapshot,
  diffScheduleVsSnapshot,
  stampHrisExport as fsStampHrisExport,
  type ApprovalBlock,
  type HrisSyncBlock,
  type ScheduleDiffMap,
  type ScheduleSnapshot,
} from './lib/firestoreSchedules';
import { assembleHrisBundle, buildBundleFilename } from './lib/hrisBundle';
import { effectiveStatus, availableActionsFor, formatApprovalActor } from './lib/scheduleApproval';
import { useApprovalQueue } from './lib/useApprovalQueue';
import {
  SubmitForApprovalModal,
  LockScheduleModal,
  SaveScheduleModal,
  SendBackModal,
  ReopenModal,
} from './components/Schedule/ApprovalActionModals';
import { PendingApprovalsCard } from './components/Schedule/PendingApprovalsCard';
import {
  writeAuditEntries,
  buildApprovalAuditEntry,
  diffEmployees, diffShifts, diffStations, diffStationGroups,
  diffHolidays, diffConfig, diffAllSchedules,
} from './lib/audit';
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
const SuperAdminTab = lazy(() => import('./tabs/SuperAdminTab').then(m => ({ default: m.SuperAdminTab })));
const UserManagementTab = lazy(() => import('./tabs/UserManagementTab').then(m => ({ default: m.UserManagementTab })));

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
  const { user, role, allowedCompanies, tabPerms, displayName, position, signOut, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dataLoaded, setDataLoaded] = useState(false);

  // If the current tab becomes disallowed (e.g. supervisor signs in while
  // activeTab is set to 'workforce' from a previous super-admin session),
  // bounce to the Dashboard which everyone can see.
  useEffect(() => {
    if (!tabAllowed(activeTab, role, tabPerms)) {
      setActiveTab('dashboard');
    }
  }, [activeTab, role, tabPerms]);

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
  // whether the last edit has reached the server. Express-side only — Online
  // mode uses the Firestore sync hook below for an analogous indicator.
  type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Firestore connection status for Online mode. Tracks navigator.onLine +
  // SDK in-sync acknowledgements so the toolbar dot accurately reflects
  // "synced / syncing / queued (offline)" — pre-v4.2 the dot was always
  // green in Online mode regardless of actual connection state.
  const firestoreSync = useFirestoreSync({ enabled: isAuthenticated });

  // v5.0 — schedule approval state for the active month. Subscribed via
  // fsSubscribeMonthApproval (separate from the entries listener). Updates
  // drive the Schedule-tab banner + dictate whether the cell handlers
  // accept clicks (read-only outside draft).
  const [activeMonthApproval, setActiveMonthApproval] = useState<ApprovalBlock | undefined>(undefined);
  const [activeMonthHrisSync, setActiveMonthHrisSync] = useState<HrisSyncBlock | undefined>(undefined);

  // v5.1.0 — re-approval diff view. Three pieces of state, all owned here
  // so the snapshot fetch happens once per toggle and is shared between
  // the schedule grid (which colours cells) and the banner (which shows
  // the count + legend).
  //   • diffSnapshot    — the most-recent /snapshots/{ts} doc, lazy-loaded
  //                        on first toggle. Cleared on month / company switch.
  //   • diffEnabled     — whether the user toggled the diff view on.
  //   • diffLoading     — true while the one-shot getDocs is in flight.
  const [diffSnapshot, setDiffSnapshot] = useState<ScheduleSnapshot | null>(null);
  const [diffEnabled, setDiffEnabled] = useState<boolean>(false);
  const [diffLoading, setDiffLoading] = useState<boolean>(false);

  // v5.1.0 — HRIS manual-bundle export busy state. Shown on the banner
  // button so the admin can't double-click and trigger a parallel zip
  // assembly. The download itself is tied to a one-shot anchor click.
  const [hrisExportBusy, setHrisExportBusy] = useState<boolean>(false);

  // v5.0 — pending-approval queue. Each role sees what's actionable for
  // them. Manager + admin + super-admin care about validation/finalization
  // queues; supervisor sees their own sent-back schedules.
  // Memoised statuses array so the hook's stale-deps warning doesn't fire
  // and so we don't re-subscribe on every render.
  const validationStatuses = useMemo<import('./lib/firestoreSchedules').ApprovalStatus[]>(
    () => (role === 'manager' || role === 'admin' || role === 'super_admin') ? ['submitted'] : [],
    [role],
  );
  const finalizationStatuses = useMemo<import('./lib/firestoreSchedules').ApprovalStatus[]>(
    () => (role === 'admin' || role === 'super_admin') ? ['locked'] : [],
    [role],
  );
  const supervisorRejectedStatuses = useMemo<import('./lib/firestoreSchedules').ApprovalStatus[]>(
    () => role === 'supervisor' ? ['rejected'] : [],
    [role],
  );
  const validationQueue = useApprovalQueue({
    enabled: isAuthenticated && validationStatuses.length > 0,
    statuses: validationStatuses,
    allowedCompanies,
  });
  const finalizationQueue = useApprovalQueue({
    enabled: isAuthenticated && finalizationStatuses.length > 0,
    statuses: finalizationStatuses,
    allowedCompanies,
  });
  const supervisorRejectedQueue = useApprovalQueue({
    enabled: isAuthenticated && supervisorRejectedStatuses.length > 0,
    statuses: supervisorRejectedStatuses,
    allowedCompanies,
    authorUid: user?.uid ?? null,
  });
  // Sidebar badge count — what's actionable for this user.
  const scheduleApprovalBadge =
    validationQueue.length + finalizationQueue.length + supervisorRejectedQueue.length;
  // Modal open-state for the five action flows. Just one boolean per modal —
  // the parent owns the state, the modals are pure presentation.
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [sendBackModalOpen, setSendBackModalOpen] = useState(false);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);

  // Spark plan daily quota exhaustion. When a Firestore write fails with
  // `resource-exhausted` we capture the timestamp + next reset time, surface
  // a friendly modal once (sticky until reload — re-detecting on every retry
  // would spam the user), and stamp localStorage so the SuperAdmin → Quota
  // panel can show "last hit at …" pre-emptively.
  const [quotaState, setQuotaState] = useState<{ exhaustedAt: number; resetAt: Date } | null>(null);
  // v5.18.0 — last non-quota sync failure. Decoupled from updateActive's
  // closure scope (which can't call showInfo directly without a forward
  // reference, see comments around the existing quotaState useEffect).
  // A separate effect below picks up `syncErrorState`, surfaces it once
  // via the info toast machinery, then clears it. Includes `at` so the
  // effect's dep array reacts to repeat failures of the same domain.
  const [syncErrorState, setSyncErrorState] = useState<{ domain: string; message: string; at: number } | null>(null);

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
        const actorEmail = user?.email ?? null;
        // Phase 2.3b — compute audit entries for this domain change. The
        // diff functions mirror server.ts:diffDomain so audit entries
        // stay shape-compatible between Offline (Express-emitted) and
        // Online (client-emitted) modes.
        let auditEntries: import('./lib/audit').AuditEntry[] = [];
        switch (key) {
          case 'employees':     auditEntries = diffEmployees(priorValue as Employee[], next as Employee[]); break;
          case 'shifts':        auditEntries = diffShifts(priorValue as Shift[], next as Shift[]); break;
          case 'stations':      auditEntries = diffStations(priorValue as Station[], next as Station[]); break;
          case 'stationGroups': auditEntries = diffStationGroups(priorValue as StationGroup[] | undefined, next as StationGroup[] | undefined); break;
          case 'holidays':      auditEntries = diffHolidays(priorValue as PublicHoliday[], next as PublicHoliday[]); break;
          case 'config':        auditEntries = diffConfig(priorValue as Config, next as Config); break;
          case 'allSchedules':  auditEntries = diffAllSchedules(priorValue as Record<string, Schedule>, next as Record<string, Schedule>); break;
        }
        const handleQuotaError = (err: unknown) => {
          const quota = detectQuotaExhausted(err);
          if (quota.exhausted && quota.resetAt) {
            const resetAt = quota.resetAt;
            // First detection wins — keep the modal sticky until reload.
            setQuotaState((prev) => prev ?? { exhaustedAt: Date.now(), resetAt });
            // Stamp for SuperAdmin → Quota panel ("last hit at …").
            try {
              window.localStorage.setItem('iraqi-scheduler-quota-last-exhausted', String(Date.now()));
              window.localStorage.setItem('iraqi-scheduler-quota-last-reset-at', resetAt.toISOString());
            } catch { /* localStorage quota itself exhausted — nothing useful to do */ }
          }
        };
        // v5.18.0 — Online-mode save state. Pre-v5.18 saveState only
        // tracked Offline Demo's /api/save lifecycle (the effect at the
        // top of this file bails out under isAuthenticated), so the Save
        // Draft badge in the schedule toolbar showed "Last saved: never"
        // forever in Online mode and the user had no visual confirmation
        // that Firestore writes were landing. We now mirror the same
        // pending → saving → saved/error transitions onto the per-domain
        // sync below so the badge tracks the actual Firestore write
        // outcome.
        setSaveState('saving');
        queueMicrotask(() => {
          // Audit write is fire-and-forget (logged on failure but doesn't
          // block the user's edit). Decoupled from data sync so a network
          // blip on audit doesn't fail the underlying data write.
          if (auditEntries.length) {
            writeAuditEntries(auditEntries, cid, actor, actorEmail).catch((err) => {
              console.error(`[Scheduler] audit write failed (${String(key)}):`, err);
              handleQuotaError(err);
            });
          }
          const sync: Promise<void> | null = (() => {
            switch (key) {
              case 'employees':     return syncEmployees(cid, priorValue as Employee[], next as Employee[], actor);
              case 'shifts':        return syncShifts(cid, priorValue as Shift[], next as Shift[], actor);
              case 'stations':      return syncStations(cid, priorValue as Station[], next as Station[], actor);
              case 'stationGroups': return syncStationGroups(cid, priorValue as StationGroup[] | undefined, next as StationGroup[] | undefined, actor);
              case 'holidays':      return syncHolidays(cid, priorValue as PublicHoliday[], next as PublicHoliday[], actor);
              case 'config':        return syncConfig(cid, priorValue as Config, next as Config, actor);
              case 'allSchedules': {
                // Phase 2.3 — diff which month(s) changed and emit per-month
                // syncs. Almost every edit touches exactly one month (active
                // month), but cross-month flows (auto-scheduler with rolling-
                // 7-day awareness, paste-month) can change two at once.
                const prevMap = priorValue as Record<string, Schedule>;
                const nextMap = next as Record<string, Schedule>;
                const allKeys = new Set<string>([...Object.keys(prevMap), ...Object.keys(nextMap)]);
                const promises: Promise<void>[] = [];
                for (const k of allKeys) {
                  if (prevMap[k] === nextMap[k]) continue;
                  const yyyymm = scheduleKeyToFirestoreId(k);
                  if (!yyyymm) continue;
                  promises.push(fsSyncMonth(cid, yyyymm, prevMap[k] ?? {}, nextMap[k] ?? {}, actor));
                }
                return promises.length ? Promise.all(promises).then(() => undefined) : null;
              }
              default:              return null;
            }
          })();
          if (sync) {
            sync.then(() => {
              setSaveState('saved');
              setLastSavedAt(Date.now());
            }).catch((err) => {
              console.error(`[Scheduler] Firestore ${String(key)} sync failed:`, err);
              setSaveState('error');
              handleQuotaError(err);
              // v5.18.0 — surface non-quota errors as a user-visible info
              // toast. Quota exhaustion already pops its own dedicated
              // modal (handleQuotaError → quotaState → useEffect →
              // showInfo); this catches the rest (permission denied,
              // network drop, malformed payload) so the user knows their
              // edit didn't land instead of seeing only console output.
              const quota = detectQuotaExhausted(err);
              if (!quota.exhausted) {
                const message = err instanceof Error ? err.message : String(err);
                setSyncErrorState({ domain: String(key), message, at: Date.now() });
              }
            });
          } else {
            // Domain change emitted no sync (e.g. allSchedules diff with
            // no actual month change). Fall back to "saved" immediately
            // so the badge doesn't stay stuck on "saving".
            setSaveState('saved');
            setLastSavedAt(Date.now());
          }
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
    // v5.11.0 — stamp the edit time so the Online beforeunload warning
    // can decide whether the user is mid-edit. Cell paint is the only
    // path through this setter.
    lastScheduleEditAtRef.current = Date.now();
    setAllSchedules(prev => {
      const current = prev[scheduleKey] ?? {};
      const next = typeof updater === 'function' ? (updater as (p: Schedule) => Schedule)(current) : updater;
      return { ...prev, [scheduleKey]: next };
    });
  }, [scheduleKey, setAllSchedules]);

  // Initial data fetch.
  //
  // ── Mode-aware source-of-truth (v4.2) ─────────────────────────────────────
  // Pre-v4.2 this fetch ran unconditionally and Firestore subscriptions
  // overlaid on top in Online mode — meaning the user briefly saw whatever
  // stale data the local Express JSON happened to hold before Firestore took
  // over. Two sources of truth coexisting is exactly the dual-dispatch concern
  // a senior reviewer flagged. From v4.2 forward the rule is:
  //
  //   • Online  → Firestore is the only source of truth. Firestore's own
  //     IndexedDB cache (persistentLocalCache in firestoreClient.ts) handles
  //     mid-edit disconnects: writes queue locally, sync on reconnect; reads
  //     serve from cache when offline. The Express /api/data fetch is skipped
  //     entirely so there's no stale shadow to confuse the user.
  //   • Offline → Express + JSON is the only source of truth. Existing
  //     behavior preserved verbatim.
  useEffect(() => {
    if (getMode() === 'online') {
      // Online mode: leave companies + companyData empty; the Firestore
      // subscriptions below will hydrate from cache (instant) or server
      // (typically <500ms). Mark dataLoaded=true immediately so the UI
      // doesn't sit in a loading state — empty-state copy in each tab is
      // the right thing to show during the brief subscription warmup.
      setDataLoaded(true);
      return;
    }
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
            if (cancelled || cid !== activeCompanyId || !cfg) return;
            // v5.1.1 — preserve the user's local UI navigation when the
            // server config updates. year / month / daysInMonth are per-
            // user navigation state, NOT shared governance, so we keep
            // whatever the local picker has and only fold in the
            // governance fields from the server.
            setCompanyData((prev) => {
              const cur = prev[cid] ?? emptyCompanyData();
              const localCfg = cur.config;
              const merged: Config = {
                ...cfg,
                year: localCfg.year,
                month: localCfg.month,
                daysInMonth: localCfg.daysInMonth,
              };
              return { ...prev, [cid]: { ...cur, config: merged } };
            });
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

  // Phase 2.3 — active-month schedule subscription. Subscribes only to the
  // currently-displayed month (config.year, config.month). When the user
  // navigates to another month, the previous subscription tears down and a
  // new one starts. Other months remain in local state from prior visits
  // (cached, not real-time) — acceptable trade-off vs. paying for a
  // subscription per month-the-user-might-look-at.
  useEffect(() => {
    if (!isAuthenticated || !activeCompanyId) return;
    const cid = activeCompanyId;
    const yyyymm = `${config.year}-${String(config.month).padStart(2, '0')}`;
    const localKey = `scheduler_schedule_${config.year}_${config.month}`;
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        unsub = await fsSubscribeMonth(cid, yyyymm, (sched) => {
          if (cancelled || cid !== activeCompanyId) return;
          setCompanyData((prev) => {
            const cur = prev[cid] ?? emptyCompanyData();
            return {
              ...prev,
              [cid]: { ...cur, allSchedules: { ...cur.allSchedules, [localKey]: sched } },
            };
          });
        });
      } catch (err) {
        console.error('[Scheduler] Firestore subscribeMonth failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [isAuthenticated, activeCompanyId, config.year, config.month]);

  // v5.0 — approval block subscription for the active month. Separate
  // listener so cell-content edits and approval transitions don't share a
  // re-render path. Resets to undefined on month switch / company switch
  // / sign-out so stale state doesn't leak between contexts.
  useEffect(() => {
    // v5.1.0 — every month/company switch invalidates the diff state.
    // The toggle's "off" default + an empty snapshot prevents a stale
    // snapshot from a previous month leaking into the cell renderer.
    setDiffSnapshot(null);
    setDiffEnabled(false);
    setDiffLoading(false);
    if (!isAuthenticated || !activeCompanyId) {
      setActiveMonthApproval(undefined);
      setActiveMonthHrisSync(undefined);
      return;
    }
    const cid = activeCompanyId;
    const yyyymm = `${config.year}-${String(config.month).padStart(2, '0')}`;
    let cancelled = false;
    let unsub: (() => void) | undefined;
    setActiveMonthApproval(undefined);
    setActiveMonthHrisSync(undefined);
    (async () => {
      try {
        unsub = await fsSubscribeMonthApproval(cid, yyyymm, ({ approval, hrisSync }) => {
          if (cancelled || cid !== activeCompanyId) return;
          setActiveMonthApproval(approval);
          setActiveMonthHrisSync(hrisSync);
        });
      } catch (err) {
        console.error('[Scheduler] Firestore subscribeMonthApproval failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [isAuthenticated, activeCompanyId, config.year, config.month]);

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
  // v5.10.0 — keep the latest serialised save body in a ref so the
  // beforeunload listener can synchronously ship it via sendBeacon when
  // the window is closed mid-debounce. Without this, the 500ms timeout
  // below could be cancelled by the unload itself, dropping the user's
  // most recent draft edits. sendBeacon guarantees the request makes it
  // out the door even after unload returns; perfect fit for "OS clicked
  // the X button" mid-paint.
  const saveBodyRef = React.useRef<string | null>(null);
  const forceSaveNowRef = React.useRef<() => Promise<void>>(async () => {});
  // v5.11.0 — track the timestamp of the most recent schedule edit so
  // the Online-mode beforeunload warning can decide whether the user
  // is mid-edit. Updated on every cell paint via the schedule update
  // path; cleared a few seconds after the last edit so the warning
  // doesn't fire spuriously when the user just navigates away after
  // a successful sync.
  const lastScheduleEditAtRef = React.useRef<number>(0);

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
    const serialized = JSON.stringify(body);
    saveBodyRef.current = serialized;
    // forceSaveNow flushes the latest body via fetch (so callers can
    // await + show success). The Save Draft button uses this; the
    // beforeunload path uses sendBeacon for the synchronous guarantee.
    forceSaveNowRef.current = async () => {
      if (!saveBodyRef.current) return;
      setSaveState('saving');
      try {
        await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: saveBodyRef.current,
        });
        setSaveState('saved');
        setLastSavedAt(Date.now());
      } catch (err) {
        console.error('[Scheduler] Force-save failed:', err);
        setSaveState('error');
        throw err;
      }
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
        body: serialized,
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

  // v5.10.0 — beforeunload safety net for Offline Demo mode. If the user
  // closes the window via the OS X button mid-debounce (the 500ms timer
  // above gets cancelled by the unload), this ships the most recent
  // body via sendBeacon — a fire-and-forget POST that the browser
  // guarantees to deliver even after unload returns. Solves the bug
  // "drafts cleared on quit" reported during the v5.9 trial.
  // v5.11.0 — extended to Online mode too. Pre-v5.11 we relied on the
  // Firestore SDK's own queue (persistentLocalCache writes go to
  // IndexedDB synchronously and flush on next launch). That works in
  // theory but the user reported lost future-month drafts after a
  // quick close, suggesting a race somewhere — most likely:
  //   * cell-paint setSchedule() schedules a microtask
  //   * before the microtask fires (typically <1ms but not guaranteed),
  //     the window is killed
  //   * the queued write never reaches IndexedDB either
  // We now add a `beforeunload` warning in Online mode that fires
  // a confirm prompt if there's unflushed state — same browser-level
  // protection as "you have unsaved changes" everywhere else.
  useEffect(() => {
    if (isAuthenticated) {
      // Online mode: warn the user when leaving within 5 seconds of the
      // last cell paint. The Firestore SDK queues writes synchronously
      // to IndexedDB, but the dispatch from React state setter to that
      // queue happens through a microtask — close the window mid-paint
      // and the queued write may never reach IndexedDB. The 5s window
      // is generous: paints typically flush sub-millisecond, but the
      // warning fires only if the user is actively editing AND
      // immediately closes. Outside that window the SDK has had ample
      // time to land the write.
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        const since = Date.now() - lastScheduleEditAtRef.current;
        if (lastScheduleEditAtRef.current > 0 && since < 5000) {
          // Modern browsers ignore custom strings here but the
          // empty preventDefault is enough to trigger the prompt.
          e.preventDefault();
          e.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', onBeforeUnload);
      return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }
    // Offline mode: send the latest body via sendBeacon (synchronously
    // queued, browser-guaranteed delivery even after unload).
    const onBeforeUnload = () => {
      if (!saveBodyRef.current) return;
      try {
        const blob = new Blob([saveBodyRef.current], { type: 'application/json' });
        navigator.sendBeacon('/api/save', blob);
      } catch {
        // sendBeacon throws on size limits (~64KB-1MB depending on
        // browser). Fallback: nothing we can do synchronously here.
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isAuthenticated]);

  // Operational State
  const [paintMode, setPaintMode] = useState<{ shiftCode: string; stationId?: string } | null>(null);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [isStationModalOpen, setIsStationModalOpen] = useState(false);
  const [isBulkStationOpen, setIsBulkStationOpen] = useState(false);
  // v5.5.0 — lifted from PayrollTab so the LeaveManagerModal can also be
  // opened from inside the EmployeeModal (giving manager + supervisor a
  // path to leave management without needing Payroll write access).
  const [leaveEditFor, setLeaveEditFor] = useState<Employee | null>(null);

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
  // v5.18.0 — Plan-Everything wizard open flag.
  const [isPlanWizardOpen, setIsPlanWizardOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);

  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<PublicHoliday | null>(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);

  // Lightweight info dialog — single OK button, no destructive action. Used
  // in place of native `alert()` so the message respects RTL layout and the
  // app's visual language. Title can be empty for plain-text confirmations.
  const [infoState, setInfoState] = useState<{ isOpen: boolean; title: string; message: string }>({
    isOpen: false, title: '', message: '',
  });
  const showInfo = React.useCallback((title: string, message: string) => {
    setInfoState({ isOpen: true, title, message });
  }, []);

  // Surface the quota-exhausted message exactly once per detection. The
  // updateActive sync catch sets quotaState; this useEffect is what actually
  // triggers the user-visible modal. Decoupling avoids calling showInfo from
  // inside updateActive (which is declared earlier, before showInfo exists).
  useEffect(() => {
    if (!quotaState) return;
    const fmt = new Intl.DateTimeFormat(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const localResetTime = fmt.format(quotaState.resetAt);
    showInfo(
      t('info.quota.title'),
      t('info.quota.body', { time: localResetTime }),
    );
  }, [quotaState, showInfo, t]);

  // v5.18.0 — surface non-quota Firestore sync errors via the same info-
  // toast machinery. Pre-v5.18 these failures only logged to the console,
  // so a user whose write failed (auth lapse, network drop, malformed
  // payload, permission rule mismatch) saw no feedback and assumed the
  // edit had landed. Cleared once shown so a repeat failure of the same
  // domain can re-fire (timestamp `at` is part of the dep so duplicates
  // re-trigger).
  useEffect(() => {
    if (!syncErrorState) return;
    showInfo(
      t('info.error.title'),
      t('info.syncFailed.body', { domain: syncErrorState.domain, message: syncErrorState.message }),
    );
    setSyncErrorState(null);
  }, [syncErrorState, showInfo, t]);

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
  // v5.18.0 — `${empId}:${day}` key set for hard violations only. The
  // Schedule grid threads this through to ScheduleCell to paint a small
  // red corner dot on each flagged cell. Memoized off `violations` so
  // unrelated re-renders (modal open/close, filter typing) don't rebuild
  // the set or invalidate the row's prop equality.
  const violationCellKeys = useMemo(() => {
    const set = new Set<string>();
    for (const v of violations) set.add(`${v.empId}:${v.day}`);
    return set;
  }, [violations]);

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
    // v5.18.0 — when the user opens an auto-generated shift in the modal
    // and saves it, strip the `autoGenerated` flag so it becomes a user-
    // curated record. "Clear all auto-generated" then leaves it alone.
    const owned: Shift = shift.autoGenerated ? { ...shift, autoGenerated: false } : shift;
    if (editingShift) {
      setShifts(prev => prev.map(s => s.code === editingShift.code ? owned : s));
    } else {
      setShifts(prev => [...prev, owned]);
    }
    setIsShiftModalOpen(false);
    setEditingShift(null);
  };

  // v5.18.0 — auto-generator hooks. `handleApplyGeneratedShifts` appends
  // the generator's output (each shift carries `autoGenerated: true`).
  // De-duplicates against existing codes defensively even though the
  // generator already avoids collisions. `handleClearAutoGeneratedShifts`
  // drops every shift currently flagged auto-generated; user-curated
  // records (where the flag was stripped on edit) survive.
  const handleApplyGeneratedShifts = React.useCallback((generated: Shift[]) => {
    setShifts(prev => {
      const have = new Set(prev.map(s => s.code.toUpperCase()));
      return [...prev, ...generated.filter(g => !have.has(g.code.toUpperCase()))];
    });
  }, [setShifts]);

  const handleClearAutoGeneratedShifts = React.useCallback(() => {
    setShifts(prev => prev.filter(s => !s.autoGenerated));
  }, [setShifts]);

  // v5.18.0 — Plan-Everything wizard. Bulk-applies hourly demand
  // suggestions across multiple stations in one setStations pass so the
  // Firestore sync and audit log see a single coherent edit instead of
  // N micro-writes. Updates are { stationId, suggestion } pairs.
  const handleApplyStationDemandBulk = React.useCallback((updates: Array<{ stationId: string; suggestion: import('./lib/demandHistory').DemandSuggestion }>) => {
    if (updates.length === 0) return;
    const byId = new Map(updates.map(u => [u.stationId, u.suggestion]));
    setStations(prev => prev.map(s => {
      const sug = byId.get(s.id);
      if (!sug || sug.noData) return s;
      return { ...s, normalHourlyDemand: sug.normal, peakHourlyDemand: sug.peak };
    }));
  }, [setStations]);

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

  // v5.2.0 — applies a BulkEditPatch to every selected employee in a single
  // setEmployees pass. Routes through the same updateActive setter as the
  // single-employee modal, so the Firestore syncEmployees fan-out fires once
  // (or once per affected doc, depending on the diff) — both Offline and
  // Online modes get the same end state. List ops use predictable
  // add/remove/replace semantics; the EmployeeModal's "carve-out" magic is
  // intentionally NOT mirrored here because it would surprise the supervisor
  // when applied to fifty rows at once.
  const applyBulkEdit = (patch: BulkEditPatch) => {
    const applyList = (current: string[] | undefined, mode: typeof patch.stations.mode, ids: string[]): string[] => {
      const cur = current || [];
      if (mode === 'add')     return Array.from(new Set([...cur, ...ids]));
      if (mode === 'remove')  return cur.filter(x => !ids.includes(x));
      if (mode === 'replace') return [...ids];
      return cur;
    };
    setEmployees(prev => prev.map(emp => {
      if (!selectedEmployees.has(emp.empId)) return emp;
      const next: Employee = { ...emp };
      if (patch.stations.mode !== 'skip')        next.eligibleStations  = applyList(emp.eligibleStations,  patch.stations.mode,        patch.stations.ids);
      if (patch.groups.mode !== 'skip')          next.eligibleGroups    = applyList(emp.eligibleGroups,    patch.groups.mode,          patch.groups.ids);
      if (patch.preferredShifts.mode !== 'skip') next.preferredShiftCodes = applyList(emp.preferredShiftCodes, patch.preferredShifts.mode, patch.preferredShifts.codes);
      if (patch.avoidShifts.mode !== 'skip')     next.avoidShiftCodes     = applyList(emp.avoidShiftCodes,     patch.avoidShifts.mode,     patch.avoidShifts.codes);
      if (patch.role !== undefined) next.role = patch.role;
      if (patch.department !== undefined) next.department = patch.department;
      if (patch.contractType !== undefined) next.contractType = patch.contractType;
      if (patch.contractedWeeklyHrs !== undefined) {
        next.contractedWeeklyHrs = patch.contractedWeeklyHrs;
        // Keep the stored OT hourly rate in sync — same recompute path the
        // EmployeeModal uses when the user changes weekly hours individually.
        next.baseHourlyRate = Math.round(baseHourlyRate(next, config));
      }
      if (patch.fixedRestDay !== undefined) next.fixedRestDay = patch.fixedRestDay;
      if (patch.category !== undefined) next.category = patch.category;
      if (patch.gender !== undefined) {
        if (patch.gender === null) delete next.gender;
        else next.gender = patch.gender;
      }
      if (patch.annualLeaveBalance !== undefined) next.annualLeaveBalance = patch.annualLeaveBalance;
      if (patch.isHazardous !== undefined) next.isHazardous = patch.isHazardous;
      if (patch.isIndustrialRotating !== undefined) next.isIndustrialRotating = patch.isIndustrialRotating;
      if (patch.hourExempt !== undefined) next.hourExempt = patch.hourExempt;
      return next;
    }));
    setIsBulkEditOpen(false);
    showInfo(
      t('info.bulkEdit.title'),
      t('info.bulkEdit.body', { count: selectedEmployees.size }),
    );
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
        // factoryResetClean reloads the page itself once the wipe
        // completes — don't add .then/setTimeout/showInfo here. Any
        // post-clear React render can re-populate localStorage from
        // useEffect deps (e.g. the activeCompanyId persistence effect),
        // which is why the function navigates away immediately.
        void factoryResetClean(isAuthenticated);
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
        // ── Online mode ────────────────────────────────────────────────
        // Firestore is the source of truth and persistentLocalCache has
        // already queued/synced every edit, so there's nothing to flush
        // to Express here. Skipping the /api/save call also avoids
        // writing a stale shadow copy of cloud data into the local JSON
        // (which would resurface as bogus state if the user later picks
        // Offline mode on this same machine). Just close the window.
        if (getMode() === 'online') {
          fetch('/api/shutdown', { method: 'POST' }).catch(() => { /* express may be irrelevant in online mode */ });
          showInfo(t('confirm.shutdown.title'), t('info.shutdown.body'));
          setTimeout(() => window.close(), 1000);
          return;
        }
        // ── Offline mode ───────────────────────────────────────────────
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

    // v5.1.9: parses the full 16-column template. Strips a leading UTF-8 BOM
    // (Excel writes one when re-saving the BOM-prefixed template) and uses a
    // quoted-field parser so Arabic names containing commas survive.
    const parseCsvRow = (row: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (inQuotes) {
          if (ch === '"') {
            if (row[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
          } else cur += ch;
        } else {
          if (ch === ',') { out.push(cur); cur = ''; }
          else if (ch === '"') inQuotes = true;
          else cur += ch;
        }
      }
      out.push(cur);
      return out.map(s => s.trim());
    };
    // v5.3.0: tri-state boolean parser. Returns undefined when the cell is
    // blank so the upsert path can leave the existing flag untouched
    // ("don't change") instead of silently overwriting with a default.
    const parseOptionalBool = (v: string | undefined): boolean | undefined => {
      if (v == null) return undefined;
      const s = v.trim().toLowerCase();
      if (s === '') return undefined;
      if (['true', 'yes', 'y', '1'].includes(s)) return true;
      if (['false', 'no', 'n', '0'].includes(s)) return false;
      return undefined;
    };
    // Parses the row into an explicitly-optional patch. Each field is
    // undefined when the CSV cell was blank; the upsert path uses that
    // signal to decide what to overwrite vs leave alone.
    type RowPatch = {
      empId: string; // empty -> brand-new auto-id
      name?: string;
      role?: string;
      department?: string;
      contractType?: string;
      contractedWeeklyHrs?: number;
      phone?: string;
      hireDate?: string;
      baseMonthlySalary?: number;
      annualLeaveBalance?: number;
      fixedRestDay?: number;
      category?: EmployeeCategory;
      gender?: Gender; // undefined -> leave as-is
      isHazardous?: boolean;
      isIndustrialRotating?: boolean;
      hourExempt?: boolean;
    };
    const parseRow = (cols: string[]): RowPatch | null => {
      const [
        id, name, role, dept, type, hrs, phone, hireDate, salary,
        annualLeave, restDay, category, gender, hazardous, industrial, hourExempt,
      ] = cols;
      // The only thing that uniquely identifies a row across imports is the
      // empId. With no id AND no name there's nothing to upsert against,
      // skip silently.
      if (!id?.trim() && !name?.trim()) return null;
      const trim = (s?: string) => (s ?? '').trim();
      const blankToUndef = (s?: string) => (trim(s) === '' ? undefined : trim(s));
      const numOrUndef = (s?: string) => {
        if (trim(s) === '') return undefined;
        const n = parseInt(s as string);
        return Number.isFinite(n) ? n : undefined;
      };
      const restRaw = numOrUndef(restDay);
      const fixedRestDay = restRaw !== undefined && restRaw >= 0 && restRaw <= 7 ? restRaw : undefined;
      const catRaw = trim(category).toLowerCase();
      const cat: EmployeeCategory | undefined = catRaw === 'driver' ? 'Driver' : catRaw === 'standard' ? 'Standard' : undefined;
      const g = trim(gender).toUpperCase();
      const genderField: Gender | undefined = g === 'F' ? 'F' : g === 'M' ? 'M' : undefined;
      const hireDateField = /^\d{4}-\d{2}-\d{2}$/.test(trim(hireDate)) ? trim(hireDate) : undefined;
      const annual = numOrUndef(annualLeave);
      return {
        empId: trim(id),
        name: blankToUndef(name),
        role: blankToUndef(role),
        department: blankToUndef(dept),
        contractType: blankToUndef(type),
        contractedWeeklyHrs: numOrUndef(hrs),
        phone: blankToUndef(phone),
        hireDate: hireDateField,
        baseMonthlySalary: numOrUndef(salary),
        annualLeaveBalance: annual !== undefined ? Math.max(0, annual) : undefined,
        fixedRestDay,
        category: cat,
        gender: genderField,
        isHazardous: parseOptionalBool(hazardous),
        isIndustrialRotating: parseOptionalBool(industrial),
        hourExempt: parseOptionalBool(hourExempt),
      };
    };

    const reader = new FileReader();
    reader.onload = (event) => {
      let text = event.target?.result as string;
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const lines = text.split(/\r?\n/);
      const patches: RowPatch[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = parseCsvRow(line);
        if (cols.length < 2) continue;
        const p = parseRow(cols);
        if (p) patches.push(p);
      }
      if (patches.length === 0) return;

      // v5.3.0 — merge-upsert semantics. For each CSV row:
      //   * empId matches an existing employee → patch only the fields the
      //     CSV provided a non-empty value for. Schedule, leaves, OT history,
      //     eligibleStations, eligibleGroups, shift preferences, holidayBank
      //     etc. all stay untouched.
      //   * empId is empty OR doesn't match → append as a new employee with
      //     defaults filling in the blanks (legacy behaviour for v5.1.x).
      // The whole pass replaces the employees array in one setEmployees call
      // so the Firestore syncEmployees diff only fires for the docs that
      // actually changed (dual-mode parity).
      let added = 0;
      let updated = 0;
      let skipped = 0;
      setEmployees(prev => {
        const byId = new Map(prev.map(e => [e.empId, e]));
        const next = [...prev];
        for (const p of patches) {
          const existing = p.empId ? byId.get(p.empId) : undefined;
          if (existing) {
            // Build a shallow patch: only properties the CSV explicitly set.
            const merged: Employee = { ...existing };
            if (p.name !== undefined) merged.name = p.name;
            if (p.role !== undefined) merged.role = p.role;
            if (p.department !== undefined) merged.department = p.department;
            if (p.contractType !== undefined) merged.contractType = p.contractType;
            if (p.contractedWeeklyHrs !== undefined) merged.contractedWeeklyHrs = p.contractedWeeklyHrs;
            if (p.phone !== undefined) merged.phone = p.phone;
            if (p.hireDate !== undefined) merged.hireDate = p.hireDate;
            if (p.baseMonthlySalary !== undefined) merged.baseMonthlySalary = p.baseMonthlySalary;
            if (p.annualLeaveBalance !== undefined) merged.annualLeaveBalance = p.annualLeaveBalance;
            if (p.fixedRestDay !== undefined) merged.fixedRestDay = p.fixedRestDay;
            if (p.category !== undefined) merged.category = p.category;
            if (p.gender !== undefined) merged.gender = p.gender;
            if (p.isHazardous !== undefined) merged.isHazardous = p.isHazardous;
            if (p.isIndustrialRotating !== undefined) merged.isIndustrialRotating = p.isIndustrialRotating;
            if (p.hourExempt !== undefined) merged.hourExempt = p.hourExempt;
            // Recompute the OT hourly rate if either input changed — same
            // path the EmployeeModal uses for individual edits.
            if (p.baseMonthlySalary !== undefined || p.contractedWeeklyHrs !== undefined) {
              merged.baseHourlyRate = Math.round(baseHourlyRate(merged, config));
            }
            // Detect "no real change" so the toast count and the syncEmployees
            // diff both reflect intent. JSON-equality is acceptable here:
            // the patch is shallow, the Employee object is plain JSON.
            if (JSON.stringify(merged) === JSON.stringify(existing)) {
              skipped++;
              continue;
            }
            const idx = next.findIndex(e => e.empId === existing.empId);
            if (idx >= 0) next[idx] = merged;
            byId.set(existing.empId, merged);
            updated++;
          } else {
            const weeklyHrs = p.contractedWeeklyHrs ?? 48;
            const monthlySalary = p.baseMonthlySalary ?? DEFAULT_MONTHLY_SALARY_IQD;
            const fresh: Employee = {
              empId: p.empId || `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
              name: p.name ?? 'Unnamed',
              role: p.role ?? 'General Staff',
              department: p.department ?? 'Warehouse',
              contractType: p.contractType ?? 'Permanent',
              contractedWeeklyHrs: weeklyHrs,
              shiftEligibility: 'All',
              isHazardous: p.isHazardous ?? false,
              isIndustrialRotating: p.isIndustrialRotating ?? true,
              hourExempt: p.hourExempt ?? false,
              fixedRestDay: p.fixedRestDay ?? 0,
              phone: p.phone ?? '',
              hireDate: p.hireDate ?? format(new Date(), 'yyyy-MM-dd'),
              notes: 'Imported via CSV',
              eligibleStations: [],
              holidayBank: 0,
              annualLeaveBalance: p.annualLeaveBalance ?? 21,
              baseMonthlySalary: monthlySalary,
              baseHourlyRate: Math.round(baseHourlyRate(
                { baseMonthlySalary: monthlySalary, contractedWeeklyHrs: weeklyHrs },
                config,
              )),
              overtimeHours: 0,
              category: p.category ?? 'Standard',
              ...(p.gender ? { gender: p.gender } : {}),
            };
            next.push(fresh);
            byId.set(fresh.empId, fresh);
            added++;
          }
        }
        return next;
      });

      // Toast splits the result so the supervisor can tell whether the import
      // grew the roster or just patched existing rows. Skipped rows usually
      // mean "CSV row was identical to current data" — surfaced as a hint.
      showInfo(
        t('info.csvImport.title'),
        t('info.csvImport.body', { added, updated, skipped }),
      );
    };
    reader.readAsText(file, 'utf-8');
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
    // v5.1.9: full 16-column template covering every field on the Employee
    // card. Prepended with a UTF-8 BOM so Excel detects the encoding and
    // round-trips Arabic text without turning it into ?????? on save.
    const headers = [
      'Employee ID',
      'Employee Name',
      'Role',
      'Department',
      'Contract Type',
      'Weekly Hours',
      'Phone',
      'Hire Date (YYYY-MM-DD)',
      'Base Salary (IQD)',
      'Annual Leave Balance',
      'Rest Day Policy (0=Rotate,1=Sun,2=Mon,3=Tue,4=Wed,5=Thu,6=Fri,7=Sat)',
      'Personnel Category (Standard|Driver)',
      'Gender (M|F)',
      'Hazardous (yes|no)',
      'Industrial (yes|no)',
      'Hour Exempt (yes|no)',
    ];
    const sampleRows = [
      ['EMP-1100', 'John Doe',  'Operator', 'Warehouse', 'Permanent', '48', '07700000000', '2023-01-15', '1500000', '21', '0', 'Standard', 'M', 'no',  'yes', 'no'],
      ['EMP-3100', 'Ali Driver','Driver',   'Transport', 'Permanent', '56', '07712345678', '2022-05-01', '1400000', '21', '5', 'Driver',   'M', 'no',  'no',  'no'],
      ['EMP-2200', 'أحمد علي',  'Operator', 'Warehouse', 'Permanent', '48', '07798765432', '2024-03-20', '1500000', '21', '0', 'Standard', 'M', 'no',  'yes', 'no'],
    ];
    const BOM = String.fromCharCode(0xFEFF);
    const csvContent = BOM + [headers, ...sampleRows]
      .map(row => row.map(csvCell).join(','))
      .join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Roster_Import_Template.csv';
    a.click();
    URL.revokeObjectURL(url);
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

  // v5.18.0 — closure handed to StationModal so the user can derive an
  // hourly demand profile from the past N months of `allSchedules`. The
  // modal owns the UI; this owns access to the data. Returns null when
  // the station id is unknown (modal is editing a fresh record that
  // hasn't been saved yet — there's no history keyed off it).
  const handleSuggestStationDemandFromHistory = React.useCallback((stationId: string) => {
    if (!stationId) return null;
    const target = stations.find(s => s.id === stationId) || selectedStation;
    if (!target) return null;
    return suggestHourlyDemandFromHistory({
      station: target,
      allSchedules,
      shifts,
      holidays,
      config,
    });
  }, [stations, selectedStation, allSchedules, shifts, holidays, config]);

  // v5.3.0 — single-pass commit for the bulk-station modal. The modal has
  // already done collision detection against existingStations, but a defensive
  // de-dup here protects against the (unlikely) race where the user opens
  // bulk-add, another tab adds an ID via Firestore subscription, and the
  // commit happens before re-render. setStations routes through updateActive
  // so syncStations fires once per actually-new doc — Offline + Online land
  // in identical end state.
  const handleBulkAddStations = (newStations: Station[]) => {
    setStations(prev => {
      const existingIds = new Set(prev.map(s => s.id));
      const filtered = newStations.filter(s => !existingIds.has(s.id));
      return [...prev, ...filtered];
    });
    setIsBulkStationOpen(false);
    showInfo(
      t('info.bulkStation.title'),
      t('info.bulkStation.body', { count: newStations.length }),
    );
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
        // Seed the new company's subcollections with the same defaults
        // Offline mode bootstraps from emptyCompanyData(): INITIAL_SHIFTS
        // (FS, MX, P1-P3, OFF, AL, SL, PH, MAT, CP), INITIAL_HOLIDAYS
        // (Iraqi public holidays), and DEFAULT_CONFIG (Iraqi Labor Law
        // thresholds). Without this, Online-mode new companies appear
        // with empty rosters / no shifts / no holidays — a regression vs
        // the v3.0.0 single-user experience.
        await seedCompanyDefaults(
          id,
          INITIAL_SHIFTS,
          INITIAL_HOLIDAYS,
          { ...DEFAULT_CONFIG, company: name },
          user?.uid ?? null,
        );
        // Optimistic local seed — the per-company subscription will fire
        // shortly and confirm/replace these with the canonical Firestore
        // data, which now matches.
        setCompanyData(prev => prev[id] ? prev : ({
          ...prev,
          [id]: {
            ...emptyCompanyData(),
            holidays: INITIAL_HOLIDAYS,
            config: { ...DEFAULT_CONFIG, company: name },
          },
        }));
        setActiveCompanyId(id);
      } catch (err) {
        console.error('[Scheduler] Firestore addCompany / seed failed:', err);
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

  // ── v5.0 — schedule approval action handlers ─────────────────────────
  //
  // Each handler:
  //   1. Calls the Firestore transition (which runs runTransaction +
  //      validates state+role).
  //   2. Writes a corresponding audit-log entry on success.
  //   3. Surfaces user-friendly errors via the existing showInfo modal.
  //   4. Closes its modal. Busy flag prevents double-click while in flight.
  //
  // The activeMonthApproval state subscription will pick up the new state
  // automatically — no need to manually update local state here.

  const activeMonthYyyymm = `${config.year}-${String(config.month).padStart(2, '0')}`;
  const activeMonthLabel = format(
    new Date(config.year, config.month - 1, 1),
    'MMMM yyyy',
  );
  const activeCompanyLabel = (() => {
    const c = companies.find((co) => co.id === activeCompanyId);
    return c?.name ?? activeMonthYyyymm;
  })();

  const approvalActorMeta = (): import('./lib/firestoreSchedules').TransitionActor | null => {
    if (!isAuthenticated || !user || !role) return null;
    return {
      uid: user.uid,
      email: user.email,
      role,
      // v5.0.2 — name + position flow into the approval block so the
      // banner / queue / history viewer attribute actions to a human
      // identity instead of a UID. Both nullable; the UI degrades to
      // email when missing.
      name: displayName,
      position,
    };
  };

  const handleApprovalError = (err: unknown, fallback: string) => {
    const e = err as { code?: string; message?: string };
    // v5.0.2 — log the raw error too so dev-tools captures Firestore
    // permission-denied / validator messages we can use to diagnose
    // user-reported "nothing happens" cases (e.g. reopen-from-saved).
    console.error('[Scheduler] Approval transition failed:', err);
    showInfo(
      t('info.error.title'),
      e?.message ?? fallback,
    );
  };

  const handleSubmitForApproval = async (notes: string) => {
    const meta = approvalActorMeta();
    if (!meta || !activeCompanyId) return;
    setApprovalBusy(true);
    try {
      await fsSubmitForApproval(activeCompanyId, activeMonthYyyymm, meta, notes || undefined);
      void writeAuditEntries(
        [buildApprovalAuditEntry({ action: 'submit', yyyymm: activeMonthYyyymm, actorRole: meta.role, notes: notes || undefined })],
        activeCompanyId, meta.uid, meta.email,
      ).catch(() => { /* audit failures are non-fatal */ });
      setSubmitModalOpen(false);
    } catch (err) {
      handleApprovalError(err, 'Submit failed.');
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleLockSchedule = async (notes: string) => {
    const meta = approvalActorMeta();
    if (!meta || !activeCompanyId) return;
    setApprovalBusy(true);
    try {
      await fsLockSchedule(activeCompanyId, activeMonthYyyymm, meta, notes || undefined);
      void writeAuditEntries(
        [buildApprovalAuditEntry({ action: 'lock', yyyymm: activeMonthYyyymm, actorRole: meta.role, notes: notes || undefined })],
        activeCompanyId, meta.uid, meta.email,
      ).catch(() => {});
      setLockModalOpen(false);
    } catch (err) {
      handleApprovalError(err, 'Lock failed — the schedule may have already been acted on by another user. Refresh and retry.');
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleSaveSchedule = async (notes: string) => {
    const meta = approvalActorMeta();
    if (!meta || !activeCompanyId) return;
    setApprovalBusy(true);
    try {
      await fsSaveSchedule(activeCompanyId, activeMonthYyyymm, meta, notes || undefined);
      void writeAuditEntries(
        [buildApprovalAuditEntry({ action: 'save', yyyymm: activeMonthYyyymm, actorRole: meta.role, notes: notes || undefined })],
        activeCompanyId, meta.uid, meta.email,
      ).catch(() => {});
      setSaveModalOpen(false);
    } catch (err) {
      handleApprovalError(err, 'Save failed — the schedule may have already been finalized by another user.');
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleSendBack = async (notes: string) => {
    const meta = approvalActorMeta();
    if (!meta || !activeCompanyId) return;
    const fromStatus = effectiveStatus(activeMonthApproval);
    setApprovalBusy(true);
    try {
      // Branch on current state: submitted → rejected (manager-initiated)
      // or locked → submitted (admin sends back to manager).
      if (fromStatus === 'submitted') {
        await fsSendBackToSupervisor(activeCompanyId, activeMonthYyyymm, meta, notes);
      } else if (fromStatus === 'locked') {
        await fsSendBackToManager(activeCompanyId, activeMonthYyyymm, meta, notes);
      } else {
        throw new Error(`Cannot send back from "${fromStatus}".`);
      }
      const fromLevel: 'manager' | 'admin' = fromStatus === 'locked' ? 'admin' : (meta.role === 'manager' ? 'manager' : 'admin');
      void writeAuditEntries(
        [buildApprovalAuditEntry({ action: 'send-back', yyyymm: activeMonthYyyymm, actorRole: meta.role, notes, fromLevel })],
        activeCompanyId, meta.uid, meta.email,
      ).catch(() => {});
      setSendBackModalOpen(false);
    } catch (err) {
      handleApprovalError(err, 'Send-back failed.');
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleReopenSchedule = async (notes: string) => {
    const meta = approvalActorMeta();
    if (!meta || !activeCompanyId) return;
    const postExport = !!activeMonthHrisSync?.lastExportedAt;
    setApprovalBusy(true);
    try {
      await fsReopenSchedule(activeCompanyId, activeMonthYyyymm, meta, notes);
      void writeAuditEntries(
        [buildApprovalAuditEntry({ action: 'reopen', yyyymm: activeMonthYyyymm, actorRole: meta.role, notes, postHrisExport: postExport })],
        activeCompanyId, meta.uid, meta.email,
      ).catch(() => {});
      setReopenModalOpen(false);
    } catch (err) {
      handleApprovalError(err, 'Reopen failed.');
    } finally {
      setApprovalBusy(false);
    }
  };

  // Compute editability + cached values for the Schedule tab + modals.
  // v5.18.0 — both memoized so every cell paint / modal open / unrelated
  // state nudge doesn't re-call effectiveStatus + availableActionsFor.
  // Read across ~12 props on the ScheduleTab render and several
  // canRunAuto guards; cheap to compute, but stable identity matters
  // for the downstream React.memo'd children.
  const activeMonthStatus = useMemo(
    () => effectiveStatus(activeMonthApproval),
    [activeMonthApproval],
  );
  const activeMonthCanEdit = useMemo(
    () => availableActionsFor(activeMonthStatus, role).canEditCells,
    [activeMonthStatus, role],
  );

  // v5.1.0 — re-approval diff view.
  // hasArchivedSnapshot is derived from the approval block (no extra
  // listener) — if the schedule has ever reached `saved` status, at least
  // one /snapshots doc was written. The toggle button surfaces in the
  // banner when this is true; clicking it lazy-loads the snapshot and
  // computes the diff against the current `schedule`.
  const hasArchivedSnapshot = useMemo(() => {
    if (!activeMonthApproval) return false;
    if (activeMonthApproval.savedAt) return true;
    return !!activeMonthApproval.history?.some((h) => h.action === 'save');
  }, [activeMonthApproval]);

  const handleToggleDiff = async (next: boolean) => {
    if (!next) {
      setDiffEnabled(false);
      return;
    }
    if (!activeCompanyId) return;
    // If we already have the snapshot for this month, just flip the flag.
    if (diffSnapshot) {
      setDiffEnabled(true);
      return;
    }
    setDiffLoading(true);
    try {
      const snap = await fsGetLatestSnapshot(activeCompanyId, activeMonthYyyymm);
      if (!snap) {
        // Edge case — banner thought there was a snapshot but the
        // collection was empty (e.g. snapshot doc write failed silently
        // post-save). Surface a friendly notice instead of leaving the
        // user staring at a still-toggled-off button.
        showInfo(
          t('info.notice.title'),
          'No archived snapshot is available for this month yet. The diff view becomes available after the schedule has been saved at least once.',
        );
        return;
      }
      setDiffSnapshot(snap);
      setDiffEnabled(true);
    } catch (err) {
      console.error('[Scheduler] getLatestSnapshot failed:', err);
      // v5.1.1 — surface the concrete error code/message in the modal
      // so the user can act on it without dev tools. The most common
      // cause is permission-denied when a freshly-created admin signs
      // in before their custom claim propagates (the bridge revokes
      // refresh tokens on role change so a sign-out + sign-in fixes it).
      const e = err as { code?: string; message?: string };
      const reason = e?.code === 'permission-denied'
        ? 'Permission denied reading /snapshots/. If your role was changed recently, sign out and sign back in to refresh the token, then try again.'
        : e?.message
          ? `${e.code ?? 'error'}: ${e.message}`
          : 'Refresh and try again.';
      showInfo(
        t('info.error.title'),
        `Failed to load the archived snapshot for the diff view. ${reason}`,
      );
    } finally {
      setDiffLoading(false);
    }
  };

  // Compute the diff map only when the toggle is on and we have a
  // snapshot. Memoised on (schedule, snapshot) so cell-level edits while
  // the diff is on recompute cheaply.
  const diffMap: ScheduleDiffMap | null = useMemo(() => {
    if (!diffEnabled || !diffSnapshot) return null;
    return diffScheduleVsSnapshot(schedule, diffSnapshot.entries);
  }, [diffEnabled, diffSnapshot, schedule]);

  const diffSnapshotLabel = diffSnapshot?.savedAt
    ? `since ${format(new Date(diffSnapshot.savedAt), 'yyyy-MM-dd HH:mm')}`
    : null;

  // v5.1.0 — HRIS manual-bundle export.
  // Available only when status === 'saved' (the schedule is officially
  // archived). Assembles the .zip in-memory via jszip (lazy-loaded), kicks
  // off the browser download, then writes hrisSync.lastExportedAt + audit
  // entry. Never touches the entries map — pure read + Firestore stamp.
  const handleExportHrisBundle = async () => {
    const meta = approvalActorMeta();
    if (!meta || !activeCompanyId || !activeMonthApproval) return;
    if (effectiveStatus(activeMonthApproval) !== 'saved') return;
    setHrisExportBusy(true);
    try {
      const blob = await assembleHrisBundle({
        companyId: activeCompanyId,
        companyName: activeCompanyLabel,
        monthLabel: activeMonthLabel,
        yyyymm: activeMonthYyyymm,
        year: config.year,
        month: config.month,
        daysInMonth: config.daysInMonth,
        schedule,
        employees,
        shifts,
        stations,
        holidays,
        config,
        violations,
        approval: activeMonthApproval,
        exportedByUid: meta.uid,
        exportedByName: meta.name ?? null,
        exportedByPosition: meta.position ?? null,
        exportedByEmail: meta.email,
      });
      // Browser-side download via a transient anchor + object URL. The
      // URL is revoked on next tick to release the Blob — leaving it
      // around hangs onto the in-memory zip until page reload.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildBundleFilename(activeMonthYyyymm, activeCompanyId);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);

      // Firestore stamp + audit run AFTER the user has the file in hand
      // so a stamp-write failure can't make them think the export
      // didn't happen. Both are best-effort — the bundle on disk is the
      // canonical artifact.
      try {
        await fsStampHrisExport(activeCompanyId, activeMonthYyyymm, meta);
      } catch (err) {
        console.error('[Scheduler] stampHrisExport failed (non-fatal):', err);
      }
      void writeAuditEntries(
        [buildApprovalAuditEntry({ action: 'hris-export', yyyymm: activeMonthYyyymm, actorRole: meta.role })],
        activeCompanyId, meta.uid, meta.email,
      ).catch(() => {});
    } catch (err) {
      console.error('[Scheduler] HRIS bundle export failed:', err);
      const e = err as { message?: string };
      showInfo(
        t('info.error.title'),
        e?.message ?? 'Failed to assemble the HRIS bundle. Refresh and try again.',
      );
    } finally {
      setHrisExportBusy(false);
    }
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
            {/* Active Firebase project badge — only in Online mode and only
                when the active config came from in-app paste (not env vars).
                Helps super-admins running multiple projects see at a glance
                which one this app is talking to. */}
            {isAuthenticated && (() => {
              const active = getActiveStoredEntry();
              return active ? (
                <p className="text-blue-300/80 text-[9px] font-bold uppercase tracking-widest mt-1 truncate" title={active.config.projectId}>
                  · {active.label}
                </p>
              ) : null;
            })()}
          </div>
        </div>

        {/* v5.1.1 — Identity badge. Name + position + role of the
            currently signed-in user, always visible in the sidebar header
            so reviewers know which "voice" they're acting with before
            clicking Lock / Save / Send-back. Only renders in Online mode
            (Offline mode is single-user; identity is implicit). When the
            super-admin hasn't filled in displayName/position yet, falls
            back to email + role label. */}
        {isAuthenticated && user && (
          <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-900/60">
            <div className="flex items-start gap-2">
              <div className={cn(
                'shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black uppercase tracking-wide',
                role === 'super_admin' ? 'bg-purple-500/20 text-purple-200' :
                role === 'admin' ? 'bg-blue-500/20 text-blue-200' :
                role === 'manager' ? 'bg-orange-500/20 text-orange-200' :
                role === 'supervisor' ? 'bg-emerald-500/20 text-emerald-200' :
                'bg-slate-500/20 text-slate-200',
              )}>
                {(displayName || user.email || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white text-[12px] font-semibold truncate" title={displayName ?? user.email ?? ''}>
                  {displayName ?? user.email ?? '(no name)'}
                </p>
                {position && (
                  <p className="text-slate-300 text-[10px] truncate" title={position}>
                    {position}
                  </p>
                )}
                <p className={cn(
                  'text-[9px] font-bold uppercase tracking-widest mt-0.5',
                  role === 'super_admin' ? 'text-purple-300' :
                  role === 'admin' ? 'text-blue-300' :
                  role === 'manager' ? 'text-orange-300' :
                  role === 'supervisor' ? 'text-emerald-300' :
                  'text-slate-400',
                )}>
                  {role === 'super_admin' ? 'Super admin' :
                   role === 'admin' ? 'Admin' :
                   role === 'manager' ? 'Manager' :
                   role === 'supervisor' ? 'Supervisor' :
                   'No role'}
                </p>
              </div>
            </div>
          </div>
        )}

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
            {tabAllowed('dashboard', role, tabPerms) && <TabButton active={activeTab === 'dashboard'} label={t('tab.dashboard')} index="01" icon={BarChart3} onClick={() => setActiveTab('dashboard')} />}
            {tabAllowed('schedule', role, tabPerms) && <TabButton active={activeTab === 'schedule'} label={t('tab.schedule')} index="02" icon={Calendar} onClick={() => setActiveTab('schedule')} badge={scheduleApprovalBadge} />}
            {tabAllowed('roster', role, tabPerms) && <TabButton active={activeTab === 'roster'} label={t('tab.roster')} index="03" icon={Users} onClick={() => setActiveTab('roster')} />}
            {tabAllowed('payroll', role, tabPerms) && <TabButton active={activeTab === 'payroll'} label={t('tab.payroll')} index="04" icon={BarChart3} onClick={() => setActiveTab('payroll')} />}
          </SidebarGroup>
          <SidebarGroup label={t('sidebar.group.analytics')}>
            {tabAllowed('coverageOT', role, tabPerms) && <TabButton active={activeTab === 'coverageOT'} label={t('tab.coverageOT')} index="05" icon={TrendingUp} onClick={() => setActiveTab('coverageOT')} />}
            {tabAllowed('workforce', role, tabPerms) && <TabButton active={activeTab === 'workforce'} label={t('tab.workforce')} index="06" icon={Building2} onClick={() => setActiveTab('workforce')} />}
            {tabAllowed('reports', role, tabPerms) && <TabButton active={activeTab === 'reports'} label={t('tab.reports')} index="07" icon={FileSpreadsheet} onClick={() => setActiveTab('reports')} />}
          </SidebarGroup>
          <SidebarGroup label={t('sidebar.group.setup')}>
            {tabAllowed('layout', role, tabPerms) && <TabButton active={activeTab === 'layout'} label={t('tab.layout')} index="08" icon={Layout} onClick={() => setActiveTab('layout')} />}
            {tabAllowed('shifts', role, tabPerms) && <TabButton active={activeTab === 'shifts'} label={t('tab.shifts')} index="09" icon={Clock} onClick={() => setActiveTab('shifts')} />}
            {tabAllowed('holidays', role, tabPerms) && <TabButton active={activeTab === 'holidays'} label={t('tab.holidays')} index="10" icon={Flag} onClick={() => setActiveTab('holidays')} />}
            {tabAllowed('variables', role, tabPerms) && <TabButton active={activeTab === 'variables'} label={t('tab.variables')} index="11" icon={Scale} onClick={() => setActiveTab('variables')} />}
          </SidebarGroup>
          <SidebarGroup label={t('sidebar.group.system')}>
            {tabAllowed('audit', role, tabPerms) && <TabButton active={activeTab === 'audit'} label={t('tab.audit')} index="12" icon={Database} onClick={() => setActiveTab('audit')} />}
            {tabAllowed('settings', role, tabPerms) && <TabButton active={activeTab === 'settings'} label={t('tab.settings')} index="13" icon={Settings} onClick={() => setActiveTab('settings')} />}
            {tabAllowed('userManagement', role, tabPerms) && <TabButton active={activeTab === 'userManagement'} label={t('tab.userManagement')} index="14" icon={Users} onClick={() => setActiveTab('userManagement')} />}
            {tabAllowed('superAdmin', role, tabPerms) && <TabButton active={activeTab === 'superAdmin'} label={t('tab.superAdmin')} index="15" icon={ShieldCheck} onClick={() => setActiveTab('superAdmin')} />}
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
          {/* v4.2.1 — tab-specific actions (export schedule, mass-import
              employees, download CSV template, enter simulation) moved out
              of the global toolbar into their own tabs (Roster + Schedule).
              The header now only carries truly global state: the active-
              database chip, the connection-status dot, and an "exit
              simulation" pill that's visible from any tab while sim mode is
              on, so the supervisor can never get stuck in sandbox by
              navigating away from Schedule. */}
          <div className="flex gap-2">
            {simMode && (
              <button
                onClick={exitSimMode}
                title={t('sim.toolbar.exit')}
                className="apple-press px-4 py-1.5 bg-indigo-600 text-white border border-indigo-700 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-700 shadow-md flex items-center gap-2"
              >
                <FlaskConical className="w-3 h-3" />
                {t('sim.toolbar.exit')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3" aria-live="polite">
            {/* Active Firebase project chip — Online mode only. Always
                visible in the top header so a multi-project super-admin
                can never be confused about which database they're working
                against. Clicking it jumps to Settings → Connected
                databases for switching. */}
            {isAuthenticated && (() => {
              const active = getActiveStoredEntry();
              if (!active) return null;
              return (
                <button
                  onClick={() => setActiveTab('settings')}
                  className="apple-press inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200 border border-blue-100 dark:border-blue-500/30 rounded-md text-[10px] font-bold uppercase tracking-widest font-mono hover:bg-blue-100 dark:hover:bg-blue-500/25 transition-colors max-w-[260px]"
                  title={`Active database: ${active.label} (${active.config.projectId})`}
                >
                  <Database className="w-3 h-3 shrink-0" />
                  <span className="truncate">{active.label}</span>
                </button>
              );
            })()}
            {(() => {
              // In Online mode the Express auto-save isn't running, so the
              // saveState dot is meaningless there. Drive the indicator off
              // Firestore connection state instead — synced (server caught
              // up), syncing (writes in flight), or queued (offline; writes
              // sit in IndexedDB cache until reconnect).
              if (isAuthenticated && !simMode) {
                const { online, syncing, queued, lastSyncedAt } = firestoreSync;
                const dotColor =
                  queued ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
                  syncing ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse' :
                  online ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                  'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]';
                const label =
                  queued ? t('toolbar.online.queued') :
                  syncing ? t('toolbar.online.syncing') :
                  lastSyncedAt ? t('toolbar.online.syncedAt', { time: format(new Date(lastSyncedAt), 'HH:mm:ss') }) :
                  t('toolbar.online.online');
                return (
                  <>
                    <div className={cn("h-2.5 w-2.5 rounded-full", dotColor)} />
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono tracking-tighter uppercase font-bold">{label}</span>
                  </>
                );
              }
              // Offline mode (or sim): existing Express auto-save dot.
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
              <div className="space-y-6">
                {/* v5.0 — pending-approval cards. Rendered above the
                    dashboard's KPI strip so they're the first thing the
                    user sees on login if there's anything actionable.
                    Cards self-hide when the queue is empty (caller
                    decides). */}
                {(role === 'manager' || role === 'admin' || role === 'super_admin') && validationQueue.length > 0 && (
                  <PendingApprovalsCard
                    kind="awaiting-validation"
                    rows={validationQueue}
                    companies={companies}
                    onJump={(cid, yyyymm) => {
                      const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
                      if (m) setActiveMonth(Number(m[1]), Number(m[2]));
                      if (cid !== activeCompanyId) setActiveCompanyId(cid);
                      setActiveTab('schedule');
                    }}
                  />
                )}
                {(role === 'admin' || role === 'super_admin') && finalizationQueue.length > 0 && (
                  <PendingApprovalsCard
                    kind="awaiting-finalization"
                    rows={finalizationQueue}
                    companies={companies}
                    onJump={(cid, yyyymm) => {
                      const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
                      if (m) setActiveMonth(Number(m[1]), Number(m[2]));
                      if (cid !== activeCompanyId) setActiveCompanyId(cid);
                      setActiveTab('schedule');
                    }}
                  />
                )}
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
              </div>
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
                onOpenLeaveManager={(emp) => setLeaveEditFor(emp)}
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
                onBulkEdit={() => setIsBulkEditOpen(true)}
                onMassImport={() => fileInputRef.current?.click()}
                onDownloadTemplate={downloadRosterTemplate}
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
                onBulkAdd={() => setIsBulkStationOpen(true)}
                // v5.4.0 — drag-drop + selection-toolbar bulk move. Single
                // setStations pass so the kanban only re-renders once and
                // syncStations only diffs the moved docs.
                onBulkMoveStations={(ids, newGroupId) => {
                  const idSet = new Set(ids);
                  setStations(prev => prev.map(s => idSet.has(s.id) ? { ...s, groupId: newGroupId } : s));
                }}
                // Bulk delete from the selection toolbar — gated by a
                // single confirm dialog showing the count so an accidental
                // click doesn't wipe the layout.
                onBulkDeleteStations={(ids) => setConfirmState({
                  isOpen: true,
                  title: t('confirm.removeStations.title'),
                  message: t('confirm.removeStations.body', { count: ids.length }),
                  onConfirm: () => {
                    const idSet = new Set(ids);
                    setStations(prev => prev.filter(s => !idSet.has(s.id)));
                  },
                })}
                // v5.13.0 — drag-drop role gate. When a station's
                // requiredRoles don't intersect the target group's
                // eligibleRoles, the kanban routes the rejected station
                // to ungrouped instead of placing in a category that
                // can't staff it. Toast surfaces which stations were
                // rejected and why so the supervisor can adjust roles.
                onRoleMismatchDrop={(targetGroupName, rejected) => {
                  const names = rejected.map(r => r.name).join(', ');
                  showInfo(
                    t('layout.dnd.roleMismatch.title'),
                    t('layout.dnd.roleMismatch.body', { count: rejected.length, names, group: targetGroupName }),
                  );
                }}
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
                canRunAuto={activeMonthCanEdit && !simMode && employees.length > 0 && stations.length > 0}
                runAutoDisabledReason={
                  // v5.1.1 — auto-scheduler must respect the cell-edit gate.
                  // Pre-v5.1.1 admins (and any role on a submitted/locked
                  // schedule) could still kick off auto-schedule, which
                  // wrote `entries` and bypassed the workflow.
                  // v5.16.0 — disabled-reason strings now flow through t()
                  // so they translate in Arabic mode (pre-v5.16 they were
                  // hardcoded English).
                  !activeMonthCanEdit
                    ? (role === 'admin'
                        ? t('schedule.runAuto.disabled.adminOnly')
                        : t('schedule.runAuto.disabled.readOnly'))
                    : employees.length === 0 && stations.length === 0
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
                violationCellKeys={violationCellKeys}
                onExportSchedule={exportScheduleCSV}
                simMode={simMode}
                onEnterSimMode={enterSimMode}
                approval={activeMonthApproval}
                monthLabel={`${activeMonthLabel} — ${activeCompanyLabel}`}
                role={role}
                canEditCells={activeMonthCanEdit && !simMode}
                onSubmitForApproval={() => setSubmitModalOpen(true)}
                onLockSchedule={() => setLockModalOpen(true)}
                onSendBackSchedule={() => setSendBackModalOpen(true)}
                onSaveSchedule={() => setSaveModalOpen(true)}
                onReopenSchedule={() => setReopenModalOpen(true)}
                onGoToRoster={() => setActiveTab('roster')}
                onGoToLayout={() => setActiveTab('layout')}
                onOpenPlanWizard={() => setIsPlanWizardOpen(true)}
                // v5.16.0 — diff view + HRIS bundle props grouped into
                // a single `archive` bundle. Reduces the ScheduleTab call
                // site from ~30 props to ~22.
                archive={{
                  hasArchivedSnapshot,
                  diffMap,
                  diffEnabled,
                  diffLoading,
                  diffSnapshotLabel,
                  onToggleDiff: handleToggleDiff,
                  onExportHrisBundle: handleExportHrisBundle,
                  hrisExportBusy,
                  hrisLastExportedAt: (() => {
                    const ts = activeMonthHrisSync?.lastExportedAt as { toMillis?: () => number; seconds?: number } | undefined;
                    if (!ts) return null;
                    if (typeof ts.toMillis === 'function') return ts.toMillis();
                    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
                    return null;
                  })(),
                }}
                // v5.10.0 — explicit "Save draft" force-flush. In Online
                // mode the Firestore SDK already does this on cell paint;
                // this button gives the supervisor a confirmable
                // single-click "I'm done editing for now" action and a
                // visible toast. In Offline Demo mode it bypasses the
                // 500ms debounce in case the user wants to close the
                // window immediately after a paint.
                // v5.11.0 — Save Draft now works in BOTH modes:
                //   * Offline Demo: bypasses the 500ms /api/save debounce
                //   * Online: awaits Firestore's pending-writes queue via
                //     waitForPendingWrites() so the toast confirms the
                //     drafts have actually reached Firestore (not just
                //     IndexedDB cache). Pre-v5.11 the button was hidden
                //     in Online mode under the assumption that auto-sync
                //     was sufficient — the user reported lost drafts
                //     after closing the window mid-microtask, so an
                //     explicit confirmable action is now needed in both.
                onSaveDraft={async () => {
                  try {
                    if (isAuthenticated) {
                      const { getDb } = await import('./lib/firestoreClient');
                      const { waitForPendingWrites } = await import('firebase/firestore');
                      const db = await getDb();
                      // Block until every queued mutation has been
                      // ACK'd by the server. If we're offline this
                      // resolves only when the network comes back —
                      // the toast then reads "saved" against actual
                      // server state, not a hopeful local cache write.
                      await waitForPendingWrites(db);
                    } else {
                      await forceSaveNowRef.current();
                    }
                    showInfo(t('schedule.saveDraft.success.title'), t('schedule.saveDraft.success.body'));
                  } catch {
                    showInfo(t('schedule.saveDraft.error.title'), t('schedule.saveDraft.error.body'));
                  }
                }}
                saveState={saveState}
                lastSavedAt={lastSavedAt}
                // v5.12.0 — carry-forward CP toggle. Defaults true; the
                // supervisor flips it off only when finalising payroll
                // (closing the business / final cycle) so deferred comp
                // can no longer be honoured and falls back to OT premium.
                // Pending count is computed live: walk active month's
                // employees through computeHolidayPay and sum each
                // employee's carriedForwardCompDays into a total +
                // distinct-worker count for the hint string.
                carryForwardUnspentCompDays={config.carryForwardUnspentCompDays ?? true}
                onToggleCarryForward={(next) => setConfig(prev => ({ ...prev, carryForwardUnspentCompDays: next }))}
                pendingCarriedForwardCount={(() => {
                  if (!(config.carryForwardUnspentCompDays ?? true)) return undefined;
                  let total = 0;
                  let workers = 0;
                  for (const emp of employees) {
                    const hourly = baseHourlyRate(emp, config);
                    const breakdown = computeHolidayPay(emp, schedule, shifts, holidays, config, hourly, allSchedules);
                    if (breakdown.carriedForwardCompDays > 0) {
                      total += breakdown.carriedForwardCompDays;
                      workers += 1;
                    }
                  }
                  return { count: total, workers };
                })()}
              />
            )}

            {activeTab === 'shifts' && (
              <ShiftsTab
                shifts={shifts}
                stations={stations}
                config={config}
                onApplyGenerated={handleApplyGeneratedShifts}
                onClearAutoGenerated={handleClearAutoGeneratedShifts}
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
                // v5.7.0 — same gate as the VariablesTab default-comp-mode
                // editor: only manager + super_admin can change Art. 74
                // policy. Pre-v5.7 supervisor could bypass the rule by
                // cycling per-holiday compMode pills here.
                compModeReadOnly={role !== null && role !== 'super_admin' && role !== 'manager'}
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
              <VariablesTab
                config={config}
                setConfig={setConfig}
                readOnly={!tabWritable('variables', role, tabPerms)}
                // v5.1.3 — operating window (default open/close + per-day
                // overrides) is OPERATIONAL config that manager + supervisor
                // own. Admin remains read-only here (consistent with
                // monitor-only on cells). Offline mode (role===null) is
                // single-user and fully editable.
                operatingWindowReadOnly={role === 'admin'}
                // v5.5.0 — holidayCompMode (Comp / Cash / Both default for
                // public-holiday work) is also OPERATIONAL config and the
                // manager owns it. Per the user request: "the manager should
                // be able to determine how to deal with overtime to choose
                // comp or cash or both as the default". Super_admin can also
                // edit (they can edit everything). Admin + supervisor stay
                // read-only here. Offline mode (role===null) is fully
                // editable as a single-user fallback.
                holidayCompModeReadOnly={role !== null && role !== 'super_admin' && role !== 'manager'}
              />
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

            {activeTab === 'superAdmin' && (
              <SuperAdminTab
                companies={companies}
                onAddCompany={addCompany}
                onRenameCompany={renameCompany}
                onDeleteCompany={deleteCompany}
              />
            )}

            {activeTab === 'userManagement' && (
              <UserManagementTab companies={companies} />
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
        // v5.5.0 — open the LeaveManagerModal from inside the Employee
        // card. setLeaveEditFor is the same setter the Payroll tab uses,
        // so the modal opens with the same plumbing regardless of where
        // the user came from.
        onManageLeaves={editingEmployee ? () => setLeaveEditFor(editingEmployee) : undefined}
      />

      {/* v5.5.0 — LeaveManagerModal hoisted to App.tsx so it's reachable
          from BOTH the Payroll tab and the EmployeeModal. Pre-v5.5 it
          only mounted inside PayrollTab, which gated leave management
          behind Payroll write access (super_admin / admin only). Manager
          + supervisor now reach it through the Employee card. */}
      <LeaveManagerModal
        isOpen={leaveEditFor !== null}
        employee={leaveEditFor}
        schedule={schedule}
        config={config}
        onClose={() => setLeaveEditFor(null)}
        onSave={(next) => {
          setEmployees(prev => prev.map(e => e.empId === next.empId ? next : e));
          setLeaveEditFor(null);
        }}
      />

      <StationModal
        isOpen={isStationModalOpen}
        onClose={() => setIsStationModalOpen(false)}
        onSave={handleSaveStation}
        station={selectedStation}
        availableRoles={rosterRoles}
        onSuggestFromHistory={handleSuggestStationDemandFromHistory}
      />

      {/* v5.18.0 — Plan-Everything wizard. Tied to the schedule toolbar's
          "Plan everything" button via the activeTab='schedule' branch.
          Mounted at App.tsx so it can call into the same setShifts /
          setStations / handleRunAutoScheduler hooks the rest of the app
          uses, keeping mutations on a single audited path. */}
      <PlanEverythingWizard
        isOpen={isPlanWizardOpen}
        onClose={() => setIsPlanWizardOpen(false)}
        employees={employees}
        shifts={shifts}
        stations={stations}
        holidays={holidays}
        config={config}
        allSchedules={allSchedules}
        schedule={schedule}
        onApplyStationDemand={handleApplyStationDemandBulk}
        onApplyShifts={handleApplyGeneratedShifts}
        onRunAutoScheduler={() => handleRunAutoScheduler('preserve')}
        isPeakDay={isPeakDay}
      />

      <BulkAddStationsModal
        isOpen={isBulkStationOpen}
        onClose={() => setIsBulkStationOpen(false)}
        existingStations={stations}
        stationGroups={stationGroups}
        availableRoles={rosterRoles}
        onApply={handleBulkAddStations}
      />

      <HolidayModal
        isOpen={isHolidayModalOpen}
        onClose={() => { setIsHolidayModalOpen(false); setEditingHoliday(null); }}
        onSave={handleSaveHoliday}
        holiday={editingHoliday}
        defaultCompMode={config.holidayCompMode ?? 'comp-day'}
        compModeReadOnly={role !== null && role !== 'super_admin' && role !== 'manager'}
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

      {/* v5.0 — schedule approval action modals. Each fires a runTransaction
          on the schedule doc; activeMonthApproval subscription picks up the
          new state automatically and re-renders the banner. The compliance
          summary numbers are passed through from the existing violations
          array so manager + admin see exactly what the supervisor saw. */}
      {(() => {
        const hardViolations = violations.filter(v => (v.severity ?? 'violation') === 'violation').length;
        const infoFindings = violations.filter(v => v.severity === 'info').length;
        // Heuristic score — same penalty (2pts per violation, capped to 0)
        // we use elsewhere; specific number isn't load-bearing, just gives
        // the approver a quick gauge.
        const compliancePctValue = Math.max(0, 100 - hardViolations * 2);
        const monthLabel = activeMonthLabel;
        const companyLabel = activeCompanyLabel;
        const submittedAtMs = (() => {
          const t2 = activeMonthApproval?.submittedAt as { toMillis?: () => number; seconds?: number } | undefined;
          if (!t2) return null;
          if (typeof t2.toMillis === 'function') return t2.toMillis();
          if (typeof t2.seconds === 'number') return t2.seconds * 1000;
          return null;
        })();
        const lockedAtMs = (() => {
          const t2 = activeMonthApproval?.lockedAt as { toMillis?: () => number; seconds?: number } | undefined;
          if (!t2) return null;
          if (typeof t2.toMillis === 'function') return t2.toMillis();
          if (typeof t2.seconds === 'number') return t2.seconds * 1000;
          return null;
        })();
        const lastExportedAtMs = (() => {
          const t2 = activeMonthHrisSync?.lastExportedAt as { toMillis?: () => number; seconds?: number } | undefined;
          if (!t2) return null;
          if (typeof t2.toMillis === 'function') return t2.toMillis();
          if (typeof t2.seconds === 'number') return t2.seconds * 1000;
          return null;
        })();
        const sendBackDestination: 'supervisor' | 'manager' = (
          effectiveStatus(activeMonthApproval) === 'submitted' ? 'supervisor' : 'manager'
        );
        return (
          <>
            <SubmitForApprovalModal
              isOpen={submitModalOpen}
              onClose={() => setSubmitModalOpen(false)}
              onConfirm={handleSubmitForApproval}
              monthLabel={monthLabel}
              companyLabel={companyLabel}
              violations={hardViolations}
              infos={infoFindings}
              scorePct={compliancePctValue}
              busy={approvalBusy}
            />
            <LockScheduleModal
              isOpen={lockModalOpen}
              onClose={() => setLockModalOpen(false)}
              onConfirm={handleLockSchedule}
              monthLabel={monthLabel}
              companyLabel={companyLabel}
              submittedBy={formatApprovalActor(
                activeMonthApproval?.submittedByName,
                activeMonthApproval?.submittedByPosition,
                activeMonthApproval?.submittedBy,
              )}
              submittedAtLabel={submittedAtMs ? format(new Date(submittedAtMs), 'yyyy-MM-dd HH:mm') : null}
              violations={hardViolations}
              infos={infoFindings}
              scorePct={compliancePctValue}
              busy={approvalBusy}
            />
            <SaveScheduleModal
              isOpen={saveModalOpen}
              onClose={() => setSaveModalOpen(false)}
              onConfirm={handleSaveSchedule}
              monthLabel={monthLabel}
              companyLabel={companyLabel}
              lockedBy={formatApprovalActor(
                activeMonthApproval?.lockedByName,
                activeMonthApproval?.lockedByPosition,
                activeMonthApproval?.lockedBy,
              )}
              lockedAtLabel={lockedAtMs ? format(new Date(lockedAtMs), 'yyyy-MM-dd HH:mm') : null}
              violations={hardViolations}
              infos={infoFindings}
              scorePct={compliancePctValue}
              busy={approvalBusy}
            />
            <SendBackModal
              isOpen={sendBackModalOpen}
              onClose={() => setSendBackModalOpen(false)}
              onConfirm={handleSendBack}
              monthLabel={monthLabel}
              companyLabel={companyLabel}
              destination={sendBackDestination}
              busy={approvalBusy}
            />
            <ReopenModal
              isOpen={reopenModalOpen}
              onClose={() => setReopenModalOpen(false)}
              onConfirm={handleReopenSchedule}
              monthLabel={monthLabel}
              companyLabel={companyLabel}
              lastExportedAt={lastExportedAtMs}
              busy={approvalBusy}
            />
          </>
        );
      })()}

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

      <BulkEditEmployeesModal
        isOpen={isBulkEditOpen}
        onClose={() => setIsBulkEditOpen(false)}
        selectedCount={selectedEmployees.size}
        stations={stations}
        stationGroups={stationGroups}
        shifts={shifts}
        onApply={applyBulkEdit}
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
