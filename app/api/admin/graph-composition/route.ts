import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import {
  publicSources,
  ATTESTED_SOURCE_IDS,
  type PublicSource,
} from '@/lib/api-sources';

export const runtime = 'nodejs';
// Two aggregate scans of a multi-million-row table. Fine for a button in the
// admin, not for anything a customer can reach.
export const maxDuration = 60;

/**
 * What the graph is made of, counted live.
 *
 * Three questions, one payload:
 *  - How big is the graph, and how much of it resolves to a person
 *    (topline)?
 *  - Which sources built it, and which of them know wallets nobody else
 *    knows (per-source: `wallets` is rows carrying the label, `sole` is rows
 *    where it is the ONLY label, which is the honest "best source" metric,
 *    since a source that only relabels wallets others already found added
 *    breadth to nothing)?
 *  - How much of the X side is still alive (`x_accounts` by status)?
 *
 * Per-source rows also carry the public evidence class the id maps to, so
 * the pane can mark attested classes without keeping its own copy of the
 * allowlist. An id the allowlist does not name comes back `unmapped`, which
 * on this pane is a finding rather than a leak: an unmapped id is invisible
 * on the public API, and the place to notice that is here.
 *
 * `sources = ARRAY['none']` rows are persisted negatives (checked, nothing
 * found). They count toward the total and toward nothing else, and 'none' is
 * excluded from the source table because it marks an absence, not a source.
 */
export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  try {
    const topline = (await db.execute(sql`
      SELECT
        count(*)::int                                                        AS total,
        count(*) FILTER (WHERE twitter_handle IS NOT NULL
                            OR farcaster IS NOT NULL
                            OR ens_name IS NOT NULL
                            OR lens IS NOT NULL
                            OR github IS NOT NULL)::int                      AS with_any,
        count(*) FILTER (WHERE twitter_handle IS NOT NULL)::int              AS with_x,
        count(*) FILTER (WHERE farcaster IS NOT NULL)::int                   AS with_fc,
        count(*) FILTER (WHERE twitter_handle IS NOT NULL
                           AND farcaster IS NOT NULL)::int                   AS with_both,
        count(*) FILTER (WHERE twitter_handle IS NOT NULL
                           AND sources && ${sql.param([...ATTESTED_SOURCE_IDS])}::text[])::int AS x_attested,
        count(*) FILTER (WHERE sources = ARRAY['none'])::int                 AS negatives
      FROM social_graph
    `)) as unknown as {
      rows: Array<{
        total: number;
        with_any: number;
        with_x: number;
        with_fc: number;
        with_both: number;
        x_attested: number;
        negatives: number;
      }>;
    };

    const perSource = (await db.execute(sql`
      SELECT
        s                                                                    AS source,
        count(*)::int                                                        AS wallets,
        count(*) FILTER (WHERE cardinality(array_remove(g.sources, 'none')) = 1)::int AS sole,
        count(*) FILTER (WHERE g.twitter_handle IS NOT NULL)::int            AS with_x,
        count(*) FILTER (WHERE g.farcaster IS NOT NULL)::int                 AS with_fc
      FROM social_graph g, unnest(g.sources) AS s
      WHERE s <> 'none'
      GROUP BY s
      ORDER BY wallets DESC
    `)) as unknown as {
      rows: Array<{
        source: string;
        wallets: number;
        sole: number;
        with_x: number;
        with_fc: number;
      }>;
    };

    const reachability = (await db.execute(sql`
      SELECT status, count(*)::int AS handles
      FROM x_accounts
      GROUP BY status
    `)) as unknown as {
      rows: Array<{ status: string; handles: number }>;
    };

    // The KYC-attested set is a quality signal, not an identity link: its
    // own table, resynced weekly, joined here rather than stamped on rows.
    const kyc = (await db.execute(sql`
      SELECT
        count(*)::int AS attested,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM social_graph g WHERE g.wallet = v.wallet
        ))::int AS in_graph
      FROM cb_verified_wallets v
    `)) as unknown as {
      rows: Array<{ attested: number; in_graph: number }>;
    };

    const sources = perSource.rows.map((r) => {
      const mapped: PublicSource | 'unmapped' =
        publicSources([r.source])?.[0] ?? 'unmapped';
      return { ...r, class: mapped };
    });

    const xByStatus: Record<string, number> = {};
    for (const r of reachability.rows) xByStatus[r.status] = r.handles;

    return NextResponse.json({
      topline: topline.rows[0],
      sources,
      xByStatus,
      kyc: kyc.rows[0] ?? { attested: 0, in_graph: 0 },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('graph-composition query failed:', error);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
}
