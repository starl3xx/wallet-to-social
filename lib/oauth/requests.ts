/**
 * The life of one authorization request: arrives, waits for a person, becomes
 * a code, is spent exactly once.
 *
 * The row is written before the user is known. That ordering is what makes the
 * sign-in detour safe: from the moment the request is stored, every later step
 * refers to it by an opaque id we generated, so nothing a client supplied ever
 * travels through the magic-link round trip. There is no attacker-controlled
 * URL for the sign-in flow to carry, which is the usual way a consent screen
 * turns into an open redirect.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { oauthAuthorizationRequests } from '@/db/schema';

/** A request the user has not answered yet. Long enough to read an email. */
const REQUEST_TTL_MS = 30 * 60 * 1000;

/**
 * How long an authorization code lives.
 *
 * OAuth 2.1 permits ten minutes and recommends less. The code travels from our
 * redirect straight into the client's token call, so a minute is generous, and
 * a short window is the cheapest defence against a code sitting in a browser
 * history or a proxy log.
 */
const CODE_TTL_MS = 60 * 1000;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** The PKCE transform: BASE64URL(SHA256(verifier)), RFC 7636 section 4.2. */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Constant-time comparison of a presented PKCE verifier against a stored
 * challenge.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first, and that comparison is not itself constant time. It does not need to
 * be: the challenge length is fixed by the transform above at 43 characters,
 * so a length mismatch leaks that the attacker's guess was the wrong length,
 * which they already knew.
 */
export function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(s256Challenge(verifier));
  const stored = Buffer.from(challenge);
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

export interface PendingRequest {
  id: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  resource: string | null;
  state: string | null;
  codeChallenge: string;
}

export async function createAuthorizationRequest(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string | null;
  state: string | null;
}): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .insert(oauthAuthorizationRequests)
    .values({
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      scope: input.scope,
      resource: input.resource,
      state: input.state,
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
    })
    .returning();
  return row?.id ?? null;
}

/**
 * Read back a request that has not been answered or expired.
 *
 * `code_hash IS NULL` is part of the filter, so a request whose code has
 * already been issued cannot be consented to a second time and produce a
 * second code for one approval.
 */
export async function loadPendingRequest(
  id: string
): Promise<PendingRequest | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(oauthAuthorizationRequests)
    .where(
      and(
        eq(oauthAuthorizationRequests.id, id),
        isNull(oauthAuthorizationRequests.codeHash),
        sql`${oauthAuthorizationRequests.expiresAt} > now()`
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    scope: row.scope,
    resource: row.resource,
    state: row.state,
    codeChallenge: row.codeChallenge,
  };
}

/**
 * Turn an approved request into a code, once.
 *
 * The `code_hash IS NULL` predicate is inside the UPDATE rather than checked
 * before it, so two approvals racing produce one code and one null: the loser
 * updates zero rows and is told so, instead of overwriting the winner's code
 * with a second one that would also work.
 */
export async function issueCode(
  requestId: string,
  userId: string,
  grantId: string
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const code = randomBytes(32).toString('base64url');
  const updated = await db
    .update(oauthAuthorizationRequests)
    .set({
      userId,
      grantId,
      codeHash: sha256(code),
      codeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
    })
    .where(
      and(
        eq(oauthAuthorizationRequests.id, requestId),
        isNull(oauthAuthorizationRequests.codeHash),
        sql`${oauthAuthorizationRequests.expiresAt} > now()`
      )
    )
    .returning();
  return updated.length === 1 ? code : null;
}

export type LoadedCode =
  | { ok: true; row: typeof oauthAuthorizationRequests.$inferSelect }
  | { ok: false };

/**
 * Read a code's row. It does not judge the row.
 *
 * Split from the consume below, and the split is the whole point. The first
 * version consumed first and validated afterwards, which meant a single
 * exchange with a wrong `code_verifier` burned the code *and* made the real
 * client's retry look like a replay, which revoked the grant. Anybody who
 * could see a code could therefore destroy the connection it belonged to by
 * spending it with garbage PKCE: the checks meant to prove the caller was the
 * right client ran after the damage.
 *
 * Deliberately no expiry check here, and that is the second thing this got
 * wrong. Checking it here read the Node clock while the consume below reads
 * Postgres's, so a code near its boundary could pass one and fail the other,
 * and a failed consume was being read as a replay: an ordinary first exchange
 * arriving a moment late was answered by revoking the connection. It also hid
 * `consumed_at` behind the expiry, so a replay that arrived after the window
 * was reported as "expired" and revoked nothing, which is the case replay
 * detection exists for.
 *
 * One clock decides, and it is Postgres's, in `consumeCode`.
 */
export async function loadCode(code: string): Promise<LoadedCode> {
  const db = getDb();
  if (!db) return { ok: false };

  const [row] = await db
    .select()
    .from(oauthAuthorizationRequests)
    .where(eq(oauthAuthorizationRequests.codeHash, sha256(code)))
    .limit(1);

  return row ? { ok: true, row } : { ok: false };
}

/**
 * What happened when we tried to spend a code.
 *
 * Four outcomes rather than a boolean, because two of them mean "no" for
 * completely different reasons and only one of them justifies revoking a
 * grant. A boolean forced the caller to guess, and it guessed wrong in both
 * directions.
 */
export type ConsumeResult = 'consumed' | 'replayed' | 'expired' | 'unknown';

/**
 * Spend a code, once.
 *
 * The UPDATE is conditional, so two exchanges racing produce exactly one
 * winner and the loser learns why by reading the row back. `replayed` is
 * checked before `expired` on that read: a code that was spent and has since
 * gone past its window is still a code in two places, and reporting it as
 * merely expired would let a late replay pass without revoking anything.
 *
 * By the time this is called the caller has already proved it holds the right
 * `client_id`, `redirect_uri` and PKCE verifier. That is what makes `replayed`
 * worth revoking a grant over rather than an overreaction to a client fumbling
 * its own request.
 */
export async function consumeCode(code: string): Promise<ConsumeResult> {
  const db = getDb();
  if (!db) return 'unknown';
  const hash = sha256(code);

  const consumed = await db
    .update(oauthAuthorizationRequests)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(oauthAuthorizationRequests.codeHash, hash),
        isNull(oauthAuthorizationRequests.consumedAt),
        sql`${oauthAuthorizationRequests.codeExpiresAt} > now()`
      )
    )
    .returning();

  if (consumed.length === 1) return 'consumed';

  const [existing] = await db
    .select()
    .from(oauthAuthorizationRequests)
    .where(eq(oauthAuthorizationRequests.codeHash, hash))
    .limit(1);

  if (!existing) return 'unknown';
  if (existing.consumedAt) return 'replayed';
  return 'expired';
}

/** Housekeeping for the cron that already prunes sessions and magic links. */
export async function cleanupAuthorizationRequests(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const deleted = await db
    .delete(oauthAuthorizationRequests)
    .where(lt(oauthAuthorizationRequests.expiresAt, new Date()))
    .returning();
  return deleted.length;
}
