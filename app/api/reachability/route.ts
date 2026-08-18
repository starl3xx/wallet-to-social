import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { cleanTwitterHandle } from '@/lib/twitter-cleaner';
import { REACHABILITY_DETAIL, REACHABILITY_LABEL, type Reachability } from '@/lib/handle-reachability';
import { checkIpRateLimit, formatRateLimitHeaders, getClientIp } from '@/lib/ip-rate-limiter';

export const runtime = 'nodejs';

/**
 * Is this X handle still reachable? Keyless, free, one handle at a time.
 *
 * ## Why this is public and free
 *
 * The claim it answers is the product's differentiator: Farcaster records a
 * verified X account as a name, captured once, with no account id and no
 * recheck, so a third of those handles reach nobody and no tool built on them
 * can say which. That is a strong claim, and the only honest way to make it is
 * to let a stranger test it in one click against a handle they already know.
 *
 * It costs us nothing to be checked. This reads one indexed row from a table we
 * already hold: no external request, no credits, nothing metered.
 *
 * ## What it deliberately withholds
 *
 * The **count** of wallets carrying the handle, never the addresses. Handle to
 * wallets is the reverse lookup, which is a paid feature behind `/api/reverse`
 * and `/v1/reverse`. A free endpoint returning addresses would give away the
 * thing Pro is sold on, for any handle anyone can type.
 *
 * The count is the part that makes the answer meaningful ("this dead handle is
 * on 240 wallets") without being the product.
 *
 * ## Unchecked is a real answer
 *
 * A handle we hold but have not resolved yet returns `unchecked`, not `live`.
 * 93.7% of held handles carry a resolved state and the rest are genuinely
 * unknown to us. Saying so is the whole point: a tool that guessed here would
 * be the thing this endpoint exists to distinguish itself from.
 */

interface Answer {
  handle: string;
  /** `unknown` means we hold no wallet carrying this handle at all. */
  state: Reachability | 'unchecked' | 'unknown';
  label: string;
  detail: string;
  /** Wallets in the index carrying this handle. Never the addresses. */
  wallets: number;
  /** When we last resolved it, ISO. Null when never checked. */
  checkedAt: string | null;
}

const NOT_IN_INDEX: Omit<Answer, 'handle'> = {
  state: 'unknown',
  label: 'Not in the index',
  detail:
    'No wallet we hold carries this handle, so we have never had reason to check it. That is a fact about our coverage, not about the account.',
  wallets: 0,
  checkedAt: null,
};

const UNCHECKED_DETAIL =
  'We hold wallets carrying this handle but have not resolved it yet. It is reported as unchecked rather than assumed live; the daily sweep works through the queue oldest first.';

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('handle') ?? '';

  /**
   * The same normaliser the ingest path uses.
   *
   * Reusing it matters: it is what strips a URL, an @, and mixed case. If this
   * endpoint normalised differently, a handle would be reachable here and
   * absent there, which is a worse answer than either.
   */
  const handle = cleanTwitterHandle(raw);
  if (!handle) {
    /**
     * Two different failures, said differently.
     *
     * `cleanTwitterHandle` returns null both for nothing at all and for a
     * string that cannot be an X handle, which is 1 to 15 characters. Telling
     * somebody who typed 23 characters to "pass a handle" describes their input
     * as absent when it was present and too long, and they retype the same
     * thing.
     */
    const trimmed = raw.trim();
    return NextResponse.json(
      {
        error: trimmed
          ? 'That is not a valid X handle. They are 1 to 15 characters, letters, numbers and underscores.'
          : 'Pass a handle, for example ?handle=jack',
      },
      { status: 400 }
    );
  }

  const limit = await checkIpRateLimit(getClientIp(request), '/api/reachability');
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many checks from this address. Try again shortly.' },
      { status: 429, headers: formatRateLimitHeaders(limit) }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }

  try {
    /**
     * The count matches on lower(twitter_handle), deliberately, and it is
     * indexed. This comment sits outside the template because a tagged template
     * ends at the first backtick, and putting a prose note with backticks
     * inside one broke the build twice today.
     *
     * Measured on the live database: the predicate below plans as a Bitmap
     * Index Scan on social_graph_twitter_lower_idx in 0.133ms. Matching the
     * column directly is a hair faster at 0.092ms because it can go index-only,
     * and every row is stored lowercase today, so the two agree.
     *
     * They agree until they do not. On 2026-08-17, 3,566 rows were written with
     * mixed case and became invisible to a reverse lookup that compared the
     * column directly against a lowercased query. That is this exact
     * substitution, and it cost a repair script. A predicate robust to storage
     * beats 41 microseconds on a keyless endpoint.
     */
    const result = (await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM social_graph
          WHERE lower(twitter_handle) = ${handle}) AS wallets,
        x.status,
        x.checked_at
      FROM (SELECT 1) AS one
      LEFT JOIN x_accounts x ON x.handle = ${handle}
    `)) as unknown as {
      rows: Array<{ wallets: number; status: string | null; checked_at: string | null }>;
    };

    const row = result.rows[0];
    const wallets = row?.wallets ?? 0;

    if (wallets === 0 && !row?.status) {
      return NextResponse.json({ handle, ...NOT_IN_INDEX }, { headers: formatRateLimitHeaders(limit) });
    }

    // Internal vocabulary in, public vocabulary out. See lib/handle-reachability.
    const state: Reachability | 'unchecked' =
      row?.status === 'live'
        ? 'live'
        : row?.status === 'unavailable'
          ? 'suspended'
          : row?.status === 'not_found'
            ? 'unclaimed'
            : 'unchecked';

    const answer: Answer = {
      handle,
      state,
      label: state === 'unchecked' ? 'Not checked yet' : REACHABILITY_LABEL[state],
      detail: state === 'unchecked' ? UNCHECKED_DETAIL : REACHABILITY_DETAIL[state],
      wallets,
      checkedAt: row?.checked_at ? new Date(row.checked_at).toISOString() : null,
    };
    return NextResponse.json(answer, { headers: formatRateLimitHeaders(limit) });
  } catch (error) {
    console.error('Reachability check error:', error);
    return NextResponse.json({ error: 'Check failed' }, { status: 500 });
  }
}
