/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Token-budget gate for tool results.
 *
 * Real BPE tokenizers (tiktoken et al.) are heavy in the browser bundle
 * (~3 MB before tree-shaking) and overkill for our use case. We only
 * need to answer "is this payload too big to send to the LLM?" — a
 * 1-byte difference doesn't change the answer.
 *
 * The 4-chars-per-token rule of thumb is famously inaccurate for code
 * and JSON, but it consistently OVER-estimates rather than under, which
 * is the right side to err on for a budget gate. (Real ratios for JSON
 * are typically ~3.0..3.5 chars/token; the 4 ratio gives a built-in
 * ~15% safety margin.)
 *
 * Phase 4 may swap this for a real tokenizer if cost discipline becomes
 * a problem. The interface here (number in, number out) lets that swap
 * happen without touching call sites.
 */

const CHARS_PER_TOKEN = 4;

/** Rough token count for arbitrary JSON-serializable data. */
export function estimateTokens(value: unknown): number {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

export interface CostEstimate {
  tokens: number;
  /** USD if `pricePerMtok` is provided, else null. */
  usd: number | null;
}

/**
 * Translate a token count into an approximate USD cost given a
 * per-million-tokens rate (e.g. from OpenRouter's `pricing.prompt`).
 * Falls back to null when no rate is supplied.
 */
export function estimateCost(tokens: number, pricePerMtok: number | null): CostEstimate {
  if (pricePerMtok == null) return { tokens, usd: null };
  return { tokens, usd: (tokens / 1_000_000) * pricePerMtok };
}

/**
 * Default size thresholds. The AI tool layer warns when a tool's
 * pre-call estimated payload (just the args, mostly) exceeds the SOFT
 * limit, and refuses when it exceeds HARD. The chat panel will gate
 * actual scope-driven pulls with a separate per-call ceiling.
 */
export const TOKEN_BUDGET = {
  /** Below this, tools fire silently. */
  comfortable: 2_000,
  /** Above this, the UI surfaces a "this is a sizable pull" confirm. */
  soft: 20_000,
  /** Above this, the UI refuses without explicit override. */
  hard: 80_000,
};

export type BudgetVerdict = 'comfortable' | 'soft' | 'hard' | 'over';

export function classify(tokens: number): BudgetVerdict {
  if (tokens <= TOKEN_BUDGET.comfortable) return 'comfortable';
  if (tokens <= TOKEN_BUDGET.soft) return 'soft';
  if (tokens <= TOKEN_BUDGET.hard) return 'hard';
  return 'over';
}
