/**
 * The proofs behind `/claim`: a wallet signature, and the gate that decides
 * whether the attestation earns credits.
 *
 * ## Why this is not `lib/x402-recovery.ts` with a different string
 *
 * The shape is deliberately copied from that file, because the hard parts are
 * solved there and were solved the expensive way: the HMAC is checked before
 * the expiry so timing leaks nothing, the redemption is insert-first so the
 * primary key decides a race rather than a read-then-write window, and
 * `issuedAt` is a parameter so a check can exercise the real function at a
 * chosen moment instead of reimplementing it.
 *
 * What is NOT shared is the secret and the message text, and that separation
 * is the point rather than tidiness. A signature captured for one purpose must
 * not present for another, so the text names what it authorises and the secret
 * is its own: rotating `X402_RECOVERY_SECRET` invalidates recovery challenges
 * and must not silently invalidate these, and a challenge issued here must be
 * refused by the recovery endpoint and the reverse.
 *
 * ## The gate, and what it is not
 *
 * A claim earns credits only when the wallet was already in the graph before
 * we announced this. Two things make that the right gate and one thing makes
 * it insufficient, all three worth stating because the first two are easy to
 * overstate.
 *
 * It cannot be bought. `first_seen_at` is our own timestamp, so unlike an X
 * account (aged ones sell for $12 to $110) or onchain history (which at least
 * requires foresight) there is no price at which an attacker acquires it after
 * the fact.
 *
 * It cannot be manufactured by the feature that reads it. Every writer of
 * `first_seen_at` was checked: `lib/attested-links.ts` writes it only in the
 * VALUES clause and never in the DO UPDATE set, `prepareUpsertData` preserves
 * `prev?.firstSeenAt`, and the only path that moves it moves it EARLIER and is
 * not attacker-reachable.
 *
 * And it is NOT the security story on its own. A signed-in free account can
 * put a thousand addresses into the graph every thirty days at no cost, so
 * membership is abundant going forward and scarce only retroactively: the
 * frozen cutoff is the whole gate, not the membership test. It also does
 * nothing against somebody who already controls pre-cutoff wallets, which is
 * exactly the airdrop-farmer population most likely to want free credits. The
 * binding constraints are the per-account-id limit and the budget, and this
 * gate is the cheap first filter in front of them.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { verifyMessage } from 'viem';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

/** How long a challenge stays signable. Matches the recovery flow's window. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * The moment membership in the graph stopped counting as evidence.
 *
 * A committed literal, never `Date.now()` and never read from the database.
 * The entire value of this gate is that it is retroactive: a cutoff that moved
 * with the clock would make every wallet eligible thirty days after it was
 * added, which is the same as having no gate while looking like one.
 *
 * Set to the day `/claim` was built. Wallets the index already knew about by
 * then were recorded for reasons that had nothing to do with earning credits.
 */
export const ATTESTATION_CUTOFF = '2026-09-20T00:00:00Z';

/**
 * Matches granted for a claim that adds something, once per X account, ever.
 *
 * The Trial pack's quantity rather than the Campaign pack's, for a reason that
 * is not generosity. Measured: 250 matches multiplies a farmed identity's
 * reach by 250 instead of 1,500, which is the difference between roughly 4,757
 * and 793 successful claims to enumerate the handle half of the index. The
 * reward is priced on leverage.
 *
 * Also the rung that has actually sold nothing yet is the $99 one, and giving
 * that away prices it at zero before the market has ever priced it at all.
 */
export const ATTESTATION_GRANT_MATCHES = 250;

/**
 * The ceiling on everything this flow will ever grant, in matches.
 *
 * Blast radius, not sybil defence. The per-account-id limit is what stops one
 * person claiming twice; this is what stops a mistake in that limit from
 * costing more than a known amount before anybody notices.
 */
export const ATTESTATION_GRANT_BUDGET = 50_000;

function secret(): string | null {
  return process.env.ATTESTATION_SECRET || null;
}

export function isConfigured(): boolean {
  return secret() !== null;
}

function sign(wallet: string, issuedAt: number, key: string): string {
  return createHmac('sha256', key)
    .update(`claim:${wallet.toLowerCase()}:${issuedAt}`)
    .digest('hex');
}

/**
 * The exact text the wallet signs.
 *
 * Written to be read by a person approving it in a wallet, because that is
 * where it is shown. It says what it authorises, names this service, and
 * carries the wallet and the moment.
 *
 * The first line differs from the recovery challenge's on purpose, and the
 * `claim:` prefix inside the HMAC does the same job machine-side: a signature
 * taken here cannot be replayed against key recovery even if both secrets
 * leaked, because the signed bytes are different.
 */
export function claimMessage(wallet: string, issuedAt: number): string {
  return [
    'walletlink.social identity claim',
    '',
    'Sign this to confirm you control this address, so the record we hold for it can name the account you choose.',
    'It authorises nothing else. No funds move and no approval is granted.',
    '',
    `Wallet: ${wallet.toLowerCase()}`,
    `Issued: ${new Date(issuedAt).toISOString()}`,
  ].join('\n');
}

export interface ClaimChallenge {
  message: string;
  issuedAt: number;
  token: string;
  expiresAt: string;
}

/**
 * A challenge for this wallet, or null when the secret is unset.
 *
 * `issuedAt` is a parameter for the reason `lib/x402-recovery.ts` gives: a
 * guard that recomputes the HMAC to test it verifies only itself, and an
 * earlier version of `scripts/check-invariants.ts` did exactly that and passed
 * while the HMAC's coverage of the timestamp had been deleted.
 */
export function issueClaimChallenge(
  wallet: string,
  issuedAt: number = Date.now()
): ClaimChallenge | null {
  const key = secret();
  if (!key) return null;
  return {
    message: claimMessage(wallet, issuedAt),
    issuedAt,
    token: sign(wallet, issuedAt, key),
    expiresAt: new Date(issuedAt + CHALLENGE_TTL_MS).toISOString(),
  };
}

export type ClaimFailure =
  | 'not_configured'
  | 'bad_token'
  | 'expired'
  | 'bad_signature';

/**
 * Whether this signature proves the wallet signed a challenge we issued, now.
 *
 * Both halves are required and neither is sufficient. The token proves the
 * challenge is ours and unexpired; the signature proves the wallet holder saw
 * it.
 *
 * One limitation worth saying out loud rather than discovering: `verifyMessage`
 * recovers an EOA signature. A smart-contract wallet signing per ERC-1271 is
 * not verified by it and will be refused, so the page must say so rather than
 * reporting a bad signature to somebody whose signature was fine.
 */
export async function verifyClaim(input: {
  wallet: string;
  issuedAt: number;
  token: string;
  signature: string;
}): Promise<{ ok: true } | { ok: false; reason: ClaimFailure }> {
  const key = secret();
  if (!key) return { ok: false, reason: 'not_configured' };

  const expected = sign(input.wallet, input.issuedAt, key);
  const a = Buffer.from(expected);
  const b = Buffer.from(input.token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_token' };
  }

  // After the HMAC, so an attacker cannot learn from the timing which of the
  // two a forged request failed. Same ordering as the recovery flow.
  const age = Date.now() - input.issuedAt;
  if (!Number.isFinite(age) || age < 0 || age > CHALLENGE_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }

  try {
    const valid = await verifyMessage({
      address: input.wallet.toLowerCase() as `0x${string}`,
      message: claimMessage(input.wallet, input.issuedAt),
      signature: input.signature as `0x${string}`,
    });
    return valid ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    // Malformed signature or address.
    return { ok: false, reason: 'bad_signature' };
  }
}

/**
 * Was this wallet in the graph before the cutoff?
 *
 * Reads `first_seen_at` and compares against a frozen literal. Returns false
 * when the wallet is absent, which is the same answer as "added after the
 * cutoff" and deliberately so: both mean the membership is not evidence.
 *
 * Throws on a failed read rather than answering false. The two are not the
 * same: false refuses a grant somebody may have earned, and doing that because
 * a query failed is a silent wrong answer on the one path where the person is
 * watching. The caller turns the throw into a refusal that says to write to
 * us, which is recoverable in a way a false negative is not.
 */
export async function walletPredatesCutoff(wallet: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    throw new Error('Claim eligibility unavailable: database not configured');
  }

  const rows = (await db.execute(sql`
    SELECT 1
    FROM social_graph
    WHERE wallet = ${wallet.toLowerCase()}
      AND first_seen_at < ${ATTESTATION_CUTOFF}::timestamp
    LIMIT 1
  `)) as unknown as { rows: Array<{ '?column?': number }> };

  return rows.rows.length > 0;
}
