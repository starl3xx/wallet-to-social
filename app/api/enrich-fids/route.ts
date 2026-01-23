import { NextResponse } from 'next/server';
import { fetchFidsByUsernames, isNeynarConfigured } from '@/lib/neynar';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/enrich-fids
 * Takes a list of Farcaster usernames and returns their FIDs
 * Used to enrich old lookups that don't have fc_fid stored
 */
export async function POST(request: Request) {
  try {
    const { usernames } = await request.json();

    if (!Array.isArray(usernames) || usernames.length === 0) {
      return NextResponse.json({ error: 'usernames array required' }, { status: 400 });
    }

    if (!isNeynarConfigured()) {
      return NextResponse.json({ error: 'Neynar not configured' }, { status: 503 });
    }

    const apiKey = process.env.NEYNAR_API_KEY!;

    // Limit to 100 usernames per request to prevent abuse
    const limitedUsernames = usernames.slice(0, 100);

    const fidMap = await fetchFidsByUsernames(limitedUsernames, apiKey);

    // Convert Map to plain object for JSON response
    const fids: Record<string, number> = {};
    for (const [username, fid] of fidMap) {
      fids[username] = fid;
    }

    return NextResponse.json({ fids });
  } catch (error) {
    console.error('Error enriching FIDs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch FIDs' },
      { status: 500 }
    );
  }
}
