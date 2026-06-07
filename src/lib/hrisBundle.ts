/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.1.0 — HRIS manual-bundle export.
 *
 * Assembles a single .zip download that an admin can hand to their HRIS
 * vendor for one-time payroll import. Bundle contents:
 *
 *   manifest.json   — schema-versioned metadata + full approval lineage
 *                     (who submitted / locked / saved, with timestamps,
 *                     positions, and reviewer notes). The downstream
 *                     system uses this to identify "which official
 *                     archive of which month" they're consuming.
 *   schedule.csv    — the schedule grid (employees × days × shift codes).
 *                     Same shape as the existing exportScheduleCSV path
 *                     so HRIS importers that already parse it keep
 *                     working.
 *   roster.csv      — employee master data: id, name, role, department,
 *                     contract type, weekly hours, salary, category.
 *   leaves.csv      — every leave range overlapping the month (annual,
 *                     sick, maternity, painted leaves derived from the
 *                     schedule) flattened to one row per range.
 *   compliance.json — violations + info findings + heuristic score so the
 *                     HRIS / payroll team can see what the platform
 *                     reported (we report; they decide whether to act).
 *   README.txt      — plain-English walkthrough of the bundle layout for
 *                     the human opening it.
 *
 * jszip is lazy-loaded (12 KB gzipped) — same pattern as the jsPDF report
 * module — so the export feature doesn't bloat the initial bundle for
 * users who never reach a saved schedule.
 *
 * Mode applicability: this module is Online-mode only by design. Offline
 * Demo mode has no approval workflow, so the "Export HRIS bundle" button
 * never renders there. The bundle generator itself is mode-agnostic — it
 * could be reused for offline if we ever need it — but the App.tsx call
 * site gates strictly on `status === 'saved'` (which is itself an
 * Online-only state).
 */

import { format } from 'date-fns';
import type {
  Employee, Shift, Schedule, Config, Violation, PublicHoliday, Station, LeaveRange,
} from '../types';
import { listAllLeaveRangesIncludingPainted } from './leaves';
import type { ApprovalBlock } from './firestoreSchedules';

const BUNDLE_VERSION = '5.1.0';

// CSV-escape a single cell. Wraps in double quotes and doubles internal
// quotes so commas, newlines, and quotes round-trip correctly through any
// well-behaved CSV parser. Same semantics as App.tsx's csvCell — kept
// local so this module has no React/App import dependency.
function csvCell(s: string | number | null | undefined): string {
  const str = String(s ?? '');
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function rowsToCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface BundleInputs {
  /** Active company name + ID — both go in the manifest. */
  companyId: string;
  companyName: string;
  /** Active month label (e.g. "April 2026") + machine-readable yyyymm. */
  monthLabel: string;
  yyyymm: string;
  /** Year + month + days-in-month from the active config. The bundle is
   * scoped to a single month so the cross-month case doesn't apply. */
  year: number;
  month: number;
  daysInMonth: number;

  schedule: Schedule;
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  violations: Violation[];

  /** Approval block from the schedule doc — used to populate the
   * approval lineage in manifest.json + reflected in README.txt. */
  approval: ApprovalBlock;

  /** Caller's identity at export time — these become the manifest's
   * `exportedBy` block. The Firestore stamp gets the same data so the
   * audit log + bundle metadata agree. */
  exportedByUid: string;
  exportedByName: string | null;
  exportedByPosition: string | null;
  exportedByEmail: string | null;
}

interface ManifestActor {
  uid: string | null;
  name: string | null;
  position: string | null;
  email: string | null;
  at: number | null;
  notes: string | null;
}

interface Manifest {
  version: string;
  generatedAt: number;
  generatedAtIso: string;
  bundleId: string;
  company: { id: string; name: string };
  month: { yyyymm: string; label: string; year: number; month: number; daysInMonth: number };
  exportedBy: { uid: string; name: string | null; position: string | null; email: string | null };
  approvalLineage: {
    submitted: ManifestActor | null;
    locked: ManifestActor | null;
    saved: ManifestActor | null;
    history: Array<{
      action: string;
      ts: number | null;
      actor: string | null;
      actorName: string | null;
      actorPosition: string | null;
      role: string | null;
      notes: string | null;
      destinationStatus: string | null;
    }>;
  };
  files: Array<{ name: string; description: string }>;
}

// Convert any of {Date | Timestamp | number} into milliseconds. Same
// shape as the renderer's other Firestore-stamp helpers.
function stampToMs(stamp: unknown): number | null {
  if (!stamp) return null;
  const t = stamp as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof stamp === 'number') return stamp;
  return null;
}

function buildManifest(inputs: BundleInputs): Manifest {
  const a = inputs.approval;
  const submitted: ManifestActor | null = a.submittedBy
    ? {
        uid: a.submittedBy ?? null,
        name: a.submittedByName ?? null,
        position: a.submittedByPosition ?? null,
        email: null,
        at: stampToMs(a.submittedAt),
        notes: a.submittedNotes ?? null,
      }
    : null;
  const locked: ManifestActor | null = a.lockedBy
    ? {
        uid: a.lockedBy ?? null,
        name: a.lockedByName ?? null,
        position: a.lockedByPosition ?? null,
        email: null,
        at: stampToMs(a.lockedAt),
        notes: a.lockedNotes ?? null,
      }
    : null;
  const saved: ManifestActor | null = a.savedBy
    ? {
        uid: a.savedBy ?? null,
        name: a.savedByName ?? null,
        position: a.savedByPosition ?? null,
        email: null,
        at: stampToMs(a.savedAt),
        notes: a.savedNotes ?? null,
      }
    : null;
  const generatedAt = Date.now();
  return {
    version: BUNDLE_VERSION,
    generatedAt,
    generatedAtIso: new Date(generatedAt).toISOString(),
    // Bundle ID = month + ms — gives downstream importers a stable
    // dedupe key when an admin re-exports after a reopen → re-save cycle.
    bundleId: `${inputs.yyyymm}-${generatedAt}`,
    company: { id: inputs.companyId, name: inputs.companyName },
    month: {
      yyyymm: inputs.yyyymm,
      label: inputs.monthLabel,
      year: inputs.year,
      month: inputs.month,
      daysInMonth: inputs.daysInMonth,
    },
    exportedBy: {
      uid: inputs.exportedByUid,
      name: inputs.exportedByName,
      position: inputs.exportedByPosition,
      email: inputs.exportedByEmail,
    },
    approvalLineage: {
      submitted,
      locked,
      saved,
      history: (a.history ?? []).map((h) => ({
        action: h.action,
        ts: stampToMs(h.ts),
        actor: h.actor ?? null,
        actorName: h.actorName ?? null,
        actorPosition: h.actorPosition ?? null,
        role: h.role ?? null,
        notes: h.notes ?? null,
        destinationStatus: h.destinationStatus ?? null,
      })),
    },
    files: [
      { name: 'manifest.json', description: 'Bundle metadata + approval lineage. Read first.' },
      { name: 'schedule.csv', description: 'Schedule grid: employees × days × shift codes.' },
      { name: 'roster.csv', description: 'Employee master data referenced by schedule.csv.' },
      { name: 'leaves.csv', description: 'Leave ranges (annual, sick, maternity, painted) overlapping this month.' },
      { name: 'compliance.json', description: 'Violations + info findings + heuristic compliance score.' },
      { name: 'README.txt', description: 'Plain-English walkthrough of the bundle layout.' },
    ],
  };
}

function buildScheduleCsv(inputs: BundleInputs): string {
  const days = Array.from({ length: inputs.daysInMonth }, (_, i) => i + 1);
  const header: (string | number)[] = ['Employee ID', 'Name', 'Role', 'Department', ...days.map((d) => `Day ${d}`)];
  const rows: (string | number | null | undefined)[][] = [header];
  for (const emp of inputs.employees) {
    const cells: (string | number | null | undefined)[] = [emp.empId, emp.name, emp.role, emp.department];
    for (const d of days) {
      cells.push(inputs.schedule[emp.empId]?.[d]?.shiftCode ?? '');
    }
    rows.push(cells);
  }
  return rowsToCsv(rows);
}

function buildRosterCsv(inputs: BundleInputs): string {
  const header = [
    'Employee ID', 'Name', 'Role', 'Department', 'Category', 'Gender', 'Contract Type',
    // v5.28 — fixed-term contract end + probation end for HRIS handoff.
    'Contract End', 'Probation End',
    'Weekly Hours', 'Base Monthly Salary', 'Base Hourly Rate', 'Hire Date', 'Phone', 'Notes',
  ];
  const rows: (string | number | null | undefined)[][] = [header];
  for (const emp of inputs.employees) {
    rows.push([
      emp.empId, emp.name, emp.role, emp.department,
      emp.category ?? 'Standard', emp.gender ?? '',
      emp.contractType, emp.contractEndDate ?? '', emp.probationEndDate ?? '',
      emp.contractedWeeklyHrs,
      emp.baseMonthlySalary, emp.baseHourlyRate,
      emp.hireDate, emp.phone, emp.notes,
    ]);
  }
  return rowsToCsv(rows);
}

function buildLeavesCsv(inputs: BundleInputs): string {
  // listAllLeaveRangesIncludingPainted gives us the union of explicit
  // ranges + ranges derived from painted AL/SL/MAT cells. Filter to ranges
  // overlapping the active month so the bundle stays scoped.
  const monthStart = `${inputs.yyyymm}-01`;
  const monthEnd = `${inputs.yyyymm}-${String(inputs.daysInMonth).padStart(2, '0')}`;
  const overlapsMonth = (r: LeaveRange) =>
    !(r.end < monthStart || r.start > monthEnd);
  const header = ['Employee ID', 'Name', 'Type', 'Start', 'End', 'Source'];
  const rows: (string | number | null | undefined)[][] = [header];
  for (const emp of inputs.employees) {
    const ranges = listAllLeaveRangesIncludingPainted(
      emp, inputs.schedule, inputs.config,
    );
    for (const r of ranges) {
      if (!overlapsMonth(r)) continue;
      // Synthetic source labels make it obvious which entries came from
      // painted cells (auto-derived) vs. the LeaveManagerModal (explicit).
      const source = r.id?.startsWith('__sched_')
        ? 'painted'
        : r.id?.startsWith('__legacy_')
          ? 'legacy'
          : 'explicit';
      rows.push([emp.empId, emp.name, r.type, r.start, r.end, source]);
    }
  }
  return rowsToCsv(rows);
}

function buildComplianceJson(inputs: BundleInputs): string {
  const hardViolations = inputs.violations.filter((v) => (v.severity ?? 'violation') === 'violation');
  const infoFindings = inputs.violations.filter((v) => v.severity === 'info');
  // Same heuristic the Lock/Save modal uses — 2 points per hard violation,
  // floored at 0. The exact number isn't load-bearing for HRIS; it's a
  // quick gauge that downstream teams can show on their dashboards.
  const score = Math.max(0, 100 - hardViolations.length * 2);
  return JSON.stringify({
    version: BUNDLE_VERSION,
    score,
    hardViolations: hardViolations.length,
    infoFindings: infoFindings.length,
    findings: inputs.violations.map((v) => ({
      empId: v.empId,
      day: v.day,
      rule: v.rule,
      article: v.article,
      message: v.message,
      severity: v.severity ?? 'violation',
      count: v.count ?? 1,
    })),
    notes: 'Severity "info" indicates a legitimate operational situation (rotating rest, holiday work paid as comp, etc.). Severity "violation" is a hard rule break. The platform reports — the human reviewer decides.',
  }, null, 2);
}

function buildReadme(inputs: BundleInputs, manifest: Manifest): string {
  const exportedAtLabel = format(new Date(manifest.generatedAt), 'yyyy-MM-dd HH:mm:ss');
  const lines: string[] = [];
  lines.push(`Iraqi Labor Scheduler — HRIS Manual Bundle`);
  lines.push(`==========================================`);
  lines.push('');
  lines.push(`Bundle ID:    ${manifest.bundleId}`);
  lines.push(`Company:      ${inputs.companyName} (${inputs.companyId})`);
  lines.push(`Month:        ${inputs.monthLabel} (${inputs.yyyymm})`);
  lines.push(`Generated:    ${exportedAtLabel}`);
  lines.push(`Generated by: ${inputs.exportedByName ?? inputs.exportedByEmail ?? inputs.exportedByUid}`);
  if (inputs.exportedByPosition) lines.push(`              ${inputs.exportedByPosition}`);
  lines.push('');
  lines.push(`Approval lineage`);
  lines.push(`----------------`);
  const formatActor = (a: ManifestActor | null, label: string): string => {
    if (!a) return `  ${label}: —`;
    const at = a.at ? format(new Date(a.at), 'yyyy-MM-dd HH:mm') : 'unknown';
    const name = a.name && a.position ? `${a.name} · ${a.position}` : (a.name ?? a.uid ?? 'unknown');
    return `  ${label}: ${name}, ${at}${a.notes ? ` — "${a.notes}"` : ''}`;
  };
  lines.push(formatActor(manifest.approvalLineage.submitted, 'Submitted'));
  lines.push(formatActor(manifest.approvalLineage.locked, 'Locked   '));
  lines.push(formatActor(manifest.approvalLineage.saved, 'Saved    '));
  lines.push('');
  lines.push(`Files in this bundle`);
  lines.push(`--------------------`);
  for (const f of manifest.files) {
    lines.push(`  ${f.name.padEnd(18)} ${f.description}`);
  }
  lines.push('');
  lines.push(`How to use`);
  lines.push(`----------`);
  lines.push(`1. Read manifest.json for machine-readable metadata + the full`);
  lines.push(`   approval history (every transition, who did it, when, with`);
  lines.push(`   what notes).`);
  lines.push(`2. Import roster.csv first so employee IDs in schedule.csv +`);
  lines.push(`   leaves.csv have somewhere to land.`);
  lines.push(`3. Import schedule.csv. Header: "Employee ID, Name, Role,`);
  lines.push(`   Department, Day 1, Day 2, ..., Day N". Each cell is the`);
  lines.push(`   shift code assigned that day, or empty if the employee is`);
  lines.push(`   off / unassigned.`);
  lines.push(`4. Import leaves.csv. Source column distinguishes "explicit"`);
  lines.push(`   ranges (entered via the LeaveManagerModal) from "painted"`);
  lines.push(`   ones derived from contiguous AL/SL/MAT cells in the grid.`);
  lines.push(`5. compliance.json carries the platform's view of the schedule`);
  lines.push(`   for record-keeping. It is reporting, not enforcement —`);
  lines.push(`   "info"-severity findings are legitimate operational`);
  lines.push(`   situations (rotating rest, holiday work paid as comp, etc.)`);
  lines.push(`   and should not be treated as violations.`);
  lines.push('');
  lines.push(`Re-exports`);
  lines.push(`----------`);
  lines.push(`If this is a re-export (the schedule was reopened, edited,`);
  lines.push(`re-saved, and re-exported), the bundle ID changes but the`);
  lines.push(`yyyymm + company stay the same. Downstream systems should`);
  lines.push(`use the bundle ID as the dedupe key.`);
  lines.push('');
  return lines.join('\r\n');
}

/**
 * Assemble the bundle and return it as a single Blob ready to be written
 * to disk by the caller. jszip is lazy-loaded inside this function so the
 * 12 KB cost is only paid by users who actually export.
 *
 * Throws on any unexpected error so the caller can surface it in the UI;
 * the error path doesn't write a partial zip.
 */
export async function assembleHrisBundle(inputs: BundleInputs): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const manifest = buildManifest(inputs);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('schedule.csv', buildScheduleCsv(inputs));
  zip.file('roster.csv', buildRosterCsv(inputs));
  zip.file('leaves.csv', buildLeavesCsv(inputs));
  zip.file('compliance.json', buildComplianceJson(inputs));
  zip.file('README.txt', buildReadme(inputs, manifest));

  // DEFLATE compression keeps the bundle small for email / file-share.
  // Level 6 is the standard speed/size compromise — text payloads
  // compress aggressively (CSVs typically 3–4× smaller).
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/**
 * Build the canonical filename for the bundle. Stable shape so HRIS
 * importers can match by glob if they need to.
 */
export function buildBundleFilename(yyyymm: string, companyId: string): string {
  return `HRIS_${companyId}_${yyyymm}.zip`;
}
