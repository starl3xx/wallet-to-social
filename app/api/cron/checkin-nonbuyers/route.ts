import { NextRequest, NextResponse } from 'next/server';
import {
  runCheckinCampaign,
  DEFAULT_PER_VARIANT,
} from '@/lib/checkin-campaign';
import { isEmailConfigured } from '@/lib/email';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * The non-buyer check-in, daily at 16:00 UTC.
 *
 * An hour after the welcome sequence, so a person who is due both on the same
 * day gets them an hour apart rather than in the same second. Copy, selection
 * and the daily cap live in `lib/checkin-campaign.ts`; this route supplies the
 * auth, the pause check and the heartbeat.
 *
 * Idempotent by the `lifecycle_emails` unique on (user, key): a rerun, a
 * doubled cron or a manual push sends nothing twice, and the campaign ends by
 * running out of people rather than by anybody remembering to stop it.
 *
 * ## Stopping it
 *
 * `isPaused()` reads `ingest_state`, so one UPDATE halts the next run with no
 * deploy. That is the difference between a switch and a redeploy, and it is
 * the whole reason the switch is a row:
 *
 *     INSERT INTO ingest_state (name, value, updated_at)
 *     VALUES ('checkin_campaign', '{"paused":true}'::jsonb, now())
 *     ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
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
    // Not a silent no-op: the heartbeat records the refusal, so the health
    // pane shows a run that could not send rather than a job that never ran.
    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'checkin_nonbuyers',
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
    const outcome = await runCheckinCampaign(DEFAULT_PER_VARIANT);

    /**
     * `ok` is derived, never asserted. A run that reached the provider and
     * failed every send is not a healthy run, and hardcoding true here records
     * one while nobody is mailed (Bugbot, 2026-08-27). The sibling welcome
     * crons take it from the same place.
     */
    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'checkin_nonbuyers',
        ok: outcome.failed === 0,
        ...outcome,
        durationMs: Date.now() - startedAt,
      },
    }).catch(console.error);

    return NextResponse.json({
      ...outcome,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'checkin_nonbuyers',
        ok: false,
        error: message,
      },
    }).catch(console.error);
    console.error('check-in campaign cron failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
