import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { socialGraph } from '@/db/schema';
import {
  authenticateApiRequest,
  apiSuccess,
  apiError,
  isValidTwitterHandle,
  normalizeTwitterHandle,
} from '@/lib/api-auth';
import { trackApiUsage } from '@/lib/api-usage';
import {
  decodeReverseCursor,
  encodeReverseCursor,
} from '@/lib/reverse-cursor';
import { publicSources } from '@/lib/api-sources';
import {
  reachabilityForWallets,
  publicTwitterField,
} from '@/lib/handle-reachability';

export const runtime = 'nodejs';

// CORS headers for public API
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

// Reverse lookups cost 2 credits
const CREDITS_COST = 2;

// Maximum results per request
const MAX_RESULTS = 100;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const startTime = Date.now();
  const { handle } = await params;

  // Authenticate request
  const authResult = await authenticateApiRequest(request, CREDITS_COST);
  if ('error' in authResult) {
    return authResult.error;
  }

  const { context } = authResult;

  // Validate Twitter handle
  if (!isValidTwitterHandle(handle)) {
    return apiError(
      'Invalid Twitter handle format. Expected 1-15 alphanumeric characters or underscores.',
      'INVALID_HANDLE',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  const normalizedHandle = normalizeTwitterHandle(handle);

  // Keyset pagination. No cursor means the first page.
  const rawCursor = request.nextUrl.searchParams.get('cursor');
  const cursor = rawCursor === null ? null : decodeReverseCursor(rawCursor);
  if (rawCursor !== null && cursor === null) {
    return apiError(
      'Invalid cursor. Pass the next_cursor value from a previous response, unmodified.',
      'INVALID_CURSOR',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
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

  // Get total count first (for truncation detection)
  const [countResult] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
    })
    .from(socialGraph)
    .where(eq(socialGraph.twitterHandle, normalizedHandle));

  const totalCount = countResult?.count ?? 0;

  // The page after the cursor position. NULLS LAST puts wallets without
  // Farcaster reach at the end rather than first (Postgres sorts NULLs first
  // under DESC), and a cursor in that bucket carries f: null, where only the
  // wallet tiebreak advances.
  const afterCursor =
    cursor === null
      ? undefined
      : cursor.f === null
        ? sql`(${socialGraph.fcFollowers} IS NULL AND ${socialGraph.wallet} > ${cursor.w})`
        : sql`(${socialGraph.fcFollowers} < ${cursor.f}
            OR (${socialGraph.fcFollowers} = ${cursor.f} AND ${socialGraph.wallet} > ${cursor.w})
            OR ${socialGraph.fcFollowers} IS NULL)`;

  // Find the wallets with this Twitter handle, one page at a time. The +1 row
  // is the has-more probe: it never ships, it only says whether a next page
  // exists, so next_cursor is exact instead of guessed from a full page.
  const fetched = await db
    .select({
      wallet: socialGraph.wallet,
      ensName: socialGraph.ensName,
      twitterHandle: socialGraph.twitterHandle,
      twitterUrl: socialGraph.twitterUrl,
      farcaster: socialGraph.farcaster,
      farcasterUrl: socialGraph.farcasterUrl,
      fcFollowers: socialGraph.fcFollowers,
      fcFid: socialGraph.fcFid,
      lens: socialGraph.lens,
      github: socialGraph.github,
      sources: socialGraph.sources,
      lastUpdatedAt: socialGraph.lastUpdatedAt,
      // Quality metadata
      twitterVerified: socialGraph.twitterVerified,
      farcasterVerified: socialGraph.farcasterVerified,
      dataQualityScore: socialGraph.dataQualityScore,
    })
    .from(socialGraph)
    .where(
      afterCursor === undefined
        ? eq(socialGraph.twitterHandle, normalizedHandle)
        : and(eq(socialGraph.twitterHandle, normalizedHandle), afterCursor)
    )
    .orderBy(
      sql`${socialGraph.fcFollowers} DESC NULLS LAST`,
      asc(socialGraph.wallet)
    )
    .limit(MAX_RESULTS + 1);

  const truncated = fetched.length > MAX_RESULTS;
  const results = truncated ? fetched.slice(0, MAX_RESULTS) : fetched;
  const lastRow = results[results.length - 1];
  const nextCursor =
    truncated && lastRow
      ? encodeReverseCursor({ f: lastRow.fcFollowers ?? null, w: lastRow.wallet })
      : null;

  // Track usage
  trackApiUsage({
    apiKeyId: context.key.id,
    // The route template, never the concrete path: a per-handle key makes
    // requests_by_endpoint unbounded and persists what the caller looked up.
    endpoint: '/v1/reverse/twitter/{handle}',
    method: 'GET',
    walletCount: results.length,
    responseStatus: 200,
    latencyMs: Date.now() - startTime,
    creditsUsed: CREDITS_COST,
    /**
     * Every returned wallet is a match: the query selected them BY the handle,
     * so each one is a resolved wallet-to-social link. A handle nobody holds
     * returns zero rows and costs nothing, which is the same rule as the
     * forward path.
     */
    matches: results.length,
  }).catch(console.error);

  if (results.length === 0) {
    return apiSuccess(
      {
        data: [],
        meta: {
          handle: normalizedHandle,
          total_count: totalCount,
          returned_count: 0,
          truncated: false,
          next_cursor: null,
        },
      },
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  /**
   * Per wallet, not once for the queried handle.
   *
   * Every row here shares the same handle, so this used to be one lookup
   * outside the loop. That is right for the three handle-level states and
   * wrong for `reassigned`, which compares the id attested alongside each
   * wallet against the id the handle resolves to now. Two wallets can hold the
   * same handle with different attested accounts, so one of them can be
   * reassigned while the other is not.
   */
  const reach = await reachabilityForWallets(
    results.map((r) => ({
      wallet: r.wallet,
      handle: r.twitterHandle ?? normalizedHandle,
    }))
  );

  const data = results.map((result) => {
    const item: Record<string, unknown> = {
      wallet: result.wallet,
    };

    if (result.ensName) item.ens_name = result.ensName;
    item.twitter = publicTwitterField({
      // Non-null by construction: the query matched on this handle. Falling
      // back to the queried value keeps TypeScript honest without a cast.
      handle: result.twitterHandle ?? normalizedHandle,
      url: result.twitterUrl,
      verified: result.twitterVerified,
      reachability: reach.get(result.wallet.toLowerCase()) ?? null,
    });
    if (result.farcaster) {
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
    // Evidence classes, never the internal pipeline identifiers — see lib/api-sources.ts
    const sources = publicSources(result.sources);
    if (sources) item.sources = sources;
    item.quality_score = result.dataQualityScore ?? 0;

    return item;
  });

  return apiSuccess(
    {
      data,
      meta: {
        handle: normalizedHandle,
        total_count: totalCount,
        returned_count: results.length,
        truncated,
        next_cursor: nextCursor,
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders }
  );
}
