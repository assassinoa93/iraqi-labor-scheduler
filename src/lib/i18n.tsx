import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

import { en } from './i18n/en';
import { ar } from './i18n/ar';

// v5.23.0 — the EN/AR string tables were extracted into `i18n/en.ts` and
// `i18n/ar.ts`. This file keeps the public API surface (types + provider +
// `useI18n` hook) plus the `en` / `ar` re-exports for backward compat.

export type Locale = 'en' | 'ar';
export type Dict = Record<string, string>;

const STORAGE_KEY = 'iraqi-scheduler-locale';

export { en, ar };

const DICTS: Record<Locale, Dict> = { en, ar };

interface I18nContextValue {
  locale: Locale;
  setLocale: (loc: Locale) => void;
  // `t('confirm.removeEmp.body', { id: 'EMP-1000' })` substitutes "{id}" with
  // the corresponding value. Missing placeholders are left in-place so they're
  // visibly broken rather than silently dropped.
  t: (key: string, vars?: Record<string, string | number>) => string;
  dir: 'ltr' | 'rtl';
}

const interpolate = (template: string, vars?: Record<string, string | number>): string => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] != null ? String(vars[key]) : match;
  });
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'en';
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'ar' ? 'ar' : 'en';
  });

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  // Sync the dir attribute and lang attribute on the document so any third-party
  // CSS or components that key off the document direction work correctly.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', locale);
  }, [dir, locale]);

  const setLocale = useCallback((loc: Locale) => {
    setLocaleState(loc);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, loc);
    }
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const dict = DICTS[locale];
    const template = key in dict ? dict[key] : (key in en ? en[key] : key);
    return interpolate(template, vars);
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, dir }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Defensive default: outside the provider just echo English.
    return {
      locale: 'en',
      setLocale: () => {},
      t: (k: string, vars?: Record<string, string | number>) => interpolate(en[k] ?? k, vars),
      dir: 'ltr',
    };
  }
  return ctx;
}
