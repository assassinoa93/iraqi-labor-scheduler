import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, AlertCircle, Lock } from 'lucide-react';
import { Shift, Config } from '../types';
import { SettingField } from './Primitives';
import { Switch } from './ui/Switch';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';
import { parseHour } from '../lib/time';
import { isSystemShift } from '../lib/systemShifts';
import { cn } from '../lib/utils';

interface ShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (s: Shift) => void;
  shift: Shift | null;
  config: Config;
}

const empty = (): Shift => ({
  code: '', name: '',
  start: '08:00', end: '16:00',
  durationHrs: 8, breakMin: 60,
  isIndustrial: false, isHazardous: false, isWork: true,
  description: ''
});

export function ShiftModal({ isOpen, onClose, onSave, shift, config }: ShiftModalProps) {
  const { t } = useI18n();
  const closeButtonRef = useModalKeys(isOpen, onClose) as React.RefObject<HTMLButtonElement>;
  const [formData, setFormData] = useState<Shift>(shift || empty());

  // Auto-recompute duration whenever start/end/break change
  useEffect(() => {
    if (!formData.start || !formData.end) return;
    const [sH, sM] = formData.start.split(':').map(Number);
    const [eH, eM] = formData.end.split(':').map(Number);
    let diffMin = (eH * 60 + eM) - (sH * 60 + sM);
    if (diffMin < 0) diffMin += 24 * 60; // crosses midnight
    const calc = Math.max(0, (diffMin - (formData.breakMin || 0)) / 60);
    if (calc !== formData.durationHrs) {
      setFormData(prev => ({ ...prev, durationHrs: Number(calc.toFixed(2)) }));
    }
  }, [formData.start, formData.end, formData.breakMin]);

  useEffect(() => {
    if (isOpen) setFormData(shift || empty());
  }, [shift, isOpen]);

  if (!isOpen) return null;

  // v2.2.0 — system shifts (OFF/CP/AL/SL/MAT/PH) drive the auto-scheduler,
  // leave system, and comp-day rotation; their `isWork` and `isHazardous`
  // semantics MUST match the engine's expectations. The user can still
  // edit display fields (name, description, times for OFF→non-zero edge
  // cases) but the toggles are locked with a lock chip in place.
  const protectedSystemShift = isSystemShift(formData.code);

  const shopStart = parseHour(config.shopOpeningTime || '00:00');
  const shopEnd = parseHour(config.shopClosingTime || '23:59');
  const shiftStart = parseHour(formData.start || '00:00');
  const shiftEnd = parseHour(formData.end || '00:00');
  const isOutside = (shiftStart < shopStart) || (shiftEnd > shopEnd && shiftEnd !== 0) || (shiftEnd === 0 && shopEnd < 23);

  // v5.3.1: sticky backdrop — Esc + X + Cancel are the only paths out.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={shift ? t('modal.shift.title.edit') : t('modal.shift.title.new')}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-center bg-slate-50 dark:bg-slate-800/40">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {shift ? t('modal.shift.title.edit') : t('modal.shift.title.new')}
          </h3>
          <button ref={closeButtonRef} onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <SettingField label={t('modal.shift.field.code')} value={formData.code} onChange={v => setFormData({...formData, code: v})} />
            <SettingField label={t('modal.shift.field.name')} value={formData.name} onChange={v => setFormData({...formData, name: v})} />
            <SettingField label={t('modal.shift.field.start')} type="time" value={formData.start} onChange={v => setFormData({...formData, start: v})} />
            <SettingField label={t('modal.shift.field.end')} type="time" value={formData.end} onChange={v => setFormData({...formData, end: v})} />
            <SettingField label={t('modal.shift.field.duration')} type="number" value={formData.durationHrs} onChange={v => setFormData({...formData, durationHrs: Math.max(0, parseFloat(v) || 0)})} />
            <SettingField label={t('modal.shift.field.break')} type="number" value={formData.breakMin} onChange={v => setFormData({...formData, breakMin: Math.max(0, parseInt(v) || 0)})} />
          </div>

          {isOutside && formData.isWork && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/40 rounded-lg text-amber-700 dark:text-amber-200">
              <AlertCircle className="w-4 h-4" />
              <p className="text-[10px] font-bold uppercase tracking-tight">{t('modal.shift.warning.outsideHours', { open: config.shopOpeningTime, close: config.shopClosingTime })}</p>
            </div>
          )}

          {protectedSystemShift ? (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 flex items-start gap-3">
              <Lock className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
              <div className="space-y-2 min-w-0 flex-1">
                <p className="text-[10px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-widest">{t('modal.shift.systemShift.title')}</p>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{t('modal.shift.systemShift.body', { code: formData.code })}</p>
                <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 dark:text-slate-400 pt-1">
                  <span>{t('modal.shift.toggle.work')}: <span className={cn('font-bold', formData.isWork ? 'text-emerald-700 dark:text-emerald-200' : 'text-slate-700 dark:text-slate-200')}>{formData.isWork ? t('shifts.status.work') : t('shifts.status.nonwork')}</span></span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span>{t('modal.shift.toggle.hazardous')}: <span className={cn('font-bold', formData.isHazardous ? 'text-rose-700 dark:text-rose-200' : 'text-slate-700 dark:text-slate-200')}>{formData.isHazardous ? t('common.yes') : t('common.no')}</span></span>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-700/60">
               <label className="flex items-center gap-2 cursor-pointer">
                  <Switch checked={formData.isHazardous} onChange={v => setFormData({...formData, isHazardous: v})} tone="rose" aria-label={t('modal.shift.toggle.hazardous')} />
                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">{t('modal.shift.toggle.hazardous')}</span>
               </label>
               <label className="flex items-center gap-2 cursor-pointer">
                  <Switch checked={formData.isWork} onChange={v => setFormData({...formData, isWork: v})} tone="emerald" aria-label={t('modal.shift.toggle.work')} />
                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">{t('modal.shift.toggle.work')}</span>
               </label>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.shift.field.description')}</label>
            <textarea
              className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs min-h-[60px] focus:ring-1 focus:ring-blue-500 outline-none text-slate-800 dark:text-slate-100"
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
              placeholder={t('modal.shift.field.description.placeholder')}
            />
          </div>
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-widest">{t('action.cancel')}</button>
          <button
            onClick={() => onSave(formData)}
            className="px-8 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded text-sm font-bold hover:bg-slate-800 dark:hover:bg-white transition-all shadow-lg uppercase tracking-widest"
          >
            {t('modal.shift.save')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
