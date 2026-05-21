/**
 * v5.24.0 — locale-aware number + date formatters.
 *
 * The platform-wide rule is:
 *   - Data values (Firestore keys, schedule cell day numbers, ids,
 *     yyyy-MM-dd serialisation) stay ASCII regardless of locale.
 *   - User-facing displays of those values pass through the helpers
 *     here so an Arabic reader sees ١٢٣ instead of 123 (and Arabic
 *     month names where applicable).
 *
 * Per-device opt-out: some users prefer ASCII digits even in Arabic
 * mode (mixed-language reports, copy-paste into ASCII spreadsheets).
 * The toggle lives in localStorage so it sticks per machine and
 * defaults ON when the locale is Arabic.
 */

import { format as dfFormat } from 'date-fns';
import { ar as arLocale } from 'date-fns/locale/ar';
import type { Locale } from '../i18n';

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

/** Map every ASCII digit (0-9) inside `s` to its Arabic-Indic counterpart.
 *  Non-digit characters are left as-is so '2026-04-12' becomes
 *  '٢٠٢٦-٠٤-١٢' (hyphens preserved). */
export function toArabicDigits(s: string): string {
  return s.replace(/[0-9]/g, d => ARABIC_DIGITS[Number(d)]);
}

const STORAGE_KEY = 'ils.i18n.arabicDigits';

/** Read the per-device "use Arabic-Indic digits" preference. Defaults to
 *  true so an Arabic-locale user gets ١٢٣ out of the box. */
export function getArabicDigitsPref(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return true;
  return raw === '1';
}

export function setArabicDigitsPref(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  // Same-tab listeners get a custom event so the toggle's effect is
  // immediate even before the user navigates.
  window.dispatchEvent(new CustomEvent('ils:arabic-digits-changed'));
}

/** Format a number for display. Locale=ar with the digits-pref ON yields
 *  Arabic-Indic digits; locale=en is always ASCII. Pass-through for
 *  Intl options (currency, fraction digits, etc.). */
export function formatNumber(
  value: number,
  locale: Locale,
  opts?: { useArabicDigits?: boolean } & Intl.NumberFormatOptions,
): string {
  const { useArabicDigits, ...intlOpts } = opts ?? {};
  const wantArabic = locale === 'ar' && (useArabicDigits ?? true);
  // Pin the numbering system explicitly. ICU's default for 'ar-IQ' is
  // 'arab' (Arabic-Indic); pass 'latn' to force ASCII when the user opts
  // out, otherwise leave ICU's default in place — both produce the
  // expected digits without an extra mapping pass.
  const tag = locale === 'ar'
    ? (wantArabic ? 'ar-IQ-u-nu-arab' : 'ar-IQ-u-nu-latn')
    : 'en-US';
  const raw = new Intl.NumberFormat(tag, intlOpts).format(value);
  // Belt-and-braces — some ICU builds still emit ASCII for 'ar-IQ' even
  // with the explicit numbering-system tag. The map is idempotent on
  // Arabic-Indic digits so this is safe.
  if (wantArabic) return toArabicDigits(raw);
  return raw;
}

/** Format a date for display. Locale=ar uses Arabic month names (date-fns
 *  ar locale) plus an optional digit map. Format string follows date-fns
 *  conventions. */
export function formatDate(
  date: Date | number,
  fmt: string,
  locale: Locale,
  opts?: { useArabicDigits?: boolean },
): string {
  const { useArabicDigits } = opts ?? {};
  const raw = dfFormat(date, fmt, locale === 'ar' ? { locale: arLocale } : undefined);
  if (locale === 'ar' && (useArabicDigits ?? true)) return toArabicDigits(raw);
  return raw;
}
