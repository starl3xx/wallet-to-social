import { NextRequest, NextResponse } from 'next/server';
import { sweepEasAttestations } from '@/lib/eas-attestations';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Daily read of the onchain social attestations on Base and Optimism.
 *
 * No key, no metering and no provider who can revoke us: this is chain state,
 * read through a hosted index that any RPC could replace. So unlike the
 * Farcaster sweep and the holder index there is no budget to consult.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const stats = await sweepEasAttestations();

    // Decided before the event is written, by the same expression that decides
    // the status code. See the note in ethos-sweep: an unconditional event made
    // a failed sweep indistinguishable from a healthy one in the health panel.
    const ok = stats.schemasFailed === 0 && stats.schemasPartial === 0;

    trackEvent('lookup_completed', {
      metadata: { eventSubtype: 'eas_sweep', ok, ...stats },
    }).catch(console.error);

    // Partial coverage is not a success. This runs unattended, so a schema we
    // could not read has to show up in the status code rather than in a field
    // nobody reads.
    if (!ok) {
      return NextResponse.json(
        {
          message:
            `${stats.schemasFailed} schema(s) unreadable, ` +
            `${stats.schemasPartial} read only in part`,
          ...stats,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ message: 'ok', ...stats });
  } catch (error) {
    console.error('EAS sweep cron error:', error);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
