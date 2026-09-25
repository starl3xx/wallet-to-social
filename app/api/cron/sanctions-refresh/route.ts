import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trackEvent } from '@/lib/analytics';
import { sendRefreshAlerts } from '@/lib/sanctions-alerts';
import {
  refreshSanctionsList,
  SANCTIONS_ALERT_AFTER_HOURS,
  SANCTIONS_REFUSE_AFTER_DAYS,
} from '@/lib/sanctions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Refresh the sanctions list the USDC rail screens against, every six hours
 * (Linear STA-41). The work is `refreshSanctionsList` in lib/sanctions.ts:
 * download OFAC's SDN.XML, parse it, refuse a list that is empty, older or
 * sharply smaller, put the rest in force in one statement, then re-check
 * every past x402 payer and freeze any that are now listed.
 *
 * ## Alerts
 *
 * Email first: a freeze, a refused run, and no success for
 * `SANCTIONS_ALERT_AFTER_HOURS` each send one to the ops inbox, at most once
 * a day per condition (`sendRefreshAlerts`, lib/sanctions-alerts.ts). They
 * run after the run's own writes and never throw, so an email can neither
 * block nor undo a freeze or a refusal. The same conditions show on the
 * admin health panel (the "Sanctions list refresh" row: `failing` after a
 * failed or refused run, `late` after the alert window; a banner for a recent
 * freeze), are logged at error with a `[sanctions]` tag, and a run that did
 * not put a list in force answers 502.
 *
 * ## Accepting a large delisting
 *
 * A list more than `SANCTIONS_MAX_DROP` smaller than the one in force is
 * refused. After checking OFAC's recent actions, an operator accepts it by
 * calling this route with the secret and `?acceptCount=<the new count>`; a
 * parse of any other size is still refused. Only with `CRON_SECRET` set.
 *
 * GET for Vercel cron.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 500 }
    );
  }

  const acceptParam = request.nextUrl.searchParams.get('acceptCount');
  const acceptCount =
    cronSecret && acceptParam !== null && /^\d+$/.test(acceptParam)
      ? Number(acceptParam)
      : null;

  const startedAt = Date.now();
  try {
    const outcome = await refreshSanctionsList({ db, acceptCount });

    if (outcome.refused || outcome.error) {
      console.error(
        `[sanctions] refresh did not update the list: ${outcome.refused ?? 'error'}` +
          ` (parsed ${outcome.parsed ?? 'nothing'}, in force ${outcome.previous})` +
          (outcome.error ? `: ${outcome.error}` : '')
      );
    }
    if (outcome.alert) {
      console.error(
        `[sanctions] ALERT: no successful refresh for ${outcome.listAgeHours ?? 'ever'} hours` +
          ` (alert at ${SANCTIONS_ALERT_AFTER_HOURS}); USDC sales stop at ${SANCTIONS_REFUSE_AFTER_DAYS} days`
      );
    }
    if (outcome.freeze && outcome.freeze.newlyFrozen > 0) {
      console.error(
        `[sanctions] ALERT: froze ${outcome.freeze.newlyFrozen} account(s) whose x402 payer is on the list published ${outcome.publishDate}; ` +
          `${outcome.freeze.keysDeactivated} key(s) deactivated. Follow the runbook in docs/OPERATIONS.md. Do not refund.`
      );
    }

    // After the run's writes, and never throwing: see "Alerts" above.
    const alerts = await sendRefreshAlerts(db, outcome);

    // Counts only: the heartbeat lives in analytics_events, which is kept
    // 400 days, so no address and no account id goes into it.
    await trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'sanctions_refresh',
        ok: outcome.ok,
        refused: outcome.refused,
        error: outcome.error,
        publishDate: outcome.publishDate,
        parsed: outcome.parsed,
        previous: outcome.previous,
        added: outcome.added,
        removed: outcome.removed,
        frozen: outcome.freeze?.newlyFrozen ?? null,
        keysDeactivated: outcome.freeze?.keysDeactivated ?? null,
        listAgeHours: outcome.listAgeHours,
        alerts,
        durationMs: Date.now() - startedAt,
      },
    });

    // Counts, not the frozen accounts: those went to the ops inbox, and a
    // response body is not where an account id and its wallet belong.
    const freeze = outcome.freeze && {
      matched: outcome.freeze.matched,
      newlyFrozen: outcome.freeze.newlyFrozen,
      keysDeactivated: outcome.freeze.keysDeactivated,
    };
    return NextResponse.json(
      { ...outcome, freeze, alerts },
      { status: outcome.ok ? 200 : 502 }
    );
  } catch (error) {
    console.error('[sanctions] refresh failed:', error);
    // The run failed before it could report; the stale check still runs.
    await sendRefreshAlerts(db, null);
    await trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'sanctions_refresh',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      },
    });
    return NextResponse.json({ error: 'Refresh failed' }, { status: 500 });
  }
}
