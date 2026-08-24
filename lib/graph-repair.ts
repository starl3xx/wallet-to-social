/**
 * Repairs for `social_graph` that need no live source to decide.
 *
 * `wallet` is the primary key, so this table cannot hold a duplicate row. What
 * it can hold is a row that contradicts itself: an attestation flag with
 * nothing to attest, a handle stored in a casing that reverse lookup will not
 * match, a URL that disagrees with the handle beside it. Those are the repairs
 * here, and the whole set is defined by one rule: **the correct value is
 * already in the row.** Anything needing an API call to decide is reported by
 * `scripts/graph-audit.ts` and left alone.
 *
 * ## The guards, and why each exists
 *
 * 1. **Nothing here deletes.** There is no DELETE in this file and none should
 *    be added. A wrong UPDATE loses one column; a wrong DELETE loses a wallet's
 *    whole history, including `first_seen_at`, which cannot be recovered from
 *    any source.
 *
 * 2. **Every repair declares a ceiling, and refuses above it.** Each repair
 *    counts its rows first and skips itself if the count exceeds `maxRows`. The
 *    ceilings are set well above what the audit found and far below anything
 *    that could be called a sweep. This is the guard that matters: if a repair
 *    suddenly matches a million rows, the detection is broken, not the data,
 *    and the correct response is to stop and say so. A repair that quietly
 *    scaled with its own bug is how a cleanup job destroys a table.
 *
 * 3. **Dry run is the default.** `apply` must be passed explicitly. The cron
 *    passes it; a human running the script has to ask for it.
 *
 * 4. **The primary key is never touched.** Lowercasing a wallet would rewrite a
 *    key and could collide with an existing row. The audit reports malformed
 *    wallets; a person fixes them.
 *
 * 5. **Each repair is one statement.** No repair can half-apply, and none
 *    depends on another having run.
 *
 * 6. **Every run returns what it changed**, per repair, so the cron's own log
 *    is the audit trail.
 */

import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

export interface RepairSpec {
  id: string;
  /** What is wrong, in one line. */
  describes: string;
  /** Why the fix is safe without asking any external source. */
  because: string;
  /**
   * Refuse to run above this many rows. Set from what the audit found, with
   * room for growth: high enough that normal drift passes, low enough that a
   * broken predicate is caught before it writes.
   */
  maxRows: number;
  count: ReturnType<typeof sql>;
  update: ReturnType<typeof sql>;
}

export const REPAIRS: RepairSpec[] = [
  {
    id: 'twitter_verified_without_handle',
    describes: 'twitter_verified is true on a row with no twitter_handle',
    because:
      'The flag describes a handle that is not there. Attestation is the one thing this product sells, so a flag with nothing under it is worse than no flag.',
    maxRows: 50_000,
    count: sql`SELECT count(*)::int AS n FROM social_graph WHERE twitter_verified IS TRUE AND twitter_handle IS NULL`,
    update: sql`UPDATE social_graph SET twitter_verified = false WHERE twitter_verified IS TRUE AND twitter_handle IS NULL`,
  },
  {
    id: 'farcaster_verified_without_name',
    describes: 'farcaster_verified is true on a row with no farcaster username',
    because: 'Same as above, on the other platform.',
    maxRows: 50_000,
    count: sql`SELECT count(*)::int AS n FROM social_graph WHERE farcaster_verified IS TRUE AND farcaster IS NULL`,
    update: sql`UPDATE social_graph SET farcaster_verified = false WHERE farcaster_verified IS TRUE AND farcaster IS NULL`,
  },
  {
    id: 'lowercase_twitter_handle',
    describes: 'twitter_handle stored with capitals',
    because:
      'X handles are case-insensitive, and reverse lookup matches on the stored string. A capitalised copy is the same account hiding from its own query.',
    maxRows: 100_000,
    count: sql`SELECT count(*)::int AS n FROM social_graph WHERE twitter_handle <> lower(twitter_handle)`,
    update: sql`UPDATE social_graph SET twitter_handle = lower(twitter_handle) WHERE twitter_handle <> lower(twitter_handle)`,
  },
  {
    id: 'lowercase_farcaster',
    describes: 'farcaster username stored with capitals',
    because: 'Farcaster usernames are lowercase by protocol.',
    maxRows: 100_000,
    count: sql`SELECT count(*)::int AS n FROM social_graph WHERE farcaster <> lower(farcaster)`,
    update: sql`UPDATE social_graph SET farcaster = lower(farcaster) WHERE farcaster <> lower(farcaster)`,
  },
  {
    id: 'lowercase_ens_name',
    describes: 'ens_name stored with capitals',
    because:
      'ENS normalises to lowercase, so a capitalised name never matches.',
    maxRows: 100_000,
    count: sql`SELECT count(*)::int AS n FROM social_graph WHERE ens_name <> lower(ens_name)`,
    update: sql`UPDATE social_graph SET ens_name = lower(ens_name) WHERE ens_name <> lower(ens_name)`,
  },
  {
    id: 'empty_string_to_null',
    describes: 'an empty string where NULL means "we do not have one"',
    because:
      'Every count we publish tests IS NOT NULL, so an empty string is counted as an identity and inflates the match rate on our own marketing.',
    maxRows: 100_000,
    count: sql`
      SELECT count(*)::int AS n FROM social_graph
      WHERE twitter_handle = '' OR farcaster = '' OR ens_name = ''
         OR lens = '' OR github = '' OR twitter_url = '' OR farcaster_url = ''`,
    update: sql`
      UPDATE social_graph SET
        twitter_handle = nullif(twitter_handle, ''),
        farcaster      = nullif(farcaster, ''),
        ens_name       = nullif(ens_name, ''),
        lens           = nullif(lens, ''),
        github         = nullif(github, ''),
        twitter_url    = nullif(twitter_url, ''),
        farcaster_url  = nullif(farcaster_url, '')
      WHERE twitter_handle = '' OR farcaster = '' OR ens_name = ''
         OR lens = '' OR github = '' OR twitter_url = '' OR farcaster_url = ''`,
  },
  {
    id: 'twitter_url_wrong_handle',
    describes: 'twitter_url pointing at something other than its own handle',
    because:
      'The handle is the canonical column: every writer sets it, and the URL is derived from it. The export links the URL, so a mismatch sends a customer somewhere that is not the account. One row holds a display name complete with spaces and emoji in place of a URL.',
    maxRows: 50_000,
    /**
     * `right(...)` rather than `ILIKE '%/' || handle`.
     *
     * In LIKE and ILIKE, `_` matches any single character, and `_` is a legal
     * character in an X handle. Concatenating a raw handle into a pattern turns
     * every underscore into a wildcard, so a URL that goes wrong at exactly
     * that position still matched and was never rewritten. The repair then
     * reported itself clean while continuing to send people to the wrong
     * account, which is the failure mode this whole file exists to avoid.
     *
     * Comparing the last `length(handle) + 1` characters is an exact string
     * test with no pattern language in it, so no character in a handle can mean
     * anything other than itself. It also leaves `twitter.com/<handle>` alone,
     * which is correct: that is the next repair's job, not this one's.
     */
    count: sql`
      SELECT count(*)::int AS n FROM social_graph
      WHERE twitter_handle IS NOT NULL
        AND (twitter_url IS NULL
             OR lower(right(twitter_url, length(twitter_handle) + 1))
                <> lower('/' || twitter_handle))`,
    update: sql`
      UPDATE social_graph SET twitter_url = 'https://x.com/' || twitter_handle
      WHERE twitter_handle IS NOT NULL
        AND (twitter_url IS NULL
             OR lower(right(twitter_url, length(twitter_handle) + 1))
                <> lower('/' || twitter_handle))`,
  },
  {
    id: 'twitter_url_legacy_domain',
    describes:
      'twitter_url on twitter.com rather than x.com, with the right handle',
    because:
      'Normalisation, not a fault: twitter.com still redirects, so neither link is broken. They are here because the ENS harvest wrote one domain and the Farcaster sweep wrote the other, and one column holding two spellings of the same link is a difference that will eventually be read as meaningful. The handle is untouched.',
    maxRows: 200_000,
    count: sql`
      SELECT count(*)::int AS n FROM social_graph
      WHERE twitter_handle IS NOT NULL
        AND twitter_url = 'https://twitter.com/' || twitter_handle`,
    update: sql`
      UPDATE social_graph SET twitter_url = 'https://x.com/' || twitter_handle
      WHERE twitter_handle IS NOT NULL
        AND twitter_url = 'https://twitter.com/' || twitter_handle`,
  },
  {
    id: 'first_seen_after_last_updated',
    describes: 'first_seen_at later than last_updated_at',
    because:
      'A row cannot be updated before it exists. `first_seen_at` is the one column no source can rebuild, so the repair moves it back to the earlier of the two rather than moving `last_updated_at` forward.',
    maxRows: 500_000,
    count: sql`SELECT count(*)::int AS n FROM social_graph WHERE last_updated_at < first_seen_at`,
    update: sql`UPDATE social_graph SET first_seen_at = last_updated_at WHERE last_updated_at < first_seen_at`,
  },
];

export interface RepairResult {
  id: string;
  found: number;
  changed: number;
  /** Set when the repair declined to run. */
  refused?: string;
  /** Set when the repair ran and the rows it targeted did not all go away. */
  incomplete?: string;
}

export interface RepairRun {
  applied: boolean;
  results: RepairResult[];
  totalFound: number;
  totalChanged: number;
  refusals: number;
}

/**
 * Run every repair. Counts first, then writes only what is under its ceiling.
 *
 * `apply` defaults to false, so calling this with no argument reports what
 * would change and touches nothing.
 */
export async function runGraphRepairs(apply = false): Promise<RepairRun> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  /**
   * Read a scalar count.
   *
   * `db.execute` resolves to `{ rows }`, not to the rows. Treating the result
   * as an array yields `undefined` at index 0, and `Number(undefined ?? 0)` is
   * 0, so the first version of this file reported every repair clean against a
   * table that had 22,000 rows to fix. A silent zero is the worst answer a
   * check can give, so a missing row throws instead of defaulting.
   */
  const scalar = async (
    q: ReturnType<typeof sql>,
    label: string
  ): Promise<number> => {
    const res = (await db.execute(q)) as unknown as {
      rows?: Array<{ n: number }>;
    };
    const value = res?.rows?.[0]?.n;
    if (value == null) {
      throw new Error(
        `Count for ${label} returned no row. Refusing to treat that as zero.`
      );
    }
    return Number(value);
  };

  const results: RepairResult[] = [];

  for (const repair of REPAIRS) {
    const found = await scalar(repair.count, repair.id);

    if (found === 0) {
      results.push({ id: repair.id, found: 0, changed: 0 });
      continue;
    }

    if (found > repair.maxRows) {
      // The ceiling is the point of this whole file. A repair matching far more
      // than it ever has is a broken predicate, and the right move is to leave
      // the data alone and make someone look.
      results.push({
        id: repair.id,
        found,
        changed: 0,
        refused: `${found} rows exceeds the ceiling of ${repair.maxRows}. Nothing written. The detection is more likely wrong than the data.`,
      });
      continue;
    }

    if (!apply) {
      results.push({ id: repair.id, found, changed: 0 });
      continue;
    }

    await db.execute(repair.update);

    // Count again rather than trusting a driver's rowCount. This is exact, and
    // it verifies the repair as well as measuring it: if rows still match the
    // predicate afterwards, the UPDATE does not fix what the count selects, and
    // that mismatch is worth surfacing rather than reporting a clean run.
    const remaining = await scalar(repair.count, `${repair.id} (after)`);
    results.push({
      id: repair.id,
      found,
      changed: found - remaining,
      ...(remaining > 0
        ? {
            incomplete: `${remaining} rows still match after the update. The repair does not fix everything its count selects.`,
          }
        : {}),
    });
  }

  return {
    applied: apply,
    results,
    totalFound: results.reduce((s, r) => s + r.found, 0),
    totalChanged: results.reduce((s, r) => s + r.changed, 0),
    refusals: results.filter((r) => r.refused).length,
  };
}

/**
 * Problems a repair must not touch, counted so the cron can report them.
 *
 * Each of these needs an answer from outside the row: which wallet an ENS name
 * currently resolves to, what a renamed Farcaster account is called now, what
 * id sits behind a username. Guessing would mean writing a plausible value over
 * a real one, which is exactly the failure this whole file is built to avoid.
 */
export async function findUnrepairable(): Promise<
  Array<{ id: string; count: number; needs: string }>
> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  // Same unwrap as above: `{ rows }`, and a missing row is an error, not a zero.
  const one = async (q: ReturnType<typeof sql>) => {
    const res = (await db.execute(q)) as unknown as {
      rows?: Array<{ n: number }>;
    };
    const value = res?.rows?.[0]?.n;
    if (value == null) throw new Error('Count returned no row.');
    return Number(value);
  };

  return [
    {
      id: 'ens_name_on_several_wallets',
      count: await one(sql`
        SELECT count(*)::int AS n FROM (
          SELECT lower(ens_name) FROM social_graph
          WHERE ens_name IS NOT NULL GROUP BY 1 HAVING count(*) > 1
        ) d`),
      needs:
        'an onchain resolution, to learn which wallet the name points at now',
    },
    {
      id: 'fc_fid_with_several_usernames',
      count: await one(sql`
        SELECT count(*)::int AS n FROM (
          SELECT fc_fid FROM social_graph
          WHERE fc_fid IS NOT NULL AND farcaster IS NOT NULL
          GROUP BY 1 HAVING count(DISTINCT lower(farcaster)) > 1
        ) d`),
      needs: 'a live lookup, to learn the account’s current username',
    },
    {
      id: 'farcaster_name_without_fid',
      count: await one(sql`
        SELECT count(*)::int AS n FROM social_graph
        WHERE farcaster IS NOT NULL AND fc_fid IS NULL`),
      needs:
        'a live lookup, to learn the id. Without it the wallet cannot be DMed.',
    },
  ];
}
