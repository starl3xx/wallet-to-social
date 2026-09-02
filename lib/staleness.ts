/**
 * When a record is reported stale, decided in one place.
 *
 * `GET /v1/wallet/{address}` has always derived `meta.stale` from two facts:
 * the record's own `stale_at` deadline, and a fallback age bound for records
 * that never got one. When `POST /v1/batch` gained per-row `stale`
 * (2026-09-01, tier B item 10 of docs/AGENT-SYSTEM.md), the derivation would
 * have existed twice, with the 30-day number typed in both, which is exactly
 * the drift `lib/packs.ts` exists to prevent for prices. So the number and the
 * rule live here and both routes import them.
 */

/**
 * A record whose `stale_at` has passed is stale; so is one that has not
 * changed in this many days, whatever its deadline says.
 */
export const STALE_AFTER_DAYS = 30;

export function isRecordStale(
  staleAt: Date | null,
  lastUpdatedAt: Date | null,
  now: Date = new Date()
): boolean {
  const pastDeadline = staleAt !== null && now > staleAt;
  const unchangedTooLong =
    lastUpdatedAt !== null &&
    now.getTime() - lastUpdatedAt.getTime() >
      STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  return pastDeadline || unchangedTooLong;
}
