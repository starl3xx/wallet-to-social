/**
 * Verify the wallet signature, record the consent, and hand back the X
 * consent URL.
 *
 * This is the first route in the flow that writes anything, and what it
 * writes cannot do anything: the row is born `awaiting_x` holding a verifier
 * and a nonce, exactly like `x_list_jobs`, and only the callback can move it
 * out of that state.
 *
 * ## Both halves, in one session, or nothing
 *
 * A signature alone proves an address and names no account. An X sign-in
 * alone proves an account and says nothing about an address. `social_graph`
 * is keyed on the wallet, so an account-only attestation has nothing to
 * write. The pairing IS the evidence, which is why the signature is required
 * here rather than collected later as an improvement.
 *
 * ## Why the consent text is stored by hash as well as by id
 *
 * `lib/attestation-consent.ts` explains it. Short version: a record that
 * cannot say which words were on the page is not a record, and an id alone
 * points at text somebody can edit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { verifyClaim, isConfigured } from '@/lib/attestation';
import { CURRENT_CONSENT, consentHash } from '@/lib/attestation-consent';
import { checkIpRateLimit, getClientIp } from '@/lib/ip-rate-limiter';
import { isSuppressed } from '@/lib/suppression';
import {
  isConfigured as xConfigured,
  clientId,
  redirectUri,
  X_AUTHORIZE_URL,
  X_CLAIM_SCOPES,
} from '@/lib/x-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The client half of PKCE, as `app/api/x/lists` does it. */
function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function POST(request: NextRequest) {
  if (!isConfigured() || !xConfigured()) {
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

  let body: {
    wallet?: unknown;
    issued_at?: unknown;
    token?: unknown;
    signature?: unknown;
    consent_version?: unknown;
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
   * Re-checked here, not trusted from the challenge route.
   *
   * A removal can land between issuing a challenge and presenting its
   * signature, and the whole window is the person's five minutes. Reading the
   * list again costs one query against a table designed to sit in shared
   * buffers, and skipping it would mean the one refusal that has to be
   * current is the one served from a stale read.
   */
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

  /**
   * The agreed text must be the one we are currently showing.
   *
   * A stale tab can hold an older version, and accepting it would record a
   * consent to words this build no longer displays. Refused with a reload
   * rather than silently upgraded: agreeing to v1 is not agreeing to v2.
   */
  if (body.consent_version !== CURRENT_CONSENT.id) {
    return NextResponse.json(
      {
        error: 'consent_stale',
        message: 'The agreement has been updated. Reload and read it again.',
      },
      { status: 409 }
    );
  }

  const verified = await verifyClaim({
    wallet,
    userId: session.user.id,
    issuedAt: Number(body.issued_at),
    token: typeof body.token === 'string' ? body.token : '',
    signature: typeof body.signature === 'string' ? body.signature : '',
  });
  if (!verified.ok) {
    /**
     * One message for every failure, and the reason is the same one
     * `app/api/x/callback` gives about `not_found`: a caller who can tell a
     * bad token from a bad signature from an expired challenge can grind
     * against whichever one is cheapest. The specific reason is logged, not
     * served.
     */
    console.error(`claim verification failed: ${verified.reason}`);
    return NextResponse.json(
      {
        error: 'not_verified',
        message:
          'That signature did not check out. If you are using a smart-contract wallet, we cannot verify it yet.',
      },
      { status: 400 }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'unavailable', message: 'Claiming is unavailable.' },
      { status: 503 }
    );
  }

  const verifier = randomBytes(32).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');

  const inserted = (await db.execute(sql`
    INSERT INTO identity_attestations
      (user_id, wallet, signature, challenge_issued_at,
       consent_version, consent_sha256, status, code_verifier, state_nonce)
    VALUES (
      ${session.user.id},
      ${wallet},
      ${String(body.signature)},
      to_timestamp(${Number(body.issued_at)} / 1000.0),
      ${CURRENT_CONSENT.id},
      ${consentHash(CURRENT_CONSENT.text)},
      'awaiting_x',
      ${verifier},
      ${nonce}
    )
    RETURNING id
  `)) as unknown as { rows: Array<{ id: string }> };

  const claimId = inserted.rows[0]?.id;
  if (!claimId) {
    return NextResponse.json(
      { error: 'unavailable', message: 'The claim could not be recorded.' },
      { status: 503 }
    );
  }

  const authorize = new URL(X_AUTHORIZE_URL);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId());
  authorize.searchParams.set('redirect_uri', redirectUri());
  /**
   * The narrow scope set, not the list-building one.
   *
   * Asking somebody improving their own profile for permission to write lists
   * to their account is asking for something this flow will never use.
   */
  authorize.searchParams.set('scope', X_CLAIM_SCOPES.join(' '));
  /**
   * Prefixed, because one callback now serves two flows and it has to know
   * which row to look in before it looks.
   */
  authorize.searchParams.set('state', `claim:${claimId}.${nonce}`);
  authorize.searchParams.set('code_challenge', s256Challenge(verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');

  return NextResponse.json({
    claim_id: claimId,
    authorize_url: authorize.toString(),
  });
}
