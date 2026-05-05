import React, { useState } from 'react';
import { TrendingDown, ShieldCheck, Crown, ArrowRight, Info, MapPin, FlaskConical, CheckCircle2, AlertTriangle, Loader2, Scale, ChevronDown, ChevronRight } from 'lucide-react';
import { StaffingAdvisory, StaffingMode, StationHire, simulateWithExtraHires, StaffingArgs, SimulationResult } from '../lib/staffingAdvisory';
import { RULE_LABEL_I18N_KEYS, RULE_ARTICLES } from '../lib/fines';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

interface Props {
  advisory: StaffingAdvisory;
  /** Current OT hours — used as the "today" baseline in the headline. */
  currentOTHours: number;
  /** Current monthly OT spend (IQD). */
  currentOTPay: number;
  /** Inputs needed to re-run the simulation when the user clicks Validate. */
  simArgs: StaffingArgs;
}

type ModeKey = 'eliminateOT' | 'optimalCoverage' | 'bestOfBoth';

// Three-tab advisory card on the Dashboard. Lets the supervisor flip between
// hiring strategies, see the headcount + IQD impact of each, and drill into
// the per-station breakdown that explains *where* the new hires would land
// and *why* (OT pressure vs peak-hour shortfall vs both). A Validate button
// runs the auto-scheduler with phantom hires and reports the actual residual
// OT / coverage so the recommendation is a real simulation, not just
// back-of-envelope arithmetic.
export function StaffingAdvisoryCard({ advisory, currentOTHours, currentOTPay, simArgs }: Props) {
  const { t } = useI18n();
  const [activeMode, setActiveMode] = useState<ModeKey>('bestOfBoth');
  const [simulating, setSimulating] = useState(false);
  const [simResults, setSimResults] = useState<Record<ModeKey, SimulationResult | null>>({
    eliminateOT: null, optimalCoverage: null, bestOfBoth: null,
  });
  // v5.17.0 — fines breakdown collapses by default to keep the card
  // compact; supervisors who want the per-rule Pareto can expand it.
  const [finesExpanded, setFinesExpanded] = useState(false);

  const modes: Array<{ key: ModeKey; icon: React.ComponentType<{ className?: string }>; tone: string; data: StaffingMode; titleKey: string; bodyKey: string }> = [
    { key: 'eliminateOT', icon: TrendingDown, tone: 'emerald', data: advisory.eliminateOT, titleKey: 'advisory.mode.eliminateOT.title', bodyKey: 'advisory.mode.eliminateOT.body' },
    { key: 'optimalCoverage', icon: ShieldCheck, tone: 'blue', data: advisory.optimalCoverage, titleKey: 'advisory.mode.optimalCoverage.title', bodyKey: 'advisory.mode.optimalCoverage.body' },
    { key: 'bestOfBoth', icon: Crown, tone: 'indigo', data: advisory.bestOfBoth, titleKey: 'advisory.mode.bestOfBoth.title', bodyKey: 'advisory.mode.bestOfBoth.body' },
  ];

  const active = modes.find(m => m.key === activeMode)!;
  const ActiveIcon = active.icon;
  const fmtIQD = (n: number) => Math.abs(n).toLocaleString();
  const activeSim = simResults[activeMode];

  const runSimulation = () => {
    if (simulating) return;
    setSimulating(true);
    // Run after a paint so the spinner state lands on screen.
    setTimeout(() => {
      try {
        const result = simulateWithExtraHires(simArgs, active.data.perStation);
        setSimResults(prev => ({ ...prev, [activeMode]: result }));
      } finally {
        setSimulating(false);
      }
    }, 0);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
      {/* Mode-tab header */}
      <div className="flex items-stretch border-b border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/40">
        {modes.map(m => {
          const Icon = m.icon;
          const isActive = m.key === activeMode;
          return (
            <button
              key={m.key}
              onClick={() => setActiveMode(m.key)}
              className={cn(
                // v2.1.4 — switched from template-literal class strings to a
                // static lookup. Tailwind v4's source scan can't see
                // `bg-white text-${tone}-700`-style interpolations, so the
                // active-tab tint silently rendered as default slate.
                "flex-1 px-4 py-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all border-b-2",
                isActive && m.tone === 'emerald' && "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-200 border-emerald-500",
                isActive && m.tone === 'blue' && "bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-200 border-blue-500",
                isActive && m.tone === 'indigo' && "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-200 border-indigo-500",
                !isActive && "text-slate-400 dark:text-slate-500 border-transparent hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-900/50",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t(m.titleKey)}</span>
            </button>
          );
        })}
      </div>

      <div className="p-6 space-y-5">
        {/* Active mode summary */}
        <div className="flex items-start gap-4">
          <div className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
            active.tone === 'emerald' && "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
            active.tone === 'blue' && "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200",
            active.tone === 'indigo' && "bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-200",
          )}>
            <ActiveIcon className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('advisory.section.eyebrow')}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight">{t(active.titleKey)}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-1">{t(active.bodyKey)}</p>
          </div>
        </div>

        {/* KPIs for the active mode. v5.17.0 — added Fines Avoided as a
            second emerald savings card so the supervisor sees the
            compliance-risk lever alongside OT savings. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/60 rounded-lg">
            <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('advisory.kpi.hires')}</p>
            <p className={cn(
              "text-2xl font-black mt-1",
              active.tone === 'emerald' && "text-emerald-700 dark:text-emerald-200",
              active.tone === 'blue' && "text-blue-700 dark:text-blue-200",
              active.tone === 'indigo' && "text-indigo-700 dark:text-indigo-200",
            )}>
              +{active.data.hiresNeeded}
            </p>
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100 dark:border-emerald-500/30 rounded-lg">
            <p className="text-[9px] font-black text-emerald-700 dark:text-emerald-200 uppercase tracking-widest">{t('advisory.kpi.otSaved')}</p>
            <p className="text-base font-black text-emerald-700 dark:text-emerald-200 mt-1">{fmtIQD(active.data.monthlyOTSaved)}</p>
            <p className="text-[9px] text-emerald-600 dark:text-emerald-300 font-medium">IQD / mo</p>
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100 dark:border-emerald-500/30 rounded-lg">
            <p className="text-[9px] font-black text-emerald-700 dark:text-emerald-200 uppercase tracking-widest flex items-center gap-1">
              <Scale className="w-2.5 h-2.5" />
              {t('advisory.kpi.finesAvoided')}
            </p>
            <p className="text-base font-black text-emerald-700 dark:text-emerald-200 mt-1">{fmtIQD(active.data.monthlyFinesAvoided)}</p>
            <p className="text-[9px] text-emerald-600 dark:text-emerald-300 font-medium">IQD / mo</p>
          </div>
          <div className="p-3 bg-rose-50 dark:bg-rose-500/15 border border-rose-100 dark:border-rose-500/30 rounded-lg">
            <p className="text-[9px] font-black text-rose-700 dark:text-rose-200 uppercase tracking-widest">{t('advisory.kpi.salaryAdded')}</p>
            <p className="text-base font-black text-rose-700 dark:text-rose-200 mt-1">{fmtIQD(active.data.monthlySalaryAdded)}</p>
            <p className="text-[9px] text-rose-600 dark:text-rose-300 font-medium">IQD / mo</p>
          </div>
        </div>

        {/* Net delta — formula now (otSaved + finesAvoided) - salaryAdded.
            Sign tells the story: positive = the hiring pays for itself
            in OT + fines saved; negative = you pay net to gain compliance
            and coverage. The card tones itself accordingly so a negative
            delta isn't dressed up as a "savings". */}
        <div className={cn(
          "p-4 rounded-xl border flex items-center justify-between",
          active.data.netMonthlyDelta >= 0
            ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/40"
            : "bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/40"
        )}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('advisory.kpi.netMonthly')}</p>
            <p className={cn(
              "text-2xl font-black mt-1",
              active.data.netMonthlyDelta >= 0 ? "text-emerald-700 dark:text-emerald-200" : "text-amber-700 dark:text-amber-200",
            )}>
              {active.data.netMonthlyDelta >= 0 ? '+' : '−'}{fmtIQD(active.data.netMonthlyDelta)} IQD
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
              {t('advisory.kpi.netMonthly.formula')}
            </p>
          </div>
          <ArrowRight className={cn(
            "w-6 h-6",
            active.data.netMonthlyDelta >= 0 ? "text-emerald-500 dark:text-emerald-300" : "text-amber-500 dark:text-amber-300",
          )} />
        </div>

        {/* v5.17.0 — fines exposure breakdown. Collapsible to keep the
            card compact. Pulls `currentPotentialFines` (today's fine
            risk by rule) so the supervisor sees which rule classes are
            generating the most legal-risk exposure. Hidden when there
            are no fines on the table. */}
        {advisory.currentPotentialFines.total > 0 && (
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setFinesExpanded(v => !v)}
              className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
            >
              {finesExpanded ? <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
              <Scale className="w-4 h-4 text-rose-600 dark:text-rose-300" />
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 flex-1 text-start">
                {t('advisory.fines.exposure.title')}
              </span>
              <span className="text-xs font-black text-rose-700 dark:text-rose-200 font-mono">
                {fmtIQD(advisory.currentPotentialFines.total)} IQD
              </span>
            </button>
            {finesExpanded && (
              <div className="p-4 space-y-3 border-t border-slate-200 dark:border-slate-700">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t('advisory.fines.exposure.help')}
                </p>
                <div className="space-y-1.5">
                  {advisory.currentPotentialFines.byRule.map(entry => {
                    const labelKey = RULE_LABEL_I18N_KEYS[entry.ruleKey];
                    const article = RULE_ARTICLES[entry.ruleKey] ?? '';
                    return (
                      <div key={entry.ruleKey} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/40 rounded">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                              {labelKey ? t(labelKey) : entry.ruleKey}
                            </span>
                            {article && (
                              <span className="text-[8px] font-mono font-black text-slate-400 dark:text-slate-500 bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">
                                {article}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                            {t('advisory.fines.exposure.rowDetail', {
                              occ: entry.occurrences,
                              rate: entry.ratePerOccurrence.toLocaleString(),
                            })}
                          </p>
                        </div>
                        <span className="text-xs font-black text-rose-700 dark:text-rose-200 font-mono shrink-0">
                          {fmtIQD(entry.subtotal)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed italic">
                  {t('advisory.fines.exposure.disclaimer')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Per-station breakdown — answers WHERE the hires land and WHY. */}
        {active.data.perStation.length > 0 ? (
          <PerStationList perStation={active.data.perStation} tone={active.tone} />
        ) : (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100 dark:border-emerald-500/30 rounded-xl flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300 shrink-0" />
            <p className="text-xs text-emerald-800 dark:text-emerald-200 font-medium">{t('advisory.perStation.empty')}</p>
          </div>
        )}

        {/* Simulation validation */}
        {active.data.hiresNeeded > 0 && (
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-indigo-600 dark:text-indigo-300" />
                <p className="text-[11px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-widest">{t('advisory.sim.title')}</p>
              </div>
              <button
                onClick={runSimulation}
                disabled={simulating}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5",
                  simulating
                    ? "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-wait"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-sm"
                )}
              >
                {simulating
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> {t('advisory.sim.running')}</>
                  : <>{activeSim ? t('advisory.sim.rerun') : t('advisory.sim.run')}</>
                }
              </button>
            </div>
            {activeSim ? <SimulationReadout result={activeSim} currentFines={advisory.currentPotentialFines.total} /> : (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t('advisory.sim.helper')}</p>
            )}
          </div>
        )}

        {/* Footnote */}
        <div className="flex items-start gap-2 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          <p>
            {t('advisory.footnote', {
              ot: currentOTHours.toFixed(0),
              spend: currentOTPay.toLocaleString(),
              avg: advisory.avgMonthlySalary.toLocaleString(),
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

// Per-station hire breakdown. Each row shows where one or more new hires
// would land, the reason (OT pressure, peak shortfall, or both), and the
// numerical evidence (monthly OT hours attributed to the station + the
// peak-hour FTE gap).
function PerStationList({ perStation, tone }: { perStation: StationHire[]; tone: string }) {
  const { t } = useI18n();
  const reasonLabel = (reason: StationHire['reason']) => {
    if (reason === 'both') return t('advisory.perStation.reason.both');
    if (reason === 'ot') return t('advisory.perStation.reason.ot');
    return t('advisory.perStation.reason.gap');
  };
  const reasonClass = (reason: StationHire['reason']) =>
    reason === 'both' ? 'text-amber-700 dark:text-amber-200 bg-amber-100 dark:bg-amber-500/25'
      : reason === 'ot' ? 'text-rose-700 dark:text-rose-200 bg-rose-100 dark:bg-rose-500/25'
        : 'text-blue-700 dark:text-blue-200 bg-blue-100 dark:bg-blue-500/25';
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
        <MapPin className="w-3 h-3" /> {t('advisory.perStation.header')}
      </p>
      <div className="space-y-1.5">
        {perStation.map(p => (
          <div key={p.stationId} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/60">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{p.stationName}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest", reasonClass(p.reason))}>
                  {reasonLabel(p.reason)}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                  {p.otHours > 0 && t('advisory.perStation.evidenceOt', { hrs: p.otHours.toFixed(1) })}
                  {p.otHours > 0 && p.coverageGap > 0 && ' · '}
                  {p.coverageGap > 0 && t('advisory.perStation.evidenceGap', { gap: p.coverageGap })}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className={cn(
                "text-2xl font-black leading-none",
                tone === 'emerald' && "text-emerald-700 dark:text-emerald-200",
                tone === 'blue' && "text-blue-700 dark:text-blue-200",
                tone === 'indigo' && "text-indigo-700 dark:text-indigo-200",
              )}>+{p.hires}</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-0.5">{t('advisory.perStation.toHire')}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimulationReadout({ result, currentFines }: { result: SimulationResult; currentFines: number }) {
  const { t } = useI18n();
  const fmtIQD = (n: number) => Math.abs(n).toLocaleString();
  // Hires can absorb over-cap OT and close coverage gaps; they CANNOT
  // eliminate holiday-premium hours (someone has to work each holiday). So
  // "clean" means cap-respected + every station covered + zero remaining
  // hard violations. Holiday hours are reported separately so the
  // supervisor sees that the residual premium pay is structural, not a
  // hiring problem.
  const isClean =
    result.remainingOTHours < 1 &&
    result.remainingCoverageGapDays === 0 &&
    result.remainingViolations === 0;
  // v5.17.0 — measured fine reduction. Positive = the simulation reduced
  // the legal-risk exposure; zero = no change; negative shouldn't happen
  // (hiring more rarely INCREASES fines, but defensively handle the
  // edge case where a phantom triggers a fresh violation we didn't have
  // before).
  const finesDelta = currentFines - result.remainingFines;
  return (
    <div className="space-y-2">
      <div className={cn(
        "flex items-center gap-2 p-2.5 rounded-lg border",
        isClean ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-200" : "bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-200",
      )}>
        {isClean ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
        <p className="text-[11px] font-bold leading-tight">
          {isClean
            ? t('advisory.sim.clean', { hires: result.phantomHires })
            : t('advisory.sim.partial', { hires: result.phantomHires })}
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <SimStat label={t('advisory.sim.remainingOT')} value={`${result.remainingOTHours.toFixed(0)}h`} ok={result.remainingOTHours < 1} />
        <SimStat label={t('advisory.sim.remainingGap')} value={result.remainingCoverageGapDays.toString()} ok={result.remainingCoverageGapDays === 0} />
        <SimStat label={t('advisory.sim.remainingViolations')} value={result.remainingViolations.toString()} ok={result.remainingViolations === 0} />
        <SimStat label={t('advisory.sim.remainingFines')} value={`${fmtIQD(result.remainingFines)} IQD`} ok={result.remainingFines === 0} />
        <SimStat label={t('advisory.sim.remainingHoliday')} value={`${result.remainingHolidayHours.toFixed(0)}h`} ok={false} hint />
        <SimStat label={t('advisory.sim.scheduled')} value={result.scheduledShifts.toString()} ok />
      </div>
      {/* v5.17.0 — measured fine-reduction headline. Surfaces only when
          there's a non-trivial change so the panel doesn't add noise on
          a clean baseline. */}
      {currentFines > 0 && finesDelta !== 0 && (
        <div className={cn(
          "p-2.5 rounded-lg border text-[11px] font-bold leading-tight",
          finesDelta > 0
            ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-200"
            : "bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-200",
        )}>
          {finesDelta > 0
            ? t('advisory.sim.finesReduced', { amount: fmtIQD(finesDelta), pct: Math.round((finesDelta / currentFines) * 100) })
            : t('advisory.sim.finesIncreased', { amount: fmtIQD(-finesDelta) })}
        </div>
      )}
      {result.remainingHolidayHours > 0 && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed pt-1">{t('advisory.sim.holidayCaveat')}</p>
      )}
    </div>
  );
}

function SimStat({ label, value, ok, hint }: { label: string; value: string; ok: boolean; hint?: boolean }) {
  return (
    <div className={cn(
      "p-2 rounded-lg border text-center",
      hint ? "bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-700/60" : ok ? "bg-white dark:bg-slate-900 border-emerald-100 dark:border-emerald-500/30" : "bg-white dark:bg-slate-900 border-amber-100 dark:border-amber-500/30",
    )}>
      <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</p>
      <p className={cn(
        "text-base font-black mt-0.5",
        hint ? "text-slate-700 dark:text-slate-200" : ok ? "text-emerald-700 dark:text-emerald-200" : "text-amber-700 dark:text-amber-200",
      )}>{value}</p>
    </div>
  );
}
