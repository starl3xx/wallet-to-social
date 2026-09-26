/**
 * The email trail of a withdrawal made on the claim page (Linear STA-50,
 * decided 2026-09-26: "backup plus email trail").
 *
 * A removal asked for by email leaves the request in the help@ inbox. A
 * withdrawal made with the withdraw button on `/claim` left nothing outside
 * the database, so a restore of the whole project from the nightly backup
 * would lose every withdrawal made since that backup, and with it the
 * suppression that stops the index collecting the wallet again. So once a
 * withdrawal has committed, `app/api/claim/withdraw/route.ts` sends one
 * plain-text email to the ops inbox with what an operator needs to apply it
 * again after a restore: the identifiers it suppressed, the claim reference
 * and the time. docs/OPERATIONS.md says how the emails are found and used.
 *
 * ## The body names a person who asked to be removed, on purpose
 *
 * The identifiers in this email belong to somebody who asked us to stop
 * holding them, and the email is a copy of them outside the database. That
 * is necessary to honor the removal: after a restore from a backup older
 * than the withdrawal, the suppression row is gone, and this email is the
 * only record that lets the operator put it back. So it carries that and
 * nothing more: no account id, no email address, no X handle (the
 * withdrawal suppresses the wallet alone, see the route). The subject names
 * nobody, so the inbox list shows no identifier, and it is the same on every
 * withdrawal, so the operator finds them all by one search.
 *
 * ## Sent through the durable-record pattern, and never blocking
 *
 * lib/ops-alerts.ts: the record is written to `ingest_state` (row
 * `alert:removal:withdrawal:<claim id>`) before the send, a send that fails
 * or times out leaves it for the daily cleanup to send again
 * (`sendUnsentRemovalRecords`), and nothing here throws. Once the email is
 * out, the payload is dropped (`dropPayloadWhenSent`): the email is the
 * record, and the database keeps no second copy of the identifiers beside
 * the suppression row. Log lines go through `redact`.
 */
import { format } from 'node:util';
import { getDb } from '@/db';
import { sendOpsAlert } from '@/lib/email';
import {
  sendRecorded,
  sendUnsentRecords,
  type AlertDb,
  type AlertEmail,
  type AlertFamily,
  type AlertResult,
  type AlertSender,
} from '@/lib/ops-alerts';
import { redact } from '@/lib/redact';
import type { RemovalTarget } from '@/lib/removal-admin';

/**
 * The subject of every withdrawal email. It names nobody, and it never
 * changes, because it is what the runbook tells the operator to search for.
 */
export const WITHDRAWAL_SUBJECT =
  '[walletlink] Removal: claim withdrawn on /claim';

const RUNBOOK =
  'Runbook: docs/OPERATIONS.md, "Right to removal: the operator runbook (stage 1)", after a backup restore.';

/** What a withdrawal email carries, and the payload of its record. */
export interface WithdrawalReport {
  /** Exactly the rows the withdrawal wrote to the suppression list. */
  suppressed: RemovalTarget[];
  /** The claim rows (`identity_attestations.id`) the person withdrew. */
  claimIds: string[];
  /** When the withdrawal committed, ISO 8601 in UTC. */
  withdrawnAt: string;
}

function composeWithdrawal(r: WithdrawalReport): AlertEmail {
  return {
    subject: WITHDRAWAL_SUBJECT,
    text: [
      'A claim was withdrawn with the withdraw button on /claim. The removal is committed in the database, and this email is its record outside it.',
      '',
      `Withdrawn at: ${r.withdrawnAt}`,
      `Claim reference: ${r.claimIds.join(', ')}`,
      ...r.suppressed.map((t) => `Suppressed: ${t.kind} ${t.identifier}`),
      '',
      'If the database is restored from a backup taken before that time, apply it again: the operator removal endpoint with these identifiers, lane wallet_sig, reason requested.',
      RUNBOOK,
    ].join('\n'),
  };
}

/** The withdrawal trail, as a family of lib/ops-alerts.ts. */
const REMOVAL: AlertFamily = {
  prefix: 'alert:removal:',
  tag: 'removal',
  records: { withdrawal: composeWithdrawal },
  dropPayloadWhenSent: true,
};

/**
 * Record and send the email for one committed withdrawal. Called by the
 * withdraw route after the erase has returned, never before. Never throws,
 * so it cannot turn a finished withdrawal into an error response.
 */
export async function alertClaimWithdrawal(
  report: WithdrawalReport,
  db: AlertDb | null = getDb(),
  send: AlertSender = sendOpsAlert
): Promise<AlertResult> {
  try {
    const key = report.claimIds[0] ?? report.withdrawnAt;
    return await sendRecorded(db, REMOVAL, 'withdrawal', key, report, send);
  } catch (error) {
    console.error(
      redact(format('[removal] withdrawal email not recorded:', error))
    );
    return 'failed';
  }
}

/**
 * Send every withdrawal record whose email has not gone out: a send that
 * failed or timed out, and a request that died after writing the record.
 * Called by the daily cleanup. Never throws.
 */
export function sendUnsentRemovalRecords(
  db: AlertDb,
  send: AlertSender = sendOpsAlert
): Promise<{ sent: number; failed: number }> {
  return sendUnsentRecords(db, REMOVAL, send);
}
