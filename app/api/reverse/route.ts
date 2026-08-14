import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq, sql, desc } from 'drizzle-orm';
import { getDb } from '@/db';
import { socialGraph } from '@/db/schema';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getUserAccess } from '@/lib/access';
import { publicSources } from '@/lib/api-sources';
import type { WalletSocialResult } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * Reverse lookup for the web app.
 *
 * The public API already exposes this at /v1/reverse/*, but that authenticates
 * with an API key. The app authenticates with a session cookie, so this is a
 * separate door onto the same query rather than a second implementation of the
 * feature.
 *
 * Same 100-row cap as the public endpoint, deliberately. If the two disagreed,
 * a customer comparing the UI against their own integration would find
 * different answers to the same question.
 */
const MAX_RESULTS = 100;

type Platform = 'twitter' | 'farcaster';

// Same shapes the public API validates against, so a handle accepted here is
// accepted there.
const VALID_TWITTER = /^@?[a-zA-Z0-9_]{1,15}$/;
const VALID_FARCASTER = /^[a-z0-9_.-]{1,32}$/;

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: 'Sign in to use reverse lookup' }, { status: 401 });
  }

  const session = await validateSession(token);
  if (!session.user) {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  const access = await getUserAccess(session.user.email);
  if (access.tier !== 'pro' && access.tier !== 'unlimited') {
    return NextResponse.json(
      {
        error: 'Reverse lookup is available on Pro and Unlimited',
        upgradeRequired: true,
        tier: access.tier,
      },
      { status: 403 }
    );
  }

  let body: { platform?: string; handle?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const platform = body.platform as Platform;
  if (platform !== 'twitter' && platform !== 'farcaster') {
    return NextResponse.json({ error: 'platform must be twitter or farcaster' }, { status: 400 });
  }

  const raw = (body.handle ?? '').trim();
  if (!raw) {
    return NextResponse.json({ error: 'Enter a handle to look up' }, { status: 400 });
  }

  const pattern = platform === 'twitter' ? VALID_TWITTER : VALID_FARCASTER;
  if (!pattern.test(raw)) {
    return NextResponse.json(
      {
        error:
          platform === 'twitter'
            ? 'X handles are 1 to 15 letters, numbers or underscores'
            : 'Farcaster usernames are up to 32 letters, numbers, dots, hyphens or underscores',
      },
      { status: 400 }
    );
  }

  const handle = raw.replace(/^@/, '').toLowerCase();

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }

  const column = platform === 'twitter' ? socialGraph.twitterHandle : socialGraph.farcaster;

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(socialGraph)
    .where(eq(column, handle));
  const totalCount = countRow?.count ?? 0;

  const rows = await db
    .select({
      wallet: socialGraph.wallet,
      ensName: socialGraph.ensName,
      twitterHandle: socialGraph.twitterHandle,
      twitterUrl: socialGraph.twitterUrl,
      farcaster: socialGraph.farcaster,
      farcasterUrl: socialGraph.farcasterUrl,
      fcFollowers: socialGraph.fcFollowers,
      fcFid: socialGraph.fcFid,
      lens: socialGraph.lens,
      github: socialGraph.github,
      sources: socialGraph.sources,
      isAgent: socialGraph.isAgent,
      agentName: socialGraph.agentName,
      agentFramework: socialGraph.agentFramework,
      agentType: socialGraph.agentType,
      agentTokenSymbol: socialGraph.agentTokenSymbol,
      agentVerified: socialGraph.agentVerified,
    })
    .from(socialGraph)
    // Highest reach first. Without an order the 100-row cap would return an
    // arbitrary slice, which matters most on exactly the handles that exceed it.
    .orderBy(desc(socialGraph.fcFollowers))
    .where(eq(column, handle))
    .limit(MAX_RESULTS);

  const results: WalletSocialResult[] = rows.map((r) => ({
    wallet: r.wallet,
    ens_name: r.ensName ?? undefined,
    twitter_handle: r.twitterHandle ?? undefined,
    twitter_url: r.twitterUrl ?? undefined,
    farcaster: r.farcaster ?? undefined,
    farcaster_url: r.farcasterUrl ?? undefined,
    fc_followers: r.fcFollowers ?? undefined,
    fc_fid: r.fcFid ?? undefined,
    lens: r.lens ?? undefined,
    github: r.github ?? undefined,
    // Evidence classes, never the internal pipeline identifiers. This reaches
    // the browser and the CSV export, so it is the same disclosure surface the
    // public API has.
    source: publicSources(r.sources) ?? [],
    is_agent: r.isAgent ?? undefined,
    agent_name: r.agentName ?? undefined,
    agent_framework: r.agentFramework ?? undefined,
    agent_type: r.agentType ?? undefined,
    agent_token_symbol: r.agentTokenSymbol ?? undefined,
    agent_verified: r.agentVerified ?? undefined,
  }));

  return NextResponse.json({
    results,
    meta: {
      platform,
      handle,
      total_count: totalCount,
      returned_count: results.length,
      truncated: totalCount > MAX_RESULTS,
    },
  });
}
