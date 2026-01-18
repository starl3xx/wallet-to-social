import { Resend } from 'resend';

// Initialize Resend with API key
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const FROM_EMAIL = 'walletlink.social <noreply@walletlink.social>';
const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://walletlink.social';

/**
 * Send a magic link email for authentication
 */
export async function sendMagicLink(
  email: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.error('Resend not configured - RESEND_API_KEY missing');
    return { success: false, error: 'Email service not configured' };
  }

  const magicLink = `${BASE_URL}/api/auth/verify?token=${token}`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Sign in to walletlink.social',
      html: getMagicLinkEmailHtml(magicLink),
      text: getMagicLinkEmailText(magicLink),
    });

    if (error) {
      console.error('Resend error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to send magic link:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if Resend is configured
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/**
 * HTML email template for magic link
 */
function getMagicLinkEmailHtml(magicLink: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to walletlink.social</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://walletlink.social/icon.png" alt="walletlink.social" width="48" height="48" style="border-radius: 8px; margin-bottom: 16px;">
    <h1 style="font-size: 24px; font-weight: 600; margin: 0;">walletlink.social</h1>
  </div>

  <p style="font-size: 16px; margin-bottom: 24px;">
    Click the button below to sign in to your account. This link will expire in 15 minutes.
  </p>

  <div style="text-align: center; margin: 32px 0;">
    <a href="${magicLink}"
       style="display: inline-block; background-color: #000; color: #fff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 16px;">
      Sign in
    </a>
  </div>

  <p style="font-size: 14px; color: #666; margin-top: 32px;">
    If you didn't request this email, you can safely ignore it.
  </p>

  <p style="font-size: 14px; color: #666;">
    If the button doesn't work, copy and paste this link into your browser:
    <br>
    <a href="${magicLink}" style="color: #666; word-break: break-all;">${magicLink}</a>
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

  <p style="font-size: 12px; color: #999; text-align: center;">
    walletlink.social — Find your DeFi users and NFT holders on Twitter
  </p>
</body>
</html>
`.trim();
}

/**
 * Plain text email template for magic link
 */
function getMagicLinkEmailText(magicLink: string): string {
  return `
Sign in to walletlink.social

Click the link below to sign in to your account. This link will expire in 15 minutes.

${magicLink}

If you didn't request this email, you can safely ignore it.

---
walletlink.social — Find your DeFi users and NFT holders on Twitter
`.trim();
}
