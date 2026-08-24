const USER_ID_KEY = 'wallet-to-social-user-id';

/**
 * The shape of an anonymous browser id: a v4-ish uuid, case-insensitive.
 *
 * Shared with `app/api/jobs/route.ts`, which rejects a body `userId` that fails
 * it. Kept here rather than there because this module is what produces the
 * value, and a validator that lives away from its producer is how the two stop
 * agreeing.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a well-formed anonymous browser id. */
export function isAnonUserId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Get or create a unique user ID stored in localStorage.
 * Used to associate lookups with users until proper auth is implemented.
 *
 * A stored value that is not a uuid is replaced rather than sent. localStorage
 * is writable by anything running on the origin and survives forever, so a
 * browser holding a corrupt value would otherwise get a 400 on every lookup
 * from the validation in `app/api/jobs/route.ts`, permanently, with no way to
 * recover short of clearing site data. Regenerating costs the visitor their
 * link to previous anonymous lookups, which is the lesser loss and is what a
 * cleared cache already does.
 */
export function getUserId(): string {
  if (typeof window === 'undefined') return '';

  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId || !isAnonUserId(userId)) {
    userId = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}
