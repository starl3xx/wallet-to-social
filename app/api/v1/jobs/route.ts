/**
 * POST /v1/jobs: the async surface (docs/AGENT-SYSTEM.md, gap 15).
 *
 * Wraps the existing job pipeline behind `authenticateApiRequest`. The job
 * runs the STANDARD pipeline, live resolve on miss, exactly like a web job
 * (which also closes gap 20: the paid rail no longer loses to the free demo).
 * Nothing here bills: `chargeForJob` debits the matches at finalize, keyed on
 * the job id, so a resumed job cannot charge twice and a failed one is never
 * charged at all.
 *
 * Submission is bounded twice, both by existing rules: `canSubmit` caps the
 * list at SUBMISSION_MULTIPLIER times the match balance (the anti-enumeration
 * guard the web surface already applies), and one active job per account
 * keeps a single key from queueing the pipeline solid.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, inArray, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import {
  authenticateApiRequest,
  apiSuccess,
  apiError,
  isValidWalletAddress,
  normalizeWalletAddress,
  readBodyCapped,
} from '@/lib/api-auth';
import { trackApiUsage } from '@/lib/api-usage';
import { createJob, processJobChunk } from '@/lib/job-processor';
import { canSubmit, legacyTierIsUnmetered } from '@/lib/credits';
import { effectiveTierForUserId } from '@/lib/access';
import { inngest } from '@/inngest/client';
import { getSiteUrl } from '@/lib/site-url';

export const runtime = 'nodejs';

// CORS headers for public API
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

interface JobsRequestBody {
  wallets: string[];
}

/**
 * A job list is bounded by the balance (`canSubmit`), not by the batch
 * ceiling, so the byte cap has to admit the largest list a real balance
 * allows: the platform's own request-body limit is ~4.5 MB, which at ~46
 * bytes per address is roughly 100,000 wallets. Anything larger never
 * reaches this function, so the cap matches the platform rather than
 * pretending to a bound of its own.
 */
const MAX_BODY_BYTES = 4_500_000;

/**
 * Jobs at or under this size are processed inline, same threshold as
 * `/api/jobs`. Above it the job is queued for Inngest with the cron worker
 * as fallback, and the caller polls.
 */
const INLINE_PROCESSING_THRESHOLD = 10;

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

  let body: JobsRequestBody;
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
   * Creation weighs one request-unit, not one per wallet. The batch endpoint
   * weighs per wallet because the request IS the work; here the request only
   * queues the work, the work is billed as matches by `chargeForJob` when the
   * job completes, and `canSubmit` below bounds the total. Weighing the queue
   * ticket per wallet would spend the whole minute window on a submission
   * that has not resolved anything yet.
   */
  const authResult = await authenticateApiRequest(request, 1);
  if ('error' in authResult) {
    return authResult.error;
  }

  const { context } = authResult;

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

  const uniqueWallets = [...new Set(normalizedWallets)];

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
   * The same submission verdict the web jobs route takes, from the key's
   * account instead of a session. It carries the SUBMISSION_MULTIPLIER bound
   * (list capped at ten times the remaining balance) and, for the two legacy
   * unmetered accounts, the daily anti-enumeration ceiling. The refusal
   * carries its remedy: the verdict's reason names the cap, and the machine
   * purchase path rides along for a caller with no human behind it.
   */
  const tier = await effectiveTierForUserId(context.key.userId);
  const verdict = await canSubmit(
    context.key.userId,
    uniqueWallets.length,
    tier
  );

  if (!verdict.allowed) {
    return apiError(
      `${verdict.reason} Buy a pack at https://walletlink.social/pricing, or with USDC, no account needed, at POST https://walletlink.social/api/x402/buy.`,
      'SUBMISSION_LIMIT_EXCEEDED',
      402,
      {
        ...context.rateLimitHeaders,
        ...corsHeaders,
        'X-Matches-Available': String(Math.max(0, verdict.balance.available)),
      }
    );
  }

  /**
   * One active job per account, counting jobs from every surface: a web job
   * in flight blocks an API submission too, because both drain the same
   * pipeline and bill the same balance. The refusal lives here alone; the web
   * route imposes no one-job rule of its own, so an active API job does not
   * block a web submission. A check rather than a constraint, the
   * same trade the ledger makes on concurrent overspend: the window between
   * check and insert is one request wide, and what a race can win is bounded
   * by SUBMISSION_MULTIPLIER anyway. The refusal names the active job so the
   * caller can poll it instead of guessing.
   */
  const [active] = await db
    .select({ id: lookupJobs.id })
    .from(lookupJobs)
    .where(
      and(
        eq(lookupJobs.userId, context.key.userId),
        inArray(lookupJobs.status, ['pending', 'processing'])
      )
    )
    .limit(1);

  if (active) {
    return apiError(
      `This account already has an active job, ${active.id}. Poll it at GET /v1/jobs/${active.id} and submit again when it completes.`,
      'JOB_ALREADY_ACTIVE',
      409,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  /**
   * Entitlement derived exactly as the web jobs route derives it from a
   * session, but from the key's account. A pack buyer's tier stays `free`,
   * so the paid result fields hang off the credit entitlement, never the
   * tier; `onFreeAllowance` false means a live lot is being spent.
   */
  const creditsCoverThisJob =
    !legacyTierIsUnmetered(tier) && !verdict.balance.onFreeAllowance;
  const paidData = legacyTierIsUnmetered(tier) || creditsCoverThisJob;

  const jobId = await createJob(
    uniqueWallets,
    {},
    {
      // The API body carries only wallets, so the deep-scan ENS toggle is off,
      // matching the web default for a submission that does not ask for it.
      includeENS: false,
      // False IS the feature: the standard pipeline resolves misses against
      // live sources, which is what this surface exists to reach.
      fastMode: false,
      // The job row keeps the results; the web history surface is not this
      // caller's, and writing rows there would put jobs in a UI list the key
      // holder may not be the person reading.
      saveToHistory: false,
      // Ownership and the debit target are the same account, stated twice
      // because they gate different things: userId scopes reads, meteredUserId
      // is the account chargeForJob debits.
      userId: context.key.userId,
      meteredUserId: context.key.userId,
      tier,
      paidData,
      canUseNeynar: true,
      canUseENS: creditsCoverThisJob,
      // Recorded inside options JSONB; lookup_jobs has no input_source column.
      inputSource: 'api',
    }
  );

  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: '/v1/jobs',
    method: 'POST',
    walletCount: uniqueWallets.length,
    responseStatus: 202,
    latencyMs: Date.now() - startTime,
    creditsUsed: 1,
    // The submission resolves nothing itself; the job's matches are debited
    // by chargeForJob at finalize, keyed on the job id.
    matches: null,
  }).catch(console.error);

  /**
   * Same dispatch as `/api/jobs`: small jobs run inline so a short list does
   * not wait out a cron tick, larger ones go to Inngest with the cron worker
   * as the fallback if the send fails.
   */
  let status = 'pending';
  if (uniqueWallets.length <= INLINE_PROCESSING_THRESHOLD) {
    try {
      const inline = await processJobChunk(jobId);
      // Report what actually happened rather than a 'pending' the caller
      // would disprove with their first poll.
      if (inline.completed && !inline.error) status = 'completed';
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
      console.log(
        'Inngest trigger skipped (cron will process):',
        error instanceof Error ? error.message : error
      );
    }
  }

  return apiSuccess(
    {
      data: {
        job_id: jobId,
        status,
        wallets: uniqueWallets.length,
        // The environment's own origin, not the production constant: a
        // status_url must poll the deployment that holds the job, and
        // `getSiteUrl()` is the production origin exactly when this is
        // production.
        status_url: `${getSiteUrl()}/api/v1/jobs/${jobId}`,
      },
      meta: {
        submitted_at: new Date().toISOString(),
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders },
    202
  );
}
