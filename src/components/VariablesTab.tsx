import React from 'react';
import { ShieldCheck, Truck, Flame, Calendar, Clock, AlertCircle, Moon, Users } from 'lucide-react';
import { Config, DayOfWeek } from '../types';
import { SettingField } from './Primitives';
import { useI18n } from '../lib/i18n';

const DOW_KEY: Record<DayOfWeek, string> = {
  1: 'common.day.sunday',
  2: 'common.day.monday',
  3: 'common.day.tuesday',
  4: 'common.day.wednesday',
  5: 'common.day.thursday',
  6: 'common.day.friday',
  7: 'common.day.saturday',
};

interface Props {
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
}

// CapDef carries i18n keys (resolved at render time so language toggles update
// labels live), the canonical Config field, default value, unit token, and
// article citation. Article strings are not translated — they're cross-language
// legal citations.
interface CapDef {
  key: keyof Config;
  labelKey: string;
  unitKey: string;
  article: string;
  descKey: string;
  defaultValue: number;
  step?: number;
}

const STANDARD_CAPS: CapDef[] = [
  { key: 'standardDailyHrsCap', labelKey: 'variables.cap.standardDailyHrsCap.label', descKey: 'variables.cap.standardDailyHrsCap.desc', unitKey: 'variables.unit.hrsPerDay', article: 'Art. 67', defaultValue: 8 },
  { key: 'standardWeeklyHrsCap', labelKey: 'variables.cap.standardWeeklyHrsCap.label', descKey: 'variables.cap.standardWeeklyHrsCap.desc', unitKey: 'variables.unit.hrsPerWeek', article: 'Art. 70', defaultValue: 48 },
  { key: 'minRestBetweenShiftsHrs', labelKey: 'variables.cap.minRestBetweenShiftsHrs.label', descKey: 'variables.cap.minRestBetweenShiftsHrs.desc', unitKey: 'variables.unit.hrs', article: 'Art. 71', defaultValue: 11 },
  { key: 'maxConsecWorkDays', labelKey: 'variables.cap.maxConsecWorkDays.label', descKey: 'variables.cap.maxConsecWorkDays.desc', unitKey: 'variables.unit.days', article: 'Art. 71 §5, 72', defaultValue: 6 },
];

const HAZARDOUS_CAPS: CapDef[] = [
  { key: 'hazardousDailyHrsCap', labelKey: 'variables.cap.hazardousDailyHrsCap.label', descKey: 'variables.cap.hazardousDailyHrsCap.desc', unitKey: 'variables.unit.hrsPerDay', article: 'Art. 68', defaultValue: 7 },
  { key: 'hazardousWeeklyHrsCap', labelKey: 'variables.cap.hazardousWeeklyHrsCap.label', descKey: 'variables.cap.hazardousWeeklyHrsCap.desc', unitKey: 'variables.unit.hrsPerWeek', article: 'Art. 70', defaultValue: 36 },
];

const DRIVER_CAPS: CapDef[] = [
  { key: 'driverDailyHrsCap', labelKey: 'variables.cap.driverDailyHrsCap.label', descKey: 'variables.cap.driverDailyHrsCap.desc', unitKey: 'variables.unit.hrsPerDay', article: 'Art. 88', defaultValue: 9 },
  { key: 'driverWeeklyHrsCap', labelKey: 'variables.cap.driverWeeklyHrsCap.label', descKey: 'variables.cap.driverWeeklyHrsCap.desc', unitKey: 'variables.unit.hrsPerWeek', article: 'Art. 88', defaultValue: 56 },
  { key: 'driverContinuousDrivingHrsCap', labelKey: 'variables.cap.driverContinuousDrivingHrsCap.label', descKey: 'variables.cap.driverContinuousDrivingHrsCap.desc', unitKey: 'variables.unit.hrs', article: 'Art. 88', defaultValue: 4.5, step: 0.5 },
  { key: 'driverMinDailyRestHrs', labelKey: 'variables.cap.driverMinDailyRestHrs.label', descKey: 'variables.cap.driverMinDailyRestHrs.desc', unitKey: 'variables.unit.hrs', article: 'Art. 88', defaultValue: 11 },
  { key: 'driverMaxConsecWorkDays', labelKey: 'variables.cap.driverMaxConsecWorkDays.label', descKey: 'variables.cap.driverMaxConsecWorkDays.desc', unitKey: 'variables.unit.days', article: 'Art. 88', defaultValue: 6 },
];

const PAY_RATES: CapDef[] = [
  { key: 'otRateDay', labelKey: 'variables.cap.otRateDay.label', descKey: 'variables.cap.otRateDay.desc', unitKey: 'variables.unit.multiplier', article: 'Art. 73', defaultValue: 1.5, step: 0.1 },
  { key: 'otRateNight', labelKey: 'variables.cap.otRateNight.label', descKey: 'variables.cap.otRateNight.desc', unitKey: 'variables.unit.multiplier', article: 'Art. 73-74', defaultValue: 2.0, step: 0.1 },
];

interface SectionProps {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconText: string;
  caps: CapDef[];
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
}

function Section({ title, subtitle, icon: Icon, iconBg, iconText, caps, config, setConfig }: SectionProps) {
  const { t } = useI18n();
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="p-5 border-b border-slate-100 flex items-center gap-4">
        <div className={`w-10 h-10 ${iconBg} ${iconText} rounded-xl flex items-center justify-center`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-slate-800 text-sm tracking-tight">{title}</h3>
          <p className="text-[10px] text-slate-500 font-medium">{subtitle}</p>
        </div>
      </div>
      <div className="divide-y divide-slate-50">
        {caps.map(cap => {
          const current = (config[cap.key] as number | undefined) ?? cap.defaultValue;
          return (
            <div key={String(cap.key)} className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <div className="md:col-span-2 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-slate-800 text-sm">{t(cap.labelKey)}</p>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest border border-slate-200 font-mono">
                    {cap.article}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">{t(cap.descKey)}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={cap.step ?? 1}
                  value={current}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setConfig(prev => ({ ...prev, [cap.key]: Number.isFinite(v) ? v : cap.defaultValue }));
                  }}
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[60px]">{t(cap.unitKey)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VariablesTab({ config, setConfig }: Props) {
  const { t } = useI18n();
  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight mb-1">{t('variables.title')}</h3>
        <p className="text-xs text-slate-400 font-medium uppercase tracking-widest font-mono">
          {t('variables.subtitle')}
        </p>
      </div>

      <div className="p-4 bg-blue-50/60 border border-blue-100 rounded-xl flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-bold text-blue-800">{t('variables.editingNote.title')}</p>
          <p className="text-[11px] text-blue-700 leading-relaxed mt-1">
            {t('variables.editingNote.body')}
          </p>
        </div>
      </div>

      <Section
        title={t('variables.standard')}
        subtitle={t('variables.standard.subtitle')}
        icon={ShieldCheck}
        iconBg="bg-blue-50"
        iconText="text-blue-600"
        caps={STANDARD_CAPS}
        config={config}
        setConfig={setConfig}
      />

      <Section
        title={t('variables.hazardous')}
        subtitle={t('variables.hazardous.subtitle')}
        icon={Flame}
        iconBg="bg-orange-50"
        iconText="text-orange-600"
        caps={HAZARDOUS_CAPS}
        config={config}
        setConfig={setConfig}
      />

      <Section
        title={t('variables.drivers')}
        subtitle={t('variables.drivers.subtitle')}
        icon={Truck}
        iconBg="bg-amber-50"
        iconText="text-amber-700"
        caps={DRIVER_CAPS}
        config={config}
        setConfig={setConfig}
      />

      <Section
        title={t('variables.payRates')}
        subtitle={t('variables.payRates.subtitle')}
        icon={Calendar}
        iconBg="bg-emerald-50"
        iconText="text-emerald-600"
        caps={PAY_RATES}
        config={config}
        setConfig={setConfig}
      />

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center gap-4">
          <div className="w-10 h-10 bg-purple-50 text-purple-700 rounded-xl flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slate-800 text-sm tracking-tight">{t('variables.operatingWindow')}</h3>
            <p className="text-[10px] text-slate-500 font-medium">{t('variables.operatingWindow.note')}</p>
          </div>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          <SettingField
            label={t('variables.operatingWindow.defaultOpen')}
            type="time"
            value={config.shopOpeningTime}
            onChange={v => setConfig(prev => ({ ...prev, shopOpeningTime: v }))}
          />
          <SettingField
            label={t('variables.operatingWindow.defaultClose')}
            type="time"
            value={config.shopClosingTime}
            onChange={v => setConfig(prev => ({ ...prev, shopClosingTime: v }))}
          />
        </div>
        <div className="p-5 pt-0 space-y-2">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('variables.operatingWindow.perDayHeader')}</p>
          <p className="text-[11px] text-slate-500 leading-relaxed">{t('variables.operatingWindow.perDayNote')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            {([1,2,3,4,5,6,7] as DayOfWeek[]).map(dow => {
              const override = config.operatingHoursByDayOfWeek?.[dow];
              const enabled = !!override;
              const open = override?.open ?? config.shopOpeningTime;
              const close = override?.close ?? config.shopClosingTime;
              const setOverride = (next: { open: string; close: string } | undefined) => {
                setConfig(prev => {
                  const map = { ...(prev.operatingHoursByDayOfWeek || {}) };
                  if (next) map[dow] = next;
                  else delete map[dow];
                  return { ...prev, operatingHoursByDayOfWeek: map };
                });
              };
              return (
                <div key={dow} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${enabled ? 'border-purple-200 bg-purple-50/40' : 'border-slate-200 bg-white'}`}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => {
                      if (e.target.checked) setOverride({ open, close });
                      else setOverride(undefined);
                    }}
                    aria-label={`Override hours for ${t(DOW_KEY[dow])}`}
                  />
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-widest min-w-[80px]">{t(DOW_KEY[dow])}</span>
                  <input
                    type="time"
                    value={open}
                    disabled={!enabled}
                    onChange={e => setOverride({ open: e.target.value, close })}
                    className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded text-xs font-mono disabled:opacity-40"
                  />
                  <span className="text-[10px] text-slate-400 font-bold">→</span>
                  <input
                    type="time"
                    value={close}
                    disabled={!enabled}
                    onChange={e => setOverride({ open, close: e.target.value })}
                    className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded text-xs font-mono disabled:opacity-40"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center gap-4">
          <div className="w-10 h-10 bg-rose-50 text-rose-700 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slate-800 text-sm tracking-tight">{t('variables.art86.title')}</h3>
            <p className="text-[10px] text-slate-500 font-medium">{t('variables.art86.subtitle')}</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enforce-art86"
              checked={!!config.enforceArt86NightWork}
              onChange={e => setConfig(prev => ({ ...prev, enforceArt86NightWork: e.target.checked }))}
            />
            <label htmlFor="enforce-art86" className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">{t('variables.art86.enable')}</label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SettingField
              label={t('variables.art86.start')}
              type="time"
              value={config.art86NightStart || '22:00'}
              onChange={v => setConfig(prev => ({ ...prev, art86NightStart: v }))}
            />
            <SettingField
              label={t('variables.art86.end')}
              type="time"
              value={config.art86NightEnd || '07:00'}
              onChange={v => setConfig(prev => ({ ...prev, art86NightEnd: v }))}
            />
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">{t('variables.art86.note')}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center gap-4">
          <div className="w-10 h-10 bg-amber-50 text-amber-700 rounded-xl flex items-center justify-center">
            <Moon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slate-800 text-sm tracking-tight">{t('variables.ramadan.title')}</h3>
            <p className="text-[10px] text-slate-500 font-medium">{t('variables.ramadan.subtitle')}</p>
          </div>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <SettingField
            label={t('variables.ramadan.start')}
            value={config.ramadanStart ?? ''}
            onChange={v => setConfig(prev => ({ ...prev, ramadanStart: v }))}
          />
          <SettingField
            label={t('variables.ramadan.end')}
            value={config.ramadanEnd ?? ''}
            onChange={v => setConfig(prev => ({ ...prev, ramadanEnd: v }))}
          />
          <SettingField
            label={t('variables.ramadan.dailyCap')}
            type="number"
            value={config.ramadanDailyHrsCap ?? 6}
            onChange={v => {
              const n = parseFloat(v);
              setConfig(prev => ({ ...prev, ramadanDailyHrsCap: Number.isFinite(n) ? n : 6 }));
            }}
          />
        </div>
        <div className="p-5 pt-0 text-[11px] text-slate-500 leading-relaxed">
          {t('variables.ramadan.note')}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-6 text-[11px] text-slate-400 leading-relaxed">
        <p className="font-bold uppercase tracking-widest text-[10px] text-slate-500 mb-2">{t('variables.references.title')}</p>
        <p>{t('variables.references.body')}</p>
      </div>
    </div>
  );
}
