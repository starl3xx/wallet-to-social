/**
 * The shared shape for ingesting attested wallet-to-account links.
 *
 * Extracted from `lib/ethos.ts` when the second and third sources arrived, and
 * extracted rather than copied for a specific reason: the agreement gate below
 * is subtle, and the first version of it was wrong in production. It wrote the
 * source label onto 2,479 rows whose handle that source had never attested, so
 * the public API reported `attested-social` for evidence naming a different
 * account. Writing that logic once per source would be one more chance to get it
 * wrong per source.
 *
 * An adapter's whole job is to produce `AttestedLink[]`. Everything that decides
 * what reaches the graph lives here.
 *
 * ## The rules every source inherits
 *
 * **Fill only.** A link is written where we hold no handle. It never overwrites
 * one, whatever its own evidence class, because a disagreement between two
 * attested sources is information rather than a race to write last.
 *
 * **The account id is only written next to a handle it belongs to.** If we hold
 * a different handle, no id is written. Storing their id beside our handle would
 * assert that a specific numeric account owns a name it does not own, which is
 * worse than either source alone: it launders a disagreement into a fact.
 *
 * **The source label follows the same gate.** This is the one that was wrong.
 * Keeping our handle but taking their label is the worst of both, and it is
 * invisible in a diff unless you go looking for it.
 *
 * **Conflicts are recorded, never resolved.** Measured across 250 real ones: our
 * stored handle no longer resolves 54% of the time, and where both resolve, 90%
 * of the time ours belongs to somebody who does not claim the wallet.
 *
 * **`last_checked_at` is never touched.** It means the full pipeline ran, and an
 * ingest is not the full pipeline.
 */
import { getDb, socialGraph } from '@/db';
import { sql } from 'drizzle-orm';

/** Rows per statement. What the other sweeps settled on. */
const BATCH = 500;

/** One attested link between an address and an account. */
export interface AttestedLink {
  wallet: string;
  handle: string;
  /**
   * The numeric X account id, where the source provides one that provably
   * belongs to the handle beside it. A handle is a string its owner can change;
   * an id is not. Sources without one leave it null and lose nothing else.
   */
  twitterUserId?: string | null;
}

export interface LinkSource {
  /** Internal identifier written into `social_graph.sources`. Must be mapped in
   *  `lib/api-sources.ts` or it is silently dropped from public responses. */
  id: string;
  /**
   * Quality floor. Must equal what `calculateQualityScore` computes for a wallet
   * carrying only a handle from this source, or the same wallet ends up with one
   * score after an ingest and another after a lookup, with GREATEST keeping
   * whichever is larger. Two numbers for one fact is how a trust line stops
   * meaning anything.
   */
  quality: number;
}

export interface IngestStats {
  links: number;
  /** Addresses two different accounts both claimed, dropped rather than guessed. */
  contested: number;
  newWallets: number;
  filled: number;
  agree: number;
  conflicts: number;
}

/**
 * Drop any address that two different accounts claim.
 *
 * Two reasons, and the second is the one that bites. Postgres refuses an
 * `ON CONFLICT DO UPDATE` that touches the same row twice in one statement, so a
 * duplicate wallet inside a batch fails the whole batch, and it fails it *after*
 * that batch's conflicts have been written.
 *
 * The other reason is that dropping is right anyway. If two accounts each claim
 * an address, at most one is correct and the source cannot say which. A
 * contested address is not attested evidence.
 */
export function dedupeByWallet(links: AttestedLink[]): {
  links: AttestedLink[];
  contested: number;
} {
  const byWallet = new Map<string, AttestedLink>();
  const contested = new Set<string>();
  for (const link of links) {
    const wallet = link.wallet.toLowerCase();
    const existing = byWallet.get(wallet);
    if (existing && existing.handle.toLowerCase() !== link.handle.toLowerCase()) {
      contested.add(wallet);
    }
    byWallet.set(wallet, { ...link, wallet });
  }
  for (const wallet of contested) byWallet.delete(wallet);
  return { links: [...byWallet.values()], contested: contested.size };
}

/**
 * What an ingest is about to change, counted before it changes it.
 *
 * Worth its own query rather than inferring from the upsert's RETURNING. An
 * upsert reports rows written, which on a daily re-run is nearly every row every
 * day and says nothing about whether anything was learned. A source that quietly
 * stopped working would still look busy.
 */
export async function classifyLinks(links: AttestedLink[]): Promise<{
  newWallets: number;
  wouldFill: number;
  agree: number;
  disagree: number;
}> {
  const empty = { newWallets: 0, wouldFill: 0, agree: 0, disagree: 0 };
  const db = getDb();
  if (!db || links.length === 0) return empty;

  const totals = { ...empty };
  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    const result = (await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE g.wallet IS NULL)::int                          AS new_wallets,
        count(*) FILTER (WHERE g.wallet IS NOT NULL
                           AND g.twitter_handle IS NULL)::int                  AS would_fill,
        count(*) FILTER (WHERE g.twitter_handle IS NOT NULL
                           AND lower(g.twitter_handle) = lower(t.handle))::int  AS agree,
        count(*) FILTER (WHERE g.twitter_handle IS NOT NULL
                           AND lower(g.twitter_handle) <> lower(t.handle))::int AS disagree
      FROM unnest(${sql.param(batch.map((l) => l.wallet))}::text[],
                  ${sql.param(batch.map((l) => l.handle))}::text[]) AS t(wallet, handle)
      LEFT JOIN social_graph g ON g.wallet = t.wallet
    `)) as unknown as {
      rows: Array<{ new_wallets: number; would_fill: number; agree: number; disagree: number }>;
    };
    const r = result.rows[0];
    if (!r) continue;
    totals.newWallets += Number(r.new_wallets ?? 0);
    totals.wouldFill += Number(r.would_fill ?? 0);
    totals.agree += Number(r.agree ?? 0);
    totals.disagree += Number(r.disagree ?? 0);
  }
  return totals;
}

/**
 * Record where we and a source name different accounts for the same wallet.
 *
 * Re-derived from the graph rather than from what we are about to send, so a
 * conflict is only recorded when the stored row really does disagree.
 * `last_seen_at` moves on every run, so a conflict that quietly goes away stops
 * being surfaced without anybody deleting a row.
 */
export async function recordConflicts(
  links: AttestedLink[],
  source: LinkSource
): Promise<number> {
  const db = getDb();
  if (!db || links.length === 0) return 0;

  let recorded = 0;
  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    const result = await db.execute(sql`
      INSERT INTO handle_conflicts
        (wallet, platform, ours, our_sources, theirs, their_source, their_user_id,
         first_seen_at, last_seen_at)
      SELECT g.wallet, 'twitter', g.twitter_handle, g.sources, t.handle,
             ${source.id}, nullif(t.user_id, ''), now(), now()
      FROM unnest(${sql.param(batch.map((l) => l.wallet))}::text[],
                  ${sql.param(batch.map((l) => l.handle))}::text[],
                  ${sql.param(batch.map((l) => l.twitterUserId ?? ''))}::text[])
             AS t(wallet, handle, user_id)
      JOIN social_graph g ON g.wallet = t.wallet
      WHERE g.twitter_handle IS NOT NULL
        AND lower(g.twitter_handle) <> lower(t.handle)
      ON CONFLICT (wallet, platform, their_source) DO UPDATE SET
        ours          = EXCLUDED.ours,
        our_sources   = EXCLUDED.our_sources,
        theirs        = EXCLUDED.theirs,
        their_user_id = EXCLUDED.their_user_id,
        last_seen_at  = now(),
        -- A conflict that changed shape is a new conflict, so reopen it.
        resolved_at   = CASE
          WHEN handle_conflicts.theirs <> EXCLUDED.theirs
            OR handle_conflicts.ours <> EXCLUDED.ours
          THEN NULL ELSE handle_conflicts.resolved_at END
      RETURNING wallet
    `);
    recorded += (result as unknown as { rows?: unknown[] })?.rows?.length ?? 0;
  }
  return recorded;
}

/**
 * Write the links, obeying every rule in this module's header.
 *
 * The three `CASE` expressions all test the same thing, and they have to: the
 * handle, the account id and the source label must agree about whether this
 * source is describing the account we already hold. Any one of them written
 * unconditionally reintroduces the bug this module exists to prevent.
 */
export async function upsertLinks(
  links: AttestedLink[],
  source: LinkSource
): Promise<number> {
  const db = getDb();
  if (!db || links.length === 0) return 0;

  let upserted = 0;
  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    const now = new Date();

    await db
      .insert(socialGraph)
      .values(
        batch.map((l) => ({
          wallet: l.wallet,
          twitterHandle: l.handle,
          twitterUrl: `https://x.com/${l.handle}`,
          twitterUserId: l.twitterUserId ?? null,
          sources: [source.id],
          twitterVerified: true,
          dataQualityScore: source.quality,
          firstSeenAt: now,
          lastUpdatedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: socialGraph.wallet,
        set: {
          twitterHandle: sql`COALESCE(social_graph.twitter_handle, EXCLUDED.twitter_handle)`,
          twitterUrl: sql`COALESCE(social_graph.twitter_url, EXCLUDED.twitter_url)`,
          twitterUserId: sql`CASE
            WHEN social_graph.twitter_handle IS NULL
              OR lower(social_graph.twitter_handle) = lower(EXCLUDED.twitter_handle)
            THEN COALESCE(EXCLUDED.twitter_user_id, social_graph.twitter_user_id)
            ELSE social_graph.twitter_user_id
          END`,
          twitterVerified: sql`CASE
            WHEN social_graph.twitter_handle IS NULL AND EXCLUDED.twitter_handle IS NOT NULL
            THEN true ELSE social_graph.twitter_verified
          END`,
          sources: sql`CASE
            WHEN social_graph.twitter_handle IS NOT NULL
              AND lower(social_graph.twitter_handle) <> lower(EXCLUDED.twitter_handle)
            THEN social_graph.sources
            WHEN ${source.id} = ANY(COALESCE(social_graph.sources, ARRAY[]::text[]))
            THEN social_graph.sources
            ELSE array_append(COALESCE(social_graph.sources, ARRAY[]::text[]), ${source.id}::text)
          END`,
          dataQualityScore: sql`CASE
            WHEN social_graph.twitter_handle IS NOT NULL
              AND lower(social_graph.twitter_handle) <> lower(EXCLUDED.twitter_handle)
            THEN social_graph.data_quality_score
            ELSE GREATEST(COALESCE(social_graph.data_quality_score, 0), ${source.quality})
          END`,
          lastUpdatedAt: sql`CASE
            WHEN social_graph.twitter_handle IS NULL AND EXCLUDED.twitter_handle IS NOT NULL
            THEN EXCLUDED.last_updated_at ELSE social_graph.last_updated_at
          END`,
        },
      });

    upserted += batch.length;
  }
  return upserted;
}

/**
 * The whole ingest, in the order that keeps the numbers honest.
 *
 * Classify and record conflicts BEFORE the upsert, both for the same reason:
 * afterwards a wallet we just filled agrees with itself and a wallet we had
 * never seen looks like an old friend. Read the state you are about to change.
 */
export async function ingestLinks(
  rawLinks: AttestedLink[],
  source: LinkSource
): Promise<IngestStats> {
  const { links, contested } = dedupeByWallet(rawLinks);

  const counts = await classifyLinks(links);
  const conflicts = await recordConflicts(links, source);
  await upsertLinks(links, source);

  return {
    links: links.length,
    contested,
    newWallets: counts.newWallets,
    filled: counts.wouldFill,
    agree: counts.agree,
    conflicts,
  };
}
