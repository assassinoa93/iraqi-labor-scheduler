import React, { useMemo, useState } from 'react';
import {
  Users, TrendingUp, Minus, Sparkles, Info,
  MapPin, ChevronDown, ChevronUp, Calendar, Activity, ShieldCheck,
  Zap, Download, Eye, GitCompareArrows, FileSpreadsheet, AlertTriangle, ChevronLeft, ChevronRight,
  Briefcase, Clock4, ArrowUp, ArrowDown, ArrowRight,
} from 'lucide-react';
import { Employee, Shift, Station, StationGroup, PublicHoliday, Config, Schedule } from '../types';
import { Card, ComparativeKpi } from '../components/Primitives';
import { CoverageScenarioPanel } from '../components/CoverageScenarioPanel';
import { WhatIfPanel } from '../components/WhatIfPanel';
import { getGroupIcon } from '../lib/groupIcons';
import { Switch } from '../components/ui/Switch';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { projectHolidaysToYear } from '../lib/holidays';
import {
  analyzeWorkforceAnnual, buildAnnualRollup, AnnualRollupStation, AnnualRollupGroup, MonthlyPlanSummary,
  PlanMode, buildHiringRoadmap, HiringRoadmap, MonthlyHiringStep,
} from '../lib/workforcePlanning';

interface Props {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  stationGroups: StationGroup[];
  holidays: PublicHoliday[];
  config: Config;
  schedule: Schedule;
  // v5.19.0 — passed through to the What-If simulator so it can re-run
  // the auto-scheduler on a hypothetical roster modification.
  allSchedules?: Record<string, Schedule>;
  isPeakDayFor: (config: Config) => (day: number) => boolean;
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
    employees, shifts, stations, stationGroups, holidays, config, schedule, allSchedules, isPeakDayFor,
    onGoToRoster, onGoToLayout,
  } = props;
  const { t } = useI18n();

  const [mode, setMode] = useState<PlanMode>('conservative');
  const [idealOnly, setIdealOnly] = useState(false);
  const [showAnnualRollup, setShowAnnualRollup] = useState(true);
  const [drillMonthIndex, setDrillMonthIndex] = useState<number | null>(null);
  // v2.5.0 — forecast-year selector. The planner runs against THIS year
  // (with the user's data as baseline) by default, but can simulate any
  // future or past year by re-projecting holidays + recomputing month
  // calendars. Useful for "plan 2027 from 2026 data" recruitment cycles.
  const [forecastYear, setForecastYear] = useState<number>(config.year);

  // Build a synthetic config when forecasting a different year. Holidays
  // are projected by month/day to the target year — both fixed-Gregorian
  // and movable Islamic holidays. Movable ones are an approximation
  // (Hijri-determined dates drift ~11 days per Gregorian year) but are
  // useful for budget / hiring forecasts; the supervisor can override
  // exact dates in the Holidays tab once the official Hijri calendar is
  // announced.
  const isForecasting = forecastYear !== config.year;
  const { forecastConfig, forecastHolidays, projectedFixedCount, approximatedMovableCount } = useMemo(() => {
    if (!isForecasting) {
      return { forecastConfig: config, forecastHolidays: holidays, projectedFixedCount: 0, approximatedMovableCount: 0 };
    }
    const { projected, projectedFixed, approximatedMovable } = projectHolidaysToYear(holidays, forecastYear);
    return {
      forecastConfig: { ...config, year: forecastYear },
      forecastHolidays: projected,
      projectedFixedCount: projectedFixed,
      approximatedMovableCount: approximatedMovable,
    };
  }, [isForecasting, config, holidays, forecastYear]);

  const annual = useMemo(
    () => analyzeWorkforceAnnual({ employees, shifts, stations, holidays: forecastHolidays, baseConfig: forecastConfig, isPeakDayFor, mode }),
    [employees, shifts, stations, forecastHolidays, forecastConfig, isPeakDayFor, mode],
  );
  const rollup = useMemo(
    () => buildAnnualRollup(annual, employees, stations, mode, stationGroups, forecastConfig),
    [annual, employees, stations, mode, stationGroups, forecastConfig],
  );
  // v2.4.0 — month-by-month hiring schedule. Plans WHEN to bring people on
  // so they're productive at peak demand without paying for them through
  // the valley months that come before. Reuses the annual demand curve;
  // mode toggles whether PT contracts can scale up/down.
  const roadmap = useMemo(
    () => buildHiringRoadmap({
      annual, employees, mode, config: forecastConfig,
      // v5.18.0 — derive lead months from the config'd lead-time-weeks.
      // ceil(weeks / 4) keeps a 4-week pipeline at 1 month, an 8-week
      // pipeline at 2 months. Defaults to 1 when unset (matches the
      // pre-v5.18 hardcoded default in buildHiringRoadmap).
      leadMonths: forecastConfig.hiringLeadTimeWeeks
        ? Math.max(1, Math.ceil(forecastConfig.hiringLeadTimeWeeks / 4))
        : 1,
    }),
    [annual, employees, mode, forecastConfig],
  );
  const drillMonth = drillMonthIndex
    ? annual.byMonth.find(m => m.monthIndex === drillMonthIndex)
    : annual.byMonth[annual.peakMonthIndex - 1];

  const fmtIQD = (n: number) => Math.round(Math.abs(n)).toLocaleString();

  // v2.6.0 — five-number annual headcount summary, computed separately
  // for FTE and PT so the supervisor reads the demand profile clearly:
  //   • Avg, median  — central tendency over the year
  //   • Peak (with month name)  — highest single-month demand
  //   • Valley (with month name)  — lowest single-month demand
  //   • Recommended  — the year-round target the planner suggests
  //                    (peak-driven in conservative mode, average-driven
  //                     in optimal mode — surfaced via `rollup.totalRecommended*`)
  // Current FT / PT split keys off the same FTE threshold used by the
  // Excel export and the rest of the app (`contractedWeeklyHrs >=
  // standardWeeklyHrsCap` ⇒ FTE).
  const headcountStats = useMemo(() => {
    const fteSeries = annual.byMonth.map(m => m.recommendedFTE);
    const ptSeries = annual.byMonth.map(m => m.recommendedPartTime);
    const cap = forecastConfig.standardWeeklyHrsCap || 48;
    const currentFTE = employees.filter(e => (e.contractedWeeklyHrs || cap) >= cap).length;
    const currentPT = employees.length - currentFTE;
    const fteStats = fiveNumberSummary(fteSeries);
    const ptStats = fiveNumberSummary(ptSeries);
    const monthName = (i: number) => annual.byMonth[i - 1]?.monthName ?? '';
    return {
      fte: {
        ...fteStats,
        peakMonth: monthName(fteStats.peakMonthIndex),
        valleyMonth: monthName(fteStats.valleyMonthIndex),
        current: currentFTE,
        recommended: rollup.totalRecommendedFTE,
        delta: rollup.totalRecommendedFTE - currentFTE,
      },
      pt: {
        ...ptStats,
        peakMonth: monthName(ptStats.peakMonthIndex),
        valleyMonth: monthName(ptStats.valleyMonthIndex),
        current: currentPT,
        recommended: rollup.totalRecommendedPartTime,
        delta: rollup.totalRecommendedPartTime - currentPT,
      },
    };
  }, [annual, employees, rollup, forecastConfig.standardWeeklyHrsCap]);

  const hasInputs = stations.length > 0;
  const hasDemand = annual.annualRequiredHours > 0;

  const handleExportPDF = async () => {
    // v5.19.0 — include the Coverage Scenario in the PDF so HR/CEO
    // readers see the same per-station walkthrough the on-screen panel
    // shows. Built lazily here so the import isn't pulled at module
    // load (the function is only called on user click).
    const { buildCoverageScenarios } = await import('../lib/coverageScenario');
    const scenarios = buildCoverageScenarios({
      stations, shifts, config: forecastConfig,
      isPeakDay: true,
      stationGroups,
    });
    return exportWorkforcePlanToPDF({
      annual, rollup, roadmap, mode, idealOnly, fmtIQD, scenarios,
    });
  };

  // v2.3.0 — Excel export. Uses the same annual + rollup data, packaged
  // into a 7-sheet workbook (executive summary, hiring roadmap, group
  // rollup, station rollup, monthly demand, budget impact, implementation
  // schedule). Async because exceljs is dynamically imported.
  const handleExportExcel = async () => {
    const { exportWorkforcePlanToExcel } = await import('../lib/workforcePlanExcel');
    const { buildCoverageScenarios } = await import('../lib/coverageScenario');
    const { auditShiftLibrary } = await import('../lib/shiftLibraryAudit');
    const cap = config.standardWeeklyHrsCap || 48;
    const fteCount = employees.filter(e => (e.contractedWeeklyHrs || cap) >= cap).length;
    const ptCount = employees.length - fteCount;
    // v5.19.0 — bundle the new sections into the same workbook so the
    // HR / CEO recipient sees the on-screen panels in spreadsheet form.
    const scenarios = buildCoverageScenarios({
      stations, shifts, config: forecastConfig,
      isPeakDay: true,
      stationGroups,
    });
    const audit = auditShiftLibrary({ shifts, schedule: props.schedule, allSchedules });
    await exportWorkforcePlanToExcel({
      annual, rollup, roadmap, mode,
      companyName: config.company,
      currentRosterFTECount: fteCount,
      currentRosterPartTimeCount: ptCount,
      scenarios,
      auditFindings: audit.findings,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-start justify-between gap-4 mb-2">
        <div className="flex items-center gap-4 flex-wrap">
          {/* v2.5.0 — clickable year selector. Renders just like the static
              year card it replaced, but the chevrons jump to the previous /
              next forecast year. The badge below switches to "FORECAST"
              when looking at a year other than the active calendar's. */}
          <div className="bg-white px-2 py-2 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-1">
            <button
              onClick={() => setForecastYear(y => y - 1)}
              aria-label={t('workforce.forecast.prevYear')}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center px-2 min-w-[88px]">
              <p className={cn(
                'text-[10px] font-black uppercase tracking-[0.2em]',
                isForecasting ? 'text-amber-600' : 'text-blue-500',
              )}>
                {isForecasting ? t('workforce.forecast.label') : t('workforce.annual.year')}
              </p>
              <p className="text-2xl font-black text-slate-800 tracking-tight font-mono">{forecastYear}</p>
            </div>
            <button
              onClick={() => setForecastYear(y => y + 1)}
              aria-label={t('workforce.forecast.nextYear')}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {isForecasting && (
              <button
                onClick={() => setForecastYear(config.year)}
                className="ms-1 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                title={t('workforce.forecast.resetTooltip')}
              >
                {t('workforce.forecast.reset')}
              </button>
            )}
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
            <>
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-md active:scale-[0.98]"
                title={t('workforce.export.excel.tooltip')}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                {t('workforce.export.excel.button')}
              </button>
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-md active:scale-[0.98]"
                title={t('workforce.export.pdf.tooltip')}
              >
                <Download className="w-3.5 h-3.5" />
                {t('workforce.export.button')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* v2.5.0 — forecast banner. Surfaces only when the user picked a
          year other than the active config's, explains the simulation
          assumptions, and warns about movable holidays that couldn't
          be auto-projected. */}
      {isForecasting && (
        <Card className="p-4 bg-amber-50/40 border-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[11px] font-black text-amber-800 uppercase tracking-widest">{t('workforce.forecast.banner.title', { year: forecastYear })}</p>
            <p className="text-[11px] text-amber-800 leading-relaxed">{t('workforce.forecast.banner.body', { year: forecastYear, projected: projectedFixedCount })}</p>
            {approximatedMovableCount > 0 && (
              <p className="text-[11px] text-amber-700 leading-relaxed">{t('workforce.forecast.banner.approximatedMovable', { count: approximatedMovableCount, year: forecastYear })}</p>
            )}
          </div>
        </Card>
      )}

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

          {/* ── Annual anchor row (kept tight on purpose) ─────────────────
              Two stable cards: total hours of demand and the year's
              salary delta vs the current roster. Headcount detail moves
              to the dedicated "Annual Headcount Plan" panel below, where
              FTE and PT are split out properly. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="p-5 bg-slate-900 text-white border-0 shadow-xl">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-300 mb-2">{t('workforce.annual.kpi.totalHours')}</p>
              <p className="text-3xl font-black tracking-tight">{Math.round(annual.annualRequiredHours).toLocaleString()}</p>
              <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{t('workforce.annual.kpi.totalHoursSub')}</p>
            </Card>
            {!idealOnly ? (
              <Card className={cn(
                "p-5 border",
                annual.annualDelta < 0 ? "bg-emerald-50 border-emerald-200" : annual.annualDelta > 0 ? "bg-rose-50 border-rose-200" : "bg-slate-50 border-slate-200",
              )}>
                <p className={cn(
                  "text-[10px] font-black uppercase tracking-widest mb-2",
                  annual.annualDelta < 0 ? "text-emerald-700 dark:text-emerald-300" : annual.annualDelta > 0 ? "text-rose-700 dark:text-rose-300" : "text-slate-600 dark:text-slate-300",
                )}>{t('workforce.annual.kpi.annualDelta')}</p>
                <p className={cn(
                  "text-2xl font-black tracking-tight",
                  annual.annualDelta < 0 ? "text-emerald-700 dark:text-emerald-300" : annual.annualDelta > 0 ? "text-rose-700 dark:text-rose-300" : "text-slate-700 dark:text-slate-200",
                )}>
                  {annual.annualDelta >= 0 ? '+' : '−'}{fmtIQD(annual.annualDelta)}
                </p>
                <p className={cn(
                  "text-[10px] font-bold mt-1",
                  annual.annualDelta < 0 ? "text-emerald-600 dark:text-emerald-300" : annual.annualDelta > 0 ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-400",
                )}>{t('workforce.annual.kpi.annualDeltaSub')}</p>
              </Card>
            ) : (
              <Card className="p-5 bg-emerald-50 border-emerald-200">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300 mb-2">{t('workforce.ideal.annualSalary')}</p>
                <p className="text-2xl font-black tracking-tight text-emerald-700 dark:text-emerald-300">
                  {fmtIQD(mode === 'conservative' ? rollup.annualConservativeSalary : rollup.annualOptimalSalary)}
                </p>
                <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-300 mt-1 uppercase tracking-wider">{t('workforce.annual.kpi.annualDeltaSub')}</p>
              </Card>
            )}
            {mode === 'conservative' ? (
              <Card className="p-5 bg-amber-50 border-amber-200">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300 mb-2">{t('workforce.ideal.legalPremium')}</p>
                <p className="text-2xl font-black tracking-tight text-amber-700 dark:text-amber-300">{fmtIQD(rollup.legalSafetyPremium)}</p>
                <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed mt-1">{t('workforce.ideal.legalPremiumNote')}</p>
              </Card>
            ) : (
              <Card className="p-5 bg-blue-50 border-blue-200">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 mb-2">{t('workforce.ideal.peakMonth')}</p>
                <p className="text-2xl font-black tracking-tight text-blue-700 dark:text-blue-300">
                  {annual.byMonth[annual.peakMonthIndex - 1].monthName}
                </p>
                <p className="text-[10px] text-blue-600 dark:text-blue-300 mt-1">
                  {Math.round(annual.byMonth[annual.peakMonthIndex - 1].monthlyRequiredHours).toLocaleString()}h {t('workforce.annual.kpi.totalHoursSub').toLowerCase()}
                </p>
              </Card>
            )}
          </div>

          {/* ── Annual Headcount Plan ─────────────────────────────────────
              Splits FTE and PT into two parallel columns. Each column
              shows: current → recommended (with delta arrow), then a
              4-tile grid of Avg / Median / Peak / Valley with the month
              name attached to peak/valley so the supervisor sees not just
              "you peak at 8" but "you peak at 8 in April". The mode
              ribbon at the top tells the reader whether the recommendation
              is peak-driven (conservative) or average-driven (optimal). */}
          <AnnualHeadcountPanel
            stats={headcountStats}
            mode={mode}
            idealOnly={idealOnly}
          />

          {/* ── Annual rollup table (v1.16: prefers GROUP rollup when
              groups exist, falls back to per-station). Groups give the
              clearest signal — "I need N cashiers" beats listing every
              individual cashier station. Stations are still available
              underneath as drill-down for finer-grained decisions. */}
          <Card className="overflow-hidden">
            <button
              onClick={() => setShowAnnualRollup(s => !s)}
              className="w-full p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3 hover:bg-slate-100/50 transition-colors text-start"
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

              {/* v2.2.0 — bar-click drilldown. Pre-2.2.0 clicking a bar
                  only highlighted it and updated the legend; the
                  selected-month detail wasn't surfaced anywhere, leaving
                  the click feeling like a no-op. This panel renders the
                  selected month's required hours, recommended mix,
                  monthly salary, and the top roles driving demand. */}
              {drillMonth && (
                <div className="mt-5 pt-5 border-t border-slate-100">
                  <MonthDrilldownPanel month={drillMonth} annual={annual} fmtIQD={fmtIQD} />
                </div>
              )}
            </Card>
          )}

          {/* ── Hiring Roadmap (v2.4.0) — month-by-month FTE/PT plan ── */}
          {!idealOnly && (
            <HiringRoadmapSection roadmap={roadmap} mode={mode} fmtIQD={fmtIQD} />
          )}

          {/* ── Coverage Scenario (v5.19.0) — narrative walkthrough of
              how the existing shift library + station demand plays out
              on a single day, with per-station roster-required math
              (peak HC × days/week ÷ workdays + leave buffer). Bridges
              the abstract "you need N FTE" headline to a concrete
              "Cashier Counter 1 — shift M takes 11–19, shift C takes
              15–23, peak overlap 15–19, you need 4 employees on this
              station's roster" picture. */}
          <CoverageScenarioPanel
            stations={stations}
            shifts={shifts}
            stationGroups={stationGroups}
            employees={employees}
            config={forecastConfig}
          />

          {/* ── What-If Simulator (v5.19.0) — preview the OT / coverage /
              payroll deltas of hypothetical hires, releases, or
              cross-training without committing the change. */}
          <WhatIfPanel
            employees={employees}
            shifts={shifts}
            stations={stations}
            stationGroups={stationGroups}
            holidays={holidays}
            config={config}
            isPeakDay={isPeakDayFor(config)}
            schedule={schedule}
            allSchedules={allSchedules}
          />

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

// v2.6.0 — Annual Headcount Plan panel.
//
// Splits FTE and PT into two parallel columns so the supervisor reads
// the year's demand without merging the two contract types. Each column
// shows:
//   • Big "current → recommended" headline + delta arrow (skipped in
//     ideal-only view, where the recommendation stands alone)
//   • A 4-tile grid: Average, Median, Peak (with month name), Valley
//     (with month name) — month names are pulled from the byMonth series
//     so the reader sees not just "you peak at 8" but "you peak at 8 in
//     April, valley at 4 in August".
//   • A short rationale line that swaps with the planner mode
//     (peak-driven vs average-driven).
//
// Input: the `headcountStats` object computed in the parent component.
interface HeadcountColumnStats {
  current: number;
  recommended: number;
  delta: number;
  avg: number;
  median: number;
  peak: number;
  valley: number;
  peakMonth: string;
  valleyMonth: string;
}
interface HeadcountStats {
  fte: HeadcountColumnStats;
  pt: HeadcountColumnStats;
}

function AnnualHeadcountPanel({
  stats, mode, idealOnly,
}: {
  stats: HeadcountStats;
  mode: PlanMode;
  idealOnly: boolean;
}) {
  const { t } = useI18n();
  // PT column is mostly relevant in optimal mode; conservative mode
  // recommends 0 PT by design (peak-driven FTE absorbs surge). Render
  // the column either way so the supervisor sees the current PT count
  // even when the recommendation drives it to zero.
  return (
    <Card className="overflow-hidden">
      <div className="p-5 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40 flex items-center gap-3">
        <Users className="w-4 h-4 text-blue-600 dark:text-blue-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
            {t('workforce.headcount.title')}
          </h3>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            {mode === 'conservative'
              ? t('workforce.headcount.subtitle.conservative')
              : t('workforce.headcount.subtitle.optimal')}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border",
            mode === 'conservative'
              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30"
              : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30",
          )}
        >
          {mode === 'conservative' ? t('workforce.mode.conservative.label') : t('workforce.mode.optimal.label')}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 dark:divide-slate-700/60">
        <HeadcountColumn
          icon={<Briefcase className="w-4 h-4" />}
          tone="blue"
          label={t('workforce.headcount.fte.label')}
          subLabel={t('workforce.headcount.fte.sub')}
          stats={stats.fte}
          unit={t('workforce.headcount.unit.fte')}
          idealOnly={idealOnly}
          rationale={mode === 'conservative'
            ? t('workforce.headcount.rationale.fte.conservative')
            : t('workforce.headcount.rationale.fte.optimal')}
        />
        <HeadcountColumn
          icon={<Clock4 className="w-4 h-4" />}
          tone="purple"
          label={t('workforce.headcount.pt.label')}
          subLabel={t('workforce.headcount.pt.sub')}
          stats={stats.pt}
          unit={t('workforce.headcount.unit.pt')}
          idealOnly={idealOnly}
          rationale={mode === 'conservative'
            ? t('workforce.headcount.rationale.pt.conservative')
            : t('workforce.headcount.rationale.pt.optimal')}
        />
      </div>
    </Card>
  );
}

// One column of the AnnualHeadcountPanel. `tone` drives the accent
// colour (blue for FTE, purple for PT). `idealOnly` flips the headline
// from "current → recommended" to just the recommendation.
function HeadcountColumn({
  icon, tone, label, subLabel, stats, unit, idealOnly, rationale,
}: {
  icon: React.ReactNode;
  tone: 'blue' | 'purple';
  label: string;
  subLabel: string;
  stats: HeadcountColumnStats;
  unit: string;
  idealOnly: boolean;
  rationale: string;
}) {
  const { t } = useI18n();
  const accentText = tone === 'blue'
    ? 'text-blue-700 dark:text-blue-200'
    : 'text-purple-700 dark:text-purple-200';
  const accentBg = tone === 'blue'
    ? 'bg-blue-50 dark:bg-blue-500/15 border-blue-100 dark:border-blue-500/30'
    : 'bg-purple-50 dark:bg-purple-500/15 border-purple-100 dark:border-purple-500/30';
  const iconWrap = tone === 'blue'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200'
    : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200';

  // Round to 1dp so .333 / .667 medians and averages stay readable
  // without lying about the precision (the underlying analyzer rounds
  // headcount to whole people; the avg/median can land between).
  const fmt = (n: number) => Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0';

  // Delta arrow + colour. A positive delta (need to hire) is rose;
  // negative (release surplus) is amber-warning in optimal mode and
  // emerald-clean in conservative mode (where surplus = idle, not a
  // legal action). Zero is slate.
  const dPos = stats.delta > 0;
  const dNeg = stats.delta < 0;
  const deltaToneClass = dPos
    ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/30'
    : dNeg
      ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/30'
      : 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700';
  const DeltaIcon = dPos ? ArrowUp : dNeg ? ArrowDown : Minus;

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center", iconWrap)}>{icon}</span>
        <div className="min-w-0">
          <p className={cn("text-[11px] font-black uppercase tracking-widest", accentText)}>{label}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">{subLabel}</p>
        </div>
      </div>

      {idealOnly ? (
        <div>
          <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">
            {t('workforce.headcount.recommended')}
          </p>
          <p className={cn("text-5xl font-black tracking-tight tabular-nums", accentText)}>
            {stats.recommended}
          </p>
          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-wider">{unit}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">
              {t('workforce.headcount.current')}
            </p>
            <p className="text-3xl font-black text-slate-800 dark:text-slate-100 tabular-nums">{stats.current}</p>
            <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-0.5 uppercase tracking-wider">{unit}</p>
          </div>
          <div>
            <p className={cn("text-[9px] font-black uppercase tracking-widest mb-1", accentText)}>
              {t('workforce.headcount.recommended')}
            </p>
            <p className={cn("text-3xl font-black tabular-nums", accentText)}>{stats.recommended}</p>
            <p className={cn("text-[9px] font-bold mt-0.5 uppercase tracking-wider", accentText)}>{unit}</p>
          </div>
        </div>
      )}

      {!idealOnly && (
        <div className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
          deltaToneClass,
        )}>
          <DeltaIcon className="w-3 h-3" />
          {stats.delta > 0 ? `+${stats.delta}` : stats.delta < 0 ? `−${Math.abs(stats.delta)}` : '0'}
          <span className="font-mono">{unit}</span>
        </div>
      )}

      {/* Year-summary tiles. Avg + median centre the demand profile;
          peak + valley anchor the extremes. The month name on
          peak/valley turns "you peak at 8" into "you peak at 8 in April"
          which is what the supervisor actually plans against. */}
      <div className={cn("rounded-xl p-3 border space-y-2.5", accentBg)}>
        <p className={cn("text-[9px] font-black uppercase tracking-widest", accentText)}>
          {t('workforce.headcount.profile.title')}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ProfileTile
            label={t('workforce.headcount.profile.avg')}
            value={fmt(stats.avg)}
            tone="neutral"
            tooltip={t('workforce.headcount.profile.avg.tooltip')}
          />
          <ProfileTile
            label={t('workforce.headcount.profile.median')}
            value={fmt(stats.median)}
            tone="neutral"
            tooltip={t('workforce.headcount.profile.median.tooltip')}
          />
          <ProfileTile
            label={t('workforce.headcount.profile.peak')}
            value={String(stats.peak)}
            month={stats.peakMonth}
            tone="rose"
            tooltip={t('workforce.headcount.profile.peak.tooltip')}
          />
          <ProfileTile
            label={t('workforce.headcount.profile.valley')}
            value={String(stats.valley)}
            month={stats.valleyMonth}
            tone="emerald"
            tooltip={t('workforce.headcount.profile.valley.tooltip')}
          />
        </div>
      </div>

      <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{rationale}</p>
    </div>
  );
}

// One stat tile inside the year-summary grid. Renders the value, an
// optional month sub-label (peak/valley get one), and a short header.
// Small palette — neutral / rose (peak) / emerald (valley) — so the
// supervisor visually parses the four numbers at a glance.
function ProfileTile({
  label, value, month, tone, tooltip,
}: {
  label: string;
  value: string;
  month?: string;
  tone: 'neutral' | 'rose' | 'emerald';
  tooltip?: string;
}) {
  const headerCls =
    tone === 'rose' ? 'text-rose-700 dark:text-rose-300'
    : tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-slate-500 dark:text-slate-400';
  const valueCls =
    tone === 'rose' ? 'text-rose-700 dark:text-rose-200'
    : tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-200'
    : 'text-slate-800 dark:text-slate-100';
  return (
    <div title={tooltip} className="bg-white dark:bg-slate-900/50 rounded-lg px-2.5 py-2 border border-slate-200 dark:border-slate-700/60">
      <p className={cn("text-[8px] font-black uppercase tracking-widest mb-0.5", headerCls)}>{label}</p>
      <p className={cn("text-xl font-black tabular-nums leading-none", valueCls)}>{value}</p>
      {month && (
        <p className="text-[8px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mt-0.5">{month}</p>
      )}
    </div>
  );
}

// v2.6.0 — shared 5-number summary helper. Walks a year-long series
// (length 12) and returns the mean, median, peak (with month index),
// and valley (with month index). Powers both the top-level Annual
// Headcount Plan panel AND the per-station / per-group demand profile
// shown when the supervisor expands a rollup row. Centralised so the
// UI never disagrees with itself about how those four numbers are
// computed.
function fiveNumberSummary(series: number[]): {
  avg: number; median: number; peak: number; valley: number;
  peakMonthIndex: number; valleyMonthIndex: number;
} {
  if (series.length === 0) {
    return { avg: 0, median: 0, peak: 0, valley: 0, peakMonthIndex: 1, valleyMonthIndex: 1 };
  }
  let peak = series[0];
  let valley = series[0];
  let peakIdx = 1;
  let valleyIdx = 1;
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    sum += v;
    if (v > peak) { peak = v; peakIdx = i + 1; }
    if (v < valley) { valley = v; valleyIdx = i + 1; }
  }
  const sorted = [...series].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { avg: sum / series.length, median, peak, valley, peakMonthIndex: peakIdx, valleyMonthIndex: valleyIdx };
}

// v2.6.0 — Per-station / per-group demand profile.
//
// Compact version of the top-level AnnualHeadcountPanel for use inside
// expanded drilldown rows. Renders FT and PT as two side-by-side
// micro-cards: each shows the year-round recommendation as the
// headline, with the Avg / Median / Peak / Valley quad below it
// (peak/valley tagged with month names). Designed to fit inside a
// drilldown card without dominating it.
//
// Shows columns conditionally — if both FT and PT recommendations are
// 0 across the year, the relevant column is omitted entirely instead
// of cluttering the row with all-zero stats.
function MonthlyDemandProfile({
  monthlyFTE, monthlyPartTime, recommendedFTE, recommendedPartTime,
}: {
  monthlyFTE: number[];
  monthlyPartTime: number[];
  recommendedFTE: number;
  recommendedPartTime: number;
}) {
  const { t } = useI18n();
  const fteAllZero = monthlyFTE.every(v => v === 0) && recommendedFTE === 0;
  const ptAllZero = monthlyPartTime.every(v => v === 0) && recommendedPartTime === 0;
  if (fteAllZero && ptAllZero) return null;

  const fteStats = fiveNumberSummary(monthlyFTE);
  const ptStats = fiveNumberSummary(monthlyPartTime);
  const monthName = (i: number) => i >= 1 && i <= 12 ? t(MONTH_NAME_KEYS[i - 1]) : '';
  const fmt = (n: number) => Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0';

  // Local micro-tile so the per-station view keeps the same Avg /
  // Median / Peak / Valley typography rhythm as the top panel without
  // pulling the heavier ProfileTile component in.
  const Tile = ({ label, value, month, tone = 'neutral' }: {
    label: string; value: string; month?: string; tone?: 'neutral' | 'rose' | 'emerald';
  }) => {
    const headerCls =
      tone === 'rose' ? 'text-rose-700 dark:text-rose-300'
      : tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300'
      : 'text-slate-500 dark:text-slate-400';
    const valueCls =
      tone === 'rose' ? 'text-rose-700 dark:text-rose-200'
      : tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-200'
      : 'text-slate-800 dark:text-slate-100';
    return (
      <div className="bg-white dark:bg-slate-900/40 rounded-md px-2 py-1.5 border border-slate-200 dark:border-slate-700/60 text-center">
        <p className={cn('text-[7px] font-black uppercase tracking-widest mb-0.5', headerCls)}>{label}</p>
        <p className={cn('text-sm font-black tabular-nums leading-none', valueCls)}>{value}</p>
        {month && <p className="text-[7px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mt-0.5">{month}</p>}
      </div>
    );
  };

  // One column per contract type. The header shows the year-round
  // recommendation as the headline (matches the top-level pattern);
  // tile grid below shows the 4-stat profile.
  const Column = ({ tone, label, recommended, stats }: {
    tone: 'blue' | 'purple';
    label: string;
    recommended: number;
    stats: ReturnType<typeof fiveNumberSummary>;
  }) => {
    const accentBg = tone === 'blue'
      ? 'bg-blue-50/50 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/25'
      : 'bg-purple-50/50 dark:bg-purple-500/10 border-purple-100 dark:border-purple-500/25';
    const accentText = tone === 'blue'
      ? 'text-blue-700 dark:text-blue-200'
      : 'text-purple-700 dark:text-purple-200';
    return (
      <div className={cn('rounded-lg p-2.5 border', accentBg)}>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <p className={cn('text-[9px] font-black uppercase tracking-widest', accentText)}>{label}</p>
          <p className={cn('text-lg font-black tabular-nums leading-none', accentText)}>{recommended}</p>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <Tile label={t('workforce.headcount.profile.avg')} value={fmt(stats.avg)} />
          <Tile label={t('workforce.headcount.profile.median')} value={fmt(stats.median)} />
          <Tile label={t('workforce.headcount.profile.peak')} value={String(stats.peak)} month={monthName(stats.peakMonthIndex)} tone="rose" />
          <Tile label={t('workforce.headcount.profile.valley')} value={String(stats.valley)} month={monthName(stats.valleyMonthIndex)} tone="emerald" />
        </div>
      </div>
    );
  };

  // Single-column when only FT is non-zero (conservative mode); full
  // two-column when both contract types are recommended.
  return (
    <div className={cn('grid gap-2', !ptAllZero ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1')}>
      {!fteAllZero && (
        <Column
          tone="blue"
          label={t('workforce.headcount.fte.label')}
          recommended={recommendedFTE}
          stats={fteStats}
        />
      )}
      {!ptAllZero && (
        <Column
          tone="purple"
          label={t('workforce.headcount.pt.label')}
          recommended={recommendedPartTime}
          stats={ptStats}
        />
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
      : group.action === 'release' ? { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', Icon: AlertTriangle }
      : { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', Icon: Minus };
  const ActionIcon = actionTone.Icon;
  const actionLabel = group.action === 'hire'
    ? t('workforce.action.hire')
    : group.action === 'release' ? t('workforce.action.release') : t('workforce.action.hold');
  const memberStationRollups = stationRollups.filter(s => group.stationIds.includes(s.stationId));
  void stationsLookup;
  const GroupIcon = getGroupIcon(group.groupIcon);

  return (
    <div className="hover:bg-slate-50/40 transition-colors">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full p-5 text-start flex items-start gap-4"
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-white shadow-sm"
          style={{ backgroundColor: group.groupColor || '#475569' }}
        >
          <GroupIcon className="w-5 h-5" />
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

          {idealOnly ? (
            // Ideal-only: just the recommendation, no comparison clutter.
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
              <KpiBlock label={t('workforce.rollup.recommendedFTE')} value={group.recommendedFTE.toString()} tone="emerald" />
              <KpiBlock label={t('workforce.rollup.recommendedPT')} value={group.recommendedPartTime.toString()} tone="blue" />
              <KpiBlock
                label={t('workforce.rollup.peakMonth')}
                value={t(MONTH_NAME_KEYS[group.peakMonthIndex - 1])}
                hint={`${group.peakMonthFTE} FTE`}
              />
            </div>
          ) : (
            // v2.2.0 — comparative format: "current / recommended" together,
            // breakdown of recommended (FTE + PT), and the action hint folded
            // into the subtext. 3 columns instead of 5.
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
              <ComparativeKpi
                label={t('workforce.rollup.rosterComparative')}
                current={group.currentEligibleCount}
                recommended={group.recommendedFTE + group.recommendedPartTime}
                currentBreakdown={group.currentPartTimeCount > 0
                  ? t('workforce.rollup.breakdown.ftePt', { fte: group.currentFTECount, pt: group.currentPartTimeCount })
                  : t('workforce.rollup.breakdown.fte', { fte: group.currentFTECount })}
                breakdown={group.recommendedPartTime > 0
                  ? t('workforce.rollup.breakdown.ftePt', { fte: group.recommendedFTE, pt: group.recommendedPartTime })
                  : t('workforce.rollup.breakdown.fte', { fte: group.recommendedFTE })}
                deltaHint={group.action === 'hire'
                  ? t('workforce.role.hireBy', { count: group.delta })
                  : group.action === 'release'
                    ? t('workforce.role.releaseBy', { count: Math.abs(group.delta) })
                    : t('workforce.role.matchesNeed')}
                tone={group.action === 'hire' ? 'rose' : group.action === 'release' ? 'blue' : 'emerald'}
              />
              <KpiBlock
                label={t('workforce.rollup.peakMonth')}
                value={t(MONTH_NAME_KEYS[group.peakMonthIndex - 1])}
                hint={`${group.peakMonthFTE} FTE`}
              />
              <KpiBlock
                label={t('workforce.role.delta')}
                value={`${group.delta > 0 ? '+' : ''}${group.delta}`}
                tone={group.delta > 0 ? 'rose' : 'neutral'}
              />
            </div>
          )}

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
          <div className="ms-14 ps-4 border-s-2 border-slate-200 dark:border-slate-700/60 space-y-3">
            <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('workforce.group.drilldown')}</p>
            {/* v2.6.0 — group-level demand profile matches the per-station
                drill below: same Avg / Median / Peak / Valley tiles for
                FT and PT. Lets the supervisor read the group-level
                picture without summing children manually. */}
            <MonthlyDemandProfile
              monthlyFTE={group.monthlyFTE}
              monthlyPartTime={group.monthlyPartTime}
              recommendedFTE={group.recommendedFTE}
              recommendedPartTime={group.recommendedPartTime}
            />
            {memberStationRollups.map(s => {
              const totalRec = s.recommendedFTE + s.recommendedPartTime;
              // v2.5.0 — surface the *effective* supply (fair-share) so
              // a station with 35 cashiers across a 10-station group
              // reads "3.5 effective / 2 needed" instead of the
              // misleading "35 / 2".
              const effectiveSupply = Math.round((s.effectiveSupplyFTE + s.effectiveSupplyPartTime) * 10) / 10;
              const deltaTone = s.action === 'hire' ? 'text-rose-700 dark:text-rose-300' : s.action === 'release' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300';
              return (
                <div key={s.stationId} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-700/60 p-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{s.stationName}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{Math.round(s.annualRequiredHours).toLocaleString()}h/yr · peak {t(MONTH_NAME_KEYS[s.peakMonthIndex - 1])}</p>
                    </div>
                    {idealOnly ? (
                      // Ideal-only: just the recommendation.
                      <div className="text-end shrink-0">
                        <p className="text-sm font-black text-emerald-700 dark:text-emerald-300">{s.recommendedFTE} FTE</p>
                        {s.recommendedPartTime > 0 && (
                          <p className="text-[10px] text-blue-700 dark:text-blue-300">+ {s.recommendedPartTime} PT</p>
                        )}
                      </div>
                    ) : (
                      // v2.2.0 — comparative: "current / recommended" matches the
                      // parent group row's pattern so the supervisor reads the
                      // drilldown the same way they read the rollup above.
                      // v2.5.0 — headline numbers are now EFFECTIVE supply vs
                      // recommended; raw eligible count moved to the tooltip.
                      <div
                        className="text-end shrink-0"
                        title={t('workforce.rollup.effectiveTooltip', { eligible: s.currentEligibleCount, effective: effectiveSupply })}
                      >
                        <p className="text-sm font-black tabular-nums">
                          <span className="text-slate-500 dark:text-slate-400">{effectiveSupply}</span>
                          <span className="text-slate-300 dark:text-slate-600 mx-0.5">/</span>
                          <span className={deltaTone}>{totalRec}</span>
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                          <span>
                            {s.currentPartTimeCount > 0
                              ? t('workforce.rollup.breakdown.ftePt', { fte: s.currentFTECount, pt: s.currentPartTimeCount })
                              : t('workforce.rollup.breakdown.fte', { fte: s.currentFTECount })}
                          </span>
                          <span className="text-slate-300 dark:text-slate-600 mx-0.5">/</span>
                          <span className={deltaTone}>
                            {s.recommendedPartTime > 0
                              ? t('workforce.rollup.breakdown.ftePt', { fte: s.recommendedFTE, pt: s.recommendedPartTime })
                              : t('workforce.rollup.breakdown.fte', { fte: s.recommendedFTE })}
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                  {/* v2.6.0 — annual demand profile (Avg / Median / Peak / Valley)
                      per station, split FT vs PT. The same view the top-level
                      Annual Headcount Plan offers, scoped to this single station. */}
                  <MonthlyDemandProfile
                    monthlyFTE={s.monthlyFTE}
                    monthlyPartTime={s.monthlyPartTime}
                    recommendedFTE={s.recommendedFTE}
                    recommendedPartTime={s.recommendedPartTime}
                  />
                </div>
              );
            })}
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
  // v2.6.0 — expandable to surface the FT/PT demand profile, mirroring
  // the group-row drilldown behaviour. Rows start collapsed; the chevron
  // and the row-wide click both toggle.
  const [expanded, setExpanded] = useState(false);
  const actionTone =
    station.action === 'hire' ? { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', Icon: TrendingUp }
      : station.action === 'release' ? { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', Icon: AlertTriangle }
      : { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', Icon: Minus };
  const ActionIcon = actionTone.Icon;
  const actionLabel = station.action === 'hire'
    ? t('workforce.action.hire')
    : station.action === 'release' ? t('workforce.action.release') : t('workforce.action.hold');

  return (
    <div className="hover:bg-slate-50/40 dark:hover:bg-slate-800/30 transition-colors">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full p-5 text-start flex items-start gap-4"
      >
        <div className="w-11 h-11 rounded-xl bg-slate-900 dark:bg-slate-700 text-white flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 tracking-tight">{station.stationName}</h3>
            {station.roleHint && (
              <span className="text-[9px] font-bold text-slate-500 dark:text-slate-300 uppercase tracking-widest bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                {station.roleHint}
              </span>
            )}
            <div className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded-lg border", actionTone.bg, actionTone.border)}>
              <ActionIcon className={cn("w-3 h-3", actionTone.text)} />
              <span className={cn("text-[9px] font-black uppercase tracking-widest", actionTone.text)}>{actionLabel}</span>
            </div>
          </div>

          {idealOnly ? (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
              <KpiBlock label={t('workforce.rollup.recommendedFTE')} value={station.recommendedFTE.toString()} tone="emerald" />
              <KpiBlock label={t('workforce.rollup.recommendedPT')} value={station.recommendedPartTime.toString()} tone="blue" />
              <KpiBlock
                label={t('workforce.rollup.peakMonth')}
                value={t(MONTH_NAME_KEYS[station.peakMonthIndex - 1])}
                hint={`${station.peakMonthFTE} FTE`}
              />
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
              <ComparativeKpi
                label={t('workforce.rollup.rosterComparative')}
                current={station.currentEligibleCount}
                recommended={station.recommendedFTE + station.recommendedPartTime}
                currentBreakdown={station.currentPartTimeCount > 0
                  ? t('workforce.rollup.breakdown.ftePt', { fte: station.currentFTECount, pt: station.currentPartTimeCount })
                  : t('workforce.rollup.breakdown.fte', { fte: station.currentFTECount })}
                breakdown={station.recommendedPartTime > 0
                  ? t('workforce.rollup.breakdown.ftePt', { fte: station.recommendedFTE, pt: station.recommendedPartTime })
                  : t('workforce.rollup.breakdown.fte', { fte: station.recommendedFTE })}
                deltaHint={station.action === 'hire'
                  ? t('workforce.role.hireBy', { count: station.delta })
                  : station.action === 'release'
                    ? t('workforce.role.releaseBy', { count: Math.abs(station.delta) })
                    : t('workforce.role.matchesNeed')}
                tone={station.action === 'hire' ? 'rose' : station.action === 'release' ? 'blue' : 'emerald'}
              />
              <KpiBlock
                label={t('workforce.rollup.peakMonth')}
                value={t(MONTH_NAME_KEYS[station.peakMonthIndex - 1])}
                hint={`${station.peakMonthFTE} FTE`}
              />
              <KpiBlock
                label={t('workforce.role.delta')}
                value={`${station.delta > 0 ? '+' : ''}${station.delta}`}
                tone={station.delta > 0 ? 'rose' : 'neutral'}
              />
            </div>
          )}

          <div className="p-3 rounded-lg bg-slate-50/60 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/60 flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-relaxed">{station.reasoning}</p>
          </div>
        </div>
        <div className="shrink-0 pt-1">
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400 dark:text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
        </div>
      </button>

      {/* v2.6.0 — drilldown profile (Avg / Median / Peak / Valley FT & PT)
          for the standalone (no-group) station rollup. Same MonthlyDemandProfile
          component as inside RollupGroupRow so behaviour stays consistent. */}
      {expanded && (
        <div className="px-5 pb-5 -mt-2">
          <div className="ms-14 ps-4 border-s-2 border-slate-200 dark:border-slate-700/60">
            <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
              {t('workforce.headcount.profile.title')}
            </p>
            <MonthlyDemandProfile
              monthlyFTE={station.monthlyFTE}
              monthlyPartTime={station.monthlyPartTime}
              recommendedFTE={station.recommendedFTE}
              recommendedPartTime={station.recommendedPartTime}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// v2.2.0 — drilldown panel for the bar a user clicked. Renders the
// month's required hours, recommended mix, monthly salary, and the top
// 3 roles driving the demand so the supervisor can answer "why does
// August spike?" without leaving the planning view.
function MonthDrilldownPanel({
  month, annual, fmtIQD,
}: {
  month: MonthlyPlanSummary;
  annual: ReturnType<typeof analyzeWorkforceAnnual>;
  fmtIQD: (n: number) => string;
}) {
  const { t } = useI18n();
  const isPeak = month.monthIndex === annual.peakMonthIndex;
  const isValley = month.monthIndex === annual.valleyMonthIndex;
  const peakHours = annual.byMonth[annual.peakMonthIndex - 1].monthlyRequiredHours;
  const pctOfPeak = peakHours > 0 ? Math.round((month.monthlyRequiredHours / peakHours) * 100) : 0;
  const monthName = t(MONTH_NAME_KEYS[month.monthIndex - 1]);

  // Top 3 roles by required-hours for this month — answers "what's driving
  // the demand?". Filters out roles with zero hours so the list isn't
  // padded with empties for venues with only a couple of active roles.
  const topRoles = [...month.plan.byRole]
    .filter(r => r.monthlyRequiredHours > 0)
    .sort((a, b) => b.monthlyRequiredHours - a.monthlyRequiredHours)
    .slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h4 className="text-base font-bold text-slate-800 tracking-tight">{t('workforce.drilldown.title')}: {monthName}</h4>
        {isPeak && (
          <span className="text-[9px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded uppercase tracking-widest">
            {t('workforce.drilldown.peakBadge')}
          </span>
        )}
        {isValley && (
          <span className="text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded uppercase tracking-widest">
            {t('workforce.drilldown.valleyBadge')}
          </span>
        )}
        {!isPeak && !isValley && (
          <span className="text-[10px] text-slate-500 font-mono">{t('workforce.drilldown.vsPeak', { pct: pctOfPeak })}</span>
        )}
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <div>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('workforce.drilldown.requiredHours')}</p>
          <p className="text-2xl font-black text-slate-800 tabular-nums">{Math.round(month.monthlyRequiredHours).toLocaleString()}h</p>
        </div>
        <div>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('workforce.drilldown.recommendedRoster')}</p>
          <p className="text-2xl font-black text-emerald-700 tabular-nums">{month.recommendedFTE + month.recommendedPartTime}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {month.recommendedPartTime > 0
              ? t('workforce.rollup.breakdown.ftePt', { fte: month.recommendedFTE, pt: month.recommendedPartTime })
              : t('workforce.rollup.breakdown.fte', { fte: month.recommendedFTE })}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('workforce.drilldown.salary')}</p>
          <p className="text-2xl font-black text-slate-800 tabular-nums">{fmtIQD(month.recommendedMonthlySalary)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">IQD / mo</p>
        </div>
      </div>

      {/* v5.18.0 — leave-aware effective HC banner. Surfaced only when
          the month has any planned leave; tells the supervisor that the
          "you have N FTE" baseline is misleading because part of that
          headcount is on leave that month. The decimal FTE-loss is
          conservative — counts every leave day at face value (no
          weekend / off-day discount), which matches how the auto-
          scheduler treats leave (a leave day is unavailable regardless). */}
      {(month.plannedLeaveFTELoss > 0 || month.projectedLeaveFTELoss > 0) && (
        <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg space-y-2">
          {month.plannedLeaveFTELoss > 0 && (
            <>
              <div className="flex items-start gap-2">
                <span className="text-[9px] font-black text-amber-700 dark:text-amber-200 uppercase tracking-widest">
                  {t('workforce.drilldown.leaveImpact.title')}
                </span>
              </div>
              <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
                {t('workforce.drilldown.leaveImpact.body', {
                  fte: month.plannedLeaveFTELoss.toFixed(2),
                  affected: month.affectedEmployeeCount,
                })}
              </p>
              {(month.plannedLeaveBreakdown.annual > 0
                || month.plannedLeaveBreakdown.sick > 0
                || month.plannedLeaveBreakdown.maternity > 0) && (
                <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  {month.plannedLeaveBreakdown.annual > 0 && (
                    <span>{t('payroll.leaveType.annual')}: <span className="font-bold">{month.plannedLeaveBreakdown.annual.toFixed(2)}</span></span>
                  )}
                  {month.plannedLeaveBreakdown.sick > 0 && (
                    <span>{t('payroll.leaveType.sick')}: <span className="font-bold">{month.plannedLeaveBreakdown.sick.toFixed(2)}</span></span>
                  )}
                  {month.plannedLeaveBreakdown.maternity > 0 && (
                    <span>{t('payroll.leaveType.maternity')}: <span className="font-bold">{month.plannedLeaveBreakdown.maternity.toFixed(2)}</span></span>
                  )}
                </div>
              )}
            </>
          )}

          {/* v5.19.0 — projected unscheduled annual-leave loss. Distinct
              from the explicit-leave block above: this number reflects
              EACH employee's remaining leave balance distributed evenly
              across the months left in the forecast year. The
              supervisor reads it as "even before anyone schedules a
              specific leave, you can expect this much FTE off the
              floor" — useful for hiring decisions because it captures
              the inevitability of the 21-day annual leave entitlement. */}
          {month.projectedLeaveActive && month.projectedLeaveFTELoss > 0 && (
            <div className="pt-1.5 border-t border-amber-200/60 dark:border-amber-500/20">
              <p className="text-[9px] font-black text-amber-700 dark:text-amber-200 uppercase tracking-widest mb-1">
                {t('workforce.drilldown.projectedLeave.title')}
              </p>
              <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
                {t('workforce.drilldown.projectedLeave.body', {
                  fte: month.projectedLeaveFTELoss.toFixed(2),
                })}
              </p>
            </div>
          )}
        </div>
      )}

      {topRoles.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{t('workforce.drilldown.topRoles')}</p>
          <div className="space-y-1.5">
            {topRoles.map(r => {
              const pct = month.monthlyRequiredHours > 0 ? Math.round((r.monthlyRequiredHours / month.monthlyRequiredHours) * 100) : 0;
              return (
                <div key={r.role} className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-slate-700 w-28 truncate">{r.role}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 w-20 text-end">
                    {Math.round(r.monthlyRequiredHours).toLocaleString()}h ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// v2.4.0 — Hiring Roadmap section. Surfaces the month-by-month
// recruitment plan: a savings-vs-naive headline + a 12-bucket timeline
// showing FTE/PT adds, releases, end-of-month roster, and per-month
// reasoning. Conservative mode shows only FTE adds; optimal adds PT
// adds AND releases as scaling tools.
function HiringRoadmapSection({
  roadmap, mode, fmtIQD,
}: {
  roadmap: HiringRoadmap;
  mode: PlanMode;
  fmtIQD: (n: number) => string;
}) {
  const { t } = useI18n();
  const [expandedReasoning, setExpandedReasoning] = useState(false);
  const peakRoster = Math.max(1, ...roadmap.steps.map(s => s.fteEnd + s.ptEnd));
  const savingsPct = roadmap.baselineAnnualCost > 0
    ? Math.round((roadmap.savingsVsBaseline / roadmap.baselineAnnualCost) * 100)
    : 0;

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-start gap-3 flex-wrap">
        <Activity className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">{t('workforce.roadmap.title')}</h3>
          <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{t('workforce.roadmap.subtitle')}</p>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Headline KPI strip — savings is the punchline. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
            <p className="text-[9px] font-black text-rose-700 uppercase tracking-widest">{t('workforce.roadmap.kpi.totalFteAdds')}</p>
            <p className="text-2xl font-black text-rose-700 tabular-nums">+{roadmap.totalFTEAdds}</p>
            <p className="text-[9px] text-rose-600 mt-0.5">{t('workforce.roadmap.kpi.fteSub')}</p>
          </div>
          {mode === 'optimal' ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-[9px] font-black text-blue-700 uppercase tracking-widest">{t('workforce.roadmap.kpi.totalPtMovement')}</p>
              <p className="text-2xl font-black text-blue-700 tabular-nums">+{roadmap.totalPTAdds} / −{roadmap.totalPTReleases}</p>
              <p className="text-[9px] text-blue-600 mt-0.5">{t('workforce.roadmap.kpi.ptSub')}</p>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">{t('workforce.roadmap.kpi.peakRoster')}</p>
              <p className="text-2xl font-black text-slate-800 tabular-nums">{roadmap.peakFTE}</p>
              <p className="text-[9px] text-slate-500 mt-0.5">{t('workforce.roadmap.kpi.peakRosterSub')}</p>
            </div>
          )}
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">{t('workforce.roadmap.kpi.savings')}</p>
            <p className="text-2xl font-black text-emerald-700 tabular-nums">{fmtIQD(roadmap.savingsVsBaseline)}</p>
            <p className="text-[9px] text-emerald-600 mt-0.5">{t('workforce.roadmap.kpi.savingsSub', { pct: savingsPct })}</p>
          </div>
          <div className="bg-slate-900 text-white border-0 rounded-lg p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-blue-300">{t('workforce.roadmap.kpi.smartCost')}</p>
            <p className="text-2xl font-black tabular-nums">{fmtIQD(roadmap.smartAnnualCost)}</p>
            <p className="text-[9px] text-slate-400 mt-0.5">{t('workforce.roadmap.kpi.smartCostSub', { vs: fmtIQD(roadmap.baselineAnnualCost) })}</p>
          </div>
        </div>

        {/* Timeline: 12 month buckets with bar chart + adds/releases chips. */}
        <div className="grid grid-cols-12 gap-1.5">
          {roadmap.steps.map(step => (
            <RoadmapMonthBar key={step.monthIndex} step={step} mode={mode} peakRoster={peakRoster} />
          ))}
        </div>

        {/* Reasoning list. Collapsed to first 6 by default — most months
            are "hold" rows the supervisor can skim. Expand to see the
            full year. */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{t('workforce.roadmap.reasoning.title')}</p>
            <button
              onClick={() => setExpandedReasoning(e => !e)}
              className="text-[9px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-700 transition-colors"
            >
              {expandedReasoning ? t('workforce.roadmap.reasoning.collapse') : t('workforce.roadmap.reasoning.expand')}
            </button>
          </div>
          <div className="space-y-1">
            {(expandedReasoning ? roadmap.steps : roadmap.steps.filter(s => s.fteAdds > 0 || s.ptAdds > 0 || s.ptReleases > 0)).map(step => (
              <div key={step.monthIndex} className="flex items-start gap-3 p-2 rounded-md bg-slate-50 border border-slate-100">
                <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest w-10 shrink-0 pt-0.5">{step.monthName}</span>
                <p className="text-[11px] text-slate-700 leading-relaxed flex-1">{step.reasoning}</p>
              </div>
            ))}
            {!expandedReasoning && roadmap.steps.every(s => s.fteAdds === 0 && s.ptAdds === 0 && s.ptReleases === 0) && (
              <p className="text-[10px] text-slate-400 italic p-2">{t('workforce.roadmap.reasoning.noActions')}</p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// One vertical bar in the roadmap timeline. Stacks FTE (slate) + PT
// (blue) up to the peak roster. Adds chips above the bar; releases
// chip below (rose) when PT contracts end.
function RoadmapMonthBar({
  step, mode, peakRoster,
}: {
  step: MonthlyHiringStep;
  mode: PlanMode;
  peakRoster: number;
}) {
  const total = step.fteEnd + step.ptEnd;
  const ftePct = peakRoster > 0 ? (step.fteEnd / peakRoster) * 100 : 0;
  const ptPct = peakRoster > 0 ? (step.ptEnd / peakRoster) * 100 : 0;
  const totalPct = peakRoster > 0 ? (total / peakRoster) * 100 : 0;
  const hasAction = step.fteAdds > 0 || step.ptAdds > 0 || step.ptReleases > 0;

  return (
    <div
      className={cn(
        'flex flex-col items-stretch p-1.5 rounded-lg transition-all',
        hasAction ? 'bg-rose-50/40' : 'hover:bg-slate-50',
      )}
      title={`${step.monthName}: ${step.fteEnd} FTE${mode === 'optimal' && step.ptEnd > 0 ? ` + ${step.ptEnd} PT` : ''}\n${step.reasoning}`}
    >
      {/* Adds chips — stack above the bar. */}
      <div className="min-h-[18px] flex flex-col items-center gap-0.5">
        {step.fteAdds > 0 && (
          <span className="text-[8px] font-black bg-rose-600 text-white px-1.5 py-0.5 rounded-full leading-none">+{step.fteAdds} FT</span>
        )}
        {step.ptAdds > 0 && (
          <span className="text-[8px] font-black bg-blue-600 text-white px-1.5 py-0.5 rounded-full leading-none">+{step.ptAdds} PT</span>
        )}
      </div>
      {/* Vertical bar. */}
      <div className="flex items-end h-24 mt-1">
        <div className="w-full flex flex-col-reverse rounded-md overflow-hidden" style={{ height: `${Math.max(4, totalPct)}%` }}>
          <div className="bg-slate-700" style={{ flexBasis: `${(ftePct / Math.max(1, totalPct)) * 100}%` }} />
          {mode === 'optimal' && step.ptEnd > 0 && (
            <div className="bg-blue-500" style={{ flexBasis: `${(ptPct / Math.max(1, totalPct)) * 100}%` }} />
          )}
        </div>
      </div>
      {/* Roster count + month label. */}
      <p className="text-[10px] font-black text-slate-700 mt-1.5 text-center tabular-nums">{step.fteEnd}{mode === 'optimal' && step.ptEnd > 0 ? `+${step.ptEnd}` : ''}</p>
      <p className="text-[9px] font-black text-slate-500 text-center uppercase tracking-widest leading-tight">{step.monthName}</p>
      {/* Releases chip — below label so it doesn't crowd the adds. */}
      <div className="min-h-[14px] flex items-center justify-center mt-1">
        {step.ptReleases > 0 && (
          <span className="text-[8px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-full leading-none">−{step.ptReleases} PT</span>
        )}
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

// v2.1.4 — i18n keys for short month names. The on-screen rollup peak-pills
// resolve via `t()` inside the components; the PDF export keeps an English
// constant since it's a shareable document the user typically wants in
// English regardless of UI locale.
const MONTH_NAME_KEYS = [
  'common.month.short.jan', 'common.month.short.feb', 'common.month.short.mar', 'common.month.short.apr',
  'common.month.short.may', 'common.month.short.jun', 'common.month.short.jul', 'common.month.short.aug',
  'common.month.short.sep', 'common.month.short.oct', 'common.month.short.nov', 'common.month.short.dec',
];
const MONTH_NAMES_PDF = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// v5.19.0 — small formatter for the Coverage Scenario PDF section.
// Mirrors the on-screen `fmtHour` in CoverageScenarioPanel so the PDF
// renders the same "11:00–23:00" style.
function formatHourPDF(h: number): string {
  if (h >= 24) return '24:00';
  const hh = Math.max(0, Math.min(24, h | 0));
  return `${String(hh).padStart(2, '0')}:00`;
}

// PDF export. Renders the current rollup + KPI strip into a portrait A4
// document and triggers a download. Uses jspdf + jspdf-autotable (already
// shipped for compliance reports).
async function exportWorkforcePlanToPDF(args: {
  annual: ReturnType<typeof analyzeWorkforceAnnual>;
  rollup: ReturnType<typeof buildAnnualRollup>;
  // v2.4.0 — month-by-month plan included as a dedicated section so the
  // PDF reader sees the same WHEN-to-hire timing the on-screen view
  // shows. Optional so legacy callers still compile.
  roadmap?: HiringRoadmap;
  mode: PlanMode;
  idealOnly: boolean;
  fmtIQD: (n: number) => string;
  // v5.19.0 — Coverage Scenario data so the PDF reader sees per-station
  // peak-day timeline + roster-required math the on-screen panel shows.
  scenarios?: Array<import('../lib/coverageScenario').StationScenario>;
}) {
  const { annual, rollup, roadmap, mode, fmtIQD, scenarios } = args;
  const { jsPDF } = await import('jspdf');
  const autoTableMod = await import('jspdf-autotable');
  // jspdf-autotable v5 ships as `export default` from ESM; the bundler
  // sometimes wraps it in a CJS-style namespace, so accept either shape.
  type AutoTableFn = (doc: InstanceType<typeof jsPDF>, opts: Record<string, unknown>) => void;
  const autoTable = (autoTableMod as unknown as { default: AutoTableFn }).default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // v5.19.1 — Arabic-text awareness. jsPDF's bundled Helvetica font
  // doesn't carry Arabic glyphs; any Arabic station / role / name in
  // the source data renders as mojibake. We detect that here and add
  // a clear warning banner to the PDF so the recipient understands
  // the symbols aren't a corruption — and direct them to the Excel
  // export which renders Arabic correctly. v5.20+ will embed an
  // Arabic-capable font; this is the patch-level mitigation.
  const arabicRegex = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  const hasArabicData = (() => {
    if (rollup.byStation.some(s => arabicRegex.test(s.stationName) || arabicRegex.test(s.roleHint || ''))) return true;
    if (rollup.byGroup.some(g => arabicRegex.test(g.groupName))) return true;
    if (scenarios?.some(s => arabicRegex.test(s.stationName))) return true;
    return false;
  })();

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Workforce Plan', 14, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Year: ${annual.year}`, 14, 25);
  doc.text(`Mode: ${mode === 'conservative' ? 'Conservative (FTE-only, hire-to-peak)' : 'Optimal (FTE + part-time mix)'}`, 14, 30);
  doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`, 14, 35);

  // Arabic warning banner — only when Arabic data is detected.
  if (hasArabicData) {
    doc.setFillColor(254, 243, 199); // amber-100
    doc.rect(14, 38, 182, 12, 'F');
    doc.setFontSize(8);
    doc.setTextColor(146, 64, 14); // amber-800
    doc.setFont('helvetica', 'bold');
    doc.text('Arabic text limitation:', 17, 43);
    doc.setFont('helvetica', 'normal');
    const warningLines = doc.splitTextToSize(
      'Arabic station / group names render as placeholder symbols in this PDF (jsPDF font limitation). For a fully readable bilingual report, use the Excel export — it renders Arabic natively and includes the same data.',
      178,
    );
    doc.text(warningLines, 17, 47);
    doc.setTextColor(0);
  }

  // Summary KPIs — Y offset shifts when the Arabic warning banner ate
  // the 38–50mm strip above.
  const summaryYStart = hasArabicData ? 60 : 45;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Annual Summary', 14, summaryYStart);
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
  let cursor = summaryYStart + 5;
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
      MONTH_NAMES_PDF[s.peakMonthIndex - 1],
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
    // v5.19.0 — added projected leave columns so PDF readers see the
    // full labor-availability picture, not just demand-driven HC.
    head: [['Month', 'Required hrs', 'Rec. FTE', 'Rec. PT', 'Planned leave FTE', 'Projected AL FTE', 'Salary (IQD)']],
    body: annual.byMonth.map(m => [
      m.monthName,
      Math.round(m.monthlyRequiredHours).toLocaleString(),
      m.recommendedFTE.toString(),
      m.recommendedPartTime.toString(),
      m.plannedLeaveFTELoss > 0 ? `−${m.plannedLeaveFTELoss.toFixed(2)}` : '—',
      m.projectedLeaveActive && m.projectedLeaveFTELoss > 0
        ? `−${m.projectedLeaveFTELoss.toFixed(2)}`
        : '—',
      Math.round(m.recommendedMonthlySalary).toLocaleString(),
    ]),
    headStyles: { fillColor: [37, 99, 235], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  });

  // v2.4.0 — Hiring Roadmap section. Two-part: a savings headline +
  // the per-month action table. Goes on its own page so the recruitment
  // team can hand it directly to HR/Finance for sign-off.
  if (roadmap) {
    doc.addPage();
    cursor = 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Hiring Roadmap', 14, cursor);
    cursor += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const savingsPct = roadmap.baselineAnnualCost > 0
      ? Math.round((roadmap.savingsVsBaseline / roadmap.baselineAnnualCost) * 100)
      : 0;
    const headlineLines = [
      `Total movements: +${roadmap.totalFTEAdds} FTE${mode === 'optimal' ? `, +${roadmap.totalPTAdds} PT, −${roadmap.totalPTReleases} PT releases` : ''}.`,
      `Phased plan annual cost: ${fmtIQD(roadmap.smartAnnualCost)} IQD.`,
      `Hire-everyone-in-Jan baseline: ${fmtIQD(roadmap.baselineAnnualCost)} IQD.`,
      `Savings vs baseline: ${fmtIQD(roadmap.savingsVsBaseline)} IQD/yr (${savingsPct}%).`,
      `Lead time assumed: ${roadmap.leadMonths} month(s) — hires placed in month X are productive in month X+${roadmap.leadMonths}.`,
    ];
    for (const ln of headlineLines) { doc.text(ln, 14, cursor); cursor += 5; }
    cursor += 2;
    autoTable(doc, {
      startY: cursor,
      head: [['Month', '+FTE', '+PT', '−PT', 'FTE end', 'PT end', 'Need FTE/PT', 'Cost (IQD)', 'Action / reasoning']],
      body: roadmap.steps.map(s => [
        s.monthName,
        s.fteAdds > 0 ? `+${s.fteAdds}` : '—',
        s.ptAdds > 0 ? `+${s.ptAdds}` : '—',
        s.ptReleases > 0 ? `−${s.ptReleases}` : '—',
        s.fteEnd.toString(),
        s.ptEnd.toString(),
        `${s.monthlyRequiredFTE} / ${s.monthlyRequiredPT}`,
        Math.round(s.monthlyCost).toLocaleString(),
        s.reasoning,
      ]),
      headStyles: { fillColor: [15, 23, 42], fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      didParseCell: (data: { section?: string; row?: { index?: number }; cell: { styles: { fillColor?: number[] } } }) => {
        if (data.section === 'body' && typeof data.row?.index === 'number') {
          const step = roadmap.steps[data.row.index];
          if (step && (step.fteAdds > 0 || step.ptAdds > 0)) {
            data.cell.styles.fillColor = [254, 226, 226]; // rose-100
          } else if (step && step.ptReleases > 0) {
            data.cell.styles.fillColor = [254, 243, 199]; // amber-100
          }
        }
      },
      columnStyles: {
        0: { cellWidth: 14 }, 1: { cellWidth: 12 }, 2: { cellWidth: 12 }, 3: { cellWidth: 12 },
        4: { cellWidth: 14 }, 5: { cellWidth: 14 }, 6: { cellWidth: 18 }, 7: { cellWidth: 22 },
        8: { cellWidth: 'auto' },
      },
      styles: { overflow: 'linebreak' },
      margin: { left: 14, right: 14 },
    });
  }

  // v5.19.0 — Coverage Scenario section. One page summarising the
  // single peak-day walkthrough per station + the roster-required
  // formula. Skipped when no scenarios were passed (legacy callers).
  if (scenarios && scenarios.length > 0) {
    doc.addPage();
    cursor = 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Coverage Scenario (peak day)', 14, cursor);
    cursor += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const scenarioIntro = 'Per-station peak-day walkthrough showing how existing shifts cover demand, plus the roster size required to keep coverage continuous through Art. 71 weekly rest and Art. 43 annual leave.';
    const introLines = doc.splitTextToSize(scenarioIntro, 180);
    doc.text(introLines, 14, cursor);
    cursor += introLines.length * 4 + 4;

    autoTable(doc, {
      startY: cursor,
      head: [['Station', 'Open', 'Shifts', 'Peak HC', 'Gap hrs', 'Roster req.', 'Why']],
      body: scenarios.map(s => [
        s.stationName,
        `${formatHourPDF(s.openingHour)}–${formatHourPDF(s.closingHour)}`,
        s.coveringShifts.map(c => c.code).join(' · ') || '—',
        s.peakConcurrentHC.toString(),
        s.uncoveredHours > 0 ? s.uncoveredHours.toString() : '—',
        s.rosterRequired.bufferedRoster.toString(),
        s.rosterRequired.explanation,
      ]),
      headStyles: { fillColor: [16, 185, 129], fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 28 }, 1: { cellWidth: 22 }, 2: { cellWidth: 28 },
        3: { cellWidth: 14 }, 4: { cellWidth: 14 }, 5: { cellWidth: 18 },
        6: { cellWidth: 'auto' },
      },
      styles: { overflow: 'linebreak' },
      margin: { left: 14, right: 14 },
    });
  }

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
