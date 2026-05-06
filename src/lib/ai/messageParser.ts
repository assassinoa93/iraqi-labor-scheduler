/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Assistant-message parser (phase 5).
 *
 * The model emits two kinds of structured payloads inside fenced JSON
 * blocks: ```chips``` (interview questions with clickable answers) and
 * ```advisory``` (severity-tagged findings with evidence). Both formats
 * are taught to the model in the system prompt.
 *
 * Parsing is deliberately defensive — the model will sometimes emit
 * invalid JSON, miss the closing fence, or invent extra fields. When
 * the parse of a block fails we fall back to rendering the raw fence
 * as text so the user can still read it; the alternative (showing
 * nothing) would be confusing.
 *
 * The parser is pure and synchronous so it can run inside the message
 * renderer without async plumbing.
 */

import {
  type AdvisoryWire, adoptAdvisory,
  type ChipsWire, adoptChipSet,
  type SessionFinding, type ChipSet,
} from './findings';

// Regex matches ```<lang>\n<body>\n``` where lang ∈ {chips, advisory}.
// `[\s\S]*?` keeps the body match non-greedy so multiple fences in one
// message each get their own match.
const FENCE_RE = /```(chips|advisory)\s*\n([\s\S]*?)```/gi;

export type AssistantSegment =
  | { kind: 'text'; content: string }
  | { kind: 'chips'; chipSet: ChipSet }
  | { kind: 'advisory'; finding: SessionFinding }
  | { kind: 'invalid'; raw: string; reason: string };

export interface ParsedAssistantContent {
  segments: AssistantSegment[];
  /** New findings extracted from this content — the chat panel persists
   *  these into `session.findings` so they stay accessible even after
   *  the message scrolls away. */
  newFindings: SessionFinding[];
  /** New chip sets surfaced. Persistence is optional — chip sets live
   *  inline in the message, but the IDs are needed to de-dup. */
  chipSets: ChipSet[];
}

export function parseAssistantContent(
  content: string,
  sourceMessageId: string,
): ParsedAssistantContent {
  const segments: AssistantSegment[] = [];
  const newFindings: SessionFinding[] = [];
  const chipSets: ChipSet[] = [];

  if (!content) {
    return { segments, newFindings, chipSets };
  }

  let cursor = 0;
  let blockIndex = 0;
  // We iterate matches manually so we can capture text before/between fences.
  // Reset lastIndex defensively — regex object is module-scoped so multiple
  // invocations within a tick would otherwise share state.
  FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(content)) !== null) {
    const fullMatch = m[0];
    const lang = m[1].toLowerCase() as 'chips' | 'advisory';
    const body = m[2] ?? '';
    const start = m.index;

    if (start > cursor) {
      const text = content.slice(cursor, start);
      if (text.trim()) segments.push({ kind: 'text', content: text });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      segments.push({
        kind: 'invalid',
        raw: fullMatch,
        reason: `JSON parse failed: ${(e as Error).message}`,
      });
      cursor = start + fullMatch.length;
      blockIndex++;
      continue;
    }

    const stableId = `${sourceMessageId}-${lang}-${blockIndex}`;
    try {
      if (lang === 'advisory') {
        const wire = parsed as AdvisoryWire;
        const finding = adoptAdvisory(wire, { id: stableId, sourceMessageId });
        segments.push({ kind: 'advisory', finding });
        newFindings.push(finding);
      } else {
        const wire = parsed as ChipsWire;
        const chipSet = adoptChipSet(wire, { id: stableId, sourceMessageId });
        // Drop chip sets with no usable options — rendering them would
        // be a dead UI surface.
        if (chipSet.options.length === 0 || !chipSet.question) {
          segments.push({ kind: 'invalid', raw: fullMatch, reason: 'chip set missing question or options' });
        } else {
          segments.push({ kind: 'chips', chipSet });
          chipSets.push(chipSet);
        }
      }
    } catch (e) {
      segments.push({
        kind: 'invalid',
        raw: fullMatch,
        reason: `Block adoption failed: ${(e as Error).message}`,
      });
    }

    cursor = start + fullMatch.length;
    blockIndex++;
  }

  if (cursor < content.length) {
    const tail = content.slice(cursor);
    if (tail.trim()) segments.push({ kind: 'text', content: tail });
  }

  // If no fences were found, the entire content is one text segment.
  if (segments.length === 0 && content.trim()) {
    segments.push({ kind: 'text', content });
  }

  return { segments, newFindings, chipSets };
}
