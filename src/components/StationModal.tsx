import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Plus, Trash2, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { Station, HourlyDemandSlot } from '../types';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';
import { validateHourlyDemand } from '../lib/stationDemand';
import { cn } from '../lib/utils';

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
  // v5.14.0 — hourly demand editor. Auto-expanded when the station
  // already has hourly slots configured so the supervisor sees them
  // without having to hunt for the section. Collapsed by default for
  // brand-new stations to keep the form concise.
  const [hourlyExpanded, setHourlyExpanded] = useState(false);

  useEffect(() => {
    setFormData(station ?? empty());
    setError(null);
    const hasHourly = !!(station?.normalHourlyDemand?.length || station?.peakHourlyDemand?.length);
    setHourlyExpanded(hasHourly);
  }, [station, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    const trimmedId = formData.id.trim();
    const trimmedName = formData.name.trim();
    if (!trimmedId) { setError(t('modal.station.error.id')); return; }
    if (!trimmedName) { setError(t('modal.station.error.name')); return; }
    // v5.14.0 — validate any hourly demand slots before save. Bad data
    // (overlap, end <= start, negative HC) blocks save with a clear
    // error message rather than silently writing malformed records.
    if (formData.normalHourlyDemand && formData.normalHourlyDemand.length > 0) {
      const err = validateHourlyDemand(formData.normalHourlyDemand);
      if (err) { setError(t('modal.station.error.hourlyNormal') + ' ' + err); return; }
    }
    if (formData.peakHourlyDemand && formData.peakHourlyDemand.length > 0) {
      const err = validateHourlyDemand(formData.peakHourlyDemand);
      if (err) { setError(t('modal.station.error.hourlyPeak') + ' ' + err); return; }
    }
    onSave({ ...formData, id: trimmedId, name: trimmedName });
    onClose();
  };

  // v5.14.0 — slot mutators for the inline editor. Each section (normal /
  // peak) gets its own list; both flow through these helpers so the
  // editing logic stays consistent.
  const addSlot = (kind: 'normal' | 'peak') => {
    const key = kind === 'normal' ? 'normalHourlyDemand' : 'peakHourlyDemand';
    setFormData(prev => {
      const list = prev[key] || [];
      // Default new slot to the next free hour after the last slot ends —
      // saves the supervisor a typo-prone "set start to 11" step in the
      // common build-up-from-empty workflow.
      const lastEnd = list.length > 0 ? list[list.length - 1].endHour : 8;
      const startHour = Math.min(23, lastEnd);
      const endHour = Math.min(24, startHour + 4);
      return { ...prev, [key]: [...list, { startHour, endHour, hc: 1 }] };
    });
  };
  const removeSlot = (kind: 'normal' | 'peak', idx: number) => {
    const key = kind === 'normal' ? 'normalHourlyDemand' : 'peakHourlyDemand';
    setFormData(prev => ({ ...prev, [key]: (prev[key] || []).filter((_, i) => i !== idx) }));
  };
  const updateSlot = (kind: 'normal' | 'peak', idx: number, patch: Partial<HourlyDemandSlot>) => {
    const key = kind === 'normal' ? 'normalHourlyDemand' : 'peakHourlyDemand';
    setFormData(prev => ({
      ...prev,
      [key]: (prev[key] || []).map((s, i) => i === idx ? { ...s, ...patch } : s),
    }));
  };
  const copyNormalToPeak = () => {
    setFormData(prev => ({
      ...prev,
      peakHourlyDemand: (prev.normalHourlyDemand || []).map(s => ({ ...s })),
    }));
  };

  // De-duplicate + sort roles. Always include 'Driver' so the seeded
  // requiredRoles=['Driver'] convention keeps working even if no driver
  // employee is on the roster yet.
  const roleOptions = Array.from(new Set([...availableRoles, 'Driver'])).filter(Boolean).sort();

  // v5.3.1: sticky backdrop — Esc + X + Cancel are the only paths out.
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label={t('modal.station.title')}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-center bg-slate-50 dark:bg-slate-800/40">
          <h3 className="font-black text-slate-800 dark:text-slate-100 uppercase tracking-tighter">{t('modal.station.title')}</h3>
          <button ref={closeButtonRef} onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-400 dark:text-slate-500" /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
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
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1 block">{t('modal.station.field.color')}</label>
            <input type="color" value={formData.color} onChange={e => setFormData({...formData, color: e.target.value})} className="w-full h-9 p-1 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg" />
          </div>

          {/* v5.14.0 — collapsible hourly demand profile editor. Default
              collapsed for new stations; auto-expanded when the station
              already has hourly slots so the supervisor sees them
              without hunting. When set, the slots OVERRIDE the flat
              normalMinHC / peakMinHC values across the whole day; gaps
              between slots are explicit "0 PAX needed there" windows. */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setHourlyExpanded(v => !v)}
              className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
            >
              {hourlyExpanded ? <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
              <Clock className="w-4 h-4 text-blue-600 dark:text-blue-300" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-200">
                {t('modal.station.hourly.title')}
              </span>
              {(formData.normalHourlyDemand?.length || formData.peakHourlyDemand?.length)
                ? <span className="ms-auto text-[9px] font-black uppercase tracking-widest bg-blue-600 text-white px-1.5 py-0.5 rounded">{t('modal.station.hourly.activeBadge')}</span>
                : null}
            </button>
            {hourlyExpanded && (
              <div className="p-4 space-y-4 border-t border-slate-200 dark:border-slate-700">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t('modal.station.hourly.help')}
                </p>
                {/* Normal day */}
                <HourlyEditor
                  kind="normal"
                  label={t('modal.station.hourly.normalDay')}
                  slots={formData.normalHourlyDemand || []}
                  fallback={formData.normalMinHC}
                  onAdd={() => addSlot('normal')}
                  onRemove={(i) => removeSlot('normal', i)}
                  onUpdate={(i, p) => updateSlot('normal', i, p)}
                  t={t}
                />
                {/* Peak day */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest">
                      {t('modal.station.hourly.peakDay')}
                    </span>
                    {(formData.normalHourlyDemand?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={copyNormalToPeak}
                        title={t('modal.station.hourly.copyNormalToPeak.tooltip')}
                        className="text-[9px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200"
                      >
                        {t('modal.station.hourly.copyNormalToPeak')}
                      </button>
                    )}
                  </div>
                  <HourlyEditor
                    kind="peak"
                    label=""
                    slots={formData.peakHourlyDemand || []}
                    fallback={formData.peakMinHC}
                    onAdd={() => addSlot('peak')}
                    onRemove={(i) => removeSlot('peak', i)}
                    onUpdate={(i, p) => updateSlot('peak', i, p)}
                    t={t}
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="text-[11px] font-bold text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/40 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>
        <div className="p-6 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-4 py-2 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">{t('action.cancel')}</button>
          <button onClick={handleSave} className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-6 py-2 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 dark:hover:bg-white transition-all">{t('modal.station.save')}</button>
        </div>
      </motion.div>
    </div>
  );
}

// v5.14.0 — slot-list editor used by both the normal-day and peak-day
// sections in the StationModal. Each row is a [start hour] → [end hour]
// [hc] tuple with a delete button. Hours are dropdowns 0–23 / 1–24
// rather than freeform inputs so the supervisor can't type "25" by
// accident. When the slot list is empty, a fallback hint shows what
// the auto-scheduler will use instead (the flat min HC value).
function HourlyEditor({
  kind, label, slots, fallback, onAdd, onRemove, onUpdate, t,
}: {
  kind: 'normal' | 'peak';
  label: string;
  slots: HourlyDemandSlot[];
  fallback: number;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, patch: Partial<HourlyDemandSlot>) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const startOptions = Array.from({ length: 24 }, (_, h) => h);
  const endOptions = Array.from({ length: 24 }, (_, h) => h + 1);
  return (
    <div className="space-y-2">
      {label && (
        <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest">{label}</p>
      )}
      {slots.length === 0 ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
          {t('modal.station.hourly.empty', { fallback })}
        </p>
      ) : (
        <div className="space-y-1.5">
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={s.startHour}
                onChange={e => onUpdate(i, { startHour: parseInt(e.target.value) })}
                className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1.5 px-2 text-xs font-mono"
                aria-label={t('modal.station.hourly.startHour')}
              >
                {startOptions.map(h => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
              <span className="text-slate-400 dark:text-slate-500 text-xs">→</span>
              <select
                value={s.endHour}
                onChange={e => onUpdate(i, { endHour: parseInt(e.target.value) })}
                className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1.5 px-2 text-xs font-mono"
                aria-label={t('modal.station.hourly.endHour')}
              >
                {endOptions.map(h => (
                  <option key={h} value={h}>{h === 24 ? '24:00' : String(h).padStart(2, '0') + ':00'}</option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                value={s.hc}
                onChange={e => onUpdate(i, { hc: Math.max(0, parseInt(e.target.value) || 0) })}
                className="w-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1.5 px-2 text-xs font-mono text-center"
                aria-label={t('modal.station.hourly.hc')}
              />
              <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">PAX</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={t('modal.station.hourly.removeSlot')}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/15 rounded"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onAdd}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors',
          'bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/40 text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-500/25',
        )}
      >
        <Plus className="w-3 h-3" />
        {t('modal.station.hourly.addSlot')}
      </button>
    </div>
  );
}
