import React, { useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, TrendingUp, AlertTriangle, Calendar as CalendarIcon,
  Users, MapPin, Clock, Lightbulb, Sparkles, Info,
} from 'lucide-react';
import { format } from 'date-fns';
import { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../types';
import { Card } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { analyzeOT, suggestMitigations, OTMitigation } from '../lib/otAnalysis';

interface Props {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  schedule: Schedule;
  prevMonth: () => void;
  nextMonth: () => void;
  onGoToRoster: () => void;
  onGoToSchedule: () => void;
}

// Coverage & OT Analysis tab — answers "why do we have OT, where is it being
// spent, and how do we mitigate it?". Splits the monthly OT spend into the
// two pools that drive premium pay (over-cap vs holiday-premium), attributes
// each pool to specific stations, and ranks the employees burning the most.
//
// The dashboard's StaffingAdvisoryCard answers "how many to hire"; this tab
// answers "what is the OT money actually buying us?". Both pull from the
// same `analyzeOT` helper so they never disagree on the totals.
export function CoverageOTAnalysisTab(props: Props) {
  const {
    employees, shifts, stations, holidays, config, schedule,
    prevMonth, nextMonth, onGoToRoster, onGoToSchedule,
  } = props;
  const { t } = useI18n();

  const analysis = useMemo(
    () => analyzeOT(employees, schedule, shifts, stations, holidays, config),
    [employees, schedule, shifts, stations, holidays, config],
  );

  const avgMonthlySalary = useMemo(() => {
    if (employees.length === 0) return 1_500_000;
    return Math.round(employees.reduce((s, e) => s + (e.baseMonthlySalary || 0), 0) / employees.length);
  }, [employees]);

  const mitigations = useMemo(
    () => suggestMitigations(analysis, avgMonthlySalary),
    [analysis, avgMonthlySalary],
  );

  const fmtIQD = (n: number) => Math.round(Math.abs(n)).toLocaleString();
  const overCapPct = analysis.totalOTPay > 0 ? Math.round((analysis.totalOverCapPay / analysis.totalOTPay) * 100) : 0;
  const holidayPct = analysis.totalOTPay > 0 ? Math.round((analysis.totalHolidayPay / analysis.totalOTPay) * 100) : 0;

  // Empty-state when no schedule or roster — same gating logic the
  // Compliance dashboard uses, just with a focused message.
  const hasAnalysis = employees.length > 0 && Object.keys(schedule).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
          <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors" aria-label={t('action.prevMonth')}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center px-4 w-40 font-mono">
            <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">{config.year}</p>
            <p className="text-xl font-black text-slate-800 tracking-tighter uppercase whitespace-nowrap">
              {format(new Date(config.year, config.month - 1, 1), 'MMMM')}
            </p>
          </div>
          <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors" aria-label={t('action.nextMonth')}>
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('otAnalysis.eyebrow')}</p>
        </div>
      </div>

      {!hasAnalysis ? (
        <Card className="p-10 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
            <TrendingUp className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-700">{t('otAnalysis.empty.title')}</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">{t('otAnalysis.empty.body')}</p>
          <div className="flex justify-center gap-2 pt-2">
            <button onClick={onGoToRoster} className="px-5 py-2 bg-slate-900 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-slate-800">
              {t('otAnalysis.empty.toRoster')}
            </button>
            <button onClick={onGoToSchedule} className="px-5 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-slate-50">
              {t('otAnalysis.empty.toSchedule')}
            </button>
          </div>
        </Card>
      ) : analysis.totalOTPay === 0 ? (
        <Card className="p-8 text-center space-y-3 bg-emerald-50/40 border-emerald-200">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <Sparkles className="w-7 h-7 text-emerald-700" />
          </div>
          <h3 className="text-lg font-bold text-emerald-800">{t('otAnalysis.cleanRun.title')}</h3>
          <p className="text-sm text-emerald-700 max-w-md mx-auto leading-relaxed">{t('otAnalysis.cleanRun.body')}</p>
        </Card>
      ) : (
        <>
          {/* ── Top KPI strip ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-5 bg-slate-900 text-white border-0 shadow-xl">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-300 mb-2">{t('otAnalysis.kpi.totalOT')}</p>
              <p className="text-3xl font-black tracking-tight">{fmtIQD(analysis.totalOTPay)}</p>
              <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">IQD / mo</p>
            </Card>
            <Card className="p-5 bg-rose-50/70 border-rose-200">
              <p className="text-[10px] font-black uppercase tracking-widest text-rose-700 mb-2">{t('otAnalysis.kpi.overCapPay')}</p>
              <p className="text-2xl font-black text-rose-700 tracking-tight">{fmtIQD(analysis.totalOverCapPay)}</p>
              <p className="text-[10px] font-bold text-rose-600 mt-1">{analysis.totalOverCapHours.toFixed(0)}h · {overCapPct}% {t('otAnalysis.kpi.ofTotal')}</p>
            </Card>
            <Card className="p-5 bg-amber-50/70 border-amber-200">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2">{t('otAnalysis.kpi.holidayPay')}</p>
              <p className="text-2xl font-black text-amber-700 tracking-tight">{fmtIQD(analysis.totalHolidayPay)}</p>
              <p className="text-[10px] font-bold text-amber-600 mt-1">{analysis.totalHolidayHours}h · {holidayPct}% {t('otAnalysis.kpi.ofTotal')}</p>
            </Card>
            <Card className="p-5 bg-blue-50/70 border-blue-200">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 mb-2">{t('otAnalysis.kpi.holidaysWorked')}</p>
              <p className="text-2xl font-black text-blue-700 tracking-tight">{analysis.holidaysThisMonth.length}</p>
              <p className="text-[10px] font-bold text-blue-600 mt-1 uppercase tracking-wider">{t('otAnalysis.kpi.holidaysSub')}</p>
            </Card>
          </div>

          {/* ── Why we have OT this month ─────────────────────────────── */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-600" /> {t('otAnalysis.why.title')}
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{t('otAnalysis.why.body', { cap: analysis.cap })}</p>
            {/* Stacked bar */}
            <div className="space-y-1.5">
              <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex">
                <div className="h-full bg-rose-500" style={{ width: `${overCapPct}%` }} />
                <div className="h-full bg-amber-500" style={{ width: `${holidayPct}%` }} />
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-rose-500 rounded-sm" /> {t('otAnalysis.why.overCapLegend', { hrs: analysis.totalOverCapHours.toFixed(1) })}</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-amber-500 rounded-sm" /> {t('otAnalysis.why.holidayLegend', { hrs: analysis.totalHolidayHours })}</span>
              </div>
            </div>
            {analysis.holidaysThisMonth.length > 0 && (
              <div className="pt-2 border-t border-slate-100">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <CalendarIcon className="w-3 h-3" /> {t('otAnalysis.why.holidaysHeader')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.holidaysThisMonth.map(h => (
                    <span key={h.date} className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-amber-50 border border-amber-100 text-[10px]">
                      <span className="font-mono font-bold text-amber-700">{h.date.slice(8, 10)}</span>
                      <span className="font-medium text-slate-700">{h.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* ── Per-station OT spend ──────────────────────────────────── */}
          {analysis.byStation.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600" /> {t('otAnalysis.byStation.title')}
                </h3>
                <p className="text-[10px] text-slate-500 mt-1">{t('otAnalysis.byStation.subtitle')}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {analysis.byStation.map(st => {
                  const stOverCapPct = st.totalOTPay > 0 ? (st.overCapPay / st.totalOTPay) * 100 : 0;
                  const stHolidayPct = st.totalOTPay > 0 ? (st.holidayPay / st.totalOTPay) * 100 : 0;
                  return (
                    <div key={st.stationId} className="p-4 hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-800">{st.stationName}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {t('otAnalysis.byStation.contributors', { n: st.contributors })} · {st.totalHours.toFixed(0)}h {t('otAnalysis.byStation.totalHours')}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-black text-slate-900 leading-none">{fmtIQD(st.totalOTPay)}</p>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">IQD / mo</p>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                        <div className="h-full bg-rose-500" style={{ width: `${stOverCapPct}%` }} />
                        <div className="h-full bg-amber-500" style={{ width: `${stHolidayPct}%` }} />
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500 font-medium">
                        {st.overCapHours > 0 && (
                          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-rose-500 rounded-sm" /> {st.overCapHours.toFixed(1)}h · {fmtIQD(st.overCapPay)}</span>
                        )}
                        {st.holidayHours > 0 && (
                          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-amber-500 rounded-sm" /> {st.holidayHours}h · {fmtIQD(st.holidayPay)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── Per-employee OT burners ───────────────────────────────── */}
          {analysis.byEmployee.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" /> {t('otAnalysis.byEmployee.title')}
                </h3>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{analysis.byEmployee.length} {t('otAnalysis.byEmployee.count')}</span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
                {analysis.byEmployee.slice(0, 20).map(emp => {
                  const overCapColor = emp.payableOverCapHours > 0 ? 'text-rose-700' : 'text-slate-300';
                  const holidayColor = emp.holidayHours > 0 ? 'text-amber-700' : 'text-slate-300';
                  return (
                    <div key={emp.empId} className="p-3 px-4 hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-800 truncate">{emp.empName}</p>
                          <p className="text-[10px] text-slate-500 font-mono">{emp.empId} · {emp.totalHours.toFixed(0)}h / {emp.cap}h cap</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 shrink-0 text-right">
                          <div>
                            <p className={cn("text-sm font-black", overCapColor)}>{emp.payableOverCapHours.toFixed(1)}h</p>
                            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{t('otAnalysis.byEmployee.overCap')}</p>
                          </div>
                          <div>
                            <p className={cn("text-sm font-black", holidayColor)}>{emp.holidayHours}h</p>
                            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{t('otAnalysis.byEmployee.holiday')}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 w-24">
                          <p className="text-sm font-black text-slate-900">{fmtIQD(emp.totalOTPay)}</p>
                          <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">IQD</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {analysis.byEmployee.length > 20 && (
                  <div className="px-4 py-3 text-[10px] text-slate-500 italic text-center">
                    {t('otAnalysis.byEmployee.more', { extra: analysis.byEmployee.length - 20 })}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Mitigations ───────────────────────────────────────────── */}
          {mitigations.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-600" /> {t('otAnalysis.mitigations.title')}
                </h3>
                <p className="text-[10px] text-slate-500 mt-1">{t('otAnalysis.mitigations.subtitle')}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {mitigations.map(m => (
                  <MitigationRow key={m.id} m={m} avgSalary={avgMonthlySalary} onGoToSchedule={onGoToSchedule} />
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function MitigationRow({ m, avgSalary, onGoToSchedule }: { m: OTMitigation; avgSalary: number; onGoToSchedule: () => void }) {
  const { t } = useI18n();
  const fmtIQD = (n: number) => Math.round(Math.abs(n)).toLocaleString();
  const labels: Record<OTMitigation['id'], { title: string; body: string; cta: string; tone: 'rose' | 'amber' | 'blue' }> = {
    'hire-overcap': {
      title: t('otAnalysis.mitigations.hire.title', { count: m.count }),
      body: t('otAnalysis.mitigations.hire.body', { cost: fmtIQD(m.count * avgSalary) }),
      cta: t('otAnalysis.mitigations.hire.cta'),
      tone: 'rose',
    },
    'comp-day-holiday': {
      title: t('otAnalysis.mitigations.compDay.title', { count: m.count }),
      body: t('otAnalysis.mitigations.compDay.body'),
      cta: t('otAnalysis.mitigations.compDay.cta'),
      tone: 'amber',
    },
    'rebalance': {
      title: t('otAnalysis.mitigations.rebalance.title'),
      body: t('otAnalysis.mitigations.rebalance.body'),
      cta: t('otAnalysis.mitigations.rebalance.cta'),
      tone: 'blue',
    },
  };
  const cfg = labels[m.id];
  const toneClass =
    cfg.tone === 'rose' ? 'bg-rose-50 text-rose-700 border-rose-200'
      : cfg.tone === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-blue-50 text-blue-700 border-blue-200';
  return (
    <div className="p-4 flex items-start gap-4">
      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border", toneClass)}>
        <Clock className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-800">{cfg.title}</p>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{cfg.body}</p>
        {m.estimatedSavings !== 0 && (
          <p className="text-[11px] font-black mt-1.5 text-emerald-700">
            {t('otAnalysis.mitigations.estSavings', { amount: fmtIQD(m.estimatedSavings) })}
          </p>
        )}
      </div>
      {m.id === 'rebalance' && (
        <button onClick={onGoToSchedule} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shrink-0">
          {cfg.cta}
        </button>
      )}
    </div>
  );
}
