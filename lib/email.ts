import { Resend } from 'resend';
import { getSiteUrl } from '@/lib/site-url';

// Initialize Resend with API key
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const FROM_EMAIL = 'walletlink.social <noreply@walletlink.social>';

/**
 * The words around the sign-in button, which differ by why the link was sent.
 *
 * A link someone asked for says "you asked for this, ignore it otherwise". A
 * link sent because a purchase just landed on the address must say the
 * opposite: most buyers are signed out at checkout, this mail is their only
 * way into the credited account, and "ignore this if you didn't request it"
 * invites them to throw away the thing they paid for.
 */
interface MagicLinkCopy {
  subject: string;
  intro: string;
  button: string;
  footnote: string;
}

const SIGN_IN_COPY: MagicLinkCopy = {
  subject: 'Sign in to walletlink.social',
  intro:
    'Click the button below to sign in to your account. This link will expire in 15 minutes.',
  button: 'Sign in',
  footnote: 'If you didn’t request this email, you can safely ignore it.',
};

function purchaseCopy(packName: string, matches: number): MagicLinkCopy {
  return {
    subject: `Your ${packName} pack is ready on walletlink.social`,
    intro: `Thanks for your purchase. ${matches.toLocaleString()} matches are on the account for this email address. Sign in to use them. This link will expire in 15 minutes, and you can request another from the site at any time.`,
    button: 'Sign in to use your credits',
    footnote:
      'You’re receiving this because a pack was bought for this address. If that wasn’t you, write to help@walletlink.social.',
  };
}

/**
 * Send a magic link email for authentication
 */
export async function sendMagicLink(
  email: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  return sendLinkEmail(email, token, SIGN_IN_COPY);
}

/**
 * The sign-in link that follows a pack purchase. Same token, same route,
 * different words: see MagicLinkCopy.
 */
export async function sendPurchaseSignInLink(
  email: string,
  token: string,
  pack: { name: string; matches: number }
): Promise<{ success: boolean; error?: string }> {
  return sendLinkEmail(email, token, purchaseCopy(pack.name, pack.matches));
}

async function sendLinkEmail(
  email: string,
  token: string,
  copy: MagicLinkCopy
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.error('Resend not configured - RESEND_API_KEY missing');
    return { success: false, error: 'Email service not configured' };
  }

  // Resolved per call rather than at module load: a module-level constant is
  // captured when the lambda cold-starts, which hides any later env change.
  const magicLink = `${getSiteUrl()}/api/auth/verify?token=${token}`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: copy.subject,
      html: getMagicLinkEmailHtml(magicLink, copy),
      text: getMagicLinkEmailText(magicLink, copy),
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
function getMagicLinkEmailHtml(magicLink: string, copy: MagicLinkCopy): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${copy.subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #0a0a0a; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://walletlink.social/icon.png" alt="walletlink.social" width="48" height="48" style="border-radius: 9px; margin-bottom: 16px;">
    <h1 style="font-size: 24px; font-weight: 600; margin: 0;">walletlink.social</h1>
  </div>

  <p style="font-size: 16px; margin-bottom: 24px;">
    ${copy.intro}
  </p>

  <div style="text-align: center; margin: 32px 0;">
    <a href="${magicLink}"
       style="display: inline-block; background-color: #4131b0; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 999px; font-weight: 500; font-size: 16px;">
      ${copy.button}
    </a>
  </div>

  <p style="font-size: 14px; color: #737373; margin-top: 32px;">
    ${copy.footnote}
  </p>

  <p style="font-size: 14px; color: #737373;">
    If the button doesn’t work, copy and paste this link into your browser:
    <br>
    <a href="${magicLink}" style="color: #737373; word-break: break-all;">${magicLink}</a>
  </p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 32px 0;">

  <p style="font-size: 12px; color: #737373; text-align: center;">
    walletlink.social: turn your wallet list into Twitter handles and Farcaster profiles
  </p>
</body>
</html>
`.trim();
}

/**
 * Plain text email template for magic link
 */
function getMagicLinkEmailText(magicLink: string, copy: MagicLinkCopy): string {
  return `
${copy.subject}

${copy.intro}

${magicLink}

${copy.footnote}

---
walletlink.social: turn your wallet list into Twitter handles and Farcaster profiles
`.trim();
}
