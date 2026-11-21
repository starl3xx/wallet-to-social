import { revalidateTag } from 'next/cache';

/**
 * The data-cache tag on the landing hero's snapshot read (STA-77).
 *
 * The hero is read on every homepage load, crawlers included, and each read
 * woke the database. It is now cached, which is only safe because every write
 * that could change what it may show expires the cache at once: a removal
 * (`insertSuppressions`) and a snapshot refresh (`/api/cron/refresh-hero`).
 * The removal promise is that it takes effect at once, so this is
 * `{ expire: 0 }`, never stale-while-revalidate: the next homepage load reads
 * the database again and filters against the new suppression list.
 */
export const HERO_CACHE_TAG = 'identity-hero';

/** Seconds a cached snapshot read may be served when nothing expired it. */
export const HERO_CACHE_SECONDS = 6 * 60 * 60;

export function expireHeroCache(): void {
  try {
    revalidateTag(HERO_CACHE_TAG, { expire: 0 });
  } catch (error) {
    // Outside a Next.js request (a script or a test) there is no cache to
    // expire, and nothing served from one.
    console.warn(
      'Hero cache not expired (no Next.js request context):',
      error instanceof Error ? error.message : error
    );
  }
}
