/**
 * The X half of a claim: read the account once, keep the id, drop the token.
 *
 * Lives beside `app/api/x/callback/route.ts` rather than inside it because
 * that route is the list flow and has its own long argument about tokens,
 * nonces and sixteen-minute jobs. Two flows sharing one registered redirect
 * URI is forced by X; two flows sharing one function body is not.
 *
 * ## What makes this different from the list callback
 *
 * That one stores a sealed access token, because it spends the next sixteen
 * minutes adding members. This one has nothing to do after the read: it wants
 * a numeric account id and a handle, and then the credential is a liability
 * rather than an asset. So the token is never written anywhere, and there is
 * no column for it to be written to.
 *
 * ## The refusals are the list callback's refusals
 *
 * Deliberately, and they are not restated with different reasoning: the nonce
 * is compared in constant time and cleared on use, the session must be the
 * account that opened the claim, and every distinguishable failure answers
 * `not_found`, because telling "no such claim" from "not your claim" is what
 * turns a uuid in a URL into a probe.
 */
import { createHmac } from 'crypto';
import { sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { secretEquals } from '@/lib/secret-box';
import {
  isConfigured as xConfigured,
  basicAuthHeader,
  clientId,
  redirectUri,
  X_TOKEN_URL,
  X_API_BASE,
} from '@/lib/x-oauth';
import { getSiteUrl } from '@/lib/site-url';
import { ingestLinks, type LinkSource } from '@/lib/attested-links';
import { grantCredits } from '@/lib/credits';
import { isSuppressed } from '@/lib/suppression';
import {
  walletPredatesCutoff,
  ATTESTATION_GRANT_MATCHES,
  ATTESTATION_GRANT_BUDGET,
} from '@/lib/attestation';

/** Bounded, for the reason lib/x-accounts.ts gives about undici's default. */
const TOKEN_TIMEOUT_MS = 10_000;

/**
 * The source this flow writes under. Quality must equal what
 * `calculateQualityScore` computes for it, or a wallet scores one way after
 * an ingest and another after a lookup.
 */
const OWNER_ATTESTED: LinkSource = { id: 'owner_attested', quality: 45 };

/**
 * The uniqueness key that survives an erase.
 *
 * "One grant per account, ever" has to keep holding after a withdrawal
 * removes the plaintext, and removal is the entire point of a withdrawal, so
 * the key cannot be the identity. Peppered rather than plain sha256: an X
 * account id is a short number from a small space, and an unkeyed digest of
 * one is reversible by anybody who can count.
 */
function accountKey(xUserId: string): string {
  return createHmac(
    'sha256',
    process.env.ATTESTATION_ID_PEPPER || process.env.ATTESTATION_SECRET || ''
  )
    .update(xUserId)
    .digest('hex');
}

/**
 * Grant the matches, once per account ever, inside the budget.
 *
 * Reserved on the attestation row rather than in `credit_lots`, because
 * `grantCredits` leaves `stripe_payment_id` null so its unique index does not
 * apply: the grant rail is deliberately repeatable and therefore cannot be
 * the idempotency key.
 *
 * Every refusal here is silent to the person on purpose. They completed a
 * claim, which is the thing that mattered; "your attestation was recorded but
 * you already claimed with this account" is a true sentence that the outcome
 * copy says without this function needing to fail.
 */
async function maybeGrant(
  db: NonNullable<ReturnType<typeof getDb>>,
  claimId: string,
  userId: string,
  wallet: string,
  /**
   * Whether this claim supplied an account id the index lacked.
   *
   * The second half of the gate, and the half that says what the grant
   * is actually buying. The cutoff answers "is this evidence we could
   * not have bought"; this answers "is it evidence we did not already
   * have". Both are required, because either alone pays for the wrong
   * thing: the cutoff alone paid for an owner attestation that Farcaster
   * mostly supplies for free, and an id gap alone would let a wallet
   * created this morning earn credits.
   */
  addsAccountId: boolean
): Promise<void> {
  if (!addsAccountId) return;

  let eligible: boolean;
  try {
    eligible = await walletPredatesCutoff(wallet);
  } catch {
    // A failed read refuses the grant rather than making one it cannot
    // justify. The claim itself is already written.
    return;
  }
  if (!eligible) return;

  const spent = (await db.execute(sql`
    SELECT COALESCE(SUM(granted_matches), 0)::int AS total
    FROM identity_attestations
    WHERE grant_claimed_at IS NOT NULL
  `)) as unknown as { rows: Array<{ total: number }> };
  if (
    (spent.rows[0]?.total ?? 0) + ATTESTATION_GRANT_MATCHES >
    ATTESTATION_GRANT_BUDGET
  ) {
    console.error('claim grant budget exhausted; recording claim without it');
    return;
  }

  /**
   * The reservation. The partial unique index on `x_user_id_hmac` where
   * `grant_claimed_at IS NOT NULL` is what makes this once-ever: a second
   * claim by the same account raises rather than double-granting, and the
   * catch turns that into no grant rather than an error page.
   */
  try {
    const reserved = (await db.execute(sql`
      UPDATE identity_attestations
      SET grant_claimed_at = now(),
          granted_matches  = ${ATTESTATION_GRANT_MATCHES},
          updated_at       = now()
      WHERE id = ${claimId}::uuid
        AND grant_claimed_at IS NULL
      RETURNING id
    `)) as unknown as { rows: Array<{ id: string }> };
    if (reserved.rows.length === 0) return;
  } catch {
    // The unique index refused it: this account has been granted before.
    return;
  }

  /**
   * Reserved first, then issued, then RELEASED if issuing failed.
   *
   * The reservation has to come first, because it is what the once-ever
   * unique index keys on and a grant made before reserving can be made twice.
   * But leaving it set when `grantCredits` throws is worse than either: the
   * account is then permanently recorded as paid and can never be granted
   * again, for credits it never received, and nothing would ever surface it.
   *
   * So the failure path puts the row back. A retry can then reserve it again,
   * and the worst case is a claim that is granted late rather than one that
   * is silently never granted at all.
   */
  try {
    await grantCredits(
      userId,
      ATTESTATION_GRANT_MATCHES,
      `identity claim ${claimId}`
    );
  } catch (error) {
    console.error('claim grant failed; releasing the reservation:', error);
    await db.execute(sql`
      UPDATE identity_attestations
      SET grant_claimed_at = NULL,
          granted_matches  = NULL,
          updated_at       = now()
      WHERE id = ${claimId}::uuid
    `);
  }
}

/**
 * Abandoned consent screens, and what they leave behind.
 *
 * Exactly the problem `cleanupAbandonedListJobs` was written for, one flow
 * over. A row is created `awaiting_x` holding the wallet signature, the PKCE
 * verifier and the state nonce, and only a completed callback or a withdrawal
 * clears any of that. Somebody who opens the X consent screen and closes the
 * tab reaches neither, so a signature and a live verifier sit in the table
 * indefinitely. Not keeping material longer than the job needs it is the one
 * thing this design is for, and the abandoned case quietly did the opposite.
 *
 * Thirty minutes matches what the callback enforces at read time, so the sweep
 * clears the payload rather than defining the deadline. The row is cancelled
 * rather than deleted, because "you started a claim and did not finish it" is
 * a true thing worth being able to see, and what makes it harmless is that
 * the payload is gone rather than that the row is.
 */
export async function cleanupAbandonedClaims(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const purged = (await db.execute(sql`
    UPDATE identity_attestations
    SET status        = 'cancelled',
        error         = 'authorization never completed',
        signature     = NULL,
        code_verifier = NULL,
        state_nonce   = NULL,
        completed_at  = now(),
        updated_at    = now()
    WHERE status = 'awaiting_x'
      AND created_at < now() - interval '30 minutes'
    RETURNING id
  `)) as unknown as { rows: Array<{ id: string }> };
  return purged.rows.length;
}

function back(outcome: string, claimId?: string): NextResponse {
  const url = new URL(getSiteUrl());
  url.pathname = '/claim';
  url.searchParams.set('claim', outcome);
  if (claimId) url.searchParams.set('claim_id', claimId);
  return NextResponse.redirect(url.toString());
}

export async function completeClaimCallback(input: {
  code: string | null;
  id: string;
  nonce: string;
  /** X's own refusal, echoed back with the state. */
  denied: string | null;
}): Promise<NextResponse> {
  /**
   * This flow's own refusals, answered on this flow's own page.
   *
   * They live here rather than in the shared route because X echoes `state`
   * on an error too: handling them upstream sent somebody who cancelled a
   * claim to the homepage carrying the list flow's vocabulary.
   *
   * `access_denied` is somebody pressing Cancel, which is a decision rather
   * than a fault and does not deserve a scary page.
   */
  if (input.denied) {
    return back(
      input.denied === 'access_denied' ? 'cancelled' : 'refused',
      input.id
    );
  }

  /**
   * Only the X client, deliberately NOT the secret box.
   *
   * The box seals a list's access token. This flow stores no token, so
   * requiring the key here would refuse a working claim for a missing secret
   * it never touches, which is exactly what the shared gate upstream used to
   * do.
   */
  if (!xConfigured()) return back('unavailable', input.id);

  if (!input.code) return back('invalid', input.id);

  const db = getDb();
  if (!db) return back('unavailable');

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : null;
  if (!session?.user) return back('signed_out', input.id);

  /**
   * The thirty minutes is enforced HERE, at the read, for the reason the list
   * callback spells out: a TTL that lives only in a sweep is a claim the code
   * does not keep, and a consent tab left open overnight would authorize
   * successfully and then fail underneath a cleanup pass. Postgres decides,
   * not Node.
   */
  const found = (await db.execute(sql`
    SELECT id, user_id, state_nonce, code_verifier, status, wallet
    FROM identity_attestations
    WHERE id = ${input.id}::uuid
      AND created_at > now() - interval '30 minutes'
  `)) as unknown as {
    rows: Array<{
      id: string;
      user_id: string;
      state_nonce: string | null;
      code_verifier: string | null;
      status: string;
      wallet: string;
    }>;
  };

  const claim = found.rows[0];
  if (
    !claim ||
    claim.user_id !== session.user.id ||
    claim.status !== 'awaiting_x' ||
    !claim.state_nonce ||
    !claim.code_verifier ||
    !secretEquals(claim.state_nonce, input.nonce)
  ) {
    return back('not_found');
  }

  /**
   * Suppressed since the claim was opened, which includes withdrawn.
   *
   * A withdrawal suppresses the wallet and cancels this account's pending
   * claims, but a claim opened before it could still arrive here afterwards
   * and re-complete the pairing that was just removed. The triggers would
   * refuse the graph write, so the index would stay clean, and the row would
   * still say `completed` and the page would still say the address was
   * claimed. That gap between what we tell somebody and what we did is the
   * thing worth closing.
   *
   * Checked before the token exchange rather than after, so a withdrawn claim
   * costs no round trip to X and no credential is minted for a flow that
   * cannot finish.
   */
  try {
    const hits = await isSuppressed('wallet', [claim.wallet]);
    if (hits.size > 0) return back('not_found', claim.id);
  } catch (error) {
    // Failure closed: the suppression read is the one query that must not
    // fall through to "carry on", which is the posture lib/suppression.ts
    // states for every caller.
    console.error('claim suppression read failed; refusing:', error);
    return back('unavailable', claim.id);
  }

  // --- exchange -------------------------------------------------------------

  let accessToken: string;
  try {
    const res = await fetch(X_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code!,
        redirect_uri: redirectUri(),
        code_verifier: claim.code_verifier,
        client_id: clientId(),
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('claim token exchange failed:', res.status);
      return back('exchange_failed', claim.id);
    }
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
    };
    if (typeof json.access_token !== 'string') {
      return back('exchange_failed', claim.id);
    }
    /**
     * A refresh token should not be here: `offline_access` is not requested.
     * If one arrives the scope set has drifted, and the right response is to
     * notice loudly rather than quietly hold a standing credential this design
     * says it does not keep. Dropped by never being read.
     */
    if (json.refresh_token) {
      console.error(
        'X returned a refresh token for a claim that did not request offline_access; dropping it'
      );
    }
    accessToken = json.access_token;
  } catch (error) {
    console.error('claim token exchange error:', error);
    return back('exchange_failed', claim.id);
  }

  // --- who authorized -------------------------------------------------------

  let xUserId: string;
  let handle: string;
  try {
    const res = await fetch(`${X_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      /**
       * A 403 here is the scope set being wrong, which is worth saying in the
       * log rather than leaving as a generic failure: `/2/users/me` needs
       * `users.read` AND `tweet.read`, and a set missing the second one fails
       * only at this exact point, after a real person has finished consenting.
       */
      console.error(`claim identity lookup failed: ${res.status}`);
      return back('identity_failed', claim.id);
    }
    const json = (await res.json()) as {
      data?: { id?: string; username?: string };
    };
    if (!json.data?.id || !json.data.username) {
      return back('identity_failed', claim.id);
    }
    xUserId = json.data.id;
    handle = json.data.username;
  } catch (error) {
    console.error('claim identity lookup error:', error);
    return back('identity_failed', claim.id);
  }

  /**
   * The verifier and the nonce are cleared in the same statement that records
   * the account, so the pair cannot be replayed even within the same second,
   * and the status moves out of `awaiting_x`.
   *
   * Conditional on the status still being `awaiting_x`: two callbacks racing
   * must not both succeed.
   *
   * `access_token` appears nowhere. There is no column for it and nothing to
   * put in one: the read above is the only thing this flow ever needed the
   * credential for, and it is finished.
   */
  const claimed = (await db.execute(sql`
    UPDATE identity_attestations
    SET x_user_id      = ${xUserId},
        x_user_id_hmac = ${accountKey(xUserId)},
        x_handle       = ${handle.toLowerCase()},
        code_verifier  = NULL,
        state_nonce    = NULL,
        status         = 'completed',
        completed_at   = now(),
        updated_at     = now()
    WHERE id = ${claim.id}::uuid
      AND status = 'awaiting_x'
    RETURNING id
  `)) as unknown as { rows: Array<{ id: string }> };

  /**
   * The losing side of a race gets no write and no grant.
   *
   * Two callbacks arriving together both passed the checks above, and the
   * `status = 'awaiting_x'` predicate is what decides between them. Without
   * this the loser would go on to write the graph and grant credits a second
   * time for one claim.
   */
  if (claimed.rows.length === 0) return back('not_found');

  /**
   * The write into the index, through the shared attested ingest rather than
   * around it.
   *
   * `ingestLinks` carries the guards every other source inherits: the
   * renamed-from refusal, the conflict record where two sources disagree, and
   * the quality floor that has to equal what `calculateQualityScore` computes
   * for this source. Writing `social_graph` directly from here would be a
   * second writer with none of that, which is the shape `lib/attested-links.ts`
   * exists to prevent.
   */
  /**
   * FILL-ONLY, and that is a decision rather than a limitation to fix later.
   *
   * Where we hold nothing, the claim fills it. Where we hold the same handle,
   * it agrees and contributes the durable account id. Where we hold something
   * DIFFERENT, `ingestLinks` records the disagreement and leaves the index
   * alone; `lib/conflict-resolution.ts` settles it once the handle we serve
   * stops reaching anyone.
   *
   * Overwriting on a signature alone would make "controls the private key"
   * sufficient to rewrite an identity in a product sold on not guessing.
   * Drained wallets with leaked keys are traded, and a buyer could bind one to
   * any account they chose and have the public API serve it as attested.
   * Routing the disagreement bounds that to the case where our own record has
   * already stopped working, which is the case where changing it costs nobody
   * anything.
   *
   * The page says this rather than promising a replacement, which the first
   * version did and the code never did.
   *
   * Wrapped, with the claim already marked `completed`: a throw here would
   * turn a finished authorization into a 500 on the OAuth return, which is
   * the worst moment available to fail. The attestation is recorded either
   * way and the daily ingest paths reach the same rows.
   */
  /**
   * Whether this claim is about to supply an account id we did not have.
   *
   * Read BEFORE the ingest, because the ingest is what changes the answer.
   *
   * This is the one thing a claim provides that nothing else can. Farcaster
   * records a verified X account as a bare username: `verified_accounts`
   * carries no numeric id, so no Farcaster-derived handle has one, and
   * `lib/handle-reachability.ts` needs one to tell a rename from a
   * suspension. Measured on 2026-09-20: 1,048,530 wallets hold an X handle
   * alongside an FID with no id beside it, against 86,894 that have one.
   *
   * A missing row answers false, which is correct and not a fallback: a
   * wallet we have never seen cannot have an id we are missing, and the
   * cutoff below refuses it anyway.
   */
  let addsAccountId = false;
  try {
    const before = (await db.execute(sql`
      SELECT twitter_user_id
      FROM social_graph
      WHERE wallet = ${claim.wallet}
      LIMIT 1
    `)) as unknown as { rows: Array<{ twitter_user_id: string | null }> };
    addsAccountId =
      before.rows.length > 0 && before.rows[0].twitter_user_id === null;
  } catch (error) {
    /**
     * A failed read refuses the grant rather than awarding one it cannot
     * justify, which is the same posture `walletPredatesCutoff` takes and for
     * the same reason: the money answer must not be decided by a query that
     * did not run. The claim itself is unaffected.
     */
    console.error('claim id-gap read failed; grant refused:', error);
  }

  try {
    await ingestLinks(
      [
        {
          wallet: claim.wallet,
          handle: handle.toLowerCase(),
          twitterUserId: xUserId,
        },
      ],
      OWNER_ATTESTED
    );
  } catch (error) {
    console.error('claim ingest failed after completion:', error);
  }

  /**
   * The grant, reserved by THIS row rather than by `credit_lots`.
   *
   * `grantCredits` leaves `stripe_payment_id` null on purpose so the unique
   * index does not apply, which means the grant rail is deliberately
   * repeatable and cannot be the idempotency key. `grant_claimed_at` on the
   * attestation is: the partial unique index on `x_user_id_hmac` refuses a
   * second grant for an account that already has one, so the UPDATE either
   * reserves the grant or tells us somebody already did.
   */
  try {
    await maybeGrant(
      db,
      claim.id,
      session.user.id,
      claim.wallet,
      addsAccountId
    );
  } catch (error) {
    // Same reasoning as the ingest above: the claim is already recorded, and
    // a failed grant must not turn a finished authorization into a 500.
    console.error('claim grant path failed after completion:', error);
  }

  return back('completed', claim.id);
}
