import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getLookupById,
  updateLookup,
  updateLookupName,
  markLookupViewed,
  getLookupLastViewedAt,
  deleteLookup,
} from '@/lib/history';
import { getEnrichedWalletsSince } from '@/lib/social-graph';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getUserAccess } from '@/lib/access';
import { hasPaidAccess } from '@/lib/credits';
import { scrubSuppressed } from '@/lib/suppression';
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
      userId: string;
    }
  | { success: false; response: NextResponse }
> {
  // Require authenticated session
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return {
      success: false,
      response: NextResponse.json({ error: 'Login required' }, { status: 401 }),
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

  return {
    success: true,
    lookup,
    email: session.user.email ?? null,
    userId: session.user.id,
  };
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
     * "What is new since you last looked" is the other half of the paid
     * saved-lookup feature, alongside adding addresses, so it is gated with it.
     * Paid means any pack or a legacy tier: the packs differ only in how many
     * matches they hold, not in which features they unlock.
     *
     * Gating it here also skips the query rather than hiding its result: the
     * enrichment scan reads every wallet in the lookup against the graph, which
     * is the most expensive thing this endpoint does, and there is no reason to
     * pay for an answer nobody is entitled to see.
     */
    const access = await getUserAccess(validation.email ?? undefined);
    const canSeeEnrichment = await hasPaidAccess(
      validation.userId,
      access.tier
    );

    // Get the lastViewedAt BEFORE we update it (to find enrichments since last view)
    let enrichedWallets: string[] = [];
    if (canSeeEnrichment) {
      const lastViewedAt = await getLookupLastViewedAt(id);
      if (lastViewedAt) {
        const wallets = (lookup.results as WalletSocialResult[]).map(
          (r) => r.wallet
        );
        enrichedWallets = await getEnrichedWalletsSince(wallets, lastViewedAt);
      }
    }

    // Mark viewed for everyone, whatever their plan. It is a record of when the
    // lookup was opened, and keeping it accurate means the window is already
    // correct on the day somebody upgrades.
    await markLookupViewed(id);

    /**
     * The serve-time suppression filter, last before the payload ships.
     *
     * Removed identifiers are stripped from the stored rows on the way out;
     * every wallet row stays, mapping fields removed, so the table the
     * customer reopens has the same rows in the same order. The enriched
     * list is filtered with the same read: "this wallet has new data" is
     * itself a claim about a suppressed wallet, so it must not survive the
     * row being stripped.
     *
     * Fail closed: a throw lands in the catch below and the request errors
     * rather than serving the stored payload unfiltered.
     */
    const scrub = await scrubSuppressed([
      lookup.results as WalletSocialResult[],
    ]);
    const servedResults = scrub.rowSets[0];
    if (scrub.suppressedWallets.size > 0) {
      enrichedWallets = enrichedWallets.filter(
        (w) => !scrub.suppressedWallets.has(w.toLowerCase())
      );
    }

    return NextResponse.json({
      results: servedResults,
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
     * Growing a saved lookup is a paid feature, included in every pack.
     *
     * The gate is here rather than only on the button, because the button is
     * not a gate: this endpoint is what actually writes the merged result, and
     * anyone who can read the network tab can call it. A plan feature enforced
     * in the browser is a suggestion.
     *
     * It guards the results branch alone. Renaming a lookup stays available to
     * anyone who owns it, since a history you cannot label is a worse product
     * for no reason.
     */
    const access = await getUserAccess(validation.email ?? undefined);
    if (!(await hasPaidAccess(validation.userId, access.tier))) {
      return NextResponse.json(
        {
          error:
            'Adding addresses to a saved lookup needs credits. Buy a pack to unlock it.',
          upgradeRequired: true,
          tier: access.tier,
        },
        { status: 403 }
      );
    }

    /**
     * The same scrub the GET applies on the way out, applied on the way
     * in. Without it a customer re-upload (this endpoint merges results
     * from the browser) could put a suppressed identifier back at rest
     * after the per-removal amend has run, and nothing would re-amend it
     * until that identifier's next removal run. Fail closed: a failed
     * suppression read throws into the catch below and the write is
     * refused rather than stored unchecked.
     */
    const scrub = await scrubSuppressed([results]);

    // Update the lookup
    const success = await updateLookup(id, scrub.rowSets[0]);

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

/**
 * Delete a saved lookup. Their copy, their call.
 *
 * Until this existed only the admin endpoint could delete a lookup
 * (DELETE /api/admin/history), so the retention story for saved lookups was
 * "kept until the owner deletes it" with no way for the owner to do so. This
 * is that way: any signed-in owner, no paid gate (a copy you cannot get rid
 * of is not yours), a hard delete of the row.
 *
 * Ownership goes through the same helper as GET and PATCH, so a lookup that
 * is missing and a lookup someone else owns are the same 404 (the repo
 * pattern; /v1/jobs/{id} does the same, because a distinct answer for
 * "exists but not yours" is an enumeration oracle).
 */
export async function DELETE(
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

    const success = await deleteLookup(id);
    if (!success) {
      return NextResponse.json(
        { error: 'Failed to delete lookup' },
        { status: 500 }
      );
    }

    // Deleted, nothing to return.
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('History delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete lookup' },
      { status: 500 }
    );
  }
}
