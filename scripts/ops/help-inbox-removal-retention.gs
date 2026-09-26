/**
 * Deletes removal emails from the help@walletlink.social mailbox 90 days
 * after the last message in their thread (Linear STA-50, decided 2026-09-26).
 *
 * This is a Google Apps Script. It runs inside the help@ mailbox, not in the
 * app, and this copy is here so that it can be reviewed and so that
 * scripts/check-invariants.ts can check it against the docs.
 *
 * Why 90 days: the nightly database backups are kept 90 days
 * (`retention-days` in .github/workflows/db-backup.yml, BACKUP_RETENTION_DAYS
 * in lib/backup-retention.ts). After a restore from a backup, every removal
 * made since that backup is applied again from these emails
 * (docs/OPERATIONS.md). An email older than the oldest backup cannot be
 * needed by a restore, so it goes.
 *
 * What it deletes: threads with the label `walletlink-removals` whose LAST
 * message is more than 90 days old. Gmail's `older_than:` matches a thread
 * when any one of its messages is old, so each thread's last message date is
 * checked here. The delete is permanent (Gmail.Users.Threads.remove): a
 * thread moved to Trash would stay there 30 more days. It logs a count, never
 * a subject or an address.
 *
 * One-time setup, signed in as help@walletlink.social:
 *
 * 1. Gmail: create the label `walletlink-removals`.
 * 2. Gmail: create a filter with Subject
 *    "[walletlink] Removal: claim withdrawn on /claim" (in quotes) and the
 *    action "Apply the label: walletlink-removals". Check "Also apply filter
 *    to matching conversations". This labels every withdrawal email from the
 *    claim page as it arrives.
 * 3. Emailed removal requests have no fixed subject, so the operator applies
 *    the label by hand to each request thread once its removal is done (the
 *    right-to-removal runbook in docs/OPERATIONS.md). A thread without the
 *    label is never deleted.
 * 4. script.google.com: create a project owned by help@. Under Services, add
 *    the Gmail API (the Gmail advanced service). Paste this file and save.
 *    Run deleteOldRemovalEmails once and grant the access it asks for. Then,
 *    under Triggers, add a time-driven trigger for deleteOldRemovalEmails
 *    with a day timer.
 */

const LABEL = 'walletlink-removals';
const RETENTION_DAYS = 90;
const PAGE_SIZE = 100;

function deleteOldRemovalEmails() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const query = 'label:' + LABEL + ' older_than:' + RETENTION_DAYS + 'd';

  // Collect first, delete after: deleting while paging would shift the pages.
  const due = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const threads = GmailApp.search(query, start, PAGE_SIZE);
    for (const thread of threads) {
      if (thread.getLastMessageDate().getTime() < cutoff) {
        due.push(thread.getId());
      }
    }
    if (threads.length < PAGE_SIZE) break;
  }

  for (const id of due) {
    Gmail.Users.Threads.remove('me', id);
  }
  console.log('Deleted ' + due.length + ' removal thread(s).');
}
