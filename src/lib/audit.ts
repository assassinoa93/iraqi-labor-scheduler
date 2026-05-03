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

/**
 * Compute which top-level keys differ between two records. Used to enrich
 * "modify" audit summaries from "Modified employee: John" to
 * "Modified employee: John (name, salary)".
 *
 * Returns at most `cap` field names. Excludes some metadata-y fields the
 * user never directly edits (id-style keys, server-stamped timestamps).
 */
function changedFields(prev: unknown, next: unknown, cap = 6): string[] {
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return [];
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const skip = new Set(['updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'serverTs']);
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (skip.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed.push(k);
    if (changed.length >= cap + 1) break;
  }
  return changed;
}

function summariseChangedFields(fields: string[], cap = 6): string {
  if (!fields.length) return '';
  if (fields.length <= cap) return ` (${fields.join(', ')})`;
  return ` (${fields.slice(0, cap).join(', ')}, +${fields.length - cap} more)`;
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
    } else {
      const prevItem = prevById.get(id);
      if (JSON.stringify(prevItem) !== JSON.stringify(item)) {
        const changed = changedFields(prevItem, item);
        const detail = summariseChangedFields(changed);
        entries.push({
          ts, domain: spec.domain, op: 'modify',
          targetId: id, label: spec.labelOf(item),
          summary: `Modified ${spec.singular}: ${spec.labelOf(item) ?? id}${detail}`,
        });
      }
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
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const display = m.replace('scheduler_schedule_', '').replace('_', '-');
    // Walk the (empId, day) cartesian to find changed cells. For small
    // edits the summary lists the first few; bulk operations (auto-
    // scheduler, clear-month) say "N cells modified" instead.
    const changedCells: Array<{ empId: string; day: string; from: string; to: string }> = [];
    const allEmps = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
    for (const empId of allEmps) {
      const aDays = a[empId] ?? {};
      const bDays = b[empId] ?? {};
      const allDays = new Set<string>([...Object.keys(aDays), ...Object.keys(bDays)]);
      for (const d of allDays) {
        const dn = Number(d);
        const av = aDays[dn];
        const bv = bDays[dn];
        if (JSON.stringify(av) !== JSON.stringify(bv)) {
          changedCells.push({
            empId, day: d,
            from: av?.shiftCode ?? '—',
            to: bv?.shiftCode ?? '—',
          });
        }
      }
    }
    let summary: string;
    if (changedCells.length === 0) {
      summary = `Schedule edited for ${display}`;
    } else if (changedCells.length <= 5) {
      const detail = changedCells
        .map((c) => `${c.empId} day ${c.day}: ${c.from}→${c.to}`)
        .join(', ');
      summary = `Schedule edited for ${display} (${detail})`;
    } else {
      summary = `Schedule edited for ${display} (${changedCells.length} cells)`;
    }
    entries.push({ ts, domain: 'schedule', op: 'replace', targetId: m, summary });
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

// ── v5.0 — schedule approval audit helpers ────────────────────────────────
//
// These build entries with `domain: 'scheduleApproval'` and a stable summary
// template per action, so the audit log gives a clean approval lineage that
// the HRIS export bundle can ship verbatim. Op is always 'modify' except
// for the HRIS export itself, which is 'replace' (semantically: "the saved
// state was archived to an external system at T").

export type ApprovalAuditAction = 'submit' | 'lock' | 'save' | 'send-back' | 'reopen' | 'hris-export';

export function buildApprovalAuditEntry(params: {
  action: ApprovalAuditAction;
  yyyymm: string;
  actorRole: string;
  notes?: string;
  /** For send-back: the level the schedule came from. */
  fromLevel?: 'manager' | 'admin';
  /** For reopen: whether the schedule was already exported to HRIS. */
  postHrisExport?: boolean;
}): AuditEntry {
  const { action, yyyymm, actorRole, notes, fromLevel, postHrisExport } = params;
  const op: AuditOp = action === 'hris-export' ? 'replace' : 'modify';
  const noteSuffix = notes ? ` — notes: ${notes}` : '';

  let summary: string;
  switch (action) {
    case 'submit':
      summary = `Submitted ${yyyymm} for approval${noteSuffix}`;
      break;
    case 'lock':
      summary = `Locked ${yyyymm} (manager-validated by ${actorRole})${noteSuffix}`;
      break;
    case 'save':
      summary = `Saved ${yyyymm} (admin-finalized by ${actorRole}) — official record archived${noteSuffix}`;
      break;
    case 'send-back': {
      const target = fromLevel === 'admin' ? 'manager' : 'supervisor';
      const sender = fromLevel === 'admin' ? 'admin' : 'manager';
      summary = `Sent ${yyyymm} back to ${target} (by ${sender})${noteSuffix}`;
      break;
    }
    case 'reopen':
      summary = `Reopened saved ${yyyymm}${postHrisExport ? ' (post-HRIS-export)' : ''}${noteSuffix}`;
      break;
    case 'hris-export':
      summary = `Exported ${yyyymm} bundle for HRIS${noteSuffix}`;
      break;
  }

  return {
    ts: Date.now(),
    domain: 'scheduleApproval',
    op,
    targetId: yyyymm,
    label: yyyymm,
    summary,
  };
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
