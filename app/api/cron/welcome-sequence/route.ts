import { NextRequest, NextResponse } from 'next/server';
import { runWelcomeSequence } from '@/lib/welcome-sequence';
import { isEmailConfigured } from '@/lib/email';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * The welcome sequence, daily at 15:00 UTC (morning in the US, where most
 * signups are). Copy, schedule and enrollment rules live in
 * `lib/welcome-sequence.ts`; this route supplies the auth and the heartbeat.
 *
 * Idempotent by the lifecycle_emails unique: a rerun or a doubled cron sends
 * nothing twice. A missed day catches up at one email per user per run.
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
    // Not a silent no-op: the heartbeat records the refusal so the health
    // pane shows a run that could not send rather than a job that never ran.
    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'welcome_sequence',
        ok: false,
        error: 'RESEND_API_KEY missing',
      },
    }).catch(console.error);
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 });
  }

  const startedAt = Date.now();
  try {
    const outcome = await runWelcomeSequence();

    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'welcome_sequence',
        ok: outcome.failed === 0,
        due: outcome.due,
        sent: outcome.sent,
        failed: outcome.failed,
        byKey: outcome.byKey,
        durationMs: Date.now() - startedAt,
      },
    }).catch(console.error);

    return NextResponse.json({ message: 'ok', ...outcome });
  } catch (error) {
    console.error('Welcome sequence cron error:', error);
    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'welcome_sequence',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(console.error);
    return NextResponse.json({ error: 'Welcome sequence failed' }, { status: 500 });
  }
}
