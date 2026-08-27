/**
 * Resolve the handle conflicts that have only one honest reading.
 *
 * ## What a conflict is, and which ones this touches
 *
 * `handle_conflicts` records every wallet where two owner-attested sources name
 * different X accounts. Those rows are written by every attested ingest and
 * were, until now, resolved by none of them: a disagreement between two
 * attested sources is evidence, and a rule that let the last writer win would
 * throw the evidence away.
 *
 * Measured on the open queue on 2026-08-22, 2,914 conflicts fell into three
 * buckets by what `x_accounts` says about each side:
 *
 *     ours reaches nobody, theirs is live    1,602
 *     both live                                637
 *     one side never checked                   494
 *
 * Only the first bucket is resolved here. Our handle reaches nobody: a
 * customer who sends to it reaches nobody, so there is nothing to protect by
 * keeping it. Theirs is live, it was attested by the wallet owner, and in 1,598
 * of the 1,602 the source also supplied the numeric id of the account it meant,
 * which matches the id the live handle resolves to. That is not a guess about
 * a rename. It is the owner's own statement, confirmed against the account.
 *
 * The second bucket is surfaced beside our handle and never swapped, because
 * both accounts reach somebody and the evidence does not say which one the
 * customer wants. The third is not in scope beyond what the first needs: where
 * ours is dead and theirs has never been checked, theirs is checked.
 *
 * ## The rule, exactly
 *
 * A conflict is accepted when every one of these holds at the moment of the
 * write, re-evaluated inside the statement that writes:
 *
 *   1. it is unresolved, on platform `twitter`, and the graph still serves the
 *      handle the conflict calls ours (a row edited since is a different fact);
 *   2. the row is not admin-curated (`'manual'` in `sources` always wins);
 *   3. ours is `not_found` or `unavailable` on a check no older than
 *      `RECHECK_DAYS`;
 *   4. theirs is `live`, with an id, on a check no older than `RECHECK_DAYS`;
 *   5. where the source supplied an account id, it equals the id theirs
 *      resolves to now. A source with no id (EAS) qualifies on liveness.
 *
 * A check older than the window is re-run first, through the same sweep the
 * reachability cron uses, within a credit cap. Freshness is not decoration: a
 * suspension can be lifted and a freed name can be taken, and a swap made on a
 * reading from last month would be a swap made on no reading at all.
 *
 * ## What accepting writes
 *
 * One statement per batch, so a batch is atomic whichever driver is in use
 * (`neon-http`, the default, has no transactions; a single statement with
 * data-modifying CTEs does not need one). The old handle goes to
 * `twitter_renamed_from`, theirs becomes the handle, the id is the source's or
 * failing that the live one, the source joins `sources`, the conflict closes
 * with a named resolution, and the wallet's `wallet_cache` row is deleted so
 * the old handle is not served from cache for up to seven days. Running it
 * twice writes nothing the second time.
 *
 * ## How a swap survives later writers
 *
 * The old handle is still the string Farcaster and the other sources hold,
 * and every writer that carries it back refuses an incoming handle equal to
 * `twitter_renamed_from`: the monthly full sweep (`lib/farcaster-sweep.ts`),
 * the live lookup upsert (`lib/social-graph.ts`, at the JS layer and again at
 * the SQL layer), and the fill-if-empty ingests (`lib/ens-harvest.ts`,
 * `lib/attested-links.ts`). A new social_graph writer that skips this guard
 * reopens the conflict on its first run, so add the guard before the writer
 * ships.
 */
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import {
  CREDITS_PER_LOOKUP,
  sweepHandles,
  type SweepProgress,
} from './x-accounts';

/** How recent a reachability check must be before it is acted on. */
export const RECHECK_DAYS = 7;

/** Credits one daily run may spend on rechecks, unless the env var says otherwise. */
export const DEFAULT_RECHECK_CREDITS = 300;

/**
 * Written to `handle_conflicts.resolution`. A constant, so anything that
 * later groups resolutions by this string finds one spelling of it.
 */
export const RESOLUTION = 'accepted-theirs: ours unreachable';

/**
 * `sweepHandles` reserves three lookups before it starts a handle, and runs a
 * pair of control lookups before the first one. Below this a recheck would
 * spend its controls and resolve nothing.
 */
const MIN_RECHECK_CREDITS = CREDITS_PER_LOOKUP * 3;

/** Rows per accept statement. What the other sweeps settled on. */
const BATCH = 500;

/** Controls every 250 lookups, as the reachability cron does for a short run. */
const CONTROL_EVERY = 250;

/**
 * Why a candidate did not qualify on this pass. One reason per row, chosen in
 * this order, so the counts add up to the candidates.
 *
 * `theirs-not-live` and `id-mismatch` are terminal for the run: no lookup
 * would change them. The other four say which side still needs a look.
 */
export type BlockedReason =
  | 'theirs-not-live'
  | 'id-mismatch'
  | 'ours-unchecked'
  | 'theirs-unchecked'
  | 'ours-stale'
  | 'theirs-stale';

export interface ResolveSample {
  wallet: string;
  ours: string;
  /** What `x_accounts` says about ours: `not_found` or `unavailable`. */
  status: string;
  theirs: string;
  source: string;
}

export interface ResolveOutcome {
  dryRun: boolean;
  /** Unresolved twitter conflicts whose our-side is not known to be live. */
  candidates: number;
  /** Qualified under the rule, after any recheck. */
  eligible: number;
  /**
   * Conflicts closed. Always 0 on a dry run. Below `eligible` where two
   * sources both qualify for one wallet with different handles: one is taken
   * and the other reopens in its new shape on the next ingest.
   */
  accepted: number;
  /** Graph rows rewritten. Below `accepted` when two sources named one account. */
  walletsUpdated: number;
  cacheRowsDeleted: number;
  /**
   * Conflicts closed because neither handle reaches anybody. Nothing was
   * swapped and nothing was chosen: see `closeBothDead`.
   */
  closedBothDead: number;
  /** Inert closures put back on the queue because a side is live again. */
  reopenedBothDead: number;
  blocked: Record<BlockedReason, number>;
  recheck: {
    /** Distinct handles that need a look before their row can qualify. */
    wanted: number;
    /** How many of those this run sent, or would send, within the cap. */
    requested: number;
    progress: SweepProgress | null;
    /** Set when no lookup was made, and why. */
    skipped: string | null;
  };
  sample: ResolveSample[];
}

export interface ResolveOptions {
  /** The resolver key. Empty means rechecks are skipped, acceptance still runs. */
  key: string;
  creditCap: number;
  recheckDays?: number;
  dryRun?: boolean;
  /** Most conflicts to accept in one run. */
  limit?: number;
  /** Absolute epoch-ms ceiling for the recheck, as `sweepHandles` takes it. */
  deadlineAt?: number;
}

interface CandidateRow {
  wallet: string;
  ours: string;
  theirs: string;
  their_source: string;
  their_user_id: string | null;
  last_seen_at: string;
  ours_status: string | null;
  ours_fresh: boolean | null;
  theirs_status: string | null;
  theirs_fresh: boolean | null;
  theirs_user_id: string | null;
}

interface Classified {
  row: CandidateRow;
  reason: BlockedReason | null;
  /** Handles a lookup would have to resolve before this row can qualify. */
  needs: string[];
}

const DEAD = new Set(['not_found', 'unavailable']);

/**
 * Every open conflict whose our-side is not known to be live.
 *
 * A live ours, fresh or stale, is excluded on purpose. Re-checking live
 * handles on a cycle is the reachability sweep's job, and a cap of a few
 * hundred credits spent confirming that live handles are still live would
 * starve the rows this job exists for.
 */
async function loadCandidates(recheckDays: number): Promise<CandidateRow[]> {
  const db = getDb();
  if (!db) return [];
  const result = (await db.execute(sql`
    SELECT
      c.wallet, c.ours, c.theirs, c.their_source, c.their_user_id, c.last_seen_at,
      ox.status AS ours_status,
      (ox.checked_at >= now() - make_interval(days => ${recheckDays}::int)) AS ours_fresh,
      tx.status AS theirs_status,
      (tx.checked_at >= now() - make_interval(days => ${recheckDays}::int)) AS theirs_fresh,
      tx.user_id AS theirs_user_id
    FROM handle_conflicts c
    JOIN social_graph g ON g.wallet = c.wallet
    LEFT JOIN x_accounts ox ON ox.handle = lower(c.ours)
    LEFT JOIN x_accounts tx ON tx.handle = lower(c.theirs)
    WHERE c.resolved_at IS NULL
      AND c.platform = 'twitter'
      AND g.twitter_handle IS NOT NULL
      AND lower(g.twitter_handle) = lower(c.ours)
      AND NOT ('manual' = ANY(COALESCE(g.sources, ARRAY[]::text[])))
      AND (ox.status IS NULL OR ox.status <> 'live')
    ORDER BY c.last_seen_at DESC, c.wallet
  `)) as unknown as { rows: CandidateRow[] };
  return result.rows;
}

function classify(row: CandidateRow): Classified {
  const oursFresh = row.ours_fresh === true;
  const theirsFresh = row.theirs_fresh === true;
  const theirsLive =
    row.theirs_status === 'live' && row.theirs_user_id !== null;

  if (theirsFresh && !theirsLive) {
    return { row, reason: 'theirs-not-live', needs: [] };
  }

  // Terminal whatever the state of ours: no lookup on our side can make the
  // source's id agree with the account theirs resolves to.
  if (
    theirsFresh &&
    row.their_user_id !== null &&
    row.their_user_id !== row.theirs_user_id
  ) {
    return { row, reason: 'id-mismatch', needs: [] };
  }

  const needs: string[] = [];
  if (!oursFresh) needs.push(row.ours.toLowerCase());
  if (!theirsFresh) needs.push(row.theirs.toLowerCase());

  if (row.ours_status === null) return { row, reason: 'ours-unchecked', needs };
  if (row.theirs_status === null)
    return { row, reason: 'theirs-unchecked', needs };
  if (!oursFresh) return { row, reason: 'ours-stale', needs };
  if (!theirsFresh) return { row, reason: 'theirs-stale', needs };

  // Fresh on both sides, ours dead, theirs live, ids agree or none supplied.
  if (DEAD.has(row.ours_status)) return { row, reason: null, needs: [] };
  // An internal status this module does not know. Report nothing rather than guess.
  return { row, reason: 'ours-unchecked', needs: [row.ours.toLowerCase()] };
}

/**
 * Which handles to send to the resolver, in the order that turns credits into
 * resolutions soonest: rows that need one lookup before rows that need two,
 * and within that, rows whose our-side is already known dead, because those
 * are the ones a single answer can close.
 */
function recheckList(classified: Classified[], creditCap: number): string[] {
  const rows = classified.filter((c) => c.needs.length > 0);
  rows.sort((a, b) => {
    if (a.needs.length !== b.needs.length)
      return a.needs.length - b.needs.length;
    const aDead = a.row.ours_status !== null ? 0 : 1;
    const bDead = b.row.ours_status !== null ? 0 : 1;
    if (aDead !== bDead) return aDead - bDead;
    return a.row.last_seen_at < b.row.last_seen_at ? 1 : -1;
  });

  const seen = new Set<string>();
  const handles: string[] = [];
  for (const c of rows) {
    for (const h of c.needs) {
      if (seen.has(h)) continue;
      seen.add(h);
      handles.push(h);
    }
  }
  // As many as the sweep will start, not as many as the cap could pay for.
  // `sweepHandles` reserves three lookups before it begins a handle and
  // refunds the two it did not use, so with no retries it starts a handle
  // while the spend is at most `creditCap` minus that reservation: one more
  // than `(creditCap - reservation) / lookup`. At the default cap of 300 that
  // is 14, where a plain `creditCap / lookup` says 16, and the dry run would
  // then promise two lookups a real run never makes.
  const starts =
    creditCap < MIN_RECHECK_CREDITS
      ? 0
      : Math.floor((creditCap - MIN_RECHECK_CREDITS) / CREDITS_PER_LOOKUP) + 1;
  return handles.slice(0, starts);
}

function emptyBlocked(): Record<BlockedReason, number> {
  return {
    'theirs-not-live': 0,
    'id-mismatch': 0,
    'ours-unchecked': 0,
    'theirs-unchecked': 0,
    'ours-stale': 0,
    'theirs-stale': 0,
  };
}

function distinctNeeded(classified: Classified[]): number {
  return new Set(classified.flatMap((c) => c.needs)).size;
}

/**
 * Accept one batch. Every condition is re-tested inside the statement, so a
 * row that changed between the read and the write is left alone rather than
 * written from a snapshot.
 *
 * When two sources both qualify for one wallet, one is chosen (the one with an
 * account id, then the most recently seen) and the graph takes its handle.
 * Every qualifying conflict naming that same handle closes with it: a second
 * source that named the same account is agreement. A qualifying conflict
 * naming a different handle stays open; the next ingest re-derives it against
 * the new handle and reopens it in its new shape.
 */
async function acceptBatch(
  keys: Array<{ wallet: string; theirSource: string }>,
  recheckDays: number
): Promise<{ wallets: number; conflicts: number; cacheRows: number }> {
  const db = getDb();
  if (!db || keys.length === 0)
    return { wallets: 0, conflicts: 0, cacheRows: 0 };

  const result = (await db.execute(sql`
    WITH keys AS (
      SELECT k.wallet, k.their_source
      FROM unnest(${sql.param(keys.map((k) => k.wallet))}::text[],
                  ${sql.param(keys.map((k) => k.theirSource))}::text[]) AS k(wallet, their_source)
    ),
    qualified AS (
      SELECT c.wallet, c.their_source, c.theirs, c.their_user_id, c.last_seen_at,
             g.twitter_handle AS served, tx.user_id AS live_user_id
      FROM keys k
      JOIN handle_conflicts c
        ON c.wallet = k.wallet AND c.their_source = k.their_source AND c.platform = 'twitter'
      JOIN social_graph g ON g.wallet = c.wallet
      JOIN x_accounts ox ON ox.handle = lower(c.ours)
      JOIN x_accounts tx ON tx.handle = lower(c.theirs)
      WHERE c.resolved_at IS NULL
        AND g.twitter_handle IS NOT NULL
        AND lower(g.twitter_handle) = lower(c.ours)
        AND NOT ('manual' = ANY(COALESCE(g.sources, ARRAY[]::text[])))
        AND ox.status IN ('not_found', 'unavailable')
        AND ox.checked_at >= now() - make_interval(days => ${recheckDays}::int)
        AND tx.status = 'live'
        AND tx.user_id IS NOT NULL
        AND tx.checked_at >= now() - make_interval(days => ${recheckDays}::int)
        AND (c.their_user_id IS NULL OR c.their_user_id = tx.user_id)
    ),
    chosen AS (
      SELECT DISTINCT ON (wallet) *
      FROM qualified
      ORDER BY wallet, (their_user_id IS NOT NULL) DESC, last_seen_at DESC
    ),
    graph AS (
      UPDATE social_graph g SET
        twitter_renamed_from = q.served,
        twitter_handle       = lower(q.theirs),
        twitter_url          = 'https://x.com/' || lower(q.theirs),
        twitter_user_id      = COALESCE(q.their_user_id, q.live_user_id),
        twitter_verified     = true,
        sources              = CASE
          WHEN q.their_source = ANY(COALESCE(g.sources, ARRAY[]::text[])) THEN g.sources
          ELSE array_append(COALESCE(g.sources, ARRAY[]::text[]), q.their_source)
        END,
        last_updated_at      = now()
      FROM chosen q
      WHERE g.wallet = q.wallet
      RETURNING g.wallet
    ),
    closed AS (
      UPDATE handle_conflicts c SET
        resolved_at = now(),
        resolution  = ${RESOLUTION}
      FROM chosen q
      JOIN qualified q2 ON q2.wallet = q.wallet AND lower(q2.theirs) = lower(q.theirs)
      WHERE c.wallet = q2.wallet AND c.their_source = q2.their_source AND c.platform = 'twitter'
      RETURNING c.wallet
    ),
    cache AS (
      DELETE FROM wallet_cache w
      USING chosen q
      WHERE w.wallet = q.wallet
      RETURNING w.wallet
    )
    SELECT
      (SELECT count(*) FROM graph)::int  AS wallets,
      (SELECT count(*) FROM closed)::int AS conflicts,
      (SELECT count(*) FROM cache)::int  AS cache_rows
  `)) as unknown as {
    rows: Array<{ wallets: number; conflicts: number; cache_rows: number }>;
  };

  const r = result.rows[0];
  return {
    wallets: Number(r?.wallets ?? 0),
    conflicts: Number(r?.conflicts ?? 0),
    cacheRows: Number(r?.cache_rows ?? 0),
  };
}

/**
 * Resolve what the evidence settles, and say what it did.
 *
 * Reads the queue, re-checks what the cap allows, reads it again, and accepts
 * what qualifies. A dry run does the first read and the arithmetic, reports
 * what it would re-check and what it would accept, and writes nothing:
 * not the graph, not the conflicts, and not `x_accounts` either, since a
 * recheck is a write.
 */
export async function resolveUnreachableConflicts(
  opts: ResolveOptions
): Promise<ResolveOutcome> {
  const recheckDays = opts.recheckDays ?? RECHECK_DAYS;
  const dryRun = opts.dryRun ?? false;
  const creditCap = Math.max(0, Math.floor(opts.creditCap));

  let classified = (await loadCandidates(recheckDays)).map(classify);

  const recheck: ResolveOutcome['recheck'] = {
    wanted: distinctNeeded(classified),
    requested: 0,
    progress: null,
    skipped: null,
  };

  const handles = recheckList(classified, creditCap);
  if (recheck.wanted === 0) {
    recheck.skipped = 'nothing to re-check';
  } else if (!opts.key) {
    recheck.skipped = 'resolver not configured';
  } else if (creditCap < MIN_RECHECK_CREDITS) {
    recheck.skipped = `credit cap ${creditCap} is below the ${MIN_RECHECK_CREDITS} one handle can cost`;
  } else if (dryRun) {
    recheck.requested = handles.length;
    recheck.skipped = 'dry run';
  } else if (handles.length > 0) {
    recheck.requested = handles.length;
    recheck.progress = await sweepHandles(handles, opts.key, {
      creditCap,
      deadlineAt: opts.deadlineAt,
      controlEvery: CONTROL_EVERY,
    });
    // What was learned changes who qualifies, so read the queue again.
    classified = (await loadCandidates(recheckDays)).map(classify);
  }

  const blocked = emptyBlocked();
  const eligible: CandidateRow[] = [];
  for (const c of classified) {
    if (c.reason === null) eligible.push(c.row);
    else blocked[c.reason]++;
  }

  const toAccept =
    opts.limit !== undefined
      ? eligible.slice(0, Math.max(0, opts.limit))
      : eligible;

  const sample: ResolveSample[] = toAccept.slice(0, 20).map((r) => ({
    wallet: r.wallet,
    ours: r.ours,
    status: r.ours_status ?? 'unknown',
    theirs: r.theirs,
    source: r.their_source,
  }));

  const outcome: ResolveOutcome = {
    dryRun,
    candidates: classified.length,
    eligible: eligible.length,
    accepted: 0,
    walletsUpdated: 0,
    cacheRowsDeleted: 0,
    closedBothDead: 0,
    reopenedBothDead: 0,
    blocked,
    recheck,
    sample,
  };
  // A dry run closes nothing, for the same reason it accepts nothing and
  // rechecks nothing: every one of those is a write.
  if (dryRun) return outcome;

  for (let i = 0; i < toAccept.length; i += BATCH) {
    const batch = toAccept.slice(i, i + BATCH);
    const written = await acceptBatch(
      batch.map((r) => ({ wallet: r.wallet, theirSource: r.their_source })),
      recheckDays
    );
    outcome.accepted += written.conflicts;
    outcome.walletsUpdated += written.wallets;
    outcome.cacheRowsDeleted += written.cacheRows;
  }

  const inert = await closeBothDead(recheckDays);
  outcome.closedBothDead = inert.closed;
  outcome.reopenedBothDead = inert.reopened;
  return outcome;
}

/**
 * Written to `resolution` when neither handle reaches anybody.
 *
 * A distinct string from `RESOLUTION`, because these rows are closed on the
 * evidence rather than decided: nothing was swapped and nothing was chosen.
 * Anything grouping the column by outcome must be able to tell the two apart.
 */
export const RESOLUTION_BOTH_DEAD = 'closed: neither handle reachable';

/**
 * Close the conflicts that no rule can ever act on.
 *
 * A conflict where **both** handles are dead cannot be accepted, because
 * acceptance requires theirs to be live, and it cannot surface as a second
 * account either, because `alsoOnXForWallets` requires both to be live. It is
 * inert: it will be re-examined by every run forever, counted in every queue
 * total forever, and can never change any answer the product gives. On
 * 2026-08-27 there were 188 of them and the number only grows, because a dead
 * handle does not come back to life on its own.
 *
 * Closing is not deciding. Our handle stays exactly where it is; the row is
 * marked so the queue stops carrying work nobody can do.
 *
 * ## Reopening is this function's job, not `recordConflicts`'s
 *
 * The first version of this comment claimed that "if either side is ever seen
 * live again, `recordConflicts` reopens the row on its next ingest". That was
 * false, and it is exactly the shape of claim this codebase asserts rather than
 * asserts about: `recordConflicts` clears `resolved_at` only when the `ours` or
 * `theirs` **strings** change. Liveness lives in `x_accounts` and never touches
 * `handle_conflicts`, so a lifted suspension or a reclaimed name would have
 * left the row closed forever, unable to surface as `twitter.also` or to
 * qualify for a swap, with a live attested handle sitting right there (Bugbot,
 * 2026-08-27).
 *
 * So the reopen is done here, in the same pass and before the close: any row
 * closed as inert whose sides are no longer both dead goes back on the queue.
 * The two statements cannot disagree about what "dead" means, because they read
 * the same two columns.
 *
 * ## Why freshness is required to close
 *
 * Two dead readings from six weeks ago are not evidence that both are dead now:
 * a suspension gets lifted and a freed name gets taken. So the same recheck
 * window that governs acceptance governs this, and a stale row waits rather
 * than being closed on an old look. That is the whole reason this runs after
 * the recheck above rather than before it.
 */
async function closeBothDead(
  recheckDays: number
): Promise<{ closed: number; reopened: number }> {
  const db = getDb();
  if (!db) return { closed: 0, reopened: 0 };

  /**
   * Reopen first, so a row that came back to life is a candidate again on this
   * run rather than on the next one.
   *
   * No freshness test here, deliberately, and it is the opposite asymmetry to
   * the close below. Closing on a stale reading risks burying a live handle, so
   * it demands a fresh look on both sides. Reopening on a stale reading costs a
   * row re-entering a queue it will leave again, so any evidence that either
   * side is not dead is enough. When the two rules disagree, the one that keeps
   * a conflict visible wins.
   */
  const reopened = (await db.execute(sql`
    UPDATE handle_conflicts c
       SET resolved_at = NULL,
           resolution  = NULL
      FROM x_accounts o, x_accounts t
     WHERE o.handle = lower(c.ours)
       AND t.handle = lower(c.theirs)
       AND c.platform = 'twitter'
       AND c.resolution = ${RESOLUTION_BOTH_DEAD}
       AND (o.status = 'live' OR t.status = 'live')
    RETURNING 1
  `)) as unknown as { rows: unknown[] };

  const result = (await db.execute(sql`
    UPDATE handle_conflicts c
       SET resolved_at = now(),
           resolution  = ${RESOLUTION_BOTH_DEAD}
      FROM x_accounts o, x_accounts t
     WHERE o.handle = lower(c.ours)
       AND t.handle = lower(c.theirs)
       AND c.platform = 'twitter'
       AND c.resolved_at IS NULL
       AND o.status IN ('not_found', 'unavailable')
       AND t.status IN ('not_found', 'unavailable')
       AND o.checked_at > now() - make_interval(days => ${recheckDays})
       AND t.checked_at > now() - make_interval(days => ${recheckDays})
    RETURNING 1
  `)) as unknown as { rows: unknown[] };

  return {
    closed: result.rows?.length ?? 0,
    reopened: reopened.rows?.length ?? 0,
  };
}
