import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { X, Layers } from 'lucide-react';
import { Station, StationGroup } from '../types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useModalKeys } from '../lib/hooks';

// v5.3.0 — bulk station creation modal. Designed for the "we just opened a
// new arcade and need to register all twelve game machines at once" flow.
// The single-station StationModal is still the right tool for editing or
// fine-tuning a station's details; this modal exists purely so the user
// doesn't have to click Add → fill 8 fields → Save → Add → ... twelve
// times in a row to get the basic skeleton in place.
//
// UX shape:
//   * Pick a target group (or "Ungrouped").
//   * Type one station name per line in a textarea (paste-friendly).
//   * Set shared properties once (HC, opening / closing time, role, color)
//     — they're applied to every created station.
//   * Choose an ID prefix; the modal auto-numbers from the highest
//     existing station ID matching that prefix, +1.
//   * Submit → all stations land in a single setStations call (one
//     Firestore syncStations diff in Online mode).
//
// What this modal does NOT do (intentionally): per-station overrides for
// HC, opening time, etc. If a row needs to differ from the rest, the user
// edits it in the regular StationModal afterwards. This keeps the bulk
// surface honest about its bulk semantics — every station gets the same
// shared defaults.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  existingStations: Station[];
  stationGroups: StationGroup[];
  availableRoles: string[];
  onApply: (stations: Station[]) => void;
}

const DEFAULT_PREFIX = 'ST-';
const DEFAULT_COLOR = '#3B82F6';

export function BulkAddStationsModal({
  isOpen, onClose, existingStations, stationGroups, availableRoles, onApply,
}: Props) {
  const { t } = useI18n();
  useModalKeys(isOpen, onClose);

  const [groupId, setGroupId] = useState<string>('');
  const [namesText, setNamesText] = useState<string>('');
  const [normalMinHC, setNormalMinHC] = useState<number>(0);
  const [peakMinHC, setPeakMinHC] = useState<number>(1);
  const [openingTime, setOpeningTime] = useState<string>('11:00');
  const [closingTime, setClosingTime] = useState<string>('23:00');
  const [requiredRole, setRequiredRole] = useState<string>('');
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [prefix, setPrefix] = useState<string>(DEFAULT_PREFIX);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setGroupId('');
    setNamesText('');
    setNormalMinHC(0);
    setPeakMinHC(1);
    setOpeningTime('11:00');
    setClosingTime('23:00');
    setRequiredRole('');
    setColor(DEFAULT_COLOR);
    setPrefix(DEFAULT_PREFIX);
    setError(null);
  }, [isOpen]);

  // When a group is picked, default the colour to the group's accent so all
  // newly-created stations inherit the kanban column's visual identity. The
  // user can still override.
  useEffect(() => {
    if (!groupId) return;
    const g = stationGroups.find(x => x.id === groupId);
    if (g?.color) setColor(g.color);
  }, [groupId, stationGroups]);

  const cleanNames = useMemo(
    () => namesText.split('\n').map(s => s.trim()).filter(Boolean),
    [namesText],
  );

  // Auto-number from the highest existing ID matching `prefix-<digits>`.
  // Falls back to 1 if no matches. The preview list shows the resulting IDs
  // before the user commits so they can spot an unwanted prefix collision.
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

  const previewIds = useMemo(() => cleanNames.map((_, i) => `${prefix}${nextNumberStart + i}`), [cleanNames, prefix, nextNumberStart]);

  const existingIds = useMemo(() => new Set(existingStations.map(s => s.id)), [existingStations]);
  const collidingId = previewIds.find(id => existingIds.has(id));

  const apply = () => {
    if (cleanNames.length === 0) { setError(t('bulkStation.error.noNames')); return; }
    if (!prefix.trim()) { setError(t('bulkStation.error.prefix')); return; }
    if (collidingId) { setError(t('bulkStation.error.collision', { id: collidingId })); return; }
    if (peakMinHC < normalMinHC) { setError(t('bulkStation.error.hc')); return; }

    const stations: Station[] = cleanNames.map((name, i) => {
      const id = `${prefix}${nextNumberStart + i}`;
      const station: Station = {
        id,
        name,
        normalMinHC: Math.max(0, normalMinHC | 0),
        peakMinHC: Math.max(0, peakMinHC | 0),
        openingTime,
        closingTime,
        color,
      };
      if (groupId) station.groupId = groupId;
      if (requiredRole) station.requiredRoles = [requiredRole];
      return station;
    });
    onApply(stations);
  };

  if (!isOpen) return null;

  const roleOptions = Array.from(new Set([...availableRoles, 'Driver'])).filter(Boolean).sort();

  return (
    <div onClick={onClose} className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('bulkStation.title')}>
      <motion.div
        onClick={e => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
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

        <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* TARGET GROUP — first because it auto-tints colour and frames
              the rest of the form's purpose. */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('bulkStation.field.group')}</label>
            <select
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
              className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
            >
              <option value="">{t('bulkStation.group.ungrouped')}</option>
              {stationGroups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* NAMES — paste-friendly textarea. The live counter + preview
              right below tells the user exactly what's about to land. */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              {t('bulkStation.field.names')}
            </label>
            <textarea
              value={namesText}
              onChange={e => setNamesText(e.target.value)}
              placeholder={t('bulkStation.namesPlaceholder')}
              className="w-full p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm min-h-[140px] focus:ring-1 focus:ring-blue-500 outline-none font-mono"
            />
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
              {t('bulkStation.countHint', { count: cleanNames.length })}
            </p>
          </div>

          {/* SHARED PROPERTIES — same for every created station. */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-700/60">
            <div className="col-span-2">
              <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-3">{t('bulkStation.section.shared')}</p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.station.field.normalHC')}</label>
              <input
                type="number" min={0} value={normalMinHC}
                onChange={e => setNormalMinHC(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.station.field.peakHC')}</label>
              <input
                type="number" min={0} value={peakMinHC}
                onChange={e => setPeakMinHC(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.station.field.openTime')}</label>
              <input
                type="time" value={openingTime}
                onChange={e => setOpeningTime(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.station.field.closeTime')}</label>
              <input
                type="time" value={closingTime}
                onChange={e => setClosingTime(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.station.field.role')}</label>
              <select
                value={requiredRole}
                onChange={e => setRequiredRole(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-medium"
              >
                <option value="">{t('modal.station.role.any')}</option>
                {roleOptions.map(r => (
                  <option key={r} value={r}>{r === 'Driver' ? t('modal.station.role.driver') : r}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('modal.station.field.color')}</label>
              <input
                type="color" value={color}
                onChange={e => setColor(e.target.value)}
                className="w-full h-9 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
          </div>

          {/* ID GENERATION — prefix + auto-number, with the live preview
              that lets the user verify before commit. */}
          <div className="space-y-3 p-4 bg-blue-50/30 dark:bg-blue-500/10 rounded-lg border border-blue-100 dark:border-blue-500/30">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-2 flex-1 min-w-[180px]">
                <label className="text-[10px] font-bold text-blue-600 dark:text-blue-300 uppercase tracking-widest">{t('bulkStation.field.prefix')}</label>
                <input
                  type="text" value={prefix}
                  onChange={e => setPrefix(e.target.value)}
                  placeholder="ST-"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-sm font-mono"
                />
              </div>
              <p className="text-[10px] font-bold text-blue-600 dark:text-blue-300 uppercase tracking-widest pb-3">
                {t('bulkStation.startsAt', { number: nextNumberStart })}
              </p>
            </div>
            {previewIds.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('bulkStation.preview.title')}</p>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700">
                  {previewIds.map((id, i) => (
                    <span
                      key={id}
                      className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-mono font-bold border',
                        existingIds.has(id)
                          ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-200 border-rose-300 dark:border-rose-500/50'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
                      )}
                      title={existingIds.has(id) ? t('bulkStation.preview.collision') : `${id} → ${cleanNames[i]}`}
                    >
                      {id}
                    </span>
                  ))}
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

        <div className="p-6 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            {cleanNames.length === 0
              ? t('bulkStation.summary.empty')
              : t('bulkStation.summary.ready', { count: cleanNames.length })}
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-6 py-2 rounded text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all uppercase tracking-widest">{t('action.cancel')}</button>
            <button
              onClick={apply}
              disabled={cleanNames.length === 0 || !!collidingId}
              className={cn(
                'px-8 py-2 rounded text-sm font-bold transition-all shadow-lg uppercase tracking-widest',
                cleanNames.length === 0 || !!collidingId
                  ? 'bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700',
              )}
            >
              {t('bulkStation.commit', { count: cleanNames.length })}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
