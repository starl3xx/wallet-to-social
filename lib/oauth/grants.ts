/**
 * A consented grant, and the credentials it hands out.
 *
 * ## The access token is an API key
 *
 * Not "is like": is. `mintAccessToken` writes an `api_keys` row whose
 * `oauth_grant_id` points here, and the token it returns is that row's key.
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
import { sha256 } from '@/lib/oauth/requests';
import { MCP_SCOPE, OFFLINE_SCOPE } from '@/lib/oauth/metadata';
import { isOurResource, sameResource } from '@/lib/oauth/params';

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
 * Live grants per account.
 *
 * Separate from the API-key cap and deliberately larger: a person plausibly
 * connects Claude on a laptop, a desktop and a phone, and each is its own
 * grant. Reaching the cap revokes the oldest rather than refusing the newest,
 * because refusing the newest presents as "connecting is broken" and the user
 * has no way to see why.
 */
const MAX_GRANTS_PER_USER = 10;

function newToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string | null;
  scope: string;
}

/**
 * Write the `api_keys` row that is this grant's access token.
 *
 * `keyPrefix` is the first twelve characters, matching what every other key
 * stores, so the dashboard's identification logic needs no special case.
 */
async function mintAccessToken(
  grant: OauthGrant
): Promise<{ token: string; expiresIn: number } | null> {
  const db = getDb();
  if (!db) return null;
  const token = newToken(ACCESS_TOKEN_PREFIX);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  const [row] = await db
    .insert(apiKeys)
    .values({
      key: hashApiKey(token),
      keyPrefix: token.slice(0, 12),
      name: grant.clientLabel,
      userId: grant.userId,
      plan: CREDIT_API_PLAN,
      expiresAt,
      oauthGrantId: grant.id,
    })
    .returning();
  if (!row) return null;
  return { token, expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
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
 * Hand out the first pair of credentials, once the code has been exchanged.
 *
 * A refresh token is issued only when `offline_access` was granted. Claude
 * appends that scope because the authorization server metadata advertises it,
 * so in practice it is always present, but a client that does not ask does not
 * get one. Honouring the scope is the difference between a scope and a label.
 *
 * The refresh hash is written with `revoked_at IS NULL` in the predicate, so a
 * grant revoked between consent and exchange (by the cap, or by the user) does
 * not quietly come back to life carrying a fresh refresh token.
 */
export async function issueInitialTokens(
  grantId: string
): Promise<IssuedTokens | null> {
  const db = getDb();
  if (!db) return null;

  const [grant] = await db
    .select()
    .from(oauthGrants)
    .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)))
    .limit(1);
  if (!grant) return null;

  const wantsRefresh = grant.scope.split(' ').includes(OFFLINE_SCOPE);
  const refreshToken = wantsRefresh ? newToken(REFRESH_TOKEN_PREFIX) : null;

  if (refreshToken) {
    const updated = await db
      .update(oauthGrants)
      .set({
        refreshTokenHash: sha256(refreshToken),
        refreshExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        lastUsedAt: new Date(),
      })
      .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)))
      .returning();
    if (updated.length !== 1) return null;
  }

  const access = await mintAccessToken(grant);
  if (!access) return null;

  return {
    accessToken: access.token,
    expiresIn: access.expiresIn,
    refreshToken,
    scope: grant.scope,
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
  const result = (await db.execute(sql`
    WITH rotated AS (
      UPDATE oauth_grants
      SET refresh_token_hash = ${input.nextHash},
          previous_refresh_token_hash = ${input.hash},
          refresh_expires_at = now() + make_interval(secs => ${refreshTtlS}),
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
 * resource for a good grant answers `invalid_target`.
 */
export async function refreshGrant(input: {
  refreshToken: string;
  clientId: string | null;
  resource: string | null;
}): Promise<RefreshResult> {
  const db = getDb();
  if (!db) return { ok: false, reason: 'invalid' };
  const hash = sha256(input.refreshToken);

  const [row] = await db
    .select()
    .from(oauthGrants)
    .where(
      sql`${oauthGrants.refreshTokenHash} = ${hash} OR ${oauthGrants.previousRefreshTokenHash} = ${hash}`
    )
    .limit(1);
  if (!row) return { ok: false, reason: 'invalid' };

  if (input.clientId !== null && input.clientId !== row.clientId) {
    return { ok: false, reason: 'wrong_client' };
  }
  if (!isOurResource(row.resource)) {
    return { ok: false, reason: 'wrong_grant_resource' };
  }
  if (input.resource !== null && !sameResource(input.resource, row.resource!)) {
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
   * concurrent refresh may have rotated in between. The semantics are the
   * ones this function always had. Presenting the previous token is read as a
   * reuse and revokes the grant; a short grace for concurrent refreshes is a
   * separate change (STA-39, PR B2).
   */
  const [reused] = await db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.previousRefreshTokenHash, hash))
    .limit(1);
  if (reused) {
    await revokeGrant(reused.id, 'refresh token reused');
    return { ok: false, reason: 'reused' };
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
  | { ok: true; scope: string }
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
  return { ok: true, scope: row.scope };
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
