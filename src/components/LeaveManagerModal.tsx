import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Trash2, Calendar, Heart, Stethoscope, Baby, Paintbrush } from 'lucide-react';
import { Employee, LeaveRange, LeaveType, Schedule, Config } from '../types';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';
import { listAllLeaveRanges, newLeaveRangeId, applyLeaveRanges, deriveLeaveRangesFromSchedule } from '../lib/leaves';
import { cn } from '../lib/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  employee: Employee | null;
  onSave: (next: Employee) => void;
  // Optional schedule + config so the modal can show painted leave ranges
  // (AL/SL/MAT cells the supervisor stamped directly on the schedule grid)
  // alongside the manually-managed ones. Painted ranges render as read-
  // only since their source of truth is the schedule, not the employee.
  schedule?: Schedule;
  config?: Config;
}

const TYPE_META: Record<LeaveType, { icon: React.ComponentType<{ className?: string }>; tone: string; labelKey: string; articleKey: string }> = {
  annual:    { icon: Calendar,    tone: 'emerald', labelKey: 'leaves.type.annual',    articleKey: 'leaves.type.annual.article' },
  sick:      { icon: Stethoscope, tone: 'amber',   labelKey: 'leaves.type.sick',      articleKey: 'leaves.type.sick.article' },
  maternity: { icon: Baby,        tone: 'rose',    labelKey: 'leaves.type.maternity', articleKey: 'leaves.type.maternity.article' },
};

// Multi-range leave editor. Lets the user record any number of leave windows
// per employee, each with its own type, start, end, and optional notes.
// Replaces the single-range fields that used to live on the Employee modal.
// Save flushes to the new `leaveRanges` field and clears the legacy
// single-range fields, so this becomes the canonical source of truth.
export function LeaveManagerModal({ isOpen, onClose, employee, onSave, schedule, config }: Props) {
  const { t } = useI18n();
  const closeButtonRef = useModalKeys(isOpen, onClose) as React.RefObject<HTMLButtonElement>;
  const [draft, setDraft] = useState<LeaveRange[]>([]);

  // Reseed the draft whenever the modal opens for a new employee. We seed
  // from the unified list helper so legacy single-range fields surface as
  // editable rows (and get re-saved as multi-range entries on commit).
  useEffect(() => {
    if (isOpen && employee) setDraft(listAllLeaveRanges(employee).map(r => ({ ...r })));
  }, [isOpen, employee]);

  // Painted ranges (v1.16): derived live from the current schedule each
  // render so the modal stays in sync after the auto-scheduler overwrites
  // AL/SL/MAT cells. These are READ-ONLY in the modal — their source of
  // truth is the schedule grid, not the employee record. Surfaced here
  // alongside the editable manual ranges so the supervisor sees a single
  // unified leave history.
  const paintedRanges = useMemo(() => {
    if (!employee || !schedule || !config) return [];
    return deriveLeaveRangesFromSchedule(employee, schedule, config);
  }, [employee, schedule, config]);

  const totalDaysByType = useMemo(() => {
    const out: Record<LeaveType, number> = { annual: 0, sick: 0, maternity: 0 };
    for (const r of draft) {
      if (!r.start || !r.end || r.end < r.start) continue;
      const start = new Date(r.start);
      const end = new Date(r.end);
      const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
      out[r.type] += days;
    }
    return out;
  }, [draft]);

  if (!employee) return null;

  const addRange = (type: LeaveType) => {
    const today = new Date().toISOString().slice(0, 10);
    setDraft(prev => [
      ...prev,
      { id: newLeaveRangeId(), type, start: today, end: today, notes: '' },
    ]);
  };

  const updateRange = (idx: number, patch: Partial<LeaveRange>) => {
    setDraft(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRange = (idx: number) => {
    setDraft(prev => prev.filter((_, i) => i !== idx));
  };

  const commit = () => {
    // Filter out malformed rows so the saved data stays clean. Re-id any
    // legacy synthetic rows so they become real persisted entries.
    const cleaned: LeaveRange[] = draft
      .filter(r => r.start && r.end && r.end >= r.start)
      .map(r => ({
        id: r.id.startsWith('__legacy_') ? newLeaveRangeId() : r.id,
        type: r.type,
        start: r.start,
        end: r.end,
        notes: r.notes?.trim() || undefined,
      }));
    onSave(applyLeaveRanges(employee, cleaned));
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={t('leaves.modal.title')}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="bg-white w-full max-w-3xl rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-slate-800">{t('leaves.modal.title')}</h3>
                <p className="text-[11px] text-slate-500 mt-1">
                  {employee.name} · <span className="font-mono">{employee.empId}</span>
                </p>
              </div>
              <button ref={closeButtonRef} onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mr-2">{t('leaves.modal.addNew')}</span>
              {(['annual', 'sick', 'maternity'] as LeaveType[]).map(type => {
                const meta = TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <button
                    key={type}
                    onClick={() => addRange(type)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all",
                      meta.tone === 'emerald' && "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100",
                      meta.tone === 'amber'   && "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100",
                      meta.tone === 'rose'    && "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100",
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    <Plus className="w-3 h-3" />
                    {t(meta.labelKey)}
                  </button>
                );
              })}
              <div className="ml-auto text-[10px] font-mono text-slate-500">
                {t('leaves.modal.totals', { annual: totalDaysByType.annual, sick: totalDaysByType.sick, maternity: totalDaysByType.maternity })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {draft.length === 0 && (
                <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
                  <Heart className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{t('leaves.modal.empty')}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{t('leaves.modal.emptyHint')}</p>
                </div>
              )}
              {draft.map((r, idx) => {
                const meta = TYPE_META[r.type];
                const Icon = meta.icon;
                const invalid = !r.start || !r.end || r.end < r.start;
                return (
                  <div
                    key={r.id}
                    className={cn(
                      "p-4 rounded-xl border bg-white",
                      meta.tone === 'emerald' && "border-emerald-200 bg-emerald-50/30",
                      meta.tone === 'amber'   && "border-amber-200 bg-amber-50/30",
                      meta.tone === 'rose'    && "border-rose-200 bg-rose-50/30",
                      invalid && "ring-1 ring-red-300",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                        meta.tone === 'emerald' && "bg-emerald-100 text-emerald-700",
                        meta.tone === 'amber'   && "bg-amber-100 text-amber-700",
                        meta.tone === 'rose'    && "bg-rose-100 text-rose-700",
                      )}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-700">{t(meta.labelKey)}</span>
                          <span className="font-mono text-[9px] text-slate-400">{t(meta.articleKey)}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{t('leaves.range.start')}</label>
                            <input
                              type="date"
                              value={r.start}
                              onChange={e => updateRange(idx, { start: e.target.value })}
                              className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{t('leaves.range.end')}</label>
                            <input
                              type="date"
                              value={r.end}
                              onChange={e => updateRange(idx, { end: e.target.value })}
                              className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs font-mono"
                            />
                          </div>
                        </div>
                        <input
                          type="text"
                          placeholder={t('leaves.range.notesPlaceholder')}
                          value={r.notes ?? ''}
                          onChange={e => updateRange(idx, { notes: e.target.value })}
                          className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-[11px]"
                        />
                        {invalid && (
                          <p className="text-[10px] text-red-600 font-bold">{t('leaves.range.invalidDates')}</p>
                        )}
                      </div>
                      <button
                        onClick={() => removeRange(idx)}
                        aria-label={t('action.delete')}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Painted ranges (v1.16) — derived live from the schedule and
                  rendered read-only. Source of truth is the schedule grid;
                  to edit them, the supervisor goes back to the schedule
                  and re-paints. We dedupe against manual ranges of the
                  same type that fully cover the painted period. */}
              {paintedRanges.length > 0 && (() => {
                const filtered = paintedRanges.filter(p => !draft.some(m =>
                  m.type === p.type && m.start <= p.start && m.end >= p.end));
                if (filtered.length === 0) return null;
                return (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      <Paintbrush className="w-3 h-3" />
                      <span>{t('leaves.modal.painted.header')}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">{t('leaves.modal.painted.body')}</p>
                    {filtered.map(r => {
                      const meta = TYPE_META[r.type];
                      const Icon = meta.icon;
                      return (
                        <div
                          key={r.id}
                          className={cn(
                            "p-3 rounded-xl border bg-slate-50 opacity-90",
                            meta.tone === 'emerald' && "border-emerald-200/70",
                            meta.tone === 'amber' && "border-amber-200/70",
                            meta.tone === 'rose' && "border-rose-200/70",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div className={cn(
                              "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                              meta.tone === 'emerald' && "bg-emerald-100 text-emerald-700",
                              meta.tone === 'amber' && "bg-amber-100 text-amber-700",
                              meta.tone === 'rose' && "bg-rose-100 text-rose-700",
                            )}>
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-xs font-bold text-slate-700">{t(meta.labelKey)}</span>
                                <span className="font-mono text-[10px] text-slate-500">{r.start} → {r.end}</span>
                                <span className="font-mono text-[8px] font-black uppercase tracking-widest bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                                  {t('leaves.modal.painted.tag')}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
              <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all uppercase tracking-widest">
                {t('action.cancel')}
              </button>
              <button
                onClick={commit}
                className="px-8 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-slate-800 transition-all shadow-lg uppercase tracking-widest"
              >
                {t('leaves.modal.save')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
