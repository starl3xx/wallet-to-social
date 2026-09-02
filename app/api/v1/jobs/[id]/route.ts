/**
 * GET /v1/jobs/{id}: poll a job, read its results when it completes.
 *
 * Zero declared cost: a status poll must answer a drained key, because the
 * job it is polling may be the very thing that drained it. The zero-cost
 * path in `authenticateApiRequest` still reads the balance for the
 * X-Matches-Available header and still enters the rate limiter at weight 0.
 *
 * Ownership is the job's `userId` against the key's account, and a mismatch
 * is the same 404 a missing job answers. A 403 would confirm the id exists,
 * and a job id is the only handle an enumerator needs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest, apiSuccess, apiError } from '@/lib/api-auth';
import { trackApiUsage } from '@/lib/api-usage';
import { getJobStatus, getJobResultsPage } from '@/lib/job-processor';
import { publicSources, asSourceList } from '@/lib/api-sources';
import {
  reachabilityForWallets,
  alsoOnXForWallets,
  publicTwitterField,
} from '@/lib/handle-reachability';
import { scrubSuppressed } from '@/lib/suppression';
import type { WalletSocialResult } from '@/lib/types';

export const runtime = 'nodejs';

// CORS headers for public API
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  // Non-safelisted response headers are invisible to browser JS unless
  // exposed, and the docs tell callers to read these.
  'Access-Control-Expose-Headers':
    'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Matches-Available, Retry-After, X-Data-Staleness, X-Last-Updated',
};

// A status poll is free (0 credits): a drained key must be able to collect
// the results it already paid for.
const CREDITS_COST = 0;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * The stage names on the job row are internal pipeline identifiers, and two
 * of them are the literal names of providers. Same discipline as
 * `lib/api-sources.ts`: an allowlist, so a stage added later cannot leak a
 * vendor by default. Both live sources collapse to one public word because
 * which vendor is being consulted is not the caller's information.
 */
const PUBLIC_STAGE: Record<string, string | undefined> = {
  graph: 'index',
  cache: 'cache',
  ens: 'onchain',
  neynar: 'live',
  web3bio: 'live',
};

/**
 * Results are paged, because a job accepts lists far above the batch cap and
 * a single response carrying 100k rows would exceed what a serverless
 * function can hold or ship. The page is sliced and filtered inside
 * Postgres (`getJobResultsPage`), so no poll ever deserialises the whole
 * job; a progress poll reads counts only (`getJobStatus`).
 */
const RESULTS_PAGE_LIMIT_MAX = 1000;
const RESULTS_PAGE_LIMIT_DEFAULT = 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  const { id } = await params;

  // Shape check before the database sees it: the column is uuid, and a
  // malformed id would surface as a driver error rather than a clean refusal.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return apiError(
      'Invalid job id. Use the job_id returned by POST /v1/jobs.',
      'INVALID_REQUEST',
      400,
      corsHeaders
    );
  }

  const offsetParam = request.nextUrl.searchParams.get('offset');
  const limitParam = request.nextUrl.searchParams.get('limit');
  const offset = offsetParam === null ? 0 : Number(offsetParam);
  const limit =
    limitParam === null ? RESULTS_PAGE_LIMIT_DEFAULT : Number(limitParam);
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > RESULTS_PAGE_LIMIT_MAX
  ) {
    return apiError(
      `offset must be a non-negative integer and limit an integer from 1 to ${RESULTS_PAGE_LIMIT_MAX}.`,
      'INVALID_REQUEST',
      400,
      corsHeaders
    );
  }

  const authResult = await authenticateApiRequest(request, CREDITS_COST);
  if ('error' in authResult) {
    return authResult.error;
  }

  const { context } = authResult;

  const job = await getJobStatus(id);

  // A job another account owns and a job that does not exist are the same
  // answer. System jobs carry a null userId and are nobody's to read.
  if (!job || job.userId !== context.key.userId) {
    return apiError('Job not found', 'JOB_NOT_FOUND', 404, {
      ...context.rateLimitHeaders,
      ...corsHeaders,
    });
  }

  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: '/v1/jobs/{id}',
    method: 'GET',
    walletCount: 0,
    responseStatus: 200,
    latencyMs: Date.now() - startTime,
    creditsUsed: CREDITS_COST,
    // A poll resolves nothing; the job's matches were debited at finalize.
    matches: null,
  }).catch(console.error);

  const data: Record<string, unknown> = {
    job_id: job.id,
    status: job.status,
    progress: {
      processed: job.processedCount,
      total: job.walletCount,
      stage: job.currentStage ? (PUBLIC_STAGE[job.currentStage] ?? null) : null,
    },
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    completed_at: job.completedAt?.toISOString() ?? null,
  };

  const meta: Record<string, unknown> = {
    requested: job.walletCount,
  };

  if (job.status === 'failed') {
    // Never the stored errorMessage: it is a raw throw off the pipeline and
    // can name a driver or a provider. A failed job is charged nothing, and
    // that is the fact the caller can act on.
    data.error =
      'The job failed before completing. It was not billed; submit the list again.';
  }

  if (job.status === 'completed') {
    const page = await getJobResultsPage(id, offset, limit);
    if (!page) {
      return apiError(
        'Results are temporarily unavailable. Retry shortly; the poll is free.',
        'SERVICE_UNAVAILABLE',
        503,
        { ...context.rateLimitHeaders, ...corsHeaders }
      );
    }

    let rows: WalletSocialResult[] = page.rows.map((r) => ({
      ...r,
      // Rows written before the source-order fix can carry a comma-joined
      // string here; coerced the same way the processor coerces on resume.
      source: asSourceList(r.source),
    }));

    /**
     * The serve-time suppression filter: a removed identifier must not ship
     * out of a stored payload, however it got in there. The wallet entries
     * survive with their mapping fields stripped, so the page's row count,
     * order and pagination are untouched; a stripped row simply serves as
     * the same null an ordinary miss serves, and `found`/`not_found` below
     * are counted after the filter so they agree with what shipped.
     *
     * Fail closed. Serving the stored payload unfiltered because the
     * suppression list could not be read would make an outage of one tiny
     * table an un-removal, so the read gets the same retryable answer as a
     * missing results page. The poll is free either way.
     */
    try {
      const scrub = await scrubSuppressed([rows]);
      rows = scrub.rowSets[0];
    } catch (error) {
      console.error('Suppression filter failed on /v1/jobs read:', error);
      return apiError(
        'Results are temporarily unavailable. Retry shortly; the poll is free.',
        'SERVICE_UNAVAILABLE',
        503,
        { ...context.rateLimitHeaders, ...corsHeaders }
      );
    }

    const byWallet = new Map<string, WalletSocialResult>();
    for (const r of rows) byWallet.set(r.wallet, r);

    // Reachability and the second attested handle come from the same
    // wallet-keyed reads every other v1 route uses, at read time: the job's
    // own stamp has no checked-at and goes stale the moment the daily cron
    // moves a handle.
    const handleRows = rows
      .filter((r) => r.twitter_handle)
      .map((r) => ({ wallet: r.wallet, handle: r.twitter_handle }));
    const [reach, also] = await Promise.all([
      reachabilityForWallets(handleRows),
      alsoOnXForWallets(handleRows),
    ]);

    /**
     * The batch contract: an entry is a record or null, in submission order,
     * and a wallet that resolved to nothing stays null so a client branching
     * on `if (entry)` cannot read a checked-negative as a match. The order
     * authority rides in the same payload as `wallets`, because unlike a
     * batch response the submission may be sessions old and the caller may no
     * longer hold the list it sent.
     */
    const wallets = page.wallets;
    const results: Array<Record<string, unknown> | null> = [];
    let foundCount = 0;

    for (const wallet of wallets) {
      const r = byWallet.get(wallet);
      const hasSocials = !!(
        r &&
        (r.twitter_handle || r.farcaster || r.ens_name || r.lens || r.github)
      );
      if (!r || !hasSocials) {
        results.push(null);
        continue;
      }

      foundCount++;
      const item: Record<string, unknown> = { wallet: r.wallet };

      if (r.ens_name) item.ens_name = r.ens_name;
      if (r.twitter_handle) {
        item.twitter = publicTwitterField({
          handle: r.twitter_handle,
          url: r.twitter_url,
          verified: r.twitter_verified,
          reachability: reach.get(r.wallet) ?? null,
          also: also.get(r.wallet) ?? null,
        });
      }
      if (r.farcaster) {
        item.farcaster = {
          username: r.farcaster,
          url: r.farcaster_url || `https://warpcast.com/${r.farcaster}`,
          followers: r.fc_followers ?? null,
          fid: r.fc_fid ?? null,
          verified: r.farcaster_verified ?? false,
        };
      }
      if (r.lens) item.lens = r.lens;
      if (r.github) item.github = r.github;
      // Evidence classes through the allowlist, never the pipeline markers
      // the job stored; an unmapped marker is dropped, not leaked.
      const sources = publicSources(r.source);
      if (sources) item.sources = sources;

      if (r.is_agent) {
        item.agent = {
          is_agent: true,
          name: r.agent_name ?? undefined,
          framework: r.agent_framework ?? undefined,
          type: r.agent_type ?? undefined,
          token_symbol: r.agent_token_symbol ?? undefined,
          verified: r.agent_verified ?? false,
        };
      }

      results.push(item);
    }

    data.wallets = wallets;
    data.results = results;
    /**
     * `found` and `not_found` count THIS PAGE; `requested` and `matched` are
     * whole-job totals. The split is deliberate: page counts fall out of the
     * rows shipped, and the only whole-job number the row already holds is
     * the billed one.
     */
    meta.found = foundCount;
    meta.not_found = wallets.length - foundCount;
    meta.offset = offset;
    meta.limit = limit;
    meta.next_offset = offset + limit < job.walletCount ? offset + limit : null;
    /**
     * What the job billed: the number `chargeForJob` debited at finalize, a
     * wallet carrying an X handle or a Farcaster account.
     */
    meta.matched = job.anySocialFound;
  }

  return apiSuccess(
    { data, meta },
    {
      ...context.rateLimitHeaders,
      ...corsHeaders,
    }
  );
}
