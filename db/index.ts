import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

let db: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!db) {
    const sql = neon(process.env.DATABASE_URL);
    db = drizzle(sql, { schema });
  }

  return db;
}

export * from './schema';
