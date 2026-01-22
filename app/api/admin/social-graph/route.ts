import { NextRequest, NextResponse } from 'next/server';
import {
  getSocialGraphWallet,
  upsertManualSocialGraph,
  getRecentManualEdits,
} from '@/lib/social-graph';

export const runtime = 'nodejs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAuthorized(request: NextRequest): boolean {
  if (!ADMIN_PASSWORD) return false;
  const password = request.headers.get('x-admin-password');
  return password === ADMIN_PASSWORD;
}

// GET: Search for a wallet in social_graph or list recent manual edits
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const wallet = searchParams.get('wallet');

    // If wallet provided, search for it
    if (wallet) {
      const data = await getSocialGraphWallet(wallet);
      return NextResponse.json({ wallet: data });
    }

    // Otherwise, return recent manual edits
    const recentEdits = await getRecentManualEdits(20);
    return NextResponse.json({ recentEdits });
  } catch (error) {
    console.error('Social graph fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch social graph data' },
      { status: 500 }
    );
  }
}

// POST: Create/update wallet with manual source
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { wallet, twitterHandle, farcaster, ensName } = body;

    if (!wallet) {
      return NextResponse.json(
        { error: 'Wallet address required' },
        { status: 400 }
      );
    }

    // Validate wallet format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // At least one social field should be provided
    if (!twitterHandle && !farcaster && !ensName) {
      return NextResponse.json(
        { error: 'At least one social field (twitterHandle, farcaster, or ensName) required' },
        { status: 400 }
      );
    }

    // Clean up twitter handle (remove @ if present)
    const cleanTwitter = twitterHandle?.replace(/^@/, '');
    // Clean up farcaster (remove @ if present)
    const cleanFarcaster = farcaster?.replace(/^@/, '');

    const result = await upsertManualSocialGraph(wallet, {
      twitterHandle: cleanTwitter,
      farcaster: cleanFarcaster,
      ensName,
    });

    if (!result) {
      return NextResponse.json(
        { error: 'Failed to save social graph data - no result returned' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Social graph updated',
      wallet: result,
    });
  } catch (error) {
    console.error('Social graph update error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to update social graph: ${errorMessage}` },
      { status: 500 }
    );
  }
}
