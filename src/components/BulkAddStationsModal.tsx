import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { X, Layers, Plus, Trash2, Wand2 } from 'lucide-react';
import { Station, StationGroup } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';

// v5.3.0 — bulk station creation modal.
// v5.3.1 — rewritten around per-row editable fields. The first version
// shipped a textarea + one shared row of defaults applied to every station.
// Real-data trial showed the supervisor often wants the *same* defaults for
// most rows but needs to tweak HC, time, or role on a few outliers (a
// vehicle that runs a half-day, a cashier with a stricter peak headcount).
// New shape: a "Defaults for new rows" header + an editable rows table
// where every row carries its own copy of the params and can be tuned
// independently. Auto-numbering is preserved.
//
// Sticky modal: the backdrop click no longer dismisses the modal — only the
// X button, Cancel button, or Esc key close it. Avoids losing 5 minutes of
// row entry to one accidental click outside the card.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  existingStations: Station[];
  stationGroups: StationGroup[];
  availableRoles: string[];
  onApply: (stations: Station[]) => void;
}

interface StationDraft {
  name: string;
  normalMinHC: number;
  peakMinHC: number;
  openingTime: string;
  closingTime: string;
  requiredRole: string;
  color: string;
}

const DEFAULT_PREFIX = 'ST-';
const DEFAULT_COLOR = '#3B82F6';

const seedDefaults = (): StationDraft => ({
  name: '', normalMinHC: 0, peakMinHC: 1,
  openingTime: '11:00', closingTime: '23:00',
  requiredRole: '', color: DEFAULT_COLOR,
});

const cloneFromDefaults = (d: StationDraft): StationDraft => ({
  ...d, name: '', // name always blank on a new row — user types it
});

export function BulkAddStationsModal({
  isOpen, onClose, existingStations, stationGroups, availableRoles, onApply,
}: Props) {
  const { t } = useI18n();
  useModalKeys(isOpen, onClose);

  const [groupId, setGroupId] = useState<string>('');
  const [prefix, setPrefix] = useState<string>(DEFAULT_PREFIX);
  // The "defaults" object is what every newly-added row inherits. Editing
  // these does NOT retroactively change rows the user has already added —
  // the "Apply to all rows" button is the explicit way to do that.
  const [defaults, setDefaults] = useState<StationDraft>(() => seedDefaults());
  const [rows, setRows] = useState<StationDraft[]>(() => [seedDefaults()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setGroupId('');
    setPrefix(DEFAULT_PREFIX);
    setDefaults(seedDefaults());
    setRows([seedDefaults()]);
    setError(null);
  }, [isOpen]);

  // When a group is picked, reflect the group's accent into the *defaults*
  // colour so subsequent Add Row clicks inherit the kanban column's visual
  // identity. Existing rows stay as-is — they can be re-coloured manually
  // or via "Apply defaults to all rows".
  useEffect(() => {
    if (!groupId) return;
    const g = stationGroups.find(x => x.id === groupId);
    if (g?.color) setDefaults(d => ({ ...d, color: g.color! }));
  }, [groupId, stationGroups]);

  const cleanRows = useMemo(() => rows.filter(r => r.name.trim() !== ''), [rows]);

  // Auto-number from the highest existing ID matching `prefix-<digits>`.
  const nextNumberStart = useMemo(() => {
    if (!prefix) return 1;
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
    let max = 0;
    for (const s of existingStations) {
      const m = re.exec(s.id);
      if (m) {
        const n = parseInt(m[1]);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return max + 1;
  }, [prefix, existingStations]);

  const idForRow = (rowIndex: number) => `${prefix}${nextNumberStart + rowIndex}`;
  const existingIds = useMemo(() => new Set(existingStations.map(s => s.id)), [existingStations]);

  // Pre-compute the IDs that would land if the user submitted right now,
  // so we can flag collisions inline on each row. Only counts rows the
  // user has actually named (blank rows don't get IDs assigned).
  const namedRowIndexes = useMemo(() => {
    const out: number[] = [];
    rows.forEach((r, i) => { if (r.name.trim() !== '') out.push(i); });
    return out;
  }, [rows]);
  // Map of rowIndex -> sequential position in the named-rows list, used so
  // collision IDs follow the same numbering submitApply will use.
  const seqByRowIndex = useMemo(() => {
    const m = new Map<number, number>();
    namedRowIndexes.forEach((idx, seq) => m.set(idx, seq));
    return m;
  }, [namedRowIndexes]);
  const idForRowIfSubmitted = (rowIndex: number): string | null => {
    const seq = seqByRowIndex.get(rowIndex);
    if (seq === undefined) return null;
    return `${prefix}${nextNumberStart + seq}`;
  };

  const updateRow = (i: number, patch: Partial<StationDraft>) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const removeRow = (i: number) => {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  };
  const addRow = () => {
    setRows(prev => [...prev, cloneFromDefaults(defaults)]);
  };
  const addManyRows = (n: number) => {
    setRows(prev => [...prev, ...Array.from({ length: n }, () => cloneFromDefaults(defaults))]);
  };
  const applyDefaultsToAll = () => {
    // Stamp the current defaults across every existing row (preserves the
    // names — the supervisor's typed-in names should never be overwritten).
    setRows(prev => prev.map(r => ({ ...defaults, name: r.name })));
  };

  const apply = () => {
    if (cleanRows.length === 0) { setError(t('bulkStation.error.noNames')); return; }
    if (!prefix.trim()) { setError(t('bulkStation.error.prefix')); return; }
    // Per-row validation: peak >= normal.
    for (const r of cleanRows) {
      if (r.peakMinHC < r.normalMinHC) {
        setError(t('bulkStation.error.hcRow', { name: r.name }));
        return;
      }
    }
    // Collision check across the contiguous numbering used at submit time.
    for (let seq = 0; seq < cleanRows.length; seq++) {
      const id = `${prefix}${nextNumberStart + seq}`;
      if (existingIds.has(id)) {
        setError(t('bulkStation.error.collision', { id }));
        return;
      }
    }

    const stations: Station[] = cleanRows.map((r, seq) => {
      const id = `${prefix}${nextNumberStart + seq}`;
      const station: Station = {
        id,
        name: r.name.trim(),
        normalMinHC: Math.max(0, r.normalMinHC | 0),
        peakMinHC: Math.max(0, r.peakMinHC | 0),
        openingTime: r.openingTime,
        closingTime: r.closingTime,
        color: r.color,
      };
      if (groupId) station.groupId = groupId;
      if (r.requiredRole) station.requiredRoles = [r.requiredRole];
      return station;
    });
    onApply(stations);
  };

  if (!isOpen) return null;

  const roleOptions = Array.from(new Set([...availableRoles, 'Driver'])).filter(Boolean).sort();

  // v5.3.1: NO onClick on the backdrop — clicking outside the card is
  // common-enough during data entry that it always reads as "I missed the
  // close button" rather than "I want to dismiss". Esc + X button + Cancel
  // are the only paths out, so 5 minutes of typing is never one stray click
  // away from being lost.
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('bulkStation.title')}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-5xl rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 dark:border-slate-700/60 flex justify-between items-center bg-slate-50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <Layers className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{t('bulkStation.title')}</h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest mt-0.5">{t('bulkStation.subtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('action.cancel')} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[72vh] overflow-y-auto">
          {/* TARGET GROUP + ID PREFIX — global, affect every row at submit. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-blue-50/30 dark:bg-blue-500/10 rounded-lg border border-blue-100 dark:border-blue-500/30">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-blue-600 dark:text-blue-300 uppercase tracking-widest">{t('bulkStation.field.group')}</label>
              <select
                value={groupId}
                onChange={e => setGroupId(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
              >
                <option value="">{t('bulkStation.group.ungrouped')}</option>
                {stationGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-blue-600 dark:text-blue-300 uppercase tracking-widest">{t('bulkStation.field.prefix')}</label>
              <input
                type="text" value={prefix}
                onChange={e => setPrefix(e.target.value)}
                placeholder="ST-"
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-2 px-3 text-sm font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-blue-600 dark:text-blue-300 uppercase tracking-widest">{t('bulkStation.startsAtLabel')}</label>
              <div className="w-full px-3 py-2 bg-white/60 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-600 dark:text-slate-300">
                {prefix}{nextNumberStart}
              </div>
            </div>
          </div>

          {/* DEFAULTS — what each newly-added row inherits. Editing these
              does NOT retroactively touch rows already in the table — the
              user has to click "Apply defaults to all rows" for that. */}
          <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-700/60">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">{t('bulkStation.section.defaults')}</p>
              <button
                type="button"
                onClick={applyDefaultsToAll}
                className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-500/15 hover:border-blue-300 dark:hover:border-blue-500/40 transition-colors"
                title={t('bulkStation.applyDefaults.tooltip')}
              >
                <Wand2 className="w-3 h-3" />
                {t('bulkStation.applyDefaults')}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <DefaultsField label={t('modal.station.field.normalHC')}>
                <input
                  type="number" min={0} value={defaults.normalMinHC}
                  onChange={e => setDefaults(d => ({ ...d, normalMinHC: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1.5 px-2 text-sm font-mono"
                />
              </DefaultsField>
              <DefaultsField label={t('modal.station.field.peakHC')}>
                <input
                  type="number" min={0} value={defaults.peakMinHC}
                  onChange={e => setDefaults(d => ({ ...d, peakMinHC: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1.5 px-2 text-sm font-mono"
                />
              </DefaultsField>
              <DefaultsField label={t('modal.station.field.openTime')}>
                <input
                  type="time" value={defaults.openingTime}
                  onChange={e => setDefaults(d => ({ ...d, openingTime: e.target.value }))}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1.5 px-2 text-sm font-mono"
                />
              </DefaultsField>
              <DefaultsField label={t('modal.station.field.closeTime')}>
                <input
                  type="time" value={defaults.closingTime}
                  onChange={e => setDefaults(d => ({ ...d, closingTime: e.target.value }))}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1.5 px-2 text-sm font-mono"
                />
              </DefaultsField>
              <DefaultsField label={t('modal.station.field.role')}>
                <select
                  value={defaults.requiredRole}
                  onChange={e => setDefaults(d => ({ ...d, requiredRole: e.target.value }))}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1.5 px-2 text-sm font-medium"
                >
                  <option value="">{t('modal.station.role.any')}</option>
                  {roleOptions.map(r => (
                    <option key={r} value={r}>{r === 'Driver' ? t('modal.station.role.driver') : r}</option>
                  ))}
                </select>
              </DefaultsField>
              <DefaultsField label={t('modal.station.field.color')}>
                <input
                  type="color" value={defaults.color}
                  onChange={e => setDefaults(d => ({ ...d, color: e.target.value }))}
                  className="w-full h-[34px] p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
                />
              </DefaultsField>
            </div>
          </div>

          {/* PER-ROW EDITABLE TABLE. Each row carries its own params — the
              defaults panel above only seeds new rows, not existing ones. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">
                {t('bulkStation.section.rows')} ({cleanRows.length}/{rows.length})
              </p>
              <div className="flex gap-2">
                <button
                  type="button" onClick={addRow}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  {t('bulkStation.row.add')}
                </button>
                <button
                  type="button" onClick={() => addManyRows(5)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold uppercase tracking-widest hover:border-blue-300 dark:hover:border-blue-500/40 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  {t('bulkStation.row.add5')}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/40 text-[9px] uppercase text-slate-400 dark:text-slate-500 font-black tracking-widest">
                  <tr>
                    <th className="px-2 py-2 text-start">ID</th>
                    <th className="px-2 py-2 text-start">{t('bulkStation.col.name')}</th>
                    <th className="px-2 py-2 text-center w-16">{t('bulkStation.col.normalHC')}</th>
                    <th className="px-2 py-2 text-center w-16">{t('bulkStation.col.peakHC')}</th>
                    <th className="px-2 py-2 text-center w-24">{t('bulkStation.col.open')}</th>
                    <th className="px-2 py-2 text-center w-24">{t('bulkStation.col.close')}</th>
                    <th className="px-2 py-2 text-start w-32">{t('bulkStation.col.role')}</th>
                    <th className="px-2 py-2 text-center w-16">{t('bulkStation.col.color')}</th>
                    <th className="px-2 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {rows.map((row, i) => {
                    const id = idForRowIfSubmitted(i);
                    const collision = id ? existingIds.has(id) : false;
                    return (
                      <tr key={i} className="bg-white dark:bg-slate-900">
                        <td className="px-2 py-1.5 align-middle">
                          {id ? (
                            <span className={cn(
                              'inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold border',
                              collision
                                ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-200 border-rose-300 dark:border-rose-500/50'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
                            )} title={collision ? t('bulkStation.preview.collision') : id}>
                              {id}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300 dark:text-slate-600 italic">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text" value={row.name}
                            onChange={e => updateRow(i, { name: e.target.value })}
                            placeholder={t('bulkStation.row.namePlaceholder')}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1 px-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" min={0} value={row.normalMinHC}
                            onChange={e => updateRow(i, { normalMinHC: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1 px-1.5 text-sm font-mono text-center"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" min={0} value={row.peakMinHC}
                            onChange={e => updateRow(i, { peakMinHC: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1 px-1.5 text-sm font-mono text-center"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="time" value={row.openingTime}
                            onChange={e => updateRow(i, { openingTime: e.target.value })}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1 px-1.5 text-sm font-mono"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="time" value={row.closingTime}
                            onChange={e => updateRow(i, { closingTime: e.target.value })}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1 px-1.5 text-sm font-mono"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={row.requiredRole}
                            onChange={e => updateRow(i, { requiredRole: e.target.value })}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-1 px-1.5 text-sm font-medium"
                          >
                            <option value="">{t('modal.station.role.any')}</option>
                            {roleOptions.map(r => (
                              <option key={r} value={r}>{r === 'Driver' ? t('modal.station.role.driver') : r}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="color" value={row.color}
                            onChange={e => updateRow(i, { color: e.target.value })}
                            className="w-10 h-7 p-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded mx-auto block"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button" onClick={() => removeRow(i)}
                            disabled={rows.length === 1}
                            aria-label={t('bulkStation.row.remove')}
                            className={cn(
                              'p-1 rounded-md transition-colors',
                              rows.length === 1
                                ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                : 'text-rose-500 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/15',
                            )}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > cleanRows.length && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                {t('bulkStation.row.blanksHint', { count: rows.length - cleanRows.length })}
              </p>
            )}
          </div>

          {error && (
            <div className="text-[11px] font-bold text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/40 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            {cleanRows.length === 0
              ? t('bulkStation.summary.empty')
              : t('bulkStation.summary.ready', { count: cleanRows.length })}
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-widest">{t('action.cancel')}</button>
            <button
              onClick={apply}
              disabled={cleanRows.length === 0}
              className={cn(
                'px-8 py-2 rounded text-sm font-bold transition-all shadow-lg uppercase tracking-widest',
                cleanRows.length === 0
                  ? 'bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700',
              )}
            >
              {t('bulkStation.commit', { count: cleanRows.length })}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function DefaultsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}
