/**
 * A frozen account: one whose credits and keys are held.
 *
 * `users.frozen_at` is set by `freezeListedBuyers` in lib/sanctions.ts when a
 * wallet that paid on the USDC rail is later found on the sanctions list
 * (Linear STA-41). Nothing in code clears it; lifting a freeze is a decision
 * for a person and a lawyer (docs/OPERATIONS.md, Linear STA-49).
 *
 * Where a freeze is enforced, which between them is every way an account
 * gets service, spends or pays:
 *
 * - `lookupActiveKey` in lib/api-keys.ts: none of the account's keys
 *   validate, including a key minted after the freeze (an OAuth refresh, the
 *   dashboard). That covers the API, the MCP server and a USDC top-up.
 * - `hasPaidAccess` in lib/credits.ts: no paid entitlement, legacy tier or
 *   not. That is the gate behind every paid feature a session reaches:
 *   reverse lookups, X lists, Farcaster DMs, contract import, enrichment in
 *   saved lookups, the developer console.
 * - `canSubmit` in lib/credits.ts: no new lookup, from the site or the API,
 *   and no offer to buy (`frozen` on the verdict).
 * - `unlockJobMatches` in lib/credits.ts: no credits spent on locked matches.
 * - `chargeForJob` and `chargeForApiCall` in lib/credits.ts: a job or call in
 *   flight when the freeze lands draws nothing, and the job fails with its
 *   results cleared (lib/job-processor.ts).
 * - The x402 recover route: no key is issued or revoked.
 * - The x402 buy route and card checkout: no new money. A USDC buy into a
 *   frozen account is refused before verify; a signed-in frozen account
 *   gets no checkout session. A card payment that still lands (the freeze
 *   came between session and payment) is granted as usual, so its record is
 *   kept, and the operator is emailed to decide on a refund
 *   (`alertFrozenAccountPayment` in lib/sanctions-alerts.ts).
 *
 * The account can still sign in and read what it has. Nothing is refunded
 * by code.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users } from '@/db/schema';

/** What a frozen account is told when it tries to spend. */
export const FROZEN_ACCOUNT_MESSAGE =
  'This account is suspended. Contact help@walletlink.social.';

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
