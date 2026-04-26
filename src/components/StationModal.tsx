import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { Station } from '../types';
import { useI18n } from '../lib/i18n';

interface StationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (s: Station) => void;
  station: Station | null;
}

const empty = (): Station => ({
  id: '', name: '', normalMinHC: 0, peakMinHC: 1, requiredRoles: [],
  openingTime: '08:00', closingTime: '23:00', color: '#3B82F6'
});

export function StationModal({ isOpen, onClose, onSave, station }: StationModalProps) {
  const { t } = useI18n();
  const [formData, setFormData] = useState<Station>(empty());

  useEffect(() => {
    setFormData(station ?? empty());
  }, [station, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-black text-slate-800 uppercase tracking-tighter">{t('modal.station.title')}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">{t('modal.station.field.id')}</label>
            <div className="flex gap-2">
              <input value={formData.id} onChange={e => setFormData({...formData, id: e.target.value})} placeholder="ID" className="w-24 bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-mono" />
              <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Display Name" className="flex-1 bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-bold" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">{t('modal.station.field.normalHC')}</label>
               <input type="number" value={formData.normalMinHC} onChange={e => setFormData({...formData, normalMinHC: parseInt(e.target.value)})} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-mono" />
             </div>
             <div>
               <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">{t('modal.station.field.peakHC')}</label>
               <input type="number" value={formData.peakMinHC} onChange={e => setFormData({...formData, peakMinHC: parseInt(e.target.value)})} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-mono" />
             </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">{t('modal.station.field.openTime')}</label>
               <input type="time" value={formData.openingTime} onChange={e => setFormData({...formData, openingTime: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-mono" />
             </div>
             <div>
               <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">{t('modal.station.field.closeTime')}</label>
               <input type="time" value={formData.closingTime} onChange={e => setFormData({...formData, closingTime: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-mono" />
             </div>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">{t('modal.station.field.role')}</label>
            <select
              value={formData.requiredRoles?.[0] ?? ''}
              onChange={e => {
                const v = e.target.value;
                setFormData({ ...formData, requiredRoles: v ? [v] : [] });
              }}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-medium"
            >
              <option value="">{t('modal.station.role.any')}</option>
              <option value="Driver">{t('modal.station.role.driver')}</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">{t('modal.station.field.color')}</label>
            <input type="color" value={formData.color} onChange={e => setFormData({...formData, color: e.target.value})} className="w-full h-9 p-1 bg-slate-50 border border-slate-200 rounded-lg" />
          </div>
        </div>
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-xs font-bold text-slate-400 uppercase tracking-widest px-4 py-2 hover:text-slate-600 transition-colors">{t('action.cancel')}</button>
          <button onClick={() => { onSave(formData); onClose(); }} className="bg-slate-900 text-white px-6 py-2 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-all">{t('modal.station.save')}</button>
        </div>
      </motion.div>
    </div>
  );
}
