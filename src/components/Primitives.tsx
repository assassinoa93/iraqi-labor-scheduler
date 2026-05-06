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
//
// v5.16.0 — dropped the leading "01"/"02"/.../"15" mono numeral. The
// numbering implied a "first do this, then do that" order, but the
// real setup path doesn't follow the visual numbers (Roster=03 →
// Layout=08 → Schedule=02). Without it the tabs read cleaner and the
// SidebarGroup labels (Operations / Analytics / Setup / System) carry
// the hierarchy. The `index` prop stays in the signature so existing
// call sites compile unchanged; it's just no longer rendered.
//
// The `dir="rtl"` flow is handled by the parent — `start-*` / `end-*`
// classes auto-mirror so the dot lands on the visual end of the row in
// either direction. Pre-2.6 the leading bar was force-placed via
// `border-l-4` and needed a CSS override to mirror in RTL.
export const TabButton = ({ active, label, onClick, badge, tag, tagTitle }: { active: boolean; icon?: any; label: string; index?: string; onClick: () => void; badge?: number; tag?: string; tagTitle?: string }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-4 py-2.5 mx-2 rounded-xl text-sm transition-colors duration-150 relative",
      active
        ? "bg-blue-500/[0.18] text-white font-semibold border border-blue-400/[0.22] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 border border-transparent",
    )}
  >
    <span className="truncate flex-1 text-start">{label}</span>
    {/* v5.20.0 — phase indicator pill. Used by the AI Services tab to
        surface "BETA" so users know the feature is still in testing.
        Coexists with `badge` and the active-state dot — only one of
        the right-side affordances renders, in priority: badge > tag > dot. */}
    {badge !== undefined && badge > 0 ? (
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
    ) : tag ? (
      <span
        className={cn(
          "shrink-0 px-1.5 h-[16px] rounded-md text-[8px] font-black tracking-widest uppercase flex items-center justify-center",
          active
            ? "bg-amber-400/90 text-slate-900"
            : "bg-amber-500/15 text-amber-300 border border-amber-400/30",
        )}
        title={tagTitle ?? tag}
      >
        {tag}
      </span>
    ) : active ? (
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"
        style={{ boxShadow: "0 0 0 3px rgba(96,165,250,0.18)" }}
      />
    ) : null}
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
  value, onClick, isRecent, onMouseDown, onMouseEnter, readOnly, diff,
  hasViolation, empId, day, ariaLabel,
}: {
  value: string;
  onClick: (e: React.MouseEvent) => void;
  isRecent?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  // v5.0.2 — read-only signals "your click won't do anything here", driven
  // by the approval-workflow gate (submitted/locked/saved) and shared with
  // the editing handlers in ScheduleTab. The visual change has to be
  // immediate or users keep clicking and assume the app is broken.
  readOnly?: boolean;
  // v5.1.0 — re-approval diff outline. When the "Show changes since last
  // archive" toggle is on, every cell that differs from the latest snapshot
  // gets a 2px ring drawn via outline (so neighbour cells don't shift):
  //   • added    → emerald (cell exists now, was empty in snapshot)
  //   • modified → amber   (shift code changed)
  //   • removed  → rose    (cell was filled in snapshot, now empty)
  // undefined / null = no diff state, render normally.
  diff?: 'added' | 'modified' | 'removed' | null;
  // v5.18.0 — per-cell violation marker. When ComplianceEngine has flagged
  // this (empId, day) as a hard rule breach, render a small red corner dot
  // so the supervisor spots violations during paint instead of having to
  // visit the side panel. Set empId+day data attributes alongside so arrow-
  // key navigation can find sibling cells via DOM querying.
  hasViolation?: boolean;
  empId?: string;
  day?: number;
  ariaLabel?: string;
}) {
  // The diff-outline + recent-change-outline are mutually compatible —
  // recent-cell pulses, diff stays static — but we precompute the class
  // once so the cn() call below stays readable.
  const diffOutline =
    diff === 'added'    ? 'outline outline-2 outline-emerald-500 dark:outline-emerald-400 z-10' :
    diff === 'modified' ? 'outline outline-2 outline-amber-500 dark:outline-amber-300 z-10' :
    diff === 'removed'  ? 'outline outline-2 outline-rose-500 dark:outline-rose-400 z-10' :
    null;

  // v5.18.0 — arrow-key navigation. The cell is keyboard-focusable when
  // editable (tabIndex=0) so Tab moves between cells in DOM order; arrow
  // keys jump to neighbours via data-cell-* attributes (see ScheduleTab
  // row). Enter / Space activate the cell (paint or open the picker, same
  // as a click). Skipped entirely for read-only cells — they're inert.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (readOnly) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(e as unknown as React.MouseEvent);
      return;
    }
    if (!empId || day === undefined) return;
    let dEmp = 0;
    let dDay = 0;
    if (e.key === 'ArrowLeft') dDay = -1;
    else if (e.key === 'ArrowRight') dDay = 1;
    else if (e.key === 'ArrowUp') dEmp = -1;
    else if (e.key === 'ArrowDown') dEmp = 1;
    else return;
    e.preventDefault();
    const root = e.currentTarget.ownerDocument;
    if (dDay !== 0) {
      // Same employee, neighbouring day. Walk by day index until we find
      // a rendered cell — virtualization may skip far-off rows but day
      // siblings on the same row are always present.
      const target = root.querySelector<HTMLButtonElement>(
        `[data-cell-emp="${cssEscape(empId)}"][data-cell-day="${day + dDay}"]`,
      );
      target?.focus();
    } else {
      // Same day, prev/next employee. Walk DOM order — siblings nearest
      // in source position are likely adjacent in the visible viewport.
      const cells = Array.from(
        root.querySelectorAll<HTMLButtonElement>(`[data-cell-day="${day}"]`),
      );
      const idx = cells.findIndex(el => el.getAttribute('data-cell-emp') === empId);
      const target = cells[idx + dEmp];
      target?.focus();
    }
  };

  return (
    <button
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onKeyDown={handleKeyDown}
      aria-disabled={readOnly || undefined}
      aria-label={ariaLabel}
      tabIndex={readOnly ? -1 : 0}
      data-cell-emp={empId}
      data-cell-day={day}
      className={cn(
        // v2.6 — softened transition (transform + colour only) so the cell
        // doesn't reflow text on hover; transform-gpu hint keeps the scale
        // animation buttery on the compositor.
        "w-full h-10 border-none flex items-center justify-center font-bold text-[10px] relative select-none transform-gpu transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:z-20",
        // Hover scale only when interactive — read-only cells must NOT
        // animate on hover, otherwise they still read as clickable.
        !readOnly && "group-hover:scale-[1.04]",
        value
          ? cn(getShiftColor(value), readOnly && "opacity-60")
          : readOnly
            ? "bg-slate-100/70 dark:bg-slate-800/50"
            : "bg-transparent hover:bg-slate-100/70 dark:hover:bg-slate-700/40",
        readOnly && "cursor-not-allowed",
        // The "just-swapped" highlight: a soft pulsing ring drawn via outline
        // so it sits over neighbouring cells without nudging the layout.
        isRecent && "outline outline-2 outline-amber-400 dark:outline-amber-300 z-10 animate-pulse",
        // Diff outline takes priority over isRecent when both apply — the
        // user explicitly asked to see what changed since the last archive,
        // and an old paint operation's pulse would distract from that.
        diffOutline,
      )}
    >
      {value}
      {hasViolation && (
        <span
          aria-hidden
          title="Compliance violation"
          className="absolute top-0.5 end-0.5 w-1.5 h-1.5 rounded-full bg-red-500 dark:bg-red-400 shadow-[0_0_0_1px_rgba(255,255,255,0.8)] dark:shadow-[0_0_0_1px_rgba(15,23,42,0.8)]"
        />
      )}
    </button>
  );
}

function cssEscape(s: string): string {
  // CSS.escape is unavailable in older runtimes; a strict whitelist of
  // characters that won't appear in employee IDs (`EMP-####`) covers our
  // case without pulling in a polyfill. Falls back to escape for safety.
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// v5.18.0 — `required`/`min`/`max`/`step`/`error` props. The previous API
// ignored numeric bounds, which let the user enter negative weekly hours
// or a 0-IQD salary that silently broke payroll math. `required` paints a
// red asterisk and exposes `aria-required` so assistive tech and the
// browser's native validation both pick it up. `error` renders a small
// inline message under the input (use for cross-field validation that
// the per-input min/max/required can't catch).
export function SettingField({
  label, value, onChange, type = 'text', options, disabled,
  required, min, max, step, error, placeholder,
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  type?: 'text' | 'number' | 'select' | 'time' | 'date';
  options?: string[];
  disabled?: boolean;
  required?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  error?: string | null;
  placeholder?: string;
}) {
  // v2.6 — common input/select base class. Apple-style softened border,
  // explicit dark surface so the field reads as recessed against the
  // card background, and a 2px focus ring tinted to the accent.
  const base = "w-full px-4 py-2 bg-white dark:bg-slate-800/60 border rounded-lg text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 transition-all shadow-sm placeholder-slate-400 dark:placeholder-slate-500 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-50 dark:disabled:bg-slate-900/40";
  const tone = error
    ? 'border-rose-300 dark:border-rose-500/50 focus:ring-rose-500/40 focus:border-rose-400'
    : 'border-slate-200 dark:border-slate-700 focus:ring-blue-500/40 focus:border-blue-400 dark:focus:border-blue-400';
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-1">
        <span>{label}</span>
        {required && <span aria-hidden className="text-rose-500 dark:text-rose-300 text-[11px] leading-none">*</span>}
      </label>
      {type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-required={required || undefined}
          aria-invalid={!!error || undefined}
          className={cn(base, tone)}
        >
          {options?.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          aria-invalid={!!error || undefined}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          className={cn(base, tone)}
        />
      )}
      {error && (
        <p role="alert" className="text-[10px] font-bold text-rose-600 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}
