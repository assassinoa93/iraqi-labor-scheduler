import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, CalendarDays, Coins, Sparkles, Info } from 'lucide-react';
import { Employee, PublicHoliday, Schedule, Shift, Config } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';
import { baseHourlyRate } from '../lib/payroll';
import { format } from 'date-fns';

interface Props {
  isOpen: boolean;
  employee: Employee | null;
  schedule: Schedule;
  shifts: Shift[];
  holidays: PublicHoliday[];
  config: Config;
  onClose: () => void;
  onSave: (next: Employee) => void;
}

// Modal that lets the supervisor pick, per worked public holiday, whether to
// (a) pay the 2× cash premium (Art. 74 default) or (b) grant a paid comp day
// off in lieu (Art. 74 alternative). Compensated holidays drop the OT line
// from 2× to 1× regular wage, which is already covered by the base monthly
// salary — net effect is the holiday becomes "free" for the venue.
//
// Only shows holidays the employee actually worked in the active month. If
// none, the modal renders an empty-state and there's nothing to toggle.
export function HolidayCompensationModal({
  isOpen, employee, schedule, shifts, holidays, config, onClose, onSave,
}: Props) {
  const { t } = useI18n();
  const closeButtonRef = useModalKeys(isOpen, onClose) as React.RefObject<HTMLButtonElement>;
  const [draft, setDraft] = useState<Set<string>>(new Set());

  // Reset draft to the current employee's compensations every time the
  // modal opens for a new employee.
  useEffect(() => {
    if (isOpen && employee) {
      setDraft(new Set(employee.holidayCompensations || []));
    }
  }, [isOpen, employee]);

  const workedHolidays = useMemo(() => {
    if (!employee) return [];
    const empSched = schedule[employee.empId] || {};
    const shiftByCode = new Map(shifts.map(s => [s.code, s]));
    const holidayByDate = new Map(holidays.map(h => [h.date, h]));
    const monthPrefix = `${config.year}-${String(config.month).padStart(2, '0')}-`;
    const out: Array<{ date: string; name: string; hours: number }> = [];
    for (const [day, entry] of Object.entries(empSched)) {
      const dateStr = format(new Date(config.year, config.month - 1, parseInt(day)), 'yyyy-MM-dd');
      if (!dateStr.startsWith(monthPrefix)) continue;
      const holiday = holidayByDate.get(dateStr);
      if (!holiday) continue;
      const shift = shiftByCode.get(entry.shiftCode);
      if (!shift?.isWork) continue;
      out.push({ date: dateStr, name: holiday.name, hours: shift.durationHrs });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [employee, schedule, shifts, holidays, config]);

  if (!isOpen || !employee) return null;

  const hourly = baseHourlyRate(employee, config);
  const otRateNight = config.otRateNight ?? 2.0;
  // Total potential premium if no comps are granted (for context).
  const totalPotentialPremium = workedHolidays.reduce((s, h) => s + h.hours * hourly * otRateNight, 0);
  // Premium remaining with the current draft set.
  const remainingPremium = workedHolidays.reduce((s, h) => {
    if (draft.has(h.date)) return s;
    return s + h.hours * hourly * otRateNight;
  }, 0);
  const savings = Math.round(totalPotentialPremium - remainingPremium);

  const toggle = (date: string) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const allComp = workedHolidays.length > 0 && workedHolidays.every(h => draft.has(h.date));
  const noneComp = workedHolidays.every(h => !draft.has(h.date));

  const setAll = (compensate: boolean) => {
    if (compensate) setDraft(new Set(workedHolidays.map(h => h.date)));
    else setDraft(new Set());
  };

  const apply = () => {
    onSave({ ...employee, holidayCompensations: Array.from(draft).sort() });
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('holidayComp.title')}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-start gap-3 bg-gradient-to-r from-amber-50 via-white to-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center shrink-0 shadow-md shadow-amber-200">
              <CalendarDays className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-slate-800 truncate">{t('holidayComp.title')}</h3>
              <p className="text-[11px] text-slate-500 font-medium uppercase tracking-widest mt-0.5 truncate">
                {employee.name} · {employee.empId}
              </p>
            </div>
          </div>
          <button ref={closeButtonRef} onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 rounded-lg transition-colors shrink-0">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-800 leading-relaxed">
              {t('holidayComp.body')}
            </p>
          </div>

          {workedHolidays.length === 0 ? (
            <div className="p-6 text-center bg-slate-50 rounded-lg border border-slate-100">
              <p className="text-sm font-bold text-slate-600">{t('holidayComp.empty.title')}</p>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{t('holidayComp.empty.body')}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  {t('holidayComp.workedCount', { n: workedHolidays.length })}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setAll(true)}
                    disabled={allComp}
                    className={cn(
                      "px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest transition-all",
                      allComp ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
                    )}
                  >
                    {t('holidayComp.compAll')}
                  </button>
                  <button
                    onClick={() => setAll(false)}
                    disabled={noneComp}
                    className={cn(
                      "px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest transition-all",
                      noneComp ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-amber-100 text-amber-700 hover:bg-amber-200",
                    )}
                  >
                    {t('holidayComp.payAll')}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                {workedHolidays.map(h => {
                  const isComp = draft.has(h.date);
                  const premium = h.hours * hourly * otRateNight;
                  return (
                    <button
                      key={h.date}
                      onClick={() => toggle(h.date)}
                      className={cn(
                        "w-full text-left p-3 rounded-lg border transition-all flex items-center gap-3",
                        isComp
                          ? "bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                          : "bg-slate-50 border-slate-200 hover:bg-slate-100",
                      )}
                    >
                      <div className={cn(
                        "w-9 h-9 rounded-lg flex flex-col items-center justify-center shrink-0",
                        isComp ? "bg-emerald-200 text-emerald-800" : "bg-slate-200 text-slate-700",
                      )}>
                        <span className="text-[8px] font-black uppercase">{h.date.slice(5, 7)}</span>
                        <span className="text-sm font-black leading-none">{h.date.slice(8, 10)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-800 truncate">{h.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {h.hours.toFixed(1)}h · {isComp ? t('holidayComp.row.willBeComp') : t('holidayComp.row.willPay', { iqd: Math.round(premium).toLocaleString() })}
                        </p>
                      </div>
                      <div className={cn(
                        "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shrink-0",
                        isComp ? "bg-emerald-600 text-white" : "bg-amber-500 text-white",
                      )}>
                        {isComp ? t('holidayComp.tag.comp') : t('holidayComp.tag.pay')}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Live savings preview */}
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-black text-emerald-800 uppercase tracking-widest">{t('holidayComp.savings.title')}</p>
                  <p className="text-lg font-black text-emerald-700 mt-0.5">
                    {savings.toLocaleString()} <span className="text-[11px] font-bold uppercase tracking-widest">IQD</span>
                  </p>
                  <p className="text-[10px] text-emerald-700 leading-relaxed mt-1">
                    {t('holidayComp.savings.body', { savings: savings.toLocaleString() })}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-5 bg-slate-50 border-t border-slate-100 flex justify-between items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
            <Coins className="w-3 h-3" />
            {t('holidayComp.footer.rate', { rate: Math.round(otRateNight * 100) })}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-5 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-200 transition-all uppercase tracking-widest">
              {t('action.cancel')}
            </button>
            <button
              onClick={apply}
              disabled={workedHolidays.length === 0}
              className={cn(
                "px-6 py-2 rounded-lg text-xs font-black transition-all shadow-md uppercase tracking-widest",
                workedHolidays.length === 0
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-amber-600 hover:bg-amber-700 text-white",
              )}
            >
              {t('holidayComp.apply')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
