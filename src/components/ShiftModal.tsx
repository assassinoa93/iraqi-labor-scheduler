import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, AlertCircle } from 'lucide-react';
import { Shift, Config } from '../types';
import { SettingField } from './Primitives';
import { useI18n } from '../lib/i18n';

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

  const shopStart = parseInt((config.shopOpeningTime || '00:00').split(':')[0]);
  const shopEnd = parseInt((config.shopClosingTime || '23:59').split(':')[0]);
  const shiftStart = parseInt((formData.start || '00:00').split(':')[0]);
  const shiftEnd = parseInt((formData.end || '00:00').split(':')[0]);
  const isOutside = (shiftStart < shopStart) || (shiftEnd > shopEnd && shiftEnd !== 0) || (shiftEnd === 0 && shopEnd < 23);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-lg rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800">
            {shift ? t('modal.shift.title.edit') : t('modal.shift.title.new')}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <SettingField label="Shift Code (e.g. FS)" value={formData.code} onChange={v => setFormData({...formData, code: v})} />
            <SettingField label="Display Name" value={formData.name} onChange={v => setFormData({...formData, name: v})} />
            <SettingField label="Start Time" type="time" value={formData.start} onChange={v => setFormData({...formData, start: v})} />
            <SettingField label="End Time" type="time" value={formData.end} onChange={v => setFormData({...formData, end: v})} />
            <SettingField label="Work Hours (Auto)" type="number" value={formData.durationHrs} onChange={v => setFormData({...formData, durationHrs: parseFloat(v)})} />
            <SettingField label="Break (Min)" type="number" value={formData.breakMin} onChange={v => setFormData({...formData, breakMin: parseInt(v)})} />
          </div>

          {isOutside && formData.isWork && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
              <AlertCircle className="w-4 h-4" />
              <p className="text-[10px] font-bold uppercase tracking-tight">Warning: Shift falls outside business operating hours ({config.shopOpeningTime} - {config.shopClosingTime})</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
             <div className="flex items-center gap-2">
                <input type="checkbox" checked={formData.isHazardous} onChange={e => setFormData({...formData, isHazardous: e.target.checked})} />
                <span className="text-[10px] font-bold text-slate-600 uppercase">Hazardous Shift</span>
             </div>
             <div className="flex items-center gap-2">
                <input type="checkbox" checked={formData.isWork} onChange={e => setFormData({...formData, isWork: e.target.checked})} />
                <span className="text-[10px] font-bold text-slate-600 uppercase">Counts as Work</span>
             </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Shift Description</label>
            <textarea
              className="w-full p-3 bg-white border border-slate-200 rounded text-xs min-h-[60px] focus:ring-1 focus:ring-blue-500 outline-none"
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
              placeholder="Instructions for supervisors or legal context..."
            />
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all uppercase tracking-widest">{t('action.cancel')}</button>
          <button
            onClick={() => onSave(formData)}
            className="px-8 py-2 bg-slate-900 text-white rounded text-sm font-bold hover:bg-slate-800 transition-all shadow-lg uppercase tracking-widest"
          >
            {t('modal.shift.save')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
