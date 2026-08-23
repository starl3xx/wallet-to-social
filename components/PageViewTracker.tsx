'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Analytics } from '@/lib/client-analytics';

/**
 * Records a `page_view` for the admin funnel.
 *
 * ## Why this component had to exist
 *
 * `Analytics.pageView` was defined in `lib/client-analytics.ts` and never
 * called, by anything, ever. The database holds 2,569 analytics events going
 * back to 18 January 2026 and **not one** is a `page_view` or a `csv_upload`.
 *
 * That is not a cosmetic gap. `getUserFunnel` reads `page_view` as the top of
 * the journey, so the admin funnel showed 0 page views above 34 lookups, and
 * `UserBehavior` divides by `pageViews || 1`, which turned every rate below it
 * into a percentage of one: 3400% lookups, 4900% upgrade modal. The panel that
 * exists to say where people fall out was reporting arithmetic against a
 * denominator that was never collected.
 *
 * ## Why it is separate from Vercel's `<Analytics />`
 *
 * They answer different questions and neither replaces the other. Vercel counts
 * traffic and is the honest source for "how many people came". This one writes
 * to `analytics_events`, which is what the funnel, the cohorts and the
 * conversion rates are computed from, and it is the only one we can join
 * against a lookup or a payment.
 *
 * ## Every page, not just the app
 *
 * The funnel's first step is "somebody arrived", and arrivals on `/vs/*` and
 * the blog are arrivals. Counting only the app page would flatter every rate
 * beneath it by hiding the visitors who never reached it, which is the opposite
 * of what a funnel is for.
 */
export function PageViewTracker() {
  const pathname = usePathname();

  /**
   * React runs effects twice in development Strict Mode, and a remount on the
   * same path would post again. The guard keeps one event per path per
   * navigation, so a counter that feeds published conversion rates is not
   * inflated by the framework.
   */
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastPath.current === pathname) return;
    lastPath.current = pathname;
    // Deliberately not awaited and errors are swallowed inside the helper:
    // analytics must never delay or break a page render.
    //
    // The ref tag comes off window.location rather than useSearchParams():
    // the hook would force a Suspense boundary in the root layout for a
    // value only read inside an effect, where window is already real.
    const ref = new URLSearchParams(window.location.search).get('ref');
    Analytics.pageView(pathname, ref);
  }, [pathname]);

  return null;
}
