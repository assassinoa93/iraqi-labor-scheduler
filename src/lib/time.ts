// Hour parsing for the HH:mm strings used throughout the app's data model.
// Consolidated here so we don't duplicate `parseInt(x.split(':')[0])` in every
// view. The auto-scheduler uses these on its hot path; if you change the
// signature, profile that loop before merging.

export interface HourBounds {
  open: number;
  close: number;
}

// Returns the hour component (0-23) of an "HH:mm" string. Returns 0 for
// malformed input so a bad data row doesn't crash the renderer; the
// EmployeeModal / StationModal validate at write time.
export function parseHour(hhmm: string | undefined): number {
  if (!hhmm) return 0;
  const n = parseInt(hhmm.split(':')[0], 10);
  return Number.isFinite(n) ? n : 0;
}

// Convenience for the (open, close) pairs we use on stations and shifts.
export function parseHourBounds(start: string, end: string): HourBounds {
  return { open: parseHour(start), close: parseHour(end) };
}
