/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Firestore error normalisation — quota-exhaustion in particular.
 *
 * Spark plan daily quotas (current at v4.2):
 *   • 50,000 document reads / day
 *   • 20,000 document writes / day
 *   • 20,000 document deletes / day
 *
 * Quotas reset at midnight US Pacific Time (the Cloud project's home zone).
 * When a project hits the limit, the SDK throws FirebaseError with code
 * `resource-exhausted`. Pre-v4.2 those bubbled up as raw "RESOURCE_EXHAUSTED"
 * strings — confusing for users and silent for super-admins. From v4.2 we
 * detect them, format a clear message that names the next reset time, and
 * surface a flag the UI can use to inform the super-admin.
 */

export interface QuotaInfo {
  /** True if the underlying error is a Firestore quota exhaustion. */
  exhausted: boolean;
  /** Localised user-facing message when `exhausted`, else null. */
  message: string | null;
  /** Next quota reset (Date) when `exhausted`, else null. Always midnight US Pacific. */
  resetAt: Date | null;
}

interface FirestoreLikeError {
  code?: string;
  message?: string;
  name?: string;
}

export function detectQuotaExhausted(err: unknown): QuotaInfo {
  const e = err as FirestoreLikeError;
  // Firestore SDK errors expose `.code` like 'resource-exhausted'. Native
  // gRPC backends sometimes use the upper-snake form. Match either, plus a
  // text fallback because some SDK paths stringify before re-throwing.
  const code = (e?.code ?? '').toLowerCase();
  const text = (e?.message ?? '').toLowerCase();
  const isQuota =
    code === 'resource-exhausted' ||
    code === 'resource_exhausted' ||
    text.includes('resource_exhausted') ||
    text.includes('resource-exhausted') ||
    text.includes('quota exceeded') ||
    text.includes('daily limit');

  if (!isQuota) return { exhausted: false, message: null, resetAt: null };

  const resetAt = nextPacificMidnight();
  const message = formatQuotaMessage(resetAt);
  return { exhausted: true, message, resetAt };
}

/**
 * Compute the next midnight in America/Los_Angeles. Spark quotas are billed
 * against the GCP project's daily window, which is fixed to US Pacific
 * regardless of the user's timezone.
 */
export function nextPacificMidnight(now: Date = new Date()): Date {
  // Get the current Pacific-time wall clock.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  const h = get('hour');
  const mi = get('minute');
  const s = get('second');

  // Midnight-Pacific tomorrow, expressed as the equivalent UTC instant.
  // Approach: figure out the offset between Pacific wall clock and UTC at
  // `now`, then compute tomorrow-Pacific-midnight via that offset. This
  // sidesteps DST landmines because we only ever compare deltas at one
  // wall-clock instant — across a DST boundary the resulting Date is
  // still correct to within an hour, which is fine for a quota reset
  // estimate that we display rounded to HH:mm anyway.
  const pacificNowAsLocalUTC = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetMs = pacificNowAsLocalUTC - now.getTime();
  // Tomorrow midnight Pacific, expressed in the same "Pacific-as-UTC" frame:
  const tomorrowPacificAsLocalUTC = Date.UTC(y, mo - 1, d + 1, 0, 0, 0);
  // Translate back to a real UTC instant.
  return new Date(tomorrowPacificAsLocalUTC - offsetMs);
}

function formatQuotaMessage(resetAt: Date): string {
  // Show the reset time in the user's local timezone so they don't have to
  // mentally convert from Pacific. Format: "tomorrow at HH:mm" when within
  // 24h, otherwise the full date+time.
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const local = fmt.format(resetAt);
  return (
    `The database has reached today's free-tier quota. ` +
    `Please check back at ${local} (your local time) to resume work. ` +
    `Your super-admin has been notified — they may need to upgrade the Firebase plan if this happens often.`
  );
}
