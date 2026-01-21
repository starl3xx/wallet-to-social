import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createJob } from '@/lib/job-processor';
import { inngest } from '@/inngest/client';
import { getUserAccess, incrementWalletsUsed } from '@/lib/access';
import { trackEvent } from '@/lib/analytics';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import {
  checkIpRateLimit,
  getClientIp,
  formatRateLimitHeaders,
} from '@/lib/ip-rate-limiter';

export const runtime = 'nodejs';

interface JobRequest {
  wallets: string[];
  originalData?: Record<string, Record<string, string>>;
  saveToHistory?: boolean;
  historyName?: string;
  includeENS?: boolean;
  userId?: string;
  email?: string;
  wallet?: string;
  inputSource?: 'file_upload' | 'text_input' | 'contract_import' | 'api';
}

export async function POST(request: NextRequest) {
  // Check for authenticated session - authenticated users bypass IP rate limits
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await validateSession(sessionToken) : { user: null };

  // Apply IP rate limiting only for unauthenticated requests
  if (!session.user) {
    const clientIp = getClientIp(request);
    const rateLimitResult = await checkIpRateLimit(clientIp, '/api/jobs');

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Sign in for unlimited access.',
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: formatRateLimitHeaders(rateLimitResult),
        }
      );
    }
  }

  try {
    const body: JobRequest = await request.json();
    const {
      wallets,
      originalData = {},
      saveToHistory = false,
      historyName,
      includeENS = false,
      userId,
      email,
      wallet,
      inputSource,
    } = body;

    if (!wallets || wallets.length === 0) {
      return NextResponse.json(
        { error: 'No wallets provided' },
        { status: 400 }
      );
    }

    // Check if database is configured
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured - job queue requires DATABASE_URL' },
        { status: 500 }
      );
    }

    // Check user access and tier limits
    const access = await getUserAccess(email, wallet);

    // Calculate effective limit considering cumulative quota
    let effectiveLimit = access.walletLimit;
    if (access.walletsRemaining !== null) {
      // Starter tier: can't exceed remaining quota
      effectiveLimit = Math.min(access.walletLimit, access.walletsRemaining);
    }

    if (wallets.length > effectiveLimit) {
      // Track limit hit event
      trackEvent('limit_hit', {
        userId: email || userId,
        metadata: {
          tier: access.tier,
          limit: effectiveLimit,
          attempted: wallets.length,
          walletsRemaining: access.walletsRemaining,
        },
      });

      // Customize error message for starter tier
      const errorMessage = access.walletsRemaining !== null
        ? `You have ${access.walletsRemaining.toLocaleString()} wallets remaining in your Starter quota`
        : `${access.tier.charAt(0).toUpperCase() + access.tier.slice(1)} tier limited to ${access.walletLimit.toLocaleString()} wallets`;

      return NextResponse.json(
        {
          error: errorMessage,
          upgradeRequired: true,
          tier: access.tier,
          limit: effectiveLimit,
          requested: wallets.length,
          walletsRemaining: access.walletsRemaining,
          walletQuota: access.walletQuota,
          walletsUsed: access.walletsUsed,
        },
        { status: 403 }
      );
    }

    // Create job in database with tier context
    const jobId = await createJob(wallets, originalData, {
      includeENS: includeENS && access.canUseENS,
      saveToHistory,
      historyName,
      userId,
      tier: access.tier,
      canUseNeynar: access.canUseNeynar,
      canUseENS: access.canUseENS,
      inputSource,
    });

    // For starter tier, increment usage counter
    if (access.tier === 'starter' && email) {
      await incrementWalletsUsed(email, wallets.length);
    }

    // Track lookup started event
    trackEvent('lookup_started', {
      userId: email || userId,
      metadata: {
        jobId,
        walletCount: wallets.length,
        tier: access.tier,
        includeENS: includeENS && access.canUseENS,
        saveToHistory,
        walletsRemaining: access.walletsRemaining !== null
          ? access.walletsRemaining - wallets.length
          : null,
      },
    });

    // Trigger Inngest function for immediate processing
    // Falls back to cron worker if Inngest is not configured
    try {
      await inngest.send({
        name: 'wallet/lookup.requested',
        data: { jobId },
      });
    } catch (error) {
      // Inngest not configured or failed - cron worker will pick up the job
      console.log('Inngest trigger skipped (cron will process):', error instanceof Error ? error.message : error);
    }

    return NextResponse.json({
      jobId,
      status: 'pending',
      walletCount: wallets.length,
      message: 'Job queued for processing',
    });
  } catch (error) {
    console.error('Job creation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create job' },
      { status: 500 }
    );
  }
}
