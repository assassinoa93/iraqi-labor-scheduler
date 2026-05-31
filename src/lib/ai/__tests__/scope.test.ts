import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearScope,
  emptyScope,
  formatDateRange,
  formatMonthRange,
  isoToday,
  readScope,
  writeScope,
} from '../scope';

function installSessionStorageStub() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = stub as unknown as Storage;
  (globalThis as unknown as { window: { addEventListener: () => void; removeEventListener: () => void; dispatchEvent: () => boolean } }).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent =
    class CustomEvent { constructor(_t: string) {} } as unknown as typeof CustomEvent;
}

beforeEach(() => {
  installSessionStorageStub();
});

describe('emptyScope', () => {
  it('returns nulls with leave.asOf set to today', () => {
    const s = emptyScope();
    expect(s.schedules).toBeNull();
    expect(s.payroll).toBeNull();
    expect(s.wfp).toBeNull();
    expect(s.leave.range).toBeNull();
    expect(s.leave.asOf).toBe(isoToday());
  });
});

describe('readScope / writeScope', () => {
  it('returns emptyScope when nothing is persisted', () => {
    expect(readScope()).toEqual(emptyScope());
  });

  it('round-trips a populated scope', () => {
    const next = {
      schedules: { fromYear: 2026, fromMonth: 4, toYear: 2026, toMonth: 6 },
      payroll: null,
      leave: { range: { from: '2026-04-01', to: '2026-06-30' }, asOf: '2026-05-21' },
      wfp: { year: 2027 },
    };
    writeScope(next);
    expect(readScope()).toEqual(next);
  });

  it('defensively merges missing leave fields from old snapshots', () => {
    sessionStorage.setItem('ils.ai.scope', JSON.stringify({
      schedules: null,
      payroll: null,
      leave: { range: { from: '2026-01-01', to: '2026-01-31' } },
      // asOf intentionally absent
    }));
    const s = readScope();
    expect(s.leave.range).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(s.leave.asOf).toBe(isoToday());
  });

  it('falls back to emptyScope on malformed JSON', () => {
    sessionStorage.setItem('ils.ai.scope', '{not json}');
    expect(readScope()).toEqual(emptyScope());
  });

  it('clearScope drops the persisted entry', () => {
    writeScope({ ...emptyScope(), wfp: { year: 2026 } });
    clearScope();
    expect(readScope()).toEqual(emptyScope());
  });
});

describe('formatMonthRange', () => {
  it('returns em dash for null', () => {
    expect(formatMonthRange(null)).toBe('—');
  });
  it('formats a single month', () => {
    expect(formatMonthRange({ fromYear: 2026, fromMonth: 4, toYear: 2026, toMonth: 4 }))
      .toBe('Apr 2026');
  });
  it('formats a same-year range', () => {
    expect(formatMonthRange({ fromYear: 2026, fromMonth: 1, toYear: 2026, toMonth: 12 }))
      .toBe('Jan–Dec 2026');
  });
  it('formats a cross-year range', () => {
    expect(formatMonthRange({ fromYear: 2025, fromMonth: 11, toYear: 2026, toMonth: 2 }))
      .toBe('Nov 2025 – Feb 2026');
  });
  it('uses a caller-supplied localized month-name array (ar locale)', () => {
    // Mirrors what the Scope bar passes — `common.month.short.*` resolved
    // via t() in Arabic — so pills read in Arabic instead of leaking English.
    const ar = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
    ];
    expect(formatMonthRange({ fromYear: 2026, fromMonth: 4, toYear: 2026, toMonth: 4 }, ar))
      .toBe('أبريل 2026');
    expect(formatMonthRange({ fromYear: 2026, fromMonth: 1, toYear: 2026, toMonth: 12 }, ar))
      .toBe('يناير–ديسمبر 2026');
    expect(formatMonthRange({ fromYear: 2025, fromMonth: 11, toYear: 2026, toMonth: 2 }, ar))
      .toBe('نوفمبر 2025 – فبراير 2026');
  });
});

describe('formatDateRange', () => {
  it('returns em dash for null', () => {
    expect(formatDateRange(null)).toBe('—');
  });
  it('returns a single date when from === to', () => {
    expect(formatDateRange({ from: '2026-05-21', to: '2026-05-21' })).toBe('2026-05-21');
  });
  it('formats a real range with arrow', () => {
    expect(formatDateRange({ from: '2026-01-01', to: '2026-12-31' })).toBe('2026-01-01 → 2026-12-31');
  });
});
