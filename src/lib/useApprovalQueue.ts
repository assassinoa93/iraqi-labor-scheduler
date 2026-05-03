/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.0 — `useApprovalQueue()` hook. Subscribes via collectionGroup query
 * to schedule docs whose `approval.status` is one of the supplied values,
 * scoped to the user's `allowedCompanies` (null = all). Returns rows the
 * dashboard widget renders + a count for the sidebar badge.
 *
 * One subscription per (user, statuses) tuple. App.tsx mounts this once
 * and shares the result via React context to avoid duplicate listeners.
 */

import { useEffect, useState } from 'react';
import { getDb } from './firestoreClient';
import type { ApprovalStatus } from './firestoreSchedules';

export interface ApprovalQueueRow {
  companyId: string;
  yyyymm: string;
  status: ApprovalStatus;
  submittedAt: number | null;
  submittedBy: string | null;
  submittedNotes: string | null;
  lockedAt: number | null;
  lockedBy: string | null;
}

interface Options {
  /** Pass false to keep the hook idle (Offline mode, signed-out, etc.). */
  enabled: boolean;
  /** Statuses the user cares about. Manager = ['submitted']; admin =
   * ['locked']; super-admin sees the union; supervisor sees ['rejected'] of
   * their own. Empty array → no listener. */
  statuses: ApprovalStatus[];
  /** Restrict to these companies. null = all (admin, super-admin). */
  allowedCompanies: string[] | null;
  /** When non-null, filter rows where submittedBy/lockedBy matches — used
   * for the supervisor's "your sent-back schedules" view. */
  authorUid?: string | null;
}

const toMs = (v: unknown): number | null => {
  if (!v) return null;
  const t = v as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof v === 'number') return v;
  return null;
};

export function useApprovalQueue({
  enabled, statuses, allowedCompanies, authorUid,
}: Options): ApprovalQueueRow[] {
  const [rows, setRows] = useState<ApprovalQueueRow[]>([]);

  useEffect(() => {
    if (!enabled || statuses.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const db = await getDb();
        const { collectionGroup, query, where, onSnapshot } = await import('firebase/firestore');
        // Firestore `in` accepts up to 30 values — comfortably above 5
        // approval statuses, so a single in-clause covers any combination.
        const q = query(
          collectionGroup(db, 'schedules'),
          where('approval.status', 'in', statuses),
        );
        unsub = onSnapshot(
          q,
          (snap) => {
            if (cancelled) return;
            const next: ApprovalQueueRow[] = [];
            for (const docSnap of snap.docs) {
              const data = docSnap.data() as { approval?: { status?: ApprovalStatus; submittedAt?: unknown; submittedBy?: string; submittedNotes?: string; lockedAt?: unknown; lockedBy?: string } };
              const yyyymm = docSnap.id;
              const parts = docSnap.ref.path.split('/');
              const companyId = parts[1];
              if (allowedCompanies && !allowedCompanies.includes(companyId)) continue;
              const a = data.approval;
              if (!a || !a.status) continue;
              if (authorUid && a.submittedBy !== authorUid && a.lockedBy !== authorUid) continue;
              next.push({
                companyId,
                yyyymm,
                status: a.status,
                submittedAt: toMs(a.submittedAt),
                submittedBy: a.submittedBy ?? null,
                submittedNotes: a.submittedNotes ?? null,
                lockedAt: toMs(a.lockedAt),
                lockedBy: a.lockedBy ?? null,
              });
            }
            // Sort: oldest first — the schedule that's been waiting longest
            // for action floats to the top of the manager / admin queue.
            next.sort((x, y) => {
              const xs = x.status === 'locked' ? x.lockedAt ?? 0 : x.submittedAt ?? 0;
              const ys = y.status === 'locked' ? y.lockedAt ?? 0 : y.submittedAt ?? 0;
              return xs - ys;
            });
            setRows(next);
          },
          (err) => {
            console.warn('[useApprovalQueue] subscribe error:', err);
            if (!cancelled) setRows([]);
          },
        );
      } catch (err) {
        console.warn('[useApprovalQueue] init failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
    // The statuses + allowedCompanies arrays are stable across renders if
    // memoised at call site; otherwise this effect re-fires on each render.
    // We rely on the caller to pass stable references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, statuses.join('|'), (allowedCompanies ?? []).join('|'), authorUid ?? '']);

  return rows;
}
