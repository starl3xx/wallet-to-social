import { neon, Pool } from '@neondatabase/serverless';
import {
  drizzle as drizzleHttp,
  NeonHttpDatabase,
} from 'drizzle-orm/neon-http';
import {
  drizzle as drizzleServerless,
  NeonDatabase,
} from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

// Use connection pooling for better performance under load
// The pooler endpoint reduces p95 latency from 200-500ms to 50-100ms
let db: NeonHttpDatabase<typeof schema> | NeonDatabase<typeof schema> | null =
  null;
let pool: Pool | null = null;

/**
 * Converts a Neon DATABASE_URL to use the pooler endpoint
 * Example: postgresql://user@ep-xxx.neon.tech/db -> postgresql://user@ep-xxx-pooler.neon.tech/db
 */
function getPoolerUrl(url: string): string {
  // Check if it's already a pooler URL
  if (url.includes('-pooler.')) {
    return url;
  }

  // Convert direct endpoint to pooler endpoint
  // Neon format: ep-cool-name-123456.region.neon.tech -> ep-cool-name-123456-pooler.region.neon.tech
  return url.replace(/(@[a-z0-9-]+)(\.[\w-]+\.neon\.tech)/i, '$1-pooler$2');
}

export function getDb():
  | NeonHttpDatabase<typeof schema>
  | NeonDatabase<typeof schema>
  | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!db) {
    // Use connection pooling if available (better for serverless under load)
    // Set USE_CONNECTION_POOLING=true in env to enable
    if (process.env.USE_CONNECTION_POOLING === 'true') {
      const poolerUrl = getPoolerUrl(process.env.DATABASE_URL);
      pool = new Pool({ connectionString: poolerUrl });
      db = drizzleServerless(pool, { schema });
    } else {
      // Default: HTTP-based queries (stateless, good for edge)
      const sql = neon(process.env.DATABASE_URL);
      db = drizzleHttp(sql, { schema });
    }
  }

  return db;
}

/**
 * Whether the driver `getDb()` returns can run `db.transaction()`.
 *
 * `neon-http` cannot: it throws "No transactions support in neon-http driver"
 * at call time, not at build time, so a transaction is a runtime dependency on
 * an environment variable. `lib/social-graph.ts` took that dependency without
 * declaring it, and on 2026-08-22 six lookups recorded a failed index write in
 * `lookup_jobs.social_graph_write_errors` with exactly that message.
 *
 * Derived from the same condition the driver choice above uses, and exported
 * rather than re-tested by callers, so the two cannot drift into disagreeing
 * about which driver is live. A caller that needs atomicity should ask, and
 * carry a path that still writes when the answer is no: losing atomicity is
 * recoverable, and writing nothing is not.
 */
export function supportsTransactions(): boolean {
  return process.env.USE_CONNECTION_POOLING === 'true';
}

/**
 * Cleanup function for graceful shutdown
 * Call this when the process is terminating
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

export * from './schema';
