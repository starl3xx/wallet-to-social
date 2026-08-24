/**
 * Read-only health report for `social_graph`.
 *
 * Usage: npx tsx --env-file=.env.local scripts/graph-audit.ts
 *
 * SELECT statements only. Nothing here writes, and nothing here should ever be
 * given a write: this script exists so a person can decide what is worth
 * repairing before a repair runs. `scripts/graph-repair.ts` is the one that
 * writes, and it takes its list of safe repairs from what this found.
 *
 * `wallet` is the primary key, so duplicate *rows* cannot exist. What can exist
 * is duplicate *identity*: the same handle stored under two casings, one ENS
 * name on two wallets (a name resolves to one address, so that is a conflict),
 * a handle stored as a URL, an empty string where a NULL belongs. Those are
 * what this looks for.
 */

import { neon } from '@neondatabase/serverless';

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

const n = (v: unknown) => Number(v ?? 0).toLocaleString();

function section(title: string) {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);
}

/** One finding: a count, a label, and whether a repair could act on it. */
function finding(label: string, count: number, note: string) {
  const mark = count === 0 ? '  ok ' : ' >>> ';
  console.log(`${mark}${n(count).padStart(9)}  ${label}`);
  if (count > 0 && note) console.log(`${' '.repeat(16)}${note}`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const sql: Sql = neon(databaseUrl);

  // ── Size and shape ──────────────────────────────────────────────────────
  section('SIZE');
  const [size] = (await sql`
    SELECT
      count(*)                                                          AS rows,
      count(*) FILTER (WHERE twitter_handle IS NOT NULL)                AS has_twitter,
      count(*) FILTER (WHERE farcaster IS NOT NULL)                     AS has_farcaster,
      count(*) FILTER (WHERE ens_name IS NOT NULL)                      AS has_ens,
      count(*) FILTER (WHERE lens IS NOT NULL)                          AS has_lens,
      count(*) FILTER (WHERE github IS NOT NULL)                        AS has_github,
      count(*) FILTER (WHERE twitter_handle IS NOT NULL
                          OR farcaster IS NOT NULL)                     AS reachable,
      count(*) FILTER (WHERE twitter_handle IS NULL
                        AND farcaster IS NULL
                        AND ens_name IS NULL
                        AND lens IS NULL
                        AND github IS NULL)                             AS empty_rows
    FROM social_graph
  `) as Row[];
  const total = Number(size.rows);
  console.log(`  rows            ${n(size.rows)}`);
  console.log(`  has twitter     ${n(size.has_twitter)}`);
  console.log(`  has farcaster   ${n(size.has_farcaster)}`);
  console.log(`  has ens         ${n(size.has_ens)}`);
  console.log(`  has lens        ${n(size.has_lens)}`);
  console.log(`  has github      ${n(size.has_github)}`);
  console.log(
    `  reachable       ${n(size.reachable)}  (${((Number(size.reachable) / total) * 100).toFixed(1)}%)`
  );
  console.log(`  no identity     ${n(size.empty_rows)}  (negatives + empties)`);

  // ── Negatives ───────────────────────────────────────────────────────────
  // A negative is a row with no identity and a last_checked_at: "we ran the
  // full pipeline and found nothing". A row with no identity and NO
  // last_checked_at is not a negative, it is a row that means nothing at all.
  section('NEGATIVES  (rows that say "checked, nothing found")');
  const [neg] = (await sql`
    SELECT
      count(*) FILTER (WHERE last_checked_at IS NOT NULL)  AS real_negatives,
      count(*) FILTER (WHERE last_checked_at IS NULL)      AS meaningless
    FROM social_graph
    WHERE twitter_handle IS NULL AND farcaster IS NULL
      AND ens_name IS NULL AND lens IS NULL AND github IS NULL
  `) as Row[];
  console.log(`  real negatives  ${n(neg.real_negatives)}`);
  finding(
    'rows with no identity and no last_checked_at',
    Number(neg.meaningless),
    'Neither an answer nor a record of asking. A repair can delete these.'
  );

  // ── Format hygiene ──────────────────────────────────────────────────────
  section('FORMAT  (values stored in a shape the code does not expect)');
  const [fmt] = (await sql`
    SELECT
      count(*) FILTER (WHERE wallet <> lower(wallet))                       AS wallet_not_lower,
      count(*) FILTER (WHERE wallet !~ '^0x[0-9a-f]{40}$')                  AS wallet_malformed,
      count(*) FILTER (WHERE twitter_handle LIKE '@%')                      AS tw_at_prefix,
      -- Not ILIKE '%http%'. There are real X handles that begin "http", and
      -- that pattern reported 238 of them as URLs. A handle cannot hold a
      -- slash or a dot, so those are what a URL in this column looks like.
      count(*) FILTER (WHERE twitter_handle ~ '[/.]'
                          OR twitter_handle ~* '^https?:')                  AS tw_is_url,
      count(*) FILTER (WHERE twitter_handle !~ '^[A-Za-z0-9_]{1,15}$')      AS tw_not_a_handle,
      count(*) FILTER (WHERE twitter_handle ~ '\\s')                        AS tw_whitespace,
      count(*) FILTER (WHERE twitter_handle <> lower(twitter_handle))       AS tw_mixed_case,
      count(*) FILTER (WHERE farcaster LIKE '@%')                           AS fc_at_prefix,
      count(*) FILTER (WHERE farcaster <> lower(farcaster))                 AS fc_mixed_case,
      count(*) FILTER (WHERE ens_name NOT LIKE '%.%')                       AS ens_no_dot,
      count(*) FILTER (WHERE ens_name <> lower(ens_name))                   AS ens_mixed_case,
      count(*) FILTER (WHERE twitter_handle = '' OR farcaster = ''
                          OR ens_name = '' OR lens = '' OR github = '')     AS empty_strings
    FROM social_graph
  `) as Row[];
  finding(
    'wallets not lowercase',
    Number(fmt.wallet_not_lower),
    'Every lookup lowercases before it queries, so these can never be hit.'
  );
  finding(
    'wallets not a 0x + 40 hex address',
    Number(fmt.wallet_malformed),
    'Cannot be matched by any lookup. Inspect before deleting.'
  );
  finding(
    'twitter handles with a leading @',
    Number(fmt.tw_at_prefix),
    'Breaks reverse lookup and the exported x.com URL.'
  );
  finding(
    'twitter handles holding a URL',
    Number(fmt.tw_is_url),
    'A handle column with a URL in it. Needs inspection, not a blind strip.'
  );
  finding(
    'twitter handles outside X’s charset (a-z 0-9 _, max 15)',
    Number(fmt.tw_not_a_handle),
    'Cannot be a real account. The exported x.com link 404s.'
  );
  finding(
    'twitter handles containing whitespace',
    Number(fmt.tw_whitespace),
    'Not a handle. Inspect.'
  );
  finding(
    'twitter handles not lowercase',
    Number(fmt.tw_mixed_case),
    'X handles are case-insensitive, so these split one account across rows.'
  );
  finding(
    'farcaster names with a leading @',
    Number(fmt.fc_at_prefix),
    'Same as above.'
  );
  finding(
    'farcaster names not lowercase',
    Number(fmt.fc_mixed_case),
    'Farcaster usernames are lowercase.'
  );
  finding(
    'ens names with no dot',
    Number(fmt.ens_no_dot),
    'Not a resolvable name.'
  );
  finding(
    'ens names not lowercase',
    Number(fmt.ens_mixed_case),
    'ENS normalises to lowercase.'
  );
  finding(
    'empty strings where NULL belongs',
    Number(fmt.empty_strings),
    'Reads as "has an identity" in every count we publish.'
  );

  // ── Duplicate identity ──────────────────────────────────────────────────
  section('DUPLICATE IDENTITY');

  const [tw] = (await sql`
    SELECT
      count(*)                                    AS handles_on_many_wallets,
      coalesce(sum(wallets), 0)                   AS wallets_involved,
      coalesce(max(wallets), 0)                   AS worst
    FROM (
      SELECT lower(twitter_handle) AS h, count(*) AS wallets
      FROM social_graph WHERE twitter_handle IS NOT NULL
      GROUP BY 1 HAVING count(*) > 1
    ) d
  `) as Row[];
  console.log(
    `  twitter handles on more than one wallet: ${n(tw.handles_on_many_wallets)}`
  );
  console.log(
    `    wallets involved ${n(tw.wallets_involved)}, largest cluster ${n(tw.worst)}`
  );
  console.log(`    Expected, and not a fault: one person owns many wallets.`);

  const [twCase] = (await sql`
    SELECT count(*) AS n FROM (
      SELECT lower(twitter_handle)
      FROM social_graph WHERE twitter_handle IS NOT NULL
      GROUP BY 1 HAVING count(DISTINCT twitter_handle) > 1
    ) d
  `) as Row[];
  finding(
    'twitter handles stored under more than one casing',
    Number(twCase.n),
    'The same account written two ways. Reverse lookup finds one of them.'
  );

  const [ens] = (await sql`
    SELECT count(*) AS names, coalesce(sum(wallets), 0) AS wallets FROM (
      SELECT lower(ens_name) AS nm, count(*) AS wallets
      FROM social_graph WHERE ens_name IS NOT NULL
      GROUP BY 1 HAVING count(*) > 1
    ) d
  `) as Row[];
  finding(
    'ens names on more than one wallet',
    Number(ens.names),
    `A name resolves to exactly one address, so at most one row is right. ${n(ens.wallets)} wallets involved.`
  );

  const [fid] = (await sql`
    SELECT count(*) AS fids, coalesce(max(wallets), 0) AS worst FROM (
      SELECT fc_fid, count(*) AS wallets
      FROM social_graph WHERE fc_fid IS NOT NULL
      GROUP BY 1 HAVING count(*) > 1
    ) d
  `) as Row[];
  console.log(
    `  farcaster ids on more than one wallet: ${n(fid.fids)} (largest ${n(fid.worst)})`
  );
  console.log(`    Expected: an account verifies several addresses.`);

  const [fidName] = (await sql`
    SELECT count(*) AS n FROM (
      SELECT fc_fid FROM social_graph
      WHERE fc_fid IS NOT NULL AND farcaster IS NOT NULL
      GROUP BY 1 HAVING count(DISTINCT lower(farcaster)) > 1
    ) d
  `) as Row[];
  finding(
    'farcaster ids carrying more than one username',
    Number(fidName.n),
    'One id is one account. Two usernames means one row holds a renamed account.'
  );

  // ── Contradictions ──────────────────────────────────────────────────────
  section('CONTRADICTIONS  (a row disagreeing with itself)');
  const [con] = (await sql`
    SELECT
      count(*) FILTER (WHERE twitter_verified   AND twitter_handle IS NULL)   AS tw_verified_no_handle,
      count(*) FILTER (WHERE farcaster_verified AND farcaster IS NULL)        AS fc_verified_no_name,
      count(*) FILTER (WHERE fc_fid IS NOT NULL AND farcaster IS NULL)        AS fid_no_name,
      count(*) FILTER (WHERE farcaster IS NOT NULL AND fc_fid IS NULL)        AS name_no_fid,
      count(*) FILTER (WHERE twitter_url IS NOT NULL AND twitter_handle IS NULL) AS url_no_handle,
      -- Not ILIKE: '_' is a wildcard in a LIKE pattern and a legal character in
      -- an X handle, so a handle with an underscore matched URLs it should not
      -- and this check under-counted. Comparing the tail exactly has no pattern
      -- language in it.
      count(*) FILTER (WHERE twitter_handle IS NOT NULL AND twitter_url IS NOT NULL
                         AND lower(right(twitter_url, length(twitter_handle) + 1))
                             <> lower('/' || twitter_handle))                 AS url_handle_mismatch,
      count(*) FILTER (WHERE data_quality_score < 0 OR data_quality_score > 100) AS score_out_of_range,
      count(*) FILTER (WHERE fc_followers < 0)                                AS negative_followers,
      count(*) FILTER (WHERE last_updated_at < first_seen_at)                 AS updated_before_seen,
      count(*) FILTER (WHERE is_agent AND agent_name IS NULL)                 AS agent_no_name
    FROM social_graph
  `) as Row[];
  finding(
    'twitter_verified with no handle',
    Number(con.tw_verified_no_handle),
    'Claims attestation for an identity that is not there.'
  );
  finding(
    'farcaster_verified with no username',
    Number(con.fc_verified_no_name),
    'Same.'
  );
  finding(
    'fc_fid with no username',
    Number(con.fid_no_name),
    'Half a Farcaster identity.'
  );
  finding(
    'farcaster username with no fc_fid',
    Number(con.name_no_fid),
    'Cannot be DMed. Blocks the Unlimited DM feature.'
  );
  finding(
    'twitter_url with no handle',
    Number(con.url_no_handle),
    'The URL holds the handle we say we do not have.'
  );
  finding(
    'twitter_url not matching its handle',
    Number(con.url_handle_mismatch),
    'One of the two is wrong; the export uses the URL.'
  );
  finding(
    'data_quality_score outside 0..100',
    Number(con.score_out_of_range),
    ''
  );
  finding('negative follower counts', Number(con.negative_followers), '');
  finding(
    'last_updated_at before first_seen_at',
    Number(con.updated_before_seen),
    'A row updated before it existed. Cosmetic, but it means one of the two is wrong.'
  );
  // `is_agent` with no name is deliberately not a finding either. The bio
  // detector in job-processor sets `is_agent: true, agent_verified: false` and
  // never learns a name, so a nameless agent is an unverified one, not a broken
  // row. Repairing it would delete the only signal that detector produces.
  console.log(
    `  note  ${n(con.agent_no_name).padStart(9)}  is_agent with no name (bio-detected, unverified: expected)`
  );
  // `lookup_count = 0` is deliberately not a finding. The schema defaults it to
  // 1, and the sweep writes 0, but 0 is the honest value: it means no customer
  // has ever asked for this wallet. Reading the default as a floor would have
  // reported 4.7M faults and repaired away a real signal.

  // ── What the graph would actually serve ─────────────────────────────────
  section('WHAT A LOOKUP GETS  (classifyQuality, applied in SQL)');
  const [cls] = (await sql`
    SELECT
      count(*) FILTER (WHERE data_quality_score >= 70)                     AS high,
      count(*) FILTER (WHERE data_quality_score < 70
                         AND (twitter_verified OR farcaster_verified
                              OR lookup_count > 3))                        AS medium,
      count(*) FILTER (WHERE data_quality_score < 70
                         AND NOT (twitter_verified OR farcaster_verified
                                  OR lookup_count > 3)
                         AND (stale_at IS NULL OR stale_at >= now()))      AS low,
      count(*) FILTER (WHERE data_quality_score < 70
                         AND NOT (twitter_verified OR farcaster_verified
                                  OR lookup_count > 3)
                         AND stale_at < now())                             AS stale
    FROM social_graph
    WHERE twitter_handle IS NOT NULL OR farcaster IS NOT NULL
       OR ens_name IS NOT NULL OR lens IS NOT NULL OR github IS NOT NULL
  `) as Row[];
  console.log(
    `  high    ${n(cls.high).padStart(11)}   served at once, in both modes`
  );
  console.log(
    `  medium  ${n(cls.medium).padStart(11)}   served, and still refreshed by a deep scan`
  );
  console.log(
    `  low     ${n(cls.low).padStart(11)}   a deep scan re-resolves; a fast scan serves it`
  );
  console.log(`  stale   ${n(cls.stale).padStart(11)}   same`);
  console.log(
    `\n  The low and stale rows are the ones a fast scan now hands back.`
  );

  // ── Freshness ───────────────────────────────────────────────────────────
  section('FRESHNESS');
  const [fresh] = (await sql`
    SELECT
      count(*) FILTER (WHERE stale_at IS NULL)                    AS no_stale_at,
      count(*) FILTER (WHERE stale_at < now())                    AS past_due,
      count(*) FILTER (WHERE stale_at >= now())                   AS fresh,
      count(*) FILTER (WHERE last_checked_at IS NULL)             AS never_checked,
      count(*) FILTER (WHERE last_updated_at < now() - interval '180 days') AS untouched_180d,
      min(first_seen_at)                                          AS oldest,
      max(last_updated_at)                                        AS newest
    FROM social_graph
  `) as Row[];
  console.log(`  fresh (stale_at in future)   ${n(fresh.fresh)}`);
  console.log(`  past due                     ${n(fresh.past_due)}`);
  console.log(`  no stale_at at all           ${n(fresh.no_stale_at)}`);
  console.log(`  never externally checked     ${n(fresh.never_checked)}`);
  console.log(`  untouched for 180 days       ${n(fresh.untouched_180d)}`);
  console.log(`  oldest row  ${String(fresh.oldest)}`);
  console.log(`  newest write ${String(fresh.newest)}`);

  // ── Provenance ──────────────────────────────────────────────────────────
  section('SOURCES  (what wrote these rows)');
  const srcRows = (await sql`
    SELECT s AS source, count(*) AS n
    FROM social_graph, unnest(coalesce(sources, ARRAY['(null)'])) AS s
    GROUP BY 1 ORDER BY 2 DESC LIMIT 15
  `) as Row[];
  for (const r of srcRows)
    console.log(`  ${String(r.source).padEnd(24)} ${n(r.n)}`);

  // ── Samples, so a person can judge rather than trust a count ────────────
  section('SAMPLES  (up to 5 of each problem, for judgement)');

  const samples: Array<[string, string]> = [
    [
      'twitter handle with @ or a URL',
      `SELECT wallet, twitter_handle FROM social_graph WHERE twitter_handle LIKE '@%' OR twitter_handle ILIKE '%http%' LIMIT 5`,
    ],
    [
      'ens name on several wallets',
      `SELECT lower(ens_name) AS ens, count(*) AS wallets FROM social_graph WHERE ens_name IS NOT NULL GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC LIMIT 5`,
    ],
    [
      'handle stored under two casings',
      `SELECT lower(twitter_handle) AS handle, array_agg(DISTINCT twitter_handle) AS variants FROM social_graph WHERE twitter_handle IS NOT NULL GROUP BY 1 HAVING count(DISTINCT twitter_handle) > 1 LIMIT 5`,
    ],
    [
      'verified with nothing to verify',
      `SELECT wallet, twitter_verified, farcaster_verified FROM social_graph WHERE (twitter_verified AND twitter_handle IS NULL) OR (farcaster_verified AND farcaster IS NULL) LIMIT 5`,
    ],
  ];
  for (const [label, q] of samples) {
    // neon's default export is a tagged template. A query built as a plain
    // string has to go through `.query`, or it throws rather than running.
    const rows = (await sql.query(q)) as Row[];
    console.log(`\n  ${label}: ${rows.length === 0 ? 'none' : ''}`);
    for (const r of rows) console.log(`    ${JSON.stringify(r)}`);
  }

  console.log('\nRead-only. Nothing was written.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
