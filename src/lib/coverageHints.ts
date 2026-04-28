// Coverage-gap suggestion engine.
//
// When the user manually paints over a working assignment (turning a work
// shift into OFF / AL / SL / MAT, or moving an employee to a non-work code),
// we may have just opened a station coverage gap on that day. This helper
// detects that, then proposes a short list of *swappable* employees who
// could take the original assignment without breaking other rules.
//
// Design notes:
//  - Output is always advisory. The caller decides whether to surface a
//    toast, ignore it, or wire a one-click swap.
//  - We do not consider the rolling-7-day weekly cap here — a single swap
//    rarely crosses it and the cost of a full pass is high. The compliance
//    engine will still flag the resulting schedule.
//  - Suggestions are scored: hours-deficit-first (so the load-balancer keeps
//    converging), then preference match, then "currently OFF on this day"
//    (we'd rather upgrade an OFF day than steal someone else's shift).

import { Employee, Shift, Station, Schedule, Config, PublicHoliday } from '../types';
import { previewAssignmentWarnings } from './compliance';
import { getEmployeeLeaveOnDate } from './leaves';

export interface CoverageGap {
  // The day-of-month (1-based) where the gap appeared.
  day: number;
  // The station whose headcount dropped (or where the cell was unassigned).
  station: Station;
  // The shift code that was removed from `vacatedEmpId`. Suggestions will
  // try to land this exact shift on the candidate employee.
  vacatedShiftCode: string;
  // The employee whose cell was changed. Excluded from suggestions.
  vacatedEmpId: string;
}

export interface CoverageSuggestion {
  empId: string;
  empName: string;
  // True when the employee currently has no work assignment on `day`.
  // The toast prefers these because the swap doesn't disturb someone else.
  currentlyOff: boolean;
  // Compliance warnings the swap would generate (informational only — the
  // user can still pick this candidate).
  warnings: string[];
  // Score: lower is better. Used to sort the toast's list.
  score: number;
  // True for the lowest-scoring entry in the returned list. The toast
  // surfaces this with a star + "Recommended" badge so the user sees the
  // most optimal pick at a glance.
  isRecommended?: boolean;
}

interface DetectArgs {
  employees: Employee[];
  shifts: Shift[];
  stations: Station[];
  holidays: PublicHoliday[];
  config: Config;
  schedule: Schedule;
  // The cell that just changed.
  empId: string;
  day: number;
  // The full edit: what was there before vs. what's there now. Either may be
  // undefined (cell was empty / cell was cleared).
  prevEntry: { shiftCode: string; stationId?: string } | undefined;
  newEntry: { shiftCode: string; stationId?: string } | undefined;
  isPeakDay: (day: number) => boolean;
  // Permissive mode: surface the gap whenever a work shift was removed,
  // even if the station's minimum headcount is 0 for the day or the
  // previous entry didn't carry a stationId. Used by the leave-pipeline so
  // adding annual / sick leave for a non-driver always yields suggestions —
  // strict mode would suppress them when normalMinHC=0 (e.g. cashier
  // stations on non-peak days). Manual paint flows keep this off so we
  // don't spam toasts when a user clears a cell at a non-required station.
  permissive?: boolean;
}

// Returns the gap struct when the edit removed coverage from a station,
// or undefined when no gap was created (no station was attached, the new
// shift is also a work shift covering the same hours, etc.).
export function detectCoverageGap(args: DetectArgs): CoverageGap | undefined {
  const { shifts, stations, prevEntry, newEntry, day, isPeakDay, employees, empId, permissive } = args;
  if (!prevEntry) return undefined;
  const prevShift = shifts.find(s => s.code === prevEntry.shiftCode);
  if (!prevShift?.isWork) return undefined;

  // Resolve the station. In strict mode the prev entry must carry a stationId;
  // in permissive mode we fall back to the employee's eligibility list so a
  // manually-painted shift without a station still yields suggestions.
  let station = prevEntry.stationId ? stations.find(s => s.id === prevEntry.stationId) : undefined;
  if (!station && permissive) {
    const emp = employees.find(e => e.empId === empId);
    if (emp) {
      // Drivers map to the first vehicle station that requires Drivers.
      // Standard staff use their eligibleStations list (or the first station
      // if none specified — matches the auto-scheduler's open-eligibility
      // semantics).
      if (emp.category === 'Driver') {
        station = stations.find(s => s.requiredRoles?.includes('Driver'));
      } else if (emp.eligibleStations.length > 0) {
        station = stations.find(s => emp.eligibleStations.includes(s.id));
      } else {
        station = stations.find(s => !s.requiredRoles?.length || s.requiredRoles.includes('Standard'));
      }
    }
  }
  if (!station) return undefined;

  // If the new entry still covers the same station with a work shift that
  // overlaps the previous shift's hours significantly, no gap was created.
  if (newEntry && newEntry.stationId === prevEntry.stationId) {
    const newShift = shifts.find(s => s.code === newEntry.shiftCode);
    if (newShift?.isWork) {
      // Same station, still working — treat as no gap.
      return undefined;
    }
  }

  // Strict mode honours the station's required-headcount threshold; permissive
  // mode treats any vacated work shift as worth suggesting alternates for.
  if (!permissive) {
    const peak = isPeakDay(day);
    const required = peak ? station.peakMinHC : station.normalMinHC;
    if (required <= 0) return undefined;
  }

  return {
    day,
    station,
    vacatedShiftCode: prevEntry.shiftCode,
    vacatedEmpId: empId,
  };
}

// Find candidate employees who could absorb `gap.vacatedShiftCode` on
// `gap.day` at `gap.station`. Returns up to `limit` suggestions sorted by score.
export function findSwapCandidates(
  gap: CoverageGap,
  args: Omit<DetectArgs, 'prevEntry' | 'newEntry' | 'empId' | 'day'>,
  limit = 5,
): CoverageSuggestion[] {
  const { employees, shifts, schedule, holidays, config } = args;
  const targetShift = shifts.find(s => s.code === gap.vacatedShiftCode);
  if (!targetShift) return [];

  const out: CoverageSuggestion[] = [];
  const shiftMap = new Map(shifts.map(s => [s.code, s]));

  for (const emp of employees) {
    if (emp.empId === gap.vacatedEmpId) continue;
    // Driver/standard category gating mirrors the auto-scheduler.
    const driver = emp.category === 'Driver';
    if (driver) {
      if (!gap.station.requiredRoles?.includes('Driver')) continue;
    } else {
      const eligible = emp.eligibleStations.length === 0 || emp.eligibleStations.includes(gap.station.id);
      if (!eligible) continue;
      if (gap.station.requiredRoles?.length && !gap.station.requiredRoles.some(r => r === emp.role || r === 'Standard')) continue;
    }

    // Skip employees on any protected leave that day. The unified helper
    // handles both v1.7 multi-range leaves and the legacy single-range fields.
    const dateStr = new Date(config.year, config.month - 1, gap.day).toISOString().slice(0, 10);
    if (getEmployeeLeaveOnDate(emp, dateStr)) continue;

    const currentEntry = schedule[emp.empId]?.[gap.day];
    const currentShift = currentEntry ? shiftMap.get(currentEntry.shiftCode) : undefined;
    const currentlyOff = !currentShift?.isWork;

    // Score: lower is better. Off employees are preferred (cost = 0); already-
    // working employees pay a penalty because picking them just shifts the
    // gap to a different station.
    let score = currentlyOff ? 0 : 100;
    // Prefer those whose preferred list includes this shift.
    if (emp.preferredShiftCodes?.includes(targetShift.code)) score -= 5;
    if (emp.avoidShiftCodes?.includes(targetShift.code)) score += 50;

    // Compute compliance warnings for advisory display only. They don't
    // disqualify the candidate — the user can still pick them.
    const warnings = previewAssignmentWarnings(emp, gap.day, targetShift.code, schedule, shifts, holidays, config);
    score += warnings.length * 3;

    out.push({
      empId: emp.empId,
      empName: emp.name,
      currentlyOff,
      warnings,
      score,
    });
  }

  const sorted = out.sort((a, b) => a.score - b.score).slice(0, limit);
  // Mark the top entry as recommended. We do this here rather than in the
  // toast component so the recommendation logic stays alongside the scoring
  // it depends on — easier to keep them in sync if we tweak the score.
  if (sorted.length > 0) sorted[0].isRecommended = true;
  return sorted;
}
