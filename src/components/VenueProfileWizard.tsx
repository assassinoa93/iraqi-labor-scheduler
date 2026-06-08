/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.22.0 — Venue Profile Wizard. Fires on first launch (when
 * `config.venueProfileCompleted === false` and the company has no
 * stations or employees yet) so the supervisor pre-fills the most
 * commonly-edited config fields in 5 questions, instead of walking
 * Variables → Settings → trial-and-error.
 *
 * Questions:
 *   1. Operating window (default open / close hours)
 *   2. Peak days (multiselect of weekdays)
 *   3. Operates on public holidays? (yes/no)
 *   4. Coverage strategy preset (Bare hours / Realistic / Safety-critical)
 *   5. Holiday compensation policy (Comp day / Cash 2× / Both)
 *
 * Skip is allowed at every step; skipping marks the wizard "completed"
 * with whatever defaults DEFAULT_CONFIG provided. The user can re-run
 * the wizard from the Variables tab if they change their mind.
 */

import React, { useState } from 'react';
import { Sparkles, Calendar, Clock, Gift, ShieldCheck, ChevronRight, ChevronLeft, X, Check } from 'lucide-react';
import { Config, HolidayCompMode } from '../types';
import { Switch } from './ui/Switch';
import { useI18n } from '../lib/i18n';
import { applyCoveragePreset, type CoveragePresetId } from '../lib/coveragePresets';
import { useModalKeys } from '../lib/hooks';

interface Props {
  isOpen: boolean;
  // Atomically merge the wizard's collected answers into Config and
  // mark the wizard complete. App.tsx handles the actual setConfig
  // call so the change shows up in both Offline and Online (Firestore)
  // modes consistently.
  onComplete: (patch: Partial<Config>) => void;
  // Called when the user clicks Skip. Marks venueProfileCompleted=true
  // (without touching other fields) so the wizard doesn't re-fire.
  onSkip: () => void;
  // Current config — used to seed the wizard with whatever defaults the
  // user already had so they're not starting from zero.
  config: Config;
}

const DOW_KEYS: Array<{ id: number; key: string }> = [
  { id: 1, key: 'common.day.sunday' },
  { id: 2, key: 'common.day.monday' },
  { id: 3, key: 'common.day.tuesday' },
  { id: 4, key: 'common.day.wednesday' },
  { id: 5, key: 'common.day.thursday' },
  { id: 6, key: 'common.day.friday' },
  { id: 7, key: 'common.day.saturday' },
];

export function VenueProfileWizard({ isOpen, onComplete, onSkip, config }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  // Local copy of the answers — atomically merged into Config on Finish
  // so a partially-filled wizard doesn't leak into the live config
  // until the user commits.
  const [openTime, setOpenTime] = useState(config.shopOpeningTime || '11:00');
  const [closeTime, setCloseTime] = useState(config.shopClosingTime || '23:00');
  const [peakDays, setPeakDays] = useState<number[]>(config.peakDays || [5, 6, 7]);
  const [operatesOnHolidays, setOperatesOnHolidays] = useState<boolean>(
    config.downtimeAssumptions?.operatesOnHolidays ?? true,
  );
  const [coveragePreset, setCoveragePreset] = useState<CoveragePresetId>('realistic');
  const [holidayCompMode, setHolidayCompMode] = useState<HolidayCompMode>(config.holidayCompMode ?? 'comp-day');

  const closeButtonRef = useModalKeys(isOpen, onSkip) as React.RefObject<HTMLButtonElement>;
  if (!isOpen) return null;

  const togglePeakDay = (id: number) => {
    setPeakDays(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id].sort());
  };

  const finish = () => {
    const coveragePatch = applyCoveragePreset(coveragePreset);
    const patch: Partial<Config> = {
      ...coveragePatch,
      shopOpeningTime: openTime,
      shopClosingTime: closeTime,
      peakDays,
      holidayCompMode,
      venueProfileCompleted: true,
    };
    // v5.35 — always persist the Q3 "operates on public holidays?" answer,
    // regardless of the coverage preset. Pre-v5.35 the answer was only written
    // when the preset was 'realistic' (the only preset that ships a
    // downtimeAssumptions block); picking the 'bare' preset (simple mode, no
    // downtime block) silently DROPPED the user's Q3 answer. Merge it onto
    // whichever downtime breakdown the preset or the existing config provides
    // — or a default block — so the answer survives and is correct when the
    // user later switches coverage to realistic.
    const baseDowntime = coveragePatch.downtimeAssumptions ?? config.downtimeAssumptions;
    patch.downtimeAssumptions = baseDowntime
      ? { ...baseDowntime, operatesOnHolidays }
      : { annualLeaveRate: 21 / 365, sickRate: 11 / 365, publicHolidayRate: 13 / 365, restDayGapRate: 1 / 7, operatesOnHolidays };
    onComplete(patch);
  };

  const TOTAL_STEPS = 5;
  const next = () => setStep(s => Math.min(TOTAL_STEPS - 1, s + 1));
  const back = () => setStep(s => Math.max(0, s - 1));
  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('wizard.venueProfile.title')}
    >
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 dark:border-slate-700/60 bg-gradient-to-r from-emerald-50 via-white to-white dark:from-emerald-500/15 dark:via-slate-900 dark:to-slate-900 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-600 shadow-lg shadow-emerald-200 dark:shadow-emerald-500/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate">{t('wizard.venueProfile.title')}</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-widest mt-0.5">
                {t('wizard.venueProfile.subtitle', { step: step + 1, total: TOTAL_STEPS })}
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onSkip}
            aria-label={t('wizard.venueProfile.skip')}
            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
          />
        </div>

        {/* Body */}
        <div className="p-6 min-h-[280px]">
          {step === 0 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-purple-600" />
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">{t('wizard.venueProfile.q1.title')}</h4>
              </div>
              <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed">{t('wizard.venueProfile.q1.body')}</p>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest">{t('variables.operatingWindow.defaultOpen')}</span>
                  <input
                    type="time"
                    value={openTime}
                    onChange={e => setOpenTime(e.target.value)}
                    className="mt-1 w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-800 dark:text-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest">{t('variables.operatingWindow.defaultClose')}</span>
                  <input
                    type="time"
                    value={closeTime}
                    onChange={e => setCloseTime(e.target.value)}
                    className="mt-1 w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-800 dark:text-slate-100"
                  />
                </label>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-blue-600" />
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">{t('wizard.venueProfile.q2.title')}</h4>
              </div>
              <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed">{t('wizard.venueProfile.q2.body')}</p>
              <div className="grid grid-cols-7 gap-2">
                {DOW_KEYS.map(d => {
                  const active = peakDays.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => togglePeakDay(d.id)}
                      className={`p-3 rounded-lg border-2 text-[11px] font-black uppercase tracking-widest transition-all ${
                        active
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15 text-blue-800 dark:text-blue-200'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      {t(d.key).slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <Gift className="w-5 h-5 text-amber-600" />
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">{t('wizard.venueProfile.q3.title')}</h4>
              </div>
              <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed">{t('wizard.venueProfile.q3.body')}</p>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <Switch
                  id="wizard-operates-on-holidays"
                  checked={operatesOnHolidays}
                  onChange={setOperatesOnHolidays}
                  tone="emerald"
                  aria-labelledby="wizard-operates-on-holidays-label"
                />
                <label htmlFor="wizard-operates-on-holidays" id="wizard-operates-on-holidays-label" className="text-sm text-slate-700 dark:text-slate-200 cursor-pointer flex-1">
                  {operatesOnHolidays ? t('wizard.venueProfile.q3.yes') : t('wizard.venueProfile.q3.no')}
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">{t('wizard.venueProfile.q4.title')}</h4>
              </div>
              <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed">{t('wizard.venueProfile.q4.body')}</p>
              <div className="grid grid-cols-1 gap-3">
                {(['bare', 'realistic', 'safety-critical'] as CoveragePresetId[]).map(id => {
                  const active = coveragePreset === id;
                  const tone = ({
                    'bare': 'border-slate-500 bg-slate-50 text-slate-800 dark:border-slate-400 dark:bg-slate-800/80 dark:text-slate-200',
                    'realistic': 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-500/10 dark:text-emerald-300',
                    'safety-critical': 'border-purple-500 bg-purple-50 text-purple-800 dark:border-purple-500 dark:bg-purple-500/10 dark:text-purple-300',
                  } as const)[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCoveragePreset(id)}
                      className={`p-4 rounded-xl border-2 text-start transition-all ${
                        active
                          ? tone + ' shadow-sm'
                          : 'border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600/80'
                      }`}
                    >
                      <p className="text-[12px] font-black uppercase tracking-widest">
                        {t(`variables.coverage.preset.${id === 'safety-critical' ? 'safetyCritical' : id}.title`)}
                      </p>
                      <p className={`text-[11px] mt-1 leading-relaxed ${active ? 'opacity-85' : 'text-slate-600 dark:text-slate-400'}`}>
                        {t(`variables.coverage.preset.${id === 'safety-critical' ? 'safetyCritical' : id}.desc`)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <Gift className="w-5 h-5 text-emerald-600" />
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">{t('wizard.venueProfile.q5.title')}</h4>
              </div>
              <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed">{t('wizard.venueProfile.q5.body')}</p>
              <div className="grid grid-cols-1 gap-3">
                {([
                  { id: 'comp-day' as const, tone: 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-500/10 dark:text-emerald-300' },
                  { id: 'cash-ot' as const, tone: 'border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-500 dark:bg-amber-500/10 dark:text-amber-300' },
                  { id: 'both' as const, tone: 'border-purple-500 bg-purple-50 text-purple-800 dark:border-purple-500 dark:bg-purple-500/10 dark:text-purple-300' },
                ]).map(opt => {
                  const active = holidayCompMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setHolidayCompMode(opt.id)}
                      className={`p-4 rounded-xl border-2 text-start transition-all ${
                        active
                          ? opt.tone + ' shadow-sm'
                          : 'border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600/80'
                      }`}
                    >
                      <p className="text-[12px] font-black uppercase tracking-widest">
                        {t(`variables.art74.${opt.id === 'comp-day' ? 'compDay' : opt.id === 'cash-ot' ? 'cashOt' : 'both'}.title`)}
                      </p>
                      <p className={`text-[11px] mt-1 leading-relaxed ${active ? 'opacity-85' : 'text-slate-600 dark:text-slate-400'}`}>
                        {t(`variables.art74.${opt.id === 'comp-day' ? 'compDay' : opt.id === 'cash-ot' ? 'cashOt' : 'both'}.body`)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer with Back / Next / Finish + Skip */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/30 flex items-center justify-between gap-3">
          <button
            onClick={onSkip}
            className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 transition-colors"
          >
            {t('wizard.venueProfile.skip')}
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={back}
                className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5"
              >
                <ChevronLeft className="w-3 h-3 rtl-flip" />
                {t('wizard.venueProfile.back')}
              </button>
            )}
            {!isLastStep ? (
              <button
                onClick={next}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-widest rounded-lg shadow-sm transition-all flex items-center gap-1.5"
              >
                {t('wizard.venueProfile.next')}
                <ChevronRight className="w-3 h-3 rtl-flip" />
              </button>
            ) : (
              <button
                onClick={finish}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-widest rounded-lg shadow-sm transition-all flex items-center gap-1.5"
              >
                <Check className="w-3 h-3" />
                {t('wizard.venueProfile.finish')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
