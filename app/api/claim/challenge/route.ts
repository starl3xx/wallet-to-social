/**
 * The text a wallet signs to claim the record we hold for it.
 *
 * `GET ?wallet=0x…` returns a challenge and nothing else. It writes no row,
 * spends nothing, and proves nothing on its own: the signature comes back to
 * `POST /api/claim/start`, which is where anything happens.
 *
 * ## Why this is authenticated when it reveals nothing
 *
 * The challenge is derived, not stored, so an anonymous caller learns only
 * what `lib/attestation.ts` would tell anyone. The session requirement is not
 * protecting the text; it is making the rate limit mean something. A bucket
 * keyed on IP alone is a bucket a stranger shares with everyone behind their
 * NAT, and one keyed on a session at least names an account we can stop.
 *
 * ## Eligibility is reported here, and it is not a gate on signing
 *
 * The response says whether this wallet would earn credits, so the page can
 * say so before somebody signs rather than after. Anyone may claim any wallet
 * they control; what the cutoff decides is only whether the claim is PAID.
 * Conflating the two would refuse an honest correction from somebody whose
 * wallet we happened to index last week.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { cookies } from 'next/headers';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import {
  issueClaimChallenge,
  walletPredatesCutoff,
  isConfigured,
  CHALLENGE_TTL_MS,
  ATTESTATION_GRANT_MATCHES,
  type ClaimIntent,
} from '@/lib/attestation';
import { checkIpRateLimit, getClientIp } from '@/lib/ip-rate-limiter';
import { isSuppressed } from '@/lib/suppression';
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'not_configured', message: 'Claiming is unavailable.' },
      { status: 503 }
    );
  }

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : null;
  if (!session?.user) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'Sign in to claim a wallet.' },
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

  const raw = request.nextUrl.searchParams.get('wallet') ?? '';
  const wallet = raw.trim().toLowerCase();
  if (!isAddress(wallet)) {
    return NextResponse.json(
      { error: 'invalid_wallet', message: 'That is not an address.' },
      { status: 400 }
    );
  }

  /**
   * An unrecognised intent is refused rather than read as a claim.
   *
   * The two are opposite acts and this value decides which one the resulting
   * signature can be spent on, so defaulting a typo to the more powerful of
   * them is the wrong direction to fail in.
   */
  const intentParam = request.nextUrl.searchParams.get('intent') ?? 'claim';
  if (intentParam !== 'claim' && intentParam !== 'withdraw') {
    return NextResponse.json(
      { error: 'invalid_intent', message: 'Unknown intent.' },
      { status: 400 }
    );
  }
  const intent: ClaimIntent = intentParam;

  /**
   * Refused before a challenge exists, not after a signature arrives.
   *
   * A suppressed wallet asked us to stop holding it. Issuing a challenge for
   * one and refusing later would be asking somebody to prove control of an
   * address so we could tell them we will not use it, which is worse than
   * refusing at the door.
   *
   * Claiming only. A withdrawal of a suppressed wallet is not somebody
   * ignoring the suppression, it is somebody FINISHING it, and refusing that
   * left a real trap: `POST /api/claim/withdraw` suppresses first and then
   * erases, because the triggers have to be in place before the rows go or
   * the next ingest writes the pair straight back. If the erase or the
   * attestation update then failed, the wallet was already suppressed, so the
   * retry arrived here and was told the address "has been removed from the
   * index" — success language for a withdrawal that had not removed it. The
   * person could not finish it and had no way to see that it was unfinished.
   *
   * Letting a withdrawal through costs nothing, because the challenge alone
   * authorises nothing: the withdraw route still requires a signature from
   * the wallet AND a completed attestation owned by the session presenting
   * it, so the worst a stranger obtains here is text they could already
   * derive.
   */
  if (intent === 'claim') {
    const hits = await isSuppressed('wallet', [wallet]);
    if (hits.size > 0) {
      return NextResponse.json(
        {
          error: 'suppressed',
          message:
            'This address has been removed from the index at its owner request.',
        },
        { status: 403 }
      );
    }
  }

  const challenge = issueClaimChallenge(wallet, session.user.id, intent);
  if (!challenge) {
    return NextResponse.json(
      { error: 'not_configured', message: 'Claiming is unavailable.' },
      { status: 503 }
    );
  }

  /**
   * A failed eligibility read is a refusal, never a false.
   *
   * `walletPredatesCutoff` throws rather than answering false for exactly
   * this: answering false here would quietly tell somebody their claim earns
   * nothing because a query failed, and they would have no way to know.
   */
  /**
   * Whether confirming would add the one thing a claim uniquely supplies.
   *
   * A handle with no numeric id beside it has no rot detector: Farcaster
   * records a verified X account as a bare username, so no Farcaster-derived
   * handle carries an id, and 1,048,530 wallets were in exactly that state on
   * 2026-09-20. This read decides both halves of what the page says next: the
   * invitation, and whether the grant applies at all.
   *
   * A failed read answers false and the response still goes out. It is a
   * prompt and a grant condition, not a gate on claiming, and refusing the
   * whole challenge because this one query failed would stop somebody
   * correcting their record over a sentence.
   */
  let idGap = false;
  try {
    const db = getDb();
    if (db) {
      const row = (await db.execute(sql`
        SELECT twitter_user_id
        FROM social_graph
        WHERE wallet = ${wallet}
          AND twitter_handle IS NOT NULL
        LIMIT 1
      `)) as unknown as { rows: Array<{ twitter_user_id: string | null }> };
      idGap = row.rows.length > 0 && row.rows[0].twitter_user_id === null;
    }
  } catch (error) {
    console.error('claim id-gap read failed; offering no invitation:', error);
  }

  let eligible: boolean;
  try {
    eligible = await walletPredatesCutoff(wallet);
  } catch {
    return NextResponse.json(
      {
        error: 'unavailable',
        message: 'We could not check this address just now. Try again shortly.',
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    message: challenge.message,
    issued_at: challenge.issuedAt,
    token: challenge.token,
    expires_at: challenge.expiresAt,
    ttl_ms: CHALLENGE_TTL_MS,
    /**
     * Whether this claim would be paid, said before anyone signs.
     *
     * `earns_credits: false` is not a refusal and the page must not render it
     * as one: the claim is still written, because a correction from the owner
     * is worth having whether or not we pay for it.
     */
    earns_credits: eligible && idGap,
    grant_matches: eligible && idGap ? ATTESTATION_GRANT_MATCHES : 0,
    /**
     * Whether we hold a handle for this address with no account id behind it.
     *
     * ONE BIT, never the handle. Returning what we hold for a caller-supplied
     * address would be giving away the reverse lookup, which is a paid
     * feature, behind nothing but a session and ten requests an hour. So this
     * says that confirming would ADD something and leaves the caller to learn
     * what by completing the claim they were already starting.
     *
     * Even one bit is a disclosure, and it is the same class and through the
     * same authenticated, rate-limited door as `earns_credits`, which has
     * reported membership-and-age per address since this route existed.
     */
    adds_account_id: idGap,
  });
}
