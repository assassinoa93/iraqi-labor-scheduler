/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.19.0 — Coverage Scenario Panel.
 *
 * Renders the per-station daily walkthrough computed by
 * `lib/coverageScenario.ts`. The panel sits at the bottom of the
 * Workforce Planning tab and answers the question "given the shift
 * library and station demand, what does an actual day on the floor
 * look like, and how many employees do I need on each station's roster
 * to keep coverage continuous through annual leave and weekly rest?"
 *
 * Each station expands into a horizontal timeline with hour markers,
 * shift bars, and a step-by-step narrative. The roster-required formula
 * (peak HC × days/week ÷ workdays + leave buffer) is surfaced inline
 * so the supervisor sees WHY the recommendation is what it is.
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Activity, AlertTriangle, Users, Clock, MapPin, Sparkles, Calendar, RotateCw } from 'lucide-react';
import { Card } from './Primitives';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';
import { buildCoverageScenarios, summarizeScenarios, type StationScenario } from '../lib/coverageScenario';
import { buildWeeklyRotation, type WeeklyStationRotation } from '../lib/weeklyScenario';
import type { Employee, Shift, Station, StationGroup, Config } from '../types';
import { getGroupIcon } from '../lib/groupIcons';

interface Props {
  stations: Station[];
  shifts: Shift[];
  stationGroups: StationGroup[];
  employees: Employee[];
  config: Config;
}

export function CoverageScenarioPanel({ stations, shifts, stationGroups, employees, config }: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [dayType, setDayType] = useState<'peak' | 'normal'>('peak');
  // v5.19.0 — toggles between the single-day timeline and the weekly
  // rotation simulator. Weekly mode answers "given my current roster
  // can I actually keep coverage continuous through Art. 71 weekly
  // rest?" — it's the operational complement to the abstract WFP
  // headcount math.
  const [view, setView] = useState<'day' | 'week'>('day');

  const scenarios = useMemo(() => buildCoverageScenarios({
    stations, shifts, config,
    isPeakDay: dayType === 'peak',
    stationGroups,
  }), [stations, shifts, config, dayType, stationGroups]);

  const weekly = useMemo(() => view === 'week'
    ? buildWeeklyRotation({ employees, shifts, stations, stationGroups, config })
    : null, [view, employees, shifts, stations, stationGroups, config]);
  const summary = useMemo(() => summarizeScenarios(scenarios, employees), [scenarios, employees]);

  // Group scenarios by station group for the rendering. Stations not
  // in a group are bucketed under "Ungrouped". Order: groups first
  // (matches the kanban's source order), then ungrouped.
  const grouped = useMemo(() => {
    const out = new Map<string, { groupName: string; groupColor?: string; groupIcon?: string; scenarios: StationScenario[] }>();
    for (const sc of scenarios) {
      const key = sc.groupId || '__ungrouped__';
      const groupName = sc.groupName || t('workforce.scenario.ungrouped');
      const group = stationGroups.find(g => g.id === sc.groupId);
      if (!out.has(key)) {
        out.set(key, {
          groupName,
          groupColor: group?.color,
          groupIcon: group?.icon,
          scenarios: [],
        });
      }
      out.get(key)!.scenarios.push(sc);
    }
    return Array.from(out.entries());
  }, [scenarios, stationGroups, t]);

  if (scenarios.length === 0) {
    return null;
  }

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full p-5 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40 flex items-center gap-3 hover:bg-slate-100/50 dark:hover:bg-slate-800 transition-colors text-start"
      >
        <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
            {t('workforce.scenario.title')}
          </h3>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            {t('workforce.scenario.subtitle')}
          </p>
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
      </button>

      {!collapsed && (
        <div className="p-5 space-y-5">
          {/* View + day-type toggles. The View toggle swaps between the
              single-day timeline (default) and the 7-day rotation view.
              Day-type only applies to the single-day view. */}
          <div className="flex items-center gap-2 flex-wrap">
            <ViewToggle view={view} onChange={setView} />
            {view === 'day' && <DayTypeToggle dayType={dayType} onChange={setDayType} />}
          </div>

          {view === 'week' && weekly ? (
            <WeeklyRotationView weekly={weekly} stationGroups={stationGroups} />
          ) : (
          <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 min-w-0">
              <SummaryTile
                label={t('workforce.scenario.summary.stations')}
                value={String(summary.stationCount)}
                icon={<MapPin className="w-3 h-3" />}
                tone="neutral"
              />
              <SummaryTile
                label={t('workforce.scenario.summary.gaps')}
                value={String(summary.stationsWithGaps)}
                icon={<AlertTriangle className="w-3 h-3" />}
                tone={summary.stationsWithGaps > 0 ? 'rose' : 'emerald'}
              />
              <SummaryTile
                label={t('workforce.scenario.summary.uncoveredHours')}
                value={String(summary.totalUncoveredHours)}
                icon={<Clock className="w-3 h-3" />}
                tone={summary.totalUncoveredHours > 0 ? 'amber' : 'emerald'}
              />
              <SummaryTile
                label={t('workforce.scenario.summary.rosterRequired')}
                value={String(summary.totalRosterRequired)}
                icon={<Users className="w-3 h-3" />}
                tone="blue"
              />
            </div>
          </div>

          {/* The key paragraph at the top — explains the scenario in one
              sentence so supervisors who skim get the verdict without
              expanding individual rows. */}
          <div className="p-4 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/10">
            <div className="flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-[11px] font-black text-emerald-800 dark:text-emerald-200 uppercase tracking-widest">
                  {t('workforce.scenario.headline.title')}
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-200 leading-relaxed">
                  {summary.stationsWithGaps === 0
                    ? t('workforce.scenario.headline.allCovered', {
                        stations: summary.stationCount,
                        roster: summary.totalRosterRequired,
                      })
                    : t('workforce.scenario.headline.someGaps', {
                        stations: summary.stationCount,
                        gaps: summary.stationsWithGaps,
                        uncovered: summary.totalUncoveredHours,
                        roster: summary.totalRosterRequired,
                      })}
                </p>
                {summary.largestGap && (
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
                    {t('workforce.scenario.headline.largestGap', {
                      station: summary.largestGap.stationName,
                      hours: summary.largestGap.hours,
                    })}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Per-group → per-station drilldown. Each group row is a
              header; expanding it reveals the per-station timelines. */}
          <div className="space-y-3">
            {grouped.map(([key, group]) => (
              <ScenarioGroupBlock
                key={key}
                groupName={group.groupName}
                groupColor={group.groupColor}
                groupIcon={group.groupIcon}
                scenarios={group.scenarios}
              />
            ))}
          </div>
          </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ViewToggle({ view, onChange }: { view: 'day' | 'week'; onChange: (v: 'day' | 'week') => void }) {
  const { t } = useI18n();
  return (
    <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800 rounded-full p-0.5">
      <button
        type="button"
        onClick={() => onChange('day')}
        className={cn(
          'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5',
          view === 'day' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100',
        )}
      >
        <Clock className="w-3 h-3" /> {t('workforce.scenario.view.day')}
      </button>
      <button
        type="button"
        onClick={() => onChange('week')}
        className={cn(
          'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5',
          view === 'week' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100',
        )}
      >
        <Calendar className="w-3 h-3" /> {t('workforce.scenario.view.week')}
      </button>
    </div>
  );
}

// v5.19.0 — Weekly rotation view. Renders the 7-day grid produced by
// buildWeeklyRotation() — each station as a row, each day as a column,
// each cell shows the assigned employee for each shift slot. Gaps in
// the rotation render with a rose halo so the supervisor instantly
// sees which day-shift can't be filled with the current roster.
function WeeklyRotationView({
  weekly, stationGroups,
}: { weekly: ReturnType<typeof buildWeeklyRotation>; stationGroups: StationGroup[] }) {
  const { t } = useI18n();
  const filledPct = weekly.totalSlots === 0 ? 100 : Math.round((weekly.filledSlots / weekly.totalSlots) * 100);
  const efficiencyPct = Math.round(weekly.averageEfficiency * 100);

  // Group stations by group for visual grouping (matches day-view layout).
  const grouped = useMemo(() => {
    const out = new Map<string, { groupName: string; groupColor?: string; groupIcon?: string; weeks: WeeklyStationRotation[] }>();
    for (const w of weekly.weeks) {
      const key = w.groupId || '__ungrouped__';
      const groupName = w.groupName || t('workforce.scenario.ungrouped');
      const group = stationGroups.find(g => g.id === w.groupId);
      if (!out.has(key)) {
        out.set(key, { groupName, groupColor: group?.color, groupIcon: group?.icon, weeks: [] });
      }
      out.get(key)!.weeks.push(w);
    }
    return Array.from(out.entries());
  }, [weekly, stationGroups, t]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryTile
          label={t('workforce.scenario.weekly.coverage')}
          value={`${filledPct}%`}
          icon={<RotateCw className="w-3 h-3" />}
          tone={filledPct >= 95 ? 'emerald' : filledPct >= 80 ? 'amber' : 'rose'}
        />
        <SummaryTile
          label={t('workforce.scenario.weekly.gaps')}
          value={String(weekly.gapSlots)}
          icon={<AlertTriangle className="w-3 h-3" />}
          tone={weekly.gapSlots > 0 ? 'rose' : 'emerald'}
        />
        <SummaryTile
          label={t('workforce.scenario.weekly.rotation')}
          value={String(weekly.totalRotationSize)}
          icon={<Users className="w-3 h-3" />}
          tone="blue"
        />
        <SummaryTile
          label={t('workforce.scenario.weekly.efficiency')}
          value={`${efficiencyPct}%`}
          icon={<Sparkles className="w-3 h-3" />}
          tone={efficiencyPct >= 70 ? 'emerald' : 'amber'}
        />
      </div>

      <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/10">
        <p className="text-[11px] font-black text-blue-800 dark:text-blue-200 uppercase tracking-widest mb-1">
          {t('workforce.scenario.weekly.headline.title')}
        </p>
        <p className="text-[11px] text-blue-700 dark:text-blue-200 leading-relaxed">
          {t('workforce.scenario.weekly.headline.body', {
            covered: weekly.filledSlots,
            total: weekly.totalSlots,
            roster: weekly.totalRotationSize,
            efficiency: efficiencyPct,
          })}
        </p>
      </div>

      <div className="space-y-3">
        {grouped.map(([key, group]) => (
          <div key={key} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 overflow-hidden">
            <div className="p-3 flex items-center gap-3 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700">
              <span
                className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0"
                style={{ backgroundColor: group.groupColor || '#475569' }}
              />
              <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">{group.groupName}</p>
            </div>
            <div className="p-3 space-y-3">
              {group.weeks.map(w => <WeeklyStationRow key={w.stationId} rotation={w} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyStationRow({ rotation }: { rotation: WeeklyStationRotation }) {
  const { t } = useI18n();
  return (
    <div className={cn(
      'rounded-md border bg-white dark:bg-slate-900/30 p-3 space-y-2',
      rotation.hasGap
        ? 'border-rose-200 dark:border-rose-500/30'
        : 'border-slate-200 dark:border-slate-700/60',
    )}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">{rotation.stationName}</p>
        <div className="flex items-center gap-1.5">
          {rotation.hasGap && (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-200 text-[9px] font-black uppercase tracking-widest">
              {t('workforce.scenario.weekly.gapBadge')}
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[9px] font-black uppercase tracking-widest">
            {rotation.rotationEmpIds.length} {t('workforce.scenario.weekly.inRotation')}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {rotation.days.map(day => (
          <div key={day.dayKey} className={cn(
            'p-1.5 rounded border text-center',
            day.isPeak ? 'bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/30' : 'bg-slate-50/40 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60',
          )}>
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
              {t(`workforce.scenario.weekly.day.${day.dayKey}`)}
            </p>
            {day.slots.length === 0 ? (
              <p className="text-[8px] text-slate-400 dark:text-slate-500 italic">—</p>
            ) : (
              <div className="space-y-0.5">
                {day.slots.map((slot, i) => (
                  <div key={i} className={cn(
                    'rounded px-1 py-0.5 text-[8px] font-mono leading-tight',
                    slot.empId
                      ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-500/15 text-rose-800 dark:text-rose-200',
                  )} title={`${slot.shiftCode} ${slot.shiftName}`}>
                    <span className="font-black">{slot.shiftCode}</span>
                    <br />
                    <span className="text-[7px]">{slot.empName ? slot.empName.split(' ')[0].slice(0, 6) : '∅'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Narrative — one line per day. Helps the supervisor read the
          rotation as a story rather than as a grid. */}
      {rotation.narrative.length > 0 && (
        <details className="text-[10px]">
          <summary className="cursor-pointer text-slate-500 dark:text-slate-400 font-mono hover:text-slate-700 dark:hover:text-slate-200">
            {t('workforce.scenario.weekly.expandNarrative')}
          </summary>
          <ul className="mt-1.5 space-y-0.5 text-slate-600 dark:text-slate-300 font-mono pl-4">
            {rotation.narrative.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function DayTypeToggle({ dayType, onChange }: { dayType: 'peak' | 'normal'; onChange: (d: 'peak' | 'normal') => void }) {
  const { t } = useI18n();
  return (
    <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800 rounded-full p-0.5">
      <button
        type="button"
        onClick={() => onChange('peak')}
        className={cn(
          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
          dayType === 'peak'
            ? "bg-violet-500 text-white shadow-sm"
            : "text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100",
        )}
      >
        {t('workforce.scenario.dayType.peak')}
      </button>
      <button
        type="button"
        onClick={() => onChange('normal')}
        className={cn(
          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
          dayType === 'normal'
            ? "bg-blue-500 text-white shadow-sm"
            : "text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100",
        )}
      >
        {t('workforce.scenario.dayType.normal')}
      </button>
    </div>
  );
}

function SummaryTile({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: 'neutral' | 'rose' | 'amber' | 'emerald' | 'blue' }) {
  const toneClass =
    tone === 'rose' ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/30'
    : tone === 'amber' ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/30'
    : tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30'
    : tone === 'blue' ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 border-blue-200 dark:border-blue-500/30'
    : 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700';
  return (
    <div className={cn('p-2.5 rounded-lg border', toneClass)}>
      <p className="text-[8px] font-black uppercase tracking-widest mb-1 flex items-center gap-1">{icon}{label}</p>
      <p className="text-lg font-black tabular-nums">{value}</p>
    </div>
  );
}

function ScenarioGroupBlock({ groupName, groupColor, groupIcon, scenarios }: {
  groupName: string;
  groupColor?: string;
  groupIcon?: string;
  scenarios: StationScenario[];
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const groupGaps = scenarios.reduce((s, sc) => s + sc.uncoveredHours, 0);
  const groupRoster = scenarios.reduce((s, sc) => s + sc.rosterRequired.bufferedRoster, 0);
  const Icon = getGroupIcon(groupIcon);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full p-3 flex items-center gap-3 hover:bg-slate-50/40 dark:hover:bg-slate-800/40 transition-colors text-start"
      >
        <span
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0"
          style={{ backgroundColor: groupColor || '#475569' }}
        >
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100 truncate">{groupName}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            {scenarios.length} {scenarios.length === 1 ? t('workforce.scenario.station') : t('workforce.scenario.stations')}
            {groupGaps > 0 && (
              <span className="text-amber-600 dark:text-amber-300 ms-2">· {groupGaps}h {t('workforce.scenario.gaps')}</span>
            )}
            <span className="ms-2">· {groupRoster} {t('workforce.scenario.roster')}</span>
          </p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3">
          {scenarios.map(sc => <StationScenarioRow key={sc.stationId} scenario={sc} />)}
        </div>
      )}
    </div>
  );
}

// One station's scenario: timeline strip on top, narrative steps below,
// then the roster-required explainer.
function StationScenarioRow({ scenario }: { scenario: StationScenario }) {
  const { t } = useI18n();
  const span = scenario.closingHour > scenario.openingHour
    ? scenario.closingHour - scenario.openingHour
    : (24 - scenario.openingHour) + scenario.closingHour;
  // Bar palette — assign colours by shift code so the same shift code
  // always renders in the same colour across the timeline.
  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#84cc16'];
  const colorByCode = new Map<string, string>();
  scenario.coveringShifts.forEach((sh, i) => colorByCode.set(sh.code, palette[i % palette.length]));

  return (
    <div className="rounded-md border border-slate-100 dark:border-slate-700/60 bg-slate-50/40 dark:bg-slate-800/40 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100 truncate">{scenario.stationName}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            {fmtHour(scenario.openingHour)}–{fmtHour(scenario.closingHour)} · {span}h · peak {scenario.peakConcurrentHC} {t('workforce.scenario.concurrent')}
          </p>
        </div>
        {scenario.uncoveredHours > 0 ? (
          <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 text-[9px] font-black uppercase tracking-widest">
            {t('workforce.scenario.uncoveredBadge', { hours: scenario.uncoveredHours })}
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200 text-[9px] font-black uppercase tracking-widest">
            {t('workforce.scenario.coveredBadge')}
          </span>
        )}
      </div>

      {/* Timeline bars */}
      <div className="space-y-1.5">
        <div className="relative h-7 bg-slate-100 dark:bg-slate-800/60 rounded-md overflow-hidden">
          {scenario.coveringShifts.map((sh, i) => {
            // Render the bar's left/right offset relative to the open
            // window. Shifts that start before the open window or end
            // after it are clipped to the visible range.
            const left = Math.max(0, ((sh.startHour - scenario.openingHour) / span) * 100);
            const right = Math.max(0, Math.min(100, ((sh.endHour - scenario.openingHour) / span) * 100));
            const width = Math.max(0, right - left);
            if (width <= 0) return null;
            return (
              <div
                key={sh.code + i}
                title={`${sh.code} ${sh.name} ${fmtHour(sh.startHour)}–${fmtHour(sh.endHour)}`}
                className="absolute h-full flex items-center justify-center text-[8px] font-black text-white tracking-widest"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: colorByCode.get(sh.code),
                  opacity: 0.85,
                  top: i % 2 === 0 ? '0' : '50%',
                  height: '50%',
                }}
              >
                {width > 8 ? sh.code : ''}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[8px] font-mono text-slate-400 dark:text-slate-500">
          <span>{fmtHour(scenario.openingHour)}</span>
          <span>{fmtHour(scenario.closingHour)}</span>
        </div>
      </div>

      {/* Step-by-step narrative — at most ~6 steps; supervisors read this
          like a story rather than a table. */}
      <ol className="space-y-1.5 text-[11px]">
        {scenario.timeline.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 w-12 shrink-0 pt-0.5">
              {fmtHour(step.hour)}
            </span>
            <span className="flex-1 min-w-0 leading-relaxed">
              {renderStepNarrative(step, t)}
            </span>
          </li>
        ))}
      </ol>

      {/* Roster-required explainer */}
      <div className="p-2.5 rounded-md bg-blue-50/50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/30">
        <div className="flex items-start gap-2">
          <Users className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black text-blue-700 dark:text-blue-200 uppercase tracking-widest mb-0.5">
              {t('workforce.scenario.rosterRequired')}: {scenario.rosterRequired.bufferedRoster}
            </p>
            <p className="text-[10px] text-blue-700 dark:text-blue-200 leading-relaxed">
              {scenario.rosterRequired.explanation}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderStepNarrative(step: ReturnType<typeof Object> extends never ? never : import('../lib/coverageScenario').CoverageStep, t: (k: string, p?: Record<string, string | number>) => string): string {
  switch (step.kind) {
    case 'open':
      return step.startedShifts.length > 0
        ? t('workforce.scenario.step.open', {
            shifts: step.startedShifts.join(', '),
            hc: step.requiredHC,
            on_floor: step.shiftsOnFloor.length,
          })
        : t('workforce.scenario.step.openNoShift', { hc: step.requiredHC });
    case 'shift-start':
      return t('workforce.scenario.step.handoffStart', {
        shifts: step.startedShifts.join(', '),
        on_floor: step.shiftsOnFloor.length,
        concurrent: step.concurrentEmployeesIfStaffedToHC,
      });
    case 'shift-end':
      return t('workforce.scenario.step.handoffEnd', {
        shifts: step.endedShifts.join(', '),
        on_floor: step.shiftsOnFloor.length,
        concurrent: step.concurrentEmployeesIfStaffedToHC,
      });
    case 'gap':
      return t('workforce.scenario.step.gap', { hc: step.requiredHC });
    case 'close':
      return t('workforce.scenario.step.close', {
        ended: step.endedShifts.join(', ') || '—',
      });
  }
}

function fmtHour(h: number): string {
  if (h >= 24) return '24:00';
  const hh = Math.max(0, Math.min(24, h | 0));
  return `${String(hh).padStart(2, '0')}:00`;
}
