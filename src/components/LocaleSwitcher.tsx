import React from 'react';
import { Languages, Sun, Moon, Monitor } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useTheme, Theme } from '../lib/theme';

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const nextLocale = locale === 'en' ? 'ar' : 'en';

  // Cycle light → dark → system → light. Three states because the user may
  // want OS-tracking on a multi-user machine.
  const cycleTheme = () => {
    const order: Theme[] = ['light', 'dark', 'system'];
    const idx = order.indexOf(theme);
    setTheme(order[(idx + 1) % order.length]);
  };
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'system' ? Monitor : Sun;
  const themeLabel = theme === 'dark' ? t('theme.dark') : theme === 'system' ? t('theme.system') : t('theme.light');

  return (
    <div className="space-y-2 mb-2">
      <button
        onClick={() => setLocale(nextLocale)}
        title={t('sidebar.locale.tooltip')}
        className="w-full flex items-center justify-between gap-2 px-4 py-2 text-[10px] font-bold text-blue-300 uppercase tracking-widest hover:bg-blue-500/10 rounded-lg transition-all border border-blue-500/20"
      >
        <span className="flex items-center gap-2">
          <Languages className="w-4 h-4" />
          {locale === 'en' ? 'EN' : 'AR'}
        </span>
        <span className="text-white">→ {t('sidebar.locale.switch')}</span>
      </button>
      <button
        onClick={cycleTheme}
        title={t('theme.tooltip')}
        className="w-full flex items-center justify-between gap-2 px-4 py-2 text-[10px] font-bold text-blue-300 uppercase tracking-widest hover:bg-blue-500/10 rounded-lg transition-all border border-blue-500/20"
      >
        <span className="flex items-center gap-2">
          <ThemeIcon className="w-4 h-4" />
          {themeLabel}
        </span>
        <span className="text-white text-[9px]">{t('theme.cycle')}</span>
      </button>
    </div>
  );
}
