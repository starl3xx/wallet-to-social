/**
 * What we hold for you, so the page can stop asking a question it can answer.
 *
 * `/claim` promises "control of your own row" and promises twice that a claim
 * can be withdrawn "from this same page with the same wallet". Neither was
 * reachable: the three routes beside this one issue a challenge, start a
 * claim and take one back, and none of them can say whether you have claimed
 * at all. So the page showed the same "Start a claim" card to somebody who
 * had claimed an hour earlier as to somebody who had never been here, and the
 * one instruction it gave about withdrawing (use the same wallet) named a
 * wallet it declined to tell you.
 *
 * The only confirmation that ever existed was a banner driven by the `?claim=`
 * parameter, which `ClaimOutcome` strips with `replaceState` as it reads.
 * That is right for a banner and wrong as the only record: one reload and the
 * person has no way to learn what happened, while the row sits in the
 * database saying `completed`.
 *
 * ## Completed rows only
 *
 * `awaiting_x` is a claim in flight and naming it would report a pairing that
 * does not exist yet. `withdrawn` and `cancelled` are deliberately absent too:
 * the question this answers is "what do you hold for me", and a withdrawal's
 * whole point is that the answer became nothing. The row survives for the
 * audit trail, not for the page.
 *
 * ## Session only, never a parameter
 *
 * The user id comes from the session cookie and nothing else. An endpoint
 * that took one would let anybody enumerate which wallets belong to which
 * account, which is the pairing this product sells and the one thing a claim
 * asks us to publish under the owner's own name rather than to hand out.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : null;
  if (!session?.user) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'Sign in to see your claims.' },
      { status: 401 }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'unavailable', message: 'We could not read your claims.' },
      { status: 503 }
    );
  }

  /**
   * `granted_matches` rather than a boolean, because zero and 250 are
   * different answers and the page says so: a claim on an address we first
   * saw after the cutoff earns nothing and is still worth having.
   *
   * No signature, no verifier, no nonce, no account id. The page needs none
   * of them and an endpoint that returns a credential it does not need is how
   * one ends up somewhere it should not be.
   */
  /**
   * One row per wallet, the newest, because a correction leaves the old one
   * standing.
   *
   * `start` inserts unconditionally and nothing unique-constrains a completed
   * pair (the withdraw route says so in as many words, which is why it
   * updates every row for a wallet rather than the newest). So somebody who
   * claims an address, renames on X and claims it again has two `completed`
   * rows for one address. Serving both would count one address as two and
   * name a pairing that has been superseded, which on a page about the record
   * we hold is the wrong answer twice over.
   *
   * `DISTINCT ON` needs its ordering to lead with the distinct key, so the
   * newest-first ordering the page wants is applied by the outer select.
   */
  const rows = (await db.execute(sql`
    SELECT wallet, x_handle, granted_matches, completed_at
    FROM (
      SELECT DISTINCT ON (wallet)
             wallet, x_handle, granted_matches, completed_at
      FROM identity_attestations
      WHERE user_id = ${session.user.id}
        AND status = 'completed'
      ORDER BY wallet, completed_at DESC NULLS LAST
    ) newest
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 100
  `)) as unknown as {
    rows: Array<{
      wallet: string;
      x_handle: string | null;
      granted_matches: number | null;
      completed_at: string | null;
    }>;
  };

  return NextResponse.json({
    claims: rows.rows.map((r) => ({
      wallet: r.wallet,
      handle: r.x_handle,
      granted_matches: r.granted_matches ?? 0,
      completed_at: r.completed_at,
    })),
  });
}
