import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';

import { en } from './i18n/en';
import { ar } from './i18n/ar';
import {
  formatDate as fmtDateRaw,
  formatNumber as fmtNumberRaw,
  abbreviateNumber as abbreviateRaw,
  getArabicDigitsPref,
  setArabicDigitsPref,
  toArabicDigits,
} from './i18n/format';

// v5.23.0 — the EN/AR string tables were extracted into `i18n/en.ts` and
// `i18n/ar.ts`. This file keeps the public API surface (types + provider +
// `useI18n` hook) plus the `en` / `ar` re-exports for backward compat.
//
// v5.24.0 — locale-aware formatters (fmt.num / fmt.date / fmt.digits) are
// surfaced on the i18n context. They auto-apply the user's Arabic-Indic
// digit preference and the active locale.

export type Locale = 'en' | 'ar';
export type Dict = Record<string, string>;

const STORAGE_KEY = 'iraqi-scheduler-locale';

export { en, ar };

const DICTS: Record<Locale, Dict> = { en, ar };

export interface I18nFormatters {
  num: (value: number, opts?: Intl.NumberFormatOptions) => string;
  date: (date: Date | number, fmt: string) => string;
  digits: (s: string) => string;
  // v5.41.0 (03.5) — compact K/M/B form (+ the full grouped figure for a
  // hover title) for dense headline numbers like annual IQD salary totals.
  abbrev: (value: number) => { short: string; full: string };
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (loc: Locale) => void;
  // `t('confirm.removeEmp.body', { id: 'EMP-1000' })` substitutes "{id}" with
  // the corresponding value. Missing placeholders are left in-place so they're
  // visibly broken rather than silently dropped.
  t: (key: string, vars?: Record<string, string | number>) => string;
  dir: 'ltr' | 'rtl';
  fmt: I18nFormatters;
  arabicDigits: boolean;
  setArabicDigits: (enabled: boolean) => void;
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

  // Arabic-Indic digit preference. Defaults to ON for ar locale; the
  // toggle lives in localStorage and survives reloads.
  const [arabicDigits, setArabicDigitsState] = useState<boolean>(getArabicDigitsPref);
  useEffect(() => {
    const onChange = () => setArabicDigitsState(getArabicDigitsPref());
    window.addEventListener('ils:arabic-digits-changed', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('ils:arabic-digits-changed', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  const setArabicDigits = useCallback((enabled: boolean) => {
    setArabicDigitsPref(enabled);
    setArabicDigitsState(enabled);
  }, []);

  const fmt = useMemo<I18nFormatters>(() => ({
    num: (value, opts) => fmtNumberRaw(value, locale, { useArabicDigits: arabicDigits, ...opts }),
    date: (date, f) => fmtDateRaw(date, f, locale, { useArabicDigits: arabicDigits }),
    digits: (s) => (locale === 'ar' && arabicDigits ? toArabicDigits(s) : s),
    abbrev: (value) => abbreviateRaw(value, locale, { useArabicDigits: arabicDigits }),
  }), [locale, arabicDigits]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, dir, fmt, arabicDigits, setArabicDigits }}>
      {children}
    </I18nContext.Provider>
  );
}

const defaultFormatters: I18nFormatters = {
  num: (v, opts) => new Intl.NumberFormat('en-US', opts).format(v),
  date: (d, f) => fmtDateRaw(d, f, 'en'),
  digits: (s) => s,
  abbrev: (v) => abbreviateRaw(v, 'en'),
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Defensive default: outside the provider just echo English.
    return {
      locale: 'en',
      setLocale: () => {},
      t: (k: string, vars?: Record<string, string | number>) => interpolate(en[k] ?? k, vars),
      dir: 'ltr',
      fmt: defaultFormatters,
      arabicDigits: false,
      setArabicDigits: () => {},
    };
  }
  return ctx;
}
