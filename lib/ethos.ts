/**
 * Ethos Network: a small, complete, enumerable set of attested wallet-to-X links.
 *
 * People sign up with an X account, connect wallets by signature, and collect
 * reviews. Everything is public, unmetered and needs no key. Measured on
 * 2026-08-16: 39,442 profiles, 36,218 of them with an X account, covering
 * 83,891 distinct addresses at 2.32 addresses per person.
 *
 * ## Why this enumerates instead of asking per wallet
 *
 * There is a batch endpoint that takes 500 addresses, and using it would be the
 * obvious design and the wrong one. Ethos covers about 0.3% of the wallets in a
 * typical customer upload, so a per-lookup call would spend a round trip on
 * every lookup to change roughly none of them. The whole dataset pages through
 * `/profiles/recent` in about 80 requests, so we take all of it once a day and
 * every lookup gets it for free out of the graph.
 *
 * ## Four behaviours that are not documented, and were found by calling it
 *
 * 1. **The batch response is deduplicated by person, not aligned to the input.**
 *    Two addresses belonging to one person come back as one record. Zipping a
 *    response against the request array silently misaligns everything after the
 *    first duplicate. The address index here is always rebuilt from `userkeys`.
 * 2. **An address Ethos has never seen still returns a record.** It comes back
 *    as a synthetic `INACTIVE` user with a null username, a blockie avatar and a
 *    default score near 1225. "I got a record" is a 100% false positive rate,
 *    so `isRealUser` requires ACTIVE and a username.
 * 3. **One bad checksum fails the entire batch.** A mixed-case address that
 *    fails EIP-55 returns 400 for all 500, not just the offender. Everything
 *    here is lowercased, which the API accepts and our storage already uses.
 * 4. **There is no documented rate limit.** About 90 requests ran clean during
 *    the audit, but an undocumented limit is one we would find in production, so
 *    this paces itself and treats 429 as expected rather than exceptional.
 *
 * ## What it is really for
 *
 * The handles are worth having: 72,867 of the addresses are ones we either do
 * not hold or hold with no X handle, which is +6.8% on our X coverage. But the
 * more valuable field is `service:x.com:<id>`. Ethos stores the numeric account
 * id and re-reads the handle from it, so its handle cannot go stale the way a
 * bare string does. In 200 checked disagreements, our handle was dead and theirs
 * live 108 times, and theirs was dead and ours live zero times.
 */
import { getDb, socialGraph } from '@/db';
import { sql } from 'drizzle-orm';
import { cleanTwitterHandle } from './twitter-cleaner';

const BASE = 'https://api.ethos.network/api/v2';

/**
 * Required by the API, which says requests without it "may be subject to rate
 * limiting". Naming ourselves honestly is also the courteous thing to do when
 * somebody is giving the data away.
 */
const CLIENT_HEADER = 'walletlink.social';

/** Their maximum, and what /profiles/recent accepts. */
const PAGE = 500;

/** Politeness between pages. The limit is unpublished, so do not go looking. */
const PAGE_DELAY_MS = 250;

/** Rows per upsert. Matches the batch size the other sweeps settled on. */
const UPSERT_BATCH = 500;

/**
 * Below the 70 trust line, like every other background source.
 *
 * Attested at both ends: the person proved wallet control with a signature and
 * X control with a sign-in. That is stronger than an identity index correlating
 * two facts.
 *
 * **45 because that is what the live path computes**, not because 45 feels
 * right. `calculateQualityScore` in lib/social-graph.ts is additive, and a
 * wallet with a handle from this source scores twitter(20) + ethos(25) = 45
 * there. Writing a different floor here would mean the same wallet had one
 * score after a sweep and another after a lookup, with GREATEST quietly keeping
 * whichever was larger. Two numbers for one fact is how a trust line stops
 * meaning anything.
 */
const DATA_QUALITY = 45;

export interface EthosUser {
  id: number;
  profileId: number | null;
  username: string | null;
  displayName: string;
  score: number;
  status: string;
  userkeys: string[];
}

/** One attested address-to-account link. */
export interface EthosLink {
  wallet: string;
  handle: string;
  /** The numeric X account id. The whole reason this source is worth having. */
  twitterUserId: string;
  ethosScore: number;
}

export interface EthosSweepStats {
  pages: number;
  profiles: number;
  withoutX: number;
  /** Address-to-account links Ethos gave us this run. */
  links: number;
  /** Of those, wallets we had never seen. */
  newWallets: number;
  /** Wallets we held with no X handle, which this run fills. */
  filled: number;
  /** Wallets where we and Ethos already name the same account. These gain the
   *  account id, which is the quiet win: a rot detector on a row that already
   *  looked fine. */
  agree: number;
  /** Wallets where we name different accounts. Recorded, never resolved here. */
  conflicts: number;
  rateLimited: number;
  /** Pages that could not be read after retries. Coverage is short by these. */
  pagesFailed: number;
  /** Addresses two different people both claimed, and which were dropped. */
  contested: number;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * A record that describes a real person, rather than a placeholder for an
 * address nobody has claimed. See gotcha 2 above: this test is the difference
 * between 83,891 links and 4.8 million false ones.
 */
export function isRealUser(u: EthosUser | undefined | null): u is EthosUser {
  return !!u && u.status === 'ACTIVE' && !!u.username;
}

const keyValue = (u: EthosUser, prefix: string): string | null =>
  (u.userkeys ?? []).find((k) => k.startsWith(prefix))?.slice(prefix.length) ?? null;

export const twitterIdOf = (u: EthosUser) => keyValue(u, 'service:x.com:');

/**
 * Every address the record claims, lowercased.
 *
 * `userkeys` is the only correct way to associate a record with an address.
 * See gotcha 1: response order tells you nothing.
 */
export function addressesOf(u: EthosUser): string[] {
  return (u.userkeys ?? [])
    .filter((k) => k.startsWith('address:'))
    .map((k) => k.slice(8).toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a));
}

/** Turns one record into the links it supports, or none. */
export function linksFrom(u: EthosUser): EthosLink[] {
  if (!isRealUser(u)) return [];
  const twitterUserId = twitterIdOf(u);
  if (!twitterUserId) return [];
  const handle = cleanTwitterHandle(u.username!);
  if (!handle) return [];
  return addressesOf(u).map((wallet) => ({
    wallet,
    handle,
    twitterUserId,
    ethosScore: u.score,
  }));
}

interface PageResult {
  values: Array<{ user: EthosUser }>;
  total: number;
}

/**
 * One page, with a bounded retry on 429 and 5xx.
 *
 * Returns null rather than throwing when a page cannot be read. A sweep that
 * aborts on one bad page loses every page after it; a sweep that skips one page
 * loses that page and says so in the stats.
 */
async function fetchPage(offset: number, onRateLimit: () => void): Promise<PageResult | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/profiles/recent?limit=${PAGE}&offset=${offset}`, {
        headers: { 'X-Ethos-Client': CLIENT_HEADER },
      });
      if (res.status === 429) {
        onRateLimit();
        // Their limit is unpublished, so back off generously rather than
        // guessing a number that happens to work today.
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        if (res.status >= 500) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        console.error(`Ethos page ${offset}: ${res.status}`);
        return null;
      }
      return (await res.json()) as PageResult;
    } catch (error) {
      console.error(`Ethos page ${offset} failed:`, error);
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Fill where we have nothing. Never overwrite, never contradict.
 *
 * Three cases, and the third is the one that matters:
 *
 * - **We have no handle.** Take theirs, and the account id with it.
 * - **We have the same handle.** Take only the id. This is the quiet win: it
 *   attaches a rot detector to a row that already looked fine.
 * - **We have a different handle.** Write NOTHING and record a conflict.
 *
 * That last rule is not caution, it is correctness. Writing their id beside our
 * handle would produce a row asserting that a specific numeric account owns a
 * handle it does not own, which is worse than either source alone: it would
 * launder a disagreement into a fact. The `CASE` below is what enforces it, and
 * the conflict rows are written separately.
 *
 * `last_checked_at` stays untouched on purpose. It means "the full pipeline
 * ran", and it did not. `last_updated_at` moves only when a handle is actually
 * filled, so a daily re-sweep does not light up "new matches" on every saved
 * lookup that happens to contain one of these wallets.
 */
async function upsertLinks(links: EthosLink[]): Promise<number> {
  const db = getDb();
  if (!db || links.length === 0) return 0;

  let upserted = 0;

  for (let i = 0; i < links.length; i += UPSERT_BATCH) {
    const batch = links.slice(i, i + UPSERT_BATCH);
    const now = new Date();

    const rows = batch.map((l) => ({
      wallet: l.wallet,
      twitterHandle: l.handle,
      twitterUrl: `https://x.com/${l.handle}`,
      twitterUserId: l.twitterUserId,
      sources: ['ethos'],
      twitterVerified: true,
      dataQualityScore: DATA_QUALITY,
      firstSeenAt: now,
      lastUpdatedAt: now,
    }));

    const result = await db
      .insert(socialGraph)
      .values(rows)
      .onConflictDoUpdate({
        target: socialGraph.wallet,
        set: {
          // Fill only. COALESCE keeps whatever is already there.
          twitterHandle: sql`COALESCE(social_graph.twitter_handle, EXCLUDED.twitter_handle)`,
          twitterUrl: sql`COALESCE(social_graph.twitter_url, EXCLUDED.twitter_url)`,
          // The id is written when we had no handle (so theirs is now ours), or
          // when the two handles agree. Never when they disagree: see above.
          twitterUserId: sql`CASE
            WHEN social_graph.twitter_handle IS NULL
              OR lower(social_graph.twitter_handle) = lower(EXCLUDED.twitter_handle)
            THEN EXCLUDED.twitter_user_id
            ELSE social_graph.twitter_user_id
          END`,
          twitterVerified: sql`CASE
            WHEN social_graph.twitter_handle IS NULL AND EXCLUDED.twitter_handle IS NOT NULL
            THEN true ELSE social_graph.twitter_verified
          END`,
          /**
           * Gated on the SAME agreement test as the id, and this was a real bug
           * before it was a rule. Appending the source unconditionally published
           * `attested-social` on 2,479 rows whose handle this source never
           * attested: it named a different account, we correctly kept ours, and
           * then labelled ours with their evidence. Keeping the handle but
           * taking the label is the worst of both, and it is exactly what the
           * module comment above claimed not to do.
           */
          sources: sql`CASE
            WHEN social_graph.twitter_handle IS NOT NULL
              AND lower(social_graph.twitter_handle) <> lower(EXCLUDED.twitter_handle)
            THEN social_graph.sources
            WHEN 'ethos' = ANY(COALESCE(social_graph.sources, ARRAY[]::text[]))
            THEN social_graph.sources
            ELSE array_append(COALESCE(social_graph.sources, ARRAY[]::text[]), 'ethos')
          END`,
          dataQualityScore: sql`CASE
            WHEN social_graph.twitter_handle IS NOT NULL
              AND lower(social_graph.twitter_handle) <> lower(EXCLUDED.twitter_handle)
            THEN social_graph.data_quality_score
            ELSE GREATEST(COALESCE(social_graph.data_quality_score, 0), ${DATA_QUALITY})
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
 * What this sweep is about to change, counted before it changes it.
 *
 * Worth a separate query rather than inferring from the upsert's RETURNING. An
 * upsert reports rows written, which on a daily re-sweep is almost every row
 * every day and says nothing about whether anything was learned. These four
 * numbers are the ones that answer "did this do anything", and getting them
 * wrong would mean a sweep that quietly stopped working still looked busy.
 */
async function classify(links: EthosLink[]): Promise<{
  newWallets: number;
  wouldFill: number;
  agree: number;
  disagree: number;
}> {
  const db = getDb();
  const empty = { newWallets: 0, wouldFill: 0, agree: 0, disagree: 0 };
  if (!db || links.length === 0) return empty;

  const totals = { ...empty };
  for (let i = 0; i < links.length; i += UPSERT_BATCH) {
    const batch = links.slice(i, i + UPSERT_BATCH);
    const result = (await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE g.wallet IS NULL)::int                         AS new_wallets,
        count(*) FILTER (WHERE g.wallet IS NOT NULL
                           AND g.twitter_handle IS NULL)::int                 AS would_fill,
        count(*) FILTER (WHERE g.twitter_handle IS NOT NULL
                           AND lower(g.twitter_handle) = lower(t.handle))::int AS agree,
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
 * Record where we and Ethos name different accounts for the same wallet.
 *
 * Written after the upsert, and deliberately re-derived from the graph rather
 * than from what we just sent, so a conflict is only recorded when the stored
 * row really does disagree. `last_seen_at` moves on every sweep so a conflict
 * that quietly goes away stops being surfaced without anybody deleting a row.
 */
async function recordConflicts(links: EthosLink[]): Promise<number> {
  const db = getDb();
  if (!db || links.length === 0) return 0;

  let recorded = 0;
  for (let i = 0; i < links.length; i += UPSERT_BATCH) {
    const batch = links.slice(i, i + UPSERT_BATCH);
    const wallets = batch.map((l) => l.wallet);
    const handles = batch.map((l) => l.handle);
    const ids = batch.map((l) => l.twitterUserId);

    const result = await db.execute(sql`
      INSERT INTO handle_conflicts
        (wallet, platform, ours, our_sources, theirs, their_source, their_user_id, first_seen_at, last_seen_at)
      SELECT g.wallet, 'twitter', g.twitter_handle, g.sources, t.handle, 'ethos', t.user_id, now(), now()
      FROM unnest(${sql.param(wallets)}::text[], ${sql.param(handles)}::text[],
                  ${sql.param(ids)}::text[]) AS t(wallet, handle, user_id)
      JOIN social_graph g ON g.wallet = t.wallet
      WHERE g.twitter_handle IS NOT NULL
        AND lower(g.twitter_handle) <> lower(t.handle)
      ON CONFLICT (wallet, platform, their_source) DO UPDATE SET
        ours         = EXCLUDED.ours,
        our_sources  = EXCLUDED.our_sources,
        theirs       = EXCLUDED.theirs,
        their_user_id= EXCLUDED.their_user_id,
        last_seen_at = now(),
        -- A conflict that changed shape is a new conflict, so reopen it.
        resolved_at  = CASE
          WHEN handle_conflicts.theirs <> EXCLUDED.theirs
            OR handle_conflicts.ours <> EXCLUDED.ours
          THEN NULL ELSE handle_conflicts.resolved_at END
      RETURNING wallet
    `);
    recorded += (result as unknown as { rows?: unknown[] })?.rows?.length ?? 0;
  }
  return recorded;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Read the whole dataset and merge it.
 *
 * A full pass rather than an incremental one, on purpose. `/profiles/recent` is
 * newest-first, so stopping at the first familiar profile would catch new
 * signups and miss every handle refresh, and the refreshes are the reason this
 * source is worth reading. At roughly 80 requests for the entire base, there is
 * nothing to save by being clever.
 */
export async function sweepEthos(
  onProgress?: (msg: string) => void
): Promise<EthosSweepStats> {
  const stats: EthosSweepStats = {
    pages: 0,
    profiles: 0,
    withoutX: 0,
    links: 0,
    newWallets: 0,
    filled: 0,
    agree: 0,
    conflicts: 0,
    rateLimited: 0,
    pagesFailed: 0,
    contested: 0,
  };

  const first = await fetchPage(0, () => stats.rateLimited++);
  if (!first) throw new Error('Ethos sweep: could not read the first page');

  const total = first.total;
  onProgress?.(`Ethos: ${total} profiles to read`);

  const seen = new Set<number>();
  const links: EthosLink[] = [];

  const absorb = (page: PageResult) => {
    stats.pages++;
    for (const { user } of page.values) {
      // Paging a live, newest-first list can repeat a record when new rows are
      // inserted mid-sweep. Dedupe by user id so one person's addresses are not
      // counted twice.
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      stats.profiles++;
      const found = linksFrom(user);
      if (found.length === 0) {
        if (!twitterIdOf(user)) stats.withoutX++;
        continue;
      }
      links.push(...found);
    }
  };

  absorb(first);
  for (let offset = PAGE; offset < total; offset += PAGE) {
    await sleep(PAGE_DELAY_MS);
    const page = await fetchPage(offset, () => stats.rateLimited++);
    if (!page) {
      stats.pagesFailed++;
      continue;
    }
    absorb(page);
    if (offset % 5000 === 0) onProgress?.(`Ethos: ${offset}/${total}, ${links.length} links`);
  }

  /**
   * Drop any address that two different people both claim.
   *
   * Two reasons, and the second is the one that would have bitten. Postgres
   * refuses an `ON CONFLICT DO UPDATE` that touches the same row twice in one
   * statement, so a duplicate wallet inside a batch fails the whole batch, and
   * it would fail it *after* the conflicts for that batch had already been
   * written. Deduping by person, which is all the page loop does, does not
   * prevent it: two people can list the same address.
   *
   * The other reason is that dropping is the right answer anyway. If two people
   * each attest that an address is theirs, at most one of them is right, and
   * this source cannot say which. A contested address is not attested evidence,
   * so it is not evidence we should be storing as attested.
   *
   * It did not happen on the first full run: 83,891 links over 83,891 distinct
   * addresses. That makes it a latent fault rather than a live one, which is
   * the kind that surfaces on the day the dataset changes and nobody is
   * watching.
   */
  const byWallet = new Map<string, EthosLink>();
  const contested = new Set<string>();
  for (const link of links) {
    const existing = byWallet.get(link.wallet);
    if (existing && existing.twitterUserId !== link.twitterUserId) contested.add(link.wallet);
    byWallet.set(link.wallet, link);
  }
  for (const wallet of contested) byWallet.delete(wallet);
  if (contested.size > 0) {
    onProgress?.(`Ethos: dropped ${contested.size} address(es) claimed by more than one person`);
  }
  stats.contested = contested.size;

  links.length = 0;
  links.push(...byWallet.values());
  stats.links = links.length;

  // Classified and recorded BEFORE the upsert, both for the same reason: after
  // it runs, a wallet we just filled agrees with itself and a wallet we never
  // had looks like an old friend. Read the state we are about to change.
  const counts = await classify(links);
  stats.newWallets = counts.newWallets;
  stats.filled = counts.wouldFill;
  stats.agree = counts.agree;
  stats.conflicts = await recordConflicts(links);

  await upsertLinks(links);

  onProgress?.(
    `Ethos: ${stats.links} links, ${stats.newWallets} new wallets, ` +
      `${stats.filled} filled, ${stats.agree} agree, ${stats.conflicts} conflicts`
  );
  return stats;
}
