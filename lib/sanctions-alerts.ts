/**
 * Email alerts for sanctions screening (Linear STA-41, decided 2026-09-25).
 *
 * The admin health panel shows these conditions, but a panel is only seen
 * when somebody opens it. So each one also sends an email to the ops inbox
 * (`sendOpsAlert` in lib/email.ts, the Resend setup the lifecycle mail uses):
 *
 * - `freeze:<account id>`: an account was frozen. Sent in the run that froze
 *   it.
 * - `stale`: no refresh has succeeded for `SANCTIONS_ALERT_AFTER_HOURS`, or
 *   there is no list at all.
 * - `refused`: a refresh run refused the list it downloaded.
 *
 * ## At most one email per condition per day, remembered in the database
 *
 * Each condition is a row of `ingest_state` named `alert:sanctions:<condition>`
 * holding when it was last sent. `claimAlert` takes it in one statement that
 * writes only when the row is absent or older than `ALERT_REPEAT_HOURS`, so of
 * two runs at once only one sends, and a function instance that restarts
 * remembers nothing it needs to. Nothing here keeps state in memory.
 *
 * ## An alert never blocks or undoes what it reports
 *
 * The freeze and the refusal are committed before any of this runs, and
 * every function here catches its own errors and returns a result instead of
 * throwing. A send that fails is logged and its claim released, so the next
 * run may try again; a claim that cannot be taken sends nothing, because the
 * one-a-day rule cannot be kept without it.
 *
 * ## What an email says
 *
 * Only what the operator needs to act. A freeze names the account id, the
 * matched address and the SDN entry uid; the other two name counts and dates.
 */
import { sql } from 'drizzle-orm';
import { sendOpsAlert } from '@/lib/email';
import {
  parseListState,
  SANCTIONS_ALERT_AFTER_HOURS,
  SANCTIONS_REFUSE_AFTER_DAYS,
  SANCTIONS_STATE_ROW,
  type FrozenAccount,
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
 * Take the right to send `condition` now. True for exactly one caller, and
 * only when the condition was never sent or was last sent more than
 * `ALERT_REPEAT_HOURS` ago.
 */
export async function claimAlert(
  db: SanctionsDb,
  condition: string
): Promise<boolean> {
  return (
    rowsOf(
      await db.execute(sql`
        INSERT INTO ingest_state (name, value, updated_at)
        VALUES (${ALERT_KEY_PREFIX + condition}, jsonb_build_object('sentAt', now()), now())
        ON CONFLICT (name) DO UPDATE
          SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
          WHERE (ingest_state.value->>'sentAt')::timestamptz
            <= now() - make_interval(hours => ${ALERT_REPEAT_HOURS}::int)
        RETURNING 1
      `)
    ).length === 1
  );
}

/** Give a claim back after a failed send, so the next run may try again. */
export async function releaseAlert(
  db: SanctionsDb,
  condition: string
): Promise<void> {
  await db.execute(
    sql`DELETE FROM ingest_state WHERE name = ${ALERT_KEY_PREFIX + condition}`
  );
}

/**
 * Send one alert for each of `conditions` at most once a day, as ONE email
 * covering the conditions it could claim. Never throws.
 */
async function sendClaimed(
  db: SanctionsDb,
  conditions: string[],
  compose: (claimed: string[]) => { subject: string; text: string },
  send: AlertSender
): Promise<AlertResult> {
  const claimed: string[] = [];
  for (const condition of conditions) {
    try {
      if (await claimAlert(db, condition)) claimed.push(condition);
    } catch (error) {
      console.error(
        `[sanctions] alert claim failed (${condition}); not sent:`,
        error
      );
    }
  }
  if (claimed.length === 0) return 'deduped';

  const { subject, text } = compose(claimed);
  let result: { success: boolean; error?: string };
  try {
    result = await send(subject, text);
  } catch (error) {
    result = { success: false, error: messageOf(error) };
  }
  if (result.success) return 'sent';

  console.error(
    `[sanctions] alert email failed (${claimed.join(', ')}): ${result.error ?? 'unknown error'}`
  );
  for (const condition of claimed) {
    try {
      await releaseAlert(db, condition);
    } catch (error) {
      console.error(
        `[sanctions] alert claim release failed (${condition}):`,
        error
      );
    }
  }
  return 'failed';
}

/** The freeze email: one per run, naming each account it could claim. */
export async function alertFreezes(
  db: SanctionsDb,
  frozen: FrozenAccount[],
  publishDate: string | null,
  send: AlertSender = sendOpsAlert
): Promise<AlertResult | null> {
  if (frozen.length === 0) return null;
  const byCondition = new Map(frozen.map((f) => [`freeze:${f.userId}`, f]));
  return sendClaimed(
    db,
    [...byCondition.keys()],
    (claimed) => {
      const accounts = claimed.map((c) => byCondition.get(c)!);
      return {
        subject: `[walletlink] Sanctions: ${accounts.length} account(s) frozen`,
        text: [
          `The sanctions refresh froze ${accounts.length} account(s): a wallet that paid for credits is on the list published ${publishDate ?? 'on an unknown date'}.`,
          '',
          ...accounts.flatMap((a) => [
            `Account id: ${a.userId}`,
            `Matched address: ${a.payer}`,
            `SDN entry uid: ${a.sdnUid ?? 'unknown'}`,
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
 * `outcome` is null when the run itself failed; the stale check still runs.
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
}> {
  const freeze = outcome?.freeze
    ? await alertFreezes(db, outcome.freeze.frozen, outcome.publishDate, send)
    : null;
  const refused = outcome ? await alertRefusedRefresh(db, outcome, send) : null;
  const stale = await alertIfListStale(db, now, send);
  return { freeze, refused, stale };
}
