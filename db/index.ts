import { neon, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleHttp, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleServerless, NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

// Use connection pooling for better performance under load
// The pooler endpoint reduces p95 latency from 200-500ms to 50-100ms
let db: NeonHttpDatabase<typeof schema> | NeonDatabase<typeof schema> | null = null;
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
  return url.replace(
    /(@[a-z0-9-]+)(\.[\w-]+\.neon\.tech)/i,
    '$1-pooler$2'
  );
}

export function getDb(): NeonHttpDatabase<typeof schema> | NeonDatabase<typeof schema> | null {
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
