/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Scope bar.
 *
 * Pill-shaped readout of the active AI session's per-domain windows.
 * Each pill is clickable; clicking opens a tiny inline editor for that
 * domain (month range / date range / year). Phase 4's chat panel wires
 * this to the actual tool layer; in phase 2 it works as a preview so
 * the planner can see and tweak what the AI will see when the chat
 * panel ships.
 *
 * The component is presentational — it doesn't read or write
 * sessionStorage itself. The parent owns the AiScope state via
 * useAiScope() and passes it down.
 */

import React, { useState } from 'react';
import { Calendar, Clock, FileSpreadsheet, TrendingUp, X, Sparkles } from 'lucide-react';
import {
  type AiScope, type MonthRange, type DateRange,
  formatMonthRange, formatDateRange, isoToday,
} from '../../lib/ai/scope';
import type { DataSurvey } from '../../lib/ai/dataSurvey';
import { useI18n } from '../../lib/i18n';

interface Props {
  scope: AiScope;
  onChange: (next: AiScope) => void;
  survey: DataSurvey | null;
}

type EditorTarget = 'schedules' | 'payroll' | 'leave' | 'wfp' | null;

/** Translator signature, matching useI18n()'s `t`. Passed into the
 *  presentational sub-editors so they can localize without each
 *  pulling the hook (keeps them pure/testable). */
type TFn = (key: string, vars?: Record<string, string | number>) => string;

export function ScopeBar({ scope, onChange, survey }: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<EditorTarget>(null);
  // Localized short month names (Jan…/يناير…), resolved once for the pills
  // and threaded into the month editors.
  const monthNames = MONTH_KEYS.map((k) => t(k));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <ScopePill
          icon={Calendar}
          label={t('ai.scope.pill.schedules')}
          value={formatMonthRange(scope.schedules, monthNames)}
          onClick={() => setEditing(editing === 'schedules' ? null : 'schedules')}
          active={editing === 'schedules'}
        />
        <ScopePill
          icon={FileSpreadsheet}
          label={t('ai.scope.pill.payroll')}
          value={formatMonthRange(scope.payroll, monthNames)}
          onClick={() => setEditing(editing === 'payroll' ? null : 'payroll')}
          active={editing === 'payroll'}
        />
        <ScopePill
          icon={Clock}
          label={t('ai.scope.pill.leave')}
          value={
            scope.leave.range
              ? formatDateRange(scope.leave.range)
              : t('ai.scope.leave.asOf', { date: scope.leave.asOf })
          }
          onClick={() => setEditing(editing === 'leave' ? null : 'leave')}
          active={editing === 'leave'}
        />
        <ScopePill
          icon={TrendingUp}
          label={t('ai.scope.pill.wfp')}
          value={scope.wfp ? String(scope.wfp.year) : '—'}
          onClick={() => setEditing(editing === 'wfp' ? null : 'wfp')}
          active={editing === 'wfp'}
        />
      </div>

      {editing === 'schedules' && (
        <MonthRangeEditor
          label={t('ai.scope.editor.schedules.title')}
          value={scope.schedules}
          survey={survey}
          domain="schedules"
          t={t}
          onSave={(r) => { onChange({ ...scope, schedules: r }); setEditing(null); }}
          onClear={() => { onChange({ ...scope, schedules: null }); setEditing(null); }}
        />
      )}
      {editing === 'payroll' && (
        <MonthRangeEditor
          label={t('ai.scope.editor.payroll.title')}
          value={scope.payroll}
          survey={survey}
          domain="payroll"
          t={t}
          onSave={(r) => { onChange({ ...scope, payroll: r }); setEditing(null); }}
          onClear={() => { onChange({ ...scope, payroll: null }); setEditing(null); }}
        />
      )}
      {editing === 'leave' && (
        <LeaveEditor
          range={scope.leave.range}
          asOf={scope.leave.asOf}
          t={t}
          onSave={(range, asOf) => {
            onChange({ ...scope, leave: { range, asOf } });
            setEditing(null);
          }}
          onClear={() => { onChange({ ...scope, leave: { range: null, asOf: isoToday() } }); setEditing(null); }}
        />
      )}
      {editing === 'wfp' && (
        <YearEditor
          value={scope.wfp?.year ?? null}
          defaultYear={survey?.wfp.defaultYear ?? new Date().getFullYear()}
          t={t}
          onSave={(year) => { onChange({ ...scope, wfp: year != null ? { year } : null }); setEditing(null); }}
          onClear={() => { onChange({ ...scope, wfp: null }); setEditing(null); }}
        />
      )}
    </div>
  );
}

// ─── Pill ───────────────────────────────────────────────────────────────

function ScopePill({
  icon: Icon, label, value, onClick, active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-colors duration-150 ${
        active
          ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/25'
          : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-300 dark:hover:border-blue-500/40'
      }`}
    >
      <Icon className={`w-3 h-3 ${active ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} />
      <span className="uppercase tracking-widest text-[9px] opacity-80">{label}</span>
      <span className="font-mono">{value}</span>
    </button>
  );
}

// ─── Inline editors ─────────────────────────────────────────────────────

function MonthRangeEditor({
  label, value, survey, domain, t, onSave, onClear,
}: {
  label: string;
  value: MonthRange | null;
  survey: DataSurvey | null;
  domain: 'schedules' | 'payroll';
  t: TFn;
  onSave: (r: MonthRange) => void;
  onClear: () => void;
}) {
  const today = new Date();
  const fallback: MonthRange = value ?? {
    fromYear: today.getFullYear(),
    fromMonth: Math.max(1, today.getMonth() - 1),
    toYear: today.getFullYear(),
    toMonth: today.getMonth() + 1,
  };
  const [draft, setDraft] = useState<MonthRange>(fallback);
  const bounds = survey ? survey[domain] : null;

  return (
    <EditorShell title={label} t={t} hint={
      bounds && bounds.earliest && bounds.latest
        ? t('ai.scope.editor.available', {
            fromMonth: t(MONTH_KEYS[bounds.earliest.month - 1]),
            fromYear: bounds.earliest.year,
            toMonth: t(MONTH_KEYS[bounds.latest.month - 1]),
            toYear: bounds.latest.year,
            count: bounds.monthCount,
          })
        : t('ai.scope.editor.noData')
    } onClose={onClear}>
      <div className="grid grid-cols-2 gap-3">
        <MonthYearField label={t('ai.scope.editor.from')} year={draft.fromYear} month={draft.fromMonth} t={t}
          onChange={(y, m) => setDraft({ ...draft, fromYear: y, fromMonth: m })} />
        <MonthYearField label={t('ai.scope.editor.to')} year={draft.toYear} month={draft.toMonth} t={t}
          onChange={(y, m) => setDraft({ ...draft, toYear: y, toMonth: m })} />
      </div>
      <EditorActions t={t} onSave={() => onSave(normalizeMonthRange(draft))} onClear={onClear} />
    </EditorShell>
  );
}

function LeaveEditor({
  range, asOf, t, onSave, onClear,
}: {
  range: DateRange | null;
  asOf: string;
  t: TFn;
  onSave: (range: DateRange | null, asOf: string) => void;
  onClear: () => void;
}) {
  const [from, setFrom] = useState(range?.from ?? '');
  const [to, setTo] = useState(range?.to ?? '');
  const [asOfDraft, setAsOfDraft] = useState(asOf);

  return (
    <EditorShell
      title={t('ai.scope.editor.leave.title')}
      hint={t('ai.scope.editor.leave.hint')}
      t={t}
      onClose={onClear}
    >
      <div className="grid grid-cols-3 gap-3">
        <LabeledInput label={t('ai.scope.editor.leave.historyFrom')} type="date" value={from} onChange={setFrom} />
        <LabeledInput label={t('ai.scope.editor.leave.historyTo')} type="date" value={to} onChange={setTo} />
        <LabeledInput label={t('ai.scope.editor.leave.balancesAsOf')} type="date" value={asOfDraft} onChange={setAsOfDraft} />
      </div>
      <EditorActions
        t={t}
        onSave={() => onSave(from && to ? { from, to } : null, asOfDraft || isoToday())}
        onClear={onClear}
      />
    </EditorShell>
  );
}

function YearEditor({
  value, defaultYear, t, onSave, onClear,
}: {
  value: number | null;
  defaultYear: number;
  t: TFn;
  onSave: (year: number | null) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState<number>(value ?? defaultYear);
  return (
    <EditorShell title={t('ai.scope.editor.wfp.title')} hint={t('ai.scope.editor.wfp.hint')} t={t} onClose={onClear}>
      <div className="grid grid-cols-1 gap-3">
        <LabeledInput
          label={t('ai.scope.editor.wfp.year')}
          type="number"
          value={String(draft)}
          onChange={(v) => setDraft(Number(v) || draft)}
        />
      </div>
      <EditorActions t={t} onSave={() => onSave(draft)} onClear={onClear} />
    </EditorShell>
  );
}

// ─── Editor primitives ─────────────────────────────────────────────────

function EditorShell({
  title, hint, t, children, onClose,
}: { title: string; hint: string; t: TFn; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/70 rounded-xl shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black text-slate-700 dark:text-slate-100 uppercase tracking-widest">{title}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label={t('ai.scope.editor.close.ariaLabel')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

function EditorActions({ t, onSave, onClear }: { t: TFn; onSave: () => void; onClear: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button
        onClick={onClear}
        className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700"
      >
        {t('ai.scope.editor.clear')}
      </button>
      <button
        onClick={onSave}
        className="apple-press px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 shadow-md shadow-blue-500/25"
      >
        {t('ai.scope.editor.save')}
      </button>
    </div>
  );
}

function LabeledInput({
  label, type, value, onChange,
}: { label: string; type: 'date' | 'number' | 'text'; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="block text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-1.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
      />
    </div>
  );
}

// i18n keys for the month <select>. Resolved via t() so the dropdown and the
// scope pills show localized month names in Arabic mode (mirrors the
// WorkforcePlanningTab / Primitives convention).
const MONTH_KEYS = [
  'common.month.short.jan', 'common.month.short.feb', 'common.month.short.mar', 'common.month.short.apr',
  'common.month.short.may', 'common.month.short.jun', 'common.month.short.jul', 'common.month.short.aug',
  'common.month.short.sep', 'common.month.short.oct', 'common.month.short.nov', 'common.month.short.dec',
];

function MonthYearField({
  label, year, month, t, onChange,
}: { label: string; year: number; month: number; t: TFn; onChange: (y: number, m: number) => void }) {
  return (
    <div className="space-y-1">
      <label className="block text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{label}</label>
      <div className="flex gap-1.5">
        <select
          value={month}
          onChange={(e) => onChange(year, Number(e.target.value))}
          className="flex-1 px-2 py-1.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          {MONTH_KEYS.map((key, i) => (
            <option key={key} value={i + 1}>{t(key)}</option>
          ))}
        </select>
        <input
          type="number"
          value={year}
          onChange={(e) => onChange(Number(e.target.value) || year, month)}
          className="w-20 px-2 py-1.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
      </div>
    </div>
  );
}

function normalizeMonthRange(r: MonthRange): MonthRange {
  // Make sure `from` <= `to` so downstream consumers don't have to.
  const fromKey = r.fromYear * 12 + (r.fromMonth - 1);
  const toKey = r.toYear * 12 + (r.toMonth - 1);
  if (fromKey <= toKey) return r;
  return {
    fromYear: r.toYear, fromMonth: r.toMonth,
    toYear: r.fromYear, toMonth: r.fromMonth,
  };
}

// ─── Default-scope helper button (used by AIServicesTab overview) ─────

export function ApplyDefaultScopeButton({
  survey, onApply,
}: { survey: DataSurvey; onApply: (next: AiScope) => void }) {
  const { t } = useI18n();
  const handle = () => {
    const today = new Date();
    const latestSched = survey.schedules.latest;
    const earliestSched = survey.schedules.earliest;

    let scheduleRange: MonthRange | null = null;
    if (latestSched) {
      let yr = latestSched.year;
      let mo = latestSched.month - 2;
      while (mo < 1) { mo += 12; yr -= 1; }
      if (earliestSched && (yr < earliestSched.year || (yr === earliestSched.year && mo < earliestSched.month))) {
        yr = earliestSched.year; mo = earliestSched.month;
      }
      scheduleRange = { fromYear: yr, fromMonth: mo, toYear: latestSched.year, toMonth: latestSched.month };
    }
    const next: AiScope = {
      schedules: scheduleRange,
      payroll: scheduleRange ? { ...scheduleRange } : null,
      leave: {
        range: survey.leave.earliest && survey.leave.latest
          ? { from: survey.leave.earliest, to: survey.leave.latest }
          : null,
        asOf: today.toISOString().slice(0, 10),
      },
      wfp: { year: survey.wfp.defaultYear },
    };
    onApply(next);
  };
  return (
    <button
      onClick={handle}
      className="apple-press inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 shadow-md shadow-blue-500/25"
    >
      <Sparkles className="w-3 h-3" />
      {t('ai.scope.applySuggested')}
    </button>
  );
}
