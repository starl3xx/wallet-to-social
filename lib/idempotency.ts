/**
 * Idempotency-Key support for `POST /v1/batch`.
 *
 * ## Why this exists
 *
 * The API bills a retry as a second resolution, and until 2026-09-01 nothing
 * offered a caller a way to retry safely: the MCP tools even declared
 * `idempotentHint: true`, inviting frameworks to resend on any timeout. A
 * caller who never saw the response to a 50-address batch had two options,
 * both bad: give up on an answer they paid for, or pay for it again.
 *
 * So the batch endpoint accepts an `Idempotency-Key` header. The first request
 * under a key executes normally and its response is stored; a repeat of the
 * same request inside the window gets the stored body and status back, marked
 * `Idempotency-Replayed: true`, and is not billed again.
 *
 * ## What the window does and does not promise
 *
 * The dedup is keyed on (api key id, header value, body hash) and lasts
 * `IDEMPOTENCY_TTL_HOURS`. It exists for sequential retries: a timeout, a
 * dropped connection, a worker restart. Two copies of the same request racing
 * each other can both miss the store and both execute; the first stored
 * response then wins the window (the upsert refuses to overwrite a live row),
 * but both calls were billed. Serialize retries; do not parallelize them.
 *
 * A key reused with a different body is refused (`IDEMPOTENCY_KEY_REUSED`),
 * because silently answering with the response to some other list is worse
 * than any error. A response too large to store is recorded without a body,
 * and a replay of it answers `IDEMPOTENCY_NOT_REPLAYABLE` so the caller knows
 * to resend under a fresh key, knowingly.
 *
 * Only a 200 consumes a key. A request that failed validation, rate limiting
 * or the balance gate stores nothing, so the same key can be retried into a
 * success.
 *
 * ## A removal reaches the stored copies
 *
 * A stored response is a copy of what the index said when the request ran,
 * and it is replayable for `IDEMPOTENCY_TTL_HOURS`. A removal inside that
 * window would otherwise be undone by a replay. So a removal rewrites the
 * stored copies that name the removed identifier (`amendRetryCopies` in
 * `lib/removal-admin.ts`), and every replay is filtered against the live
 * suppression list before it is served (`app/api/v1/batch/route.ts`), which
 * covers a removal that lands between the store and the replay. Both go
 * through `scrubStoredBatchResponse` below.
 *
 * The copies are rewritten and never deleted. A deleted key turns the
 * caller's next retry into a miss, a miss resolves and bills again, and
 * `chargeForApiCall` has no idempotency key by design: the retry this header
 * exists to protect would pay twice for one list.
 */
import { createHash } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { idempotencyKeys } from '@/db/schema';
import { isKindSuppressed, type SuppressionSets } from '@/lib/suppression';

/** How long a stored response stays replayable, and how old a row may get. */
export const IDEMPOTENCY_TTL_HOURS = 24;

/**
 * Longest accepted `Idempotency-Key` header value. A UUID is 36 characters;
 * this bounds a stored, indexed column, not a caller's imagination.
 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/**
 * Largest response body stored for replay, in bytes. Above it the key is
 * recorded with no body and a replay answers IDEMPOTENCY_NOT_REPLAYABLE. A
 * full 50-address batch response is far below this; the bound exists so the
 * table cannot become a copy of the index one jsonb row at a time.
 */
export const IDEMPOTENCY_MAX_REPLAYABLE_BYTES = 256 * 1024;

export type IdempotencyLookup =
  | { kind: 'miss' }
  | { kind: 'replay'; status: number; response: unknown }
  | { kind: 'mismatch' }
  | { kind: 'not_replayable' };

export function idempotencyBodyHash(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/**
 * What the store knows about this (key, header value) pair.
 *
 * A row past its TTL reads as a miss: the caller is starting a new attempt,
 * not retrying yesterday's, and the upsert in `storeIdempotentResponse`
 * overwrites the expired row rather than colliding with it.
 */
export async function findIdempotentReplay(
  keyId: string,
  idemKey: string,
  bodyHash: string
): Promise<IdempotencyLookup> {
  const db = getDb();
  // No database reads as a miss; the route's own reads will answer 503.
  if (!db) return { kind: 'miss' };

  try {
    return await lookupReplay(db, keyId, idemKey, bodyHash);
  } catch (error) {
    // A transient failure on the LOOKUP must not turn a keyed retry into a
    // 500: falling through to normal execution keeps the request servable,
    // bills it as the new request it is, and leaves the key replayable later.
    // Contrast the store path, whose failures are also swallowed by design.
    console.error('Idempotency replay lookup failed:', error);
    return { kind: 'miss' };
  }
}

async function lookupReplay(
  db: NonNullable<ReturnType<typeof getDb>>,
  keyId: string,
  idemKey: string,
  bodyHash: string
): Promise<IdempotencyLookup> {
  const [row] = await db
    .select({
      bodyHash: idempotencyKeys.bodyHash,
      response: idempotencyKeys.response,
      status: idempotencyKeys.status,
      createdAt: idempotencyKeys.createdAt,
    })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.keyId, keyId),
        eq(idempotencyKeys.idemKey, idemKey)
      )
    )
    .limit(1);

  if (!row) return { kind: 'miss' };

  const ageMs = Date.now() - row.createdAt.getTime();
  if (ageMs > IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000) return { kind: 'miss' };

  if (row.bodyHash !== bodyHash) return { kind: 'mismatch' };
  if (row.response === null) return { kind: 'not_replayable' };
  return { kind: 'replay', status: row.status, response: row.response };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A stored `/v1/batch` response with every suppressed identity taken out, in
 * the shape a fresh request would serve today.
 *
 * One function for both callers, so the replay filter and the removal-time
 * rewrite cannot disagree about what a removal means for a retry copy. The
 * rules are the live route's, applied to the served shape:
 *
 *  - a suppressed wallet's entry becomes `null`, and its `previously_checked`
 *    timestamp goes too, because the live route serves a suppressed wallet as
 *    never indexed and that timestamp is itself a "we held a row" signal;
 *  - a suppressed handle takes its own platform object (`twitter` or
 *    `farcaster`), and a suppressed second X handle takes `twitter.also`;
 *  - ENS, Lens and GitHub go the same way;
 *  - an entry left with no identity at all becomes `null`, which is the live
 *    route's rule for a row with no socials.
 *
 * `meta.found`, `not_found` and `matched` are recounted from what is served.
 * `matched` on the original was what that call billed, and the ledger stays
 * the billing record, the same split `amendSavedCopies` makes for
 * `lookup_jobs.any_social_found`: a count above the handles served would
 * itself say that something was removed.
 *
 * Pure. Returns the same reference when nothing matched. A value that is not
 * the stored shape is returned unchanged, since the batch route writes the
 * only rows this table holds.
 */
export function scrubStoredBatchResponse(
  payload: unknown,
  sets: SuppressionSets
): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return payload;

  let touched = false;
  const data = payload.data.map((entry: unknown) => {
    if (!isRecord(entry)) return entry;
    if (isKindSuppressed(sets, 'wallet', entry.wallet)) {
      touched = true;
      return null;
    }

    const next: Record<string, unknown> = { ...entry };
    let changed = false;
    if (isRecord(entry.twitter)) {
      if (isKindSuppressed(sets, 'twitter', entry.twitter.handle)) {
        delete next.twitter;
        changed = true;
      } else if (
        isRecord(entry.twitter.also) &&
        isKindSuppressed(sets, 'twitter', entry.twitter.also.handle)
      ) {
        const twitter = { ...entry.twitter };
        delete twitter.also;
        next.twitter = twitter;
        changed = true;
      }
    }
    if (
      isRecord(entry.farcaster) &&
      isKindSuppressed(sets, 'farcaster', entry.farcaster.username)
    ) {
      delete next.farcaster;
      changed = true;
    }
    if (isKindSuppressed(sets, 'ens', entry.ens_name)) {
      delete next.ens_name;
      changed = true;
    }
    if (isKindSuppressed(sets, 'lens', entry.lens)) {
      delete next.lens;
      changed = true;
    }
    if (isKindSuppressed(sets, 'github', entry.github)) {
      delete next.github;
      changed = true;
    }
    if (!changed) return entry;

    touched = true;
    const hasSocials = !!(
      next.twitter ||
      next.farcaster ||
      next.ens_name ||
      next.lens ||
      next.github
    );
    return hasSocials ? next : null;
  });

  let meta = payload.meta;
  if (isRecord(meta) && isRecord(meta.previously_checked)) {
    const checked = Object.entries(meta.previously_checked);
    const kept = checked.filter(
      ([wallet]) => !isKindSuppressed(sets, 'wallet', wallet)
    );
    if (kept.length !== checked.length) {
      touched = true;
      const trimmed: Record<string, unknown> = { ...meta };
      delete trimmed.previously_checked;
      // Absent when empty, the live route's rule: absent is not false.
      if (kept.length > 0) {
        trimmed.previously_checked = Object.fromEntries(kept);
      }
      meta = trimmed;
    }
  }

  if (!touched) return payload;

  if (isRecord(meta)) {
    const found = data.filter((entry) => entry !== null).length;
    const requested =
      typeof meta.requested === 'number' ? meta.requested : data.length;
    meta = {
      ...meta,
      found,
      not_found: requested - found,
      matched: data.filter(
        (entry) => isRecord(entry) && (entry.twitter || entry.farcaster)
      ).length,
    };
  }
  return { ...payload, data, meta };
}

/**
 * Record a served response under its idempotency key.
 *
 * The upsert only overwrites a row that has aged past the TTL. Inside the
 * window the first stored response stands, so two racing duplicates cannot
 * take turns rewriting what a later replay returns.
 */
export async function storeIdempotentResponse(
  keyId: string,
  idemKey: string,
  bodyHash: string,
  status: number,
  payload: unknown
): Promise<void> {
  const db = getDb();
  if (!db) return;

  const serialized = JSON.stringify(payload);
  const replayable =
    Buffer.byteLength(serialized, 'utf8') <= IDEMPOTENCY_MAX_REPLAYABLE_BYTES;

  await db.execute(sql`
    INSERT INTO idempotency_keys (key_id, idem_key, body_hash, response, status)
    VALUES (${keyId}, ${idemKey}, ${bodyHash}, ${replayable ? serialized : null}::jsonb, ${status})
    ON CONFLICT (key_id, idem_key) DO UPDATE
      SET body_hash = EXCLUDED.body_hash,
          response = EXCLUDED.response,
          status = EXCLUDED.status,
          created_at = now()
      WHERE idempotency_keys.created_at < now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})
  `);
}

/**
 * Delete rows past the TTL. Called from the cleanup cron
 * (`app/api/cron/cleanup/route.ts`), which is where every other retention
 * period in this codebase is enforced.
 *
 * The interval is computed in SQL rather than as a JS Date parameter, because
 * a Date parameter through raw SQL shifts by the local offset (see the Drizzle
 * raw-SQL notes in the cron modules that learned this the hard way).
 */
export async function cleanupIdempotencyKeys(): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const result = (await db.execute(sql`
    DELETE FROM idempotency_keys
    WHERE created_at < now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})
    RETURNING key_id
  `)) as unknown as { rows: unknown[] };

  return result.rows.length;
}
