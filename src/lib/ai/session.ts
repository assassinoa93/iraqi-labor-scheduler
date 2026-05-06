/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — AI session record.
 *
 * One session = one chat conversation, captured against the scope that
 * was active when the user said "go". The user-locked decision is
 * "scope is per-session" — every message, tool call, and finding in
 * this record was produced under the `scope` snapshot here.
 *
 * Persistence: localStorage, keyed by AI user id (`getAiUserId`). Phase 4
 * keeps just the CURRENT session. A future phase can add a sessions list
 * with resume.
 *
 * Per-machine, per-user. NEVER synced to Firestore — same posture as the
 * encrypted OpenRouter key.
 */

import type { AiScope } from './scope';
import type { ChatMessage } from './openrouter';
import type { SessionFinding, SessionChipResponse, FindingStatus } from './findings';

export interface ChatTurnTokens {
  prompt: number;
  completion: number;
  total: number;
}

/**
 * One entry in the conversation. Mirrors OpenAI / OpenRouter chat-message
 * shape so the loop can spread the array straight into the API call,
 * but adds a stable id (for React keys + tool-call linking) and timestamps.
 */
export interface SessionMessage extends ChatMessage {
  id: string;
  ts: number;
  /** Cumulative token usage for this turn (assistant messages only). */
  tokens?: ChatTurnTokens;
  /** Set on tool messages so we can show "ran getCompliance ≈ 4.2k tokens". */
  toolEstimateTokens?: number;
  toolVerdict?: 'comfortable' | 'soft' | 'hard' | 'over';
  /** Captured for tool error messages so the UI can highlight failures. */
  toolError?: boolean;
}

export interface AiSession {
  id: string;
  startedAt: number;
  /** Scope captured when the session was created. */
  scope: AiScope;
  /** Model id active at session start. The user can switch models for the
   *  next session by changing it in AI Settings; current session stays
   *  pinned to its starting model so threads remain coherent. */
  model: string;
  messages: SessionMessage[];
  /** Running total of API tokens consumed by this session. */
  totalTokens: ChatTurnTokens;
  /** Same in $USD if pricing was available — accumulated client-side
   *  via OpenRouter's `pricing.prompt` / `pricing.completion` from /models. */
  totalCostUsd: number | null;
  /** v5.20 phase 5 — every advisory finding the model has emitted in
   *  this session, regardless of accept/dismiss status. The exporter
   *  (phase 6) reads from here. Optional on disk for backward compat
   *  with phase 4 sessions; readers default to []. */
  findings?: SessionFinding[];
  /** v5.20 phase 5 — record of which chip sets have been answered, so
   *  the chat re-renders past chip rows as inert "✓ <label>". */
  chipResponses?: SessionChipResponse[];
}

const sessionKey = (aiUserId: string) => `ils.ai.session.${aiUserId}.current`;

export function newSession(scope: AiScope, model: string): AiSession {
  return {
    id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    startedAt: Date.now(),
    scope,
    model,
    messages: [],
    totalTokens: { prompt: 0, completion: 0, total: 0 },
    totalCostUsd: null,
    findings: [],
    chipResponses: [],
  };
}

/** Update one finding's status (accept / dismiss). Returns a new session
 *  object — caller owns persistence. */
export function setFindingStatus(
  session: AiSession,
  findingId: string,
  status: FindingStatus,
): AiSession {
  const findings = (session.findings ?? []).map((f) =>
    f.id === findingId ? { ...f, status } : f,
  );
  return { ...session, findings };
}

/** Record a chip-click answer. Idempotent — if the chipSetId already has
 *  a response, the new one wins. */
export function recordChipResponse(
  session: AiSession,
  response: SessionChipResponse,
): AiSession {
  const existing = session.chipResponses ?? [];
  const filtered = existing.filter((r) => r.chipSetId !== response.chipSetId);
  return { ...session, chipResponses: [...filtered, response] };
}

/** Append findings extracted from a parsed assistant message. De-dupes
 *  by finding id (the parser produces stable ids derived from message
 *  id + block index). */
export function appendFindings(
  session: AiSession,
  newFindings: SessionFinding[],
): AiSession {
  if (!newFindings.length) return session;
  const existing = session.findings ?? [];
  const seen = new Set(existing.map((f) => f.id));
  const merged = [...existing];
  for (const f of newFindings) {
    if (!seen.has(f.id)) merged.push(f);
  }
  return { ...session, findings: merged };
}

export function readSession(aiUserId: string): AiSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(aiUserId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiSession;
    // Defensive: if the stored shape is missing required fields the user
    // probably upgraded across a breaking change — drop the corrupt
    // session rather than crash the chat panel.
    if (!parsed.id || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(aiUserId: string, session: AiSession): void {
  try {
    localStorage.setItem(sessionKey(aiUserId), JSON.stringify(session));
  } catch (e) {
    // Quota / private-mode / any storage failure — log and keep going.
    // The in-memory session is still valid; the user just can't resume
    // after a reload.
    console.warn('[ai/session] persist failed:', e);
  }
}

export function clearSession(aiUserId: string): void {
  try { localStorage.removeItem(sessionKey(aiUserId)); } catch { /* ignore */ }
}

export function nextMessageId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Trim a long session before persistence so localStorage doesn't bloat.
 * Keeps the system message + the most recent N turns. Phase 5 can add a
 * "compact older history" button that triggers a real summarization.
 */
export function trimForPersistence(session: AiSession, maxMessages = 200): AiSession {
  if (session.messages.length <= maxMessages) return session;
  // Always keep the first system message (if any) — losing it would
  // change the model's behaviour mid-session.
  const head = session.messages[0]?.role === 'system' ? [session.messages[0]] : [];
  const tail = session.messages.slice(-maxMessages + head.length);
  return { ...session, messages: [...head, ...tail] };
}
