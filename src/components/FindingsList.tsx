/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.25 — the ONE component for rendering compliance findings. Replaces the
 * per-surface ad-hoc lists (Dashboard flat dump, Reports column, preview
 * modal) that each counted, coloured, titled, and split findings differently.
 *
 * Behaviour:
 *   • Splits hard violations (rose) from info notes (blue) — both always shown.
 *   • Groups by rule so the report reads as "Weekly hours cap · ×5 · 3 staff"
 *     instead of dozens of near-identical rows (this is what keeps the now-
 *     unfiltered weekly-cap from overwhelming the list).
 *   • Each group expands to the per-employee detail on click.
 *   • Titles + detail render through findings.ts → fully translated, with
 *     Arabic-Indic digits when that locale/pref is active.
 */
import React, { useState } from 'react';
import { AlertTriangle, Info, ChevronDown, ShieldCheck, Circle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import type { Violation } from '../types';
import {
  splitFindings,
  groupFindings,
  countInstances,
  findingTitle,
  findingDetail,
  type FindingGroup,
} from '../lib/findings';

interface FindingsListProps {
  /** Raw findings (violations + info notes mixed); split internally. */
  findings: Violation[];
  /** Resolve employee display names for the expanded detail rows. */
  empNameById?: Map<string, string>;
  /** false → "nothing to check yet" empty state (no schedule); true → "all
   *  clear" empty state. */
  hasContext?: boolean;
  className?: string;
}

export function FindingsList({ findings, empNameById, hasContext = true, className }: FindingsListProps) {
  const { t } = useI18n();
  const { violations, notes } = splitFindings(findings);
  const vGroups = groupFindings(violations);
  const nGroups = groupFindings(notes);

  if (violations.length === 0 && notes.length === 0) {
    return (
      <div className="p-10 text-center">
        {hasContext ? (
          <>
            <ShieldCheck className="w-10 h-10 text-emerald-500 dark:text-emerald-400 mx-auto mb-3" />
            <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{t('findings.allClear.title')}</div>
            <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{t('findings.allClear.hint')}</div>
          </>
        ) : (
          <>
            <Circle className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <div className="text-sm font-bold text-slate-500 dark:text-slate-300">{t('findings.noSchedule.title')}</div>
            <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{t('findings.noSchedule.hint')}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn('divide-y divide-slate-100 dark:divide-slate-700/60', className)}>
      {vGroups.length > 0 && (
        <FindingsSection
          label={t('findings.section.violations')}
          total={countInstances(violations)}
          tone="violation"
          groups={vGroups}
          empNameById={empNameById}
        />
      )}
      {nGroups.length > 0 && (
        <FindingsSection
          label={t('findings.section.notes')}
          total={countInstances(notes)}
          tone="info"
          groups={nGroups}
          empNameById={empNameById}
        />
      )}
    </div>
  );
}

function FindingsSection({
  label, total, tone, groups, empNameById,
}: {
  label: string;
  total: number;
  tone: 'violation' | 'info';
  groups: FindingGroup[];
  empNameById?: Map<string, string>;
}) {
  const { fmt } = useI18n();
  const accent = tone === 'violation'
    ? 'text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15'
    : 'text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15';
  return (
    <div>
      <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-50/60 dark:bg-slate-800/40">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</span>
        <span className={cn('text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-full', accent)}>{fmt.num(total)}</span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
        {groups.map((g) => (
          <FindingGroupRow key={`${tone}:${g.key}`} group={g} empNameById={empNameById} />
        ))}
      </div>
    </div>
  );
}

function FindingGroupRow({ group, empNameById }: { group: FindingGroup; empNameById?: Map<string, string> }) {
  const { t, fmt, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const isViolation = group.severity === 'violation';
  const Icon = isViolation ? AlertTriangle : Info;
  const iconCls = isViolation ? 'text-rose-500 dark:text-rose-300' : 'text-blue-500 dark:text-blue-300';
  // Title comes from the first item (all items in a group share the rule).
  const title = findingTitle(group.items[0], t);

  return (
    <div className={cn(isViolation ? 'bg-white dark:bg-slate-900' : 'bg-blue-50/20 dark:bg-blue-500/[0.04]')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <Icon className={cn('w-4 h-4 shrink-0', iconCls)} />
        <span className="text-sm font-bold text-slate-800 dark:text-slate-100 flex-1 min-w-0 truncate">{title}</span>
        {group.instances > 1 && (
          <span className="shrink-0 text-[10px] font-black tabular-nums text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
            ×{fmt.num(group.instances)}
          </span>
        )}
        <span className="shrink-0 text-[10px] font-medium text-slate-400 dark:text-slate-500 tabular-nums hidden sm:inline">
          {t('findings.staff', { n: fmt.num(group.employees) })}
        </span>
        <span className="shrink-0 text-[10px] font-mono text-slate-400 dark:text-slate-500 hidden md:inline">{group.article}</span>
        <ChevronDown className={cn('w-4 h-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="px-5 pb-3 ps-12 space-y-1.5">
          {group.items.map((v, i) => (
            <li key={`${v.empId}:${v.day}:${i}`} className="flex items-baseline gap-2 text-[11px] leading-relaxed">
              <span className="font-bold text-slate-700 dark:text-slate-200 shrink-0">
                {empNameById?.get(v.empId) ?? v.empId}
              </span>
              <span className="text-slate-300 dark:text-slate-600" dir={dir}>·</span>
              <span className="text-slate-500 dark:text-slate-400 shrink-0">{t('findings.day', { day: fmt.num(v.day) })}</span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="text-slate-500 dark:text-slate-400">{findingDetail(v, t, fmt.digits)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
