import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createJob, processJobChunk } from '@/lib/job-processor';
import { inngest } from '@/inngest/client';
import { canSubmit } from '@/lib/credits';
import { getUserAccess, incrementWalletsUsed } from '@/lib/access';
import { trackEvent } from '@/lib/analytics';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import {
  checkIpRateLimit,
  getClientIp,
  formatRateLimitHeaders,
} from '@/lib/ip-rate-limiter';

// Jobs with this many wallets or fewer are processed inline (no cron wait)
const INLINE_PROCESSING_THRESHOLD = 10;

export const runtime = 'nodejs';

interface JobRequest {
  wallets: string[];
  originalData?: Record<string, Record<string, string>>;
  saveToHistory?: boolean;
  historyName?: string;
  includeENS?: boolean;
  fastMode?: boolean;
  userId?: string;
  email?: string;
  wallet?: string;
  inputSource?: 'file_upload' | 'text_input' | 'contract_import' | 'api';
  /** Set for a contract import, so the job records WHAT was looked up. */
  sourceContract?: {
    contractAddress: string;
    chain: string;
    tokenName?: string;
    tokenSymbol?: string;
    contractType?: string;
    totalHolders?: number;
    truncated?: boolean;
  };
}

export async function POST(request: NextRequest) {
  // Check for authenticated session - authenticated users bypass IP rate limits
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken
    ? await validateSession(sessionToken)
    : { user: null };

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
      fastMode = false,
      userId,
      email,
      wallet,
      inputSource,
      sourceContract,
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

    // Access tier is derived from the validated SESSION only. Previously email
    // and wallet came from the request body, so an anonymous caller could pass
    // a whitelisted wallet (public onchain) or a known paid user's email to
    // getUserAccess and be handed Infinity walletLimit — bypassing the free
    // cap. Authenticated users keep their tier via the session; anonymous
    // callers get free tier regardless of what the body claims.
    // (A signed-wallet path could restore wallet-based whitelist access later.)
    const authedEmail = session.user?.email;
    const access = await getUserAccess(authedEmail);
    // Silence unused-var lint for body fields we intentionally no longer trust
    void email;
    void wallet;

    /**
     * The credit check, for accounts the ledger applies to.
     *
     * Runs before the per-lookup limit below, because it is the real meter now
     * and its message is the useful one: "you have N matches left" tells a
     * caller what to do, where "free tier limited to 500 wallets" tells them to
     * split the file, which is exactly the behaviour the ledger exists to end.
     *
     * Only for signed-in accounts. An anonymous caller has no identity to meter
     * against (`userId` is a localStorage value that a cleared cache resets), so
     * anonymous keeps the per-lookup cap and the IP rate limit, which is the
     * demo that earns the signup.
     */
    let creditsCoverThisLookup = false;

    if (session.user) {
      const verdict = await canSubmit(
        session.user.id,
        wallets.length,
        access.tier
      );

      if (!verdict.allowed) {
        trackEvent('limit_hit', {
          userId: session.user.email,
          metadata: {
            tier: access.tier,
            reason: 'credits',
            available: verdict.balance.available,
            attempted: wallets.length,
            onFreeAllowance: verdict.balance.onFreeAllowance,
          },
        });

        return NextResponse.json(
          {
            error: verdict.reason,
            upgradeRequired: true,
            tier: access.tier,
            creditsAvailable: verdict.balance.available,
            maxWallets: verdict.maxWallets,
            onFreeAllowance: verdict.balance.onFreeAllowance,
            freeWindowResetsAt: verdict.balance.freeWindowResetsAt,
            requested: wallets.length,
          },
          { status: 403 }
        );
      }

      /**
       * Purchased credits supersede the per-lookup ceiling. Legacy tiers do
       * not, and that distinction cost a round of review.
       *
       * The first version exempted every unmetered tier, which handed legacy
       * `pro` an infinite per-lookup limit instead of the 5,000 it was sold.
       * `unlimited` was already infinite so nothing changed there, but `pro`
       * would have quietly received more than it paid for, and the published
       * copy still promises exactly that cap. Honouring a legacy purchase means
       * both directions: never metering it, and never silently enlarging it.
       *
       * The free allowance does not supersede it either: it is the demo, and
       * 100 matches should not unlock unlimited submission size.
       */
      creditsCoverThisLookup = !verdict.balance.onFreeAllowance;
    }

    /**
     * The legacy per-lookup ceiling, and who it still applies to.
     *
     * A pack purchase leaves `users.tier` as `free`, so `getUserAccess` hands
     * back a 500-wallet limit for someone holding 25,000 matches. Applying it
     * would block an Index buyer at 500 wallets a lookup, which is the tier
     * model reaching past its own retirement to cap a customer who paid to
     * escape it.
     *
     * Credits carry their own ceiling and it is the right one: submitted
     * wallets are bounded at ten times the remaining balance, checked above.
     * So this applies only where no credits do, which is an anonymous caller
     * or a signed-in account that has never bought anything.
     */
    const effectiveLimit = creditsCoverThisLookup
      ? Number.POSITIVE_INFINITY
      : access.walletLimit;

    if (wallets.length > effectiveLimit) {
      // Track limit hit event
      trackEvent('limit_hit', {
        userId: email || userId,
        metadata: {
          tier: access.tier,
          limit: effectiveLimit,
          attempted: wallets.length,
        },
      });

      const errorMessage = `${access.tier.charAt(0).toUpperCase() + access.tier.slice(1)} tier limited to ${access.walletLimit.toLocaleString()} wallets`;

      return NextResponse.json(
        {
          error: errorMessage,
          upgradeRequired: true,
          tier: access.tier,
          limit: effectiveLimit,
          requested: wallets.length,
          walletsUsed: access.walletsUsed,
        },
        { status: 403 }
      );
    }

    // Create job in database with tier context
    // Use session user ID for authenticated users (ensures history is linked correctly)
    const effectiveUserId = session.user?.id || userId;

    const jobId = await createJob(wallets, originalData, {
      /**
       * Credits unlock the deep scan, not a tier.
       *
       * `access.canUseENS` is tier-derived, and a pack buyer's tier is `free`,
       * so the client would offer the deep scan, the server would strip it, and
       * the progress bar would mark a stage complete that never ran. "Deep scan
       * with onchain ENS" is listed under "Every pack includes".
       */
      includeENS: includeENS && (access.canUseENS || creditsCoverThisLookup),
      fastMode,
      saveToHistory,
      historyName,
      userId: effectiveUserId,
      // Only a signed-in account can be debited; see JobOptions.meteredUserId.
      meteredUserId: session.user?.id,
      tier: access.tier,
      canUseNeynar: access.canUseNeynar,
      canUseENS: access.canUseENS || creditsCoverThisLookup,
      inputSource,
      // Recorded so the admin Jobs table can name the contract behind a lookup.
      // Only meaningful for a contract import; undefined for an upload.
      sourceContract,
    });

    // Lifetime usage record. It gates nothing now that Starter's quota is gone,
    // but it is the only measure of how much work an account has actually run.
    if (authedEmail) {
      await incrementWalletsUsed(authedEmail, wallets.length);
    }

    // Track lookup started event
    trackEvent('lookup_started', {
      userId: effectiveUserId || email,
      metadata: {
        jobId,
        walletCount: wallets.length,
        tier: access.tier,
        includeENS: includeENS && (access.canUseENS || creditsCoverThisLookup),
        // The choice the user made, kept alongside the flags it resolved to.
        // `includeENS` alone cannot tell a fast scan from a free account's deep
        // scan: both arrive as false, and they mean opposite things.
        scanDepth: fastMode ? 'fast' : 'deep',
        saveToHistory,
      },
    });

    // Small jobs: process inline to avoid cron queue wait (~45s avg)
    // Large jobs: trigger Inngest or fall back to cron worker
    if (wallets.length <= INLINE_PROCESSING_THRESHOLD) {
      try {
        await processJobChunk(jobId);
      } catch (error) {
        console.error(
          'Inline processing error (cron will retry):',
          error instanceof Error ? error.message : error
        );
      }
    } else {
      try {
        await inngest.send({
          name: 'wallet/lookup.requested',
          data: { jobId },
        });
      } catch (error) {
        // Inngest not configured or failed - cron worker will pick up the job
        console.log(
          'Inngest trigger skipped (cron will process):',
          error instanceof Error ? error.message : error
        );
      }
    }

    return NextResponse.json({
      jobId,
      status: 'pending',
      walletCount: wallets.length,
      message: 'Job queued for processing',
    });
  } catch (error) {
    // Log the real error server-side; return a generic message. This route is
    // unauthenticated, so echoing error.message could leak DB/driver internals.
    console.error('Job creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    );
  }
}
