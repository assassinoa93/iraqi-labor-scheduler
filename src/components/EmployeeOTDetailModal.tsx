import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { X, Clock, Calendar as CalendarIcon, AlertTriangle, Info } from 'lucide-react';
import { format } from 'date-fns';
import { Employee, Shift, Schedule, PublicHoliday, Config } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';
import { monthlyHourCap, baseHourlyRate } from '../lib/payroll';
import { computeHolidayPay } from '../lib/holidayCompPay';

// v5.6.0 — drill-down for the "Who burned the OT" card on the Coverage / OT
// Analysis tab. Pre-v5.6 the card showed only month-level rollup numbers
// (over-cap hours, holiday hours, total OT pay) — the supervisor had no way
// to answer "which days?" without flipping back to the schedule grid and
// counting cells by hand. This modal walks the active month day-by-day and
// surfaces every worked day for the selected employee, plus a running
// cumulative-hours-vs-cap line so the day the cap was crossed is obvious.
//
// Holidays render in amber; days that pushed the running total past the cap
// render in rose. Comp-day (CP) and leave (AL/SL/MAT/OFF) cells appear too —
// they're non-work but show in the timeline so the overall pattern is
// readable. Station chips show where the hours landed.
//
// Sticky modal: backdrop click does NOT dismiss (per the v5.3.1 form-modal
// pattern); only the X button, Cancel button, or Esc close it.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  employee: Employee | null;
  schedule: Schedule;
  shifts: Shift[];
  config: Config;
  holidays: PublicHoliday[];
  // Pre-computed totals from analyzeOT() so the modal stays consistent with
  // the card the user clicked from. We don't recompute these here.
  totalHours: number;
  payableOverCapHours: number;
  holidayHours: number;
  totalOTPay: number;
  // v5.6.0 — extra context for the "why OT?" callout. premiumHolidayHours is
  // the subset of holiday hours where the 2× cash premium IS owed (cash-ot
  // mode, both mode, or comp-day mode where the comp window expired).
  // Anything else is comp-day-compensated and contributes 0 to OT pay.
  premiumHolidayHours: number;
  overCapPay: number;
  holidayPay: number;
  // Optional station name lookup for nicer chips than raw IDs.
  stationNameById?: Map<string, string>;
  // Cross-month visibility for the comp-window check — same as the OT analysis
  // pipeline. Without this, late-month holidays falsely report premium owed.
  allSchedules?: Record<string, Schedule>;
}

interface DayRow {
  day: number;
  date: string;
  dayOfWeek: string;
  shiftCode: string;
  isWork: boolean;
  hours: number;
  stationId?: string;
  isHoliday: boolean;
  cumulative: number;
  pushedOverCap: boolean;
}

export function EmployeeOTDetailModal({
  isOpen, onClose, employee, schedule, shifts, config, holidays,
  totalHours, payableOverCapHours, holidayHours, totalOTPay,
  premiumHolidayHours, overCapPay, holidayPay,
  stationNameById, allSchedules,
}: Props) {
  const { t } = useI18n();
  useModalKeys(isOpen, onClose);

  const cap = monthlyHourCap(config);

  // v5.6.0 — per-holiday breakdown so the modal can show, for each holiday
  // the employee worked, whether the premium is owed (and why) vs.
  // compensated by a comp day landing in the window. Same source of truth
  // (computeHolidayPay) the rest of payroll/dashboard already uses, so
  // numbers can't diverge.
  const holidayBreakdown = useMemo(() => {
    if (!employee) return null;
    const hourly = baseHourlyRate(employee, config);
    return computeHolidayPay(employee, schedule, shifts, holidays, config, hourly, allSchedules);
  }, [employee, schedule, shifts, holidays, config, allSchedules]);
  // Map date → premium-owed flag + comp-day offset for fast per-row lookup.
  const holidayMetaByDate = useMemo(() => {
    const m = new Map<string, { premiumOwed: boolean; compDayOffset: number | null }>();
    for (const ph of holidayBreakdown?.perHoliday || []) {
      m.set(ph.date, { premiumOwed: ph.premiumOwed, compDayOffset: ph.compDayOffset });
    }
    return m;
  }, [holidayBreakdown]);

  // Walk the schedule day by day, building per-row data + running cumulative
  // hours so we can flag the exact day the cap was crossed.
  const rows = useMemo<DayRow[]>(() => {
    if (!employee) return [];
    const empSched = schedule[employee.empId] || {};
    const shiftByCode = new Map(shifts.map(s => [s.code, s]));
    const holidayDates = new Set(holidays
      .filter(h => h.date.startsWith(`${config.year}-${String(config.month).padStart(2, '0')}-`))
      .map(h => h.date));
    const days: DayRow[] = [];
    let cumulative = 0;
    for (let day = 1; day <= config.daysInMonth; day++) {
      const entry = empSched[day];
      if (!entry) continue;
      const shift = shiftByCode.get(entry.shiftCode);
      const hours = shift?.isWork ? shift.durationHrs : 0;
      const date = new Date(config.year, config.month - 1, day);
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayOfWeek = format(date, 'EEE');
      const isHoliday = holidayDates.has(dateStr);
      // The cap-crossing day is the FIRST day where cumulative+hours > cap
      // and cumulative was still <= cap. That gets the "pushed over" flag.
      // Days after the crossing also contribute to OT; flag all of them so
      // the supervisor sees the OT region as a continuous block.
      const willCross = cumulative + hours > cap && hours > 0;
      cumulative += hours;
      days.push({
        day,
        date: dateStr,
        dayOfWeek,
        shiftCode: entry.shiftCode,
        isWork: !!shift?.isWork,
        hours,
        stationId: entry.stationId,
        isHoliday,
        cumulative,
        pushedOverCap: willCross,
      });
    }
    return days;
  }, [employee, schedule, shifts, holidays, config, cap]);

  if (!isOpen || !employee) return null;

  const monthStr = format(new Date(config.year, config.month - 1, 1), 'MMMM yyyy');
  const workRows = rows.filter(r => r.isWork);
  // Hours per station, sorted desc for the small footer rollup.
  const byStation = new Map<string, number>();
  for (const r of workRows) {
    const k = r.stationId || '__unassigned__';
    byStation.set(k, (byStation.get(k) || 0) + r.hours);
  }
  const stationRollup = Array.from(byStation.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, hrs]) => ({
      id,
      name: id === '__unassigned__'
        ? t('otDetail.station.unassigned')
        : (stationNameById?.get(id) ?? id),
      hours: hrs,
    }));

  // Index of the first day where cumulative crossed the cap (for the
  // "Cap reached on day X" callout). Null if the worker never crossed.
  const capCrossDay = workRows.find(r => r.pushedOverCap)?.day ?? null;

  // v5.3.1 sticky-modal pattern: backdrop click does NOT dismiss.
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('otDetail.title')}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="p-5 border-b border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate">{employee.name}</h3>
              <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{employee.empId} · {monthStr}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors shrink-0">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {/* Top KPI strip — consistent with what the card showed. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-slate-100 dark:border-slate-700/60 shrink-0">
          <KpiTile label={t('otDetail.kpi.totalHours')} value={`${totalHours.toFixed(1)}h`} sub={t('otDetail.kpi.cap', { cap })} />
          <KpiTile label={t('otDetail.kpi.overCap')} value={`${payableOverCapHours.toFixed(1)}h`} tone={payableOverCapHours > 0 ? 'rose' : undefined} />
          <KpiTile label={t('otDetail.kpi.holiday')} value={`${holidayHours.toFixed(1)}h`} tone={holidayHours > 0 ? 'amber' : undefined} />
          <KpiTile label={t('otDetail.kpi.otPay')} value={Math.round(totalOTPay).toLocaleString()} sub="IQD" tone={totalOTPay > 0 ? 'rose' : undefined} />
        </div>

        {capCrossDay !== null && (
          <div className="px-4 py-2 border-b border-rose-100 dark:border-rose-500/30 bg-rose-50/60 dark:bg-rose-500/10 text-[11px] font-bold text-rose-700 dark:text-rose-200 flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-3.5 h-3.5" />
            {t('otDetail.capCrossed', { day: capCrossDay })}
          </div>
        )}

        {/* v5.6.0 — "Why OT?" explainer. Decomposes the OT pay into the two
            independent reasons (over-cap hours vs. holiday premium) so the
            supervisor can answer "is this because they worked a holiday or
            because they actually went over their monthly cap?" at a glance.
            Each line cites the exact mechanism + the relevant Art. 74 / Art.
            70 hook so the explanation is auditable. */}
        {(payableOverCapHours > 0 || premiumHolidayHours > 0) && (
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/40 dark:bg-slate-800/20 shrink-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 mb-2 flex items-center gap-1.5">
              <Info className="w-3 h-3" /> {t('otDetail.why.title')}
            </p>
            <div className="space-y-1.5 text-[11px]">
              {payableOverCapHours > 0 && (
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-sm bg-rose-500 mt-1 shrink-0" />
                  <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                    <span className="font-bold">{t('otDetail.why.overCap.title', { hrs: payableOverCapHours.toFixed(1), pay: Math.round(overCapPay).toLocaleString() })}</span>
                    {' '}
                    <span className="text-slate-500 dark:text-slate-400">{t('otDetail.why.overCap.body', { cap })}</span>
                  </p>
                </div>
              )}
              {premiumHolidayHours > 0 && (
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-sm bg-amber-500 mt-1 shrink-0" />
                  <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                    <span className="font-bold">{t('otDetail.why.holiday.title', { hrs: premiumHolidayHours.toFixed(1), pay: Math.round(holidayPay).toLocaleString() })}</span>
                    {' '}
                    <span className="text-slate-500 dark:text-slate-400">{t('otDetail.why.holiday.body')}</span>
                  </p>
                </div>
              )}
              {holidayHours > 0 && premiumHolidayHours < holidayHours && (
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-sm bg-emerald-500 mt-1 shrink-0" />
                  <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                    <span className="font-bold">{t('otDetail.why.compDay.title', { hrs: (holidayHours - premiumHolidayHours).toFixed(1) })}</span>
                    {' '}
                    <span className="text-slate-500 dark:text-slate-400">{t('otDetail.why.compDay.body')}</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Per-day table — heart of the modal. */}
        <div className="flex-1 overflow-y-auto">
          {workRows.length === 0 ? (
            <div className="p-12 text-center">
              <CalendarIcon className="w-8 h-8 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('otDetail.noWork')}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 dark:bg-slate-800/40 text-[9px] uppercase text-slate-400 dark:text-slate-500 font-black tracking-widest sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-start w-16">{t('otDetail.col.day')}</th>
                  <th className="px-3 py-2 text-start">{t('otDetail.col.date')}</th>
                  <th className="px-3 py-2 text-start w-16">{t('otDetail.col.shift')}</th>
                  <th className="px-3 py-2 text-start">{t('otDetail.col.station')}</th>
                  <th className="px-3 py-2 text-end w-16">{t('otDetail.col.hours')}</th>
                  <th className="px-3 py-2 text-end w-24">{t('otDetail.col.cumulative')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {workRows.map(r => {
                  const overCap = r.cumulative > cap;
                  const stationLabel = r.stationId
                    ? (stationNameById?.get(r.stationId) ?? r.stationId)
                    : t('otDetail.station.unassigned');
                  // v5.6.0 — per-row holiday status: was premium owed?
                  // Three possible holiday tags:
                  //   AMBER 'PH 2×'   → premium owed (cash-ot, both, or
                  //                     comp window expired)
                  //   EMERALD 'PH +CP' → compensated by a CP within window
                  //   AMBER 'PH'      → fallback (no breakdown found)
                  const holidayMeta = r.isHoliday ? holidayMetaByDate.get(r.date) : undefined;
                  const compDayLanded = holidayMeta && holidayMeta.compDayOffset !== null;
                  const premiumOwedHere = !!holidayMeta?.premiumOwed;
                  return (
                    <tr
                      key={r.day}
                      className={cn(
                        'transition-colors',
                        overCap && !r.isHoliday && 'bg-rose-50/40 dark:bg-rose-500/10',
                        r.isHoliday && premiumOwedHere && 'bg-amber-50/60 dark:bg-amber-500/15',
                        r.isHoliday && !premiumOwedHere && 'bg-emerald-50/40 dark:bg-emerald-500/10',
                      )}
                    >
                      <td className="px-3 py-2 font-mono font-bold text-slate-600 dark:text-slate-300">{r.day}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-mono">{r.date}</span>
                        <span className="ms-2 text-[9px] uppercase tracking-widest text-slate-400 dark:text-slate-500">{r.dayOfWeek}</span>
                        {r.isHoliday && premiumOwedHere && (
                          <span
                            className="ms-2 inline-block px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest uppercase bg-amber-200 dark:bg-amber-500/30 text-amber-800 dark:text-amber-100"
                            title={t('otDetail.tag.premium.tooltip')}
                          >
                            {t('otDetail.tag.premium')}
                          </span>
                        )}
                        {r.isHoliday && !premiumOwedHere && (
                          <span
                            className="ms-2 inline-block px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest uppercase bg-emerald-200 dark:bg-emerald-500/30 text-emerald-800 dark:text-emerald-100"
                            title={compDayLanded
                              ? t('otDetail.tag.compFound.tooltip', { offset: holidayMeta!.compDayOffset! })
                              : t('otDetail.tag.compFound.tooltip.unknown')}
                          >
                            {compDayLanded
                              ? t('otDetail.tag.compFound', { offset: holidayMeta!.compDayOffset! })
                              : t('otDetail.tag.holiday')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200">{r.shiftCode}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 truncate">{stationLabel}</td>
                      <td className="px-3 py-2 text-end font-mono font-bold text-slate-800 dark:text-slate-100">{r.hours}h</td>
                      <td className={cn(
                        'px-3 py-2 text-end font-mono font-bold',
                        overCap ? 'text-rose-700 dark:text-rose-200' : 'text-slate-500 dark:text-slate-400',
                      )}>
                        {r.cumulative}h
                        {r.pushedOverCap && (
                          <span className="ms-1 text-[8px] uppercase tracking-widest font-black text-rose-600 dark:text-rose-300">
                            {t('otDetail.overCapMark')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Station rollup — small footer summarising hours by station so the
            user can see "where did the work land" at a glance. */}
        {stationRollup.length > 0 && (
          <div className="p-3 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/40 dark:bg-slate-800/30 shrink-0">
            <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">{t('otDetail.byStation')}</p>
            <div className="flex flex-wrap gap-1.5">
              {stationRollup.map(s => (
                <span
                  key={s.id}
                  className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                >
                  {s.name} · {s.hours}h
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex justify-end shrink-0">
          <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-widest">{t('action.cancel')}</button>
        </div>
      </motion.div>
    </div>
  );
}

function KpiTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'rose' | 'amber' }) {
  const valueClass =
    tone === 'rose' ? 'text-rose-700 dark:text-rose-200' :
    tone === 'amber' ? 'text-amber-700 dark:text-amber-200' :
    'text-slate-800 dark:text-slate-100';
  return (
    <div className="space-y-0.5">
      <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</p>
      <p className={cn('text-base font-black', valueClass)}>{value}</p>
      {sub && <p className="text-[9px] font-mono text-slate-400 dark:text-slate-500">{sub}</p>}
    </div>
  );
}
