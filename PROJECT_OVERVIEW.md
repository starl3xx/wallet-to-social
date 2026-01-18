# PROJECT_OVERVIEW.md

> Comprehensive context document for LLMs working on walletlink.social

## Quick Summary

**walletlink.social** is a Next.js 16 application that resolves Ethereum wallet addresses to social profiles (Twitter/X, Farcaster, ENS, Lens, GitHub). Users upload a CSV of wallet addresses and receive enriched data showing which wallets have associated social accounts - useful for community outreach, airdrop targeting, and influencer identification.

**Live URL**: https://walletlink.social

---

## Product Overview

### Core Value Proposition
- Upload CSV with wallet addresses → get Twitter/Farcaster handles for those wallets
- Industry average match rate is ~2.5%; this tool achieves 15-25% match rates
- One-time payment model (not subscription) for paid tiers

### User Tiers

| Tier | Price | Per-Lookup Limit | Total Quota | Key Features |
|------|-------|------------------|-------------|--------------|
| Free | $0 | 1,000 wallets | Unlimited lookups | Basic CSV export, 1 saved lookup |
| Starter | $49 | 10,000 wallets | 10,000 total cumulative | All Pro features, quota-based |
| Pro | $149 | 10,000 wallets | Unlimited lookups | ENS lookups, follower counts, priority scoring, full history |
| Unlimited | $420 | Unlimited | Unlimited | Everything + priority support |

**Key distinction**: Starter tier has a *cumulative* quota (10K wallets total across all lookups), while Pro has a *per-lookup* limit (10K per lookup, unlimited lookups).

### User Flow
1. User uploads CSV/Excel with wallet addresses
2. System detects wallet column and optional holdings/value columns
3. User clicks "Start Lookup" → background job processes wallets
4. Progress shown in real-time with stage indicators (cache → neynar → web3bio → ens)
5. Results displayed in sortable/filterable table
6. User exports as CSV or Twitter list (.txt)

---

## Technical Architecture

### Stack
- **Framework**: Next.js 16 with App Router
- **Database**: Neon PostgreSQL with Drizzle ORM
- **Styling**: Tailwind CSS v4
- **UI Components**: Radix UI primitives
- **Payments**: Stripe (one-time checkout)
- **Email**: Resend (magic link auth)
- **Hosting**: Vercel

### Project Structure

```
wallet-to-social/
├── app/
│   ├── page.tsx              # Main upload/results page
│   ├── admin/page.tsx        # Admin dashboard
│   ├── vs/                   # Competitor comparison pages (SEO)
│   │   ├── addressable/
│   │   ├── blaze/
│   │   └── holder/
│   └── api/
│       ├── jobs/             # Job queue endpoints
│       ├── history/          # Lookup history CRUD
│       ├── auth/             # Magic link authentication
│       ├── checkout/         # Stripe checkout
│       ├── webhook/          # Stripe webhooks
│       ├── admin/            # Admin-only endpoints
│       ├── developer/        # API key management
│       └── v1/               # Public API endpoints
├── components/
│   ├── FileUpload.tsx        # CSV/Excel upload dropzone
│   ├── ResultsTable.tsx      # Virtualized results table
│   ├── UpgradeModal.tsx      # Pricing/checkout modal
│   ├── AccessBanner.tsx      # Tier badge display
│   ├── LookupHistory.tsx     # Saved lookups sidebar
│   └── admin/                # Admin dashboard components
├── lib/
│   ├── job-processor.ts      # Core lookup processing logic
│   ├── web3bio.ts            # Web3.bio API client
│   ├── neynar.ts             # Neynar API client (Farcaster)
│   ├── ens.ts                # ENS onchain lookups
│   ├── access.ts             # Tier/quota management
│   ├── stripe.ts             # Stripe checkout
│   ├── cache.ts              # 24h wallet cache
│   ├── social-graph.ts       # Permanent social data storage
│   └── analytics.ts          # Event tracking
└── db/
    ├── schema.ts             # Drizzle schema definitions
    └── index.ts              # Database connection
```

### Data Flow

```
CSV Upload
    ↓
Parse wallets + detect holdings column (lib/csv-parser.ts)
    ↓
Create background job (POST /api/jobs)
    ↓
Job processor runs (lib/job-processor.ts):
    1. Check wallet_cache (24h TTL)
    2. Run Neynar batch API (fast - 200 wallets/request)
    3. Run Web3Bio for wallets without Twitter (slow - 1 request/wallet)
    4. Optional: ENS onchain lookups
    5. Enrich from social_graph (permanent storage)
    6. Cache results, persist positive results to social_graph
    ↓
Frontend polls /api/jobs/[id] for progress
    ↓
Results displayed in ResultsTable (virtualized)
    ↓
Export to CSV or Twitter list
```

---

## Database Schema

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `wallet_cache` | 24h TTL cache for API results | wallet, twitter_handle, farcaster, ens_name, cached_at |
| `social_graph` | Permanent storage of all discovered social links | wallet, twitter_handle, farcaster, fc_followers, sources[], first_seen_at |
| `lookup_jobs` | Background job queue | status, wallets[], processed_count, partial_results, twitter_found |
| `lookup_history` | Saved lookup sessions | user_id, wallet_count, results (JSONB), input_source |
| `users` | User accounts and tiers | email, tier, stripe_customer_id, wallets_used |
| `whitelist` | Admin-granted unlimited access | email, wallet, note |

### API Infrastructure Tables

| Table | Purpose |
|-------|---------|
| `api_plans` | Subscription tiers (developer/startup/enterprise) |
| `api_keys` | External API keys with SHA-256 hashing |
| `api_usage` | Per-request usage tracking |
| `rate_limit_buckets` | Sliding window rate limiting |

### Analytics Tables

| Table | Purpose |
|-------|---------|
| `analytics_events` | User behavior tracking |
| `api_metrics` | External API performance (latency, errors) |
| `daily_stats` | Aggregated daily metrics |

---

## External API Integrations

### Neynar (Farcaster)
- **Endpoint**: `https://api.neynar.com/v2/farcaster/user/bulk-by-address`
- **Batch size**: 200 wallets per request
- **Returns**: Farcaster username, follower count, verified Twitter handle
- **Performance**: ~339ms average for 200 wallets
- **Requires**: `NEYNAR_API_KEY`

### Web3.bio
- **Endpoint**: `https://api.web3.bio/profile/{wallet}`
- **Batch size**: 1 wallet per request (no batch API)
- **Returns**: ENS name, Twitter, Farcaster, Lens, GitHub
- **Performance**: ~45 seconds for 50 wallets (individual requests)
- **Optimization**: Only called for wallets without Twitter from Neynar
- **Requires**: `WEB3BIO_API_KEY` (optional, for rate limits)

### ENS (Onchain)
- **Method**: Direct onchain text record lookups via Alchemy
- **Returns**: Twitter, GitHub from ENS text records
- **Performance**: Slower but most accurate for Twitter handles
- **Requires**: `ALCHEMY_KEY`
- **Note**: Optional feature, only for paid tiers

---

## Key Files Deep Dive

### `lib/job-processor.ts`
The core processing engine. Key functions:
- `processJobChunk()`: Processes up to 3000 wallets per invocation
- Pipeline order: cache → neynar (fast) → web3bio (only uncovered wallets) → ens
- Tracks stats: twitterFound, farcasterFound, anySocialFound, cacheHits
- Saves partial results for resume capability

### `lib/access.ts`
Tier and quota management:
- `getUserAccess(email, wallet)`: Returns tier, limits, and remaining quota
- `TIER_LIMITS`: Per-lookup wallet limits
- `TIER_QUOTA`: Cumulative quotas (only starter tier has this)
- `incrementWalletsUsed()`: Atomic counter for starter tier usage

### `components/ResultsTable.tsx`
Virtualized table for 10K+ rows:
- Uses `@tanstack/react-virtual`
- CSS Grid layout (required for virtualization)
- 10-row overscan for smooth scrolling
- Debounced search (300ms)

### `app/page.tsx`
Main page orchestrating:
- File upload state
- Job polling and progress tracking
- Results display
- LocalStorage persistence of active job ID

---

## API Endpoints

### User-Facing
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/jobs` | POST | Create new lookup job |
| `/api/jobs/[id]` | GET | Get job status/results |
| `/api/history` | GET/POST | List/save lookup history |
| `/api/history/[id]` | GET/DELETE | Get/delete specific lookup |
| `/api/checkout` | POST | Create Stripe checkout |
| `/api/auth/send-magic-link` | POST | Send login email |
| `/api/auth/verify` | GET | Verify magic link token |

### Public API (for external developers)
| Endpoint | Method | Credits | Purpose |
|----------|--------|---------|---------|
| `/api/v1/wallet/[address]` | GET | 1 | Single wallet lookup |
| `/api/v1/batch` | POST | 1/wallet | Batch lookup |
| `/api/v1/reverse/twitter/[handle]` | GET | 2 | Find wallets by Twitter |
| `/api/v1/reverse/farcaster/[username]` | GET | 2 | Find wallets by Farcaster |
| `/api/v1/stats` | GET | Free | Dataset statistics |
| `/api/v1/usage` | GET | Free | API key usage |

### Admin
| Endpoint | Purpose |
|----------|---------|
| `/api/admin/dashboard` | Aggregated stats |
| `/api/admin/users` | User management |
| `/api/admin/jobs` | Job management |
| `/api/admin/whitelist` | Whitelist management |
| `/api/admin/social-graph` | Manual wallet enrichment |

---

## Environment Variables

```bash
# Required
DATABASE_URL=postgres://...              # Neon PostgreSQL

# API Keys
NEYNAR_API_KEY=...                       # Farcaster data
WEB3BIO_API_KEY=...                      # Higher rate limits
ALCHEMY_KEY=...                          # ENS onchain lookups

# Stripe
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PRICE_STARTER=price_xxx           # $49 product
STRIPE_PRICE_PRO=price_xxx               # $149 product
STRIPE_PRICE_UNLIMITED=price_xxx         # $420 product

# Email (Resend)
RESEND_API_KEY=...

# Optional
INNGEST_EVENT_KEY=...                    # For faster processing
INNGEST_SIGNING_KEY=...
USE_CONNECTION_POOLING=true              # Neon pooler
ADMIN_EMAILS=admin@example.com           # Comma-separated
```

---

## Performance Optimizations

### API Pipeline
- **Neynar first**: Fast batch API (200 wallets/request) runs before Web3Bio
- **Skip Web3Bio for covered wallets**: Only call slow API for wallets without Twitter
- **15-second timeouts**: Prevents hanging requests
- **Parallel batches**: Neynar processes 5 batches concurrently

### Frontend
- **Table virtualization**: Only renders visible rows (~35) instead of 10K+
- **Component memoization**: React.memo, useMemo, useCallback throughout
- **Debounced search**: 300ms delay to prevent lag
- **Adaptive polling**: Starts at 2s, increases to 5s when idle

### Database
- **Composite indexes**: `(status, created_at)` for job queue queries
- **COUNT FILTER**: Efficient aggregation instead of full scans
- **Connection pooling**: Optional Neon pooler for lower latency

---

## Common Tasks

### Adding a new tier
1. Update `TIER_LIMITS` and `TIER_QUOTA` in `lib/access.ts`
2. Update `TIER_PRICES` in `lib/access.ts`
3. Add Stripe price ID to env vars
4. Update `UpgradeModal.tsx` with new card
5. Update `AccessBanner.tsx` for badge display
6. Update comparison pages (`app/vs/*/page.tsx`)
7. Update JSON-LD in `app/layout.tsx`

### Adding a new data source
1. Create client in `lib/` (e.g., `lib/newapi.ts`)
2. Add to pipeline in `lib/job-processor.ts`
3. Update `WalletSocialResult` type in `lib/types.ts`
4. Add tracking to `lib/analytics.ts`
5. Update cache schema if needed

### Running locally
```bash
npm install
cp .env.example .env.local  # Fill in values
npm run db:push             # Setup database
npm run dev                 # Start dev server
```

---

## UI Guidelines

- **Never reference API providers in UI** (Web3.bio, Neynar) - use "all data sources"
- **Sentence case for headings** - "My lookups" not "My Lookups"
- **Curly apostrophes** - "We'll" not "We'll"
- **No time estimates** - Never predict how long tasks will take
- **Social proof = comparisons** - "9x industry avg" not progress bars

---

## Recent Changes (2025-01-18)

- **API pipeline optimization**: Neynar runs first, Web3Bio only for uncovered wallets
- **Starter tier**: New $49 tier with 10K cumulative wallet quota
- **Scalability fixes**: 15s API timeouts, parallel cron processing, connection pooling
- **Debounced search**: 300ms delay for large result sets

---

## Files to Update on Changes

When making significant changes, update:
1. `README.md` - Changelog section
2. `PROJECT_OVERVIEW.md` - This file (architecture, features)
3. `CLAUDE.md` - If adding new patterns or commands
