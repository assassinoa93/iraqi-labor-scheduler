import React from 'react';
import { Languages } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const next = locale === 'en' ? 'ar' : 'en';

  return (
    <button
      onClick={() => setLocale(next)}
      title={t('sidebar.locale.tooltip')}
      className="w-full flex items-center justify-between gap-2 px-4 py-2 mb-2 text-[10px] font-bold text-blue-300 uppercase tracking-widest hover:bg-blue-500/10 rounded-lg transition-all border border-blue-500/20"
    >
      <span className="flex items-center gap-2">
        <Languages className="w-4 h-4" />
        {locale === 'en' ? 'EN' : 'AR'}
      </span>
      <span className="text-white">→ {t('sidebar.locale.switch')}</span>
    </button>
  );
}
