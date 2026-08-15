# Changelog

All notable changes to walletlink.social. Newest first.


### 2026-08-15 (Stripe Customers were never created)

- `createCheckoutSession` never set `customer_creation`, which defaults to
  `if_required`. A one-time card payment never requires a Customer, so Stripe
  created none: the account held **zero Customer objects** despite real
  completed sales. `customer_email` prefills the field, it does not create
  anything. Every payment therefore stored an empty `stripe_customer_id`, and
  the admin Users pane showed a dash in the Stripe column for every paying
  account. Now set to `always`.
- The Users pane falls back to the payment intent when no Customer exists, since
  historic sales have none and the payment intent identifies the sale in Stripe
  just as well. `/api/admin/users` now returns `stripePaymentId` for it.
- `''` is no longer written to `stripe_customer_id`. Callers derive it from
  `session.customer`, which is null whenever no Customer was created, and an
  empty string in an id column reads as "we have one and it is blank".


### 2026-08-15 (apex is canonical, and everything now agrees)

- Vercel now serves `walletlink.social` directly and 308-redirects `www` to it.
  The arrangement used to be reversed while `metadataBase`, `sitemap.ts`,
  `robots.ts` and every canonical tag declared the apex, so each of those
  published a URL that redirected.
- That split was the root cause of two separate failures. Stripe does not follow
  redirects, so the webhook registered against the redirecting host failed every
  delivery from 2026-01-17 and no payment ever provisioned an account. The X
  card crawler hit the same redirect on `og:image` and kept serving a stale card.
- `PRODUCTION_URL` moves to the apex, so the single resolver in `lib/site-url.ts`
  and the SEO declarations now state the same origin. No `www` literal remains in
  the codebase.
- The Stripe webhook endpoint has been repointed to the apex, which now answers
  directly rather than through a redirect.

**The rule this leaves behind:** a machine-to-machine URL must never point at a
redirect, and there must be exactly one declared origin.


### 2026-08-15 (Starter tier removed)

- Starter was retired on 2026-08-12 but survived in 42 places across 12 files,
  defended by a comment about keeping legacy accounts working. There were no
  legacy accounts: **zero users ever held it and zero payments were ever taken
  for it**, verified against production before removing anything.
- Removed from `UserTier`, the price and limit maps, the tier ladder, checkout,
  the webhook, the upgrade modal, the account chip and the analytics unions. New
  `PaidTier` names the tiers that can actually be bought, so signatures no longer
  spell the union out four different ways.
- **The cumulative-quota machinery went with it.** `TIER_QUOTA`, `walletQuota`
  and `walletsRemaining` existed solely because Starter capped at 10,000 wallets
  in total; every remaining tier has a per-lookup limit and nothing else.
  `walletsUsed` is still accumulated, now as a lifetime usage record that gates
  nothing, and is no longer reset on upgrade since that would only destroy it.
- `getUserAccess` now routes `users.tier` through a `normalizeTier()` rather than
  casting it. The column is free text, and an unrecognised value used to index
  the limit map to `undefined`, producing a broken lookup with no error rather
  than a clear failure.


### 2026-08-15 (share text overstated the match rate)

- The share card copy computed its match rate as
  `(twitterCount + farcasterCount) / totalWallets`, which counts everyone
  holding both an X handle and a Farcaster account twice. On a real
  1,057-wallet lookup it published **49%** for a result the product itself
  reported as **30.8%**: 190 people double-counted. It now uses the distinct
  reachable figure, the same one the results header states, passed in from the
  same predicate so the two cannot disagree.
- This is the overlap error `StatsCards` was already fixed for. It survived in
  `ShareButtons` because that component derives its own statistics rather than
  receiving them.


### 2026-08-15 (checkout provisioning, after a customer paid twice for nothing)

Two independent faults, either of which alone would have been survivable,
combined to take $198 from the first paying customer and give them nothing.

- **The webhook had never worked.** The endpoint registered in Stripe was
  `https://walletlink.social/api/webhook`, on the apex. Vercel serves this
  project from `www` and the apex 307-redirects, and Stripe does not follow
  redirects: it records a 3xx as a failed delivery. Every payment since the
  endpoint was created on 2026-01-17 succeeded in Stripe and provisioned
  nothing. Repointed to the `www` origin.
- **`NEXT_PUBLIC_URL` was never set in production**, so `createCheckoutSession`
  fell back to `http://localhost:3000` and built `success_url` against it. After
  paying, the buyer was redirected to a dead port on their own machine, assumed
  the payment had failed, and paid again. New `lib/site-url.ts` is the single
  resolver: explicit env var, then the known production origin, then the preview
  URL, then localhost only when genuinely not deployed. There is no longer a
  localhost fallback that production can reach.
- **`/api/auth/checkout-status` now grants the upgrade** instead of only
  reporting whether some other system had. It was already asking Stripe and
  already knew `payment_status === 'paid'`. Had it acted on that, the webhook
  outage would have been invisible to customers.
- **Provisioning is one function.** `provisionPaidCheckout()` is idempotent on
  the payment intent and books the sale itself, so a grant cannot happen without
  the revenue being recorded, and the two paths racing cannot double-count.
- `payment_completed` was previously tracked as a floating promise the
  serverless runtime was free to discard, and the `payment_intent.succeeded`
  path recorded no sale at all. Both fixed.
- A missing key or webhook secret no longer reports as "signature verification
  failed". Config errors are their own type and answer 500, so Stripe retries
  rather than discarding the event.
- **Revenue is read from Stripe, net of refunds**, instead of being inferred
  from each user's tier. The dashboard mapped `pro` to $99 and `unlimited` to
  $249, which is entitlement rather than income: it invented revenue for
  complimentary accounts and could not see a refund at all. With one $99 sale,
  one refunded $99 duplicate and a goodwill upgrade, it reported $249 against an
  actual net of $99. New `/api/admin/revenue`.
- Accounts holding more than they paid for are now reported as complimentary,
  including the partial case where someone bought Pro and was moved to
  Unlimited. An email-only check would still have implied $249.
- `isStripeConfigured()` no longer requires `STRIPE_PRICE_STARTER`. Starter was
  retired on 2026-08-12 and checkout rejects it, so gating on its price id meant
  deleting a dead env var would 503 every purchase.


### 2026-08-14 (AI assistant on the marketing site)

- Floating chat bubble backed by Cloudflare AI Search over both
  `docs.walletlink.social` (13 pages) and the marketing site (33 pages).
  New `components/DocsChat.tsx`, mounted in the root layout, hidden on
  `/admin` and `/success`, loaded `lazyOnload` so 115 KB stays off the
  critical path.
- Everything is served from `help.walletlink.social`, a **proxied** CNAME, so
  queries and the widget bundle both pass through our zone. The public
  endpoint is unauthenticated and spends Workers AI neurons per answer, so the
  zone is where that spend is bounded: 8 req/10s per IP at the WAF, 20 req/60s
  at the endpoint.
- A system prompt enforces the two rules the corpus cannot: never name a data
  provider, and never merge "~23% has an identity" with "~13% is reachable".
  Both verified against the live endpoint. See `docs/AI-SEARCH.md`.

### 2026-08-14 (public docs site + API source-leak fix)

**`sources` no longer leaks the data supply chain**

- `/v1/wallet`, `/v1/batch` and both `/v1/reverse` endpoints returned the raw
  `social_graph.sources` array, which contains literal vendor names. New
  `lib/api-sources.ts` maps them to evidence classes (`onchain`, `farcaster`,
  `manual`, `aggregated`) on an **allowlist**, so an unmapped internal source is
  dropped rather than published. Breaking change to those response bodies.

**Docs site**

- New `docs-site/` holding the Mintlify content for docs.walletlink.social:
  13 pages covering the concepts and a full `/v1` API reference, written
  against the route handlers rather than against this README.
- `docs-site/` is the *only* publishable folder. `docs/` stays internal, since
  `docs/SECURITY.md` is the backup and restore runbook.
- Freshness is enforced, not requested: `.github/pull_request_template.md` asks
  for an explicit docs decision and `.github/workflows/docs-freshness.yml`
  fails any PR that changes the public API surface without touching
  `docs-site/` (escape hatch: the `no-docs-needed` label).
- Corrected the Public API section above: those plans are tier benefits, not
  monthly subscriptions.

### 2026-08-12 (daily collection seed cron)

**Top/trending collections and tokens → holder lists → the graph**

- New `lib/seed-collections.ts` + `/api/cron/seed-collections` (07:00 UTC):
  one NFT collection per chain (Ethereum, Base, Robinhood Chain) and one
  trending token on Ethereum + Base per day, holders capped at 2,000 per
  contract, queued through the normal lookup pipeline as visible
  `seed_cron` jobs — Recent Activity now shows real collections with real
  match stats.
- Discovery: OpenSea top+trending (uses `OPENSEA_API_KEY`, or auto-provisions
  a temp key — capped at 2/day, so treat it as best-effort);
  GeckoTerminal trending pools (keyless); Blockscout holders-ranked list as
  the keyless Robinhood fallback. Denylists filter infra tokens (WETH/USDC…)
  and infra NFTs (Uniswap positions et al.) whose holder lists aren't
  audiences.
- Selection is novelty-aware via the new `seeded_contracts` table (30-day
  re-seed window), so the cron works down the rankings instead of re-buying
  the top 10.
- New `wallet_holdings` table records wallet ↔ contract edges at seed time —
  the audience-graph data ("holders of X") that social resolution alone
  can't provide. Migration: `scripts/migrate-seed-tables.ts` (applied).

### 2026-08-12 (ENS text-record harvest)

**Onchain com.twitter / com.github records → social_graph**

- New `lib/ens-harvest.ts`: scans mainnet TextChanged logs (both the 3-arg
  pre-2023 and 4-arg 2023+ signatures, topic-filtered to the two keys, any
  resolver), then resolves each node's CURRENT values fully onchain —
  registry → resolver → `text()`/`addr()` via Multicall3. No subgraph, no
  third-party indexer, no node→name healing needed: `text()` works on node
  hashes directly.
- These are the highest-quality Twitter edges that exist (the wallet owner
  set the handle onchain themselves): source `ens_onchain`,
  `twitter_verified`, quality 50 — below the 70 trust line because the
  Farcaster side was never checked. Fill-only upserts: never overwrite an
  existing handle; `last_updated_at` moves only when something was filled.
- Checkpointed in the new `ingest_state` table
  (`scripts/migrate-ingest-state.ts`, applied 2026-08-12); the daily Vercel
  cron (`/api/cron/ens-harvest`, 05:00 UTC) scans ~7,200 new blocks per day.
- CLI: `npx tsx --env-file=.env.local scripts/ens-harvest.ts
  --backfill | --incremental`. Interrupt-safe.
- The ENS registry address comes from ethers' network config, not a typed
  constant — a wrong registry address fails silently (every `resolver()`
  read returns `0x`), which is exactly what happened on the first attempt.

### 2026-08-12 (Farcaster protocol sweep)

**Bulk-ingest every Farcaster verified wallet into social_graph**

- New `lib/farcaster-sweep.ts`: sweeps Neynar `/user/bulk` (100 FIDs/call,
  1 credit/FID — a full network sweep is ~3.3M of the free tier's 10M monthly
  credits) and upserts every verified + custody ETH address with username,
  FID, and follower count. Sources tagged `farcaster_sweep`.
- Swept rows are deliberately medium quality (score 45, no `last_checked_at`):
  they carry Farcaster data but were never checked for Twitter, so lookups
  use them as base data and still resolve the remaining fields. Sweep upserts
  never touch Twitter/ENS/Lens/GitHub columns, and `last_updated_at` only
  moves on identity changes so re-sweeps don't trigger "new matches" badges.
- Daily incremental Vercel cron (`/api/cron/farcaster-sweep`, 05:30 UTC)
  ingests newly registered FIDs (sequential, so new = above max known fc_fid).
- Monthly full re-sweep via GitHub Actions
  (`.github/workflows/farcaster-sweep.yml`) — requires `DATABASE_URL` and
  `NEYNAR_API_KEY` repository secrets.
- CLI: `npx tsx --env-file=.env.local scripts/farcaster-sweep.ts
  --full | --incremental | --range A B`. Idempotent, safe to interrupt.

### 2026-08-12 (negative-result persistence)

**Stop re-buying API calls for wallets known to have no socials**

- `social_graph` now persists negative results: wallets that completed the full
  external pipeline with nothing found get a row (all socials NULL,
  `sources=['none']`) with a new `last_checked_at` column. Repeat lookups skip
  all paid API calls for 30 days. Previously this knowledge lived only in the
  7-day `wallet_cache` — the graph held ~5k positives out of ~86k wallets ever
  checked, so ~80% of every repeat list was re-purchased.
- False-negative protection: `batchFetchNeynar`/`batchFetchWeb3Bio` now report
  failed wallets (timeouts, 429s, 5xx) separately from genuine not-founds, and
  failures are never persisted as negatives. Fast-mode and Neynar-disabled runs
  don't persist negatives either (incomplete pipeline).
- All `social_graph` readers updated for rows without socials: v1 API
  wallet/batch report `found: false` (with `checked_at` to distinguish
  "never seen"), stats/analytics denominators count positives only, the
  refresh-stale cron skips negatives, and "new matches" badges ignore
  negative re-checks.
- Migration: `scripts/migrate-negative-persistence.ts` (applied 2026-08-12).

### 2026-08-12 (later)

**Pricing and packaging changes**

- **Pro: $149 → $99**, and contract import moved down from Unlimited into Pro
- **Free per-lookup limit: 1,000 → 500**
- **New analytics events**: `checkout_redirected`, `checkout_failed`; `limit_hit` wired up
- Revenue math in the webhook, admin dashboard and analytics updated to 9900 cents

Driven by the funnel: 41 checkout sessions started, 0 completed. Free gave 1,000 wallets
per lookup with unlimited lookups and ungated CSV export, leaving Pro with little to sell.

**Deploy order matters:** the `$99` Stripe price must exist and `STRIPE_PRICE_PRO` must
point at it *before* this ships, or the site advertises $99 and charges $149.

### 2026-08-12

**Robinhood Chain support for contract import**

- **New network**: Contract import now supports Robinhood Chain (chain ID 4663) alongside Ethereum and Base
  - NFT (ERC-721/1155) holder lookups via Alchemy's NFT API on `robinhood-mainnet`
  - Requires `ROBINHOOD_MAINNET` to be enabled for the app in the Alchemy dashboard
  - Verified against onchain `ownerOf` enumeration: Alchemy returned exactly the same
    618 holders for StonkBrokers (4,444 tokens) with no gaps in either direction
- **ERC-20 gap handled explicitly**: Moralis has no holder index for Robinhood, so token
  lookups on that network now fail with a clear message instead of an opaque API error.
  The import modal warns before the request is made.
- **New `lib/chains.ts`**: Chain constants (`SUPPORTED_CHAINS`, `CHAIN_LABELS`, `CHAIN_IDS`)
  split into a dependency-free module. `lib/contract-holders.ts` imports `ethers` at module
  scope, so client components importing chain values from it would ship ethers to the browser.
- **Chain selector is now data-driven**: `ContractImportModal` maps over `SUPPORTED_CHAINS`
  instead of hardcoding radio buttons, so adding a network is a one-line change.
- **Moralis no longer gates NFT imports**: `/api/contract-holders` previously returned 503
  when `MORALIS_API_KEY` was unset, blocking NFT lookups that only need Alchemy.
- **Clearer errors**: New `UNSUPPORTED_CHAIN`, `CHAIN_NO_NFT_SUPPORT`, and
  `CHAIN_NO_ERC20_SUPPORT` codes replace a raw TypeError on unknown networks.

### 2025-01-21

**Admin analytics dashboard + IP rate limiting**

- **Admin analytics dashboard**: New "Dashboard" tab in admin panel with comprehensive usage metrics
  - Period selector: Today / Last 7 days / Last 30 days with comparison to previous period
  - Usage metrics: Lookups, wallets processed, match rate, avg processing time (with % change)
  - Match analytics: Twitter/Farcaster/any rates with progress bars and 7-day sparkline trends
  - Performance monitoring: Queue status (pending/running), success rate, stage distribution
  - Recent activity table: Last 5 completed jobs with match stats
  - New endpoint: `GET /api/admin/dashboard?period=today|week|month`
- **IP-based rate limiting**: Prevents abuse from unauthenticated users
  - 3 requests per hour on `/api/lookup` and `/api/jobs` per IP address
  - Atomic UPSERT prevents race conditions under concurrent load
  - Supports proxy headers: `x-forwarded-for`, `x-vercel-forwarded-for`, `cf-connecting-ip`
  - Returns standard rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, etc.)
  - Fails open if database unavailable (allows requests but logs warning)
  - New table: `ip_rate_limit_buckets` with hourly bucket granularity

**Database migration required**:
```sql
CREATE TABLE IF NOT EXISTS ip_rate_limit_buckets (
  ip_address TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (ip_address, endpoint, bucket_key)
);
```

---

### 2025-01-18

**New Starter tier + API optimization**

- **Starter tier ($49)**: New entry-level paid tier with 10,000 wallets cumulative (total across all lookups)
  - All Pro features (ENS, follower counts, priority scoring, history)
  - Quota-based instead of per-lookup limits
  - `wallets_used` column tracks cumulative usage
- **API pipeline optimization**: Neynar runs first (fast batch API), then Web3Bio only for wallets without Twitter
  - Expected 30-60% reduction in Web3Bio API calls
  - Separate stage indicators: `neynar` then `web3bio` instead of `web3bio+neynar`
- **PROJECT_OVERVIEW.md**: New comprehensive context document for LLMs

**Database migration required**:
```sql
ALTER TABLE users ADD COLUMN wallets_used INTEGER NOT NULL DEFAULT 0;
```

---

**Scalability audit: fixes for high-load scenarios**

Critical fixes (P0):
- **Inngest concurrency**: Increased from 10 to 100 concurrent jobs - 50 jobs now start in ~5s vs ~250s
- **API timeouts**: Added 15-second timeouts to all external API calls (Web3.bio, Neynar, ENS) - prevents jobs from hanging indefinitely
- **Rate limit race condition**: Fixed with atomic UPSERT - accurate counting under high concurrency
- **Connection pooling**: Added optional Neon pooler support (`USE_CONNECTION_POOLING=true`) - reduces p95 latency from 200-500ms to 50-100ms
- **Cache state loss bug**: Fixed Inngest step serialization issue that was discarding cache hits - 2-3x faster processing

High priority fixes (P1):
- **Debounced search**: 300ms debounce on ResultsTable search - eliminates 1-2s lag with 10K+ results
- **Parallel cron processing**: Process 5 jobs simultaneously instead of 1 - 5x faster queue clearing
- **Adaptive polling**: Starts at 2s, increases to 5s when idle - ~60% reduction in server requests
- **Composite indexes**: Added `(status, created_at)` and `(user_id, created_at)` indexes for faster queries
- **COUNT aggregates**: Replaced full table scans with `COUNT(*) FILTER` - ~99% faster stats queries

Additional fix:
- **Neynar 404 handling**: Gracefully handles batches where no addresses have Farcaster accounts

**Database migrations required**:
```sql
CREATE INDEX IF NOT EXISTS lookup_jobs_status_created_idx ON lookup_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS lookup_history_user_created_idx ON lookup_history (user_id, created_at);
```

### 2025-01-17 (Evening)

**Admin Wallet Enrichment feature**
- **Manual wallet enrichment**: New "Enrichment" tab in admin panel for adding/editing social data
  - Search any wallet address to view existing social_graph data
  - Add Twitter, Farcaster, or ENS manually with 'manual' source tag
  - Recent manual edits list for quick reference
- **New API endpoint**: `POST /api/admin/social-graph` for admin wallet enrichment

**New matches notifications**
- **Enrichment badges**: "X new matches" badge appears on lookups when wallets have been enriched since last view
- **Row highlighting**: Enriched wallets highlighted with green background + "NEW" badge in results table
- **View tracking**: `lastViewedAt` timestamp tracks when users load lookups for accurate "new" detection
- **Automatic clearing**: Badges clear after user views the lookup (read-receipt pattern)

**Input source tracking**
- **Source column in admin history**: Shows whether lookup came from "File" (upload) or "Paste" (text input)
- **Color-coded badges**: Blue for file uploads, purple for text input
- **New database column**: `input_source` on `lookup_history` table

**Database migrations required**:
```sql
ALTER TABLE lookup_history ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMP;
ALTER TABLE lookup_history ADD COLUMN IF NOT EXISTS input_source TEXT;
```

### 2025-01-17

**Public API infrastructure**
- **Subscription API product**: New `/api/v1/` endpoints for external developers to access social_graph data
- **API key management**: Generate, validate, revoke, and rotate API keys with SHA-256 hashing
- **Three pricing tiers**: Developer ($49/mo), Startup ($199/mo), Enterprise ($799/mo)
- **Rate limiting**: Multi-tier sliding window limits (per-minute, daily, monthly) with `X-RateLimit-*` headers
- **Usage tracking**: Per-request analytics for billing and monitoring
- **Core endpoints**:
  - `GET /api/v1/wallet/[address]` - Single wallet lookup (1 credit)
  - `POST /api/v1/batch` - Batch lookup up to plan limit (1 credit/wallet)
  - `GET /api/v1/reverse/twitter/[handle]` - Find wallets by Twitter (2 credits)
  - `GET /api/v1/reverse/farcaster/[username]` - Find wallets by Farcaster (2 credits)
  - `GET /api/v1/stats` - Dataset statistics (free)
  - `GET /api/v1/usage` - API key usage stats (free)
- **Developer endpoints**: `/api/developer/keys`, `/api/developer/plans`, `/api/developer/usage`
- **New database tables**: `api_plans`, `api_keys`, `api_usage`, `rate_limit_buckets`

**Processing modal redesign**
- **Animated activity indicators**: Spinning ring + pulse effect shows processing even at 0%
- **Pipeline visualization**: 4-stage progress (Cache → Web3.bio → Farcaster → ENS) with active stage highlighting
- **Shimmer effects**: Progress bar has animated shimmer and sliding gradient when idle
- **Color-coded stats**: Twitter (sky) and Farcaster (violet) badges pulse when finding new matches
- **Job restoration fix**: Returning to page now properly restores stage info and animations

**New comparison pages**
- **`/vs/blaze`**: Compare against Blaze Web3 CRM ($79/month) - highlights Farcaster support and one-time pricing
- **`/vs/holder`**: Compare against Holder.xyz wallet messaging platform - emphasizes lookup focus vs CRM
- **SEO improvements**: Shortened titles, added keywords, Twitter cards, enhanced JSON-LD, internal linking between all /vs/ pages

**My lookups: Tiered history + Add addresses feature**
- **Renamed "Recent Lookups" to "My lookups"**: Better reflects user ownership
- **Tiered history visibility**: Free users see 1 lookup, Pro/Unlimited see full history with pagination
- **Add addresses to lookups (Pro+)**: Click "+" on any lookup to add more addresses
  - New AddAddressesModal with file upload and paste support
  - Deduplicates addresses already in the lookup
  - Merges new results with existing, preserving source tracking
  - Choose to add to existing lookup or create new one
- **Updated Upgrade modal**: Now lists history and add-to-lookups as Pro+ features
- **Updated vs/addressable page**: New comparison rows for Lookup History and Add to Lookups

**Admin dashboard enhancements**
- **Tabbed admin UI**: New tabs for Activity, Jobs, History, and Users management
- **Activity tab**: View/hide/delete completed jobs from public Live Activity feed
- **Jobs tab**: Monitor all jobs, filter by status, retry failed jobs, cancel stuck ones
- **History tab**: View/search/delete lookup history by user ID
- **Users tab**: View users by tier, change tiers via dropdown for manual upgrades
- **Hidden jobs**: New `hidden` column to hide spam/test lookups from public feed
- **New admin endpoints**: `/api/admin/activity`, `/api/admin/jobs`, `/api/admin/history`, `/api/admin/users`
- **Fixed match rate calculation**: Now uses `anySocialFound` instead of double-counting Twitter + Farcaster

**UX improvements**
- **Wallet limit warning**: Shows banner when uploaded file exceeds tier limit (before clicking Start)
- **Updated time estimates**: Processing now shows ~10s per 1K wallets (was incorrectly showing ~2min)
- **Live Activity filter**: Now hides lookups with fewer than 25 wallets
- **Copy refinements**: "Farcaster" instead of "FC", curly apostrophes, sentence case headings
- **Fixed Live Activity rate**: Now shows deduplicated "any social" rate (14.5%) instead of inflated sum (22%)
- **New `any_social_found` column**: Tracks unique wallets with Twitter OR Farcaster (not double-counting)

### 2025-01-16

**SEO & positioning**
- **Addressable alternative positioning**: New `/vs/addressable` comparison page
- **SEO meta tags**: Optimized title, description, and Open Graph tags for search visibility
- **Comparison content**: Feature comparison showing advantages over Addressable

**Live Activity improvements**
- **Industry average comparison**: Shows "9x industry avg" badge (vs ~2.5% baseline)
- **Cleaner copy**: Simplified homepage messaging and AccessBanner text

### 2025-01-15

**Tiered pricing with Stripe integration**
- **Three tiers**: Free (500 wallets), Pro (5,000 wallets, $99), Unlimited ($249)
- **Stripe Checkout**: One-time payment flow with automatic tier upgrade
- **Admin whitelist**: Manual unlimited access grants via `/admin` dashboard
- **Access control**: Tier-based limits enforced on frontend and backend
- **User database**: New `users` and `whitelist` tables for access management

**UI overhaul - Stripe-inspired design**
- **New color scheme**: Indigo accent color (`#635bff`) replacing green
- **Card-based layout**: Clean cards with subtle shadows and borders
- **Improved typography**: Better hierarchy and spacing throughout
- **Dark mode polish**: Refined dark theme with proper contrast
- **Consistent styling**: Buttons, inputs, and badges unified

**Rebrand to walletlink.social**
- **New domain**: Rebranded from previous name to walletlink.social
- **App icon**: Custom wallet emoji icon as favicon and header logo
- **Header clickable**: Logo/title returns to homepage from any state

**Performance optimizations**
- **Table virtualization**: ResultsTable uses `@tanstack/react-virtual` for 13K+ rows
- **Component memoization**: React.memo, useMemo, useCallback throughout
- **Reduced re-renders**: Optimized polling to avoid unnecessary state updates

**Live Activity redesign**
- **Card-based tiles**: Horizontal scrolling cards showing recent lookups
- **Pulsing indicator**: Green dot animation for "live" feel
- **Social proof**: Shows wallet count, Twitter/FC found, and match rate %

### 2025-01-14

**User-specific history + public wins showcase**
- **Private "Recent lookups"**: Each user only sees their own lookup history (localStorage ID until profiles)
- **"Recently processed" showcase**: Public tiles showing successful lookups (>10% social rate) as social proof
  - Updates every 3 minutes via polling
  - Shows wallet count, Twitter/Farcaster counts, and social hit rate %
- **Removed data source references**: Cleaner UI without Web3.bio/Neynar attribution in footer and results table
- **New database columns**: `user_id` on `lookup_history` and `lookup_jobs` tables

**Major performance optimizations + Inngest integration**
- **Parallel API calls**: Web3.bio and Neynar now run concurrently (saves 2-3s per batch)
- **Parallel Neynar batches**: Process 5 batches simultaneously instead of sequentially (5x faster)
- **Increased ENS batch size**: 50 wallets per batch instead of 20 (2.5x faster)
- **Larger chunk size**: 3000 wallets per cron invocation instead of 2000 (50% more throughput)
- **Inngest integration**: Optional workflow orchestration for 10-50x faster processing
  - Install: `npm install inngest` and add `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` env vars
  - Processes wallets in 500-wallet micro-batches with durable checkpoints
  - Falls back to cron worker if Inngest not configured
- **Estimated speedup**: 13k wallets now ~2-3 minutes (was ~17 minutes)

**Persist job ID across page refresh**
- Saves active job ID to localStorage so progress survives page refresh
- Automatically restores in-progress job state on page load
- Fixes issue where refreshing the page would lose connection to running job

**Add estimated processing time**
- Shows estimated time when file is uploaded (based on wallet count)
- Shows time remaining during processing (based on actual rate)

**Smooth progress bar animation**
- Progress counter animates smoothly instead of jumping in chunks
- Creates responsive feel during batch processing

**Add background job queue for large wallet lookups**
- New job queue system handles batches of any size without timeout
- Vercel Cron worker processes jobs in chunks (2000 wallets per invocation)
- Jobs persist in database and resume automatically if interrupted
- Frontend polls for progress instead of SSE streaming
- Users can close browser tab and retrieve results from History later
- New `lookup_jobs` table tracks job status, progress, and partial results
- New API endpoints: `POST /api/jobs`, `GET /api/jobs/[id]`, `POST /api/jobs/worker`

**Add browser notification on lookup complete**
- Opt-in checkbox to receive browser notification when long lookups finish
- Uses native Web Notifications API (no dependencies)
- Shows count of Twitter/Farcaster accounts found
- Click notification to focus the app tab

**Add Excel (.xlsx) file upload support**
- New file format support: upload .xlsx files in addition to CSV
- Unified file parser abstraction (`lib/file-parser.ts`) for extensibility
- Uses `read-excel-file` library (~50KB) for efficient Excel parsing
- Auto-detects wallet/address column in Excel files (same logic as CSV)
- Preserves extra columns from Excel files
- 10MB file size limit with clear error messaging

### 2025-01-14

**Add permanent social graph database** (`868e2bd`)
- New `social_graph` table stores all wallets with discovered social accounts permanently
- Merge & update strategy: new data fills gaps, follower counts update, existing data preserved
- Enrichment: backfills results from social graph after API calls complete
- Indexed on twitter_handle, farcaster, ens_name, fc_followers for future query capabilities
- Tracks firstSeenAt, lastUpdatedAt, and lookupCount per wallet

**Add dark mode with system preference toggle** (`9c414c0`)
- Dark mode support with automatic system preference detection
- Toggle cycles through System/Light/Dark modes
- Preference saved to localStorage

### 2025-01-13

**Add holdings, priority score, and enhanced export features** (`c1c77e2`)
- Holdings/Value column: auto-detects value columns from CSV (Peak index DTF value, balance, holdings, etc.), displays with $X,XXX.XX formatting
- Priority Score column: calculates `holdings × log₁₀(fcFollowers + 1)` with 5-bar visual indicator
- Top Influencers filter: quick filter button for accounts with 1K+ Farcaster followers
- Click-to-copy wallet: truncated `0x1234...abcd` display with clipboard copy and "Copied!" toast
- Twitter List export: new button to generate `.txt` file with @handles (one per line) for Twitter list import
- Enhanced CSV export: includes all columns (wallet, ens, holdings, twitter, farcaster, fc_followers, priority_score, source), sorted by priority score descending

**Format codebase with Prettier** (`2bd28ff`)
- Added Prettier configuration and formatted all source files

### Previous Updates

**Add Web3.bio API key support** (`f75c0fd`)
- Support for Web3.bio API key to increase rate limits

**Add warning for ENS with large wallet batches** (`2fc0aa4`)
- Show warning when using ENS lookup with >1000 wallets (may timeout)

**Speed up lookups to avoid Vercel timeout** (`b7e6899`)
- Optimized batch processing to complete within Vercel's function timeout limits

**Add ENS text record lookups for onchain Twitter handles** (`b38f945`)
- Query ENS text records directly onchain for the most accurate Twitter handle data
- Optional toggle (slower but more reliable than API sources)

**Add Neon database integration for caching and history** (`96f3780`)
- 24-hour result caching to speed up repeated lookups
- Lookup history feature to save and reload previous searches

**Initial commit: Wallet Social Lookup app** (`0ecff9d`)
- Core wallet-to-social lookup functionality
- Web3.bio and Neynar API integration
- CSV upload and export

---

