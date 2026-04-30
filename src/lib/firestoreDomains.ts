/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 2.2 — Firestore CRUD + onSnapshot subscriptions for the per-company
 * static domains: employees, shifts, stations, stationGroups, holidays, and
 * config. Schedules and audit are Phase 2.3.
 *
 * Architecture:
 *   - Each domain (except config) is a per-company subcollection at
 *     `/companies/{companyId}/<collection>/{itemId}`. One Firestore doc per
 *     item, ID derived from the item's stable identifier (empId, code, id).
 *   - `config` is a single doc at `/companies/{companyId}/config/current`
 *     because Config is edited holistically and is always read in full.
 *   - The renderer's existing array-shape state is preserved verbatim.
 *     `subscribeX()` returns the array; `syncX()` accepts before/after
 *     arrays and computes the diff, emitting individual setDoc/deleteDoc
 *     calls in a writeBatch.
 *
 * Why per-doc instead of array-per-company:
 *   - Field-level / per-item updates avoid the "rewrite the whole roster on
 *     every keystroke" problem the Express layer has today.
 *   - Two supervisors editing different employees in the same company won't
 *     clobber each other.
 *   - Smaller writes = lower bandwidth for offline-flush queues.
 *
 * Diff strategy:
 *   - Compare prev[] vs next[] by ID. JSON.stringify equality is good enough
 *     for "did this item change" — domains are flat-ish and small. We avoid
 *     a hot path here because writes happen on user actions, not in render.
 */

import type { Unsubscribe } from 'firebase/firestore';
import type { Employee, Shift, Station, StationGroup, PublicHoliday, Config } from '../types';
import { getDb } from './firestoreClient';

// ── Generic helpers (private) ────────────────────────────────────────────

interface Diff<T> { added: T[]; updated: T[]; removed: T[]; }

function diffArrays<T>(prev: T[], next: T[], idOf: (t: T) => string): Diff<T> {
  const prevMap = new Map<string, T>();
  for (const p of prev) prevMap.set(idOf(p), p);
  const nextMap = new Map<string, T>();
  for (const n of next) nextMap.set(idOf(n), n);
  const added: T[] = [];
  const updated: T[] = [];
  const removed: T[] = [];
  for (const [id, n] of nextMap) {
    const p = prevMap.get(id);
    if (!p) added.push(n);
    else if (JSON.stringify(p) !== JSON.stringify(n)) updated.push(n);
  }
  for (const [id, p] of prevMap) {
    if (!nextMap.has(id)) removed.push(p);
  }
  return { added, updated, removed };
}

async function syncArrayCollection<T>(
  companyId: string,
  collName: string,
  idOf: (t: T) => string,
  prev: T[],
  next: T[],
  actorUid: string | null,
): Promise<void> {
  if (prev === next) return;
  const { added, updated, removed } = diffArrays(prev, next, idOf);
  if (!added.length && !updated.length && !removed.length) return;
  const db = await getDb();
  const { doc, serverTimestamp, writeBatch } = await import('firebase/firestore');
  const batch = writeBatch(db);
  const meta = () => ({ updatedAt: serverTimestamp(), updatedBy: actorUid ?? 'unknown' });
  // setDoc overwrites the entire doc — fine here because items are flat
  // value objects with no untracked Firestore-only fields.
  for (const item of [...added, ...updated]) {
    batch.set(doc(db, 'companies', companyId, collName, idOf(item)), { ...item, ...meta() });
  }
  for (const item of removed) {
    batch.delete(doc(db, 'companies', companyId, collName, idOf(item)));
  }
  await batch.commit();
}

async function subscribeArrayCollection<T>(
  companyId: string,
  collName: string,
  hydrate: (data: Record<string, unknown>, id: string) => T,
  onChange: (items: T[]) => void,
  onError?: (err: unknown) => void,
): Promise<Unsubscribe> {
  const db = await getDb();
  const { collection, onSnapshot } = await import('firebase/firestore');
  return onSnapshot(
    collection(db, 'companies', companyId, collName),
    (snap) => {
      const items = snap.docs.map((d) => hydrate(d.data() as Record<string, unknown>, d.id));
      onChange(items);
    },
    (err) => {
      console.error(`[firestoreDomains] subscribe ${collName} error:`, err);
      onError?.(err);
    },
  );
}

// Single-doc variants — used by `config`. The doc lives at
// `/companies/{companyId}/config/current`. We wrap the value in `{ value: ... }`
// so the doc has stable shape regardless of T's fields.
async function syncSingleDoc<T>(
  companyId: string,
  groupName: string,
  value: T,
  actorUid: string | null,
): Promise<void> {
  const db = await getDb();
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
  await setDoc(doc(db, 'companies', companyId, groupName, 'current'), {
    value,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid ?? 'unknown',
  });
}

async function subscribeSingleDoc<T>(
  companyId: string,
  groupName: string,
  onChange: (value: T | null) => void,
  onError?: (err: unknown) => void,
): Promise<Unsubscribe> {
  const db = await getDb();
  const { doc, onSnapshot } = await import('firebase/firestore');
  return onSnapshot(
    doc(db, 'companies', companyId, groupName, 'current'),
    (snap) => {
      const data = snap.exists() ? (snap.data() as { value?: T }) : null;
      onChange((data?.value ?? null) as T | null);
    },
    (err) => {
      console.error(`[firestoreDomains] subscribe ${groupName} error:`, err);
      onError?.(err);
    },
  );
}

// ── Per-domain typed wrappers (public) ───────────────────────────────────

// Employees ---------------------------------------------------------------
export function subscribeEmployees(companyId: string, onChange: (items: Employee[]) => void, onError?: (err: unknown) => void) {
  return subscribeArrayCollection<Employee>(
    companyId, 'employees',
    (data, id) => ({ ...(data as Omit<Employee, 'empId'>), empId: id }),
    onChange, onError,
  );
}
export function syncEmployees(companyId: string, prev: Employee[], next: Employee[], actorUid: string | null) {
  return syncArrayCollection<Employee>(companyId, 'employees', (e) => e.empId, prev, next, actorUid);
}

// Shifts ------------------------------------------------------------------
export function subscribeShifts(companyId: string, onChange: (items: Shift[]) => void, onError?: (err: unknown) => void) {
  return subscribeArrayCollection<Shift>(
    companyId, 'shifts',
    (data, id) => ({ ...(data as Omit<Shift, 'code'>), code: id }),
    onChange, onError,
  );
}
export function syncShifts(companyId: string, prev: Shift[], next: Shift[], actorUid: string | null) {
  return syncArrayCollection<Shift>(companyId, 'shifts', (s) => s.code, prev, next, actorUid);
}

// Stations ---------------------------------------------------------------
export function subscribeStations(companyId: string, onChange: (items: Station[]) => void, onError?: (err: unknown) => void) {
  return subscribeArrayCollection<Station>(
    companyId, 'stations',
    (data, id) => ({ ...(data as Omit<Station, 'id'>), id }),
    onChange, onError,
  );
}
export function syncStations(companyId: string, prev: Station[], next: Station[], actorUid: string | null) {
  return syncArrayCollection<Station>(companyId, 'stations', (s) => s.id, prev, next, actorUid);
}

// Station Groups ---------------------------------------------------------
export function subscribeStationGroups(companyId: string, onChange: (items: StationGroup[]) => void, onError?: (err: unknown) => void) {
  return subscribeArrayCollection<StationGroup>(
    companyId, 'stationGroups',
    (data, id) => ({ ...(data as Omit<StationGroup, 'id'>), id }),
    onChange, onError,
  );
}
export function syncStationGroups(companyId: string, prev: StationGroup[] | undefined, next: StationGroup[] | undefined, actorUid: string | null) {
  // The CompanyData.stationGroups field is optional (pre-1.16 saves don't
  // have it). Coerce to [] so the diff is well-defined.
  return syncArrayCollection<StationGroup>(companyId, 'stationGroups', (g) => g.id, prev ?? [], next ?? [], actorUid);
}

// Holidays ---------------------------------------------------------------
// Holidays may lack `id` on legacy data — fall back to `date` as the doc
// ID so subscribe and sync round-trip stably.
function holidayId(h: PublicHoliday): string {
  return h.id ?? h.date;
}
export function subscribeHolidays(companyId: string, onChange: (items: PublicHoliday[]) => void, onError?: (err: unknown) => void) {
  return subscribeArrayCollection<PublicHoliday>(
    companyId, 'holidays',
    (data, id) => ({ ...(data as Omit<PublicHoliday, 'id'>), id }),
    onChange, onError,
  );
}
export function syncHolidays(companyId: string, prev: PublicHoliday[], next: PublicHoliday[], actorUid: string | null) {
  return syncArrayCollection<PublicHoliday>(companyId, 'holidays', holidayId, prev, next, actorUid);
}

// Config (single doc) ----------------------------------------------------
export function subscribeConfig(companyId: string, onChange: (cfg: Config | null) => void, onError?: (err: unknown) => void) {
  return subscribeSingleDoc<Config>(companyId, 'config', onChange, onError);
}
export function syncConfig(companyId: string, _prev: Config, next: Config, actorUid: string | null) {
  return syncSingleDoc<Config>(companyId, 'config', next, actorUid);
}

// ── New-company default seeding ──────────────────────────────────────────

/**
 * Seed a freshly-created company with the same baseline data the Offline
 * Demo mode bootstraps from `emptyCompanyData()` + `DEFAULT_CONFIG`:
 *   - INITIAL_SHIFTS (FS, MX, P1-P3, OFF, AL, SL, PH, MAT, CP)
 *   - INITIAL_HOLIDAYS (Iraqi public holidays — Eids consolidated with durationDays)
 *   - DEFAULT_CONFIG (Iraqi Labor Law thresholds, customised with the company name)
 *
 * Called from App.addCompany() in Online mode immediately after the
 * Firestore company doc is created. Without this, new companies would
 * appear in the app with empty rosters / no shifts / no holidays — a
 * regression vs Offline mode where the user always lands with sensible
 * defaults.
 *
 * Idempotent — `setDoc` overwrites, so re-running with the same defaults
 * is safe (though not currently exposed). Phase 3 may surface a "Re-seed
 * defaults" admin action.
 */
export async function seedCompanyDefaults(
  companyId: string,
  initialShifts: Shift[],
  initialHolidays: PublicHoliday[],
  defaultConfig: Config,
  actorUid: string | null,
): Promise<void> {
  await Promise.all([
    syncShifts(companyId, [], initialShifts, actorUid),
    syncHolidays(companyId, [], initialHolidays, actorUid),
    syncConfig(companyId, defaultConfig, defaultConfig, actorUid),
  ]);
}
