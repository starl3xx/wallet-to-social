/**
 * POST /v1/estimate: the dry run (docs/AGENT-SYSTEM.md, gap 19).
 *
 * Counts only, and free on the match meter: how many of these addresses are
 * in the index, how many were checked and found bare, how many we have never
 * seen, and the band a resolve of this list would bill inside. An agent can
 * plan a spend before spending, which was the missing half of "cost stated at
 * the decision point".
 *
 * Three decisions, recorded 2026-09-01:
 *
 * **Free, but weighed like the batch it previews.** `credits: 0` so a
 * zero-balance agent can plan (planning is the argument for buying again), and
 * `rateWeight` of one unit per wallet so the estimate spends exactly the rate
 * window the equivalent `/v1/batch` would. A free AND weightless count over
 * arbitrary lists would be an unmetered index scan; this way scanning through
 * estimates costs the same throughput as scanning through batches, with no
 * credits to show for it.
 *
 * **The list is capped at the plan's batch ceiling.** Same cap as `/v1/batch`,
 * so the estimate previews a call the caller could actually make, and the
 * per-wallet weight can never exceed a window the plan admits.
 *
 * **Minimum ten wallets.** Counts are the same disclosure class as the free
 * reverse count only while they stay aggregates; a one-wallet "count" is a
 * free per-wallet membership oracle. See ESTIMATE_MIN_WALLETS.
 *
 * No identities leave this endpoint. The response is integers and a note.
 */
import { NextRequest, NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { socialGraph } from '@/db/schema';
import {
  authenticateApiRequest,
  apiSuccess,
  apiError,
  isValidWalletAddress,
  normalizeWalletAddress,
  readBodyCapped,
} from '@/lib/api-auth';
import { trackApiUsage } from '@/lib/api-usage';
import {
  loadSuppressionList,
  isKindSuppressed,
  type SuppressionSets,
} from '@/lib/suppression';
import { ESTIMATE_MIN_WALLETS } from '@/lib/api-plans';
import { MEASURED_MATCH_RATE } from '@/lib/packs';
import {
  CHAIN_MATCH_RATES,
  CHAIN_MATCH_RATES_MEASURED_ON,
} from '@/lib/public-figures';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  // Non-safelisted response headers are invisible to browser JS unless
  // exposed, and the docs tell callers to read these.
  'Access-Control-Expose-Headers':
    'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Matches-Available, Retry-After, X-Data-Staleness, X-Last-Updated',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

interface EstimateRequestBody {
  wallets: string[];
}

// Same bound as /v1/batch: the largest plan batch (~46 KB of addresses) fits
// with room to spare, and the read-side cap lives in lib/api-auth.ts.
const MAX_BODY_BYTES = 1_000_000;

/**
 * The measured per-chain span, derived from the same constants /v1/stats
 * serves, so the note cannot drift from the table it points at.
 */
const CHAIN_RATES = Object.values(CHAIN_MATCH_RATES).map((c) => c.either_pct);
const CHAIN_RATE_LOW = Math.min(...CHAIN_RATES);
const CHAIN_RATE_HIGH = Math.max(...CHAIN_RATES);

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  const raw = await readBodyCapped(request, MAX_BODY_BYTES);
  if (raw === null) {
    return apiError(
      'Request body too large',
      'INVALID_REQUEST',
      413,
      corsHeaders
    );
  }

  let body: EstimateRequestBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError('Invalid JSON body', 'INVALID_REQUEST', 400, corsHeaders);
  }

  if (!body.wallets || !Array.isArray(body.wallets)) {
    return apiError(
      'Missing or invalid "wallets" array in request body',
      'INVALID_REQUEST',
      400,
      corsHeaders
    );
  }

  if (body.wallets.length === 0) {
    return apiError(
      'Wallets array cannot be empty',
      'INVALID_REQUEST',
      400,
      corsHeaders
    );
  }

  /**
   * Free on the match meter, weighed per wallet on the request meter, exactly
   * like the batch this call previews. The weight is the submitted count, not
   * the deduplicated one, mirroring /v1/batch: duplicates cost throughput
   * everywhere, and an estimate must not be the cheaper way to send them.
   */
  const authResult = await authenticateApiRequest(request, 0, {
    rateWeight: body.wallets.length,
  });
  if ('error' in authResult) {
    return authResult.error;
  }

  const { context } = authResult;

  // The same ceiling as /v1/batch, from the caller's (laddered) plan: an
  // estimate previews a call the caller could actually make.
  const maxBatchSize = context.plan.maxBatchSize;
  if (body.wallets.length > maxBatchSize) {
    return apiError(
      `Batch size exceeds the maximum of ${maxBatchSize} wallets per request. Estimate the list in batch-sized pieces, the same way you would resolve it.`,
      'BATCH_SIZE_EXCEEDED',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  const invalidWallets: string[] = [];
  const normalizedWallets: string[] = [];
  for (const wallet of body.wallets) {
    if (!isValidWalletAddress(wallet)) {
      invalidWallets.push(wallet);
    } else {
      normalizedWallets.push(normalizeWalletAddress(wallet));
    }
  }

  if (invalidWallets.length > 0) {
    return apiError(
      `Invalid wallet addresses: ${invalidWallets.slice(0, 5).join(', ')}${invalidWallets.length > 5 ? ` and ${invalidWallets.length - 5} more` : ''}`,
      'INVALID_ADDRESS',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  const uniqueWallets = [...new Set(normalizedWallets)];

  // On the deduplicated list, so ten copies of one address cannot turn the
  // aggregate back into a per-wallet oracle.
  if (uniqueWallets.length < ESTIMATE_MIN_WALLETS) {
    return apiError(
      `An estimate needs at least ${ESTIMATE_MIN_WALLETS} distinct wallets. The counts are aggregates by design; for one address, resolve it.`,
      'LIST_TOO_SMALL',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  const db = getDb();
  if (!db) {
    return apiError(
      'Service temporarily unavailable',
      'SERVICE_UNAVAILABLE',
      503,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  /**
   * Presence only. Handles are read to classify, counted, and never returned:
   * the whole response is integers, which is what keeps a free endpoint in
   * the counts disclosure class.
   */
  const rows = await db
    .select({
      wallet: socialGraph.wallet,
      twitterHandle: socialGraph.twitterHandle,
      farcaster: socialGraph.farcaster,
      ensName: socialGraph.ensName,
      lens: socialGraph.lens,
      github: socialGraph.github,
      lastCheckedAt: socialGraph.lastCheckedAt,
    })
    .from(socialGraph)
    .where(inArray(socialGraph.wallet, uniqueWallets));

  /**
   * The counts are a membership disclosure too: two estimates differing by
   * one wallet subtract into a free single-wallet membership oracle, which
   * is exactly what a suppressed wallet must not answer. So a suppressed
   * wallet is skipped entirely (it counts as never checked, the
   * never-indexed shape), and a suppressed handle does not let its row
   * claim an identity. Fail closed like every serve-time filter.
   */
  let suppression: SuppressionSets;
  try {
    suppression = await loadSuppressionList();
  } catch (error) {
    console.error('Suppression check failed on /v1/estimate:', error);
    return apiError(
      'Service temporarily unavailable',
      'SERVICE_UNAVAILABLE',
      503,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  let inIndex = 0;
  let billableNow = 0;
  let previouslyCheckedEmpty = 0;
  for (const row of rows) {
    if (isKindSuppressed(suppression, 'wallet', row.wallet)) continue;
    if (isKindSuppressed(suppression, 'twitter', row.twitterHandle)) {
      row.twitterHandle = null;
    }
    if (isKindSuppressed(suppression, 'farcaster', row.farcaster)) {
      row.farcaster = null;
    }
    if (isKindSuppressed(suppression, 'ens', row.ensName)) row.ensName = null;
    if (isKindSuppressed(suppression, 'lens', row.lens)) row.lens = null;
    if (isKindSuppressed(suppression, 'github', row.github)) row.github = null;
    const hasIdentity = !!(
      row.twitterHandle ||
      row.farcaster ||
      row.ensName ||
      row.lens ||
      row.github
    );
    if (hasIdentity) {
      inIndex++;
      // The billable predicate, identical to /v1/batch: X or Farcaster.
      if (row.twitterHandle || row.farcaster) billableNow++;
    } else if (row.lastCheckedAt) {
      previouslyCheckedEmpty++;
    }
    // A row with no identity and no checked stamp falls through to
    // never_checked below: absent is not false, so it does not get to claim
    // "checked and empty".
  }

  const neverChecked = uniqueWallets.length - inIndex - previouslyCheckedEmpty;

  /**
   * The band, honestly bounded. `low` is exact: it is what a /v1/batch of
   * this list bills today, because the batch bills the X-or-Farcaster rows
   * the index already holds. `high` adds the never-checked wallets resolving
   * at the measured overall rate, which is what a job (live resolve on miss)
   * could reach. It is a band, not a quote: the real rate is decided mostly
   * by which chain the holders live on, and an address does not say.
   */
  const low = billableNow;
  const high = billableNow + Math.ceil(neverChecked * MEASURED_MATCH_RATE);

  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: '/v1/estimate',
    method: 'POST',
    walletCount: uniqueWallets.length,
    responseStatus: 200,
    latencyMs: Date.now() - startTime,
    creditsUsed: body.wallets.length,
    // Counts only. Resolves no wallet, bills nothing.
    matches: null,
  }).catch(console.error);

  return apiSuccess(
    {
      data: {
        requested: uniqueWallets.length,
        in_index: inIndex,
        previously_checked_empty: previouslyCheckedEmpty,
        never_checked: neverChecked,
        would_bill_estimate: {
          low,
          high,
          note: `low is exact for a /v1/batch of this list: the wallets already holding an X handle or a Farcaster account. high adds never-checked wallets resolving at the measured overall rate (${Math.round(MEASURED_MATCH_RATE * 1000) / 10}% of submitted wallets). Real lists measured ${CHAIN_RATE_LOW}% to ${CHAIN_RATE_HIGH}% by chain on ${CHAIN_MATCH_RATES_MEASURED_ON}; addresses do not name their chain, so pick your row from match_rates on /v1/stats.`,
        },
      },
      meta: {
        generated_at: new Date().toISOString(),
        // in_index counts wallets holding ANY identity; only the X-or-
        // Farcaster subset bills, which is why low can sit below in_index.
        billable_predicate: 'x_or_farcaster',
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders }
  );
}
