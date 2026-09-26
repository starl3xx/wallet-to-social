/**
 * Email alerts for sanctions screening (Linear STA-41, decided 2026-09-25).
 *
 * The admin health panel shows these conditions, but a panel is only seen
 * when somebody opens it. So each one also sends an email to the ops inbox
 * (`sendOpsAlert` in lib/email.ts, the Resend setup the lifecycle mail uses):
 *
 * - `freeze:<account id>:<payer>`: a frozen account with a listed payer
 *   that no email has reported yet. Read from the database, not from the run
 *   that froze it, so a send that failed, a run that died after the freeze,
 *   and a second payer listed months later are all reported on the next run.
 * - `stale`: no refresh has succeeded for `SANCTIONS_ALERT_AFTER_HOURS`, or
 *   there is no list at all.
 * - `refused`: a refresh run's guard refused the list it downloaded (empty,
 *   older, or sharply smaller). A download or parse failure is not emailed
 *   by itself; it shows as `failing` on the health panel at once and reaches
 *   the inbox through `stale` at 36 hours.
 * - `settled-payer:<settlement id>`: a USDC payment settled from a wallet
 *   other than the one screened. Money has moved, so the operator must know.
 * - `frozen-payment:<payment id>`: a card payment landed on a frozen
 *   account. It is granted as usual (the credits are held) and the operator
 *   decides on a refund.
 * - `frozen-job:<job id>`: a job charged before its account was frozen,
 *   failed by finalize; the charge needs a refund decision.
 *
 * The last three cannot be recomputed from other tables, so their claim row
 * carries the email's content and is written before the first send: a
 * durable record that the refresh and the daily cleanup resend until it is
 * marked sent (`sendUnsentAlertRecords`).
 *
 * ## At most one email per condition per day, remembered in the database
 *
 * Each condition is a row of `ingest_state` named `alert:sanctions:<condition>`.
 * Claimed and sent are recorded apart: `claimAlerts` takes every condition of
 * one email in ONE statement and writes `claimedAt`; a send that succeeds
 * replaces it with `sentAt`. A row is claimable again once it was sent more
 * than `ALERT_REPEAT_HOURS` ago, or when it was never sent and its claim is
 * gone or older than `CLAIM_EXPIRY_MINUTES`, which is how a run that died
 * between claiming and sending is recovered. So of two runs at once only one
 * sends, and a function instance that restarts remembers nothing it needs
 * to. Nothing here keeps state in memory. A freeze pair's `sentAt` is its
 * permanent sent marker: the pending query skips it, so a freeze is reported
 * once, not daily.
 *
 * ## An alert never blocks or undoes what it reports
 *
 * The freeze and the refusal are committed before any of this runs, and
 * every function here catches its own errors and returns a result instead of
 * throwing. Every send is given `OPS_ALERT_TIMEOUT_MS`. A send that fails or
 * times out is logged and its claim released (the row and any record stay),
 * so the next run tries again; a claim that cannot be taken sends nothing,
 * because the one-a-day rule cannot be kept without it.
 *
 * ## What an email says
 *
 * Only what the operator needs to act. A freeze names the account id, the
 * matched address, the SDN entry uid and the date of the list in force that
 * matched; the list alerts name counts and dates; a payment alert names the
 * account or settlement and the payment.
 */
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { OPS_ALERT_TIMEOUT_MS, sendOpsAlert, withTimeout } from '@/lib/email';
import {
  listedPayerPairs,
  parseListState,
  SANCTIONS_ALERT_AFTER_HOURS,
  SANCTIONS_REFUSE_AFTER_DAYS,
  SANCTIONS_STATE_ROW,
  type RefreshOutcome,
  type SanctionsDb,
} from '@/lib/sanctions';

/** At most one email per condition in this many hours. */
export const ALERT_REPEAT_HOURS = 24;

/** The `ingest_state` name prefix of the alert claims. */
export const ALERT_KEY_PREFIX = 'alert:sanctions:';

const RUNBOOK =
  'Runbook: docs/OPERATIONS.md, "Sanctions screening: the operator runbook".';

export type AlertSender = (
  subject: string,
  text: string
) => Promise<{ success: boolean; error?: string }>;

export type AlertResult = 'sent' | 'deduped' | 'failed';

function rowsOf(result: unknown): unknown[] {
  return ((result as { rows?: unknown[] }).rows ?? []) as unknown[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A claim with no sent marker that is older than this belongs to a run that
 * died between claiming and sending (or whose release failed): it counts as
 * unclaimed again. Far above `OPS_ALERT_TIMEOUT_MS`, so a live send is never
 * taken from under the run that is making it.
 */
export const CLAIM_EXPIRY_MINUTES = 5;

/**
 * When an existing claim row may be taken: sent more than
 * `ALERT_REPEAT_HOURS` ago, or never sent and not claimed in the last
 * `CLAIM_EXPIRY_MINUTES` (a released claim has no `claimedAt` at all).
 */
function claimableRow(): SQL {
  return sql`(
    (ingest_state.value->>'sentAt' IS NOT NULL
      AND (ingest_state.value->>'sentAt')::timestamptz
        <= now() - make_interval(hours => ${ALERT_REPEAT_HOURS}::int))
    OR (ingest_state.value->>'sentAt' IS NULL
      AND (ingest_state.value->>'claimedAt' IS NULL
        OR (ingest_state.value->>'claimedAt')::timestamptz
          <= now() - make_interval(mins => ${CLAIM_EXPIRY_MINUTES}::int)))
  )`;
}

/**
 * Claim `conditions` in ONE statement and return the ones this caller won.
 *
 * A claim is a row `alert:sanctions:<condition>` holding `claimedAt`; a send
 * that succeeds replaces it with `sentAt` (`markAlertsSent`), and one that
 * fails drops `claimedAt` (`releaseAlerts`). `payloads` rides with the claim
 * for the alerts that cannot be recomputed from other tables (a payment, a
 * job): the row is then the durable record a later sweep sends from
 * (`sendUnsentAlertRecords`), written before the first send is tried.
 */
export async function claimAlerts(
  db: SanctionsDb,
  conditions: string[],
  payloads: Record<string, unknown> = {}
): Promise<string[]> {
  if (conditions.length === 0) return [];
  const names = conditions.map((c) => ALERT_KEY_PREFIX + c);
  const bodies = conditions.map((c) =>
    payloads[c] === undefined ? null : JSON.stringify(payloads[c])
  );
  const rows = rowsOf(
    await db.execute(sql`
      INSERT INTO ingest_state (name, value, updated_at)
      SELECT t.name,
             jsonb_strip_nulls(jsonb_build_object('claimedAt', now(), 'payload', t.payload::jsonb)),
             now()
      FROM unnest(${sql.param(names)}::text[], ${sql.param(bodies)}::text[]) AS t(name, payload)
      ON CONFLICT (name) DO UPDATE
        SET value = jsonb_strip_nulls(jsonb_build_object(
              'claimedAt', now(),
              'payload', coalesce(EXCLUDED.value->'payload', ingest_state.value->'payload'))),
            updated_at = now()
        WHERE ${claimableRow()}
      RETURNING name
    `)
  ) as Array<{ name: string }>;
  return rows.map((r) => r.name.slice(ALERT_KEY_PREFIX.length));
}

/** The claim becomes the sent marker. */
export async function markAlertsSent(
  db: SanctionsDb,
  conditions: string[]
): Promise<void> {
  await db.execute(sql`
    UPDATE ingest_state
    SET value = (value - 'claimedAt') || jsonb_build_object('sentAt', now()),
        updated_at = now()
    WHERE name = ANY(${sql.param(conditions.map((c) => ALERT_KEY_PREFIX + c))}::text[])
  `);
}

/**
 * Give claims back after a failed send, so the next run may try again. The
 * row stays, with any payload, so a durable record is never lost.
 */
export async function releaseAlerts(
  db: SanctionsDb,
  conditions: string[]
): Promise<void> {
  await db.execute(sql`
    UPDATE ingest_state
    SET value = value - 'claimedAt', updated_at = now()
    WHERE name = ANY(${sql.param(conditions.map((c) => ALERT_KEY_PREFIX + c))}::text[])
      AND value->>'sentAt' IS NULL
  `);
}

/**
 * Send one alert for each of `conditions` at most once a day, as ONE email
 * covering the conditions it could claim. Never throws.
 */
async function sendClaimed(
  db: SanctionsDb,
  conditions: string[],
  compose: (claimed: string[]) => { subject: string; text: string },
  send: AlertSender,
  payloads: Record<string, unknown> = {}
): Promise<AlertResult> {
  let claimed: string[];
  try {
    claimed = await claimAlerts(db, conditions, payloads);
  } catch (error) {
    console.error(
      `[sanctions] alert claim failed (${conditions.join(', ')}); not sent:`,
      error
    );
    return 'failed';
  }
  if (claimed.length === 0) return 'deduped';

  const { subject, text } = compose(claimed);
  let result: { success: boolean; error?: string };
  try {
    result = await withTimeout(send(subject, text), OPS_ALERT_TIMEOUT_MS, {
      success: false,
      error: 'timed out',
    });
  } catch (error) {
    result = { success: false, error: messageOf(error) };
  }
  if (result.success) {
    try {
      await markAlertsSent(db, claimed);
    } catch (error) {
      // The email went out; at worst the claim expires and it goes out again.
      console.error(
        `[sanctions] alert sent but not marked (${claimed.join(', ')}):`,
        error
      );
    }
    return 'sent';
  }

  console.error(
    `[sanctions] alert email failed (${claimed.join(', ')}): ${result.error ?? 'unknown error'}`
  );
  try {
    await releaseAlerts(db, claimed);
  } catch (error) {
    // The claim then expires after CLAIM_EXPIRY_MINUTES instead.
    console.error(
      `[sanctions] alert claim release failed (${claimed.join(', ')}):`,
      error
    );
  }
  return 'failed';
}

/** A frozen account's listed payer that no email has reported yet. */
export interface PendingFreeze {
  userId: string;
  payer: string;
  sdnUid: string | null;
}

/**
 * The freeze email, from database state: every (frozen account, listed
 * payer) pair with no `freeze:<account>:<payer>` row, as ONE email naming
 * each pair it could claim. The claim is kept after a send, which makes it
 * the pair's sent marker; a failed send releases it, and the next call finds
 * the pair pending again. Called by every refresh and by the daily cleanup.
 * The list date is that of the list in force, the one that matched.
 */
export async function alertPendingFreezes(
  db: SanctionsDb,
  send: AlertSender = sendOpsAlert
): Promise<AlertResult | null> {
  let pending: PendingFreeze[];
  let publishDate: string | null;
  try {
    const rows = rowsOf(
      await db.execute(sql`
        WITH pairs AS (${listedPayerPairs()})
        SELECT p.user_id AS "userId", p.payer, s.sdn_uid AS "sdnUid",
               (SELECT value->>'publishDate' FROM ingest_state
                 WHERE name = ${SANCTIONS_STATE_ROW}) AS "publishDate"
        FROM pairs p
        JOIN users u ON u.id = p.user_id AND u.frozen_at IS NOT NULL
        JOIN sanctioned_addresses s ON s.address = p.payer
        WHERE NOT EXISTS (
          SELECT 1 FROM ingest_state a
          WHERE a.name = ${ALERT_KEY_PREFIX + 'freeze:'}::text || p.user_id::text || ':' || p.payer
            AND (a.value->>'sentAt' IS NOT NULL
              OR (a.value->>'claimedAt')::timestamptz
                > now() - make_interval(mins => ${CLAIM_EXPIRY_MINUTES}::int))
        )
        ORDER BY p.user_id, p.payer
      `)
    ) as Array<PendingFreeze & { publishDate: string | null }>;
    pending = rows.map(({ userId, payer, sdnUid }) => ({
      userId: String(userId),
      payer,
      sdnUid,
    }));
    publishDate = rows[0]?.publishDate ?? null;
  } catch (error) {
    console.error(
      '[sanctions] pending freeze alerts could not be read:',
      error
    );
    return 'failed';
  }
  if (pending.length === 0) return null;

  const byCondition = new Map(
    pending.map((f) => [`freeze:${f.userId}:${f.payer}`, f])
  );
  return sendClaimed(
    db,
    [...byCondition.keys()],
    (claimed) => {
      const pairs = claimed.map((c) => byCondition.get(c)!);
      const accounts = new Set(pairs.map((p) => p.userId)).size;
      return {
        subject: `[walletlink] Sanctions: ${accounts} account(s) frozen`,
        text: [
          `${accounts} frozen account(s): a wallet that paid for credits is on the sanctions list in force, published ${publishDate ?? 'on an unknown date'}.`,
          '',
          ...pairs.flatMap((p) => [
            `Account id: ${p.userId}`,
            `Matched address: ${p.payer}`,
            `SDN entry uid: ${p.sdnUid ?? 'unknown'}`,
            '',
          ]),
          'Do not refund. Do not move the USDC these purchases paid. Do not lift the freeze. Tell the lawyer today (Linear STA-49).',
          RUNBOOK,
        ].join('\n'),
      };
    },
    send
  );
}

// ------------------------------------------- alerts with a durable record
//
// A payment on a frozen account, a settlement from an unscreened payer, and a
// job billed before its account froze cannot be recomputed from other tables
// the way a freeze can. So each claim carries its payload: the row is written
// before the first send is tried, and `sendUnsentAlertRecords` (the refresh
// and the daily cleanup) sends any record with no sent marker.

export interface SettledPayerReport {
  settlementId: string;
  screenedPayer: string;
  settledPayer: string;
  transaction: string;
}

export interface FrozenPaymentReport {
  userId: string;
  reference: string;
  pack: string;
  amountCents: number;
}

export interface FrozenJobReport {
  jobId: string;
  userId: string;
}

const COMPOSERS: Record<
  string,
  (payload: never) => { subject: string; text: string }
> = {
  'settled-payer': (r: SettledPayerReport) => ({
    subject:
      '[walletlink] Sanctions: a payment settled from an unscreened wallet',
    text: [
      'A USDC payment settled from a wallet other than the one that was screened. The money has moved.',
      '',
      `Settlement: ${r.settlementId}`,
      `Transaction: ${r.transaction || 'unknown'}`,
      `Screened payer: ${r.screenedPayer}`,
      `Settled payer: ${r.settledPayer}`,
      '',
      'Check the settled payer against sanctioned_addresses now. If it is listed, follow the freeze runbook and do not refund.',
      RUNBOOK,
    ].join('\n'),
  }),
  'frozen-payment': (r: FrozenPaymentReport) => ({
    subject: '[walletlink] Sanctions: payment received for a frozen account',
    text: [
      'A card payment was received for a frozen account. It was granted as usual, so the credits are held with the rest of the account.',
      '',
      `Account id: ${r.userId}`,
      `Payment: ${r.reference}`,
      `Pack: ${r.pack}, ${(r.amountCents / 100).toFixed(2)} USD`,
      '',
      'Decide on a refund with the lawyer (Linear STA-49). Do not lift the freeze.',
      RUNBOOK,
    ].join('\n'),
  }),
  'frozen-job': (r: FrozenJobReport) => ({
    subject:
      '[walletlink] Sanctions: a job was charged before its account was frozen',
    text: [
      'A lookup job was charged, then its account was frozen before the job finished. The job has been failed and its results cleared; the charge stands.',
      '',
      `Account id: ${r.userId}`,
      `Job: ${r.jobId}`,
      '',
      'Decide on a refund of that charge with the lawyer (Linear STA-49). Do not lift the freeze.',
      RUNBOOK,
    ].join('\n'),
  }),
};

/** The kinds with a durable record, which the sweep resends. */
export const RECORDED_ALERT_KINDS = Object.keys(COMPOSERS);

/** Their row names, as LIKE patterns. */
const RECORD_PATTERNS = RECORDED_ALERT_KINDS.map(
  (kind) => ALERT_KEY_PREFIX + kind + ':%'
);

/** Record and send one alert with a payload. Never throws. */
async function sendRecorded(
  db: SanctionsDb | null,
  kind: string,
  key: string,
  payload: object,
  send: AlertSender
): Promise<AlertResult> {
  if (!db) return 'failed';
  const condition = `${kind}:${key}`;
  return sendClaimed(
    db,
    [condition],
    () => COMPOSERS[kind](payload as never),
    send,
    { [condition]: payload }
  );
}

/**
 * A USDC payment that settled from a wallet other than the one screened.
 * Called by the buy route after settle; the grant goes ahead either way.
 * Never throws.
 */
export async function alertSettledPayerMismatch(
  report: SettledPayerReport,
  db: SanctionsDb | null = getDb(),
  send: AlertSender = sendOpsAlert
): Promise<AlertResult> {
  return sendRecorded(db, 'settled-payer', report.settlementId, report, send);
}

/**
 * A card payment that landed on a frozen account, typically because the
 * freeze came between the checkout session and the payment. The payment is
 * granted as usual, so its record is never dropped, and the credits are held
 * like the rest; the operator decides on a refund. Returns null for an
 * account that is not frozen. Never throws.
 */
export async function alertFrozenAccountPayment(
  payment: FrozenPaymentReport,
  db: SanctionsDb | null = getDb(),
  send: AlertSender = sendOpsAlert
): Promise<AlertResult | null> {
  if (!db) return 'failed';
  try {
    const [row] = rowsOf(
      await db.execute(
        sql`SELECT frozen_at FROM users WHERE id = ${payment.userId}`
      )
    ) as Array<{ frozen_at: unknown }>;
    if (!row?.frozen_at) return null;
  } catch (error) {
    console.error('[sanctions] frozen-payment check failed:', error);
    return 'failed';
  }
  return sendRecorded(db, 'frozen-payment', payment.reference, payment, send);
}

/**
 * A job charged before its account was frozen, which finalize has just
 * failed: the charge stands and needs a refund decision (lib/job-processor.ts).
 * Never throws.
 */
export async function alertFrozenBilledJob(
  report: FrozenJobReport,
  db: SanctionsDb | null = getDb(),
  send: AlertSender = sendOpsAlert
): Promise<AlertResult> {
  return sendRecorded(db, 'frozen-job', report.jobId, report, send);
}

/**
 * Send every durable alert record that has no sent marker and no live claim:
 * a send that failed, and a run that died after writing the record. Called by
 * the refresh and by the daily cleanup. Never throws.
 */
export async function sendUnsentAlertRecords(
  db: SanctionsDb,
  send: AlertSender = sendOpsAlert
): Promise<{ sent: number; failed: number }> {
  let records: Array<{ name: string; payload: unknown }>;
  try {
    records = rowsOf(
      await db.execute(sql`
        SELECT name, value->'payload' AS payload
        FROM ingest_state
        WHERE name LIKE ANY(${sql.param(RECORD_PATTERNS)}::text[])
          AND value->'payload' IS NOT NULL
          AND value->>'sentAt' IS NULL
          AND (value->>'claimedAt' IS NULL
            OR (value->>'claimedAt')::timestamptz
              <= now() - make_interval(mins => ${CLAIM_EXPIRY_MINUTES}::int))
        ORDER BY name
      `)
    ) as Array<{ name: string; payload: unknown }>;
  } catch (error) {
    console.error('[sanctions] alert records could not be read:', error);
    return { sent: 0, failed: 1 };
  }
  let sent = 0;
  let failed = 0;
  for (const record of records) {
    const condition = record.name.slice(ALERT_KEY_PREFIX.length);
    const kind = condition.slice(0, condition.indexOf(':'));
    const payload =
      typeof record.payload === 'string'
        ? JSON.parse(record.payload)
        : record.payload;
    if (!COMPOSERS[kind] || !payload) continue;
    const result = await sendClaimed(
      db,
      [condition],
      () => COMPOSERS[kind](payload as never),
      send,
      { [condition]: payload }
    );
    if (result === 'sent') sent++;
    else if (result === 'failed') failed++;
  }
  return { sent, failed };
}

/** The refused-refresh email. Nothing about any account. */
export async function alertRefusedRefresh(
  db: SanctionsDb,
  outcome: RefreshOutcome,
  send: AlertSender = sendOpsAlert
): Promise<AlertResult | null> {
  if (!outcome.refused) return null;
  return sendClaimed(
    db,
    ['refused'],
    () => ({
      subject: `[walletlink] Sanctions refresh refused: ${outcome.refused}`,
      text: [
        `The sanctions refresh refused the list it downloaded (${outcome.refused}): ${outcome.parsed ?? 0} addresses parsed, ${outcome.previous} in force. The list in force is kept.`,
        outcome.refused === 'sharp_drop'
          ? `If OFAC really delisted that many, accept it by calling /api/cron/sanctions-refresh with the cron secret and ?acceptCount=${outcome.parsed}.`
          : outcome.refused === 'older_publication'
            ? 'The download is older than the list in force; the next run tries again.'
            : 'Check the downloaded file before anything else.',
        `USDC sales stop ${SANCTIONS_REFUSE_AFTER_DAYS} days after the last successful refresh.`,
        RUNBOOK,
      ].join('\n'),
    }),
    send
  );
}

/**
 * The stale-list email, read from the database rather than from a run, so a
 * job that stopped running is caught too: the daily cleanup calls this as
 * well as the refresh.
 */
export async function alertIfListStale(
  db: SanctionsDb,
  now: Date = new Date(),
  send: AlertSender = sendOpsAlert
): Promise<AlertResult | 'fresh'> {
  let state: ReturnType<typeof parseListState>;
  try {
    const [row] = rowsOf(
      await db.execute(
        sql`SELECT value FROM ingest_state WHERE name = ${SANCTIONS_STATE_ROW}`
      )
    ) as Array<{ value: unknown }>;
    state = parseListState(row?.value);
  } catch (error) {
    console.error(
      '[sanctions] stale-list check could not read the list:',
      error
    );
    return 'failed';
  }
  const ageHours = state
    ? (now.getTime() - Date.parse(state.refreshedAt)) / 3_600_000
    : null;
  if (ageHours !== null && ageHours <= SANCTIONS_ALERT_AFTER_HOURS) {
    return 'fresh';
  }
  return sendClaimed(
    db,
    ['stale'],
    () => ({
      subject:
        ageHours === null
          ? '[walletlink] Sanctions list missing: USDC sales refused'
          : `[walletlink] Sanctions list not refreshed for ${Math.floor(ageHours)} hours`,
      text: [
        state
          ? `No refresh of the sanctions list has succeeded for ${Math.floor(ageHours!)} hours (last success ${state.refreshedAt}, list published ${state.publishDate}). USDC sales stop when it is ${SANCTIONS_REFUSE_AFTER_DAYS} days old.`
          : 'There is no sanctions list in force, so every USDC sale is refused until a refresh succeeds.',
        'Read the [sanctions] lines in the refresh cron log for the reason.',
        RUNBOOK,
      ].join('\n'),
    }),
    send
  );
}

/**
 * Every alert a refresh run can raise, in the order the operator reads them.
 * `outcome` is null when the run itself failed; the pending freezes and the
 * stale check still run.
 * Never throws, and runs only after the run's own writes are committed.
 */
export async function sendRefreshAlerts(
  db: SanctionsDb,
  outcome: RefreshOutcome | null,
  now: Date = new Date(),
  send: AlertSender = sendOpsAlert
): Promise<{
  freeze: AlertResult | null;
  refused: AlertResult | null;
  stale: AlertResult | 'fresh';
  records: { sent: number; failed: number };
}> {
  const freeze = await alertPendingFreezes(db, send);
  const refused = outcome ? await alertRefusedRefresh(db, outcome, send) : null;
  const stale = await alertIfListStale(db, now, send);
  const records = await sendUnsentAlertRecords(db, send);
  return { freeze, refused, stale, records };
}
