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
          'inline-flex items-center gap-1 uppercase font-black tracking-wider text-[10px] transition-colors w-full',
          justify,
          active
            ? 'text-slate-700 dark:text-slate-100 hover:text-slate-900 dark:hover:text-white'
            : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200',
        )}
      >
        {label}
        {active && (direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn("bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm overflow-hidden", className)}>
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
    tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'blue' ? 'text-blue-700 dark:text-blue-300'
    : tone === 'rose' ? 'text-rose-700 dark:text-rose-300'
    : 'text-slate-800 dark:text-slate-100';
  return (
    <div>
      <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-black tabular-nums">
        <span className="text-slate-500 dark:text-slate-400">{current}</span>
        <span className="text-slate-300 dark:text-slate-600 mx-1">/</span>
        <span className={recClass}>{recommended}</span>
      </p>
      {currentBreakdown && breakdown ? (
        <p className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight tabular-nums">
          <span className="text-slate-500 dark:text-slate-400">{currentBreakdown}</span>
          <span className="text-slate-300 dark:text-slate-600 mx-1">/</span>
          <span className={recClass}>{breakdown}</span>
        </p>
      ) : (breakdown || deltaHint) && (
        <p className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
          {breakdown}
          {breakdown && deltaHint ? ' · ' : ''}
          {deltaHint}
        </p>
      )}
      {currentBreakdown && deltaHint && (
        <p className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">{deltaHint}</p>
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
    <div ref={wrapRef} className="relative flex items-center gap-4 bg-white dark:bg-slate-900 p-2 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-sm">
      <button
        onClick={onPrev}
        aria-label={t('action.prevMonth')}
        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300 transition-colors"
      >
        {dir === 'rtl' ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </button>
      <button
        onClick={() => setOpen(o => !o)}
        title={t('common.monthPicker.tooltip')}
        className="text-center px-4 w-40 font-mono hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl py-1 transition-colors cursor-pointer"
      >
        <p className="text-[10px] font-black text-blue-500 dark:text-blue-300 uppercase tracking-[0.2em]">{year}</p>
        <p className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-tighter uppercase whitespace-nowrap">{monthName}</p>
      </button>
      <button
        onClick={onNext}
        aria-label={t('action.nextMonth')}
        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300 transition-colors"
      >
        {dir === 'rtl' ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
      </button>

      {open && (
        <div className="absolute top-full mt-2 start-0 z-50 w-72 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700/70 shadow-2xl p-3" role="dialog" aria-label={t('common.monthPicker.aria')}>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setDraftYear(y => y - 1)}
              aria-label={t('common.monthPicker.prevYear')}
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 transition-colors"
            >
              {dir === 'rtl' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <p className="text-sm font-black text-slate-800 dark:text-slate-100 font-mono tracking-tight">{draftYear}</p>
            <button
              onClick={() => setDraftYear(y => y + 1)}
              aria-label={t('common.monthPicker.nextYear')}
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 transition-colors"
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
                    'px-2 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all duration-150',
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                      : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60',
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
//
// v2.6.0 — tightened padding + lighter weight to match the design
// system's eyebrow rhythm. Indentation aligns with the new TabButton
// (which carries `mx-2` for the rounded-pill active treatment).
export const SidebarGroup = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-2">
    <div className="px-5 pt-3 pb-1.5 text-[9px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-[0.2em]">{label}</div>
    <div className="space-y-0.5">{children}</div>
  </div>
);

// Sidebar tab nav button.
//
// v2.6.0 (design-system pass) — adopts the macOS Big Sur "rounded pill"
// active treatment from `Sidebar.jsx` in the design package:
//   • Active tab paints a `rounded-xl` (12px) tinted-blue surface with a
//     hairline blue ring, instead of the previous edge-pinned stripe.
//   • A small pulsing blue dot sits at the inline-end edge of the active
//     row, replacing the leading bar as the "you are here" cue.
//   • Inactive tabs get a faint `slate-800/70` hover (Apple-quiet).
//   • Index numerals are mono + tabular so two-digit IDs line up.
//
// The `dir="rtl"` flow is handled by the parent — `start-*` / `end-*`
// classes auto-mirror so the dot lands on the visual end of the row in
// either direction. Pre-2.6 the leading bar was force-placed via
// `border-l-4` and needed a CSS override to mirror in RTL.
export const TabButton = ({ active, label, index, onClick, badge }: { active: boolean; icon?: any; label: string; index: string; onClick: () => void; badge?: number }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl text-sm transition-colors duration-150 relative",
      active
        ? "bg-blue-500/[0.18] text-white font-semibold border border-blue-400/[0.22] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 border border-transparent",
    )}
  >
    <span className={cn(
      "font-mono text-[10px] font-bold transition-opacity tabular-nums w-3.5 shrink-0 text-center",
      active ? "text-blue-300 opacity-100" : "text-slate-500 opacity-60",
    )}>{index}</span>
    <span className="truncate flex-1 text-start">{label}</span>
    {/* v5.0 — pending-action badge. Surfaces the count of items waiting
        for the user's attention on this tab (currently used by Schedule
        for the approval queue). Clamped at 99+ to keep the sidebar tidy. */}
    {badge !== undefined && badge > 0 && (
      <span
        className={cn(
          "shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums flex items-center justify-center",
          active
            ? "bg-blue-400 text-slate-900"
            : "bg-amber-500 text-white",
        )}
        title={`${badge} item${badge === 1 ? '' : 's'} need attention`}
      >
        {badge > 99 ? '99+' : badge}
      </span>
    )}
    {active && badge === undefined && (
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"
        style={{ boxShadow: "0 0 0 3px rgba(96,165,250,0.18)" }}
      />
    )}
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
    <Card className="p-5 group">
      <p className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold mb-2">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className={cn(
          "text-3xl font-light tracking-tight",
          trend === 'Critical' ? "text-red-600 dark:text-red-300" : "text-slate-900 dark:text-slate-50"
        )}>
          {value}
        </span>
        {!trend && unit && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase">{unit}</span>
        )}
      </div>
      {trend && (
        <div className="mt-4 flex items-center gap-1.5">
          <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", trend === 'Critical' ? "bg-red-500" : "bg-emerald-500")} />
          <span className={cn(
            "text-[10px] font-bold uppercase tracking-tight",
            trend === 'Critical' ? "text-red-500 dark:text-red-300" : "text-emerald-500 dark:text-emerald-300",
          )}>
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
        // v2.6 — softened transition (transform + colour only) so the cell
        // doesn't reflow text on hover; transform-gpu hint keeps the scale
        // animation buttery on the compositor.
        "w-full h-10 border-none flex items-center justify-center font-bold text-[10px] relative select-none transform-gpu transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04]",
        value
          ? getShiftColor(value)
          : "bg-transparent hover:bg-slate-100/70 dark:hover:bg-slate-700/40",
        // The "just-swapped" highlight: a soft pulsing ring drawn via outline
        // so it sits over neighbouring cells without nudging the layout.
        isRecent && "outline outline-2 outline-amber-400 dark:outline-amber-300 z-10 animate-pulse"
      )}
    >
      {value}
    </button>
  );
}

export function SettingField({ label, value, onChange, type = 'text', options, disabled }: { label: string; value: any; onChange: (v: string) => void; type?: 'text' | 'number' | 'select' | 'time' | 'date'; options?: string[]; disabled?: boolean }) {
  // v2.6 — common input/select base class. Apple-style softened border,
  // explicit dark surface so the field reads as recessed against the
  // card background, and a 2px focus ring tinted to the accent.
  const base = "w-full px-4 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 dark:focus:border-blue-400 transition-all shadow-sm placeholder-slate-400 dark:placeholder-slate-500 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-50 dark:disabled:bg-slate-900/40";
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{label}</label>
      {type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={base}
        >
          {options?.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={base}
        />
      )}
    </div>
  );
}
