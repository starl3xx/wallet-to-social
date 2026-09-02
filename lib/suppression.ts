/**
 * Read-side helpers for the right-to-removal suppression list.
 *
 * The suppression system has three halves and this file is the third:
 *
 *  1. Database triggers (the suppression migration) stop a suppressed
 *     identifier from LANDING in any table that stores one.
 *  2. The operator endpoint erases what is already stored.
 *  3. These helpers stop the app from ASKING about a suppressed identifier
 *     (the pre-flight filter in `lib/job-processor.ts`) and from SERVING one
 *     out of a saved payload (`lookup_history.results` and `lookup_jobs`
 *     payloads, which no trigger reaches into).
 *
 * The pre-flight half is not an optimisation. A suppressed wallet with no
 * cached row would otherwise run the full external pipeline, and the trigger
 * would then block `upsertNegativeWallets` from persisting the "checked,
 * nothing found" row, so every later lookup would pay to resolve the exact
 * person who asked us to stop. Filtering before the pipeline is what keeps
 * re-collection at zero instead of moving it from monthly to per-lookup.
 *
 * ## Failure posture: closed
 *
 * Every function here throws on a failed read. A serve-time filter that fell
 * back to "serve it unfiltered" on an error would make the one query the
 * feature depends on the one query allowed to fail silently, which is the
 * silent-nothing failure shape the migration's own probes exist to prevent.
 * Callers on a serve path turn the throw into an error response; the job
 * worker lets it fail the chunk, which retries.
 *
 * ## No cache, deliberately
 *
 * A removal must take effect on the next request, so nothing here is memoised
 * beyond the single call. A module-level cache would outlive the request on a
 * warm serverless instance and keep serving a mapping the operator had just
 * erased. Each caller makes at most one list read per request or per worker
 * chunk, so there is nothing worth caching anyway.
 *
 * ## One query, and why it can be the whole table
 *
 * `suppressed_identifiers` is designed to hold tens of rows and sit entirely
 * in shared buffers (see the migration's index note). A saved payload can
 * hold 10,000 rows and six identifiers each, and shipping 60,000 parameters
 * to probe a table of tens is the expensive direction. So the serve-time
 * filter reads the list once per request with zero parameters and matches in
 * process, and only the targeted helpers (`isSuppressed`) send identifier
 * arrays, through the primary key.
 *
 * ## Normalisation
 *
 * The table's CHECK constraint guarantees every stored identifier is
 * lowercase and trimmed (wallets are lowercase hex). `social_graph.wallet` is
 * stored lowercase; handles are normalised to lowercase on write today, but
 * rows written before `scripts/repair-handle-casing.ts` and old saved
 * payloads still carry mixed case. So every comparison here lowercases the
 * app-side value first, the same rule the triggers apply with `lower(NEW.x)`.
 */
import { getDb } from '@/db';
import { suppressedIdentifiers } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { calculatePriorityScore } from '@/lib/csv-parser';
import type { WalletSocialResult } from '@/lib/types';

/**
 * The identifier kinds, mirroring the suppression migration's closed
 * vocabulary. `wallet` is not a platform, which is why the axis is "kind".
 */
export const SUPPRESSION_KINDS = [
  'wallet',
  'twitter',
  'farcaster',
  'ens',
  'lens',
  'github',
] as const;

export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

/** Every kind mapped to the set of suppressed identifiers of that kind. */
export type SuppressionSets = ReadonlyMap<SuppressionKind, ReadonlySet<string>>;

function emptySets(): Map<SuppressionKind, Set<string>> {
  const map = new Map<SuppressionKind, Set<string>>();
  for (const kind of SUPPRESSION_KINDS) map.set(kind, new Set());
  return map;
}

/**
 * Read the whole suppression list: one query, zero parameters.
 *
 * Throws when the database is unreachable or the table cannot be read. Do
 * not catch this to serve unfiltered data; catch it to refuse the request.
 */
export async function loadSuppressionList(): Promise<SuppressionSets> {
  const db = getDb();
  if (!db) {
    throw new Error('Suppression list unavailable: database not configured');
  }

  const rows = await db
    .select({
      kind: suppressedIdentifiers.kind,
      identifier: suppressedIdentifiers.identifier,
    })
    .from(suppressedIdentifiers);

  const sets = emptySets();
  for (const row of rows) {
    sets.get(row.kind as SuppressionKind)?.add(row.identifier);
  }
  return sets;
}

/**
 * Which of these identifiers are suppressed, in one indexed query.
 *
 * Input casing does not matter: values are lowercased before querying, and
 * the returned set holds the lowercase forms. An empty input skips the query
 * entirely. Throws on a failed read; see the failure posture above.
 */
export async function isSuppressed(
  kind: SuppressionKind,
  identifiers: string[]
): Promise<Set<string>> {
  const normalized = [
    ...new Set(
      identifiers
        .map((id) => id.trim().toLowerCase())
        .filter((id) => id.length > 0)
    ),
  ];
  if (normalized.length === 0) return new Set();

  const db = getDb();
  if (!db) {
    throw new Error('Suppression list unavailable: database not configured');
  }

  // The explicit ::text[] cast matters: the http driver sends no parameter
  // type hints (the 42P18 lesson in lib/neynar-budget.ts).
  const rows = await db
    .select({ identifier: suppressedIdentifiers.identifier })
    .from(suppressedIdentifiers)
    .where(
      and(
        eq(suppressedIdentifiers.kind, kind),
        sql`${suppressedIdentifiers.identifier} = ANY(${sql.param(normalized)}::text[])`
      )
    );

  return new Set(rows.map((r) => r.identifier));
}

function lower(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0
    ? value.toLowerCase()
    : null;
}

function kindHit(
  sets: SuppressionSets,
  kind: SuppressionKind,
  value: unknown
): boolean {
  const v = lower(value);
  return v !== null && (sets.get(kind)?.has(v) ?? false);
}

/**
 * Scrub one result row against the suppression sets. Pure; returns the same
 * reference when nothing matched, so an untouched payload allocates nothing.
 *
 * A suppressed WALLET takes every field we resolved, because the mapping is
 * the wallet joined to any of them: the row keeps only the wallet itself and
 * whatever columns the customer uploaded, so counts align and the row is the
 * same shape as a wallet the index never matched (an ordinary miss carries
 * these keys as absent, not null, which is why they are deleted rather than
 * nulled). A suppressed HANDLE takes only its own platform's fields, on any
 * row that carries it, including the second attested handle in
 * `twitter_also`.
 *
 * `priority_score` is recomputed rather than deleted where it was present,
 * because an ordinary miss on a paid job still has one (holdings times
 * log of nothing), and a score computed from erased follower counts would
 * both leak that data existed and disagree with the row beside it.
 */
export function scrubResultRow(
  row: WalletSocialResult,
  sets: SuppressionSets
): WalletSocialResult {
  const walletSuppressed = kindHit(sets, 'wallet', row.wallet);

  const twitterSuppressed =
    walletSuppressed || kindHit(sets, 'twitter', row.twitter_handle);
  const alsoSuppressed =
    row.twitter_also !== undefined &&
    (walletSuppressed || kindHit(sets, 'twitter', row.twitter_also.handle));
  const farcasterSuppressed =
    walletSuppressed || kindHit(sets, 'farcaster', row.farcaster);
  const ensSuppressed = walletSuppressed || kindHit(sets, 'ens', row.ens_name);
  const lensSuppressed = walletSuppressed || kindHit(sets, 'lens', row.lens);
  const githubSuppressed =
    walletSuppressed || kindHit(sets, 'github', row.github);

  const touched =
    walletSuppressed ||
    (twitterSuppressed && row.twitter_handle !== undefined) ||
    alsoSuppressed ||
    (farcasterSuppressed && row.farcaster !== undefined) ||
    (ensSuppressed && row.ens_name !== undefined) ||
    (lensSuppressed && row.lens !== undefined) ||
    (githubSuppressed && row.github !== undefined);
  if (!touched) return row;

  const next: WalletSocialResult = { ...row };

  if (twitterSuppressed || walletSuppressed) {
    delete next.twitter_handle;
    delete next.twitter_url;
    delete next.twitter_verified;
    delete next.twitter_reachability;
    // Written by an older stamp shape; harmless to delete where absent.
    delete next.twitter_reachability_checked_at;
  }
  if (alsoSuppressed) {
    delete next.twitter_also;
  }
  if (farcasterSuppressed || walletSuppressed) {
    delete next.farcaster;
    delete next.farcaster_url;
    delete next.fc_fid;
    delete next.fc_followers;
    delete next.fc_bio;
    delete next.farcaster_verified;
  }
  if (ensSuppressed || walletSuppressed) delete next.ens_name;
  if (lensSuppressed || walletSuppressed) delete next.lens;
  if (githubSuppressed || walletSuppressed) delete next.github;

  if (walletSuppressed) {
    // Agent identity is a fact about the wallet, so it goes with the wallet.
    delete next.is_agent;
    delete next.agent_name;
    delete next.agent_framework;
    delete next.agent_type;
    delete next.agent_token_symbol;
    delete next.agent_verified;
    // The provenance of data that is no longer in the row is itself a signal
    // that data existed. An empty source list is the fresh-miss shape.
    next.source = [];
  }

  if (
    row.priority_score !== undefined &&
    (walletSuppressed || farcasterSuppressed)
  ) {
    next.priority_score = calculatePriorityScore(next.holdings, undefined);
  }

  return next;
}

/**
 * Serve-time filter for saved payloads: strip suppressed identifiers from
 * result rows on the way out of a history or jobs read.
 *
 * Takes row sets rather than rows so a route serving several saved lookups
 * still makes exactly one suppression read for the whole request. Rows are
 * never dropped: a suppressed wallet keeps its entry with the mapping fields
 * removed, so the caller's counts and row order survive.
 *
 * Skips the query entirely when the payload holds no rows. Throws when the
 * suppression list cannot be read: the caller must refuse the request rather
 * than serve unfiltered data.
 *
 * `suppressedWallets` is returned (lowercase) so a route can also drop those
 * wallets from row-adjacent extras built from the same payload, such as the
 * enriched-wallets list on a saved lookup.
 */
export async function scrubSuppressed(
  rowSets: WalletSocialResult[][]
): Promise<{
  rowSets: WalletSocialResult[][];
  suppressedWallets: ReadonlySet<string>;
}> {
  const hasRows = rowSets.some((rows) => rows.length > 0);
  if (!hasRows) {
    return { rowSets, suppressedWallets: new Set() };
  }

  const sets = await loadSuppressionList();

  const anySuppressed = SUPPRESSION_KINDS.some(
    (kind) => (sets.get(kind)?.size ?? 0) > 0
  );
  if (!anySuppressed) {
    return { rowSets, suppressedWallets: new Set() };
  }

  const walletSet = sets.get('wallet')!;
  const suppressedWallets = new Set<string>();
  const scrubbed = rowSets.map((rows) =>
    rows.map((row) => {
      const w = lower(row.wallet);
      if (w !== null && walletSet.has(w)) suppressedWallets.add(w);
      return scrubResultRow(row, sets);
    })
  );

  return { rowSets: scrubbed, suppressedWallets };
}
