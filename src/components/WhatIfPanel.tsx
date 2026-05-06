/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.19.0 — What-If Panel.
 *
 * Sits at the bottom of the Workforce Planning tab and lets the
 * supervisor preview the OT / coverage / payroll impact of a
 * hypothetical roster change without committing to it.
 *
 * Three change types: hire, cross-train, release. Each adds a row to
 * the staged-changes list; clicking "Run simulation" calls
 * simulateWhatIf and displays the before/after deltas. The simulation
 * is non-destructive — it produces a new schedule in memory but never
 * writes it back; the supervisor uses the verdict to decide whether
 * to actually execute the change in the Roster / Schedule tabs.
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FlaskConical, Plus, X, Loader2, Sparkles, ArrowRight, MinusCircle } from 'lucide-react';
import { Card } from './Primitives';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';
import type { Employee, Shift, Station, StationGroup, PublicHoliday, Config, Schedule } from '../types';
import { simulateWhatIf, type WhatIfChange, type WhatIfResult } from '../lib/whatIfSimulator';

interface Props {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  stationGroups: StationGroup[];
  holidays: PublicHoliday[];
  config: Config;
  isPeakDay: (day: number) => boolean;
  schedule: Schedule;
  allSchedules?: Record<string, Schedule>;
}

export function WhatIfPanel(props: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(true);
  const [staged, setStaged] = useState<WhatIfChange[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WhatIfResult | null>(null);

  // Build the unique role list for the role-picker (hire / release).
  const roles = useMemo(() => {
    const out = new Set<string>();
    for (const e of props.employees) {
      if (e.role && e.role !== '' && e.role !== 'Standard') out.add(e.role);
      if (e.category === 'Driver') out.add('Driver');
    }
    if (out.size === 0) out.add('Standard');
    return Array.from(out).sort();
  }, [props.employees]);

  const addChange = (c: WhatIfChange) => setStaged(s => [...s, c]);
  const removeChange = (i: number) => setStaged(s => s.filter((_, idx) => idx !== i));
  const reset = () => { setStaged([]); setResult(null); };

  const handleRun = () => {
    if (staged.length === 0) return;
    setRunning(true);
    // Yield to paint the spinner before the (possibly heavy) sim run.
    requestAnimationFrame(() => {
      try {
        const r = simulateWhatIf({
          baseEmployees: props.employees,
          shifts: props.shifts,
          stations: props.stations,
          stationGroups: props.stationGroups,
          holidays: props.holidays,
          config: props.config,
          isPeakDay: props.isPeakDay,
          baseSchedule: props.schedule,
          allSchedules: props.allSchedules,
          changes: staged,
        });
        setResult(r);
      } finally {
        setRunning(false);
      }
    });
  };

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full p-5 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40 flex items-center gap-3 hover:bg-slate-100/50 dark:hover:bg-slate-800 transition-colors text-start"
      >
        <FlaskConical className="w-4 h-4 text-blue-600 dark:text-blue-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
            {t('workforce.whatIf.title')}
          </h3>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            {t('workforce.whatIf.subtitle')}
          </p>
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
      </button>

      {!collapsed && (
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ChangeBuilder kind="hire" roles={roles} stationGroups={props.stationGroups} onAdd={addChange} />
            <ChangeBuilder kind="cross-train" employees={props.employees} stationGroups={props.stationGroups} onAdd={addChange} />
            <ChangeBuilder kind="release" roles={roles} onAdd={addChange} />
            {staged.length > 0 && (
              <button
                type="button"
                onClick={reset}
                className="ms-auto text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                {t('workforce.whatIf.reset')}
              </button>
            )}
          </div>

          {staged.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                {t('workforce.whatIf.staged.title', { count: staged.length })}
              </p>
              <div className="space-y-1.5">
                {staged.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60">
                    <span className={cn(
                      'shrink-0 px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-widest',
                      c.kind === 'hire' ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border-emerald-200 dark:border-emerald-500/30'
                      : c.kind === 'release' ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-200 border-rose-200 dark:border-rose-500/30'
                      : 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200 border-blue-200 dark:border-blue-500/30',
                    )}>
                      {c.kind}
                    </span>
                    <p className="text-[11px] text-slate-700 dark:text-slate-200 flex-1 min-w-0">
                      {describeChange(c, t, props.employees, props.stationGroups)}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeChange(i)}
                      aria-label={t('action.remove')}
                      className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleRun}
                disabled={running}
                className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white text-[11px] font-black uppercase tracking-widest shadow-md flex items-center justify-center gap-2"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                {running ? t('workforce.whatIf.running') : t('workforce.whatIf.run')}
              </button>
            </div>
          )}

          {result && (
            <div className="p-4 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/10 space-y-3">
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-black text-emerald-800 dark:text-emerald-200 uppercase tracking-widest">
                    {t('workforce.whatIf.result.title')}
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-200 leading-relaxed mt-1">
                    {result.verdict}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <DeltaTile label={t('workforce.whatIf.metric.otHours')} before={result.before.totalOTHours} after={result.after.totalOTHours} delta={result.delta.otHours} better="lower" unit="h" />
                <DeltaTile label={t('workforce.whatIf.metric.otPay')} before={result.before.totalOTPay} after={result.after.totalOTPay} delta={result.delta.otPay} better="lower" unit="IQD" />
                <DeltaTile label={t('workforce.whatIf.metric.coverageGaps')} before={result.before.coverageGapSlots} after={result.after.coverageGapSlots} delta={result.delta.coverageGapSlots} better="lower" />
                <DeltaTile label={t('workforce.whatIf.metric.payroll')} before={result.before.monthlyPayroll} after={result.after.monthlyPayroll} delta={result.delta.monthlyPayroll} better="context" unit="IQD" />
              </div>
              <p className="text-[9px] text-emerald-700 dark:text-emerald-300 italic">
                {t('workforce.whatIf.result.disclaimer')}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ChangeBuilder({ kind, roles, employees, stationGroups, onAdd }: {
  kind: 'hire' | 'cross-train' | 'release';
  roles?: string[];
  employees?: Employee[];
  stationGroups?: StationGroup[];
  onAdd: (c: WhatIfChange) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [role, setRole] = useState<string>(roles?.[0] || 'Standard');
  const [empId, setEmpId] = useState<string>(employees?.[0]?.empId || '');
  const [groupId, setGroupId] = useState<string>(stationGroups?.[0]?.id || '');

  const handleAdd = () => {
    if (kind === 'hire') {
      onAdd({ kind, count, role, eligibleGroups: groupId ? [groupId] : undefined });
    } else if (kind === 'cross-train' && empId) {
      onAdd({ kind, empId, addEligibleGroups: groupId ? [groupId] : [] });
    } else if (kind === 'release') {
      onAdd({ kind, count, role });
    }
    setOpen(false);
  };

  const tone =
    kind === 'hire' ? 'emerald'
    : kind === 'release' ? 'rose'
    : 'blue';
  const Icon = kind === 'hire' ? Plus : kind === 'release' ? MinusCircle : ArrowRight;
  const toneClasses =
    tone === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/25'
    : tone === 'rose' ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-200 border-rose-200 dark:border-rose-500/30 hover:bg-rose-100 dark:hover:bg-rose-500/25'
    : 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200 border-blue-200 dark:border-blue-500/30 hover:bg-blue-100 dark:hover:bg-blue-500/25';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn('px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-colors', toneClasses)}
      >
        <Icon className="w-3 h-3" />
        {t(`workforce.whatIf.add.${kind}`)}
      </button>
      {open && (
        <div className="absolute z-10 top-full mt-1 start-0 p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl space-y-2 min-w-[260px]">
          {(kind === 'hire' || kind === 'release') && (
            <>
              <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {t('workforce.whatIf.field.count')}
                <input
                  type="number"
                  min={1} max={20}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="mt-1 w-full px-2 py-1 text-xs font-mono border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                />
              </label>
              <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {t('workforce.whatIf.field.role')}
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="mt-1 w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                >
                  {roles?.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            </>
          )}
          {kind === 'cross-train' && (
            <>
              <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {t('workforce.whatIf.field.employee')}
                <select
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value)}
                  className="mt-1 w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                >
                  {employees?.map(e => <option key={e.empId} value={e.empId}>{e.name}</option>)}
                </select>
              </label>
            </>
          )}
          {(kind === 'hire' || kind === 'cross-train') && (stationGroups?.length ?? 0) > 0 && (
            <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {t('workforce.whatIf.field.group')}
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="mt-1 w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
              >
                <option value="">—</option>
                {stationGroups?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={handleAdd}
            className={cn('w-full px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest', toneClasses)}
          >
            {t('workforce.whatIf.field.confirm')}
          </button>
        </div>
      )}
    </div>
  );
}

function describeChange(c: WhatIfChange, t: (k: string, p?: Record<string, string | number>) => string, employees: Employee[], stationGroups: StationGroup[]): string {
  if (c.kind === 'hire') {
    const groupName = c.eligibleGroups?.[0]
      ? stationGroups.find(g => g.id === c.eligibleGroups![0])?.name || '—'
      : '—';
    return t('workforce.whatIf.describe.hire', { count: c.count, role: c.role, group: groupName });
  }
  if (c.kind === 'cross-train') {
    const emp = employees.find(e => e.empId === c.empId)?.name || c.empId;
    const groupName = c.addEligibleGroups?.[0]
      ? stationGroups.find(g => g.id === c.addEligibleGroups![0])?.name || '—'
      : '—';
    return t('workforce.whatIf.describe.crossTrain', { emp, group: groupName });
  }
  return t('workforce.whatIf.describe.release', { count: c.count, role: c.role });
}

function DeltaTile({ label, before, after, delta, better, unit }: {
  label: string;
  before: number;
  after: number;
  delta: number;
  better: 'lower' | 'higher' | 'context';
  unit?: string;
}) {
  const isBetter = better === 'lower' ? delta < 0 : better === 'higher' ? delta > 0 : false;
  const isWorse = better === 'lower' ? delta > 0 : better === 'higher' ? delta < 0 : false;
  const tone = isBetter ? 'emerald' : isWorse ? 'rose' : 'slate';
  const toneClass =
    tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30'
    : tone === 'rose' ? 'text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/30'
    : 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700';
  const fmt = (n: number) => Math.round(n).toLocaleString();
  return (
    <div className={cn('p-2.5 rounded-lg border', toneClass)}>
      <p className="text-[8px] font-black uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xs font-mono">
        <span className="text-slate-500 dark:text-slate-400">{fmt(before)}</span>
        <span className="mx-1.5">→</span>
        <span className="font-black">{fmt(after)}</span>
        {unit && <span className="text-slate-400 dark:text-slate-500 ms-0.5 text-[8px]">{unit}</span>}
      </p>
      <p className="text-[9px] font-mono mt-0.5">
        {delta === 0 ? '±0' : `${delta > 0 ? '+' : ''}${fmt(delta)}`}
      </p>
    </div>
  );
}
