import { NextRequest, NextResponse } from 'next/server';
import {
  runWelcomeFirstTouch,
  FIRST_TOUCH_DELAY_MINUTES,
} from '@/lib/welcome-sequence';
import { isEmailConfigured } from '@/lib/email';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Welcome-1 on a five-minute tick.
 *
 * The daily 15:00 UTC runner owns days 2 to 14 and keeps a day-0 pass as a
 * safety net, but on its own it made the *welcome* email arrive up to a day
 * after the welcome: someone who signed up at 15:01 UTC waited 23 hours and
 * 59 minutes. This route closes that to FIRST_TOUCH_DELAY_MINUTES plus up to
 * five, without putting welcome-1 in the same inbox second as the magic link.
 *
 * Overlap with the daily runner is expected at 15:00 and is safe:
 * claimAndSend takes the lifecycle_emails row before it sends, so the second
 * runner finds the claim taken and sends nothing.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 500 }
    );
  }
  if (!isEmailConfigured()) {
    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'welcome_first_touch',
        ok: false,
        error: 'RESEND_API_KEY missing',
      },
    }).catch(console.error);
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 });
  }

  const startedAt = Date.now();
  try {
    const outcome = await runWelcomeFirstTouch();

    // 288 runs a day, and most of them have nothing to do. Only a run that
    // sent, failed or threw is worth a row; the daily runner is the heartbeat
    // that proves the sequence itself is alive.
    if (outcome.sent > 0 || outcome.failed > 0) {
      trackEvent('lookup_completed', {
        metadata: {
          eventSubtype: 'welcome_first_touch',
          ok: outcome.failed === 0,
          delayMinutes: FIRST_TOUCH_DELAY_MINUTES,
          due: outcome.due,
          sent: outcome.sent,
          failed: outcome.failed,
          durationMs: Date.now() - startedAt,
        },
      }).catch(console.error);
    }

    return NextResponse.json({ message: 'ok', ...outcome });
  } catch (error) {
    console.error('Welcome first-touch cron error:', error);
    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'welcome_first_touch',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(console.error);
    return NextResponse.json(
      { error: 'Welcome first-touch failed' },
      { status: 500 }
    );
  }
}
