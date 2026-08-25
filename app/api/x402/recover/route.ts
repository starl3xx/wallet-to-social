/**
 * Reissue an API key to the wallet that paid for the credits.
 *
 * `GET ?wallet=0x…` returns a challenge. Sign it with that wallet and `POST`
 * the signature back to receive a new key.
 *
 * The key is minted fresh rather than recovered: only its hash was ever stored,
 * so the original cannot be produced by anybody, including us. The credits are
 * untouched, because they belong to the account rather than to the key.
 *
 * See `lib/x402-recovery.ts` for why this cannot be done from the payment
 * itself. Short version: every field of a settled payment is on a public chain.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import {
  issueChallenge,
  verifyRecovery,
  consumeChallenge,
  CHALLENGE_TTL_MS,
} from '@/lib/x402-recovery';
import { createApiKeyIfUnderCap } from '@/lib/api-keys';
import { CREDIT_API_PLAN } from '@/lib/api-plans';
import { getBalance } from '@/lib/credits';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { checkIpRateLimit, getClientIp } from '@/lib/ip-rate-limiter';

export const runtime = 'nodejs';

/** Matches the cap the buy endpoint mints under. */
const X402_MAX_KEYS = 3;

/**
 * The account this wallet paid into, or null.
 *
 * Scoped to `origin = 'x402'` deliberately. `users.wallet` is only ever written
 * by the onchain rail today, but a signature over a challenge must not become a
 * way into an account that was created some other way, if that column is ever
 * populated by something else.
 */
async function walletAccount(wallet: string): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.wallet, wallet.toLowerCase()), eq(users.origin, 'x402'))
    )
    .limit(1);
  return row?.id ?? null;
}

function badWallet() {
  return NextResponse.json(
    {
      error: 'Provide a wallet address as 0x followed by 40 hex characters.',
      code: 'INVALID_ADDRESS',
    },
    { status: 400 }
  );
}

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get('wallet') ?? '';
  if (!isAddress(wallet)) return badWallet();

  /**
   * Bounded per IP, because issuing a challenge needs no proof of anything.
   * It is cheap, but it is an unauthenticated endpoint and those get a bound.
   */
  const limit = await checkIpRateLimit(getClientIp(request), '/api/x402');
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' },
      {
        status: 429,
        headers: limit.retryAfter
          ? { 'Retry-After': String(limit.retryAfter) }
          : undefined,
      }
    );
  }

  const challenge = issueChallenge(wallet);
  if (!challenge) {
    return NextResponse.json(
      { error: 'Key recovery is not configured.', code: 'RECOVERY_DISABLED' },
      { status: 503 }
    );
  }

  /**
   * Issued whether or not this wallet ever bought anything.
   *
   * Refusing here would turn the endpoint into an oracle for which wallets hold
   * credits, answerable by anyone, for free. Whether an account exists is
   * settled after a signature proves who is asking.
   */
  return NextResponse.json({
    message: challenge.message,
    issued_at: challenge.issuedAt,
    token: challenge.token,
    expires_at: challenge.expiresAt,
    valid_for_seconds: CHALLENGE_TTL_MS / 1000,
    instructions:
      'Sign `message` with this wallet using personal_sign, then POST { wallet, issued_at, token, signature } back to this URL.',
  });
}

export async function POST(request: NextRequest) {
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
      { error: 'Body must be JSON.', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  const wallet = typeof body.wallet === 'string' ? body.wallet : '';
  if (!isAddress(wallet)) return badWallet();

  const issuedAt = Number(body.issued_at);
  const token = typeof body.token === 'string' ? body.token : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!issuedAt || !token || !signature) {
    return NextResponse.json(
      {
        error:
          'Send wallet, issued_at, token and signature from the challenge.',
        code: 'INVALID_REQUEST',
      },
      { status: 400 }
    );
  }

  const limit = await checkIpRateLimit(getClientIp(request), '/api/x402');
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' },
      { status: 429 }
    );
  }

  const proof = await verifyRecovery({ wallet, issuedAt, token, signature });
  if (!proof.ok) {
    if (proof.reason === 'not_configured') {
      return NextResponse.json(
        { error: 'Key recovery is not configured.', code: 'RECOVERY_DISABLED' },
        { status: 503 }
      );
    }
    /**
     * One message for all three failures. Telling a caller whether the token
     * was forged, stale, or the signature wrong tells them which half to keep
     * working on.
     */
    return NextResponse.json(
      {
        error:
          'That signature does not match a live challenge for this wallet. Request a fresh one and sign it within five minutes.',
        code: 'PROOF_REJECTED',
      },
      { status: 403 }
    );
  }

  /**
   * Spend the challenge before anything is issued against it.
   *
   * A valid signature is not enough on its own: the redeem request travels
   * over the wire, and anyone who captures it can send it again from their own
   * connection and receive their own key. They never need the victim's reply.
   * The five-minute window narrows that, it does not close it.
   *
   * Insert-first, so the primary key decides a race between two simultaneous
   * redemptions rather than a read that both of them pass.
   */
  if (!(await consumeChallenge(token, wallet, issuedAt))) {
    return NextResponse.json(
      {
        error:
          'That challenge has already been used. Request a fresh one and sign it within five minutes.',
        code: 'CHALLENGE_SPENT',
      },
      { status: 409 }
    );
  }

  const userId = await walletAccount(wallet);
  if (!userId) {
    return NextResponse.json(
      {
        error:
          'This wallet has not bought a pack. Buy one at /api/x402/buy, which returns a key.',
        code: 'NO_ACCOUNT',
      },
      { status: 404 }
    );
  }

  const created = await createApiKeyIfUnderCap(
    userId,
    `x402 recovery ${wallet.slice(0, 10)}`,
    CREDIT_API_PLAN,
    X402_MAX_KEYS
  );
  if (!created) {
    return NextResponse.json(
      {
        error: 'Service temporarily unavailable.',
        code: 'SERVICE_UNAVAILABLE',
      },
      { status: 503 }
    );
  }
  if ('capReached' in created) {
    return NextResponse.json(
      {
        error: `This wallet already holds ${X402_MAX_KEYS} active keys. Revoke one before issuing another.`,
        code: 'KEY_CAP_REACHED',
      },
      { status: 409 }
    );
  }

  // A key handed out on a signature is worth a line in the log. The prefix,
  // never the key: this is the one place both exist and only one of them is
  // safe to write down.
  console.log(
    `[x402] key reissued wallet=${wallet.toLowerCase()} prefix=${created.key.keyPrefix}`
  );

  const balance = await getBalance(userId);
  return NextResponse.json({
    api_key: created.rawKey,
    shown_once: true,
    matches_available: balance.available,
    docs: 'https://docs.walletlink.social/agent-pack',
  });
}
