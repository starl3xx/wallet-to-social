import { NextRequest, NextResponse } from 'next/server';
import {
  getBalance,
  legacyTierIsUnmetered,
  unexpiredPackIds,
} from '@/lib/credits';
import { effectiveTierForUserId } from '@/lib/access';
import { validateApiKey } from './api-keys';
import { checkRateLimit, type RateLimitHeaders } from './rate-limiter';
import { trackApiUsage, routeTemplate } from './api-usage';
import { API_PLANS, ladderedPlanId } from '@/lib/api-plans';
import type { ApiKey, ApiPlan } from '@/db/schema';

export interface AuthenticatedContext {
  key: ApiKey;
  plan: ApiPlan;
  rateLimitHeaders: RateLimitHeaders;
}

export interface ApiError {
  error: string;
  code: string;
  status: number;
}

/**
 * Extracts API key from Authorization header
 * Supports: Bearer wts_live_xxx or just wts_live_xxx
 */
function extractApiKey(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return null;
  }

  // Support both "Bearer xxx" and just "xxx"
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return authHeader;
}

/**
 * The CORS pair every API-surface response needs, baked into the error path.
 *
 * The success path gets these from each route's own `corsHeaders`, but the
 * errors this module produces (401, 402, 429) return before any route code
 * runs, and they shipped with no CORS headers at all: a browser could not
 * read the 402 that carries the balance figure, or even distinguish it from
 * a network failure. Declared here once rather than threaded from six routes.
 */
const API_ERROR_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers':
    'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Matches-Available, Retry-After, X-Data-Staleness, X-Last-Updated',
};

/**
 * Creates a JSON error response with proper headers
 */
export function apiError(
  error: string,
  code: string,
  status: number,
  headers?: Record<string, string | undefined>
): NextResponse {
  return NextResponse.json(
    { error, code },
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...API_ERROR_CORS_HEADERS,
        ...headers,
      },
    }
  );
}

/**
 * Creates a JSON success response with rate limit headers
 */
export function apiSuccess<T>(
  data: T,
  headers: RateLimitHeaders,
  status: number = 200
): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Authenticates an API request
 * Returns either an error response or the authenticated context
 *
 * `credits` is the declared cost: above zero it arms the balance refusal, and
 * it is the default rate-limit weight. `options.rateWeight` separates the two
 * for a call that is free on the match meter but must still pay for its size
 * on the request meter: `/v1/estimate` declares `credits: 0` with a weight of
 * one unit per wallet, so a zero-balance agent can plan a spend but cannot use
 * planning as an unmetered scan (gap 19 of docs/AGENT-SYSTEM.md).
 */
export async function authenticateApiRequest(
  request: NextRequest,
  credits: number = 1,
  options?: { rateWeight?: number }
): Promise<{ error: NextResponse } | { context: AuthenticatedContext }> {
  const rawKey = extractApiKey(request);

  if (!rawKey) {
    return {
      error: apiError(
        'Missing API key. Provide via Authorization header: Bearer wts_live_xxx',
        'MISSING_API_KEY',
        401
      ),
    };
  }

  // Validate the API key
  const keyResult = await validateApiKey(rawKey);

  if (!keyResult) {
    return {
      error: apiError('Invalid or expired API key', 'INVALID_API_KEY', 401),
    };
  }

  const { key } = keyResult;
  let plan = keyResult.plan;

  /**
   * The API draws on the same credit balance as the app.
   *
   * Without this, a $29 pack buys 5,000 API requests a day forever, which at
   * the batch endpoint's 50 addresses per request is 250,000 wallets a day: an
   * export licence for the index, sold by accident. The rate limit bounds the
   * burst, not the total, and the total is the thing worth bounding.
   *
   * Checked here rather than in each endpoint because this is the one gate they
   * all pass through, and a metered endpoint somebody forgot to wire is the
   * same hole with extra steps.
   *
   * A balance check, not a debit. What a call costs is not known until it
   * resolves, so the debit belongs where the matches are counted, exactly as it
   * does for a job. This refuses the call when nothing is left.
   *
   * A declared cost of zero skips the refusal, never the read. `/v1/stats` and
   * `/v1/usage` declare `credits: 0`, resolve nothing and bill nothing, and
   * refusing them at zero balance locked an agent out of its own meter: the
   * zero reading is the argument for buying again, and the endpoint that
   * reports it was the one answering 402. The balance is still read on the
   * zero-cost path, because it was already being read here to decide the
   * refusal, and it feeds the X-Matches-Available header either way. The rate
   * limiter below still runs for every call, at the declared weight.
   */
  const tier = await effectiveTierForUserId(key.userId);
  let matchesAvailable: number | undefined;
  if (!legacyTierIsUnmetered(tier)) {
    /**
     * The plan ladder (docs/AGENT-SYSTEM.md, gap 17). Every credit key is
     * STORED on the developer plan; the limits a request is served under come
     * from the account's unexpired packs, decided here on every request so
     * the entitlement tracks the pack's twelve-month life: buying Scale
     * raises the next request, and the pack expiring lowers it, with no key
     * rotation either way.
     *
     * Derived strictly from `credit_lots` rows this server reads. Nothing in
     * the request can name a plan, and `ladderedPlanId` only ever raises the
     * stored plan, so a hand-raised key keeps what support gave it. The two
     * legacy unmetered tiers never reach this branch: their keys carry the
     * `TIER_API_PLAN` mapping (pro on developer, unlimited on startup),
     * unchanged.
     *
     * Credits still bound totals: this substitutes rate-limit ceilings only,
     * and the balance gate below is unchanged, so the ladder cannot reopen
     * the export-licence hole the account-level balance check closed.
     */
    const packs = await unexpiredPackIds(key.userId);
    const servedPlanId = ladderedPlanId(plan.id, packs);
    if (servedPlanId !== plan.id && API_PLANS[servedPlanId]) {
      plan = { ...plan, ...API_PLANS[servedPlanId] };
    }

    const balance = await getBalance(key.userId);
    if (credits > 0 && balance.available <= 0) {
      return {
        error: apiError(
          /**
           * A refusal carries its remedy, and this caller may have no human
           * behind it: the browser path AND the machine path, or an
           * autonomous agent hits a dead end here. These exact strings are
           * documented in docs-site/api-reference/errors.mdx, quoted in
           * docs-site/openapi.yaml and docs-site/mcp-server.mdx, and callers
           * are told to branch on the code, so reword all four together.
           */
          balance.onFreeAllowance
            ? 'Free allowance used up for this 30-day window. Buy a pack at https://walletlink.social/pricing to continue, or buy one with USDC, no account needed, at POST https://walletlink.social/api/x402/buy.'
            : 'No credits left. Buy a pack at https://walletlink.social/pricing to continue, or buy one with USDC, no account needed, at POST https://walletlink.social/api/x402/buy.',
          'NO_CREDITS',
          402,
          /**
           * The 402 is the moment a caller most wants a balance figure, so it
           * carries one. Clamped: a concurrent overspend can leave the ledger
           * below zero, and a negative balance is bookkeeping, not something a
           * caller can act on.
           */
          { 'X-Matches-Available': String(Math.max(0, balance.available)) }
        ),
      };
    }
    /**
     * Clamped for the same reason the 402 clamps: a zero-cost call now gets
     * this far with an empty (or, after a concurrent overspend, negative)
     * balance, and a negative number in the header is bookkeeping, not
     * something a caller can act on.
     */
    matchesAvailable = Math.max(0, balance.available);
  }

  // Check rate limits, at the declared weight (which defaults to the cost).
  const rateLimitResult = await checkRateLimit(
    key,
    plan,
    options?.rateWeight ?? credits
  );

  if (!rateLimitResult.allowed) {
    return {
      error: apiError(
        `Rate limit exceeded. Try again in ${rateLimitResult.result.retryAfter} seconds`,
        'RATE_LIMIT_EXCEEDED',
        429,
        // The balance gate ran first, so the figure exists here too. A 429 is
        // a pacing signal, and what to do next depends on both meters.
        matchesAvailable === undefined
          ? rateLimitResult.headers
          : {
              ...rateLimitResult.headers,
              'X-Matches-Available': String(matchesAvailable),
            }
      ),
    };
  }

  /**
   * The balance rides out as a header, so a caller learns what is left from
   * the call it already made instead of spending a second request to ask.
   *
   * It is the balance the gate above read, which is the balance BEFORE this
   * call's matches are debited: what a call costs is not known until it
   * resolves, and the debit happens where the matches are counted. Subtract
   * the matches the response reports to know what is left after it. The two
   * legacy unmetered accounts have no balance to report, so the header is
   * absent rather than carrying a number that means nothing.
   */
  const rateLimitHeaders: RateLimitHeaders = {
    ...rateLimitResult.headers,
  };
  if (matchesAvailable !== undefined) {
    rateLimitHeaders['X-Matches-Available'] = String(matchesAvailable);
  }

  return {
    context: {
      key,
      plan,
      rateLimitHeaders,
    },
  };
}

/**
 * Wraps an API handler with authentication, rate limiting, and usage tracking
 */
export function withApiAuth<T>(
  handler: (
    request: NextRequest,
    context: AuthenticatedContext,
    params: T
  ) => Promise<NextResponse>
) {
  return async (
    request: NextRequest,
    { params }: { params: Promise<T> }
  ): Promise<NextResponse> => {
    const startTime = Date.now();
    const resolvedParams = await params;

    // Authenticate
    const authResult = await authenticateApiRequest(request);

    if ('error' in authResult) {
      return authResult.error;
    }

    const { context } = authResult;

    try {
      // Call the handler
      const response = await handler(request, context, resolvedParams);

      // Track usage (fire and forget)
      trackApiUsage({
        apiKeyId: context.key.id,
        endpoint: routeTemplate(new URL(request.url).pathname),
        method: request.method,
        responseStatus: response.status,
        latencyMs: Date.now() - startTime,
        creditsUsed: 1,
        /**
         * A generic wrapper cannot know what the handler resolved, so it never
         * bills. Every endpoint currently in `/v1` calls `trackApiUsage`
         * itself with a real count; this path exists for handlers that do not,
         * and it records the request without charging for it.
         *
         * If a resolving endpoint is ever written on top of `withApiAuth`
         * alone, it will run free. Better that than a wrapper guessing at a
         * number it cannot see.
         */
        matches: null,
      }).catch(console.error);

      return response;
    } catch (error) {
      console.error('API handler error:', error);

      // Track error usage
      trackApiUsage({
        apiKeyId: context.key.id,
        endpoint: routeTemplate(new URL(request.url).pathname),
        method: request.method,
        responseStatus: 500,
        latencyMs: Date.now() - startTime,
        creditsUsed: 0,
        // A request that threw resolved nothing and is not billed.
        matches: null,
      }).catch(console.error);

      return apiError(
        'Internal server error',
        'INTERNAL_ERROR',
        500,
        context.rateLimitHeaders
      );
    }
  };
}

/**
 * Read a request body while bounding the actual bytes taken off the stream.
 *
 * NOT Content-Length, which a caller can omit, understate, or evade with
 * chunked transfer-encoding. Reads until the cap, then aborts and returns
 * null. The wallet-count endpoints need the body before they can weigh the
 * rate limit, so they cannot authenticate before reading; this caps what an
 * unauthenticated caller can force us to buffer and parse. One copy here
 * rather than one per route, because a route that forgets the cap is the
 * same hole with a different path.
 */
export async function readBodyCapped(
  request: NextRequest,
  maxBytes: number
): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null; // over the cap
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Validates wallet address format
 */
export function isValidWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validates Twitter handle format
 */
export function isValidTwitterHandle(handle: string): boolean {
  // Twitter handles: 1-15 chars, alphanumeric + underscores
  return /^@?[a-zA-Z0-9_]{1,15}$/.test(handle);
}

/**
 * Validates Farcaster username format.
 *
 * Derived from the index rather than from the fname spec, because the column
 * holds both kinds of name and the reverse lookup matches on the column.
 * Against the 4,699,611 usernames stored on 2026-08-24:
 *
 *     dot (all of them `.eth`)   1,477,534
 *     hyphen                       189,078
 *     underscore                         0
 *     longer than 20 chars         334,345   (longest is 25)
 *
 * The previous rule was `[a-z0-9_]{1,20}`, which allowed the one character
 * that never occurs and rejected the two that do. It refused 2,065,051 of the
 * usernames we hold, 43.9% of the index, including `vitalik.eth`, which is the
 * worked example on our own published docs page. Every one of those returned
 * 400 INVALID_USERNAME for a name that is in the table.
 *
 * The leading character must be alphanumeric, which is what excludes
 * Farcaster's `!<fid>` placeholder for an account with no username set. Those
 * are 475,698 rows and they are not addressable handles, so rejecting them is
 * correct rather than incidental.
 *
 * 32 characters rather than the observed 25: an ENS name can be longer than
 * anything we happen to hold today, and the ceiling is here to bound the input,
 * not to encode a census.
 */
export function isValidFarcasterUsername(username: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,31}$/.test(username.toLowerCase());
}

/**
 * Normalizes a wallet address to lowercase
 */
export function normalizeWalletAddress(address: string): string {
  return address.toLowerCase();
}

/**
 * Normalizes a Twitter handle (removes @ prefix, lowercases)
 */
export function normalizeTwitterHandle(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase();
}

/**
 * Normalizes a Farcaster username (lowercases)
 */
export function normalizeFarcasterUsername(username: string): string {
  return username.toLowerCase();
}
