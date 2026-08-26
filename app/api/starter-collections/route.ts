import { NextResponse } from 'next/server';
import {
  listStarterCollections,
  STARTER_WALLET_CAP,
} from '@/lib/starter-collections';

/**
 * The collections offered as a first action on the homepage.
 *
 * The homepage is a client component, so it cannot read the corpus directly
 * the way /holders does. This is the smallest thing that closes that gap: the
 * same listing floor, the same rows, shaped for a card.
 *
 * Cached rather than queried per visit. The reachability query behind it
 * aggregates the whole holdings table against the identity index and measures
 * about two seconds, which is a fine cost hourly and an absurd one on every
 * arrival at the front page. The corpus moves on the seed cron's clock, so an
 * hour-old answer is the same answer.
 */
export const revalidate = 3600;
export const dynamic = 'force-static';

export async function GET() {
  try {
    const collections = await listStarterCollections(3);
    return NextResponse.json({ collections, walletCap: STARTER_WALLET_CAP });
  } catch (error) {
    // An empty list renders nothing, which is the honest failure: the rest of
    // the page still offers every way in that needs the visitor to bring data.
    console.error('Starter collections fetch error:', error);
    return NextResponse.json({
      collections: [],
      walletCap: STARTER_WALLET_CAP,
    });
  }
}
