import React, { useMemo, useState } from 'react';
import {
  Users, TrendingUp, Minus, Sparkles, Info,
  MapPin, ChevronDown, ChevronUp, Calendar, Activity, ShieldCheck,
  Zap, Download, Eye, GitCompareArrows,
} from 'lucide-react';
import { Employee, Shift, Station, StationGroup, PublicHoliday, Config, Schedule } from '../types';
import { Card } from '../components/Primitives';
import { Switch } from '../components/ui/Switch';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import {
  analyzeWorkforceAnnual, buildAnnualRollup, AnnualRollupStation, AnnualRollupGroup, MonthlyPlanSummary,
  PlanMode,
} from '../lib/workforcePlanning';

interface Props {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  stationGroups: StationGroup[];
  holidays: PublicHoliday[];
  config: Config;
  schedule: Schedule;
  isPeakDayFor: (config: Config) => (day: number) => boolean;
  prevMonth: () => void;
  nextMonth: () => void;
  onGoToRoster: () => void;
  onGoToLayout: () => void;
}

// Workforce Planning tab (v1.14)
//
// Two recommendation modes:
//   • Conservative — pure FTE, hire-to-peak, never release. The
//     Iraqi-labor-law-safe default.
//   • Optimal — FTE baseline + part-timers for peak surge. Cheaper but
//     assumes the supervisor can scale up/down across the year, which is
//     legally tricky (Art. 36/40 of the Iraqi Labor Law: fixed-term renewals
//     become open-ended FTE; dismissals need Minister of Labor approval).
//
// Two view modes:
//   • Comparative — current roster vs ideal roster side-by-side
//   • Ideal-only — standalone view of what the ideal plan looks like
//     without the comparison clutter, easier to share with stakeholders
//
// Export to PDF for sharing with HR Director / CEO.
export function WorkforcePlanningTab(props: Props) {
  const {
    employees, shifts, stations, stationGroups, holidays, config, isPeakDayFor,
    onGoToRoster, onGoToLayout,
  } = props;
  const { t } = useI18n();

  const [mode, setMode] = useState<PlanMode>('conservative');
  const [idealOnly, setIdealOnly] = useState(false);
  const [showAnnualRollup, setShowAnnualRollup] = useState(true);
  const [drillMonthIndex, setDrillMonthIndex] = useState<number | null>(null);

  const annual = useMemo(
    () => analyzeWorkforceAnnual({ employees, shifts, stations, holidays, baseConfig: config, isPeakDayFor, mode }),
    [employees, shifts, stations, holidays, config, isPeakDayFor, mode],
  );
  const rollup = useMemo(
    () => buildAnnualRollup(annual, employees, stations, mode, stationGroups),
    [annual, employees, stations, mode, stationGroups],
  );
  const drillMonth = drillMonthIndex
    ? annual.byMonth.find(m => m.monthIndex === drillMonthIndex)
    : annual.byMonth[annual.peakMonthIndex - 1];

  const fmtIQD = (n: number) => Math.round(Math.abs(n)).toLocaleString();

  const hasInputs = stations.length > 0;
  const hasDemand = annual.annualRequiredHours > 0;

  const handleExportPDF = () => exportWorkforcePlanToPDF({
    annual, rollup, mode, idealOnly, fmtIQD,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-start justify-between gap-4 mb-2">
        <div className="flex items-center gap-4">
          <div className="bg-white px-5 py-3 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">{t('workforce.annual.year')}</p>
            <p className="text-2xl font-black text-slate-800 tracking-tight font-mono">{annual.year}</p>
          </div>
          <div className="bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('workforce.mode.label')}</p>
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
          <div className="bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-2">
            {idealOnly ? <Eye className="w-3.5 h-3.5 text-indigo-600" /> : <GitCompareArrows className="w-3.5 h-3.5 text-slate-600" />}
            <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest">
              {idealOnly ? t('workforce.view.ideal') : t('workforce.view.comparative')}
            </p>
            <Switch checked={idealOnly} onChange={setIdealOnly} tone="indigo" size="sm" aria-label={t('workforce.view.toggle')} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasInputs && hasDemand && (
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-md active:scale-[0.98]"
            >
              <Download className="w-3.5 h-3.5" />
              {t('workforce.export.button')}
            </button>
          )}
        </div>
      </div>

      {!hasInputs ? (
        <Card className="p-10 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
            <MapPin className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-700">{t('workforce.empty.title')}</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">{t('workforce.empty.body')}</p>
          <button onClick={onGoToLayout} className="px-5 py-2 bg-slate-900 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all">
            {t('workforce.empty.cta')}
          </button>
        </Card>
      ) : !hasDemand ? (
        <Card className="p-8 text-center space-y-3 bg-amber-50/40 border-amber-200">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <Info className="w-7 h-7 text-amber-700" />
          </div>
          <h3 className="text-lg font-bold text-amber-800">{t('workforce.noDemand.title')}</h3>
          <p className="text-sm text-amber-700 max-w-md mx-auto leading-relaxed">{t('workforce.noDemand.body')}</p>
        </Card>
      ) : (
        <>
          {/* Mode explanation banner */}
          <Card className={cn(
            "p-4 flex items-start gap-3 border",
            mode === 'conservative' ? "bg-emerald-50/50 border-emerald-200" : "bg-amber-50/50 border-amber-200",
          )}>
            {mode === 'conservative' ? (
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <Zap className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <p className={cn(
                "text-[11px] font-black uppercase tracking-widest",
                mode === 'conservative' ? "text-emerald-800" : "text-amber-800",
              )}>
                {mode === 'conservative' ? t('workforce.mode.conservative.title') : t('workforce.mode.optimal.title')}
              </p>
              <p className={cn(
                "text-[11px] leading-relaxed mt-1",
                mode === 'conservative' ? "text-emerald-700" : "text-amber-700",
              )}>
                {mode === 'conservative' ? t('workforce.mode.conservative.body') : t('workforce.mode.optimal.body')}
              </p>
            </div>
          </Card>

          {/* ── Annual KPI strip ────────────────────────────────────────── */}
          {!idealOnly ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-5 bg-slate-900 text-white border-0 shadow-xl">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-300 mb-2">{t('workforce.annual.kpi.totalHours')}</p>
                <p className="text-3xl font-black tracking-tight">{Math.round(annual.annualRequiredHours).toLocaleString()}</p>
                <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{t('workforce.annual.kpi.totalHoursSub')}</p>
              </Card>
              <Card className="p-5 bg-slate-50 border-slate-200">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-700 mb-2">{t('workforce.kpi.current')}</p>
                <p className="text-3xl font-black tracking-tight text-slate-800">{rollup.totalCurrentEmployees}</p>
                <p className="text-[10px] font-bold text-slate-600 mt-1 uppercase tracking-wider">{t('workforce.kpi.currentSub')}</p>
              </Card>
              <Card className="p-5 bg-emerald-50 border-emerald-200">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 mb-2">{t('workforce.kpi.recommended')}</p>
                <p className="text-3xl font-black tracking-tight text-emerald-700">{rollup.totalRecommendedFTE + rollup.totalRecommendedPartTime}</p>
                <p className="text-[10px] font-bold text-emerald-600 mt-1 uppercase tracking-wider">
                  {rollup.totalRecommendedFTE} FTE + {rollup.totalRecommendedPartTime} PT
                </p>
              </Card>
              <Card className={cn(
                "p-5 border",
                annual.annualDelta < 0 ? "bg-emerald-50 border-emerald-200" : annual.annualDelta > 0 ? "bg-rose-50 border-rose-200" : "bg-slate-50 border-slate-200",
              )}>
                <p className={cn(
                  "text-[10px] font-black uppercase tracking-widest mb-2",
                  annual.annualDelta < 0 ? "text-emerald-700" : annual.annualDelta > 0 ? "text-rose-700" : "text-slate-600",
                )}>{t('workforce.annual.kpi.annualDelta')}</p>
                <p className={cn(
                  "text-2xl font-black tracking-tight",
                  annual.annualDelta < 0 ? "text-emerald-700" : annual.annualDelta > 0 ? "text-rose-700" : "text-slate-700",
                )}>
                  {annual.annualDelta >= 0 ? '+' : '−'}{fmtIQD(annual.annualDelta)}
                </p>
                <p className={cn(
                  "text-[10px] font-bold mt-1",
                  annual.annualDelta < 0 ? "text-emerald-600" : annual.annualDelta > 0 ? "text-rose-600" : "text-slate-500",
                )}>IQD / yr</p>
              </Card>
            </div>
          ) : (
            // Ideal-only view: simpler 3-card strip showing the recommendation alone
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="p-6 bg-slate-900 text-white border-0 shadow-xl">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300 mb-2">{t('workforce.ideal.totalRoster')}</p>
                <p className="text-4xl font-black tracking-tight">{rollup.totalRecommendedFTE + rollup.totalRecommendedPartTime}</p>
                <p className="text-[11px] font-bold text-slate-300 mt-2">{rollup.totalRecommendedFTE} FTE + {rollup.totalRecommendedPartTime} PT</p>
              </Card>
              <Card className="p-6 bg-emerald-50 border-emerald-200">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 mb-2">{t('workforce.ideal.annualSalary')}</p>
                <p className="text-3xl font-black tracking-tight text-emerald-700">
                  {fmtIQD(mode === 'conservative' ? rollup.annualConservativeSalary : rollup.annualOptimalSalary)}
                </p>
                <p className="text-[10px] font-bold text-emerald-600 mt-2 uppercase tracking-wider">IQD / yr</p>
              </Card>
              {mode === 'conservative' ? (
                <Card className="p-6 bg-amber-50 border-amber-200">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2">{t('workforce.ideal.legalPremium')}</p>
                  <p className="text-3xl font-black tracking-tight text-amber-700">{fmtIQD(rollup.legalSafetyPremium)}</p>
                  <p className="text-[10px] text-amber-700 leading-relaxed mt-2">{t('workforce.ideal.legalPremiumNote')}</p>
                </Card>
              ) : (
                <Card className="p-6 bg-blue-50 border-blue-200">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 mb-2">{t('workforce.ideal.peakMonth')}</p>
                  <p className="text-3xl font-black tracking-tight text-blue-700">
                    {annual.byMonth[annual.peakMonthIndex - 1].monthName}
                  </p>
                  <p className="text-[10px] text-blue-600 mt-2">{Math.round(annual.byMonth[annual.peakMonthIndex - 1].monthlyRequiredHours).toLocaleString()}h required</p>
                </Card>
              )}
            </div>
          )}

          {/* ── Annual rollup table (v1.16: prefers GROUP rollup when
              groups exist, falls back to per-station). Groups give the
              clearest signal — "I need N cashiers" beats listing every
              individual cashier station. Stations are still available
              underneath as drill-down for finer-grained decisions. */}
          <Card className="overflow-hidden">
            <button
              onClick={() => setShowAnnualRollup(s => !s)}
              className="w-full p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3 hover:bg-slate-100/50 transition-colors text-left"
            >
              <Activity className="w-4 h-4 text-blue-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                  {rollup.byGroup.length > 0 ? t('workforce.rollup.byGroup.title') : t('workforce.rollup.byStation.title')}
                </h3>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {rollup.byGroup.length > 0 ? t('workforce.rollup.byGroup.subtitle') : t('workforce.rollup.byStation.subtitle')}
                </p>
              </div>
              {showAnnualRollup ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {showAnnualRollup && (
              <div className="divide-y divide-slate-100">
                {rollup.byGroup.length > 0 ? (
                  rollup.byGroup.map(g => (
                    <RollupGroupRow key={g.groupId} group={g} stationsLookup={stations} stationRollups={rollup.byStation} idealOnly={idealOnly} />
                  ))
                ) : rollup.byStation.length === 0 ? (
                  <div className="p-6 text-center text-[11px] text-slate-500 italic">
                    {t('workforce.rollup.byStation.empty')}
                  </div>
                ) : (
                  rollup.byStation.map(s => (
                    <RollupStationRow key={s.stationId} station={s} idealOnly={idealOnly} />
                  ))
                )}
              </div>
            )}
          </Card>

          {/* ── Monthly demand chart (skipped in ideal-only) ───────────── */}
          {!idealOnly && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-600" /> {t('workforce.annual.chart.title')}
                </h3>
                <p className="text-[10px] text-slate-500">{t('workforce.annual.chart.tip')}</p>
              </div>
              <MonthlyDemandChart
                months={annual.byMonth}
                peakMonthIndex={annual.peakMonthIndex}
                valleyMonthIndex={annual.valleyMonthIndex}
                activeMonthIndex={drillMonth?.monthIndex ?? annual.peakMonthIndex}
                onPickMonth={setDrillMonthIndex}
              />
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3 text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span className="text-slate-500">{t('workforce.annual.chart.peakLabel')}: <span className="font-bold text-slate-800">{annual.byMonth[annual.peakMonthIndex - 1].monthName}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-slate-500">{t('workforce.annual.chart.valleyLabel')}: <span className="font-bold text-slate-800">{annual.byMonth[annual.valleyMonthIndex - 1].monthName}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-slate-500">{t('workforce.annual.chart.activeLabel')}: <span className="font-bold text-slate-800">{drillMonth?.monthName}</span></span>
                </div>
              </div>
            </Card>
          )}

          {/* ── Implementation timing (only meaningful in comparative mode) ── */}
          {!idealOnly && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-amber-600" /> {t('workforce.annual.timing.title')}
                </h3>
                <p className="text-[10px] text-slate-500 mt-1">{t('workforce.annual.timing.subtitle')}</p>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {annual.savingsByStartMonth.map(row => {
                    const isSaving = row.savings > 0;
                    const isNeutral = row.savings === 0;
                    return (
                      <div
                        key={row.monthIndex}
                        className={cn(
                          "p-3 rounded-xl border transition-all",
                          isNeutral ? "bg-slate-50 border-slate-200"
                            : isSaving ? "bg-emerald-50 border-emerald-200"
                              : "bg-rose-50 border-rose-200",
                        )}
                      >
                        <p className={cn(
                          "text-[10px] font-black uppercase tracking-widest",
                          isNeutral ? "text-slate-500" : isSaving ? "text-emerald-700" : "text-rose-700",
                        )}>
                          {t('workforce.annual.timing.startIn', { month: row.monthName })}
                        </p>
                        <p className={cn(
                          "text-lg font-black mt-1",
                          isNeutral ? "text-slate-700" : isSaving ? "text-emerald-700" : "text-rose-700",
                        )}>
                          {isSaving ? '+' : row.savings < 0 ? '−' : ''}{fmtIQD(row.savings)}
                        </p>
                        <p className={cn(
                          "text-[9px] font-bold uppercase tracking-wider mt-0.5",
                          isNeutral ? "text-slate-500" : isSaving ? "text-emerald-600" : "text-rose-600",
                        )}>
                          IQD · {row.remainingMonths} {row.remainingMonths === 1 ? t('workforce.annual.timing.monthLeft') : t('workforce.annual.timing.monthsLeft')}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          )}

          {/* Footer CTA */}
          <Card className="p-5 bg-slate-900 text-white border-0 flex items-start gap-4">
            <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">{t('workforce.cta.title')}</p>
              <p className="text-[11px] text-slate-300 leading-relaxed mt-1">{t('workforce.cta.body')}</p>
            </div>
            <button onClick={onGoToRoster} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 shrink-0">
              {t('workforce.cta.button')}
            </button>
          </Card>
        </>
      )}
    </div>
  );
}

// Apple-style segmented control for mode (Conservative ↔ Optimal).
function ModeToggle({ mode, onChange }: { mode: PlanMode; onChange: (m: PlanMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="inline-flex items-center bg-slate-100 rounded-full p-0.5">
      <button
        onClick={() => onChange('conservative')}
        className={cn(
          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
          mode === 'conservative'
            ? "bg-emerald-500 text-white shadow-sm"
            : "text-slate-600 hover:text-slate-800",
        )}
      >
        {t('workforce.mode.conservative.label')}
      </button>
      <button
        onClick={() => onChange('optimal')}
        className={cn(
          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
          mode === 'optimal'
            ? "bg-amber-500 text-white shadow-sm"
            : "text-slate-600 hover:text-slate-800",
        )}
      >
        {t('workforce.mode.optimal.label')}
      </button>
    </div>
  );
}

// Per-group rollup row (v1.16). Aggregates demand across the group's
// member stations and shows a drill-down to per-station rows when the
// supervisor expands it.
function RollupGroupRow({ group, stationsLookup, stationRollups, idealOnly }: {
  group: AnnualRollupGroup;
  stationsLookup: Station[];
  stationRollups: AnnualRollupStation[];
  idealOnly: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const actionTone =
    group.action === 'hire' ? { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', Icon: TrendingUp }
      : { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', Icon: Minus };
  const ActionIcon = actionTone.Icon;
  const actionLabel = group.action === 'hire' ? t('workforce.action.hire') : t('workforce.action.hold');
  const memberStationRollups = stationRollups.filter(s => group.stationIds.includes(s.stationId));
  void stationsLookup;

  return (
    <div className="hover:bg-slate-50/40 transition-colors">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full p-5 text-left flex items-start gap-4"
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-white shadow-sm"
          style={{ backgroundColor: group.groupColor || '#475569' }}
        >
          <MapPin className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-base font-bold text-slate-800 tracking-tight">{group.groupName}</h3>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest bg-slate-100 px-1.5 py-0.5 rounded">
              {group.stationIds.length} {t('workforce.group.stations')}
            </span>
            <div className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded-lg border", actionTone.bg, actionTone.border)}>
              <ActionIcon className={cn("w-3 h-3", actionTone.text)} />
              <span className={cn("text-[9px] font-black uppercase tracking-widest", actionTone.text)}>{actionLabel}</span>
            </div>
          </div>

          <div className={cn("grid gap-3", idealOnly ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-5")}>
            {!idealOnly && (
              <KpiBlock label={t('workforce.group.eligibleNow')} value={group.currentEligibleCount.toString()} />
            )}
            <KpiBlock label={t('workforce.rollup.recommendedFTE')} value={group.recommendedFTE.toString()} tone="emerald" />
            <KpiBlock label={t('workforce.rollup.recommendedPT')} value={group.recommendedPartTime.toString()} tone="blue" />
            {!idealOnly && (
              <KpiBlock
                label={t('workforce.role.delta')}
                value={`${group.delta > 0 ? '+' : ''}${group.delta}`}
                tone={group.delta > 0 ? 'rose' : 'neutral'}
                hint={group.action === 'hire'
                  ? t('workforce.role.hireBy', { count: group.delta })
                  : t('workforce.role.matchesNeed')}
              />
            )}
            <KpiBlock
              label={t('workforce.rollup.peakMonth')}
              value={MONTH_NAMES[group.peakMonthIndex - 1]}
              hint={`${group.peakMonthFTE} FTE`}
            />
          </div>

          <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-100 flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-700 leading-relaxed">{group.reasoning}</p>
          </div>
        </div>
        <div className="shrink-0 pt-1">
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {expanded && memberStationRollups.length > 0 && (
        <div className="px-5 pb-5 -mt-2">
          <div className="ml-14 pl-4 border-l-2 border-slate-200 space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('workforce.group.drilldown')}</p>
            {memberStationRollups.map(s => (
              <div key={s.stationId} className="bg-white rounded-lg border border-slate-100 p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate">{s.stationName}</p>
                  <p className="text-[10px] text-slate-500 font-mono">{Math.round(s.annualRequiredHours).toLocaleString()}h/yr · peak {MONTH_NAMES[s.peakMonthIndex - 1]}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-emerald-700">{s.recommendedFTE} FTE</p>
                  {s.recommendedPartTime > 0 && (
                    <p className="text-[10px] text-blue-700">+ {s.recommendedPartTime} PT</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Per-station rollup row (v1.15). Anchored to physical stations rather
// than role labels, so the supervisor reads "Cashier Point 1 needs 2 FTE
// — you have 3 eligible employees, hold" rather than the abstract
// "Standard role needs 2 FTE".
function RollupStationRow({ station, idealOnly }: { station: AnnualRollupStation; idealOnly: boolean }) {
  const { t } = useI18n();
  const actionTone =
    station.action === 'hire' ? { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', Icon: TrendingUp }
      : { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', Icon: Minus };
  const ActionIcon = actionTone.Icon;
  const actionLabel = station.action === 'hire' ? t('workforce.action.hire') : t('workforce.action.hold');

  return (
    <div className="p-5 hover:bg-slate-50/40 transition-colors">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-base font-bold text-slate-800 tracking-tight">{station.stationName}</h3>
            {station.roleHint && (
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest bg-slate-100 px-1.5 py-0.5 rounded">
                {station.roleHint}
              </span>
            )}
            <div className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded-lg border", actionTone.bg, actionTone.border)}>
              <ActionIcon className={cn("w-3 h-3", actionTone.text)} />
              <span className={cn("text-[9px] font-black uppercase tracking-widest", actionTone.text)}>{actionLabel}</span>
            </div>
          </div>

          <div className={cn("grid gap-3", idealOnly ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-5")}>
            {!idealOnly && (
              <KpiBlock label={t('workforce.station.current')} value={station.currentEligibleCount.toString()} />
            )}
            <KpiBlock label={t('workforce.rollup.recommendedFTE')} value={station.recommendedFTE.toString()} tone="emerald" />
            <KpiBlock label={t('workforce.rollup.recommendedPT')} value={station.recommendedPartTime.toString()} tone="blue" />
            {!idealOnly && (
              <KpiBlock
                label={t('workforce.role.delta')}
                value={`${station.delta > 0 ? '+' : ''}${station.delta}`}
                tone={station.delta > 0 ? 'rose' : 'neutral'}
                hint={station.action === 'hire'
                  ? t('workforce.role.hireBy', { count: station.delta })
                  : t('workforce.role.matchesNeed')}
              />
            )}
            <KpiBlock
              label={t('workforce.rollup.peakMonth')}
              value={MONTH_NAMES[station.peakMonthIndex - 1]}
              hint={`${station.peakMonthFTE} FTE`}
            />
          </div>

          <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-100 flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-700 leading-relaxed">{station.reasoning}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthlyDemandChart({
  months, peakMonthIndex, valleyMonthIndex, activeMonthIndex, onPickMonth,
}: {
  months: MonthlyPlanSummary[];
  peakMonthIndex: number;
  valleyMonthIndex: number;
  activeMonthIndex: number;
  onPickMonth: (idx: number) => void;
}) {
  const max = Math.max(1, ...months.map(m => m.monthlyRequiredHours));
  return (
    <div className="grid grid-cols-12 gap-1.5">
      {months.map(m => {
        const heightPct = Math.max(4, Math.round((m.monthlyRequiredHours / max) * 100));
        const isPeak = m.monthIndex === peakMonthIndex;
        const isValley = m.monthIndex === valleyMonthIndex;
        const isActive = m.monthIndex === activeMonthIndex;
        const tone = isPeak ? 'bg-rose-500'
          : isValley ? 'bg-emerald-500'
          : isActive ? 'bg-blue-500'
          : 'bg-slate-300';
        return (
          <button
            key={m.monthIndex}
            onClick={() => onPickMonth(m.monthIndex)}
            className={cn(
              "flex flex-col items-stretch group transition-all rounded-lg p-1.5",
              isActive ? "bg-blue-50/60" : "hover:bg-slate-50",
            )}
            title={`${m.monthName}: ${Math.round(m.monthlyRequiredHours).toLocaleString()}h required · ${m.recommendedFTE} FTE + ${m.recommendedPartTime} PT`}
          >
            <div className="flex items-end h-24">
              <div
                className={cn("w-full rounded-md transition-all", tone, isActive && "ring-2 ring-blue-500 ring-offset-1")}
                style={{ height: `${heightPct}%` }}
              />
            </div>
            <p className={cn(
              "text-[10px] font-black mt-1.5 text-center uppercase tracking-widest",
              isActive ? "text-blue-700" : "text-slate-600",
            )}>{m.monthName}</p>
            <p className="text-[9px] font-mono text-center text-slate-500 leading-tight">
              {Math.round(m.monthlyRequiredHours).toLocaleString()}h
            </p>
          </button>
        );
      })}
    </div>
  );
}

function KpiBlock({ label, value, tone = 'neutral', hint }: { label: string; value: string; tone?: 'emerald' | 'blue' | 'rose' | 'neutral'; hint?: string }) {
  const valueClass =
    tone === 'emerald' ? 'text-emerald-700'
    : tone === 'blue' ? 'text-blue-700'
    : tone === 'rose' ? 'text-rose-700'
    : 'text-slate-800';
  return (
    <div>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className={cn("text-2xl font-black", valueClass)}>{value}</p>
      {hint && <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">{hint}</p>}
    </div>
  );
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// PDF export. Renders the current rollup + KPI strip into a portrait A4
// document and triggers a download. Uses jspdf + jspdf-autotable (already
// shipped for compliance reports).
async function exportWorkforcePlanToPDF(args: {
  annual: ReturnType<typeof analyzeWorkforceAnnual>;
  rollup: ReturnType<typeof buildAnnualRollup>;
  mode: PlanMode;
  idealOnly: boolean;
  fmtIQD: (n: number) => string;
}) {
  const { annual, rollup, mode, fmtIQD } = args;
  const { jsPDF } = await import('jspdf');
  const autoTableMod = await import('jspdf-autotable');
  // jspdf-autotable v5 ships as `export default` from ESM; the bundler
  // sometimes wraps it in a CJS-style namespace, so accept either shape.
  type AutoTableFn = (doc: InstanceType<typeof jsPDF>, opts: Record<string, unknown>) => void;
  const autoTable = (autoTableMod as unknown as { default: AutoTableFn }).default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Workforce Plan', 14, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Year: ${annual.year}`, 14, 25);
  doc.text(`Mode: ${mode === 'conservative' ? 'Conservative (FTE-only, hire-to-peak)' : 'Optimal (FTE + part-time mix)'}`, 14, 30);
  doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`, 14, 35);

  // Summary KPIs
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Annual Summary', 14, 45);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const summaryLines = [
    `Annual demand: ${Math.round(annual.annualRequiredHours).toLocaleString()} hours`,
    `Current roster: ${rollup.totalCurrentEmployees}`,
    `Recommended roster: ${rollup.totalRecommendedFTE} FTE + ${rollup.totalRecommendedPartTime} part-time`,
    `Peak month: ${annual.byMonth[annual.peakMonthIndex - 1].monthName} (${Math.round(annual.byMonth[annual.peakMonthIndex - 1].monthlyRequiredHours).toLocaleString()}h)`,
    `Valley month: ${annual.byMonth[annual.valleyMonthIndex - 1].monthName} (${Math.round(annual.byMonth[annual.valleyMonthIndex - 1].monthlyRequiredHours).toLocaleString()}h)`,
    `Annual recommended salary: ${fmtIQD(mode === 'conservative' ? rollup.annualConservativeSalary : rollup.annualOptimalSalary)} IQD`,
    mode === 'conservative'
      ? `Legal-safety premium vs optimal: ${fmtIQD(rollup.legalSafetyPremium)} IQD/yr (cost of carrying excess capacity through valleys to avoid releases)`
      : `Note: optimal mode assumes scaling up/down across the year — legally complex under Iraqi Labor Law.`,
  ];
  let cursor = 50;
  summaryLines.forEach(line => { doc.text(line, 14, cursor); cursor += 5; });

  // Per-role rollup table
  cursor += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Per-station Recommendation', 14, cursor);
  cursor += 4;
  autoTable(doc, {
    startY: cursor,
    head: [['Station', 'Role hint', 'Current', 'Rec. FTE', 'Rec. PT', 'Delta', 'Action', 'Peak Month', 'Reasoning']],
    body: rollup.byStation.map(s => [
      s.stationName,
      s.roleHint || '—',
      s.currentEligibleCount.toString(),
      s.recommendedFTE.toString(),
      s.recommendedPartTime.toString(),
      `${s.delta > 0 ? '+' : ''}${s.delta}`,
      s.action.toUpperCase(),
      MONTH_NAMES[s.peakMonthIndex - 1],
      s.reasoning,
    ]),
    headStyles: { fillColor: [15, 23, 42], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 28 }, 1: { cellWidth: 18 }, 2: { cellWidth: 14 }, 3: { cellWidth: 14 }, 4: { cellWidth: 12 },
      5: { cellWidth: 12 }, 6: { cellWidth: 14 }, 7: { cellWidth: 16 }, 8: { cellWidth: 'auto' },
    },
    margin: { left: 14, right: 14 },
    styles: { overflow: 'linebreak' },
  });

  // Monthly demand table
  const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursor + 60;
  cursor = lastY + 8;
  if (cursor > 240) { doc.addPage(); cursor = 18; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Monthly Demand Breakdown', 14, cursor);
  cursor += 4;
  autoTable(doc, {
    startY: cursor,
    head: [['Month', 'Required hrs', 'Rec. FTE', 'Rec. PT', 'Salary (IQD)']],
    body: annual.byMonth.map(m => [
      m.monthName,
      Math.round(m.monthlyRequiredHours).toLocaleString(),
      m.recommendedFTE.toString(),
      m.recommendedPartTime.toString(),
      Math.round(m.recommendedMonthlySalary).toLocaleString(),
    ]),
    headStyles: { fillColor: [37, 99, 235], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Iraqi Labor Scheduler — Workforce Plan ${annual.year}`, 14, 290);
    doc.text(`Page ${i} / ${pageCount}`, 196, 290, { align: 'right' });
  }

  doc.save(`Workforce-Plan-${annual.year}-${mode}.pdf`);
}
