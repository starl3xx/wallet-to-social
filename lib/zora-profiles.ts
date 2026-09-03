/**
 * Creator-profile harvest: a keyless profile API where a person holds an
 * account, attaches social accounts, and connects wallets.
 *
 * The account is the join. A person creates a profile, links social accounts,
 * and connects wallets. The API returns the linked accounts, the linked
 * wallets, and a LINK/UNLINK ledger recording when each social account was
 * attached.
 *
 * ## Class: `aggregated`, and why not `attested-social`
 *
 * This source was written as `attested-social` and downgraded on review,
 * because the evidence does not reach that bar and the bar is what walletlink
 * sells. `attested-social` is defined in `lib/api-sources.ts` as a platform
 * where "the person proved the wallet with a signature and the account with a
 * sign-in". The wallet half of that sentence is unevidenced here.
 *
 * What the payload actually contains, verified live on 2026-09-02 against
 * several established accounts:
 *
 * - `socialAccountLinkedEvents` is a real ledger, and it covers SOCIAL
 *   ACCOUNTS ONLY. Every row is `{platform, socialAccountUsername,
 *   occurredAt, eventType}`. There is no wallet row in it, ever.
 * - `linkedWallets.edges[].node` carries exactly `{walletType,
 *   walletAddress}`. No timestamp, no event, no signature, no proof of any
 *   kind. The upstream's own documentation calls the field "Connected
 *   wallets" and types it as `PRIVY | EXTERNAL | SMART_WALLET`; the word
 *   "signature" does not appear anywhere in its profile documentation.
 *
 * So `EXTERNAL` is a statement about which of the platform's own wallet
 * categories a row falls into, not per-row evidence that this person proved
 * this address. It is very likely that connecting one requires a signature in
 * their UI, and that is exactly the problem: it is an inference about a flow
 * we cannot observe, and if the platform ever admits an address another way (a
 * paste box, an import, a delegate) nothing in the response would change.
 *
 * The account half IS evidenced, by the dated ledger. A pair is worth its
 * weaker half, so the pair is `aggregated`: good corroborating evidence, not
 * an owner attestation. That keeps it outside `ATTESTED_SOURCES`, so a
 * customer filtering for attested evidence is not shown it, and puts the score
 * at 35, well below the 70 trust line.
 *
 * Upgrading it later needs new evidence, not a new opinion: a per-wallet proof
 * record in the payload, or a documented signature requirement. Follower
 * counts and the Farcaster fid are corroboration of the ACCOUNT half, which is
 * not the half in doubt, so they do not move this.
 *
 * ## The two filters that are not optional
 *
 * Both were established by probing the live API, and both fail silently rather
 * than loudly if they are skipped, which is why each is a NAMED refusal here
 * rather than a condition folded into a filter expression.
 *
 * **1. The record must be an account.** An address the platform has never seen
 * still returns HTTP 200 with a wallet-shaped record, and that record's
 * `handle` field holds the address's ENS reverse name. Verified live on
 * 2026-09-02: `0x0000000000000000000000000000000000000000` comes back as
 * `handle: "xia.hryb1001.eth"`. Ingesting that as a profile handle would write
 * an unrelated stranger's ENS name into the index as an attested account name.
 *
 * The gate the register named is `__typename === 'GraphQLAccountProfile'`, and
 * it is necessary but not sufficient here: `/profile` returns `__typename`,
 * `/profileSocial` (the endpoint this module reads, because it is a strict
 * superset) does NOT return it at all. Measured on the same two probes. So the
 * gate is structural and the typename is checked only where it is present:
 * a real account carries `username`, `socialAccounts` and `linkedWallets`, and
 * the wallet-shaped record carries none of the three. `handle` is never read
 * as an identity value on either shape, because a registered account can also
 * hold a truncated-address handle.
 *
 * **2. Only an EXTERNAL wallet is worth emitting.** `linkedWallets` mixes
 * three `walletType` values and only `EXTERNAL` is a wallet the person
 * brought. `PRIVY` and `SMART_WALLET` are provisioned by the platform, so a
 * pair built from one asserts that a custodial address the person never chose
 * belongs to their X account. `publicWallet` is not a substitute: it is
 * frequently the SMART_WALLET, and where an account holds two EXTERNAL wallets
 * it and `externalWallet` name different ones. Every EXTERNAL wallet is
 * emitted, because the person brought all of them.
 *
 * This filter is why the rows are worth having at all; it is NOT what makes
 * them attested. See the class note above: `EXTERNAL` distinguishes a brought
 * wallet from a provisioned one and says nothing about how the bringing was
 * proved.
 *
 * `platformBlocked` is honoured wherever it appears (the profile and, at
 * enumeration time, the list node and its inline profile). It was false on
 * every one of the 200-plus records observed, so the gate is verified in code
 * and never against a live true, and what a true means remains a reading
 * rather than a measurement: it is treated as "exclude", the only safe
 * handling of an unknown exclusion flag. Nothing should attribute a share of
 * dropped rows to it until a true is found in the wild.
 *
 * ## Which platforms are emitted, and why the others are not
 *
 * Only X. The other three are read, counted and dropped:
 *
 * - **TikTok and Instagram**: `social_graph` has no column for either, so
 *   there is nowhere for the pair to land. Not a judgement about the evidence.
 *   (The register called Instagram "bio-proof"; the API does not support that
 *   claim, since all four platforms appear in the same LINK ledger with no
 *   field distinguishing how any of them was proved. The reason to drop it is
 *   the schema, and saying so keeps an unverifiable claim out of the code.)
 *
 * - **Farcaster**: read and AUDITED, never written. Two reasons. The shared
 *   attested-link ingest is X-only by construction (`AttestedLink` has a
 *   handle and an X account id and nothing else), and a second writer would
 *   duplicate the fill-only rule, the agreement gate and the conflict
 *   recording that `lib/attested-links.ts` exists to keep in one place. And
 *   `social_graph`'s Farcaster columns are owned by the monthly protocol
 *   sweep, which treats them as authoritative and overwrites them; a value
 *   written here would be clobbered on wallets the sweep covers and would sit
 *   unmaintained on the ones it does not. What the Farcaster side is worth is
 *   the free per-row audit: the API returns a real fid, so every profile with
 *   one is a check on a row the index already holds, at no extra request. If
 *   those rows are wanted later they need their own writer, and the audit
 *   counters this harvest reports are the evidence for whether they earn one.
 *
 * Discord is not read at any point and no field here is keyed by it.
 *
 * ## Rate limit
 *
 * Measured, because nothing is discoverable from the response: there is no
 * `Retry-After` and no `x-ratelimit-*` header on any status. The bucket is
 * concurrency-shaped with a slow refill (25 parallel requests all succeeded;
 * 50 parallel shed 45; a sustained 5 req/s shed a third), so the harvest runs
 * strictly serially at one request per second and treats a 429 as a long
 * back-off rather than a retry. A 504 is a gateway timeout on the upstream,
 * not a limit, so it retries on a short backoff instead.
 *
 * ## Removal
 *
 * Two halves, because this harvest both reads addresses and learns new ones.
 * The wallets mode filters the suppression list BEFORE asking about an
 * address, which is the pre-flight rule in `lib/suppression.ts`: asking a
 * third party about a suppressed address is re-collection even when the write
 * is later refused. The explore mode cannot pre-filter, since the address is
 * not known until the answer arrives, so it filters the pairs it produces.
 * The database triggers are the backstop underneath both and skip a suppressed
 * row silently, which is why neither filter may be relied on alone.
 */
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import type { AttestedLink, LinkSource } from './attested-links';

export const ZORA_PROFILE_SOURCE: LinkSource = {
  id: 'zora_profile',
  /**
   * twitter(20) + zora_profile(15) in `calculateQualityScore`, the same 15 the
   * other `aggregated` source carries. See the class note in the header: the
   * account half is evidenced and the wallet half is not, and a pair is worth
   * its weaker half.
   */
  quality: 35,
};

const API_BASE = 'https://api-sdk.zora.engineering';

/**
 * One request per second, serially. See the rate-limit note in the header:
 * the ceiling is on requests in flight rather than on a count, and a rested
 * bucket still sheds a third of a sustained 5 req/s.
 */
export const REQUEST_SPACING_MS = 1100;

/** A 429 carries no reset time, so the only safe response is to wait a while. */
const RATE_LIMIT_BACKOFF_MS = 30_000;

/** Attempts per request, including the first. */
const MAX_ATTEMPTS = 4;

/**
 * The list page size is silently capped at 20: `count=21`, `50`, `100`, `200`
 * and `1000` all return exactly 20 rows. Asking for more would make the
 * request budget lie about how much of the list a run covers.
 */
export const EXPLORE_PAGE_SIZE = 20;

/**
 * Identifies the caller. A default user agent is a real hazard on this host:
 * Python's is answered with HTTP 403 by the edge, which from the outside looks
 * exactly like an empty corpus. Node's default is accepted and so is this one,
 * both verified live.
 */
const USER_AGENT = 'walletlink.social harvester (+https://walletlink.social)';

/**
 * The list types that can actually be walked, measured by paging each to
 * exhaustion.
 *
 * The excluded ones are excluded for two different reasons and neither is a
 * preference. The volume and value leaderboards (TOP_VOLUME_24H,
 * MOST_VALUABLE, LAST_TRADED) stop dead at 200 rows with `hasNextPage: false`,
 * and TRENDING_CREATORS at 36, so a harvest pointed at one would report a
 * completed walk over a fixed leaderboard. TOP_GAINERS and LAST_TRADED_UNIQUE
 * are ranked leaderboards of the same kind: they were first observed
 * answering HTTP 504 and now answer 200, which changes nothing about why they
 * are unsuitable. The four below are keyed on a timestamp, page back
 * without a floor short of the collection's first day, and accept a
 * hand-built cursor, which is what makes the walk resumable.
 */
export const WALKABLE_LIST_TYPES = [
  'NEW_CREATORS',
  'NEW',
  'FEATURED',
  'NEW_ALL',
] as const;

export type ZoraListType = (typeof WALKABLE_LIST_TYPES)[number];

/** Creator coins, so one row is one account rather than one post. */
export const DEFAULT_LIST_TYPE: ZoraListType = 'NEW_CREATORS';

/**
 * Every reason a record produced fewer pairs than it might have, named.
 *
 * A drop with no name is the failure this whole module is written against: an
 * index quietly poisoned by a record that looked like an account, or quietly
 * empty because a filter was too strict. Each of these is counted and printed.
 */
export const ZORA_REFUSALS = [
  /** Not an account record. The ENS-reverse-name trap in the header. */
  'not_an_account',
  /** `platformBlocked` is true somewhere on the record. */
  'platform_blocked',
  /** An account with no wallet the person brought themselves. */
  'no_external_wallet',
  /** An account with no X account attached. */
  'no_x_account',
  /**
   * The X account's latest ledger entry is an UNLINK, or there is none.
   *
   * Expect this to read 0 more or less forever, and do NOT read that as
   * evidence the ledger check is unnecessary. When an account is unlinked the
   * API also nulls `socialAccounts.twitter`, so `no_x_account` fires first and
   * this one never gets the chance. The check still earns its place in the
   * other direction, which was verified live: an account whose ledger holds
   * UNLINK followed by a later LINK of the same handle is correctly emitted,
   * which a naive "any UNLINK disqualifies" rule would have dropped.
   */
  'unlinked_x_account',
  /** An X username that is not a possible X handle. */
  'malformed_x_handle',
  /** A linked wallet that is not a 20-byte hex address. */
  'malformed_wallet',
  /** A platform this index has no column for: TikTok, Instagram. */
  'platform_not_indexed',
  /** The address or the handle is on the removal suppression list. */
  'suppressed',
  /** The upstream never answered after every retry. */
  'transport_failure',
] as const;

export type ZoraRefusal = (typeof ZORA_REFUSALS)[number];

export type RefusalTally = Record<ZoraRefusal, number>;

export function emptyRefusalTally(): RefusalTally {
  const tally = {} as RefusalTally;
  for (const reason of ZORA_REFUSALS) tally[reason] = 0;
  return tally;
}

export function addRefusals(into: RefusalTally, from: RefusalTally): void {
  for (const reason of ZORA_REFUSALS) into[reason] += from[reason];
}

/**
 * A Farcaster account read off a profile, for the audit only.
 *
 * Never written. See the header for why the Farcaster side of this source is
 * a check on rows the index already holds rather than a source of new ones.
 */
export interface ZoraFarcasterObservation {
  wallet: string;
  username: string;
  /** The real fid, which is what makes the audit worth anything. */
  fid: number | null;
}

/** What one profile record yielded, and what it refused. */
export interface ZoraProfileReading {
  /**
   * The account's own username, where the record is an account. Recorded for
   * logging only: it is never an identity value, since a registered account
   * can hold a truncated-address username and the wallet-shaped record holds
   * an unrelated ENS name in the same position.
   */
  username: string | null;
  /** One pair per EXTERNAL wallet. X only. */
  links: AttestedLink[];
  farcaster: ZoraFarcasterObservation[];
  refusals: RefusalTally;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A 20-byte hex address, the only wallet shape this index stores. */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * An X handle, validated rather than repaired.
 *
 * `cleanTwitterHandle` is the normaliser every source passes through inside
 * the ingest, and it strips invalid characters instead of rejecting: it turns
 * `x.com/name` into `xcom` and `name.base.eth` into `namebaseeth`, inventing a
 * handle that belongs to somebody else. That is the right trade for a free
 * text field. Here the username arrives from an OAuth connection and is
 * already a real handle, so anything that fails this test is a parse surprise
 * and must be refused loudly rather than repaired into a plausible stranger.
 */
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

interface LedgerEntry {
  platform: string;
  username: string;
  at: number;
  linked: boolean;
}

function readLedger(profile: Record<string, unknown>): LedgerEntry[] {
  const events = profile.socialAccountLinkedEvents;
  if (!isRecord(events) || !Array.isArray(events.edges)) return [];
  const entries: LedgerEntry[] = [];
  for (const edge of events.edges) {
    if (!isRecord(edge) || !isRecord(edge.node)) continue;
    const node = edge.node;
    const platform = asString(node.platform);
    const username = asString(node.socialAccountUsername);
    const occurredAt = asString(node.occurredAt);
    const eventType = asString(node.eventType);
    if (!platform || !username || !occurredAt || !eventType) continue;
    const at = Date.parse(occurredAt);
    if (Number.isNaN(at)) continue;
    entries.push({
      platform,
      username,
      at,
      linked: eventType === 'LINK',
    });
  }
  return entries;
}

/**
 * Is this account still attached, according to the platform's own ledger?
 *
 * The latest entry for the platform and username wins, so a re-linked account
 * counts and an unlinked one does not. An account with no entry at all is
 * refused: in a pooled sample of 157 profiles every one of the 82 attached
 * accounts had a matching LINK entry and none was unbacked, so an absent
 * entry is an unexplained record rather than an ordinary one.
 */
function isLinked(
  ledger: LedgerEntry[],
  platform: string,
  username: string
): boolean {
  const wanted = username.toLowerCase();
  let latest: LedgerEntry | null = null;
  for (const entry of ledger) {
    if (entry.platform !== platform) continue;
    if (entry.username.toLowerCase() !== wanted) continue;
    if (latest === null || entry.at > latest.at) latest = entry;
  }
  return latest !== null && latest.linked;
}

function socialAccount(
  profile: Record<string, unknown>,
  platform: string
): Record<string, unknown> | null {
  const accounts = profile.socialAccounts;
  if (!isRecord(accounts)) return null;
  const account = accounts[platform];
  return isRecord(account) ? account : null;
}

function socialUsername(
  profile: Record<string, unknown>,
  platform: string
): string | null {
  const account = socialAccount(profile, platform);
  return account === null ? null : asString(account.username);
}

/**
 * Read one `/profileSocial` payload into the pairs it supports.
 *
 * Pure: every filter is applied here and every drop is counted, so a caller
 * cannot forget one. The payload is parsed from `unknown` rather than cast,
 * because the published schema and the live response disagree in exactly the
 * place the account gate depends on: the schema declares `username`
 * non-nullable, and the wallet-shaped record omits it along with everything
 * else the gate tests.
 */
export function readProfile(payload: unknown): ZoraProfileReading {
  const refusals = emptyRefusalTally();
  const empty: ZoraProfileReading = {
    username: null,
    links: [],
    farcaster: [],
    refusals,
  };

  if (!isRecord(payload) || !isRecord(payload.profile)) {
    refusals.not_an_account++;
    return empty;
  }
  const profile = payload.profile;

  // Present on `/profile`, absent on `/profileSocial`. Checked where it is
  // there, never depended on: a gate that can pass by matching nothing is not
  // a gate.
  const typename = asString(profile.__typename);
  if (typename !== null && typename !== 'GraphQLAccountProfile') {
    refusals.not_an_account++;
    return empty;
  }

  // The gate that actually fires. All three are present on an account record
  // and all three are absent on the wallet-shaped one.
  const username = asString(profile.username);
  const linkedWallets = profile.linkedWallets;
  if (
    username === null ||
    !isRecord(profile.socialAccounts) ||
    !isRecord(linkedWallets) ||
    !Array.isArray(linkedWallets.edges)
  ) {
    refusals.not_an_account++;
    return empty;
  }

  if (profile.platformBlocked === true) {
    refusals.platform_blocked++;
    return { ...empty, username };
  }

  const wallets: string[] = [];
  const seen = new Set<string>();
  for (const edge of linkedWallets.edges) {
    if (!isRecord(edge) || !isRecord(edge.node)) continue;
    const node = edge.node;
    if (node.walletType !== 'EXTERNAL') continue;
    const address = asString(node.walletAddress);
    if (address === null || !ADDRESS.test(address)) {
      refusals.malformed_wallet++;
      continue;
    }
    // Lowercased for the dedupe and because that is the form that lands: the
    // ingest lowercases every wallet before it reaches the graph.
    const wallet = address.toLowerCase();
    if (seen.has(wallet)) continue;
    seen.add(wallet);
    wallets.push(wallet);
  }

  if (wallets.length === 0) {
    refusals.no_external_wallet++;
    return { ...empty, username };
  }

  // Counted, not emitted: this index has no column for either.
  for (const platform of ['tiktok', 'instagram']) {
    if (socialUsername(profile, platform) !== null) {
      refusals.platform_not_indexed++;
    }
  }

  const ledger = readLedger(profile);
  const links: AttestedLink[] = [];
  const xUsername = socialUsername(profile, 'twitter');

  // Shape before ledger, so a username that is not a possible handle is
  // reported as the parse surprise it is. The other order would report it as
  // unlinked, since a value that cannot be a handle also never matches a
  // ledger entry, and the count would name the wrong problem.
  if (xUsername === null) {
    refusals.no_x_account++;
  } else if (!X_HANDLE.test(xUsername)) {
    refusals.malformed_x_handle++;
  } else if (!isLinked(ledger, 'TWITTER', xUsername)) {
    refusals.unlinked_x_account++;
  } else {
    for (const wallet of wallets) {
      links.push({
        wallet,
        handle: xUsername,
        /**
         * Never populated from this source. The X account object carries an
         * `id` field and it was null on all 46 sampled X links, so what a
         * non-null value would mean is unverified. `twitter_user_id` is the
         * one column that can tell a rename from a deletion, and writing a
         * value whose meaning is a guess would make it lie in the direction
         * nothing can correct.
         *
         * The cost of leaving it null, stated plainly: a handle that changed
         * hands between the LINK event and this read is emitted as a current
         * pair and nothing downstream can detect it. The ledger is dated and
         * this harvest does not bound that age, because there is no age at
         * which a link stops being the platform's latest word. It is one more
         * reason the rows are `aggregated` rather than attested, and the
         * correction path is the reachability sweep that re-reads handles,
         * not a filter here.
         */
        twitterUserId: null,
      });
    }
  }

  const farcaster: ZoraFarcasterObservation[] = [];
  const fcUsername = socialUsername(profile, 'farcaster');
  if (fcUsername !== null && isLinked(ledger, 'FARCASTER', fcUsername)) {
    const account = socialAccount(profile, 'farcaster') ?? {};
    const rawFid = asString(account.id);
    const fid = rawFid !== null && /^\d+$/.test(rawFid) ? Number(rawFid) : null;
    for (const wallet of wallets) {
      farcaster.push({ wallet, username: fcUsername, fid });
    }
  }

  return { username, links, farcaster, refusals };
}

/** One account discovered by walking a list. */
export interface ZoraListEntry {
  username: string;
}

export interface ZoraListPage {
  entries: ZoraListEntry[];
  /** Opaque, and also a hand-buildable timestamp key. Null ends the walk. */
  endCursor: string | null;
  hasNextPage: boolean;
  /** List rows excluded before any profile was fetched. */
  refusals: RefusalTally;
}

/** Raised when the upstream never answered. Callers must not advance a cursor. */
export class ZoraTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZoraTransportError';
  }
}

let lastRequestAt = 0;

async function pace(): Promise<void> {
  const wait = lastRequestAt + REQUEST_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/**
 * One GET, paced and retried.
 *
 * The three failure shapes are handled differently on purpose. A 429 has no
 * reset time on this host, so it waits a fixed long interval rather than
 * retrying into the same wall; a `Retry-After` is honoured if one ever
 * appears, which costs nothing and stops a future header change from being
 * ignored. A 5xx (504 is the one observed) is an upstream timeout and backs
 * off briefly. Anything else is a request this code got wrong, and it throws
 * immediately rather than hammering a 400 four times.
 */
async function get(
  path: string,
  params: Record<string, string>
): Promise<unknown> {
  const url = `${API_BASE}${path}?${new URLSearchParams(params).toString()}`;

  for (let attempt = 1; ; attempt++) {
    await pace();

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new ZoraTransportError(
          `${path}: network error after ${attempt} attempts: ${String(err)}`
        );
      }
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }

    if (res.status === 429) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new ZoraTransportError(
          `${path}: rate limited after ${attempt} attempts`
        );
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : RATE_LIMIT_BACKOFF_MS;
      console.warn(`  rate limited, waiting ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new ZoraTransportError(
          `${path}: HTTP ${res.status} after ${attempt} attempts`
        );
      }
      await new Promise((r) => setTimeout(r, attempt * 3000));
      continue;
    }

    if (!res.ok) {
      throw new Error(
        `${path}: HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
      );
    }

    return (await res.json()) as unknown;
  }
}

/**
 * One page of a list, newest first.
 *
 * Rows are reduced to account usernames here, because the list payload carries
 * no usable address: its `creatorAddress` was the account's SMART_WALLET in
 * 100 of 100 profiles resolved, and its inline profile copy has the account
 * ids forced to null. One profile request per account is therefore required,
 * not an optimisation to skip.
 */
export async function fetchListPage(
  listType: ZoraListType,
  after: string | null
): Promise<ZoraListPage> {
  const params: Record<string, string> = {
    listType,
    count: String(EXPLORE_PAGE_SIZE),
  };
  if (after) params.after = after;

  const payload = await get('/explore', params);
  const refusals = emptyRefusalTally();

  if (!isRecord(payload) || !isRecord(payload.exploreList)) {
    throw new Error(
      `Unexpected /explore shape: ${JSON.stringify(payload).slice(0, 300)}`
    );
  }
  const list = payload.exploreList;
  if (!Array.isArray(list.edges)) {
    throw new Error(
      `Unexpected /explore shape (no edges): ${JSON.stringify(list).slice(0, 300)}`
    );
  }

  const entries: ZoraListEntry[] = [];
  const seen = new Set<string>();
  for (const edge of list.edges) {
    if (!isRecord(edge) || !isRecord(edge.node)) continue;
    const node = edge.node;
    const creator = isRecord(node.creatorProfile) ? node.creatorProfile : null;
    if (node.platformBlocked === true || creator?.platformBlocked === true) {
      refusals.platform_blocked++;
      continue;
    }
    const username = creator ? asString(creator.handle) : null;
    if (username === null) {
      refusals.not_an_account++;
      continue;
    }
    if (seen.has(username.toLowerCase())) continue;
    seen.add(username.toLowerCase());
    entries.push({ username });
  }

  const pageInfo = isRecord(list.pageInfo) ? list.pageInfo : {};
  return {
    entries,
    endCursor: asString(pageInfo.endCursor),
    hasNextPage: pageInfo.hasNextPage === true,
    refusals,
  };
}

/**
 * Read one profile by any identifier the API resolves: an account username, a
 * hex address, or an ENS or Base name.
 *
 * `/profileSocial` rather than `/profile`, because it is a strict superset and
 * the extra fields are the ones that matter: the LINK ledger this module gates
 * on, and the linked-wallet list.
 *
 * Never pass an X handle here. `/profileBySocialHandle` is the endpoint that
 * resolves those, and feeding one to this endpoint quietly returns the
 * DIFFERENT account that happens to own the same string as its own username,
 * which would write a wrong pair that no later check could catch.
 */
export async function fetchProfile(identifier: string): Promise<unknown> {
  return get('/profileSocial', { identifier });
}

/* ------------------------------------------------------------------ */
/* Checkpoints                                                         */
/* ------------------------------------------------------------------ */

/**
 * The two walks keep separate keys, because their cursors are different kinds
 * of thing and a shared key would let one resume from the other's position.
 */
export const EXPLORE_STATE_KEY = 'zora_profile_explore';
export const WALLETS_STATE_KEY = 'zora_profile_wallets';

export interface ExploreCheckpoint {
  listType: string;
  cursor: string;
}

export async function getExploreCheckpoint(): Promise<ExploreCheckpoint | null> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(
    sql`SELECT value->>'listType' AS list_type, value->>'cursor' AS cursor
        FROM ingest_state WHERE name = ${EXPLORE_STATE_KEY}`
  )) as unknown as {
    rows: Array<{ list_type: string | null; cursor: string | null }>;
  };
  const row = result.rows[0];
  if (!row?.list_type || !row.cursor) return null;
  return { listType: row.list_type, cursor: row.cursor };
}

/**
 * Every parameter inside `jsonb_build_object` carries an explicit cast.
 *
 * The function declares its arguments as `"any"`, the driver sends no type
 * hints, and Postgres therefore fails the whole statement at plan time with
 * 42P18. It fails on every call in every environment, so a checkpoint written
 * this way never advances: the harvest reads the same page forever and reports
 * a clean run each time.
 */
export async function saveExploreCheckpoint(
  listType: string,
  cursor: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${EXPLORE_STATE_KEY},
            jsonb_build_object('listType', ${listType}::text, 'cursor', ${cursor}::text),
            now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

/**
 * Record that a walk finished, so the next run starts from the beginning.
 *
 * This is the difference between a pipeline that keeps working and one that
 * quietly stops. Both walks move AWAY from where new rows appear: the list
 * walk pages backwards in time from the cursor it started at, and the address
 * walk moves up the primary key, which has nothing to do with when a row
 * arrived. A finished walk that kept its cursor would do one request a week
 * forever and find nothing, while every account and every address that arrived
 * in the meantime sat on the wrong side of the cursor.
 *
 * The row is rewritten rather than deleted. `sweep_runner` holds SELECT,
 * INSERT and UPDATE on `ingest_state` and deliberately not DELETE, so a
 * harvest that removed its own row would work locally against the owner role
 * and fail in the scheduled run as `permission denied`. Rewriting also keeps
 * the completion visible: the row says which walk finished and when.
 */
export async function markExploreComplete(listType: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${EXPLORE_STATE_KEY},
            jsonb_build_object('listType', ${listType}::text,
                               'cursor', NULL,
                               'completedAt', now()),
            now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

export async function markWalletsComplete(): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${WALLETS_STATE_KEY},
            jsonb_build_object('lastWallet', ''::text, 'completedAt', now()),
            now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

export async function getWalletsCheckpoint(): Promise<string | null> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(
    sql`SELECT value->>'lastWallet' AS last_wallet
        FROM ingest_state WHERE name = ${WALLETS_STATE_KEY}`
  )) as unknown as { rows: Array<{ last_wallet: string | null }> };
  return result.rows[0]?.last_wallet ?? null;
}

export async function saveWalletsCheckpoint(lastWallet: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${WALLETS_STATE_KEY},
            jsonb_build_object('lastWallet', ${lastWallet}::text),
            now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

/**
 * The next page of addresses to ask about, keyed on the primary key.
 *
 * A keyset walk on `wallet` rather than an OFFSET: the index makes each page
 * cost the same, and the cursor stays valid across runs however many rows
 * arrive in between. Every address in the graph is asked about exactly once
 * per full walk, whether or not it already carries a handle, because a hit
 * that disagrees with a stored handle is recorded as a conflict and that is
 * information the fill path cannot produce.
 *
 * **A cold start looks broken and is not.** The walk is ordered by address
 * ascending from the empty string, so the first pages are vanity and burn
 * addresses: a 25-request sample ended at
 * `0x000000000000deaacbb476761b12b99b22b583eb` and every one was refused as
 * `not_an_account`, which is the account gate doing exactly its job on
 * addresses the platform has never seen. At roughly one request a second the
 * run reports zero yield for a long stretch before it reaches addresses that
 * resolve. Do not read the first reports as a failure, and do not tune
 * anything on them.
 */
export async function nextWalletPage(
  after: string,
  limit: number
): Promise<string[]> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(sql`
    SELECT wallet FROM social_graph
    WHERE wallet > ${after}::text
    ORDER BY wallet ASC
    LIMIT ${limit}::int
  `)) as unknown as { rows: Array<{ wallet: string }> };
  return result.rows.map((r) => r.wallet);
}

/** What the index already holds about the Farcaster side of these addresses. */
export interface FarcasterAudit {
  /** Same fid on both sides. */
  agree: number;
  /** Both sides hold a fid and they differ. */
  disagree: number;
  /** The index holds no Farcaster account for this address. */
  absent: number;
  /** One side has no fid to compare, so nothing is proved either way. */
  unknown: number;
}

export function emptyFarcasterAudit(): FarcasterAudit {
  return { agree: 0, disagree: 0, absent: 0, unknown: 0 };
}

export function addAudit(into: FarcasterAudit, from: FarcasterAudit): void {
  into.agree += from.agree;
  into.disagree += from.disagree;
  into.absent += from.absent;
  into.unknown += from.unknown;
}

/**
 * Compare the Farcaster accounts read off these profiles with the ones the
 * index already holds. Reads only; nothing here writes.
 *
 * The fid is the comparison that means something. A username is a string its
 * owner can change and both sides store one; the fid cannot be changed, so a
 * mismatch is a real disagreement rather than a rename.
 */
export async function auditFarcaster(
  observations: ZoraFarcasterObservation[]
): Promise<FarcasterAudit> {
  const audit = emptyFarcasterAudit();
  const db = getDb();
  if (!db || observations.length === 0) return audit;

  const wallets = [...new Set(observations.map((o) => o.wallet))];
  const result = (await db.execute(sql`
    SELECT wallet, fc_fid FROM social_graph
    WHERE wallet = ANY(${sql.param(wallets)}::text[])
  `)) as unknown as { rows: Array<{ wallet: string; fc_fid: number | null }> };

  const stored = new Map<string, number | null>();
  for (const row of result.rows) stored.set(row.wallet, row.fc_fid);

  for (const observation of observations) {
    if (!stored.has(observation.wallet)) {
      audit.absent++;
      continue;
    }
    const ours = stored.get(observation.wallet) ?? null;
    if (ours === null) {
      audit.absent++;
    } else if (observation.fid === null) {
      audit.unknown++;
    } else if (Number(ours) === observation.fid) {
      audit.agree++;
    } else {
      audit.disagree++;
    }
  }
  return audit;
}
