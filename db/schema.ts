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
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
    fcFid: integer('fc_fid'),
    lens: text('lens'),
    github: text('github'),
    sources: text('sources').array(), // ['web3bio', 'neynar']
    cachedAt: timestamp('cached_at').defaultNow().notNull(),
    // Agent detection metadata
    isAgent: boolean('is_agent').default(false),
    agentName: text('agent_name'),
    agentFramework: text('agent_framework'),
    agentType: text('agent_type'),
    agentTokenSymbol: text('agent_token_symbol'),
    agentDetectionSource: text('agent_detection_source'),
    agentVerified: boolean('agent_verified').default(false),
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
    /**
     * The numeric X account id, where a source gave us one that provably
     * belongs to the handle beside it.
     *
     * A handle is a string its owner can change; an id is not. Almost every
     * handle in this table came from Farcaster, which stores the string and no
     * id, so a rename is invisible to us: a random sample of 300 on 2026-08-16
     * found 7.7% pointing at accounts that no longer exist. This column is the
     * only thing in the pipeline that can tell a rename from a deletion.
     *
     * Only ever written next to a handle it belongs to. When two sources name
     * different handles for one wallet, this is left alone and the
     * disagreement goes to `handle_conflicts` instead.
     */
    twitterUserId: text('twitter_user_id'),
    /**
     * The handle this row served before the conflict resolver replaced it.
     *
     * Set only by `lib/conflict-resolution.ts`, when the stored handle reached
     * nobody on a recent check and an attested source named a live account for
     * the same wallet. It is the audit trail for that swap, and it is also the
     * guard every writer that carries the old string needs: Farcaster still
     * holds the dead handle and will keep offering it, so a writer that sees
     * its incoming handle here knows it is looking at the past.
     */
    twitterRenamedFrom: text('twitter_renamed_from'),
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
    // Data quality metadata (Phase 1)
    twitterVerified: boolean('twitter_verified').default(false), // High-confidence data from ENS onchain
    farcasterVerified: boolean('farcaster_verified').default(false), // High-confidence data from Neynar
    dataQualityScore: integer('data_quality_score').default(0), // 0-100 confidence score
    lastVerificationAt: timestamp('last_verification_at'), // When data was last verified
    staleAt: timestamp('stale_at'), // When data should be refreshed
    // When external resolution last ran for this wallet, positive OR negative.
    // Rows where this is set but every social column is NULL are persisted
    // negatives: "checked, nothing found" — they let repeat lookups skip paid
    // API calls until the recheck window passes.
    lastCheckedAt: timestamp('last_checked_at'),
    // Agent detection metadata
    isAgent: boolean('is_agent').default(false),
    agentName: text('agent_name'), // "aixbt", "Luna", "Truth Terminal"
    agentFramework: text('agent_framework'), // "virtuals" | "elizaos" | "olas" | "custom" | null
    agentType: text('agent_type'), // "trading" | "social" | "defi" | "nft" | null
    agentTokenSymbol: text('agent_token_symbol'), // "$AIXBT", "$LUNA"
    agentDetectionSource: text('agent_detection_source'), // "known_list" | "bio_keyword" | "onchain_heuristic" | "manual"
    agentVerified: boolean('agent_verified').default(false),
  },
  (table) => [
    index('social_graph_twitter_idx').on(table.twitterHandle),
    index('social_graph_farcaster_idx').on(table.farcaster),
    index('social_graph_ens_idx').on(table.ensName),
    index('social_graph_fc_followers_idx').on(table.fcFollowers),
    index('social_graph_stale_at_idx').on(table.staleAt), // For finding stale records to refresh
    index('social_graph_last_checked_idx').on(table.lastCheckedAt),
    index('social_graph_is_agent_idx').on(table.isAgent),
    index('social_graph_agent_framework_idx').on(table.agentFramework),
  ]
);

// Curated seed data of known AI agent wallets
export const knownAgents = pgTable(
  'known_agents',
  {
    wallet: text('wallet').primaryKey(), // lowercase eth address
    name: text('name').notNull(), // "aixbt", "Luna", "Truth Terminal"
    framework: text('framework'), // "virtuals" | "elizaos" | "olas" | "custom"
    agentType: text('agent_type'), // "trading" | "social" | "defi" | "nft"
    tokenSymbol: text('token_symbol'), // "$AIXBT", "$LUNA"
    twitterHandle: text('twitter_handle'),
    farcaster: text('farcaster'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('known_agents_framework_idx').on(table.framework)]
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

    // Social graph write status tracking (Phase 2)
    socialGraphWriteStatus: text('social_graph_write_status'), // 'success' | 'partial' | 'failed' | null
    socialGraphWriteErrors: text('social_graph_write_errors').array(), // Array of error messages

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

// User accounts. `tier` is 'free' or one of the two closed legacy values;
// a pack purchase never changes it (credits live in credit_lots).
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
    walletsUsed: integer('wallets_used').default(0).notNull(), // lifetime wallets processed; gates nothing, kept as a usage record
    /**
     * Lifecycle mail opt-out, set by the unsubscribe endpoint. Honored by
     * every lifecycle send; transactional mail (magic links, purchase
     * sign-in) ignores it, because that mail is the account working.
     */
    emailOptOut: boolean('email_opt_out').default(false).notNull(),
    /**
     * The wallet that paid, for an account created by the x402 rail.
     * Lowercased, unique where present, NULL for every account that signed up
     * with an email. This is the identity such an account actually has: there
     * is no inbox behind `email`.
     */
    wallet: text('wallet'),
    /**
     * How this row came to exist. NULL means the magic-link signup, which is
     * every account that predates the column. `'x402'` marks a row minted by
     * an onchain payment, and several queries need to know: it is not a
     * signup, it is not churn, and it must never be mailed.
     */
    origin: text('origin'),
  },
  (table) => [
    index('users_email_idx').on(table.email),
    uniqueIndex('users_wallet_idx')
      .on(table.wallet)
      .where(sql`${table.wallet} IS NOT NULL`),
  ]
);

/**
 * One row per lifecycle email actually sent, so a send is at-most-once.
 *
 * `emailKey` names the email ('relaunch-trial-2026-08', 'welcome-1', ...).
 * The unique pair is the idempotency guard: a re-run campaign script or a
 * cron that catches up after a missed day cannot double-send.
 */
export const lifecycleEmails = pgTable(
  'lifecycle_emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emailKey: text('email_key').notNull(),
    /** When the row was claimed. Not proof of delivery: see confirmedAt. */
    sentAt: timestamp('sent_at').defaultNow().notNull(),
    /**
     * Written after the send returns success. NULL means the claim was taken
     * and never redeemed, which reclaimStaleClaims deletes so it retries.
     */
    confirmedAt: timestamp('confirmed_at'),
    /** Attempts made for this (user, key). Zero only on a pre-retry row. */
    attempts: integer('attempts').default(0).notNull(),
    /** When the last attempt failed. NULL means in flight, or delivered. */
    failedAt: timestamp('failed_at'),
    /** What the provider said, so a stuck row can be diagnosed. */
    lastError: text('last_error'),
  },
  (table) => [
    uniqueIndex('lifecycle_emails_user_key_idx').on(
      table.userId,
      table.emailKey
    ),
  ]
);

/**
 * Credit lots: one row per purchase, drawn down FIFO by expiry.
 *
 * ## Why lots and not a balance column
 *
 * Credits expire twelve months from purchase, so "how many does this account
 * have" is a question about time, not a number you can keep in a column. A
 * single balance would have to be swept by a job that knows every purchase
 * date, which is the lot table again with the audit trail thrown away.
 *
 * FIFO by `expiresAt`, so the credits closest to expiring are spent first. The
 * alternative, spending the newest first, quietly maximises how much expires
 * unused, which would be a design that profits from the customer forgetting.
 *
 * ## The unit is a MATCH, not a submitted wallet
 *
 * `remaining` counts wallets we resolved to an X handle or a Farcaster account.
 * A miss costs the buyer nothing. That is the whole pricing position, and it is
 * only honest if the meter is enforced here rather than described in copy: the
 * same predicate as `lookup_jobs.any_social_found`, which is
 * `twitter_handle || farcaster`.
 *
 * ## Expiry is enforced in the query
 *
 * Every read filters `expires_at > now()`. Nothing sweeps expired rows, because
 * a lot that has expired is still the record of a purchase that happened, and
 * deleting it would make revenue recognition unauditable. If expiry lived only
 * in the copy, deferred revenue would never clear.
 */
export const creditLots = pgTable(
  'credit_lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * `NO ACTION`, not `CASCADE`, unlike the four other keys to `users`.
     *
     * A purchase record must outlive the account that made it. Cascade would
     * make deleting a user silently delete the evidence that they paid, and 22
     * user rows were deleted in the current stats window by something outside
     * this repo. So deleting a user who holds credit lots now fails instead:
     * a loud failure is recoverable, a silent deletion is not.
     *
     * Applied by scripts/migrate-money-fks.ts.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Matches bought. Never mutated; spend is recorded in `consumed`. */
    granted: integer('granted').notNull(),
    /** Matches spent from this lot. Always <= granted. */
    consumed: integer('consumed').default(0).notNull(),
    /** Which pack, or 'grant' for anything issued by hand. */
    pack: text('pack').notNull(),
    /** Cents actually charged. 0 for a grant. Not derived from `pack`, because
     *  a price can change and this is the record of what was paid. */
    amountCents: integer('amount_cents').default(0).notNull(),
    stripePaymentId: text('stripe_payment_id'),
    /**
     * The onchain payment that bought this lot, as
     * `<network>:<from>:<nonce>` from the EIP-3009 authorization the payer
     * signed. NULL for a Stripe purchase or a hand grant.
     *
     * Deliberately not the transaction hash. On a facilitator timeout the hash
     * is unknown, and a `settlement_pending` response can carry one for a
     * transaction that was broadcast and never mined; the authorization is
     * known before settlement is attempted, and USDC itself refuses to honour
     * it twice.
     *
     * Deliberately not `stripe_payment_id` either. That column is read as
     * "this was a card sale" by `scripts/relaunch-report.ts` and
     * `lib/analytics.ts`, so an onchain reference in it would be counted as
     * Stripe revenue by every query that looks.
     */
    settlementId: text('settlement_id'),
    /** Which rail paid for this lot: `'stripe'`, `'x402'`, or NULL for a row
     *  that predates the column. Never backfilled by guessing. */
    rail: text('rail'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    /** Why a lot was granted by hand. Empty for a purchase. */
    note: text('note'),
  },
  (table) => [
    index('credit_lots_user_idx').on(table.userId),
    // The drawdown query: this account's live lots, oldest expiry first.
    index('credit_lots_user_expiry_idx').on(table.userId, table.expiresAt),
    /**
     * One lot per Stripe payment. The webhook is retried on any non-2xx, and
     * without this a retry after a partial failure grants the pack twice.
     * `provisionPaidCheckout` already relies on the same guarantee for tiers.
     */
    uniqueIndex('credit_lots_stripe_payment_idx').on(table.stripePaymentId),
    /**
     * The same guarantee for the onchain rail. Partial rather than plain: a
     * bare unique index would also work, since Postgres treats NULLs as
     * distinct, but saying WHERE NOT NULL states the intent rather than
     * relying on the reader knowing that rule.
     */
    uniqueIndex('credit_lots_settlement_idx')
      .on(table.settlementId)
      .where(sql`${table.settlementId} IS NOT NULL`),
  ]
);

/**
 * Every debit, one row per job.
 *
 * Kept separate from the lots so a spend can be explained after the fact: which
 * job, how many matches, and which lots paid for it. A customer asking "what
 * happened to my credits" is answerable from this table alone.
 *
 * Also the free tier's meter. A free account has no lots, and its allowance is
 * a rolling 30-day window over these rows, which is what makes splitting a file
 * pointless: twenty runs of 500 debit exactly what one run of 10,000 debits.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * `NO ACTION`, not `CASCADE`. Same argument as `credit_lots.userId`: a
     * record of what somebody spent must outlive their account, so deleting a
     * user who holds ledger rows fails rather than silently succeeding.
     *
     * Applied by scripts/migrate-money-fks.ts.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Matches debited. Positive. */
    matches: integer('matches').notNull(),
    /** Wallets submitted, for the record. Never charged for. */
    walletsSubmitted: integer('wallets_submitted').default(0).notNull(),
    /** 'free' when the rolling allowance paid, otherwise 'lots'. */
    paidFrom: text('paid_from').notNull(),
    jobId: uuid('job_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('credit_ledger_user_idx').on(table.userId),
    // The free-tier window query: this account, last 30 days.
    index('credit_ledger_user_created_idx').on(table.userId, table.createdAt),
    /**
     * One debit per job. The worker can resume a job after a transport failure,
     * and without this a resumed job charges twice for the same matches.
     */
    uniqueIndex('credit_ledger_job_idx').on(table.jobId),
  ]
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
    index('analytics_events_type_created_idx').on(
      table.eventType,
      table.createdAt
    ),
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
    index('api_metrics_provider_created_idx').on(
      table.provider,
      table.createdAt
    ),
    index('api_metrics_job_id_idx').on(table.jobId),
  ]
);

// Daily aggregated statistics (computed nightly)
export const dailyStats = pgTable('daily_stats', {
  date: date('date').primaryKey(),
  totalLookups: integer('total_lookups').default(0).notNull(),
  totalWalletsProcessed: integer('total_wallets_processed')
    .default(0)
    .notNull(),
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
});

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

/**
 * One row per redeemed key-recovery challenge, so a challenge is single-use.
 *
 * The challenge is a stateless HMAC and needs no storage to verify. What needs
 * storing is that it has been spent: without it, anyone who sees a redeem
 * request can replay it from their own connection inside the five-minute
 * window and receive their own key, without ever reading the victim's reply.
 *
 * The hash rather than the token, because a table of live credentials is a
 * credential store whether or not anything ever copies it. The hash is enough
 * to recognise a replay.
 *
 * Deliberately NOT in the nightly dump. Every row is worthless five minutes
 * after it is written, so a restore would carry nothing but expired hashes.
 */
export const x402RecoveryRedemptions = pgTable(
  'x402_recovery_redemptions',
  {
    tokenHash: text('token_hash').primaryKey(),
    wallet: text('wallet').notNull(),
    redeemedAt: timestamp('redeemed_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [
    index('x402_recovery_redemptions_expires_idx').on(table.expiresAt),
  ]
);

// ============================================================================
// Public API Infrastructure
// ============================================================================

// API rate-limit presets ('developer', 'startup', 'enterprise'). Seeded,
// never sold; price_monthly is historical. See lib/api-plans.ts.
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
    endpoint: text('endpoint').notNull(), // route template, e.g. '/v1/wallet/{address}', never a concrete path
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

// IP-based rate limit buckets for unauthenticated UI endpoints
export const ipRateLimitBuckets = pgTable(
  'ip_rate_limit_buckets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipAddress: text('ip_address').notNull(),
    endpoint: text('endpoint').notNull(), // '/api/lookup', '/api/jobs'
    bucketKey: text('bucket_key').notNull(), // e.g., '2024-01-15T14' for hourly buckets
    count: integer('count').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ip_rate_limit_buckets_lookup_idx').on(
      table.ipAddress,
      table.endpoint,
      table.bucketKey
    ),
    index('ip_rate_limit_buckets_created_at_idx').on(table.createdAt),
  ]
);

// ============================================================================
// Audit Trail (Phase 4)
// ============================================================================

// Track changes to social_graph for debugging and pattern detection
export const socialGraphHistory = pgTable(
  'social_graph_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wallet: text('wallet').notNull(),
    fieldChanged: text('field_changed').notNull(), // 'twitter_handle', 'farcaster', 'ens_name', etc.
    oldValue: text('old_value'),
    newValue: text('new_value'),
    changedAt: timestamp('changed_at').defaultNow().notNull(),
    changeSource: text('change_source'), // 'web3bio', 'neynar', 'ens_onchain', 'manual'
  },
  (table) => [
    index('social_graph_history_wallet_idx').on(table.wallet),
    index('social_graph_history_changed_at_idx').on(table.changedAt),
    index('social_graph_history_field_changed_idx').on(table.fieldChanged),
  ]
);

/**
 * Where two attested sources name different accounts for the same wallet.
 *
 * A disagreement between two owner-attested sources is evidence, not noise for
 * whichever source wrote last to settle. Measured on 250 real conflicts: 54% of
 * the time our stored handle no longer resolves to any X account, and among the
 * cases where both handles are live, 90% of the time ours belongs to a person
 * who does not claim the wallet at all. A silent overwrite would discard that
 * signal; a silent keep goes on serving a handle that points at a stranger.
 *
 * Keyed by (wallet, platform, their_source) so one wallet can be in conflict
 * with more than one source without the rows fighting each other.
 */
export const handleConflicts = pgTable(
  'handle_conflicts',
  {
    wallet: text('wallet').notNull(),
    platform: text('platform').notNull().default('twitter'),
    ours: text('ours').notNull(),
    ourSources: text('our_sources').array(),
    theirs: text('theirs').notNull(),
    theirSource: text('their_source').notNull(),
    theirUserId: text('their_user_id'),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    // Moves on every sweep, so a conflict that quietly goes away stops being
    // surfaced without anybody deleting a row.
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at'),
    resolution: text('resolution'),
  },
  (table) => [
    primaryKey({ columns: [table.wallet, table.platform, table.theirSource] }),
    index('handle_conflicts_unresolved_idx').on(table.lastSeenAt),
  ]
);

// Types for insert/select
export type WalletCache = typeof walletCache.$inferSelect;
export type NewWalletCache = typeof walletCache.$inferInsert;
export type LookupHistory = typeof lookupHistory.$inferSelect;
export type NewLookupHistory = typeof lookupHistory.$inferInsert;
export type SocialGraph = typeof socialGraph.$inferSelect;
export type NewSocialGraph = typeof socialGraph.$inferInsert;
export type HandleConflict = typeof handleConflicts.$inferSelect;
export type NewHandleConflict = typeof handleConflicts.$inferInsert;
export type LookupJob = typeof lookupJobs.$inferSelect;
export type NewLookupJob = typeof lookupJobs.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
/**
 * The ingest tables, declared so the ORM knows they exist.
 *
 * ## Why they were missing, and why that mattered
 *
 * These seven were created by hand, by `scripts/migrate-*.ts`, and this file had
 * never heard of them. `drizzle-kit push` diffs this file against the database
 * and treats anything it cannot see as garbage, so on 2026-08-24 its plan opened
 * with `DROP TABLE ... CASCADE` on all of them plus one more: **4.25 million
 * rows, none of which are in the nightly backup.** `npm run db:push` is a
 * documented command in three files. It now refuses; see
 * `scripts/db-push-refuses.mjs`.
 *
 * ## They are read models
 *
 * Nothing here generates DDL, because no migration path in this repo runs
 * generated DDL: schema changes are hand-written SQL in `scripts/migrate-*.ts`.
 * These declarations exist so the tables are visible to the ORM and to anyone
 * reading this file for the shape of the database. Column types were read out of
 * the live database rather than copied from the migration scripts, so they
 * describe what is actually there.
 *
 * **Two things are deliberately not reproduced**, and both are named here rather
 * than left to look like oversights. Four of the indexes below are partial in
 * the database (`x_accounts_user_id_idx` and `x_accounts_last_live_user_id_idx`
 * are `WHERE ... IS NOT NULL`, `x_accounts_unreachable_idx` is
 * `WHERE status <> 'live'`), and the predicate is omitted here. And
 * `social_graph` carries two indexes this file still does not declare,
 * `social_graph_twitter_lower_idx` (an expression index on
 * `lower(twitter_handle)`) and `social_graph_twitter_user_id_idx`. Both are
 * omissions of *predicate*, not of existence, so nothing at runtime depends on
 * them: no migration path here generates DDL from this file. They would matter
 * to `drizzle-kit push`, which is exactly why push refuses rather than being
 * trusted to read this file correctly.
 *
 * ## The one that cannot be declared
 *
 * `farcaster_sweep_seen_1786631580832` holds 3.68M rows and 42% of the database
 * by size. Its name carries a timestamp because `lib/farcaster-sweep.ts` creates
 * it at runtime, so no static declaration can name it. Its un-suffixed twin
 * below is the empty original. That pair is an abandoned swap and the largest
 * reclaimable object here, but reclaiming it is storage cleanup rather than a
 * schema fix, and it needs the sweep's own expectations checked first: the sweep
 * restarts on 2026-09-01 and the empty twin means it currently has no dedupe
 * memory at all.
 *
 * `user_id` on `x_accounts` is an **X platform id, not `users.id`**. Never join
 * or cast it against one. The same is true of `last_live_user_id` here and of
 * `social_graph.twitter_user_id`.
 */
export const xAccounts = pgTable(
  'x_accounts',
  {
    handle: text('handle').primaryKey(),
    userId: text('user_id'), // X platform id. NOT users.id.
    displayName: text('display_name'),
    followers: integer('followers'),
    status: text('status').notNull(), // live | unavailable | not_found
    unavailableReason: text('unavailable_reason'),
    checkedAt: timestamp('checked_at').defaultNow().notNull(),
    lastLiveUserId: text('last_live_user_id'), // X platform id. NOT users.id.
  },
  (table) => [
    index('x_accounts_checked_at_idx').on(table.checkedAt),
    index('x_accounts_user_id_idx').on(table.userId),
    index('x_accounts_last_live_user_id_idx').on(table.lastLiveUserId),
    index('x_accounts_unreachable_idx').on(table.status),
  ]
);

export const walletHoldings = pgTable(
  'wallet_holdings',
  {
    wallet: text('wallet').notNull(),
    contract: text('contract').notNull(),
    chain: text('chain').notNull(),
    contractType: text('contract_type'),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.wallet, table.contract, table.chain] }),
    index('wallet_holdings_contract_idx').on(table.contract, table.chain),
  ]
);

export const seededContracts = pgTable(
  'seeded_contracts',
  {
    address: text('address').notNull(),
    chain: text('chain').notNull(),
    contractType: text('contract_type'),
    name: text('name'),
    symbol: text('symbol'),
    holdersImported: integer('holders_imported').default(0).notNull(),
    totalHolders: integer('total_holders'),
    firstSeededAt: timestamp('first_seeded_at').defaultNow().notNull(),
    lastSeededAt: timestamp('last_seeded_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.address, table.chain] })]
);

/** Every sweep checkpoint and budget counter, in five jsonb rows. */
export const ingestState = pgTable('ingest_state', {
  name: text('name').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const xHandleAttempts = pgTable(
  'x_handle_attempts',
  {
    handle: text('handle').primaryKey(),
    attempts: integer('attempts').default(0).notNull(),
    lastAttemptAt: timestamp('last_attempt_at').defaultNow().notNull(),
    lastReason: text('last_reason'),
  },
  (table) => [
    index('x_handle_attempts_last_attempt_idx').on(table.lastAttemptAt),
  ]
);

export const clankerUnresolvedIds = pgTable(
  'clanker_unresolved_ids',
  {
    identifier: text('identifier').primaryKey(),
    attempts: integer('attempts').default(0).notNull(),
    lastAttemptAt: timestamp('last_attempt_at').defaultNow().notNull(),
    lastReason: text('last_reason'),
  },
  (table) => [index('clanker_unresolved_ids_attempts_idx').on(table.attempts)]
);

/** The empty original. The live one carries a runtime timestamp suffix; see above. */
export const farcasterSweepSeen = pgTable('farcaster_sweep_seen', {
  wallet: text('wallet').primaryKey(),
});

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
export type IpRateLimitBucket = typeof ipRateLimitBuckets.$inferSelect;
export type NewIpRateLimitBucket = typeof ipRateLimitBuckets.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
export type MagicLinkToken = typeof magicLinkTokens.$inferSelect;
export type NewMagicLinkToken = typeof magicLinkTokens.$inferInsert;
export type SocialGraphHistory = typeof socialGraphHistory.$inferSelect;
export type NewSocialGraphHistory = typeof socialGraphHistory.$inferInsert;
export type KnownAgent = typeof knownAgents.$inferSelect;
export type NewKnownAgent = typeof knownAgents.$inferInsert;
