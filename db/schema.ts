import { pgTable, text, integer, timestamp, jsonb, uuid, index } from 'drizzle-orm/pg-core';

// Cache individual wallet social lookups (24h TTL)
export const walletCache = pgTable('wallet_cache', {
  wallet: text('wallet').primaryKey(), // lowercase eth address
  ensName: text('ens_name'),
  twitterHandle: text('twitter_handle'),
  twitterUrl: text('twitter_url'),
  farcaster: text('farcaster'),
  farcasterUrl: text('farcaster_url'),
  fcFollowers: integer('fc_followers'),
  lens: text('lens'),
  github: text('github'),
  sources: text('sources').array(), // ['web3bio', 'neynar']
  cachedAt: timestamp('cached_at').defaultNow().notNull(),
}, (table) => [
  index('wallet_cache_cached_at_idx').on(table.cachedAt),
]);

// Track lookup history for saved results
export const lookupHistory = pgTable('lookup_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'), // optional user-provided name
  walletCount: integer('wallet_count').notNull(),
  twitterFound: integer('twitter_found').notNull(),
  farcasterFound: integer('farcaster_found').notNull(),
  results: jsonb('results').notNull(), // full results array
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('lookup_history_created_at_idx').on(table.createdAt),
]);

// Types for insert/select
export type WalletCache = typeof walletCache.$inferSelect;
export type NewWalletCache = typeof walletCache.$inferInsert;
export type LookupHistory = typeof lookupHistory.$inferSelect;
export type NewLookupHistory = typeof lookupHistory.$inferInsert;
