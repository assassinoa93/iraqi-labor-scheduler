/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — AI Advisory PDF report (phase 6).
 *
 * Renders a session's findings into a printable advisory report. Reuses
 * jsPDF + jspdf-autotable, the same toolchain `lib/pdfReport.ts` uses
 * for the operational compliance report.
 *
 * Language: English. jsPDF cannot render right-to-left Arabic glyphs
 * without a custom font (same caveat as the existing report). Iraqi
 * regulators accept English-language submissions, so this matches the
 * v5.19.1 Arabic-PDF warning posture.
 *
 * Scope: by default exports only `accepted` findings — that's the
 * curated action plan the planner has reviewed. Optional `includePending`
 * adds findings still under review. Dismissed findings are always excluded.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import type { AiSession } from './session';
import type { SessionFinding, FindingSeverity, FindingCategory } from './findings';
import type { AiScope } from './scope';

interface ExportOptions {
  /** Workspace-friendly company name for the title page. */
  companyName: string;
  /** When true, include findings still in `pending` status (default false:
   *  only `accepted` findings ship to the PDF). */
  includePending?: boolean;
}

const SEVERITY_COLORS: Record<FindingSeverity, [number, number, number]> = {
  info:      [37, 99, 235],   // blue-600
  warning:   [217, 119, 6],   // amber-600
  violation: [225, 29, 72],   // rose-600
};

const CATEGORY_LABEL: Record<FindingCategory, string> = {
  liability: 'Liability',
  cost: 'Cost',
  risk: 'Risk',
};

export function generateAiAdvisoryReport(
  session: AiSession,
  opts: ExportOptions,
): void {
  const includePending = opts.includePending ?? false;
  const findings = (session.findings ?? []).filter((f) => {
    if (f.status === 'dismissed') return false;
    if (f.status === 'accepted') return true;
    return includePending;
  });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── Title page ──────────────────────────────────────────────────────
  drawTitlePage(doc, session, opts.companyName, findings, includePending);

  // ── Findings sections (grouped by category) ─────────────────────────
  if (findings.length > 0) {
    const byCategory: Record<FindingCategory, SessionFinding[]> = {
      liability: [],
      cost: [],
      risk: [],
    };
    for (const f of findings) byCategory[f.category].push(f);

    for (const cat of ['liability', 'cost', 'risk'] as FindingCategory[]) {
      const list = byCategory[cat];
      if (list.length === 0) continue;
      doc.addPage('a4', 'portrait');
      drawCategorySection(doc, cat, list);
    }
  }

  // ── Disclaimers ─────────────────────────────────────────────────────
  doc.addPage('a4', 'portrait');
  drawDisclaimerPage(doc, session);

  const safeCompany = opts.companyName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'Workspace';
  const dateTag = format(new Date(), 'yyyy-MM-dd');
  doc.save(`${safeCompany}_AI_Advisory_${dateTag}.pdf`);
}

// ─── Page renderers ─────────────────────────────────────────────────────

function drawTitlePage(
  doc: jsPDF,
  session: AiSession,
  companyName: string,
  findings: SessionFinding[],
  includePending: boolean,
) {
  doc.setFontSize(24);
  doc.setTextColor(30, 41, 59);
  doc.text('AI Advisory Report', 20, 28);

  doc.setFontSize(14);
  doc.setTextColor(100, 116, 139);
  doc.text(companyName, 20, 38);

  doc.setFontSize(9);
  doc.setTextColor(120, 130, 145);
  doc.text(`Generated ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 20, 46);
  doc.text(`Session started ${format(new Date(session.startedAt), 'yyyy-MM-dd HH:mm')}`, 20, 52);
  doc.text(`Model: ${session.model}`, 20, 58);
  doc.text(
    `Tokens: ${session.totalTokens.total.toLocaleString()} (${session.totalTokens.prompt.toLocaleString()} in / ${session.totalTokens.completion.toLocaleString()} out)`,
    20, 64,
  );

  // ── Scope summary ───────────────────────────────────────────────────
  doc.setFontSize(13);
  doc.setTextColor(30, 41, 59);
  doc.text('Session scope', 20, 78);

  const scopeRows = scopeAsRows(session.scope);
  autoTable(doc, {
    head: [['Domain', 'Window']],
    body: scopeRows,
    startY: 82,
    theme: 'grid',
    headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    styles: { cellPadding: 2 },
    margin: { left: 20, right: 20 },
  });

  // ── Executive summary ───────────────────────────────────────────────
  const lastY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const summaryY = lastY + 12;
  doc.setFontSize(13);
  doc.setTextColor(30, 41, 59);
  doc.text('Summary', 20, summaryY);

  const counts = countByDimensions(findings);
  const summaryRows: string[][] = [
    ['Findings included', String(findings.length)],
    ['  · Accepted', String(counts.accepted)],
    ...(includePending ? [['  · Pending (under review)', String(counts.pending)]] : []),
    ['  · Severity: violations', String(counts.violations)],
    ['  · Severity: warnings', String(counts.warnings)],
    ['  · Severity: info', String(counts.info)],
    ['  · Category: liability', String(counts.liability)],
    ['  · Category: cost', String(counts.cost)],
    ['  · Category: risk', String(counts.risk)],
  ];
  autoTable(doc, {
    body: summaryRows,
    startY: summaryY + 4,
    theme: 'plain',
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 20, right: 20 },
  });

  // ── Banner if no findings to ship ───────────────────────────────────
  if (findings.length === 0) {
    const noY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;
    doc.setFontSize(10);
    doc.setTextColor(180, 80, 0);
    doc.text(
      'No findings selected for export. Accept findings in the chat panel before exporting,',
      20, noY,
    );
    doc.text("or re-run with 'Include pending' to ship findings still under review.", 20, noY + 5);
  }
}

function drawCategorySection(doc: jsPDF, category: FindingCategory, findings: SessionFinding[]) {
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text(`${CATEGORY_LABEL[category]} findings`, 15, 22);

  doc.setFontSize(9);
  doc.setTextColor(120, 130, 145);
  doc.text(`${findings.length} finding${findings.length === 1 ? '' : 's'} in this category`, 15, 28);

  // Sort: violations first, then warnings, then info — most actionable up front.
  const order: FindingSeverity[] = ['violation', 'warning', 'info'];
  const sorted = [...findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  let y = 36;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const usableWidth = pageWidth - 30;

  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    // Estimate the block height; if it won't fit, page-break.
    const evidenceLines = f.evidence.length;
    const recoLines = doc.splitTextToSize(f.recommendation || '', usableWidth - 4).length;
    const blockHeight = 20 + recoLines * 4 + evidenceLines * 4 + 6;
    if (y + blockHeight > pageHeight - 20) {
      doc.addPage('a4', 'portrait');
      y = 20;
    }

    drawFindingCard(doc, f, y, usableWidth);
    y += blockHeight + 4;
  }
}

function drawFindingCard(doc: jsPDF, f: SessionFinding, y: number, width: number) {
  const x = 15;
  const color = SEVERITY_COLORS[f.severity];
  // Severity bar on the left edge.
  doc.setFillColor(color[0], color[1], color[2]);
  doc.rect(x, y, 1.5, 16, 'F');

  // Severity + category strip
  doc.setFontSize(8);
  doc.setTextColor(color[0], color[1], color[2]);
  doc.text(f.severity.toUpperCase(), x + 4, y + 4);
  doc.setTextColor(100, 116, 139);
  doc.text(`· ${CATEGORY_LABEL[f.category]}`, x + 4 + (f.severity.length * 1.5) + 8, y + 4);
  if (f.stationId) doc.text(`· station ${f.stationId}`, x + 4 + (f.severity.length * 1.5) + 25, y + 4);
  if (f.empId) doc.text(`· employee ${f.empId}`, x + 4 + (f.severity.length * 1.5) + 50, y + 4);

  // Title
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.text(f.title, x + 4, y + 10);
  doc.setFont('helvetica', 'normal');

  // Status badge on the right edge
  doc.setFontSize(8);
  if (f.status === 'accepted') {
    doc.setTextColor(5, 150, 105);
    doc.text('ACCEPTED', x + width - 22, y + 4);
  } else if (f.status === 'pending') {
    doc.setTextColor(217, 119, 6);
    doc.text('PENDING', x + width - 20, y + 4);
  }

  // Recommendation
  let cursorY = y + 16;
  if (f.recommendation) {
    doc.setFontSize(9);
    doc.setTextColor(60, 70, 85);
    const lines = doc.splitTextToSize(f.recommendation, width - 4);
    doc.text(lines, x + 4, cursorY);
    cursorY += lines.length * 4 + 2;
  }

  // Evidence rows
  if (f.evidence.length > 0) {
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Evidence', x + 4, cursorY);
    cursorY += 3;
    doc.setFont('courier', 'normal');
    for (const e of f.evidence) {
      const text = `${e.path} = ${e.value}`;
      const lines = doc.splitTextToSize(text, width - 8);
      doc.setTextColor(60, 70, 85);
      doc.text(lines, x + 6, cursorY);
      cursorY += lines.length * 3.2;
    }
    doc.setFont('helvetica', 'normal');
  }
}

function drawDisclaimerPage(doc: jsPDF, _session: AiSession) {
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text('Notes and disclaimers', 15, 22);

  doc.setFontSize(10);
  doc.setTextColor(60, 70, 85);
  const text = [
    'About this report',
    '',
    'This advisory report was assembled from an AI-assisted session inside the Iraqi Labor Scheduler',
    'app. Findings reflect the assistant\'s reading of the workspace data within the session scope',
    "shown on page 1. The platform's compliance philosophy is reporting-not-enforcement: findings",
    "marked 'info' describe legitimate operational situations (e.g. holiday work that is compensable),",
    "while 'warnings' and 'violations' point at outcomes the planner should review against Iraqi",
    'Labor Law and internal policy.',
    '',
    'Each finding cites snapshot field paths under the "Evidence" header. These map to the canonical',
    'schedules / payroll / leave / compliance / WFP queries the assistant ran during the session;',
    'the same numbers are visible in the Schedule, Payroll, Coverage / OT, and Workforce Planning',
    'tabs of the app.',
    '',
    'Limitations',
    '',
    '- AI-generated content. Verify each finding against the underlying tabs before acting on it.',
    "- Confidence-gated. Stations whose AI profile confidence was below 40 were skipped during the",
    '  full advisory pass; ask the assistant to interview them before relying on findings about them.',
    '- Read-only. The assistant cannot mutate schedules, payroll, employees, stations, shifts,',
    '  holidays, or leave records. Recommendations are proposals only.',
    '- English language. jsPDF cannot render right-to-left Arabic glyphs without a custom font, so',
    '  the report is generated in English (Iraqi regulators accept English submissions).',
    '',
    'Privacy',
    '',
    'This session was processed by OpenRouter and the model provider you selected. By default the',
    "app sets `provider.data_collection: 'deny'` so providers may not train on your prompts.",
    'Your OpenRouter API key is encrypted at rest via the OS keychain (Electron safeStorage),',
    'stored only on this device, and never synced to Firestore.',
  ];
  let y = 30;
  for (const line of text) {
    if (line === '') { y += 3; continue; }
    if (line === 'About this report' || line === 'Limitations' || line === 'Privacy') {
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'bold');
      doc.text(line, 15, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(60, 70, 85);
      y += 6;
      continue;
    }
    doc.text(line, 15, y);
    y += 5;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function scopeAsRows(scope: AiScope): string[][] {
  const rows: string[][] = [];
  rows.push(['Schedules', formatMonthRangeOrEmpty(scope.schedules)]);
  rows.push(['Payroll', formatMonthRangeOrEmpty(scope.payroll)]);
  rows.push([
    'Leave',
    scope.leave.range
      ? `${scope.leave.range.from} → ${scope.leave.range.to} (balances as of ${scope.leave.asOf})`
      : `as of ${scope.leave.asOf}`,
  ]);
  rows.push(['WFP', scope.wfp ? String(scope.wfp.year) : '—']);
  return rows;
}

function formatMonthRangeOrEmpty(
  r: { fromYear: number; fromMonth: number; toYear: number; toMonth: number } | null,
): string {
  if (!r) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (r.fromYear === r.toYear && r.fromMonth === r.toMonth) {
    return `${months[r.fromMonth - 1]} ${r.fromYear}`;
  }
  if (r.fromYear === r.toYear) {
    return `${months[r.fromMonth - 1]}–${months[r.toMonth - 1]} ${r.fromYear}`;
  }
  return `${months[r.fromMonth - 1]} ${r.fromYear} – ${months[r.toMonth - 1]} ${r.toYear}`;
}

function countByDimensions(findings: SessionFinding[]) {
  return {
    accepted: findings.filter((f) => f.status === 'accepted').length,
    pending: findings.filter((f) => f.status === 'pending').length,
    violations: findings.filter((f) => f.severity === 'violation').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
    liability: findings.filter((f) => f.category === 'liability').length,
    cost: findings.filter((f) => f.category === 'cost').length,
    risk: findings.filter((f) => f.category === 'risk').length,
  };
}
