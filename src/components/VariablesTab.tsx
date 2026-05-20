import React, { useState } from 'react';
import { ShieldCheck, Truck, Flame, Calendar, Clock, AlertCircle, Moon, Users, Gift, Scale, ChevronDown, ChevronRight, Lock, ShieldAlert, Sparkles, Settings2 } from 'lucide-react';
import { Config, DayOfWeek, Employee } from '../types';
import { SettingField } from './Primitives';
import { Switch } from './ui/Switch';
import { useI18n } from '../lib/i18n';
import { RULE_KEYS, DEFAULT_FINE_RATES, RULE_ARTICLES, RULE_LABEL_I18N_KEYS, getEffectiveFineRate } from '../lib/fines';
import {
  COVERAGE_PRESETS, applyCoveragePreset, detectCoveragePreset, isCoverageCustomized,
  type CoveragePresetId,
} from '../lib/coveragePresets';

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
  // v5.22.0 — roster lookup so the tab can hide sections that aren't
  // relevant to this venue (driver caps when no drivers exist; hazardous
  // caps when no hazardous-flagged employees). Optional + default to
  // empty so test fixtures and legacy callers keep working.
  employees?: Employee[];
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

// v5.22.0 — Lightweight collapsible card wrapper so sections that aren't
// relevant to the venue (no drivers? no hazardous staff? Art. 86 toggle
// off?) collapse by default but stay one click away. Uses local state so
// each section's open/closed independently.
interface CollapsibleCardProps {
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconText: string;
  defaultOpen?: boolean;
  // Small badge text rendered next to the title — used to surface state
  // ("Disabled", "Off", "Customized") without forcing the user to expand.
  badge?: string;
  badgeTone?: 'slate' | 'amber' | 'emerald' | 'blue';
  children: React.ReactNode;
}

function CollapsibleCard({ title, subtitle, icon: Icon, iconBg, iconText, defaultOpen = true, badge, badgeTone = 'slate', children }: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const badgeClass = ({
    slate: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700/60 dark:text-slate-300 dark:border-slate-600',
    amber: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30',
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30',
    blue: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-500/30',
  } as const)[badgeTone];
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/70 rounded-xl overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full p-5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/60 transition-colors text-start"
      >
        <div className={`w-10 h-10 ${iconBg} ${iconText} rounded-xl flex items-center justify-center shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm tracking-tight">{title}</h3>
            {badge && (
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${badgeClass}`}>
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">{subtitle}</p>}
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />}
      </button>
      {open && children}
    </div>
  );
}

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
  // v5.22.0 — defaultOpen lets the wrapper auto-collapse sections that
  // aren't relevant to this venue (driver caps without drivers, etc.).
  defaultOpen?: boolean;
  // v5.22.0 — small status badge next to the title (e.g. "No drivers
  // configured" so the user understands why it's collapsed).
  badge?: string;
  badgeTone?: 'slate' | 'amber' | 'emerald' | 'blue';
}

function Section({ title, subtitle, icon, iconBg, iconText, caps, config, setConfig, readOnly, defaultOpen = true, badge, badgeTone }: SectionProps) {
  const { t } = useI18n();
  return (
    <CollapsibleCard
      title={title}
      subtitle={subtitle}
      icon={icon}
      iconBg={iconBg}
      iconText={iconText}
      defaultOpen={defaultOpen}
      badge={badge}
      badgeTone={badgeTone}
    >
      <div className="divide-y divide-slate-50 dark:divide-slate-800">
        {caps.map(cap => {
          const current = (config[cap.key] as number | undefined) ?? cap.defaultValue;
          return (
            <div key={String(cap.key)} className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <div className="md:col-span-2 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">{t(cap.labelKey)}</p>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[9px] font-black uppercase tracking-widest border border-slate-200 dark:border-slate-600 font-mono">
                    {cap.article}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t(cap.descKey)}</p>
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
                  className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-800 dark:text-slate-100 text-end focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest min-w-[60px]">{t(cap.unitKey)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}

export function VariablesTab({ config, setConfig: rawSetConfig, readOnly, operatingWindowReadOnly, holidayCompModeReadOnly, employees = [] }: Props) {
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

  // v5.22.0 — relevance flags drive the auto-collapse behaviour. A venue
  // with zero drivers doesn't need to see a 5-row Driver Caps section
  // by default; the section stays one click away if the user does need
  // to inspect it. Same for hazardous staff.
  const hasDrivers = employees.some(e => e.category === 'Driver');
  const hasHazardousStaff = employees.some(e => e.isHazardous);
  const ramadanConfigured = !!(config.ramadanStart && config.ramadanEnd);
  const art86Enabled = !!config.enforceArt86NightWork;

  // v5.22.0 — toggle between the everyday "Operational" view and the
  // legally-grounded "Statutory" view (Iraqi Labor Law caps, pay rates,
  // fines). Most managers spend 100% of their time in the operational
  // panel; the statutory panel is for super-admin / labor-counsel review.
  const [showStatutory, setShowStatutory] = useState(false);

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight mb-1">{t('variables.title')}</h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium uppercase tracking-widest font-mono">
          {t('variables.subtitle')}
        </p>
      </div>

      {/* v5.22.0 — view switcher. Two pill buttons (Operational / Statutory)
          replace the old "everything inline" layout. Operational is the
          default landing because the manager edits operational hours,
          coverage, holiday compensation; super-admin reviews the
          statutory panel infrequently. */}
      <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setShowStatutory(false)}
          className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
            !showStatutory
              ? 'bg-white dark:bg-slate-900 shadow-sm text-slate-800 dark:text-slate-100'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Settings2 className="w-3.5 h-3.5" />
          {t('variables.view.operational')}
        </button>
        <button
          type="button"
          onClick={() => setShowStatutory(true)}
          className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
            showStatutory
              ? 'bg-white dark:bg-slate-900 shadow-sm text-slate-800 dark:text-slate-100'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          {t('variables.view.statutory')}
        </button>
      </div>

      {readOnly && (
        <div className="p-4 bg-amber-50/60 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-widest">{t('variables.governance.readOnly.title')}</p>
            <p className="text-[11px] text-amber-800 dark:text-amber-300/90 leading-relaxed mt-1">
              {opsReadOnly
                ? t('variables.governance.readOnly.bothLocked')
                : t('variables.governance.readOnly.statutoryLocked')}
            </p>
          </div>
        </div>
      )}

      {showStatutory ? (
        <>
          <div className="p-4 bg-blue-50/60 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/30 rounded-xl flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-blue-600 dark:text-blue-300 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-bold text-blue-800 dark:text-blue-200">{t('variables.statutory.banner.title')}</p>
              <p className="text-[11px] text-blue-700 dark:text-blue-300/90 leading-relaxed mt-1">{t('variables.statutory.banner.body')}</p>
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
            defaultOpen
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
            defaultOpen={hasHazardousStaff}
            badge={hasHazardousStaff ? undefined : t('variables.section.notApplicable')}
            badgeTone="slate"
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
            defaultOpen={hasDrivers}
            badge={hasDrivers ? undefined : t('variables.section.notApplicable')}
            badgeTone="slate"
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
            defaultOpen
          />

          {/* v5.22.0 — fine rates are statutory-context but the 10 rows
              are a power-user surface. Defaults are already grounded in
              Law 37/2015 so we collapse by default and surface a one-line
              summary. */}
          <FineRatesSection config={config} setConfig={setConfig} readOnly={readOnly} />

          <div className="border-t border-slate-100 dark:border-slate-800 pt-6 text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
            <p className="font-bold uppercase tracking-widest text-[10px] text-slate-500 dark:text-slate-400 mb-2">{t('variables.references.title')}</p>
            <p>{t('variables.references.body')}</p>
          </div>
        </>
      ) : (
        <>
          <div className="p-4 bg-blue-50/60 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/30 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-300 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-bold text-blue-800 dark:text-blue-200">{t('variables.editingNote.title')}</p>
              <p className="text-[11px] text-blue-700 dark:text-blue-300/90 leading-relaxed mt-1">
                {t('variables.editingNote.body')}
              </p>
            </div>
          </div>

          {/* v5.22.0 — operational view: how the venue actually runs.
              Order chosen by frequency-of-edit: hours → coverage realism
              → holiday compensation → ramadan → art.86 → hiring lead time. */}
          <CollapsibleCard
            title={t('variables.operatingWindow')}
            subtitle={t('variables.operatingWindow.note')}
            icon={Clock}
            iconBg="bg-purple-50"
            iconText="text-purple-700"
            defaultOpen
          >
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
            <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t('variables.operatingWindow.perDayHeader')}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t('variables.operatingWindow.perDayNote')}</p>
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
                  <div
                    key={dow}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                      enabled
                        ? 'border-purple-200 bg-purple-50/40 dark:border-purple-500/40 dark:bg-purple-500/10'
                        : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60'
                    }`}
                  >
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
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-widest min-w-[80px]">{t(DOW_KEY[dow])}</span>
                    <input
                      type="time"
                      value={open}
                      disabled={!enabled || opsReadOnly}
                      onChange={e => setOverride({ open: e.target.value, close })}
                      className="flex-1 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono text-slate-800 dark:text-slate-100 disabled:opacity-40"
                    />
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">→</span>
                    <input
                      type="time"
                      value={close}
                      disabled={!enabled || opsReadOnly}
                      onChange={e => setOverride({ open, close: e.target.value })}
                      className="flex-1 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono text-slate-800 dark:text-slate-100 disabled:opacity-40"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </CollapsibleCard>

        {/* v5.22.0 — Coverage realism preset. Replaces the raw
            coverageMode + 5 downtime rates + peakSafetyFactor surface
            with three named presets. Power users can still tweak the
            individual rates via the Customize disclosure. */}
        <CoverageRealismSection config={config} setConfig={rawSetConfig} readOnly={readOnly} />

        <CollapsibleCard
          title={t('variables.art74.title')}
          subtitle={t('variables.art74.subtitle')}
          icon={Gift}
          iconBg="bg-emerald-50"
          iconText="text-emerald-700"
          defaultOpen
        >
          <div className="p-5 space-y-4">
            {/* v5.1.7 — three-way mode selector. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                type="button"
                disabled={compModeReadOnly}
                onClick={() => compModeReadOnly ? null : rawSetConfig(prev => ({ ...prev, holidayCompMode: 'comp-day' }))}
                className={`p-4 rounded-xl border-2 text-start transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                  (config.holidayCompMode ?? 'comp-day') === 'comp-day'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 shadow-sm'
                    : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <p className="text-[11px] font-black uppercase tracking-widest text-emerald-800 dark:text-emerald-300">{t('variables.art74.compDay.title')}</p>
                <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{t('variables.art74.compDay.body')}</p>
              </button>
              <button
                type="button"
                disabled={compModeReadOnly}
                onClick={() => compModeReadOnly ? null : rawSetConfig(prev => ({ ...prev, holidayCompMode: 'cash-ot' }))}
                className={`p-4 rounded-xl border-2 text-start transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                  config.holidayCompMode === 'cash-ot'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10 shadow-sm'
                    : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <p className="text-[11px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-300">{t('variables.art74.cashOt.title')}</p>
                <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{t('variables.art74.cashOt.body')}</p>
              </button>
              <button
                type="button"
                disabled={compModeReadOnly}
                onClick={() => compModeReadOnly ? null : rawSetConfig(prev => ({ ...prev, holidayCompMode: 'both' }))}
                className={`p-4 rounded-xl border-2 text-start transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                  config.holidayCompMode === 'both'
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-500/10 shadow-sm'
                    : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <p className="text-[11px] font-black uppercase tracking-widest text-purple-800 dark:text-purple-300">{t('variables.art74.both.title')}</p>
                <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{t('variables.art74.both.body')}</p>
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
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t('variables.art74.note')}</p>
          </div>
        </CollapsibleCard>

        {/* v5.22.0 — Ramadan auto-collapses when no dates are set
            (the rule is dormant) and surfaces an "Off" badge so the
            user can see at a glance it's not contributing. */}
        <CollapsibleCard
          title={t('variables.ramadan.title')}
          subtitle={t('variables.ramadan.subtitle')}
          icon={Moon}
          iconBg="bg-amber-50"
          iconText="text-amber-700"
          defaultOpen={ramadanConfigured}
          badge={ramadanConfigured ? undefined : t('variables.section.off')}
          badgeTone="slate"
        >
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
          <div className="p-5 pt-0 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('variables.ramadan.note')}
          </div>
        </CollapsibleCard>

        {/* v5.22.0 — Art. 86 women's industrial night work auto-collapses
            when the toggle is off so super-admins don't see 4 disabled
            controls; the section badge says "Disabled" with an Enable
            shortcut visible the moment it's expanded. */}
        <CollapsibleCard
          title={t('variables.art86.title')}
          subtitle={t('variables.art86.subtitle')}
          icon={Users}
          iconBg="bg-rose-50"
          iconText="text-rose-700"
          defaultOpen={art86Enabled}
          badge={art86Enabled ? undefined : t('variables.section.off')}
          badgeTone="slate"
        >
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
              <label htmlFor="enforce-art86" id="enforce-art86-label" className="text-[11px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-widest cursor-pointer">{t('variables.art86.enable')}</label>
            </div>
            {art86Enabled && (
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
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t('variables.art86.note')}</p>
          </div>
        </CollapsibleCard>

        {/* v5.18.0 — hiring lead time. */}
        <CollapsibleCard
          title={t('variables.hiringLead.title')}
          subtitle={t('variables.hiringLead.body')}
          icon={Sparkles}
          iconBg="bg-blue-50"
          iconText="text-blue-700"
          defaultOpen={false}
        >
          <div className="p-5">
            <div className="max-w-xs">
              <SettingField
                label={t('variables.hiringLead.label')}
                type="number"
                min={0}
                max={52}
                step={1}
                value={config.hiringLeadTimeWeeks ?? 0}
                onChange={v => {
                  const n = parseInt(v, 10);
                  setConfig(prev => ({ ...prev, hiringLeadTimeWeeks: Number.isFinite(n) && n >= 0 ? Math.min(52, n) : 0 }));
                }}
                disabled={readOnly}
              />
            </div>
          </div>
        </CollapsibleCard>
        </>
      )}
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
  // v5.22.0 — count any user overrides so the collapsed-default state
  // can surface a "N customized" badge. If nothing's been touched, the
  // section reads as "Defaults from Law 37/2015" and stays out of the way.
  const overrideCount = RULE_ORDER.reduce((n, ruleKey) => {
    const seed = DEFAULT_FINE_RATES[ruleKey] ?? 0;
    const v = config.fineRates?.[ruleKey];
    return typeof v === 'number' && v !== seed ? n + 1 : n;
  }, 0);
  return (
    <CollapsibleCard
      title={t('variables.fines.title')}
      subtitle={overrideCount > 0
        ? t('variables.fines.subtitle.customized', { count: overrideCount })
        : t('variables.fines.subtitle.defaults')}
      icon={Scale}
      iconBg="bg-rose-50"
      iconText="text-rose-700"
      defaultOpen={false}
      badge={overrideCount > 0 ? t('variables.fines.badge.customized', { count: overrideCount }) : undefined}
      badgeTone="blue"
    >
      <div className="p-4 bg-amber-50/60 dark:bg-amber-500/10 border-b border-amber-100 dark:border-amber-500/30">
        <p className="text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
          <span className="font-bold uppercase tracking-widest">{t('variables.fines.disclaimer.label')}</span>
          {' — '}
          {t('variables.fines.disclaimer.body')}
        </p>
      </div>
      <div className="divide-y divide-slate-50 dark:divide-slate-800">
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
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">{labelKey ? t(labelKey) : ruleKey}</p>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[9px] font-black uppercase tracking-widest border border-slate-200 dark:border-slate-600 font-mono">
                    {article}
                  </span>
                  {isOverridden && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-200 text-[9px] font-black uppercase tracking-widest border border-blue-200 dark:border-blue-500/30">
                      {t('variables.fines.overridden')}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
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
                  className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-800 dark:text-slate-100 text-end focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest min-w-[60px]">{t('variables.fines.unit')}</span>
                {isOverridden && !readOnly && (
                  <button
                    type="button"
                    onClick={() => resetToDefault(ruleKey)}
                    title={t('variables.fines.reset.tooltip')}
                    className="text-[9px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline"
                  >
                    {t('variables.fines.reset')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}

// v5.22.0 — Coverage realism preset section. Replaces the raw
// coverageMode + 5 downtime rates + peakSafetyFactor surface with
// three named presets (Bare hours / Realistic / Safety-critical) and
// a Customize disclosure that exposes the underlying numbers for
// power users / labor-counsel reviews. Default-collapsed when the
// venue is on the simple/bare preset (no buffer applied) so legacy
// users don't see new chrome they don't need.
function CoverageRealismSection({ config, setConfig, readOnly }: {
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const [showCustomize, setShowCustomize] = useState(false);
  const activePreset = detectCoveragePreset(config);
  const customized = isCoverageCustomized(config);

  const setPreset = (id: CoveragePresetId) => {
    if (readOnly) return;
    const patch = applyCoveragePreset(id);
    setConfig(prev => ({ ...prev, ...patch }));
  };

  // The badge gives a one-glance read of the active state without
  // expanding: which preset is in use, plus a "Customized" tag when
  // the rates have been hand-edited away from the preset defaults.
  const presetBadge: string = customized
    ? t('variables.coverage.badge.customized')
    : t(COVERAGE_PRESETS.find(p => p.id === activePreset)?.titleKey ?? '');

  return (
    <CollapsibleCard
      title={t('variables.coverage.title')}
      subtitle={t('variables.coverage.subtitle')}
      icon={ShieldCheck}
      iconBg="bg-emerald-50"
      iconText="text-emerald-700"
      defaultOpen={activePreset !== 'bare'}
      badge={presetBadge}
      badgeTone={customized ? 'blue' : 'emerald'}
    >
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {COVERAGE_PRESETS.map(p => {
            const active = activePreset === p.id;
            const tone = ({
              slate: { border: 'border-slate-500 dark:border-slate-400', bg: 'bg-slate-50 dark:bg-slate-800/80', text: 'text-slate-800 dark:text-slate-200' },
              emerald: { border: 'border-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-800 dark:text-emerald-300' },
              purple: { border: 'border-purple-500', bg: 'bg-purple-50 dark:bg-purple-500/10', text: 'text-purple-800 dark:text-purple-300' },
            } as const)[p.tone];
            return (
              <button
                key={p.id}
                type="button"
                disabled={readOnly}
                onClick={() => setPreset(p.id)}
                className={`p-4 rounded-xl border-2 text-start transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                  active
                    ? `${tone.border} ${tone.bg} shadow-sm`
                    : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <p className={`text-[11px] font-black uppercase tracking-widest ${tone.text}`}>{t(p.titleKey)}</p>
                <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{t(p.descKey)}</p>
              </button>
            );
          })}
        </div>

        {/* Customize disclosure — hides the raw rate fields by default
            so the supervisor isn't intimidated by 5 percentages. The
            disclosure is only meaningful in 'realistic' or 'safety-
            critical' modes; in 'bare' the rates aren't applied. */}
        {activePreset !== 'bare' && (
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => setShowCustomize(s => !s)}
              className="text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 uppercase tracking-widest flex items-center gap-1"
            >
              {showCustomize ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {showCustomize ? t('variables.coverage.customize.hide') : t('variables.coverage.customize.show')}
            </button>
            {showCustomize && (
              <div className="mt-4 space-y-3">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t('variables.coverage.customize.note')}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {([
                    { key: 'annualLeaveRate', labelKey: 'variables.coverage.dt.annualLeave', defaultValue: 21 / 365 },
                    { key: 'sickRate', labelKey: 'variables.coverage.dt.sick', defaultValue: 11 / 365 },
                    { key: 'publicHolidayRate', labelKey: 'variables.coverage.dt.publicHoliday', defaultValue: 13 / 365 },
                    { key: 'restDayGapRate', labelKey: 'variables.coverage.dt.restDayGap', defaultValue: 1 / 7 },
                  ] as const).map(field => {
                    const dt = config.downtimeAssumptions ?? {
                      annualLeaveRate: 21 / 365, sickRate: 11 / 365, publicHolidayRate: 13 / 365,
                      restDayGapRate: 1 / 7, operatesOnHolidays: true,
                    };
                    const pct = ((dt[field.key] as number) * 100).toFixed(1);
                    return (
                      <div key={field.key} className="flex items-center gap-2">
                        <label className="text-[11px] text-slate-700 dark:text-slate-200 flex-1">{t(field.labelKey)}</label>
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          max={50}
                          value={pct}
                          disabled={readOnly}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            const next = Number.isFinite(v) ? Math.max(0, Math.min(50, v)) / 100 : field.defaultValue;
                            setConfig(prev => ({
                              ...prev,
                              downtimeAssumptions: {
                                ...(prev.downtimeAssumptions ?? dt),
                                [field.key]: next,
                              },
                            }));
                          }}
                          className="w-20 px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono text-slate-800 dark:text-slate-100 text-end focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:opacity-60"
                        />
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">%</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <Switch
                    id="coverage-operates-on-holidays"
                    checked={!!config.downtimeAssumptions?.operatesOnHolidays}
                    onChange={v => setConfig(prev => ({
                      ...prev,
                      downtimeAssumptions: {
                        ...(prev.downtimeAssumptions ?? {
                          annualLeaveRate: 21 / 365, sickRate: 11 / 365, publicHolidayRate: 13 / 365,
                          restDayGapRate: 1 / 7, operatesOnHolidays: true,
                        }),
                        operatesOnHolidays: v,
                      },
                    }))}
                    tone="emerald"
                    size="sm"
                    disabled={readOnly}
                    aria-labelledby="coverage-operates-on-holidays-label"
                  />
                  <label htmlFor="coverage-operates-on-holidays" id="coverage-operates-on-holidays-label" className="text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer">
                    {t('variables.coverage.dt.operatesOnHolidays')}
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}
