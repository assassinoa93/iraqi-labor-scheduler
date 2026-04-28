import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, ChevronRight, Database, BarChart3, X,
  ShieldAlert, Clock, ShieldCheck, AlertCircle, TrendingUp,
  Briefcase, Plus, CheckCircle2, Circle,
} from 'lucide-react';
import { format } from 'date-fns';
import { Employee, Shift, PublicHoliday, Config, Violation, Schedule, Station } from '../types';
import { Card, KpiCard } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { DEFAULT_MONTHLY_SALARY_IQD, baseHourlyRate, monthlyHourCap } from '../lib/payroll';
import { useModalKeys } from '../lib/hooks';
import { ComplianceTrendCard } from '../components/ComplianceTrendCard';
import { StaffingAdvisoryCard } from '../components/StaffingAdvisoryCard';
import { computeStaffingAdvisory } from '../lib/staffingAdvisory';
import { computeHolidayPay } from '../lib/holidayCompPay';

interface DashboardTabProps {
  employees: Employee[];
  shifts: Shift[];
  holidays: PublicHoliday[];
  config: Config;
  schedule: Schedule;
  // v2.1.1 — full schedule map so holiday OT premium calcs can peek into
  // next month for late-month holidays.
  allSchedules?: Record<string, Schedule>;
  stations: Station[];
  violations: Violation[];
  staffingGapsByStation: Array<{ stationId: string; stationName: string; gap: number; roleHint?: string }>;
  hourlyCoverage: {
    hours: number[];
    coverage: Record<number, Record<number, number>>;
    requirements: Record<number, Record<number, number>>;
  };
  peakStabilityPercent: number;
  overallCoveragePercent: number;
  isStatsModalOpen: boolean;
  setIsStatsModalOpen: (b: boolean) => void;
  prevMonth: () => void;
  nextMonth: () => void;
  onGoToRoster: () => void;
  onLoadSample: () => void;
  // Identifies which company we're recording the compliance trend for. The
  // trend card persists per-company snapshots in localStorage so switching
  // company resets the chart to that company's history.
  activeCompanyId: string;
}

export function DashboardTab(props: DashboardTabProps) {
  const {
    employees, shifts, holidays, config, schedule, allSchedules, stations,
    violations, staffingGapsByStation, hourlyCoverage,
    peakStabilityPercent, overallCoveragePercent,
    isStatsModalOpen, setIsStatsModalOpen,
    prevMonth, nextMonth, onGoToRoster, onLoadSample,
    activeCompanyId,
  } = props;
  const { t } = useI18n();
  const closeStatsButtonRef = useModalKeys(isStatsModalOpen, () => setIsStatsModalOpen(false)) as React.RefObject<HTMLButtonElement>;

  // Compliance health metric. Three checks per (employee × day): daily cap,
  // rest-between-shifts, weekly rest. Higher rule coverage might shift this
  // but the original heuristic is good enough for an at-a-glance score.
  const totalChecks = employees.length * config.daysInMonth * 3;
  const totalViolationInstances = violations.reduce((s, v) => s + (v.count || 1), 0);
  const compliancePct = totalChecks === 0
    ? '100%'
    : `${Math.max(0, Math.round(100 - (totalViolationInstances / Math.max(totalChecks, 1)) * 100))}%`;

  // Optimization advisory: convert scheduled OT into a "you could hire N more
  // people for the same money" projection. Treats one full-time slot as a
  // monthly cap of hours and the default monthly salary as the marginal hire
  // cost — both come from the same constants payroll.ts uses elsewhere.
  const cap = monthlyHourCap(config);
  const otRateDay = config.otRateDay ?? 1.5;
  const shiftByCode = new Map(shifts.map(s => [s.code, s]));

  // Split OT into the two pools that pay at different rates under Iraqi
  // Labor Law: over-cap (Art. 70, 1.5×) and public-holiday hours (Art. 74,
  // 2.0×). Reporting them together as a single "OT Premium" used to confuse
  // supervisors when a clean at-cap month still produced significant
  // premium pay (all holiday hours). The Coverage & OT Analysis tab uses
  // the same split — these locals just power the dashboard headline.
  let totalOTHours = 0;
  let totalOverCapPay = 0;
  let totalHolidayPay = 0;
  for (const emp of employees) {
    const empSched = schedule[emp.empId] || {};
    let totalHrs = 0;
    for (const [, entry] of Object.entries(empSched)) {
      const shift = shiftByCode.get(entry.shiftCode);
      if (!shift?.isWork) continue;
      totalHrs += shift.durationHrs;
    }
    const hourly = baseHourlyRate(emp, config);
    // v2.1.1 — Holiday OT honours the Art. 74 either-or model. The 2×
    // premium fires only when no comp day landed inside the window.
    const breakdown = computeHolidayPay(emp, schedule, shifts, holidays, config, hourly, allSchedules);
    const stdOT = Math.max(0, totalHrs - cap - breakdown.premiumHolidayHours);
    totalOTHours += Math.max(0, totalHrs - cap);
    totalOverCapPay += stdOT * hourly * otRateDay;
    totalHolidayPay += breakdown.premiumPay;
  }
  const totalOTPay = totalOverCapPay + totalHolidayPay;
  const potentialHires = Math.ceil(totalOTHours / Math.max(1, cap));
  const hireCost = potentialHires * DEFAULT_MONTHLY_SALARY_IQD;
  const savings = Math.max(0, totalOTPay - hireCost);
  const totalHolidayBank = employees.reduce((s, e) => s + (e.holidayBank || 0), 0);
  const peopleWithBank = employees.filter(e => (e.holidayBank || 0) > 0).length;

  // 3-mode staffing advisory. The per-station gap data comes straight from
  // the dashboard's existing peak-hour shortfall computation — the advisory
  // module slices it by mode (OT-driven, gap-driven, or both) and returns a
  // per-station breakdown so each recommended hire is tied to a station and
  // a reason. Wrap isPeakDay locally so the simulation re-uses the same
  // peak-day predicate.
  const isPeakDay = (d: number) => (config.peakDays || []).includes(((new Date(config.year, config.month - 1, d).getDay()) + 1));
  const stationGaps = staffingGapsByStation.map(g => ({
    stationId: g.stationId, stationName: g.stationName, gap: g.gap,
  }));
  const advisorySimArgs = {
    employees, schedule, shifts, stations, holidays, config, isPeakDay,
    totalOTHours, totalOTPay, stationGaps,
  };
  const advisory = computeStaffingAdvisory(advisorySimArgs);

  // Gate the strategic-growth + advisory cards on setup-completeness. The
  // dashboard should not pretend to give actionable advice when the supervisor
  // hasn't entered a roster, defined stations, or set a schedule for the
  // active month. Each block lists exactly what is still missing so the user
  // knows where to go next.
  const hasRoster = employees.length > 0;
  const hasStations = stations.length > 0;
  const hasShifts = shifts.some(s => s.isWork);
  const hasEligibility = employees.length === 0 || employees.every(e => e.category === 'Driver' || e.eligibleStations.length > 0);
  const hasScheduleEntries = Object.values(schedule).some(empSched => empSched && Object.keys(empSched).length > 0);
  const setupComplete = hasRoster && hasStations && hasShifts && hasEligibility && hasScheduleEntries;
  const setupChecklist: Array<{ key: string; ok: boolean; labelKey: string }> = [
    { key: 'roster', ok: hasRoster, labelKey: 'dashboard.setup.needRoster' },
    { key: 'stations', ok: hasStations, labelKey: 'dashboard.setup.needStations' },
    { key: 'shifts', ok: hasShifts, labelKey: 'dashboard.setup.needShifts' },
    { key: 'elig', ok: hasEligibility, labelKey: 'dashboard.setup.needEligibility' },
    { key: 'schedule', ok: hasScheduleEntries, labelKey: 'dashboard.setup.needSchedule' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
          <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center px-4 w-40 font-mono">
            <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">{config.year}</p>
            <p className="text-xl font-black text-slate-800 tracking-tighter uppercase whitespace-nowrap">
              {format(new Date(config.year, config.month - 1, 1), 'MMMM')}
            </p>
          </div>
          <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
          <button
            onClick={() => setIsStatsModalOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-md active:scale-95"
          >
            <Database className="w-3.5 h-3.5 text-blue-400" />
            {t('dashboard.showStats')}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isStatsModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label={t('dashboard.stats.title')}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                    <BarChart3 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-800 tracking-tighter uppercase leading-none">{t('dashboard.stats.title')}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{t('dashboard.stats.period')}: {format(new Date(config.year, config.month - 1, 1), 'MMMM yyyy')}</p>
                  </div>
                </div>
                <button ref={closeStatsButtonRef} onClick={() => setIsStatsModalOpen(false)} aria-label={t('action.cancel')} className="p-3 hover:bg-slate-200 rounded-2xl transition-all"><X className="w-6 h-6 text-slate-400" /></button>
              </div>

              <div className="p-8 overflow-y-auto flex-1 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="p-6 bg-blue-600 text-white border-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-100 mb-4 opacity-70">{t('dashboard.stats.complianceHealth')}</p>
                    <p className="text-5xl font-black tracking-tight">{compliancePct}</p>
                    <p className="text-xs font-bold text-blue-100 mt-2">{t('dashboard.stats.basedOn', { count: employees.length })}</p>
                  </Card>
                  <Card className="p-6 bg-slate-900 text-white border-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">{t('dashboard.stats.totalIncidents')}</p>
                    <p className="text-5xl font-black tracking-tight">{totalViolationInstances}</p>
                    <p className="text-xs font-bold text-emerald-400 mt-2">{t('dashboard.stats.acrossRules', { count: violations.length })}</p>
                  </Card>
                  <Card className="p-6 border-slate-200">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">{t('dashboard.peakStability')}</p>
                    <p className={cn(
                      "text-5xl font-black tracking-tight",
                      peakStabilityPercent >= 90 ? "text-emerald-600" : peakStabilityPercent >= 75 ? "text-slate-800" : "text-rose-600"
                    )}>{peakStabilityPercent}%</p>
                    <p className="text-xs font-bold text-slate-400 mt-2 italic">{t('dashboard.peakCaption')}</p>
                  </Card>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <ShieldAlert className="w-3.5 h-3.5" /> {t('dashboard.stats.byCategory')}
                  </h4>
                  <div className="grid grid-cols-1 gap-3">
                    {[
                      { cat: t('dashboard.stats.cat.workHours'), count: violations.filter(v => v.article.includes('67') || v.article.includes('68')).length, icon: Clock, color: 'text-rose-500' },
                      { cat: t('dashboard.stats.cat.restPeriods'), count: violations.filter(v => v.article.includes('71') || v.article.includes('72')).length, icon: ShieldCheck, color: 'text-emerald-500' },
                      { cat: t('dashboard.stats.cat.wagesOT'), count: violations.filter(v => v.article.includes('70')).length, icon: Database, color: 'text-blue-500' },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-4">
                          <item.icon className={cn("w-5 h-5", item.color)} />
                          <span className="text-sm font-bold text-slate-700">{item.cat}</span>
                        </div>
                        <span className="text-lg font-black text-slate-800">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase italic">{t('dashboard.stats.footer')}</p>
                <button onClick={() => setIsStatsModalOpen(false)} className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all">{t('dashboard.stats.close')}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {!setupComplete && employees.length > 0 && (
        <Card className="p-6 border-amber-200 bg-amber-50/40">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
              <ShieldAlert className="w-6 h-6 text-amber-700" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-slate-800 tracking-tight">{t('dashboard.setup.title')}</h3>
              <p className="text-xs text-slate-600 leading-relaxed mt-1">{t('dashboard.setup.body')}</p>
              <div className="mt-4 space-y-1.5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('dashboard.setup.checklist')}</p>
                {setupChecklist.map(item => (
                  <div key={item.key} className="flex items-center gap-2">
                    {item.ok
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      : <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
                    <p className={cn(
                      "text-xs leading-relaxed",
                      item.ok ? "text-slate-400 line-through" : "text-slate-700 font-medium",
                    )}>{t(item.labelKey)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {setupComplete && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-6 bg-slate-900 text-white border-0 shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
              <TrendingUp className="w-40 h-40" />
            </div>
            <div className="relative z-10 space-y-6">
              <div className="space-y-1">
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-blue-400">{t('dashboard.optim.eyebrow')}</h3>
                <h4 className="text-3xl font-black tracking-tighter">{t('dashboard.optim.title')}</h4>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-y border-white/10">
                <div>
                  <p className="text-[10px] uppercase font-bold text-white/40 mb-1">{t('dashboard.optim.scheduledOT')}</p>
                  <p className="text-xl font-black text-emerald-400">{totalOTHours.toFixed(0)}h</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-white/40 mb-1">{t('dashboard.optim.otPremium')}</p>
                  <p className="text-xl font-black text-rose-400">{Math.round(totalOTPay).toLocaleString()} IQD</p>
                  {(totalOverCapPay > 0 || totalHolidayPay > 0) && (
                    <p className="text-[9px] text-white/50 font-mono leading-tight mt-1">
                      {Math.round(totalOverCapPay).toLocaleString()} {t('dashboard.optim.overCapShort')} · {Math.round(totalHolidayPay).toLocaleString()} {t('dashboard.optim.holidayShort')}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-white/40 mb-1">{t('dashboard.optim.staffDeficit')}</p>
                  <p className="text-xl font-black text-blue-400">+{potentialHires} {t('dashboard.optim.personnel')}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-white/40 mb-1">{t('dashboard.optim.savings')}</p>
                  <p className="text-xl font-black text-emerald-400">≈{Math.round(savings).toLocaleString()} IQD</p>
                </div>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10 flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-300">
                    {t('dashboard.optim.body', {
                      hours: totalOTHours.toFixed(0),
                      hires: potentialHires,
                      savings: Math.round(savings).toLocaleString(),
                    })}
                  </p>
                </div>
              </div>

              {/* Per-station gap breakdown — answers "where exactly?" so the
                  aggregate hire count isn't a black box. Mirrors the Staffing
                  Advisory but condensed for the strategic-growth context. */}
              {staffingGapsByStation.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[10px] font-black text-blue-300 uppercase tracking-[0.3em]">{t('dashboard.optim.byStation')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {staffingGapsByStation.slice(0, 6).map(g => (
                      <div key={g.stationId} className="flex items-center justify-between gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">{g.stationName}</p>
                          <p className="text-[10px] font-mono text-blue-300 truncate">
                            {g.roleHint
                              ? t('dashboard.optim.byStation.role', { role: g.roleHint })
                              : t('dashboard.optim.byStation.anyEligible')}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-black text-rose-300 leading-none">+{g.gap}</p>
                          <p className="text-[8px] font-black uppercase tracking-widest text-white/40 mt-0.5">{t('dashboard.optim.byStation.toHire')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {staffingGapsByStation.length > 6 && (
                    <p className="text-[10px] text-white/40 italic">
                      {t('dashboard.optim.byStation.moreFooter', { extra: staffingGapsByStation.length - 6 })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('dashboard.continuity')}</h5>
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <div>
                    <p className={cn(
                      "text-2xl font-black",
                      overallCoveragePercent >= 90 ? "text-emerald-600" : overallCoveragePercent >= 75 ? "text-slate-800" : "text-rose-600"
                    )}>{overallCoveragePercent}%</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">{t('dashboard.stationCoverage')}</p>
                  </div>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${overallCoveragePercent}%` }}
                    className={cn(
                      "h-full",
                      overallCoveragePercent >= 90 ? "bg-emerald-500" : overallCoveragePercent >= 75 ? "bg-blue-500" : "bg-rose-500"
                    )}
                  />
                </div>
                <p className="text-[10px] text-slate-400 italic">{t('dashboard.coverageNote')}</p>
              </div>
            </Card>
            <Card className="p-6 bg-blue-50/50 border-blue-100">
              <div className="flex items-center gap-3 mb-3">
                <Briefcase className="w-5 h-5 text-blue-600" />
                <h5 className="text-sm font-bold text-slate-800">{t('dashboard.recruitment.title')}</h5>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mb-4">
                {t('dashboard.recruitment.body', { current: employees.length, target: employees.length + potentialHires })}
              </p>
              <button onClick={onGoToRoster} className="w-full py-2 bg-blue-600 text-white rounded text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all">{t('dashboard.recruitment.cta')}</button>
            </Card>
          </div>
        </div>
      )}

      {employees.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-10 border-2 border-dashed border-slate-200 rounded-2xl bg-white text-center space-y-6"
        >
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-10 h-10 text-slate-400" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h2 className="text-2xl font-bold text-slate-800 tracking-tight">{t('dashboard.empty.title')}</h2>
            <p className="text-sm text-slate-500 leading-relaxed">{t('dashboard.empty.body')}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <button onClick={onGoToRoster} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl flex items-center gap-2">
              <Plus className="w-4 h-4" />
              {t('dashboard.empty.create')}
            </button>
            <button onClick={onLoadSample} className="px-8 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2">
              <Database className="w-4 h-4" />
              {t('dashboard.empty.sample')}
            </button>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label={t('dashboard.kpi.workforce')} value={employees.length} />
        <KpiCard label={t('dashboard.kpi.violations')} value={totalViolationInstances} trend={violations.length > 0 ? 'Critical' : 'Perfect'} />
        <KpiCard label={t('dashboard.kpi.stations')} value={stations.length} />
        <KpiCard label={t('dashboard.kpi.compliance')} value={compliancePct} trend="Health" />
        <KpiCard
          label={t('dashboard.kpi.fteForecast')}
          value={potentialHires === 0 ? '—' : `+${potentialHires}`}
          trend={potentialHires > 0 ? 'Critical' : undefined}
        />
      </div>

      <ComplianceTrendCard
        companyId={activeCompanyId}
        compliancePct={parseInt(compliancePct, 10) || 0}
        violations={totalViolationInstances}
        coveragePct={overallCoveragePercent}
      />

      {setupComplete && (
        <StaffingAdvisoryCard
          advisory={advisory}
          currentOTHours={totalOTHours}
          currentOTPay={totalOTPay}
          simArgs={advisorySimArgs}
        />
      )}

      <div className="grid grid-cols-1 gap-6">
        <Card className="flex flex-col">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">{t('dashboard.complianceAudit')}</h3>
            <span className="text-[10px] bg-slate-100 px-2.5 py-1 rounded text-slate-500 font-mono font-bold uppercase">{t('dashboard.liveValidation')}</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
            {violations.map((v, i) => (
              <div key={i} className={cn("flex items-center gap-6 px-6 py-4 transition-colors", v.article === "(Art. 67)" ? "bg-red-50/30" : "bg-white hover:bg-slate-50")}>
                <div className="font-mono text-xs text-slate-500 font-bold shrink-0">{v.empId}</div>
                <div className="text-sm font-bold text-slate-800 w-40 truncate">
                  {employees.find(e => e.empId === v.empId)?.name}
                </div>
                <div className="text-xs font-bold text-slate-400 w-24 shrink-0">{v.article}</div>
                <div className={cn("text-xs font-medium flex-1", v.article.includes("Art. 67") || v.article.includes("Art. 68") ? "text-red-600 font-bold" : "text-slate-500 font-medium")}>
                  {v.message} {v.count && v.count > 1 && <span className="text-blue-600 font-black ml-1 uppercase">({v.count} {t('dashboard.times')})</span>}
                </div>
              </div>
            ))}
            {violations.length === 0 && (
              <div className="p-20 text-center text-slate-400 font-bold uppercase tracking-widest text-[10px]">{t('dashboard.noViolations')}</div>
            )}
          </div>
        </Card>

        <Card className="p-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">{t('dashboard.coverageTitle')} ({config.shopOpeningTime} - {config.shopClosingTime})</h3>
            <div className="flex gap-2">
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase">
                <div className="w-2 h-2 rounded-full bg-red-100 border border-red-200" /> {t('dashboard.coverage.low')}
              </div>
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase">
                <div className="w-2 h-2 rounded-full bg-emerald-100 border border-emerald-200" /> {t('dashboard.coverage.optimal')}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(${hourlyCoverage.hours.length + 1}, minmax(40px, 1fr))` }}>
              <div className="h-10" />
              {hourlyCoverage.hours.map(h => (
                <div key={h} className="text-center font-mono text-[9px] font-bold text-slate-400 py-2 border-b border-slate-100">
                  {h}:00
                </div>
              ))}

              {Array.from({ length: config.daysInMonth }, (_, i) => i + 1).map(day => (
                <React.Fragment key={day}>
                  <div className="flex flex-col justify-center pr-4 border-r border-slate-100">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">{t('dashboard.day')} {day}</span>
                    <span className="text-[8px] text-slate-300 font-bold">{format(new Date(config.year, config.month - 1, day), 'EEE')}</span>
                  </div>
                  {hourlyCoverage.hours.map(h => {
                    const count = hourlyCoverage.coverage[day]?.[h] || 0;
                    const req = hourlyCoverage.requirements[day]?.[h] || 0;
                    const isLow = count < req;
                    return (
                      <div
                        key={h}
                        className={cn(
                          "h-10 rounded flex flex-col items-center justify-center border transition-all relative overflow-hidden",
                          isLow ? "bg-red-50 border-red-100 text-red-600 shadow-[inset_0_0_10px_rgba(239,68,68,0.05)]" : "bg-emerald-50 border-emerald-100 text-emerald-600 shadow-[inset_0_0_10px_rgba(16,185,129,0.05)]"
                        )}
                      >
                        <span className="text-[10px] font-bold">{count}</span>
                        <span className="text-[7px] font-black uppercase opacity-60">/{req}</span>
                        {isLow && <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-red-500 rounded-bl-sm" />}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
          <p className="mt-6 text-[10px] text-slate-400 font-medium italic">{t('dashboard.coverage.note')}</p>
        </Card>

        <div className="grid grid-cols-1 gap-6">
          {/* Note: the older "Staffing Advisory" panel that lived here was
              removed in v1.8.1 — its content is now covered by the
              StaffingAdvisoryCard above (with per-mode tabs + per-station
              breakdown + simulation validation). The duplicate panel was
              showing the same recommendations in two different cards. */}
          <Card className="p-6 border-blue-100 bg-blue-50/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                <Briefcase className="w-5 h-5" />
              </div>
              <h3 className="font-bold uppercase tracking-widest text-xs text-slate-700">{t('dashboard.holidayBank.title')}</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-bold text-slate-500 uppercase">{t('dashboard.holidayBank.total')}</span>
                <span className="text-xl font-black text-blue-700 leading-none">
                  {totalHolidayBank} <span className="text-[10px] uppercase">{t('dashboard.holidayBank.days')}</span>
                </span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600"
                  style={{ width: employees.length === 0 ? '0%' : `${Math.min(100, (peopleWithBank / employees.length) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 font-medium">
                {t('dashboard.holidayBank.summary', { with: peopleWithBank, total: employees.length })}
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
