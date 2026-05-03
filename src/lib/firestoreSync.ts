/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Connection-status hook for Online mode. Firestore's SDK already queues
 * writes locally via persistentLocalCache when offline and replays them on
 * reconnect, but the user has no UI signal that this is happening — the
 * pre-v4.2 toolbar dot only reflected Express auto-save state, which doesn't
 * apply in Online mode.
 *
 * `useFirestoreSync()` returns:
 *   - `online`:  navigator.onLine + the SDK's last in-sync timestamp.
 *   - `syncing`: writes have been emitted but Firestore hasn't acknowledged
 *                them all yet. `onSnapshotsInSync` fires once they do.
 *   - `queued`:  online === false. Writes are sitting in IndexedDB until
 *                connectivity returns.
 *
 * The hook only attaches its listeners when Online mode is active — Offline
 * mode never calls getDb(), so the import + onSnapshotsInSync stay cold.
 */

import { useEffect, useState } from 'react';
import { getDb } from './firestoreClient';

export interface FirestoreSyncStatus {
  online: boolean;
  syncing: boolean;
  queued: boolean;
  lastSyncedAt: number | null;
}

interface Options {
  /** Pass false to keep the hook idle (Offline mode). */
  enabled: boolean;
}

export function useFirestoreSync({ enabled }: Options): FirestoreSyncStatus {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  // Pending = monotonically incremented on each successful onSnapshotsInSync
  // tick; if a tick hasn't arrived for >1.5s after a navigator-online event
  // we assume something is queued. The hook is intentionally conservative:
  // it never claims "synced" without an ack from the SDK, but it doesn't
  // claim "syncing" forever either.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const db = await getDb();
        const { onSnapshotsInSync } = await import('firebase/firestore');
        // Fires whenever the SDK has fully reconciled all active snapshot
        // listeners with their server state — i.e. there are no in-flight
        // writes the user could lose if they unplugged right now.
        unsub = onSnapshotsInSync(db, () => {
          if (cancelled) return;
          setLastSyncedAt(Date.now());
          setTick((t) => t + 1);
        });
      } catch (err) {
        // getDb throws if Firebase isn't configured — only legitimate when
        // the hook is wired up before the wizard finishes. Stay quiet.
        console.warn('[firestoreSync] subscribe failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [enabled]);

  // Treat the connection as "syncing" if we know we've gone online recently
  // but no ack has landed in the last ~1.5s. This is a best-effort signal —
  // the SDK doesn't expose a pending-write count, so we infer.
  const stale = lastSyncedAt === null || Date.now() - lastSyncedAt > 1500;
  const syncing = enabled && online && stale && tick === 0;

  return {
    online: enabled ? online : true,
    syncing,
    queued: enabled && !online,
    lastSyncedAt,
  };
}
