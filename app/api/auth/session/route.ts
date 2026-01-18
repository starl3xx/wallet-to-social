import { NextResponse } from 'next/server';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getUserAccess } from '@/lib/access';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json({ user: null });
    }

    const sessionResult = await validateSession(sessionToken);

    if (!sessionResult.user) {
      return NextResponse.json({ user: null });
    }

    // Get full access info (tier, whitelist status)
    const access = await getUserAccess(sessionResult.user.email);

    return NextResponse.json({
      user: {
        id: sessionResult.user.id,
        email: sessionResult.user.email,
        tier: access.tier,
        isWhitelisted: access.isWhitelisted,
        walletLimit: access.walletLimit === Infinity ? null : access.walletLimit,
      },
    });
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json({ user: null });
  }
}
