/**
 * Sanctions screening for the USDC rail (Linear STA-41, decided 2026-09-25).
 *
 * The wallet paying `/api/x402/buy` is checked against the EVM addresses on
 * OFAC's SDN list before anything verifies or settles, so a listed payer is
 * refused and no money moves. Card checkout has no wallet to check; it gets
 * the geoblock in `lib/geoblock.ts` only.
 *
 * ## Why the list is built here
 *
 * From OFAC's own SDN.XML, a US government work with no key, no account and no
 * terms. The free onchain oracle was measured on 2026-09-24 and was stale: no
 * update since 2026-03-18, and it answered "not sanctioned" for 42 of the 124
 * EVM addresses on the SDN list published 2026-09-23. A remote screening API
 * would put a third-party quota in the money path. This list is as fresh as
 * the refresh cron makes it, and a screen is one local read.
 *
 * ## The pieces
 *
 * - `parseSdnXml`: every `0x` + 40-hex token inside an `<sdnEntry>`, whatever
 *   ticker OFAC filed it under (ETH, USDT, USDC, ARB, BSC, BNB, ETC): an EVM
 *   address is the same key on Base. It refuses a file it cannot vouch for:
 *   no publish date, no closing tag, or an entry count that disagrees with
 *   the file's own `Record_Count`.
 * - `refreshSanctionsList`: fetch, parse, guard, replace, then re-check past
 *   buyers. Run by `/api/cron/sanctions-refresh` every six hours.
 * - `refreshRefusal`: the guard. A refresh never replaces the list with an
 *   empty parse, an older publication, or one more than `SANCTIONS_MAX_DROP`
 *   smaller, unless an operator names the exact new count.
 * - `screenPayer` and `sanctionsRefusal`: the route-time read, its record, and
 *   the response.
 * - `freezeListedBuyers`: a wallet listed after it bought. Its accounts are
 *   frozen and their keys deactivated. Never refunded.
 * - The five-year purge of the screening record is `deleteOldScreenings` in
 *   lib/retention.ts, beside the other retention deletes the cleanup runs.
 *
 * ## Fail closed
 *
 * The route refuses a sale (503, before verify) when the list is missing, when
 * its last successful refresh is `SANCTIONS_REFUSE_AFTER_DAYS` old, and when
 * the read or its record fails. A refused sale costs a retry; a screen that
 * fails open is no screen. The refresh alerts through the admin health panel
 * after `SANCTIONS_ALERT_AFTER_HOURS` without a success, long before sales
 * stop.
 *
 * ## Where the list and its metadata live
 *
 * `sanctioned_addresses` holds the current list, lowercased, one row per
 * address. The list's own metadata (OFAC's publish date, the time of the last
 * successful refresh, the counts) is the `ingest_state` row
 * `SANCTIONS_STATE_ROW`, written in the same statement as the list, so
 * `scripts/ops-status.ts` prints it with every other pipeline's state.
 * `sanctions_screenings` is the record of each screening, kept five years.
 * Schema: `scripts/migrate-sanctions-screening.ts`.
 */
import { NextResponse } from 'next/server';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { BASE_MAINNET } from '@/lib/x402';

/** OFAC's SDN list as XML. It redirects to a presigned download. */
export const SDN_XML_URL =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML';

/** The `ingest_state` row that carries the list's metadata. */
export const SANCTIONS_STATE_ROW = 'sanctions_list';

/**
 * Alert when no refresh has succeeded for this long. Six missed runs: one
 * failed run is not an alarm, a day and a half of them is. The admin health
 * panel reads this as the refresh job's `maxAgeHours`.
 */
export const SANCTIONS_ALERT_AFTER_HOURS = 36;

/**
 * Refuse USDC sales once the last successful refresh is this old, and when
 * there is no list at all. Measured from our last successful refresh, never
 * from OFAC's publish date: OFAC can go more than a week without publishing,
 * and an unchanged list confirmed this morning is current.
 */
export const SANCTIONS_REFUSE_AFTER_DAYS = 7;

/**
 * The largest share of the list one refresh may remove. A truncated download
 * or a format change shows up as a list that shrank; writing it would unlist
 * addresses silently. A real delisting that large is rare, and an operator
 * accepts it by naming the new count (`acceptCount`).
 */
export const SANCTIONS_MAX_DROP = 0.2;

/** How long a refused buyer is told to wait before retrying a 503. */
export const SCREENING_RETRY_AFTER_SECONDS = 3600;

/** What a listed payer is told. No list named, no detail given. */
export const SANCTIONED_PAYER_MESSAGE = 'This payment cannot be accepted.';

/** What a buyer is told when the screen cannot run. */
export const SCREENING_UNAVAILABLE_MESSAGE =
  'Payments are paused while a required check is unavailable. Nothing was charged; try again later.';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * What these functions need from a database: Drizzle's `execute`. Structural,
 * so a PGlite-backed Drizzle or a recording stub can stand in for Neon.
 */
export interface SanctionsDb {
  execute(query: SQL): Promise<unknown>;
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------------ parse

export interface SdnAddress {
  /** Lowercased `0x` + 40 hex. */
  address: string;
  /** The `<uid>` of the SDN entry that lists it. */
  sdnUid: string;
  /** The entry's name, first and last joined. */
  entity: string;
  /** The tickers OFAC filed it under, e.g. `['ETH', 'USDT']`. Empty when it
   *  appears in the entry outside a digital currency id. */
  tickers: string[];
}

export interface SdnList {
  /** OFAC's `Publish_Date`, as `YYYY-MM-DD`. */
  publishDate: string;
  /** Entries in the file, checked against its own `Record_Count`. */
  recordCount: number;
  /** Distinct addresses, sorted. */
  addresses: SdnAddress[];
}

export class SdnParseError extends Error {}

const ENTRY = /<sdnEntry>([\s\S]*?)<\/sdnEntry>/g;
const ID_BLOCK = /<id>([\s\S]*?)<\/id>/g;
/** Not part of a longer hex run, so a 64-hex transaction hash never matches. */
const EVM_TOKEN = /(?<![0-9a-fA-F])0[xX][0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const HAS_EVM_TOKEN = /(?<![0-9a-fA-F])0[xX][0-9a-fA-F]{40}(?![0-9a-fA-F])/;
const CURRENCY_ID = /^Digital Currency Address - (.+)$/;

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function tagText(body: string, name: string): string | null {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(body);
  if (!m) return null;
  return m[1]
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITIES[e])
    .trim();
}

/**
 * The EVM addresses on an SDN.XML file.
 *
 * Every `0x` + 40-hex token inside an entry, not only the ones under a
 * "Digital Currency Address" id: if OFAC renamed that id type, a parse keyed
 * on it would return a shorter list, and the refresh guard would be the only
 * thing between that and a silent unlisting. On the 2026-09-23 file the two
 * readings are the same 124 addresses.
 *
 * Throws `SdnParseError` for a file it cannot vouch for, and the refresh then
 * keeps the list it has.
 */
export function parseSdnXml(xml: string): SdnList {
  const published =
    /<Publish_Date>\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/Publish_Date>/.exec(xml);
  if (!published) throw new SdnParseError('no Publish_Date');
  const publishDate = `${published[3]}-${published[1]}-${published[2]}`;
  const asDate = new Date(`${publishDate}T00:00:00Z`);
  if (
    Number.isNaN(asDate.getTime()) ||
    asDate.toISOString().slice(0, 10) !== publishDate
  ) {
    throw new SdnParseError(`Publish_Date is not a date: ${publishDate}`);
  }

  // A download cut short ends mid-entry. The closing tag is the cheapest proof
  // that it did not.
  if (!/<\/sdnList>\s*$/.test(xml)) {
    throw new SdnParseError('the file does not end with </sdnList>');
  }
  const declared = /<Record_Count>\s*(\d+)\s*<\/Record_Count>/.exec(xml);
  if (!declared) throw new SdnParseError('no Record_Count');

  let entries = 0;
  const byAddress = new Map<string, SdnAddress>();
  for (const entry of xml.matchAll(ENTRY)) {
    entries++;
    const body = entry[1];
    if (!HAS_EVM_TOKEN.test(body)) continue;

    const sdnUid = tagText(body, 'uid') ?? '';
    const entity = [tagText(body, 'firstName'), tagText(body, 'lastName')]
      .filter(Boolean)
      .join(' ');

    const tickers = new Map<string, Set<string>>();
    for (const id of body.matchAll(ID_BLOCK)) {
      const ticker = CURRENCY_ID.exec(tagText(id[1], 'idType') ?? '')?.[1];
      const number = (tagText(id[1], 'idNumber') ?? '').toLowerCase();
      if (!ticker || !/^0x[0-9a-f]{40}$/.test(number)) continue;
      const set = tickers.get(number) ?? new Set<string>();
      set.add(ticker.trim());
      tickers.set(number, set);
    }

    for (const token of body.matchAll(EVM_TOKEN)) {
      const address = token[0].toLowerCase();
      const filed = [...(tickers.get(address) ?? [])];
      const known = byAddress.get(address);
      if (known) {
        known.tickers = [...new Set([...known.tickers, ...filed])].sort();
      } else {
        byAddress.set(address, {
          address,
          sdnUid,
          entity,
          tickers: filed.sort(),
        });
      }
    }
  }

  if (entries !== Number(declared[1])) {
    throw new SdnParseError(
      `the file declares ${declared[1]} entries and holds ${entries}`
    );
  }

  return {
    publishDate,
    recordCount: entries,
    addresses: [...byAddress.values()].sort((a, b) =>
      a.address < b.address ? -1 : 1
    ),
  };
}

/** Download SDN.XML. About 29 MB; a few seconds from a server. */
export async function fetchSdnXml(
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const response = await fetchImpl(SDN_XML_URL, {
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`SDN.XML answered ${response.status}`);
  }
  return response.text();
}

// ------------------------------------------------------------ list state

export interface ListState {
  /** OFAC's publish date of the list in force, `YYYY-MM-DD`. */
  publishDate: string;
  /** When a refresh last succeeded, ISO. */
  refreshedAt: string;
  addressCount: number;
}

/** The `ingest_state` value, or null when it is absent or malformed. */
export function parseListState(value: unknown): ListState | null {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const { publishDate, refreshedAt, addressCount } = v as Record<
    string,
    unknown
  >;
  if (
    typeof publishDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(publishDate) ||
    typeof refreshedAt !== 'string' ||
    !Number.isFinite(Date.parse(refreshedAt)) ||
    typeof addressCount !== 'number'
  ) {
    return null;
  }
  return { publishDate, refreshedAt, addressCount };
}

async function readCurrentList(
  db: SanctionsDb
): Promise<{ count: number; state: ListState | null }> {
  const [row] = rowsOf<{ n: number | string; state: unknown }>(
    await db.execute(sql`
      SELECT (SELECT count(*)::int FROM sanctioned_addresses) AS n,
             (SELECT value FROM ingest_state WHERE name = ${SANCTIONS_STATE_ROW}) AS state
    `)
  );
  return { count: Number(row?.n ?? 0), state: parseListState(row?.state) };
}

// ----------------------------------------------------------------- guard

export type RefreshRefusal = 'empty' | 'older_publication' | 'sharp_drop';

/**
 * Why a parsed list must not replace the one in force, or null when it may.
 *
 * - `empty`: never, override or not. An empty list screens nobody.
 * - `older_publication`: a list OFAC published before the one we hold.
 * - `sharp_drop`: more than `SANCTIONS_MAX_DROP` of the list would go. An
 *   operator who has checked OFAC's recent actions accepts it by passing the
 *   exact new count as `acceptCount`; any other count is still refused.
 */
export function refreshRefusal(
  current: { count: number; publishDate: string | null },
  incoming: { count: number; publishDate: string },
  acceptCount: number | null = null
): RefreshRefusal | null {
  if (incoming.count <= 0) return 'empty';
  if (current.publishDate && incoming.publishDate < current.publishDate) {
    return 'older_publication';
  }
  if (
    current.count > 0 &&
    incoming.count < current.count * (1 - SANCTIONS_MAX_DROP) &&
    acceptCount !== incoming.count
  ) {
    return 'sharp_drop';
  }
  return null;
}

// --------------------------------------------------------------- replace

/**
 * Put `list` in force, in ONE statement: the rows it drops, the rows it adds
 * or updates, and the state row with the new refresh time. Commits whole or
 * not at all, on a driver with no transactions, so no screen can read half a
 * list. `first_seen_at` is written on insert only: when this system first
 * saw the address listed.
 */
export async function replaceSanctionsList(
  db: SanctionsDb,
  list: SdnList,
  now: Date
): Promise<{ added: number; removed: number; total: number }> {
  const addresses = list.addresses.map((a) => a.address);
  const uids = list.addresses.map((a) => a.sdnUid);
  const entities = list.addresses.map((a) => a.entity);
  const tickers = list.addresses.map((a) => a.tickers.join(','));
  const state = JSON.stringify({
    publishDate: list.publishDate,
    refreshedAt: now.toISOString(),
    addressCount: addresses.length,
    recordCount: list.recordCount,
  });

  const [row] = rowsOf<{ added: number; removed: number; total: number }>(
    await db.execute(sql`
      WITH incoming AS (
        SELECT * FROM unnest(
          ${sql.param(addresses)}::text[],
          ${sql.param(uids)}::text[],
          ${sql.param(entities)}::text[],
          ${sql.param(tickers)}::text[]
        ) AS t(address, sdn_uid, entity, tickers)
      ), removed AS (
        DELETE FROM sanctioned_addresses s
        WHERE NOT EXISTS (SELECT 1 FROM incoming i WHERE i.address = s.address)
        RETURNING 1
      ), upserted AS (
        INSERT INTO sanctioned_addresses (address, sdn_uid, entity, tickers)
        SELECT address, sdn_uid, entity, tickers FROM incoming
        ON CONFLICT (address) DO UPDATE
          SET sdn_uid = EXCLUDED.sdn_uid,
              entity = EXCLUDED.entity,
              tickers = EXCLUDED.tickers
        RETURNING 1
      ), state AS (
        INSERT INTO ingest_state (name, value, updated_at)
        VALUES (${SANCTIONS_STATE_ROW}, ${state}::jsonb, now())
        ON CONFLICT (name) DO UPDATE
          SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        RETURNING 1
      )
      -- Every data-modifying CTE runs to completion whether or not this reads
      -- it, and all of them see the list as it stood before the statement, so
      -- the NOT EXISTS below counts what is genuinely new.
      SELECT
        (SELECT count(*)::int FROM incoming i
          WHERE NOT EXISTS (SELECT 1 FROM sanctioned_addresses s WHERE s.address = i.address)) AS added,
        (SELECT count(*)::int FROM removed) AS removed,
        (SELECT count(*)::int FROM upserted) AS total
    `)
  );
  return {
    added: Number(row?.added ?? 0),
    removed: Number(row?.removed ?? 0),
    total: Number(row?.total ?? 0),
  };
}

// ---------------------------------------------------------------- freeze

/** The prefix of every x402 settlement id; the payer is the third field. */
const SETTLEMENT_PREFIX = `${BASE_MAINNET}:`;

/**
 * A wallet that bought and is now listed.
 *
 * The payer of every x402 purchase is stored: `credit_lots.settlement_id` is
 * `<network>:<from>:<nonce>` with `from` lowercased (`settlementIdFor` in
 * lib/x402.ts), so `split_part(..., ':', 3)` is the paying wallet whichever
 * account the purchase credited, including a top-up to an email account. A
 * wallet-keyed account also carries the wallet in `users.wallet`.
 *
 * Every account either names is frozen, in one statement: `frozen_at` and a
 * reason on the account (set once, never moved), and every active key
 * deactivated. A frozen account's keys stop validating even if one is minted
 * later (`lookupActiveKey` in lib/api-keys.ts), and it can start no new work
 * or spend credits (`isAccountFrozen` in lib/account-freeze.ts). Nothing is
 * refunded: see the runbook in docs/OPERATIONS.md.
 *
 * Idempotent. An account frozen by an earlier run is not counted again, but
 * any key it has gained since is deactivated again.
 */
export async function freezeListedBuyers(
  db: SanctionsDb,
  publishDate: string | null
): Promise<{ matched: number; newlyFrozen: number; keysDeactivated: number }> {
  const [row] = rowsOf<{
    matched: number;
    newly_frozen: number;
    keys_deactivated: number;
  }>(
    await db.execute(sql`
      WITH hits AS (
        SELECT DISTINCT ON (user_id) user_id, payer FROM (
          SELECT l.user_id, s.address AS payer
          FROM credit_lots l
          JOIN sanctioned_addresses s
            ON s.address = split_part(l.settlement_id, ':', 3)
          WHERE l.settlement_id LIKE ${SETTLEMENT_PREFIX + '%'}
          UNION ALL
          SELECT u.id, s.address
          FROM users u
          JOIN sanctioned_addresses s ON s.address = u.wallet
          WHERE u.origin = 'x402'
        ) m
        ORDER BY user_id, payer
      ), frozen AS (
        UPDATE users u
        SET frozen_at = now(),
            frozen_reason = 'sanctions list match: x402 payer ' || hits.payer
              || ' (list published ' || coalesce(${publishDate}::text, 'unknown') || ')'
        FROM hits
        WHERE u.id = hits.user_id AND u.frozen_at IS NULL
        RETURNING u.id
      ), keys AS (
        UPDATE api_keys k
        SET is_active = false
        FROM hits
        WHERE k.user_id = hits.user_id AND k.is_active = true
        RETURNING k.id
      )
      SELECT
        (SELECT count(*)::int FROM hits) AS matched,
        (SELECT count(*)::int FROM frozen) AS newly_frozen,
        (SELECT count(*)::int FROM keys) AS keys_deactivated
    `)
  );
  return {
    matched: Number(row?.matched ?? 0),
    newlyFrozen: Number(row?.newly_frozen ?? 0),
    keysDeactivated: Number(row?.keys_deactivated ?? 0),
  };
}

// --------------------------------------------------------------- refresh

export interface RefreshOutcome {
  /** True only when a new list went in force AND the freeze check ran. */
  ok: boolean;
  /** Why the parsed list was not put in force, when it was not. */
  refused: RefreshRefusal | null;
  /** The download, parse or freeze error, when there was one. */
  error: string | null;
  publishDate: string | null;
  /** Addresses in the parsed file, or null when nothing parsed. */
  parsed: number | null;
  /** Addresses in force before this run. */
  previous: number;
  added: number;
  removed: number;
  /** Null when the freeze check could not run. */
  freeze: {
    matched: number;
    newlyFrozen: number;
    keysDeactivated: number;
  } | null;
  /** Hours since the last successful refresh, after this run. */
  listAgeHours: number | null;
  /** No refresh has succeeded for `SANCTIONS_ALERT_AFTER_HOURS`. */
  alert: boolean;
}

/**
 * One refresh: download, parse, guard, replace, then re-check every past
 * x402 payer against the list now in force.
 *
 * The freeze check runs on every run, including one whose new list was
 * refused: the list in force is still the best one there is, and re-checking
 * against it is idempotent. A failure in it makes the run a failure.
 *
 * Throws only when the current list cannot be read or the replace itself
 * fails; the cron route reports that as a failed run.
 */
export async function refreshSanctionsList(options: {
  db: SanctionsDb;
  fetchXml?: () => Promise<string>;
  now?: Date;
  acceptCount?: number | null;
}): Promise<RefreshOutcome> {
  const { db, fetchXml = () => fetchSdnXml(), acceptCount = null } = options;
  const now = options.now ?? new Date();
  const current = await readCurrentList(db);

  let list: SdnList | null = null;
  let error: string | null = null;
  try {
    list = parseSdnXml(await fetchXml());
  } catch (e) {
    error = `download or parse failed: ${messageOf(e)}`;
  }

  let refused: RefreshRefusal | null = null;
  let applied: { added: number; removed: number } | null = null;
  if (list) {
    refused = refreshRefusal(
      { count: current.count, publishDate: current.state?.publishDate ?? null },
      { count: list.addresses.length, publishDate: list.publishDate },
      acceptCount
    );
    if (!refused) applied = await replaceSanctionsList(db, list, now);
  }

  let freeze: RefreshOutcome['freeze'] = null;
  try {
    freeze = await freezeListedBuyers(
      db,
      applied && list ? list.publishDate : (current.state?.publishDate ?? null)
    );
  } catch (e) {
    error = [error, `freeze check failed: ${messageOf(e)}`]
      .filter(Boolean)
      .join('; ');
  }

  const lastSuccess = applied
    ? now.getTime()
    : Date.parse(current.state?.refreshedAt ?? '');
  const listAgeHours = Number.isFinite(lastSuccess)
    ? Math.round(((now.getTime() - lastSuccess) / HOUR_MS) * 10) / 10
    : null;

  return {
    ok: Boolean(applied) && freeze !== null,
    refused,
    error,
    publishDate: list?.publishDate ?? current.state?.publishDate ?? null,
    parsed: list ? list.addresses.length : null,
    previous: current.count,
    added: applied?.added ?? 0,
    removed: applied?.removed ?? 0,
    freeze,
    listAgeHours,
    alert: listAgeHours === null || listAgeHours > SANCTIONS_ALERT_AFTER_HOURS,
  };
}

// ---------------------------------------------------------------- screen

export type ScreenVerdict = 'clear' | 'listed' | 'stale' | 'missing' | 'error';

/**
 * The verdict for a payer, from the list state and whether the address is on
 * it. A hit on a list that has aged is still a hit, so `listed` is decided
 * before `stale`.
 */
export function screeningVerdict(
  state: ListState | null,
  listed: boolean,
  now: Date
): Exclude<ScreenVerdict, 'error'> {
  if (!state) return 'missing';
  if (listed) return 'listed';
  const age = now.getTime() - Date.parse(state.refreshedAt);
  if (!(age <= SANCTIONS_REFUSE_AFTER_DAYS * DAY_MS)) return 'stale';
  return 'clear';
}

/**
 * Screen a payer and record the screening.
 *
 * One read for the list state and the address, then one insert into
 * `sanctions_screenings` (address, the list's publish date, the verdict, the
 * time). The record is part of the screen: when it cannot be written the
 * verdict is `error`, and the route refuses. Any other failure, and a missing
 * database, is `error` too. Never throws.
 */
export async function screenPayer(
  payer: string,
  db: SanctionsDb | null = getDb(),
  now: Date = new Date()
): Promise<{ verdict: ScreenVerdict; publishDate: string | null }> {
  if (!db) return { verdict: 'error', publishDate: null };
  const address = payer.trim().toLowerCase();
  try {
    const [row] = rowsOf<{ state: unknown; listed: boolean }>(
      await db.execute(sql`
        SELECT (SELECT value FROM ingest_state WHERE name = ${SANCTIONS_STATE_ROW}) AS state,
               EXISTS (SELECT 1 FROM sanctioned_addresses WHERE address = ${address}) AS listed
      `)
    );
    const state = parseListState(row?.state);
    const verdict = screeningVerdict(state, row?.listed === true, now);
    const publishDate = state?.publishDate ?? null;
    await db.execute(sql`
      INSERT INTO sanctions_screenings (address, list_publish_date, verdict)
      VALUES (${address}, ${publishDate}::date, ${verdict})
    `);
    return { verdict, publishDate };
  } catch (error) {
    console.error('[sanctions] screening could not run; refusing:', error);
    return { verdict: 'error', publishDate: null };
  }
}

/**
 * The response for a verdict, or null for `clear` alone. Anything else,
 * including a verdict this function has never heard of, refuses.
 */
export function sanctionsRefusal(verdict: ScreenVerdict): NextResponse | null {
  if (verdict === 'clear') return null;
  if (verdict === 'listed') {
    return NextResponse.json(
      { error: SANCTIONED_PAYER_MESSAGE, code: 'SANCTIONED_PAYER' },
      { status: 403 }
    );
  }
  return NextResponse.json(
    { error: SCREENING_UNAVAILABLE_MESSAGE, code: 'SCREENING_UNAVAILABLE' },
    {
      status: 503,
      headers: { 'Retry-After': String(SCREENING_RETRY_AFTER_SECONDS) },
    }
  );
}
