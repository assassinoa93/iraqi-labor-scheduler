// v2.3.0 — Workforce Plan Excel exporter.
//
// Why a separate module: the PDF exporter in WorkforcePlanningTab is a
// single dense document for printing. The Excel deliverable is the format
// HR, Finance, and the CEO actually open — they sort, filter, and copy
// numbers into recruitment plans and budget proposals. So the workbook is
// designed to be useful as a working document, not just a pretty
// readout: 7 sheets, styled headers, currency formatting, and a frozen
// header row on each sheet.
//
// Sheets:
//   1. Executive Summary — top KPIs, key decisions, sign-off block
//   2. Hiring Roadmap    — actionable rows by group + standalone station
//   3. Group Rollup      — annual recommendation per group
//   4. Station Rollup    — annual recommendation per individual station
//   5. Monthly Demand    — seasonality curve, salary by month
//   6. Budget Impact     — current vs recommended P&L view
//   7. Implementation    — start-month-vs-savings table
//
// exceljs is loaded dynamically (same pattern as jspdf in the PDF
// exporter) so it doesn't enter the main bundle.

import { AnnualWorkforcePlan, AnnualRollup, PlanMode, HiringRoadmap } from './workforcePlanning';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// exceljs's runtime types differ a bit from its TS surface. We sidestep
// the friction with a loose Cell/Row/Worksheet shape — the writes use
// the small subset that's stable across versions.
type ExcelCell = {
  value: unknown;
  font?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
  border?: Record<string, unknown>;
  numFmt?: string;
};

type ExcelRow = {
  number: number;
  height?: number;
  eachCell: (cb: (cell: ExcelCell) => void) => void;
  getCell: (idx: number) => ExcelCell;
};

type ExcelSheet = {
  name: string;
  columns: Array<{ width?: number }>;
  views?: Array<Record<string, unknown>>;
  addRow: (data: unknown[]) => ExcelRow;
  getRow: (idx: number) => ExcelRow;
  getCell: (ref: string) => ExcelCell;
  mergeCells: (range: string) => void;
};

type ExcelWorkbook = {
  creator: string;
  created: Date;
  modified: Date;
  addWorksheet: (name: string, opts?: Record<string, unknown>) => ExcelSheet;
  xlsx: { writeBuffer: () => Promise<ArrayBuffer> };
};

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const TOTAL_FONT = { bold: true, color: { argb: 'FF0F172A' }, size: 11 };
const SECTION_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const SECTION_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 };
const HIRE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }; // rose-100
const HOLD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }; // emerald-100

const IQD_FORMAT = '#,##0" IQD"';
const HOURS_FORMAT = '#,##0" h"';

interface ExportArgs {
  annual: AnnualWorkforcePlan;
  rollup: AnnualRollup;
  // v2.4.0 — month-by-month hiring schedule. Drives the Hiring Roadmap
  // sheet. Optional so legacy callers still compile, but in practice
  // the WorkforcePlanningTab always passes it.
  roadmap?: HiringRoadmap;
  mode: PlanMode;
  companyName?: string;
  // Number of currently-employed workers + their FT/PT split. Surfaced on
  // the Executive Summary sheet (the rollup's totalCurrentEmployees is a
  // count, but the FT/PT split has to come from the caller because the
  // rollup carries it per-row, not aggregated).
  currentRosterFTECount: number;
  currentRosterPartTimeCount: number;
}

export async function exportWorkforcePlanToExcel(args: ExportArgs): Promise<void> {
  const { annual, rollup, roadmap, mode, companyName = 'Iraqi Labor Scheduler', currentRosterFTECount, currentRosterPartTimeCount } = args;

  // Dynamic import keeps exceljs out of the main bundle. The package ships
  // both ESM and CJS; some bundlers wrap the default export in a
  // namespace. Accept either shape.
  const ExcelMod = await import('exceljs');
  const ExcelJS = (ExcelMod as unknown as { default?: typeof ExcelMod }).default ?? ExcelMod;
  const wb = new (ExcelJS as unknown as { Workbook: new () => ExcelWorkbook }).Workbook();
  wb.creator = companyName;
  wb.created = new Date();
  wb.modified = new Date();

  buildExecutiveSummary(wb, args, currentRosterFTECount, currentRosterPartTimeCount);
  // v2.4.0 — Hiring Roadmap sheet promoted from "per-group action list"
  // to "month-by-month plan" so HR / Finance read WHEN to hire, not just
  // how many. Previous per-group view still surfaces in Group Rollup.
  buildHiringRoadmap(wb, rollup, annual, roadmap, mode);
  buildGroupRollup(wb, rollup);
  buildStationRollup(wb, rollup);
  buildMonthlyDemand(wb, annual);
  buildBudgetImpact(wb, annual, rollup, mode, roadmap);
  buildImplementationSchedule(wb, annual);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Workforce-Plan-${annual.year}-${mode}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Clean the object URL — without this every export leaks ~50KB until
  // the tab unloads.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Sheet 1: Executive Summary ──────────────────────────────────────────
function buildExecutiveSummary(
  wb: ExcelWorkbook,
  args: ExportArgs,
  currentFTE: number,
  currentPT: number,
) {
  const { annual, rollup, mode, companyName = 'Iraqi Labor Scheduler' } = args;
  const ws = wb.addWorksheet('Executive Summary', { views: [{ state: 'frozen', ySplit: 0 }] });
  ws.columns = [
    { width: 38 }, { width: 28 }, { width: 32 },
  ];

  // Title block.
  const titleRow = ws.addRow([`${companyName} — Workforce Plan ${annual.year}`]);
  ws.mergeCells(`A${titleRow.number}:C${titleRow.number}`);
  styleCell(ws.getCell(`A${titleRow.number}`), { font: { bold: true, size: 18, color: { argb: 'FF0F172A' } }, alignment: { vertical: 'middle' } });
  titleRow.height = 28;

  const subtitleRow = ws.addRow([`Generated ${new Date().toISOString().slice(0, 10)} · Mode: ${mode === 'conservative' ? 'Conservative (FTE-only, hire-to-peak)' : 'Optimal (FTE + part-time mix)'}`]);
  ws.mergeCells(`A${subtitleRow.number}:C${subtitleRow.number}`);
  styleCell(ws.getCell(`A${subtitleRow.number}`), { font: { italic: true, size: 10, color: { argb: 'FF64748B' } } });

  ws.addRow([]);

  // Section: Demand snapshot.
  addSectionHeader(ws, 'Demand snapshot');
  const demandHeader = ws.addRow(['Metric', 'Value', 'Notes']);
  styleHeaderRow(demandHeader);

  addKVRow(ws, 'Annual demand (work-hours)', `${Math.round(annual.annualRequiredHours).toLocaleString()} h`, 'Sum of every station\'s open-window × min-headcount across the year, plus a comp-day overhead pool for holiday work.');
  addKVRow(ws, 'Peak month', `${annual.byMonth[annual.peakMonthIndex - 1].monthName} · ${Math.round(annual.byMonth[annual.peakMonthIndex - 1].monthlyRequiredHours).toLocaleString()} h`, 'Drives the conservative recommendation: hire to this level and hold through valleys.');
  addKVRow(ws, 'Valley month', `${annual.byMonth[annual.valleyMonthIndex - 1].monthName} · ${Math.round(annual.byMonth[annual.valleyMonthIndex - 1].monthlyRequiredHours).toLocaleString()} h`, 'Slack capacity period — useful for rotating leave/training.');

  ws.addRow([]);
  addSectionHeader(ws, 'Roster snapshot');
  styleHeaderRow(ws.addRow(['Metric', 'Value', 'Notes']));
  addKVRow(ws, 'Current roster (total)', rollup.totalCurrentEmployees, '');
  addKVRow(ws, 'Current FT', currentFTE, 'contractedWeeklyHrs ≥ standard cap (Art. 70).');
  addKVRow(ws, 'Current PT', currentPT, 'contractedWeeklyHrs < standard cap.');
  addKVRow(ws, 'Recommended FT', rollup.totalRecommendedFTE, mode === 'conservative' ? 'Year-round target, hire-to-peak.' : 'Average FTE across the year (optimal mode).');
  addKVRow(ws, 'Recommended PT', rollup.totalRecommendedPartTime, mode === 'conservative' ? 'Conservative mode never recommends PT.' : 'Covers the seasonal surge above the FTE baseline.');
  const totalRec = rollup.totalRecommendedFTE + rollup.totalRecommendedPartTime;
  addKVRow(ws, 'Recommended total', totalRec, `Net change vs current: ${(totalRec - rollup.totalCurrentEmployees) >= 0 ? '+' : ''}${totalRec - rollup.totalCurrentEmployees}`);

  ws.addRow([]);
  addSectionHeader(ws, 'Budget snapshot');
  styleHeaderRow(ws.addRow(['Metric', 'Value (IQD)', 'Notes']));
  addKVRow(ws, 'Annual current salary', annual.annualCurrentSalary, 'Sum of current employees\' baseMonthlySalary × 12.', IQD_FORMAT);
  addKVRow(ws, 'Annual recommended salary', annual.annualRecommendedSalary, 'Sum of monthly recommended salary across the year.', IQD_FORMAT);
  const delta = annual.annualDelta;
  addKVRow(ws, 'Annual delta', delta, delta < 0 ? `Saving ${Math.abs(delta).toLocaleString()} IQD/yr vs current.` : `Investment of ${delta.toLocaleString()} IQD/yr to reach recommended coverage.`, IQD_FORMAT);
  if (mode === 'conservative') {
    addKVRow(ws, 'Legal-safety premium', rollup.legalSafetyPremium, 'Cost vs the (legally tricky) optimal mix — what you pay to keep the year-round headcount stable.', IQD_FORMAT);
  }

  ws.addRow([]);
  addSectionHeader(ws, 'Decisions requested');
  styleHeaderRow(ws.addRow(['Function', 'Decision', 'Sign-off']));
  const decisions = [
    ['HR Director', `Approve the ${rollup.byGroup.filter(g => g.action === 'hire').reduce((s, g) => s + g.delta, 0) + rollup.byStation.filter(s => s.action === 'hire' && !rollup.byGroup.some(g => g.stationIds.includes(s.stationId))).reduce((s, x) => s + x.delta, 0)} new hires recommended in this plan.`, ''],
    ['Finance Director', `Allocate budget for the recommended salary delta (${delta >= 0 ? '+' : ''}${delta.toLocaleString()} IQD/yr).`, ''],
    ['CEO', 'Green-light the year-round target headcount and the implementation start month from the schedule sheet.', ''],
  ];
  for (const row of decisions) {
    const r = ws.addRow(row);
    r.height = 28;
    r.eachCell(c => {
      c.alignment = { vertical: 'top', wrapText: true };
      c.border = thinBorder();
    });
    // Sign-off column in rose so it's visible empty.
    styleCell(r.getCell(3), { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } }, border: thinBorder() });
  }

  ws.addRow([]);
  const footerRow = ws.addRow(['Generated by Iraqi Labor Scheduler — workforce planning is reporting, not enforcement. Verify against your HR records before approving hires.']);
  ws.mergeCells(`A${footerRow.number}:C${footerRow.number}`);
  styleCell(ws.getCell(`A${footerRow.number}`), { font: { italic: true, size: 9, color: { argb: 'FF94A3B8' } }, alignment: { wrapText: true } });
  footerRow.height = 22;
}

// ── Sheet 2: Hiring Roadmap ──────────────────────────────────────────
// v2.4.0 — month-by-month plan instead of the v2.3 per-group action list.
// Two blocks on this sheet: a Headline block at the top (savings figures
// + lead-time assumption), then the 12-row monthly schedule with adds /
// releases / end-of-month roster / cost / reasoning. The per-group
// "where" answer still lives in the Group Rollup sheet.
function buildHiringRoadmap(
  wb: ExcelWorkbook,
  rollup: AnnualRollup,
  annual: AnnualWorkforcePlan,
  roadmap: HiringRoadmap | undefined,
  mode: PlanMode,
) {
  const ws = wb.addWorksheet('Hiring Roadmap', { views: [{ state: 'frozen', ySplit: 0 }] });
  ws.columns = [
    { width: 12 }, // Month
    { width: 10 }, // +FTE
    { width: 10 }, // +PT
    { width: 10 }, // -PT
    { width: 12 }, // FTE end
    { width: 12 }, // PT end
    { width: 14 }, // Need FTE / PT
    { width: 18 }, // Monthly cost
    { width: 50 }, // Reasoning
  ];

  // Title block.
  const titleRow = ws.addRow([`Monthly Hiring Plan — ${annual.year}`]);
  ws.mergeCells(`A${titleRow.number}:I${titleRow.number}`);
  styleCell(ws.getCell(`A${titleRow.number}`), { font: { bold: true, size: 16, color: { argb: 'FF0F172A' } } });
  titleRow.height = 26;

  if (!roadmap) {
    const note = ws.addRow(['Roadmap data not available — re-export with the latest WorkforcePlanningTab to populate this sheet.']);
    ws.mergeCells(`A${note.number}:I${note.number}`);
    styleCell(ws.getCell(`A${note.number}`), { font: { italic: true, color: { argb: 'FF94A3B8' } } });
    return;
  }

  const savingsPct = roadmap.baselineAnnualCost > 0
    ? Math.round((roadmap.savingsVsBaseline / roadmap.baselineAnnualCost) * 100)
    : 0;

  // Headline block.
  ws.addRow([]);
  addSectionHeader(ws, 'Plan summary');
  styleHeaderRow(ws.addRow(['Metric', 'Value', 'Notes', '', '', '', '', '', '']));
  addKVRow(ws, 'Total FTE adds', roadmap.totalFTEAdds, 'Sum of monthly FTE hires across the year.');
  if (mode === 'optimal') {
    addKVRow(ws, 'Total PT adds', roadmap.totalPTAdds, 'PT contracts started across the year.');
    addKVRow(ws, 'Total PT releases', roadmap.totalPTReleases, 'PT contracts ended (= scaling down after surge).');
  }
  addKVRow(ws, 'Smart annual cost (phased)', roadmap.smartAnnualCost, 'Sum of payroll across the 12-month phased plan.', IQD_FORMAT);
  addKVRow(ws, 'Baseline cost (hire-all-in-Jan)', roadmap.baselineAnnualCost, 'Naive alternative: hire to peak in January and hold all year.', IQD_FORMAT);
  addKVRow(ws, 'Annual savings vs baseline', roadmap.savingsVsBaseline, `${savingsPct}% saved by deferring hires until needed.`, IQD_FORMAT);
  addKVRow(ws, 'Lead time assumption', `${roadmap.leadMonths} month(s)`, 'Hires placed in month X are productive starting month X + lead.');
  addKVRow(ws, 'Starting roster', `${roadmap.startingFTE} FT + ${roadmap.startingPT} PT`, 'Roster the plan was built on.');

  ws.addRow([]);
  addSectionHeader(ws, 'Month-by-month schedule');
  // Schedule header.
  styleHeaderRow(ws.addRow(['Month', '+FTE', '+PT', '-PT', 'FTE end', 'PT end', 'Need FTE / PT', 'Monthly cost (IQD)', 'Action / reasoning']));

  for (const step of roadmap.steps) {
    const hasAction = step.fteAdds > 0 || step.ptAdds > 0;
    const hasRelease = step.ptReleases > 0;
    const row = ws.addRow([
      step.monthName,
      step.fteAdds > 0 ? step.fteAdds : '—',
      step.ptAdds > 0 ? step.ptAdds : '—',
      step.ptReleases > 0 ? step.ptReleases : '—',
      step.fteEnd,
      step.ptEnd,
      `${step.monthlyRequiredFTE} / ${step.monthlyRequiredPT}`,
      Math.round(step.monthlyCost),
      step.reasoning,
    ]);
    row.eachCell(c => {
      c.alignment = { vertical: 'top', wrapText: true };
      c.border = thinBorder();
      if (hasAction) c.fill = HIRE_FILL;
      else if (hasRelease) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; // amber-100
      else c.fill = HOLD_FILL;
    });
    row.getCell(8).numFmt = IQD_FORMAT;
    row.height = 32;
  }

  // Totals row.
  const tot = ws.addRow([
    'TOTAL',
    roadmap.totalFTEAdds || '—',
    roadmap.totalPTAdds || '—',
    roadmap.totalPTReleases || '—',
    roadmap.peakFTE,
    mode === 'optimal' ? roadmap.peakPT : '—',
    '',
    Math.round(roadmap.smartAnnualCost),
    `Savings vs baseline: ${roadmap.savingsVsBaseline.toLocaleString()} IQD (${savingsPct}%)`,
  ]);
  tot.eachCell(c => { c.fill = TOTAL_FILL; c.font = TOTAL_FONT; c.border = thinBorder(); c.alignment = { vertical: 'top', wrapText: true }; });
  tot.getCell(8).numFmt = IQD_FORMAT;
  tot.height = 28;

  // Surface the per-group "where to hire" so the supervisor sees both
  // dimensions (when AND where) on one sheet. This is a compressed
  // restatement of the Group Rollup sheet — full detail still lives there.
  ws.addRow([]);
  addSectionHeader(ws, 'Where to hire — peak-driven per group');
  styleHeaderRow(ws.addRow(['Group', 'Net hire', 'Suggested start', 'Peak month', 'Reasoning', '', '', '', '']));
  const groupedStationIds = new Set(rollup.byGroup.flatMap(g => g.stationIds));
  type WhereRow = { name: string; netHire: number; startMonth: string; peakMonth: string; reasoning: string; isGroup: boolean };
  const whereRows: WhereRow[] = [];
  for (const g of rollup.byGroup) {
    if (g.delta <= 0) continue;
    whereRows.push({
      name: g.groupName, netHire: g.delta,
      startMonth: suggestStartMonth(g.peakMonthIndex, g.delta),
      peakMonth: MONTH_NAMES[g.peakMonthIndex - 1],
      reasoning: g.reasoning, isGroup: true,
    });
  }
  for (const s of rollup.byStation) {
    if (groupedStationIds.has(s.stationId) || s.delta <= 0) continue;
    whereRows.push({
      name: s.stationName, netHire: s.delta,
      startMonth: suggestStartMonth(s.peakMonthIndex, s.delta),
      peakMonth: MONTH_NAMES[s.peakMonthIndex - 1],
      reasoning: s.reasoning, isGroup: false,
    });
  }
  whereRows.sort((a, b) => b.netHire - a.netHire);
  if (whereRows.length === 0) {
    const empty = ws.addRow(['No hire actions — current roster covers demand across the year.']);
    ws.mergeCells(`A${empty.number}:I${empty.number}`);
    styleCell(ws.getCell(`A${empty.number}`), { font: { italic: true, color: { argb: 'FF94A3B8' } } });
  } else {
    for (const r of whereRows) {
      const row = ws.addRow([r.name, r.netHire, r.startMonth, r.peakMonth, r.reasoning, '', '', '', '']);
      row.eachCell(c => { c.alignment = { vertical: 'top', wrapText: true }; c.border = thinBorder(); c.fill = HIRE_FILL; });
      row.height = 28;
    }
  }
}

// ── Sheet 3: Group Rollup ──────────────────────────────────────────
function buildGroupRollup(wb: ExcelWorkbook, rollup: AnnualRollup) {
  const ws = wb.addWorksheet('Group Rollup', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { width: 26 }, { width: 12 }, { width: 16 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 12 }, { width: 36 },
  ];
  ws.addRow(['Group', '# stations', 'Annual hours', 'Current FT', 'Current PT', 'Rec FT', 'Rec PT', 'Delta', 'Action', 'Peak month', 'Reasoning']);
  styleHeaderRow(ws.getRow(1));
  for (const g of rollup.byGroup) {
    const row = ws.addRow([
      g.groupName, g.stationIds.length, Math.round(g.annualRequiredHours),
      g.currentFTECount, g.currentPartTimeCount,
      g.recommendedFTE, g.recommendedPartTime, g.delta,
      g.action.toUpperCase(), MONTH_NAMES[g.peakMonthIndex - 1], g.reasoning,
    ]);
    row.eachCell(c => { c.alignment = { vertical: 'top', wrapText: true }; c.border = thinBorder(); });
    row.getCell(3).numFmt = HOURS_FORMAT;
    if (g.action === 'hire') row.getCell(9).fill = HIRE_FILL;
    else row.getCell(9).fill = HOLD_FILL;
    row.height = 28;
  }
  if (rollup.byGroup.length === 0) {
    const empty = ws.addRow(['No station groups defined — see Station Rollup sheet for per-station detail.']);
    ws.mergeCells(`A${empty.number}:K${empty.number}`);
    styleCell(ws.getCell(`A${empty.number}`), { font: { italic: true, color: { argb: 'FF94A3B8' } } });
  }
}

// ── Sheet 4: Station Rollup ──────────────────────────────────────────
function buildStationRollup(wb: ExcelWorkbook, rollup: AnnualRollup) {
  const ws = wb.addWorksheet('Station Rollup', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { width: 26 }, { width: 14 }, { width: 16 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 12 }, { width: 36 },
  ];
  ws.addRow(['Station', 'Role hint', 'Annual hours', 'Current FT', 'Current PT', 'Rec FT', 'Rec PT', 'Delta', 'Action', 'Peak month', 'Reasoning']);
  styleHeaderRow(ws.getRow(1));
  for (const s of rollup.byStation) {
    const row = ws.addRow([
      s.stationName, s.roleHint || '—', Math.round(s.annualRequiredHours),
      s.currentFTECount, s.currentPartTimeCount,
      s.recommendedFTE, s.recommendedPartTime, s.delta,
      s.action.toUpperCase(), MONTH_NAMES[s.peakMonthIndex - 1], s.reasoning,
    ]);
    row.eachCell(c => { c.alignment = { vertical: 'top', wrapText: true }; c.border = thinBorder(); });
    row.getCell(3).numFmt = HOURS_FORMAT;
    if (s.action === 'hire') row.getCell(9).fill = HIRE_FILL;
    else row.getCell(9).fill = HOLD_FILL;
    row.height = 28;
  }
}

// ── Sheet 5: Monthly Demand ──────────────────────────────────────────
function buildMonthlyDemand(wb: ExcelWorkbook, annual: AnnualWorkforcePlan) {
  const ws = wb.addWorksheet('Monthly Demand', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { width: 12 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 14 },
  ];
  ws.addRow(['Month', 'Required hours', 'Rec FT', 'Rec PT', 'Monthly salary (IQD)', '% of peak']);
  styleHeaderRow(ws.getRow(1));
  const peakHrs = annual.byMonth[annual.peakMonthIndex - 1].monthlyRequiredHours;
  for (const m of annual.byMonth) {
    const pct = peakHrs > 0 ? Math.round((m.monthlyRequiredHours / peakHrs) * 100) : 0;
    const row = ws.addRow([
      m.monthName,
      Math.round(m.monthlyRequiredHours),
      m.recommendedFTE,
      m.recommendedPartTime,
      Math.round(m.recommendedMonthlySalary),
      `${pct}%`,
    ]);
    row.eachCell(c => { c.border = thinBorder(); });
    row.getCell(2).numFmt = HOURS_FORMAT;
    row.getCell(5).numFmt = IQD_FORMAT;
    if (m.monthIndex === annual.peakMonthIndex) {
      row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }; });
    } else if (m.monthIndex === annual.valleyMonthIndex) {
      row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }; });
    }
  }
  // Totals row.
  const totalHours = annual.byMonth.reduce((s, m) => s + m.monthlyRequiredHours, 0);
  const totalSalary = annual.byMonth.reduce((s, m) => s + m.recommendedMonthlySalary, 0);
  const tot = ws.addRow(['Year', Math.round(totalHours), '', '', Math.round(totalSalary), '']);
  tot.eachCell(c => { c.fill = TOTAL_FILL; c.font = TOTAL_FONT; c.border = thinBorder(); });
  tot.getCell(2).numFmt = HOURS_FORMAT;
  tot.getCell(5).numFmt = IQD_FORMAT;
}

// ── Sheet 6: Budget Impact ──────────────────────────────────────────
function buildBudgetImpact(wb: ExcelWorkbook, annual: AnnualWorkforcePlan, rollup: AnnualRollup, mode: PlanMode, roadmap?: HiringRoadmap) {
  const ws = wb.addWorksheet('Budget Impact', { views: [{ state: 'frozen', ySplit: 0 }] });
  ws.columns = [{ width: 38 }, { width: 22 }, { width: 36 }];

  const titleRow = ws.addRow(['Budget Impact — annual view']);
  ws.mergeCells(`A${titleRow.number}:C${titleRow.number}`);
  styleCell(ws.getCell(`A${titleRow.number}`), { font: { bold: true, size: 14, color: { argb: 'FF0F172A' } } });
  ws.addRow([]);

  styleHeaderRow(ws.addRow(['Line item', 'Amount (IQD/yr)', 'Notes']));

  addBudgetRow(ws, 'Current annual salary', annual.annualCurrentSalary, 'Today\'s payroll × 12.');
  addBudgetRow(ws, 'Recommended annual salary', annual.annualRecommendedSalary, 'Sum of monthly recommended salary.');
  addBudgetRow(ws, 'Net delta (recommended − current)', annual.annualDelta, annual.annualDelta < 0 ? 'Saving — reinvest into training/benefits.' : 'Investment — line up funding before hire window.');
  ws.addRow([]);
  addBudgetRow(ws, 'Annual conservative cost', rollup.annualConservativeSalary, 'Hire-to-peak headcount × 12 × avg FTE salary.');
  addBudgetRow(ws, 'Annual optimal cost', rollup.annualOptimalSalary, 'Cost of the FTE+PT mix (hard to execute legally).');
  addBudgetRow(ws, 'Legal-safety premium', rollup.legalSafetyPremium, mode === 'conservative' ? 'You are paying this to avoid releases; built into the conservative plan.' : 'Reference only — optimal mode does not pay this.');

  ws.addRow([]);
  styleHeaderRow(ws.addRow(['Headcount line', 'Persons', 'Notes']));
  addKVRow(ws, 'Current roster', rollup.totalCurrentEmployees, '');
  addKVRow(ws, 'Recommended FT', rollup.totalRecommendedFTE, '');
  addKVRow(ws, 'Recommended PT', rollup.totalRecommendedPartTime, '');
  addKVRow(ws, 'Net hires', Math.max(0, rollup.totalRecommendedFTE + rollup.totalRecommendedPartTime - rollup.totalCurrentEmployees), 'Sum of positive deltas across hire actions.');

  // v2.4.0 — Phasing impact. Surfaces the savings the Hiring Roadmap
  // sheet computes so Finance sees the bottom-line on the budget tab too.
  if (roadmap) {
    ws.addRow([]);
    addSectionHeader(ws, 'Phasing impact (vs hire-all-in-Jan)');
    styleHeaderRow(ws.addRow(['Line item', 'Amount (IQD/yr)', 'Notes']));
    addBudgetRow(ws, 'Phased plan annual cost', roadmap.smartAnnualCost, 'Sum of payroll across the 12 phased months.');
    addBudgetRow(ws, 'Hire-everyone-in-Jan baseline', roadmap.baselineAnnualCost, 'Cost of hiring to peak in Jan and holding through the year.');
    addBudgetRow(ws, 'Savings vs baseline', roadmap.savingsVsBaseline, 'Pure timing — no change in headcount target, just when hires arrive.');
  }
}

// ── Sheet 7: Implementation Schedule ──────────────────────────────────
function buildImplementationSchedule(wb: ExcelWorkbook, annual: AnnualWorkforcePlan) {
  const ws = wb.addWorksheet('Implementation', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ width: 14 }, { width: 16 }, { width: 22 }, { width: 36 }];
  ws.addRow(['Start month', 'Months remaining', 'Annual savings (IQD)', 'Comment']);
  styleHeaderRow(ws.getRow(1));
  for (const r of annual.savingsByStartMonth) {
    const row = ws.addRow([
      r.monthName, r.remainingMonths, r.savings,
      r.savings > 0
        ? 'Net positive — adopt from this month forward saves money.'
        : r.savings < 0 ? 'Net cost — only justified if peak coverage is non-negotiable.'
          : 'Neutral — current and recommended are roughly equivalent through year end.',
    ]);
    row.eachCell(c => { c.border = thinBorder(); c.alignment = { vertical: 'top', wrapText: true }; });
    row.getCell(3).numFmt = IQD_FORMAT;
    if (r.savings > 0) row.eachCell(c => { c.fill = HOLD_FILL; });
    else if (r.savings < 0) row.eachCell(c => { c.fill = HIRE_FILL; });
    row.height = 28;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────
function thinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };
}

function styleCell(cell: ExcelCell, props: Partial<ExcelCell>) {
  if (props.font) cell.font = { ...(cell.font || {}), ...props.font };
  if (props.fill) cell.fill = props.fill;
  if (props.alignment) cell.alignment = props.alignment;
  if (props.border) cell.border = props.border;
  if (props.numFmt) cell.numFmt = props.numFmt;
}

function styleHeaderRow(row: ExcelRow) {
  row.height = 22;
  row.eachCell(c => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    c.border = thinBorder();
  });
}

function addSectionHeader(ws: ExcelSheet, label: string) {
  const row = ws.addRow([label]);
  ws.mergeCells(`A${row.number}:C${row.number}`);
  const cell = ws.getCell(`A${row.number}`);
  cell.fill = SECTION_FILL;
  cell.font = SECTION_FONT;
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
  row.height = 24;
}

function addKVRow(ws: ExcelSheet, key: string, value: unknown, note: string, numFmt?: string) {
  const row = ws.addRow([key, value, note]);
  row.eachCell(c => {
    c.border = thinBorder();
    c.alignment = { vertical: 'top', wrapText: true };
  });
  row.height = 24;
  if (numFmt) row.getCell(2).numFmt = numFmt;
}

function addBudgetRow(ws: ExcelSheet, label: string, amount: number, note: string) {
  const row = ws.addRow([label, amount, note]);
  row.getCell(2).numFmt = IQD_FORMAT;
  row.eachCell(c => { c.border = thinBorder(); c.alignment = { vertical: 'top', wrapText: true }; });
  row.height = 24;
}

// Suggest a hiring start month: aim to have hires productive ~2 months
// before the role's peak month so onboarding completes in time. Wraps
// around the year (Dec → Oct, etc.). For surplus rows we just say "—".
function suggestStartMonth(rolePeak: number, delta: number): string {
  if (delta <= 0) return '—';
  let target = rolePeak - 2;
  if (target < 1) target += 12;
  return MONTH_NAMES[target - 1];
}
