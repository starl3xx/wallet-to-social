/**
 * Relabel OAuth connections made before labels put the verified host first.
 *
 * Until 2026-09-23 a metadata-document client's connection was labeled by the
 * name it gave itself, so a document on any host that called itself "Claude"
 * was listed under Connected applications as just "Claude". New grants are
 * labeled by `connectionLabel` (lib/oauth/clients.ts): the host first, the
 * claim after it. This brings the grants that already exist into line.
 *
 * Only metadata-document grants can be recomputed: their host is the client
 * id itself. A registered client's label was its reply host at approval, and
 * the redirect is not kept once the code is spent, so those are reported and
 * left as they are.
 *
 * Idempotent: a grant already carrying the new label is not touched. Run with
 * the OWNER connection, after the change that introduced connectionLabel is
 * deployed:
 *   npx tsx --env-file=.env.local scripts/migrate-oauth-grant-labels.ts          # dry run
 *   npx tsx --env-file=.env.local scripts/migrate-oauth-grant-labels.ts --commit
 */
import { neon } from '@neondatabase/serverless';
import { cleanClaimedName, connectionLabel } from '@/lib/oauth/clients';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required (the owner connection)');
    process.exit(1);
  }
  const commit = process.argv.includes('--commit');
  const sql = neon(process.env.DATABASE_URL);

  const rows = await sql`
    SELECT g.id, g.client_label, g.client_id, c.client_name, c.is_cimd
    FROM oauth_grants g
    JOIN oauth_clients c ON c.client_id = g.client_id
    WHERE g.revoked_at IS NULL`;

  let changed = 0;
  let registered = 0;
  for (const row of rows) {
    if (!row.is_cimd) {
      registered++;
      continue;
    }
    const label = connectionLabel(
      {
        clientId: row.client_id as string,
        displayHost: new URL(row.client_id as string).host,
        claimedName: cleanClaimedName(row.client_name),
        redirectUris: [],
        isCimd: true,
      },
      ''
    );
    if (label === row.client_label) continue;
    changed++;
    console.log(
      `grant ${String(row.id).slice(0, 8)}: "${row.client_label}" -> "${label}"`
    );
    if (commit) {
      await sql`UPDATE oauth_grants SET client_label = ${label} WHERE id = ${row.id}`;
    }
  }

  console.log(
    `\n${rows.length} live grants: ${changed} relabeled${commit ? '' : ' (dry run)'}, ` +
      `${registered} registered-client grants left as they are.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
