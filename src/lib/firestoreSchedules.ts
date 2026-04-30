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
import { getDb } from './firestoreClient';

const SUBCOLLECTION = 'schedules';
const FULL_REPLACE_THRESHOLD = 200;

interface FirestoreScheduleDoc {
  entries?: Schedule;
  updatedAt?: unknown;
  updatedBy?: string;
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
    await setDoc(ref, { entries: next, ...meta });
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
      await setDoc(ref, { entries: next, ...meta });
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
