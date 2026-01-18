import { NextRequest, NextResponse } from 'next/server';
import { verifyMagicLinkToken, createSession, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '@/lib/auth';
import { getOrCreateUser } from '@/lib/access';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');
  const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://walletlink.social';

  // Helper to redirect with error
  const redirectWithError = (error: string) => {
    const url = new URL(baseUrl);
    url.searchParams.set('auth_error', error);
    return NextResponse.redirect(url);
  };

  // Helper to redirect with success
  const redirectWithSuccess = () => {
    const url = new URL(baseUrl);
    url.searchParams.set('auth_success', '1');
    return NextResponse.redirect(url);
  };

  try {
    if (!token) {
      return redirectWithError('Missing sign-in token');
    }

    // Verify the magic link token
    const verifyResult = await verifyMagicLinkToken(token);

    if ('error' in verifyResult) {
      return redirectWithError(verifyResult.error);
    }

    const { email } = verifyResult;

    // Get or create the user
    const user = await getOrCreateUser(email);

    // Create a session
    const userAgent = request.headers.get('user-agent') || undefined;
    const sessionResult = await createSession(user.id, userAgent);

    if ('error' in sessionResult) {
      return redirectWithError('Failed to create session');
    }

    // Set the session cookie
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionResult.token, SESSION_COOKIE_OPTIONS);

    return redirectWithSuccess();
  } catch (error) {
    console.error('Verify magic link error:', error);
    return redirectWithError('Sign-in failed');
  }
}
