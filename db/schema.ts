import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  boolean,
  date,
  numeric,
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
    lastViewedAt: timestamp('last_viewed_at'), // when user last loaded this lookup
    inputSource: text('input_source'), // 'file_upload' | 'text_input' | 'api'
  },
  (table) => [
    index('lookup_history_created_at_idx').on(table.createdAt),
    index('lookup_history_user_id_idx').on(table.userId),
    // Composite index for user's history sorted by date (most common query pattern)
    index('lookup_history_user_created_idx').on(table.userId, table.createdAt),
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
    anySocialFound: integer('any_social_found').default(0).notNull(),
    cacheHits: integer('cache_hits').default(0).notNull(),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),

    // Error handling
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').default(0).notNull(),

    // Admin visibility
    hidden: boolean('hidden').default(false).notNull(),
  },
  (table) => [
    index('lookup_jobs_status_idx').on(table.status),
    index('lookup_jobs_created_at_idx').on(table.createdAt),
    // Composite index for efficient "get next pending job" queries
    index('lookup_jobs_status_created_idx').on(table.status, table.createdAt),
  ]
);

// Users table for tiered pricing
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').unique().notNull(),
    tier: text('tier').notNull().default('free'), // 'free' | 'pro' | 'unlimited'
    stripeCustomerId: text('stripe_customer_id'),
    stripePaymentId: text('stripe_payment_id'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('users_email_idx').on(table.email)]
);

// Whitelist for unlimited access (admin-managed)
export const whitelist = pgTable(
  'whitelist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email'),
    wallet: text('wallet'),
    note: text('note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('whitelist_email_idx').on(table.email),
    index('whitelist_wallet_idx').on(table.wallet),
  ]
);

// Analytics events for behavior tracking
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(), // 'page_view', 'csv_upload', 'lookup_started', etc.
    userId: text('user_id'), // localStorage ID or email
    sessionId: text('session_id'), // Browser session ID
    metadata: jsonb('metadata').$type<Record<string, unknown>>(), // Event-specific data
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('analytics_events_type_created_idx').on(table.eventType, table.createdAt),
    index('analytics_events_user_id_idx').on(table.userId),
    index('analytics_events_session_id_idx').on(table.sessionId),
  ]
);

// API performance metrics
export const apiMetrics = pgTable(
  'api_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(), // 'web3bio', 'neynar', 'ens'
    latencyMs: integer('latency_ms'),
    statusCode: integer('status_code'),
    errorMessage: text('error_message'),
    walletCount: integer('wallet_count'), // Number of wallets in batch
    jobId: uuid('job_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('api_metrics_provider_created_idx').on(table.provider, table.createdAt),
    index('api_metrics_job_id_idx').on(table.jobId),
  ]
);

// Daily aggregated statistics (computed nightly)
export const dailyStats = pgTable(
  'daily_stats',
  {
    date: date('date').primaryKey(),
    totalLookups: integer('total_lookups').default(0).notNull(),
    totalWalletsProcessed: integer('total_wallets_processed').default(0).notNull(),
    uniqueUsers: integer('unique_users').default(0).notNull(),
    newUsers: integer('new_users').default(0).notNull(),
    revenueCents: integer('revenue_cents').default(0).notNull(),
    proPurchases: integer('pro_purchases').default(0).notNull(),
    unlimitedPurchases: integer('unlimited_purchases').default(0).notNull(),
    avgMatchRate: numeric('avg_match_rate', { precision: 5, scale: 2 }),
    cacheHitRate: numeric('cache_hit_rate', { precision: 5, scale: 2 }),
    avgLatencyMs: integer('avg_latency_ms'),
    errorCount: integer('error_count').default(0).notNull(),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
  }
);

// ============================================================================
// Authentication
// ============================================================================

// Auth sessions (30-day expiry)
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(), // SHA-256 of session token
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ]
);

// Magic link tokens (15-minute expiry)
export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(), // SHA-256 of token
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('magic_link_tokens_email_idx').on(table.email),
    index('magic_link_tokens_expires_at_idx').on(table.expiresAt),
  ]
);

// ============================================================================
// Public API Infrastructure
// ============================================================================

// API subscription plans
export const apiPlans = pgTable('api_plans', {
  id: text('id').primaryKey(), // 'developer', 'startup', 'enterprise'
  name: text('name').notNull(),
  priceMonthly: integer('price_monthly').notNull(), // in cents
  requestsPerMinute: integer('requests_per_minute').notNull(),
  requestsPerDay: integer('requests_per_day').notNull(),
  requestsPerMonth: integer('requests_per_month').notNull(),
  maxBatchSize: integer('max_batch_size').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// API keys for external developers
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(), // SHA-256 hash of the actual key
    keyPrefix: text('key_prefix').notNull(), // First 8 chars for identification (e.g., "wts_live_")
    name: text('name').notNull(), // User-provided name for the key
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    plan: text('plan')
      .notNull()
      .references(() => apiPlans.id),

    // Rate limits (can override plan defaults)
    rateLimit: integer('rate_limit'), // requests per minute (null = use plan default)
    dailyLimit: integer('daily_limit'), // requests per day
    monthlyLimit: integer('monthly_limit'), // requests per month

    // Status tracking
    isActive: boolean('is_active').default(true).notNull(),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [
    index('api_keys_user_id_idx').on(table.userId),
    index('api_keys_key_idx').on(table.key),
    index('api_keys_is_active_idx').on(table.isActive),
  ]
);

// API usage tracking for billing and analytics
export const apiUsage = pgTable(
  'api_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(), // e.g., '/v1/wallet/0x...'
    method: text('method').notNull(), // GET, POST
    walletCount: integer('wallet_count').default(1).notNull(), // For batch endpoints
    responseStatus: integer('response_status').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    creditsUsed: integer('credits_used').default(1).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('api_usage_api_key_id_idx').on(table.apiKeyId),
    index('api_usage_created_at_idx').on(table.createdAt),
    index('api_usage_api_key_created_idx').on(table.apiKeyId, table.createdAt),
  ]
);

// Rate limit buckets for sliding window tracking
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    bucketType: text('bucket_type').notNull(), // 'minute', 'day', 'month'
    bucketKey: text('bucket_key').notNull(), // e.g., '2024-01-15T14:30' for minute, '2024-01-15' for day
    count: integer('count').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('rate_limit_buckets_lookup_idx').on(
      table.apiKeyId,
      table.bucketType,
      table.bucketKey
    ),
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
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Whitelist = typeof whitelist.$inferSelect;
export type NewWhitelist = typeof whitelist.$inferInsert;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
export type ApiMetric = typeof apiMetrics.$inferSelect;
export type NewApiMetric = typeof apiMetrics.$inferInsert;
export type DailyStat = typeof dailyStats.$inferSelect;
export type NewDailyStat = typeof dailyStats.$inferInsert;
export type ApiPlan = typeof apiPlans.$inferSelect;
export type NewApiPlan = typeof apiPlans.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type ApiUsage = typeof apiUsage.$inferSelect;
export type NewApiUsage = typeof apiUsage.$inferInsert;
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type NewRateLimitBucket = typeof rateLimitBuckets.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
export type MagicLinkToken = typeof magicLinkTokens.$inferSelect;
export type NewMagicLinkToken = typeof magicLinkTokens.$inferInsert;
