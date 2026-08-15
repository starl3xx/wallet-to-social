import { getDb } from '@/db';
import { users, whitelist } from '@/db/schema';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { trackEvent } from '@/lib/analytics';

export type UserTier = 'free' | 'pro' | 'unlimited';

/** Paid tiers, i.e. the ones that can be bought. */
export type PaidTier = Exclude<UserTier, 'free'>;

export interface UserAccess {
  tier: UserTier;
  isWhitelisted: boolean;
  walletLimit: number;       // per-lookup limit
  walletsUsed: number;       // cumulative wallets processed
  canUseNeynar: boolean;
  canUseENS: boolean;
}

/**
 * `users.tier` is a free-text column, so anything could be in it.
 *
 * Everything downstream indexes maps by tier, and an unrecognised value would
 * yield `undefined` for the wallet limit rather than an error: a broken lookup
 * with no obvious cause. Treating unknown as free is both the safe default and
 * the honest one, since an unrecognised tier is not a tier we sell.
 */
export function normalizeTier(value: string | null | undefined): UserTier {
  return value === 'pro' || value === 'unlimited' ? value : 'free';
}

export const TIER_LIMITS: Record<UserTier, number> = {
  // Free is deliberately enough to prove the product on a real list and not
  // enough to run a campaign on. It was 1,000, which combined with unlimited
  // free lookups made Pro nearly redundant — only 7 lookups in the product's
  // history ever exceeded it, while the upgrade modal was viewed 261 times.
  free: 500,
  // Pro sits at 5,000 rather than 10,000 deliberately. Historically the two are
  // identical — 140 of 142 lookups ever were under 5,000 — but at 10,000 Pro
  // swallows essentially every case and Unlimited has no volume story left.
  // Blue-chip and token-holder lists (BAYC 5,601 holders, Base Colors 17,712)
  // are exactly the buyers who can justify the top tier.
  pro: 5000,
  unlimited: Infinity,
};

/**
 * No tier carries a cumulative quota.
 *
 * Starter was the only one that ever did (10,000 wallets total), and it was
 * retired on 2026-08-12 having never been purchased by anyone. The quota
 * machinery it required, `TIER_QUOTA` / `walletQuota` / `walletsRemaining`,
 * went with it: every tier now has a per-lookup limit and nothing else, which
 * is the model the product actually sells.
 *
 * `walletsUsed` is still accumulated. It no longer gates anything, but it is
 * the only record of how much work an account has actually run.
 */
export const TIER_PRICES: Record<PaidTier, number> = {
  pro: 99,
  unlimited: 249,
};

/**
 * Check if an email or wallet is whitelisted
 */
export async function isWhitelisted(
  email?: string,
  wallet?: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  if (!email && !wallet) return false;

  try {
    const conditions = [];
    if (email) {
      conditions.push(eq(whitelist.email, email.toLowerCase()));
    }
    if (wallet) {
      conditions.push(eq(whitelist.wallet, wallet.toLowerCase()));
    }

    const [entry] = await db
      .select()
      .from(whitelist)
      .where(or(...conditions))
      .limit(1);

    return !!entry;
  } catch (error) {
    console.error('Whitelist check error:', error);
    return false;
  }
}

/**
 * Get user access level based on email/wallet
 * Priority: whitelist > paid tier > free
 */
export async function getUserAccess(
  email?: string,
  wallet?: string
): Promise<UserAccess> {
  // Default free tier access
  const freeAccess: UserAccess = {
    tier: 'free',
    isWhitelisted: false,
    walletLimit: TIER_LIMITS.free,
    walletsUsed: 0,
    canUseNeynar: true,
    canUseENS: false,
  };

  const db = getDb();
  if (!db) return freeAccess;

  try {
    // Check whitelist first
    const whitelisted = await isWhitelisted(email, wallet);
    if (whitelisted) {
      return {
        tier: 'unlimited',
        isWhitelisted: true,
        walletLimit: Infinity,
        walletsUsed: 0,
        canUseNeynar: true,
        canUseENS: true,
      };
    }

    // Check users table for paid tier
    if (email) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      if (user) {
        // Normalised rather than cast: the column is free text, and a value we
        // do not recognise would otherwise index TIER_LIMITS to `undefined` and
        // produce a lookup limit of NaN instead of an error.
        const tier = normalizeTier(user.tier);

        return {
          tier,
          isWhitelisted: false,
          walletLimit: TIER_LIMITS[tier],
          walletsUsed: user.walletsUsed ?? 0,
          canUseNeynar: true,
          canUseENS: tier !== 'free',
        };
      }
    }

    return freeAccess;
  } catch (error) {
    console.error('Access check error:', error);
    return freeAccess;
  }
}

/**
 * Get or create a user by email
 */
export async function getOrCreateUser(email: string) {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  const normalizedEmail = email.toLowerCase();

  // Try to find existing user
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existing) return existing;

  // Create new user
  const [newUser] = await db
    .insert(users)
    .values({ email: normalizedEmail })
    .returning();

  return newUser;
}

/**
 * Upgrade a user to a paid tier
 */
export async function upgradeUser(
  email: string,
  tier: PaidTier,
  stripeCustomerId: string,
  stripePaymentId: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  const normalizedEmail = email.toLowerCase();
  // '' is not an id. Callers derive this from `session.customer`, which is null
  // for any checkout that did not create a Customer, and an empty string stored
  // in an id column reads as "we have one and it is blank" rather than "there
  // isn't one".
  const customerId = stripeCustomerId || null;

  await db
    .insert(users)
    .values({
      email: normalizedEmail,
      tier,
      stripeCustomerId: customerId,
      stripePaymentId,
      paidAt: new Date(),
      walletsUsed: 0,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        tier,
        stripeCustomerId: customerId,
        stripePaymentId,
        paidAt: new Date(),
        // walletsUsed is deliberately left alone. It used to be reset for
        // Starter, whose cumulative quota made the counter meaningful; with no
        // tier carrying a quota it is a lifetime usage record, and resetting it
        // on upgrade would only destroy history.
      },
    });
}

/**
 * Rank of each tier, so a lower-tier grant can never clobber a higher one.
 */
const TIER_RANK: Record<UserTier, number> = {
  free: 0,
  pro: 1,
  unlimited: 2,
};

export interface ProvisionResult {
  provisioned: boolean;
  /** 'granted' | 'already-provisioned' | 'outranked' | 'no-account' */
  reason: 'granted' | 'already-provisioned' | 'outranked' | 'no-account';
  tier: UserTier;
}

/**
 * Grant a paid tier exactly once, from whichever path notices the payment first.
 *
 * Two paths know a checkout succeeded: the Stripe webhook, and the /success page
 * polling `checkout-status` with a session id. Before 2026-08-15 only the webhook
 * granted anything, so when its endpoint was pointed at a redirecting URL every
 * payment on the platform succeeded in Stripe and provisioned nothing. The
 * customer had no recourse: the one system that could have fixed it up was
 * already talking to Stripe and already knew the session was paid, and threw
 * that knowledge away.
 *
 * Both paths now call this. It is idempotent on `stripePaymentId`, which is the
 * natural key: whichever path arrives first writes the grant, the other becomes
 * a no-op rather than a duplicate upgrade or a double-counted sale.
 */
export async function provisionPaidCheckout(
  email: string,
  tier: PaidTier,
  stripeCustomerId: string,
  stripePaymentId: string,
  context: { sessionId: string; via: 'checkout.session' | 'payment_intent' | 'success-page' }
): Promise<ProvisionResult> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  const normalizedEmail = email.toLowerCase();
  const paidAt = new Date();
  // Same reasoning as upgradeUser: an empty string is not an id.
  const customerId = stripeCustomerId || null;

  // Both guards live inside the upsert rather than in a preceding SELECT, and
  // that is the whole point. Read-then-write is not safe here: the webhook and
  // the /success poll are *designed* to run at the same moment on the same
  // payment, so both could read "not yet provisioned", both pass, and both book
  // the sale. Revenue is summed from those events, so the report would simply be
  // wrong.
  //
  // With the conditions in `setWhere`, Postgres takes a row lock on conflict.
  // The second writer blocks, then re-evaluates against the row the first one
  // just committed, sees its own payment id already there, and matches nothing.
  // `returning()` yields a row only when this call actually changed something,
  // which makes it the authority on whether to record a sale.
  const tiersThisCanOverwrite = (Object.keys(TIER_RANK) as UserTier[]).filter(
    (t) => TIER_RANK[t] <= TIER_RANK[tier]
  );

  const [granted] = await db
    .insert(users)
    .values({
      email: normalizedEmail,
      tier,
      stripeCustomerId: customerId,
      stripePaymentId,
      paidAt,
      walletsUsed: 0,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        tier,
        stripeCustomerId: customerId,
        stripePaymentId,
        paidAt,
        // Matches upgradeUser: walletsUsed is a lifetime record, never reset.
      },
      setWhere: and(
        // Idempotency on the payment intent. `ne` alone would not do: a NULL
        // stripe_payment_id compares as NULL rather than true, so a first-time
        // upgrade of an existing free account would match nothing and silently
        // never provision.
        or(
          isNull(users.stripePaymentId),
          ne(users.stripePaymentId, stripePaymentId)
        ),
        // Never downgrade. Without this, someone on Unlimited re-opening an old
        // Pro success URL would be quietly dropped a tier.
        inArray(users.tier, tiersThisCanOverwrite)
      ),
    })
    .returning();

  if (!granted) {
    // Nothing changed, so distinguish why purely for the caller's logs. This
    // read races nothing: it only labels an outcome already decided above.
    const [existing] = await db
      .select({ tier: users.tier, stripePaymentId: users.stripePaymentId })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!existing) return { provisioned: false, reason: 'no-account', tier: 'free' };

    return {
      provisioned: false,
      reason:
        existing.stripePaymentId === stripePaymentId
          ? 'already-provisioned'
          : 'outranked',
      tier: (existing.tier as UserTier) ?? 'free',
    };
  }

  // Booked here rather than at the call sites, so a grant cannot happen without
  // the sale being recorded, and it is reached only when the upsert above
  // actually wrote. The webhook previously did this as a floating promise
  // (`trackEvent(...)` with no await), which a serverless runtime is free to
  // discard when the handler returns, and the payment_intent path recorded
  // nothing at all.
  await trackEvent('payment_completed', {
    userId: normalizedEmail,
    metadata: {
      tier,
      amountCents: TIER_PRICES[tier] * 100,
      stripeSessionId: context.sessionId,
      stripeCustomerId: customerId,
      via: context.via,
    },
  });

  return { provisioned: true, reason: 'granted', tier };
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string) {
  const db = getDb();
  if (!db) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  return user || null;
}

/**
 * Add entry to whitelist
 */
export async function addToWhitelist(
  entry: { email?: string; wallet?: string; note?: string }
): Promise<string> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  if (!entry.email && !entry.wallet) {
    throw new Error('Either email or wallet required');
  }

  const [result] = await db
    .insert(whitelist)
    .values({
      email: entry.email?.toLowerCase(),
      wallet: entry.wallet?.toLowerCase(),
      note: entry.note,
    })
    .returning();

  return result.id;
}

/**
 * Remove entry from whitelist
 */
export async function removeFromWhitelist(id: string): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  const result = await db
    .delete(whitelist)
    .where(eq(whitelist.id, id))
    .returning();

  return result.length > 0;
}

/**
 * Get all whitelist entries
 */
export async function getWhitelistEntries() {
  const db = getDb();
  if (!db) return [];

  return db.select().from(whitelist).orderBy(whitelist.createdAt);
}

/**
 * Add to a user's lifetime wallet count.
 *
 * This gated the Starter quota; with that tier gone it gates nothing, and is
 * kept purely as a record of how much work an account has run.
 */
export async function incrementWalletsUsed(
  email: string,
  count: number
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  await db
    .update(users)
    .set({ walletsUsed: sql`${users.walletsUsed} + ${count}` })
    .where(eq(users.email, email.toLowerCase()));
}

/**
 * Get stats for admin dashboard
 */
export async function getAccessStats() {
  const db = getDb();
  if (!db) return { free: 0, pro: 0, unlimited: 0, whitelisted: 0 };

  try {
    const userStats = await db
      .select({
        tier: users.tier,
        count: sql<number>`count(*)::int`,
      })
      .from(users)
      .groupBy(users.tier);

    const [whitelistCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(whitelist);

    const stats = { free: 0, pro: 0, unlimited: 0, whitelisted: 0 };
    for (const row of userStats) {
      if (row.tier in stats) {
        stats[row.tier as keyof typeof stats] = row.count;
      }
    }
    stats.whitelisted = whitelistCount?.count || 0;

    return stats;
  } catch (error) {
    console.error('Stats error:', error);
    return { free: 0, pro: 0, unlimited: 0, whitelisted: 0 };
  }
}
