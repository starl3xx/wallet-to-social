import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getLookupById, updateLookup, updateLookupName, markLookupViewed, getLookupLastViewedAt } from '@/lib/history';
import { getEnrichedWalletsSince } from '@/lib/social-graph';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getUserAccess } from '@/lib/access';
import type { WalletSocialResult } from '@/lib/types';

/**
 * Helper to validate session and ownership for a lookup
 * Returns 404 for both "not found" and "not owned" to prevent enumeration attacks
 */
async function validateSessionAndOwnership(lookupId: string): Promise<
  | {
      success: true;
      lookup: Awaited<ReturnType<typeof getLookupById>>;
      email: string | null;
    }
  | { success: false; response: NextResponse }
> {
  // Require authenticated session
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Login required' },
        { status: 401 }
      ),
    };
  }

  const session = await validateSession(sessionToken);
  if (!session.user) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Invalid or expired session' },
        { status: 401 }
      ),
    };
  }

  // Get the lookup
  const lookup = await getLookupById(lookupId);

  // Return 404 for both "not found" and "not owned" (prevents enumeration)
  if (!lookup || lookup.userId !== session.user.id) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Lookup not found' },
        { status: 404 }
      ),
    };
  }

  return { success: true, lookup, email: session.user.email ?? null };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  try {
    const { id } = await params;

    // Validate session and ownership
    const validation = await validateSessionAndOwnership(id);
    if (!validation.success) {
      return validation.response;
    }

    const lookup = validation.lookup!;

    /**
     * "What is new since you last looked" is the other half of the Unlimited
     * saved-lookup feature, alongside adding addresses, so it is gated with it.
     *
     * Gating it here also skips the query rather than hiding its result: the
     * enrichment scan reads every wallet in the lookup against the graph, which
     * is the most expensive thing this endpoint does, and there is no reason to
     * pay for an answer nobody is entitled to see.
     */
    const access = await getUserAccess(validation.email ?? undefined);
    const canSeeEnrichment = access.tier === 'unlimited';

    // Get the lastViewedAt BEFORE we update it (to find enrichments since last view)
    let enrichedWallets: string[] = [];
    if (canSeeEnrichment) {
      const lastViewedAt = await getLookupLastViewedAt(id);
      if (lastViewedAt) {
        const wallets = (lookup.results as WalletSocialResult[]).map((r) => r.wallet);
        enrichedWallets = await getEnrichedWalletsSince(wallets, lastViewedAt);
      }
    }

    // Mark viewed for everyone, whatever their plan. It is a record of when the
    // lookup was opened, and keeping it accurate means the window is already
    // correct on the day somebody upgrades.
    await markLookupViewed(id);

    return NextResponse.json({
      results: lookup.results,
      enrichedWallets, // wallets that were updated since last view
    });
  } catch (error) {
    console.error('History fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lookup' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  try {
    const { id } = await params;
    const body = await request.json();

    // Validate session and ownership
    const validation = await validateSessionAndOwnership(id);
    if (!validation.success) {
      return validation.response;
    }

    // Handle name update
    if (typeof body.name === 'string') {
      const success = await updateLookupName(id, body.name);
      if (!success) {
        return NextResponse.json(
          { error: 'Failed to update lookup name' },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true });
    }

    // Handle results update
    const results: WalletSocialResult[] = body.results;
    if (!results || !Array.isArray(results)) {
      return NextResponse.json(
        { error: 'Invalid request - must include name or results' },
        { status: 400 }
      );
    }

    /**
     * Growing a saved lookup is an Unlimited feature.
     *
     * The gate is here rather than only on the button, because the button is
     * not a gate: this endpoint is what actually writes the merged result, and
     * anyone who can read the network tab can call it. A plan feature enforced
     * in the browser is a suggestion.
     *
     * It guards the results branch alone. Renaming a lookup stays available to
     * anyone who owns it, since Pro is sold with full lookup history and a
     * history you cannot label is a worse product for no reason.
     */
    const access = await getUserAccess(validation.email ?? undefined);
    if (access.tier !== 'unlimited') {
      return NextResponse.json(
        {
          error: 'Adding addresses to a saved lookup is available on Unlimited.',
          upgradeRequired: true,
          tier: access.tier,
        },
        { status: 403 }
      );
    }

    // Update the lookup
    const success = await updateLookup(id, results);

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to update lookup' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('History update error:', error);
    return NextResponse.json(
      { error: 'Failed to update lookup' },
      { status: 500 }
    );
  }
}
