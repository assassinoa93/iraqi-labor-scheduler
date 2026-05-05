/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-launch screen: picks between Offline Demo (current local-first
 * behavior) and Connect Online (Firestore-backed multi-user). The choice
 * persists in localStorage so subsequent launches go straight to the chosen
 * mode. Switching modes prompts a restart from Settings.
 *
 * v5.16.0 — fully i18n'd. Pre-v5.16 every string here was hardcoded English,
 * which meant Arabic-locale users saw English on the very first screen.
 * Also fixed the role list (was 3 roles; the app actually has 4 since
 * the manager role landed in v5.x).
 */

import React from 'react';
import { Database, Cloud } from 'lucide-react';
import { setMode, AppMode } from '../lib/mode';
import { useI18n } from '../lib/i18n';

interface Props {
  onPick: (mode: AppMode) => void;
}

export function ModePicker({ onPick }: Props) {
  const { t } = useI18n();
  const choose = (mode: AppMode) => {
    setMode(mode);
    onPick(mode);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-black text-slate-900 dark:text-slate-50 mb-2 tracking-tight">
            {t('modePicker.title')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
            {t('modePicker.subtitle')}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button
            onClick={() => choose('offline')}
            className="apple-press text-start p-8 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xl transition-all group"
          >
            <div className="w-14 h-14 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center mb-6 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/25 transition-colors">
              <Database className="w-7 h-7 text-emerald-600 dark:text-emerald-300" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50 mb-2">{t('modePicker.offline.title')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              {t('modePicker.offline.body')}
            </p>
            <ul className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-400 font-medium">
              <li>· {t('modePicker.offline.bullet1')}</li>
              <li>· {t('modePicker.offline.bullet2')}</li>
              <li>· {t('modePicker.offline.bullet3')}</li>
            </ul>
          </button>

          <button
            onClick={() => choose('online')}
            className="apple-press text-start p-8 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xl transition-all group cursor-pointer"
          >
            <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center mb-6 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/25 transition-colors">
              <Cloud className="w-7 h-7 text-blue-600 dark:text-blue-300" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50 mb-2">{t('modePicker.online.title')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              {t('modePicker.online.body')}
            </p>
            <ul className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-400 font-medium">
              <li>· {t('modePicker.online.bullet1')}</li>
              <li>· {t('modePicker.online.bullet2')}</li>
              <li>· {t('modePicker.online.bullet3')}</li>
            </ul>
          </button>
        </div>
        <p className="mt-10 text-center text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-600 font-medium">
          {t('modePicker.footer')}
        </p>
      </div>
    </div>
  );
}
