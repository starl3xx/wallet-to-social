/**
 * Take it back: remove the pair, and stop us collecting it again.
 *
 * The page promises this twice and the consent text a third time, so it is
 * not a feature so much as the other half of the thing already shipped. A
 * claim flow whose withdrawal does not exist is a page making a promise the
 * code does not keep, which is the defect this repository has a whole file to
 * prevent.
 *
 * ## It uses the lane that has been reserved since stage 1
 *
 * `lib/removal-admin.ts` says `wallet_sig` is "reserved for the stage 2
 * self-serve lanes so the un-suppress gating they need is representable from
 * day one". This is that lane finally carrying something: a removal proved by
 * a signature rather than by an email nobody checks.
 *
 * And it is strictly stronger proof than the lane the operator endpoint
 * already accepts. The email lane deliberately demands nothing, because a
 * removal request refused for want of proof is worse than one granted too
 * easily. A signature over a challenge we issued, in a session we
 * authenticated, is more than that lane has ever asked for.
 *
 * ## What it does NOT do
 *
 * It does not delete the attestation row. The row records that somebody
 * claimed and then withdrew, which is a true thing worth being able to see,
 * and what makes it harmless is that `eraseIdentifier` takes the identifiers
 * out of every table that serves them. That is the same argument
 * `cleanupAbandonedListJobs` makes about cancelled list jobs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { verifyClaim, isConfigured } from '@/lib/attestation';
import { checkIpRateLimit, getClientIp } from '@/lib/ip-rate-limiter';
import { insertSuppressions, eraseIdentifier } from '@/lib/removal-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'not_configured', message: 'Withdrawing is unavailable.' },
      { status: 503 }
    );
  }

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : null;
  if (!session?.user) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'Sign in to withdraw a claim.' },
      { status: 401 }
    );
  }

  const rate = await checkIpRateLimit(getClientIp(request), '/api/claim');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many attempts. Try later.' },
      { status: 429 }
    );
  }

  let body: {
    wallet?: unknown;
    issued_at?: unknown;
    token?: unknown;
    signature?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Expected a JSON body.' },
      { status: 400 }
    );
  }

  const wallet =
    typeof body.wallet === 'string' ? body.wallet.trim().toLowerCase() : '';
  if (!isAddress(wallet)) {
    return NextResponse.json(
      { error: 'invalid_wallet', message: 'That is not an address.' },
      { status: 400 }
    );
  }

  /**
   * The same proof a claim takes, which is the point rather than symmetry for
   * its own sake: whoever can make the claim must be able to unmake it, with
   * nothing extra asked of them at the worse moment.
   */
  const verified = await verifyClaim({
    wallet,
    userId: session.user.id,
    issuedAt: Number(body.issued_at),
    token: typeof body.token === 'string' ? body.token : '',
    signature: typeof body.signature === 'string' ? body.signature : '',
  });
  if (!verified.ok) {
    console.error(`claim withdrawal verification failed: ${verified.reason}`);
    return NextResponse.json(
      {
        error: 'not_verified',
        message: 'That signature did not check out.',
      },
      { status: 400 }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'unavailable', message: 'Withdrawing is unavailable.' },
      { status: 503 }
    );
  }

  /**
   * Their own claim, in their own session. A signature proves the wallet and
   * the session proves the account, and both are required for the same reason
   * the callback requires both.
   */
  const found = (await db.execute(sql`
    SELECT count(*)::int AS n
    FROM identity_attestations
    WHERE user_id = ${session.user.id}
      AND wallet = ${wallet}
      AND status = 'completed'
  `)) as unknown as { rows: Array<{ n: number }> };

  if ((found.rows[0]?.n ?? 0) === 0) {
    return NextResponse.json(
      {
        error: 'not_found',
        message: 'We have no completed claim for that address on this account.',
      },
      { status: 404 }
    );
  }

  /**
   * Suppress FIRST, then erase.
   *
   * That order is load-bearing and it is the order the operator endpoint
   * uses: the suppression triggers stop a suppressed identifier from LANDING
   * again, so erasing before suppressing leaves a window where the next
   * ingest writes the pair straight back. The person is withdrawing
   * precisely so that stops happening.
   *
   * The wallet only, not the handle. Suppressing the handle would remove that
   * account from every OTHER wallet's record too, and the person is
   * withdrawing one pairing rather than asking to be erased from the index
   * entirely. The operator endpoint remains the way to ask for that, and it
   * is linked from the privacy page.
   */
  await insertSuppressions(
    db,
    [{ kind: 'wallet', identifier: wallet }],
    'wallet_sig',
    'requested'
  );
  const erased = await eraseIdentifier(db, 'wallet', wallet);

  /**
   * EVERY row for this wallet, not the most recent one.
   *
   * `start` inserts unconditionally and nothing unique-constrains a completed
   * pair, so one wallet can carry several rows. Withdrawing the newest left
   * the earlier ones holding the handle, the account id and the signature,
   * which is the opposite of what withdrawing means.
   *
   * `awaiting_x` rows go too, and that half matters more: a claim opened
   * before the withdrawal could otherwise come back through the callback
   * afterwards and re-complete the pairing that was just removed. Cancelling
   * them here closes that window from this side, and the callback closes it
   * from the other by refusing a suppressed wallet.
   *
   * The rows stay, marked. "Somebody claimed this and then withdrew" is a
   * true thing worth being able to see, and what makes it harmless is that
   * the erase above took the identifiers out of every table that serves them.
   */
  await db.execute(sql`
    UPDATE identity_attestations
    SET status        = 'withdrawn',
        x_user_id     = NULL,
        x_handle      = NULL,
        signature     = NULL,
        code_verifier = NULL,
        state_nonce   = NULL,
        updated_at    = now()
    WHERE user_id = ${session.user.id}
      AND wallet = ${wallet}
      AND status IN ('completed', 'awaiting_x')
  `);

  return NextResponse.json({
    withdrawn: true,
    /**
     * `x_user_id_hmac` deliberately survives, which is why the grant cannot
     * be farmed by claiming and withdrawing in a loop: the key that enforces
     * one grant per account outlives the identity it was derived from, which
     * is the whole reason it is an HMAC rather than the id itself.
     */
    quarantined: erased.quarantined,
  });
}
