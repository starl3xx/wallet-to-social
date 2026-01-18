import { NextRequest, NextResponse } from 'next/server';
import { getUserAccess } from '@/lib/access';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const email = searchParams.get('email') || undefined;
    const wallet = searchParams.get('wallet') || undefined;

    if (!email && !wallet) {
      return NextResponse.json(
        { error: 'Email or wallet required' },
        { status: 400 }
      );
    }

    const access = await getUserAccess(email, wallet);

    return NextResponse.json({
      tier: access.tier,
      isWhitelisted: access.isWhitelisted,
      walletLimit: access.walletLimit === Infinity ? null : access.walletLimit,
      walletLimitFormatted: access.walletLimit === Infinity
        ? 'Unlimited'
        : access.walletLimit.toLocaleString(),
      walletQuota: access.walletQuota,
      walletsUsed: access.walletsUsed,
      walletsRemaining: access.walletsRemaining,
      canUseNeynar: access.canUseNeynar,
      canUseENS: access.canUseENS,
    });
  } catch (error) {
    console.error('Check access error:', error);
    return NextResponse.json(
      { error: 'Failed to check access' },
      { status: 500 }
    );
  }
}
