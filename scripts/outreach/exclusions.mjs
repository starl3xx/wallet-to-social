import { email, excludeEmails } from './engine.mjs';

// Keep acquisition separate from welcome/check-in mail. Existing accounts, including
// opted-out accounts, never enter cold outreach. The query is read-only and the
// dedicated connection should have SELECT(email) on users and no write privilege.
export async function syncExistingAccounts(state, now, query) {
  if (!query) {
    if (!process.env.OUTREACH_DATABASE_URL)
      throw new Error(
        'OUTREACH_DATABASE_URL is required to exclude existing accounts before sending'
      );
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.OUTREACH_DATABASE_URL);
    query = () => sql`SELECT email FROM public.users WHERE email IS NOT NULL`;
  }
  const rows = await query();
  if (!Array.isArray(rows))
    throw new Error('Existing-account exclusion query failed');
  const addresses = [];
  for (const row of rows) {
    // Synthetic agent accounts do not necessarily have deliverable email addresses.
    try {
      addresses.push(email(row.email));
    } catch {
      /* Not a contact address. */
    }
  }
  excludeEmails(state, addresses, now);
  state.exclusionsSyncedAt = now;
  return { excludedAccounts: addresses.length };
}
