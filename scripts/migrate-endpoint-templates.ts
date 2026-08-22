/**
 * Migration: normalize api_usage.endpoint to route templates.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-endpoint-templates.ts
 *
 * Applied by hand rather than with drizzle-kit push, because production has
 * known drift from db/schema.ts on other tables and push would try to
 * reconcile those too. Idempotent: safe to run more than once, because every
 * WHERE excludes rows that already hold the template.
 *
 * ## Why
 *
 * `trackApiUsage` stored the concrete request path, so `/v1/wallet/0x...`
 * was its own key. That gave `requests_by_endpoint` in `/v1/usage` one entry
 * per distinct address or handle (unbounded cardinality), and it persisted
 * customer query targets in an analytics table and echoed them back in API
 * responses. The write sites now store templates; this rewrites the rows
 * written before the change. The wrapper in `lib/api-auth.ts` derives the
 * template with `routeTemplate()` from `lib/api-usage.ts`; the three
 * parameterized routes pass their template as a literal.
 */

import { neon } from '@neondatabase/serverless';

const REWRITES: Array<{ template: string; like: string }> = [
  { template: '/v1/wallet/{address}', like: '/v1/wallet/%' },
  { template: '/v1/reverse/twitter/{handle}', like: '/v1/reverse/twitter/%' },
  {
    template: '/v1/reverse/farcaster/{username}',
    like: '/v1/reverse/farcaster/%',
  },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  for (const { template, like } of REWRITES) {
    const rows = (await sql`
      UPDATE api_usage
      SET endpoint = ${template}
      WHERE endpoint LIKE ${like} AND endpoint <> ${template}
      RETURNING id
    `) as unknown as unknown[];
    console.log(`${template}: ${rows.length} rows rewritten`);
  }

  const leftovers = (await sql`
    SELECT endpoint, count(*)::int AS n
    FROM api_usage
    WHERE endpoint LIKE '/v1/wallet/%' AND endpoint <> '/v1/wallet/{address}'
       OR endpoint LIKE '/v1/reverse/%'
          AND endpoint NOT IN ('/v1/reverse/twitter/{handle}', '/v1/reverse/farcaster/{username}')
    GROUP BY endpoint
  `) as unknown as Array<{ endpoint: string; n: number }>;

  if (leftovers.length > 0) {
    console.error('verification failed: concrete paths remain', leftovers);
    process.exit(1);
  }
  console.log('\nverified: no concrete paths remain under the three routes');
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
