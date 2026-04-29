import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { getShiftColor } from '../lib/colors';
import { useI18n } from '../lib/i18n';

export type SortDir = 'asc' | 'desc';

// Header cell that toggles sort direction. Click once to sort ascending,
// twice to flip to descending. The same control is used by RosterTab,
// PayrollTab and ShiftsTab — a string sortKey keeps it generic without
// pulling tab-specific union types into this file.
export function SortableHeader({
  label, sortKey, currentKey, direction, onSort, align = 'start', className,
}: {
  label: string;
  sortKey: string;
  currentKey: string | null;
  direction: SortDir;
  onSort: (k: string) => void;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  const active = currentKey === sortKey;
  const justify = align === 'center' ? 'justify-center' : align === 'end' ? 'justify-end' : 'justify-start';
  return (
    <th className={cn('px-6 py-3 tracking-wider', className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 uppercase font-black tracking-wider text-[10px] hover:text-slate-700 transition-colors w-full',
          justify,
          active ? 'text-slate-700' : 'text-slate-400',
        )}
      >
        {label}
        {active && (direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn("bg-white rounded border border-slate-200 shadow-sm overflow-hidden", className)}>
    {children}
  </div>
);

// v2.2.0 — current / recommended comparative KPI. Used on the Workforce
// Planning rollup so the supervisor reads "5 / 9" at a glance instead of
// hunting two separate KpiBlocks for the same delta. The recommended
// number is tinted to match the action tone (rose for hire, slate for
// hold) and the breakdown text below disambiguates FTE vs PT.
//
// v2.3.0 — `currentBreakdown` lets the caller surface the FT / PT split
// for the current side too, so the comparative reads like
// "3 FT + 2 PT / 5 FT + 0 PT" instead of "5 / 5". Without it the
// component falls back to the v2.2 single-line `breakdown` describing
// the recommended side.
export function ComparativeKpi({
  label, current, recommended, breakdown, currentBreakdown, deltaHint, tone = 'neutral',
}: {
  label: string;
  current: number | string;
  recommended: number | string;
  breakdown?: string;
  currentBreakdown?: string;
  deltaHint?: string;
  tone?: 'emerald' | 'blue' | 'rose' | 'neutral';
}) {
  const recClass =
    tone === 'emerald' ? 'text-emerald-700'
    : tone === 'blue' ? 'text-blue-700'
    : tone === 'rose' ? 'text-rose-700'
    : 'text-slate-800';
  return (
    <div>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-black tabular-nums">
        <span className="text-slate-500">{current}</span>
        <span className="text-slate-300 mx-1">/</span>
        <span className={recClass}>{recommended}</span>
      </p>
      {currentBreakdown && breakdown ? (
        <p className="text-[9px] text-slate-500 mt-0.5 leading-tight tabular-nums">
          <span className="text-slate-500">{currentBreakdown}</span>
          <span className="text-slate-300 mx-1">/</span>
          <span className={recClass}>{breakdown}</span>
        </p>
      ) : (breakdown || deltaHint) && (
        <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">
          {breakdown}
          {breakdown && deltaHint ? ' · ' : ''}
          {deltaHint}
        </p>
      )}
      {currentBreakdown && deltaHint && (
        <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">{deltaHint}</p>
      )}
    </div>
  );
}

// v2.2.0 — month + year navigator. Replaces the prev/next-only chevrons
// across the Schedule, Dashboard, Payroll, Coverage&OT and Workforce tabs
// so jumping from Jan to Dec is one click instead of twelve. The chevrons
// stay (incremental nav is still nice for adjacent months); clicking the
// month/year text in the middle pops a year-stepper + 4×3 month grid.
const MONTH_KEYS = [
  'common.month.short.jan', 'common.month.short.feb', 'common.month.short.mar', 'common.month.short.apr',
  'common.month.short.may', 'common.month.short.jun', 'common.month.short.jul', 'common.month.short.aug',
  'common.month.short.sep', 'common.month.short.oct', 'common.month.short.nov', 'common.month.short.dec',
];

export function MonthYearPicker({
  year, month, onChange, onPrev, onNext,
}: {
  year: number;
  month: number; // 1..12
  onChange: (year: number, month: number) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(year);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Reset drafted year whenever the popover opens so the year matches what
  // the user is currently viewing — surprising otherwise after navigating
  // away and back.
  useEffect(() => {
    if (open) setDraftYear(year);
  }, [open, year]);

  // Click-outside dismissal — closes when the user clicks anywhere outside
  // the wrapper (including pressing the date card in another tab in the
  // same component, which never re-renders the wrapper but still escapes
  // the popover).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const monthName = t(MONTH_KEYS[month - 1]);

  return (
    <div ref={wrapRef} className="relative flex items-center gap-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
      <button
        onClick={onPrev}
        aria-label={t('action.prevMonth')}
        className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors"
      >
        {dir === 'rtl' ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </button>
      <button
        onClick={() => setOpen(o => !o)}
        title={t('common.monthPicker.tooltip')}
        className="text-center px-4 w-40 font-mono hover:bg-slate-50 rounded-xl py-1 transition-colors cursor-pointer"
      >
        <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">{year}</p>
        <p className="text-xl font-black text-slate-800 tracking-tighter uppercase whitespace-nowrap">{monthName}</p>
      </button>
      <button
        onClick={onNext}
        aria-label={t('action.nextMonth')}
        className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors"
      >
        {dir === 'rtl' ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
      </button>

      {open && (
        <div className="absolute top-full mt-2 start-0 z-50 w-72 bg-white rounded-2xl border border-slate-200 shadow-2xl p-3" role="dialog" aria-label={t('common.monthPicker.aria')}>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setDraftYear(y => y - 1)}
              aria-label={t('common.monthPicker.prevYear')}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
            >
              {dir === 'rtl' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <p className="text-sm font-black text-slate-800 font-mono tracking-tight">{draftYear}</p>
            <button
              onClick={() => setDraftYear(y => y + 1)}
              aria-label={t('common.monthPicker.nextYear')}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
            >
              {dir === 'rtl' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {MONTH_KEYS.map((key, i) => {
              const m = i + 1;
              const isActive = draftYear === year && m === month;
              return (
                <button
                  key={key}
                  onClick={() => { onChange(draftYear, m); setOpen(false); }}
                  className={cn(
                    'px-2 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all',
                    isActive
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {t(key)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Sidebar section header used to group navigation tabs by purpose
// (Operations / Analytics / Setup / System). Renders a small caps label
// with subtle separators above and below so the navigation reads as a
// hierarchical menu rather than a long flat list.
export const SidebarGroup = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-3">
    <div className="px-6 py-2 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{label}</div>
    <div>{children}</div>
  </div>
);

export const TabButton = ({ active, label, index, onClick }: { active: boolean; icon?: any; label: string; index: string; onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-4 px-6 py-3.5 text-sm transition-all duration-200",
      active
        ? "bg-blue-600/20 border-l-4 border-blue-500 text-white font-medium"
        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
    )}
  >
    <span className={cn("text-[10px] font-bold transition-opacity", active ? "opacity-100" : "opacity-40")}>{index}</span>
    <span>{label}</span>
  </button>
);

// KpiCard renders a single dashboard metric. `unit` decorates the value
// (the legacy "Staff" hardcoded label is now optional and i18n'd at the
// caller). `trend` flips the card into status mode — when 'Critical'
// the value/dot/label render red; any other truthy string renders the
// OK tone. v2.1.2 dropped the always-empty inner span artifact and
// routed status labels through i18n.
export function KpiCard({ label, value, trend, unit }: { label: string; value: any; trend?: string; unit?: string }) {
  const { t } = useI18n();
  return (
    <Card className="p-5 border-slate-200 shadow-sm group bg-white">
      <p className="text-[11px] text-slate-400 uppercase tracking-widest font-bold mb-2">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className={cn(
          "text-3xl font-light tracking-tight",
          trend === 'Critical' ? "text-red-600" : "text-slate-900"
        )}>
          {value}
        </span>
        {!trend && unit && (
          <span className="text-[10px] text-slate-400 font-bold uppercase">{unit}</span>
        )}
      </div>
      {trend && (
        <div className="mt-4 flex items-center gap-1.5">
          <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", trend === 'Critical' ? "bg-red-500" : "bg-emerald-500")} />
          <span className={cn("text-[10px] font-bold uppercase tracking-tight", trend === 'Critical' ? "text-red-500" : "text-emerald-500")}>
            {trend === 'Critical' ? t('kpi.status.review') : t('kpi.status.balanced')}
          </span>
        </div>
      )}
    </Card>
  );
}

export function ScheduleCell({
  value, onClick, isRecent, onMouseDown, onMouseEnter,
}: {
  value: string;
  onClick: (e: React.MouseEvent) => void;
  isRecent?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      className={cn(
        "w-full h-10 border-none transition-all flex items-center justify-center font-bold text-[10px] group-hover:scale-105 relative select-none",
        value ? getShiftColor(value) : "bg-transparent hover:bg-slate-50",
        // The "just-swapped" highlight: a soft pulsing ring drawn via outline
        // so it sits over neighbouring cells without nudging the layout.
        isRecent && "outline outline-2 outline-amber-400 z-10 animate-pulse"
      )}
    >
      {value}
    </button>
  );
}

export function SettingField({ label, value, onChange, type = 'text', options }: { label: string; value: any; onChange: (v: string) => void; type?: 'text' | 'number' | 'select' | 'time' | 'date'; options?: string[] }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</label>
      {type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-2 bg-white border border-slate-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
        >
          {options?.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-2 bg-white border border-slate-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
        />
      )}
    </div>
  );
}
