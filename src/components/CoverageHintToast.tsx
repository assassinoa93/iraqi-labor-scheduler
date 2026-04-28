import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lightbulb, X, ArrowRight, MoonStar, AlertTriangle, Star } from 'lucide-react';
import { CoverageGap, CoverageSuggestion } from '../lib/coverageHints';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

interface Props {
  // When non-null the toast is visible. The toast doesn't close itself —
  // the parent dismisses it via `onDismiss` or after a swap is picked.
  hint: { gap: CoverageGap; suggestions: CoverageSuggestion[] } | null;
  onDismiss: () => void;
  onPickReplacement: (empId: string) => void;
}

// Side hint that appears in the bottom-right corner when a manual paint
// creates a coverage gap. Non-blocking by design: nothing the user has done
// is rolled back, the original change stands. The toast simply offers a
// one-click "fill the gap with someone else" action plus a "keep the gap"
// override. List of candidates is sorted by an internal score (off-day
// employees first; preference / compliance warnings factored in).
export function CoverageHintToast({ hint, onDismiss, onPickReplacement }: Props) {
  const { t } = useI18n();
  return (
    <AnimatePresence>
      {hint && (
        <motion.div
          key="coverage-hint"
          initial={{ opacity: 0, x: 40, y: 0 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ type: 'spring', stiffness: 280, damping: 26 }}
          className="fixed bottom-6 right-6 z-[90] w-[320px] bg-white border border-amber-200 rounded-xl shadow-2xl shadow-amber-500/10 overflow-hidden"
          role="status"
          aria-live="polite"
        >
          <div className="px-4 py-3 bg-gradient-to-r from-amber-50 to-amber-100 border-b border-amber-200 flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Lightbulb className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">{t('hint.coverage.eyebrow')}</p>
              <p className="text-xs font-bold text-slate-800 leading-snug">
                {t('hint.coverage.title', { day: hint.gap.day, station: hint.gap.station.name })}
              </p>
            </div>
            <button
              onClick={onDismiss}
              aria-label={t('action.cancel')}
              className="text-slate-400 hover:text-slate-700 p-1 -m-1 rounded transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4 py-3 space-y-2 max-h-[280px] overflow-y-auto">
            <p className="text-[10px] text-slate-500 leading-relaxed">{t('hint.coverage.body')}</p>
            {hint.suggestions.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded text-[11px] text-slate-500 italic">
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
                        ? "bg-amber-50 border-amber-300 ring-2 ring-amber-200 hover:bg-amber-100"
                        : s.currentlyOff
                          ? "bg-emerald-50/70 border-emerald-100 hover:bg-emerald-100"
                          : "bg-slate-50 border-slate-100 hover:bg-slate-100"
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
                        <span className="text-xs font-bold text-slate-800 truncate">{s.empName}</span>
                        {s.currentlyOff && (
                          <span className="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest bg-emerald-200 text-emerald-800 rounded">
                            {t('hint.coverage.tag.off')}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 font-mono truncate">{s.empId}</p>
                      {s.warnings.length > 0 && (
                        <p className="text-[10px] text-amber-700 leading-tight mt-1 flex items-start gap-1">
                          <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                          <span className="line-clamp-2">{s.warnings[0]}</span>
                        </p>
                      )}
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 mt-0.5 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex justify-between items-center gap-2">
            <span className="text-[9px] text-slate-400 italic">{t('hint.coverage.override')}</span>
            <button
              onClick={onDismiss}
              className="px-3 py-1 text-[10px] font-black text-slate-700 hover:bg-white border border-slate-200 rounded uppercase tracking-widest transition-all"
            >
              {t('hint.coverage.keepGap')}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
