import { NextRequest, NextResponse } from 'next/server';
import { getBalance, legacyTierIsUnmetered } from '@/lib/credits';
import { effectiveTierForUserId } from '@/lib/access';
import { validateApiKey } from './api-keys';
import { checkRateLimit, type RateLimitHeaders } from './rate-limiter';
import { trackApiUsage, routeTemplate } from './api-usage';
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
 */
export async function authenticateApiRequest(
  request: NextRequest,
  credits: number = 1
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

  const { key, plan } = keyResult;

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
   */
  const tier = await effectiveTierForUserId(key.userId);
  if (!legacyTierIsUnmetered(tier)) {
    const balance = await getBalance(key.userId);
    if (balance.available <= 0) {
      return {
        error: apiError(
          balance.onFreeAllowance
            ? 'Free allowance used up for this 30-day window. Buy a pack to continue.'
            : 'No credits left. Buy a pack to continue.',
          'NO_CREDITS',
          402
        ),
      };
    }
  }

  // Check rate limits
  const rateLimitResult = await checkRateLimit(key, plan, credits);

  if (!rateLimitResult.allowed) {
    return {
      error: apiError(
        `Rate limit exceeded. Try again in ${rateLimitResult.result.retryAfter} seconds`,
        'RATE_LIMIT_EXCEEDED',
        429,
        rateLimitResult.headers
      ),
    };
  }

  return {
    context: {
      key,
      plan,
      rateLimitHeaders: rateLimitResult.headers,
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
 * Validates Farcaster username format
 */
export function isValidFarcasterUsername(username: string): boolean {
  // Farcaster: lowercase letters, numbers, underscores
  return /^[a-z0-9_]{1,20}$/.test(username.toLowerCase());
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
