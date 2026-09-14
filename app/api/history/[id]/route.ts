import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getLookupById,
  updateLookup,
  updateLookupName,
  markLookupViewed,
  getLookupLastViewedAt,
  deleteLookup,
  clearLookupGateById,
} from '@/lib/history';
import { getEnrichedWalletsSince } from '@/lib/social-graph';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getUserAccess } from '@/lib/access';
import { hasPaidAccess } from '@/lib/credits';
import { scrubSuppressed } from '@/lib/suppression';
import { gateResults } from '@/lib/match-gate';
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
    let servedResults = scrub.rowSets[0];
    if (scrub.suppressedWallets.size > 0) {
      enrichedWallets = enrichedWallets.filter(
        (w) => !scrub.suppressedWallets.has(w.toLowerCase())
      );
    }

    /**
     * The match gate, mirrored from the job that saved this lookup. History
     * stores the full payload, so without this the save-to-history checkbox
     * would serve everything the job's own results route locks. Cleared by
     * the unlock endpoint through the row's job_id.
     */
    let lockedMatches = 0;
    if (lookup.matchesDelivered !== null) {
      const gate = gateResults(servedResults, lookup.matchesDelivered);
      servedResults = gate.results;
      lockedMatches = gate.locked;
    }

    return NextResponse.json({
      results: servedResults,
      enrichedWallets, // wallets that were updated since last view
      // The job behind the gate rides along so the client can key an unlock.
      ...(lockedMatches > 0 ? { lockedMatches, jobId: lookup.jobId } : {}),
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
     * A gated lookup refuses the merge outright.
     *
     * The client can only ever hold the gated view (locked rows with the
     * billable identities stripped), so accepting its PATCH would overwrite
     * the stored full payload with the stripped one: the locked X and
     * Farcaster identities would be gone from history for good, and an
     * unlock could null the gate but never restore them. Refusing also
     * keeps newly paid matches out of an old gate's counting. The way
     * forward is the one the message names: unlock first, then grow it.
     */
    if (validation.lookup!.matchesDelivered !== null) {
      /**
       * Refuse only while something is actually locked. Suppression can
       * empty a gate: removals eat the matched rows until the billed quota
       * covers everything that remains, at which point the GET shows no
       * locked rows and no unlock control, and a refusal here would leave
       * the merge blocked with nothing visible to clear. The stored gate is
       * recomputed the same way the GET computes it, and an emptied gate is
       * cleared rather than stepped over, so the next add does not re-lock
       * newly paid matches against a dead number.
       */
      const storedScrub = await scrubSuppressed([
        validation.lookup!.results as WalletSocialResult[],
      ]);
      const storedGate = gateResults(
        storedScrub.rowSets[0],
        validation.lookup!.matchesDelivered
      );
      if (storedGate.locked > 0) {
        return NextResponse.json(
          {
            error:
              'This lookup has locked matches. Unlock it from the results view before adding addresses.',
            upgradeRequired: true,
          },
          { status: 409 }
        );
      }
      await clearLookupGateById(id);
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
