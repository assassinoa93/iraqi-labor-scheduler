import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { HourlyDemandSlot } from '../types';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';

// v5.15.0 — extracted from StationModal so BulkAddStationsModal's defaults
// panel can reuse the exact same slot editor. Keeping a single editor
// component means future tweaks (e.g. drag-to-reorder, per-slot notes,
// validation hints) land in both surfaces without drift.
//
// Hours are dropdowns 0–23 (start) and 1–24 (end) so the supervisor can't
// type "25" by accident. End-hour 24 represents end-of-day (exclusive
// upper bound — `{ start: 19, end: 24 }` covers 19, 20, 21, 22, 23).

interface Props {
  slots: HourlyDemandSlot[];
  // Flat HC value used as the fallback hint when the slot list is empty.
  // The hint text shows what the auto-scheduler will fall back to so the
  // supervisor knows the station isn't unstaffed just because the hourly
  // profile is empty.
  fallback: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, patch: Partial<HourlyDemandSlot>) => void;
  // Optional label rendered above the slot list. Pass undefined when the
  // parent already provides its own header (e.g. peak-day section in
  // StationModal which wires the Copy-from-normal button next to the
  // header).
  label?: string;
}

export function HourlyDemandEditor({ slots, fallback, onAdd, onRemove, onUpdate, label }: Props) {
  const { t } = useI18n();
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

// v5.15.0 — re-export from stationDemand so callers can import the
// editor + the helper from the same module. The implementation lives in
// the lib so it's testable as pure logic.
export { nextSlotDefaults } from '../lib/stationDemand';
