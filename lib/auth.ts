import { getDb } from '@/db';
import { authSessions, magicLinkTokens, users } from '@/db/schema';
import { eq, and, isNull, lt, gt } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { ACQUISITION_MAX_LENGTH } from '@/lib/first-touch';

// Session duration: 30 days
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// Magic link duration: 15 minutes
const MAGIC_LINK_DURATION_MS = 15 * 60 * 1000;

/**
 * The same two durations in the units a person reads, exported because
 * `app/privacy/page.tsx` states both and a number written twice drifts.
 *
 * They are genuinely different things and the policy says so: a sign-in link
 * *works* for fifteen minutes, and the row recording it is *deleted* a day
 * later by `app/api/cron/cleanup/route.ts`. Conflating the two would tell a
 * reader their link lasts a day.
 */
export const SESSION_DURATION_DAYS = SESSION_DURATION_MS / 86_400_000;
export const MAGIC_LINK_DURATION_MINUTES = MAGIC_LINK_DURATION_MS / 60_000;
/** What `cleanupExpiredAuth` below uses as its magic-link cutoff. */
export const MAGIC_LINK_RETENTION_HOURS = 24;

// Rate limit: 5 requests per email per hour
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

/**
 * Hash a token using SHA-256
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a cryptographically secure random token
 */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate a magic link token for an email
 * Returns the raw token (to be sent in email) and stores hash in DB
 */
export async function generateMagicLinkToken(
  email: string,
  acquisition?: string | null
): Promise<{ token: string } | { error: string }> {
  const db = getDb();
  if (!db) {
    return { error: 'Database not configured' };
  }

  const normalizedEmail = email.toLowerCase();

  try {
    // Check rate limit: count recent tokens for this email
    const oneHourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentTokens = await db
      .select()
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.email, normalizedEmail),
          gt(magicLinkTokens.createdAt, oneHourAgo)
        )
      );

    if (recentTokens.length >= RATE_LIMIT_MAX_REQUESTS) {
      return { error: 'Too many sign-in attempts. Please try again later.' };
    }

    // Generate token and hash
    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_DURATION_MS);

    // Store in database
    await db.insert(magicLinkTokens).values({
      email: normalizedEmail,
      tokenHash,
      expiresAt,
      // Clamped here as well as at the caller. This is the last point before
      // it becomes a row, and a length bound at the boundary is worth more
      // than one further up that a second caller can skip.
      acquisition: acquisition
        ? acquisition.slice(0, ACQUISITION_MAX_LENGTH)
        : null,
    });

    return { token };
  } catch (error) {
    console.error('Error generating magic link token:', error);
    return { error: 'Failed to generate sign-in link' };
  }
}

/**
 * Verify a magic link token
 * Returns the email if valid, marks token as used
 */
export async function verifyMagicLinkToken(
  token: string
): Promise<{ email: string; acquisition: string | null } | { error: string }> {
  const db = getDb();
  if (!db) {
    return { error: 'Database not configured' };
  }

  const tokenHash = hashToken(token);

  try {
    // Find token that matches, not used, not expired
    const [tokenRecord] = await db
      .select()
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.tokenHash, tokenHash),
          isNull(magicLinkTokens.usedAt),
          gt(magicLinkTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!tokenRecord) {
      return { error: 'Invalid or expired sign-in link' };
    }

    // Mark token as used immediately
    await db
      .update(magicLinkTokens)
      .set({ usedAt: new Date() })
      .where(eq(magicLinkTokens.id, tokenRecord.id));

    return {
      email: tokenRecord.email,
      acquisition: tokenRecord.acquisition ?? null,
    };
  } catch (error) {
    console.error('Error verifying magic link token:', error);
    return { error: 'Failed to verify sign-in link' };
  }
}

/**
 * Create a session for a user
 * Returns the raw session token (to be stored in cookie)
 */
export async function createSession(
  userId: string,
  userAgent?: string
): Promise<{ token: string } | { error: string }> {
  const db = getDb();
  if (!db) {
    return { error: 'Database not configured' };
  }

  try {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await db.insert(authSessions).values({
      userId,
      tokenHash,
      expiresAt,
      userAgent,
    });

    return { token };
  } catch (error) {
    console.error('Error creating session:', error);
    return { error: 'Failed to create session' };
  }
}

/**
 * Validate a session token
 * Returns the user if valid
 */
export async function validateSession(
  token: string
): Promise<
  { user: { id: string; email: string; tier: string } } | { user: null }
> {
  const db = getDb();
  if (!db) {
    return { user: null };
  }

  const tokenHash = hashToken(token);

  try {
    // Find valid session with user data
    const result = await db
      .select({
        sessionId: authSessions.id,
        userId: authSessions.userId,
        expiresAt: authSessions.expiresAt,
        email: users.email,
        tier: users.tier,
      })
      .from(authSessions)
      .innerJoin(users, eq(authSessions.userId, users.id))
      .where(
        and(
          eq(authSessions.tokenHash, tokenHash),
          gt(authSessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (result.length === 0) {
      return { user: null };
    }

    const { userId, email, tier } = result[0];
    return {
      user: {
        id: userId,
        email,
        tier,
      },
    };
  } catch (error) {
    console.error('Error validating session:', error);
    return { user: null };
  }
}

/**
 * Delete a session (logout)
 */
export async function deleteSession(token: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    return false;
  }

  const tokenHash = hashToken(token);

  try {
    const result = await db
      .delete(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash))
      .returning();

    return result.length > 0;
  } catch (error) {
    console.error('Error deleting session:', error);
    return false;
  }
}

/**
 * Delete all sessions for a user (logout everywhere)
 */
export async function deleteAllUserSessions(userId: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    return false;
  }

  try {
    await db.delete(authSessions).where(eq(authSessions.userId, userId));
    return true;
  } catch (error) {
    console.error('Error deleting user sessions:', error);
    return false;
  }
}

/**
 * Clean up expired sessions and tokens (for cron job)
 */
export async function cleanupExpiredAuth(): Promise<{
  sessionsDeleted: number;
  tokensDeleted: number;
}> {
  const db = getDb();
  if (!db) {
    return { sessionsDeleted: 0, tokensDeleted: 0 };
  }

  try {
    const now = new Date();

    // Delete expired sessions
    const deletedSessions = await db
      .delete(authSessions)
      .where(lt(authSessions.expiresAt, now))
      .returning();

    // Delete expired or used magic link tokens older than the retention window
    const oneDayAgo = new Date(
      Date.now() - MAGIC_LINK_RETENTION_HOURS * 60 * 60 * 1000
    );
    const deletedTokens = await db
      .delete(magicLinkTokens)
      .where(lt(magicLinkTokens.createdAt, oneDayAgo))
      .returning();

    return {
      sessionsDeleted: deletedSessions.length,
      tokensDeleted: deletedTokens.length,
    };
  } catch (error) {
    console.error('Error cleaning up expired auth:', error);
    return { sessionsDeleted: 0, tokensDeleted: 0 };
  }
}

/**
 * The only destination a sign-in link may return to other than the home page.
 *
 * A magic link that carries a caller-supplied return path is an open redirect
 * with a stamp of authenticity on it, so this is not a sanitiser: it is an
 * allowlist of one shape. A path matches only if it is the OAuth consent
 * screen carrying one opaque request id, and that id was minted by
 * `createAuthorizationRequest` before the link was ever sent.
 *
 * Nothing an OAuth client supplied travels through the mail round trip. The
 * client's `redirect_uri`, `state` and `client_id` are all in the row this id
 * names, written and validated before the email was composed, so tampering
 * with the link can only ever produce a different request id: either one that
 * does not exist, or somebody else's, which the consent screen then refuses
 * because it belongs to a different pending flow.
 *
 * Both ends check. `send-magic-link` checks before it composes the mail and
 * `verify` checks again before it redirects, because only the second check is
 * the one an attacker has to get past.
 */
const RETURN_PATH = /^\/oauth\/authorize\?req=[A-Za-z0-9-]{36}$/;

export function isAllowedReturnPath(path: string | null): boolean {
  return typeof path === 'string' && RETURN_PATH.test(path);
}

// Cookie configuration
export const SESSION_COOKIE_NAME = 'wts_session';

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: SESSION_DURATION_MS / 1000, // Convert to seconds
  path: '/',
};
