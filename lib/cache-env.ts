/**
 * The deployment environment, as a data-cache key part (STA-77).
 *
 * Several holder reads answer differently on a preview deployment (an empty
 * listing, on purpose, so preview builds never touch Neon). A data-cache entry
 * keyed without the environment could be filled by a preview and served to
 * production for as long as it lives. Every `unstable_cache` key over data a
 * preview answers differently carries this.
 *
 * Kept out of `lib/holder-pages.ts`, whose own `VERCEL_ENV` reads are pinned to
 * the exact preview equality by `scripts/check-invariants.ts`.
 */
export const CACHE_ENV = process.env.VERCEL_ENV ?? 'local';
