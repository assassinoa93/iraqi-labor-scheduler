import { describe, it, expect } from 'vitest';
import { parseAssistantContent } from '../messageParser';

describe('parseAssistantContent', () => {
  it('returns a single text segment when content has no fences', () => {
    const r = parseAssistantContent('Hello world', 'msg-1');
    expect(r.segments).toEqual([{ kind: 'text', content: 'Hello world' }]);
    expect(r.newFindings).toEqual([]);
    expect(r.chipSets).toEqual([]);
  });

  it('returns empty arrays for empty content', () => {
    const r = parseAssistantContent('', 'msg-1');
    expect(r.segments).toEqual([]);
    expect(r.newFindings).toEqual([]);
    expect(r.chipSets).toEqual([]);
  });

  it('parses a valid advisory fence into a finding segment', () => {
    const body = JSON.stringify({
      type: 'advisory',
      severity: 'warning',
      category: 'liability',
      title: 'Driver weekly cap',
      recommendation: 'Reassign 4h to another driver',
      evidence: [{ path: 'getPayroll{2026-01}.weeklyHrs', value: 60 }],
      empId: 'EMP-007',
    });
    const content = `Some intro\n\`\`\`advisory\n${body}\n\`\`\`\nTrailing text.`;
    const r = parseAssistantContent(content, 'msg-1');

    expect(r.segments.map(s => s.kind)).toEqual(['text', 'advisory', 'text']);
    expect(r.newFindings).toHaveLength(1);
    const finding = r.newFindings[0];
    expect(finding.id).toBe('msg-1-advisory-0');
    expect(finding.severity).toBe('warning');
    expect(finding.category).toBe('liability');
    expect(finding.empId).toBe('EMP-007');
    expect(finding.evidence).toEqual([
      { path: 'getPayroll{2026-01}.weeklyHrs', value: '60' },
    ]);
    expect(finding.status).toBe('pending');
  });

  it('parses a valid chips fence into a chip-set segment', () => {
    const body = JSON.stringify({
      type: 'chips',
      stationId: 'STA-1',
      field: 'gameType',
      question: 'Which type of game is at station 1?',
      options: [
        { label: 'Bowling', value: 'bowling' },
        { label: 'Arcade', value: 'arcade' },
      ],
    });
    const content = `\`\`\`chips\n${body}\n\`\`\``;
    const r = parseAssistantContent(content, 'msg-2');

    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].kind).toBe('chips');
    if (r.segments[0].kind === 'chips') {
      expect(r.segments[0].chipSet.question).toMatch(/station 1/);
      expect(r.segments[0].chipSet.options).toHaveLength(2);
    }
    expect(r.chipSets).toHaveLength(1);
  });

  it('falls back to invalid segment when JSON is malformed', () => {
    const content = '```advisory\n{not json}\n```';
    const r = parseAssistantContent(content, 'msg-3');
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].kind).toBe('invalid');
    expect(r.newFindings).toEqual([]);
  });

  it('flags chip sets with no options as invalid', () => {
    const body = JSON.stringify({
      type: 'chips',
      question: 'pick one',
      options: [],
    });
    const content = `\`\`\`chips\n${body}\n\`\`\``;
    const r = parseAssistantContent(content, 'msg-4');
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].kind).toBe('invalid');
    expect(r.chipSets).toEqual([]);
  });

  it('handles multiple consecutive fences in one message', () => {
    const a = JSON.stringify({ type: 'advisory', severity: 'info', title: 'A' });
    const b = JSON.stringify({
      type: 'chips',
      question: 'q?',
      options: [{ label: 'yes', value: 'y' }],
    });
    const content = `Before\n\`\`\`advisory\n${a}\n\`\`\`\nMiddle\n\`\`\`chips\n${b}\n\`\`\`\nAfter`;
    const r = parseAssistantContent(content, 'msg-5');
    expect(r.segments.map(s => s.kind)).toEqual([
      'text', 'advisory', 'text', 'chips', 'text',
    ]);
    expect(r.newFindings).toHaveLength(1);
    expect(r.chipSets).toHaveLength(1);
    // IDs are block-index scoped so they must differ.
    expect(r.newFindings[0].id).toBe('msg-5-advisory-0');
    expect(r.chipSets[0].id).toBe('msg-5-chips-1');
  });

  it('resets regex state between calls so two invocations are independent', () => {
    const body = JSON.stringify({ type: 'advisory', severity: 'info', title: 'X' });
    const content = `\`\`\`advisory\n${body}\n\`\`\``;
    const r1 = parseAssistantContent(content, 'msg-a');
    const r2 = parseAssistantContent(content, 'msg-b');
    expect(r1.newFindings).toHaveLength(1);
    expect(r2.newFindings).toHaveLength(1);
  });
});
