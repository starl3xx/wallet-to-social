/**
 * How many days each nightly database backup is kept: the `retention-days`
 * of the upload step in `.github/workflows/db-backup.yml`, after which GitHub
 * deletes the artifact. The workflow cannot import this, so
 * `scripts/check-invariants.ts` fails when the two disagree. A text that
 * states the backup period reads it from here, or is checked against it.
 */
export const BACKUP_RETENTION_DAYS = 90;
