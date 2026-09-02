import { createHash, randomBytes } from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiKeys, apiPlans, type ApiKey, type ApiPlan } from '@/db/schema';
import { API_PLANS } from '@/lib/api-plans';

// Key format: wts_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (32 random chars)
const KEY_PREFIX = 'wts_live_';

/**
 * The other prefix this function accepts.
 *
 * An OAuth access token for the MCP server is an `api_keys` row, so it arrives
 * here and must pass the format check. It is a separate prefix rather than a
 * `wts_live_` key so that a log line, a support ticket or a key list says which
 * kind of credential it is without a database read.
 *
 * Written out rather than imported from `lib/oauth/grants.ts`: that module
 * imports `hashApiKey` from here, and a cycle between the credential format and
 * the credential mint is the kind of thing that resolves to `undefined` at run
 * time and turns this check into `rawKey.startsWith(undefined)`.
 * `scripts/check-invariants.ts` asserts the two constants agree.
 */
const OAUTH_KEY_PREFIX = 'wts_mcp_';

export const ACCEPTED_KEY_PREFIXES = [KEY_PREFIX, OAUTH_KEY_PREFIX];
const KEY_LENGTH = 32;

/**
 * Generates a cryptographically secure API key
 * Returns both the raw key (to show user once) and the hash (to store)
 */
export function generateApiKey(): {
  rawKey: string;
  hashedKey: string;
  prefix: string;
} {
  const randomPart = randomBytes(KEY_LENGTH)
    .toString('base64url')
    .slice(0, KEY_LENGTH);
  const rawKey = `${KEY_PREFIX}${randomPart}`;
  const hashedKey = hashApiKey(rawKey);
  const prefix = rawKey.slice(0, 12); // 'wts_live_xxx' for identification

  return { rawKey, hashedKey, prefix };
}

/**
 * Hashes an API key using SHA-256
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Creates a new API key for a user
 */
export async function createApiKey(
  userId: string,
  name: string,
  planId: string
): Promise<{ key: ApiKey; rawKey: string } | null> {
  const db = getDb();
  if (!db) return null;

  const { rawKey, hashedKey, prefix } = generateApiKey();

  const [key] = await db
    .insert(apiKeys)
    .values({
      key: hashedKey,
      keyPrefix: prefix,
      name,
      userId,
      plan: planId,
    })
    .returning();

  return { key, rawKey };
}

/**
 * Create a key only if the account is under its active-key cap, correct under
 * concurrency.
 *
 * A count-then-insert races, and so does a single statement that both counts
 * and inserts: under READ COMMITTED each concurrent statement's count snapshot
 * predates the others' inserts, so a `FOR UPDATE` lock serializes the writes
 * but every statement still sees the pre-insert total. Verified empirically —
 * a 20-way burst overshot a cap of 3 to 14. The neon-http driver has no
 * interactive transactions, so we can't lock-then-conditionally-insert either.
 *
 * Instead: insert unconditionally, then self-heal. Rank this key among the
 * account's currently-active keys by the fixed `(created_at, id)` order and
 * revoke it if its rank exceeds the cap. This converges to exactly `cap`
 * survivors no matter how the inserts interleave: the lowest-`cap` keys always
 * see rank ≤ cap (nothing ordered before them ever revokes), and every excess
 * key always sees rank ≥ cap+1 (the cap survivors are always counted ahead of
 * it), so it revokes itself. Stale snapshots only ever inflate the count-ahead,
 * which can never make an excess key wrongly survive.
 *
 * Returns { capReached: true } when this key was over the cap and revoked.
 */
export async function createApiKeyIfUnderCap(
  userId: string,
  name: string,
  planId: string,
  maxActiveKeys: number
): Promise<{ key: ApiKey; rawKey: string } | { capReached: true } | null> {
  const db = getDb();
  if (!db) return null;

  const { rawKey, hashedKey, prefix } = generateApiKey();

  // 1. Insert unconditionally.
  const [key] = await db
    .insert(apiKeys)
    .values({ key: hashedKey, keyPrefix: prefix, name, userId, plan: planId })
    .returning();
  if (!key) return null;

  // 2. Self-heal: revoke this key if it is beyond the cap by rank order.
  //
  // `oauth_grant_id IS NULL` excludes OAuth access tokens from the ranking,
  // and it is not tidiness. Without it, connecting Claude mints a grant key,
  // that key counts toward this cap, and the next dashboard key the user makes
  // ranks past the cap and revokes itself. Worse the other way round: a user at
  // the cap who connects a client has an access token minted that outranks
  // nothing, while their own keys stay put, so the count is wrong in whichever
  // direction happens to hurt. Grants are capped separately, in
  // `lib/oauth/grants.ts`, because they are a different thing being limited for
  // a different reason.
  const healed = (await db.execute(sql`
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
      FROM api_keys
      WHERE user_id = ${userId} AND is_active = true AND revoked_at IS NULL
        AND oauth_grant_id IS NULL
    )
    UPDATE api_keys
    SET is_active = false, revoked_at = now()
    WHERE id = ${key.id}
      AND (SELECT rn FROM ranked WHERE ranked.id = ${key.id}) > ${maxActiveKeys}
    RETURNING id
  `)) as unknown as { rows: Array<{ id: string }> };

  if (healed.rows.length > 0) {
    return { capReached: true };
  }

  return { key, rawKey };
}

/**
 * Validates an API key and returns the key record with plan details
 * Returns null if key is invalid, inactive, or expired
 */
export async function validateApiKey(
  rawKey: string
): Promise<{ key: ApiKey; plan: ApiPlan } | null> {
  const db = getDb();
  if (!db) return null;

  // Quick format check
  if (!ACCEPTED_KEY_PREFIXES.some((prefix) => rawKey.startsWith(prefix))) {
    return null;
  }

  const hashedKey = hashApiKey(rawKey);

  const result = await db
    .select({
      key: apiKeys,
      plan: apiPlans,
    })
    .from(apiKeys)
    .innerJoin(apiPlans, eq(apiKeys.plan, apiPlans.id))
    .where(eq(apiKeys.key, hashedKey))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const { key, plan } = result[0];

  // Check if key is active
  if (!key.isActive) {
    return null;
  }

  // Check if key has been revoked
  if (key.revokedAt) {
    return null;
  }

  // Check if key has expired
  if (key.expiresAt && key.expiresAt < new Date()) {
    return null;
  }

  // Update last used timestamp (fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(console.error);

  return { key, plan };
}

/**
 * Revokes an API key
 */
export async function revokeApiKey(
  keyId: string,
  userId: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const result = await db
    .update(apiKeys)
    .set({
      isActive: false,
      revokedAt: new Date(),
    })
    .where(eq(apiKeys.id, keyId))
    .returning();

  // Verify the key belonged to the user
  if (result.length === 0 || result[0].userId !== userId) {
    return false;
  }

  return true;
}

/**
 * Rotates an API key: revokes the old one and issues a replacement.
 *
 * ## Why this does not check the cap, and why that is only safe now
 *
 * Rotation is count-neutral: it retires exactly one active key and issues
 * exactly one. That holds ONLY while the three filters below hold, and every
 * one of them was missing.
 *
 * The select matched on `id` alone, and the revoke was unconditional. So
 * rotating an already-revoked key retired nothing and created a live key, and
 * the insert never went through `createApiKeyIfUnderCap`. Revoke once, then
 * POST the same dead id N times, and an account holds N+1 active keys against
 * a cap of 10. The cap was decoration.
 *
 * Worse, `oauth_grant_id` was not excluded. An OAuth access token lives an hour
 * and is capped separately in `lib/oauth/grants.ts`; the replacement row
 * carries no `oauth_grant_id`, so rotating a grant laundered a one-hour token
 * into a permanent dashboard credential. `listApiKeys` has always hidden grant
 * rows, which is why this was not visible from the dashboard, and
 * `/api/developer/usage` handed the id over anyway.
 *
 * The revoke is conditional on the row still being active and returns the
 * rows it touched. Two concurrent rotations of one key therefore produce one
 * replacement, not two: the loser updates nothing and returns null rather than
 * inserting.
 */
export async function rotateApiKey(
  keyId: string,
  userId: string
): Promise<{ key: ApiKey; rawKey: string } | null> {
  const db = getDb();
  if (!db) return null;

  // Ownership is in the WHERE clause, not a comparison after the fact: a filter
  // the database applies cannot be skipped by an early return being edited.
  const [existingKey] = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.id, keyId),
        eq(apiKeys.userId, userId),
        eq(apiKeys.isActive, true),
        isNull(apiKeys.revokedAt),
        isNull(apiKeys.oauthGrantId)
      )
    )
    .limit(1);

  if (!existingKey) {
    return null;
  }

  // Conditional, and the returned rows are the interlock. If another request
  // rotated or revoked this key first, nothing is updated and no key is minted.
  const retired = await db
    .update(apiKeys)
    .set({
      isActive: false,
      revokedAt: new Date(),
    })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.isActive, true)))
    .returning();

  if (retired.length === 0) {
    return null;
  }

  // Create new key with same settings
  const { rawKey, hashedKey, prefix } = generateApiKey();

  const [newKey] = await db
    .insert(apiKeys)
    .values({
      key: hashedKey,
      keyPrefix: prefix,
      name: existingKey.name,
      userId: existingKey.userId,
      plan: existingKey.plan,
      rateLimit: existingKey.rateLimit,
      dailyLimit: existingKey.dailyLimit,
      monthlyLimit: existingKey.monthlyLimit,
    })
    .returning();

  return { key: newKey, rawKey };
}

/**
 * Revoke every active key an account holds and issue one fresh key, as one
 * atomic statement.
 *
 * ## Who this is for
 *
 * An x402 wallet account at the key cap. Recovery mints a key only under the
 * cap, and revoking a key takes an email session this account can never have:
 * its synthetic address receives no email. That was a deadlock (tier B, item
 * 13 of docs/AGENT-SYSTEM.md): three lost keys locked the account's credits
 * away forever. Wallet-signature control is exactly the proof revocation
 * needs, so the recovery route calls this when the signer asks for
 * `revoke_others_and_reissue`.
 *
 * ## One statement, deliberately
 *
 * The revoke and the mint travel in a single SQL statement (a data-modifying
 * CTE), so they commit or fail together: there is no window where the
 * account's keys are revoked and no replacement exists. The neon-http driver
 * has no interactive transactions (see createApiKeyIfUnderCap above), and one
 * statement needs none.
 *
 * OAuth access tokens (`oauth_grant_id` set) are left alone: they are capped
 * and revoked as grants in `lib/oauth/grants.ts`, they never count toward the
 * key cap, and sweeping them here would kill a person's connected client as a
 * side effect of an agent's key rotation.
 *
 * Returns the revoked prefixes so the caller can be told exactly which keys
 * stopped working. `scripts/check-invariants.ts` asserts the callers and the
 * scoping of this function; change it and run the guard.
 */
export async function revokeAllAndReissueKey(
  userId: string,
  name: string,
  planId: string
): Promise<{
  rawKey: string;
  keyPrefix: string;
  revokedPrefixes: string[];
} | null> {
  const db = getDb();
  if (!db) return null;

  const { rawKey, hashedKey, prefix } = generateApiKey();

  const result = (await db.execute(sql`
    WITH revoked AS (
      UPDATE api_keys
      SET is_active = false, revoked_at = now()
      WHERE user_id = ${userId} AND is_active = true AND revoked_at IS NULL AND oauth_grant_id IS NULL
      RETURNING key_prefix
    ), minted AS (
      INSERT INTO api_keys (key, key_prefix, name, user_id, plan)
      VALUES (${hashedKey}, ${prefix}, ${name}, ${userId}, ${planId})
      RETURNING id
    )
    SELECT
      (SELECT COALESCE(array_agg(key_prefix), '{}'::text[]) FROM revoked) AS revoked_prefixes,
      (SELECT id FROM minted) AS minted_id
  `)) as unknown as {
    rows: Array<{ revoked_prefixes: string[]; minted_id: string }>;
  };

  const row = result.rows[0];
  if (!row?.minted_id) return null;

  return { rawKey, keyPrefix: prefix, revokedPrefixes: row.revoked_prefixes };
}

/**
 * Lists the API keys a user made, without exposing the hash.
 *
 * OAuth access tokens are excluded. They are `api_keys` rows, but they are not
 * keys anyone created or can copy: they last an hour, they rotate on refresh,
 * and revoking one from a key list would only cause the client to mint another
 * on its next refresh, which reads as a revoke button that does not work. The
 * thing a person wants to revoke is the grant, and that is listed and revoked
 * as a connected application.
 */
export async function listApiKeys(userId: string): Promise<ApiKey[]> {
  const db = getDb();
  if (!db) return [];

  return db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.oauthGrantId)))
    .orderBy(apiKeys.createdAt);
}

/**
 * Seeds the default API plans (run once on setup)
 */
export async function seedApiPlans(): Promise<void> {
  const db = getDb();
  if (!db) return;

  // Definitions live in lib/api-plans.ts so the seed, the tier mapping and the
  // pricing copy cannot drift apart.
  const plans = Object.values(API_PLANS);

  for (const plan of plans) {
    await db
      .insert(apiPlans)
      .values(plan)
      .onConflictDoUpdate({
        target: apiPlans.id,
        set: {
          name: plan.name,
          priceMonthly: plan.priceMonthly,
          requestsPerMinute: plan.requestsPerMinute,
          requestsPerDay: plan.requestsPerDay,
          requestsPerMonth: plan.requestsPerMonth,
          maxBatchSize: plan.maxBatchSize,
        },
      });
  }
}

/**
 * Gets all available API plans
 */
export async function getApiPlans(): Promise<ApiPlan[]> {
  const db = getDb();
  if (!db) return [];

  return db.select().from(apiPlans).orderBy(apiPlans.priceMonthly);
}
