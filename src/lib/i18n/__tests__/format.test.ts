import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatDate,
  formatNumber,
  getArabicDigitsPref,
  setArabicDigitsPref,
  toArabicDigits,
} from '../format';

function installLocalStorageStub() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = stub as unknown as Storage;
  (globalThis as unknown as { window: { localStorage: Storage; addEventListener: () => void; removeEventListener: () => void; dispatchEvent: () => boolean } }).window = {
    localStorage: stub as unknown as Storage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent =
    class CustomEvent { constructor(_t: string) {} } as unknown as typeof CustomEvent;
}

beforeEach(() => {
  installLocalStorageStub();
});

describe('toArabicDigits', () => {
  it('maps ASCII digits to Arabic-Indic', () => {
    expect(toArabicDigits('0123456789')).toBe('٠١٢٣٤٥٦٧٨٩');
  });

  it('preserves non-digit characters including hyphens and Arabic letters', () => {
    expect(toArabicDigits('2026-04-12')).toBe('٢٠٢٦-٠٤-١٢');
    expect(toArabicDigits('5 موظف')).toBe('٥ موظف');
  });

  it('is a no-op when no digits are present', () => {
    expect(toArabicDigits('hello world')).toBe('hello world');
  });
});

describe('getArabicDigitsPref / setArabicDigitsPref', () => {
  it('defaults to true when nothing is stored', () => {
    expect(getArabicDigitsPref()).toBe(true);
  });

  it('round-trips through the setter', () => {
    setArabicDigitsPref(false);
    expect(getArabicDigitsPref()).toBe(false);
    setArabicDigitsPref(true);
    expect(getArabicDigitsPref()).toBe(true);
  });
});

describe('formatNumber', () => {
  it('returns ASCII digits for locale=en', () => {
    expect(formatNumber(1234, 'en')).toBe('1,234');
  });

  it('returns Arabic-Indic digits for locale=ar when pref is on', () => {
    expect(formatNumber(1234, 'ar', { useArabicDigits: true })).toMatch(/[٠-٩]/);
  });

  it('keeps ASCII digits for locale=ar when pref is off', () => {
    expect(formatNumber(1234, 'ar', { useArabicDigits: false })).toMatch(/[0-9]/);
    expect(formatNumber(1234, 'ar', { useArabicDigits: false })).not.toMatch(/[٠-٩]/);
  });

  it('passes Intl.NumberFormat options through (fraction digits)', () => {
    expect(formatNumber(1.5, 'en', { minimumFractionDigits: 2 })).toBe('1.50');
  });

  it('passes Intl.NumberFormat options through (currency style)', () => {
    const out = formatNumber(1000, 'en', { style: 'currency', currency: 'IQD' });
    // Different ICU versions render the IQD symbol differently; the
    // numeric portion is the load-bearing assertion.
    expect(out).toMatch(/1,000/);
  });
});

describe('formatDate', () => {
  const d = new Date(2026, 3, 12); // 2026-04-12

  it('formats in English with ASCII digits', () => {
    expect(formatDate(d, 'yyyy-MM-dd', 'en')).toBe('2026-04-12');
  });

  it('maps digits to Arabic-Indic when locale=ar with pref on', () => {
    expect(formatDate(d, 'yyyy-MM-dd', 'ar', { useArabicDigits: true })).toBe('٢٠٢٦-٠٤-١٢');
  });

  it('keeps ASCII digits but Arabic month names when pref is off', () => {
    const out = formatDate(d, 'MMMM yyyy', 'ar', { useArabicDigits: false });
    // The numeric year must stay ASCII; the month name should be Arabic.
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/[؀-ۿ]/);
  });

  it('uses Arabic month names by default in ar locale', () => {
    const out = formatDate(d, 'MMMM yyyy', 'ar');
    expect(out).toMatch(/[؀-ۿ]/);
  });

  it('uses English month names in en locale', () => {
    expect(formatDate(d, 'MMMM yyyy', 'en')).toBe('April 2026');
  });
});
