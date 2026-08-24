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
    return NextResponse.json(
      { error: 'Email not configured' },
      { status: 500 }
    );
  }

  const startedAt = Date.now();
  try {
    const outcome = await runWelcomeFirstTouch();

    /**
     * Every run, including the quiet ones, and that is the whole point.
     *
     * The first version only wrote a row when something was sent, on the
     * reasoning that 288 empty rows a day are noise. But "no row" then means
     * both "nothing to do" and "this job has been dead since Tuesday", and the
     * health pane cannot tell those apart, which is exactly what it exists to
     * do. The daily runner cannot stand in for it either: it proves the
     * sequence is alive, not that the five-minute runner is.
     *
     * The noise objection was real and is now fixed at the source:
     * `NOT_A_HEARTBEAT` in lib/analytics.ts keeps subtyped cron rows out of
     * every lookup count, so these no longer inflate product metrics.
     */
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
