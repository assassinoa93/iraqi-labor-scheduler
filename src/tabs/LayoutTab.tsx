import React from 'react';
import { Plus, Edit3, Trash2, Layout } from 'lucide-react';
import { Employee, Station } from '../types';
import { Card } from '../components/Primitives';
import { useI18n } from '../lib/i18n';

interface LayoutTabProps {
  stations: Station[];
  employees: Employee[];
  onAddNew: () => void;
  onEdit: (st: Station) => void;
  onDelete: (st: Station) => void;
}

export function LayoutTab({ stations, employees, onAddNew, onEdit, onDelete }: LayoutTabProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">{t('layout.title')}</h3>
          <p className="text-xs text-slate-400 font-medium tracking-widest leading-none">{t('layout.subtitle')}</p>
        </div>
        <button
          onClick={onAddNew}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg active:scale-95 whitespace-nowrap min-w-fit"
        >
          <Plus className="w-4 h-4" />
          {t('layout.new')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stations.map(st => (
          <Card key={st.id} className="p-6 relative group overflow-hidden border-slate-200">
            <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rotate-45 translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform -z-10" />
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 rounded-xl shadow-lg border-2 border-white" style={{ backgroundColor: st.color || '#3b82f6' }}>
                <Layout className="w-6 h-6 text-white" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-lg leading-tight">{st.name}</h4>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{st.id}</span>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between items-center text-[10px] font-bold">
                <span className="text-slate-400 uppercase tracking-tighter">{t('layout.normalStaffing')}</span>
                <span className="text-slate-800">{st.normalMinHC} {t('layout.persons')}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold">
                <span className="text-slate-400 uppercase tracking-tighter">{t('layout.peakStaffing')}</span>
                <span className="text-blue-600">{st.peakMinHC} {t('layout.persons')}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold">
                <span className="text-slate-400 uppercase tracking-tighter">{t('layout.opHours')}</span>
                <span className="text-slate-800 font-mono tracking-tighter uppercase">{st.openingTime} - {st.closingTime}</span>
              </div>
            </div>

            <div className="flex gap-2 p-4 bg-slate-50 rounded-lg border border-slate-100 mb-6">
              <div className="flex-1 text-center border-r border-slate-200">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('layout.eligible')}</p>
                <p className="text-lg font-light text-slate-800">
                  {employees.filter(e => e.eligibleStations?.includes(st.id)).length}
                </p>
              </div>
              <div className="flex-1 text-center">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('layout.status')}</p>
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest py-1.5">{t('layout.active')}</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <button
                onClick={() => onEdit(st)}
                aria-label={`${t('action.edit')}: ${st.name}`}
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-all border border-transparent hover:border-slate-200"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => onDelete(st)}
                aria-label={`${t('action.delete')}: ${st.name}`}
                className="p-2 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-all border border-transparent hover:border-red-100"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </Card>
        ))}
        {stations.length === 0 && (
          <div className="col-span-1 md:col-span-2 lg:col-span-3 p-20 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-white shadow-inner">
            <Layout className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <h3 className="text-slate-400 font-bold uppercase tracking-widest text-xs">{t('layout.empty')}</h3>
            <p className="text-[11px] text-slate-300 font-medium uppercase tracking-tighter mt-1">{t('layout.emptyHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
