import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

// Cache individual wallet social lookups (24h TTL)
export const walletCache = pgTable(
  'wallet_cache',
  {
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
  },
  (table) => [index('wallet_cache_cached_at_idx').on(table.cachedAt)]
);

// Track lookup history for saved results
export const lookupHistory = pgTable(
  'lookup_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name'), // optional user-provided name
    userId: text('user_id'), // localStorage ID until profiles exist
    walletCount: integer('wallet_count').notNull(),
    twitterFound: integer('twitter_found').notNull(),
    farcasterFound: integer('farcaster_found').notNull(),
    results: jsonb('results').notNull(), // full results array
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('lookup_history_created_at_idx').on(table.createdAt),
    index('lookup_history_user_id_idx').on(table.userId),
  ]
);

// Permanent social graph - stores wallets with discovered social accounts
export const socialGraph = pgTable(
  'social_graph',
  {
    wallet: text('wallet').primaryKey(), // lowercase eth address
    ensName: text('ens_name'),
    twitterHandle: text('twitter_handle'),
    twitterUrl: text('twitter_url'),
    farcaster: text('farcaster'),
    farcasterUrl: text('farcaster_url'),
    fcFollowers: integer('fc_followers'),
    fcFid: integer('fc_fid'),
    lens: text('lens'),
    github: text('github'),
    sources: text('sources').array(), // ['web3bio', 'neynar', 'ens']
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    lastUpdatedAt: timestamp('last_updated_at').defaultNow().notNull(),
    lookupCount: integer('lookup_count').default(1).notNull(),
  },
  (table) => [
    index('social_graph_twitter_idx').on(table.twitterHandle),
    index('social_graph_farcaster_idx').on(table.farcaster),
    index('social_graph_ens_idx').on(table.ensName),
    index('social_graph_fc_followers_idx').on(table.fcFollowers),
  ]
);

// Background job queue for large lookups
export const lookupJobs = pgTable(
  'lookup_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: text('status').notNull().default('pending'), // pending | processing | completed | failed
    userId: text('user_id'), // localStorage ID until profiles exist
    wallets: jsonb('wallets').notNull().$type<string[]>(), // full wallet list as JSONB array
    originalData: jsonb('original_data'), // CSV extra columns
    options: jsonb('options').notNull(), // {includeENS, saveToHistory, historyName}

    // Progress tracking
    processedCount: integer('processed_count').default(0).notNull(),
    currentStage: text('current_stage'), // cache | web3bio | neynar | ens
    partialResults: jsonb('partial_results'), // results so far (for resume)

    // Stats
    twitterFound: integer('twitter_found').default(0).notNull(),
    farcasterFound: integer('farcaster_found').default(0).notNull(),
    cacheHits: integer('cache_hits').default(0).notNull(),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),

    // Error handling
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').default(0).notNull(),
  },
  (table) => [
    index('lookup_jobs_status_idx').on(table.status),
    index('lookup_jobs_created_at_idx').on(table.createdAt),
  ]
);

// Types for insert/select
export type WalletCache = typeof walletCache.$inferSelect;
export type NewWalletCache = typeof walletCache.$inferInsert;
export type LookupHistory = typeof lookupHistory.$inferSelect;
export type NewLookupHistory = typeof lookupHistory.$inferInsert;
export type SocialGraph = typeof socialGraph.$inferSelect;
export type NewSocialGraph = typeof socialGraph.$inferInsert;
export type LookupJob = typeof lookupJobs.$inferSelect;
export type NewLookupJob = typeof lookupJobs.$inferInsert;
