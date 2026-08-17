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
import { cleanTwitterHandle } from './twitter-cleaner';
import { ingestLinks, type AttestedLink, type LinkSource } from './attested-links';

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

export interface EthosUser {
  id: number;
  profileId: number | null;
  username: string | null;
  displayName: string;
  score: number;
  status: string;
  userkeys: string[];
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
export function linksFrom(u: EthosUser): AttestedLink[] {
  if (!isRealUser(u)) return [];
  const twitterUserId = twitterIdOf(u);
  if (!twitterUserId) return [];
  const handle = cleanTwitterHandle(u.username!);
  if (!handle) return [];
  return addressesOf(u).map((wallet) => ({ wallet, handle, twitterUserId }));
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
/* Ingest                                                              */
/* ------------------------------------------------------------------ */

/**
 * Every rule about what reaches the graph now lives in `lib/attested-links.ts`,
 * shared with the other attested sources. This file is a client and a shape
 * conversion, which is all an adapter should ever be.
 */
const SOURCE: LinkSource = {
  id: 'ethos',
  /**
   * 45 because that is what the live path computes, not because 45 feels right.
   * `calculateQualityScore` is additive, and a wallet with a handle from this
   * source scores twitter(20) + ethos(25) there.
   */
  quality: 45,
};

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
  const links: AttestedLink[] = [];

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

  const ingested = await ingestLinks(links, SOURCE);
  stats.links = ingested.links;
  stats.contested = ingested.contested;
  stats.newWallets = ingested.newWallets;
  stats.filled = ingested.filled;
  stats.agree = ingested.agree;
  stats.conflicts = ingested.conflicts;

  onProgress?.(
    `Ethos: ${stats.links} links, ${stats.newWallets} new wallets, ` +
      `${stats.filled} filled, ${stats.agree} agree, ${stats.conflicts} conflicts`
  );
  return stats;
}
