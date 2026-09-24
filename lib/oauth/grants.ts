/**
 * A consented grant, and the credentials it hands out.
 *
 * ## The access token is an API key
 *
 * Not "is like": is. Both statements that issue one, `spendAndMint` (called by
 * `redeemCode`) at the code exchange and `rotateAndMint` at a refresh, write an
 * `api_keys` row whose
 * `oauth_grant_id` points here, and the token returned is that row's key.
 * Everything downstream then works with no second implementation: the three
 * rate-limit windows in `lib/rate-limiter.ts`, the credit balance check in
 * `lib/api-auth.ts`, the per-key usage ledger, the plan's batch ceiling. A
 * separate token type would have needed all of it written twice, and the
 * second copy is where the meter quietly disagrees with the first.
 *
 * The columns an access token needs were already there. `expires_at` bounds
 * its life to an hour. `revoked_at` ends it early. `oauth_grant_id` is the one
 * new column, and it is what tells a token from a key somebody made in the
 * dashboard and pasted into a config file.
 *
 * The row outlives the token, but not forever. Every refresh writes a new one,
 * so the daily cleanup (`app/api/cron/cleanup/route.ts`) deletes a token's row
 * `OAUTH_TOKEN_RETENTION_DAYS` after it stopped working, by expiry or
 * revocation, and its usage rows go with it. A dashboard key is never deleted.
 *
 * ## What that costs, stated plainly
 *
 * A token issued for the MCP server also authenticates a plain REST call to
 * `/v1/*`. It is the same credential type, so it must. That is not a hole
 * being tolerated: the eight MCP tools are the nine `/v1` endpoints, reached
 * through the same handlers, drawing on the same balance. The counts differ by
 * one only because the single and batch lookups are one tool that picks the
 * endpoint by list length. There is nothing on one surface that is not on the
 * other, so the audience separation RFC 8707 describes would separate two names
 * for one resource.
 *
 * It is written down here because the alternative is a consent screen implying
 * a boundary that no code enforces, and this repository has shipped four
 * comments that asserted a security property with nothing able to contradict
 * them. `scripts/check-invariants.ts` derives the MCP tool count from the
 * `registerTool` calls and asserts every surface that states it agrees. It
 * does not assert parity between the two surfaces, because they are not the
 * same size: the sentence above explains why the counts differ by one.
 *
 * ## The key cap
 *
 * `createApiKeyIfUnderCap` revokes keys beyond an account's cap by rank. Grant
 * keys are excluded from that ranking, in the SQL rather than by convention:
 * without the exclusion, connecting a client would push a dashboard key over
 * the cap and revoke a credential the user is actively using. Grants have
 * their own cap, below.
 */
import { randomBytes } from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiKeys, oauthGrants, type OauthGrant } from '@/db/schema';
import { hashApiKey } from '@/lib/api-keys';
import { CREDIT_API_PLAN } from '@/lib/api-plans';
import {
  sha256,
  unspentCodeReason,
  type UnspentReason,
} from '@/lib/oauth/requests';
import { MCP_SCOPE, OFFLINE_SCOPE } from '@/lib/oauth/metadata';
import { isOurResource, resourcesAreOurs } from '@/lib/oauth/params';

/**
 * The access-token prefix, distinct from `wts_live_` on purpose.
 *
 * A person reading a log, a support ticket or their own key list can tell at a
 * glance which credential they are looking at, and `validateApiKey` refuses
 * anything carrying neither prefix before it touches the database.
 */
export const ACCESS_TOKEN_PREFIX = 'wts_mcp_';
export const REFRESH_TOKEN_PREFIX = 'wts_rt_';

/** One hour. Short enough that a leaked token expires before it is noticed missing. */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Ninety days. A client that has not called in a quarter re-consents. */
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * How long after a rotation a replay of a token rotated out in the same burst
 * is held off rather than read as a reuse.
 *
 * An MCP client sends one refresh per tool call that meets an expired token,
 * and the SDK refreshes on every 401 even once another call has saved new
 * tokens, so one burst of parallel calls rotates the chain several times and
 * its slow members present tokens one, two or more steps old. They used to
 * revoke the connection (the direct predecessor) or get `invalid_grant`, which
 * makes the SDK delete the live tokens (anything older). Now every token
 * rotated out while the rotations keep coming within this window is held in
 * `refresh_grace_hashes` (the last REFRESH_GRACE_HASHES), and a replay of one
 * gets a refusal with no tokens; the connection lives on what the winners
 * received. After the window, presenting the direct predecessor revokes, as
 * OAuth 2.1 section 4.3.1 and RFC 9700 section 4.14.2 describe, and an older
 * token is unknown, as before.
 *
 * A replay inside the window is refused and not detected: a stolen token
 * gains nothing from it, and revocation needs a replay after the window while
 * that token is still the direct predecessor. Thirty seconds, Okta's default
 * grace for rotation.
 */
export const REFRESH_REUSE_GRACE_MS = 30 * 1000;

/** How many rotated-out hashes one burst keeps; a burst longer than this is not parallel calls. */
export const REFRESH_GRACE_HASHES = 10;

/**
 * Live grants per account.
 *
 * Separate from the API-key cap and deliberately larger: a person plausibly
 * connects Claude on a laptop, a desktop and a phone, and each is its own
 * grant. Reaching the cap revokes the oldest rather than refusing the newest,
 * because refusing the newest presents as "connecting is broken" and the user
 * has no way to see why.
 */
const MAX_GRANTS_PER_USER = 10;

export function newToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

/**
 * What `newToken` puts after the prefix: 32 random bytes in base64url, which
 * is 43 characters with no padding.
 */
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;

/**
 * Whether a string has the shape of a refresh token we mint, judged without
 * the database.
 *
 * The token endpoint and revocation answer anything else before any read and
 * before any limit is charged. No row can match it: every refresh token is
 * `newToken(REFRESH_TOKEN_PREFIX)`, and the format is the one the first token
 * was issued in.
 */
export function isWellFormedRefreshToken(raw: string): boolean {
  return (
    raw.startsWith(REFRESH_TOKEN_PREFIX) &&
    TOKEN_BODY.test(raw.slice(REFRESH_TOKEN_PREFIX.length))
  );
}

/** The same judgment for an access token, `newToken(ACCESS_TOKEN_PREFIX)`. */
export function isWellFormedAccessToken(raw: string): boolean {
  return (
    raw.startsWith(ACCESS_TOKEN_PREFIX) &&
    TOKEN_BODY.test(raw.slice(ACCESS_TOKEN_PREFIX.length))
  );
}

/**
 * The grants a presented refresh token names: by the token a grant holds now,
 * by the one that token replaced, or by any rotated out in the latest burst
 * (REFRESH_REUSE_GRACE_MS). One predicate, so `refreshGrant` and
 * `grantIdForRefreshToken` cannot come to disagree about whose token it is.
 */
function matchesRefreshHash(hash: string) {
  return sql`${oauthGrants.refreshTokenHash} = ${hash} OR ${oauthGrants.previousRefreshTokenHash} = ${hash} OR ${oauthGrants.refreshGraceHashes} @> ARRAY[${hash}]::text[]`;
}

/**
 * The grant a refresh token belongs to, or null, found exactly as
 * `refreshGrant` finds it and without judging it: a revoked, expired or
 * rotated-out token still names its grant.
 *
 * The token endpoint counts a refresh against the connection it names before
 * `refreshGrant` decides anything, and revocation ends the grant it names.
 * Reads only.
 */
export async function grantIdForRefreshToken(
  raw: string
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(matchesRefreshHash(sha256(raw)))
    .limit(1);
  return row?.id ?? null;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string | null;
  scope: string;
}

/**
 * Retire every access token this grant has issued.
 *
 * Called before minting a replacement and on revocation, so a grant never has
 * two live access tokens. The alternative, letting the old one run out its
 * hour, means a refresh does not actually retire the credential it replaced,
 * which is the whole reason a client refreshes after a suspected leak.
 */
async function revokeAccessTokens(grantId: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(apiKeys)
    .set({ isActive: false, revokedAt: new Date() })
    .where(and(eq(apiKeys.oauthGrantId, grantId), isNull(apiKeys.revokedAt)));
}

/**
 * Record a consent. No credentials yet.
 *
 * The grant exists from the moment the user approves, before the code is
 * exchanged, and the ordering is load-bearing rather than incidental. A
 * replayed authorization code has to be answered by revoking everything that
 * code produced, and the only way to know what it produced is for the grant id
 * to already be on the code's row. Creating the grant at exchange time instead
 * leaves a window where a replay arrives before the id is stamped, and the
 * revoke has nothing to name.
 *
 * The cost is a grant row for a consent whose client never came back for its
 * code. It holds no refresh token, because nothing has been handed out yet, and
 * it ages out through the grant cap.
 */
export async function createGrant(input: {
  userId: string;
  clientId: string;
  clientLabel: string;
  scope: string;
  resource: string | null;
}): Promise<OauthGrant | null> {
  const db = getDb();
  if (!db) return null;

  const [grant] = await db
    .insert(oauthGrants)
    .values({
      userId: input.userId,
      clientId: input.clientId,
      clientLabel: input.clientLabel,
      scope: input.scope,
      resource: input.resource,
    })
    .returning();
  return grant ?? null;
}

/**
 * Bring an account back under the grant cap.
 *
 * Called after a code has been issued, never inside `createGrant`. Pruning at
 * creation time meant a consent that lost its race, two Approve clicks where
 * only one can win, still counted: the spare grant existed for the moment it
 * took to discover it had no code, and pruning ran in that moment, so an
 * approval nobody completed could revoke a connection somebody was using.
 * Ranking after the winner is known cannot do that.
 */
export async function enforceGrantCap(userId: string): Promise<void> {
  await pruneGrants(userId);
}

/**
 * Spend a code and issue its first credentials in ONE statement.
 *
 * They used to be three: spend the code, write the refresh hash, mint the
 * access token. On neon-http each is its own transaction, so a failure after
 * the spend left a code that was used up with nothing to show for it, and the
 * client's retry was read as a replay and revoked the connection it was
 * trying to make. One data-modifying statement is atomic: a failed mint
 * leaves the code unspent. The same shape as `rotateAndMint` below.
 *
 * The spend is conditional (`consumed_at IS NULL`, `code_expires_at > now()`),
 * so two exchanges racing produce exactly one winner. The grant update carries
 * `revoked_at IS NULL`, so a grant revoked between consent and exchange (by
 * the cap, or by the user) does not come back to life; the LEFT JOIN still
 * reports that code as spent, which is what tells it apart from a replay.
 *
 * A refresh token is written only when the grant's own scope holds
 * `offline_access`, and `refreshed` says whether it was. Times come from
 * Postgres, never a JS Date parameter, and the aliases are snake_case.
 */
async function spendAndMint(input: {
  codeHash: string;
  refreshHash: string;
  accessHash: string;
  accessPrefix: string;
}): Promise<{
  grant_id: string | null;
  scope: string | null;
  refreshed: boolean | null;
  minted_id: string | null;
} | null> {
  const db = getDb();
  if (!db) return null;
  const refreshTtlS = Math.floor(REFRESH_TOKEN_TTL_MS / 1000);
  const accessTtlS = Math.floor(ACCESS_TOKEN_TTL_MS / 1000);
  const result = (await db.execute(sql`
    WITH consumed AS (
      UPDATE oauth_authorization_requests
      SET consumed_at = now()
      WHERE code_hash = ${input.codeHash}
        AND consumed_at IS NULL
        AND code_expires_at > now()
      RETURNING grant_id
    ),
    granted AS (
      UPDATE oauth_grants
      SET refresh_token_hash = CASE
            WHEN ${OFFLINE_SCOPE} = ANY (string_to_array(scope, ' '))
            THEN ${input.refreshHash} ELSE refresh_token_hash END,
          refresh_expires_at = CASE
            WHEN ${OFFLINE_SCOPE} = ANY (string_to_array(scope, ' '))
            THEN now() + make_interval(secs => ${refreshTtlS})
            ELSE refresh_expires_at END,
          last_used_at = now()
      WHERE id IN (SELECT grant_id FROM consumed) AND revoked_at IS NULL
      RETURNING id, user_id, client_label, scope,
        ${OFFLINE_SCOPE} = ANY (string_to_array(scope, ' ')) AS refreshed
    ),
    minted AS (
      INSERT INTO api_keys (key, key_prefix, name, user_id, plan, expires_at, oauth_grant_id)
      SELECT ${input.accessHash}, ${input.accessPrefix}, client_label, user_id,
             ${CREDIT_API_PLAN}, now() + make_interval(secs => ${accessTtlS}), id
      FROM granted
      RETURNING id
    )
    SELECT g.id AS grant_id, g.scope, g.refreshed,
           (SELECT id FROM minted) AS minted_id
    FROM consumed c LEFT JOIN granted g ON g.id = c.grant_id
  `)) as unknown as {
    rows: Array<{
      grant_id: string | null;
      scope: string | null;
      refreshed: boolean | null;
      minted_id: string | null;
    }>;
  };
  return result.rows[0] ?? null;
}

/**
 * What exchanging a code came to. `inactive` is a code that was spent on a
 * grant revoked since consent; the other refusals are `unspentCodeReason`'s.
 */
export type RedeemResult =
  | { outcome: 'issued'; tokens: IssuedTokens }
  | { outcome: UnspentReason | 'inactive' };

/**
 * Exchange a code for its first credentials, once.
 *
 * By the time this is called the caller has proved it holds the right
 * `client_id`, `redirect_uri` and PKCE verifier. When nothing was spent, the
 * row is read back to say why, and only `replayed` justifies revoking.
 *
 * A refresh token is issued only when `offline_access` was granted. Claude
 * appends that scope because the authorization server metadata advertises it,
 * so in practice it is always present, but a client that does not ask does not
 * get one. Honoring the scope is the difference between a scope and a label.
 */
export async function redeemCode(code: string): Promise<RedeemResult> {
  const refreshToken = newToken(REFRESH_TOKEN_PREFIX);
  const access = newToken(ACCESS_TOKEN_PREFIX);
  const spent = await spendAndMint({
    codeHash: sha256(code),
    refreshHash: sha256(refreshToken),
    accessHash: hashApiKey(access),
    accessPrefix: access.slice(0, 12),
  });

  if (!spent) return { outcome: await unspentCodeReason(code) };
  if (!spent.grant_id) return { outcome: 'inactive' };
  if (!spent.minted_id) throw new Error('code exchange minted no access token');
  return {
    outcome: 'issued',
    tokens: {
      accessToken: access,
      expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refreshToken: spent.refreshed ? refreshToken : null,
      scope: spent.scope!,
    },
  };
}

/**
 * Keep an account under the grant cap by revoking its oldest live grants.
 *
 * Ranked by `(created_at, id)` and self-healing in the same shape as the API
 * key cap, for the same reason: a count-then-delete races, and this converges
 * however the inserts interleave.
 */
async function pruneGrants(userId: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const excess = (await db.execute(sql`
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY created_at DESC, id DESC) AS rn
      FROM oauth_grants
      WHERE user_id = ${userId} AND revoked_at IS NULL
    )
    UPDATE oauth_grants
    SET revoked_at = now(), revoked_reason = 'grant limit reached'
    WHERE id IN (SELECT id FROM ranked WHERE rn > ${MAX_GRANTS_PER_USER})
    RETURNING id
  `)) as unknown as { rows: Array<{ id: string }> };

  for (const row of excess.rows) {
    await revokeAccessTokens(row.id);
  }
}

export type RefreshResult =
  | { ok: true; tokens: IssuedTokens }
  | {
      ok: false;
      reason:
        | 'invalid'
        | 'expired'
        | 'reused'
        | 'just_rotated'
        | 'wrong_client'
        | 'wrong_grant_resource'
        | 'wrong_resource';
    };

/**
 * Rotate a refresh token and mint its access token in ONE statement.
 *
 * They used to be three: rotate the hash, retire the old access tokens, mint
 * the new one. On neon-http each is its own transaction, so a mint that failed
 * after the rotation committed left the client holding a refresh token that
 * was now the "previous" one, and its retry was read as a reuse and revoked
 * the whole connection. One data-modifying statement is atomic: a failed mint
 * rolls the rotation back. Its sub-statements share one snapshot, so
 * `retired` cannot see the row `minted` inserts. The same shape as
 * `revokeAllAndReissueKey` in lib/api-keys.ts.
 *
 * Times come from Postgres (`now()` plus numeric seconds), never a JS Date
 * parameter, and the aliases are snake_case so none needs quoting.
 */
async function rotateAndMint(input: {
  hash: string;
  nextHash: string;
  clientId: string | null;
  accessHash: string;
  accessPrefix: string;
}): Promise<{
  grant_id: string;
  scope: string;
  minted_id: string | null;
} | null> {
  const db = getDb();
  if (!db) return null;
  const refreshTtlS = Math.floor(REFRESH_TOKEN_TTL_MS / 1000);
  const accessTtlS = Math.floor(ACCESS_TOKEN_TTL_MS / 1000);
  const graceS = Math.floor(REFRESH_REUSE_GRACE_MS / 1000);
  const result = (await db.execute(sql`
    WITH rotated AS (
      UPDATE oauth_grants
      SET refresh_token_hash = ${input.nextHash},
          previous_refresh_token_hash = ${input.hash},
          refresh_expires_at = now() + make_interval(secs => ${refreshTtlS}),
          refresh_rotated_at = now(),
          refresh_grace_hashes = CASE
            WHEN refresh_rotated_at > now() - make_interval(secs => ${graceS})
            THEN (coalesce(refresh_grace_hashes, ARRAY[]::text[]))[greatest(cardinality(refresh_grace_hashes) - ${REFRESH_GRACE_HASHES - 2}, 1):] || ${input.hash}::text
            ELSE ARRAY[${input.hash}::text]
          END,
          last_used_at = now()
      WHERE refresh_token_hash = ${input.hash}
        AND revoked_at IS NULL
        AND refresh_expires_at > now()
        AND (${input.clientId}::text IS NULL OR client_id = ${input.clientId})
      RETURNING id, user_id, client_label, scope
    ),
    retired AS (
      UPDATE api_keys
      SET is_active = false, revoked_at = now()
      WHERE oauth_grant_id IN (SELECT id FROM rotated) AND revoked_at IS NULL
    ),
    minted AS (
      INSERT INTO api_keys (key, key_prefix, name, user_id, plan, expires_at, oauth_grant_id)
      SELECT ${input.accessHash}, ${input.accessPrefix}, client_label, user_id,
             ${CREDIT_API_PLAN}, now() + make_interval(secs => ${accessTtlS}), id
      FROM rotated
      RETURNING id
    )
    SELECT r.id AS grant_id, r.scope, (SELECT id FROM minted) AS minted_id
    FROM rotated r
  `)) as unknown as {
    rows: Array<{ grant_id: string; scope: string; minted_id: string | null }>;
  };
  return result.rows[0] ?? null;
}

/**
 * Exchange a refresh token for a new pair, rotating the refresh token.
 *
 * OAuth 2.1 requires rotation for public clients, and every client here is
 * public. Rotation on its own is only half of it: the value it replaced is
 * kept in `previous_refresh_token_hash`, and presenting *that* is proof of a
 * leak, because the legitimate client already exchanged it and holds the
 * successor. That case revokes the grant rather than returning an error, which
 * is what the specification asks for and is the only reason to keep the column.
 * Except within REFRESH_REUSE_GRACE_MS of the rotation, when it is refused
 * without revoking: see that constant.
 *
 * ## Bindings, checked before anything is spent or revoked
 *
 * A refresh token belongs to one client and one resource (OAuth 2.1 section
 * 4.3.1; RFC 9700 section 4.14.2). A `client_id` that disagrees is refused
 * without revoking: whoever holds the token could send the right id anyway,
 * so revoking adds no protection and would let a probe end a live connection.
 * An absent `client_id` is accepted (OAuth 2.1 section 3.2.2 makes it
 * optional for this request). A grant made for some other server answers
 * `invalid_grant`, so the client starts over; a request naming a different
 * resource for a good grant, in any one of its values, answers
 * `invalid_target`.
 */
export async function refreshGrant(input: {
  refreshToken: string;
  clientId: string | null;
  resources: string[];
}): Promise<RefreshResult> {
  const db = getDb();
  if (!db) return { ok: false, reason: 'invalid' };
  const hash = sha256(input.refreshToken);

  const [row] = await db
    .select()
    .from(oauthGrants)
    .where(matchesRefreshHash(hash))
    .limit(1);
  if (!row) return { ok: false, reason: 'invalid' };

  if (input.clientId !== null && input.clientId !== row.clientId) {
    return { ok: false, reason: 'wrong_client' };
  }
  if (!isOurResource(row.resource)) {
    return { ok: false, reason: 'wrong_grant_resource' };
  }
  if (!resourcesAreOurs(input.resources, row.resource!)) {
    return { ok: false, reason: 'wrong_resource' };
  }

  const next = newToken(REFRESH_TOKEN_PREFIX);
  const access = newToken(ACCESS_TOKEN_PREFIX);
  const rotated = await rotateAndMint({
    hash,
    nextHash: sha256(next),
    clientId: input.clientId,
    accessHash: hashApiKey(access),
    accessPrefix: access.slice(0, 12),
  });

  if (rotated) {
    if (!rotated.minted_id) throw new Error('refresh minted no access token');
    return {
      ok: true,
      tokens: {
        accessToken: access,
        expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        refreshToken: next,
        scope: rotated.scope,
      },
    };
  }

  /**
   * Nothing rotated. Classified from a FRESH read, not the pre-read above: a
   * concurrent refresh may have rotated in between. A token rotated out in the
   * current burst, while the last rotation is moments ago
   * (REFRESH_REUSE_GRACE_MS, judged by Postgres) on a live grant, is a
   * parallel refresh: refused without tokens and without a revoke. After the
   * window the direct predecessor revokes the grant, and an older token of the
   * burst is unknown, as it always was. A grant rotated before
   * `refresh_rotated_at` existed has NULL there, which is never recent.
   */
  const graceS = Math.floor(REFRESH_REUSE_GRACE_MS / 1000);
  const [reused] = await db
    .select({
      id: oauthGrants.id,
      revokedAt: oauthGrants.revokedAt,
      rotatedJustNow: sql<boolean>`${oauthGrants.refreshRotatedAt} > now() - make_interval(secs => ${graceS})`,
      direct: sql<boolean>`${oauthGrants.previousRefreshTokenHash} = ${hash}`,
    })
    .from(oauthGrants)
    .where(
      sql`${oauthGrants.previousRefreshTokenHash} = ${hash} OR ${oauthGrants.refreshGraceHashes} @> ARRAY[${hash}]::text[]`
    )
    .limit(1);
  if (reused) {
    if (reused.rotatedJustNow === true && !reused.revokedAt) {
      console.log(`[oauth] refresh held off within grace, grant ${reused.id}`);
      return { ok: false, reason: 'just_rotated' };
    }
    if (reused.direct === true) {
      await revokeGrant(reused.id, 'refresh token reused');
      return { ok: false, reason: 'reused' };
    }
  }
  const [stale] = await db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.refreshTokenHash, hash))
    .limit(1);
  if (stale) return { ok: false, reason: 'expired' };
  return { ok: false, reason: 'invalid' };
}

export async function revokeGrant(
  grantId: string,
  reason: string
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(oauthGrants)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)));
  await revokeAccessTokens(grantId);
}

/** Whether a bearer string is one of our OAuth access tokens by shape alone. */
export function looksLikeAccessToken(raw: string): boolean {
  return raw.startsWith(ACCESS_TOKEN_PREFIX);
}

export type AccessTokenCheck =
  | { ok: true; scope: string; userId: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'audience' };

/**
 * Validate an OAuth access token, at the MCP boundary, before the MCP layer
 * sees the request.
 *
 * It has to happen here rather than inside the tool handlers. A tool handler's
 * return value is already destined for an HTTP 200, and a 200 wrapping an error
 * is read by a client as a tool that failed, not as a token that needs
 * refreshing: the connection then stays broken until somebody reconnects it by
 * hand. Only a transport-level 401 makes a client refresh and retry.
 *
 * One query, joining the grant. Both halves are load-bearing:
 *
 *   - the key row carries `expires_at`, which is what makes an access token
 *     expire an hour after it was minted
 *   - the grant carries `revoked_at`, which is what makes disconnecting
 *     immediate rather than eventually
 *
 * Checking only the key would mean a revoke that failed to update the key row
 * left a working token behind, and checking only the grant would mean an
 * expired token kept working until somebody revoked it.
 */
export async function validateAccessToken(
  raw: string
): Promise<AccessTokenCheck> {
  const db = getDb();
  if (!db) return { ok: false, reason: 'unknown' };

  const [row] = await db
    .select({
      keyRevokedAt: apiKeys.revokedAt,
      keyActive: apiKeys.isActive,
      keyExpiresAt: apiKeys.expiresAt,
      grantRevokedAt: oauthGrants.revokedAt,
      scope: oauthGrants.scope,
      resource: oauthGrants.resource,
      // The account, so the MCP route can bound its discovery traffic per
      // account rather than per the shared address hosted clients call from.
      userId: apiKeys.userId,
    })
    .from(apiKeys)
    .innerJoin(oauthGrants, eq(apiKeys.oauthGrantId, oauthGrants.id))
    .where(eq(apiKeys.key, hashApiKey(raw)))
    .limit(1);

  if (!row) return { ok: false, reason: 'unknown' };
  if (row.grantRevokedAt || row.keyRevokedAt || !row.keyActive) {
    return { ok: false, reason: 'revoked' };
  }
  if (row.keyExpiresAt && row.keyExpiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  // The MCP authorization spec: a server MUST validate that an access token
  // was issued for it. A grant made for another deployment's resource is not
  // a token for this one.
  if (!isOurResource(row.resource)) {
    return { ok: false, reason: 'audience' };
  }
  return { ok: true, scope: row.scope, userId: row.userId };
}

export async function listGrants(userId: string): Promise<OauthGrant[]> {
  const db = getDb();
  if (!db) return [];
  return db
    .select()
    .from(oauthGrants)
    .where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)))
    .orderBy(oauthGrants.createdAt);
}

/** The scope every grant carries, so the consent screen and the token agree. */
export const GRANTABLE_SCOPES = [MCP_SCOPE, OFFLINE_SCOPE];
