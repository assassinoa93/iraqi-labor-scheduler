// v5.40.0 — en/ar dictionary parity guard.
//
// The two dictionaries must stay in lockstep: every key present in one must
// be present in the other. The Dict type is Record<string, string>, so tsc
// cannot catch a key that exists in en.ts but was never translated in ar.ts
// (or a stale ar.ts key left behind after an en.ts removal). This test makes
// the lockstep rule mechanical instead of conventional.
import { describe, it, expect } from 'vitest';
import { en } from '../i18n/en';
import { ar } from '../i18n/ar';

describe('i18n en/ar parity', () => {
  it('every English key has an Arabic counterpart', () => {
    const arKeys = new Set(Object.keys(ar));
    const missing = Object.keys(en).filter(k => !arKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('every Arabic key has an English counterpart', () => {
    const enKeys = new Set(Object.keys(en));
    const stale = Object.keys(ar).filter(k => !enKeys.has(k));
    expect(stale).toEqual([]);
  });
});
