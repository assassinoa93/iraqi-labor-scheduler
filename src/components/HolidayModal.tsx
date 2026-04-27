import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { format } from 'date-fns';
import { PublicHoliday } from '../types';
import { SettingField } from './Primitives';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';

interface HolidayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (h: PublicHoliday) => void;
  holiday: PublicHoliday | null;
}

const empty = (): PublicHoliday => ({
  date: format(new Date(), 'yyyy-MM-dd'),
  name: '',
  type: 'National',
  legalReference: 'Article 73'
});

export function HolidayModal({ isOpen, onClose, onSave, holiday }: HolidayModalProps) {
  const { t } = useI18n();
  const closeButtonRef = useModalKeys(isOpen, onClose) as React.RefObject<HTMLButtonElement>;
  const [formData, setFormData] = useState<PublicHoliday>(holiday || empty());

  useEffect(() => {
    if (isOpen) setFormData(holiday || empty());
  }, [holiday, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={holiday ? t('modal.holiday.title.edit') : t('modal.holiday.title.new')}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-md rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800">
            {holiday ? t('modal.holiday.title.edit') : t('modal.holiday.title.new')}
          </h3>
          <button ref={closeButtonRef} onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-8 space-y-4">
          <SettingField label="Holiday Date" type="text" value={formData.date} onChange={v => setFormData({...formData, date: v})} />
          <SettingField label="Holiday Name" value={formData.name} onChange={v => setFormData({...formData, name: v})} />
          <SettingField label="Category" type="select" options={['National', 'Religious', 'Sector-Specific', 'Custom']} value={formData.type} onChange={v => setFormData({...formData, type: v})} />
          <SettingField label="Legal Reference" value={formData.legalReference} onChange={v => setFormData({...formData, legalReference: v})} />
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all uppercase tracking-widest">{t('action.cancel')}</button>
          <button
            onClick={() => onSave(formData)}
            className="px-8 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-slate-800 transition-all shadow-lg uppercase tracking-widest"
          >
            {t('modal.holiday.declare')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
