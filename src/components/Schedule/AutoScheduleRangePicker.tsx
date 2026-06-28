import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Calendar, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';

// Extracted from ScheduleTab in v5.23.0. Toolbar widget that fronts the
// auto-scheduler: two primary buttons (re-fill preserving edits vs
// destructive rebuild) plus a date-range picker that lets the user run the
// scheduler over a sub-window of the active month instead of the whole one.
// The widget closes itself on outside click + Escape; the parent only sees
// the resolved {start,end} payload (or undefined for full-month runs).
export function AutoScheduleRangePicker({
  year, month, daysInMonth, disabled, disabledReason, busy = false, onRunPreserve, onRunFresh,
}: {
  year: number;
  month: number;
  daysInMonth: number;
  disabled: boolean;
  disabledReason?: string;
  // v5.34 — true while a run is in flight: disables both run buttons and
  // swaps the primary button's icon/label for a spinner so the heavy
  // synchronous computation no longer looks like a frozen UI.
  busy?: boolean;
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
        disabled={disabled || busy}
        title={disabled ? (disabledReason || '') : t('action.runAutoSchedule.refill.tooltip')}
        className="apple-press flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm tracking-tight hover:bg-emerald-700 shadow-lg shadow-emerald-500/25 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:hover:bg-slate-300 dark:disabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:shadow-none disabled:text-slate-500"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
        {busy ? t('schedule.autoRunning') : t('action.runAutoSchedule.refill')}
      </button>

      <button
        onClick={() => onRunFresh(buildRange())}
        disabled={disabled || busy}
        title={disabled ? (disabledReason || '') : t('action.runAutoSchedule.rebuild.tooltip')}
        className="apple-press flex items-center gap-2 bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 border-2 border-rose-300 dark:border-rose-500/40 px-6 py-2.5 rounded-xl font-semibold text-sm tracking-tight hover:bg-rose-50 dark:hover:bg-rose-500/10 shadow-sm disabled:bg-slate-50 dark:disabled:bg-slate-900 disabled:text-slate-400 dark:disabled:text-slate-600 disabled:border-slate-200 dark:disabled:border-slate-700 disabled:cursor-not-allowed disabled:shadow-none"
      >
        <Sparkles className="w-4 h-4" />
        {t('action.runAutoSchedule.rebuild')}
      </button>

      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy}
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
              className="flex-1 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-[11px] font-semibold tracking-tight hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
            >
              {t('schedule.runAuto.range.fullMonth')}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 px-3 py-2 bg-slate-900 dark:bg-blue-600 text-white rounded-lg text-[11px] font-semibold tracking-tight hover:bg-slate-800 dark:hover:bg-blue-500 transition-all"
            >
              {t('action.done')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
