import React from 'react';
import { Calendar, Plus, Trash2, Edit3 } from 'lucide-react';
import { format } from 'date-fns';
import { PublicHoliday, HolidayCompMode, Config } from '../types';
import { Card } from '../components/Primitives';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

interface HolidaysTabProps {
  holidays: PublicHoliday[];
  config: Config;
  onAddNew: () => void;
  onEdit: (holi: PublicHoliday) => void;
  onDelete: (holi: PublicHoliday) => void;
  onUpdate: (holi: PublicHoliday) => void;
  // v2.2.0 — bulk mode-set across every holiday in the list. Saves the
  // supervisor from cycling 14 individual pills when the policy
  // changes uniformly (e.g. switching the whole year to cash-ot during
  // a peak season).
  onSetAllCompModes: (mode: HolidayCompMode | undefined) => void;
}

export function HolidaysTab({ holidays, config, onAddNew, onEdit, onDelete, onUpdate, onSetAllCompModes }: HolidaysTabProps) {
  const { t } = useI18n();
  const defaultMode = config.holidayCompMode ?? 'comp-day';

  const cycleMode = (current: HolidayCompMode | undefined): HolidayCompMode | undefined => {
    // v5.1.7 — cycle now: inherit → comp-day → cash-ot → both → inherit.
    if (current === undefined) return 'comp-day';
    if (current === 'comp-day') return 'cash-ot';
    if (current === 'cash-ot') return 'both';
    return undefined;
  };
  // v5.1.7 — pill colour for each effective Art. 74 mode (matches the
  // VariablesTab + HolidayModal palette so the visual language is
  // consistent across surfaces).
  const pillCls = (mode: HolidayCompMode) =>
    mode === 'comp-day'
      ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-500/25'
      : mode === 'cash-ot'
        ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/25'
        : 'bg-purple-50 dark:bg-purple-500/15 border-purple-200 dark:border-purple-500/30 text-purple-800 dark:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-500/25';
  const modeLabel = (mode: HolidayCompMode) =>
    mode === 'comp-day' ? t('holidays.compMode.compDay')
      : mode === 'cash-ot' ? t('holidays.compMode.cashOt')
      : t('holidays.compMode.both');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-100 uppercase tracking-tight">{t('holidays.title')}</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium tracking-widest font-mono leading-none">{t('holidays.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* v2.2.0 — bulk-set every holiday at once. Useful when the
              supervisor wants to flip the whole year to cash-ot during
              a peak quarter, then back to inherit afterwards. */}
          {holidays.length > 0 && (
            <div className="flex items-center bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-1 shadow-sm">
              <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest px-2">{t('holidays.bulk.label')}</span>
              <button
                onClick={() => onSetAllCompModes(undefined)}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-all"
                title={t('holidays.bulk.inherit.tooltip')}
              >
                {t('holidays.compMode.inherit')}
              </button>
              <button
                onClick={() => onSetAllCompModes('comp-day')}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 transition-all"
                title={t('holidays.bulk.compDay.tooltip')}
              >
                {t('holidays.compMode.compDay')}
              </button>
              <button
                onClick={() => onSetAllCompModes('cash-ot')}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/15 transition-all"
                title={t('holidays.bulk.cashOt.tooltip')}
              >
                {t('holidays.compMode.cashOt')}
              </button>
              <button
                onClick={() => onSetAllCompModes('both')}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-500/15 transition-all"
                title={t('holidays.bulk.both.tooltip')}
              >
                {t('holidays.compMode.both')}
              </button>
            </div>
          )}
          <button
            onClick={onAddNew}
            className="apple-press flex items-center gap-2 bg-red-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-red-700 shadow-lg shadow-red-500/25 font-mono"
          >
            <Plus className="w-4 h-4" />
            {t('holidays.new')}
          </button>
        </div>
      </div>

      <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
        {t('holidays.compModeHint', { mode: modeLabel(defaultMode) })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {holidays.map(holi => {
          const effMode: HolidayCompMode = holi.compMode ?? defaultMode;
          const isOverride = holi.compMode !== undefined;
          return (
            <Card key={holi.id ?? holi.date} className="p-6 relative group">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-red-50 dark:bg-red-500/15 rounded-xl flex items-center justify-center text-red-600 dark:text-red-300 border border-red-100 dark:border-red-500/30 shadow-sm">
                  <Calendar className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-tight">{holi.name}</h4>
                    {(holi.durationDays ?? 1) > 1 && (
                      <span className="text-[9px] font-black bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-500/30 px-1.5 py-0.5 rounded uppercase tracking-widest">
                        {t('holidays.durationBadge', { days: holi.durationDays })}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 font-bold uppercase">
                    {(holi.durationDays ?? 1) > 1
                      ? t('holidays.dateRange', {
                          start: format(new Date(holi.date), 'dd MMM'),
                          end: format(new Date(new Date(holi.date).getTime() + ((holi.durationDays ?? 1) - 1) * 86400000), 'dd MMM yyyy'),
                        })
                      : format(new Date(holi.date), 'dd MMMM yyyy')}
                  </span>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5">{t('holidays.compMode.label')}</p>
                <button
                  onClick={() => onUpdate({ ...holi, compMode: cycleMode(holi.compMode) })}
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all',
                    pillCls(effMode),
                  )}
                  title={t('holidays.compMode.cycleHint')}
                >
                  {modeLabel(effMode)}
                  {!isOverride && (
                    <span className="ms-2 normal-case font-medium text-[9px] text-slate-500 dark:text-slate-400 lowercase">{t('holidays.compMode.inherit')}</span>
                  )}
                </button>
              </div>

              <div className="flex justify-between items-center py-3 border-t border-slate-50 dark:border-slate-700/60 mt-4">
                <span className={cn(
                  'text-[9px] font-black uppercase tracking-widest',
                  holi.isFixed ? 'text-blue-500 dark:text-blue-300' : 'text-slate-400 dark:text-slate-500',
                )}>
                  {holi.isFixed ? t('holidays.fixed') : t('holidays.movable')}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onEdit(holi)}
                    aria-label={`${t('action.edit')}: ${holi.name}`}
                    title={t('action.edit')}
                    className="text-slate-300 dark:text-slate-500 hover:text-blue-500 dark:hover:text-blue-300 transition-colors p-1"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onDelete(holi)}
                    aria-label={`${t('action.delete')}: ${holi.name}`}
                    title={t('action.delete')}
                    className="text-slate-300 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-300 transition-colors p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
