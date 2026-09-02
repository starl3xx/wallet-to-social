/**
 * The suppression list, the quarantine table, and the triggers that make the
 * removal promise mean something. Right-to-removal, stage 1: storage.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-suppression.ts
 *        (must be the OWNER DATABASE_URL. The pooler host is rewritten to the
 *        direct endpoint below, because this takes DDL locks. See CLAUDE.md.)
 *
 * Hand-applied SQL, like every other migration here: `npm run db:push` refuses,
 * `db/migrations/` is a write-only artefact, and production has known drift from
 * `db/schema.ts`. Idempotent, and it verifies what it did.
 *
 * ## What is broken today
 *
 * `app/privacy/page.tsx` tells anybody in the index, used the service or not:
 * "Write to us with the address or handle and we will remove it." The same page
 * then admits, honestly, that "a removal can undo itself": nothing stops an
 * automated sweep from finding the same public record again and adding it back.
 * "Until that is built, write to us again and we will remove it again."
 *
 * This migration is the storage half of that build. `lib/farcaster-sweep.ts:234`,
 * `lib/ens-harvest.ts:416`, `lib/attested-links.ts:273` and three call sites in
 * `lib/social-graph.ts` (:463, :975, :1187) all upsert into `social_graph` on a
 * schedule, from sources that still hold the mapping, and the sweep also runs a
 * raw `UPDATE social_graph` (`lib/farcaster-sweep.ts:623`; its raw DELETE at
 * :664 needs no guard, since deleting is the point). A row deleted by hand
 * comes back on the next sweep. After this migration, it cannot.
 *
 * ## One row per identifier, and never a row that holds two
 *
 * The obvious table is `(wallet, platform, handle)`. It is the wrong table, and
 * the reason is the whole point of the feature: a row pairing a wallet with a
 * handle **is** the edge the person asked us to erase. Writing it into a table
 * that nothing ever sweeps would re-create the mapping, permanently, as a side
 * effect of honouring the request to destroy it.
 *
 * So the key is `(kind, identifier)` and a row carries exactly one identifier.
 * A request naming both an address and a handle becomes two independent rows
 * and no column in this schema joins them. The promise accepts either; the
 * table accepts either; it never stores the pair.
 *
 * ## Jittered timestamps, so the rows cannot be re-joined
 *
 * A shared `DEFAULT now()` would quietly rebuild the join the key refuses to
 * store: two rows inserted by one request land with the same transaction
 * timestamp, and anyone who can read the table (which includes the scheduled
 * read-only role) can pair them by equality. So `requested_at` and
 * `created_at` default to `now() - random() * interval '4 hours'`, evaluated
 * per row and per column, which makes co-batched rows carry unrelated values.
 * Both columns are therefore approximate by up to four hours, backward only,
 * and that is the cost of not storing the association.
 *
 * The default is the mechanism, so application code must never supply these
 * columns explicitly: an endpoint that wrote `now()` itself would silently
 * defeat the jitter for every row it inserts. The verification below reads the
 * live default expression out of `pg_attrdef` and fails if `random()` is not
 * in it.
 *
 * ## In the clear, not hashed, and the tension that leaves
 *
 * To suppress an identifier you have to recognise it on every write, and to
 * recognise it you have to keep it. Retaining an identifier in order to honour
 * a request to erase it is itself processing of that person's data. There is no
 * arrangement of this feature that avoids the contradiction, and pretending
 * otherwise is how it gets hidden. It is stated here instead.
 *
 * Hashing does not resolve it, it only looks like it does:
 *
 *  - A social handle is drawn from a public, enumerable namespace. We hold
 *    over a million X handles in `social_graph` in the same database. Anybody
 *    who could read a hashed suppression table could recover every entry by
 *    hashing that list, in seconds. Against the only adversary who can reach
 *    the table, an unkeyed hash of a handle is worth nothing.
 *  - A keyed hash (HMAC) does resist that, but the key has to be available
 *    wherever the check runs. The check runs in the database, inside a trigger,
 *    because that is the only place that covers a `psql` session and a script
 *    written next year. Putting the key in the database next to the ciphertext
 *    is not a key, it is a longer column name.
 *  - Hashing also destroys the operational property that matters most: an
 *    operator handling a mail from a person cannot see what is on the list, so
 *    cannot tell them "yes, this is suppressed" or find and fix a request that
 *    was recorded in the wrong shape. A suppression that silently matches
 *    nothing is indistinguishable from a suppression that works.
 *
 * What is actually required is minimisation, and that is what the columns do:
 * one public identifier per row, no requester, no contact address, no free
 * text. The marginal disclosure over what we already publish is the bare fact
 * that somebody objected, and that fact is the record of the promise being
 * kept. It is not incidental data, it is the audit trail.
 *
 * **No requester column, deliberately.** The privacy page refuses to demand
 * proof of ownership, because the alternative is asking a stranger for more
 * information than we already hold about them. Recording who asked would
 * collect exactly that information after the fact. `reason` is therefore a
 * closed vocabulary enforced by a CHECK rather than free text, so the field
 * cannot quietly become the place an operator pastes somebody's email address.
 *
 * **`lane` records a verification method, never a person.** The reversal rule
 * is that un-suppressing must demand the same or stronger verification than
 * the suppression did, which requires remembering how a row was verified:
 * `email` (the stage 1 support lane), `wallet_sig` (a wallet signature, stage
 * 2), `handle_proof` (a posted nonce, stage 2), `legal` (a court or
 * regulator). It is a closed CHECK vocabulary for the same reason `reason` is:
 * a lane can never name, quote, or point at the requester.
 *
 * ## The quarantine table: the 30-day undo window
 *
 * The email lane demands no proof, so a plausible mail can suppress somebody
 * else's identifier. The repair for that is reversibility: before the removal
 * endpoint deletes a row from the index, it copies the row here as jsonb, with
 * the source table name and the (kind, identifier) of the suppression that
 * caused it. Un-suppress restores from this copy, operator-only in stage 1.
 * `purge_after` is 30 days out, and the cleanup cron
 * (`app/api/cron/cleanup/route.ts`) must delete rows past it; until that
 * branch ships, the operator purges by hand.
 *
 * `suppression_quarantine` is the most sensitive table in this database for
 * its 30 days: unlike the suppression list, its `row_data` DOES hold the
 * erased edge, wallet and handles together. So it is operator-only, enforced
 * and verified below:
 *
 *  - NOT in `READ_ONLY_TABLES` (scripts/migrate-grant-readonly.ts):
 *    `sweep_runner` must never read it.
 *  - NOT in `BACKUP_TABLES` or the `pg_dump -t` list
 *    (.github/workflows/db-backup.yml): a backup would extend the stated
 *    30-day retention past the promise.
 *  - No FK to `suppressed_identifiers`, so the operator flow, not the schema,
 *    owns the ordering: quarantine rows are written after the suppression row
 *    commits, and an un-suppress reads them after deleting it.
 *
 * `suppressed_identifiers` itself goes in BOTH lists, and the asymmetry is the
 * restore semantics: a backup restored WITHOUT the suppression list would
 * un-remove every person who asked to be gone, while a restore WITH it plus
 * these triggers means any restored identity row re-suppresses on its next
 * write, and the pre-flight filter holds in the meantime.
 *
 * ## Why triggers, and not a check in the write paths
 *
 * There are six upsert sites into `social_graph` and raw statements besides
 * (`lib/farcaster-sweep.ts:623`). An application-level check is an obligation
 * that nothing fails without, which is precisely the shape this repo keeps
 * getting caught by: the `sweep_runner` grant, the published-figures registry,
 * the backup table list. Each was a list somebody had to remember.
 *
 * A trigger cannot be forgotten by a new script, a hand-run backfill, or a
 * `psql` window. It is the only enforcement that is not a checklist.
 *
 * ## Both INSERT and UPDATE, and why INSERT alone would look right
 *
 * Postgres fires BEFORE INSERT triggers for every proposed row of an
 * `INSERT ... ON CONFLICT DO UPDATE`, and their effects are reflected in
 * `EXCLUDED`. So a BEFORE INSERT trigger that blanks a suppressed handle makes
 * `EXCLUDED.twitter_handle` NULL, and `lib/social-graph.ts`'s
 * `COALESCE(EXCLUDED.twitter_handle, social_graph.twitter_handle)` then keeps
 * the stored handle. The blank would have been perfectly applied and changed
 * nothing. The BEFORE UPDATE trigger is what actually clears the merged row.
 *
 * ## RETURN NULL: the write is skipped, silently
 *
 * A suppressed wallet makes the whole row vanish from the statement. The batch
 * reports 500 and writes 499. That is deliberate: `lib/farcaster-sweep.ts`
 * writes in batches of 500, and raising an exception would abort the batch and
 * take 499 unrelated wallets with it, turning one person's erasure request into
 * a sweep outage.
 *
 * A counter on the suppression row was considered and rejected. Two concurrent
 * batches that both touch two suppressed wallets can lock those rows in
 * opposite orders, and a deadlock would abort a whole batch to record a
 * statistic. The evidence that the guard works belongs in a test that tries it,
 * not in a counter. See the probes at the end of this file, which do exactly
 * that against the live database, and roll back.
 *
 * ## SECURITY DEFINER
 *
 * The functions run as the owner. Without that, `sweep_runner` would need SELECT
 * on `suppressed_identifiers` for every `social_graph` write, and a missing
 * grant would not merely fail a read: it would break the write path itself, in
 * CI, on a run that passed locally. The guard must not be able to become the
 * thing that breaks writes.
 *
 * PUBLIC keeps EXECUTE, which is safe here because Postgres refuses to call a
 * function returning `trigger` outside a trigger context ("trigger functions
 * can only be called as triggers"), so there is no callable surface to revoke.
 *
 * The table is still added to `READ_ONLY_TABLES` in
 * `scripts/migrate-grant-readonly.ts`, so a scheduled check can read it and
 * assert that nothing on the list appears in the index.
 *
 * ## What this migration does NOT do
 *
 *  1. **The endpoint.** Writing the suppression, quarantining and deleting the
 *     existing rows is application code. The order is load-bearing and belongs
 *     with it: **insert the suppression and commit it FIRST, then copy to
 *     quarantine, then delete.** The other way round leaves a window in which
 *     an in-flight batch re-inserts the row after the delete and before the
 *     guard exists.
 *  2. **The read path.** These triggers stop re-collection landing. They do not
 *     stop us asking: a lookup of a suppressed wallet still calls the upstream
 *     resolvers and then discards the answer. That is still processing, and it
 *     costs credits. Worse, the trigger blocks `upsertNegativeWallets`
 *     (lib/social-graph.ts:946), so without a pre-flight filter in
 *     `lib/job-processor.ts` a suppressed wallet with no cached row runs the
 *     full external pipeline on every lookup: re-collection moves from monthly
 *     to per-lookup. The filter is mandatory before this ships.
 *  3. **`lookup_history.results` and `lookup_jobs` payloads.** A person's
 *     mapping can sit inside a customer's saved jsonb result set. Nothing here
 *     reaches into it. The serve-time filter and the per-removal jsonb amend
 *     are application code in the removal endpoint and the history/jobs reads.
 *  4. **The quarantine purge.** `purge_after` is data; the cleanup cron branch
 *     that honours it ships with the endpoint.
 *
 * ## Rollback
 *
 *   DROP TRIGGER IF EXISTS suppression_guard ON social_graph;
 *   DROP TRIGGER IF EXISTS suppression_guard ON wallet_cache;
 *   DROP TRIGGER IF EXISTS suppression_guard ON x_accounts;
 *   DROP TRIGGER IF EXISTS suppression_guard ON handle_conflicts;
 *   DROP TRIGGER IF EXISTS suppression_guard ON social_graph_history;
 *   DROP TRIGGER IF EXISTS suppression_guard ON wallet_holdings;
 *   DROP TRIGGER IF EXISTS suppression_guard ON known_agents;
 *   DROP FUNCTION IF EXISTS suppression_guard_row();
 *   DROP FUNCTION IF EXISTS suppression_guard_skip();
 *
 * The two tables are deliberately not in that list. `suppressed_identifiers`
 * is the record of promises made, and dropping it destroys the only evidence
 * that they were. `suppression_quarantine` holds every undo younger than 30
 * days, and dropping it turns each of those removals irreversible early.
 */
import { Pool } from '@neondatabase/serverless';
import { randomBytes } from 'node:crypto';

/**
 * The identifier kinds, one per column in the index that names a person.
 *
 * `wallet` is not a platform, which is why this column is `kind` and not
 * `platform` as on `handle_conflicts`. `lens` and `github` are here because
 * `social_graph` stores both (`lib/social-graph.ts`, `db/schema.ts:107-108`)
 * and a suppression vocabulary that omits a column we hold cannot honour a
 * request about it.
 */
const KINDS = ['wallet', 'twitter', 'farcaster', 'ens', 'lens', 'github'];

/**
 * Why a suppression exists, not who asked for it.
 *
 *   requested  a person wrote to the support address
 *   operator   we suppressed it on our own initiative
 *   legal      a court or regulator required it
 */
const REASONS = ['requested', 'operator', 'legal'];

/**
 * How the request was verified, not who made it. Reversal must demand the
 * same or stronger verification than the removal, and this is the column that
 * lets an endpoint enforce that without remembering a person.
 *
 *   email         the stage 1 support lane; no proof demanded
 *   wallet_sig    a wallet signature over a server challenge (stage 2)
 *   handle_proof  a server nonce posted from the handle (stage 2)
 *   legal         a court or regulator; never self-serve reversible
 */
const LANES = ['email', 'wallet_sig', 'handle_proof', 'legal'];

/**
 * Tables that store identifiers and deliberately do NOT get the guard.
 *
 * SUPPRESSION EXCLUSION BOUNDARY (decision 2, 2026-09-02). These are the
 * negative and dedupe tables: each row means "do not process this identifier
 * again" or "already seen, skip it". Deleting or blocking those markers would
 * INCREASE processing of the exact person who asked to be left alone: the
 * sweep would re-visit their FID, the X resolver would re-attempt their
 * handle, the clanker backfill would re-query their identifier. Suppression's
 * job is less processing, so the do-not-reprocess memory stays.
 *
 * `farcaster_sweep_seen` also has a runtime-suffixed twin
 * (`farcaster_sweep_seen_<timestamp>`, created by lib/farcaster-sweep.ts), so
 * the verification below matches the prefix, not just the name.
 *
 * Also outside the trigger scope, for different reasons, none of them this
 * boundary:
 *  - `users`, `whitelist`, `x402_recovery_redemptions`: account, billing and
 *    credential records of the service's own users, given in a transaction,
 *    not collected. A trigger here would let a suppression refuse a purchase.
 *  - `lookup_history`, `lookup_jobs`: identifiers live inside customer jsonb
 *    payloads, not columns; they are handled by the payload TTL, the
 *    serve-time filter and the per-removal jsonb amend (decision 5).
 *  - `seeded_contracts`: token contract addresses, not people.
 *
 * scripts/check-invariants.ts can anchor on this constant the way it anchors
 * on BACKUP_TABLES in migrate-grant-readonly.ts.
 */
const SUPPRESSION_EXCLUDED_TABLES = [
  'x_handle_attempts',
  'clanker_unresolved_ids',
  'farcaster_sweep_seen',
];

interface CheckConstraint {
  name: string;
  expression: string;
}

/**
 * Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so each is added only when
 * `pg_constraint` says it is absent. The same pattern as
 * `scripts/migrate-money-fks.ts`.
 */
const CHECKS: CheckConstraint[] = [
  {
    name: 'suppressed_identifiers_kind_check',
    expression: `kind = ANY (ARRAY[${KINDS.map((k) => `'${k}'`).join(', ')}])`,
  },
  {
    name: 'suppressed_identifiers_reason_check',
    expression: `reason = ANY (ARRAY[${REASONS.map((r) => `'${r}'`).join(', ')}])`,
  },
  {
    name: 'suppressed_identifiers_lane_check',
    expression: `lane = ANY (ARRAY[${LANES.map((l) => `'${l}'`).join(', ')}])`,
  },
  {
    /**
     * Normalisation, enforced rather than assumed.
     *
     * The guard compares `lower(NEW.twitter_handle)` against `identifier`. A
     * row stored as '@Alice' or 'Alice' therefore matches nothing, and a
     * suppression that matches nothing looks exactly like one that works: no
     * error, no row, no sign. This is the one failure mode the feature cannot
     * tolerate, so the shape is a constraint and not a convention.
     *
     * The wallet pattern is the lowercase half of `/^0x[a-fA-F0-9]{40}$/`, the
     * form used in `lib/api-auth.ts` and `lib/csv-parser.ts`, because
     * `social_graph.wallet` is lowercase.
     */
    name: 'suppressed_identifiers_identifier_check',
    expression: `
      identifier = lower(identifier)
      AND identifier = btrim(identifier)
      AND length(identifier) > 0
      AND identifier NOT LIKE '@%'
      AND identifier NOT LIKE '%/%'
      AND (kind <> 'wallet' OR identifier ~ '^0x[0-9a-f]{40}$')
    `,
  },
];

/**
 * Per-row, per-column jitter: see the header. Backward only, so a suppression
 * never claims to come from the future.
 */
const JITTERED_DEFAULT = `(now() - random() * interval '4 hours')`;

/**
 * The guard that edits the row, for the two tables that hold a wallet next to
 * the handles it resolves to.
 *
 * `wallet_cache` lacks `twitter_user_id`, `twitter_verified`,
 * `farcaster_verified` and `twitter_renamed_from`. PL/pgSQL prepares an
 * expression the first time it executes, so the `TG_TABLE_NAME` branches below
 * are never resolved against a row type that has no such column. That is a real
 * dependency on a language behaviour rather than a schema fact, so it is not
 * left as an assumption: probe 5 at the end of this file writes a
 * `wallet_cache` row through this function and fails the migration if it
 * raises.
 */
const GUARD_ROW = `
CREATE OR REPLACE FUNCTION suppression_guard_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  hits text[];
BEGIN
  -- One statement, so one plan and one bitmap over the primary key, rather
  -- than six probes per written row.
  SELECT array_agg(s.kind) INTO hits
  FROM public.suppressed_identifiers s
  WHERE (s.kind = 'wallet'    AND s.identifier = lower(NEW.wallet))
     OR (s.kind = 'twitter'   AND s.identifier = lower(NEW.twitter_handle))
     OR (s.kind = 'farcaster' AND s.identifier = lower(NEW.farcaster))
     OR (s.kind = 'ens'       AND s.identifier = lower(NEW.ens_name))
     OR (s.kind = 'lens'      AND s.identifier = lower(NEW.lens))
     OR (s.kind = 'github'    AND s.identifier = lower(NEW.github));

  IF hits IS NULL THEN
    RETURN NEW;
  END IF;

  -- A suppressed wallet takes the whole row. Nothing on it is separable from
  -- the address, because the address is the key.
  IF 'wallet' = ANY (hits) THEN
    RETURN NULL;
  END IF;

  IF 'twitter' = ANY (hits) THEN
    NEW.twitter_handle := NULL;
    NEW.twitter_url := NULL;
    IF TG_TABLE_NAME = 'social_graph' THEN
      NEW.twitter_user_id := NULL;
      NEW.twitter_verified := false;
    END IF;
  END IF;

  IF 'farcaster' = ANY (hits) THEN
    NEW.farcaster := NULL;
    NEW.farcaster_url := NULL;
    NEW.fc_fid := NULL;
    NEW.fc_followers := NULL;
    IF TG_TABLE_NAME = 'social_graph' THEN
      NEW.farcaster_verified := false;
    END IF;
  END IF;

  IF 'ens'    = ANY (hits) THEN NEW.ens_name := NULL; END IF;
  IF 'lens'   = ANY (hits) THEN NEW.lens     := NULL; END IF;
  IF 'github' = ANY (hits) THEN NEW.github   := NULL; END IF;

  /*
   * twitter_renamed_from is checked on its own, not folded into the query
   * above. It holds a DIFFERENT handle to twitter_handle (the dead one the
   * conflict resolver replaced), so a match on it must not clear the live
   * handle beside it, and a match on the live handle must not clear it.
   *
   * Clearing it costs nothing that suppression does not already give: the
   * column exists so a writer carrying the dead string knows to leave the row
   * alone, and once that string is suppressed no writer can put it back.
   *
   * The nesting is load-bearing. PL/pgSQL prepares a whole IF condition as one
   * SQL expression before it evaluates any of it, so putting
   * TG_TABLE_NAME = 'social_graph' AND NEW.twitter_renamed_from IS NOT NULL
   * on one line would resolve that column against wallet_cache, which does not
   * have it, and raise on the first cache write rather than short-circuiting.
   * An outer IF that names no column of NEW is what makes the inner statement
   * unreachable, and therefore unprepared, for the wrong row type.
   */
  IF TG_TABLE_NAME = 'social_graph' THEN
    IF NEW.twitter_renamed_from IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.suppressed_identifiers s
         WHERE s.kind = 'twitter'
           AND s.identifier = lower(NEW.twitter_renamed_from)
       )
    THEN
      NEW.twitter_renamed_from := NULL;
    END IF;
  END IF;

  /*
   * A row left with every social column NULL is kept, not dropped. In
   * social_graph that is a persisted negative ("checked, nothing found",
   * db/schema.ts:120), and it is the thing that stops the lookup path paying
   * to resolve this wallet again every time somebody asks. Dropping the row
   * to look tidy would buy repeated outbound calls about the exact person who
   * asked us to stop.
   */
  RETURN NEW;
END;
$fn$;
`;

/**
 * The guard that drops the row, for tables where there is nothing to blank.
 *
 * Configured per trigger through TG_ARGV as `kind=column` pairs, read out of
 * `to_jsonb(NEW)` so the function names no column at compile time and one
 * definition serves five differently shaped tables.
 *
 * An empty kind (`=old_value`) matches an identifier of any kind. That is for
 * `social_graph_history`, whose `old_value`/`new_value` hold a bare string
 * whose type is named by another column. Matching too widely there deletes one
 * audit row that mentioned a suppressed string, which is the cheap side of the
 * trade; matching too narrowly keeps the handle in the audit table forever,
 * which is the expensive one.
 */
const GUARD_SKIP = `
CREATE OR REPLACE FUNCTION suppression_guard_skip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  payload jsonb;
  spec    text;
  k       text;
  v       text;
  found   boolean;
BEGIN
  payload := to_jsonb(NEW);

  FOREACH spec IN ARRAY TG_ARGV LOOP
    k := split_part(spec, '=', 1);
    v := lower(payload ->> split_part(spec, '=', 2));
    CONTINUE WHEN v IS NULL;

    IF k = '' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.suppressed_identifiers s WHERE s.identifier = v
      ) INTO found;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.suppressed_identifiers s
        WHERE s.kind = k AND s.identifier = v
      ) INTO found;
    END IF;

    IF found THEN
      RETURN NULL;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$fn$;
`;

interface Attachment {
  table: string;
  fn: string;
  /** Literal argument list for CREATE TRIGGER, empty for the row guard. */
  args: string;
}

/**
 * Every table that stores an identifier naming a person, and how each is
 * guarded. A table absent from this list and from
 * SUPPRESSION_EXCLUDED_TABLES (or the account/payload carve-outs documented
 * there) is a table where the promise is still false, so the two lists
 * together are the scope statement.
 */
const ATTACHMENTS: Attachment[] = [
  // The index itself, and the cache in front of it.
  { table: 'social_graph', fn: 'suppression_guard_row', args: '' },
  { table: 'wallet_cache', fn: 'suppression_guard_row', args: '' },

  // Keyed on the handle, and it stores a display name and a follower count
  // beside it. There is nothing to blank; the row is the personal data.
  {
    table: 'x_accounts',
    fn: 'suppression_guard_skip',
    args: `'twitter=handle'`,
  },

  // handle_conflicts holds wallet + two handles in one row: the erased edge,
  // twice over. `platform` defaults to 'twitter' but is not constrained to it,
  // so both handle kinds are checked against both columns. Deletion alone is
  // insufficient here: paid routes republish `theirs` as twitter.also, so a
  // surviving conflict row is a surviving publication.
  {
    table: 'handle_conflicts',
    fn: 'suppression_guard_skip',
    args: `'wallet=wallet', 'twitter=ours', 'twitter=theirs', 'farcaster=ours', 'farcaster=theirs'`,
  },

  // The audit trail records the old and new value of a changed handle, which
  // is the handle. Suppressing the mapping and leaving its history is not
  // suppressing the mapping.
  {
    table: 'social_graph_history',
    fn: 'suppression_guard_skip',
    args: `'wallet=wallet', '=old_value', '=new_value'`,
  },

  // wallet -> contract edges from the seed cron. No handle, but the wallet is
  // an identifier and a suppressed one must not gain new rows here.
  {
    table: 'wallet_holdings',
    fn: 'suppression_guard_skip',
    args: `'wallet=wallet'`,
  },

  // The curated agent seed list holds a wallet next to two handles. It cannot
  // take the row guard: that function's lookup names columns (ens_name, lens,
  // github, twitter_url) this table does not have, and would raise on first
  // use. Dropping the whole row is right anyway: a curated entry about a
  // suppressed identifier is exactly the mapping the person asked us not to
  // keep, and the seed script simply stops re-adding it.
  {
    table: 'known_agents',
    fn: 'suppression_guard_skip',
    args: `'wallet=wallet', 'twitter=twitter_handle', 'farcaster=farcaster'`,
  },
];

const TRIGGER_NAME = 'suppression_guard';

interface Probe {
  name: string;
  pass: boolean;
  detail: string;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }

  // DDL never goes through the pooler: a bare SET on a pooled connection
  // outlives this script on a shared backend. See CLAUDE.md.
  const direct = url.replace('-pooler.', '.');
  if (direct !== url) {
    console.log(
      'DATABASE_URL is the pooler; using the direct endpoint for DDL'
    );
  }

  const pool = new Pool({ connectionString: direct });
  const client = await pool.connect();

  try {
    const who = await client.query('SELECT current_user');
    console.log(`connected as ${who.rows[0].current_user}\n`);

    // ---------------------------------------------------------------- table
    await client.query(`
      CREATE TABLE IF NOT EXISTS suppressed_identifiers (
        kind         text      NOT NULL,
        identifier   text      NOT NULL,
        reason       text      NOT NULL DEFAULT 'requested',
        lane         text      NOT NULL DEFAULT 'email',
        requested_at timestamp NOT NULL DEFAULT ${JITTERED_DEFAULT},
        created_at   timestamp NOT NULL DEFAULT ${JITTERED_DEFAULT},
        PRIMARY KEY (kind, identifier)
      )
    `);
    console.log('table suppressed_identifiers: ok');

    // Converge a table created by an earlier draft of this script: the lane
    // column, and the jittered defaults in place of a shared DEFAULT now()
    // (which would let co-batched rows be re-joined by timestamp equality).
    // All three are no-ops on a fresh table.
    await client.query(`
      ALTER TABLE suppressed_identifiers
        ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'email'
    `);
    await client.query(`
      ALTER TABLE suppressed_identifiers
        ALTER COLUMN requested_at SET DEFAULT ${JITTERED_DEFAULT}
    `);
    await client.query(`
      ALTER TABLE suppressed_identifiers
        ALTER COLUMN created_at SET DEFAULT ${JITTERED_DEFAULT}
    `);
    console.log('  lane column and jittered defaults: ok');

    /**
     * No secondary index, on purpose.
     *
     * Every lookup either guard makes supplies both `kind` and `identifier` as
     * equality predicates, or supplies `identifier` alone. The primary key is
     * a btree on `(kind, identifier)`, which serves the first exactly and the
     * second by scanning a table that will hold tens of rows and sit entirely
     * in shared buffers. An index added here would be read by nothing.
     */
    for (const c of CHECKS) {
      const { rowCount } = await client.query(
        `SELECT 1 FROM pg_constraint
         WHERE conname = $1 AND conrelid = 'suppressed_identifiers'::regclass`,
        [c.name]
      );
      if (rowCount) {
        console.log(`  ${c.name}: already present`);
        continue;
      }
      await client.query(
        `ALTER TABLE suppressed_identifiers
           ADD CONSTRAINT ${c.name} CHECK (${c.expression})`
      );
      console.log(`  ${c.name}: added`);
    }

    // ----------------------------------------------------------- quarantine
    /**
     * Operator-only, by construction and by the verification below. See the
     * header for why it is in neither READ_ONLY_TABLES nor BACKUP_TABLES.
     *
     * `kind` and `identifier` reference the suppression row that caused each
     * copy, without a foreign key: an un-suppress deletes the suppression row
     * and then restores from here, and an FK would force the opposite order.
     */
    await client.query(`
      CREATE TABLE IF NOT EXISTS suppression_quarantine (
        id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        kind           text        NOT NULL,
        identifier     text        NOT NULL,
        source_table   text        NOT NULL,
        row_data       jsonb       NOT NULL,
        quarantined_at timestamptz NOT NULL DEFAULT now(),
        purge_after    timestamptz NOT NULL DEFAULT (now() + interval '30 days')
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS suppression_quarantine_purge_idx
        ON suppression_quarantine (purge_after)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS suppression_quarantine_ref_idx
        ON suppression_quarantine (kind, identifier)
    `);
    console.log('table suppression_quarantine: ok');

    // Nothing grants to PUBLIC or the service roles on a new table in this
    // database (there is no default ACL here; grants are explicit, in
    // migrate-grant-readonly.ts and migrate-grant-harvest-writes.ts). The
    // REVOKEs make that a decision instead of an inheritance, and make a
    // re-run repair a grant added by hand in a psql window.
    await client.query(`REVOKE ALL ON suppression_quarantine FROM PUBLIC`);
    const { rows: roles } = await client.query(
      `SELECT rolname FROM pg_roles
       WHERE rolname IN ('sweep_runner', 'backup_reader')`
    );
    for (const r of roles) {
      await client.query(
        `REVOKE ALL ON suppression_quarantine FROM ${r.rolname}`
      );
    }
    console.log('  revoked PUBLIC and service-role access: ok');

    // ------------------------------------------------------------ functions
    await client.query(GUARD_ROW);
    console.log('\nfunction suppression_guard_row(): ok');
    await client.query(GUARD_SKIP);
    console.log('function suppression_guard_skip(): ok');

    // ------------------------------------------------------------- triggers
    /**
     * One transaction per table, not one for all seven.
     *
     * CREATE TRIGGER takes SHARE ROW EXCLUSIVE, which blocks writers, and
     * social_graph is written by a cron. lock_timeout means a clash aborts
     * instead of stalling the sweep. Per table, so a timeout on the seventh
     * leaves the first six in place and a re-run finishes the job.
     *
     * DROP + CREATE rather than CREATE OR REPLACE TRIGGER, which needs PG 14.
     * Inside a transaction the swap is atomic: no window without a guard.
     */
    console.log();
    for (const a of ATTACHMENTS) {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '3s'");
        await client.query(
          `DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON ${a.table}`
        );
        await client.query(
          `CREATE TRIGGER ${TRIGGER_NAME}
             BEFORE INSERT OR UPDATE ON ${a.table}
             FOR EACH ROW EXECUTE FUNCTION ${a.fn}(${a.args})`
        );
        await client.query('COMMIT');
        console.log(`trigger ${TRIGGER_NAME} on ${a.table}: ok`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }

    // -------------------------------------------------- catalog verification
    const { rows: triggers } = await client.query(
      `SELECT c.relname AS table_name, p.proname AS fn, t.tgenabled
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_proc  p ON p.oid = t.tgfoid
       WHERE t.tgname = $1 AND NOT t.tgisinternal
       ORDER BY c.relname`,
      [TRIGGER_NAME]
    );
    console.log(`\ntriggers present: ${triggers.length}/${ATTACHMENTS.length}`);
    for (const t of triggers) {
      console.log(`  ${t.table_name} -> ${t.fn}() [tgenabled=${t.tgenabled}]`);
    }
    // Set equality, not just a count: the same number on the wrong tables
    // would pass a count, and a guard on an excluded table is as much a
    // defect as a missing one.
    const wanted = ATTACHMENTS.map((a) => a.table).sort();
    const got = triggers.map((t) => t.table_name).sort();
    const disabled = triggers.filter((t) => t.tgenabled !== 'O');
    if (JSON.stringify(wanted) !== JSON.stringify(got) || disabled.length > 0) {
      console.error(
        '\nverification failed: the attached triggers do not match the' +
          ` attachment list, or one is disabled.\n  wanted: ${wanted.join(', ')}\n  got:    ${got.join(', ')}`
      );
      process.exit(1);
    }

    // The decision 2 boundary, asserted as a refusal: no guard on the
    // negative/dedupe tables, including the sweep's runtime-suffixed seen
    // tables. Redundant with set equality today; kept named so the boundary
    // has its own line of output and its own failure.
    const { rows: onExcluded } = await client.query(
      `SELECT c.relname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       WHERE t.tgname = $1 AND NOT t.tgisinternal
         AND (c.relname = ANY($2) OR c.relname LIKE 'farcaster_sweep_seen%')`,
      [TRIGGER_NAME, SUPPRESSION_EXCLUDED_TABLES]
    );
    if (onExcluded.length > 0) {
      console.error(
        `\nverification failed: the guard is attached to excluded ` +
          `negative/dedupe tables: ${onExcluded.map((r) => r.relname).join(', ')}`
      );
      process.exit(1);
    }
    console.log('excluded negative/dedupe tables carry no guard');

    /**
     * Every column named in a TG_ARGV spec exists on the table it is attached
     * to.
     *
     * `payload ->> 'colum_name'` returns NULL for a key that is not there, and
     * the guard treats NULL as "nothing to check". A typo in the ATTACHMENTS
     * list would therefore disable that check with no error, on a table whose
     * trigger the catalog reports as present and enabled. That is the same
     * silent-nothing failure the identifier CHECK exists to prevent, one level
     * up, so it is checked here rather than trusted.
     */
    const badSpecs: string[] = [];
    for (const a of ATTACHMENTS) {
      if (!a.args) continue;
      const columns = a.args
        .split(',')
        .map((s) => s.trim().replace(/^'|'$/g, '').split('=')[1]);
      const { rows: present } = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
           AND column_name = ANY($2)`,
        [a.table, columns]
      );
      const have = new Set(present.map((r) => r.column_name));
      for (const c of columns) {
        if (!have.has(c)) badSpecs.push(`${a.table}.${c}`);
      }
    }
    if (badSpecs.length > 0) {
      console.error(
        `\nverification failed: trigger arguments name columns that do not exist: ${badSpecs.join(', ')}`
      );
      process.exit(1);
    }
    console.log('trigger arguments: every named column exists');

    /**
     * The jitter is a column DEFAULT, so a table that predates this version of
     * the script, or a future ALTER that "tidies" the expression back to
     * now(), would silently restore the joinable timestamps. Read the live
     * default out of the catalog and require the volatile function.
     */
    const { rows: defaults } = await client.query(
      `SELECT a.attname AS col, pg_get_expr(d.adbin, d.adrelid) AS expr
       FROM pg_attrdef d
       JOIN pg_attribute a
         ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'suppressed_identifiers'::regclass
         AND a.attname IN ('requested_at', 'created_at')`
    );
    const unjittered = ['requested_at', 'created_at'].filter((col) => {
      const row = defaults.find((d) => d.col === col);
      return !row || !String(row.expr).includes('random()');
    });
    if (unjittered.length > 0) {
      console.error(
        `\nverification failed: timestamp defaults are not jittered ` +
          `(co-batched rows would be joinable): ${unjittered.join(', ')}`
      );
      process.exit(1);
    }
    console.log('timestamp defaults: jittered per row');

    /**
     * Operator-only means nobody but the owner. The two service roles and
     * PUBLIC are the only grantees that could plausibly appear, and each
     * would be a leak: sweep_runner reads run in CI, backup_reader's reads
     * end up in a 90-day artifact, and PUBLIC is everyone.
     */
    const { rows: qGrants } = await client.query(
      `SELECT grantee, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema = 'public'
         AND table_name = 'suppression_quarantine'
         AND grantee IN ('sweep_runner', 'backup_reader', 'PUBLIC')`
    );
    if (qGrants.length > 0) {
      console.error(
        `\nverification failed: suppression_quarantine is not operator-only: ` +
          qGrants.map((g) => `${g.grantee}:${g.privilege_type}`).join(', ')
      );
      process.exit(1);
    }
    console.log('suppression_quarantine: no service-role or PUBLIC access');

    // ------------------------------------------------ behavioural probes
    /**
     * Assert the refusal, not the success.
     *
     * A catalog check proves a trigger exists. It cannot tell an enforcing
     * trigger from one that matches nothing, and a suppression that matches
     * nothing is silent. So the guard is made to refuse a real write, here,
     * against this database, and every one of these transactions is rolled
     * back. Nothing below is committed.
     *
     * Addresses and handles are random, so they collide with no real row and
     * nothing needs deleting to make room.
     */
    const probes: Probe[] = [];
    const gone = '0x' + randomBytes(20).toString('hex');
    const keeps = '0x' + randomBytes(20).toString('hex');
    const cached = '0x' + randomBytes(20).toString('hex');
    const agent = '0x' + randomBytes(20).toString('hex');
    const handle = 'probe' + randomBytes(6).toString('hex');
    // Stored in mixed case, suppressed in lower case: the graph keeps a
    // handle's original casing (scripts/repair-handle-casing.ts exists because
    // of it), so the guard has to match case-insensitively or it matches
    // nothing that matters.
    const handleAsStored = handle.toUpperCase();

    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query(
        `INSERT INTO suppressed_identifiers (kind, identifier, reason)
         VALUES ('wallet', $1, 'operator'), ('twitter', $2, 'operator')`,
        [gone, handle]
      );

      const rowsOf = async (sqlText: string, args: unknown[]) => {
        const { rows } = await client.query(sqlText, args);
        return rows;
      };

      // 1. A suppressed wallet cannot be inserted at all.
      await client.query(
        `INSERT INTO social_graph (wallet, twitter_handle) VALUES ($1, $2)`,
        [gone, 'anything']
      );
      const r1 = await rowsOf(
        `SELECT count(*)::int AS n FROM social_graph WHERE wallet = $1`,
        [gone]
      );
      probes.push({
        name: 'a suppressed wallet is refused by INSERT',
        pass: r1[0].n === 0,
        detail: `rows landed: ${r1[0].n}`,
      });

      // 2. A suppressed handle is stripped, and the rest of the row survives.
      await client.query(
        `INSERT INTO social_graph
           (wallet, twitter_handle, twitter_url, farcaster, farcaster_url)
         VALUES ($1, $2, $3, 'probefc', 'https://warpcast.com/probefc')`,
        [keeps, handleAsStored, `https://x.com/${handleAsStored}`]
      );
      const r2 = await rowsOf(
        `SELECT twitter_handle, twitter_url, farcaster
         FROM social_graph WHERE wallet = $1`,
        [keeps]
      );
      probes.push({
        name: 'a suppressed handle is stripped, case-insensitively, and the row is kept',
        pass:
          r2.length === 1 &&
          r2[0].twitter_handle === null &&
          r2[0].twitter_url === null &&
          r2[0].farcaster === 'probefc',
        detail: JSON.stringify(r2[0] ?? null),
      });

      // 3. The UPDATE path, which is the one an upsert's conflict branch takes.
      await client.query(
        `UPDATE social_graph SET twitter_handle = $2, twitter_url = $3
         WHERE wallet = $1`,
        [keeps, handleAsStored, `https://x.com/${handleAsStored}`]
      );
      const r3 = await rowsOf(
        `SELECT twitter_handle FROM social_graph WHERE wallet = $1`,
        [keeps]
      );
      probes.push({
        name: 'an UPDATE cannot put a suppressed handle back',
        pass: r3.length === 1 && r3[0].twitter_handle === null,
        detail: JSON.stringify(r3[0] ?? null),
      });

      // 4. x_accounts is keyed on the handle, so the whole row goes.
      await client.query(
        `INSERT INTO x_accounts (handle, status) VALUES ($1, 'live')`,
        [handleAsStored]
      );
      const r4 = await rowsOf(
        `SELECT count(*)::int AS n FROM x_accounts WHERE lower(handle) = $1`,
        [handle]
      );
      probes.push({
        name: 'a suppressed handle is refused by x_accounts',
        pass: r4[0].n === 0,
        detail: `rows landed: ${r4[0].n}`,
      });

      // 5. wallet_cache, which lacks four of the columns the row guard names.
      //    This is the probe that turns the PL/pgSQL lazy-resolution note above
      //    into a tested fact rather than an assumption.
      await client.query(
        `INSERT INTO wallet_cache (wallet, twitter_handle, farcaster)
         VALUES ($1, $2, 'probefc')`,
        [cached, handleAsStored]
      );
      const r5 = await rowsOf(
        `SELECT twitter_handle, farcaster FROM wallet_cache WHERE wallet = $1`,
        [cached]
      );
      probes.push({
        name: 'the row guard runs on wallet_cache without touching a column it lacks',
        pass:
          r5.length === 1 &&
          r5[0].twitter_handle === null &&
          r5[0].farcaster === 'probefc',
        detail: JSON.stringify(r5[0] ?? null),
      });

      // 6. handle_conflicts stores the erased edge twice over.
      await client.query(
        `INSERT INTO handle_conflicts (wallet, ours, theirs, their_source)
         VALUES ($1, 'a', 'b', 'probe')`,
        [gone]
      );
      const r6 = await rowsOf(
        `SELECT count(*)::int AS n FROM handle_conflicts WHERE wallet = $1`,
        [gone]
      );
      probes.push({
        name: 'a suppressed wallet is refused by handle_conflicts',
        pass: r6[0].n === 0,
        detail: `rows landed: ${r6[0].n}`,
      });

      // 7. The audit trail, through the any-kind spec.
      await client.query(
        `INSERT INTO social_graph_history
           (wallet, field_changed, old_value, new_value)
         VALUES ($1, 'twitter_handle', $2, NULL)`,
        [keeps, handleAsStored]
      );
      const r7 = await rowsOf(
        `SELECT count(*)::int AS n FROM social_graph_history
         WHERE wallet = $1 AND lower(old_value) = $2`,
        [keeps, handle]
      );
      probes.push({
        name: 'a suppressed handle is refused by social_graph_history',
        pass: r7[0].n === 0,
        detail: `rows landed: ${r7[0].n}`,
      });

      // 8. wallet_holdings.
      await client.query(
        `INSERT INTO wallet_holdings (wallet, contract, chain)
         VALUES ($1, '0xprobe', 'base')`,
        [gone]
      );
      const r8 = await rowsOf(
        `SELECT count(*)::int AS n FROM wallet_holdings WHERE wallet = $1`,
        [gone]
      );
      probes.push({
        name: 'a suppressed wallet is refused by wallet_holdings',
        pass: r8[0].n === 0,
        detail: `rows landed: ${r8[0].n}`,
      });

      // 9. known_agents, by wallet and by handle. Both inserts must vanish:
      //    the first names a suppressed wallet, the second pairs a fresh
      //    wallet with the suppressed handle.
      await client.query(
        `INSERT INTO known_agents (wallet, name, twitter_handle)
         VALUES ($1, 'probe', 'anything')`,
        [gone]
      );
      await client.query(
        `INSERT INTO known_agents (wallet, name, twitter_handle)
         VALUES ($1, 'probe', $2)`,
        [agent, handleAsStored]
      );
      const r9 = await rowsOf(
        `SELECT count(*)::int AS n FROM known_agents WHERE wallet IN ($1, $2)`,
        [gone, agent]
      );
      probes.push({
        name: 'a suppressed wallet or handle is refused by known_agents',
        pass: r9[0].n === 0,
        detail: `rows landed: ${r9[0].n}`,
      });

      // 10. The normalisation constraint, tried the way an operator gets it
      //     wrong: a leading '@' and the wrong case.
      let refused = false;
      try {
        await client.query('SAVEPOINT badshape');
        await client.query(
          `INSERT INTO suppressed_identifiers (kind, identifier)
           VALUES ('twitter', '@MixedCase')`
        );
        await client.query('RELEASE SAVEPOINT badshape');
      } catch {
        refused = true;
        await client.query('ROLLBACK TO SAVEPOINT badshape');
      }
      probes.push({
        name: 'an unnormalised identifier is refused rather than silently stored',
        pass: refused,
        detail: refused ? 'rejected' : 'accepted, and would match nothing',
      });

      // 11. The lane vocabulary is closed. A value outside it is where an
      //     operator would one day write something about the requester.
      let laneRefused = false;
      try {
        await client.query('SAVEPOINT badlane');
        await client.query(
          `INSERT INTO suppressed_identifiers (kind, identifier, lane)
           VALUES ('twitter', $1, 'asked_nicely')`,
          ['lane' + randomBytes(6).toString('hex')]
        );
        await client.query('RELEASE SAVEPOINT badlane');
      } catch {
        laneRefused = true;
        await client.query('ROLLBACK TO SAVEPOINT badlane');
      }
      probes.push({
        name: 'a lane outside the closed vocabulary is refused',
        pass: laneRefused,
        detail: laneRefused ? 'rejected' : 'accepted free text',
      });

      // 12. The two rows above were inserted by ONE statement, which is
      //     exactly the co-batched shape a real two-identifier request
      //     produces. If their timestamps matched, the association the key
      //     refuses to store would be sitting in the timestamps.
      const r12 = await rowsOf(
        `SELECT count(DISTINCT requested_at)::int AS ra,
                count(DISTINCT created_at)::int  AS ca
         FROM suppressed_identifiers WHERE identifier IN ($1, $2)`,
        [gone, handle]
      );
      probes.push({
        name: 'co-batched rows land with unequal timestamps',
        pass: r12[0].ra === 2 && r12[0].ca === 2,
        detail: `distinct requested_at: ${r12[0].ra}, distinct created_at: ${r12[0].ca}`,
      });
    } finally {
      // Nothing above is kept. The probes exist to prove the guard refuses, not
      // to leave rows behind that prove it once did.
      await client.query('ROLLBACK');
    }

    console.log('\nbehaviour, all rolled back:');
    for (const p of probes) {
      console.log(`  ${p.pass ? 'ok  ' : 'FAIL'} ${p.name} (${p.detail})`);
    }
    const failed = probes.filter((p) => !p.pass);
    if (failed.length > 0) {
      console.error(
        `\n${failed.length} probe(s) failed. The suppression list is not enforced.`
      );
      process.exit(1);
    }

    const { rows: left } = await client.query(
      'SELECT count(*)::int AS n FROM suppressed_identifiers'
    );
    console.log(
      `\nOK. suppressed_identifiers holds ${left[0].n} row(s); ${ATTACHMENTS.length} triggers enforce it.`
    );
    console.log(
      'Next, with the owner URL: run scripts/migrate-grant-readonly.ts, which\n' +
        'now lists suppressed_identifiers in BOTH READ_ONLY_TABLES and\n' +
        'BACKUP_TABLES (and .github/workflows/db-backup.yml dumps it; the two\n' +
        'lists must agree or pg_dump fails). suppression_quarantine stays in\n' +
        'NEITHER list, on purpose.'
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
