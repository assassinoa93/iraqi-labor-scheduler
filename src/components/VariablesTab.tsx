import React from 'react';
import { ShieldCheck, Truck, Flame, Calendar, Clock, AlertCircle, Moon, Users, Gift, Scale } from 'lucide-react';
import { Config, DayOfWeek } from '../types';
import { SettingField } from './Primitives';
import { Switch } from './ui/Switch';
import { useI18n } from '../lib/i18n';
import { RULE_KEYS, DEFAULT_FINE_RATES, RULE_ARTICLES, RULE_LABEL_I18N_KEYS, getEffectiveFineRate } from '../lib/fines';

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
  // Online mode: governance config (Iraqi Labor Law caps, pay rates, driver
  // & hazardous limits) is super-admin-only edit because it's the rules
  // every other role plays under. Offline / single-user mode leaves this
  // undefined → falsy → fully editable.
  readOnly?: boolean;
  // v5.1.3 — operating window (default open/close + per-day overrides)
  // is OPERATIONAL config, not governance. Manager + supervisor own
  // day-to-day operations and need to be able to set when the business
  // is open. Admin is still locked out (monitor-only on operations,
  // consistent with cell-edit gate). Defaults to `readOnly` if not
  // supplied so legacy callers keep their previous behaviour.
  operatingWindowReadOnly?: boolean;
  // v5.5.0 — holidayCompMode is also operational rather than governance:
  // it determines how the business pays for holiday work (comp day vs 2×
  // cash vs both). The manager owns this decision. Same precedent as the
  // operating-window override: defaults to `readOnly` so legacy callers
  // keep their previous behaviour.
  holidayCompModeReadOnly?: boolean;
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
  readOnly?: boolean;
}

function Section({ title, subtitle, icon: Icon, iconBg, iconText, caps, config, setConfig, readOnly }: SectionProps) {
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
                  disabled={readOnly}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setConfig(prev => ({ ...prev, [cap.key]: Number.isFinite(v) ? v : cap.defaultValue }));
                  }}
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
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

export function VariablesTab({ config, setConfig: rawSetConfig, readOnly, operatingWindowReadOnly, holidayCompModeReadOnly }: Props) {
  const { t } = useI18n();
  // v5.1.3 — operating window has its own write-gate (manager + supervisor
  // own operational hours). When the prop is omitted, fall back to
  // `readOnly` so callers from before v5.1.3 don't accidentally widen
  // editing rights.
  const opsReadOnly = operatingWindowReadOnly ?? readOnly;
  // v5.5.0 — holidayCompMode is also OPERATIONAL config (not governance):
  // the manager decides whether holiday work is comp-day, 2× cash, or both.
  // Falls back to `readOnly` when the prop isn't supplied so legacy callers
  // don't accidentally widen access.
  const compModeReadOnly = holidayCompModeReadOnly ?? readOnly;
  // Governance setter: swallowed when `readOnly` so cap / pay / hazardous /
  // driver controls that don't honour `disabled` are no-ops at the data
  // layer. The operating-window section uses the raw setter (gated by
  // `opsReadOnly` on each control instead).
  const setConfig: typeof rawSetConfig = readOnly ? (() => undefined) : rawSetConfig;
  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight mb-1">{t('variables.title')}</h3>
        <p className="text-xs text-slate-400 font-medium uppercase tracking-widest font-mono">
          {t('variables.subtitle')}
        </p>
      </div>

      {readOnly && (
        <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-amber-900 uppercase tracking-widest">Governance — Read-only</p>
            <p className="text-[11px] text-amber-800 leading-relaxed mt-1">
              {opsReadOnly
                ? 'Iraqi Labor Law thresholds and operating-window hours can only be edited by the super-admin. You can review the configured values here.'
                : 'Iraqi Labor Law thresholds can only be edited by the super-admin. The operating-window section below is editable — manager and supervisor own day-to-day operational hours.'}
            </p>
          </div>
        </div>
      )}

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
        readOnly={readOnly}
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
        readOnly={readOnly}
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
        readOnly={readOnly}
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
        readOnly={readOnly}
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
            onChange={v => rawSetConfig(prev => ({ ...prev, shopOpeningTime: v }))}
            disabled={opsReadOnly}
          />
          <SettingField
            label={t('variables.operatingWindow.defaultClose')}
            type="time"
            value={config.shopClosingTime}
            onChange={v => rawSetConfig(prev => ({ ...prev, shopClosingTime: v }))}
            disabled={opsReadOnly}
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
                rawSetConfig(prev => {
                  const map = { ...(prev.operatingHoursByDayOfWeek || {}) };
                  if (next) map[dow] = next;
                  else delete map[dow];
                  return { ...prev, operatingHoursByDayOfWeek: map };
                });
              };
              return (
                <div key={dow} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${enabled ? 'border-purple-200 bg-purple-50/40' : 'border-slate-200 bg-white'}`}>
                  <Switch
                    checked={enabled}
                    onChange={v => {
                      if (v) setOverride({ open, close });
                      else setOverride(undefined);
                    }}
                    tone="indigo"
                    size="sm"
                    disabled={opsReadOnly}
                    aria-label={`Override hours for ${t(DOW_KEY[dow])}`}
                  />
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-widest min-w-[80px]">{t(DOW_KEY[dow])}</span>
                  <input
                    type="time"
                    value={open}
                    disabled={!enabled || opsReadOnly}
                    onChange={e => setOverride({ open: e.target.value, close })}
                    className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded text-xs font-mono disabled:opacity-40"
                  />
                  <span className="text-[10px] text-slate-400 font-bold">→</span>
                  <input
                    type="time"
                    value={close}
                    disabled={!enabled || opsReadOnly}
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
            <Switch
              id="enforce-art86"
              checked={!!config.enforceArt86NightWork}
              onChange={v => setConfig(prev => ({ ...prev, enforceArt86NightWork: v }))}
              tone="rose"
              disabled={readOnly}
              aria-labelledby="enforce-art86-label"
            />
            <label htmlFor="enforce-art86" id="enforce-art86-label" className="text-[11px] font-bold text-slate-700 uppercase tracking-widest cursor-pointer">{t('variables.art86.enable')}</label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SettingField
              label={t('variables.art86.start')}
              type="time"
              value={config.art86NightStart || '22:00'}
              onChange={v => setConfig(prev => ({ ...prev, art86NightStart: v }))}
              disabled={readOnly}
            />
            <SettingField
              label={t('variables.art86.end')}
              type="time"
              value={config.art86NightEnd || '07:00'}
              onChange={v => setConfig(prev => ({ ...prev, art86NightEnd: v }))}
              disabled={readOnly}
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
            disabled={readOnly}
          />
          <SettingField
            label={t('variables.ramadan.end')}
            value={config.ramadanEnd ?? ''}
            onChange={v => setConfig(prev => ({ ...prev, ramadanEnd: v }))}
            disabled={readOnly}
          />
          <SettingField
            label={t('variables.ramadan.dailyCap')}
            type="number"
            value={config.ramadanDailyHrsCap ?? 6}
            onChange={v => {
              const n = parseFloat(v);
              setConfig(prev => ({ ...prev, ramadanDailyHrsCap: Number.isFinite(n) ? n : 6 }));
            }}
            disabled={readOnly}
          />
        </div>
        <div className="p-5 pt-0 text-[11px] text-slate-500 leading-relaxed">
          {t('variables.ramadan.note')}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-50 text-emerald-700 rounded-xl flex items-center justify-center">
            <Gift className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slate-800 text-sm tracking-tight">{t('variables.art74.title')}</h3>
            <p className="text-[10px] text-slate-500 font-medium">{t('variables.art74.subtitle')}</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          {/* v5.1.7 — three-way mode selector. The third "Both" tile is
              the strict-text reading: comp day + premium together. We
              keep the two existing tiles' colour scheme (emerald = thrift
              practitioner reading, amber = cash-only) and add purple for
              the strict-compliance "both" path so super-admins can spot
              the cost tier at a glance. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              type="button"
              disabled={compModeReadOnly}
              onClick={() => compModeReadOnly ? null : rawSetConfig(prev => ({ ...prev, holidayCompMode: 'comp-day' }))}
              className={`p-4 rounded-xl border-2 text-start transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                (config.holidayCompMode ?? 'comp-day') === 'comp-day'
                  ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-emerald-800">{t('variables.art74.compDay.title')}</p>
              <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">{t('variables.art74.compDay.body')}</p>
            </button>
            <button
              type="button"
              disabled={compModeReadOnly}
              onClick={() => compModeReadOnly ? null : rawSetConfig(prev => ({ ...prev, holidayCompMode: 'cash-ot' }))}
              className={`p-4 rounded-xl border-2 text-start transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                config.holidayCompMode === 'cash-ot'
                  ? 'border-amber-500 bg-amber-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-amber-800">{t('variables.art74.cashOt.title')}</p>
              <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">{t('variables.art74.cashOt.body')}</p>
            </button>
            <button
              type="button"
              disabled={compModeReadOnly}
              onClick={() => compModeReadOnly ? null : rawSetConfig(prev => ({ ...prev, holidayCompMode: 'both' }))}
              className={`p-4 rounded-xl border-2 text-start transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                config.holidayCompMode === 'both'
                  ? 'border-purple-500 bg-purple-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-purple-800">{t('variables.art74.both.title')}</p>
              <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">{t('variables.art74.both.body')}</p>
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SettingField
              label={t('variables.art74.recommended')}
              type="number"
              value={config.holidayCompRecommendedDays ?? 7}
              onChange={v => {
                const n = parseInt(v, 10);
                setConfig(prev => ({ ...prev, holidayCompRecommendedDays: Number.isFinite(n) && n > 0 ? n : 7 }));
              }}
              disabled={readOnly}
            />
            <SettingField
              label={t('variables.art74.window')}
              type="number"
              value={config.holidayCompWindowDays ?? 30}
              onChange={v => {
                const n = parseInt(v, 10);
                setConfig(prev => ({ ...prev, holidayCompWindowDays: Number.isFinite(n) && n > 0 ? n : 30 }));
              }}
              disabled={readOnly}
            />
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">{t('variables.art74.note')}</p>
        </div>
      </div>

      {/* v5.17.0 — Fine rates per rule (IQD per occurrence). Drives the
          staffing advisory's "fines avoided" / "current potential
          fines" estimates. Defaults are mid-range placeholders aligned
          with the Iraqi Labor Law 37/2015 penalty framework — supervisor
          should refine with their labor counsel for the amounts that
          apply to their establishment. Governance gate: same readOnly
          treatment as the rest of the legal-variables section. */}
      <FineRatesSection config={config} setConfig={setConfig} readOnly={readOnly} />

      <div className="border-t border-slate-100 pt-6 text-[11px] text-slate-400 leading-relaxed">
        <p className="font-bold uppercase tracking-widest text-[10px] text-slate-500 mb-2">{t('variables.references.title')}</p>
        <p>{t('variables.references.body')}</p>
      </div>
    </div>
  );
}

// v5.17.0 — Fine rates section. Each row exposes one rule's IQD-per-
// occurrence amount (read from Config.fineRates with fallback to the
// DEFAULT_FINE_RATES seeds). Entire section gated by the same readOnly
// flag as the cap settings — this is governance config, not operational.
function FineRatesSection({ config, setConfig, readOnly }: {
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  // Display order matches operational severity (overwork rules first,
  // then leave-day work, then Art. 86 women's industrial night work).
  const RULE_ORDER: string[] = [
    RULE_KEYS.DAILY_HOURS_CAP,
    RULE_KEYS.WEEKLY_HOURS_CAP,
    RULE_KEYS.MIN_REST_BETWEEN_SHIFTS,
    RULE_KEYS.CONSECUTIVE_WORK_DAYS,
    RULE_KEYS.WEEKLY_REST_DAY,
    RULE_KEYS.CONTINUOUS_DRIVING_NO_BREAK,
    RULE_KEYS.WORKED_DURING_ANNUAL_LEAVE,
    RULE_KEYS.WORKED_DURING_SICK_LEAVE,
    RULE_KEYS.WORKED_DURING_MATERNITY,
    RULE_KEYS.WOMENS_NIGHT_WORK_INDUSTRIAL,
  ];
  const updateRate = (ruleKey: string, value: number) => {
    setConfig(prev => ({
      ...prev,
      fineRates: { ...(prev.fineRates ?? {}), [ruleKey]: Math.max(0, Math.round(value)) },
    }));
  };
  const resetToDefault = (ruleKey: string) => {
    setConfig(prev => {
      const next = { ...(prev.fineRates ?? {}) };
      delete next[ruleKey]; // delete the override → falls back to DEFAULT_FINE_RATES
      return { ...prev, fineRates: next };
    });
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="p-5 border-b border-slate-100 flex items-center gap-4">
        <div className="w-10 h-10 bg-rose-50 text-rose-700 rounded-xl flex items-center justify-center">
          <Scale className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-slate-800 text-sm tracking-tight">{t('variables.fines.title')}</h3>
          <p className="text-[10px] text-slate-500 font-medium">{t('variables.fines.subtitle')}</p>
        </div>
      </div>
      <div className="p-4 bg-amber-50/60 border-b border-amber-100">
        <p className="text-[11px] text-amber-900 leading-relaxed">
          <span className="font-bold uppercase tracking-widest">{t('variables.fines.disclaimer.label')}</span>
          {' — '}
          {t('variables.fines.disclaimer.body')}
        </p>
      </div>
      <div className="divide-y divide-slate-50">
        {RULE_ORDER.map(ruleKey => {
          const labelKey = RULE_LABEL_I18N_KEYS[ruleKey];
          const article = RULE_ARTICLES[ruleKey] ?? '';
          const seedDefault = DEFAULT_FINE_RATES[ruleKey] ?? 0;
          const current = getEffectiveFineRate(ruleKey, config);
          const isOverridden = typeof config.fineRates?.[ruleKey] === 'number'
            && config.fineRates[ruleKey] !== seedDefault;
          return (
            <div key={ruleKey} className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <div className="md:col-span-2 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-slate-800 text-sm">{labelKey ? t(labelKey) : ruleKey}</p>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest border border-slate-200 font-mono">
                    {article}
                  </span>
                  {isOverridden && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[9px] font-black uppercase tracking-widest border border-blue-200">
                      {t('variables.fines.overridden')}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {t('variables.fines.row.help', { defaultAmount: seedDefault.toLocaleString() })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={50000}
                  min={0}
                  value={current}
                  disabled={readOnly}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    updateRate(ruleKey, Number.isFinite(v) ? v : seedDefault);
                  }}
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[60px]">{t('variables.fines.unit')}</span>
                {isOverridden && !readOnly && (
                  <button
                    type="button"
                    onClick={() => resetToDefault(ruleKey)}
                    title={t('variables.fines.reset.tooltip')}
                    className="text-[9px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-800 underline"
                  >
                    {t('variables.fines.reset')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
