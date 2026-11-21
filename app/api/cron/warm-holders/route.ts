import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import {
  HOLDER_DATA_TAG,
  listHolderCollectionsCached,
  warmHolderSnapshot,
} from '@/lib/holder-pages';
import { listStarterCollectionsCached } from '@/lib/starter-collections';
import { getSiteUrl } from '@/lib/site-url';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Pages fetched at once while warming: enough to finish in about a minute. */
const WARM_CONCURRENCY = 6;

/** Cached renders regenerated each morning, besides one per holder report. */
const DAILY_PATHS = ['/sitemap.xml', '/holders', '/api/public-stats'];

/**
 * Regenerates every holder report, and what is built from the same data, once
 * a day inside the morning cron window (STA-77).
 *
 * The holder data is a multi-second aggregate over the whole holdings table.
 * It used to be recomputed whenever a crawler or an agent happened to arrive,
 * at random times all day (1.8 million index reads in one quiet 15-minute
 * window on 2026-11-21), which kept the database from ever reaching the five
 * idle minutes Neon needs to suspend. Now the pages and the data cache keep a
 * week, and this route refreshes them while the database is awake for the
 * morning crons anyway. The pages show aggregates only, never an identity, so
 * a day-old render has nothing a removal must take back.
 *
 * Every report reads one bulk snapshot (`warmHolderSnapshot` in
 * lib/holder-pages.ts), so the warm fills that first and awaits it. A page
 * fetched before it would start the aggregate itself, six at once, and each
 * would outlast its fetch timeout on a cold database.
 *
 * ## Two phases, two requests, on purpose
 *
 * Next applies `revalidatePath` and `revalidateTag` only after the route
 * handler returns. A single request that expired the caches and then fetched
 * the pages fetched them from the still-valid cache, and the real regeneration
 * happened later, whenever a crawler arrived: the random-hour wake this route
 * exists to prevent. So `?phase=expire` (07:28 UTC) only expires, and the plain
 * call (07:30 UTC) only regenerates: it refills the snapshot and the listing,
 * fetches every listed page, whose stale render is rebuilt from the fresh
 * snapshot, and refills the starter collections directly, because their edge
 * cache may still answer a fetch without running the route. The two minutes
 * between them are the only time a visitor can meet an expired snapshot.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (request.nextUrl.searchParams.get('phase') === 'expire') {
      return NextResponse.json(expirePhase());
    }
    return NextResponse.json(await warmPhase());
  } catch (error) {
    console.error('Holder warm failed:', error);
    return NextResponse.json({ error: 'warm_failed' }, { status: 500 });
  }
}

/** 07:28: mark everything stale. Applied when this request returns. */
function expirePhase() {
  revalidateTag(HOLDER_DATA_TAG, { expire: 0 });
  revalidatePath('/holders/[chain]/[address]', 'page');
  for (const path of DAILY_PATHS) revalidatePath(path);
  return { expired: [HOLDER_DATA_TAG, ...DAILY_PATHS, '/holders/*'] };
}

/** 07:30: rebuild everything the expire phase marked stale. */
async function warmPhase() {
  const snapshot = await warmHolderSnapshot();
  // Past the one-minute hold, so the entry the expiry just cleared is refilled.
  const collections = await listHolderCollectionsCached.direct();
  const paths = [
    ...DAILY_PATHS,
    ...collections.map((c) => `/holders/${c.chain}/${c.address}`),
  ];

  const origin = getSiteUrl();
  let warmed = 0;
  let failed = 0;
  for (let i = 0; i < paths.length; i += WARM_CONCURRENCY) {
    const batch = paths.slice(i, i + WARM_CONCURRENCY);
    const outcomes = await Promise.allSettled(
      batch.map(async (path) => {
        const response = await fetch(`${origin}${path}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(30_000),
        });
        // Read the body: it releases the socket, and the render is only
        // known to have finished once the stream has.
        await response.arrayBuffer();
        return response.ok;
      })
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled' && outcome.value) warmed++;
      else failed++;
    }
  }

  const starters = await listStarterCollectionsCached(3);
  return {
    snapshot,
    pages: paths.length,
    warmed,
    failed,
    starters: starters.length,
  };
}
