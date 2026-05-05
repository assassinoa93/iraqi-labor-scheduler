/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.18.0 — "Why didn't you cover X?" panel.
 *
 * Surfaces post-hoc analysis of the active schedule's uncovered slots
 * grouped by station+day, with the most-likely binding constraint
 * (no eligible employees / on leave / already scheduled / fixed rest).
 * Designed for the bottom of ScheduleTab — collapsed by default so it
 * doesn't crowd the grid; expanded only when the supervisor wants to
 * understand why the auto-scheduler couldn't fully fill a window.
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, AlertOctagon, UserX, CalendarOff, Clock, Bed, Info } from 'lucide-react';
import type { Employee, Shift, Station, PublicHoliday, Config, Schedule } from '../../types';
import { diagnoseUnfilledCoverage, groupUnfilledByStationDay, type UnfilledReason, type UnfilledGroup } from '../../lib/coverageDiagnostics';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';

interface Props {
  schedule: Schedule;
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  isPeakDay: (day: number) => boolean;
}

const REASON_KEYS: Record<UnfilledReason, { i18n: string; tone: string; icon: React.ComponentType<{ className?: string }>; }> = {
  'no-eligible-employees':         { i18n: 'coverageDiag.reason.noEligible', tone: 'rose', icon: UserX },
  'all-eligible-on-leave':         { i18n: 'coverageDiag.reason.onLeave', tone: 'amber', icon: CalendarOff },
  'all-eligible-already-scheduled':{ i18n: 'coverageDiag.reason.alreadyScheduled', tone: 'blue', icon: Clock },
  'all-eligible-fixed-rest':       { i18n: 'coverageDiag.reason.fixedRest', tone: 'indigo', icon: Bed },
  'station-closed':                { i18n: 'coverageDiag.reason.stationClosed', tone: 'slate', icon: Info },
  'unknown':                       { i18n: 'coverageDiag.reason.unknown', tone: 'slate', icon: Info },
};

export function CoverageDiagnosticsPanel(props: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const groups: UnfilledGroup[] = useMemo(() => {
    if (!open) return [];
    const slots = diagnoseUnfilledCoverage(props);
    return groupUnfilledByStationDay(slots);
  }, [open, props]);

  // Cheap pre-compute to drive the badge count without paying the full
  // diagnose cost. We just check whether ANY slot is short — short-circuit
  // walk over stations/days/hours.
  const hasGaps = useMemo(() => {
    // Run the full diagnose; on tiny rosters this is a few ms.
    // Caches under `open` flag for the expanded path; this is the
    // collapsed-state preview so we run it eagerly. Acceptable cost
    // because daysInMonth × stations × hours is typically <2,000 ops.
    const slots = diagnoseUnfilledCoverage(props);
    return slots.length > 0;
  }, [props]);

  // Empty group: render nothing — no need to surface a "0 gaps" panel.
  if (!hasGaps) return null;

  const empName = (id: string) => props.employees.find(e => e.empId === id)?.name || id;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
        <AlertOctagon className="w-4 h-4 text-rose-600 dark:text-rose-300" />
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
          {t('coverageDiag.title')}
        </span>
        <span className="ms-auto text-[10px] font-mono font-bold text-rose-600 dark:text-rose-300">
          {open ? t('coverageDiag.gapsCount', { count: groups.length }) : t('coverageDiag.expand')}
        </span>
      </button>

      {open && (
        <div className="p-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
          {groups.length === 0 && (
            <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
              {t('coverageDiag.noGaps')}
            </p>
          )}
          {groups.slice(0, 60).map((g, i) => {
            const meta = REASON_KEYS[g.reason] ?? REASON_KEYS.unknown;
            const Icon = meta.icon;
            const blockedNames = g.blockedEmpIds.slice(0, 4).map(empName).join(', ');
            const moreBlocked = g.blockedEmpIds.length > 4 ? g.blockedEmpIds.length - 4 : 0;
            const hourLabel = g.hours.length === 1
              ? `${String(g.hours[0]).padStart(2, '0')}:00`
              : `${String(g.hours[0]).padStart(2, '0')}:00–${String(g.hours[g.hours.length - 1] + 1).padStart(2, '0')}:00`;
            return (
              <div
                key={`${g.day}-${g.stationId}-${i}`}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border',
                  meta.tone === 'rose' && 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30',
                  meta.tone === 'amber' && 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30',
                  meta.tone === 'blue' && 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30',
                  meta.tone === 'indigo' && 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30',
                  meta.tone === 'slate' && 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700',
                )}
              >
                <Icon className={cn(
                  'w-4 h-4 shrink-0 mt-0.5',
                  meta.tone === 'rose' && 'text-rose-600 dark:text-rose-300',
                  meta.tone === 'amber' && 'text-amber-600 dark:text-amber-300',
                  meta.tone === 'blue' && 'text-blue-600 dark:text-blue-300',
                  meta.tone === 'indigo' && 'text-indigo-600 dark:text-indigo-300',
                  meta.tone === 'slate' && 'text-slate-500 dark:text-slate-400',
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                    {t('coverageDiag.line.head', {
                      day: g.day,
                      station: g.stationName,
                      hours: hourLabel,
                      shortfall: g.totalShortfall,
                    })}
                  </p>
                  <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-0.5">
                    {t(meta.i18n)}
                  </p>
                  {blockedNames && (
                    <p className="text-[9px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      {blockedNames}{moreBlocked > 0 && ` +${moreBlocked}`}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {groups.length > 60 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic text-center">
              {t('coverageDiag.truncated', { count: groups.length - 60 })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
