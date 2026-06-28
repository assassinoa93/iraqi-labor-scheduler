import { CheckCircle2, Circle, ArrowRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { EASE_OUT, useCountUp } from '../lib/motion';

// v5.41.0 (03.1) — completion ring for the setup card. The arc sweeps 0→pct
// once on mount (honours reduced-motion: it renders filled instantly), and the
// centre percentage counts up in step. Gives the card a sense of momentum
// toward "done" that the bare checklist lacked.
function ProgressRing({ pct }: { pct: number }) {
  const reduce = useReducedMotion();
  const size = 52;
  const stroke = 5;
  const r = (size - stroke) / 2;
  // Animate via strokeDashoffset (works reliably on <circle> — pathLength is
  // only honoured on <path> in some browsers). Offset C → C·(1−pct) sweeps the
  // arc from empty to pct, starting at 12 o'clock thanks to the -90° rotation.
  const circumference = 2 * Math.PI * r;
  const shown = useCountUp(Math.round(pct * 100), { duration: 0.9 });
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-200 dark:stroke-slate-700" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-blue-600 dark:stroke-blue-400"
          strokeDasharray={circumference}
          initial={reduce ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct) }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-black text-slate-700 dark:text-slate-200 tabular-nums">
        {Math.round(shown)}%
      </div>
    </div>
  );
}

// v5.24.0 — Setup checklist for new users.
//
// The empty-state CTAs on the Schedule and Dashboard tabs tell the user
// *what's missing* but not the order. New supervisors stalled on
// "should I start with employees, stations, or shifts?" — this checklist
// answers that with a four-step ordered list, each step deep-linking
// to the right tab. Dismiss persists per-device (localStorage); once
// dismissed the card never returns even if the workspace empties.

const STORAGE_KEY = 'ils.ui.setupChecklist.dismissed';

interface Props {
  stationsCount: number;
  employeesCount: number;
  shiftsCount: number;
  // v5.27 — Step 4 ("generate a schedule") is now a real, completable step
  // driven by whether the active month has any assignments. Previously it was
  // hardcoded incomplete AND the card self-dismissed the instant stations +
  // employees + shifts existed — i.e. exactly when the "now build a schedule"
  // nudge became relevant. This also lets us retire the parallel amber setup
  // card the Dashboard rendered alongside it.
  hasScheduleEntries: boolean;
  onGoToLayout: () => void;
  onGoToRoster: () => void;
  onGoToShifts: () => void;
  onGoToSchedule: () => void;
  // v5.27 — when provided, Step 4's CTA opens the Plan-Everything wizard
  // directly instead of just dropping the user on the Schedule tab to hunt
  // for the button.
  onOpenPlanWizard?: () => void;
}

export function SetupChecklist({
  stationsCount, employeesCount, shiftsCount, hasScheduleEntries,
  onGoToLayout, onGoToRoster, onGoToShifts, onGoToSchedule, onOpenPlanWizard,
}: Props) {
  const { t, fmt } = useI18n();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  });

  // Re-evaluate on every render — if the workspace becomes fully populated
  // we hide the card automatically, but if it empties again (rare in
  // practice) we keep it hidden until the user un-dismisses via factory
  // reset. The intent is "first-week handhold", not "perpetual nag".
  const stationsDone = stationsCount > 0;
  const employeesDone = employeesCount > 0;
  const shiftsDone = shiftsCount > 0;
  // v5.27 — "all done" now includes a built schedule, so the card stays
  // through the final step instead of vanishing right before it.
  const allDone = stationsDone && employeesDone && shiftsDone && hasScheduleEntries;
  // v5.41.0 (03.1) — drive the completion ring + caption off the four steps.
  const completedSteps = [stationsDone, employeesDone, shiftsDone, hasScheduleEntries].filter(Boolean).length;
  const totalSteps = 4;
  const pct = completedSteps / totalSteps;

  useEffect(() => {
    if (allDone) setDismissed(true);
  }, [allDone]);

  if (dismissed) return null;

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '1');
    }
    setDismissed(true);
  };

  const Step = ({
    done, label, hint, cta, onClick, badge,
  }: {
    done: boolean;
    label: string;
    hint: string;
    cta: string;
    onClick: () => void;
    badge: string;
  }) => (
    <div className={cn(
      'flex items-start gap-3 p-3 rounded-xl border',
      done
        ? 'bg-emerald-50/50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
        : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700',
    )}>
      {done
        ? <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5" />
        : <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{badge}</span>
          <p className={cn(
            'text-sm font-bold',
            done ? 'text-emerald-700 dark:text-emerald-200' : 'text-slate-800 dark:text-slate-100',
          )}>{label}</p>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">{hint}</p>
      </div>
      {!done && (
        <button
          onClick={onClick}
          className="apple-press shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-semibold tracking-tight shadow-sm"
        >
          {cta}
          <ArrowRight className="w-3 h-3 rtl-flip" />
        </button>
      )}
    </div>
  );

  return (
    <div className="relative bg-gradient-to-br from-blue-50 to-indigo-50/70 dark:from-blue-500/10 dark:to-indigo-500/10 border border-blue-200 dark:border-blue-500/30 rounded-2xl p-5 shadow-sm">
      <button
        onClick={handleDismiss}
        title={t('setup.checklist.dismiss')}
        className="absolute top-3 end-3 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors"
        aria-label={t('setup.checklist.dismiss')}
      >
        <X className="w-4 h-4" />
      </button>
      <div className="mb-4 flex items-start justify-between gap-4 pe-7">
        <div className="min-w-0">
          <p className="text-[10px] font-black text-blue-600 dark:text-blue-300 uppercase tracking-widest mb-1">{t('setup.checklist.eyebrow')}</p>
          <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">{t('setup.checklist.title')}</h3>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mt-1">{t('setup.checklist.subtitle')}</p>
          <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300 mt-1.5 tabular-nums">{t('setup.checklist.progress', { done: fmt.num(completedSteps), total: fmt.num(totalSteps) })}</p>
        </div>
        <ProgressRing pct={pct} />
      </div>
      <div className="space-y-2">
        <Step
          badge={t('setup.checklist.step1.badge')}
          done={stationsDone}
          label={t('setup.checklist.step1.label')}
          hint={t('setup.checklist.step1.hint')}
          cta={t('setup.checklist.step1.cta')}
          onClick={onGoToLayout}
        />
        <Step
          badge={t('setup.checklist.step2.badge')}
          done={employeesDone}
          label={t('setup.checklist.step2.label')}
          hint={t('setup.checklist.step2.hint')}
          cta={t('setup.checklist.step2.cta')}
          onClick={onGoToRoster}
        />
        <Step
          badge={t('setup.checklist.step3.badge')}
          done={shiftsDone}
          label={t('setup.checklist.step3.label')}
          hint={t('setup.checklist.step3.hint')}
          cta={t('setup.checklist.step3.cta')}
          onClick={onGoToShifts}
        />
        <Step
          badge={t('setup.checklist.step4.badge')}
          done={hasScheduleEntries}
          label={t('setup.checklist.step4.label')}
          hint={t('setup.checklist.step4.hint')}
          cta={onOpenPlanWizard ? t('setup.checklist.step4.ctaWizard') : t('setup.checklist.step4.cta')}
          onClick={onOpenPlanWizard ?? onGoToSchedule}
        />
      </div>
    </div>
  );
}
