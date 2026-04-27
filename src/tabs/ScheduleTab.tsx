import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Search, MousePointer2, Sparkles, Hash, AlertTriangle, X } from 'lucide-react';
import { format, isWeekend } from 'date-fns';
import { List, type RowComponentProps } from 'react-window';
import { Employee, Shift, PublicHoliday, Config, Schedule } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { ScheduleCell } from '../components/Primitives';

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
  onCellClick: (empId: string, day: number) => void;
  onUndo: () => void;
  onRunAuto: () => void;
  // Last paint operation's compliance warnings, if any. Null means the most
  // recent paint was clean (or no paint has happened yet).
  paintWarnings: { empName: string; warnings: string[] } | null;
  onDismissPaintWarnings: () => void;
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
  onCellClick: (empId: string, day: number) => void;
}

// Each visible row is rendered by react-window. We deliberately do NOT wrap
// in React.memo — the memoised component would return ReactNode which
// react-window v2's strict prop type rejects, and the row is cheap anyway
// (a flexbox + N divs). Virtualisation alone is the meaningful win.
function ScheduleRow({
  index, style, employees, days, schedule, onCellClick,
}: RowComponentProps<RowData>) {
  const emp = employees[index];
  return (
    <div style={style} className="flex border-b border-slate-100 hover:bg-slate-50/50 group bg-white">
      <div
        className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 px-4 py-2 border-r border-slate-200 shadow-[4px_0_10px_rgba(0,0,0,0.03)] flex flex-col justify-center"
        style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH }}
      >
        <span className="font-bold text-slate-700 text-xs truncate uppercase tracking-tight">{emp?.name}</span>
        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1 shrink-0 mt-0.5">
          <Hash className="w-2 h-2" /> {emp?.empId} • {emp?.role}
        </span>
      </div>
      {days.map(day => (
        <div key={day} className="border-r border-slate-100 flex-shrink-0" style={{ width: DAY_CELL_WIDTH, minWidth: DAY_CELL_WIDTH }}>
          <ScheduleCell
            value={emp ? schedule[emp.empId]?.[day]?.shiftCode || '' : ''}
            onClick={() => emp && onCellClick(emp.empId, day)}
          />
        </div>
      ))}
    </div>
  );
}

export function ScheduleTab({
  employees, filteredEmployees, shifts, holidays, config, schedule,
  paintMode, setPaintMode, scheduleFilter, setScheduleFilter,
  scheduleRoleFilter, setScheduleRoleFilter, rosterRoles,
  scheduleUndoStack, prevMonth, nextMonth, onCellClick, onUndo, onRunAuto,
  paintWarnings, onDismissPaintWarnings,
}: ScheduleTabProps) {
  const { t } = useI18n();

  const days = useMemo(
    () => Array.from({ length: config.daysInMonth }, (_, i) => i + 1),
    [config.daysInMonth],
  );

  const totalGridWidth = NAME_COL_WIDTH + days.length * DAY_CELL_WIDTH;

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
          <div className="flex items-center gap-1.5 mr-4 bg-slate-900 border border-slate-700 p-1 rounded-xl shadow-xl">
            {shifts.map(s => (
              <button
                key={s.code}
                onClick={() => setPaintMode(paintMode?.shiftCode === s.code ? null : { shiftCode: s.code })}
                aria-pressed={paintMode?.shiftCode === s.code}
                className={cn(
                  "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                  paintMode?.shiftCode === s.code
                    ? "bg-blue-600 text-white shadow-inner shadow-blue-800"
                    : "text-slate-400 hover:text-white"
                )}
              >
                {s.code}
              </button>
            ))}
            <div className="w-px h-6 bg-slate-700 mx-1" />
            <button
              onClick={() => setPaintMode(null)}
              aria-label={t('schedule.cursorMode')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                !paintMode ? "bg-white/10 text-white" : "text-slate-400"
              )}
            >
              <MousePointer2 className="w-3 h-3" />
            </button>
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

          <button
            onClick={onRunAuto}
            className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-95"
          >
            <Sparkles className="w-4 h-4" />
            {t('action.runAutoSchedule')}
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
                rowProps={{ employees: filteredEmployees, days, schedule, onCellClick }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
