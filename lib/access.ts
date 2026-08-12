import { getDb } from '@/db';
import { users, whitelist } from '@/db/schema';
import { eq, or, sql } from 'drizzle-orm';

export type UserTier = 'free' | 'starter' | 'pro' | 'unlimited';

export interface UserAccess {
  tier: UserTier;
  isWhitelisted: boolean;
  walletLimit: number;       // per-lookup limit
  walletQuota: number | null; // total cumulative quota (starter only)
  walletsUsed: number;       // cumulative wallets processed
  walletsRemaining: number | null; // quota - used (starter only)
  canUseNeynar: boolean;
  canUseENS: boolean;
}

export const TIER_LIMITS: Record<UserTier, number> = {
  // Free is deliberately enough to prove the product on a real list and not
  // enough to run a campaign on. It was 1,000, which combined with unlimited
  // free lookups made Pro nearly redundant — only 7 lookups in the product's
  // history ever exceeded it, while the upgrade modal was viewed 261 times.
  free: 500,
  // Retired 2026-08-12 and no longer purchasable, but kept so any legacy
  // account holding it still resolves rather than crashing.
  starter: 10000,
  // Pro sits at 5,000 rather than 10,000 deliberately. Historically the two are
  // identical — 140 of 142 lookups ever were under 5,000 — but at 10,000 Pro
  // swallows essentially every case and Unlimited has no volume story left.
  // Blue-chip and token-holder lists (BAYC 5,601 holders, Base Colors 17,712)
  // are exactly the buyers who can justify the top tier.
  pro: 5000,
  unlimited: Infinity,
};

export const TIER_QUOTA: Record<UserTier, number | null> = {
  free: null,      // no cumulative quota
  starter: 10000,  // 10,000 total
  pro: null,       // no cumulative quota
  unlimited: null,
};

export const TIER_PRICES: Record<'starter' | 'pro' | 'unlimited', number> = {
  starter: 49,
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
    walletQuota: null,
    walletsUsed: 0,
    walletsRemaining: null,
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
        walletQuota: null,
        walletsUsed: 0,
        walletsRemaining: null,
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
        const tier = user.tier as UserTier;
        const isPaid = tier === 'starter' || tier === 'pro' || tier === 'unlimited';
        const quota = TIER_QUOTA[tier];
        const walletsUsed = user.walletsUsed ?? 0;
        const walletsRemaining = quota !== null ? Math.max(0, quota - walletsUsed) : null;

        return {
          tier,
          isWhitelisted: false,
          walletLimit: TIER_LIMITS[tier],
          walletQuota: quota,
          walletsUsed,
          walletsRemaining,
          canUseNeynar: true,
          canUseENS: isPaid,
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
  tier: 'starter' | 'pro' | 'unlimited',
  stripeCustomerId: string,
  stripePaymentId: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  const normalizedEmail = email.toLowerCase();

  // Upsert user with new tier
  // For starter tier, reset walletsUsed to 0 on purchase
  await db
    .insert(users)
    .values({
      email: normalizedEmail,
      tier,
      stripeCustomerId,
      stripePaymentId,
      paidAt: new Date(),
      walletsUsed: 0, // Reset usage on upgrade
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        tier,
        stripeCustomerId,
        stripePaymentId,
        paidAt: new Date(),
        // Reset walletsUsed only for starter tier upgrades
        ...(tier === 'starter' ? { walletsUsed: 0 } : {}),
      },
    });
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
 * Increment walletsUsed counter for starter tier users
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
  if (!db) return { free: 0, starter: 0, pro: 0, unlimited: 0, whitelisted: 0 };

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

    const stats = { free: 0, starter: 0, pro: 0, unlimited: 0, whitelisted: 0 };
    for (const row of userStats) {
      if (row.tier in stats) {
        stats[row.tier as keyof typeof stats] = row.count;
      }
    }
    stats.whitelisted = whitelistCount?.count || 0;

    return stats;
  } catch (error) {
    console.error('Stats error:', error);
    return { free: 0, starter: 0, pro: 0, unlimited: 0, whitelisted: 0 };
  }
}
