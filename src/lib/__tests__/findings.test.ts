import { describe, it, expect } from 'vitest';
import {
  splitFindings,
  groupFindings,
  countInstances,
  complianceScore,
  findingTitleKey,
  findingTitle,
  findingDetail,
} from '../findings';
import type { Violation } from '../../types';

const v = (over: Partial<Violation>): Violation => ({
  empId: 'EMP-1', day: 1, rule: 'Daily hours cap', article: '(Art. 67)',
  message: 'msg', ruleKey: 'dailyHoursCap', ...over,
});

describe('findings — splitFindings', () => {
  it('separates hard violations from info notes', () => {
    const all = [
      v({}),
      v({ rule: 'Public holiday worked', ruleKey: undefined, severity: 'info' }),
    ];
    const { violations, notes } = splitFindings(all);
    expect(violations).toHaveLength(1);
    expect(notes).toHaveLength(1);
    expect(notes[0].rule).toBe('Public holiday worked');
  });

  it('treats a missing severity as a violation (back-compat)', () => {
    const { violations } = splitFindings([v({ severity: undefined })]);
    expect(violations).toHaveLength(1);
  });
});

describe('findings — countInstances', () => {
  it('sums the grouped count, defaulting missing count to 1', () => {
    expect(countInstances([v({ count: 3 }), v({ count: undefined })])).toBe(4);
  });
});

describe('findings — groupFindings', () => {
  it('groups by rule and tallies instances + distinct employees', () => {
    const groups = groupFindings([
      v({ empId: 'EMP-1', count: 2 }),
      v({ empId: 'EMP-2', count: 1 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].instances).toBe(3);
    expect(groups[0].employees).toBe(2);
  });

  it('orders violations before notes, then by instance count', () => {
    const groups = groupFindings([
      v({ rule: 'Public holiday worked', ruleKey: undefined, severity: 'info', count: 5 }),
      v({ rule: 'Daily hours cap', ruleKey: 'dailyHoursCap', count: 1 }),
      v({ rule: 'Weekly hours cap', ruleKey: 'weeklyHoursCap', count: 3 }),
    ]);
    expect(groups[0].severity).toBe('violation');
    expect(groups[0].rule).toBe('Weekly hours cap'); // 3 > 1
    expect(groups[1].rule).toBe('Daily hours cap');
    expect(groups[2].severity).toBe('info'); // note last despite count 5
  });
});

describe('findings — complianceScore', () => {
  it('is 100 with no violations', () => {
    expect(complianceScore(10, 30, 0)).toBe(100);
  });
  it('is 100 when there is nothing to check (no employees or days)', () => {
    expect(complianceScore(0, 30, 5)).toBe(100);
  });
  it('decreases as violations rise and clamps to 0', () => {
    const a = complianceScore(10, 30, 10);
    const b = complianceScore(10, 30, 100);
    expect(a).toBeLessThan(100);
    expect(b).toBeLessThan(a);
    expect(complianceScore(1, 1, 9999)).toBe(0);
  });
});

describe('findings — titles + detail', () => {
  it('maps a violation ruleKey to its fines.rule.* i18n key', () => {
    expect(findingTitleKey(v({ ruleKey: 'weeklyHoursCap' }))).toBe('fines.rule.weeklyHoursCap');
  });
  it('maps an info note to its finding.note.* i18n key', () => {
    expect(findingTitleKey(v({ rule: 'Comp day owed', ruleKey: undefined, severity: 'info' }))).toBe('finding.note.compDayOwed');
  });
  it('returns empty key for an unknown rule (caller falls back to raw rule)', () => {
    expect(findingTitleKey(v({ rule: 'Custom rule', ruleKey: undefined }))).toBe('');
  });
  it('findingTitle falls back to the raw rule when no key is registered', () => {
    const t = (k: string) => `T:${k}`;
    expect(findingTitle(v({ rule: 'Custom rule', ruleKey: undefined }), t)).toBe('Custom rule');
    expect(findingTitle(v({ ruleKey: 'dailyHoursCap' }), t)).toBe('T:fines.rule.dailyHoursCap');
  });
  it('findingDetail prefers messageKey + params, applies the digit mapper', () => {
    const t = (k: string, vars?: Record<string, string | number>) => `${k}|${vars?.cap ?? ''}`;
    const out = findingDetail(v({ messageKey: 'finding.msg.dailyCap', messageParams: { cap: 8 } }), t, (s) => s.replace('8', '٨'));
    expect(out).toBe('finding.msg.dailyCap|٨');
  });
  it('findingDetail falls back to the English message when no key', () => {
    const t = (k: string) => k;
    expect(findingDetail(v({ messageKey: undefined, message: 'plain english' }), t)).toBe('plain english');
  });
});
