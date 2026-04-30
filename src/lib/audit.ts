/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 2.3b — client-side audit log for Online mode.
 *
 * Ports the per-domain diff logic from `server.ts` (lines 124-209) so the
 * client can compute the same audit entries that the Express server used
 * to emit on every save. Audit entries are written to a top-level
 * `/audit/{autoId}` collection in Firestore.
 *
 * Why a top-level collection (not per-company subcollection)?
 *   - The original on-disk shape is global (one audit.json with companyId
 *     tags), and admins want a unified timeline across all companies.
 *   - Firestore Security Rules can scope reads on the `companyId` field:
 *     supervisors get filtered to their `companies` claim, admins see all.
 *
 * Why client-side instead of a Cloud Function `onWrite` trigger?
 *   - The user is on Spark plan (no Cloud Functions). The trade-off is
 *     that audit + data writes are NOT atomic — the data write can succeed
 *     while the audit write fails (network blip mid-batch). Failure mode
 *     is "missing audit entry, data is correct" which is acceptable.
 *   - Rules forbid update/delete of audit entries (immutable), so a
 *     malicious client can't tamper with history; they can only fail to
 *     add an entry, which is detectable via missing-from-history.
 */

import type { Unsubscribe } from 'firebase/firestore';
import type { Employee, Shift, Station, StationGroup, PublicHoliday, Config, Schedule } from '../types';
import { getDb } from './firestoreClient';

export type AuditOp = 'add' | 'remove' | 'modify' | 'replace';

export interface AuditEntry {
  ts: number;
  domain: string;
  op: AuditOp;
  targetId?: string;
  label?: string;
  summary: string;
}

/** Fully-populated audit entry as written to Firestore. */
export interface AuditEntryDoc extends AuditEntry {
  companyId?: string;
  actorUid?: string;
  actorEmail?: string;
}

// ── Per-domain diff functions (port of server.ts:diffDomain) ─────────────

interface ArrayDiffSpec<T> {
  domain: string;
  singular: string; // for human summary text
  idOf: (item: T) => string;
  labelOf: (item: T) => string | undefined;
}

function diffArrayDomain<T>(spec: ArrayDiffSpec<T>, prev: T[], next: T[]): AuditEntry[] {
  const ts = Date.now();
  const entries: AuditEntry[] = [];
  const prevById = new Map<string, T>();
  for (const x of prev) prevById.set(spec.idOf(x), x);
  const nextById = new Map<string, T>();
  for (const x of next) nextById.set(spec.idOf(x), x);
  for (const [id, item] of nextById) {
    if (!prevById.has(id)) {
      entries.push({ ts, domain: spec.domain, op: 'add', targetId: id, label: spec.labelOf(item), summary: `Added ${spec.singular}: ${spec.labelOf(item) ?? id}` });
    } else if (JSON.stringify(prevById.get(id)) !== JSON.stringify(item)) {
      entries.push({ ts, domain: spec.domain, op: 'modify', targetId: id, label: spec.labelOf(item), summary: `Modified ${spec.singular}: ${spec.labelOf(item) ?? id}` });
    }
  }
  for (const [id, item] of prevById) {
    if (!nextById.has(id)) {
      entries.push({ ts, domain: spec.domain, op: 'remove', targetId: id, label: spec.labelOf(item), summary: `Removed ${spec.singular}: ${spec.labelOf(item) ?? id}` });
    }
  }
  return entries;
}

export function diffEmployees(prev: Employee[], next: Employee[]): AuditEntry[] {
  return diffArrayDomain<Employee>(
    { domain: 'employees', singular: 'employee', idOf: (e) => e.empId, labelOf: (e) => e.name },
    prev, next,
  );
}
export function diffShifts(prev: Shift[], next: Shift[]): AuditEntry[] {
  return diffArrayDomain<Shift>(
    { domain: 'shifts', singular: 'shift', idOf: (s) => s.code, labelOf: (s) => s.name },
    prev, next,
  );
}
export function diffStations(prev: Station[], next: Station[]): AuditEntry[] {
  return diffArrayDomain<Station>(
    { domain: 'stations', singular: 'station', idOf: (s) => s.id, labelOf: (s) => s.name },
    prev, next,
  );
}
export function diffStationGroups(prev: StationGroup[] | undefined, next: StationGroup[] | undefined): AuditEntry[] {
  return diffArrayDomain<StationGroup>(
    { domain: 'stationGroups', singular: 'station group', idOf: (g) => g.id, labelOf: (g) => g.name },
    prev ?? [], next ?? [],
  );
}
export function diffHolidays(prev: PublicHoliday[], next: PublicHoliday[]): AuditEntry[] {
  // Port of server.ts: keys by date (not id) for back-compat with legacy
  // audit.json entries. Multi-day holidays still emit one entry per
  // distinct date because the v3.0 model has one record per holiday with
  // durationDays — the date IS the start-of-window identifier.
  return diffArrayDomain<PublicHoliday>(
    { domain: 'holidays', singular: 'holiday', idOf: (h) => h.date, labelOf: (h) => h.name },
    prev, next,
  );
}
export function diffConfig(prev: Config, next: Config): AuditEntry[] {
  const ts = Date.now();
  const a = (prev ?? {}) as Record<string, unknown>;
  const b = (next ?? {}) as Record<string, unknown>;
  const changed: string[] = [];
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed.push(k);
  }
  if (!changed.length) return [];
  return [{
    ts, domain: 'config', op: 'modify',
    summary: `Config edited: ${changed.slice(0, 8).join(', ')}${changed.length > 8 ? `, +${changed.length - 8} more` : ''}`,
  }];
}
export function diffCompanies(_prev: unknown, _next: unknown): AuditEntry[] {
  // Companies CRUD already audits via the Phase 2.1 Firestore mutators
  // emitting their own audit entries (handled in the Companies registry
  // itself, not the per-company tree). Returning [] here keeps the
  // dispatcher honest — companies aren't in CompanyData anyway.
  return [];
}
export function diffAllSchedules(prev: Record<string, Schedule>, next: Record<string, Schedule>): AuditEntry[] {
  const ts = Date.now();
  const entries: AuditEntry[] = [];
  const months = new Set<string>([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
  for (const m of months) {
    const a = prev?.[m] ?? {};
    const b = next?.[m] ?? {};
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      // Strip the "scheduler_schedule_" prefix and reformat the
      // _-separator for readability ("scheduler_schedule_2026_4" → "2026-4").
      const display = m.replace('scheduler_schedule_', '').replace('_', '-');
      entries.push({ ts, domain: 'schedule', op: 'replace', targetId: m, summary: `Schedule edited for ${display}` });
    }
  }
  return entries;
}

// ── Firestore writers / readers ─────────────────────────────────────────

/**
 * Write a list of audit entries to /audit. All entries share the same
 * actor + companyId (the user who did the edit, the company they were on).
 *
 * Failures are non-fatal — the calling site logs and continues. Audit is
 * supplementary; missing entries are recoverable via `git log` style
 * inference from the Firestore data state.
 */
export async function writeAuditEntries(
  entries: AuditEntry[],
  companyId: string | null,
  actorUid: string | null,
  actorEmail: string | null,
): Promise<void> {
  if (!entries.length) return;
  const db = await getDb();
  const { collection, doc, serverTimestamp, writeBatch } = await import('firebase/firestore');
  const batch = writeBatch(db);
  for (const e of entries) {
    const ref = doc(collection(db, 'audit'));
    batch.set(ref, {
      ts: e.ts || Date.now(),
      domain: e.domain,
      op: e.op,
      targetId: e.targetId ?? null,
      label: e.label ?? null,
      summary: e.summary,
      companyId: companyId ?? null,
      actorUid: actorUid ?? null,
      actorEmail: actorEmail ?? null,
      // serverTs is for ordering by server time (immune to client clock skew).
      // The display-side `ts` field is the millisecond epoch the client
      // captured at edit time, useful for "X minutes ago" UI hints.
      serverTs: serverTimestamp(),
    });
  }
  await batch.commit();
}

/**
 * Subscribe to the audit log. Filters and ordering are server-side via
 * Firestore composite indexes. Latest-first by client timestamp.
 *
 * Without a `companyId` filter, the rules let admins read every entry but
 * supervisors get filtered to their `companies` claim by Firestore itself
 * (the rule walks `resource.data.companyId in token.companies`).
 */
export async function subscribeAuditLog(
  onChange: (entries: AuditEntryDoc[]) => void,
  options?: { companyId?: string; limit?: number },
  onError?: (err: unknown) => void,
): Promise<Unsubscribe> {
  const db = await getDb();
  const { collection, query, where, orderBy, limit: qLimit, onSnapshot } = await import('firebase/firestore');
  const limitN = options?.limit ?? 500;
  const q = options?.companyId
    ? query(collection(db, 'audit'), where('companyId', '==', options.companyId), orderBy('ts', 'desc'), qLimit(limitN))
    : query(collection(db, 'audit'), orderBy('ts', 'desc'), qLimit(limitN));
  return onSnapshot(
    q,
    (snap) => {
      const entries: AuditEntryDoc[] = snap.docs.map((d) => d.data() as AuditEntryDoc);
      onChange(entries);
    },
    (err) => {
      console.error('[audit] subscribe error:', err);
      onError?.(err);
    },
  );
}
