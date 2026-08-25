/**
 * The account a wallet gets when it pays onchain.
 *
 * ## Why there is an account at all
 *
 * The x402 pitch is "no account, no card, no email", and that is what the buyer
 * experiences: they sign a payment and receive a key. Underneath there has to
 * be a row, because credits hang off `users.id` through five NOT NULL foreign
 * keys (`credit_lots`, `credit_ledger`, `api_keys`, `auth_sessions`,
 * `lifecycle_emails`) and the billing path resolves `api_keys.user_id` before
 * it can charge anything. Making the balance hang off the key instead would
 * mean rewriting `getBalance`, `drawDown`, `chargeForApiCall`,
 * `effectiveTierForUserId` and the account-level rate-limit aggregation for one
 * buyer type. The row is the cheaper truth.
 *
 * ## The email is synthetic and undeliverable on purpose
 *
 * `users.email` is NOT NULL and UNIQUE, and nothing validates its shape, so a
 * wallet-derived address satisfies the schema. `.invalid` is reserved by
 * RFC 2606 and guaranteed never to resolve, so a message sent here by mistake
 * dies at DNS instead of reaching a stranger who happens to own the domain.
 *
 * Belt and braces, because "nothing should mail this account" is a claim about
 * every current and future caller rather than about one:
 *
 *  - `email_opt_out` is true from the moment the row exists, and every
 *    lifecycle send already honours it (`ELIGIBLE_USER` in
 *    `lib/welcome-sequence.ts`).
 *  - `origin` is `'x402'`, which `getBalance` reads to withhold the free
 *    allowance and which analytics can exclude from signups and churn.
 *  - the address cannot be delivered to even if both of those are ignored.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { users } from '@/db/schema';

/** RFC 2606 reserved. Guaranteed never to resolve. */
const SYNTHETIC_EMAIL_DOMAIN = 'x402.walletlink.invalid';

export function syntheticEmailForWallet(wallet: string): string {
  return `${wallet.toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * The account for this wallet, created if it is the wallet's first payment.
 *
 * `ON CONFLICT ... DO NOTHING` plus a re-select rather than the read-then-write
 * `getOrCreateUser` uses. Two settlements from one wallet can be in flight at
 * once, and under read-then-write both miss the SELECT, both INSERT, and the
 * second throws a unique violation at somebody who has already paid. Here the
 * loser of the race simply reads the winner's row.
 *
 * The conflict target is `email`, which carries the wallet, rather than the
 * partial index on `wallet`: `ON CONFLICT` needs a unique constraint that
 * covers every row it might hit, and `users_wallet_idx` is partial.
 */
export async function getOrCreateWalletAccount(
  wallet: string
): Promise<{ userId: string; created: boolean }> {
  const db = getDb();
  if (!db) throw new Error('No database: cannot record a settled payment.');

  const address = wallet.toLowerCase();
  const email = syntheticEmailForWallet(address);

  const inserted = (
    await db.execute(sql`
      INSERT INTO ${users} (email, wallet, origin, email_opt_out)
      VALUES (${email}, ${address}, 'x402', true)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `)
  ).rows as Array<{ id: string }>;

  if (inserted[0]) return { userId: inserted[0].id, created: true };

  const existing = (
    await db.execute(
      sql`SELECT id FROM ${users} WHERE email = ${email} LIMIT 1`
    )
  ).rows as Array<{ id: string }>;

  if (!existing[0]) {
    // Neither inserted nor found. Something else deleted the row between the
    // two statements, which is not a case to paper over: the caller has taken
    // money and cannot record who for.
    throw new Error(`Could not resolve an account for wallet ${address}`);
  }

  return { userId: existing[0].id, created: false };
}
