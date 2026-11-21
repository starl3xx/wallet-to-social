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
 *
 * ## Held for a minute after it settles
 *
 * A read that misses computes the value, starts writing it, and returns
 * without waiting for the write. A cold holder page reads the snapshot again a moment
 * later, before the write has landed, so that read missed too and ran the bulk
 * query a second time: two bulk queries inside one 126 s markdown request on
 * 2026-11-21. Concurrent requests on one instance did the same. So each
 * instance shares one read while it is in flight and for a minute after it
 * settles. A failed read is not held. `direct` skips the hold, for the morning
 * warm, which must refill an entry that has just expired.
 */
export const SHARED_CACHE_HOLD_MS = 60_000;

export type SharedCache<T> = (() => Promise<T>) & {
  direct: () => Promise<T>;
};

export function sharedCache<T>(
  name: string,
  fill: () => Promise<T>,
  options: { revalidate: number; tags: string[] }
): SharedCache<T> {
  const callback = () => fill();
  callback.toString = () => name;
  const direct = unstable_cache(callback, [name, CACHE_ENV], options);
  return Object.assign(holdShared(direct, SHARED_CACHE_HOLD_MS), { direct });
}

/**
 * One read shared by every caller while it is in flight and for `holdMs`
 * after it resolves. A rejected read is dropped at once, so the next caller
 * tries again. Pure, so `scripts/check-invariants.ts` drives it directly.
 */
export function holdShared<T>(
  read: () => Promise<T>,
  holdMs: number,
  now: () => number = Date.now
): () => Promise<T> {
  let held: { value: Promise<T>; settledAt: number | null } | null = null;
  return () => {
    if (held && (held.settledAt === null || now() - held.settledAt < holdMs)) {
      return held.value;
    }
    const entry = { value: read(), settledAt: null as number | null };
    held = entry;
    entry.value.then(
      () => {
        entry.settledAt = now();
      },
      () => {
        if (held === entry) held = null;
      }
    );
    return entry.value;
  };
}
