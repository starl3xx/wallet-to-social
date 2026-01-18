import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from './api-keys';
import { checkRateLimit, type RateLimitHeaders } from './rate-limiter';
import { trackApiUsage } from './api-usage';
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
      error: apiError(
        'Invalid or expired API key',
        'INVALID_API_KEY',
        401
      ),
    };
  }

  const { key, plan } = keyResult;

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
  return async (request: NextRequest, { params }: { params: Promise<T> }): Promise<NextResponse> => {
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
        endpoint: new URL(request.url).pathname,
        method: request.method,
        responseStatus: response.status,
        latencyMs: Date.now() - startTime,
        creditsUsed: 1,
      }).catch(console.error);

      return response;
    } catch (error) {
      console.error('API handler error:', error);

      // Track error usage
      trackApiUsage({
        apiKeyId: context.key.id,
        endpoint: new URL(request.url).pathname,
        method: request.method,
        responseStatus: 500,
        latencyMs: Date.now() - startTime,
        creditsUsed: 0,
      }).catch(console.error);

      return apiError('Internal server error', 'INTERNAL_ERROR', 500, context.rateLimitHeaders);
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
