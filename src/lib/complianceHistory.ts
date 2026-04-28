// Lightweight compliance-trend persistence backed by localStorage. The
// server doesn't recompute violations (the engine lives client-side), so we
// can't ship a server-managed history without duplicating the engine. Instead
// the dashboard records one snapshot per (company, day) on every render —
// the most recent reading wins for that day. The result is a 30-day rolling
// view good enough to spot whether things are trending up or down without
// any server work.

const STORAGE_KEY = 'iraqi-scheduler-compliance-history';
const MAX_DAYS = 30;

export interface ComplianceSnapshot {
  date: string;        // YYYY-MM-DD (calendar day, not timestamp)
  compliancePct: number;
  violations: number;
  coveragePct: number;
}

type HistoryByCompany = Record<string, ComplianceSnapshot[]>;

const safeRead = (): HistoryByCompany => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const safeWrite = (data: HistoryByCompany) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or blocked — silently drop. The trend is a nicety;
    // failing to record one snapshot doesn't break anything.
  }
};

// Read the last `days` snapshots for the given company, sorted oldest-first
// so a sparkline draws naturally left-to-right.
export function readHistory(companyId: string, days = MAX_DAYS): ComplianceSnapshot[] {
  const all = safeRead();
  const entries = all[companyId] || [];
  // Keep only the most recent `days` entries, already sorted oldest-first
  // because we always append.
  return entries.slice(-days);
}

// Record (or update) today's snapshot. Replaces any existing entry for the
// same calendar day so the user sees the latest reading rather than the
// first one of the day.
export function recordSnapshot(companyId: string, snapshot: Omit<ComplianceSnapshot, 'date'>): void {
  const today = new Date().toISOString().slice(0, 10);
  const all = safeRead();
  const list = all[companyId] || [];
  const existingIdx = list.findIndex(e => e.date === today);
  const next: ComplianceSnapshot = { date: today, ...snapshot };
  if (existingIdx >= 0) {
    list[existingIdx] = next;
  } else {
    list.push(next);
  }
  // Cap the list — drop oldest entries beyond MAX_DAYS so the file stays small.
  const trimmed = list.slice(-MAX_DAYS);
  all[companyId] = trimmed;
  safeWrite(all);
}
