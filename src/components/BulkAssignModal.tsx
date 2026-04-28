import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CalendarRange, Sparkles } from 'lucide-react';
import { Shift } from '../types';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  shifts: Shift[];
  daysInMonth: number;
  onApply: (shiftCode: string, fromDay: number, toDay: number, overwrite: boolean) => void;
}

// Bulk-assigns a shift code to a contiguous range of days for every selected
// employee. Designed for the "I just hired ten cashiers, give them all the
// morning shift Monday-Friday" use case. The user picks the shift, the day
// range, and whether to overwrite existing entries (default: keep existing
// non-empty cells so a leave or rest day isn't accidentally clobbered).
export function BulkAssignModal({ isOpen, onClose, selectedCount, shifts, daysInMonth, onApply }: Props) {
  const { t } = useI18n();
  const closeButtonRef = useModalKeys(isOpen, onClose) as React.RefObject<HTMLButtonElement>;
  const [shiftCode, setShiftCode] = useState<string>('');
  const [fromDay, setFromDay] = useState<number>(1);
  const [toDay, setToDay] = useState<number>(daysInMonth);
  const [overwrite, setOverwrite] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setShiftCode(shifts[0]?.code ?? '');
      setFromDay(1);
      setToDay(daysInMonth);
      setOverwrite(false);
    }
  }, [isOpen, shifts, daysInMonth]);

  const apply = () => {
    if (!shiftCode) return;
    const lo = Math.min(fromDay, toDay);
    const hi = Math.max(fromDay, toDay);
    onApply(shiftCode, lo, hi, overwrite);
  };

  const totalCells = selectedCount * (Math.abs(toDay - fromDay) + 1);

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
          aria-label={t('bulkAssign.title')}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="bg-white w-full max-w-lg rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-emerald-50 to-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center">
                  <CalendarRange className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{t('bulkAssign.title')}</h3>
                  <p className="text-[11px] text-slate-500">{t('bulkAssign.subtitle', { count: selectedCount })}</p>
                </div>
              </div>
              <button ref={closeButtonRef} onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('bulkAssign.shiftPicker')}</label>
                <div className="flex flex-wrap gap-2">
                  {shifts.map(s => (
                    <button
                      key={s.code}
                      onClick={() => setShiftCode(s.code)}
                      className={
                        'px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest border transition-all ' +
                        (shiftCode === s.code
                          ? 'bg-emerald-600 border-emerald-700 text-white shadow-sm'
                          : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-300')
                      }
                    >
                      {s.code}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('bulkAssign.fromDay')}</label>
                  <input
                    type="number"
                    min={1}
                    max={daysInMonth}
                    value={fromDay}
                    onChange={e => setFromDay(Math.max(1, Math.min(daysInMonth, parseInt(e.target.value) || 1)))}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('bulkAssign.toDay')}</label>
                  <input
                    type="number"
                    min={1}
                    max={daysInMonth}
                    value={toDay}
                    onChange={e => setToDay(Math.max(1, Math.min(daysInMonth, parseInt(e.target.value) || 1)))}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="bulk-overwrite"
                  type="checkbox"
                  checked={overwrite}
                  onChange={e => setOverwrite(e.target.checked)}
                />
                <label htmlFor="bulk-overwrite" className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">
                  {t('bulkAssign.overwrite')}
                </label>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                {overwrite ? t('bulkAssign.overwriteOn') : t('bulkAssign.overwriteOff')}
              </p>

              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg flex items-center gap-3">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <p className="text-[11px] text-slate-700">
                  {t('bulkAssign.summary', { cells: totalCells, count: selectedCount, days: Math.abs(toDay - fromDay) + 1 })}
                </p>
              </div>
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all uppercase tracking-widest">
                {t('action.cancel')}
              </button>
              <button
                onClick={apply}
                disabled={!shiftCode}
                className="px-8 py-2 bg-emerald-600 text-white rounded text-sm font-bold hover:bg-emerald-700 transition-all shadow-lg uppercase tracking-widest disabled:opacity-40"
              >
                {t('bulkAssign.apply')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
