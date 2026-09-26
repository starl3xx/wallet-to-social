/**
 * Operator emails remembered in the database: the machinery the sanctions
 * alerts (Linear STA-41, lib/sanctions-alerts.ts) were built on, shared since
 * 2026-09-26 with the withdrawal trail (Linear STA-50,
 * lib/removal-alerts.ts).
 *
 * Each user of it is a family (`AlertFamily`): its own `ingest_state` name
 * prefix, its own log tag, and the kinds of alert whose email is composed
 * from a payload stored with the claim. The emails themselves go to the ops
 * inbox through `sendOpsAlert` in lib/email.ts.
 *
 * ## At most one email per condition per day, remembered in the database
 *
 * Each condition is a row of `ingest_state` named `<prefix><condition>`.
 * Claimed and sent are recorded apart: `claimAlerts` takes every condition of
 * one email in ONE statement and writes `claimedAt`; a send that succeeds
 * replaces it with `sentAt`. A row is claimable again once it was sent more
 * than `ALERT_REPEAT_HOURS` ago, or when it was never sent and its claim is
 * gone or older than `CLAIM_EXPIRY_MINUTES`, which is how a run that died
 * between claiming and sending is recovered. So of two runs at once only one
 * sends, and a function instance that restarts remembers nothing it needs
 * to. Nothing here keeps state in memory.
 *
 * ## Durable records
 *
 * An alert that cannot be recomputed from other tables (a payment, a job, a
 * withdrawal) carries its email's content as a payload on its claim row,
 * written before the first send is tried. `sendUnsentRecords` (the daily
 * cleanup, and for sanctions the refresh too) sends every record with no
 * sent marker. A family that sets `dropPayloadWhenSent` keeps no copy once
 * the email is out: the row is left as the sent marker alone.
 *
 * ## An alert never blocks or undoes what it reports
 *
 * What an alert reports is committed before any of this runs, and every
 * function here catches its own errors and returns a result instead of
 * throwing. Every send is given `OPS_ALERT_TIMEOUT_MS`. A send that fails or
 * times out is logged and its claim released (the row and any record stay),
 * so the next run tries again; a claim that cannot be taken sends nothing,
 * because the one-a-day rule cannot be kept without it.
 */
import { format } from 'node:util';
import { sql, type SQL } from 'drizzle-orm';
import { OPS_ALERT_TIMEOUT_MS, sendOpsAlert, withTimeout } from '@/lib/email';
import { redact } from '@/lib/redact';

/** At most one email per condition in this many hours. */
export const ALERT_REPEAT_HOURS = 24;

/**
 * A claim with no sent marker that is older than this belongs to a run that
 * died between claiming and sending (or whose release failed): it counts as
 * unclaimed again. Far above `OPS_ALERT_TIMEOUT_MS`, so a live send is never
 * taken from under the run that is making it.
 */
export const CLAIM_EXPIRY_MINUTES = 5;

/** What these functions need from a database: Drizzle's `execute`. */
export interface AlertDb {
  execute(query: SQL): Promise<unknown>;
}

export type AlertSender = (
  subject: string,
  text: string
) => Promise<{ success: boolean; error?: string }>;

export type AlertResult = 'sent' | 'deduped' | 'failed';

export interface AlertEmail {
  subject: string;
  text: string;
}

export interface AlertFamily {
  /** The `ingest_state` name prefix of the family's rows, ending in ':'. */
  prefix: string;
  /** The tag its log lines start with, as `[tag]`. */
  tag: string;
  /** The kinds with a durable record, and the email each composes. */
  records: Record<string, (payload: never) => AlertEmail>;
  /** Whether a sent record drops its payload, keeping only the marker. */
  dropPayloadWhenSent?: boolean;
}

export function rowsOf(result: unknown): unknown[] {
  return ((result as { rows?: unknown[] }).rows ?? []) as unknown[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One log line, through `redact`. A failed statement's error carries its
 * parameters, and a record's payload can name a wallet, so the line is
 * masked here rather than trusting that `redactConsole` was installed.
 */
function logAlert(family: AlertFamily, message: string, error?: unknown) {
  console.error(
    redact(
      error === undefined
        ? format('[%s] %s', family.tag, message)
        : format('[%s] %s:', family.tag, message, error)
    )
  );
}

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
 * A claim is a row `<prefix><condition>` holding `claimedAt`; a send that
 * succeeds replaces it with `sentAt` (`markAlertsSent`), and one that fails
 * drops `claimedAt` (`releaseAlerts`). `payloads` rides with the claim for
 * the alerts that cannot be recomputed from other tables: the row is then
 * the durable record a later sweep sends from (`sendUnsentRecords`), written
 * before the first send is tried.
 */
export async function claimAlerts(
  db: AlertDb,
  family: AlertFamily,
  conditions: string[],
  payloads: Record<string, unknown> = {}
): Promise<string[]> {
  if (conditions.length === 0) return [];
  const names = conditions.map((c) => family.prefix + c);
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
  return rows.map((r) => r.name.slice(family.prefix.length));
}

/**
 * The claim becomes the sent marker. A family with `dropPayloadWhenSent`
 * loses its payload in the same statement, so the email is the only copy.
 */
export async function markAlertsSent(
  db: AlertDb,
  family: AlertFamily,
  conditions: string[]
): Promise<void> {
  await db.execute(sql`
    UPDATE ingest_state
    SET value = (value - 'claimedAt'${family.dropPayloadWhenSent ? sql` - 'payload'` : sql``}) || jsonb_build_object('sentAt', now()),
        updated_at = now()
    WHERE name = ANY(${sql.param(conditions.map((c) => family.prefix + c))}::text[])
  `);
}

/**
 * Give claims back after a failed send, so the next run may try again. The
 * row stays, with any payload, so a durable record is never lost.
 */
export async function releaseAlerts(
  db: AlertDb,
  family: AlertFamily,
  conditions: string[]
): Promise<void> {
  await db.execute(sql`
    UPDATE ingest_state
    SET value = value - 'claimedAt', updated_at = now()
    WHERE name = ANY(${sql.param(conditions.map((c) => family.prefix + c))}::text[])
      AND value->>'sentAt' IS NULL
  `);
}

/**
 * Send one alert for each of `conditions` at most once a day, as ONE email
 * covering the conditions it could claim. Never throws: an email that cannot
 * be composed counts as a failed send, like one the provider refused.
 */
export async function sendClaimed(
  db: AlertDb,
  family: AlertFamily,
  conditions: string[],
  compose: (claimed: string[]) => AlertEmail,
  send: AlertSender,
  payloads: Record<string, unknown> = {}
): Promise<AlertResult> {
  let claimed: string[];
  try {
    claimed = await claimAlerts(db, family, conditions, payloads);
  } catch (error) {
    logAlert(
      family,
      `alert claim failed (${conditions.join(', ')}); not sent`,
      error
    );
    return 'failed';
  }
  if (claimed.length === 0) return 'deduped';

  let result: { success: boolean; error?: string };
  try {
    const { subject, text } = compose(claimed);
    result = await withTimeout(send(subject, text), OPS_ALERT_TIMEOUT_MS, {
      success: false,
      error: 'timed out',
    });
  } catch (error) {
    result = { success: false, error: messageOf(error) };
  }
  if (result.success) {
    try {
      await markAlertsSent(db, family, claimed);
    } catch (error) {
      // The email went out; at worst the claim expires and it goes out again.
      logAlert(
        family,
        `alert sent but not marked (${claimed.join(', ')})`,
        error
      );
    }
    return 'sent';
  }

  logAlert(
    family,
    `alert email failed (${claimed.join(', ')}): ${result.error ?? 'unknown error'}`
  );
  try {
    await releaseAlerts(db, family, claimed);
  } catch (error) {
    // The claim then expires after CLAIM_EXPIRY_MINUTES instead.
    logAlert(
      family,
      `alert claim release failed (${claimed.join(', ')})`,
      error
    );
  }
  return 'failed';
}

/**
 * Record and send one alert with a payload: the row `<prefix><kind>:<key>`
 * is written with the payload before the send is tried, so a send that
 * fails leaves it for `sendUnsentRecords`. Never throws.
 */
export async function sendRecorded(
  db: AlertDb | null,
  family: AlertFamily,
  kind: string,
  key: string,
  payload: object,
  send: AlertSender
): Promise<AlertResult> {
  if (!db) return 'failed';
  const condition = `${kind}:${key}`;
  return sendClaimed(
    db,
    family,
    [condition],
    () => family.records[kind](payload as never),
    send,
    { [condition]: payload }
  );
}

/**
 * Send every durable record of `family` that has no sent marker and no live
 * claim: a send that failed, and a run that died after writing the record.
 * Never throws.
 */
export async function sendUnsentRecords(
  db: AlertDb,
  family: AlertFamily,
  send: AlertSender = sendOpsAlert
): Promise<{ sent: number; failed: number }> {
  const patterns = Object.keys(family.records).map(
    (kind) => family.prefix + kind + ':%'
  );
  let records: Array<{ name: string; payload: unknown }>;
  try {
    records = rowsOf(
      await db.execute(sql`
        SELECT name, value->'payload' AS payload
        FROM ingest_state
        WHERE name LIKE ANY(${sql.param(patterns)}::text[])
          AND value->'payload' IS NOT NULL
          AND value->>'sentAt' IS NULL
          AND (value->>'claimedAt' IS NULL
            OR (value->>'claimedAt')::timestamptz
              <= now() - make_interval(mins => ${CLAIM_EXPIRY_MINUTES}::int))
        ORDER BY name
      `)
    ) as Array<{ name: string; payload: unknown }>;
  } catch (error) {
    logAlert(family, 'alert records could not be read', error);
    return { sent: 0, failed: 1 };
  }
  let sent = 0;
  let failed = 0;
  for (const record of records) {
    const condition = record.name.slice(family.prefix.length);
    const kind = condition.slice(0, condition.indexOf(':'));
    let payload: unknown;
    try {
      payload =
        typeof record.payload === 'string'
          ? JSON.parse(record.payload)
          : record.payload;
    } catch {
      payload = null;
    }
    if (!family.records[kind] || !payload) continue;
    const result = await sendClaimed(
      db,
      family,
      [condition],
      () => family.records[kind](payload as never),
      send,
      { [condition]: payload }
    );
    if (result === 'sent') sent++;
    else if (result === 'failed') failed++;
  }
  return { sent, failed };
}
