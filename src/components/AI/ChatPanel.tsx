/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — AI chat panel.
 *
 * Renders the conversation, accepts user input, drives the agent loop.
 * Sits inside the Configured Key state of AIServicesTab — the panel
 * itself doesn't read the API key, the parent threads it down so the
 * key is fetched once per turn from `safeStorage` and discarded after
 * the request.
 *
 * Phase 5 surfaces:
 *   - Plain text input + send
 *   - Tool-use loop runs to completion per turn
 *   - Tool calls appear inline as collapsed cards
 *   - Question chips parsed from fenced ```chips``` blocks; clicking a
 *     chip writes the picked value to the station profile (via the
 *     dual-mode store) and posts a synthetic user reply
 *   - Advisory finding cards parsed from fenced ```advisory``` blocks
 *     with accept / dismiss / ask-more actions
 *   - "Run full advisory pass" button that asks the model to walk every
 *     station in scope and emit one ```advisory``` block per finding
 *   - New session button (clears local persistence + findings)
 *   - Scope-change broadcast appended as a system message
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send, Loader2, Sparkles, Wrench, AlertTriangle,
  RotateCcw, ChevronDown, ChevronRight, User as UserIcon,
  ListChecks, FileDown,
} from 'lucide-react';
import type { CompanyData } from '../../types';
import { aiKeyStore } from '../../lib/ai/keyStorage';
import { allToolSchemas, type ToolContext } from '../../lib/ai/tools';
import { runAgentLoop } from '../../lib/ai/agentLoop';
import { buildSystemPrompt, buildScopeChangeNotice } from '../../lib/ai/systemPrompt';
import {
  type AiSession, type SessionMessage,
  newSession, readSession, writeSession, clearSession,
  nextMessageId, trimForPersistence,
  appendFindings, setFindingStatus, recordChipResponse,
} from '../../lib/ai/session';
import type { AiScope } from '../../lib/ai/scope';
import { listAvailableData, type DataSurvey } from '../../lib/ai/dataSurvey';
import type { ChatMessage } from '../../lib/ai/openrouter';
import { parseAssistantContent } from '../../lib/ai/messageParser';
import {
  type SessionFinding, type ChipSet, type ChipOption,
  type SessionChipResponse, type FindingStatus,
} from '../../lib/ai/findings';
import { ChipsBlock } from './ChipsBlock';
import { AdvisoryCard } from './AdvisoryCard';
import { generateAiAdvisoryReport } from '../../lib/ai/aiPdfReport';

interface Props {
  aiUserId: string;
  /** OpenRouter model id from the user's prefs. */
  model: string | null;
  noTraining: boolean;
  ctx: ToolContext;
  scope: AiScope;
  companyData: CompanyData;
}

const FULL_ADVISORY_PROMPT = [
  'Run a full advisory pass over every station and the active session scope.',
  '',
  '- Walk through schedules, payroll, leave, compliance, and WFP within scope.',
  '- Emit one ```advisory``` fenced block PER finding. Do not bundle multiple findings into one block.',
  '- For each finding, pick severity (info / warning / violation), category (liability / cost / risk), and cite snapshot field paths as evidence.',
  '- Skip stations whose profile confidence is below 40 — list them at the end as "needs interview" instead of advising.',
  '- Do NOT ask interview questions in this pass. Treat profile data as it is.',
  '- Be terse. The planner will read every finding.',
].join('\n');

export function ChatPanel({
  aiUserId, model, noTraining, ctx, scope, companyData,
}: Props) {
  const [session, setSession] = useState<AiSession | null>(null);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const lastBroadcastScopeRef = useRef<string>('');
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Hydrate persisted session on mount; otherwise create a new one anchored
  // to the current scope + selected model. Snapshot the scope at session
  // start (the locked decision: scope is per-session).
  useEffect(() => {
    const existing = readSession(aiUserId);
    if (existing) {
      setSession(existing);
    } else if (model) {
      setSession(newSession(scope, model));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiUserId]);

  useEffect(() => {
    if (session) writeSession(aiUserId, trimForPersistence(session));
  }, [aiUserId, session]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [session?.messages.length]);

  // Detect mid-session scope changes and append a system-marker message
  // so the model re-grounds. Only fires after first render and only when
  // the scope JSON actually differs.
  useEffect(() => {
    if (!session) return;
    const key = JSON.stringify(scope);
    if (!lastBroadcastScopeRef.current) {
      lastBroadcastScopeRef.current = key;
      return;
    }
    if (lastBroadcastScopeRef.current === key) return;
    const prevKey = lastBroadcastScopeRef.current;
    lastBroadcastScopeRef.current = key;

    let prevScope: AiScope = scope;
    try { prevScope = JSON.parse(prevKey) as AiScope; } catch { /* fallback */ }
    const notice = buildScopeChangeNotice(prevScope, scope);
    const msg: SessionMessage = {
      id: nextMessageId(),
      ts: Date.now(),
      role: 'system',
      content: notice,
    };
    setSession((s) => s ? { ...s, messages: [...s.messages, msg] } : s);
  }, [scope, session]);

  // Core message-send entry point. Used by the input box, chip clicks,
  // ask-more, and Run full advisory pass — they all just hand text in.
  const sendMessage = async (text: string) => {
    if (!text.trim() || running || !session || !model) return;
    setError(null);

    const survey: DataSurvey = listAvailableData(companyData, Object.keys(ctx.profiles).length);
    const hasSystem = session.messages.some((m) => m.role === 'system');
    const systemMsg: SessionMessage | null = hasSystem ? null : {
      id: nextMessageId(),
      ts: Date.now(),
      role: 'system',
      content: buildSystemPrompt(survey, scope),
    };

    const userMsg: SessionMessage = {
      id: nextMessageId(),
      ts: Date.now(),
      role: 'user',
      content: text.trim(),
    };

    const baseMessages = [
      ...(systemMsg ? [systemMsg] : []),
      ...session.messages,
      userMsg,
    ];

    setSession((s) => s ? { ...s, messages: baseMessages } : s);
    setRunning(true);
    setActiveTool(null);

    let apiKey: string | null = null;
    try {
      apiKey = await aiKeyStore.getKey(aiUserId);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
      return;
    }
    if (!apiKey) {
      setError('No OpenRouter key on file. Re-paste it in AI Settings.');
      setRunning(false);
      return;
    }

    const apiMessages: ChatMessage[] = baseMessages.map((m) => {
      const out: ChatMessage = { role: m.role, content: m.content };
      if (m.tool_calls) out.tool_calls = m.tool_calls;
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      if (m.name) out.name = m.name;
      return out;
    });

    await runAgentLoop(
      apiMessages,
      ctx,
      {
        apiKey,
        model,
        tools: allToolSchemas(),
        noTraining,
      },
      {
        onMessage: (m) => {
          // For assistant messages, parse out any fenced advisory blocks
          // and append them to session.findings so the renderer + future
          // exporter both see a stable list.
          let extracted: SessionFinding[] = [];
          if (m.role === 'assistant' && m.content) {
            const parsed = parseAssistantContent(m.content, m.id);
            extracted = parsed.newFindings;
          }
          setSession((s) => {
            if (!s) return s;
            const withMessage: AiSession = {
              ...s,
              messages: [...s.messages, m],
              totalTokens: m.tokens
                ? {
                    prompt: s.totalTokens.prompt + m.tokens.prompt,
                    completion: s.totalTokens.completion + m.tokens.completion,
                    total: s.totalTokens.total + m.tokens.total,
                  }
                : s.totalTokens,
            };
            return extracted.length ? appendFindings(withMessage, extracted) : withMessage;
          });
        },
        onToolCallStart: (name) => setActiveTool(name),
        onDone: ({ reason, error: err }) => {
          setRunning(false);
          setActiveTool(null);
          if (err) setError(err.message);
          else if (reason === 'maxIterations') {
            setError('The assistant hit the iteration cap. Send another message to continue, or start a new session.');
          }
        },
      },
    );
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    await sendMessage(text);
  };

  const handleNewSession = () => {
    if (!model) return;
    clearSession(aiUserId);
    setSession(newSession(scope, model));
    setError(null);
    lastBroadcastScopeRef.current = JSON.stringify(scope);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ── Chip + advisory action handlers ────────────────────────────────────

  const handleChipPick = async (chipSet: ChipSet, option: ChipOption) => {
    if (!session) return;
    // Record the response so the chip set re-renders inert.
    const response: SessionChipResponse = {
      chipSetId: chipSet.id,
      selected: option.label,
      ts: Date.now(),
    };
    setSession((s) => s ? recordChipResponse(s, response) : s);

    // Persist the picked value to the station profile when the chip set
    // declared a target field. Null-value chips are "I will type" escapes
    // — no profile mutation, just nudge the user's focus to the input.
    if (option.value && chipSet.field && chipSet.stationId) {
      try {
        await ctx.updateProfile(chipSet.stationId, {
          [chipSet.field]: option.value,
        } as Partial<{ [k: string]: unknown }>);
      } catch (e) {
        setError(`Profile write failed: ${(e as Error).message}`);
      }
    }

    if (option.value === null) {
      // Freeform path — focus the input box for the user.
      const ta = document.querySelector('textarea[aria-label="ai-chat-input"]') as HTMLTextAreaElement | null;
      ta?.focus();
      return;
    }

    // Send a synthetic user reply naming the choice.
    const replyParts: string[] = [];
    if (chipSet.stationId) replyParts.push(`For station ${chipSet.stationId}:`);
    replyParts.push(`I picked "${option.label}".`);
    if (chipSet.field) replyParts.push(`(Profile field "${chipSet.field}" updated to "${option.value}".)`);
    await sendMessage(replyParts.join(' '));
  };

  const handleSetFindingStatus = (findingId: string, status: FindingStatus) => {
    setSession((s) => s ? setFindingStatus(s, findingId, status) : s);
  };

  const handleAskMore = (finding: SessionFinding) => {
    const refTokens: string[] = [`finding "${finding.title}"`];
    if (finding.stationId) refTokens.push(`station ${finding.stationId}`);
    void sendMessage(`Tell me more about ${refTokens.join(' on ')}. What's the strongest evidence and what would the impact of acting on it be?`);
  };

  const handleRunFullAdvisoryPass = () => {
    void sendMessage(FULL_ADVISORY_PROMPT);
  };

  const handleExport = (includePending: boolean) => {
    if (!session) return;
    try {
      generateAiAdvisoryReport(session, {
        companyName: companyData.config.company || 'Workspace',
        includePending,
      });
    } catch (e) {
      setError(`PDF export failed: ${(e as Error).message}`);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (!model) {
    return (
      <div className="p-5 bg-amber-50/60 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-300 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800 dark:text-amber-200">Pick a model first</p>
            <p className="text-xs text-amber-700 dark:text-amber-300/80 mt-0.5">
              Choose a model in AI Settings (above) before starting a chat. The chat will pin to that model for the session.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const findings = session?.findings ?? [];
  const chipResponses = session?.chipResponses ?? [];
  const acceptedCount = findings.filter((f) => f.status === 'accepted').length;
  const pendingCount = findings.filter((f) => f.status === 'pending').length;
  const exportable = acceptedCount + pendingCount > 0;

  return (
    <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/70 rounded-2xl shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 text-amber-500 dark:text-amber-300" />
          <h4 className="text-xs font-black text-slate-700 dark:text-slate-100 uppercase tracking-widest">
            Chat
          </h4>
          {session && session.messages.length > 0 && (
            <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest font-mono">
              {session.totalTokens.total.toLocaleString()} tok · {session.messages.filter((m) => m.role !== 'system').length} msg
            </span>
          )}
          {findings.length > 0 && (
            <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              · {findings.length} finding{findings.length === 1 ? '' : 's'}
              {acceptedCount > 0 && <span className="text-emerald-600 dark:text-emerald-300"> · {acceptedCount} accepted</span>}
              {pendingCount > 0 && <span className="text-amber-600 dark:text-amber-300"> · {pendingCount} pending</span>}
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleRunFullAdvisoryPass}
            disabled={running}
            className="apple-press inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-200 border border-amber-200 dark:border-amber-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-amber-100 dark:hover:bg-amber-500/25 disabled:opacity-50"
            title="Walk every station in scope and emit one finding per issue"
          >
            <ListChecks className="w-3 h-3" />
            Run full advisory pass
          </button>
          <ExportButton
            disabled={running || !exportable}
            acceptedCount={acceptedCount}
            pendingCount={pendingCount}
            onExport={handleExport}
          />
          <button
            onClick={handleNewSession}
            disabled={running}
            className="apple-press inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3" />
            New session
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="space-y-3 max-h-[560px] overflow-y-auto pr-1"
        aria-label="Chat history"
      >
        {(!session || session.messages.filter((m) => m.role !== 'system').length === 0) && (
          <EmptyChat />
        )}
        {session?.messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            findings={findings}
            chipResponses={chipResponses}
            onChipPick={handleChipPick}
            onSetFindingStatus={handleSetFindingStatus}
            onAskMore={handleAskMore}
            disabled={running}
          />
        ))}
        {running && (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-2 py-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{activeTool ? `Calling ${activeTool}…` : 'Thinking…'}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 rounded-lg">
          <p className="text-[11px] font-bold text-rose-700 dark:text-rose-200">{error}</p>
        </div>
      )}

      <div className="space-y-2">
        <textarea
          aria-label="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the assistant — e.g. 'walk me through April OT pressure'"
          rows={3}
          disabled={running}
          className="w-full px-3 py-2 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all resize-y disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[10px] text-slate-400 dark:text-slate-500">
            Cmd/Ctrl+Enter to send · model: <span className="font-mono">{model}</span> · {noTraining ? 'no-training on' : 'no-training off'}
          </p>
          <button
            onClick={handleSend}
            disabled={running || !input.trim()}
            className="apple-press inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 shadow-md shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="text-center py-8 px-4">
      <Sparkles className="w-8 h-8 text-amber-400 dark:text-amber-300 mx-auto mb-3 opacity-60" />
      <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Start a conversation</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto leading-relaxed">
        Try: <em>&quot;walk me through April OT pressure&quot;</em> or <em>&quot;which stations need profile interviews?&quot;</em>. The assistant will use your scope above and call tools to ground its answers in real data.
      </p>
    </div>
  );
}

interface MessageRowProps {
  message: SessionMessage;
  findings: SessionFinding[];
  chipResponses: SessionChipResponse[];
  onChipPick: (chipSet: ChipSet, option: ChipOption) => void;
  onSetFindingStatus: (id: string, status: FindingStatus) => void;
  onAskMore: (finding: SessionFinding) => void;
  disabled: boolean;
}

function MessageRow({
  message, findings, chipResponses, onChipPick, onSetFindingStatus, onAskMore, disabled,
}: MessageRowProps) {
  if (message.role === 'system') return <SystemMarker message={message} />;
  if (message.role === 'tool') return <ToolResult message={message} />;
  if (message.role === 'assistant') {
    return (
      <AssistantBubble
        message={message}
        findings={findings}
        chipResponses={chipResponses}
        onChipPick={onChipPick}
        onSetFindingStatus={onSetFindingStatus}
        onAskMore={onAskMore}
        disabled={disabled}
      />
    );
  }
  return <UserBubble message={message} />;
}

function UserBubble({ message }: { message: SessionMessage }) {
  return (
    <div className="flex gap-3 justify-end">
      <div className="max-w-[80%] bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-2 shadow-md shadow-blue-500/20">
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      </div>
      <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-300 shrink-0">
        <UserIcon className="w-3.5 h-3.5" />
      </div>
    </div>
  );
}

function AssistantBubble({
  message, findings, chipResponses, onChipPick, onSetFindingStatus, onAskMore, disabled,
}: {
  message: SessionMessage;
  findings: SessionFinding[];
  chipResponses: SessionChipResponse[];
  onChipPick: (chipSet: ChipSet, option: ChipOption) => void;
  onSetFindingStatus: (id: string, status: FindingStatus) => void;
  onAskMore: (finding: SessionFinding) => void;
  disabled: boolean;
}) {
  const hasContent = !!(message.content && message.content.trim());
  const hasToolCalls = !!(message.tool_calls && message.tool_calls.length > 0);

  // Parse fences out of the content. The parser is pure + cheap; running
  // it on every render is fine for the message volumes we expect.
  const parsed = useMemo(
    () => parseAssistantContent(message.content ?? '', message.id),
    [message.content, message.id],
  );

  const responseByChipId = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of chipResponses) m.set(r.chipSetId, r.selected);
    return m;
  }, [chipResponses]);

  const findingById = useMemo(() => {
    const m = new Map<string, SessionFinding>();
    for (const f of findings) m.set(f.id, f);
    return m;
  }, [findings]);

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-300 shrink-0">
        <Sparkles className="w-3.5 h-3.5" />
      </div>
      <div className="max-w-[80%] flex-1 min-w-0 space-y-2">
        {hasContent && parsed.segments.map((seg, i) => {
          if (seg.kind === 'text') {
            return (
              <div key={i} className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-2xl rounded-bl-sm px-4 py-2">
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{seg.content.trim()}</p>
              </div>
            );
          }
          if (seg.kind === 'chips') {
            return (
              <ChipsBlock
                key={i}
                chipSet={seg.chipSet}
                selected={responseByChipId.get(seg.chipSet.id) ?? null}
                disabled={disabled}
                onPick={(opt) => onChipPick(seg.chipSet, opt)}
              />
            );
          }
          if (seg.kind === 'advisory') {
            // Read the canonical finding from session state — its status
            // (accepted / dismissed) lives there, not in the parsed copy.
            const live = findingById.get(seg.finding.id) ?? seg.finding;
            return (
              <AdvisoryCard
                key={i}
                finding={live}
                onSetStatus={onSetFindingStatus}
                onAskMore={onAskMore}
                disabled={disabled}
              />
            );
          }
          // Invalid block — show a small warning so the user can copy
          // the raw fence and figure out what the model meant.
          return (
            <details key={i} className="bg-slate-100 dark:bg-slate-800/60 rounded-lg px-3 py-2">
              <summary className="text-[10px] font-bold text-rose-600 dark:text-rose-300 cursor-pointer">
                Couldn&apos;t parse a structured block: {seg.reason}
              </summary>
              <pre className="mt-2 text-[10px] font-mono text-slate-500 dark:text-slate-400 whitespace-pre-wrap">{seg.raw}</pre>
            </details>
          );
        })}
        {hasToolCalls && (
          <div className="space-y-1">
            {message.tool_calls!.map((tc) => (
              <div key={tc.id} className="text-[10px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Wrench className="w-2.5 h-2.5" />
                <span>calling <span className="font-bold text-slate-700 dark:text-slate-200">{tc.function.name}</span></span>
              </div>
            ))}
          </div>
        )}
        {message.tokens && (
          <p className="text-[9px] text-slate-400 dark:text-slate-500 font-mono">
            {message.tokens.total.toLocaleString()} tok ({message.tokens.prompt} in / {message.tokens.completion} out)
          </p>
        )}
      </div>
    </div>
  );
}

function ToolResult({ message }: { message: SessionMessage }) {
  const [open, setOpen] = useState(false);
  const verdictColor = {
    comfortable: 'text-emerald-600 dark:text-emerald-300',
    soft: 'text-amber-600 dark:text-amber-300',
    hard: 'text-rose-600 dark:text-rose-300',
    over: 'text-rose-700 dark:text-rose-200 font-black',
  }[message.toolVerdict ?? 'comfortable'];
  return (
    <div className="ms-10 max-w-[80%]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {message.toolError ? (
          <AlertTriangle className="w-3 h-3 text-rose-500" />
        ) : (
          <Wrench className="w-3 h-3" />
        )}
        <span className="font-bold">{message.name ?? 'tool'}</span>
        <span className={verdictColor}>≈ {(message.toolEstimateTokens ?? 0).toLocaleString()} tok</span>
        <span className="text-slate-400 dark:text-slate-500">{message.toolError ? '(error)' : '(result)'}</span>
      </button>
      {open && (
        <pre className="mt-1 text-[10px] font-mono p-3 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-700/70 rounded-lg overflow-x-auto max-h-64 overflow-y-auto text-slate-700 dark:text-slate-300">
{prettifyToolContent(message.content)}
        </pre>
      )}
    </div>
  );
}

function prettifyToolContent(raw: string | null): string {
  if (!raw) return '';
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
}

function ExportButton({
  disabled, acceptedCount, pendingCount, onExport,
}: {
  disabled: boolean;
  acceptedCount: number;
  pendingCount: number;
  onExport: (includePending: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const noFindings = acceptedCount + pendingCount === 0;
  const noAccepted = acceptedCount === 0;

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title={noFindings ? 'Nothing to export — accept findings or run a full pass first' : 'Export findings as PDF'}
        className="apple-press inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 dark:hover:bg-emerald-500/25 disabled:opacity-50"
      >
        <FileDown className="w-3 h-3" />
        Export PDF
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute end-0 top-full mt-1 z-20 w-64 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xl p-1.5">
          <button
            onClick={() => { setOpen(false); onExport(false); }}
            disabled={noAccepted}
            className="w-full text-start px-3 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <p className="text-xs font-bold text-slate-700 dark:text-slate-100">Accepted only</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              {acceptedCount} finding{acceptedCount === 1 ? '' : 's'} · the curated action plan
            </p>
          </button>
          <button
            onClick={() => { setOpen(false); onExport(true); }}
            className="w-full text-start px-3 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <p className="text-xs font-bold text-slate-700 dark:text-slate-100">Accepted + pending</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              {acceptedCount + pendingCount} finding{acceptedCount + pendingCount === 1 ? '' : 's'} · includes still under review
            </p>
          </button>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 px-3 pt-2 pb-1 border-t border-slate-100 dark:border-slate-800 mt-1">
            Dismissed findings are always excluded. Report is generated in English.
          </p>
        </div>
      )}
    </div>
  );
}

function SystemMarker({ message }: { message: SessionMessage }) {
  const [open, setOpen] = useState(false);
  const preview = (message.content ?? '').split('\n').find(Boolean) ?? 'system';
  return (
    <div className="text-center">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>system: {preview.replace(/[#*]/g, '').slice(0, 60)}{preview.length > 60 ? '…' : ''}</span>
      </button>
      {open && (
        <pre className="mt-2 text-left text-[10px] font-mono p-3 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-700/70 rounded-lg overflow-x-auto max-h-64 overflow-y-auto text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
{message.content ?? ''}
        </pre>
      )}
    </div>
  );
}
