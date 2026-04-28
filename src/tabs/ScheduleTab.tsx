import React, { useMemo, useEffect, useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, Search, MousePointer2, Sparkles, Hash, AlertTriangle, X, Wrench, Wand2, Keyboard, Undo2, AlertOctagon, Printer } from 'lucide-react';
import { format, isWeekend } from 'date-fns';
import { List, type RowComponentProps } from 'react-window';
import { Employee, Shift, PublicHoliday, Config, Schedule } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { ScheduleCell } from '../components/Primitives';
import { computeEmployeeRunningStats, formatEmployeeStatsTooltip, EmployeeRunningStats } from '../lib/employeeStats';

export type PaintMode = { shiftCode: string; stationId?: string } | null;

interface ScheduleTabProps {
  employees: Employee[];
  filteredEmployees: Employee[];
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
  onRunAuto: (mode?: 'fresh' | 'preserve') => void;
  // Cells (`${empId}:${day}` keys) the user just swapped via the coverage
  // hint toast. The grid renders these with a brief pulsing highlight so the
  // user sees what moved. Empty set = no recent changes; the cells render
  // normally.
  recentlyChangedCells?: Set<string>;
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
}

// Layout constants used by both the sticky header row and the virtualized
// body rows. Keep them in sync — drift here = misaligned columns.
const ROW_HEIGHT = 48;
const DAY_CELL_WIDTH = 36;
const NAME_COL_WIDTH = 224;

interface RowData {
  employees: Employee[];
  days: number[];
  schedule: Schedule;
  onCellClick: (empId: string, day: number, opts?: { shift?: boolean }) => void;
  onCellMouseDown: (empId: string, day: number, e: React.MouseEvent) => void;
  onCellMouseEnter: (empId: string, day: number) => void;
  recentlyChangedCells?: Set<string>;
  statsByEmpId: Map<string, EmployeeRunningStats>;
}

// Each visible row is rendered by react-window. We deliberately do NOT wrap
// in React.memo — the memoised component would return ReactNode which
// react-window v2's strict prop type rejects, and the row is cheap anyway
// (a flexbox + N divs). Virtualisation alone is the meaningful win.
function ScheduleRow({
  index, style, employees, days, schedule, onCellClick, onCellMouseDown, onCellMouseEnter, recentlyChangedCells, statsByEmpId,
}: RowComponentProps<RowData>) {
  const emp = employees[index];
  const stats = emp ? statsByEmpId.get(emp.empId) : undefined;
  // Cap-status tone: red when at or above the cap, amber within 90%, neutral
  // otherwise. Drives a small badge next to the name so the user spots
  // already-saturated employees before painting another shift.
  const capPct = stats && stats.weeklyCap > 0 ? stats.weeklyHrsRolling / stats.weeklyCap : 0;
  const tone = capPct >= 1 ? 'over' : capPct >= 0.9 ? 'near' : 'ok';
  return (
    <div style={style} className="flex border-b border-slate-100 hover:bg-slate-50/50 group bg-white">
      <div
        className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-4 py-2 border-r border-slate-200 shadow-[4px_0_10px_rgba(0,0,0,0.03)] flex flex-col justify-center"
        style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH }}
        title={stats ? formatEmployeeStatsTooltip(stats) : undefined}
      >
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-slate-700 text-xs truncate uppercase tracking-tight flex-1 min-w-0">{emp?.name}</span>
          {stats && tone !== 'ok' && (
            <span
              className={cn(
                "shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-black tracking-widest",
                tone === 'over' ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700",
              )}
              title={`${stats.weeklyHrsRolling.toFixed(1)} / ${stats.weeklyCap} h peak weekly`}
            >
              <AlertOctagon className="w-2.5 h-2.5" />
              {Math.round(capPct * 100)}%
            </span>
          )}
        </div>
        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1 shrink-0 mt-0.5">
          <Hash className="w-2 h-2" /> {emp?.empId} • {emp?.role}
        </span>
      </div>
      {days.map(day => {
        const isRecent = !!emp && !!recentlyChangedCells?.has(`${emp.empId}:${day}`);
        return (
          <div key={day} className="border-r border-slate-100 flex-shrink-0" style={{ width: DAY_CELL_WIDTH, minWidth: DAY_CELL_WIDTH }}>
            <ScheduleCell
              value={emp ? schedule[emp.empId]?.[day]?.shiftCode || '' : ''}
              onClick={(e) => emp && onCellClick(emp.empId, day, { shift: e.shiftKey })}
              onMouseDown={(e) => emp && onCellMouseDown(emp.empId, day, e)}
              onMouseEnter={() => emp && onCellMouseEnter(emp.empId, day)}
              isRecent={isRecent}
            />
          </div>
        );
      })}
    </div>
  );
}

export function ScheduleTab({
  employees, filteredEmployees, shifts, holidays, config, schedule,
  paintMode, setPaintMode, scheduleFilter, setScheduleFilter,
  scheduleRoleFilter, setScheduleRoleFilter, rosterRoles,
  scheduleUndoStack, prevMonth, nextMonth, onCellClick, onCellRangeFill,
  onUndo, onUndoCell, cellUndoDepth = 0, onRunAuto,
  paintWarnings, onDismissPaintWarnings, staleness, recentlyChangedCells,
}: ScheduleTabProps) {
  const { t } = useI18n();
  // Drag-paint: when the user holds the mouse on a cell while in paint mode
  // and drags across neighbours, every cell entered gets painted. Tracked
  // here (not in App.tsx) to keep mouse-event noise local to the grid.
  const [isDragPainting, setIsDragPainting] = useState(false);
  const lastClickedCellRef = useRef<{ empId: string; day: number } | null>(null);

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
  }, [paintMode, onCellClick, onCellRangeFill]);

  const handleCellMouseEnter = React.useCallback((empId: string, day: number) => {
    if (isDragPainting && paintMode) {
      onCellClick(empId, day);
    }
  }, [isDragPainting, paintMode, onCellClick]);

  const handleCellClick = React.useCallback((empId: string, day: number, opts?: { shift?: boolean }) => {
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
  }, [paintMode, isDragPainting, onCellClick]);

  const days = useMemo(
    () => Array.from({ length: config.daysInMonth }, (_, i) => i + 1),
    [config.daysInMonth],
  );

  // Per-employee running counters for the active month. Computed once per
  // schedule change and shared with every visible row via rowProps so
  // virtualised rows don't redo the work as they scroll into view.
  const statsByEmpId = useMemo(() => {
    const m = new Map<string, EmployeeRunningStats>();
    for (const emp of filteredEmployees) {
      m.set(emp.empId, computeEmployeeRunningStats(emp, schedule, shifts, holidays, config));
    }
    return m;
  }, [filteredEmployees, schedule, shifts, holidays, config]);

  const totalGridWidth = NAME_COL_WIDTH + days.length * DAY_CELL_WIDTH;

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
          <button onClick={prevMonth} aria-label={t('schedule.prevMonth')} className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center px-4 w-40">
            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{config.year}</p>
            <h3 className="font-bold text-slate-800">{format(new Date(config.year, config.month - 1), 'MMMM')}</h3>
          </div>
          <button onClick={nextMonth} aria-label={t('schedule.nextMonth')} className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={scheduleFilter}
              onChange={(e) => setScheduleFilter(e.target.value)}
              placeholder={t('schedule.searchPlaceholder')}
              aria-label={t('schedule.searchPlaceholder')}
              className="pl-9 pr-3 py-2.5 w-64 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
            />
          </div>
          <select
            value={scheduleRoleFilter}
            onChange={(e) => setScheduleRoleFilter(e.target.value)}
            aria-label={t('schedule.allRoles')}
            className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
          >
            <option value="all">{t('schedule.allRoles')}</option>
            {rosterRoles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {(scheduleFilter || scheduleRoleFilter !== 'all') && (
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              {filteredEmployees.length}/{employees.length}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1.5 mr-4 bg-slate-900 border border-slate-700 p-1 rounded-xl shadow-xl"
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
              className="ml-1 mr-1 hidden md:flex items-center gap-1 text-[8px] text-slate-500 font-bold uppercase tracking-widest"
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
              className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              {t('action.undoLast')}
            </button>
          )}
          {onUndoCell && cellUndoDepth > 0 && (
            <button
              onClick={onUndoCell}
              title={t('action.undoCell.tooltip', { count: cellUndoDepth })}
              className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-3 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
            >
              <Undo2 className="w-4 h-4" />
              {t('action.undoCell')} ({cellUndoDepth})
            </button>
          )}

          <button
            onClick={() => onRunAuto('preserve')}
            title={t('action.runAutoSchedulePreserve.tooltip')}
            className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg active:scale-95"
          >
            <Wand2 className="w-4 h-4" />
            {t('action.runAutoSchedulePreserve')}
          </button>

          <button
            onClick={() => onRunAuto('fresh')}
            className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-95"
          >
            <Sparkles className="w-4 h-4" />
            {t('action.runAutoSchedule')}
          </button>

          <button
            onClick={() => window.print()}
            title={t('schedule.print.tooltip')}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-3 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
          >
            <Printer className="w-4 h-4" />
            {t('schedule.print')}
          </button>
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
      {staleness?.isStale && (
        <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <Wrench className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-amber-900 uppercase tracking-widest mb-1">
              {t('schedule.stale.header')}
            </p>
            <p className="text-[11px] text-amber-800">
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
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {paintMode && (
          <div className="bg-blue-600 text-white px-4 py-1 text-[9px] font-bold uppercase tracking-widest text-center shadow-lg border-b border-blue-700 animate-pulse">
            {t('schedule.paintBanner', { code: paintMode.shiftCode })}
          </div>
        )}
        {paintWarnings && paintWarnings.warnings.length > 0 && (
          <div role="alert" className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-amber-900 uppercase tracking-widest mb-1">
                {t('schedule.warningHeader', { name: paintWarnings.empName })}
              </p>
              <ul className="text-[11px] text-amber-800 space-y-0.5 list-disc pl-4">
                {paintWarnings.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <p className="text-[10px] text-amber-700 italic mt-1">{t('schedule.warningFooter')}</p>
            </div>
            <button
              onClick={onDismissPaintWarnings}
              aria-label={t('action.cancel')}
              className="p-1 hover:bg-amber-100 rounded text-amber-700 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <div style={{ width: totalGridWidth, minWidth: totalGridWidth }}>
            {/* Sticky day header */}
            <div className="flex bg-slate-50 border-b border-slate-200 sticky top-0 z-20">
              <div
                className="sticky left-0 bg-slate-50 z-30 px-4 py-4 border-r border-slate-200 shadow-[4px_0_10px_rgba(0,0,0,0.05)] tracking-tighter text-[10px] uppercase font-black text-slate-500 flex items-center"
                style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH }}
              >
                {t('schedule.personnelDirectory')}
              </div>
              {days.map(d => {
                const date = new Date(config.year, config.month - 1, d);
                const isHoli = holidays.some(h => h.date === format(date, 'yyyy-MM-dd'));
                return (
                  <div
                    key={d}
                    className={cn(
                      "py-4 text-center border-r border-slate-100 tracking-tighter flex flex-col items-center",
                      isWeekend(date) && "bg-slate-100/50",
                      isHoli && "bg-red-50/50"
                    )}
                    style={{ width: DAY_CELL_WIDTH, minWidth: DAY_CELL_WIDTH }}
                  >
                    <span className={cn("text-slate-900 font-black text-[10px]", (isWeekend(date) || isHoli) && "text-red-500")}>{d}</span>
                    <span className="text-[7px] text-slate-400 font-bold uppercase shrink-0 leading-none">
                      {format(date, 'EEE')}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Virtualised body */}
            {filteredEmployees.length === 0 && employees.length > 0 ? (
              <div className="p-12 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {t('schedule.noMatches')}
              </div>
            ) : (
              <List
                rowCount={filteredEmployees.length}
                rowHeight={ROW_HEIGHT}
                defaultHeight={Math.min(filteredEmployees.length * ROW_HEIGHT, 600)}
                rowComponent={ScheduleRow}
                rowProps={{
                  employees: filteredEmployees,
                  days,
                  schedule,
                  onCellClick: handleCellClick,
                  onCellMouseDown: handleCellMouseDown,
                  onCellMouseEnter: handleCellMouseEnter,
                  recentlyChangedCells,
                  statsByEmpId,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
