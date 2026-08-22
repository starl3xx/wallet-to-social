/**
 * The wallet cache TTL, on its own so the client can read it.
 *
 * `lib/cache.ts` imports the database, so a `'use client'` page cannot import
 * from it. The results header says how long a cached row is trusted for, and
 * that copy said "24h" while the TTL here said 168: the number has to come
 * from the same constant the cache reads, or it drifts again.
 */
export const CACHE_TTL_HOURS = 168; // 7 days: wallet-to-social mappings rarely change
export const CACHE_TTL_DAYS = CACHE_TTL_HOURS / 24;
