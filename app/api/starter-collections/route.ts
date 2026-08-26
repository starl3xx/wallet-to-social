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
  /**
   * A failure must not be answered, because an answer here is kept for an hour.
   *
   * This caught the error and returned an empty list with a 200, reasoning that
   * an empty list renders nothing and the page still works. That reasoning is
   * right about one request and wrong about this route: the response IS the
   * cache entry, so one transient database error during a revalidation was
   * stored as a successful empty answer and the cards stayed hidden for every
   * visitor until the next regeneration an hour later (found by Bugbot,
   * Medium).
   *
   * Throwing is the behaviour that wants: at build time it fails loudly, the
   * same as `/holders` and its `generateStaticParams`, which read the same
   * corpus and catch nothing either; during a revalidation Next keeps serving
   * the last good answer and tries again, which is exactly the outcome the
   * catch was reaching for and did not get.
   */
  const collections = await listStarterCollections(3);
  return NextResponse.json({ collections, walletCap: STARTER_WALLET_CAP });
}
