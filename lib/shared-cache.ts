import { unstable_cache } from 'next/cache';
import { CACHE_ENV } from '@/lib/cache-env';

/**
 * A data-cache entry that every route reads as one entry (STA-77, PR #433).
 *
 * `unstable_cache` keys an entry on the callback's compiled source as well as
 * on its key parts: `${cb.toString()}-${keyParts}`, in
 * `next/dist/server/web/spec-extension/unstable-cache.js`. Next compiles a
 * module once per layer, and pages and route handlers are different layers
 * that name the same imports differently. So the holder page and the markdown
 * route each kept their own copy of the holder snapshot, and the markdown copy
 * was refilled by whichever agent asked first: 126 s of bulk queries on
 * 2026-11-21, at an hour nobody chose. Here the callback's source is its name,
 * so every layer computes the same key.
 *
 * The name is the only version now. The compiled source used to change the key
 * whenever the function changed. It no longer does, and the data cache
 * outlives deploys, so bump the `-vN` in the name on any change to what the
 * entry holds. If not, a deploy reads the old shape until the next expiry.

 * Only the key is shared. Nothing is held in memory between requests: a held
 * value could outlive the morning expiry and be baked into a page rebuilt just
 * after it, which would then count as fresh until the next morning (Bugbot on
 * PR #433). Reads within one request are shared by the caller
 * (`lib/holder-pages.ts`).
 */
export function sharedCache<T>(
  name: string,
  fill: () => Promise<T>,
  options: { revalidate: number; tags: string[] }
): () => Promise<T> {
  const callback = () => fill();
  callback.toString = () => name;
  return unstable_cache(callback, [name, CACHE_ENV], options);
}
