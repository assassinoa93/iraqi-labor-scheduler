import React from 'react';
import { Calendar, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { PublicHoliday, HolidayCompMode, Config } from '../types';
import { Card } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

interface HolidaysTabProps {
  holidays: PublicHoliday[];
  config: Config;
  onAddNew: () => void;
  onDelete: (holi: PublicHoliday) => void;
  onUpdate: (holi: PublicHoliday) => void;
}

export function HolidaysTab({ holidays, config, onAddNew, onDelete, onUpdate }: HolidaysTabProps) {
  const { t } = useI18n();
  const defaultMode = config.holidayCompMode ?? 'comp-day';

  const cycleMode = (current: HolidayCompMode | undefined): HolidayCompMode | undefined => {
    // Cycle: inherit → comp-day override → cash-ot override → inherit
    if (current === undefined) return 'comp-day';
    if (current === 'comp-day') return 'cash-ot';
    return undefined;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">{t('holidays.title')}</h3>
          <p className="text-xs text-slate-400 font-medium tracking-widest font-mono leading-none">{t('holidays.subtitle')}</p>
        </div>
        <button
          onClick={onAddNew}
          className="flex items-center gap-2 bg-red-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg font-mono"
        >
          <Plus className="w-4 h-4" />
          {t('holidays.new')}
        </button>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-[11px] text-slate-600 leading-relaxed">
        {t('holidays.compModeHint', {
          mode: defaultMode === 'comp-day' ? t('holidays.compMode.compDay') : t('holidays.compMode.cashOt'),
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {holidays.map(holi => {
          const effMode: HolidayCompMode = holi.compMode ?? defaultMode;
          const isOverride = holi.compMode !== undefined;
          return (
            <Card key={holi.date} className="p-6 relative group border-slate-200">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-600 border border-red-100 shadow-sm">
                  <Calendar className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 text-sm leading-tight">{holi.name}</h4>
                  <span className="text-[10px] font-mono text-slate-400 font-bold uppercase">{format(new Date(holi.date), 'dd MMMM yyyy')}</span>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5">{t('holidays.compMode.label')}</p>
                <button
                  onClick={() => onUpdate({ ...holi, compMode: cycleMode(holi.compMode) })}
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all',
                    effMode === 'comp-day'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                      : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100',
                  )}
                  title={t('holidays.compMode.cycleHint')}
                >
                  {effMode === 'comp-day' ? t('holidays.compMode.compDay') : t('holidays.compMode.cashOt')}
                  {!isOverride && (
                    <span className="ml-2 normal-case font-medium text-[9px] text-slate-500 lowercase">{t('holidays.compMode.inherit')}</span>
                  )}
                </button>
              </div>

              <div className="flex justify-between items-center py-3 border-t border-slate-50 mt-4">
                <span className={cn("text-[9px] font-black uppercase tracking-widest", holi.isFixed ? "text-blue-500" : "text-slate-400")}>
                  {holi.isFixed ? t('holidays.fixed') : t('holidays.movable')}
                </span>
                <button
                  onClick={() => onDelete(holi)}
                  aria-label={`${t('action.delete')}: ${holi.name}`}
                  className="text-slate-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
