/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.29 — statute requirement lookup used by the HRIS compliance.json + PDF
 * compliance report.
 */
import { describe, it, expect } from 'vitest';
import { requirementForArticle, statuteLegendFor, STATUTE_REQUIREMENTS } from '../statuteText';

describe('requirementForArticle', () => {
  it('resolves a simple "(Art. 69)" citation', () => {
    expect(requirementForArticle('(Art. 69)')).toBe(STATUTE_REQUIREMENTS['69']);
  });

  it('resolves the first known article in a compound citation "(Art. 71 §5, 72)"', () => {
    expect(requirementForArticle('(Art. 71 §5, 72)')).toBe(STATUTE_REQUIREMENTS['71']);
  });

  it('resolves a slashed citation "Art. 67 / 68"', () => {
    expect(requirementForArticle('Art. 67 / 68')).toBe(STATUTE_REQUIREMENTS['67']);
  });

  it('returns null for non-article pseudo-tokens', () => {
    expect(requirementForArticle('(Annual Leave)')).toBeNull();
    expect(requirementForArticle('(Ramadan)')).toBeNull();
    expect(requirementForArticle(undefined)).toBeNull();
    expect(requirementForArticle('')).toBeNull();
  });

  it('returns null for an unknown article number', () => {
    expect(requirementForArticle('(Art. 999)')).toBeNull();
  });
});

describe('statuteLegendFor', () => {
  it('returns distinct article/requirement pairs, de-duplicated, in first-seen order', () => {
    const legend = statuteLegendFor([
      { article: '(Art. 69)' },
      { article: '(Art. 67)' },
      { article: '(Art. 69)' }, // dup
      { article: '(Annual Leave)' }, // no number → skipped
    ]);
    expect(legend.map((l) => l.article)).toEqual(['(Art. 69)', '(Art. 67)']);
    expect(legend[0].requirement).toBe(STATUTE_REQUIREMENTS['69']);
  });

  it('returns an empty array when no findings cite a catalogued article', () => {
    expect(statuteLegendFor([{ article: '(Ramadan)' }, {}])).toEqual([]);
  });
});
