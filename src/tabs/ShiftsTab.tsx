import React, { useMemo, useState } from 'react';
import { Plus, Clock, ChevronUp, ChevronDown, Settings, Trash2, Lock } from 'lucide-react';
import { Shift } from '../types';
import { Card, SortableHeader, SortDir } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { isSystemShift } from '../lib/systemShifts';

interface ShiftsTabProps {
  shifts: Shift[];
  onAddNew: () => void;
  onEdit: (s: Shift) => void;
  onDelete: (code: string) => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
}

type ShiftSortKey = 'code' | 'name' | 'hours' | 'status';

export function ShiftsTab({ shifts, onAddNew, onEdit, onDelete, onMove }: ShiftsTabProps) {
  const { t } = useI18n();
  const [sortKey, setSortKey] = useState<ShiftSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (k: string) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k as ShiftSortKey); setSortDir('asc'); }
  };

  // Pair each shift with its underlying index — needed because the
  // reorder buttons act on the original `shifts` array index, but the
  // visible row may be at a different position once a sort is applied.
  // Rendering still uses the visible row index for keyboard order so the
  // user sees what they're acting on, but `onMove` always gets the
  // canonical index.
  const visible = useMemo(() => {
    const indexed = shifts.map((s, originalIndex) => ({ shift: s, originalIndex }));
    if (sortKey) {
      const dirMul = sortDir === 'asc' ? 1 : -1;
      const sorted = [...indexed].sort((a, b) => {
        let va: number | string;
        let vb: number | string;
        switch (sortKey) {
          case 'code': va = a.shift.code.toLowerCase(); vb = b.shift.code.toLowerCase(); break;
          case 'name': va = a.shift.name.toLowerCase(); vb = b.shift.name.toLowerCase(); break;
          case 'hours': va = a.shift.durationHrs; vb = b.shift.durationHrs; break;
          case 'status': va = a.shift.isWork ? 1 : 0; vb = b.shift.isWork ? 1 : 0; break;
        }
        if (va < vb) return -1 * dirMul;
        if (va > vb) return 1 * dirMul;
        return 0;
      });
      return sorted;
    }
    // v5.7.0 — default order: working shifts on top, non-working at the
    // bottom. Pre-v5.7 the default was the canonical array order, which
    // meant a freshly-seeded list mixed OFF / CP / AL / SL / MAT in with
    // FS / MS etc. depending on insert order. The auto-scheduler hot loop
    // operates only on `isWork: true` shifts; surfacing them at the top
    // matches the supervisor's mental model ("the work shifts I assign
    // are what I should see first; the leave/system codes are reference
    // material at the bottom"). Within each partition we preserve the
    // canonical (manually-reordered) order so the up/down buttons still
    // act on a stable index — see the disable logic below for the
    // cross-partition guard.
    return [...indexed].sort((a, b) => {
      const aWork = a.shift.isWork ? 0 : 1;
      const bWork = b.shift.isWork ? 0 : 1;
      if (aWork !== bWork) return aWork - bWork;
      return a.originalIndex - b.originalIndex;
    });
  }, [shifts, sortKey, sortDir]);

  const sortActive = sortKey !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight">{t('shifts.title')}</h3>
        <button
          onClick={onAddNew}
          className="flex items-center gap-2 bg-slate-900 dark:bg-slate-700 text-white px-5 py-2 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 dark:hover:bg-slate-600 transition-all shadow-lg text-center font-mono"
        >
          <Plus className="w-3 h-3" />
          {t('shifts.new')}
        </button>
      </div>

      <Card>
        <table className="w-full text-start text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/40 text-[11px] uppercase text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
            <tr>
              <SortableHeader label={t('shifts.col.code')} sortKey="code" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHeader label={t('shifts.col.name')} sortKey="name" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHeader label={t('shifts.col.hours')} sortKey="hours" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHeader label={t('shifts.col.status')} sortKey="status" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="center" />
              <th className="px-6 py-4 tracking-wider text-center w-24 text-[10px] font-black text-slate-400 dark:text-slate-500">{t('shifts.col.order')}</th>
              <th className="px-6 py-4 tracking-wider text-end text-[10px] font-black text-slate-400 dark:text-slate-500">{t('shifts.col.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {visible.map(({ shift: s, originalIndex }) => (
              <tr key={s.code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                <td className="px-6 py-4 font-mono text-xs font-bold text-blue-600 dark:text-blue-300">{s.code}</td>
                <td className="px-6 py-4">
                  <p className="font-bold text-slate-700 dark:text-slate-200 text-xs">{s.name}</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">{s.description}</p>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {s.start}-{s.end} ({s.durationHrs}h)
                  </div>
                </td>
                <td className="px-6 py-4 text-center">
                  <span className={cn("px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter", s.isWork ? "bg-emerald-100 dark:bg-emerald-500/25 text-emerald-700 dark:text-emerald-200" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400")}>
                    {s.isWork ? t('shifts.status.work') : t('shifts.status.nonwork')}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {/* Reorder buttons act on the canonical (unsorted) index.
                      Disabled while a sort is active so the visible row
                      doesn't appear to move "wrong" — the up/down would
                      swap underlying positions while the sort keeps the
                      visible order, which reads as a non-response.
                      v5.7.0 — also disabled when a swap would cross the
                      isWork/non-isWork partition (default ordering keeps
                      working shifts on top), since the canonical swap
                      would visibly do nothing under the partition rule. */}
                  {(() => {
                    const prev = originalIndex > 0 ? shifts[originalIndex - 1] : null;
                    const next = originalIndex < shifts.length - 1 ? shifts[originalIndex + 1] : null;
                    const upBlockedByPartition = !sortActive && prev !== null && prev.isWork !== s.isWork;
                    const downBlockedByPartition = !sortActive && next !== null && next.isWork !== s.isWork;
                    return (
                      <div className="flex flex-col items-center gap-1" title={sortActive ? t('shifts.reorder.disabled.sortActive') : (upBlockedByPartition || downBlockedByPartition ? t('shifts.reorder.disabled.partition') : undefined)}>
                        <button
                          disabled={sortActive || originalIndex === 0 || upBlockedByPartition}
                          onClick={() => onMove(originalIndex, 'up')}
                          aria-label={`${t('shifts.moveUp')}: ${s.code}`}
                          className="p-1 text-slate-400 dark:text-slate-500 hover:text-blue-500 dark:hover:text-blue-300 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          disabled={sortActive || originalIndex === shifts.length - 1 || downBlockedByPartition}
                          onClick={() => onMove(originalIndex, 'down')}
                          aria-label={`${t('shifts.moveDown')}: ${s.code}`}
                          className="p-1 text-slate-400 dark:text-slate-500 hover:text-blue-500 dark:hover:text-blue-300 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })()}
                </td>
                <td className="px-6 py-4 text-end">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => onEdit(s)} aria-label={`${t('action.edit')}: ${s.code}`} className="text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors p-1">
                      <Settings className="w-4 h-4" />
                    </button>
                    {/* v2.2.0 — system shifts (OFF/CP/AL/SL/MAT/PH) get a
                        lock icon instead of a delete button. Several layers
                        (auto-scheduler / leaves / comp-day rotation) key off
                        these specific codes; deletion was already blocked
                        with a notice, but exposing the trash icon implied
                        the action was viable. */}
                    {isSystemShift(s.code) ? (
                      <span
                        title={t('shifts.systemShift.locked')}
                        className="text-slate-300 dark:text-slate-600 p-1"
                        aria-label={t('shifts.systemShift.locked')}
                      >
                        <Lock className="w-4 h-4" />
                      </span>
                    ) : (
                      <button onClick={() => onDelete(s.code)} aria-label={`${t('action.delete')}: ${s.code}`} className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-300 transition-colors p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
