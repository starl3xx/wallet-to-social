/**
 * A frozen account: one whose credits and keys are held.
 *
 * `users.frozen_at` is set by `freezeListedBuyers` in lib/sanctions.ts when a
 * wallet that paid on the USDC rail is later found on the sanctions list
 * (Linear STA-41). Only an operator lifts it, on legal advice, with
 * scripts/sanctions-lift-freeze.ts (docs/OPERATIONS.md, Linear STA-49).
 *
 * Where a freeze is enforced, which between them is every way an account
 * gets service, spends or pays:
 *
 * - `lookupActiveKey` in lib/api-keys.ts: none of the account's keys
 *   validate, including a key minted after the freeze (an OAuth refresh, the
 *   dashboard). That covers the API, the MCP server and a USDC top-up.
 * - `hasPaidAccess` in lib/credits.ts: no paid entitlement, legacy tier or
 *   not. That is the gate behind every paid feature a session reaches:
 *   reverse lookups, X lists, Farcaster DMs, contract import, enrichment and
 *   merges in saved lookups, the developer console. The gates that would
 *   otherwise offer a pack (reverse lookups, X lists, Farcaster DMs, contract
 *   import, saved-lookup merges) check the freeze first and answer
 *   `frozenAccountResponse()` instead.
 * - `canSubmit` in lib/credits.ts: no new lookup, from the site or the API,
 *   and no offer to buy (`frozen` on the verdict).
 * - `unlockJobMatches` in lib/credits.ts: no credits spent on locked matches.
 * - `chargeForJob` and `chargeForApiCall` in lib/credits.ts: a job or call in
 *   flight when the freeze lands draws nothing, and the job fails with its
 *   results cleared (lib/job-processor.ts).
 * - The x402 recover route: no key is issued or revoked.
 * - The x402 buy route and card checkout: no new money. A USDC buy into a
 *   frozen account is refused after verify has proven the payer and before
 *   settle; a top-up with its key gets the same 403 (`isFrozenAccountKey`);
 *   a signed-in frozen account gets no checkout session. A card payment that
 *   still lands on it is granted as usual, so its record is kept, and the
 *   operator is emailed to decide on a refund (`alertFrozenAccountPayment`
 *   in lib/sanctions-alerts.ts).
 *
 * The account can still sign in and read what it has. Nothing is refunded
 * by code.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users } from '@/db/schema';

/** What a frozen account is told when it tries to spend. */
export const FROZEN_ACCOUNT_MESSAGE =
  'This account is suspended. Contact help@walletlink.social.';

/**
 * The answer a paid-feature gate gives a frozen account: the message, a code
 * the client can tell apart, and no `upgradeRequired`, so no buy button is
 * shown for a purchase the checkout would refuse. `message` repeats `error`
 * for the clients that read that field.
 */
export function frozenAccountResponse(): NextResponse {
  return NextResponse.json(
    {
      error: FROZEN_ACCOUNT_MESSAGE,
      message: FROZEN_ACCOUNT_MESSAGE,
      code: 'ACCOUNT_SUSPENDED',
    },
    { status: 403 }
  );
}

/**
 * Whether this account is frozen. Throws when the database does; the callers
 * then fail as they would on any other read, which refuses the spend.
 */
export async function isAccountFrozen(userId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const [row] = await db
    .select({ frozenAt: users.frozenAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Boolean(row?.frozenAt);
}
