import { CheckCircle2, Circle, ArrowRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

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
  onGoToLayout: () => void;
  onGoToRoster: () => void;
  onGoToShifts: () => void;
  onGoToSchedule: () => void;
}

export function SetupChecklist({
  stationsCount, employeesCount, shiftsCount,
  onGoToLayout, onGoToRoster, onGoToShifts, onGoToSchedule,
}: Props) {
  const { t } = useI18n();
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
  const allDone = stationsDone && employeesDone && shiftsDone;

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
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{badge}</span>
          <p className={cn(
            'text-sm font-bold',
            done ? 'text-emerald-700 dark:text-emerald-200 line-through opacity-70' : 'text-slate-800 dark:text-slate-100',
          )}>{label}</p>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">{hint}</p>
      </div>
      {!done && (
        <button
          onClick={onClick}
          className="apple-press shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest font-mono shadow-sm"
        >
          {cta}
          <ArrowRight className="w-3 h-3" />
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
      <div className="mb-4">
        <p className="text-[10px] font-black text-blue-600 dark:text-blue-300 uppercase tracking-widest mb-1">{t('setup.checklist.eyebrow')}</p>
        <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">{t('setup.checklist.title')}</h3>
        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mt-1">{t('setup.checklist.subtitle')}</p>
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
          done={false}
          label={t('setup.checklist.step4.label')}
          hint={t('setup.checklist.step4.hint')}
          cta={t('setup.checklist.step4.cta')}
          onClick={onGoToSchedule}
        />
      </div>
    </div>
  );
}
