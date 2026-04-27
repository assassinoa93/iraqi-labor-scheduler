import React from 'react';
import { Plus, Clock, ChevronUp, ChevronDown, Settings, Trash2 } from 'lucide-react';
import { Shift } from '../types';
import { Card } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

interface ShiftsTabProps {
  shifts: Shift[];
  onAddNew: () => void;
  onEdit: (s: Shift) => void;
  onDelete: (code: string) => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
}

export function ShiftsTab({ shifts, onAddNew, onEdit, onDelete, onMove }: ShiftsTabProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">{t('shifts.title')}</h3>
        <button
          onClick={onAddNew}
          className="flex items-center gap-2 bg-slate-900 text-white px-5 py-2 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg text-center font-mono"
        >
          <Plus className="w-3 h-3" />
          {t('shifts.new')}
        </button>
      </div>

      <Card>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-bold border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 tracking-wider">{t('shifts.col.code')}</th>
              <th className="px-6 py-4 tracking-wider">{t('shifts.col.name')}</th>
              <th className="px-6 py-4 tracking-wider">{t('shifts.col.hours')}</th>
              <th className="px-6 py-4 tracking-wider text-center">{t('shifts.col.status')}</th>
              <th className="px-6 py-4 tracking-wider text-center w-24">{t('shifts.col.order')}</th>
              <th className="px-6 py-4 tracking-wider text-right">{t('shifts.col.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shifts.map((s, i) => (
              <tr key={s.code} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 font-mono text-xs font-bold text-blue-600">{s.code}</td>
                <td className="px-6 py-4">
                  <p className="font-bold text-slate-700 text-xs">{s.name}</p>
                  <p className="text-[10px] text-slate-400">{s.description}</p>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-500">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {s.start}-{s.end} ({s.durationHrs}h)
                  </div>
                </td>
                <td className="px-6 py-4 text-center">
                  <span className={cn("px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter", s.isWork ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                    {s.isWork ? t('shifts.status.work') : t('shifts.status.nonwork')}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col items-center gap-1">
                    <button
                      disabled={i === 0}
                      onClick={() => onMove(i, 'up')}
                      aria-label={`${t('shifts.moveUp')}: ${s.code}`}
                      className="p-1 text-slate-400 hover:text-blue-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      disabled={i === shifts.length - 1}
                      onClick={() => onMove(i, 'down')}
                      aria-label={`${t('shifts.moveDown')}: ${s.code}`}
                      className="p-1 text-slate-400 hover:text-blue-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => onEdit(s)} aria-label={`${t('action.edit')}: ${s.code}`} className="text-slate-400 hover:text-slate-900 transition-colors p-1">
                      <Settings className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(s.code)} aria-label={`${t('action.delete')}: ${s.code}`} className="text-slate-400 hover:text-red-600 transition-colors p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
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
