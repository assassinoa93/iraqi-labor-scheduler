import React, { useMemo, useState } from 'react';
import {
  TrendingUp, Calendar as CalendarIcon,
  Users, MapPin, Clock, Lightbulb, Sparkles, Info,
} from 'lucide-react';
import { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../types';
import { Card, MonthYearPicker } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { analyzeOT, suggestMitigations, OTMitigation } from '../lib/otAnalysis';
import { EmployeeOTDetailModal } from '../components/EmployeeOTDetailModal';

interface Props {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  schedule: Schedule;
  // v2.1.1 — full schedule map so the Art. 74 comp-window check sees
  // next-month CP/OFF days for late-month holidays.
  allSchedules?: Record<string, Schedule>;
  prevMonth: () => void;
  nextMonth: () => void;
  setActiveMonth: (year: number, month: number) => void;
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
    employees, shifts, stations, holidays, config, schedule, allSchedules,
    prevMonth, nextMonth, setActiveMonth, onGoToRoster, onGoToSchedule,
  } = props;
  const { t } = useI18n();

  const analysis = useMemo(
    () => analyzeOT(employees, schedule, shifts, stations, holidays, config, allSchedules),
    [employees, schedule, shifts, stations, holidays, config, allSchedules],
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

  // v5.6.0 — per-employee OT detail modal. Clicking a "Who burned the OT"
  // row drills into a per-day breakdown with the cap-crossing day flagged
  // and the holiday/comp-day status visible per row, so the supervisor can
  // answer "was this OT because they worked a holiday or because they went
  // over their monthly cap?" without flipping back to the schedule grid.
  const [drillEmpId, setDrillEmpId] = useState<string | null>(null);
  const drillEmp = useMemo(() => employees.find(e => e.empId === drillEmpId) || null, [employees, drillEmpId]);
  const drillRow = useMemo(() => analysis.byEmployee.find(e => e.empId === drillEmpId), [analysis, drillEmpId]);
  const stationNameById = useMemo(() => new Map(stations.map(s => [s.id, s.name])), [stations]);
  const holidayPct = analysis.totalOTPay > 0 ? Math.round((analysis.totalHolidayPay / analysis.totalOTPay) * 100) : 0;

  // Empty-state when no schedule or roster — same gating logic the
  // Compliance dashboard uses, just with a focused message.
  const hasAnalysis = employees.length > 0 && Object.keys(schedule).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-center justify-between gap-4 mb-2">
        <MonthYearPicker
          year={config.year}
          month={config.month}
          onChange={setActiveMonth}
          onPrev={prevMonth}
          onNext={nextMonth}
        />
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('otAnalysis.eyebrow')}</p>
        </div>
      </div>

      {!hasAnalysis ? (
        <Card className="p-10 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto">
            <TrendingUp className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200">{t('otAnalysis.empty.title')}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">{t('otAnalysis.empty.body')}</p>
          <div className="flex justify-center gap-2 pt-2">
            <button onClick={onGoToRoster} className="px-5 py-2 bg-slate-900 dark:bg-slate-700 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-slate-800 dark:hover:bg-slate-600">
              {t('otAnalysis.empty.toRoster')}
            </button>
            <button onClick={onGoToSchedule} className="px-5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800/60">
              {t('otAnalysis.empty.toSchedule')}
            </button>
          </div>
        </Card>
      ) : analysis.totalOTPay === 0 ? (
        <Card className="p-8 text-center space-y-3 bg-emerald-50/40 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/40">
          <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-500/25 rounded-full flex items-center justify-center mx-auto">
            <Sparkles className="w-7 h-7 text-emerald-700 dark:text-emerald-200" />
          </div>
          <h3 className="text-lg font-bold text-emerald-800 dark:text-emerald-200">{t('otAnalysis.cleanRun.title')}</h3>
          <p className="text-sm text-emerald-700 dark:text-emerald-200 max-w-md mx-auto leading-relaxed">{t('otAnalysis.cleanRun.body')}</p>
        </Card>
      ) : (
        <>
          {/* ── Top KPI strip ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-5 bg-slate-900 dark:bg-slate-800 text-white border-0 shadow-xl">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-300 mb-2">{t('otAnalysis.kpi.totalOT')}</p>
              <p className="text-3xl font-black tracking-tight">{fmtIQD(analysis.totalOTPay)}</p>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mt-1 uppercase tracking-wider">IQD / mo</p>
            </Card>
            <Card className="p-5 bg-rose-50/70 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/40">
              <p className="text-[10px] font-black uppercase tracking-widest text-rose-700 dark:text-rose-200 mb-2">{t('otAnalysis.kpi.overCapPay')}</p>
              <p className="text-2xl font-black text-rose-700 dark:text-rose-200 tracking-tight">{fmtIQD(analysis.totalOverCapPay)}</p>
              <p className="text-[10px] font-bold text-rose-600 dark:text-rose-300 mt-1">{analysis.totalOverCapHours.toFixed(0)}h · {overCapPct}% {t('otAnalysis.kpi.ofTotal')}</p>
            </Card>
            <Card className="p-5 bg-amber-50/70 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/40">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-200 mb-2">{t('otAnalysis.kpi.holidayPay')}</p>
              <p className="text-2xl font-black text-amber-700 dark:text-amber-200 tracking-tight">{fmtIQD(analysis.totalHolidayPay)}</p>
              <p className="text-[10px] font-bold text-amber-600 dark:text-amber-300 mt-1">{analysis.totalHolidayHours}h · {holidayPct}% {t('otAnalysis.kpi.ofTotal')}</p>
            </Card>
            <Card className="p-5 bg-blue-50/70 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/40">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-200 mb-2">{t('otAnalysis.kpi.holidaysWorked')}</p>
              <p className="text-2xl font-black text-blue-700 dark:text-blue-200 tracking-tight">{analysis.holidaysThisMonth.length}</p>
              <p className="text-[10px] font-bold text-blue-600 dark:text-blue-300 mt-1 uppercase tracking-wider">{t('otAnalysis.kpi.holidaysSub')}</p>
            </Card>
          </div>

          {/* ── Why we have OT this month ─────────────────────────────── */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-300" /> {t('otAnalysis.why.title')}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{t('otAnalysis.why.body', { cap: analysis.cap })}</p>
            {/* Stacked bar */}
            <div className="space-y-1.5">
              <div className="h-4 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                <div className="h-full bg-rose-500" style={{ width: `${overCapPct}%` }} />
                <div className="h-full bg-amber-500" style={{ width: `${holidayPct}%` }} />
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-rose-500 rounded-sm" /> {t('otAnalysis.why.overCapLegend', { hrs: analysis.totalOverCapHours.toFixed(1) })}</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-amber-500 rounded-sm" /> {t('otAnalysis.why.holidayLegend', { hrs: analysis.totalHolidayHours })}</span>
              </div>
            </div>
            {analysis.holidaysThisMonth.length > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60">
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <CalendarIcon className="w-3 h-3" /> {t('otAnalysis.why.holidaysHeader')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.holidaysThisMonth.map(h => (
                    <span key={h.id ?? h.date} className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-amber-50 dark:bg-amber-500/15 border border-amber-100 dark:border-amber-500/30 text-[10px]">
                      <span className="font-mono font-bold text-amber-700 dark:text-amber-200">{h.date.slice(8, 10)}</span>
                      <span className="font-medium text-slate-700 dark:text-slate-200">{h.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* ── Per-station OT spend ──────────────────────────────────── */}
          {analysis.byStation.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600 dark:text-blue-300" /> {t('otAnalysis.byStation.title')}
                </h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{t('otAnalysis.byStation.subtitle')}</p>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {analysis.byStation.map(st => {
                  const stOverCapPct = st.totalOTPay > 0 ? (st.overCapPay / st.totalOTPay) * 100 : 0;
                  const stHolidayPct = st.totalOTPay > 0 ? (st.holidayPay / st.totalOTPay) * 100 : 0;
                  return (
                    <div key={st.stationId} className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{st.stationName}</p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {t('otAnalysis.byStation.contributors', { n: st.contributors })} · {st.totalHours.toFixed(0)}h {t('otAnalysis.byStation.totalHours')}
                          </p>
                        </div>
                        <div className="text-end shrink-0">
                          <p className="text-lg font-black text-slate-900 dark:text-slate-50 leading-none">{fmtIQD(st.totalOTPay)}</p>
                          <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">IQD / mo</p>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                        <div className="h-full bg-rose-500" style={{ width: `${stOverCapPct}%` }} />
                        <div className="h-full bg-amber-500" style={{ width: `${stHolidayPct}%` }} />
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
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
              <div className="p-4 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600 dark:text-blue-300" /> {t('otAnalysis.byEmployee.title')}
                </h3>
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{analysis.byEmployee.length} {t('otAnalysis.byEmployee.count')}</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60 max-h-[400px] overflow-y-auto">
                {analysis.byEmployee.slice(0, 20).map(emp => {
                  const overCapColor = emp.payableOverCapHours > 0 ? 'text-rose-700 dark:text-rose-200' : 'text-slate-300 dark:text-slate-600';
                  const holidayColor = emp.holidayHours > 0 ? 'text-amber-700 dark:text-amber-200' : 'text-slate-300 dark:text-slate-600';
                  return (
                    <button
                      key={emp.empId}
                      type="button"
                      onClick={() => setDrillEmpId(emp.empId)}
                      title={t('otAnalysis.byEmployee.drillHint')}
                      className="w-full text-start p-3 px-4 hover:bg-blue-50/40 dark:hover:bg-blue-500/10 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500/40 focus:ring-inset"
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{emp.empName}</p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{emp.empId} · {emp.totalHours.toFixed(0)}h / {emp.cap}h cap</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 shrink-0 text-end">
                          <div>
                            <p className={cn("text-sm font-black", overCapColor)}>{emp.payableOverCapHours.toFixed(1)}h</p>
                            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{t('otAnalysis.byEmployee.overCap')}</p>
                          </div>
                          <div>
                            <p className={cn("text-sm font-black", holidayColor)}>{emp.holidayHours}h</p>
                            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{t('otAnalysis.byEmployee.holiday')}</p>
                          </div>
                        </div>
                        <div className="text-end shrink-0 w-24">
                          <p className="text-sm font-black text-slate-900 dark:text-slate-50">{fmtIQD(emp.totalOTPay)}</p>
                          <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">IQD</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {analysis.byEmployee.length > 20 && (
                  <div className="px-4 py-3 text-[10px] text-slate-500 dark:text-slate-400 italic text-center">
                    {t('otAnalysis.byEmployee.more', { extra: analysis.byEmployee.length - 20 })}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Mitigations ───────────────────────────────────────────── */}
          {mitigations.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-300" /> {t('otAnalysis.mitigations.title')}
                </h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{t('otAnalysis.mitigations.subtitle')}</p>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {mitigations.map(m => (
                  <MitigationRow
                    key={m.id}
                    m={m}
                    avgSalary={avgMonthlySalary}
                    onGoToSchedule={onGoToSchedule}
                  />
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      <EmployeeOTDetailModal
        isOpen={drillEmpId !== null}
        onClose={() => setDrillEmpId(null)}
        employee={drillEmp}
        schedule={schedule}
        shifts={shifts}
        config={config}
        holidays={holidays}
        allSchedules={allSchedules}
        stationNameById={stationNameById}
        totalHours={drillRow?.totalHours ?? 0}
        payableOverCapHours={drillRow?.payableOverCapHours ?? 0}
        holidayHours={drillRow?.holidayHours ?? 0}
        totalOTPay={drillRow?.totalOTPay ?? 0}
        premiumHolidayHours={drillRow?.premiumHolidayHours ?? 0}
        overCapPay={drillRow?.overCapPay ?? 0}
        holidayPay={drillRow?.holidayPay ?? 0}
      />
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
    cfg.tone === 'rose' ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-200 border-rose-200 dark:border-rose-500/40'
      : cfg.tone === 'amber' ? 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-200 border-amber-200 dark:border-amber-500/40'
        : 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200 border-blue-200 dark:border-blue-500/40';
  return (
    <div className="p-4 flex items-start gap-4">
      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border", toneClass)}>
        <Clock className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{cfg.title}</p>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{cfg.body}</p>
        {m.estimatedSavings !== 0 && (
          <p className="text-[11px] font-black mt-1.5 text-emerald-700 dark:text-emerald-200">
            {t('otAnalysis.mitigations.estSavings', { amount: fmtIQD(m.estimatedSavings) })}
          </p>
        )}
      </div>
      {(m.id === 'rebalance' || m.id === 'comp-day-holiday') && (
        <button onClick={onGoToSchedule} className={cn(
          "px-3 py-1.5 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shrink-0",
          m.id === 'rebalance' ? "bg-blue-600 hover:bg-blue-700" : "bg-amber-600 hover:bg-amber-700",
        )}>
          {cfg.cta}
        </button>
      )}
    </div>
  );
}
