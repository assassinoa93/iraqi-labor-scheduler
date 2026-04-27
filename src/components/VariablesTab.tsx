import React from 'react';
import { ShieldCheck, Truck, Flame, Calendar, Clock, AlertCircle, Moon } from 'lucide-react';
import { Config } from '../types';
import { SettingField } from './Primitives';
import { useI18n } from '../lib/i18n';

interface Props {
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
}

interface CapDef {
  key: keyof Config;
  label: string;
  unit: string;
  article: string;
  description: string;
  defaultValue: number;
  step?: number;
}

const STANDARD_CAPS: CapDef[] = [
  {
    key: 'standardDailyHrsCap',
    label: 'Standard Daily Hours Cap',
    unit: 'hrs / day',
    article: 'Art. 67',
    description: 'Maximum working hours per day for standard staff. The Iraqi Labor Law fixes the workday at 8 hours.',
    defaultValue: 8,
  },
  {
    key: 'standardWeeklyHrsCap',
    label: 'Standard Weekly Hours Cap',
    unit: 'hrs / week',
    article: 'Art. 70',
    description: 'Total working hours over any rolling 7-day window for standard staff. The legal ceiling is 48 hours.',
    defaultValue: 48,
  },
  {
    key: 'minRestBetweenShiftsHrs',
    label: 'Min Rest Between Shifts',
    unit: 'hrs',
    article: 'Art. 71',
    description: 'Mandatory rest period between the end of one shift and the start of the next.',
    defaultValue: 11,
  },
  {
    key: 'maxConsecWorkDays',
    label: 'Max Consecutive Work Days',
    unit: 'days',
    article: 'Art. 71 §5, 72',
    description: 'Maximum number of consecutive working days before a mandatory rest day must occur.',
    defaultValue: 6,
  },
];

const HAZARDOUS_CAPS: CapDef[] = [
  {
    key: 'hazardousDailyHrsCap',
    label: 'Hazardous Daily Hours Cap',
    unit: 'hrs / day',
    article: 'Art. 68',
    description: 'Reduced daily cap for staff exposed to hazardous or unhealthy conditions.',
    defaultValue: 7,
  },
  {
    key: 'hazardousWeeklyHrsCap',
    label: 'Hazardous Weekly Hours Cap',
    unit: 'hrs / week',
    article: 'Art. 70',
    description: 'Reduced weekly cap for staff in hazardous categories.',
    defaultValue: 36,
  },
];

const DRIVER_CAPS: CapDef[] = [
  {
    key: 'driverDailyHrsCap',
    label: 'Driver Daily Hours Cap',
    unit: 'hrs / day',
    article: 'Art. 88',
    description: 'Maximum on-duty hours per day for drivers under transport-worker provisions.',
    defaultValue: 9,
  },
  {
    key: 'driverWeeklyHrsCap',
    label: 'Driver Weekly Hours Cap',
    unit: 'hrs / week',
    article: 'Art. 88',
    description: 'Maximum weekly on-duty hours for drivers.',
    defaultValue: 56,
  },
  {
    key: 'driverContinuousDrivingHrsCap',
    label: 'Continuous Driving Cap',
    unit: 'hrs',
    article: 'Art. 88',
    description: 'Maximum continuous driving time before a mandatory 30-minute break is required.',
    defaultValue: 4.5,
    step: 0.5,
  },
  {
    key: 'driverMinDailyRestHrs',
    label: 'Driver Min Daily Rest',
    unit: 'hrs',
    article: 'Art. 88',
    description: 'Minimum rest period between two driving days.',
    defaultValue: 11,
  },
  {
    key: 'driverMaxConsecWorkDays',
    label: 'Driver Max Consecutive Days',
    unit: 'days',
    article: 'Art. 88',
    description: 'Maximum consecutive driving days before a mandatory rest day must occur.',
    defaultValue: 6,
  },
];

const PAY_RATES: CapDef[] = [
  {
    key: 'otRateDay',
    label: 'Daytime Overtime Multiplier',
    unit: '×',
    article: 'Art. 73',
    description: 'Pay multiplier for overtime worked during daytime hours.',
    defaultValue: 1.5,
    step: 0.1,
  },
  {
    key: 'otRateNight',
    label: 'Night-time / Holiday Overtime Multiplier',
    unit: '×',
    article: 'Art. 73-74',
    description: 'Pay multiplier for overtime worked at night or on official holidays.',
    defaultValue: 2.0,
    step: 0.1,
  },
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
                  <p className="font-bold text-slate-800 text-sm">{cap.label}</p>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest border border-slate-200 font-mono">
                    {cap.article}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">{cap.description}</p>
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
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[60px]">{cap.unit}</span>
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
          <p className="text-xs font-bold text-blue-800">Editing these values is intentional but consequential.</p>
          <p className="text-[11px] text-blue-700 leading-relaxed mt-1">
            Defaults reflect the statute as written. Adjust only if your operation falls under a sector-specific exemption (Ministerial decree, collective bargaining agreement, or Ministry of Transport regulation). Changes apply immediately to both the compliance engine and the auto-scheduler.
          </p>
        </div>
      </div>

      <Section
        title={t('variables.standard')}
        subtitle="Iraqi Labor Law No. 37 of 2015 — Art. 67, 70, 71, 72"
        icon={ShieldCheck}
        iconBg="bg-blue-50"
        iconText="text-blue-600"
        caps={STANDARD_CAPS}
        config={config}
        setConfig={setConfig}
      />

      <Section
        title={t('variables.hazardous')}
        subtitle="Art. 68, 70"
        icon={Flame}
        iconBg="bg-orange-50"
        iconText="text-orange-600"
        caps={HAZARDOUS_CAPS}
        config={config}
        setConfig={setConfig}
      />

      <Section
        title={t('variables.drivers')}
        subtitle="Art. 88"
        icon={Truck}
        iconBg="bg-amber-50"
        iconText="text-amber-700"
        caps={DRIVER_CAPS}
        config={config}
        setConfig={setConfig}
      />

      <Section
        title={t('variables.payRates')}
        subtitle="Art. 73, 74"
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
            <p className="text-[10px] text-slate-500 font-medium">Business hours used by the auto-scheduler when sizing shifts</p>
          </div>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          <SettingField
            label="Shop Opening Time"
            type="time"
            value={config.shopOpeningTime}
            onChange={v => setConfig(prev => ({ ...prev, shopOpeningTime: v }))}
          />
          <SettingField
            label="Shop Closing Time"
            type="time"
            value={config.shopClosingTime}
            onChange={v => setConfig(prev => ({ ...prev, shopClosingTime: v }))}
          />
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
        <p className="font-bold uppercase tracking-widest text-[10px] text-slate-500 mb-2">References</p>
        <p>
          Iraqi Labor Law No. 37 of 2015 — full text available from the Iraqi Ministry of Labor. Articles cited above are
          enforced by the compliance engine in <span className="font-mono">src/lib/compliance.ts</span>. Driver-specific
          caps additionally consult Ministry of Transport regulations applicable to commercial vehicle operators.
        </p>
      </div>
    </div>
  );
}
