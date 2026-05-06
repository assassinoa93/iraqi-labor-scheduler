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

interface Props {
  scope: AiScope;
  onChange: (next: AiScope) => void;
  survey: DataSurvey | null;
}

type EditorTarget = 'schedules' | 'payroll' | 'leave' | 'wfp' | null;

export function ScopeBar({ scope, onChange, survey }: Props) {
  const [editing, setEditing] = useState<EditorTarget>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <ScopePill
          icon={Calendar}
          label="Schedules"
          value={formatMonthRange(scope.schedules)}
          onClick={() => setEditing(editing === 'schedules' ? null : 'schedules')}
          active={editing === 'schedules'}
        />
        <ScopePill
          icon={FileSpreadsheet}
          label="Payroll"
          value={formatMonthRange(scope.payroll)}
          onClick={() => setEditing(editing === 'payroll' ? null : 'payroll')}
          active={editing === 'payroll'}
        />
        <ScopePill
          icon={Clock}
          label="Leave"
          value={
            scope.leave.range
              ? formatDateRange(scope.leave.range)
              : `as of ${scope.leave.asOf}`
          }
          onClick={() => setEditing(editing === 'leave' ? null : 'leave')}
          active={editing === 'leave'}
        />
        <ScopePill
          icon={TrendingUp}
          label="WFP"
          value={scope.wfp ? String(scope.wfp.year) : '—'}
          onClick={() => setEditing(editing === 'wfp' ? null : 'wfp')}
          active={editing === 'wfp'}
        />
      </div>

      {editing === 'schedules' && (
        <MonthRangeEditor
          label="Schedules window"
          value={scope.schedules}
          survey={survey}
          domain="schedules"
          onSave={(r) => { onChange({ ...scope, schedules: r }); setEditing(null); }}
          onClear={() => { onChange({ ...scope, schedules: null }); setEditing(null); }}
        />
      )}
      {editing === 'payroll' && (
        <MonthRangeEditor
          label="Payroll window"
          value={scope.payroll}
          survey={survey}
          domain="payroll"
          onSave={(r) => { onChange({ ...scope, payroll: r }); setEditing(null); }}
          onClear={() => { onChange({ ...scope, payroll: null }); setEditing(null); }}
        />
      )}
      {editing === 'leave' && (
        <LeaveEditor
          range={scope.leave.range}
          asOf={scope.leave.asOf}
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
  label, value, survey, domain, onSave, onClear,
}: {
  label: string;
  value: MonthRange | null;
  survey: DataSurvey | null;
  domain: 'schedules' | 'payroll';
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
    <EditorShell title={label} hint={
      bounds && bounds.earliest && bounds.latest
        ? `Available: ${MONTHS[bounds.earliest.month - 1]} ${bounds.earliest.year} → ${MONTHS[bounds.latest.month - 1]} ${bounds.latest.year} (${bounds.monthCount} months)`
        : 'No data on file yet.'
    } onClose={onClear}>
      <div className="grid grid-cols-2 gap-3">
        <MonthYearField label="From" year={draft.fromYear} month={draft.fromMonth}
          onChange={(y, m) => setDraft({ ...draft, fromYear: y, fromMonth: m })} />
        <MonthYearField label="To" year={draft.toYear} month={draft.toMonth}
          onChange={(y, m) => setDraft({ ...draft, toYear: y, toMonth: m })} />
      </div>
      <EditorActions onSave={() => onSave(normalizeMonthRange(draft))} onClear={onClear} />
    </EditorShell>
  );
}

function LeaveEditor({
  range, asOf, onSave, onClear,
}: {
  range: DateRange | null;
  asOf: string;
  onSave: (range: DateRange | null, asOf: string) => void;
  onClear: () => void;
}) {
  const [from, setFrom] = useState(range?.from ?? '');
  const [to, setTo] = useState(range?.to ?? '');
  const [asOfDraft, setAsOfDraft] = useState(asOf);

  return (
    <EditorShell
      title="Leave window"
      hint="Leave history range is optional. `As of` controls the date used for current balance calculations."
      onClose={onClear}
    >
      <div className="grid grid-cols-3 gap-3">
        <LabeledInput label="History from" type="date" value={from} onChange={setFrom} />
        <LabeledInput label="History to" type="date" value={to} onChange={setTo} />
        <LabeledInput label="Balances as of" type="date" value={asOfDraft} onChange={setAsOfDraft} />
      </div>
      <EditorActions
        onSave={() => onSave(from && to ? { from, to } : null, asOfDraft || isoToday())}
        onClear={onClear}
      />
    </EditorShell>
  );
}

function YearEditor({
  value, defaultYear, onSave, onClear,
}: {
  value: number | null;
  defaultYear: number;
  onSave: (year: number | null) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState<number>(value ?? defaultYear);
  return (
    <EditorShell title="Workforce planning year" hint="Full-year forecast. Pick any year — WFP projects from current employees + holidays." onClose={onClear}>
      <div className="grid grid-cols-1 gap-3">
        <LabeledInput
          label="Year"
          type="number"
          value={String(draft)}
          onChange={(v) => setDraft(Number(v) || draft)}
        />
      </div>
      <EditorActions onSave={() => onSave(draft)} onClear={onClear} />
    </EditorShell>
  );
}

// ─── Editor primitives ─────────────────────────────────────────────────

function EditorShell({
  title, hint, children, onClose,
}: { title: string; hint: string; children: React.ReactNode; onClose: () => void }) {
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
          aria-label="Close editor"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

function EditorActions({ onSave, onClear }: { onSave: () => void; onClear: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button
        onClick={onClear}
        className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700"
      >
        Clear
      </button>
      <button
        onClick={onSave}
        className="apple-press px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 shadow-md shadow-blue-500/25"
      >
        Save scope
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function MonthYearField({
  label, year, month, onChange,
}: { label: string; year: number; month: number; onChange: (y: number, m: number) => void }) {
  return (
    <div className="space-y-1">
      <label className="block text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{label}</label>
      <div className="flex gap-1.5">
        <select
          value={month}
          onChange={(e) => onChange(year, Number(e.target.value))}
          className="flex-1 px-2 py-1.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>{name}</option>
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
      Apply suggested scope
    </button>
  );
}
