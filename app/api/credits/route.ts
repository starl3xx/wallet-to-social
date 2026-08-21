import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getBalance, legacyTierIsUnmetered } from '@/lib/credits';
import { normalizeTier } from '@/lib/access';
import { FREE_MATCHES_PER_WINDOW, SUBMISSION_MULTIPLIER } from '@/lib/packs';

export const runtime = 'nodejs';

/**
 * What this account can spend.
 *
 * Session-only, deliberately. An anonymous caller has no ledger: `userId` is a
 * localStorage value that a cleared cache resets, so there is nothing to
 * report and nothing to meter. They get the per-lookup cap and the IP rate
 * limit instead, which is the demo that earns the signup.
 *
 * A legacy `pro` or `unlimited` account returns `unmetered: true` rather than a
 * number. Those tiers were sold one-time, before credits existed, and
 * displaying a balance for them would imply a meter they never agreed to.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : { user: null };

  if (!session.user) {
    return NextResponse.json({
      signedIn: false,
      unmetered: false,
      available: 0,
      freeAllowance: FREE_MATCHES_PER_WINDOW,
    });
  }

  const tier = normalizeTier(session.user.tier);

  if (legacyTierIsUnmetered(tier)) {
    return NextResponse.json({ signedIn: true, unmetered: true, tier });
  }

  const balance = await getBalance(session.user.id);

  return NextResponse.json({
    signedIn: true,
    unmetered: false,
    tier,
    available: balance.available,
    onFreeAllowance: balance.onFreeAllowance,
    freeAllowance: FREE_MATCHES_PER_WINDOW,
    freeUsedThisWindow: balance.freeUsedThisWindow,
    freeWindowResetsAt: balance.freeWindowResetsAt,
    // What the caller may submit right now. The UI needs this to say "you can
    // run 2,500 wallets" rather than making someone infer it from a multiplier.
    maxWallets: balance.available * SUBMISSION_MULTIPLIER,
    lots: balance.lots.map((l) => ({
      remaining: l.remaining,
      pack: l.pack,
      expiresAt: l.expiresAt,
    })),
  });
}
