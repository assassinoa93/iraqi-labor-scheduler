import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { Station } from '../types';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';

interface StationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (s: Station) => void;
  station: Station | null;
  // v2.1.2: roles to choose from for "required role" dropdown. Pulled
  // from the live roster so any role on a real employee (Cashier,
  // Operator, Security, etc.) can be required at station level — not
  // just the hardcoded "Driver" the modal shipped with.
  availableRoles?: string[];
}

const empty = (): Station => ({
  id: '', name: '', normalMinHC: 0, peakMinHC: 1, requiredRoles: [],
  openingTime: '08:00', closingTime: '23:00', color: '#3B82F6'
});

export function StationModal({ isOpen, onClose, onSave, station, availableRoles = [] }: StationModalProps) {
  const { t } = useI18n();
  const closeButtonRef = useModalKeys(isOpen, onClose) as React.RefObject<HTMLButtonElement>;
  const [formData, setFormData] = useState<Station>(empty());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFormData(station ?? empty());
    setError(null);
  }, [station, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    const trimmedId = formData.id.trim();
    const trimmedName = formData.name.trim();
    if (!trimmedId) { setError(t('modal.station.error.id')); return; }
    if (!trimmedName) { setError(t('modal.station.error.name')); return; }
    onSave({ ...formData, id: trimmedId, name: trimmedName });
    onClose();
  };

  // De-duplicate + sort roles. Always include 'Driver' so the seeded
  // requiredRoles=['Driver'] convention keeps working even if no driver
  // employee is on the roster yet.
  const roleOptions = Array.from(new Set([...availableRoles, 'Driver'])).filter(Boolean).sort();

  // v5.3.1: sticky backdrop — Esc + X + Cancel are the only paths out.
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label={t('modal.station.title')}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-center bg-slate-50 dark:bg-slate-800/40">
          <h3 className="font-black text-slate-800 dark:text-slate-100 uppercase tracking-tighter">{t('modal.station.title')}</h3>
          <button ref={closeButtonRef} onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-400 dark:text-slate-500" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.station.field.id')}</label>
            <div className="flex gap-2">
              <input value={formData.id} onChange={e => setFormData({...formData, id: e.target.value})} placeholder="ID" className="w-24 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono text-slate-800 dark:text-slate-100" />
              <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Display Name" className="flex-1 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-bold text-slate-800 dark:text-slate-100" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.station.field.normalHC')}</label>
               <input type="number" min={0} value={formData.normalMinHC} onChange={e => setFormData({...formData, normalMinHC: Math.max(0, parseInt(e.target.value) || 0)})} className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono text-slate-800 dark:text-slate-100" />
             </div>
             <div>
               <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.station.field.peakHC')}</label>
               <input type="number" min={0} value={formData.peakMinHC} onChange={e => setFormData({...formData, peakMinHC: Math.max(0, parseInt(e.target.value) || 0)})} className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono text-slate-800 dark:text-slate-100" />
             </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.station.field.openTime')}</label>
               <input type="time" value={formData.openingTime} onChange={e => setFormData({...formData, openingTime: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono text-slate-800 dark:text-slate-100" />
             </div>
             <div>
               <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.station.field.closeTime')}</label>
               <input type="time" value={formData.closingTime} onChange={e => setFormData({...formData, closingTime: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono text-slate-800 dark:text-slate-100" />
             </div>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.station.field.role')}</label>
            <select
              value={formData.requiredRoles?.[0] ?? ''}
              onChange={e => {
                const v = e.target.value;
                setFormData({ ...formData, requiredRoles: v ? [v] : [] });
              }}
              className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-medium text-slate-800 dark:text-slate-100"
            >
              <option value="">{t('modal.station.role.any')}</option>
              {roleOptions.map(r => (
                <option key={r} value={r}>{r === 'Driver' ? t('modal.station.role.driver') : r}</option>
              ))}
            </select>
          </div>
          {error && (
            <div className="text-[11px] font-bold text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/40 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.station.field.color')}</label>
            <input type="color" value={formData.color} onChange={e => setFormData({...formData, color: e.target.value})} className="w-full h-9 p-1 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg" />
          </div>
        </div>
        <div className="p-6 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex justify-end gap-3">
          <button onClick={onClose} className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-4 py-2 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">{t('action.cancel')}</button>
          <button onClick={handleSave} className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-6 py-2 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 dark:hover:bg-white transition-all">{t('modal.station.save')}</button>
        </div>
      </motion.div>
    </div>
  );
}
