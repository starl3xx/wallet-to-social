/**
 * Reissuing a key to the wallet that paid for it.
 *
 * ## Why this cannot be done from the payment
 *
 * Three attempts were made to serve a key from a replayed payment payload
 * before the reason they all fail became clear. `from` and `nonce` are in
 * USDC's public `AuthorizationUsed` event; the EIP-3009 signature over them is
 * in the settlement transaction's calldata. **Once a payment settles, every
 * field of it is on a public chain**, so nothing a caller can present from that
 * payment distinguishes the buyer from anyone reading Base.
 *
 * Proving current control of a wallet needs a value the wallet could not have
 * seen in advance and could not have copied from anywhere: a challenge this
 * server issued, signed now.
 *
 * ## Why the challenge carries no database row
 *
 * It is an HMAC over the wallet and the minute it was issued, exactly as
 * `unsubscribeUrl` signs an email, so it verifies without a token table. Its
 * own secret rather than a reuse, so rotating it invalidates only recovery
 * challenges.
 *
 * The window is deliberately short. A signed challenge is worth something to an
 * attacker only inside it, and only if they can also read the reply carrying
 * the key, which means they are already reading the response they would be
 * stealing.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { verifyMessage } from 'viem';

/** How long a challenge stays signable. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function secret(): string | null {
  return process.env.X402_RECOVERY_SECRET || null;
}

function sign(wallet: string, issuedAt: number, key: string): string {
  return createHmac('sha256', key)
    .update(`${wallet.toLowerCase()}:${issuedAt}`)
    .digest('hex');
}

/**
 * The exact text the wallet signs.
 *
 * Written to be read by a person approving it in a wallet, because that is
 * where it is shown. It says what it authorises, names this service, and
 * carries the wallet and the moment, so a signature captured for one purpose
 * cannot be presented for another.
 */
export function challengeMessage(wallet: string, issuedAt: number): string {
  return [
    'walletlink.social key recovery',
    '',
    'Sign this to receive a new API key for the credits this wallet has already bought.',
    'It authorises nothing else. No funds move.',
    '',
    `Wallet: ${wallet.toLowerCase()}`,
    `Issued: ${new Date(issuedAt).toISOString()}`,
  ].join('\n');
}

export interface Challenge {
  message: string;
  issuedAt: number;
  token: string;
  expiresAt: string;
}

/** A challenge for this wallet, or null when the secret is unset. */
export function issueChallenge(wallet: string): Challenge | null {
  const key = secret();
  if (!key) return null;
  const issuedAt = Date.now();
  return {
    message: challengeMessage(wallet, issuedAt),
    issuedAt,
    token: sign(wallet, issuedAt, key),
    expiresAt: new Date(issuedAt + CHALLENGE_TTL_MS).toISOString(),
  };
}

export type RecoveryFailure =
  | 'not_configured'
  | 'bad_token'
  | 'expired'
  | 'bad_signature';

/**
 * Whether this signature proves the wallet signed a challenge we issued, now.
 *
 * Both halves are required and neither is sufficient. The token proves the
 * challenge is ours and unexpired; the signature proves the wallet holder saw
 * it. A signature over a message we never issued is refused, and so is one over
 * a challenge that has aged out.
 */
export async function verifyRecovery(input: {
  wallet: string;
  issuedAt: number;
  token: string;
  signature: string;
}): Promise<{ ok: true } | { ok: false; reason: RecoveryFailure }> {
  const key = secret();
  if (!key) return { ok: false, reason: 'not_configured' };

  const expected = sign(input.wallet, input.issuedAt, key);
  const a = Buffer.from(expected);
  const b = Buffer.from(input.token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_token' };
  }

  // Checked after the HMAC, so an attacker cannot learn from the timing which
  // of the two a forged request failed.
  const age = Date.now() - input.issuedAt;
  if (!Number.isFinite(age) || age < 0 || age > CHALLENGE_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }

  try {
    const valid = await verifyMessage({
      address: input.wallet.toLowerCase() as `0x${string}`,
      message: challengeMessage(input.wallet, input.issuedAt),
      signature: input.signature as `0x${string}`,
    });
    return valid ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    // Malformed signature or address.
    return { ok: false, reason: 'bad_signature' };
  }
}
