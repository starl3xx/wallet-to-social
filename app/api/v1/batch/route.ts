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
import { publicSources } from '@/lib/api-sources';
import {
  reachabilityForWallets,
  alsoOnXForWallets,
  publicTwitterField,
} from '@/lib/handle-reachability';
import { isRecordStale } from '@/lib/staleness';
import {
  findIdempotentReplay,
  storeIdempotentResponse,
  idempotencyBodyHash,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_TTL_HOURS,
} from '@/lib/idempotency';

export const runtime = 'nodejs';

// CORS headers for public API
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Idempotency-Key',
  // Non-safelisted response headers are invisible to browser JS unless
  // exposed, and the docs tell callers to read these.
  'Access-Control-Expose-Headers':
    'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Matches-Available, Retry-After, X-Data-Staleness, X-Last-Updated, Idempotency-Replayed',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

interface BatchRequestBody {
  wallets: string[];
}

// The max batch is ~1000 addresses (~46 KB); 1 MB is generous. The read-side
// cap itself lives in lib/api-auth.ts (readBodyCapped), shared with /v1/jobs.
const MAX_BODY_BYTES = 1_000_000;

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

  // Parse the (now size-bounded) body to get the wallet count for rate limiting
  let body: BatchRequestBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError('Invalid JSON body', 'INVALID_REQUEST', 400, corsHeaders);
  }

  // Validate wallets array
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
   * Optional retry protection: an Idempotency-Key header makes a repeat of
   * this exact request replay the stored response instead of billing again.
   * The header is validated before authentication like the other body-shape
   * checks; the store itself is consulted after, because the dedup is scoped
   * to the authenticated key. See lib/idempotency.ts for the contract.
   */
  const idemKey = request.headers.get('Idempotency-Key');
  if (idemKey !== null && idemKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return apiError(
      `Idempotency-Key is longer than ${IDEMPOTENCY_KEY_MAX_LENGTH} characters. Use an opaque id such as a UUID.`,
      'INVALID_REQUEST',
      400,
      corsHeaders
    );
  }
  // An empty value is a footgun, not a key: every request would share one
  // bucket and the second body would answer 422 for no reason a caller can
  // see. Refused outright, the way Stripe refuses it.
  if (idemKey !== null && idemKey.length === 0) {
    return apiError(
      'Idempotency-Key must not be empty. Use an opaque id such as a UUID, or omit the header.',
      'INVALID_REQUEST',
      400,
      corsHeaders
    );
  }

  // Authenticate request with credits = wallet count
  const authResult = await authenticateApiRequest(request, body.wallets.length);
  if ('error' in authResult) {
    return authResult.error;
  }

  const { context } = authResult;

  // Check batch size limit. The plan is the laddered one (lib/api-plans.ts
  // PACK_API_PLAN via lib/api-auth.ts): every pack's key is stored on the
  // developer plan, and a live Scale or Index pack raises the ceiling served
  // here to 200 or 1,000. Over it, the honest advice is still to split.
  const maxBatchSize = context.plan.maxBatchSize;
  if (body.wallets.length > maxBatchSize) {
    return apiError(
      `Batch size exceeds the maximum of ${maxBatchSize} wallets per request. Split the list across requests.`,
      'BATCH_SIZE_EXCEEDED',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  // Validate and normalize wallet addresses
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

  // Deduplicate
  const uniqueWallets = [...new Set(normalizedWallets)];

  /**
   * Replay check, after authentication (the store is keyed on the api key)
   * and before any resolution work. The body hash covers the raw bytes, so a
   * hit means the identical request already ran; its validations passed then
   * and would pass identically now.
   *
   * A replay is recorded in api_usage with `matches: null`, the same shape as
   * a non-resolving endpoint: the request happened and its rate-limit weight
   * was spent at the gate above, but nothing was resolved and nothing is
   * billed.
   */
  if (idemKey !== null) {
    const bodyHash = idempotencyBodyHash(raw);
    const prior = await findIdempotentReplay(context.key.id, idemKey, bodyHash);
    if (prior.kind === 'mismatch') {
      return apiError(
        `This Idempotency-Key was already used with a different request body inside the ${IDEMPOTENCY_TTL_HOURS}-hour window. Use a fresh key for a new request.`,
        'IDEMPOTENCY_KEY_REUSED',
        422,
        { ...context.rateLimitHeaders, ...corsHeaders }
      );
    }
    if (prior.kind === 'not_replayable') {
      return apiError(
        'The original response under this Idempotency-Key was too large to store, so it cannot be replayed. Resend with a fresh key; the resend is billed as a new request.',
        'IDEMPOTENCY_NOT_REPLAYABLE',
        409,
        { ...context.rateLimitHeaders, ...corsHeaders }
      );
    }
    if (prior.kind === 'replay') {
      trackApiUsage({
        apiKeyId: context.key.id,
        endpoint: '/v1/batch',
        method: 'POST',
        walletCount: uniqueWallets.length,
        responseStatus: prior.status,
        latencyMs: Date.now() - startTime,
        creditsUsed: uniqueWallets.length,
        // A replay resolves nothing and bills nothing.
        matches: null,
      }).catch(console.error);

      return NextResponse.json(prior.response, {
        status: prior.status,
        headers: {
          'Content-Type': 'application/json',
          ...context.rateLimitHeaders,
          ...corsHeaders,
          'Idempotency-Replayed': 'true',
        },
      });
    }
  }

  // Query social graph
  const db = getDb();
  if (!db) {
    return apiError(
      'Service temporarily unavailable',
      'SERVICE_UNAVAILABLE',
      503,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  const results = await db
    .select({
      wallet: socialGraph.wallet,
      ensName: socialGraph.ensName,
      twitterHandle: socialGraph.twitterHandle,
      twitterVerified: socialGraph.twitterVerified,
      twitterUrl: socialGraph.twitterUrl,
      farcaster: socialGraph.farcaster,
      farcasterUrl: socialGraph.farcasterUrl,
      farcasterVerified: socialGraph.farcasterVerified,
      fcFollowers: socialGraph.fcFollowers,
      fcFid: socialGraph.fcFid,
      lens: socialGraph.lens,
      github: socialGraph.github,
      sources: socialGraph.sources,
      lastUpdatedAt: socialGraph.lastUpdatedAt,
      // Freshness and negative knowledge, same row, no extra read: staleAt
      // feeds per-row `stale`, lastCheckedAt feeds meta.previously_checked on
      // misses.
      staleAt: socialGraph.staleAt,
      lastCheckedAt: socialGraph.lastCheckedAt,
      // Agent metadata
      isAgent: socialGraph.isAgent,
      agentName: socialGraph.agentName,
      agentFramework: socialGraph.agentFramework,
      agentType: socialGraph.agentType,
      agentTokenSymbol: socialGraph.agentTokenSymbol,
      agentVerified: socialGraph.agentVerified,
    })
    .from(socialGraph)
    .where(inArray(socialGraph.wallet, uniqueWallets));

  // Build result map
  const resultMap = new Map<string, (typeof results)[0]>();
  // One read each for the whole batch, together: neither depends on the other.
  // `also` is a second live handle attested for the same wallet; see
  // alsoOnXForWallets for what has to hold before a row gets one.
  const handleRows = results.map((r) => ({
    wallet: r.wallet,
    handle: r.twitterHandle,
  }));
  const [reach, also] = await Promise.all([
    reachabilityForWallets(handleRows),
    alsoOnXForWallets(handleRows),
  ]);

  for (const result of results) {
    resultMap.set(result.wallet, result);
  }

  // Build response array in same order as input
  const data: Array<Record<string, unknown> | null> = [];
  let foundCount = 0;

  /**
   * Negative knowledge for the misses, keyed by wallet.
   *
   * A miss stays `null` in `data`, because "an entry is a record or null" is
   * the published contract and a client that branches on `if (entry)` must not
   * start reading a checked-negative as a match. What was missing is the
   * distinction the single lookup already makes in `meta.checked_at`: an
   * address we checked and found bare versus one we have never seen. It rides
   * in `meta.previously_checked` as wallet -> ISO timestamp, present only for
   * misses that were actually checked; absence means never seen, per the
   * absent-is-not-false rule.
   */
  const previouslyChecked: Record<string, string> = {};

  for (const wallet of uniqueWallets) {
    const result = resultMap.get(wallet);
    // Persisted negatives (rows with no socials) are "not found" to API
    // consumers: the same null as a wallet we have never seen
    const hasSocials = !!(
      result &&
      (result.twitterHandle ||
        result.farcaster ||
        result.ensName ||
        result.lens ||
        result.github)
    );
    if (!result || !hasSocials) {
      data.push(null);
      if (result?.lastCheckedAt) {
        previouslyChecked[wallet] = result.lastCheckedAt.toISOString();
      }
      continue;
    }

    foundCount++;

    const item: Record<string, unknown> = {
      wallet: result.wallet,
    };

    if (result.ensName) item.ens_name = result.ensName;
    if (result.twitterHandle) {
      // Also gains `verified`, which this route omitted while the other three
      // returned it. One builder is how that stops happening.
      item.twitter = publicTwitterField({
        handle: result.twitterHandle,
        url: result.twitterUrl,
        verified: result.twitterVerified,
        // Keyed by wallet, not handle: reassigned is a per-wallet fact.
        reachability: reach.get(result.wallet.toLowerCase()) ?? null,
        also: also.get(result.wallet.toLowerCase()) ?? null,
      });
    }
    if (result.farcaster) {
      // `verified` for the same reason twitter carries it four lines up: this
      // route omitted it while the other three returned it, so a multi-address
      // caller got the account without the evidence class behind it. The MCP
      // layer had to report `attested: null` on every batch result as a result
      // (app/api/mcp/route.ts), which is the product's central claim going
      // missing exactly where the volume is.
      item.farcaster = {
        username: result.farcaster,
        url: result.farcasterUrl || `https://warpcast.com/${result.farcaster}`,
        followers: result.fcFollowers,
        fid: result.fcFid,
        verified: result.farcasterVerified ?? false,
      };
    }
    if (result.lens) item.lens = result.lens;
    if (result.github) item.github = result.github;
    // Evidence classes, never the internal pipeline identifiers; see lib/api-sources.ts
    const sources = publicSources(result.sources);
    if (sources) item.sources = sources;

    // Agent metadata
    if (result.isAgent) {
      item.agent = {
        is_agent: true,
        name: result.agentName ?? undefined,
        framework: result.agentFramework ?? undefined,
        type: result.agentType ?? undefined,
        token_symbol: result.agentTokenSymbol ?? undefined,
        verified: result.agentVerified ?? false,
      };
    }

    /**
     * Freshness, per row. The single lookup reports these in `meta`; a batch
     * has one `meta` for many rows, so they ride each record instead. Same
     * derivation as the single lookup, from lib/staleness.ts, so the two
     * routes cannot disagree about what stale means. The row's lastUpdatedAt
     * was already selected (and previously dropped on the floor); the column
     * is NOT NULL, so `last_updated` is always present on a found row.
     */
    item.last_updated = result.lastUpdatedAt.toISOString();
    item.stale = isRecordStale(result.staleAt, result.lastUpdatedAt);

    data.push(item);
  }

  /**
   * Billed on matches, the same predicate the app uses: an X handle or a
   * Farcaster account. Not `data.length`, which counts every row including the
   * ones that resolved to nothing, and not ENS or Lens or GitHub, which the app
   * does not bill for either.
   */
  const matches = data.filter(
    (item) => item?.twitter || item?.farcaster
  ).length;

  // Track usage
  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: '/v1/batch',
    method: 'POST',
    walletCount: uniqueWallets.length,
    responseStatus: 200,
    latencyMs: Date.now() - startTime,
    creditsUsed: uniqueWallets.length,
    matches,
  }).catch(console.error);

  const payload = {
    data,
    meta: {
      requested: uniqueWallets.length,
      found: foundCount,
      not_found: uniqueWallets.length - foundCount,
      /**
       * What this call was billed: the same `matches` the debit above uses.
       *
       * `found` is larger. It counts a row with only an ENS name, Lens or
       * GitHub as found, and none of those cost anything. Without this
       * field the response carried no number a caller could reconcile
       * against their balance, on a product sold as "you only pay for
       * matches".
       */
      matched: matches,
      // Misses we have checked before, wallet -> when. Absent when every miss
      // is an address we have never seen; see the comment where it is built.
      ...(Object.keys(previouslyChecked).length > 0
        ? { previously_checked: previouslyChecked }
        : {}),
    },
  };

  /**
   * Awaited, not fire-and-forget: the caller's next retry may arrive the
   * moment this response does, and a store still in flight would re-run and
   * re-bill the exact request the header exists to protect. Only a 200 is
   * stored, so a failed request never consumes its key.
   */
  if (idemKey !== null) {
    try {
      await storeIdempotentResponse(
        context.key.id,
        idemKey,
        idempotencyBodyHash(raw),
        200,
        payload
      );
    } catch (error) {
      // The answer is correct and already paid for; losing the replay row
      // costs a future retry its dedup, not this caller their response.
      console.error('Failed to store idempotent response:', error);
    }
  }

  return apiSuccess(payload, { ...context.rateLimitHeaders, ...corsHeaders });
}
