/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Findings + chip responses (phase 5).
 *
 * Findings are the unit of advisory output: a severity-tagged,
 * evidence-backed recommendation the model emits via a fenced
 * ```advisory``` block. The parser turns each block into one
 * SessionFinding stored on the session.
 *
 * ChipResponses track which question-chip set the user has answered, so
 * the chat re-renders past chip rows as inert (✓ Slot bank) instead of
 * letting the user click again.
 *
 * Severity ladder mirrors the platform's existing compliance-finding
 * model (info / warning / violation). The user-locked compliance-
 * philosophy memory says: 'info' for legitimate operational situations,
 * 'violation' only for hard rule breaches.
 */

export type FindingSeverity = 'info' | 'warning' | 'violation';
export type FindingCategory = 'liability' | 'cost' | 'risk';
export type FindingStatus = 'pending' | 'accepted' | 'dismissed';

export interface FindingEvidence {
  /** Snapshot field path the AI is citing, e.g.
   *  `getPayroll{2026-04..06}[EMP-007].otHours`. Free-form — we don't
   *  parse it; the value is a transparency surface for the planner. */
  path: string;
  value: string;
}

export interface SessionFinding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  recommendation: string;
  evidence: FindingEvidence[];
  status: FindingStatus;
  /** Optional station / employee scope so the planner can filter. */
  stationId?: string;
  empId?: string;
  /** Epoch ms when the model emitted it. */
  ts: number;
  /** Message id of the assistant turn that emitted this finding —
   *  lets us de-dupe if the model accidentally repeats the same one. */
  sourceMessageId: string;
}

/** Wire shape the model is expected to emit inside a ```advisory``` fence. */
export interface AdvisoryWire {
  type: 'advisory';
  severity?: string;
  category?: string;
  title?: string;
  recommendation?: string;
  evidence?: Array<{ path?: unknown; value?: unknown } | unknown>;
  stationId?: string;
  empId?: string;
}

const VALID_SEVERITIES: FindingSeverity[] = ['info', 'warning', 'violation'];
const VALID_CATEGORIES: FindingCategory[] = ['liability', 'cost', 'risk'];

/** Coerce + validate a wire-format advisory into a SessionFinding. Throws
 *  on missing required fields so the parser can render the raw text
 *  instead. */
export function adoptAdvisory(
  wire: AdvisoryWire,
  meta: { id: string; sourceMessageId: string },
): SessionFinding {
  const severity = (typeof wire.severity === 'string' && VALID_SEVERITIES.includes(wire.severity as FindingSeverity))
    ? wire.severity as FindingSeverity
    : 'info';
  const category = (typeof wire.category === 'string' && VALID_CATEGORIES.includes(wire.category as FindingCategory))
    ? wire.category as FindingCategory
    : 'risk';
  const title = typeof wire.title === 'string' && wire.title.trim() ? wire.title.trim() : 'Untitled finding';
  const recommendation = typeof wire.recommendation === 'string' ? wire.recommendation.trim() : '';

  const evidence: FindingEvidence[] = [];
  if (Array.isArray(wire.evidence)) {
    for (const e of wire.evidence) {
      if (e && typeof e === 'object') {
        const ev = e as { path?: unknown; value?: unknown };
        const path = typeof ev.path === 'string' ? ev.path : '';
        const value = ev.value == null ? '' : String(ev.value);
        if (path) evidence.push({ path, value });
      }
    }
  }

  return {
    id: meta.id,
    severity,
    category,
    title,
    recommendation,
    evidence,
    status: 'pending',
    stationId: typeof wire.stationId === 'string' ? wire.stationId : undefined,
    empId: typeof wire.empId === 'string' ? wire.empId : undefined,
    ts: Date.now(),
    sourceMessageId: meta.sourceMessageId,
  };
}

// ─── Chip responses ────────────────────────────────────────────────────

/** Wire shape for a fenced ```chips``` block. */
export interface ChipsWire {
  type: 'chips';
  /** Stable id for this chip set. The UI relies on this for de-dup +
   *  "already answered" rendering. The model is told to use a stable id
   *  in the system prompt; if it omits one we synthesize from the
   *  source message id + block index. */
  id?: string;
  stationId?: string;
  /** Profile field the answer should write to (e.g. 'gameType'). When
   *  absent, the chip's `value` becomes a freeform user-message reply
   *  with no profile mutation. */
  field?: string;
  question?: string;
  options?: Array<{ label?: string; value?: unknown } | unknown>;
}

export interface ChipOption {
  label: string;
  value: string | null; // null → freeform follow-up
}

export interface ChipSet {
  id: string;
  stationId?: string;
  field?: string;
  question: string;
  options: ChipOption[];
  sourceMessageId: string;
}

export function adoptChipSet(
  wire: ChipsWire,
  meta: { id: string; sourceMessageId: string },
): ChipSet {
  const options: ChipOption[] = [];
  if (Array.isArray(wire.options)) {
    for (const o of wire.options) {
      if (o && typeof o === 'object') {
        const op = o as { label?: unknown; value?: unknown };
        const label = typeof op.label === 'string' ? op.label.trim() : '';
        if (!label) continue;
        const value = typeof op.value === 'string' ? op.value : null;
        options.push({ label, value });
      }
    }
  }
  return {
    id: typeof wire.id === 'string' && wire.id ? wire.id : meta.id,
    stationId: typeof wire.stationId === 'string' ? wire.stationId : undefined,
    field: typeof wire.field === 'string' ? wire.field : undefined,
    question: typeof wire.question === 'string' ? wire.question.trim() : '',
    options,
    sourceMessageId: meta.sourceMessageId,
  };
}

export interface SessionChipResponse {
  chipSetId: string;
  selected: string; // label of the chosen option
  ts: number;
}
