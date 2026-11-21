import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { listHolderCollections } from '@/lib/holder-pages';
import { getSiteUrl } from '@/lib/site-url';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Pages fetched at once while warming: enough to finish in about a minute. */
const WARM_CONCURRENCY = 6;

/**
 * Regenerates every holder report once a day, inside the morning cron window
 * (STA-77).
 *
 * The holder pages used to regenerate hourly, whenever a crawler happened to
 * arrive. There are over 300 of them, so the regenerations landed at random
 * times all day, each one a heavy read of `wallet_holdings` (1.8 million index
 * reads in one quiet 15-minute window on 2026-11-21), and together they kept
 * the database from ever reaching the five idle minutes Neon needs to suspend.
 *
 * Now the pages keep their cached render for a week, and this cron, at 07:30
 * UTC after the 07:00 seed run has moved the holdings, marks them stale and
 * fetches each one, so the regeneration happens here, while the database is
 * awake for the morning crons anyway. A crawler arriving later gets the cached
 * page and wakes nothing. The pages show aggregates only, never an identity,
 * so a day-old render has nothing a removal must take back.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const collections = await listHolderCollections();
    const paths = [
      '/sitemap.xml',
      '/holders',
      ...collections.map((c) => `/holders/${c.chain}/${c.address}`),
    ];

    revalidatePath('/holders');
    revalidatePath('/holders/[chain]/[address]', 'page');
    revalidatePath('/sitemap.xml');

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

    return NextResponse.json({ pages: paths.length, warmed, failed });
  } catch (error) {
    console.error('Holder warm failed:', error);
    return NextResponse.json({ error: 'warm_failed' }, { status: 500 });
  }
}
