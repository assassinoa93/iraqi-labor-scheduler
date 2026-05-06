/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — OpenRouter tool-use loop.
 *
 * Drives a single conversational turn: send the message history + tool
 * schemas → receive an assistant reply with optional tool_calls →
 * execute the tools via the registry → feed results back as `tool` role
 * messages → loop until the model emits a final assistant message with
 * no further tool calls.
 *
 * Bounded by `maxIterations` so a misbehaving model (or a stuck tool)
 * can't run away with the user's wallet.
 *
 * The function streams progress via the supplied callbacks instead of
 * returning at the end — this lets the UI append messages and update
 * token usage as each iteration completes, even if a later iteration
 * throws.
 */

import { chat, type ChatMessage, type ChatTool, type ChatResponse } from './openrouter';
import { TOOLS, type ToolContext } from './tools';
import { estimateTokens, classify } from './tools/sizeEstimator';
import { nextMessageId, type SessionMessage } from './session';

export interface AgentRunOptions {
  apiKey: string;
  model: string;
  /** Tool schemas to expose. Usually `allToolSchemas()` from the registry. */
  tools: ChatTool[];
  /** When true, sets `provider.data_collection: 'deny'` on each request. */
  noTraining: boolean;
  /** Hard ceiling on iterations. 10 is plenty for the patterns we want. */
  maxIterations?: number;
  /** Sampling temperature. Default 0.3 — the design rules want low. */
  temperature?: number;
}

export interface AgentCallbacks {
  /** Fired for every message the loop appends (assistant + tool). The UI
   *  uses this to update the visible transcript progressively. */
  onMessage: (msg: SessionMessage) => void;
  /** Fired when the loop has reached a stable state (final assistant
   *  message OR error OR iteration cap). */
  onDone: (info: { reason: 'final' | 'maxIterations' | 'error'; error?: Error }) => void;
  /** Optional: pre-call hook so the UI can show "calling getCompliance…". */
  onToolCallStart?: (name: string, args: unknown) => void;
}

/**
 * Run the loop with the given message history. The history MUST already
 * include the system message + the user message that just arrived. The
 * loop appends new messages via `onMessage`; the caller is responsible
 * for persisting them (this keeps the function pure-ish and testable).
 */
export async function runAgentLoop(
  initialMessages: ChatMessage[],
  ctx: ToolContext,
  opts: AgentRunOptions,
  cb: AgentCallbacks,
): Promise<{ messages: ChatMessage[] }> {
  const messages: ChatMessage[] = [...initialMessages];
  const maxIterations = opts.maxIterations ?? 10;
  let iter = 0;

  try {
    while (iter < maxIterations) {
      iter++;

      let response: ChatResponse;
      try {
        response = await chat(opts.apiKey, {
          model: opts.model,
          messages,
          tools: opts.tools,
          temperature: opts.temperature ?? 0.3,
          noTraining: opts.noTraining,
        });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        cb.onDone({ reason: 'error', error: err });
        return { messages };
      }

      const choice = response.choices[0];
      const reply = choice?.message;
      if (!reply) {
        const err = new Error('OpenRouter returned no message');
        cb.onDone({ reason: 'error', error: err });
        return { messages };
      }

      const tokens = response.usage
        ? {
            prompt: response.usage.prompt_tokens,
            completion: response.usage.completion_tokens,
            total: response.usage.total_tokens,
          }
        : undefined;

      const assistantMsg: SessionMessage = {
        id: nextMessageId(),
        ts: Date.now(),
        role: 'assistant',
        content: reply.content ?? '',
        tool_calls: reply.tool_calls,
        tokens,
      };
      messages.push({
        role: 'assistant',
        content: reply.content ?? null,
        tool_calls: reply.tool_calls,
      });
      cb.onMessage(assistantMsg);

      // No tool calls = model finished its turn.
      if (!reply.tool_calls || reply.tool_calls.length === 0) {
        cb.onDone({ reason: 'final' });
        return { messages };
      }

      // Run each requested tool. We run them sequentially — they're
      // pure-ish reads of CompanyData with no I/O, so parallelism wouldn't
      // win much and sequential keeps the message order intuitive.
      for (const tc of reply.tool_calls) {
        const name = tc.function.name;
        let args: unknown;
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = {};
        }
        cb.onToolCallStart?.(name, args);

        const tool = TOOLS[name];
        let resultPayload: unknown;
        let toolErr = false;
        let estimateTokensUsed = 0;
        let verdict: 'comfortable' | 'soft' | 'hard' | 'over' = 'comfortable';
        if (!tool) {
          resultPayload = { error: `Unknown tool: ${name}` };
          toolErr = true;
        } else {
          try {
            const out = await tool.run(args, ctx);
            resultPayload = out.data;
            estimateTokensUsed = out.tokens;
            verdict = out.verdict;
          } catch (e) {
            resultPayload = { error: (e as Error).message };
            toolErr = true;
          }
        }

        const serialized = (() => {
          try { return JSON.stringify(resultPayload); }
          catch { return String(resultPayload); }
        })();
        if (!estimateTokensUsed) estimateTokensUsed = estimateTokens(resultPayload);
        if (verdict === 'comfortable') verdict = classify(estimateTokensUsed);

        const toolMsg: SessionMessage = {
          id: nextMessageId(),
          ts: Date.now(),
          role: 'tool',
          content: serialized,
          tool_call_id: tc.id,
          name,
          toolEstimateTokens: estimateTokensUsed,
          toolVerdict: verdict,
          toolError: toolErr,
        };
        messages.push({
          role: 'tool',
          content: serialized,
          tool_call_id: tc.id,
          name,
        });
        cb.onMessage(toolMsg);
      }
      // Loop again so the model can react to the tool results.
    }

    cb.onDone({ reason: 'maxIterations' });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    cb.onDone({ reason: 'error', error: err });
  }
  return { messages };
}
