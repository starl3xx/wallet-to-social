/**
 * Seed script for known_agents table
 *
 * Usage: npx tsx scripts/seed-known-agents.ts
 *
 * Reads data/seed-agents.json and upserts into the known_agents table.
 * Safe to re-run — uses onConflictDoUpdate to update existing entries.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { knownAgents } from '../db/schema';
import seedData from '../data/seed-agents.json';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const db = drizzle(sql);

  console.log(`Seeding ${seedData.length} known agents...`);

  let upserted = 0;

  // Upsert in batches of 50
  for (let i = 0; i < seedData.length; i += 50) {
    const batch = seedData.slice(i, i + 50).map((agent) => ({
      wallet: agent.wallet.toLowerCase(),
      name: agent.name,
      framework: agent.framework ?? null,
      agentType: agent.agentType ?? null,
      tokenSymbol: agent.tokenSymbol ?? null,
      twitterHandle: agent.twitterHandle ?? null,
      farcaster: agent.farcaster ?? null,
    }));

    await db
      .insert(knownAgents)
      .values(batch)
      .onConflictDoUpdate({
        target: knownAgents.wallet,
        set: {
          name: knownAgents.name, // Will be overwritten by EXCLUDED in SQL
          framework: knownAgents.framework,
          agentType: knownAgents.agentType,
          tokenSymbol: knownAgents.tokenSymbol,
          twitterHandle: knownAgents.twitterHandle,
          farcaster: knownAgents.farcaster,
          updatedAt: new Date(),
        },
      });

    upserted += batch.length;
    console.log(`  Upserted ${upserted}/${seedData.length}`);
  }

  console.log(`Done! ${upserted} known agents seeded.`);
}

main().catch((error) => {
  console.error('Seed error:', error);
  process.exit(1);
});
