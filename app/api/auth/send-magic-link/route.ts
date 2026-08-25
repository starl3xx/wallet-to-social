import { NextRequest, NextResponse } from 'next/server';
import { generateMagicLinkToken, isAllowedReturnPath } from '@/lib/auth';
import { safeOrigin } from '@/lib/first-touch';
import { sendMagicLink, isEmailConfigured } from '@/lib/email';

export const runtime = 'nodejs';

interface SendMagicLinkRequest {
  email: string;
  /**
   * Where this browser first arrived from, as one short groupable string.
   *
   * Sent by the client because only the client has it: it lives in the
   * localStorage of whatever typed the email. Sanitised and clamped again on
   * arrival, since it is a value from the open internet on its way to a column.
   */
  origin?: string;
  /**
   * Where to land after signing in, and the only value here that is not the
   * user's own typing.
   *
   * Accepted only when `isAllowedReturnPath` recognises it, which it does for
   * exactly one shape: the OAuth consent screen carrying one opaque request id.
   * Anything else is dropped silently rather than refused, because a caller
   * that sent a bad `next` still wants their sign-in link.
   */
  next?: string;
}

export async function POST(request: NextRequest) {
  try {
    if (!isEmailConfigured()) {
      return NextResponse.json(
        { error: 'Email service not configured' },
        { status: 503 }
      );
    }

    const body: SendMagicLinkRequest = await request.json();
    const { email } = body;
    const origin = safeOrigin(body.origin);
    const returnPath = isAllowedReturnPath(body.next ?? null)
      ? body.next
      : undefined;

    // Validate email format
    if (!email || !email.includes('@') || email.length > 254) {
      return NextResponse.json(
        { error: 'Valid email required' },
        { status: 400 }
      );
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Generate magic link token (rate limited in lib/auth.ts)
    const tokenResult = await generateMagicLinkToken(email, origin);

    if ('error' in tokenResult) {
      // Rate limit error returns 429
      if (tokenResult.error.includes('Too many')) {
        return NextResponse.json({ error: tokenResult.error }, { status: 429 });
      }
      return NextResponse.json({ error: tokenResult.error }, { status: 500 });
    }

    // Send the magic link email
    const emailResult = await sendMagicLink(
      email,
      tokenResult.token,
      returnPath
    );

    if (!emailResult.success) {
      return NextResponse.json(
        { error: emailResult.error || 'Failed to send email' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Send magic link error:', error);
    return NextResponse.json(
      { error: 'Failed to send sign-in link' },
      { status: 500 }
    );
  }
}
