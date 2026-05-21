import { describe, it, expect } from 'vitest';
import { adoptAdvisory, adoptChipSet } from '../findings';

describe('adoptAdvisory', () => {
  const meta = { id: 'F1', sourceMessageId: 'M1' };

  it('coerces a fully-populated wire into a SessionFinding', () => {
    const f = adoptAdvisory({
      type: 'advisory',
      severity: 'violation',
      category: 'cost',
      title: 'Overtime breach',
      recommendation: 'Cap OT below 12h/wk',
      evidence: [{ path: 'getPayroll{2026-04}.ot', value: 14 }],
      stationId: 'S1',
      empId: 'E1',
    }, meta);
    expect(f.severity).toBe('violation');
    expect(f.category).toBe('cost');
    expect(f.title).toBe('Overtime breach');
    expect(f.recommendation).toBe('Cap OT below 12h/wk');
    expect(f.evidence).toEqual([{ path: 'getPayroll{2026-04}.ot', value: '14' }]);
    expect(f.stationId).toBe('S1');
    expect(f.empId).toBe('E1');
    expect(f.status).toBe('pending');
    expect(f.id).toBe('F1');
    expect(f.sourceMessageId).toBe('M1');
  });

  it('defaults invalid severity to info and invalid category to risk', () => {
    const f = adoptAdvisory({
      type: 'advisory',
      severity: 'banana' as unknown as string,
      category: 'invented' as unknown as string,
      title: 'X',
    }, meta);
    expect(f.severity).toBe('info');
    expect(f.category).toBe('risk');
  });

  it('falls back to "Untitled finding" when title is missing or empty', () => {
    expect(adoptAdvisory({ type: 'advisory' }, meta).title).toBe('Untitled finding');
    expect(adoptAdvisory({ type: 'advisory', title: '   ' }, meta).title).toBe('Untitled finding');
  });

  it('skips evidence entries missing a path', () => {
    const f = adoptAdvisory({
      type: 'advisory',
      title: 'X',
      evidence: [
        { path: 'ok.path', value: 1 },
        { value: 'no path' },
        null,
        'string-not-object',
      ],
    }, meta);
    expect(f.evidence).toEqual([{ path: 'ok.path', value: '1' }]);
  });
});

describe('adoptChipSet', () => {
  const meta = { id: 'C1', sourceMessageId: 'M2' };

  it('uses the wire id when provided', () => {
    const c = adoptChipSet({
      type: 'chips',
      id: 'wire-id',
      question: 'q?',
      options: [{ label: 'a', value: 'a' }],
    }, meta);
    expect(c.id).toBe('wire-id');
  });

  it('falls back to the synthesized id when wire id is missing', () => {
    const c = adoptChipSet({
      type: 'chips',
      question: 'q?',
      options: [{ label: 'a', value: 'a' }],
    }, meta);
    expect(c.id).toBe('C1');
  });

  it('skips options with no label and accepts string-or-null values', () => {
    const c = adoptChipSet({
      type: 'chips',
      question: 'q?',
      options: [
        { label: 'A', value: 'a' },
        { label: '', value: 'skip' },
        { label: 'B', value: 42 as unknown as string },
        { label: 'C' },
      ],
    }, meta);
    expect(c.options.map(o => o.label)).toEqual(['A', 'B', 'C']);
    expect(c.options[0].value).toBe('a');
    expect(c.options[1].value).toBeNull();
    expect(c.options[2].value).toBeNull();
  });
});
