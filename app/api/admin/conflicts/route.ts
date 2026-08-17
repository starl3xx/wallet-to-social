import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * The queue of wallets where two attested sources name different X accounts.
 *
 * These are recorded by every attested ingest and resolved by none of them,
 * deliberately: a disagreement between two owner-attested sources is evidence,
 * not a race for whoever writes last. Until now there was nowhere to read them,
 * which made "queued for review" true and useless.
 *
 * ## What the reachability join adds
 *
 * A conflict on its own is ambiguous. Joined against `x_accounts` it usually
 * is not. Measured across 250 of them: our stored handle no longer reaches
 * anyone 54% of the time, and where both handles resolve, 90% of the time ours
 * belongs to somebody who does not claim the wallet. So a conflict where our
 * side is dead and theirs is live has an obvious reading, and this surfaces that
 * rather than making a person work it out per row.
 *
 * **It still does not decide.** The verdict column is a reading of the evidence,
 * not an action. Nothing here writes to `social_graph`.
 */
export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;
  const limit = Math.min(Number(params.get('limit') ?? 100) || 100, 500);
  const offset = Math.max(Number(params.get('offset') ?? 0) || 0, 0);
  const filter = params.get('filter') ?? 'all';

  try {
    const rows = (await db.execute(sql`
      SELECT
        c.wallet, c.ours, c.our_sources, c.theirs, c.their_source, c.their_user_id,
        c.first_seen_at, c.last_seen_at,
        ox.status AS ours_status, tx.status AS theirs_status,
        g.twitter_verified, g.farcaster, g.data_quality_score
      FROM handle_conflicts c
      JOIN social_graph g ON g.wallet = c.wallet
      LEFT JOIN x_accounts ox ON ox.handle = lower(c.ours)
      LEFT JOIN x_accounts tx ON tx.handle = lower(c.theirs)
      WHERE c.resolved_at IS NULL
        AND CASE ${filter}
              -- The clear-cut ones: what we serve is dead and the other side works.
              WHEN 'ours-dead' THEN ox.status IS NOT NULL AND ox.status <> 'live'
                                    AND tx.status = 'live'
              -- The dangerous ones: both resolve, so ours may be a stranger.
              WHEN 'both-live' THEN ox.status = 'live' AND tx.status = 'live'
              WHEN 'unchecked' THEN ox.status IS NULL OR tx.status IS NULL
              ELSE true
            END
      ORDER BY
        -- Unresolvable-on-our-side first: those are the ones costing a customer
        -- a wasted send today.
        (ox.status IS NOT NULL AND ox.status <> 'live') DESC,
        c.last_seen_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as { rows: Array<Record<string, unknown>> };

    const [counts] = (
      (await db.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE ox.status IS NOT NULL AND ox.status <> 'live'
                             AND tx.status = 'live')::int AS ours_dead,
          count(*) FILTER (WHERE ox.status = 'live' AND tx.status = 'live')::int AS both_live,
          count(*) FILTER (WHERE ox.status IS NULL OR tx.status IS NULL)::int AS unchecked
        FROM handle_conflicts c
        LEFT JOIN x_accounts ox ON ox.handle = lower(c.ours)
        LEFT JOIN x_accounts tx ON tx.handle = lower(c.theirs)
        WHERE c.resolved_at IS NULL
      `)) as unknown as { rows: Array<Record<string, number>> }
    ).rows;

    return NextResponse.json({
      counts,
      conflicts: rows.rows.map((r) => ({
        wallet: r.wallet,
        ours: r.ours,
        oursSources: r.our_sources,
        oursStatus: r.ours_status ?? null,
        theirs: r.theirs,
        theirSource: r.their_source,
        theirsStatus: r.theirs_status ?? null,
        theirUserId: r.their_user_id,
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at,
        farcaster: r.farcaster,
        quality: r.data_quality_score,
        /**
         * A reading, not a decision. Named so nobody mistakes it for one.
         */
        verdict:
          r.ours_status && r.ours_status !== 'live' && r.theirs_status === 'live'
            ? 'ours-unreachable'
            : r.ours_status === 'live' && r.theirs_status === 'live'
              ? 'both-live'
              : 'unchecked',
      })),
      limit,
      offset,
    });
  } catch (error) {
    console.error('Admin conflicts error:', error);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
}
