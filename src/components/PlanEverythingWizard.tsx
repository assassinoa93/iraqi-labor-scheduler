/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.18.0 — "Plan Everything" wizard.
 *
 * Chains the four planning surfaces into a single confirmable workflow so
 * the supervisor doesn't have to walk Stations → Shifts → Schedule →
 * Workforce by hand each month:
 *
 *   1. Demand tuning — for every station with no hourly demand profile
 *      yet (or where the supervisor wants to refresh from history),
 *      run suggestHourlyDemandFromHistory and surface the proposed
 *      profiles. Apply-all updates every station in one pass.
 *
 *   2. Shift generation — feed the (possibly just-updated) station
 *      demand into generateOptimalShifts. Surface the proposed shift
 *      library additions; apply appends to the existing library
 *      (auto-generated flag stays on for visual differentiation).
 *
 *   3. Auto-schedule — kick off the existing autoScheduler.runAuto
 *      via the parent's onRunAuto callback. The actual schedule write
 *      lives in App.tsx; the wizard just triggers it and surfaces the
 *      "running" state.
 *
 *   4. Recap — coverage diagnostics + staffing-advisory summary so
 *      the supervisor sees the post-plan picture and knows whether
 *      they need to hire / cross-train / redistribute leave.
 *
 * Each step is skippable. The wizard treats the user's previous edits
 * as the new baseline at each step — applying step 1 immediately changes
 * what step 2 emits.
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { X, Sparkles, ArrowRight, ArrowLeft, CheckCircle2, Loader2, ShieldCheck, Wand2, BarChart3 } from 'lucide-react';
import type { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../types';
import { suggestHourlyDemandFromHistory, type DemandSuggestion } from '../lib/demandHistory';
import { generateOptimalShifts } from '../lib/shiftGenerator';
import { diagnoseUnfilledCoverage, groupUnfilledByStationDay } from '../lib/coverageDiagnostics';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';
import { cn } from '../lib/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  // Source data (read-only inputs).
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  allSchedules: Record<string, Schedule>;
  schedule: Schedule;
  // Mutation hooks. The wizard collects user intent and forwards each
  // confirmed step to the parent for the actual state mutation +
  // persistence.
  onApplyStationDemand: (updates: Array<{ stationId: string; suggestion: DemandSuggestion }>) => void;
  onApplyShifts: (newShifts: Shift[]) => void;
  onRunAutoScheduler: () => void;
  // Predicate for peak-day classification. Mirrors App.tsx's isPeakDay
  // closure — needed for the recap step's coverage diagnostics so the
  // wizard's "after" picture matches what the schedule grid displays.
  isPeakDay: (day: number) => boolean;
}

type Step = 'demand' | 'shifts' | 'schedule' | 'recap';

const STEPS: Step[] = ['demand', 'shifts', 'schedule', 'recap'];

export function PlanEverythingWizard({
  isOpen, onClose,
  employees, shifts, stations, holidays, config, allSchedules, schedule,
  onApplyStationDemand, onApplyShifts, onRunAutoScheduler, isPeakDay,
}: Props) {
  const { t } = useI18n();
  useModalKeys(isOpen, onClose);
  const [stepIdx, setStepIdx] = useState(0);
  const [running, setRunning] = useState(false);
  // Track which step has been applied so the recap can summarise what
  // the user actually did vs skipped.
  const [applied, setApplied] = useState<Record<Step, boolean>>({
    demand: false, shifts: false, schedule: false, recap: false,
  });

  const step: Step = STEPS[stepIdx];

  // Demand suggestions per station — recomputed every time the modal
  // opens because the user may have run the schedule again between
  // visits and the history-based suggestions would change.
  const demandSuggestions = useMemo(() => {
    if (!isOpen) return [];
    return stations.map(st => ({
      station: st,
      suggestion: suggestHourlyDemandFromHistory({
        station: st, allSchedules, shifts, holidays, config,
      }),
    })).filter(x => !x.suggestion.noData);
  }, [isOpen, stations, allSchedules, shifts, holidays, config]);

  // Shift suggestions feed off the CURRENT station demand. Re-runs after
  // the user applies step 1 (because stations[] changes upstream and the
  // memo dep updates).
  const shiftResult = useMemo(() => {
    if (!isOpen) return null;
    return generateOptimalShifts(stations, config, shifts);
  }, [isOpen, stations, config, shifts]);

  // Coverage diagnostics for the recap step. Computed only when the
  // wizard is on the recap step so we don't pay the cost on demand /
  // shifts / schedule steps where it isn't surfaced.
  const recapDiagnostics = useMemo(() => {
    if (step !== 'recap') return null;
    const slots = diagnoseUnfilledCoverage({
      schedule, employees, shifts, stations, holidays, config, isPeakDay,
    });
    return groupUnfilledByStationDay(slots);
  }, [step, schedule, employees, shifts, stations, holidays, config, isPeakDay]);

  if (!isOpen) return null;

  const goNext = () => setStepIdx(i => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIdx(i => Math.max(i - 1, 0));

  const handleApplyDemand = () => {
    onApplyStationDemand(
      demandSuggestions.map(({ station, suggestion }) => ({ stationId: station.id, suggestion })),
    );
    setApplied(a => ({ ...a, demand: true }));
    goNext();
  };

  const handleApplyShifts = () => {
    if (shiftResult && shiftResult.generated.length > 0) {
      onApplyShifts(shiftResult.generated);
    }
    setApplied(a => ({ ...a, shifts: true }));
    goNext();
  };

  const handleRunSchedule = () => {
    setRunning(true);
    // Yield so the spinner state lands before the (possibly heavy) run.
    requestAnimationFrame(() => {
      onRunAutoScheduler();
      setApplied(a => ({ ...a, schedule: true }));
      setRunning(false);
      goNext();
    });
  };

  // Step renderers — kept inline so the wizard stays in one file and the
  // shared header/footer can drive the layout.
  const renderDemandStep = () => (
    <div className="space-y-4">
      <p className="text-[12px] text-slate-700 dark:text-slate-200 leading-relaxed">
        {t('planAll.demand.body')}
      </p>
      {demandSuggestions.length === 0 ? (
        <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-200">
          {t('planAll.demand.noData')}
        </div>
      ) : (
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {demandSuggestions.map(({ station, suggestion }) => (
            <div key={station.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">{station.name}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                    {t('planAll.demand.basis', {
                      months: suggestion.monthsAnalyzed,
                      normal: suggestion.normalDayCount,
                      peak: suggestion.peakDayCount,
                    })}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                    {t('planAll.demand.slots')}
                  </p>
                  <p className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-200">
                    {suggestion.normal.length} <span className="text-slate-300 dark:text-slate-600">/</span> {suggestion.peak.length}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderShiftsStep = () => (
    <div className="space-y-4">
      <p className="text-[12px] text-slate-700 dark:text-slate-200 leading-relaxed">
        {t('planAll.shifts.body')}
      </p>
      {/* v5.19.0 — surface the coverage verdict before the suggestions
          list. When the existing library already covers every demand
          hour, the wizard says so explicitly instead of dropping into
          the "0 shifts proposed" empty state which read as a bug. */}
      {shiftResult && shiftResult.verdict === 'adequate' ? (
        <div className="p-4 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-[11px] text-emerald-700 dark:text-emerald-200 leading-relaxed">
          {t('planAll.shifts.adequate', {
            existing: shiftResult.coveringShifts.map(s => s.code).join(', ') || '—',
            coverage: shiftResult.existingCoverage.pctCovered,
          })}
        </div>
      ) : !shiftResult || shiftResult.generated.length === 0 ? (
        <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-200">
          {t('planAll.shifts.empty')}
        </div>
      ) : (
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {shiftResult.suggestions.map(s => (
            <div key={s.shift.code} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 flex items-center gap-3">
              <span className="px-2 py-1 rounded-md bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-200 border border-violet-200 dark:border-violet-500/40 font-mono text-[10px] font-black tracking-widest">
                {s.shift.code}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100 truncate">{s.shift.name}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                  {s.shift.start}–{s.shift.end} · {s.spanHours}h
                </p>
              </div>
              <div className="text-end">
                <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('shifts.autoGen.recommendedHC')}</p>
                <p className="text-[10px] font-mono font-bold text-slate-700 dark:text-slate-200">
                  {s.recommendedNormalHC} <span className="text-slate-300 dark:text-slate-600">/</span> <span className="text-violet-600 dark:text-violet-300">{s.recommendedPeakHC}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderScheduleStep = () => (
    <div className="space-y-4">
      <p className="text-[12px] text-slate-700 dark:text-slate-200 leading-relaxed">
        {t('planAll.schedule.body')}
      </p>
      <div className="p-4 rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-[11px] text-blue-700 dark:text-blue-200 leading-relaxed">
        {t('planAll.schedule.note')}
      </div>
      {applied.shifts && (
        <p className="text-[10px] text-emerald-700 dark:text-emerald-200 font-mono">
          {t('planAll.schedule.afterShifts')}
        </p>
      )}
    </div>
  );

  const renderRecapStep = () => (
    <div className="space-y-4">
      <p className="text-[12px] text-slate-700 dark:text-slate-200 leading-relaxed">
        {t('planAll.recap.body')}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <RecapCard label={t('planAll.recap.demand')} done={applied.demand} />
        <RecapCard label={t('planAll.recap.shifts')} done={applied.shifts} />
        <RecapCard label={t('planAll.recap.schedule')} done={applied.schedule} />
      </div>
      {recapDiagnostics && (
        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {t('planAll.recap.coverageGaps')}
          </p>
          <p className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">
            {recapDiagnostics.length}
          </p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
            {recapDiagnostics.length === 0
              ? t('planAll.recap.coverageOk')
              : t('planAll.recap.coverageHint')}
          </p>
        </div>
      )}
    </div>
  );

  const stepRenderers: Record<Step, React.ReactNode> = {
    demand: renderDemandStep(),
    shifts: renderShiftsStep(),
    schedule: renderScheduleStep(),
    recap: renderRecapStep(),
  };

  const StepIcon = step === 'demand' ? BarChart3
    : step === 'shifts' ? Sparkles
    : step === 'schedule' ? Wand2
    : ShieldCheck;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('planAll.title')}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col"
      >
        {/* Header + step rail */}
        <div className="p-6 border-b border-slate-100 dark:border-slate-700/60 bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-500/10 dark:to-blue-500/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white flex items-center justify-center shadow-md">
                <StepIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{t('planAll.title')}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {t(`planAll.step.${step}.title`)} · {stepIdx + 1} / {STEPS.length}
                </p>
              </div>
            </div>
            <button onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200/60 dark:hover:bg-slate-700 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  i < stepIdx ? 'bg-violet-500'
                  : i === stepIdx ? 'bg-violet-400'
                  : 'bg-slate-200 dark:bg-slate-700',
                )}
              />
            ))}
          </div>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {stepRenderers[step]}
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={stepIdx === 0 ? onClose : goBack}
            disabled={running}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
          >
            <ArrowLeft className="w-3 h-3" />
            {stepIdx === 0 ? t('action.cancel') : t('planAll.back')}
          </button>
          <div className="flex items-center gap-2">
            {step !== 'recap' && (
              <button
                type="button"
                onClick={goNext}
                disabled={running}
                className="px-4 py-2 rounded text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
              >
                {t('planAll.skip')}
              </button>
            )}
            {step === 'demand' && (
              <PrimaryAction
                onClick={handleApplyDemand}
                disabled={demandSuggestions.length === 0}
                label={t('planAll.demand.apply', { count: demandSuggestions.length })}
              />
            )}
            {step === 'shifts' && (
              <PrimaryAction
                onClick={handleApplyShifts}
                disabled={!shiftResult || (shiftResult.generated.length === 0 && shiftResult.verdict !== 'adequate')}
                label={shiftResult?.verdict === 'adequate'
                  ? t('planAll.shifts.adequateContinue')
                  : t('planAll.shifts.apply', { count: shiftResult?.generated.length ?? 0 })}
              />
            )}
            {step === 'schedule' && (
              <PrimaryAction
                onClick={handleRunSchedule}
                disabled={running}
                running={running}
                label={running ? t('planAll.schedule.running') : t('planAll.schedule.run')}
              />
            )}
            {step === 'recap' && (
              <PrimaryAction
                onClick={onClose}
                label={t('planAll.recap.close')}
              />
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function PrimaryAction({ onClick, disabled, running, label }: { onClick: () => void; disabled?: boolean; running?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 px-5 py-2 rounded text-[11px] font-bold uppercase tracking-widest transition-all shadow-md',
        disabled
          ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
          : 'bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-700 hover:to-blue-700',
      )}
    >
      {running
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <ArrowRight className="w-3 h-3" />}
      {label}
    </button>
  );
}

function RecapCard({ label, done }: { label: string; done: boolean }) {
  return (
    <div className={cn(
      'p-3 rounded-lg border text-center',
      done
        ? 'border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10'
        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40',
    )}>
      <CheckCircle2 className={cn(
        'w-5 h-5 mx-auto mb-1',
        done ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-300 dark:text-slate-600',
      )} />
      <p className={cn(
        'text-[10px] font-black uppercase tracking-widest',
        done ? 'text-emerald-700 dark:text-emerald-200' : 'text-slate-400 dark:text-slate-500',
      )}>
        {label}
      </p>
    </div>
  );
}
