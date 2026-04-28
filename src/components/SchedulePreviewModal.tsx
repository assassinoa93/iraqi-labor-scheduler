import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, ShieldAlert, CheckCircle2, AlertCircle } from 'lucide-react';
import { Schedule, Shift, Employee, Violation } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';

interface PreviewStats {
  totalAssignments: number;
  totalHours: number;
  unfilledStationDays: number;
  violationCount: number;
  topViolations: Violation[];
  perRoleHours: Record<string, number>;
}

export function buildPreviewStats(
  schedule: Schedule,
  shifts: Shift[],
  employees: Employee[],
  violations: Violation[],
  daysInMonth: number,
  totalRequiredStationDays: number,
  filledStationDays: number,
): PreviewStats {
  const shiftMap = new Map(shifts.map(s => [s.code, s]));
  let totalAssignments = 0;
  let totalHours = 0;
  const perRoleHours: Record<string, number> = {};

  for (const emp of employees) {
    const empSched = schedule[emp.empId] || {};
    let empHours = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const entry = empSched[d];
      const sh = entry ? shiftMap.get(entry.shiftCode) : undefined;
      if (sh?.isWork) {
        totalAssignments++;
        empHours += sh.durationHrs;
      }
    }
    totalHours += empHours;
    if (empHours > 0) {
      const roleKey = emp.category === 'Driver' ? 'Driver' : emp.role || 'Other';
      perRoleHours[roleKey] = (perRoleHours[roleKey] || 0) + empHours;
    }
  }

  const totalViolationInstances = violations.reduce((s, v) => s + (v.count || 1), 0);
  const topViolations = [...violations]
    .sort((a, b) => (b.count || 1) - (a.count || 1))
    .slice(0, 4);

  return {
    totalAssignments,
    totalHours,
    unfilledStationDays: Math.max(0, totalRequiredStationDays - filledStationDays),
    violationCount: totalViolationInstances,
    topViolations,
    perRoleHours,
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApply: () => void;
  stats: PreviewStats | null;
  monthLabel: string;
}

export function SchedulePreviewModal({ isOpen, onClose, onApply, stats, monthLabel }: Props) {
  const { t } = useI18n();
  const closeButtonRef = useModalKeys(isOpen, onClose) as React.RefObject<HTMLButtonElement>;
  // AnimatePresence handles enter/exit explicitly so consecutive auto-scheduler
  // runs (open → close → open) don't get stuck in a partially-animated state
  // where the panel never reaches opacity:1. Without this wrapper a fast-clicker
  // could occasionally see the modal not appear at all.
  const open = isOpen && !!stats;
  const violationLevel = !stats ? 'clean' : stats.violationCount === 0 ? 'clean' : stats.violationCount < 10 ? 'mild' : 'heavy';

  return (
    <AnimatePresence>
      {open && stats && (
        <motion.div
          key="schedule-preview-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={t('modal.preview.title')}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="bg-white w-full max-w-2xl rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
          >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-indigo-50 via-blue-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">{t('modal.preview.title')}</h3>
              <p className="text-[11px] text-slate-500 font-medium uppercase tracking-widest">{monthLabel} · {t('modal.preview.subtitle')}</p>
            </div>
          </div>
          <button ref={closeButtonRef} onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={t('modal.preview.assignments')} value={stats.totalAssignments} />
            <Stat label={t('modal.preview.totalHours')} value={Math.round(stats.totalHours)} />
            <Stat label={t('modal.preview.unfilled')} value={stats.unfilledStationDays} tone={stats.unfilledStationDays > 0 ? 'warn' : 'ok'} />
            <Stat label={t('modal.preview.violations')} value={stats.violationCount} tone={violationLevel === 'clean' ? 'ok' : violationLevel === 'mild' ? 'warn' : 'bad'} />
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('modal.preview.hoursByRole')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(stats.perRoleHours).map(([role, hrs]) => (
                <div key={role} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-xs font-bold text-slate-700">{role}</span>
                  <span className="text-sm font-black text-slate-900">{Math.round(hrs)} h</span>
                </div>
              ))}
              {Object.keys(stats.perRoleHours).length === 0 && (
                <p className="text-xs text-slate-400 italic col-span-2">No work assignments yet.</p>
              )}
            </div>
          </div>

          {stats.topViolations.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-2">
                <ShieldAlert className="w-3 h-3" /> {t('modal.preview.violationsHeader')}
              </p>
              <div className="space-y-1">
                {stats.topViolations.map((v, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
                    <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-red-800">
                        {v.rule} <span className="font-mono text-[10px] text-red-500">{v.article}</span>
                      </p>
                      <p className="text-[11px] text-red-700 leading-relaxed">{v.message}</p>
                    </div>
                    {(v.count || 1) > 1 && (
                      <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[9px] font-black">×{v.count}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.violationCount === 0 && stats.unfilledStationDays === 0 && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <p className="text-xs text-emerald-800 font-bold">{t('modal.preview.cleanRun')}</p>
            </div>
          )}
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-between items-center gap-3 flex-wrap">
          <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
            {t('modal.preview.applyNote')}
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all uppercase tracking-widest">
              {t('action.cancel')}
            </button>
            <button
              onClick={onApply}
              className={cn(
                "px-8 py-2 rounded text-sm font-bold transition-all shadow-lg uppercase tracking-widest",
                violationLevel === 'heavy'
                  ? "bg-amber-600 hover:bg-amber-700 text-white"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white"
              )}
            >
              {violationLevel === 'heavy' ? t('modal.preview.applyAnyway') : t('modal.preview.applyButton')}
            </button>
          </div>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const toneClass = tone === 'ok'
    ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
    : tone === 'warn'
      ? 'bg-amber-50 border-amber-100 text-amber-700'
      : tone === 'bad'
        ? 'bg-red-50 border-red-100 text-red-700'
        : 'bg-slate-50 border-slate-100 text-slate-700';
  return (
    <div className={cn("p-3 rounded-lg border", toneClass)}>
      <p className="text-[9px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <p className="text-2xl font-black mt-1">{value.toLocaleString()}</p>
    </div>
  );
}
