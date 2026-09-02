import {
  getDb,
  analyticsEvents,
  apiMetrics,
  creditLots,
  dailyStats,
  lookupJobs,
  users,
  type NewAnalyticsEvent,
  type NewApiMetric,
} from '@/db';
import { sql, eq, and, gte, lte, desc, count, avg } from 'drizzle-orm';

/**
 * A window bound, as the naive-UTC literal the timestamp columns actually hold.
 *
 * Interpolating a JS `Date` into a raw `sql` template does not do this. Drizzle
 * hands the driver a local-offset string, so a machine at UTC-5 sends
 * `2026-08-26T14:07:29.664-05:00`; `analytics_events.created_at` is `timestamp
 * without time zone` holding UTC, so Postgres discards the offset and compares
 * against the wall-clock half. The window silently ends five hours early.
 *
 * Measured on 2026-08-26 over a 30-day window: the Drizzle query builder
 * counted 3,739 events, the same window through a raw `sql` template counted
 * 3,645, and this helper counted 3,739. The 94 missing rows were the whole of
 * that day, which is the part anybody looking at a funnel cares most about.
 *
 * Production runs in UTC, where the offset is zero and the bug does not bite,
 * which is exactly why it survived: it is invisible on the only machine nobody
 * questions, and it makes every local verification of these queries lie. The
 * pre-existing session count in `getUserFunnel` had it too.
 *
 * The `::timestamp` cast at each call site is not decoration. Without it the
 * parameter arrives untyped and the coercion depends on context.
 *
 * Exported only so `scripts/check-invariants.ts` can call it. The first version
 * of that assertion checked the call sites and not this body, and the guard
 * duly replaced the body with `String(d)` and went undetected: an assertion
 * that every caller uses the helper says nothing about whether the helper is
 * right.
 */
export function utcBound(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

// Event types for tracking user behavior
export type AnalyticsEventType =
  | 'page_view'
  | 'csv_upload'
  | 'lookup_started'
  | 'lookup_completed'
  | 'export_clicked'
  | 'history_saved'
  | 'upgrade_modal_viewed'
  | 'checkout_started'
  // checkout_started fires on button click, before the API call, so on its own
  // it cannot distinguish "reached Stripe" from "checkout errored". These two
  // close that gap: 41 checkout_started with 0 payments was unreadable without them.
  | 'checkout_redirected'
  | 'checkout_failed'
  | 'payment_completed'
  | 'limit_hit'
  // The app's reverse lookup, fired client-side so it carries a session id.
  // `locked` separates a caller who got the count from one who got the
  // wallets, which is the only way to tell whether the free half converts.
  | 'reverse_lookup'
  | 'user_registered'
  | 'contract_import_blocked'
  | 'contract_import_success'
  // Social graph tracking events (Phase 3)
  | 'social_graph_hit' // Served from high-quality graph data, skipped API
  | 'social_graph_miss' // Not in graph or low quality, needed API
  | 'social_graph_stale' // In graph but needed refresh
  | 'social_graph_write_success'
  | 'social_graph_write_failed'
  // Weekly hygiene pass. `blocked` is the one that matters: it fires when a
  // repair refused because it matched more rows than its ceiling allows, which
  // means the detection is probably broken and nobody would otherwise find out.
  | 'graph_repair_applied'
  | 'graph_repair_blocked';

// API provider names
export type ApiProvider = 'web3bio' | 'neynar' | 'ens';

// Track a user behavior event
export async function trackEvent(
  eventType: AnalyticsEventType,
  options: {
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const event: NewAnalyticsEvent = {
      eventType,
      userId: options.userId ?? null,
      sessionId: options.sessionId ?? null,
      metadata: options.metadata ?? null,
    };

    await db.insert(analyticsEvents).values(event);
  } catch (error) {
    console.error('Analytics event tracking error:', error);
  }
}

// Track API call performance
export async function trackApiCall(
  provider: ApiProvider,
  options: {
    latencyMs: number;
    statusCode?: number;
    errorMessage?: string;
    walletCount?: number;
    jobId?: string;
  }
): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const metric: NewApiMetric = {
      provider,
      latencyMs: options.latencyMs,
      statusCode: options.statusCode ?? null,
      errorMessage: options.errorMessage ?? null,
      walletCount: options.walletCount ?? null,
      jobId: options.jobId ?? null,
    };

    await db.insert(apiMetrics).values(metric);
  } catch (error) {
    console.error('API metrics tracking error:', error);
  }
}

// Get unique user count for a date range
export async function getActiveUsers(
  startDate: Date,
  endDate: Date
): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  try {
    const result = await db
      .select({ count: sql<number>`COUNT(DISTINCT user_id)` })
      .from(analyticsEvents)
      .where(
        and(
          gte(analyticsEvents.createdAt, startDate),
          lte(analyticsEvents.createdAt, endDate),
          sql`user_id IS NOT NULL`
        )
      );

    return result[0]?.count ?? 0;
  } catch (error) {
    console.error('Active users error:', error);
    return 0;
  }
}

// Get API performance stats for a provider
export async function getApiStats(
  provider: ApiProvider,
  startDate: Date,
  endDate: Date
): Promise<{
  avgLatency: number;
  p99Latency: number;
  errorRate: number;
  totalCalls: number;
}> {
  const db = getDb();
  if (!db) return { avgLatency: 0, p99Latency: 0, errorRate: 0, totalCalls: 0 };

  try {
    const stats = await db
      .select({
        avgLatency: avg(apiMetrics.latencyMs),
        totalCalls: count(),
        errorCount: sql<number>`SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END)`,
      })
      .from(apiMetrics)
      .where(
        and(
          eq(apiMetrics.provider, provider),
          gte(apiMetrics.createdAt, startDate),
          lte(apiMetrics.createdAt, endDate)
        )
      );

    // Get P99 latency separately
    const p99Result = await db
      .select({ latency: apiMetrics.latencyMs })
      .from(apiMetrics)
      .where(
        and(
          eq(apiMetrics.provider, provider),
          gte(apiMetrics.createdAt, startDate),
          lte(apiMetrics.createdAt, endDate),
          sql`latency_ms IS NOT NULL`
        )
      )
      .orderBy(desc(apiMetrics.latencyMs));

    const p99Index = Math.floor(p99Result.length * 0.01);
    const p99Latency = p99Result[p99Index]?.latency ?? 0;

    const totalCalls = stats[0]?.totalCalls ?? 0;
    const errorCount = Number(stats[0]?.errorCount ?? 0);

    return {
      avgLatency: Math.round(Number(stats[0]?.avgLatency ?? 0)),
      p99Latency,
      errorRate: totalCalls > 0 ? (errorCount / totalCalls) * 100 : 0,
      totalCalls,
    };
  } catch (error) {
    console.error('API stats error:', error);
    return { avgLatency: 0, p99Latency: 0, errorRate: 0, totalCalls: 0 };
  }
}

// Aggregate daily stats - run this via cron job
export async function aggregateDailyStats(date: Date): Promise<void> {
  const db = getDb();
  if (!db) return;

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const dateStr = startOfDay.toISOString().split('T')[0];

  try {
    // Count lookups (completed jobs)
    const lookupStats = await db
      .select({
        totalLookups: count(),
        totalWallets: sql<number>`COALESCE(SUM(COALESCE(array_length(wallets::text[], 1), 0)), 0)`,
        uniqueUsers: sql<number>`COUNT(DISTINCT user_id)`,
        avgMatchRate: sql<number>`AVG(
          CASE WHEN COALESCE(array_length(wallets::text[], 1), 0) > 0
          THEN (COALESCE(twitter_found, 0) + COALESCE(farcaster_found, 0)) * 100.0 / COALESCE(array_length(wallets::text[], 1), 1)
          ELSE 0 END
        )`,
        cacheHits: sql<number>`COALESCE(SUM(cache_hits), 0)`,
      })
      .from(lookupJobs)
      .where(
        and(
          eq(lookupJobs.status, 'completed'),
          gte(lookupJobs.completedAt, startOfDay),
          lte(lookupJobs.completedAt, endOfDay)
        )
      );

    // Count new users
    const newUserStats = await db
      .select({ count: count() })
      .from(users)
      .where(
        and(gte(users.createdAt, startOfDay), lte(users.createdAt, endOfDay))
      );

    // Legacy tier purchases. Only the two legacy accounts ever set `tier` and
    // `paidAt`; a pack never touches either column. Kept so the days those two
    // sales landed on keep their revenue when the stats are recomputed.
    const purchaseStats = await db
      .select({
        proPurchases: sql<number>`SUM(CASE WHEN tier = 'pro' THEN 1 ELSE 0 END)`,
        unlimitedPurchases: sql<number>`SUM(CASE WHEN tier = 'unlimited' THEN 1 ELSE 0 END)`,
      })
      .from(users)
      .where(and(gte(users.paidAt, startOfDay), lte(users.paidAt, endOfDay)));

    // Pack revenue: what was actually charged for each lot created that day.
    // `amount_cents` is the record of what was paid, not derived from the
    // pack, so a price change does not rewrite history. Hand-issued grants
    // carry 0 and add nothing.
    const packStats = await db
      .select({
        packRevenueCents: sql<number>`COALESCE(SUM(${creditLots.amountCents}), 0)`,
      })
      .from(creditLots)
      .where(
        and(
          gte(creditLots.createdAt, startOfDay),
          lte(creditLots.createdAt, endOfDay)
        )
      );

    // Legacy list prices (Pro $99, Unlimited $249) apply only to the tier
    // sales above; nothing sold today is priced this way.
    const proPurchases = Number(purchaseStats[0]?.proPurchases ?? 0);
    const unlimitedPurchases = Number(
      purchaseStats[0]?.unlimitedPurchases ?? 0
    );
    const packRevenueCents = Number(packStats[0]?.packRevenueCents ?? 0);
    const revenueCents =
      packRevenueCents + proPurchases * 9900 + unlimitedPurchases * 24900;

    // Get API error count
    const errorStats = await db
      .select({ count: count() })
      .from(apiMetrics)
      .where(
        and(
          gte(apiMetrics.createdAt, startOfDay),
          lte(apiMetrics.createdAt, endOfDay),
          sql`error_message IS NOT NULL`
        )
      );

    // Get average latency
    const latencyStats = await db
      .select({ avgLatency: avg(apiMetrics.latencyMs) })
      .from(apiMetrics)
      .where(
        and(
          gte(apiMetrics.createdAt, startOfDay),
          lte(apiMetrics.createdAt, endOfDay)
        )
      );

    // Calculate cache hit rate
    const totalWallets = Number(lookupStats[0]?.totalWallets ?? 0);
    const cacheHits = Number(lookupStats[0]?.cacheHits ?? 0);
    const cacheHitRate =
      totalWallets > 0 ? (cacheHits / totalWallets) * 100 : 0;

    // Upsert daily stats
    await db
      .insert(dailyStats)
      .values({
        date: dateStr,
        totalLookups: lookupStats[0]?.totalLookups ?? 0,
        totalWalletsProcessed: totalWallets,
        uniqueUsers: Number(lookupStats[0]?.uniqueUsers ?? 0),
        newUsers: newUserStats[0]?.count ?? 0,
        revenueCents,
        proPurchases,
        unlimitedPurchases,
        avgMatchRate: String(lookupStats[0]?.avgMatchRate ?? 0),
        cacheHitRate: String(cacheHitRate.toFixed(2)),
        avgLatencyMs: Math.round(Number(latencyStats[0]?.avgLatency ?? 0)),
        errorCount: errorStats[0]?.count ?? 0,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: dailyStats.date,
        set: {
          totalLookups: sql`EXCLUDED.total_lookups`,
          totalWalletsProcessed: sql`EXCLUDED.total_wallets_processed`,
          uniqueUsers: sql`EXCLUDED.unique_users`,
          newUsers: sql`EXCLUDED.new_users`,
          revenueCents: sql`EXCLUDED.revenue_cents`,
          proPurchases: sql`EXCLUDED.pro_purchases`,
          unlimitedPurchases: sql`EXCLUDED.unlimited_purchases`,
          avgMatchRate: sql`EXCLUDED.avg_match_rate`,
          cacheHitRate: sql`EXCLUDED.cache_hit_rate`,
          avgLatencyMs: sql`EXCLUDED.avg_latency_ms`,
          errorCount: sql`EXCLUDED.error_count`,
          computedAt: sql`EXCLUDED.computed_at`,
        },
      });
  } catch (error) {
    console.error('Daily stats aggregation error:', error);
  }
}

// Get daily stats for a date range (for sparklines)
export async function getDailyStatsRange(
  startDate: Date,
  endDate: Date
): Promise<
  Array<{
    date: string;
    totalLookups: number;
    totalWalletsProcessed: number;
    uniqueUsers: number;
    newUsers: number;
    revenueCents: number;
    avgMatchRate: number;
    errorCount: number;
  }>
> {
  const db = getDb();
  if (!db) return [];

  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  try {
    const stats = await db
      .select()
      .from(dailyStats)
      .where(and(gte(dailyStats.date, startStr), lte(dailyStats.date, endStr)))
      .orderBy(dailyStats.date);

    return stats.map((s) => ({
      date: s.date,
      totalLookups: s.totalLookups,
      totalWalletsProcessed: s.totalWalletsProcessed,
      uniqueUsers: s.uniqueUsers,
      newUsers: s.newUsers,
      revenueCents: s.revenueCents,
      avgMatchRate: Number(s.avgMatchRate ?? 0),
      errorCount: s.errorCount,
    }));
  } catch (error) {
    console.error('Daily stats range error:', error);
    return [];
  }
}

// Get user funnel metrics
export async function getUserFunnel(
  startDate: Date,
  endDate: Date
): Promise<{
  pageViews: number;
  csvUploads: number;
  lookupsStarted: number;
  lookupsCompleted: number;
  exportsClicked: number;
  historySaved: number;
  /**
   * Accounts created in the window. Fired from `getOrCreateUser` since
   * 2026-08-26; every window before that reads 0 because nothing emitted it,
   * not because nobody signed up.
   */
  usersRegistered: number;
  upgradeModalViewed: number;
  checkoutStarted: number;
  /** Reached Stripe: the redirect fired. Tracked since 2026-08-15. */
  checkoutRedirected: number;
  checkoutFailed: number;
  /** Top checkout failure reasons in the window, most frequent first. */
  checkoutFailureReasons: Array<{ reason: string; count: number }>;
  paymentCompleted: number;
  /**
   * Payments split by the rail that took the money.
   *
   * The onchain rail does not pass through the buy-credits modal or a Stripe
   * redirect: `/api/x402/buy` grants the pack directly. So every x402 sale
   * lands on the last step of the funnel having skipped the three above it, and
   * without this split the steps look broken rather than bypassed. Legacy tier
   * sales carry no `rail` at all and appear as `(unknown)`.
   */
  paymentsByRail: Array<{ rail: string; count: number }>;
  /*
   * `sessions` and `engagedSessions` were here, computed by a second grouping
   * of the whole event table on every call. `getSessionFunnel` computes both
   * from the grouping it was already doing, so this one ran the same query for
   * the same two numbers and nothing read them once the panes were merged. Two
   * definitions of "engaged" in one file is the thing this change exists to
   * remove.
   */
  /**
   * False when the query failed and every number below is a zero this function
   * invented rather than measured.
   *
   * The catch returns a fully-populated object of zeros, which renders as a
   * real answer: a quiet week and a broken query look identical on the panel.
   * That was not hypothetical. A `db.execute` result read as an array instead
   * of `{ rows }` threw, and the funnel reported 0 page views, 0 lookups and 0
   * payments while the database held 1,487 sessions.
   */
  ok: boolean;
}> {
  const empty = {
    ok: false,
    pageViews: 0,
    csvUploads: 0,
    lookupsStarted: 0,
    lookupsCompleted: 0,
    exportsClicked: 0,
    historySaved: 0,
    usersRegistered: 0,
    upgradeModalViewed: 0,
    checkoutStarted: 0,
    checkoutRedirected: 0,
    checkoutFailed: 0,
    checkoutFailureReasons: [],
    paymentCompleted: 0,
    paymentsByRail: [],
  };
  const db = getDb();
  if (!db) return empty;

  try {
    const result = await db
      .select({
        eventType: analyticsEvents.eventType,
        count: count(),
      })
      .from(analyticsEvents)
      .where(
        and(
          gte(analyticsEvents.createdAt, startDate),
          lte(analyticsEvents.createdAt, endDate),
          NOT_A_HEARTBEAT
        )
      )
      .groupBy(analyticsEvents.eventType);

    const counts = new Map(result.map((r) => [r.eventType, r.count]));

    // checkout_failed carries its reason; the whole point of the event is to
    // explain the started-to-completed gap, so the reasons ride along.
    const reasons = (await db
      .select({
        reason: sql<string>`coalesce(${analyticsEvents.metadata}->>'reason', '(none)')`,
        count: count(),
      })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventType, 'checkout_failed'),
          gte(analyticsEvents.createdAt, startDate),
          lte(analyticsEvents.createdAt, endDate)
        )
      )
      .groupBy(sql`1`)
      .orderBy(desc(count()))
      .limit(5)) as Array<{ reason: string; count: number }>;

    const paymentsByRail = (await db
      .select({
        rail: sql<string>`coalesce(${analyticsEvents.metadata}->>'rail', '(unknown)')`,
        count: count(),
      })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventType, 'payment_completed'),
          gte(analyticsEvents.createdAt, startDate),
          lte(analyticsEvents.createdAt, endDate)
        )
      )
      .groupBy(sql`1`)
      .orderBy(desc(count()))) as Array<{ rail: string; count: number }>;

    // The session and engaged-session counts used to be a third query here,
    // grouping the whole event table again for two numbers `getSessionFunnel`
    // already produces from the grouping it has to do anyway.

    return {
      ok: true,
      pageViews: counts.get('page_view') ?? 0,
      csvUploads: counts.get('csv_upload') ?? 0,
      lookupsStarted: counts.get('lookup_started') ?? 0,
      lookupsCompleted: counts.get('lookup_completed') ?? 0,
      exportsClicked: counts.get('export_clicked') ?? 0,
      historySaved: counts.get('history_saved') ?? 0,
      usersRegistered: counts.get('user_registered') ?? 0,
      upgradeModalViewed: counts.get('upgrade_modal_viewed') ?? 0,
      checkoutStarted: counts.get('checkout_started') ?? 0,
      checkoutRedirected: counts.get('checkout_redirected') ?? 0,
      checkoutFailed: counts.get('checkout_failed') ?? 0,
      checkoutFailureReasons: reasons,
      paymentCompleted: counts.get('payment_completed') ?? 0,
      paymentsByRail,
    };
  } catch (error) {
    console.error('User funnel error:', error);
    return empty;
  }
}

/**
 * The two conversion rates, named, because "conversion rate" alone named three.
 *
 * Until this existed the panel showed three different numbers under one word:
 * the Pulse tile divided payments by lookups started over 7 days, the Revenue
 * pane divided payments by pricing views over 30 days, and the Behavior funnel
 * divided every step by page views over 7. The Pulse tile linked to the Revenue
 * pane, so the one journey a reader was invited to take moved between two
 * definitions without saying so.
 *
 * Two rates, and both are worth having. `lookupToPaid` is the business rate: of
 * everyone who used the product, how many paid. `pricingToPaid` is the checkout
 * rate: of everyone who was actually asked, how many did. A change in the first
 * with no change in the second is a top-of-funnel story, and the panel could
 * not previously tell those apart.
 *
 * `null`, never zero, when the denominator is zero. A rate that cannot be
 * computed has to say so: the same rule the funnel already applies to page
 * views, for the same reason.
 */
export function conversionRates(funnel: {
  paymentCompleted: number;
  upgradeModalViewed: number;
  lookupsStarted: number;
}): { pricingToPaid: number | null; lookupToPaid: number | null } {
  return {
    pricingToPaid:
      funnel.upgradeModalViewed > 0
        ? (funnel.paymentCompleted / funnel.upgradeModalViewed) * 100
        : null,
    lookupToPaid:
      funnel.lookupsStarted > 0
        ? (funnel.paymentCompleted / funnel.lookupsStarted) * 100
        : null,
  };
}

/**
 * One session that reached each step, rather than one count per event type.
 *
 * `getUserFunnel` above counts events: `COUNT(*) GROUP BY event_type` over the
 * window. That answers "how many times did this happen", which is not what a
 * funnel is for and cannot answer "what share of visitors got this far": one
 * person who opened the pricing modal six times is six, and the steps are free
 * to rise as you read downwards. This counts distinct sessions instead, so
 * every step is a number of people and a ratio between two steps means
 * something.
 *
 * Both are kept. The event counts are the honest answer to "how much did this
 * happen", which the paywall work needs; this is the honest answer to "how many
 * got through", which the event counts cannot give.
 *
 * ## Where the sessions come from
 *
 * `analytics_events.session_id` is written by the browser for client events and
 * carried into the server-side lookup events through `lookup_jobs.session_id`,
 * so a visit and the lookup it ran are the same session id. Two events are not:
 *
 * - `payment_completed` fires from the Stripe webhook, which has no browser and
 *   no session. It is joined back by `user_id`, which both sides set to the
 *   account email. That works only for a session that was signed in, so `paid`
 *   is a floor.
 * - `user_registered` fires on the magic-link callback, which is frequently a
 *   different browser from the one that asked for the link. It is reported
 *   beside the funnel rather than inside it for that reason.
 */
export interface SessionFunnel {
  /** False when the query failed and every count below is an invented zero. */
  ok: boolean;
  /** Every distinct browser session in the window, automated ones included. */
  sessions: number;
  /**
   * Sessions that did more than arrive once: two events of any kind, or one
   * event that is not a pageview.
   *
   * Reported beside `sessions` rather than replacing it, because the gap
   * between the two is itself the finding. On 24 and 25 August a QR auction
   * sent 1,321 sessions at the site and 1,220 of them recorded a single event
   * and never came back within the same second: no second pageview, no scroll
   * into anything measured, nothing. Dividing conversions by that number says
   * the product converts at a fifteenth of its real rate, and dividing by this
   * one silently discards traffic somebody paid for. Both numbers, always.
   *
   * Deliberately not a bot verdict. It says what a session did, which is
   * checkable, rather than what it was, which is not: a crawler that fetches
   * two pages counts as engaged and a real person who read the homepage and
   * closed the tab does not. A floor on genuine interest, not a headcount.
   */
  engaged: number;
  ranLookup: number;
  gotResults: number;
  hitWall: number;
  sawPricing: number;
  startedCheckout: number;
  reachedStripe: number;
  paid: number;
  /** Sessions with no `user_id` on any event: nobody we can join to an account. */
  anonymous: number;
}

export async function getSessionFunnel(
  startDate: Date,
  endDate: Date
): Promise<SessionFunnel> {
  const empty: SessionFunnel = {
    ok: false,
    sessions: 0,
    engaged: 0,
    ranLookup: 0,
    gotResults: 0,
    hitWall: 0,
    sawPricing: 0,
    startedCheckout: 0,
    reachedStripe: 0,
    paid: 0,
    anonymous: 0,
  };
  const db = getDb();
  if (!db) return empty;

  try {
    /**
     * The money tail is forced monotone; the top of the funnel is not.
     *
     * `components/UpgradeModal.tsx` is the only surface that starts a Stripe
     * checkout, so a session that started one did see the pricing, whether or
     * not its `upgrade_modal_viewed` reached us. OR-ing each step with the ones
     * below it states that, and stops a lost beacon from drawing a funnel that
     * widens at the bottom.
     *
     * The same trick would be a lie further up. Pricing is reachable from the
     * marketing pages without running anything, so a session can see it having
     * never run a lookup, and crediting it with one would invent usage. Those
     * steps are reported as measured, which means `sawPricing` may legitimately
     * exceed `gotResults`.
     *
     * The onchain rail is the known exception: `/api/x402/buy` grants a pack
     * with no modal and no Stripe redirect, so an x402 buyer lands in `paid`
     * having genuinely skipped the three steps above it.
     */
    const result = (await db.execute(sql`
      WITH s AS (
        SELECT
          session_id,
          count(*) AS events,
          count(*) FILTER (WHERE event_type <> 'page_view') AS non_page_views,
          max(user_id) AS user_id,
          bool_or(event_type = 'lookup_started') AS ran_lookup,
          bool_or(
            event_type = 'lookup_completed'
            AND metadata->>'eventSubtype' IS NULL
          ) AS got_results,
          bool_or(event_type = 'limit_hit') AS hit_wall,
          bool_or(event_type = 'upgrade_modal_viewed') AS saw_pricing,
          bool_or(event_type = 'checkout_started') AS started_checkout,
          bool_or(event_type = 'checkout_redirected') AS reached_stripe
        FROM analytics_events
        WHERE session_id IS NOT NULL
          AND created_at >= ${utcBound(startDate)}::timestamp
          AND created_at <= ${utcBound(endDate)}::timestamp
        GROUP BY session_id
      ),
      paid_users AS (
        SELECT DISTINCT user_id
        FROM analytics_events
        WHERE event_type = 'payment_completed'
          AND user_id IS NOT NULL
          AND created_at >= ${utcBound(startDate)}::timestamp
          AND created_at <= ${utcBound(endDate)}::timestamp
      ),
      f AS (
        SELECT
          s.*,
          -- Intent AND outcome, not outcome alone.
          --
          -- A payment carries no session, so the only join is the account
          -- email, and "every session belonging to somebody who paid this
          -- month" is not a conversion: measured on 2026-08-26 that read 20
          -- paid sessions against a single payment event, because one buyer
          -- had visited twenty times. Requiring the session to have reached
          -- checkout as well makes the bottom step mean what the step above it
          -- means, at the cost of missing a buyer whose checkout events were
          -- all lost. started_checkout is in the test alongside reached_stripe
          -- so a dropped redirect beacon does not lose a real sale.
          --
          -- An onchain sale has neither event and is never counted here. The
          -- rail split on the event funnel is where those are visible.
          (
            s.user_id IS NOT NULL
            AND p.user_id IS NOT NULL
            AND (s.started_checkout OR s.reached_stripe)
          ) AS paid
        FROM s LEFT JOIN paid_users p ON p.user_id = s.user_id
      )
      -- Every alias is double-quoted. Postgres folds an unquoted identifier to
      -- lower case, so AS ranLookup comes back as ranlookup and AS ran_lookup
      -- as ran_lookup: either way the property the interface promises is
      -- undefined at the call site, with no type error, because the row is
      -- cast rather than checked. The first version of this query was written
      -- unquoted and six steps of the pane would have rendered blank.
      SELECT
        count(*)::int AS "sessions",
        count(*) FILTER (WHERE events > 1 OR non_page_views > 0)::int AS "engaged",
        count(*) FILTER (WHERE ran_lookup)::int AS "ranLookup",
        count(*) FILTER (WHERE got_results)::int AS "gotResults",
        count(*) FILTER (WHERE hit_wall)::int AS "hitWall",
        count(*) FILTER (
          WHERE saw_pricing OR started_checkout OR reached_stripe
        )::int AS "sawPricing",
        count(*) FILTER (
          WHERE started_checkout OR reached_stripe
        )::int AS "startedCheckout",
        count(*) FILTER (WHERE reached_stripe OR paid)::int AS "reachedStripe",
        count(*) FILTER (WHERE paid)::int AS "paid",
        count(*) FILTER (WHERE user_id IS NULL)::int AS "anonymous"
      FROM f
    `)) as unknown as {
      rows: Array<Omit<SessionFunnel, 'ok'>>;
    };

    const row = result.rows?.[0];
    if (!row) return empty;
    return { ok: true, ...row };
  } catch (error) {
    console.error('Session funnel error:', error);
    return empty;
  }
}

/**
 * The gates, and what happened at each one.
 *
 * Every event here was already being written and read by nothing. Four of them
 * are the only record of a person meeting a limit, which is the moment the
 * product asks to be paid for, so the panel that exists to explain conversion
 * had no view of the thing it is explaining.
 *
 * `reverse_lookup.locked` is the sharpest of them: the endpoint answers a count
 * for free and withholds the wallets, and the field says which half the caller
 * got. Nothing has ever asked what share of callers the free half satisfies.
 */
export interface GateMetrics {
  ok: boolean;
  /** Reverse lookups answered in full. */
  reverseUnlocked: number;
  /** Reverse lookups that returned a count and withheld the wallets. */
  reverseLocked: number;
  /** Distinct sessions that met the locked half at least once. */
  reverseLockedSessions: number;
  /** Free-allowance refusals, and the people who met one. */
  limitHits: number;
  limitHitSessions: number;
  contractImportBlocked: number;
  contractImportSuccess: number;
}

export async function getGateMetrics(
  startDate: Date,
  endDate: Date
): Promise<GateMetrics> {
  const empty: GateMetrics = {
    ok: false,
    reverseUnlocked: 0,
    reverseLocked: 0,
    reverseLockedSessions: 0,
    limitHits: 0,
    limitHitSessions: 0,
    contractImportBlocked: 0,
    contractImportSuccess: 0,
  };
  const db = getDb();
  if (!db) return empty;

  try {
    const result = (await db.execute(sql`
      SELECT
        count(*) FILTER (
          WHERE event_type = 'reverse_lookup' AND metadata->>'locked' = 'false'
        )::int AS "reverseUnlocked",
        count(*) FILTER (
          WHERE event_type = 'reverse_lookup' AND metadata->>'locked' = 'true'
        )::int AS "reverseLocked",
        count(DISTINCT session_id) FILTER (
          WHERE event_type = 'reverse_lookup' AND metadata->>'locked' = 'true'
        )::int AS "reverseLockedSessions",
        count(*) FILTER (WHERE event_type = 'limit_hit')::int AS "limitHits",
        count(DISTINCT session_id) FILTER (
          WHERE event_type = 'limit_hit'
        )::int AS "limitHitSessions",
        count(*) FILTER (
          WHERE event_type = 'contract_import_blocked'
        )::int AS "contractImportBlocked",
        count(*) FILTER (
          WHERE event_type = 'contract_import_success'
        )::int AS "contractImportSuccess"
      FROM analytics_events
      WHERE created_at >= ${utcBound(startDate)}::timestamp AND created_at <= ${utcBound(endDate)}::timestamp
    `)) as unknown as { rows: Array<Omit<GateMetrics, 'ok'>> };

    const row = result.rows?.[0];
    if (!row) return empty;
    return { ok: true, ...row };
  } catch (error) {
    console.error('Gate metrics error:', error);
    return empty;
  }
}

/**
 * Buy-credits modal opens by the gate that opened them, and whether the
 * session went on to a checkout.
 *
 * The trigger name has been written since the modal existed ('limit' and
 * 'feature' before 2026-08-22, per-gate names after). The first reader of it
 * reported bare open counts with a note to "join against checkouts by hand
 * once volume justifies it"; this is that join, done here so nobody has to.
 *
 * The bottom step is a checkout, deliberately not a payment. The payment
 * lands from the Stripe webhook with no session, so a per-gate "paid" could
 * only be built on the email join the session funnel documents as a floor,
 * and a floor divided by a per-gate count would read as a per-gate rate it is
 * not. `checkout_started` OR `checkout_redirected`, same as the session
 * funnel's money tail, so a dropped redirect beacon does not lose the intent.
 *
 * A session that opened the modal through two gates and checked out once
 * credits both gates: the join is co-occurrence in the session, not a click
 * path, and splitting the credit would be inventing an attribution model.
 */
export interface GateConversion {
  /** False when the query failed and the empty table below is not a quiet week. */
  ok: boolean;
  gates: Array<{
    trigger: string;
    /** Modal opens through this gate, one person six times is six. */
    opens: number;
    /** Distinct sessions that met this gate. Opens with no session id count above only. */
    sessions: number;
    /** Of those sessions, how many reached a checkout in the window. */
    checkoutSessions: number;
  }>;
}

export async function getGateConversion(
  startDate: Date,
  endDate: Date
): Promise<GateConversion> {
  const empty: GateConversion = { ok: false, gates: [] };
  const db = getDb();
  if (!db) return empty;
  try {
    const result = (await db.execute(sql`
      WITH opens AS (
        SELECT metadata->>'trigger' AS trig, session_id
        FROM analytics_events
        WHERE event_type = 'upgrade_modal_viewed'
          AND created_at >= ${utcBound(startDate)}::timestamp
          AND created_at <= ${utcBound(endDate)}::timestamp
      ),
      checkouts AS (
        SELECT DISTINCT session_id
        FROM analytics_events
        WHERE event_type IN ('checkout_started', 'checkout_redirected')
          AND session_id IS NOT NULL
          AND created_at >= ${utcBound(startDate)}::timestamp
          AND created_at <= ${utcBound(endDate)}::timestamp
      )
      SELECT
        coalesce(o.trig, '(none)') AS "trigger",
        count(*)::int AS "opens",
        count(DISTINCT o.session_id)::int AS "sessions",
        count(DISTINCT o.session_id) FILTER (
          WHERE c.session_id IS NOT NULL
        )::int AS "checkoutSessions"
      FROM opens o
      LEFT JOIN checkouts c ON c.session_id = o.session_id
      GROUP BY 1
      ORDER BY count(*) DESC
    `)) as unknown as { rows: GateConversion['gates'] };
    return { ok: true, gates: result.rows ?? [] };
  } catch (error) {
    console.error('Gate conversion error:', error);
    return empty;
  }
}

/**
 * Where sessions and accounts came from, by first touch.
 *
 * `page_view.metadata.origin` and `users.acquisition` have been written since
 * 2026-08-25 and read by nothing but a one-off campaign script: the exact
 * shape `getGateMetrics` complains about, data recorded to answer "did the
 * campaign work" with no query anybody can run. These two groupings are that
 * query.
 *
 * `(untagged)`, never `direct`, for a missing origin. `direct` is a measured
 * value (this browser arrived with no referrer and no tag); a session whose
 * first page view carries no origin at all predates the capture, or lost the
 * beacon, and folding it into `direct` would report the absence of a
 * measurement as the most common acquisition channel.
 *
 * The signup grouping excludes rows minted by the onchain rail
 * (`users.origin = 'x402'`): the schema documents those as not-signups, and
 * they carry no browser first touch to group by. `bought` is "has ever
 * purchased a pack, as of now", not "purchased inside the window": a cohort's
 * purchases trail its signups by days, and clipping them to the window would
 * make every recent cohort read as non-converting.
 */
export interface AcquisitionSources {
  /** False when a query failed and the empty tables below are invented. */
  ok: boolean;
  /** Sessions grouped by the origin on their first page view in the window. */
  sessions: Array<{
    source: string;
    sessions: number;
    ranLookup: number;
    sawPricing: number;
    startedCheckout: number;
  }>;
  /** Accounts created in the window, by the first touch stored at signup. */
  signups: Array<{
    source: string;
    signups: number;
    bought: number;
  }>;
}

export async function getAcquisitionSources(
  startDate: Date,
  endDate: Date
): Promise<AcquisitionSources> {
  const empty: AcquisitionSources = { ok: false, sessions: [], signups: [] };
  const db = getDb();
  if (!db) return empty;
  try {
    const sessionRows = (await db.execute(sql`
      WITH first_view AS (
        SELECT DISTINCT ON (session_id)
          session_id,
          coalesce(metadata->>'origin', '(untagged)') AS source
        FROM analytics_events
        WHERE event_type = 'page_view'
          AND session_id IS NOT NULL
          AND created_at >= ${utcBound(startDate)}::timestamp
          AND created_at <= ${utcBound(endDate)}::timestamp
        ORDER BY session_id, created_at
      ),
      s AS (
        SELECT
          session_id,
          bool_or(event_type = 'lookup_started') AS ran_lookup,
          -- Checkout events count as having seen pricing, the same forced
          -- monotone tail getSessionFunnel documents: the buy-credits modal
          -- is the only way into a checkout, so a session that started one
          -- did see the pricing whether or not that beacon reached us.
          -- Without this a row can read "started checkout 1, saw pricing 0",
          -- which the product cannot do.
          bool_or(
            event_type IN (
              'upgrade_modal_viewed',
              'checkout_started',
              'checkout_redirected'
            )
          ) AS saw_pricing,
          bool_or(
            event_type IN ('checkout_started', 'checkout_redirected')
          ) AS started_checkout
        FROM analytics_events
        WHERE session_id IS NOT NULL
          AND created_at >= ${utcBound(startDate)}::timestamp
          AND created_at <= ${utcBound(endDate)}::timestamp
        GROUP BY session_id
      )
      SELECT
        f.source AS "source",
        count(*)::int AS "sessions",
        count(*) FILTER (WHERE s.ran_lookup)::int AS "ranLookup",
        count(*) FILTER (WHERE s.saw_pricing)::int AS "sawPricing",
        count(*) FILTER (WHERE s.started_checkout)::int AS "startedCheckout"
      FROM first_view f
      JOIN s ON s.session_id = f.session_id
      GROUP BY f.source
      ORDER BY count(*) DESC
      LIMIT 20
    `)) as unknown as { rows: AcquisitionSources['sessions'] };

    const signupRows = (await db.execute(sql`
      SELECT
        coalesce(u.acquisition, '(untagged)') AS "source",
        count(*)::int AS "signups",
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM credit_lots l
            WHERE l.user_id = u.id AND l.amount_cents > 0
          )
        )::int AS "bought"
      FROM users u
      WHERE u.created_at >= ${utcBound(startDate)}::timestamp
        AND u.created_at <= ${utcBound(endDate)}::timestamp
        AND u.origin IS DISTINCT FROM 'x402'
      GROUP BY 1
      ORDER BY count(*) DESC
      LIMIT 20
    `)) as unknown as { rows: AcquisitionSources['signups'] };

    return {
      ok: true,
      sessions: sessionRows.rows ?? [],
      signups: signupRows.rows ?? [],
    };
  } catch (error) {
    console.error('Acquisition sources error:', error);
    return empty;
  }
}

/**
 * Packs bought in the window, from the settled record rather than the events.
 *
 * `credit_lots` is the one table both rails write: a Stripe webhook and an
 * x402 settlement each end as a lot. The Revenue pane reads Stripe alone, so
 * an onchain sale is visible there nowhere; any surface quoting this total
 * beside that pane must say the two differ and why, or the panel gains two
 * disagreeing revenue figures again.
 *
 * `amount_cents > 0` keeps hand-issued grants out: a grant is a lot and is
 * not a purchase, and counting it would inflate exactly the number this
 * exists to make honest.
 */
export interface Purchases {
  /** False when the query failed and the empty table below is invented. */
  ok: boolean;
  byPack: Array<{
    pack: string;
    rail: string;
    count: number;
    amountCents: number;
  }>;
}

export async function getPurchases(
  startDate: Date,
  endDate: Date
): Promise<Purchases> {
  const empty: Purchases = { ok: false, byPack: [] };
  const db = getDb();
  if (!db) return empty;
  try {
    const result = (await db.execute(sql`
      SELECT
        pack AS "pack",
        coalesce(rail, '(unknown)') AS "rail",
        count(*)::int AS "count",
        coalesce(sum(amount_cents), 0)::int AS "amountCents"
      FROM credit_lots
      WHERE amount_cents > 0
        AND created_at >= ${utcBound(startDate)}::timestamp
        AND created_at <= ${utcBound(endDate)}::timestamp
      GROUP BY 1, 2
      ORDER BY count(*) DESC, 4 DESC
    `)) as unknown as { rows: Purchases['byPack'] };
    return { ok: true, byPack: result.rows ?? [] };
  } catch (error) {
    console.error('Purchases error:', error);
    return empty;
  }
}

/**
 * The agent rail: API keys, what they called, and what the onchain rail sold.
 *
 * `api_usage` is written on every metered call and `getUsageByUser` was built
 * "for admin analytics" with zero callers; this is the first admin surface to
 * read the table. It is a rail beside the browser funnel, not a step of it:
 * an API call spends credits an account already bought, and an x402 sale
 * mints an account with no session, no modal and no checkout event, so
 * neither belongs inside either funnel above.
 *
 * The key counts are point-in-time, not windowed: "how many keys exist and
 * how many could call right now" is the standing question, and a key created
 * before the window is still the caller behind this week's requests.
 */
export interface AgentRail {
  /** False when the query failed and every count below is an invented zero. */
  ok: boolean;
  /** Keys ever created, OAuth access tokens included. */
  totalKeys: number;
  /** Keys that could authenticate a call right now. */
  activeKeys: number;
  /** Keys that are OAuth access tokens from agent connections. */
  oauthKeys: number;
  /** Distinct keys that made at least one call in the window. */
  callers: number;
  requests: number;
  creditsUsed: number;
  /** Onchain pack sales settled in the window, and what they charged. */
  onchainSales: number;
  onchainCents: number;
}

export async function getAgentRail(
  startDate: Date,
  endDate: Date
): Promise<AgentRail> {
  const empty: AgentRail = {
    ok: false,
    totalKeys: 0,
    activeKeys: 0,
    oauthKeys: 0,
    callers: 0,
    requests: 0,
    creditsUsed: 0,
    onchainSales: 0,
    onchainCents: 0,
  };
  const db = getDb();
  if (!db) return empty;
  try {
    const result = (await db.execute(sql`
      WITH keys AS (
        SELECT
          count(*)::int AS total_keys,
          -- The same three tests lib/api-keys.ts applies before honouring a
          -- key. The expiry test matters most for the OAuth tokens this stat
          -- exists to watch: every one of them carries expires_at, so without
          -- it each expired token would read as able to call forever.
          count(*) FILTER (
            WHERE is_active AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > ${utcBound(new Date())}::timestamp)
          )::int AS active_keys,
          count(*) FILTER (WHERE oauth_grant_id IS NOT NULL)::int AS oauth_keys
        FROM api_keys
      ),
      calls AS (
        SELECT
          count(DISTINCT api_key_id)::int AS callers,
          count(*)::int AS requests,
          coalesce(sum(credits_used), 0)::int AS credits_used
        FROM api_usage
        WHERE created_at >= ${utcBound(startDate)}::timestamp
          AND created_at <= ${utcBound(endDate)}::timestamp
      ),
      onchain AS (
        SELECT
          count(*)::int AS sales,
          coalesce(sum(amount_cents), 0)::int AS cents
        FROM credit_lots
        WHERE rail = 'x402'
          AND amount_cents > 0
          AND created_at >= ${utcBound(startDate)}::timestamp
          AND created_at <= ${utcBound(endDate)}::timestamp
      )
      SELECT
        keys.total_keys AS "totalKeys",
        keys.active_keys AS "activeKeys",
        keys.oauth_keys AS "oauthKeys",
        calls.callers AS "callers",
        calls.requests AS "requests",
        calls.credits_used AS "creditsUsed",
        onchain.sales AS "onchainSales",
        onchain.cents AS "onchainCents"
      FROM keys, calls, onchain
    `)) as unknown as { rows: Array<Omit<AgentRail, 'ok'>> };
    const row = result.rows?.[0];
    if (!row) return empty;
    return { ok: true, ...row };
  } catch (error) {
    console.error('Agent rail error:', error);
    return empty;
  }
}

/**
 * Cron heartbeats are not lookups.
 *
 * Nine scheduled routes report their health by writing a `lookup_completed`
 * row carrying `metadata.eventSubtype`, because there is no heartbeat event
 * type. Every product query that counts `lookup_completed` therefore counts
 * them as work a person did. At nine a day that was a rounding error nobody
 * noticed; `/api/cron/welcome-first` runs 288 times a day, which would have
 * made the machines the majority of our "lookups".
 *
 * The right fix is a heartbeat event type of its own. Until then this is the
 * one predicate that separates them, applied everywhere the count is read.
 */
const NOT_A_HEARTBEAT = sql`${analyticsEvents.metadata}->>'eventSubtype' IS NULL`;

/*
 * There was an in-memory counterpart here, `isHeartbeat`, for the one query
 * that fetched rows and filtered them in Node. That query is now aggregated in
 * Postgres like every other, so the predicate above is the only definition of
 * a heartbeat and cannot drift from a second one.
 */

/**
 * Lifecycle email state: sends by email key, and the opt-out count.
 *
 * lifecycle_emails and users.email_opt_out were written by the campaign
 * plumbing and readable only through ad-hoc SQL; the admin surface is where
 * "did the send go out, and who opted out" belongs.
 *
 * Counts `confirmed_at IS NOT NULL`, because a row stopped meaning delivery
 * when claimAndSend began taking it before the send. An unfiltered count
 * reports an in-flight claim, and an abandoned one waiting on the reclaim, as
 * mail that went out: the pane would answer "did the send go out" with yes on
 * exactly the runs where it had not. `sent_at` is the claim time and stays the
 * ordering key, since a confirm follows its claim within a second.
 */
export async function getEmailStatus(): Promise<{
  sends: Array<{ emailKey: string; count: number; lastSentAt: Date | null }>;
  optOuts: number;
}> {
  const db = getDb();
  if (!db) return { sends: [], optOuts: 0 };
  try {
    const sends = (await db.execute(sql`
      SELECT email_key AS "emailKey", count(*)::int AS count,
             max(confirmed_at) AS "lastSentAt"
      FROM lifecycle_emails
      WHERE confirmed_at IS NOT NULL
      GROUP BY 1 ORDER BY max(confirmed_at) DESC
    `)) as unknown as {
      rows: Array<{ emailKey: string; count: number; lastSentAt: Date | null }>;
    };
    const optOuts = (await db.execute(
      sql`SELECT count(*)::int AS n FROM users WHERE email_opt_out = true`
    )) as unknown as { rows: Array<{ n: number }> };
    return { sends: sends.rows, optOuts: optOuts.rows[0]?.n ?? 0 };
  } catch (error) {
    console.error('Email status error:', error);
    return { sends: [], optOuts: 0 };
  }
}

// Get user behavior cohorts
export async function getUserCohorts(): Promise<
  Array<{
    name: string;
    definition: string;
    count: number;
    /**
     * `null` where the average is not a measurement this query can make: an
     * empty cohort, or one assembled from a table that carries no lookups.
     * Never 0, which the panel renders as a measured zero.
     */
    avgLookups: number | null;
    /** `null` where a conversion rate is not a meaningful thing to compute. */
    conversionRate: number | null;
  }>
> {
  const db = getDb();
  if (!db) return [];

  try {
    // Power Users: 5+ lookups with exports
    const powerUsers = await db
      .select({
        userId: analyticsEvents.userId,
        lookupCount: sql<number>`COUNT(CASE WHEN event_type = 'lookup_completed' THEN 1 END)`,
        hasExport: sql<number>`MAX(CASE WHEN event_type = 'export_clicked' THEN 1 ELSE 0 END)`,
        hasPaid: sql<number>`MAX(CASE WHEN event_type = 'payment_completed' THEN 1 ELSE 0 END)`,
        // The cohort below has always been *labelled* "hit limit" and has never
        // tested for one. `limit_hit` has been written since the free window
        // existed and read by nothing, so the fix was to ask the column that
        // was already there rather than to soften the label.
        hasLimitHit: sql<number>`MAX(CASE WHEN event_type = 'limit_hit' THEN 1 ELSE 0 END)`,
      })
      .from(analyticsEvents)
      .where(sql`user_id IS NOT NULL`)
      .groupBy(analyticsEvents.userId);

    let powerUserCount = 0;
    let powerUserLookups = 0;
    let powerUserPaid = 0;
    let tireKickerCount = 0;
    let tireKickerPaid = 0;
    let almostConvertedCount = 0;
    let almostConvertedLookups = 0;
    let hitTheWallCount = 0;
    let hitTheWallLookups = 0;

    for (const user of powerUsers) {
      const lookups = Number(user.lookupCount);
      const hasExport = Number(user.hasExport) > 0;
      const hasPaid = Number(user.hasPaid) > 0;
      const hasLimitHit = Number(user.hasLimitHit) > 0;

      // Counted outside the chain below on purpose. Meeting the paywall and
      // not buying is the single most actionable state an account can be in,
      // and the `else if` ladder would have hidden most of it behind whichever
      // earlier arm happened to match first.
      if (hasLimitHit && !hasPaid) {
        hitTheWallCount++;
        hitTheWallLookups += lookups;
      }

      if (lookups >= 5 && hasExport) {
        powerUserCount++;
        powerUserLookups += lookups;
        if (hasPaid) powerUserPaid++;
      } else if (lookups === 1 && !hasExport) {
        tireKickerCount++;
        if (hasPaid) tireKickerPaid++;
      } else if (lookups >= 3 && !hasPaid) {
        almostConvertedCount++;
        almostConvertedLookups += lookups;
      }
    }

    /**
     * Every average is summed, never asserted from the definition.
     *
     * Three of these rows used to state a constant in the average column, and
     * the column is labelled "Avg lookups" so the table rendered each of them
     * as a measurement. "Almost converted" is defined as `>= 3` and reported
     * exactly 3, which is a floor wearing a mean's label; "Hit the free wall"
     * reported 0 for accounts that by definition ran enough lookups to exhaust
     * an allowance (Bugbot, 2026-08-26); "Churned paid" reported 0 for accounts
     * this query never sees, because they come from a different table below.
     *
     * A cohort with no members has no average, and `null` says so. Zero is a
     * measurement, and it was the wrong one.
     */
    const mean = (total: number, n: number) => (n > 0 ? total / n : null);

    // Churned paid users (paid but no activity in 30 days). "Paid" is a legacy
    // tier or a bought lot; a pack never sets `tier`, so the tier test alone
    // would miss every pack buyer.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const churnedResult = await db
      .select({ count: count() })
      .from(users)
      .where(
        and(
          sql`(tier != 'free' OR EXISTS (
            SELECT 1 FROM credit_lots
            WHERE credit_lots.user_id = users.id
            AND credit_lots.amount_cents > 0
          ))`,
          sql`NOT EXISTS (
            SELECT 1 FROM analytics_events
            WHERE analytics_events.user_id = users.email
            AND analytics_events.created_at > ${thirtyDaysAgo}
          )`
        )
      );

    return [
      {
        name: 'Power users',
        definition: '5+ lookups, exports regularly',
        count: powerUserCount,
        avgLookups: mean(powerUserLookups, powerUserCount),
        conversionRate:
          powerUserCount > 0 ? (powerUserPaid / powerUserCount) * 100 : null,
      },
      {
        name: 'Tire kickers',
        definition: '1 lookup, no export',
        count: tireKickerCount,
        // The one constant that is not an assertion: this cohort is defined as
        // `lookups === 1`, so the mean of its members is 1 exactly. Still null
        // when there are no members, because the mean of nothing is not 1.
        avgLookups: tireKickerCount > 0 ? 1 : null,
        conversionRate:
          tireKickerCount > 0 ? (tireKickerPaid / tireKickerCount) * 100 : null,
      },
      {
        name: 'Almost converted',
        // What the code tests, which is not what this row claimed for months.
        // The limit is now its own cohort below, where it can be counted
        // honestly instead of asserted in a caption.
        definition: '3+ lookups, never paid',
        count: almostConvertedCount,
        avgLookups: mean(almostConvertedLookups, almostConvertedCount),
        conversionRate: null,
      },
      {
        name: 'Hit the free wall',
        definition: 'Refused by the free allowance, never paid',
        count: hitTheWallCount,
        avgLookups: mean(hitTheWallLookups, hitTheWallCount),
        conversionRate: null,
      },
      {
        name: 'Churned paid',
        definition: 'Paid but no activity in 30d',
        count: churnedResult[0]?.count ?? 0,
        // Counted from `users` by the query above, which carries no event
        // history, so this cohort's lookup count is not merely zero: it is not
        // known here at all.
        avgLookups: null,
        // Was 100, which rendered as a 100% conversion rate and read as the
        // best-performing cohort on the panel. Everyone here has paid by
        // definition, so the column has nothing to say about them.
        conversionRate: null,
      },
    ];
  } catch (error) {
    console.error('User cohorts error:', error);
    return [];
  }
}

// Get retention cohorts (week over week)
export async function getRetentionCohorts(
  weeks: number = 4
): Promise<Array<{ cohortWeek: string; retention: number[] }>> {
  const db = getDb();
  if (!db) return [];

  try {
    const results: Array<{ cohortWeek: string; retention: number[] }> = [];
    const now = new Date();

    for (let w = weeks - 1; w >= 0; w--) {
      const cohortStart = new Date(now);
      cohortStart.setDate(cohortStart.getDate() - (w + 1) * 7);
      cohortStart.setHours(0, 0, 0, 0);

      const cohortEnd = new Date(cohortStart);
      cohortEnd.setDate(cohortEnd.getDate() + 7);

      const cohortWeek = cohortStart.toISOString().split('T')[0];

      // Get users who first appeared in this cohort week
      const cohortUsers = await db
        .select({ userId: analyticsEvents.userId })
        .from(analyticsEvents)
        .where(
          and(
            sql`user_id IS NOT NULL`,
            gte(analyticsEvents.createdAt, cohortStart),
            lte(analyticsEvents.createdAt, cohortEnd)
          )
        )
        .groupBy(analyticsEvents.userId);

      const userIds = cohortUsers.map((u) => u.userId).filter(Boolean);
      if (userIds.length === 0) {
        results.push({ cohortWeek, retention: [100] });
        continue;
      }

      const retention: number[] = [100]; // Week 0 is always 100%

      // Check subsequent weeks
      for (let followUp = 1; followUp <= weeks - w - 1; followUp++) {
        const weekStart = new Date(cohortEnd);
        weekStart.setDate(weekStart.getDate() + (followUp - 1) * 7);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const activeInWeek = await db
          .select({ count: sql<number>`COUNT(DISTINCT user_id)` })
          .from(analyticsEvents)
          .where(
            and(
              sql`user_id = ANY(${userIds})`,
              gte(analyticsEvents.createdAt, weekStart),
              lte(analyticsEvents.createdAt, weekEnd)
            )
          );

        const retainedCount = Number(activeInWeek[0]?.count ?? 0);
        retention.push(Math.round((retainedCount / userIds.length) * 100));
      }

      results.push({ cohortWeek, retention });
    }

    return results;
  } catch (error) {
    console.error('Retention cohorts error:', error);
    return [];
  }
}

// Get queue depth (pending/processing jobs)
export async function getQueueDepth(): Promise<{
  pending: number;
  processing: number;
}> {
  const db = getDb();
  if (!db) return { pending: 0, processing: 0 };

  try {
    const result = await db
      .select({
        status: lookupJobs.status,
        count: count(),
      })
      .from(lookupJobs)
      .where(sql`status IN ('pending', 'processing')`)
      .groupBy(lookupJobs.status);

    const counts = new Map(result.map((r) => [r.status, r.count]));

    return {
      pending: counts.get('pending') ?? 0,
      processing: counts.get('processing') ?? 0,
    };
  } catch (error) {
    console.error('Queue depth error:', error);
    return { pending: 0, processing: 0 };
  }
}

// Get recent errors for error log
export async function getRecentErrors(limit: number = 50): Promise<
  Array<{
    id: string;
    provider: string;
    errorMessage: string;
    jobId: string | null;
    createdAt: Date;
  }>
> {
  const db = getDb();
  if (!db) return [];

  try {
    const errors = await db
      .select({
        id: apiMetrics.id,
        provider: apiMetrics.provider,
        errorMessage: apiMetrics.errorMessage,
        jobId: apiMetrics.jobId,
        createdAt: apiMetrics.createdAt,
      })
      .from(apiMetrics)
      .where(sql`error_message IS NOT NULL`)
      .orderBy(desc(apiMetrics.createdAt))
      .limit(limit);

    return errors.map((e) => ({
      id: e.id,
      provider: e.provider,
      errorMessage: e.errorMessage ?? '',
      jobId: e.jobId,
      createdAt: e.createdAt,
    }));
  } catch (error) {
    console.error('Recent errors error:', error);
    return [];
  }
}

// Calculate executive pulse metrics
export async function getExecutivePulse(): Promise<{
  lookupsToday: number;
  lookupsTrend: number[];
  activeUsers7d: number;
  activeUsersTrend: 'up' | 'down' | 'flat';
  /**
   * Payments over pricing views, 7 days, `null` when nobody saw pricing.
   *
   * Named rather than called "conversion rate", and the same definition the
   * funnel and the revenue pane use. See `conversionRates`.
   */
  pricingToPaid: number | null;
  revenueMTD: number;
  revenueVsLastMonth: number;
  errorRate: number;
  errorStatus: 'green' | 'yellow' | 'red';
  queueDepth: number;
}> {
  const db = getDb();
  if (!db)
    return {
      lookupsToday: 0,
      lookupsTrend: [],
      activeUsers7d: 0,
      activeUsersTrend: 'flat',
      pricingToPaid: null,
      revenueMTD: 0,
      revenueVsLastMonth: 0,
      errorRate: 0,
      errorStatus: 'green',
      queueDepth: 0,
    };

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Lookups today
    const todayLookups = await db
      .select({ count: count() })
      .from(lookupJobs)
      .where(
        and(
          eq(lookupJobs.status, 'completed'),
          gte(lookupJobs.completedAt, todayStart)
        )
      );

    // 7-day trend
    const weeklyStats = await getDailyStatsRange(sevenDaysAgo, now);
    const lookupsTrend = weeklyStats.map((s) => s.totalLookups);

    // Active users (7d)
    const activeUsers7d = await getActiveUsers(sevenDaysAgo, now);
    const activeUsersPrev7d = await getActiveUsers(
      fourteenDaysAgo,
      sevenDaysAgo
    );
    const activeUsersTrend: 'up' | 'down' | 'flat' =
      activeUsers7d > activeUsersPrev7d
        ? 'up'
        : activeUsers7d < activeUsersPrev7d
          ? 'down'
          : 'flat';

    // Conversion (this week), through the one shared definition.
    const funnel = await getUserFunnel(sevenDaysAgo, now);
    const { pricingToPaid } = conversionRates(funnel);

    // Revenue MTD
    const mtdStats = await getDailyStatsRange(monthStart, now);
    const revenueMTD =
      mtdStats.reduce((sum, s) => sum + s.revenueCents, 0) / 100;

    // Revenue vs last month
    const lastMonthStats = await getDailyStatsRange(
      lastMonthStart,
      lastMonthEnd
    );
    const lastMonthRevenue =
      lastMonthStats.reduce((sum, s) => sum + s.revenueCents, 0) / 100;
    const revenueVsLastMonth =
      lastMonthRevenue > 0
        ? ((revenueMTD - lastMonthRevenue) / lastMonthRevenue) * 100
        : 0;

    // Error rate (24h)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const allApiCalls = await db
      .select({ count: count() })
      .from(apiMetrics)
      .where(gte(apiMetrics.createdAt, twentyFourHoursAgo));

    const errorApiCalls = await db
      .select({ count: count() })
      .from(apiMetrics)
      .where(
        and(
          gte(apiMetrics.createdAt, twentyFourHoursAgo),
          sql`error_message IS NOT NULL`
        )
      );

    const totalCalls = allApiCalls[0]?.count ?? 0;
    const errorCalls = errorApiCalls[0]?.count ?? 0;
    const errorRate = totalCalls > 0 ? (errorCalls / totalCalls) * 100 : 0;
    const errorStatus: 'green' | 'yellow' | 'red' =
      errorRate < 1 ? 'green' : errorRate < 5 ? 'yellow' : 'red';

    // Queue depth
    const queue = await getQueueDepth();
    const queueDepth = queue.pending + queue.processing;

    return {
      lookupsToday: todayLookups[0]?.count ?? 0,
      lookupsTrend,
      activeUsers7d,
      activeUsersTrend,
      pricingToPaid:
        pricingToPaid === null ? null : Math.round(pricingToPaid * 100) / 100,
      revenueMTD,
      revenueVsLastMonth: Math.round(revenueVsLastMonth),
      errorRate: Math.round(errorRate * 100) / 100,
      errorStatus,
      queueDepth,
    };
  } catch (error) {
    console.error('Executive pulse error:', error);
    return {
      lookupsToday: 0,
      lookupsTrend: [],
      activeUsers7d: 0,
      activeUsersTrend: 'flat',
      pricingToPaid: null,
      revenueMTD: 0,
      revenueVsLastMonth: 0,
      errorRate: 0,
      errorStatus: 'green',
      queueDepth: 0,
    };
  }
}

// Get feature adoption metrics
export async function getFeatureAdoption(
  startDate: Date,
  endDate: Date
): Promise<{
  ensLookupRate: number;
  historySaveRate: number;
  exportRate: number;
  exportFormats: { csv: number; twitter: number };
  avgLookupSize: { free: number; pro: number; unlimited: number };
}> {
  const db = getDb();
  if (!db)
    return {
      ensLookupRate: 0,
      historySaveRate: 0,
      exportRate: 0,
      exportFormats: { csv: 0, twitter: 0 },
      avgLookupSize: { free: 0, pro: 0, unlimited: 0 },
    };

  try {
    /**
     * Aggregated in Postgres, not in Node.
     *
     * This was `db.select().from(analyticsEvents)` over the whole window,
     * every column of every row, then eight passes of `Array.filter` over the
     * result. It is correct and it does not scale: the pane asks for 30 days,
     * the table already holds millions of rows across the product's history,
     * and the cost of a page load here grows with total traffic rather than
     * with the size of the answer, which is twelve numbers.
     *
     * The heartbeat predicate moves with it. It was applied to the two
     * `lookup_completed` filters and skipped on `export_clicked`, so the
     * denominator excluded cron rows and one numerator did not.
     */
    const result = (await db.execute(sql`
      SELECT
        count(*) FILTER (
          WHERE event_type = 'lookup_completed'
            AND metadata->>'eventSubtype' IS NULL
        )::int AS "totalLookups",
        count(*) FILTER (
          WHERE event_type = 'lookup_completed'
            AND metadata->>'eventSubtype' IS NULL
            AND metadata->>'includeENS' = 'true'
        )::int AS "ensLookups",
        count(*) FILTER (WHERE event_type = 'history_saved')::int AS "historySaves",
        count(*) FILTER (WHERE event_type = 'export_clicked')::int AS "exports",
        count(*) FILTER (
          WHERE event_type = 'export_clicked' AND metadata->>'format' = 'csv'
        )::int AS "csvExports",
        count(*) FILTER (
          WHERE event_type = 'export_clicked' AND metadata->>'format' = 'twitter'
        )::int AS "twitterExports",
        coalesce(avg((metadata->>'walletCount')::numeric) FILTER (
          WHERE event_type = 'lookup_started'
            AND coalesce(metadata->>'tier', 'free') = 'free'
        ), 0)::float AS "avgFree",
        coalesce(avg((metadata->>'walletCount')::numeric) FILTER (
          WHERE event_type = 'lookup_started' AND metadata->>'tier' = 'pro'
        ), 0)::float AS "avgPro",
        coalesce(avg((metadata->>'walletCount')::numeric) FILTER (
          WHERE event_type = 'lookup_started' AND metadata->>'tier' = 'unlimited'
        ), 0)::float AS "avgUnlimited"
      FROM analytics_events
      WHERE created_at >= ${utcBound(startDate)}::timestamp
        AND created_at <= ${utcBound(endDate)}::timestamp
        -- A lookup_started with no walletCount would make ::numeric throw and
        -- take the whole pane down with it, so the cast only sees digits.
        AND (
          event_type <> 'lookup_started'
          OR metadata->>'walletCount' ~ '^[0-9]+$'
        )
    `)) as unknown as {
      rows: Array<{
        totalLookups: number;
        ensLookups: number;
        historySaves: number;
        exports: number;
        csvExports: number;
        twitterExports: number;
        avgFree: number;
        avgPro: number;
        avgUnlimited: number;
      }>;
    };

    const row = result.rows?.[0];
    if (!row) {
      return {
        ensLookupRate: 0,
        historySaveRate: 0,
        exportRate: 0,
        exportFormats: { csv: 0, twitter: 0 },
        avgLookupSize: { free: 0, pro: 0, unlimited: 0 },
      };
    }

    const totalLookups = row.totalLookups;
    const rate = (n: number) =>
      totalLookups > 0 ? (n / totalLookups) * 100 : 0;

    return {
      ensLookupRate: rate(row.ensLookups),
      historySaveRate: rate(row.historySaves),
      exportRate: rate(row.exports),
      exportFormats: { csv: row.csvExports, twitter: row.twitterExports },
      avgLookupSize: {
        free: Math.round(row.avgFree),
        pro: Math.round(row.avgPro),
        unlimited: Math.round(row.avgUnlimited),
      },
    };
  } catch (error) {
    console.error('Feature adoption error:', error);
    return {
      ensLookupRate: 0,
      historySaveRate: 0,
      exportRate: 0,
      exportFormats: { csv: 0, twitter: 0 },
      avgLookupSize: { free: 0, pro: 0, unlimited: 0 },
    };
  }
}
