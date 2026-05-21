/**
 * v5.23.0 — coverage-hint queue extracted from App.tsx.
 *
 * Owns the Schedule grid's two paint-time visual aids:
 *
 *   1) `coverageHints` — the FIFO queue of open gap suggestions. Painting a
 *      leave that drops a station below required HC pushes one entry; the
 *      SuggestionPane renders the head as the active hint and dismisses
 *      either via the toast or the live-refresh effect when the gap closes.
 *   2) `recentlyChangedCells` — the pulsing-highlight set used after a
 *      toast-driven swap, so the user can see which rows actually moved.
 *
 * `massChangeDetected` returns true when ≥3 hints opened inside an 8 s
 * window, which the UI uses to surface a one-shot "bulk operation" banner
 * with the preserve-absences re-schedule shortcut.
 *
 * Pure state holder — no schedule reads. Callers compute gaps + swap
 * candidates and feed them in via `pushHint`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoverageGap, CoverageSuggestion } from './coverageHints';

export interface PendingHint {
  /** `${vacatedEmpId}:${day}:${stationId}` — uniquely identifies the gap. */
  id: string;
  gap: CoverageGap;
  suggestions: CoverageSuggestion[];
  /** Creation time, used for mass-change detection + ordering. */
  ts: number;
}

const MASS_CHANGE_THRESHOLD = 3;
const MASS_CHANGE_WINDOW_MS = 8000;
const RECENTLY_CHANGED_FLASH_MS = 5000;

export function hintIdFor(gap: CoverageGap): string {
  return `${gap.vacatedEmpId}:${gap.day}:${gap.station.id}`;
}

export interface CoverageHintsApi {
  coverageHints: PendingHint[];
  activeCoverageHint: PendingHint | null;
  pushHint: (gap: CoverageGap, suggestions: CoverageSuggestion[]) => void;
  dismissHintById: (id: string) => void;
  setCoverageHints: React.Dispatch<React.SetStateAction<PendingHint[]>>;
  massChangeDetected: boolean;
  recentlyChangedCells: Set<string>;
  flashRecentlyChanged: (keys: string[]) => void;
}

export function useCoverageHints(): CoverageHintsApi {
  const [coverageHints, setCoverageHints] = useState<PendingHint[]>([]);
  const activeCoverageHint = coverageHints[0] || null;

  const pushHint = useCallback((gap: CoverageGap, suggestions: CoverageSuggestion[]) => {
    const id = hintIdFor(gap);
    setCoverageHints(prev => {
      if (prev.some(h => h.id === id)) {
        // Refresh suggestions on the existing entry rather than pushing a
        // duplicate; rapid sweep-paint over the same cell would otherwise
        // stack the hint repeatedly.
        return prev.map(h => h.id === id ? { ...h, suggestions } : h);
      }
      return [...prev, { id, gap, suggestions, ts: Date.now() }];
    });
  }, []);

  const dismissHintById = useCallback((id: string) => {
    setCoverageHints(prev => prev.filter(h => h.id !== id));
  }, []);

  const massChangeDetected = useMemo(() => {
    if (coverageHints.length < MASS_CHANGE_THRESHOLD) return false;
    const cutoff = Date.now() - MASS_CHANGE_WINDOW_MS;
    return coverageHints.filter(h => h.ts >= cutoff).length >= MASS_CHANGE_THRESHOLD;
  }, [coverageHints]);

  const [recentlyChangedCells, setRecentlyChangedCells] = useState<Set<string>>(new Set());
  const recentlyChangedTimerRef = useRef<number | null>(null);

  const flashRecentlyChanged = useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setRecentlyChangedCells(prev => {
      const next = new Set(prev);
      keys.forEach(k => next.add(k));
      return next;
    });
    if (recentlyChangedTimerRef.current) window.clearTimeout(recentlyChangedTimerRef.current);
    recentlyChangedTimerRef.current = window.setTimeout(
      () => setRecentlyChangedCells(new Set()),
      RECENTLY_CHANGED_FLASH_MS,
    );
  }, []);

  // Cleanup on unmount so the timer doesn't fire into stale state.
  useEffect(() => () => {
    if (recentlyChangedTimerRef.current) window.clearTimeout(recentlyChangedTimerRef.current);
  }, []);

  return {
    coverageHints,
    activeCoverageHint,
    pushHint,
    dismissHintById,
    setCoverageHints,
    massChangeDetected,
    recentlyChangedCells,
    flashRecentlyChanged,
  };
}
