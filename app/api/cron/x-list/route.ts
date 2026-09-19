/**
 * One tick of the X list builder.
 *
 * Every minute, because X's member-add window is fifteen minutes wide and a
 * minute is the finest schedule Vercel offers: a list of 319 spends its first
 * 300 over the first fifteen minutes and finishes in the next window, which is
 * the fastest the provider allows and requires no scheduling cleverness at all.
 *
 * Idle is the overwhelmingly common case and costs one indexed query against a
 * partial index that only covers unfinished rows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runXListTick } from '@/lib/x-list-worker';
import { isConfigured as xConfigured } from '@/lib/x-oauth';
import { isConfigured as boxConfigured } from '@/lib/secret-box';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  /**
   * Answers 200 rather than 503 when unconfigured.
   *
   * A cron that reports failure every minute on a deployment where the feature
   * is simply switched off trains everyone to ignore its alerts, and the alert
   * that matters here is a job that stalls while the feature IS on.
   */
  if (!xConfigured() || !boxConfigured()) {
    return NextResponse.json({ status: 'disabled' });
  }

  try {
    const result = await runXListTick();
    return NextResponse.json(result);
  } catch (error) {
    console.error('X list tick failed:', error);
    return NextResponse.json(
      { error: 'tick_failed', message: String(error) },
      { status: 500 }
    );
  }
}
