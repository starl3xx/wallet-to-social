import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { verifyUnsubscribeToken } from '@/lib/email';

export const runtime = 'nodejs';

/**
 * One-click unsubscribe from lifecycle mail.
 *
 * GET serves the human clicking the footer link; POST serves the mail
 * client's List-Unsubscribe-Post one-click (RFC 8058), which posts with no
 * body worth reading. Both verify the stateless HMAC pair and set
 * `users.email_opt_out`. An address with no account row still gets a calm
 * confirmation: telling a stranger whether an email has an account here
 * would be an oracle, and the outcome they asked for (no mail) is true
 * either way, because every send checks the users table.
 *
 * Transactional mail (sign-in links, purchase links) is not affected, and
 * the page says so: the account keeps working.
 */
async function unsubscribe(request: NextRequest): Promise<NextResponse> {
  const e = request.nextUrl.searchParams.get('e') ?? '';
  const t = request.nextUrl.searchParams.get('t') ?? '';
  const email = verifyUnsubscribeToken(e, t);

  if (!email) {
    return page(
      'This link is not valid',
      'The unsubscribe link is incomplete or has been altered. Reply to any email from us, or write to help@walletlink.social, and a person will take you off the list.',
      400
    );
  }

  const db = getDb();
  if (db) {
    await db
      .update(users)
      .set({ emailOptOut: true })
      .where(eq(users.email, email));
  }

  return page(
    'You are unsubscribed',
    'This address will get no more announcement or marketing email from walletlink.social. Sign-in links and purchase receipts still arrive, because the account needs them to work.',
    200
  );
}

export async function GET(request: NextRequest) {
  return unsubscribe(request);
}

export async function POST(request: NextRequest) {
  return unsubscribe(request);
}

/** A dependency-free page: this renders in a mail client's opened tab. */
function page(title: string, body: string, status: number): NextResponse {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #0a0a0a; max-width: 600px; margin: 0 auto; padding: 64px 20px;">
  <h1 style="font-size: 24px; font-weight: 600;">${title}</h1>
  <p style="font-size: 16px;">${body}</p>
  <p style="font-size: 14px;"><a href="https://walletlink.social" style="color: #4131b0;">walletlink.social</a></p>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
