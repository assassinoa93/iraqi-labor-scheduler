// Backward-compatibility migration layer.
//
// Whenever the schema gains a new field, the codebase has two options:
//   A. Make the field optional and have every reader handle `undefined`.
//   B. Backfill the field at load time so the in-memory shape is always
//      uniform and readers can rely on it being present.
//
// We use a hybrid: TypeScript marks new fields optional (so old JSON parses),
// AND this file runs every freshly-loaded record through a normaliser that
// stamps in safe defaults. The normaliser is idempotent — re-running it on
// already-normalised data is a no-op — so we can call it confidently on
// every load path (initial fetch, backup import, etc.).
//
// When you add a new field to one of the domain types in `../types.ts`:
//   1. Mark it optional in the type if older records won't have it.
//   2. Add a backfill line in the relevant normaliser below.
//   3. Bump `CURRENT_DATA_VERSION` and add a `migrate_*` block if the
//      change requires structural rewriting (e.g. renaming a field).
//
// Keeps old backups loadable forever — even those generated before the
// migration layer existed get the same treatment.

import { Employee, Shift, Station, StationGroup, PublicHoliday, Config, Schedule, ScheduleEntry, Company } from '../types';
import { DEFAULT_CONFIG } from './initialData';

// Bump this when introducing a structural migration. Stored in
// `companies.json` alongside the companies list so future versions can
// detect what level of migration the on-disk data has already received.
export const CURRENT_DATA_VERSION = 2;

// ─── Employee ────────────────────────────────────────────────────────────────
// Backfills every field we've added since the original schema. Old records
// (v1.0 → v1.5) lack `category`, `gender`, `preferredShiftCodes`, etc.
// We do NOT throw on missing required fields — instead we fall back to a
// safe default so the row remains usable.
export function normalizeEmployee(raw: Partial<Employee> & Record<string, unknown>): Employee {
  if (!raw || typeof raw !== 'object') {
    throw new Error('normalizeEmployee: input must be an object');
  }
  return {
    empId: String(raw.empId ?? `EMP-${Math.floor(1000 + Math.random() * 9000)}`),
    name: String(raw.name ?? 'Unnamed'),
    role: String(raw.role ?? ''),
    department: String(raw.department ?? ''),
    contractType: String(raw.contractType ?? 'Permanent'),
    contractedWeeklyHrs: Number(raw.contractedWeeklyHrs ?? 48),
    shiftEligibility: String(raw.shiftEligibility ?? 'All'),
    isHazardous: !!raw.isHazardous,
    isIndustrialRotating: !!raw.isIndustrialRotating,
    hourExempt: !!raw.hourExempt,
    fixedRestDay: Number(raw.fixedRestDay ?? 0),
    phone: String(raw.phone ?? ''),
    hireDate: String(raw.hireDate ?? ''),
    notes: String(raw.notes ?? ''),
    eligibleStations: Array.isArray(raw.eligibleStations) ? (raw.eligibleStations as string[]) : [],
    holidayBank: Number(raw.holidayBank ?? 0),
    annualLeaveBalance: Number(raw.annualLeaveBalance ?? 21),
    baseMonthlySalary: Number(raw.baseMonthlySalary ?? 0),
    baseHourlyRate: Number(raw.baseHourlyRate ?? 0),
    overtimeHours: Number(raw.overtimeHours ?? 0),
    // Fields below are optional in the type — only set when present so
    // downstream code can still distinguish "not specified" from a value.
    category: raw.category === 'Driver' ? 'Driver' : 'Standard',
    gender: raw.gender === 'M' || raw.gender === 'F' ? raw.gender : undefined,
    maternityLeaveStart: typeof raw.maternityLeaveStart === 'string' ? raw.maternityLeaveStart : undefined,
    maternityLeaveEnd: typeof raw.maternityLeaveEnd === 'string' ? raw.maternityLeaveEnd : undefined,
    sickLeaveStart: typeof raw.sickLeaveStart === 'string' ? raw.sickLeaveStart : undefined,
    sickLeaveEnd: typeof raw.sickLeaveEnd === 'string' ? raw.sickLeaveEnd : undefined,
    annualLeaveStart: typeof raw.annualLeaveStart === 'string' ? raw.annualLeaveStart : undefined,
    annualLeaveEnd: typeof raw.annualLeaveEnd === 'string' ? raw.annualLeaveEnd : undefined,
    preferredShiftCodes: Array.isArray(raw.preferredShiftCodes) ? (raw.preferredShiftCodes as string[]) : [],
    avoidShiftCodes: Array.isArray(raw.avoidShiftCodes) ? (raw.avoidShiftCodes as string[]) : [],
    // Multi-range leaves (v1.7+). Validate each entry; drop malformed rows.
    leaveRanges: Array.isArray(raw.leaveRanges)
      ? (raw.leaveRanges as unknown as Array<Record<string, unknown>>)
          .filter(r => r && typeof r === 'object' && typeof r.start === 'string' && typeof r.end === 'string'
            && (r.type === 'annual' || r.type === 'sick' || r.type === 'maternity'))
          .map(r => ({
            id: typeof r.id === 'string' && r.id.length > 0 ? r.id : `lv-${Math.random().toString(36).slice(2, 8)}`,
            type: r.type as 'annual' | 'sick' | 'maternity',
            start: r.start as string,
            end: r.end as string,
            notes: typeof r.notes === 'string' ? r.notes : undefined,
          }))
      : undefined,
    // Holiday-compensation toggles (v1.11+). Each entry is a YYYY-MM-DD
    // date the supervisor has elected to compensate with a paid day off
    // instead of the 2× cash premium. Pre-1.11 saves don't have this
    // field — defaults to undefined (treated as empty list = all
    // holidays paid double).
    holidayCompensations: Array.isArray(raw.holidayCompensations)
      ? (raw.holidayCompensations as unknown[]).filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d as string)) as string[]
      : undefined,
    // v1.16: group-level eligibility. Strings only; unknown group IDs are
    // simply ignored at scheduling time (no error), so reordering or
    // renaming groups stays safe.
    eligibleGroups: Array.isArray(raw.eligibleGroups)
      ? (raw.eligibleGroups as unknown[]).filter(g => typeof g === 'string') as string[]
      : undefined,
  };
}

// ─── Shift ───────────────────────────────────────────────────────────────────
export function normalizeShift(raw: Partial<Shift> & Record<string, unknown>): Shift {
  return {
    code: String(raw.code ?? ''),
    name: String(raw.name ?? ''),
    start: String(raw.start ?? '00:00'),
    end: String(raw.end ?? '00:00'),
    durationHrs: Number(raw.durationHrs ?? 0),
    breakMin: Number(raw.breakMin ?? 0),
    isIndustrial: !!raw.isIndustrial,
    isHazardous: !!raw.isHazardous,
    isWork: !!raw.isWork,
    description: String(raw.description ?? ''),
  };
}

// ─── Station ─────────────────────────────────────────────────────────────────
// v5.14.0 — sanitise an hourly-demand slot list coming from disk.
// Drops malformed entries silently rather than blowing up the load —
// the supervisor sees a station with one fewer slot, not a crash.
function normalizeHourlyDemandSlots(raw: unknown): { startHour: number; endHour: number; hc: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: { startHour: number; endHour: number; hc: number }[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const slot = s as { startHour?: unknown; endHour?: unknown; hc?: unknown };
    const startHour = Number(slot.startHour);
    const endHour = Number(slot.endHour);
    const hc = Number(slot.hc);
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || !Number.isFinite(hc)) continue;
    if (startHour < 0 || startHour > 23 || endHour < 1 || endHour > 24) continue;
    if (startHour >= endHour) continue;
    out.push({ startHour, endHour, hc: Math.max(0, hc) });
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeStation(raw: Partial<Station> & Record<string, unknown>): Station {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    normalMinHC: Number(raw.normalMinHC ?? 0),
    peakMinHC: Number(raw.peakMinHC ?? 0),
    requiredRoles: Array.isArray(raw.requiredRoles) ? (raw.requiredRoles as string[]) : undefined,
    openingTime: String(raw.openingTime ?? '00:00'),
    closingTime: String(raw.closingTime ?? '00:00'),
    color: typeof raw.color === 'string' ? raw.color : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    // v1.16: optional group membership.
    groupId: typeof raw.groupId === 'string' && raw.groupId.length > 0 ? raw.groupId : undefined,
    // v5.14.0: hourly demand profiles. Pre-v5.14 stations don't have
    // these — undefined preserves legacy "use flat min HC" behaviour.
    normalHourlyDemand: normalizeHourlyDemandSlots(raw.normalHourlyDemand),
    peakHourlyDemand: normalizeHourlyDemandSlots(raw.peakHourlyDemand),
  };
}

// v1.16: station groups are persisted alongside stations. Pre-1.16 saves
// don't include this list — defaults to empty so consumers can treat it
// uniformly without null-checks.
export function normalizeStationGroup(raw: Record<string, unknown>): StationGroup {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    color: typeof raw.color === 'string' ? raw.color : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    // v2.2.0 — preset icon name. Pre-2.2.0 groups carry undefined and the
    // renderer falls back to the default `boxes` glyph.
    icon: typeof raw.icon === 'string' ? raw.icon : undefined,
    // v5.13.0: optional eligible-roles gate. Pre-v5.13 saves carry
    // undefined — drag-drop + auto-scheduler treat absent as "no gate".
    eligibleRoles: Array.isArray(raw.eligibleRoles)
      ? (raw.eligibleRoles as unknown[]).filter((r): r is string => typeof r === 'string')
      : undefined,
  };
}

// ─── Holiday ─────────────────────────────────────────────────────────────────
export function normalizeHoliday(raw: Partial<PublicHoliday> & Record<string, unknown>): PublicHoliday {
  // v5.1.7 — accept the new 'both' mode alongside the original two.
  // Anything unrecognised falls through to undefined (= inherit).
  const compMode =
    raw.compMode === 'cash-ot' || raw.compMode === 'comp-day' || raw.compMode === 'both'
      ? raw.compMode
      : undefined;
  // v2.2.0 — stable id. Backfill from `date` when missing so legacy
  // records continue to look up the same way under their existing date
  // string (no surprise reshuffling), while a user re-dating an entry
  // post-2.2.0 keeps its identity stable across the rename.
  const date = String(raw.date ?? '');
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : (date || `holi-${Math.random().toString(36).slice(2, 10)}`);
  // v2.5.0 — multi-day holidays. Backfill durationDays = 1 for legacy
  // records (single-day was the implicit assumption everywhere). Clamp
  // to [1, 14] — Iraqi holidays never legally exceed two weeks and
  // anything outside that is almost certainly user error.
  const rawDuration = typeof raw.durationDays === 'number' ? raw.durationDays : 1;
  const durationDays = Math.max(1, Math.min(14, Math.round(rawDuration)));
  return {
    id,
    date,
    name: String(raw.name ?? ''),
    type: String(raw.type ?? 'National'),
    legalReference: String(raw.legalReference ?? 'Art. 74'),
    isFixed: typeof raw.isFixed === 'boolean' ? raw.isFixed : undefined,
    // v2.1: per-holiday Art. 74 mode override. Undefined = inherit
    // config.holidayCompMode at evaluation time.
    compMode,
    durationDays,
  };
}

// ─── Config ──────────────────────────────────────────────────────────────────
// Spread DEFAULT_CONFIG first so any field added in a future release is
// guaranteed to land with a safe value when the on-disk file predates it.
export function normalizeConfig(raw: Partial<Config> & Record<string, unknown>): Config {
  const merged: Config = { ...DEFAULT_CONFIG, ...(raw as Partial<Config>) };
  // Coerce array fields explicitly — older saves occasionally serialised
  // peakDays as a stringified number list.
  if (!Array.isArray(merged.peakDays)) {
    merged.peakDays = DEFAULT_CONFIG.peakDays;
  }
  // operatingHoursByDayOfWeek: drop malformed entries instead of trusting
  // the raw input shape.
  if (merged.operatingHoursByDayOfWeek && typeof merged.operatingHoursByDayOfWeek === 'object') {
    const cleaned: NonNullable<Config['operatingHoursByDayOfWeek']> = {};
    for (const [k, v] of Object.entries(merged.operatingHoursByDayOfWeek)) {
      const dow = Number(k);
      if (dow < 1 || dow > 7) continue;
      const entry = v as { open?: unknown; close?: unknown } | undefined;
      if (entry && typeof entry.open === 'string' && typeof entry.close === 'string') {
        cleaned[dow as 1 | 2 | 3 | 4 | 5 | 6 | 7] = { open: entry.open, close: entry.close };
      }
    }
    merged.operatingHoursByDayOfWeek = cleaned;
  }
  // v5.17.0 — fineRates: filter to numeric values only, then merge with
  // DEFAULT_CONFIG.fineRates so saves that predate v5.17 inherit the
  // seeded defaults for every rule. This means the staffing advisory's
  // fines-avoided estimate works on day one even on legacy data without
  // requiring the user to visit the Variables tab first.
  if (merged.fineRates && typeof merged.fineRates === 'object') {
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(merged.fineRates)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) cleaned[k] = v;
    }
    // Merge with seed: seed defaults for unset keys, user overrides win.
    merged.fineRates = { ...(DEFAULT_CONFIG.fineRates ?? {}), ...cleaned };
  } else {
    // Pre-v5.17 saves don't carry fineRates → inherit the seed wholesale.
    merged.fineRates = { ...(DEFAULT_CONFIG.fineRates ?? {}) };
  }
  return merged;
}

// ─── Schedule entry ──────────────────────────────────────────────────────────
// The legacy raw form is `string` (the bare shift code); the modern form is
// `{shiftCode, stationId?}`. Either is accepted on input.
export function normalizeScheduleEntry(raw: unknown): ScheduleEntry | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') return { shiftCode: raw };
  if (typeof raw === 'object') {
    const r = raw as { shiftCode?: unknown; stationId?: unknown };
    if (typeof r.shiftCode !== 'string') return undefined;
    return {
      shiftCode: r.shiftCode,
      stationId: typeof r.stationId === 'string' ? r.stationId : undefined,
    };
  }
  return undefined;
}

// Migrates an entire month → employee → day map. Drops malformed entries
// silently rather than erroring on them, so a single corrupted cell never
// blocks the rest of the file from loading.
export function normalizeSchedule(raw: unknown): Schedule {
  if (!raw || typeof raw !== 'object') return {};
  const out: Schedule = {};
  for (const [empId, days] of Object.entries(raw as Record<string, unknown>)) {
    if (!days || typeof days !== 'object') continue;
    const cleanedDays: Record<number, ScheduleEntry> = {};
    for (const [dayStr, entry] of Object.entries(days as Record<string, unknown>)) {
      const day = Number(dayStr);
      if (!Number.isFinite(day)) continue;
      const cleaned = normalizeScheduleEntry(entry);
      if (cleaned) cleanedDays[day] = cleaned;
    }
    out[empId] = cleanedDays;
  }
  return out;
}

export function normalizeAllSchedules(raw: unknown): Record<string, Schedule> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, Schedule> = {};
  for (const [monthKey, schedule] of Object.entries(raw as Record<string, unknown>)) {
    out[monthKey] = normalizeSchedule(schedule);
  }
  return out;
}

// ─── Company ─────────────────────────────────────────────────────────────────
export function normalizeCompany(raw: Partial<Company> & Record<string, unknown>): Company {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'Unnamed Company'),
    color: typeof raw.color === 'string' ? raw.color : undefined,
  };
}

// ─── Top-level convenience helpers ───────────────────────────────────────────
export function normalizeEmployees(raw: unknown): Employee[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(x => x && typeof x === 'object')
    .map(x => normalizeEmployee(x as Record<string, unknown>));
}
export function normalizeShifts(raw: unknown): Shift[] {
  if (!Array.isArray(raw)) return [];
  const shifts = raw.filter(x => x && typeof x === 'object').map(x => normalizeShift(x as Record<string, unknown>));
  // v2.1: backfill the CP (compensation) shift on existing companies. Pre-2.1
  // saves don't have it; the auto-scheduler uses CP for the comp-day rotation
  // after PH-work, so it must exist or the scheduler falls back to OFF.
  if (!shifts.some(s => s.code === 'CP')) {
    shifts.push({
      code: 'CP',
      name: 'Compensation',
      start: '00:00',
      end: '00:00',
      durationHrs: 0,
      breakMin: 0,
      isIndustrial: false,
      isHazardous: false,
      isWork: false,
      description: 'Comp rest day for prior PH work (Art. 74)',
    });
  }
  return shifts;
}
export function normalizeStations(raw: unknown): Station[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(x => x && typeof x === 'object').map(x => normalizeStation(x as Record<string, unknown>));
}
export function normalizeHolidays(raw: unknown): PublicHoliday[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(x => x && typeof x === 'object').map(x => normalizeHoliday(x as Record<string, unknown>));
}
export function normalizeCompanies(raw: unknown): Company[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(x => x && typeof x === 'object').map(x => normalizeCompany(x as Record<string, unknown>));
}
