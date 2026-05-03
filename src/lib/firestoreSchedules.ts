/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 2.3 — schedules in Firestore with cell-level concurrency.
 *
 * Document layout:
 *   /companies/{companyId}/schedules/{YYYY-MM}
 *     entries: Record<empId, Record<dayOfMonth, ScheduleEntry>>
 *     updatedAt: Timestamp
 *     updatedBy: string
 *
 * Why one doc per month (not per day or per cell):
 *   - Reads are dominated by "show me this employee's whole month" queries;
 *     a single doc fits the access pattern with one Firestore read.
 *   - 60 employees × 31 days × ~30 bytes per entry ≈ 56 KB, well under
 *     Firestore's 1 MiB doc limit.
 *
 * Why field-path updates (not full setDoc):
 *   - Two supervisors editing different cells in the same month must NOT
 *     clobber each other. updateDoc with `entries.{empId}.{day}` patches
 *     a single nested key atomically. Same-cell collisions still
 *     last-writer-win, but those are rare and the audit log captures both.
 *
 * Threshold for full-replace:
 *   - For diff sizes ≥200 changed cells (auto-scheduler, clear-month),
 *     fall back to setDoc with the whole entries map. Per-field updateDoc
 *     has a 500-field limit; staying under 200 keeps headroom and one
 *     full-replace is cheaper than 500 individual patches anyway.
 */

import type { Unsubscribe } from 'firebase/firestore';
import type { Schedule, ScheduleEntry } from '../types';
import type { Role } from './auth';
import { getDb } from './firestoreClient';
import {
  isValidTransition, stampPrefixForAction, buildHistoryEntry,
  type TransitionResult,
} from './scheduleApproval';

const SUBCOLLECTION = 'schedules';
const FULL_REPLACE_THRESHOLD = 200;

// ── v5.0 approval workflow types ──────────────────────────────────────────
//
// Status lifecycle:
//   draft → submitted → locked → saved
//                ↓        ↓        ↑
//              rejected  send-back reopen
//                ↓
//              draft (auto on first supervisor edit)
//
// All approval fields are optional — a missing `approval` block means
// `'draft'` for backward compatibility with pre-v5.0 schedules.

export type ApprovalStatus =
  | 'draft'      // supervisor editing
  | 'submitted'  // awaiting manager validation; cells read-only
  | 'rejected'   // manager / admin sent back; cells editable; flag clears on first supervisor edit
  | 'locked'     // manager has validated; awaiting admin finalization; cells read-only
  | 'saved';     // admin has finalized; HRIS-ready; immutable snapshot in /snapshots subcollection

export type ApprovalAction =
  | 'submit' | 'lock' | 'save' | 'send-back' | 'reopen';

export interface ApprovalHistoryEntry {
  action: ApprovalAction;
  ts: unknown;             // serverTimestamp at write time
  actor: string;           // uid
  actorEmail: string | null;
  role: Role;
  notes?: string;
  destinationStatus?: ApprovalStatus;  // for send-back / reopen — which state we returned to
}

export interface ApprovalBlock {
  status: ApprovalStatus;
  // Per-stage stamps (optional, populated as the workflow advances).
  submittedAt?: unknown;
  submittedBy?: string;
  submittedNotes?: string;
  lockedAt?: unknown;
  lockedBy?: string;
  lockedNotes?: string;
  savedAt?: unknown;
  savedBy?: string;
  savedNotes?: string;
  rejectedAt?: unknown;
  rejectedBy?: string;
  rejectedNotes?: string;
  rejectedFrom?: 'manager' | 'admin';   // which level sent it back
  // Append-only audit lineage. Every transition pushes one entry.
  history?: ApprovalHistoryEntry[];
}

export interface HrisSyncBlock {
  lastExportedAt?: unknown;
  lastExportedBy?: string;
  method?: 'manual-bundle';   // future: 'webhook', 'sap', etc.
  notes?: string;
}

interface FirestoreScheduleDoc {
  entries?: Schedule;
  updatedAt?: unknown;
  updatedBy?: string;
  // v5.0 — approval workflow state. Missing = 'draft'.
  approval?: ApprovalBlock;
  // v5.1 — HRIS export tracking. Missing = never exported.
  hrisSync?: HrisSyncBlock;
}

/**
 * Convert legacy in-memory key → Firestore doc ID.
 *   "scheduler_schedule_2026_04"  →  "2026-04"
 */
export function scheduleKeyToFirestoreId(key: string): string | null {
  const m = /^scheduler_schedule_(\d{4})_(\d{1,2})$/.exec(key);
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}`;
}

export function firestoreIdToScheduleKey(id: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(id);
  if (!m) return null;
  return `scheduler_schedule_${m[1]}_${Number(m[2])}`;
}

/**
 * Build the Firestore doc ID for a (year, month) pair, e.g. (2026, 4) → "2026-04".
 */
export function makeMonthId(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export async function subscribeMonth(
  companyId: string,
  yyyymm: string,
  onChange: (schedule: Schedule) => void,
  onError?: (err: unknown) => void,
): Promise<Unsubscribe> {
  const db = await getDb();
  const { doc, onSnapshot } = await import('firebase/firestore');
  return onSnapshot(
    doc(db, 'companies', companyId, SUBCOLLECTION, yyyymm),
    (snap) => {
      const data = snap.exists() ? (snap.data() as FirestoreScheduleDoc) : null;
      onChange(data?.entries ?? {});
    },
    (err) => {
      console.error(`[firestoreSchedules] subscribe ${yyyymm} error:`, err);
      onError?.(err);
    },
  );
}

/**
 * v5.0 — separate subscription for the approval block + hrisSync block.
 * Shares the same underlying doc as `subscribeMonth` but is a distinct
 * Firestore listener. Both can be active concurrently — the SDK
 * de-duplicates the network traffic.
 */
export async function subscribeMonthApproval(
  companyId: string,
  yyyymm: string,
  onChange: (state: { approval?: ApprovalBlock; hrisSync?: HrisSyncBlock }) => void,
  onError?: (err: unknown) => void,
): Promise<Unsubscribe> {
  const db = await getDb();
  const { doc, onSnapshot } = await import('firebase/firestore');
  return onSnapshot(
    doc(db, 'companies', companyId, SUBCOLLECTION, yyyymm),
    (snap) => {
      const data = snap.exists() ? (snap.data() as FirestoreScheduleDoc) : null;
      onChange({ approval: data?.approval, hrisSync: data?.hrisSync });
    },
    (err) => {
      console.error(`[firestoreSchedules] subscribeMonthApproval ${yyyymm} error:`, err);
      onError?.(err);
    },
  );
}

interface ScheduleChange {
  empId: string;
  day: number;
  entry: ScheduleEntry | null; // null = the cell was cleared
}

function diffSchedule(prev: Schedule, next: Schedule): ScheduleChange[] {
  const changes: ScheduleChange[] = [];
  const allEmpIds = new Set<string>([
    ...Object.keys(prev),
    ...Object.keys(next),
  ]);
  for (const empId of allEmpIds) {
    const prevDays = prev[empId] ?? {};
    const nextDays = next[empId] ?? {};
    const allDayKeys = new Set<string>([
      ...Object.keys(prevDays),
      ...Object.keys(nextDays),
    ]);
    for (const dayKey of allDayKeys) {
      const dayNum = Number(dayKey);
      const p = prevDays[dayNum];
      const n = nextDays[dayNum];
      if (JSON.stringify(p) !== JSON.stringify(n)) {
        changes.push({ empId, day: dayNum, entry: n ?? null });
      }
    }
  }
  return changes;
}

/**
 * Push a schedule month diff to Firestore.
 * - Small diff (<FULL_REPLACE_THRESHOLD changes) → field-path updateDoc.
 * - Large diff → setDoc replacing the whole entries map.
 * - Doc-not-found → setDoc creating the doc fresh (first edit on a month).
 */
export async function syncMonth(
  companyId: string,
  yyyymm: string,
  prev: Schedule,
  next: Schedule,
  actorUid: string | null,
): Promise<void> {
  if (prev === next) return;
  const changes = diffSchedule(prev, next);
  if (!changes.length) return;
  const db = await getDb();
  const { doc, setDoc, updateDoc, deleteField, serverTimestamp } = await import('firebase/firestore');
  const ref = doc(db, 'companies', companyId, SUBCOLLECTION, yyyymm);
  const meta = { updatedAt: serverTimestamp(), updatedBy: actorUid ?? 'unknown' };

  if (changes.length >= FULL_REPLACE_THRESHOLD) {
    // v5.0 — `{ merge: true }` is critical. Pre-v5.0 this was a plain setDoc
    // that replaced the whole document, which silently dropped the new
    // `approval` and `hrisSync` blocks every time the auto-scheduler fired
    // a >200-cell write. Merging keeps cell-content writes orthogonal to
    // approval-state writes — the two paths never trample each other.
    await setDoc(ref, { entries: next, ...meta }, { merge: true });
    return;
  }

  const update: Record<string, unknown> = { ...meta };
  for (const c of changes) {
    const path = `entries.${c.empId}.${c.day}`;
    update[path] = c.entry === null ? deleteField() : c.entry;
  }
  try {
    await updateDoc(ref, update);
  } catch (err: unknown) {
    // updateDoc fails if the doc doesn't exist — first edit of a month.
    // The Firebase SDK's "not-found" error has a `code` property; we also
    // match the message text as a defence in case the SDK changes.
    const e = err as { code?: string; message?: string };
    if (e?.code === 'not-found' || /No document to update/i.test(e?.message ?? '')) {
      // First-write also uses { merge: true } for symmetry, even though
      // the doc doesn't exist yet — costs nothing and keeps the invariant
      // "writes to entries never touch approval/hrisSync" globally.
      await setDoc(ref, { entries: next, ...meta }, { merge: true });
      return;
    }
    throw err;
  }
}

/**
 * Hard-delete a month doc — used by the "clear month" UI action when the
 * user wants the slate fully blank in Firestore as well as the renderer.
 */
export async function deleteMonth(companyId: string, yyyymm: string): Promise<void> {
  const db = await getDb();
  const { doc, deleteDoc } = await import('firebase/firestore');
  await deleteDoc(doc(db, 'companies', companyId, SUBCOLLECTION, yyyymm));
}

// ── v5.0 approval transitions ─────────────────────────────────────────────
//
// Every transition uses runTransaction so the read-validate-write of the
// status field is atomic — catches the "two managers approve at once" race
// and the "supervisor reopens while admin saves" race. Field-path writes
// only — the `entries` map is never touched.
//
// The save transition additionally writes an immutable snapshot doc into
// the /snapshots subcollection. That snapshot is the canonical "for record
// keeping" archive the user asked for. The snapshot write is a separate
// Firestore call after the parent transaction commits — strictly speaking
// not atomic. Acceptable trade-off: if the snapshot write fails the parent
// is still in 'saved' state with the entries intact, and a retry can
// recreate the snapshot. The diff view checks for snapshot existence
// before loading, so a missing snapshot just means diff is unavailable —
// no data corruption.

interface TransitionContext {
  companyId: string;
  yyyymm: string;
  actorUid: string;
  actorEmail: string | null;
  role: Role;
  notes?: string;
}

/**
 * Internal helper used by all five transition entrypoints. Returns the
 * full transition result + the schedule data at the time of the
 * transaction, so callers (saveSchedule) can sequence follow-up writes
 * (the snapshot doc) using values that were authoritative at commit time.
 *
 * Why one helper: every transition has identical scaffolding (transaction
 * boundary, validator call, history append, stamp write). Inlining each
 * would duplicate ~30 lines per function.
 */
async function runApprovalTransition(
  ctx: TransitionContext,
  action: 'submit' | 'lock' | 'save' | 'send-back' | 'reopen',
): Promise<{
  result: TransitionResult;
  // Snapshot data captured at commit time, for any post-transaction work
  // that needs the entries map (saveSchedule uses this for the snapshot doc).
  capturedEntries: Schedule;
  capturedApproval: ApprovalBlock;
}> {
  const { runTransaction, doc, arrayUnion, serverTimestamp } = await import('firebase/firestore');
  const db = await getDb();
  const ref = doc(db, 'companies', ctx.companyId, SUBCOLLECTION, ctx.yyyymm);

  let result: TransitionResult = { ok: false };
  let capturedEntries: Schedule = {};
  let capturedApproval: ApprovalBlock = { status: 'draft' };

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? (snap.data() as FirestoreScheduleDoc) : undefined;
    const currentStatus = data?.approval?.status ?? 'draft';

    result = isValidTransition({ from: currentStatus, action, role: ctx.role });
    if (!result.ok || !result.to) {
      const err = new Error(result.reason ?? 'Invalid transition');
      (err as Error & { code: string }).code = 'INVALID_TRANSITION';
      throw err;
    }

    const stamp = stampPrefixForAction(action, result.to);
    const historyEntry = buildHistoryEntry({
      action,
      actor: ctx.actorUid,
      actorEmail: ctx.actorEmail,
      role: ctx.role,
      notes: ctx.notes,
      destinationStatus: result.to,
    });

    if (snap.exists()) {
      // Doc already exists — use field-path writes so we never touch
      // anything outside the approval subobject.
      const update: Record<string, unknown> = {
        'approval.status': result.to,
        'approval.history': arrayUnion(historyEntry),
      };
      if (stamp) {
        update[`approval.${stamp}At`] = serverTimestamp();
        update[`approval.${stamp}By`] = ctx.actorUid;
        if (ctx.notes) update[`approval.${stamp}Notes`] = ctx.notes;
      }
      if (action === 'send-back' && result.rejectedFrom) {
        update['approval.rejectedFrom'] = result.rejectedFrom;
      }
      tx.update(ref, update);
    } else {
      // First-write — flatten to a structured object since field-path
      // syntax requires the doc to exist.
      const nestedApproval: Record<string, unknown> = {
        status: result.to,
        history: [historyEntry],
      };
      if (stamp) {
        nestedApproval[`${stamp}At`] = serverTimestamp();
        nestedApproval[`${stamp}By`] = ctx.actorUid;
        if (ctx.notes) nestedApproval[`${stamp}Notes`] = ctx.notes;
      }
      if (action === 'send-back' && result.rejectedFrom) {
        nestedApproval.rejectedFrom = result.rejectedFrom;
      }
      tx.set(ref, { approval: nestedApproval }, { merge: true });
    }

    capturedEntries = data?.entries ?? {};
    capturedApproval = {
      ...(data?.approval ?? { status: 'draft' }),
      status: result.to,
      ...(stamp ? { [`${stamp}By`]: ctx.actorUid } : {}),
    };
  });

  return { result, capturedEntries, capturedApproval };
}

/** Supervisor submits a draft (or rejected) schedule for manager review. */
export async function submitForApproval(
  companyId: string, yyyymm: string,
  actorUid: string, actorEmail: string | null, role: Role,
  notes?: string,
): Promise<TransitionResult> {
  const { result } = await runApprovalTransition(
    { companyId, yyyymm, actorUid, actorEmail, role, notes },
    'submit',
  );
  return result;
}

/** Manager (or admin/super) locks a submitted schedule. */
export async function lockSchedule(
  companyId: string, yyyymm: string,
  actorUid: string, actorEmail: string | null, role: Role,
  notes?: string,
): Promise<TransitionResult> {
  const { result } = await runApprovalTransition(
    { companyId, yyyymm, actorUid, actorEmail, role, notes },
    'lock',
  );
  return result;
}

/**
 * Admin (or super-admin) finalizes a locked schedule. After the status
 * transitions to 'saved' the snapshot doc is written separately — see the
 * trade-off note above. The user-visible result is the same: a saved
 * schedule with an immutable archive in /snapshots.
 */
export async function saveSchedule(
  companyId: string, yyyymm: string,
  actorUid: string, actorEmail: string | null, role: Role,
  notes?: string,
): Promise<TransitionResult> {
  const { result, capturedEntries, capturedApproval } = await runApprovalTransition(
    { companyId, yyyymm, actorUid, actorEmail, role, notes },
    'save',
  );
  if (result.ok) {
    try {
      await writeSavedSnapshot(companyId, yyyymm, capturedEntries, capturedApproval);
    } catch (err) {
      // Don't fail the whole call — the parent state is already 'saved'
      // and the user has been confirmed-through. Surface in the console
      // so the super-admin can investigate, and let the diff view fall
      // back gracefully when there's no snapshot doc to load.
      console.error(`[firestoreSchedules] writeSavedSnapshot failed for ${companyId}/${yyyymm}:`, err);
    }
  }
  return result;
}

/**
 * Manager (or admin) sends a submitted schedule back to the supervisor.
 * Notes are mandatory — the supervisor needs to know why it came back.
 */
export async function sendBackToSupervisor(
  companyId: string, yyyymm: string,
  actorUid: string, actorEmail: string | null, role: Role,
  notes: string,
): Promise<TransitionResult> {
  if (!notes || !notes.trim()) {
    throw Object.assign(new Error('Notes are required when sending a schedule back.'), { code: 'NOTES_REQUIRED' });
  }
  const { result } = await runApprovalTransition(
    { companyId, yyyymm, actorUid, actorEmail, role, notes },
    'send-back',
  );
  return result;
}

/**
 * Admin (or super-admin) sends a locked schedule back to the manager for
 * re-review. Same one-step-back rule as supervisor send-back. Notes are
 * mandatory. The validator distinguishes by current state — sending back
 * from 'locked' lands in 'submitted', which is what we want here.
 */
export async function sendBackToManager(
  companyId: string, yyyymm: string,
  actorUid: string, actorEmail: string | null, role: Role,
  notes: string,
): Promise<TransitionResult> {
  if (!notes || !notes.trim()) {
    throw Object.assign(new Error('Notes are required when sending a schedule back.'), { code: 'NOTES_REQUIRED' });
  }
  const { result } = await runApprovalTransition(
    { companyId, yyyymm, actorUid, actorEmail, role, notes },
    'send-back',
  );
  return result;
}

/**
 * Admin (or super-admin) reopens a saved schedule for amendments. Notes
 * are mandatory — the audit trail needs the reason. The renderer applies
 * tiered safeguards (post-HRIS-export warning, longer reason min-length
 * for old exports) before calling this.
 */
export async function reopenSchedule(
  companyId: string, yyyymm: string,
  actorUid: string, actorEmail: string | null, role: Role,
  notes: string,
): Promise<TransitionResult> {
  if (!notes || !notes.trim()) {
    throw Object.assign(new Error('Reason is required to reopen a saved schedule.'), { code: 'NOTES_REQUIRED' });
  }
  const { result } = await runApprovalTransition(
    { companyId, yyyymm, actorUid, actorEmail, role, notes },
    'reopen',
  );
  return result;
}

/**
 * Write the immutable snapshot doc that captures a saved schedule's
 * entries map at the moment of finalization. Called by saveSchedule()
 * after the parent transition succeeds.
 */
async function writeSavedSnapshot(
  companyId: string,
  yyyymm: string,
  entries: Schedule,
  approval: ApprovalBlock,
): Promise<void> {
  const db = await getDb();
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
  const snapshotId = String(Date.now());
  const ref = doc(
    db,
    'companies', companyId,
    SUBCOLLECTION, yyyymm,
    'snapshots', snapshotId,
  );
  await setDoc(ref, {
    entries,
    submittedAt: approval.submittedAt ?? null,
    submittedBy: approval.submittedBy ?? null,
    lockedAt: approval.lockedAt ?? null,
    lockedBy: approval.lockedBy ?? null,
    savedAt: serverTimestamp(),
    savedBy: approval.savedBy ?? null,
    version: '5.0',
  });
}

/**
 * Helper for the "approver" / dashboard widgets — fetches all schedule
 * docs across `allowedCompanies` whose `approval.status` matches one of
 * the supplied filters. Uses `collectionGroup` so a manager scoped to
 * companies A + B sees a single combined list without per-company queries.
 *
 * Returns plain rows the dashboard widget can render; doesn't subscribe.
 * For live updates, callers should use a snapshot listener on this query.
 */
export async function listPendingApprovals(
  statuses: Array<'submitted' | 'locked'>,
  allowedCompanies: string[] | null,
): Promise<Array<{
  companyId: string;
  yyyymm: string;
  status: 'submitted' | 'locked';
  submittedAt: number | null;
  submittedBy: string | null;
  submittedNotes: string | null;
  lockedAt: number | null;
  lockedBy: string | null;
}>> {
  const db = await getDb();
  const { collectionGroup, query, where, getDocs } = await import('firebase/firestore');
  const q = query(
    collectionGroup(db, SUBCOLLECTION),
    where('approval.status', 'in', statuses),
  );
  const snap = await getDocs(q);
  const rows: Awaited<ReturnType<typeof listPendingApprovals>> = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as FirestoreScheduleDoc;
    const yyyymm = docSnap.id;
    // Path: /companies/{cid}/schedules/{yyyymm}
    const parts = docSnap.ref.path.split('/');
    const companyId = parts[1];
    if (allowedCompanies && !allowedCompanies.includes(companyId)) continue;
    const a = data.approval;
    if (!a) continue;
    if (!statuses.includes(a.status as 'submitted' | 'locked')) continue;
    // Convert any Timestamp fields to millisecond epochs for the renderer.
    const toMs = (v: unknown): number | null => {
      if (!v) return null;
      const t = v as { toMillis?: () => number; seconds?: number };
      if (typeof t.toMillis === 'function') return t.toMillis();
      if (typeof t.seconds === 'number') return t.seconds * 1000;
      if (typeof v === 'number') return v;
      return null;
    };
    rows.push({
      companyId, yyyymm,
      status: a.status as 'submitted' | 'locked',
      submittedAt: toMs(a.submittedAt),
      submittedBy: a.submittedBy ?? null,
      submittedNotes: a.submittedNotes ?? null,
      lockedAt: toMs(a.lockedAt),
      lockedBy: a.lockedBy ?? null,
    });
  }
  return rows;
}
