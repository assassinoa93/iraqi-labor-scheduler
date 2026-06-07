/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.27 — Bulk "Record leave for selected". A 50-person Eid closure or a team
 * training day previously meant opening 50 employee modals one at a time. This
 * records one leave range (annual / sick / maternity) across every selected
 * employee in a single pass; the App handler appends the LeaveRange AND stamps
 * the leave onto the schedule grid, exactly like the single-employee path.
 *
 * Public holidays are modelled separately (Holidays tab) and are intentionally
 * NOT a leave type here.
 */
import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, CalendarOff } from 'lucide-react';
import { format } from 'date-fns';
import type { LeaveType } from '../types';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';

interface BulkLeaveModalProps {
  isOpen: boolean;
  count: number;
  onClose: () => void;
  onApply: (args: { type: LeaveType; start: string; end: string; notes: string }) => void;
}

export function BulkLeaveModal({ isOpen, count, onClose, onApply }: BulkLeaveModalProps) {
  const { t } = useI18n();
  const closeButtonRef = useModalKeys(isOpen, onClose) as React.RefObject<HTMLButtonElement>;
  const today = format(new Date(), 'yyyy-MM-dd');
  const [type, setType] = useState<LeaveType>('annual');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setType('annual');
      setStart(today);
      setEnd(today);
      setNotes('');
      setError(null);
    }
    // today is stable within an open session; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleApply = () => {
    if (!start || !end) { setError(t('modal.bulkLeave.error.dates')); return; }
    if (start > end) { setError(t('modal.bulkLeave.error.inverted')); return; }
    onApply({ type, start, end, notes: notes.trim() });
    onClose();
  };

  const types: LeaveType[] = ['annual', 'sick', 'maternity'];

  // Sticky backdrop — Esc / X / Cancel only (data-entry modal convention).
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label={t('modal.bulkLeave.title')}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-center bg-slate-50 dark:bg-slate-800/40">
          <div className="flex items-center gap-2">
            <CalendarOff className="w-5 h-5 text-amber-600 dark:text-amber-300" />
            <div>
              <h3 className="font-black text-slate-800 dark:text-slate-100 uppercase tracking-tighter text-sm">{t('modal.bulkLeave.title')}</h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">{t('modal.bulkLeave.subtitle', { count })}</p>
            </div>
          </div>
          <button ref={closeButtonRef} onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-400 dark:text-slate-500" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.bulkLeave.type')}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LeaveType)}
              className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-medium text-slate-800 dark:text-slate-100"
            >
              {types.map(ty => <option key={ty} value={ty}>{t(`leaves.type.${ty}`)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.bulkLeave.start')}</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono text-slate-800 dark:text-slate-100" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.bulkLeave.end')}</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono text-slate-800 dark:text-slate-100" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.bulkLeave.notes')}</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('modal.bulkLeave.notesPlaceholder')} className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm text-slate-800 dark:text-slate-100" />
          </div>
          {error && (
            <div className="text-[11px] font-bold text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/40 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>
        <div className="p-6 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex justify-end gap-3">
          <button onClick={onClose} className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-4 py-2 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">{t('action.cancel')}</button>
          <button onClick={handleApply} className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-6 py-2 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 dark:hover:bg-white transition-all">{t('modal.bulkLeave.apply')}</button>
        </div>
      </motion.div>
    </div>
  );
}
