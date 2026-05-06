/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Station profiles for AI Services.
 *
 * A station's `Station` record holds operational config (HC, hours,
 * required roles, hourly demand). The profile is a SEPARATE entity that
 * captures *why* a station looks the way it does — the kind of activity
 * that runs there, peak windows, concurrent tasks, and any safety
 * constraints. The AI fills it in through interview turns and the
 * planner can edit it manually.
 *
 * Why separate from `Station`:
 *   - Operational config is governance — every tab reads it; AI must
 *     not silently mutate it.
 *   - Profiles are AI-managed metadata. If they're empty, the rest of
 *     the app keeps working unchanged.
 *
 * Dual-mode storage (per the project parity rule):
 *   - Online: Firestore subcollection
 *       /companies/{companyId}/stationProfiles/{stationId}
 *     The existing `match /companies/{companyId}/{collection}/{docId}`
 *     rule covers it (read+write to anyone with company access).
 *   - Offline: single localStorage key per company
 *       ils.ai.stationProfiles.<companyId>
 *     Offline mode is single-machine, so per-machine storage is the
 *     correct shape — reflects the "this device's AI user wrote this"
 *     reality and avoids touching the Express data-JSON layer.
 *
 * The hook auto-detects mode and dispatches. Callers pass companyId +
 * a mode hint; the hook returns `[profiles, updateProfile]`.
 */

import { useEffect, useMemo, useState } from 'react';
import type { AppMode } from '../mode';

export interface StationProfile {
  stationId: string;
  /** Human-readable category — e.g. 'slot-bank', 'cashier', 'surveillance',
   *  'restaurant', 'security', 'reception'. Free-form so the AI can pick
   *  domain-appropriate labels per workplace. */
  gameType?: string;
  /** Free-text description of the station's activity. */
  activityDescription?: string;
  /** Peak windows as readable HH:mm–HH:mm strings, e.g. ["19:00–23:00"]. */
  peakHours?: string[];
  /** Tasks happening concurrently (e.g. cashier + surveillance + payouts). */
  concurrentTasks?: string[];
  /** Safety / regulatory / staffing constraints. */
  safetyConstraints?: string[];
  /** Other notes the AI surfaces or the planner adds. */
  notes?: string;

  // ── AI-managed metadata ─────────────────────────────────────────────
  /** 0..100 confidence in the profile's completeness. Drives the
   *  ask-vs-advise gate in the chat panel. */
  confidence: number;
  /** Origin of the most recent write. */
  source: 'ai' | 'user' | 'imported';
  /** Epoch ms of the last update. */
  updatedAt: number;
  /** UID (online) or local ai user id (offline) of the last writer. */
  updatedBy: string | null;
}

export const EMPTY_PROFILE = (stationId: string): StationProfile => ({
  stationId,
  confidence: 0,
  source: 'ai',
  updatedAt: 0,
  updatedBy: null,
});

/**
 * Heuristic confidence calculator. Counts which structured fields are
 * filled and weights them. Free-text only contributes when long enough
 * to look intentional.
 *
 * The chat panel will normally trust the value the AI emits via the
 * `updateStationProfile` tool, but this is the fallback for manual
 * edits and the initial display sort.
 */
export function computeConfidence(p: Partial<StationProfile>): number {
  let score = 0;
  if (p.gameType && p.gameType.trim()) score += 25;
  if (p.activityDescription && p.activityDescription.trim().length > 20) score += 25;
  if (p.peakHours && p.peakHours.length > 0) score += 15;
  if (p.concurrentTasks && p.concurrentTasks.length > 0) score += 15;
  if (p.safetyConstraints && p.safetyConstraints.length > 0) score += 10;
  if (p.notes && p.notes.trim().length > 20) score += 10;
  return Math.min(100, score);
}

// ─── Storage layer ──────────────────────────────────────────────────────

const LOCAL_KEY = (companyId: string) => `ils.ai.stationProfiles.${companyId}`;
const LOCAL_EVENT = 'ils:ai-profiles-changed';

interface ProfileMap {
  [stationId: string]: StationProfile;
}

function readLocal(companyId: string): ProfileMap {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(companyId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as ProfileMap : {};
  } catch {
    return {};
  }
}

function writeLocal(companyId: string, map: ProfileMap): void {
  localStorage.setItem(LOCAL_KEY(companyId), JSON.stringify(map));
  // Same-tab subscribers don't get a `storage` event — broadcast our own.
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: { companyId } }));
}

/**
 * React hook that returns the profile map for the given company along
 * with a mutator. Uses Firestore in Online mode, localStorage in Offline.
 *
 * The Firestore branch lazy-imports the SDK only when needed so Offline
 * mode never pays the bundle cost (matches the rest of the app).
 */
export function useStationProfiles(
  companyId: string | null,
  mode: AppMode | null,
  actorUid: string | null,
): {
  profiles: ProfileMap;
  loading: boolean;
  updateProfile: (stationId: string, patch: Partial<StationProfile>) => Promise<void>;
  deleteProfile: (stationId: string) => Promise<void>;
} {
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [loading, setLoading] = useState(true);

  // Online: Firestore subscription. Lazy-imported so Offline doesn't
  // pull in the SDK chunk just because the AI tab is mounted.
  // Offline: localStorage + same-tab change event.
  useEffect(() => {
    if (!companyId) {
      setProfiles({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    let unsub: (() => void) | undefined;

    if (mode === 'online') {
      (async () => {
        try {
          const { getDb } = await import('../firestoreClient');
          const { collection, onSnapshot } = await import('firebase/firestore');
          const db = await getDb();
          unsub = onSnapshot(
            collection(db, 'companies', companyId, 'stationProfiles'),
            (snap) => {
              if (cancelled) return;
              const next: ProfileMap = {};
              for (const d of snap.docs) {
                const data = d.data() as Partial<StationProfile>;
                next[d.id] = {
                  ...EMPTY_PROFILE(d.id),
                  ...data,
                  stationId: d.id,
                };
              }
              setProfiles(next);
              setLoading(false);
            },
            (err) => {
              console.warn('[ai/profiles] subscription error:', err);
              if (cancelled) return;
              setLoading(false);
            },
          );
        } catch (err) {
          console.warn('[ai/profiles] failed to subscribe:', err);
          if (!cancelled) setLoading(false);
        }
      })();
    } else {
      // Offline mode: hydrate immediately, listen for cross-component edits.
      setProfiles(readLocal(companyId));
      setLoading(false);
      const onChange = (e: Event) => {
        const detail = (e as CustomEvent<{ companyId?: string }>).detail;
        if (detail?.companyId && detail.companyId !== companyId) return;
        setProfiles(readLocal(companyId));
      };
      window.addEventListener(LOCAL_EVENT, onChange);
      window.addEventListener('storage', onChange);
      unsub = () => {
        window.removeEventListener(LOCAL_EVENT, onChange);
        window.removeEventListener('storage', onChange);
      };
    }

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [companyId, mode]);

  const updateProfile = useMemo(() => {
    return async (stationId: string, patch: Partial<StationProfile>) => {
      if (!companyId) throw new Error('No active company');
      const merged: StationProfile = {
        ...EMPTY_PROFILE(stationId),
        ...(profiles[stationId] ?? {}),
        ...patch,
        stationId,
        updatedAt: Date.now(),
        updatedBy: actorUid,
      };
      // Recompute confidence unless the caller pinned it explicitly.
      if (patch.confidence === undefined) {
        merged.confidence = computeConfidence(merged);
      }

      if (mode === 'online') {
        const { getDb } = await import('../firestoreClient');
        const { doc, setDoc } = await import('firebase/firestore');
        const db = await getDb();
        await setDoc(
          doc(db, 'companies', companyId, 'stationProfiles', stationId),
          merged,
          { merge: true },
        );
      } else {
        const next = { ...readLocal(companyId), [stationId]: merged };
        writeLocal(companyId, next);
      }
    };
  }, [companyId, mode, profiles, actorUid]);

  const deleteProfile = useMemo(() => {
    return async (stationId: string) => {
      if (!companyId) throw new Error('No active company');
      if (mode === 'online') {
        const { getDb } = await import('../firestoreClient');
        const { doc, deleteDoc } = await import('firebase/firestore');
        const db = await getDb();
        await deleteDoc(doc(db, 'companies', companyId, 'stationProfiles', stationId));
      } else {
        const next = { ...readLocal(companyId) };
        delete next[stationId];
        writeLocal(companyId, next);
      }
    };
  }, [companyId, mode]);

  return { profiles, loading, updateProfile, deleteProfile };
}

/**
 * Convenience: count how many of a given station list have a profile
 * filled in past the given confidence threshold. Used by the AI tab's
 * overview card so the planner can see "12 / 24 stations profiled".
 */
export function countProfiled(
  stationIds: string[],
  profiles: ProfileMap,
  minConfidence = 40,
): { profiled: number; total: number } {
  let profiled = 0;
  for (const id of stationIds) {
    const p = profiles[id];
    if (p && p.confidence >= minConfidence) profiled++;
  }
  return { profiled, total: stationIds.length };
}
