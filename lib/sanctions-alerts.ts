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
 * ## At most one email per condition per day, and never blocking
 *
 * The claims, the durable records, the timeout and the never-throw rule are
 * lib/ops-alerts.ts, shared with the withdrawal trail since 2026-09-26. Each
 * condition here is a row of `ingest_state` named `alert:sanctions:<condition>`.
 * A freeze pair's `sentAt` is its permanent sent marker: the pending query
 * skips it, so a freeze is reported once, not daily. The freeze and the
 * refusal are committed before any of this runs.
 *
 * ## What an email says
 *
 * Only what the operator needs to act. A freeze names the account id, the
 * matched address, the SDN entry uid and the date of the list in force that
 * matched; the list alerts name counts and dates; a payment alert names the
 * account or settlement and the payment.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { sendOpsAlert } from '@/lib/email';
import {
  CLAIM_EXPIRY_MINUTES,
  rowsOf,
  sendClaimed as sendClaimedIn,
  sendRecorded as sendRecordedIn,
  sendUnsentRecords,
  type AlertEmail,
  type AlertFamily,
  type AlertResult,
  type AlertSender,
} from '@/lib/ops-alerts';
import {
  listedPayerPairs,
  parseListState,
  SANCTIONS_ALERT_AFTER_HOURS,
  SANCTIONS_REFUSE_AFTER_DAYS,
  SANCTIONS_STATE_ROW,
  type RefreshOutcome,
  type SanctionsDb,
} from '@/lib/sanctions';

export {
  ALERT_REPEAT_HOURS,
  CLAIM_EXPIRY_MINUTES,
  type AlertResult,
  type AlertSender,
} from '@/lib/ops-alerts';

/** The `ingest_state` name prefix of the alert claims. */
export const ALERT_KEY_PREFIX = 'alert:sanctions:';

const RUNBOOK =
  'Runbook: docs/OPERATIONS.md, "Sanctions screening: the operator runbook".';

/** Send under the sanctions family's claims (lib/ops-alerts.ts). */
function sendClaimed(
  db: SanctionsDb,
  conditions: string[],
  compose: (claimed: string[]) => AlertEmail,
  send: AlertSender,
  payloads: Record<string, unknown> = {}
): Promise<AlertResult> {
  return sendClaimedIn(db, SANCTIONS, conditions, compose, send, payloads);
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

const COMPOSERS: Record<string, (payload: never) => AlertEmail> = {
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

/** The sanctions alerts, as a family of lib/ops-alerts.ts. */
const SANCTIONS: AlertFamily = {
  prefix: ALERT_KEY_PREFIX,
  tag: 'sanctions',
  records: COMPOSERS,
};

/** Record and send one alert with a payload. Never throws. */
function sendRecorded(
  db: SanctionsDb | null,
  kind: string,
  key: string,
  payload: object,
  send: AlertSender
): Promise<AlertResult> {
  return sendRecordedIn(db, SANCTIONS, kind, key, payload, send);
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
  return sendUnsentRecords(db, SANCTIONS, send);
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
