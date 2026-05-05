import React, { useMemo, useEffect, useState, useRef } from 'react';
import { ChevronLeft, Search, MousePointer2, Sparkles, Hash, AlertTriangle, X, Wrench, Wand2, Keyboard, Undo2, AlertOctagon, Printer, Calendar, ChevronDown, ChevronRight, MapPin, Download, FlaskConical, Save } from 'lucide-react';
import { ScheduleApprovalBanner } from '../components/Schedule/ScheduleApprovalBanner';
import { CoverageDiagnosticsPanel } from '../components/Schedule/CoverageDiagnosticsPanel';
import { format } from 'date-fns';
import { List, type RowComponentProps } from 'react-window';
import { Employee, Shift, PublicHoliday, Config, Schedule, Station } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { ScheduleCell, MonthYearPicker } from '../components/Primitives';
import { computeEmployeeRunningStats, formatEmployeeStatsTooltip, EmployeeRunningStats } from '../lib/employeeStats';
import { summarizeDiffMap } from '../lib/firestoreSchedules';

export type PaintMode = { shiftCode: string; stationId?: string } | null;

// v5.16.0 — Archive ops bundle. Groups the diff-view + HRIS-bundle-
// export props that all flow into the approval banner so App.tsx can
// pre-build them once instead of inlining 9 separate fields.
export interface ScheduleArchiveProps {
  // True if at least one /snapshots doc exists for this month — gates
  // the diff toggle's visibility.
  hasArchivedSnapshot?: boolean;
  // Diff map from the most recent archived snapshot. null when the diff
  // view is off (most of the time).
  diffMap?: import('../lib/firestoreSchedules').ScheduleDiffMap | null;
  diffLoading?: boolean;
  // e.g. "since 2026-04-12 14:08" — surfaces the snapshot the diff is
  // measuring against.
  diffSnapshotLabel?: string | null;
  onToggleDiff?: (next: boolean) => void;
  diffEnabled?: boolean;
  // HRIS manual-bundle export. Banner-rendered button when the schedule
  // is in 'saved' state.
  onExportHrisBundle?: () => void;
  hrisExportBusy?: boolean;
  hrisLastExportedAt?: number | null;
}

interface ScheduleTabProps {
  employees: Employee[];
  filteredEmployees: Employee[];
  // v2.6 — stations are needed for the pivot-style "group by station" view
  // (header rows show the station name + headcount, members nest under them).
  stations: Station[];
  shifts: Shift[];
  holidays: PublicHoliday[];
  config: Config;
  schedule: Schedule;
  paintMode: PaintMode;
  setPaintMode: (m: PaintMode) => void;
  scheduleFilter: string;
  setScheduleFilter: (s: string) => void;
  scheduleRoleFilter: string;
  setScheduleRoleFilter: (s: string) => void;
  // v2.2.0 — view-narrowing toggles. Surfaced as buttons next to the
  // role-filter pill. Both are computed server-side (in App.tsx) before
  // the filtered list lands here, so the grid just renders.
  scheduleViolationsOnly: boolean;
  setScheduleViolationsOnly: (v: boolean) => void;
  scheduleGroupByStation: boolean;
  setScheduleGroupByStation: (v: boolean) => void;
  violationCount: number;
  rosterRoles: string[];
  scheduleUndoStack: Array<unknown>;
  prevMonth: () => void;
  nextMonth: () => void;
  // Single-cell paint. Modifiers carry whether the user held Shift/Ctrl, used
  // to drive range-fill from the last clicked cell.
  onCellClick: (empId: string, day: number, opts?: { shift?: boolean }) => void;
  // Range fill from (anchorEmpId, anchorDay) to (empId, day) — fired when the
  // user Shift+clicks a second cell. The App handler paints every cell in the
  // rectangle (including endpoints) with the current paint mode and records
  // a single bundled undo entry.
  onCellRangeFill?: (anchorEmpId: string, anchorDay: number, empId: string, day: number) => void;
  onUndo: () => void;
  // Per-cell undo (Ctrl+Z). The App keeps a separate stack of individual cell
  // edits so users can quickly back out of a mispainted cell without losing
  // the whole month.
  onUndoCell?: () => void;
  cellUndoDepth?: number;
  // v2.2.0 — range is an ISO-date pair (YYYY-MM-DD). Cross-month ranges
  // (e.g. 2026-04-15 → 2026-05-15) are honoured; the App.tsx orchestrator
  // splits the run into per-month invocations and stitches the rolling
  // state across boundaries.
  onRunAuto: (mode?: 'fresh' | 'preserve', range?: { start: string; end: string }) => void;
  // v2.2.0 — fast non-adjacent month jump.
  setActiveMonth: (year: number, month: number) => void;
  // v2.1.4 — auto-scheduler needs at least one employee AND one station
  // to have a chance of producing useful output. Pre-2.1.4 the buttons
  // fired regardless and either threw or surfaced an empty schedule with
  // a confusing info modal. App.tsx passes the precomputed flag so
  // ScheduleTab doesn't need a stations[] prop just to count it.
  canRunAuto: boolean;
  runAutoDisabledReason?: string;
  // Cells (`${empId}:${day}` keys) the user just swapped via the coverage
  // hint toast. The grid renders these with a brief pulsing highlight so the
  // user sees what moved. Empty set = no recent changes; the cells render
  // normally.
  recentlyChangedCells?: Set<string>;
  // v5.18.0 — `${empId}:${day}` keys flagged as hard-rule violations by
  // the compliance engine. The grid paints a small red corner dot on each
  // so the supervisor can spot violations during paint without leaving the
  // tab. App.tsx derives the set from `violations` (excluding info-only
  // findings) and memoizes it. Empty / undefined = no markers.
  violationCellKeys?: Set<string>;
  // Last paint operation's compliance warnings, if any. Null means the most
  // recent paint was clean (or no paint has happened yet).
  paintWarnings: { empName: string; warnings: string[] } | null;
  onDismissPaintWarnings: () => void;
  // Schedule staleness — references that no longer exist (employees,
  // shifts, or stations were deleted after the schedule was built).
  staleness?: {
    isStale: boolean;
    orphanedEmpIds: string[];
    orphanedShiftCodes: string[];
    orphanedStationIds: string[];
  };
  // v4.2.1 — moved out of the global toolbar so schedule operations live
  // with the schedule. Export saves the active month as CSV; the simulation
  // toggle gates editing into a sandbox so the supervisor can model "what
  // if" without touching saved data.
  onExportSchedule?: () => void;
  simMode?: boolean;
  onEnterSimMode?: () => void;

  // v5.0 — approval workflow. The parent (App.tsx) owns the modal state and
  // the actual transition calls; this tab just renders the banner + reads
  // the role/status to compute "is the grid editable right now?".
  approval?: import('../lib/firestoreSchedules').ApprovalBlock;
  monthLabel?: string;          // e.g. "April 2026 — Iraqi Mall, Branch A"
  role?: import('../lib/auth').Role | null;
  canEditCells?: boolean;       // App.tsx computes this from `availableActionsFor`
  onSubmitForApproval?: () => void;
  onLockSchedule?: () => void;
  onSendBackSchedule?: () => void;
  onSaveSchedule?: () => void;
  onReopenSchedule?: () => void;
  // v5.16.0 — re-approval diff view + HRIS bundle export grouped into
  // a single `archive` prop. Both clusters are about the post-save
  // archive lifecycle (snapshots, diffs, HRIS exports) and are read
  // exclusively by the approval banner — packing them collapses ~9
  // top-level props into one. Internal refs use `archive?.foo` so the
  // change is local to this tab + App.tsx call site.
  //
  // App.tsx owns the snapshot fetch (one-shot getDocs on toggle) and
  // the actual HRIS assembly + Firestore stamp; this tab just wires the
  // banner clicks and busy flags through.
  archive?: ScheduleArchiveProps;

  // v5.10.0 — explicit "Save draft" force-flush + status surfacing.
  // Only wired in Offline Demo mode (Online mode auto-syncs on every
  // cell paint via Firestore so an explicit button would be noise).
  // App.tsx hands us the latest save state so the badge tracks the
  // auto-save lifecycle (pending → saving → saved → error). The
  // button bypasses the 500ms debounce and confirms via toast.
  onSaveDraft?: () => Promise<void> | void;
  saveState?: 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  lastSavedAt?: number | null;

  // v5.12.0 — carry-forward toggle for unspent comp days. When on
  // (default), comp windows that expire without a CP landing roll the
  // unspent credit into next-month accrual instead of firing a 2× cash
  // premium. Off = legacy "premium owed when window expires" — right
  // call when closing the business or finalising payroll where deferred
  // comp can't be honoured. App.tsx owns the config write; this tab
  // just renders the toggle and the "X CP days carry to next month"
  // hint below the schedule grid when carry-forward is active and there
  // are pending accruals.
  carryForwardUnspentCompDays?: boolean;
  onToggleCarryForward?: (next: boolean) => void;
  pendingCarriedForwardCount?: { count: number; workers: number };

  // v5.16.0 — navigation shortcuts for the empty-state CTA. When
  // employees=0 or stations=0 the grid renders nothing useful, so we
  // surface a "Go to Roster" / "Go to Stations" button that bridges
  // the user to the missing setup. App.tsx owns the actual setActiveTab.
  onGoToRoster?: () => void;
  onGoToLayout?: () => void;
  // v5.18.0 — opens the Plan-Everything wizard. Optional so existing
  // callers compile unchanged; when omitted the button doesn't render.
  onOpenPlanWizard?: () => void;
}

// Layout constants used by both the sticky header row and the virtualized
// body rows. Keep them in sync — drift here = misaligned columns.
const ROW_HEIGHT = 48;
const GROUP_HEADER_HEIGHT = 38;
// v5.16.0 — DAY_CELL_WIDTH is now per-render (read from the compact-cells
// toggle below) rather than a constant. The two values are picked so a
// 31-day month fits on a 1366px laptop with the suggestion pane open in
// compact mode (28×31 + 224 + 356 = 1456 — close enough that the user
// can scroll the small remainder, vs the 1696px-wide default mode).
const DAY_CELL_WIDTH_DEFAULT = 36;
const DAY_CELL_WIDTH_COMPACT = 28;
const NAME_COL_WIDTH = 224;

const GROUP_COLLAPSE_KEY = 'iraqi-scheduler-collapsed-station-groups';
const COMPACT_CELLS_KEY = 'iraqi-scheduler-compact-day-cells';

// Pivot row plan item. When `scheduleGroupByStation` is on, the row plan
// interleaves station headers with employee rows; otherwise it's just
// employee rows. react-window only knows about the row count + height —
// we walk the plan to render either kind.
type RowPlanItem =
  | { kind: 'header'; stationId: string; stationName: string; count: number; collapsed: boolean }
  | { kind: 'employee'; emp: Employee; stationId: string };

interface RowData {
  rowPlan: RowPlanItem[];
  days: number[];
  schedule: Schedule;
  onCellClick: (empId: string, day: number, opts?: { shift?: boolean }) => void;
  onCellMouseDown: (empId: string, day: number, e: React.MouseEvent) => void;
  onCellMouseEnter: (empId: string, day: number) => void;
  recentlyChangedCells?: Set<string>;
  violationCellKeys?: Set<string>;
  statsByEmpId: Map<string, EmployeeRunningStats>;
  onToggleCollapse: (stationId: string) => void;
  groupingEnabled: boolean;
  totalGridWidth: number;
  // v5.16.0 — current day-cell width (derived from the compact-cells
  // toggle). Threaded into rows so the cell box can size to match the
  // sticky day-header above. Constant 36px or 28px today, but read as
  // a number so future granular tweaks land naturally.
  dayCellWidth: number;
  // v5.0.2 — when false, every cell renders read-only (cursor-not-allowed
  // + faded bg). Driven by approval status (submitted/locked/saved).
  cellsReadOnly: boolean;
  // v5.1.0 — when the user toggles "Show changes since last archive",
  // a Map of `${empId}:${day}` → 'added' | 'modified' | 'removed' is
  // threaded down here so the cell can render a coloured outline.
  // null = diff view off (most of the time).
  diffMap: import('../lib/firestoreSchedules').ScheduleDiffMap | null;
}

// Each visible row is rendered by react-window. We deliberately do NOT wrap
// in React.memo — the memoised component would return ReactNode which
// react-window v2's strict prop type rejects, and the row is cheap anyway
// (a flexbox + N divs). Virtualisation alone is the meaningful win.
function ScheduleRow({
  index, style, rowPlan, days, schedule, onCellClick, onCellMouseDown, onCellMouseEnter,
  recentlyChangedCells, violationCellKeys, statsByEmpId, onToggleCollapse, groupingEnabled, totalGridWidth,
  cellsReadOnly, diffMap, dayCellWidth,
}: RowComponentProps<RowData>) {
  const item = rowPlan[index];
  if (!item) return <div style={style} />;

  // ── Pivot header row ──────────────────────────────────────────────────────
  // Renders as a single tinted strip across the whole grid: a sticky-left
  // chevron + station label, then the day-area carries on flat (no per-cell
  // borders inside the strip — the day grid resumes on the next employee
  // row). Clicking anywhere on the strip toggles collapse.
  if (item.kind === 'header') {
    const collapsed = item.collapsed;
    return (
      <div
        style={style}
        role="button"
        tabIndex={0}
        onClick={() => onToggleCollapse(item.stationId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse(item.stationId);
          }
        }}
        title={collapsed ? `Expand · ${item.stationName}` : `Collapse · ${item.stationName}`}
        className="flex border-b border-blue-200/60 dark:border-blue-500/30 bg-gradient-to-r from-blue-50 via-blue-50/70 to-blue-50/40 dark:from-blue-500/15 dark:via-blue-500/10 dark:to-blue-500/5 hover:from-blue-100 hover:via-blue-100/70 dark:hover:from-blue-500/25 cursor-pointer transition-colors group-row-header select-none"
      >
        <div
          data-sticky-left
          className="z-10 px-3 flex items-center gap-2 will-change-transform"
          style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, height: GROUP_HEADER_HEIGHT }}
        >
          <span className="shrink-0 text-blue-600 dark:text-blue-300">
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
          <MapPin className="w-3.5 h-3.5 text-blue-500 dark:text-blue-300 shrink-0" />
          <span className="text-[11px] font-black text-blue-900 dark:text-blue-100 uppercase tracking-tight truncate">
            {item.stationName}
          </span>
          <span
            className="ms-auto text-[9px] font-mono font-black bg-blue-600/90 text-white px-1.5 py-0.5 rounded shrink-0"
            aria-label={`${item.count} employees`}
          >
            {item.count}
          </span>
        </div>
        {/* The day area stays empty visually — the gradient already paints
            the strip, and we don't want the per-cell borders to show inside
            the header band. A single spacer div fills the day area so the
            grid widths still line up. */}
        <div
          aria-hidden
          style={{ width: Math.max(0, totalGridWidth - NAME_COL_WIDTH), height: GROUP_HEADER_HEIGHT }}
        />
      </div>
    );
  }

  // ── Employee row (existing schedule grid behaviour) ───────────────────────
  const emp = item.emp;
  const stats = emp ? statsByEmpId.get(emp.empId) : undefined;
  // Cap-status tone: red when at or above the cap, amber within 90%, neutral
  // otherwise. Drives a small badge next to the name so the user spots
  // already-saturated employees before painting another shift.
  const capPct = stats && stats.weeklyCap > 0 ? stats.weeklyHrsRolling / stats.weeklyCap : 0;
  const tone = capPct >= 1 ? 'over' : capPct >= 0.9 ? 'near' : 'ok';
  return (
    <div style={style} className="flex border-b schedule-grid-line hover:bg-slate-50/50 dark:hover:bg-slate-800/40 group bg-white dark:bg-slate-900">
      {/* v1.15 — react-window's overflow:auto container intercepts CSS
          sticky-left, so the JS scroll handler in ScheduleTab translates
          [data-sticky-left] elements by the current scrollLeft to keep
          them visually pinned to the viewport edge. The will-change hint
          keeps the transform on the GPU compositor for smooth panning. */}
      <div
        data-sticky-left
        className="bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/60 z-10 px-4 py-2 border-r border-slate-200 dark:border-slate-700 shadow-[4px_0_10px_rgba(0,0,0,0.03)] flex flex-col justify-center will-change-transform"
        style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH }}
        title={stats ? formatEmployeeStatsTooltip(stats) : undefined}
      >
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-slate-700 dark:text-slate-100 text-xs truncate uppercase tracking-tight flex-1 min-w-0">{emp?.name}</span>
          {/* v5.16.0 — cap-status badge: red 'over' tier stays always-visible
              (it signals an active rule breach, not just a hint). Amber 'near'
              tier is now hover-only — it competes for attention with the cap
              dot in the schedule cell tooltip and the row hover already
              surfaces full stats. Reduces the visual noise on the grid
              without losing the breach signal. */}
          {stats && tone !== 'ok' && (
            <span
              className={cn(
                "shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-black tracking-widest transition-opacity",
                tone === 'over'
                  ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200 opacity-100"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200 opacity-0 group-hover:opacity-100",
              )}
              title={`${stats.weeklyHrsRolling.toFixed(1)} / ${stats.weeklyCap} h peak weekly`}
            >
              <AlertOctagon className="w-2.5 h-2.5" />
              {Math.round(capPct * 100)}%
            </span>
          )}
        </div>
        <span className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1 shrink-0 mt-0.5">
          <Hash className="w-2 h-2" /> {emp?.empId} • {emp?.role}
        </span>
      </div>
      {days.map(day => {
        const cellKey = emp ? `${emp.empId}:${day}` : '';
        const isRecent = !!emp && !!recentlyChangedCells?.has(cellKey);
        const hasViolation = !!emp && !!violationCellKeys?.has(cellKey);
        const diffKind = emp && diffMap ? diffMap.get(cellKey) ?? null : null;
        const code = emp ? schedule[emp.empId]?.[day]?.shiftCode || '' : '';
        const ariaLabel = emp
          ? `${emp.name} · day ${day}${code ? ` · ${code}` : ''}${hasViolation ? ' · violation' : ''}`
          : undefined;
        return (
          <div key={day} className="border-r schedule-grid-line flex-shrink-0" style={{ width: dayCellWidth, minWidth: dayCellWidth }}>
            <ScheduleCell
              value={code}
              onClick={(e) => emp && onCellClick(emp.empId, day, { shift: e.shiftKey })}
              onMouseDown={(e) => emp && onCellMouseDown(emp.empId, day, e)}
              onMouseEnter={() => emp && onCellMouseEnter(emp.empId, day)}
              isRecent={isRecent}
              hasViolation={hasViolation}
              readOnly={cellsReadOnly}
              diff={diffKind}
              empId={emp?.empId}
              day={day}
              ariaLabel={ariaLabel}
            />
          </div>
        );
      })}
    </div>
  );
}

export function ScheduleTab({
  employees, filteredEmployees, stations, shifts, holidays, config, schedule,
  paintMode, setPaintMode, scheduleFilter, setScheduleFilter,
  scheduleRoleFilter, setScheduleRoleFilter,
  scheduleViolationsOnly, setScheduleViolationsOnly,
  scheduleGroupByStation, setScheduleGroupByStation,
  violationCount, rosterRoles,
  scheduleUndoStack, prevMonth, nextMonth, setActiveMonth, onCellClick, onCellRangeFill,
  onUndo, onUndoCell, cellUndoDepth = 0, onRunAuto,
  canRunAuto, runAutoDisabledReason,
  paintWarnings, onDismissPaintWarnings, staleness, recentlyChangedCells, violationCellKeys,
  onExportSchedule, simMode, onEnterSimMode, onSaveDraft, saveState, lastSavedAt,
  carryForwardUnspentCompDays, onToggleCarryForward, pendingCarriedForwardCount,
  // v5.0 — approval workflow props
  approval, monthLabel, role, canEditCells = true,
  onSubmitForApproval, onLockSchedule, onSendBackSchedule,
  onSaveSchedule, onReopenSchedule,
  // v5.16.0 — archive ops bundle (diff view + HRIS export).
  archive,
  // v5.16.0 — navigation shortcuts for empty-state CTA.
  onGoToRoster, onGoToLayout,
  // v5.18.0 — Plan-Everything wizard opener.
  onOpenPlanWizard,
}: ScheduleTabProps) {
  // v5.16.0 — destructure archive bundle into local consts so the rest
  // of the function body keeps reading the same names. Defaults match
  // the old per-prop defaults verbatim so behaviour is unchanged.
  const {
    hasArchivedSnapshot = false,
    diffMap = null,
    diffLoading = false,
    diffSnapshotLabel = null,
    onToggleDiff,
    diffEnabled = false,
    onExportHrisBundle,
    hrisExportBusy = false,
    hrisLastExportedAt = null,
  } = archive ?? {};
  const { t } = useI18n();

  // v5.16.0 — compact-cells toggle. Persists across sessions in localStorage
  // so a 1366px-laptop supervisor doesn't have to re-enable it every visit.
  // Default off — full 36px cells are easier to read at 1920px+; users on
  // smaller displays opt in via the toolbar toggle.
  const [compactCells, setCompactCells] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(COMPACT_CELLS_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(COMPACT_CELLS_KEY, compactCells ? '1' : '0'); } catch {/* quota — non-critical */}
  }, [compactCells]);
  const dayCellWidth = compactCells ? DAY_CELL_WIDTH_COMPACT : DAY_CELL_WIDTH_DEFAULT;

  // v2.6 — collapsed station IDs persist across sessions so the supervisor's
  // pivot view doesn't reset between visits. Stored as an array (Set isn't
  // JSON-friendly) keyed per-app — small enough that we don't bother per-
  // company; the IDs are globally unique anyway.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(GROUP_COLLAPSE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch { return new Set(); }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(GROUP_COLLAPSE_KEY, JSON.stringify(Array.from(collapsedGroups)));
    } catch {/* quota / privacy mode — non-critical */}
  }, [collapsedGroups]);
  const toggleCollapse = React.useCallback((stationId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(stationId)) next.delete(stationId);
      else next.add(stationId);
      return next;
    });
  }, []);
  // Drag-paint: when the user holds the mouse on a cell while in paint mode
  // and drags across neighbours, every cell entered gets painted. Tracked
  // here (not in App.tsx) to keep mouse-event noise local to the grid.
  const [isDragPainting, setIsDragPainting] = useState(false);
  const lastClickedCellRef = useRef<{ empId: string; day: number } | null>(null);
  // v2.1.2 — paint banner pulses briefly when entering paint mode, then
  // settles to a static label. Pre-2.1.2 it pulsed forever, which read
  // as visual noise after the user understood they were in paint mode.
  const [paintBannerPulse, setPaintBannerPulse] = useState(false);
  useEffect(() => {
    if (paintMode) {
      setPaintBannerPulse(true);
      const t = window.setTimeout(() => setPaintBannerPulse(false), 1800);
      return () => window.clearTimeout(t);
    } else {
      setPaintBannerPulse(false);
    }
  }, [paintMode?.shiftCode]);

  // v5.0.2 — when the schedule transitions into a read-only state (submit
  // / lock / save), clear any active paint selection so the user doesn't
  // see a "painting X" banner without being able to actually paint.
  useEffect(() => {
    if (!canEditCells && paintMode) setPaintMode(null);
  }, [canEditCells, paintMode, setPaintMode]);

  // Refs for the sticky top scrollbar mirror (v1.13) and the manual
  // sticky-left translate fix for the names column (v1.15). Two separate
  // scroll containers — the visible "rail" at the top of the grid and the
  // actual grid container below it — synchronised so dragging either thumb
  // pans both. A flag ref prevents feedback loops when one scroll triggers
  // the other.
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const topScrollMirrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = gridScrollRef.current;
    const top = topScrollMirrorRef.current;
    if (!grid || !top) return;
    let syncing = false;
    // v1.15: react-window's <List> creates its own overflow:auto scroll
    // container, which intercepts `position: sticky; left: 0` on the body
    // rows' name column — so the name column would scroll horizontally
    // along with the days. We work around it by JS-translating every
    // `[data-sticky-left]` element by the current scrollLeft, making it
    // "stick" to the visible viewport-left manually. The day header still
    // uses CSS sticky since it lives outside the List.
    const applyStickyLeft = () => {
      const x = grid.scrollLeft;
      const els = grid.querySelectorAll<HTMLElement>('[data-sticky-left]');
      for (let i = 0; i < els.length; i++) {
        els[i].style.transform = `translateX(${x}px)`;
      }
    };
    const onGrid = () => {
      if (!syncing) {
        syncing = true;
        top.scrollLeft = grid.scrollLeft;
        requestAnimationFrame(() => { syncing = false; });
      }
      applyStickyLeft();
    };
    const onTop = () => {
      if (syncing) return;
      syncing = true;
      grid.scrollLeft = top.scrollLeft;
      requestAnimationFrame(() => { syncing = false; });
    };
    grid.addEventListener('scroll', onGrid, { passive: true });
    top.addEventListener('scroll', onTop, { passive: true });
    // Run once to handle any initial scrollLeft (e.g. RTL reset).
    applyStickyLeft();
    // Also re-apply when rows mount/update — a MutationObserver catches
    // the React re-renders that virtualization triggers without us needing
    // to thread a "schedule version" prop through the row component.
    const obs = new MutationObserver(applyStickyLeft);
    obs.observe(grid, { childList: true, subtree: true });
    return () => {
      grid.removeEventListener('scroll', onGrid);
      top.removeEventListener('scroll', onTop);
      obs.disconnect();
    };
  }, []);

  // Drag releases on mouseup anywhere — even outside the grid. Without the
  // window listener a release outside the grid would leave the grid stuck
  // in dragging mode.
  useEffect(() => {
    if (!isDragPainting) return;
    const onUp = () => setIsDragPainting(false);
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [isDragPainting]);

  const handleCellMouseDown = React.useCallback((empId: string, day: number, e: React.MouseEvent) => {
    // v5.0 — read-only-while-pending. If the schedule is in submitted /
    // locked / saved state the cell handlers are inert. Reviewers see the
    // grid but can't stealth-edit; they have to send-back or reopen with
    // notes to make changes happen.
    if (!canEditCells) return;
    // Shift+click range fill takes priority — paint the rectangle and skip
    // drag-paint setup. The handleCellClick handler will also fire (browser
    // delivers click after mousedown), but the range-fill path short-circuits
    // it via lastClickedCellRef tracking.
    if (e.shiftKey && lastClickedCellRef.current && paintMode && onCellRangeFill) {
      e.preventDefault();
      onCellRangeFill(lastClickedCellRef.current.empId, lastClickedCellRef.current.day, empId, day);
      lastClickedCellRef.current = { empId, day };
      return;
    }
    if (paintMode) {
      e.preventDefault();
      setIsDragPainting(true);
      onCellClick(empId, day);
    }
    lastClickedCellRef.current = { empId, day };
  }, [paintMode, onCellClick, onCellRangeFill, canEditCells]);

  const handleCellMouseEnter = React.useCallback((empId: string, day: number) => {
    if (!canEditCells) return;
    if (isDragPainting && paintMode) {
      onCellClick(empId, day);
    }
  }, [isDragPainting, paintMode, onCellClick, canEditCells]);

  const handleCellClick = React.useCallback((empId: string, day: number, opts?: { shift?: boolean }) => {
    if (!canEditCells) return;
    // Skip the click if it's the second half of a shift+click range fill
    // (already handled in mousedown). Without this guard the anchor cell
    // would be cycled twice.
    if (opts?.shift && paintMode) return;
    // Drag-paint already handled on mousedown — let the click for the same
    // cell pass through harmlessly only when not in paint mode (so cycling
    // through codes still works in cursor mode).
    if (paintMode && isDragPainting) return;
    onCellClick(empId, day, opts);
    lastClickedCellRef.current = { empId, day };
  }, [paintMode, isDragPainting, onCellClick, canEditCells]);

  const days = useMemo(
    () => Array.from({ length: config.daysInMonth }, (_, i) => i + 1),
    [config.daysInMonth],
  );

  // Per-employee running counters for the active month. Computed once per
  // schedule change and shared with every visible row via rowProps so
  // virtualised rows don't redo the work as they scroll into view.
  // v2.1.3 — keyed on the full `employees` array, not `filteredEmployees`.
  // The search box rebinds `filteredEmployees` on every keystroke, which
  // pre-2.1.3 invalidated this useMemo and rebuilt ~3100 stats objects
  // (100 emp × 31 days) per character typed. Computing for the full
  // roster up front means search-box typing only re-filters the visible
  // rows; the stats cache is reused across keystrokes.
  const statsByEmpId = useMemo(() => {
    const m = new Map<string, EmployeeRunningStats>();
    for (const emp of employees) {
      m.set(emp.empId, computeEmployeeRunningStats(emp, schedule, shifts, holidays, config));
    }
    return m;
  }, [employees, schedule, shifts, holidays, config]);

  const totalGridWidth = NAME_COL_WIDTH + days.length * dayCellWidth;

  // v2.6 — primary station per employee. The "most-frequent stationId in the
  // visible month" wins; ties are broken by station-table order.
  const primaryStationByEmp = useMemo(() => {
    const m = new Map<string, string>();
    for (const emp of employees) {
      const empSched = schedule[emp.empId] || {};
      const counts = new Map<string, number>();
      for (const entry of Object.values(empSched)) {
        if (entry.stationId) counts.set(entry.stationId, (counts.get(entry.stationId) || 0) + 1);
      }
      let best = '';
      let bestN = 0;
      for (const [sid, n] of counts) {
        if (n > bestN) { bestN = n; best = sid; }
      }
      m.set(emp.empId, best);
    }
    return m;
  }, [employees, schedule]);

  // Build the row plan. In flat (non-grouped) mode this is just the
  // filtered employee list mapped to row items; in grouped mode it
  // interleaves a header before each station block and skips the bodies
  // of collapsed groups. The "Unassigned" bucket gets a synthetic
  // header so collapsing it works the same way.
  const rowPlan = useMemo<RowPlanItem[]>(() => {
    if (!scheduleGroupByStation) {
      return filteredEmployees.map(emp => ({
        kind: 'employee' as const,
        emp,
        stationId: primaryStationByEmp.get(emp.empId) || '',
      }));
    }
    // Group employees by primary station, preserving the station-table
    // order and putting unassigned at the end.
    const stationOrder = new Map(stations.map((s, i) => [s.id, i]));
    const stationName = new Map(stations.map(s => [s.id, s.name]));
    const groups = new Map<string, Employee[]>();
    for (const emp of filteredEmployees) {
      const sid = primaryStationByEmp.get(emp.empId) || '';
      if (!groups.has(sid)) groups.set(sid, []);
      groups.get(sid)!.push(emp);
    }
    // Stable sort group keys by station-table index, '' (unassigned) last.
    const sortedSids = [...groups.keys()].sort((a, b) => {
      if (a === b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return (stationOrder.get(a) ?? 999) - (stationOrder.get(b) ?? 999);
    });
    const plan: RowPlanItem[] = [];
    for (const sid of sortedSids) {
      const members = groups.get(sid)!;
      const collapsed = collapsedGroups.has(sid || '__unassigned__');
      plan.push({
        kind: 'header',
        stationId: sid || '__unassigned__',
        stationName: sid ? (stationName.get(sid) || sid) : t('schedule.group.unassigned'),
        count: members.length,
        collapsed,
      });
      if (!collapsed) {
        for (const emp of members) {
          plan.push({ kind: 'employee', emp, stationId: sid });
        }
      }
    }
    return plan;
  }, [scheduleGroupByStation, filteredEmployees, stations, primaryStationByEmp, collapsedGroups, t]);

  // Variable row height — header rows are stubbier than body rows. The
  // function form lets react-window keep its position cache correct as the
  // plan changes (e.g. when collapsing a group).
  const getRowHeight = React.useCallback(
    (i: number) => rowPlan[i]?.kind === 'header' ? GROUP_HEADER_HEIGHT : ROW_HEIGHT,
    [rowPlan],
  );

  // The viewport's natural height, capped at 600px so the modal-like
  // scroll-within-page feel stays consistent. Now sums the actual row
  // heights since headers are shorter than employee rows.
  const naturalHeight = useMemo(() => {
    let h = 0;
    for (let i = 0; i < rowPlan.length; i++) {
      h += rowPlan[i].kind === 'header' ? GROUP_HEADER_HEIGHT : ROW_HEIGHT;
    }
    return Math.min(h, 600);
  }, [rowPlan]);

  // Keyboard shortcuts:
  //   • Number keys (1-9) pick the corresponding shift code from the painter
  //   • Esc / 0 clear paint mode
  //   • Ctrl/Cmd+Z undo the last per-cell paint
  // Shortcuts are suppressed while the user is typing in an input/textarea/select
  // so the search filter and other inputs work normally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      // Ctrl/Cmd+Z → per-cell undo. We let Shift+Ctrl+Z fall through (browser
      // redo gesture) so we don't fight any future redo wiring.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        if (onUndoCell && cellUndoDepth > 0) {
          e.preventDefault();
          onUndoCell();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' || e.key === '0') {
        if (paintMode) {
          e.preventDefault();
          setPaintMode(null);
        }
        return;
      }
      // Number keys 1-9 select the Nth shift in the painter row.
      const n = parseInt(e.key, 10);
      if (Number.isFinite(n) && n >= 1 && n <= shifts.length) {
        const target = shifts[n - 1];
        if (target) {
          e.preventDefault();
          setPaintMode(paintMode?.shiftCode === target.code ? null : { shiftCode: target.code });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shifts, paintMode, setPaintMode, onUndoCell, cellUndoDepth]);

  // v5.16.0 — empty-state guard. Pre-v5.16 a brand-new install showed
  // the user an empty grid + busy toolbar with no breadcrumb of what to
  // do next. Now we route them to the missing setup tab. The case where
  // BOTH are missing (truly fresh install) sends to Roster first since
  // employees usually feel more concrete to a new user than stations.
  const noEmployees = employees.length === 0;
  const noStations = stations.length === 0;
  if (noEmployees || noStations) {
    return (
      <ScheduleEmptyState
        kind={noEmployees && noStations ? 'both' : noEmployees ? 'noEmployees' : 'noStations'}
        onGoToRoster={onGoToRoster}
        onGoToLayout={onGoToLayout}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* v5.0 — approval banner (top of grid). Banner reads `approval.status`
          and shows the right colour/copy/actions for the current state.
          When role===null (offline mode) and status===draft (default) the
          banner hides itself entirely so the legacy single-user UI is
          unchanged. */}
      {(role !== undefined && monthLabel) && (
        <ScheduleApprovalBanner
          approval={approval}
          monthLabel={monthLabel}
          role={role}
          canWriteSchedule={canEditCells}
          onSubmit={onSubmitForApproval}
          onLock={onLockSchedule}
          onSendBack={onSendBackSchedule}
          onSave={onSaveSchedule}
          onReopen={onReopenSchedule}
          hasArchivedSnapshot={hasArchivedSnapshot}
          diffEnabled={diffEnabled}
          diffLoading={diffLoading}
          diffSnapshotLabel={diffSnapshotLabel}
          diffSummary={diffEnabled && diffMap ? summarizeDiffMap(diffMap) : null}
          onToggleDiff={onToggleDiff}
          onExportHrisBundle={onExportHrisBundle}
          hrisExportBusy={hrisExportBusy}
          hrisLastExportedAt={hrisLastExportedAt}
        />
      )}

      {/* v5.12.0 — carry-forward CP toggle. Surfaces above the schedule
          grid so the supervisor sees the policy in effect for the
          current month. When checked: holidays whose comp window
          expires roll into next-month accrual instead of OT. When
          unchecked (e.g. closing the business): legacy "premium owed"
          behaviour. The hint below shows the running count of CP days
          + workers carrying forward so the supervisor knows what next
          month's planning needs to absorb. */}
      {onToggleCarryForward !== undefined && (
        <div className={cn(
          'flex items-center gap-3 flex-wrap p-3 rounded-xl border shadow-sm',
          carryForwardUnspentCompDays
            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
            : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30',
        )}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!carryForwardUnspentCompDays}
              onChange={(e) => onToggleCarryForward(e.target.checked)}
              className="w-4 h-4 cursor-pointer"
            />
            <span className={cn(
              'text-[11px] font-bold uppercase tracking-widest',
              carryForwardUnspentCompDays
                ? 'text-emerald-800 dark:text-emerald-200'
                : 'text-amber-800 dark:text-amber-200',
            )}>
              {t('schedule.carryForward.label')}
            </span>
          </label>
          {carryForwardUnspentCompDays && pendingCarriedForwardCount && pendingCarriedForwardCount.count > 0 && (
            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 ms-2">
              {t('schedule.carryForward.pending', {
                count: pendingCarriedForwardCount.count,
                workers: pendingCarriedForwardCount.workers,
              })}
            </span>
          )}
          <p className={cn(
            'text-[10px] leading-relaxed ms-auto max-w-md',
            carryForwardUnspentCompDays
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-amber-700 dark:text-amber-300',
          )}>
            {carryForwardUnspentCompDays
              ? t('schedule.carryForward.helpOn')
              : t('schedule.carryForward.helpOff')}
          </p>
        </div>
      )}

      {/* The toolbar stacks vertically by default and only goes single-row at
          xl+ widths. With the suggestion pane open the main content width is
          ~1010px on a 1366×768 laptop, which can't fit all 8+ toolbar items
          on a single row without items overflowing — pre-1.12 the rightmost
          buttons (Auto-Schedule, Print) ended up underneath the pane. The
          xl: breakpoint and explicit flex-wrap let the toolbar wrap cleanly
          inside the padded area. */}
      <div className="flex flex-col xl:flex-row xl:flex-wrap xl:items-center xl:justify-between gap-4">
        <MonthYearPicker
          year={config.year}
          month={config.month}
          onChange={setActiveMonth}
          onPrev={prevMonth}
          onNext={nextMonth}
        />

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={scheduleFilter}
              onChange={(e) => setScheduleFilter(e.target.value)}
              placeholder={t('schedule.searchPlaceholder')}
              aria-label={t('schedule.searchPlaceholder')}
              className="ps-9 pe-3 py-2.5 w-64 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all shadow-sm"
            />
          </div>
          <select
            value={scheduleRoleFilter}
            onChange={(e) => setScheduleRoleFilter(e.target.value)}
            aria-label={t('schedule.allRoles')}
            className="px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all shadow-sm"
          >
            <option value="all">{t('schedule.allRoles')}</option>
            {rosterRoles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {/* v2.2.0 — violations-only filter. Disabled when there are no
              violations so the supervisor doesn't toggle to an empty grid
              and wonder where everyone went. The count next to the label
              is a quick signal of how much there is to act on. */}
          <button
            onClick={() => setScheduleViolationsOnly(!scheduleViolationsOnly)}
            aria-pressed={scheduleViolationsOnly}
            disabled={violationCount === 0 && !scheduleViolationsOnly}
            title={violationCount === 0 ? t('schedule.filter.violations.empty') : t('schedule.filter.violations.tooltip')}
            className={cn(
              'px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm flex items-center gap-1.5 border',
              scheduleViolationsOnly
                ? 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700'
                : 'bg-white dark:bg-slate-800/60 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            <AlertTriangle className="w-3 h-3" />
            {t('schedule.filter.violations')}
            {violationCount > 0 && (
              <span className={cn(
                'px-1.5 py-0.5 rounded text-[9px] font-mono',
                scheduleViolationsOnly ? 'bg-white/20 text-white' : 'bg-rose-100 dark:bg-rose-500/25 text-rose-700 dark:text-rose-200',
              )}>{violationCount}</span>
            )}
          </button>
          {/* v2.2.0 — group-by-station toggle. Sorts visible rows by
              each employee's primary station (most-frequent in the
              visible month) so the supervisor can scan station-by-
              station coverage without re-architecting the grid. */}
          <button
            onClick={() => setScheduleGroupByStation(!scheduleGroupByStation)}
            aria-pressed={scheduleGroupByStation}
            title={t('schedule.filter.groupByStation.tooltip')}
            className={cn(
              'px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm flex items-center gap-1.5 border',
              scheduleGroupByStation
                ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                : 'bg-white dark:bg-slate-800/60 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800',
            )}
          >
            <Wrench className="w-3 h-3" />
            {t('schedule.filter.groupByStation')}
          </button>
          {/* v5.16.0 — compact-cells toggle. Shrinks each day cell from
              36px to 28px so a 31-day month fits on a 1366px laptop with
              the suggestion pane open. Persists in localStorage. */}
          <button
            onClick={() => setCompactCells(v => !v)}
            aria-pressed={compactCells}
            title={t('schedule.compactCells.tooltip')}
            className={cn(
              'px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm flex items-center gap-1.5 border',
              compactCells
                ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                : 'bg-white dark:bg-slate-800/60 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800',
            )}
          >
            {t('schedule.compactCells.label')}
          </button>
          {(scheduleFilter || scheduleRoleFilter !== 'all' || scheduleViolationsOnly || scheduleGroupByStation) && (
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              {filteredEmployees.length}/{employees.length}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1.5 me-4 bg-slate-900 border border-slate-700 p-1 rounded-xl shadow-xl"
            title={`${t('schedule.kbdHelp.title')} — ${t('schedule.kbdHelp.numberKeys')} ${t('schedule.kbdHelp.escape')}`}
          >
            {shifts.map((s, idx) => {
              const kbdHint = idx < 9 ? String(idx + 1) : null;
              return (
                <button
                  key={s.code}
                  onClick={() => setPaintMode(paintMode?.shiftCode === s.code ? null : { shiftCode: s.code })}
                  aria-pressed={paintMode?.shiftCode === s.code}
                  title={kbdHint ? `${s.code} (${kbdHint})` : s.code}
                  className={cn(
                    "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all relative",
                    paintMode?.shiftCode === s.code
                      ? "bg-blue-600 text-white shadow-inner shadow-blue-800"
                      : "text-slate-400 hover:text-white"
                  )}
                >
                  {s.code}
                  {kbdHint && (
                    <span className="absolute -top-1 -right-1 text-[7px] font-mono font-black bg-slate-800 text-slate-300 px-1 py-px rounded border border-slate-700 leading-none">
                      {kbdHint}
                    </span>
                  )}
                </button>
              );
            })}
            <div className="w-px h-6 bg-slate-700 mx-1" />
            <button
              onClick={() => setPaintMode(null)}
              aria-label={t('schedule.cursorMode')}
              title={`${t('schedule.cursorMode')} (Esc)`}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                !paintMode ? "bg-white/10 text-white" : "text-slate-400"
              )}
            >
              <MousePointer2 className="w-3 h-3" />
            </button>
            <div
              className="ms-1 me-1 hidden md:flex items-center gap-1 text-[8px] text-slate-500 font-bold uppercase tracking-widest"
              title={`${t('schedule.kbdHelp.numberKeys')} ${t('schedule.kbdHelp.escape')}`}
            >
              <Keyboard className="w-3 h-3" />
              <span>1-9 / Esc</span>
            </div>
          </div>

          {scheduleUndoStack.length > 0 && (
            <button
              onClick={onUndo}
              title={`${t('action.undoLast')} (${scheduleUndoStack.length})`}
              className="apple-press flex items-center gap-2 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              {t('action.undoLast')}
            </button>
          )}
          {onUndoCell && cellUndoDepth > 0 && (
            <button
              onClick={onUndoCell}
              title={t('action.undoCell.tooltip', { count: cellUndoDepth })}
              className="apple-press flex items-center gap-2 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-3 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm"
            >
              <Undo2 className="w-4 h-4" />
              {t('action.undoCell')} ({cellUndoDepth})
            </button>
          )}

          <AutoScheduleRangePicker
            year={config.year}
            month={config.month}
            daysInMonth={config.daysInMonth}
            disabled={!canRunAuto}
            disabledReason={runAutoDisabledReason}
            onRunPreserve={(range) => onRunAuto('preserve', range)}
            onRunFresh={(range) => onRunAuto('fresh', range)}
          />

          {/* v5.10.0 — explicit "Save draft" button. Surfaces only in
              Offline Demo mode (Online's Firestore SDK already auto-syncs
              every cell paint, so an explicit button there would be
              noise). Bypasses the 500ms debounce so the supervisor has a
              clear "I'm done editing for now" action with confirmable
              outcome (toast + last-saved time in the badge). */}
          {onSaveDraft && (
            <button
              onClick={() => { void onSaveDraft(); }}
              disabled={saveState === 'saving'}
              title={lastSavedAt
                ? t('schedule.saveDraft.lastSaved', { time: format(new Date(lastSavedAt), 'HH:mm:ss') })
                : t('schedule.saveDraft.never')}
              className={cn(
                'apple-press flex items-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-sm border',
                saveState === 'saving'
                  ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 cursor-wait'
                  : saveState === 'error'
                    ? 'bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-500/25'
                    : 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-500/25',
              )}
            >
              <Save className="w-4 h-4" />
              {saveState === 'saving' ? t('schedule.saveDraft.saving') : t('schedule.saveDraft.label')}
            </button>
          )}

          {onExportSchedule && (
            <button
              onClick={onExportSchedule}
              className="apple-press flex items-center gap-2 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-3 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm"
            >
              <Download className="w-4 h-4" />
              {t('toolbar.exportSchedule')}
            </button>
          )}

          {onEnterSimMode && !simMode && (
            <button
              onClick={onEnterSimMode}
              className="apple-press flex items-center gap-2 bg-white dark:bg-slate-800/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/40 px-3 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-50 dark:hover:bg-indigo-500/15 shadow-sm"
            >
              <FlaskConical className="w-4 h-4" />
              {t('sim.toolbar.enter')}
            </button>
          )}

          <button
            onClick={() => window.print()}
            title={t('schedule.print.tooltip')}
            className="apple-press flex items-center gap-2 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-3 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm"
          >
            <Printer className="w-4 h-4" />
            {t('schedule.print')}
          </button>

          {/* v5.18.0 — Plan-Everything wizard launcher. Surfaces only
              when the parent wired the callback. Lives next to the
              other one-shot toolbar actions; the violet gradient
              matches the auto-shift-generator's CTA so the two
              "let-the-app-do-it-for-you" surfaces feel like the same
              family. */}
          {onOpenPlanWizard && (
            <button
              onClick={onOpenPlanWizard}
              title={t('schedule.planEverything.tooltip')}
              className="apple-press flex items-center gap-2 bg-gradient-to-r from-violet-600 to-blue-600 text-white border border-transparent px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:from-violet-700 hover:to-blue-700 shadow-md"
            >
              <Wand2 className="w-4 h-4" />
              {t('schedule.planEverything')}
            </button>
          )}
        </div>
      </div>

      {/*
        Virtualised schedule grid:
        - Outer wrapper handles horizontal scroll for the full day column set.
        - Inner div is the natural-width grid (header + virtualised body).
        - The List virtualises rows vertically: only the rows visible in the
          fixed-height viewport are mounted, so 50+ employees stay snappy.
        - The leftmost employee column uses position:sticky:left:0 — anchored
          to the outer horizontal scroll, so it stays visible while you scroll
          across the days.
      */}
      {/* Schedule grid is locked to LTR regardless of UI language. The
          calendar (day 1 → day 31) reads naturally left-to-right in both
          locales, scrollLeft semantics stay consistent across browsers,
          and the JS sticky-left translate works without per-engine
          quirks. Only the grid itself uses dir="ltr"; the toolbar and
          surrounding UI follow the document direction. */}
      {staleness?.isStale && (
        <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <Wrench className="w-4 h-4 text-amber-600 dark:text-amber-300 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-amber-900 dark:text-amber-200 uppercase tracking-widest mb-1">
              {t('schedule.stale.header')}
            </p>
            <p className="text-[11px] text-amber-800 dark:text-amber-200/80">
              {t('schedule.stale.body', {
                emps: staleness.orphanedEmpIds.length,
                shifts: staleness.orphanedShiftCodes.length,
                stations: staleness.orphanedStationIds.length,
              })}
            </p>
            <button
              onClick={() => onRunAuto('fresh')}
              className="mt-2 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-bold uppercase tracking-widest"
            >
              {t('schedule.stale.rerun')}
            </button>
          </div>
        </div>
      )}
      <div dir="ltr" className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {paintMode && (
          <div className={cn(
            "bg-blue-600 text-white px-4 py-1 text-[9px] font-bold uppercase tracking-widest text-center shadow-lg border-b border-blue-700",
            paintBannerPulse && "animate-pulse",
          )}>
            {t('schedule.paintBanner', { code: paintMode.shiftCode })}
          </div>
        )}
        {paintWarnings && paintWarnings.warnings.length > 0 && (
          <div role="alert" className="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-amber-900 dark:text-amber-200 uppercase tracking-widest mb-1">
                {t('schedule.warningHeader', { name: paintWarnings.empName })}
              </p>
              <ul className="text-[11px] text-amber-800 dark:text-amber-200/80 space-y-0.5 list-disc ps-4">
                {paintWarnings.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <p className="text-[10px] text-amber-700 dark:text-amber-200/70 italic mt-1">{t('schedule.warningFooter')}</p>
            </div>
            <button
              onClick={onDismissPaintWarnings}
              aria-label={t('action.cancel')}
              className="p-1 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded text-amber-700 dark:text-amber-200 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {/* Sticky top-rail scrollbar (v1.13.1 hotfix). The native scrollbar
            lives at the BOTTOM of the grid container, which is off-screen
            when the user is looking at the top rows of a tall roster. This
            rail mirrors the grid's horizontal scroll position and stays
            inside the visible viewport so the user can pan the calendar
            without scrolling all the way down to find the scrollbar.
            v1.13.1: a sticky-left "personnel" placeholder pins the names
            column zone in the rail so the rail's thumb maps cleanly to the
            day-cell area only — the names column stays anchored at the
            left both in the grid AND in the rail. */}
        <div className="sticky top-0 z-30 flex bg-slate-50/80 dark:bg-slate-800/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
          <div
            className="sticky left-0 z-10 bg-slate-50 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 shadow-[4px_0_8px_rgba(0,0,0,0.04)] flex items-center px-4 text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest"
            style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, height: 14 }}
            aria-hidden
          >
            ⇄
          </div>
          <div
            ref={topScrollMirrorRef}
            className="overflow-x-auto schedule-top-scrollbar flex-1"
            style={{ height: 14 }}
            aria-hidden
          >
            <div style={{ width: Math.max(0, totalGridWidth - NAME_COL_WIDTH), height: 1 }} />
          </div>
        </div>
        <div className="overflow-x-auto" ref={gridScrollRef}>
          <div style={{ width: totalGridWidth, minWidth: totalGridWidth }}>
            {/* Sticky day header */}
            <div className="flex bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-20">
              <div
                className="sticky left-0 bg-slate-50 dark:bg-slate-800 z-30 px-4 py-4 border-r border-slate-200 dark:border-slate-700 shadow-[4px_0_10px_rgba(0,0,0,0.05)] tracking-tighter text-[10px] uppercase font-black text-slate-500 dark:text-slate-300 flex items-center"
                style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH }}
              >
                {t('schedule.personnelDirectory')}
              </div>
              {days.map(d => {
                const date = new Date(config.year, config.month - 1, d);
                const dateStr = format(date, 'yyyy-MM-dd');
                const holiday = holidays.find(h => h.date === dateStr);
                const isHoli = !!holiday;
                const isToday = format(new Date(), 'yyyy-MM-dd') === dateStr;
                // v2.1.4 — Iraqi weekend is Fri/Sat, not the date-fns default
                // Sat/Sun. Matches PrintScheduleView so on-screen and printed
                // calendars agree. JS `getDay()` returns 0=Sun … 5=Fri, 6=Sat.
                const dow = date.getDay();
                const weekendDay = dow === 5 || dow === 6;
                return (
                  <div
                    key={d}
                    title={isHoli ? `${d} ${format(date, 'MMM')} — ${holiday.name}` : `${d} ${format(date, 'MMM')} (${format(date, 'EEEE')})`}
                    className={cn(
                      "py-3 text-center border-r schedule-grid-line tracking-tighter flex flex-col items-center relative",
                      weekendDay && "bg-slate-100/60 dark:bg-slate-800/80",
                      isHoli && "bg-red-50/70 dark:bg-red-500/15",
                      isToday && "bg-blue-50/80 dark:bg-blue-500/20 ring-2 ring-blue-400 dark:ring-blue-300 ring-inset z-10",
                    )}
                    style={{ width: dayCellWidth, minWidth: dayCellWidth }}
                  >
                    {isHoli && (
                      <span className="absolute top-1 start-1 w-1.5 h-1.5 rounded-full bg-red-500" aria-label="Holiday" />
                    )}
                    {isToday && (
                      <span className="absolute -top-0.5 right-0.5 text-[7px] font-black text-blue-600 dark:text-blue-300 uppercase tracking-tighter">●</span>
                    )}
                    <span className={cn(
                      "font-black text-[11px]",
                      isToday
                        ? "text-blue-700 dark:text-blue-200"
                        : (weekendDay || isHoli)
                          ? "text-red-600 dark:text-red-300"
                          : "text-slate-900 dark:text-slate-100",
                    )}>
                      {d}
                    </span>
                    <span className={cn(
                      "text-[7px] font-bold uppercase shrink-0 leading-none mt-0.5",
                      isToday ? "text-blue-500 dark:text-blue-300" : "text-slate-400 dark:text-slate-500",
                    )}>
                      {format(date, 'EEE')}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Virtualised body */}
            {filteredEmployees.length === 0 && employees.length > 0 ? (
              <div className="p-12 text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                {t('schedule.noMatches')}
              </div>
            ) : (
              <List
                rowCount={rowPlan.length}
                rowHeight={getRowHeight}
                defaultHeight={naturalHeight}
                rowComponent={ScheduleRow}
                rowProps={{
                  rowPlan,
                  days,
                  schedule,
                  onCellClick: handleCellClick,
                  onCellMouseDown: handleCellMouseDown,
                  onCellMouseEnter: handleCellMouseEnter,
                  recentlyChangedCells,
                  violationCellKeys,
                  statsByEmpId,
                  onToggleCollapse: toggleCollapse,
                  groupingEnabled: scheduleGroupByStation,
                  totalGridWidth,
                  cellsReadOnly: !canEditCells,
                  diffMap: diffEnabled ? diffMap : null,
                  dayCellWidth,
                }}
              />
            )}
          </div>
        </div>
        {/* Footer summary bar — totals across the currently-filtered roster.
            Helps spot at a glance whether the visible group is over- or
            under-loaded without scrolling through all employee tooltips. */}
        {filteredEmployees.length > 0 && (() => {
          let totalHrs = 0;
          let saturated = 0;
          let nearCap = 0;
          let onLeaveAnyDay = 0;
          for (const emp of filteredEmployees) {
            const stats = statsByEmpId.get(emp.empId);
            if (!stats) continue;
            totalHrs += stats.totalHrs;
            const ratio = stats.weeklyCap > 0 ? stats.weeklyHrsRolling / stats.weeklyCap : 0;
            if (ratio >= 1) saturated++;
            else if (ratio >= 0.9) nearCap++;
            if (stats.daysOnLeave > 0) onLeaveAnyDay++;
          }
          return (
            <div className="bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-4 flex-wrap text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 dark:text-slate-500">{t('schedule.footer.totalHrs')}:</span>
                <span className="font-black text-slate-800 dark:text-slate-100">{totalHrs.toFixed(0)}h</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span className="text-slate-400 dark:text-slate-500">{t('schedule.footer.saturated')}:</span>
                <span className="font-black text-red-700 dark:text-red-300">{saturated}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-slate-400 dark:text-slate-500">{t('schedule.footer.nearCap')}:</span>
                <span className="font-black text-amber-700 dark:text-amber-300">{nearCap}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-slate-400 dark:text-slate-500">{t('schedule.footer.onLeaveAny')}:</span>
                <span className="font-black text-emerald-700 dark:text-emerald-300">{onLeaveAnyDay}</span>
              </div>
              <div className="ms-auto text-slate-400 dark:text-slate-500 normal-case font-mono">
                {filteredEmployees.length}/{employees.length} {t('schedule.footer.employees')}
              </div>
            </div>
          );
        })()}
      </div>

      {/* v5.18.0 — coverage diagnostics. Inline isPeakDay predicate
          mirrors App.tsx's logic — peakDays-of-week OR holiday date.
          The panel is self-rendering: it counts gaps and hides itself
          when the schedule is fully covered, so this block costs
          ~nothing on healthy schedules. */}
      {(() => {
        const holidayDates = new Set(holidays.map(h => h.date));
        const isPeak = (day: number) => {
          const date = new Date(config.year, config.month - 1, day);
          const dow = date.getDay() + 1;
          const dateStr = format(date, 'yyyy-MM-dd');
          return (config.peakDays || []).includes(dow) || holidayDates.has(dateStr);
        };
        return (
          <CoverageDiagnosticsPanel
            schedule={schedule}
            employees={employees}
            shifts={shifts}
            stations={stations}
            holidays={holidays}
            config={config}
            isPeakDay={isPeak}
          />
        );
      })()}
    </div>
  );
}

// v2.2.0 — Auto-Schedule run UI with optional date range, including
// cross-month ranges (e.g. 15 Apr → 15 May). Pre-2.2.0 the buttons ran
// across the full active month unconditionally. The Calendar chevron
// reveals start/end ISO dates; if both dates fall inside the active
// month and span the whole month, the range is omitted (= existing
// full-month behaviour). Cross-month ranges are split into per-month
// invocations by the App.tsx orchestrator.
function AutoScheduleRangePicker({
  year, month, daysInMonth, disabled, disabledReason, onRunPreserve, onRunFresh,
}: {
  year: number;
  month: number;
  daysInMonth: number;
  disabled: boolean;
  disabledReason?: string;
  onRunPreserve: (range?: { start: string; end: string }) => void;
  onRunFresh: (range?: { start: string; end: string }) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const monthFirst = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthLast = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const [startDate, setStartDate] = useState(monthFirst);
  const [endDate, setEndDate] = useState(monthLast);

  // Reset to the active month's bounds whenever the visible month
  // changes — otherwise a stale window from a previous month would
  // surprise the user when they next open the picker.
  useEffect(() => {
    setStartDate(monthFirst);
    setEndDate(monthLast);
  }, [monthFirst, monthLast]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  // Normalise: lo is always the earlier date, hi the later. The picker
  // accepts swapped inputs gracefully so a typo doesn't error.
  const [lo, hi] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];

  const dayCount = (() => {
    const a = new Date(lo);
    const b = new Date(hi);
    return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  })();

  const isFullMonth = lo === monthFirst && hi === monthLast;
  const crossesMonth = lo.slice(0, 7) !== hi.slice(0, 7);
  const showPeriodHint = dayCount < 28;

  // Range payload to forward to the orchestrator. Suppress when the
  // range is exactly the active month so the existing full-month
  // preview-and-apply path runs unchanged.
  const buildRange = (): { start: string; end: string } | undefined =>
    isFullMonth ? undefined : { start: lo, end: hi };

  return (
    <div ref={wrapRef} className="relative inline-flex items-center gap-2">
      {/* v5.16.0 — clearer labels + tone signaling. Pre-v5.16 the
          two buttons read "Optimal (Keep Absences)" + "Auto-Schedule"
          which leaned on side-effects; users repeatedly asked "did
          this overwrite my leaves?". The safe path now reads as
          "Re-fill (keep my edits)" in the primary emerald tone, and
          the destructive rebuild path borrows the rose accent so it
          visibly registers as "I will lose work" before click. */}
      <button
        onClick={() => onRunPreserve(buildRange())}
        disabled={disabled}
        title={disabled ? (disabledReason || '') : t('action.runAutoSchedule.refill.tooltip')}
        className="apple-press flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-500/25 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:hover:bg-slate-300 dark:disabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:shadow-none disabled:text-slate-500"
      >
        <Wand2 className="w-4 h-4" />
        {t('action.runAutoSchedule.refill')}
      </button>

      <button
        onClick={() => onRunFresh(buildRange())}
        disabled={disabled}
        title={disabled ? (disabledReason || '') : t('action.runAutoSchedule.rebuild.tooltip')}
        className="apple-press flex items-center gap-2 bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 border-2 border-rose-300 dark:border-rose-500/40 px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-rose-50 dark:hover:bg-rose-500/10 shadow-sm disabled:bg-slate-50 dark:disabled:bg-slate-900 disabled:text-slate-400 dark:disabled:text-slate-600 disabled:border-slate-200 dark:disabled:border-slate-700 disabled:cursor-not-allowed disabled:shadow-none"
      >
        <Sparkles className="w-4 h-4" />
        {t('action.runAutoSchedule.rebuild')}
      </button>

      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title={t('schedule.runAuto.range.tooltip')}
        className={cn(
          'p-2.5 rounded-xl border transition-all shadow-sm flex items-center gap-1',
          isFullMonth
            ? 'bg-white dark:bg-slate-800/60 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            : 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200 border-blue-200 dark:border-blue-500/30 hover:bg-blue-100 dark:hover:bg-blue-500/25',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
        aria-label={t('schedule.runAuto.range.tooltip')}
      >
        <Calendar className="w-4 h-4" />
        {!isFullMonth && (
          <span className="text-[10px] font-mono font-black">{lo.slice(5)}→{hi.slice(5)}</span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-2 end-0 z-50 w-96 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-4 space-y-3">
          <div>
            <p className="text-[10px] font-black text-slate-700 dark:text-slate-100 uppercase tracking-widest">{t('schedule.runAuto.range.title')}</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">{t('schedule.runAuto.range.body')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1 block">{t('schedule.runAuto.range.start')}</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-mono font-bold text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1 block">{t('schedule.runAuto.range.end')}</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-mono font-bold text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">
            <span>{t('schedule.runAuto.range.coverage')}</span>
            <span className="font-mono text-slate-800 dark:text-slate-100">
              {dayCount} {dayCount === 1 ? t('schedule.runAuto.range.day') : t('schedule.runAuto.range.days')}
              {crossesMonth && ` · ${t('schedule.runAuto.range.crossesMonths')}`}
            </span>
          </div>
          {showPeriodHint && (
            <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg p-2.5 text-[10px] text-amber-800 dark:text-amber-200 leading-relaxed">
              <AlertTriangle className="w-3 h-3 inline-block me-1" />
              {t('schedule.runAuto.range.minHint')}
            </div>
          )}
          {crossesMonth && (
            <div className="bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30 rounded-lg p-2.5 text-[10px] text-blue-800 dark:text-blue-200 leading-relaxed">
              <Calendar className="w-3 h-3 inline-block me-1" />
              {t('schedule.runAuto.range.crossMonthNote')}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setStartDate(monthFirst); setEndDate(monthLast); setOpen(false); }}
              className="flex-1 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
            >
              {t('schedule.runAuto.range.fullMonth')}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 px-3 py-2 bg-slate-900 dark:bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 dark:hover:bg-blue-500 transition-all"
            >
              {t('action.done')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// v5.16.0 — empty-state shown when employees=0 OR stations=0. The grid
// can't render anything useful in those states; pre-v5.16 the user just
// saw an empty grid with a busy toolbar and no breadcrumb. This block
// names exactly what's missing and provides a one-click jump to the
// setup tab. Mirrors the DashboardTab empty-state pattern.
function ScheduleEmptyState({
  kind, onGoToRoster, onGoToLayout,
}: {
  kind: 'noEmployees' | 'noStations' | 'both';
  onGoToRoster?: () => void;
  onGoToLayout?: () => void;
}) {
  const { t } = useI18n();
  const titleKey =
    kind === 'noEmployees' ? 'schedule.empty.noEmployees.title'
    : kind === 'noStations' ? 'schedule.empty.noStations.title'
    : 'schedule.empty.both.title';
  const bodyKey =
    kind === 'noEmployees' ? 'schedule.empty.noEmployees.body'
    : kind === 'noStations' ? 'schedule.empty.noStations.body'
    : 'schedule.empty.both.body';
  // For the 'both' case, show the Roster CTA (employees first, stations
  // come after — that's the natural setup order).
  const showRosterCta = (kind === 'noEmployees' || kind === 'both') && !!onGoToRoster;
  const showLayoutCta = kind === 'noStations' && !!onGoToLayout;
  return (
    <div className="space-y-6">
      <div className="p-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-900 shadow-inner">
        <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
          <Calendar className="w-8 h-8 text-slate-400 dark:text-slate-500" />
        </div>
        <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-2">{t(titleKey)}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed mb-6">{t(bodyKey)}</p>
        <div className="flex flex-wrap gap-3 justify-center">
          {showRosterCta && (
            <button
              onClick={onGoToRoster}
              className="apple-press flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-md"
            >
              {t('schedule.empty.noEmployees.cta')}
            </button>
          )}
          {showLayoutCta && (
            <button
              onClick={onGoToLayout}
              className="apple-press flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-md"
            >
              {t('schedule.empty.noStations.cta')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
