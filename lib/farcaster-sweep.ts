/**
 * Farcaster protocol-wide ingest: FID → verified wallets → social_graph.
 *
 * Sweeps Neynar's /v2/farcaster/user/bulk endpoint (100 FIDs per call,
 * 1 credit per FID — a full sweep of the ~3.3M-FID network costs ~3.3M of the
 * free tier's 10M monthly credits) and upserts every ETH address attached to
 * a Farcaster account into social_graph.
 *
 * Two callers:
 *  - scripts/farcaster-sweep.ts  — full sweeps (monthly, GitHub Actions or local)
 *  - /api/cron/farcaster-sweep   — daily incremental (new FIDs only; FIDs are
 *    sequential, so "new" = above the highest fc_fid already stored)
 *
 * Design constraints, learned the hard way elsewhere in this codebase:
 *  - Swept rows must NOT look fully-checked: they carry Farcaster data but the
 *    wallet was never run through Twitter resolution. They get quality < 70
 *    (medium tier: served as base data, still resolved on first real lookup)
 *    and NO last_checked_at — that column means "full pipeline ran".
 *  - last_updated_at only moves when the Farcaster identity actually changes.
 *    A monthly re-sweep that bumped it on 1M+ rows would light up "new
 *    matches" badges on every saved lookup that contains any Farcaster wallet.
 *  - Never overwrite Twitter/ENS/Lens/GitHub fields — sweep data is
 *    authoritative for Farcaster fields only.
 */

import { getDb, socialGraph } from '@/db';
import { sql } from 'drizzle-orm';
import { cleanTwitterHandle } from './twitter-cleaner';
import { checkBackgroundBudget, recordSpend } from './neynar-budget';

const NEYNAR_BULK_URL = 'https://api.neynar.com/v2/farcaster/user/bulk';
const FIDS_PER_CALL = 100;
// Free tier allows 600 RPM per endpoint = 10 rps. Stay under it.
const CONCURRENT_CALLS = 4;
const DELAY_BETWEEN_ROUNDS_MS = 500;
const MAX_RETRIES = 3;

export interface SweepStats {
  fidsRequested: number;
  fidsFound: number;
  fidsWithEthAddress: number;
  walletsUpserted: number;
  apiCalls: number;
  failedCalls: number;
  /** Set when the run stopped early because the credit budget ran out. */
  budgetStopped?: boolean;
  /** FID to resume from when budgetStopped — nothing at or above it was swept. */
  budgetStoppedAtFid?: number;
  budgetReason?: string;
}

interface NeynarUser {
  fid: number;
  username?: string;
  follower_count?: number;
  custody_address?: string;
  verified_addresses?: { eth_addresses?: string[] };
  /**
   * Cryptographically attested off-platform accounts. This arrives in the same
   * bulk response as everything else above — reading it costs nothing extra.
   */
  verified_accounts?: Array<{ platform?: string; username?: string }>;
}

interface SweepRow {
  wallet: string;
  farcaster: string;
  fcFid: number;
  fcFollowers: number | null;
  /** Attested X handle from verified_accounts, or null if the user has none. */
  twitterHandle: string | null;
}

/** Highest FID we already hold — the incremental sweep's starting point. */
export async function getMaxKnownFid(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const [row] = await db
    .select({
      maxFid: sql<number>`COALESCE(MAX(${socialGraph.fcFid}), 0)::int`,
    })
    .from(socialGraph);
  return row?.maxFid ?? 0;
}

/**
 * Find the network's current highest registered FID by probing user/bulk.
 * FIDs are assigned sequentially, so exponential probe + binary search on
 * "does this FID exist" converges in ~40 calls.
 */
export async function getNetworkMaxFid(
  apiKey: string,
  hint: number
): Promise<number> {
  const exists = async (fid: number): Promise<boolean> => {
    const users = await fetchUserBatch([fid], apiKey);
    if (users === null) {
      // A failed probe must not read as "FID doesn't exist" — the binary
      // search would converge below the real frontier and the sweep would
      // silently skip the tail. Fail loudly; callers retry next run.
      throw new Error(`Network max FID probe failed at fid ${fid}`);
    }
    return users.length > 0;
  };

  let low = Math.max(1, hint);
  let high = low;
  // Expand until we pass the frontier
  let step = 10000;
  while (await exists(high)) {
    low = high;
    high += step;
    step *= 2;
    if (high > 100_000_000) break; // sanity bound
  }
  // Binary search the boundary
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (await exists(mid)) low = mid;
    else high = mid;
  }
  return low;
}

async function fetchUserBatch(
  fids: number[],
  apiKey: string
): Promise<NeynarUser[] | null> {
  // Bulk costs 1 credit per FID requested. Recorded once per batch, OUTSIDE the
  // retry loop: a 429 or 5xx is not a billed request, so counting every attempt
  // would invent spend that never happened — and during a rate-limit burst that
  // phantom spend could exhaust the background ceiling and freeze every
  // background job until the period rolls over.
  void recordSpend(fids.length);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${NEYNAR_BULK_URL}?fids=${fids.join(',')}`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 404) return []; // none of these FIDs exist
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as { users?: NeynarUser[] };
      return json.users ?? [];
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return null;
}

function usersToRows(users: NeynarUser[]): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const user of users) {
    if (!user.username || !user.fid) continue;
    const addresses = new Set<string>();
    for (const addr of user.verified_addresses?.eth_addresses ?? []) {
      if (addr?.startsWith('0x') && addr.length === 42)
        addresses.add(addr.toLowerCase());
    }
    // Custody addresses appear in holder lists too (Farcaster-native users);
    // linking them to the profile is the same public protocol data
    const custody = user.custody_address;
    if (custody?.startsWith('0x') && custody.length === 42)
      addresses.add(custody.toLowerCase());

    // Same extraction as lib/neynar.ts — an X account listed in
    // verified_accounts was proven by signature, so it is the strongest
    // Twitter signal we have anywhere in the pipeline.
    const x = user.verified_accounts?.find(
      (acc) => acc.platform === 'twitter' || acc.platform === 'x'
    );
    const twitterHandle = x?.username ? cleanTwitterHandle(x.username) : null;

    for (const wallet of addresses) {
      rows.push({
        wallet,
        farcaster: user.username,
        fcFid: user.fid,
        fcFollowers: user.follower_count ?? null,
        twitterHandle: twitterHandle || null,
      });
    }
  }
  return rows;
}

/**
 * Upsert sweep rows. Farcaster fields are authoritative from the sweep;
 * everything else is untouched. last_updated_at moves only on identity change.
 */
async function upsertSweepRows(rows: SweepRow[]): Promise<number> {
  const db = getDb();
  if (!db || rows.length === 0) return 0;

  // One row per wallet — a wallet verified by multiple FIDs keeps the last
  // (rare; almost always the same person's accounts)
  const byWallet = new Map<string, SweepRow>();
  for (const r of rows) byWallet.set(r.wallet, r);
  const deduped = Array.from(byWallet.values());

  const now = new Date();
  let upserted = 0;

  for (let i = 0; i < deduped.length; i += 500) {
    const batch = deduped.slice(i, i + 500).map((r) => ({
      wallet: r.wallet,
      farcaster: r.farcaster,
      farcasterUrl: `https://warpcast.com/${r.farcaster}`,
      fcFid: r.fcFid,
      fcFollowers: r.fcFollowers,
      twitterHandle: r.twitterHandle,
      twitterUrl: r.twitterHandle ? `https://x.com/${r.twitterHandle}` : null,
      // The handle came from verified_accounts, i.e. proven by signature
      twitterVerified: r.twitterHandle != null,
      sources: ['farcaster_sweep'],
      farcasterVerified: true,
      // 45 = farcaster(20) + farcaster_sweep(25), or 65 with an attested
      // twitter(20). Both stay below the 70 trust line on purpose: the sweep
      // still knows nothing about this wallet's ENS/Web3Bio side, so the row
      // must not read as "fully resolved" — see module comment.
      dataQualityScore: r.twitterHandle ? 65 : 45,
      firstSeenAt: now,
      lastUpdatedAt: now,
      lookupCount: 0,
    }));

    await db
      .insert(socialGraph)
      .values(batch)
      .onConflictDoUpdate({
        target: socialGraph.wallet,
        set: {
          farcaster: sql`EXCLUDED.farcaster`,
          farcasterUrl: sql`EXCLUDED.farcaster_url`,
          fcFid: sql`EXCLUDED.fc_fid`,
          fcFollowers: sql`EXCLUDED.fc_followers`,
          farcasterVerified: sql`true`,
          // Twitter precedence, tightest rule first:
          //   1. A 'manual' row is admin-curated and always wins.
          //   2. An attested handle from this sweep is otherwise authoritative.
          //   3. If the user has NO attested X, only clear the stored handle on
          //      rows where this sweep is the sole source — there the handle
          //      could only have come from us, so it is ours to retract. On a
          //      row that other sources also wrote, leave their value alone.
          //   4. A handle we have already replaced (twitter_renamed_from) is
          //      the dead string Farcaster still carries. Writing it back would
          //      undo the conflict resolver's work on every monthly sweep and
          //      reopen the conflict at the next attested ingest, so the
          //      accepted handle wins.
          twitterHandle: sql`CASE
            WHEN 'manual' = ANY(COALESCE(${socialGraph.sources}, ARRAY[]::text[])) THEN ${socialGraph.twitterHandle}
            WHEN lower(EXCLUDED.twitter_handle) = lower(${socialGraph.twitterRenamedFrom}) THEN ${socialGraph.twitterHandle}
            WHEN EXCLUDED.twitter_handle IS NOT NULL THEN EXCLUDED.twitter_handle
            WHEN COALESCE(${socialGraph.sources}, ARRAY[]::text[]) = ARRAY['farcaster_sweep']::text[] THEN NULL
            ELSE ${socialGraph.twitterHandle}
          END`,
          twitterUrl: sql`CASE
            WHEN 'manual' = ANY(COALESCE(${socialGraph.sources}, ARRAY[]::text[])) THEN ${socialGraph.twitterUrl}
            WHEN lower(EXCLUDED.twitter_handle) = lower(${socialGraph.twitterRenamedFrom}) THEN ${socialGraph.twitterUrl}
            WHEN EXCLUDED.twitter_handle IS NOT NULL THEN EXCLUDED.twitter_url
            WHEN COALESCE(${socialGraph.sources}, ARRAY[]::text[]) = ARRAY['farcaster_sweep']::text[] THEN NULL
            ELSE ${socialGraph.twitterUrl}
          END`,
          twitterVerified: sql`CASE
            WHEN 'manual' = ANY(COALESCE(${socialGraph.sources}, ARRAY[]::text[])) THEN ${socialGraph.twitterVerified}
            WHEN lower(EXCLUDED.twitter_handle) = lower(${socialGraph.twitterRenamedFrom}) THEN ${socialGraph.twitterVerified}
            WHEN EXCLUDED.twitter_handle IS NOT NULL THEN true
            WHEN COALESCE(${socialGraph.sources}, ARRAY[]::text[]) = ARRAY['farcaster_sweep']::text[] THEN false
            ELSE ${socialGraph.twitterVerified}
          END`,
          sources: sql`CASE WHEN 'farcaster_sweep' = ANY(${socialGraph.sources}) THEN ${socialGraph.sources} ELSE array_append(COALESCE(${socialGraph.sources}, ARRAY[]::text[]), 'farcaster_sweep') END`,
          // GREATEST everywhere except the one case where the score must fall:
          // a sweep-only row whose attested handle we just retracted above. It
          // scored 65 with that handle; leaving GREATEST would keep the
          // twitter(20) bonus on a row that no longer has a twitter handle, and
          // since every writer uses GREATEST no later lookup could correct it.
          dataQualityScore: sql`CASE
            WHEN COALESCE(${socialGraph.sources}, ARRAY[]::text[]) = ARRAY['farcaster_sweep']::text[]
                 AND EXCLUDED.twitter_handle IS NULL
              THEN EXCLUDED.data_quality_score
            ELSE GREATEST(COALESCE(${socialGraph.dataQualityScore}, 0), EXCLUDED.data_quality_score)
          END`,
          // Only an actual identity change counts as an update — follower
          // drift must not re-trigger "new matches" badges
          // Gaining or changing an attested X handle is an identity change too.
          // Guarded on EXCLUDED being non-null: when Neynar reports no X we may
          // deliberately keep another source's handle, and that is not a change.
          // A refused rename (EXCLUDED equals twitter_renamed_from, handled
          // above) is not a change either: nothing served moved, and bumping
          // the timestamp would raise a false "new matches" badge on every
          // resolved wallet at every full sweep.
          lastUpdatedAt: sql`CASE WHEN ${socialGraph.farcaster} IS DISTINCT FROM EXCLUDED.farcaster
              OR ${socialGraph.fcFid} IS DISTINCT FROM EXCLUDED.fc_fid
              OR (EXCLUDED.twitter_handle IS NOT NULL
                  AND lower(EXCLUDED.twitter_handle) IS DISTINCT FROM lower(${socialGraph.twitterRenamedFrom})
                  AND ${socialGraph.twitterHandle} IS DISTINCT FROM EXCLUDED.twitter_handle)
            THEN EXCLUDED.last_updated_at ELSE ${socialGraph.lastUpdatedAt} END`,
        },
      });
    upserted += batch.length;
  }

  return upserted;
}

/**
 * Revocation handling: the sweep only ever upserts wallets CURRENTLY attached
 * to a FID, so a wallet whose verification was removed would keep its stale
 * farcaster mapping forever (and keep appearing in reverse lookups). Full
 * sweeps therefore track every wallet they see in a scratch table; after a
 * clean, complete sweep, pure-sweep rows that were NOT seen get their
 * Farcaster fields cleared.
 */
const RESUME_STATE_KEY = 'farcaster_sweep_resume';

/**
 * A full sweep that ran out of credit, and where to pick it up.
 *
 * The sweep always knew: `budgetStoppedAtFid` has been in `SweepStats` all
 * along and the CLI printed a resume command. Nothing wrote it down, so the
 * monthly `--full` restarted from FID 1, spent its whole budget re-covering
 * ground, stopped in roughly the same place, and abandoned another ~580 MB seen
 * table.
 *
 * ## Why there is no seen table in here
 *
 * The obvious design carries the seen table across segments so revocation
 * cleanup can run once the segments together cover the range. It is wrong, and
 * dangerously so.
 *
 * `cleanupRevokedWallets` clears every pure-sweep row NOT in the seen table, and
 * guards that with a 100,000-row floor and a "seen >= 90% of upserts" ratio.
 * Both are per-table. Accumulate the table across segments and the guards start
 * describing the EARLIER segments: a final segment that sweeps its whole range
 * and silently returns nothing (a Neynar 404, which `fetchUserBatch` maps to
 * `[]`, or a renamed response field) adds zero wallets, increments no
 * `failedCalls`, sets no `budgetStopped`, and sails through both checks on the
 * strength of rows another month put there. Cleanup then clears every
 * pure-sweep row in the range that segment was supposed to cover, and deletes
 * outright the ones the sweep was the only source for. Order 10^6 rows.
 *
 * The floor exists precisely to stop that: its comment says "a sweep that
 * 'succeeded' with ~zero results must never reach cleanup". On a single-run
 * sweep it works, because the count really is ~0. Spreading the table over
 * segments is what defeats it.
 *
 * The anchor does not save it either. `upsertSweepRows` deliberately leaves
 * `last_updated_at` alone unless the Farcaster identity changed, so most
 * pure-sweep rows keep a months-old timestamp and the `last_updated_at <
 * sweepStartedAt` clause excludes almost nothing.
 *
 * So: a resume sweeps, and does not track, and does not clean up. Revocation
 * cleanup remains what it was, something only a sweep that covers the whole
 * range in one run may do. That is no worse than before this checkpoint
 * existed, since such a sweep has never once completed, and it buys the thing
 * that was actually asked for: the range gets covered instead of re-covered.
 */
export interface SweepCheckpoint {
  /** Nothing at or above this was swept. Resume here. */
  nextFid: number;
  /** The network max the original run probed. Frozen for the whole resume. */
  endFid: number;
  /** How many segments have run. Diagnostic. */
  segments: number;
  /** When the first segment began. Diagnostic; nothing decides on it. */
  startedAt: string;
}

/** A checkpoint is only usable if its range is two real, ordered integers. */
export function isUsableCheckpoint(cp: unknown): cp is SweepCheckpoint {
  if (!cp || typeof cp !== 'object') return false;
  const c = cp as Record<string, unknown>;
  return (
    Number.isSafeInteger(c.nextFid) &&
    Number.isSafeInteger(c.endFid) &&
    (c.nextFid as number) >= 1 &&
    (c.nextFid as number) <= (c.endFid as number)
  );
}

export async function readSweepCheckpoint(): Promise<SweepCheckpoint | null> {
  const db = getDb();
  if (!db) return null;
  const result = (await db.execute(sql`
    SELECT value FROM ingest_state WHERE name = ${RESUME_STATE_KEY}
  `)) as unknown as { rows: Array<{ value: SweepCheckpoint | null }> };
  return result.rows[0]?.value ?? null;
}

export async function writeSweepCheckpoint(cp: SweepCheckpoint): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${RESUME_STATE_KEY}, ${JSON.stringify(cp)}::jsonb, now())
    ON CONFLICT (name) DO UPDATE SET
      value = ${JSON.stringify(cp)}::jsonb, updated_at = now()
  `);
}

/**
 * Clear the checkpoint by writing JSON null, not by deleting the row.
 *
 * CI runs the sweep as `sweep_runner`, which holds SELECT, INSERT and UPDATE on
 * `ingest_state` and **not DELETE** (verified against production 2026-08-24).
 * A `DELETE` here would have thrown "permission denied" at the worst available
 * moment: on the success path, immediately AFTER `cleanupRevokedWallets` had
 * cleared rows and dropped the seen table, leaving a stale checkpoint pointing
 * at a table that no longer exists. It passes locally, where the owner role has
 * DELETE, which is exactly the shape of bug CLAUDE.md warns about.
 *
 * An upsert to `'null'::jsonb` needs only the privileges the role already has.
 * The column is NOT NULL, and JSON null satisfies that while reading back as a
 * JS `null`, so `readSweepCheckpoint` treats it as absent with no extra branch.
 * Granting DELETE would also work, and would widen a CI role's rights on a
 * table it otherwise only appends to.
 */
export async function clearSweepCheckpoint(): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${RESUME_STATE_KEY}, 'null'::jsonb, now())
    ON CONFLICT (name) DO UPDATE SET value = 'null'::jsonb, updated_at = now()
  `);
}

/**
 * Drop a seen table that can never be used again.
 *
 * A budget-stopped `--full` calls this on its way out. Its table cannot serve a
 * later cleanup, because cleanup requires a sweep that covered the whole range
 * in one run, so keeping it "for forensics" only accumulates storage: the first
 * one sat at 3,676,509 rows and 580 MB for eleven days.
 *
 * The name is digits-only by construction (see `beginSeenTracking`), which is
 * what makes it safe to interpolate as an identifier.
 */
export async function dropSeenTable(name: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(sql`DROP TABLE IF EXISTS ${sql.raw(name)}`);
}

export async function beginSeenTracking(): Promise<string> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  // Per-run table name so concurrent full sweeps (scheduled + manual, or
  // Actions + local CLI) can never truncate each other's seen set. Digits
  // only — safe to interpolate as an identifier.
  const tableName = `farcaster_sweep_seen_${Date.now()}`;
  // A LOGGED table, deliberately: Neon does not persist UNLOGGED tables
  // across compute restarts, and a restart mid-sweep would silently empty
  // the seen set — cleanup would then clear nearly every sweep row as
  // "revoked". WAL overhead on ~2.5M small inserts is acceptable.
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS ${sql.raw(tableName)} (wallet text PRIMARY KEY)`
  );
  return tableName;
}

/**
 * Clear Farcaster fields on rows the completed full sweep did not see.
 *
 * Only safe after a COMPLETE sweep with zero failed calls — wallets in a
 * failed batch would be absent from the seen table and wrongly cleared, so
 * callers must check stats.failedCalls first.
 *
 * Guards:
 *  - only pure sweep rows: Farcaster evidence from a real lookup ('neynar')
 *    or an admin ('manual') is left for the staleness refresh path to correct
 *  - only rows untouched since the sweep started: an incremental cron run
 *    that raced this sweep writes fresh last_updated_at and is protected
 *
 * Rows left with no socials, no sources, and no full-pipeline check are
 * deleted outright rather than kept as empty husks.
 */
export async function cleanupRevokedWallets(
  sweepStartedAt: Date,
  seenTable: string,
  expectedSeenCount: number,
  /**
   * The sweep that produced `seenTable` covered its ENTIRE range. Cleanup
   * clears every pure-sweep wallet absent from the seen table, so running it
   * after a partial sweep would treat every FID the sweep never reached as
   * revoked and wipe their Farcaster data.
   *
   * The guards below cannot detect this on their own: a sweep that stops
   * halfway has a proportionally smaller seen table AND a proportionally
   * smaller upsert count, so the ratio check still passes. It has to be
   * asserted by the caller.
   */
  sweepWasComplete: boolean
): Promise<{ cleared: number; deleted: number }> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  if (!sweepWasComplete) {
    throw new Error(
      `Refusing revocation cleanup: the sweep did not cover its full range, so ` +
        `unswept FIDs would be misread as revoked (seen table ${seenTable} kept)`
    );
  }

  // Integrity guards. Cleanup clears everything NOT in the seen table, so a
  // deficient seen set mass-clears healthy rows. Two independent checks:
  //
  // 1. Absolute floor: the network holds >1M wallet-attached FIDs, so any
  //    legitimate full sweep sees hundreds of thousands of wallets. A sweep
  //    that "succeeded" with ~zero results (API returning 200s with empty
  //    user arrays, a response-shape change) must never reach cleanup —
  //    a ratio check alone passes trivially when both counts are 0.
  // 2. Ratio: seen must be >= 90% of upserts (upsert counts can slightly
  //    exceed distinct wallets when one wallet is attached to several FIDs).
  //
  // On failure: abort and keep the table for forensics.
  const MIN_PLAUSIBLE_SWEEP_WALLETS = 100_000;
  const [seenRow] = (
    (await db.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.raw(seenTable)}`
    )) as unknown as { rows: Array<{ n: number }> }
  ).rows;
  const seenCount = seenRow?.n ?? 0;
  if (
    seenCount < MIN_PLAUSIBLE_SWEEP_WALLETS ||
    seenCount < expectedSeenCount * 0.9
  ) {
    throw new Error(
      `Seen-table integrity check failed: ${seenCount} rows (expected >= ${MIN_PLAUSIBLE_SWEEP_WALLETS} and >= 90% of ${expectedSeenCount} upserted) — refusing to run revocation cleanup (table ${seenTable} kept)`
    );
  }

  const cleared = await db.execute(sql`
    UPDATE social_graph
    SET farcaster = NULL,
        farcaster_url = NULL,
        fc_fid = NULL,
        fc_followers = NULL,
        farcaster_verified = false,
        -- The sweep now also writes attested X handles, so a revoked FID must
        -- not leave one stranded. Only clear where this sweep is the sole
        -- source: on a row web3bio or ENS also wrote, the handle may be theirs.
        -- (All SET expressions see the pre-UPDATE row, so the sources array
        -- read here is the original one, not the array_remove result below.)
        twitter_handle = CASE WHEN sources = ARRAY['farcaster_sweep']::text[]
                              THEN NULL ELSE twitter_handle END,
        twitter_url = CASE WHEN sources = ARRAY['farcaster_sweep']::text[]
                           THEN NULL ELSE twitter_url END,
        twitter_verified = CASE WHEN sources = ARRAY['farcaster_sweep']::text[]
                                THEN false ELSE twitter_verified END,
        sources = array_remove(sources, 'farcaster_sweep'),
        last_updated_at = now()
    WHERE 'farcaster_sweep' = ANY(sources)
      AND NOT (sources && ARRAY['neynar', 'manual'])
      AND last_updated_at < ${sweepStartedAt}
      AND wallet NOT IN (SELECT wallet FROM ${sql.raw(seenTable)})
  `);

  const deleted = await db.execute(sql`
    DELETE FROM social_graph
    WHERE twitter_handle IS NULL AND farcaster IS NULL AND ens_name IS NULL
      AND lens IS NULL AND github IS NULL
      AND last_checked_at IS NULL
      AND (sources IS NULL OR sources = '{}')
  `);

  await db.execute(sql`DROP TABLE IF EXISTS ${sql.raw(seenTable)}`);

  return {
    cleared: (cleared as unknown as { rowCount?: number }).rowCount ?? 0,
    deleted: (deleted as unknown as { rowCount?: number }).rowCount ?? 0,
  };
}

/**
 * Sweep a FID range [startFid, endFid] and ingest every attached ETH address.
 * Paced for the free tier's 600 RPM. onProgress fires per completed round.
 * trackSeen records every wallet into farcaster_sweep_seen for the
 * post-full-sweep revocation cleanup.
 */
export async function sweepFidRange(
  startFid: number,
  endFid: number,
  apiKey: string,
  onProgress?: (stats: SweepStats, lastFid: number) => void,
  opts?: { seenTable?: string }
): Promise<SweepStats> {
  const stats: SweepStats = {
    fidsRequested: 0,
    fidsFound: 0,
    fidsWithEthAddress: 0,
    walletsUpserted: 0,
    apiCalls: 0,
    failedCalls: 0,
  };

  const batches: number[][] = [];
  for (let fid = startFid; fid <= endFid; fid += FIDS_PER_CALL) {
    batches.push(
      Array.from(
        { length: Math.min(FIDS_PER_CALL, endFid - fid + 1) },
        (_, i) => fid + i
      )
    );
  }

  for (let i = 0; i < batches.length; i += CONCURRENT_CALLS) {
    const round = batches.slice(i, i + CONCURRENT_CALLS);

    // Stop cleanly at the background ceiling rather than running the account
    // into overage — Neynar pauses ALL API requests on continued overuse, which
    // would take the live lookup path down with the sweep. Checked per round so
    // a long sweep yields as soon as the budget is gone; the caller keeps the
    // stats it earned and the range can be resumed from `budgetStoppedAtFid`.
    const roundCredits = round.reduce((n, b) => n + b.length, 0);
    const budget = await checkBackgroundBudget(roundCredits);
    if (!budget.allowed) {
      stats.budgetStopped = true;
      stats.budgetStoppedAtFid = round[0][0];
      stats.budgetReason = budget.reason;
      console.warn(`Sweep halted at FID ${round[0][0]}: ${budget.reason}`);
      break;
    }

    const results = await Promise.all(
      round.map((b) => fetchUserBatch(b, apiKey))
    );

    const users: NeynarUser[] = [];
    for (let j = 0; j < round.length; j++) {
      stats.apiCalls++;
      stats.fidsRequested += round[j].length;
      const r = results[j];
      if (r === null) {
        stats.failedCalls++;
        continue;
      }
      users.push(...r);
    }

    stats.fidsFound += users.length;
    const rows = usersToRows(users);
    stats.fidsWithEthAddress += new Set(rows.map((r) => r.fcFid)).size;
    stats.walletsUpserted += await upsertSweepRows(rows);

    if (opts?.seenTable && rows.length > 0) {
      const db = getDb();
      if (db) {
        const wallets = Array.from(new Set(rows.map((r) => r.wallet)));
        // Explicit VALUES rows — drizzle binds a JS array as a ($1, $2, …)
        // record, which Postgres can't cast to text[]
        await db.execute(sql`
          INSERT INTO ${sql.raw(opts.seenTable)} (wallet)
          VALUES ${sql.join(
            wallets.map((w) => sql`(${w})`),
            sql`, `
          )}
          ON CONFLICT DO NOTHING
        `);
      }
    }

    onProgress?.(
      stats,
      round[round.length - 1][round[round.length - 1].length - 1]
    );

    if (i + CONCURRENT_CALLS < batches.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_ROUNDS_MS));
    }
  }

  return stats;
}
