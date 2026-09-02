import type { getDb } from '@/db';
import { sql, type SQL } from 'drizzle-orm';

/**
 * The operator side of the right-to-removal system: stage 1.
 *
 * A person mails the support address naming their identifiers; the operator
 * runs the admin endpoint (`app/api/admin/removal/route.ts`), which calls
 * into here. No proof is demanded, matching the privacy page, and the
 * database stores nothing about who asked: one `(kind, identifier)` row per
 * named identifier, nothing joining them.
 *
 * ## The order is load-bearing
 *
 * 1. Insert and COMMIT the suppression rows first (each row its own
 *    statement, so each is committed before any deletion begins).
 * 2. Copy affected rows into the quarantine table and delete (or blank)
 *    them, one atomic statement per table, so a copy can never be lost to a
 *    failure between "copied" and "deleted".
 * 3. Amend the customer-held jsonb copies (`lookup_history.results`,
 *    `lookup_jobs.partial_results`), non-fail-soft.
 *
 * Deleting before the suppression row commits would leave a window in which
 * an in-flight sweep batch re-inserts the row after the delete and before
 * the guard exists. The other way round, that race is harmless: a batch that
 * re-inserts behind our deletes hits the committed suppression rows through
 * the `suppression_guard` storage triggers (see
 * `scripts/migrate-suppression.ts`), which refuse the wallet row and blank a
 * suppressed handle. Nothing lands.
 *
 * ## Timestamps are jittered
 *
 * A request naming a wallet and a handle becomes two rows, and identical
 * insert timestamps would rebuild exactly the association the
 * one-identifier-per-row design refuses to store. The jitter lives in the
 * table itself: `suppressed_identifiers.requested_at` and `created_at`
 * DEFAULT to `now() - random() * interval '4 hours'`, drawn per row
 * (`scripts/migrate-suppression.ts`, `JITTERED_DEFAULT`), so this module
 * simply omits the columns and inserts one row per statement, each in its
 * own transaction (per-statement autocommit on both drivers), with no batch
 * marker of any kind.
 *
 * What that does and does not prevent, stated rather than implied: no two
 * rows share an xmin, but a SELECT-privileged reader (the scheduled
 * read-only role included) can still see ADJACENT transaction ids and heap
 * positions (`xmin`, `ctid`), and the nightly dump emits rows in heap
 * order. Adjacency is deniable in a way equality is not: two unrelated
 * requests arriving near in time are just as adjacent, and suppressions
 * are rare enough that any same-day pair already stands out. The jitter
 * plus per-transaction inserts are the designed mitigations; the residual
 * is accepted and recorded here and in the decision notes, not hidden.
 *
 * ## The quarantine table
 *
 * `suppression_quarantine` holds a full pre-removal copy of every row this
 * module deleted or blanked, keyed back to `(kind, identifier)`, so a
 * removal that turns out to be hostile (the email lane demands no proof) can
 * be reversed until `purge_after`, which the cleanup cron enforces. The DDL
 * is owned by `scripts/migrate-suppression.ts` (id, kind, identifier,
 * source_table, row_data, quarantined_at, purge_after; operator-only by
 * REVOKE). The table is deliberately in NEITHER `READ_ONLY_TABLES` nor the
 * backup list: a scheduled reader has no business in it, and a backup would
 * extend the stated 30-day retention.
 *
 * There is no action column: whether a quarantined row was deleted or
 * blanked is fully determined by `(kind, source_table)`. A wallet-kind
 * removal deletes whole rows everywhere; every other kind blanks columns on
 * `social_graph` and `wallet_cache` and deletes rows elsewhere. The restore
 * paths below rely on exactly that disjointness.
 *
 * ## What this module deliberately does not touch
 *
 * The negative and dedupe tables (`x_handle_attempts`, the
 * `farcaster_sweep_seen*` pair, `clanker_unresolved_ids`) are excluded by
 * decision: they are do-not-reprocess markers, and deleting them would
 * INCREASE processing of the person who asked to be left alone. The
 * boundary is documented, not silently applied: `SUPPRESSION_EXCLUDED_TABLES`
 * in `scripts/migrate-suppression.ts` is the code-facing record, and
 * `docs/AGENT-SYSTEM.md` principle 8 is the decision record.
 *
 * `lookup_jobs.wallets` and `lookup_jobs.original_data` are the customer's
 * own input (their list, their CSV columns) and are never edited; only the
 * mappings we produced are. The result-element amendment keeps each wallet
 * entry so the customer's row counts still align with what was billed.
 */

/**
 * The closed vocabularies. Kinds come from `lib/suppression.ts` (one
 * authority, shared with the serve-time filter); reasons and lanes mirror
 * the CHECK constraints `scripts/migrate-suppression.ts` installs, so the
 * endpoint refuses a bad value with a readable message instead of a
 * constraint error. They must match that script.
 */
export { SUPPRESSION_KINDS } from '@/lib/suppression';
export type { SuppressionKind } from '@/lib/suppression';
import { SUPPRESSION_KINDS } from '@/lib/suppression';
import type { SuppressionKind } from '@/lib/suppression';

export const SUPPRESSION_REASONS = ['requested', 'operator', 'legal'] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/**
 * How the request was verified, never who made it. Stage 1 only ever writes
 * `email` (the no-proof lane) and `legal`; `wallet_sig` and `handle_proof`
 * are reserved for the stage 2 self-serve lanes so the un-suppress gating
 * they need is representable from day one.
 */
export const SUPPRESSION_LANES = [
  'email',
  'wallet_sig',
  'handle_proof',
  'legal',
] as const;
export type SuppressionLane = (typeof SUPPRESSION_LANES)[number];

/**
 * Days a quarantined copy survives. The enforcing value is the
 * `purge_after` DEFAULT in the quarantine DDL plus the cleanup cron that
 * honours it; this constant exists for messages and the refusal check and
 * must match the migration.
 */
export const QUARANTINE_RETENTION_DAYS = 30;

/**
 * Upper bound on the random backdating the table DEFAULT applies to each
 * suppression row (`JITTERED_DEFAULT` in `scripts/migrate-suppression.ts`).
 * Read here only to widen time-window queries so a backdated row cannot
 * slip out of them.
 */
export const TIMESTAMP_JITTER_HOURS = 4;

/**
 * The clustering alarm: how many recently suppressed wallets belonging to
 * seeded collections it takes to warn the operator. A warning, never a
 * block; the point is that a burst of removals aimed at one collection's
 * holders (a starter card is the obvious target) is visible before the next
 * one is executed, not that it is prevented.
 */
export const CLUSTER_ALARM_THRESHOLD = 3;
export const CLUSTER_ALARM_WINDOW_DAYS = 7;

type Db = NonNullable<ReturnType<typeof getDb>>;

export interface RemovalTarget {
  kind: SuppressionKind;
  identifier: string;
}

export interface RemovalStep {
  table: string;
  action: 'deleted' | 'blanked' | 'amended';
  rows: number;
}

export interface RemovalReport {
  kind: SuppressionKind;
  identifier: string;
  /** For on-screen display; the full identifier is for the un-suppress
   *  action and must not be rendered (a screenshot is the leak). */
  identifierMasked: string;
  suppression: 'created' | 'already-present';
  steps: RemovalStep[];
  /** Rows copied into quarantine before deletion or blanking. */
  quarantined: number;
  /** Whether the index or any saved copy actually held this identifier. */
  hadRecords: boolean;
}

/**
 * Normalises an operator-typed identifier into the shape the
 * `suppressed_identifiers` CHECK constraint accepts: trimmed, lowercased,
 * no leading '@'. Returns an error string instead of letting a malformed
 * value travel to the database and come back as a constraint name.
 */
export function normalizeRemovalTarget(
  kind: string,
  identifier: string
):
  | { ok: true; kind: SuppressionKind; identifier: string }
  | { ok: false; error: string } {
  if (!SUPPRESSION_KINDS.includes(kind as SuppressionKind)) {
    return { ok: false, error: `Unknown kind '${kind}'` };
  }
  let id = identifier.trim().toLowerCase();
  if (id.startsWith('@')) id = id.slice(1);
  if (id.length === 0) {
    return { ok: false, error: 'Empty identifier' };
  }
  if (id.includes('/')) {
    return {
      ok: false,
      error: `'${id}' looks like a URL; name the bare identifier instead`,
    };
  }
  if (kind === 'wallet' && !/^0x[0-9a-f]{40}$/.test(id)) {
    return { ok: false, error: `'${id}' is not a wallet address` };
  }
  return { ok: true, kind: kind as SuppressionKind, identifier: id };
}

/**
 * A display form that identifies a row to the operator without putting the
 * whole identifier on screen. The full value still travels in the API
 * response (the operator is the verified party and needs it for the
 * un-suppress action); this is for the table a screenshot might catch.
 */
export function maskIdentifier(
  kind: SuppressionKind,
  identifier: string
): string {
  if (kind === 'wallet') {
    return `${identifier.slice(0, 6)}…${identifier.slice(-4)}`;
  }
  if (identifier.length <= 4) return `${identifier.slice(0, 1)}…`;
  return `${identifier.slice(0, 2)}…${identifier.slice(-2)}`;
}

/**
 * Inserts the suppression rows, one statement per row so each commits
 * independently before any deletion starts, and no shared batch marker.
 * The timestamps are omitted so the table's per-row jittered DEFAULT is
 * the one authority on backdating. `ON CONFLICT DO NOTHING` keeps a re-run
 * idempotent and keeps the earliest timestamps, so re-running a partially
 * failed removal cannot refresh a row's apparent age.
 */
export async function insertSuppressions(
  db: Db,
  targets: RemovalTarget[],
  lane: SuppressionLane,
  reason: SuppressionReason
): Promise<Map<string, 'created' | 'already-present'>> {
  const outcomes = new Map<string, 'created' | 'already-present'>();
  for (const t of targets) {
    const res = (await db.execute(sql`
      INSERT INTO suppressed_identifiers (kind, identifier, reason, lane)
      VALUES (${t.kind}, ${t.identifier}, ${reason}, ${lane})
      ON CONFLICT (kind, identifier) DO NOTHING
      RETURNING kind
    `)) as unknown as { rows: unknown[] };
    outcomes.set(
      `${t.kind}:${t.identifier}`,
      res.rows.length > 0 ? 'created' : 'already-present'
    );
  }
  return outcomes;
}

/**
 * Copy-then-delete as ONE statement: the DELETE runs in a CTE whose
 * RETURNING feeds the quarantine INSERT, so the two cannot be separated by
 * a failure. That matters because `db/index.ts` may hand back the neon-http
 * driver, which supports no transactions; a single statement is atomic on
 * either driver.
 */
async function quarantineDelete(
  db: Db,
  kind: SuppressionKind,
  identifier: string,
  table: string,
  where: SQL
): Promise<number> {
  const res = (await db.execute(sql`
    WITH gone AS (
      DELETE FROM ${sql.raw(table)} t
      WHERE ${where}
      RETURNING to_jsonb(t.*) AS payload
    )
    INSERT INTO suppression_quarantine
      (kind, identifier, source_table, row_data)
    SELECT ${kind}, ${identifier}, ${table}, gone.payload FROM gone
    RETURNING id
  `)) as unknown as { rows: unknown[] };
  return res.rows.length;
}

/**
 * Copy-then-blank, same single-statement shape as above, for the two tables
 * (`social_graph`, `wallet_cache`) where a handle-kind suppression clears
 * columns and keeps the row. The kept row is a persisted negative:
 * "checked, nothing found", which is what stops the lookup path paying to
 * resolve this wallet again on every ask.
 *
 * The UPDATE fires the BEFORE UPDATE `suppression_guard` trigger, which
 * (the suppression row being committed by now) blanks the same columns
 * again. Harmless, and the belt-and-braces is the design: the explicit SET
 * here is the erasure of record, the trigger is what makes re-collection
 * impossible.
 */
async function quarantineBlank(
  db: Db,
  kind: SuppressionKind,
  identifier: string,
  table: string,
  where: SQL,
  set: SQL
): Promise<number> {
  const res = (await db.execute(sql`
    WITH snap AS (
      SELECT t.wallet AS wallet_key, to_jsonb(t.*) AS payload
      FROM ${sql.raw(table)} t
      WHERE ${where}
    ),
    copied AS (
      INSERT INTO suppression_quarantine
        (kind, identifier, source_table, row_data)
      SELECT ${kind}, ${identifier}, ${table}, snap.payload FROM snap
    )
    UPDATE ${sql.raw(table)} g
    SET ${set}
    FROM snap
    WHERE g.wallet = snap.wallet_key
    RETURNING g.wallet
  `)) as unknown as { rows: unknown[] };
  return res.rows.length;
}

/**
 * The jsonb amendment over a saved result array. For each element naming
 * the identifier, the mapping keys are removed; the element itself (and so
 * the customer's row count, and the wallet entry they submitted) survives.
 * Removal rather than `null` values because every one of these keys is
 * optional in `WalletSocialResult`, so key-absent is exactly the shape an
 * unresolved wallet already has: absent is not false, and it is not
 * "removed" either.
 *
 * Non-fail-soft by construction: the caller records the returned row count
 * and any thrown error aborts the removal with the failure named. A
 * non-array value (nothing writes one, but jsonb proves nothing) is treated
 * as holding no elements rather than crashing the guard predicate.
 */
async function amendSavedCopies(
  db: Db,
  table: 'lookup_history' | 'lookup_jobs',
  column: 'results' | 'partial_results',
  identifier: string,
  matchKey: string,
  stripKeys: readonly string[],
  checkTwitterAlso: boolean
): Promise<number> {
  const strip = sql.raw(
    `ARRAY[${stripKeys.map((k) => `'${k}'`).join(', ')}]::text[]`
  );
  const col = sql.raw(column);
  const alsoWhen = checkTwitterAlso
    ? sql` WHEN lower(t.elem #>> '{twitter_also,handle}') = ${identifier}
             THEN t.elem - 'twitter_also' `
    : sql``;
  const alsoGuard = checkTwitterAlso
    ? sql` OR lower(e #>> '{twitter_also,handle}') = ${identifier}`
    : sql``;
  const res = (await db.execute(sql`
    UPDATE ${sql.raw(table)} h
    SET ${col} = (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN lower(t.elem ->> ${matchKey}) = ${identifier}
            THEN t.elem - ${strip}
          ${alsoWhen}
          ELSE t.elem
        END
        ORDER BY t.ord
      ), '[]'::jsonb)
      FROM jsonb_array_elements(h.${col}) WITH ORDINALITY AS t(elem, ord)
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(h.${col}) = 'array'
             THEN h.${col} ELSE '[]'::jsonb END
      ) e
      WHERE lower(e ->> ${matchKey}) = ${identifier} ${alsoGuard}
    )
    RETURNING h.id
  `)) as unknown as { rows: unknown[] };
  return res.rows.length;
}

/**
 * Which result-element keys carry the mapping for each kind. The element
 * shape is `WalletSocialResult` (lib/types.ts); everything not listed here
 * is either the customer's own input (wallet, holdings, their CSV columns)
 * or another identity's data.
 *
 * `priority_score` rides the farcaster and wallet lists because it is
 * derived from `fc_followers`, so leaving it is leaving a measurement of
 * the erased identity behind.
 */
const RESULT_MATCH_KEY: Record<SuppressionKind, string> = {
  wallet: 'wallet',
  twitter: 'twitter_handle',
  farcaster: 'farcaster',
  ens: 'ens_name',
  lens: 'lens',
  github: 'github',
};

const RESULT_STRIP: Record<SuppressionKind, readonly string[]> = {
  wallet: [
    'ens_name',
    'twitter_handle',
    'twitter_url',
    'twitter_user_id',
    'twitter_verified',
    'twitter_reachability',
    'twitter_also',
    'farcaster',
    'farcaster_url',
    'fc_followers',
    'fc_fid',
    'fc_bio',
    'farcaster_verified',
    'lens',
    'github',
    'priority_score',
    'source',
    'is_agent',
    'agent_name',
    'agent_framework',
    'agent_type',
    'agent_token_symbol',
    'agent_verified',
  ],
  twitter: [
    'twitter_handle',
    'twitter_url',
    'twitter_user_id',
    'twitter_verified',
    'twitter_reachability',
    'twitter_also',
  ],
  farcaster: [
    'farcaster',
    'farcaster_url',
    'fc_followers',
    'fc_fid',
    'fc_bio',
    'farcaster_verified',
    'priority_score',
  ],
  ens: ['ens_name'],
  lens: ['lens'],
  github: ['github'],
};

/** The columns a handle-kind suppression clears, per table. Mirrors the
 *  `suppression_guard_row` trigger function so the explicit erasure and the
 *  write guard cannot disagree about what a suppression means. */
const BLANK_SET: Record<string, Record<string, string>> = {
  social_graph: {
    twitter:
      'twitter_handle = NULL, twitter_url = NULL, twitter_user_id = NULL, twitter_verified = false',
    twitter_renamed: 'twitter_renamed_from = NULL',
    farcaster:
      'farcaster = NULL, farcaster_url = NULL, fc_fid = NULL, fc_followers = NULL, farcaster_verified = false',
    ens: 'ens_name = NULL',
    lens: 'lens = NULL',
    github: 'github = NULL',
  },
  wallet_cache: {
    // wallet_cache has no twitter_user_id, twitter_verified,
    // farcaster_verified or twitter_renamed_from columns (db/schema.ts:19).
    twitter: 'twitter_handle = NULL, twitter_url = NULL',
    farcaster:
      'farcaster = NULL, farcaster_url = NULL, fc_fid = NULL, fc_followers = NULL',
    ens: 'ens_name = NULL',
    lens: 'lens = NULL',
    github: 'github = NULL',
  },
};

/**
 * Runs the erasure for one already-suppressed identifier: quarantine copy,
 * delete or blank, then the saved-copy amendments. Every step is idempotent
 * (a re-run finds the rows already gone or already blanked and does
 * nothing), so a failed run is repaired by running it again. Throws on the
 * first failing step; the caller reports what completed and what remains.
 */
export async function eraseIdentifier(
  db: Db,
  kind: SuppressionKind,
  identifier: string
): Promise<{ steps: RemovalStep[]; quarantined: number }> {
  const steps: RemovalStep[] = [];
  let quarantined = 0;

  const del = async (table: string, where: SQL) => {
    const rows = await quarantineDelete(db, kind, identifier, table, where);
    quarantined += rows;
    steps.push({ table, action: 'deleted', rows });
  };
  const blank = async (table: string, where: SQL, setKey: string) => {
    const rows = await quarantineBlank(
      db,
      kind,
      identifier,
      table,
      where,
      sql.raw(BLANK_SET[table][setKey])
    );
    quarantined += rows;
    steps.push({ table, action: 'blanked', rows });
  };

  if (kind === 'wallet') {
    // A suppressed wallet takes the whole row everywhere: the address is
    // the key, so nothing on the row is separable from it.
    await del('social_graph', sql`t.wallet = ${identifier}`);
    await del('wallet_cache', sql`t.wallet = ${identifier}`);
    await del('handle_conflicts', sql`t.wallet = ${identifier}`);
    await del('social_graph_history', sql`t.wallet = ${identifier}`);
    await del('wallet_holdings', sql`t.wallet = ${identifier}`);
    // The curated agent registry pairs the wallet with a name and handles,
    // which is exactly the mapping the person asked us not to keep. The
    // storage trigger only refuses FUTURE writes; the existing row goes
    // here, whole (same rationale as the migration's skip-guard comment).
    await del('known_agents', sql`t.wallet = ${identifier}`);
  } else {
    await blank(
      'social_graph',
      sql`lower(t.${sql.raw(RESULT_MATCH_KEY[kind])}) = ${identifier}`,
      kind
    );
    if (kind === 'twitter') {
      // twitter_renamed_from holds a DIFFERENT handle to twitter_handle
      // (the dead one the conflict resolver replaced), so it gets its own
      // pass: a match on it must not clear the live handle beside it.
      await blank(
        'social_graph',
        sql`lower(t.twitter_renamed_from) = ${identifier}`,
        'twitter_renamed'
      );
    }
    await blank(
      'wallet_cache',
      sql`lower(t.${sql.raw(RESULT_MATCH_KEY[kind])}) = ${identifier}`,
      kind
    );
    if (kind === 'twitter') {
      // Keyed on the handle; the row IS the personal data.
      await del('x_accounts', sql`lower(t.handle) = ${identifier}`);
    }
    if (kind === 'twitter' || kind === 'farcaster') {
      // handle_conflicts holds wallet + two handles: the erased edge, twice
      // over, and it republishes handles as twitter.also on paid routes, so
      // deletion of the graph row alone would not remove the handle.
      // `platform` defaults to 'twitter' but is not constrained to it, so
      // both columns are checked for both kinds, same as the trigger.
      await del(
        'handle_conflicts',
        sql`lower(t.ours) = ${identifier} OR lower(t.theirs) = ${identifier}`
      );
      // Same reasoning as the wallet branch: an existing curated agent row
      // carrying the suppressed handle survives the trigger, so it is
      // erased here, whole.
      await del(
        'known_agents',
        kind === 'twitter'
          ? sql`lower(t.twitter_handle) = ${identifier}`
          : sql`lower(t.farcaster) = ${identifier}`
      );
      /**
       * Saved REVERSE lookups whose subject is this handle. The element
       * amend below cannot make these honest: the lookup's name is
       * "Wallets for @handle" and its row membership IS the handle-to-
       * wallets mapping, so stripping per-element keys leaves the mapping
       * intact as a titled list. Those rows are quarantined and deleted
       * whole. Matched on the write-side marker (`input_source =
       * 'reverse_lookup'`, `app/api/reverse/route.ts`) plus the name that
       * route writes, with and without the '@', so a farcaster save
       * matches too. A reverse save the customer since RENAMED no longer
       * names its subject, in our data or anyone else's: the amend below
       * still strips the handle's fields from its rows, and a wallet list
       * with no subject attached is not a mapping. That residual is
       * accepted. The serve-time filter needs no matching row-drop: this
       * delete runs synchronously in the same request as the suppression
       * insert, so the window in which a history read could serve the
       * titled row is the seconds this function is in flight (or a failed
       * run awaiting its re-run, which the endpoint reports loudly).
       */
      await del(
        'lookup_history',
        sql`t.input_source = 'reverse_lookup' AND lower(t.name) IN (${'wallets for @' + identifier}, ${'wallets for ' + identifier})`
      );
    }
    // The audit trail records old and new values of changed handles, which
    // is the handle. Any-kind match, same as the trigger's '=old_value'
    // spec: too wide deletes an audit row that mentioned the string, too
    // narrow keeps the identity in the audit table forever.
    await del(
      'social_graph_history',
      sql`lower(t.old_value) = ${identifier} OR lower(t.new_value) = ${identifier}`
    );
  }

  // The saved copies we hold and serve. Non-fail-soft: an error here aborts
  // the removal report rather than logging and shrugging, because a filter
  // upstream can mask a broken amend forever.
  //
  // A job row mid-processing can rewrite partial_results from worker memory
  // after this statement runs; the committed suppression rows make the next
  // social-graph write of that data a no-op, the serve-time filter covers
  // the read, and re-running this endpoint amends whatever landed.
  const historyRows = await amendSavedCopies(
    db,
    'lookup_history',
    'results',
    identifier,
    RESULT_MATCH_KEY[kind],
    RESULT_STRIP[kind],
    kind === 'twitter'
  );
  steps.push({ table: 'lookup_history', action: 'amended', rows: historyRows });
  const jobRows = await amendSavedCopies(
    db,
    'lookup_jobs',
    'partial_results',
    identifier,
    RESULT_MATCH_KEY[kind],
    RESULT_STRIP[kind],
    kind === 'twitter'
  );
  steps.push({ table: 'lookup_jobs', action: 'amended', rows: jobRows });

  return { steps, quarantined };
}

/** How each blanked table-and-kind pair is put back. Conservative on
 *  purpose: every column restores only where the live row still has NULL
 *  (the right-hand sides of an UPDATE's SET all read the pre-update tuple),
 *  so a value that arrived after the removal is never overwritten by a
 *  copy up to 30 days old. */
const RESTORE_SET: Record<string, Record<SuppressionKind, string>> = {
  social_graph: {
    wallet: '', // wallet rows are deleted, not blanked
    twitter: `
      twitter_handle = COALESCE(g.twitter_handle, s.row_data ->> 'twitter_handle'),
      twitter_url = COALESCE(g.twitter_url, s.row_data ->> 'twitter_url'),
      twitter_user_id = COALESCE(g.twitter_user_id, s.row_data ->> 'twitter_user_id'),
      twitter_renamed_from = COALESCE(g.twitter_renamed_from, s.row_data ->> 'twitter_renamed_from'),
      twitter_verified = CASE WHEN g.twitter_handle IS NULL
        THEN COALESCE((s.row_data ->> 'twitter_verified')::boolean, false)
        ELSE g.twitter_verified END`,
    farcaster: `
      farcaster = COALESCE(g.farcaster, s.row_data ->> 'farcaster'),
      farcaster_url = COALESCE(g.farcaster_url, s.row_data ->> 'farcaster_url'),
      fc_fid = COALESCE(g.fc_fid, (s.row_data ->> 'fc_fid')::int),
      fc_followers = COALESCE(g.fc_followers, (s.row_data ->> 'fc_followers')::int),
      farcaster_verified = CASE WHEN g.farcaster IS NULL
        THEN COALESCE((s.row_data ->> 'farcaster_verified')::boolean, false)
        ELSE g.farcaster_verified END`,
    ens: `ens_name = COALESCE(g.ens_name, s.row_data ->> 'ens_name')`,
    lens: `lens = COALESCE(g.lens, s.row_data ->> 'lens')`,
    github: `github = COALESCE(g.github, s.row_data ->> 'github')`,
  },
  wallet_cache: {
    wallet: '',
    twitter: `
      twitter_handle = COALESCE(g.twitter_handle, s.row_data ->> 'twitter_handle'),
      twitter_url = COALESCE(g.twitter_url, s.row_data ->> 'twitter_url')`,
    farcaster: `
      farcaster = COALESCE(g.farcaster, s.row_data ->> 'farcaster'),
      farcaster_url = COALESCE(g.farcaster_url, s.row_data ->> 'farcaster_url'),
      fc_fid = COALESCE(g.fc_fid, (s.row_data ->> 'fc_fid')::int),
      fc_followers = COALESCE(g.fc_followers, (s.row_data ->> 'fc_followers')::int)`,
    ens: `ens_name = COALESCE(g.ens_name, s.row_data ->> 'ens_name')`,
    lens: `lens = COALESCE(g.lens, s.row_data ->> 'lens')`,
    github: `github = COALESCE(g.github, s.row_data ->> 'github')`,
  },
};

/** The tables whose deleted rows a given kind can have quarantined. */
const DELETED_TABLES: Record<SuppressionKind, string[]> = {
  wallet: [
    'social_graph',
    'wallet_cache',
    'handle_conflicts',
    'social_graph_history',
    'wallet_holdings',
    'known_agents',
  ],
  twitter: [
    'x_accounts',
    'handle_conflicts',
    'social_graph_history',
    'known_agents',
    'lookup_history',
  ],
  farcaster: [
    'handle_conflicts',
    'social_graph_history',
    'known_agents',
    'lookup_history',
  ],
  ens: ['social_graph_history'],
  lens: ['social_graph_history'],
  github: ['social_graph_history'],
};

/**
 * Primary-key columns per restorable table, read out of each quarantined
 * copy's jsonb. The restore below needs them to tell three outcomes apart:
 * the re-insert landed; a live row already exists and wins; or a trigger
 * refused the insert (a sibling suppression still covers it) and the copy
 * must be KEPT for a later re-run. Mirrors `db/schema.ts`; non-text key
 * columns compare through `::text`, which is how jsonb stored them.
 */
const RESTORE_PK: Record<string, readonly string[]> = {
  social_graph: ['wallet'],
  wallet_cache: ['wallet'],
  handle_conflicts: ['wallet', 'platform', 'their_source'],
  social_graph_history: ['id'],
  wallet_holdings: ['wallet', 'contract', 'chain'],
  x_accounts: ['handle'],
  known_agents: ['wallet'],
  lookup_history: ['id'],
};

export interface UnsuppressReport {
  kind: SuppressionKind;
  identifier: string;
  suppressionDeleted: boolean;
  /** Quarantine rows restored (or superseded by a newer live row) per
   *  table. A restored row passes back through the storage triggers, so
   *  anything still covered by another suppression row stays out; that is
   *  the correct outcome, not a bug. */
  restored: RemovalStep[];
  /** Quarantine copies left IN PLACE because their restore did not land:
   *  a sibling suppression refused the write, or the base row a blank
   *  would restore into is gone. Not a failure: lift the sibling
   *  suppression, then run this un-suppress again and these restore. The
   *  copies still purge at `purge_after` like any others. */
  kept: RemovalStep[];
  /** Set when `kept` is non-empty: what the operator should do about it. */
  note?: string;
}

/**
 * Reverses a removal from the quarantine copy. Operator-only in stage 1;
 * the `lane` column exists so a later stage can require same-or-stronger
 * verification per lane without a schema change.
 *
 * Order: the suppression row is deleted FIRST, then the rows are restored,
 * because a restore write made while the suppression row still exists would
 * be refused or blanked by the very triggers that make suppression real.
 * If the quarantine copy is already purged (past
 * `QUARANTINE_RETENTION_DAYS`), the restore is refused: re-collection is
 * the only path back, and `acknowledgePurged` is how the operator accepts
 * that and deletes the bare suppression row so re-collection can happen.
 */
export async function unsuppressIdentifier(
  db: Db,
  kind: SuppressionKind,
  identifier: string,
  acknowledgePurged: boolean
): Promise<UnsuppressReport | { refusal: string; status: number }> {
  // The age comparison runs in SQL, against the same clock that wrote the
  // row. Parsing a `timestamp` string into a JS Date shifts it by the local
  // offset (the documented raw-SQL trap: correct on UTC production, wrong
  // on a laptop), and this check decides whether a restore is refused.
  const supp = (await db.execute(sql`
    SELECT (created_at < now() - ${sql.raw(String(QUARANTINE_RETENTION_DAYS))} * interval '1 day')
             AS past_retention
    FROM suppressed_identifiers
    WHERE kind = ${kind} AND identifier = ${identifier}
  `)) as unknown as { rows: Array<{ past_retention: boolean }> };

  const quarantineCount = (await db.execute(sql`
    SELECT count(*)::int AS n FROM suppression_quarantine
    WHERE kind = ${kind} AND identifier = ${identifier}
  `)) as unknown as { rows: Array<{ n: number }> };
  const held = quarantineCount.rows[0]?.n ?? 0;

  if (supp.rows.length === 0 && held === 0) {
    return { refusal: 'Not suppressed', status: 404 };
  }

  if (supp.rows.length > 0 && held === 0) {
    // The jitter backdates created_at by up to TIMESTAMP_JITTER_HOURS, so
    // this can read "past retention" a few hours early on a suppression
    // that never had a quarantine copy at all; the acknowledgement path
    // recovers that case.
    if (supp.rows[0].past_retention && !acknowledgePurged) {
      return {
        refusal:
          `The quarantine copy has been purged (${QUARANTINE_RETENTION_DAYS}-day retention). ` +
          'Re-collection is the only path back: un-suppressing now removes the block and the ' +
          'identity returns only as the pipelines rediscover it. Pass acknowledgePurged to proceed.',
        status: 409,
      };
    }
  }

  // Suppression row first; see the function comment.
  const deleted = (await db.execute(sql`
    DELETE FROM suppressed_identifiers
    WHERE kind = ${kind} AND identifier = ${identifier}
    RETURNING kind
  `)) as unknown as { rows: unknown[] };

  const restored: RemovalStep[] = [];

  // Deleted rows: re-insert the quarantined copy. Whether a quarantine row
  // was a deletion or a blank is determined by (kind, source_table): only
  // a wallet-kind removal deletes from social_graph and wallet_cache, and
  // DELETED_TABLES encodes exactly that split, so no action column is
  // needed.
  //
  // A quarantine copy is deleted ONLY when its restore landed or a newer
  // live row supersedes it, and the two are told apart by primary key:
  // the tuple came back from the INSERT's RETURNING (landed), or a live
  // row with the copy's key already existed in the statement snapshot
  // (ON CONFLICT swallowed the insert; a row that re-exists is newer than
  // a copy up to 30 days old, so the live one wins). A trigger REFUSING
  // the insert (a sibling suppression still covers something on the row)
  // matches neither, and that copy is kept: deleting it would destroy the
  // only restorable state inside the undo window. Restore and cleanup stay
  // one statement, so a failure leaves every copy in place for a re-run.
  for (const table of DELETED_TABLES[kind]) {
    const pk = RESTORE_PK[table];
    const pkFromSrc = sql.raw(
      pk.map((c) => `src.row_data ->> '${c}'`).join(', ')
    );
    const pkFromIns = sql.raw(pk.map((c) => `${c}::text`).join(', '));
    const liveMatch = sql.raw(
      pk.map((c) => `live.${c}::text = src.row_data ->> '${c}'`).join(' AND ')
    );
    const res = (await db.execute(sql`
      WITH src AS (
        SELECT id, row_data FROM suppression_quarantine
        WHERE kind = ${kind} AND identifier = ${identifier}
          AND source_table = ${table}
      ),
      ins AS (
        INSERT INTO ${sql.raw(table)}
        SELECT p.* FROM src,
          LATERAL jsonb_populate_record(NULL::${sql.raw(table)}, src.row_data) p
        ON CONFLICT DO NOTHING
        RETURNING ${pkFromIns}
      )
      DELETE FROM suppression_quarantine q USING src
      WHERE q.id = src.id
        AND ((${pkFromSrc}) IN (SELECT * FROM ins)
          OR EXISTS (
            SELECT 1 FROM ${sql.raw(table)} live WHERE ${liveMatch}
          ))
      RETURNING q.id
    `)) as unknown as { rows: unknown[] };
    if (res.rows.length > 0) {
      restored.push({ table, action: 'deleted', rows: res.rows.length });
    }
  }

  // Blanked rows: put the kind's columns back where they are still NULL.
  // For a non-wallet kind, every quarantine row for these two tables is a
  // blank (only wallet-kind removals delete from them), so (kind,
  // source_table) is the whole predicate. The copy is deleted only when
  // its UPDATE actually matched the base row (RETURNING drives the
  // delete): a base row deleted since (by a wallet-kind removal of that
  // wallet) keeps its copy for a re-run after that wallet is restored.
  if (kind !== 'wallet') {
    for (const table of ['social_graph', 'wallet_cache'] as const) {
      const res = (await db.execute(sql`
        WITH src AS (
          SELECT id, row_data FROM suppression_quarantine
          WHERE kind = ${kind} AND identifier = ${identifier}
            AND source_table = ${table}
        ),
        upd AS (
          UPDATE ${sql.raw(table)} g
          SET ${sql.raw(RESTORE_SET[table][kind])}
          FROM src s
          WHERE g.wallet = s.row_data ->> 'wallet'
          RETURNING g.wallet
        )
        DELETE FROM suppression_quarantine q USING src
        WHERE q.id = src.id
          AND (src.row_data ->> 'wallet') IN (SELECT wallet FROM upd)
        RETURNING q.id
      `)) as unknown as { rows: unknown[] };
      if (res.rows.length > 0) {
        restored.push({ table, action: 'blanked', rows: res.rows.length });
      }
    }
  }

  // What is left is what could not restore yet. Named to the operator
  // rather than silently held: these copies restore on a re-run once the
  // blocking suppression is lifted, and purge on schedule regardless.
  const keptRes = (await db.execute(sql`
    SELECT source_table, count(*)::int AS n FROM suppression_quarantine
    WHERE kind = ${kind} AND identifier = ${identifier}
    GROUP BY source_table ORDER BY source_table
  `)) as unknown as { rows: Array<{ source_table: string; n: number }> };
  const kept: RemovalStep[] = keptRes.rows.map((r) => ({
    table: r.source_table,
    action: 'deleted',
    rows: r.n,
  }));

  // The jsonb amendments are NOT reversed: a saved lookup's stripped keys
  // are gone, and the un-suppressed identity returns to saved copies only
  // if the customer runs the lookup again. Stated here so nobody adds a
  // "restore the amend" pass that would need a copy of the very mapping
  // the amend erased.

  return {
    kind,
    identifier,
    suppressionDeleted: deleted.rows.length > 0,
    restored,
    kept,
    note:
      kept.length > 0
        ? 'Some quarantine copies could not restore yet: a sibling suppression refused the write, or the base row is gone. Lift the blocking suppression and run this un-suppress again; the copies purge on schedule either way.'
        : undefined,
  };
}

export interface SuppressionListRow {
  kind: SuppressionKind;
  identifier: string;
  identifierMasked: string;
  lane: string;
  reason: string;
  /** Jittered, so a day, never a time: the stored timestamp is deliberately
   *  backdated by up to TIMESTAMP_JITTER_HOURS. */
  createdDay: string;
  quarantineRows: number;
  /** ISO day the earliest quarantined copy becomes purgeable; null when
   *  nothing was quarantined (or it is already purged). */
  quarantineExpires: string | null;
}

export async function listRecentSuppressions(
  db: Db,
  limit: number
): Promise<{ total: number; rows: SuppressionListRow[] }> {
  const totalRes = (await db.execute(sql`
    SELECT count(*)::int AS n FROM suppressed_identifiers
  `)) as unknown as { rows: Array<{ n: number }> };

  const res = (await db.execute(sql`
    SELECT s.kind, s.identifier, s.lane, s.reason,
           to_char(s.created_at, 'YYYY-MM-DD') AS created_day,
           COALESCE(q.n, 0) AS quarantine_rows,
           -- purge_after is the enforcing column the cleanup cron reads,
           -- so the pane shows that rather than re-deriving a date.
           to_char(q.earliest_purge, 'YYYY-MM-DD') AS quarantine_expires
    FROM suppressed_identifiers s
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n, min(purge_after) AS earliest_purge
      FROM suppression_quarantine q
      WHERE q.kind = s.kind AND q.identifier = s.identifier
    ) q ON true
    ORDER BY s.created_at DESC
    LIMIT ${limit}
  `)) as unknown as {
    rows: Array<{
      kind: SuppressionKind;
      identifier: string;
      lane: string;
      reason: string;
      created_day: string;
      quarantine_rows: number;
      quarantine_expires: string | null;
    }>;
  };

  return {
    total: totalRes.rows[0]?.n ?? 0,
    rows: res.rows.map((r) => ({
      kind: r.kind,
      identifier: r.identifier,
      identifierMasked: maskIdentifier(r.kind, r.identifier),
      lane: r.lane,
      reason: r.reason,
      createdDay: r.created_day,
      quarantineRows: r.quarantine_rows,
      quarantineExpires: r.quarantine_expires,
    })),
  };
}

export interface ClusterAlarm {
  /** Distinct recently suppressed wallets that belong to any seeded
   *  collection: the pool the starter cards and /holders pages draw from. */
  starterHits: number;
  windowDays: number;
  threshold: number;
  warning: boolean;
  clusters: Array<{
    name: string;
    chain: string;
    address: string;
    suppressed: number;
  }>;
}

/**
 * Counts recent wallet-kind suppressions that sit inside seeded
 * collections, so a burst of removals aimed at one collection's holders is
 * visible to the operator at the moment the next one is executed.
 *
 * Two sources, unioned, because this endpoint's own deletions would
 * otherwise blind the alarm: a suppressed wallet's `wallet_holdings` rows
 * move to quarantine at removal time, and the quarantine copy outlives the
 * alarm window. Membership means "in a collection the seed corpus holds";
 * the listing floor (`lib/holder-pages.ts`) is deliberately not applied,
 * because it costs a whole-corpus reachability aggregate and an over-wide
 * warning is the cheap failure for a signal that never blocks anything.
 *
 * The window is widened by the timestamp jitter, since a row's recorded
 * `created_at` can sit up to TIMESTAMP_JITTER_HOURS before its true insert.
 */
export async function clusteringAlarm(db: Db): Promise<ClusterAlarm> {
  const windowSql = sql.raw(
    `now() - interval '${CLUSTER_ALARM_WINDOW_DAYS} days' - interval '${TIMESTAMP_JITTER_HOURS} hours'`
  );

  const memberCte = sql`
    WITH recent AS (
      SELECT identifier FROM suppressed_identifiers
      WHERE kind = 'wallet' AND created_at >= ${windowSql}
    ),
    member AS (
      SELECT r.identifier, wh.contract, wh.chain
      FROM recent r
      JOIN wallet_holdings wh ON wh.wallet = r.identifier
      UNION
      SELECT r.identifier, q.row_data ->> 'contract', q.row_data ->> 'chain'
      FROM recent r
      JOIN suppression_quarantine q
        ON q.kind = 'wallet' AND q.identifier = r.identifier
       AND q.source_table = 'wallet_holdings'
    )
  `;

  const totalRes = (await db.execute(sql`
    ${memberCte}
    SELECT count(DISTINCT m.identifier)::int AS n
    FROM member m
    JOIN seeded_contracts sc ON sc.address = m.contract AND sc.chain = m.chain
    WHERE sc.holders_imported > 0 AND sc.name IS NOT NULL
  `)) as unknown as { rows: Array<{ n: number }> };

  const clustersRes = (await db.execute(sql`
    ${memberCte}
    SELECT sc.name, sc.chain, sc.address,
           count(DISTINCT m.identifier)::int AS suppressed
    FROM member m
    JOIN seeded_contracts sc ON sc.address = m.contract AND sc.chain = m.chain
    WHERE sc.holders_imported > 0 AND sc.name IS NOT NULL
    GROUP BY sc.name, sc.chain, sc.address
    ORDER BY suppressed DESC, sc.name
    LIMIT 5
  `)) as unknown as {
    rows: Array<{
      name: string;
      chain: string;
      address: string;
      suppressed: number;
    }>;
  };

  const starterHits = totalRes.rows[0]?.n ?? 0;
  return {
    starterHits,
    windowDays: CLUSTER_ALARM_WINDOW_DAYS,
    threshold: CLUSTER_ALARM_THRESHOLD,
    warning: starterHits >= CLUSTER_ALARM_THRESHOLD,
    clusters: clustersRes.rows,
  };
}
