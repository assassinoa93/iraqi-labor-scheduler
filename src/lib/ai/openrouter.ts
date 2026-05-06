/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Thin OpenRouter HTTP adapter.
 *
 * Each call accepts the plaintext API key as an argument so this module
 * holds no key state of its own. Callers fetch the key from the Electron
 * safeStorage bridge (lib/ai/keyStorage.ts) immediately before the call
 * and let it fall out of scope after.
 *
 * The adapter is provider-agnostic on the wire: OpenRouter speaks an
 * OpenAI-compatible chat-completions schema, so future LM Studio / direct-
 * Anthropic / direct-OpenAI adapters can share the same ChatMessage /
 * ChatTool types without a rewrite at the call site.
 */

const BASE = 'https://openrouter.ai/api/v1';

// Identifies the app to OpenRouter for their dashboard / leaderboard.
// Public, not secret.
const APP_HEADERS = {
  'HTTP-Referer': 'https://github.com/assassinoa93/iraqi-labor-scheduler',
  'X-Title': 'Iraqi Labor Scheduler',
};

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  // OpenRouter exposes prices as USD-per-token strings (e.g. "0.000003").
  // Multiply by 1e6 to get the conventional $/Mtok rate.
  pricing?: { prompt: string; completion: string };
  architecture?: { modality?: string; tokenizer?: string };
  // Set on models that accept the chat-completions `tools` array. Critical
  // for the v5.20+ tool-use loop — non-tool models can't drive the
  // interview / advisory pattern.
  supported_parameters?: string[];
}

export interface OpenRouterKeyInfo {
  label: string | null;
  // Cumulative spend in USD on this key.
  usage: number;
  // Hard cap in USD; null = unlimited.
  limit: number | null;
  is_free_tier: boolean;
  rate_limit?: { requests: number; interval: string };
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  // Tool-use plumbing — present on assistant messages that emit tool
  // calls, and on tool messages that respond to one.
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  max_tokens?: number;
  /** When true, pins `provider.data_collection: 'deny'` so upstream
   * model providers can't train on the request. Default in the UI. */
  noTraining?: boolean;
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: Array<{
    finish_reason: string;
    message: ChatMessage;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function asError(res: Response): Promise<Error> {
  let detail = '';
  try { detail = await res.text(); } catch { /* best-effort */ }
  // Strip whitespace + trim runaway HTML so the toast doesn't render a
  // 200-line stack trace from the upstream provider.
  const trimmed = detail.replace(/\s+/g, ' ').trim().slice(0, 400);
  const err = new Error(`OpenRouter ${res.status}: ${trimmed || res.statusText}`);
  (err as Error & { status: number }).status = res.status;
  return err;
}

/**
 * Pull the full model catalog. The list is large (~300 entries) and
 * stable enough to cache in localStorage at the call site.
 */
export async function listModels(apiKey: string): Promise<OpenRouterModel[]> {
  const res = await fetch(`${BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, ...APP_HEADERS },
  });
  if (!res.ok) throw await asError(res);
  const json = (await res.json()) as { data: OpenRouterModel[] };
  return json.data ?? [];
}

/**
 * Live key info — usage so far, hard limit, free-tier flag. Used to
 * render the spend readout in AI Settings.
 */
export async function getKeyInfo(apiKey: string): Promise<OpenRouterKeyInfo> {
  const res = await fetch(`${BASE}/auth/key`, {
    headers: { Authorization: `Bearer ${apiKey}`, ...APP_HEADERS },
  });
  if (!res.ok) throw await asError(res);
  const json = (await res.json()) as { data: OpenRouterKeyInfo };
  return json.data;
}

/**
 * Single non-streaming chat completion. The renderer side will wrap
 * this in the tool-use loop in step 4 of the build.
 */
export async function chat(apiKey: string, opts: ChatOptions): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.tools && opts.tools.length) body.tools = opts.tools;
  if (opts.max_tokens) body.max_tokens = opts.max_tokens;
  if (opts.noTraining) body.provider = { data_collection: 'deny' };

  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...APP_HEADERS,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as ChatResponse;
}

/**
 * Lightweight key-validation ping used by the Settings panel after a
 * paste. Hits the cheapest endpoint that 401s on a bad key (`/auth/key`),
 * returns true on 200, throws on transport failure, returns false on a
 * 401/403. Lets the UI distinguish "bad key" from "you're offline".
 */
export async function validateKey(apiKey: string): Promise<boolean> {
  try {
    await getKeyInfo(apiKey);
    return true;
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    if (status === 401 || status === 403) return false;
    throw e;
  }
}

/**
 * Convert OpenRouter's per-token price string into the conventional
 * USD-per-million-tokens display number. Returns null when the model
 * doesn't expose pricing (free / preview models do this).
 */
export function pricePerMtok(model: OpenRouterModel): { prompt: number | null; completion: number | null } {
  const p = model.pricing;
  if (!p) return { prompt: null, completion: null };
  const parse = (s: string | undefined) => {
    if (!s) return null;
    const n = Number(s);
    return isFinite(n) ? n * 1_000_000 : null;
  };
  return { prompt: parse(p.prompt), completion: parse(p.completion) };
}

export function supportsTools(model: OpenRouterModel): boolean {
  return Array.isArray(model.supported_parameters) && model.supported_parameters.includes('tools');
}
