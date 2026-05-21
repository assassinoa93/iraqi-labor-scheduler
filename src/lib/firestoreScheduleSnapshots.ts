/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.23.0 — schedule snapshot + diff helpers (extracted from
 * firestoreSchedules.ts).
 *
 * The "Show changes since last archive" toggle in the schedule banner
 * lazy-loads the most-recent snapshot and renders changed cells with
 * coloured outlines. Loader is cheap because each schedule month has at
 * most a handful of snapshots (one per save), and the doc payload is the
 * same shape as a full schedule month (~56 KB at 60×31).
 *
 * Re-exported from firestoreSchedules.ts so existing import paths keep
 * working without churn at the call sites.
 */

import type { Schedule } from '../types';
import { getDb } from './firestoreClient';

const SUBCOLLECTION = 'schedules';

export interface ScheduleSnapshot {
  /** Doc ID — millisecond timestamp at save-time, descending sort key. */
  id: string;
  entries: Schedule;
  /** When the snapshot was written (server timestamp). Useful for the
   * "since YYYY-MM-DD" label in the diff header. */
  savedAt: number | null;
  savedBy: string | null;
  /** Snapshot writer version — currently '5.0', bumped if the payload
   * shape changes so the renderer can refuse a future format. */
  version: string;
}

/**
 * Fetch the most-recent snapshot for a schedule month. Returns null when
 * the schedule has never been saved (no snapshots written yet) — the
 * banner uses that to suppress the diff toggle entirely.
 *
 * Why query-then-pick-first: Firestore's `limit(1)` plus `orderBy(__name__,
 * 'desc')` returns the highest-keyed doc, which IS the latest because
 * snapshot IDs are millisecond timestamps stringified. Cheaper than
 * fetching every snapshot and sorting client-side.
 */
export async function getLatestSnapshot(
  companyId: string,
  yyyymm: string,
): Promise<ScheduleSnapshot | null> {
  const db = await getDb();
  const { collection, query, orderBy, limit, getDocs } = await import('firebase/firestore');
  const ref = collection(db, 'companies', companyId, SUBCOLLECTION, yyyymm, 'snapshots');
  const q = query(ref, orderBy('__name__', 'desc'), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  const data = docSnap.data() as { entries?: Schedule; savedAt?: unknown; savedBy?: string; version?: string };
  const toMs = (v: unknown): number | null => {
    if (!v) return null;
    const t = v as { toMillis?: () => number; seconds?: number };
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    if (typeof v === 'number') return v;
    return null;
  };
  return {
    id: docSnap.id,
    entries: data.entries ?? {},
    savedAt: toMs(data.savedAt),
    savedBy: data.savedBy ?? null,
    version: data.version ?? 'unknown',
  };
}

export type ScheduleDiffKind = 'added' | 'modified' | 'removed';
export type ScheduleDiffMap = Map<string, ScheduleDiffKind>;

export interface ScheduleDiffSummary {
  added: number;
  modified: number;
  removed: number;
  total: number;
}

/** Aggregate the diff map for the banner pill ("12 changed: 5 added · 4 modified · 3 removed"). */
export function summarizeDiffMap(diff: ScheduleDiffMap): ScheduleDiffSummary {
  let added = 0, modified = 0, removed = 0;
  for (const kind of diff.values()) {
    if (kind === 'added') added++;
    else if (kind === 'modified') modified++;
    else removed++;
  }
  return { added, modified, removed, total: added + modified + removed };
}

/**
 * Compute the cell-level diff between a current schedule and a snapshot.
 * Returns a Map keyed by `${empId}:${day}` so the schedule cell can do an
 * O(1) lookup as it renders. Empty map means nothing changed.
 *
 * Three states matter for the UI:
 *   - 'added':    cell exists now, didn't in the snapshot
 *   - 'modified': cell exists in both but shiftCode differs (stationId
 *                 changes alone don't count — they're a rendering detail
 *                 that the reviewer doesn't need to flag separately)
 *   - 'removed':  cell existed in the snapshot but not now
 *
 * stationId-only diffs are intentionally suppressed — visually the cell
 * still shows the same shift code, so flagging it would be confusing
 * noise. Comment this in case the policy ever needs to change.
 */
export function diffScheduleVsSnapshot(
  current: Schedule,
  snapshot: Schedule,
): ScheduleDiffMap {
  const diff: ScheduleDiffMap = new Map();
  const allEmpIds = new Set<string>([
    ...Object.keys(current),
    ...Object.keys(snapshot),
  ]);
  for (const empId of allEmpIds) {
    const cur = current[empId] ?? {};
    const snap = snapshot[empId] ?? {};
    const allDays = new Set<string>([
      ...Object.keys(cur),
      ...Object.keys(snap),
    ]);
    for (const dayKey of allDays) {
      const day = Number(dayKey);
      const c = cur[day];
      const s = snap[day];
      const cCode = c?.shiftCode ?? '';
      const sCode = s?.shiftCode ?? '';
      if (cCode === sCode) continue;
      const key = `${empId}:${day}`;
      if (!sCode && cCode) diff.set(key, 'added');
      else if (sCode && !cCode) diff.set(key, 'removed');
      else diff.set(key, 'modified');
    }
  }
  return diff;
}
