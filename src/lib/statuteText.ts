/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.29 — plain-language statute text for the Iraqi Labour Law No. 37 of 2015
 * articles the compliance engine cites. Exports (HRIS compliance.json + the PDF
 * compliance report) attach the requirement wording next to each finding so an
 * inspector reads WHAT the rule requires, not just an article token.
 *
 * English-only by design: these are cross-language legal citations and the PDF
 * is generated in English (jsPDF cannot render Arabic) — matching the existing
 * convention in fines.ts (RULE_ARTICLES) and pdfReport.ts. The wording is a
 * practitioner summary, NOT the verbatim statute; the operator should confirm
 * exact text with counsel for any formal submission.
 *
 * Verdicts (compliant / breached) are NOT encoded here — those are derived from
 * each finding's own `severity` at the call site, never from a static per-rule
 * map (a rule like the weekly cap can be a violation or a note depending on
 * context).
 */

// Keyed by bare article number (string) so a single requirement covers every
// citation format the engine emits: "(Art. 67)", "(Art. 71 §5, 72)", "Art. 67 / 68".
export const STATUTE_REQUIREMENTS: Record<string, string> = {
  '67': 'Standard daily working hours must not exceed 8 hours (Art. 67).',
  '68': 'Total working hours including overtime are capped, with reduced limits for hazardous work (Art. 68).',
  '69': 'The working day must include rest/meal/prayer breaks; a worker must not work more than 5 continuous hours without a rest break of at least 30 minutes (the break is not counted as working time) (Art. 69).',
  '70': 'Weekly working hours must not exceed 48; overtime is paid at premium rates (Art. 70).',
  '71': 'Workers are entitled to a minimum daily rest period between shifts and to at least 21 days of paid annual leave per year of service; any waiver of the minimum annual leave is void (Art. 71).',
  '72': 'Workers are entitled to a weekly rest day, and the number of consecutive working days is limited (Art. 72).',
  '74': 'Work performed on an official public holiday must be compensated, either by a compensatory rest day or by premium pay (Art. 74).',
  '84': 'Workers are entitled to paid sick leave and must not be required to work during an approved sick-leave period (Art. 84).',
  '86': 'Women must not be employed on night work in industrial undertakings during the protected night window (Art. 86).',
  '87': 'Women are entitled to maternity leave and must not work during the protected maternity period (Art. 87).',
  '88': 'Transport workers (drivers) are subject to stricter daily and weekly hour caps and continuous-driving limits than standard staff (Art. 88).',
  '137': 'End-of-service gratuity accrues for each year of service, calculated from the hire date (Art. 137).',
};

/**
 * Resolve the plain-language requirement for a finding's `article` string.
 * Scans for the first known article number token, so "(Art. 71 §5, 72)" maps to
 * the Art. 71 requirement and "Art. 67 / 68" maps to Art. 67. Returns null when
 * no catalogued article is present (e.g. the "(Annual Leave)" / "(Ramadan)"
 * pseudo-tokens), so callers can omit the column rather than show a blank rule.
 */
export function requirementForArticle(article: string | undefined | null): string | null {
  if (!article) return null;
  const nums = article.match(/\d+/g);
  if (!nums) return null;
  for (const n of nums) {
    if (STATUTE_REQUIREMENTS[n]) return STATUTE_REQUIREMENTS[n];
  }
  return null;
}

/**
 * Distinct (article token, requirement) pairs for a set of findings, in a
 * stable order — used to render a statute legend/appendix under a report
 * instead of repeating the full requirement on every row.
 */
export function statuteLegendFor(
  findings: Array<{ article?: string }>,
): Array<{ article: string; requirement: string }> {
  const seen = new Map<string, string>();
  for (const f of findings) {
    const req = requirementForArticle(f.article);
    if (req && f.article && !seen.has(f.article)) seen.set(f.article, req);
  }
  return Array.from(seen.entries()).map(([article, requirement]) => ({ article, requirement }));
}
