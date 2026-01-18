import { NextRequest, NextResponse } from 'next/server';
import { generateMagicLinkToken } from '@/lib/auth';
import { sendMagicLink, isEmailConfigured } from '@/lib/email';

export const runtime = 'nodejs';

interface SendMagicLinkRequest {
  email: string;
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
    const tokenResult = await generateMagicLinkToken(email);

    if ('error' in tokenResult) {
      // Rate limit error returns 429
      if (tokenResult.error.includes('Too many')) {
        return NextResponse.json(
          { error: tokenResult.error },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: tokenResult.error },
        { status: 500 }
      );
    }

    // Send the magic link email
    const emailResult = await sendMagicLink(email, tokenResult.token);

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
