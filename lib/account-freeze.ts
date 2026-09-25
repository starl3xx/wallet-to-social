/**
 * A frozen account: one whose credits and keys are held.
 *
 * `users.frozen_at` is set by `freezeListedBuyers` in lib/sanctions.ts when a
 * wallet that paid on the USDC rail is later found on the sanctions list
 * (Linear STA-41). Nothing in code clears it; lifting a freeze is a decision
 * for a person and a lawyer (docs/OPERATIONS.md, Linear STA-49).
 *
 * A freeze is enforced in three places, which between them are every way an
 * account spends:
 *
 * - `lookupActiveKey` in lib/api-keys.ts: none of the account's keys
 *   validate, including a key minted after the freeze (x402 recovery, an
 *   OAuth refresh, the dashboard). That covers the API, the MCP server and a
 *   top-up.
 * - `canSubmit` in lib/credits.ts: no new lookup, from the site or the API.
 * - `unlockJobMatches` in lib/credits.ts: no credits spent on locked matches.
 *
 * The account can still sign in and read what it has. Nothing is refunded.
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
