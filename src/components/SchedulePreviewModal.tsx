import React from 'react';
import { motion } from 'motion/react';
import { X, Sparkles, ShieldAlert, CheckCircle2, AlertCircle, Info, BarChart3 } from 'lucide-react';
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
  // v1.16: residual comp-day debt — the count of (employee × PH-work day)
  // pairs where the schedule could not place an OFF/leave inside the
  // 7-day comp window. Surfaces as "insufficient HC" warning so the
  // supervisor knows the auto-scheduler is at capacity.
  compDayShortfallTotal: number;
  compDayShortfallEmployees: number;
}

export function buildPreviewStats(
  schedule: Schedule,
  shifts: Shift[],
  employees: Employee[],
  violations: Violation[],
  daysInMonth: number,
  totalRequiredStationDays: number,
  filledStationDays: number,
  compDayShortfall: Array<{ empId: string; debtDays: number }> = [],
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

  // Count violations by severity tier so the modal can split them visually:
  // hard violations (cap breaches, missing rest) drive the headline number;
  // info findings (PH worked, comp day owed) are surfaced separately so the
  // user understands they don't penalise the compliance score.
  const totalViolationInstances = violations
    .filter(v => (v.severity ?? 'violation') === 'violation')
    .reduce((s, v) => s + (v.count || 1), 0);
  const topViolations = [...violations]
    .sort((a, b) => (b.count || 1) - (a.count || 1))
    .slice(0, 6);

  return {
    totalAssignments,
    totalHours,
    unfilledStationDays: Math.max(0, totalRequiredStationDays - filledStationDays),
    violationCount: totalViolationInstances,
    topViolations,
    perRoleHours,
    compDayShortfallTotal: compDayShortfall.reduce((s, e) => s + e.debtDays, 0),
    compDayShortfallEmployees: compDayShortfall.length,
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
  // Direct conditional render — no AnimatePresence wrapper. The previous
  // AnimatePresence-based version with a constant key interacted badly with
  // React StrictMode's double-mount: the first mount's exit animation could
  // cancel the entry of the real mount, leaving the modal stuck at opacity:0.
  // Returning early when there's nothing to show is simpler and reliable.
  if (!isOpen || !stats) return null;
  const violationLevel = stats.violationCount === 0 ? 'clean' : stats.violationCount < 10 ? 'mild' : 'heavy';

  // Compliance health score for the headline. Same heuristic the dashboard
  // uses (3 checks per employee×day) but applied to the preview's totals.
  const totalChecks = Math.max(1, stats.totalAssignments * 3);
  const compliancePct = Math.max(0, Math.round(100 - (stats.violationCount / totalChecks) * 100));

  // Split top findings into hard violations vs informational notes so the user
  // sees them as separate columns — info findings (PH worked, comp day owed)
  // shouldn't read like critical failures.
  const hardFindings = stats.topViolations.filter(v => (v.severity ?? 'violation') === 'violation');
  const infoFindings = stats.topViolations.filter(v => v.severity === 'info');

  // Hours-by-role bar visualisation. Sort largest-first and compute bar widths
  // relative to the busiest role so the chart fills its container.
  const roleEntries = Object.entries(stats.perRoleHours).sort((a, b) => b[1] - a[1]);
  const maxRoleHours = roleEntries[0]?.[1] ?? 1;
  const ROLE_TONES = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-blue-500', 'bg-rose-500', 'bg-purple-500'];

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('modal.preview.title')}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        {/* Hero header — bigger, with the compliance score front and centre. */}
        <div className={cn(
          "p-6 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-stretch gap-4",
          violationLevel === 'clean' ? "bg-gradient-to-r from-emerald-50 via-white to-white dark:from-emerald-500/15 dark:via-slate-900 dark:to-slate-900"
            : violationLevel === 'mild' ? "bg-gradient-to-r from-amber-50 via-white to-white dark:from-amber-500/15 dark:via-slate-900 dark:to-slate-900"
              : "bg-gradient-to-r from-rose-50 via-white to-white dark:from-rose-500/15 dark:via-slate-900 dark:to-slate-900"
        )}>
          <div className="flex items-center gap-4 min-w-0">
            <div className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-lg",
              violationLevel === 'clean' ? "bg-emerald-600 shadow-emerald-200 dark:shadow-emerald-500/30"
                : violationLevel === 'mild' ? "bg-amber-600 shadow-amber-200 dark:shadow-amber-500/30"
                  : "bg-rose-600 shadow-rose-200 dark:shadow-rose-500/30",
            )}>
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate">{t('modal.preview.title')}</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-widest mt-0.5">
                {monthLabel} · {t('modal.preview.subtitle')}
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-3 pr-1">
            <div className="text-right">
              <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.preview.compliance')}</p>
              <p className={cn(
                "text-3xl font-black leading-none mt-1",
                compliancePct >= 95 ? "text-emerald-600 dark:text-emerald-300" : compliancePct >= 80 ? "text-amber-600 dark:text-amber-300" : "text-rose-600 dark:text-rose-300",
              )}>{compliancePct}%</p>
            </div>
            <button ref={closeButtonRef} onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </button>
          </div>
          <button onClick={onClose} aria-label={t('action.cancel')} className="sm:hidden p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors self-start">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Top-level KPI strip — 4 cards laid out in a single visually balanced row. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <BigStat label={t('modal.preview.assignments')} value={stats.totalAssignments} sub={t('modal.preview.assignmentsSub')} />
            <BigStat label={t('modal.preview.totalHours')} value={Math.round(stats.totalHours)} sub="hours" />
            <BigStat
              label={t('modal.preview.unfilled')}
              value={stats.unfilledStationDays}
              sub={t('modal.preview.unfilledSub')}
              tone={stats.unfilledStationDays === 0 ? 'ok' : stats.unfilledStationDays < 5 ? 'warn' : 'bad'}
            />
            <BigStat
              label={t('modal.preview.violations')}
              value={stats.violationCount}
              sub={t('modal.preview.violationsSub')}
              tone={violationLevel === 'clean' ? 'ok' : violationLevel === 'mild' ? 'warn' : 'bad'}
            />
          </div>

          {/* v1.16 — comp-day shortfall warning. When the auto-scheduler can't
              place an OFF inside the 7-day comp window after a PH-work day,
              it accumulates as residual debt. The most common cause is HC
              being too thin to spare anyone for OFF — this row tells the
              supervisor that hiring is the real fix, not re-running. */}
          {stats.compDayShortfallTotal > 0 && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/40">
              <AlertCircle className="w-4 h-4 text-amber-700 dark:text-amber-200 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black text-amber-800 dark:text-amber-200 uppercase tracking-widest">{t('modal.preview.compShortfall.title')}</p>
                <p className="text-[11px] text-amber-700 dark:text-amber-200 leading-relaxed mt-1">
                  {t('modal.preview.compShortfall.body', {
                    days: stats.compDayShortfallTotal,
                    emps: stats.compDayShortfallEmployees,
                  })}
                </p>
              </div>
            </div>
          )}

          {/* Hours-by-role visual bar chart */}
          {roleEntries.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <BarChart3 className="w-3 h-3" /> {t('modal.preview.hoursByRole')}
              </p>
              <div className="space-y-2">
                {roleEntries.map(([role, hrs], i) => {
                  const pct = Math.max(2, Math.round((hrs / maxRoleHours) * 100));
                  return (
                    <div key={role} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-slate-700 dark:text-slate-200">{role}</span>
                        <span className="font-mono font-black text-slate-900 dark:text-slate-50">{Math.round(hrs)} h</span>
                      </div>
                      <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", ROLE_TONES[i % ROLE_TONES.length])}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Findings split — hard violations on the left, info notes on the right. */}
          {(hardFindings.length > 0 || infoFindings.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {hardFindings.length > 0 && (
                <FindingsList
                  title={t('modal.preview.violationsHeader')}
                  findings={hardFindings}
                  tone="rose"
                  Icon={ShieldAlert}
                />
              )}
              {infoFindings.length > 0 && (
                <FindingsList
                  title={t('modal.preview.notesHeader')}
                  findings={infoFindings}
                  tone="blue"
                  Icon={Info}
                />
              )}
            </div>
          )}

          {stats.violationCount === 0 && stats.unfilledStationDays === 0 && hardFindings.length === 0 && (
            <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/40 rounded-xl">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300 shrink-0" />
              <div>
                <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">{t('modal.preview.cleanRun')}</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-200 mt-0.5">{t('modal.preview.cleanRunSub')}</p>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex justify-between items-center gap-3 flex-wrap">
          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed flex-1 min-w-[180px]">
            {t('modal.preview.applyNote')}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-5 py-2 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-widest">
              {t('action.cancel')}
            </button>
            <button
              onClick={onApply}
              className={cn(
                "px-6 py-2 rounded-lg text-xs font-black transition-all shadow-md uppercase tracking-widest",
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
    </div>
  );
}

function BigStat({ label, value, sub, tone = 'neutral' }: { label: string; value: number; sub?: string; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const toneClass = tone === 'ok'
    ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-100 dark:border-emerald-500/30'
    : tone === 'warn'
      ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-100 dark:border-amber-500/30'
      : tone === 'bad'
        ? 'bg-rose-50 dark:bg-rose-500/15 border-rose-100 dark:border-rose-500/30'
        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-700/60';
  const valueClass = tone === 'ok'
    ? 'text-emerald-700 dark:text-emerald-200'
    : tone === 'warn'
      ? 'text-amber-700 dark:text-amber-200'
      : tone === 'bad'
        ? 'text-rose-700 dark:text-rose-200'
        : 'text-slate-800 dark:text-slate-100';
  return (
    <div className={cn("p-3.5 rounded-xl border", toneClass)}>
      <p className="text-[9px] font-black uppercase tracking-widest opacity-60 text-slate-600 dark:text-slate-300">{label}</p>
      <p className={cn("text-2xl font-black mt-1.5 leading-none", valueClass)}>{value.toLocaleString()}</p>
      {sub && <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mt-1 uppercase tracking-wider">{sub}</p>}
    </div>
  );
}

function FindingsList({ title, findings, tone, Icon }: {
  title: string;
  findings: Violation[];
  tone: 'rose' | 'blue';
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const headerClass = tone === 'rose' ? 'text-rose-600 dark:text-rose-300' : 'text-blue-600 dark:text-blue-300';
  const rowBgClass = tone === 'rose' ? 'bg-rose-50/60 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/30' : 'bg-blue-50/60 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/30';
  const ruleClass = tone === 'rose' ? 'text-rose-800 dark:text-rose-200' : 'text-blue-800 dark:text-blue-200';
  const articleClass = tone === 'rose' ? 'text-rose-500 dark:text-rose-300' : 'text-blue-500 dark:text-blue-300';
  const messageClass = tone === 'rose' ? 'text-rose-700 dark:text-rose-200' : 'text-blue-700 dark:text-blue-200';
  const countClass = tone === 'rose' ? 'bg-rose-100 dark:bg-rose-500/25 text-rose-700 dark:text-rose-200' : 'bg-blue-100 dark:bg-blue-500/25 text-blue-700 dark:text-blue-200';
  const iconClass = tone === 'rose' ? 'text-rose-500 dark:text-rose-300' : 'text-blue-500 dark:text-blue-300';
  return (
    <div className="space-y-2">
      <p className={cn("text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5", headerClass)}>
        <Icon className="w-3 h-3" /> {title}
      </p>
      <div className="space-y-1.5">
        {findings.map((v, i) => (
          <div key={i} className={cn("flex items-start gap-2 p-2.5 rounded-lg border", rowBgClass)}>
            <AlertCircle className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", iconClass)} />
            <div className="min-w-0 flex-1">
              <p className={cn("text-[11px] font-black leading-tight", ruleClass)}>
                {v.rule} <span className={cn("font-mono text-[9px] font-bold ml-0.5", articleClass)}>{v.article}</span>
              </p>
              <p className={cn("text-[10px] leading-snug mt-0.5", messageClass)}>{v.message}</p>
            </div>
            {(v.count || 1) > 1 && (
              <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-black shrink-0", countClass)}>×{v.count}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
