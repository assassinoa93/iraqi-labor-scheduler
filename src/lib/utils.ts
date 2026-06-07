import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * v5.27.0 — validate a user-entered stable identifier (employee empId, shift
 * code, station id) BEFORE it becomes a Firestore document id / data-file key.
 *
 * Two real data-loss traps this closes:
 *   1. Duplicate id — both Offline (Record keyed by id) and Online
 *      (`setDoc(.../{id})`) silently OVERWRITE the existing record, so the
 *      original employee/shift/station vanishes with no error.
 *   2. Illegal id — a '/' splits a Firestore doc path into a nested
 *      subcollection (so the doc never lands where the reader looks); '.'
 *      and '..' are reserved path segments Firestore rejects outright.
 *
 * Returns an i18n key describing the failure, or null when the id is valid.
 * `existingIds` must be the ids of OTHER items only (exclude the record being
 * edited so re-saving an unchanged id passes). Duplicate detection is
 * case-insensitive: 'EMP-1' vs 'emp-1' would be distinct Firestore docs but
 * is almost always user error (and the shift library already de-dupes codes
 * case-insensitively), so we treat a case-collision as a duplicate.
 */
export function validateIdentifier(id: string, existingIds: string[]): string | null {
  const trimmed = id.trim();
  if (!trimmed) return 'validate.id.required';
  if (trimmed.includes('/')) return 'validate.id.slash';
  if (trimmed === '.' || trimmed === '..') return 'validate.id.dots';
  const lower = trimmed.toLowerCase();
  if (existingIds.some(x => x.trim().toLowerCase() === lower)) return 'validate.id.duplicate';
  return null;
}
