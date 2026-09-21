/**
 * KYC-attested wallet sweep: the exchange's verified-account attestations on
 * Base, resynced in full.
 *
 * The schema carries one boolean and no identity, so this is a wallet-quality
 * signal, not a link: nothing here goes near the attested-links machinery,
 * and no handle is ever written. What it buys is the one fact a customer
 * cannot infer from a wallet's contents: a regulated exchange attested that a
 * verified human controls it.
 *
 * A FULL walk every run, no checkpoint, deliberately. An incremental cursor
 * would never revisit old rows, so a revoked attestation (accounts do get
 * closed) would stay in the table forever, and a wallet that entered the
 * graph after its attestation was swept would never join the overlap. The
 * whole set is ~723 pages of 1,000 at one request each: a few minutes a
 * week. Rows seen this run get `swept_at = runStart`; after a COMPLETE walk,
 * and only then, rows with an older `swept_at` are deleted, which is how a
 * revocation leaves. A walk that dies mid-run deletes nothing.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/sweep-cb-verified.ts            # dry run (counts only)
 *   npx tsx --env-file=.env.local scripts/sweep-cb-verified.ts --commit
 */
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

const ENDPOINT = 'https://base.easscan.org/graphql';
const SCHEMA_ID =
  '0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9';
const ATTESTER = '0x357458739F90461b99789350868CD7CF330Dd7EE';
const PAGE = 1000;
const PAGE_DELAY_MS = 150;
/** A stop, not a target: 314,295 live rows on the first full sweep (2026-09-20). */
const MAX_PAGES = 2000;

interface Row {
  id: string;
  recipient: string;
  time: number;
}

async function fetchPage(afterTime: number): Promise<Row[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ attestations(where:{schemaId:{equals:"${SCHEMA_ID}"}, attester:{equals:"${ATTESTER}"}, revoked:{equals:false}, time:{gt:${afterTime}}}, take:${PAGE}, orderBy:{time:asc}){ id recipient time } }`,
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4)
        throw new Error(`easscan ${res.status} after ${attempt} attempts`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    if (!res.ok) {
      throw new Error(
        `easscan ${res.status}: ${(await res.text()).slice(0, 200)}`
      );
    }
    const json = (await res.json()) as {
      data?: { attestations?: Row[] };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      throw new Error(`easscan errors: ${json.errors[0].message}`);
    }
    // A missing payload is a malformed answer, never the end of the set: an
    // empty page here marks the walk complete and unlocks the delete pass,
    // so only a PRESENT, empty array may say so.
    if (!Array.isArray(json.data?.attestations)) {
      throw new Error(
        `easscan returned no attestations array: ${JSON.stringify(json).slice(0, 200)}`
      );
    }
    return json.data.attestations;
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const db = getDb();
  if (!db) throw new Error('Database not configured');

  const runStart = new Date();
  let cursor = 0;
  let seen = 0;
  let pages = 0;
  let complete = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await fetchPage(cursor);
    pages++;
    if (rows.length === 0) {
      complete = true;
      break;
    }
    seen += rows.length;

    if (commit) {
      /**
       * One row per wallet per statement, newest attestation kept: a wallet
       * can carry two live attestations (re-verification), and Postgres
       * refuses an ON CONFLICT DO UPDATE that touches the same row twice in
       * one statement. Found by the first full run, on page one.
       */
      const byWallet = new Map<
        string,
        { wallet: string; uid: string; time: number }
      >();
      for (const r of rows) {
        const wallet = r.recipient.toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(wallet)) continue;
        const prev = byWallet.get(wallet);
        if (!prev || r.time > prev.time) {
          byWallet.set(wallet, { wallet, uid: r.id, time: r.time });
        }
      }
      const wallets = [...byWallet.values()];
      await db.execute(sql`
        INSERT INTO cb_verified_wallets (wallet, uid, attested_at, swept_at)
        SELECT t.wallet, t.uid, to_timestamp(t.time), ${runStart}
        FROM unnest(${sql.param(wallets.map((w) => w.wallet))}::text[],
                    ${sql.param(wallets.map((w) => w.uid))}::text[],
                    ${sql.param(wallets.map((w) => w.time))}::bigint[]) AS t(wallet, uid, time)
        -- Belt to the storage trigger's suspenders: a removed wallet is
        -- excluded here explicitly, and refused by the guard if this line
        -- ever drifts.
        WHERE NOT EXISTS (
          SELECT 1 FROM suppressed_identifiers si
          WHERE si.kind = 'wallet' AND si.identifier = t.wallet
        )
        ON CONFLICT (wallet) DO UPDATE SET
          uid = EXCLUDED.uid,
          attested_at = EXCLUDED.attested_at,
          swept_at = EXCLUDED.swept_at
      `);
    }

    /**
     * `gt` on a seconds-resolution cursor can shadow same-second siblings at
     * a page boundary, the same accepted loss the governance-profile harvest
     * documents; the weekly full resync also re-offers every lost row.
     */
    cursor = rows[rows.length - 1].time;
    if (pages % 100 === 0) {
      console.log(
        `  ${pages} pages, ${seen.toLocaleString()} rows, cursor ${cursor}`
      );
    }
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  if (!complete) {
    throw new Error(
      `MAX_PAGES (${MAX_PAGES}) reached before the end of the set; nothing was deleted.`
    );
  }

  if (commit) {
    // Only after a complete walk: what this run did not see is revoked or gone.
    const removed = (await db.execute(sql`
      DELETE FROM cb_verified_wallets WHERE swept_at < ${runStart} RETURNING wallet
    `)) as unknown as { rows: unknown[] };
    const overlap = (await db.execute(sql`
      SELECT count(*)::int AS n FROM cb_verified_wallets v
      WHERE EXISTS (SELECT 1 FROM social_graph g WHERE g.wallet = v.wallet)
    `)) as unknown as { rows: Array<{ n: number }> };
    console.log(
      `Done: ${seen.toLocaleString()} attestations, ${removed.rows?.length ?? 0} removed as gone, ` +
        `${Number(overlap.rows[0]?.n ?? 0).toLocaleString()} overlap the graph.`
    );
  } else {
    console.log(
      `Dry run: ${seen.toLocaleString()} live attestations in ${pages} pages. Nothing written.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
