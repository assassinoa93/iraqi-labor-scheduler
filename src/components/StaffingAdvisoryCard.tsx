import React, { useState } from 'react';
import { TrendingDown, ShieldCheck, Crown, ArrowRight, Info, MapPin, FlaskConical, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { StaffingAdvisory, StaffingMode, StationHire, simulateWithExtraHires, StaffingArgs, SimulationResult } from '../lib/staffingAdvisory';
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
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Mode-tab header */}
      <div className="flex items-stretch border-b border-slate-100 bg-slate-50">
        {modes.map(m => {
          const Icon = m.icon;
          const isActive = m.key === activeMode;
          return (
            <button
              key={m.key}
              onClick={() => setActiveMode(m.key)}
              className={cn(
                "flex-1 px-4 py-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all border-b-2",
                isActive
                  ? `bg-white text-${m.tone}-700 border-${m.tone}-500`
                  : "text-slate-400 border-transparent hover:text-slate-700 hover:bg-white/50"
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
            active.tone === 'emerald' && "bg-emerald-50 text-emerald-700",
            active.tone === 'blue' && "bg-blue-50 text-blue-700",
            active.tone === 'indigo' && "bg-indigo-50 text-indigo-700",
          )}>
            <ActiveIcon className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('advisory.section.eyebrow')}</p>
            <h3 className="text-lg font-bold text-slate-800 tracking-tight">{t(active.titleKey)}</h3>
            <p className="text-xs text-slate-500 leading-relaxed mt-1">{t(active.bodyKey)}</p>
          </div>
        </div>

        {/* KPIs for the active mode */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{t('advisory.kpi.hires')}</p>
            <p className={cn(
              "text-2xl font-black mt-1",
              active.tone === 'emerald' && "text-emerald-700",
              active.tone === 'blue' && "text-blue-700",
              active.tone === 'indigo' && "text-indigo-700",
            )}>
              +{active.data.hiresNeeded}
            </p>
          </div>
          <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
            <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">{t('advisory.kpi.otSaved')}</p>
            <p className="text-base font-black text-emerald-700 mt-1">{fmtIQD(active.data.monthlyOTSaved)}</p>
            <p className="text-[9px] text-emerald-600 font-medium">IQD / mo</p>
          </div>
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg">
            <p className="text-[9px] font-black text-rose-700 uppercase tracking-widest">{t('advisory.kpi.salaryAdded')}</p>
            <p className="text-base font-black text-rose-700 mt-1">{fmtIQD(active.data.monthlySalaryAdded)}</p>
            <p className="text-[9px] text-rose-600 font-medium">IQD / mo</p>
          </div>
        </div>

        {/* Net delta */}
        <div className={cn(
          "p-4 rounded-xl border flex items-center justify-between",
          active.data.netMonthlyDelta >= 0
            ? "bg-emerald-50 border-emerald-200"
            : "bg-amber-50 border-amber-200"
        )}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('advisory.kpi.netMonthly')}</p>
            <p className={cn(
              "text-2xl font-black mt-1",
              active.data.netMonthlyDelta >= 0 ? "text-emerald-700" : "text-amber-700",
            )}>
              {active.data.netMonthlyDelta >= 0 ? '+' : '−'}{fmtIQD(active.data.netMonthlyDelta)} IQD
            </p>
          </div>
          <ArrowRight className={cn(
            "w-6 h-6",
            active.data.netMonthlyDelta >= 0 ? "text-emerald-500" : "text-amber-500",
          )} />
        </div>

        {/* Per-station breakdown — answers WHERE the hires land and WHY. */}
        {active.data.perStation.length > 0 ? (
          <PerStationList perStation={active.data.perStation} tone={active.tone} />
        ) : (
          <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-xs text-emerald-800 font-medium">{t('advisory.perStation.empty')}</p>
          </div>
        )}

        {/* Simulation validation */}
        {active.data.hiresNeeded > 0 && (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-indigo-600" />
                <p className="text-[11px] font-black text-slate-700 uppercase tracking-widest">{t('advisory.sim.title')}</p>
              </div>
              <button
                onClick={runSimulation}
                disabled={simulating}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5",
                  simulating
                    ? "bg-slate-200 text-slate-500 cursor-wait"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-sm"
                )}
              >
                {simulating
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> {t('advisory.sim.running')}</>
                  : <>{activeSim ? t('advisory.sim.rerun') : t('advisory.sim.run')}</>
                }
              </button>
            </div>
            {activeSim ? <SimulationReadout result={activeSim} /> : (
              <p className="text-[11px] text-slate-500 leading-relaxed">{t('advisory.sim.helper')}</p>
            )}
          </div>
        )}

        {/* Footnote */}
        <div className="flex items-start gap-2 text-[10px] text-slate-500 leading-relaxed">
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
    reason === 'both' ? 'text-amber-700 bg-amber-100'
      : reason === 'ot' ? 'text-rose-700 bg-rose-100'
        : 'text-blue-700 bg-blue-100';
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
        <MapPin className="w-3 h-3" /> {t('advisory.perStation.header')}
      </p>
      <div className="space-y-1.5">
        {perStation.map(p => (
          <div key={p.stationId} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800 truncate">{p.stationName}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest", reasonClass(p.reason))}>
                  {reasonLabel(p.reason)}
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  {p.otHours > 0 && t('advisory.perStation.evidenceOt', { hrs: p.otHours.toFixed(1) })}
                  {p.otHours > 0 && p.coverageGap > 0 && ' · '}
                  {p.coverageGap > 0 && t('advisory.perStation.evidenceGap', { gap: p.coverageGap })}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className={cn(
                "text-2xl font-black leading-none",
                tone === 'emerald' && "text-emerald-700",
                tone === 'blue' && "text-blue-700",
                tone === 'indigo' && "text-indigo-700",
              )}>+{p.hires}</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mt-0.5">{t('advisory.perStation.toHire')}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimulationReadout({ result }: { result: SimulationResult }) {
  const { t } = useI18n();
  const isClean = result.remainingOTHours < 1 && result.remainingCoverageGapDays === 0;
  return (
    <div className="space-y-2">
      <div className={cn(
        "flex items-center gap-2 p-2.5 rounded-lg border",
        isClean ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800",
      )}>
        {isClean ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
        <p className="text-[11px] font-bold leading-tight">
          {isClean
            ? t('advisory.sim.clean', { hires: result.phantomHires })
            : t('advisory.sim.partial', { hires: result.phantomHires })}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SimStat label={t('advisory.sim.remainingOT')} value={`${result.remainingOTHours.toFixed(0)}h`} ok={result.remainingOTHours < 1} />
        <SimStat label={t('advisory.sim.remainingGap')} value={result.remainingCoverageGapDays.toString()} ok={result.remainingCoverageGapDays === 0} />
        <SimStat label={t('advisory.sim.scheduled')} value={result.scheduledShifts.toString()} ok />
      </div>
    </div>
  );
}

function SimStat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={cn(
      "p-2 rounded-lg border text-center",
      ok ? "bg-white border-emerald-100" : "bg-white border-amber-100",
    )}>
      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      <p className={cn("text-base font-black mt-0.5", ok ? "text-emerald-700" : "text-amber-700")}>{value}</p>
    </div>
  );
}
