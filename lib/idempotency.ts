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
 */
import { createHash } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { idempotencyKeys } from '@/db/schema';

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
