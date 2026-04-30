import React, { useState } from 'react';
import {
  Lightbulb, X, ArrowRight, MoonStar, AlertTriangle, Star, ChevronRight,
  History, Undo2, Sparkles, ChevronLeft as ChevronLeftIcon, Zap,
} from 'lucide-react';
import { CoverageGap, CoverageSuggestion } from '../lib/coverageHints';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

// One entry in the recent-changes log. Captures enough state to render a
// human-readable line ("Painted FS on Ali — Day 12") and to revert via
// onUndo. Built up by the schedule grid as the user paints; bounded at the
// last N entries to keep the pane readable.
export interface RecentChange {
  id: string;             // unique key per change for the undo-button click handler
  ts: number;
  empId: string;
  empName: string;
  day: number;
  prevCode: string;       // shift code that was in the cell before the edit ('' if empty)
  nextCode: string;       // shift code that's in the cell now
  source: 'paint' | 'cycle' | 'swap' | 'leave-stamp';
}

interface Props {
  // Current coverage gap, if any. Null means no gap is active and the
  // suggestion section shows a "no gaps" pleasant state.
  hint: { gap: CoverageGap; suggestions: CoverageSuggestion[] } | null;
  // Number of additional gaps queued behind the active one (v1.12). Pre-1.12
  // each new paint replaced the previous hint, so the supervisor lost
  // suggestions before they could act on them. Now older gaps stay queued
  // and surface in the pane footer with a count.
  pendingCount: number;
  // True when ≥3 distinct gaps have opened within an 8-second window. The
  // pane shows a "bulk operation detected" banner offering to re-run the
  // auto-scheduler in preserve-absences mode — the right answer when the
  // user is stamping leaves on multiple employees at once.
  massChangeDetected: boolean;
  onDismissHint: () => void;
  onPickReplacement: (empId: string) => void;
  onRunOptimal: () => void;
  // Recent-changes log, most recent first. Each item is undoable independently.
  recentChanges: RecentChange[];
  onUndoChange: (id: string) => void;
  onClearChanges: () => void;
  // Pane is collapsible — when collapsed it renders as a thin tab against
  // the right edge so the schedule grid gets the full viewport width.
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

// Persistent right-side pane on the Schedule tab. Replaces the
// CoverageHintToast: live coverage suggestions when a paint creates a gap,
// plus a per-session change log with one-click undo on each entry.
//
// Layout: fixed right rail, ~340px wide, full viewport height. The
// ScheduleTab applies right-margin so the grid doesn't slide under it.
// Collapses to a thin 36px-wide tab the user clicks to expand.
export function SuggestionPane({
  hint, pendingCount, massChangeDetected,
  onDismissHint, onPickReplacement, onRunOptimal,
  recentChanges, onUndoChange, onClearChanges,
  collapsed, onToggleCollapsed,
}: Props) {
  const { t, dir } = useI18n();
  const [showAllChanges, setShowAllChanges] = useState(false);
  // Anchor the pane on the visual edge OPPOSITE the sidebar. The sidebar
  // sits at the inline-start of the document (visual left in LTR, visual
  // right in RTL because the flex row reverses), so the pane stays at
  // inline-end via logical positioning.
  const isRTL = dir === 'rtl';

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        title={t('pane.expand')}
        aria-label={t('pane.expand')}
        style={isRTL ? { left: 0 } : { right: 0 }}
        className={cn(
          "fixed top-32 z-[40] flex flex-col items-center gap-2 px-2 py-4 bg-white dark:bg-slate-900 border-y border-slate-200 dark:border-slate-700 shadow-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all",
          isRTL ? "border-r rounded-r-xl" : "border-l rounded-l-xl",
        )}
      >
        {isRTL
          ? <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          : <ChevronLeftIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        }
        <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest [writing-mode:vertical-rl]">
          {t('pane.title')}
        </span>
        {hint && (
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        )}
        {recentChanges.length > 0 && (
          <span className="text-[9px] font-black text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
            {recentChanges.length}
          </span>
        )}
      </button>
    );
  }

  const visibleChanges = showAllChanges ? recentChanges : recentChanges.slice(0, 10);

  return (
    <aside
      style={isRTL ? { left: 0 } : { right: 0 }}
      className={cn(
        "fixed top-16 bottom-0 w-[340px] z-[40] bg-white dark:bg-slate-900 shadow-xl flex flex-col overflow-hidden",
        isRTL ? "border-r border-slate-200 dark:border-slate-700" : "border-l border-slate-200 dark:border-slate-700",
      )}
      role="complementary"
      aria-label={t('pane.title')}
    >
      {/* Header with collapse */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-300" />
          <h3 className="text-[11px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-widest">{t('pane.title')}</h3>
        </div>
        <button
          onClick={onToggleCollapsed}
          title={t('pane.collapse')}
          aria-label={t('pane.collapse')}
          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
        >
          {isRTL
            ? <ChevronLeftIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            : <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          }
        </button>
      </div>

      {/* Suggestions section */}
      <div className="flex-1 overflow-y-auto">
        {/* Mass-change banner — surfaces above the active hint when ≥3 gaps
            opened in <8s. Offers the only sensible answer at that scale: re-
            run the auto-scheduler in preserve-absences mode so it routes
            substitutes around the absences in one shot. */}
        {massChangeDetected && (
          <section className="p-4 border-b border-indigo-200 dark:border-indigo-500/40 bg-indigo-50/70 dark:bg-indigo-500/10">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-200">
                <Zap className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black text-indigo-900 dark:text-indigo-200 uppercase tracking-widest">{t('pane.massChange.title')}</p>
                <p className="text-[10px] text-indigo-700 dark:text-indigo-200 leading-relaxed mt-1">{t('pane.massChange.body')}</p>
                <button
                  onClick={onRunOptimal}
                  className="mt-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-sm"
                >
                  {t('pane.massChange.cta')}
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="p-4 border-b border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300" />
            <h4 className="text-[10px] font-black text-amber-700 dark:text-amber-200 uppercase tracking-widest">{t('pane.suggestions.header')}</h4>
            {pendingCount > 0 && (
              <span className="text-[9px] font-black text-amber-700 dark:text-amber-200 bg-amber-100 dark:bg-amber-500/25 border border-amber-200 dark:border-amber-500/40 px-1.5 py-0.5 rounded">
                +{pendingCount} {t('pane.pending.label')}
              </span>
            )}
            {hint && (
              <button
                onClick={onDismissHint}
                title={t('hint.coverage.keepGap')}
                aria-label={t('hint.coverage.keepGap')}
                className="ml-auto p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {!hint ? (
            <div className="px-3 py-6 text-center bg-emerald-50/60 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 rounded-lg">
              <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-200 uppercase tracking-widest">{t('pane.suggestions.noGap')}</p>
              <p className="text-[10px] text-emerald-600 dark:text-emerald-300 mt-1 leading-relaxed">{t('pane.suggestions.noGapHint')}</p>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 mb-2 rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/40">
                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                  {t('hint.coverage.title', { day: hint.gap.day, station: hint.gap.station.name })}
                </p>
                <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-0.5">{t('hint.coverage.body')}</p>
                {pendingCount > 0 && (
                  <p className="text-[10px] text-amber-700 dark:text-amber-200 font-medium mt-1">
                    {t('pane.pending.hint', { count: pendingCount })}
                  </p>
                )}
              </div>

              {hint.suggestions.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/40 rounded text-[11px] text-slate-500 dark:text-slate-400 italic">
                  <MoonStar className="w-3 h-3" /> {t('hint.coverage.noCandidates')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {hint.suggestions.map(s => (
                    <button
                      key={s.empId}
                      onClick={() => onPickReplacement(s.empId)}
                      className={cn(
                        "w-full text-start px-3 py-2 rounded-lg border transition-all flex items-start gap-2 group relative",
                        s.isRecommended
                          ? "bg-amber-50 dark:bg-amber-500/15 border-amber-300 dark:border-amber-500/40 ring-2 ring-amber-200 dark:ring-amber-500/40 hover:bg-amber-100 dark:hover:bg-amber-500/25"
                          : s.currentlyOff
                            ? "bg-emerald-50/70 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/25"
                            : "bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-800"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {s.isRecommended && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest bg-amber-500 text-white rounded">
                              <Star className="w-2.5 h-2.5 fill-white" />
                              {t('hint.coverage.tag.recommended')}
                            </span>
                          )}
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{s.empName}</span>
                          {s.currentlyOff && (
                            <span className="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest bg-emerald-200 dark:bg-emerald-500/25 text-emerald-800 dark:text-emerald-200 rounded">
                              {t('hint.coverage.tag.off')}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate">{s.empId}</p>
                        {s.warnings.length > 0 && (
                          <p className="text-[10px] text-amber-700 dark:text-amber-200 leading-tight mt-1 flex items-start gap-1">
                            <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                            <span className="line-clamp-2">{s.warnings[0]}</span>
                          </p>
                        )}
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200 mt-0.5 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Recent changes section */}
        <section className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <h4 className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">
              {t('pane.changes.header')} ({recentChanges.length})
            </h4>
            {recentChanges.length > 0 && (
              <button
                onClick={onClearChanges}
                title={t('pane.changes.clear')}
                aria-label={t('pane.changes.clear')}
                className="ml-auto text-[9px] font-bold text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 uppercase tracking-widest"
              >
                {t('pane.changes.clear')}
              </button>
            )}
          </div>

          {recentChanges.length === 0 ? (
            <div className="px-3 py-6 text-center bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/60 rounded-lg">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('pane.changes.empty')}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">{t('pane.changes.emptyHint')}</p>
            </div>
          ) : (
            <>
              <ul className="space-y-1">
                {visibleChanges.map(change => (
                  <li
                    key={change.id}
                    className="flex items-start gap-2 px-2.5 py-1.5 bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/60 rounded-md text-[10px]"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-700 dark:text-slate-200 truncate">{change.empName}</p>
                      <p className="text-slate-500 dark:text-slate-400 font-mono">
                        {t('pane.changes.line', {
                          day: change.day,
                          prev: change.prevCode || '∅',
                          next: change.nextCode || '∅',
                        })}
                      </p>
                    </div>
                    <button
                      onClick={() => onUndoChange(change.id)}
                      title={t('pane.changes.undo')}
                      aria-label={t('pane.changes.undo')}
                      className="p-1 text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/15 rounded transition-colors shrink-0"
                    >
                      <Undo2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
              {recentChanges.length > 10 && (
                <button
                  onClick={() => setShowAllChanges(s => !s)}
                  className="mt-2 w-full text-center text-[9px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 uppercase tracking-widest"
                >
                  {showAllChanges ? t('pane.changes.showLess') : t('pane.changes.showAll', { extra: recentChanges.length - 10 })}
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
