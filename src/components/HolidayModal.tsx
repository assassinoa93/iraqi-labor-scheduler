import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { format } from 'date-fns';
import { PublicHoliday, HolidayCompMode } from '../types';
import { SettingField } from './Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';

interface HolidayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (h: PublicHoliday) => void;
  holiday: PublicHoliday | null;
  // v2.1.2: configured global compMode so the per-holiday picker can
  // show "(default)" against the inheriting option.
  defaultCompMode?: HolidayCompMode;
}

const empty = (): PublicHoliday => ({
  // v2.2.0 — generate a stable id at create time. The id stays
  // unchanged across date / name / compMode edits so the user can
  // freely re-date a holiday without orphaning it.
  id: `holi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  date: format(new Date(), 'yyyy-MM-dd'),
  name: '',
  type: 'National',
  // v2.1.2 fix: was 'Article 73', diverging from the rest of the
  // codebase which cites Art. 74 for holiday work.
  legalReference: 'Art. 74',
});

export function HolidayModal({ isOpen, onClose, onSave, holiday, defaultCompMode = 'comp-day' }: HolidayModalProps) {
  const { t } = useI18n();
  useModalKeys(isOpen, onClose);
  const [formData, setFormData] = useState<PublicHoliday>(holiday || empty());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFormData(holiday || empty());
      setError(null);
    }
  }, [holiday, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    const name = formData.name.trim();
    if (!name) { setError(t('modal.holiday.error.name')); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.date)) { setError(t('modal.holiday.error.date')); return; }
    onSave({ ...formData, name });
    onClose();
  };

  const setCompMode = (m: HolidayCompMode | undefined) => setFormData(prev => ({ ...prev, compMode: m }));
  const effectiveMode: HolidayCompMode = formData.compMode ?? defaultCompMode;

  return (
    <div onClick={onClose} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={holiday ? t('modal.holiday.title.edit') : t('modal.holiday.title.new')}>
      <motion.div
        onClick={e => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-md rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-center bg-slate-50 dark:bg-slate-800/40">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {holiday ? t('modal.holiday.title.edit') : t('modal.holiday.title.new')}
          </h3>
          <button onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-8 space-y-4">
          {/* v2.1.3 — native date picker. The HTML <input type="date">
              value is always YYYY-MM-DD, matching the storage format,
              so callers don't need to reformat. The i18n hint stays for
              users who type the date instead of using the picker. */}
          <SettingField label={t('modal.holiday.field.date')} type="date" value={formData.date} onChange={v => setFormData({...formData, date: v})} />
          <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-2">{t('modal.holiday.field.date.hint')}</p>
          <SettingField label={t('modal.holiday.field.name')} value={formData.name} onChange={v => setFormData({...formData, name: v})} />

          {/* v2.5.0 — duration field. Eid Al-Fitr / Eid Al-Adha typically
              span 2-3 days; pre-2.5 the user added 3 separate records
              (one per day) which made bulk-editing painful. The field
              now holds a single record + duration; the rest of the app
              expands it to per-day records for date-matching. */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.holiday.field.duration')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={14}
                value={formData.durationDays ?? 1}
                onChange={e => {
                  const raw = parseInt(e.target.value, 10);
                  const clamped = Number.isFinite(raw) ? Math.max(1, Math.min(14, raw)) : 1;
                  setFormData({ ...formData, durationDays: clamped });
                }}
                className="w-24 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-medium font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
              />
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{t('modal.holiday.field.duration.suffix')}</span>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">{t('modal.holiday.field.duration.hint')}</p>
          </div>
          <SettingField
            label={t('modal.holiday.field.category')}
            type="select"
            options={['National', 'Religious', 'Sector-Specific', 'Custom']}
            value={formData.type}
            onChange={v => setFormData({...formData, type: v})}
          />
          <SettingField label={t('modal.holiday.field.legalRef')} value={formData.legalReference} onChange={v => setFormData({...formData, legalReference: v})} />

          {/* Per-holiday Art. 74 compMode picker. Lets the user pre-set
              the override at create time instead of saving then editing
              the pill on the holidays tab. */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 block">{t('modal.holiday.field.compMode')}</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setCompMode(undefined)}
                className={cn(
                  'px-3 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all',
                  formData.compMode === undefined ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
                )}
              >
                {t('modal.holiday.compMode.inherit')}
                <div className="text-[8px] font-medium normal-case opacity-70 mt-0.5">
                  {effectiveMode === 'comp-day' ? t('holidays.compMode.compDay') : t('holidays.compMode.cashOt')}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setCompMode('comp-day')}
                className={cn(
                  'px-3 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all',
                  formData.compMode === 'comp-day' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
                )}
              >
                {t('holidays.compMode.compDay')}
              </button>
              <button
                type="button"
                onClick={() => setCompMode('cash-ot')}
                className={cn(
                  'px-3 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all',
                  formData.compMode === 'cash-ot' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
                )}
              >
                {t('holidays.compMode.cashOt')}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-[11px] font-bold text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/40 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-widest">{t('action.cancel')}</button>
          <button
            onClick={handleSave}
            className="px-8 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded text-sm font-bold hover:bg-slate-800 dark:hover:bg-white transition-all shadow-lg uppercase tracking-widest"
          >
            {holiday ? t('action.save') : t('modal.holiday.declare')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
