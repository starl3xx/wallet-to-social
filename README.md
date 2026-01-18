# walletlink.social

A Next.js application that takes a CSV of Ethereum wallet addresses and finds associated social profiles (Twitter/X and Farcaster). Perfect for community outreach, airdrop targeting, and identifying key influencers among token holders.

## Features

- **Batch Wallet Lookup**: Upload a CSV with wallet addresses and get social profiles for all of them
- **Multiple Data Sources**: Aggregates data from Web3.bio, Neynar, and ENS text records
- **Holdings & Priority Scoring**: Auto-detects value/balance columns and calculates outreach priority based on holdings × follower reach
- **Smart Filtering**: Filter by Twitter-only results or Top Influencers (1K+ Farcaster followers)
- **Click-to-Copy**: Truncated wallet addresses with one-click clipboard copy
- **Export Options**:
  - Full CSV export with all data, sorted by priority score
  - Twitter List export (.txt) for bulk Twitter list imports
- **Caching**: 24-hour result caching via Neon PostgreSQL
- **Lookup History**: Save and reload previous lookups (tiered: free gets 1, pro/unlimited get full history)
- **Add to Lookups**: Grow existing lookups by adding more addresses over time (Pro+)
- **Public API**: Subscription-based API access to social_graph data for developers (see [API docs](#public-api))

## Getting Started

### Prerequisites

- Node.js 18+
- (Optional) Neon PostgreSQL database for caching
- (Optional) Neynar API key for Farcaster data
- (Optional) Web3.bio API key for higher rate limits

### Environment Variables

Create a `.env.local` file:

```bash
# Optional: Neon database for caching and history
DATABASE_URL=postgres://...

# Optional: Neynar API for Farcaster lookups
NEYNAR_API_KEY=your-api-key

# Optional: Web3.bio API key
WEB3BIO_API_KEY=your-api-key

# Optional: Inngest for 10-50x faster processing
INNGEST_EVENT_KEY=your-event-key
INNGEST_SIGNING_KEY=your-signing-key
```

### Installation

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

### Database Setup (Optional)

If using Neon for caching:

```bash
npm run db:push
```

## Usage

1. **Prepare your CSV**: Include a column named `wallet` or `address` with Ethereum addresses. Optionally include value/holdings columns.
2. **Upload**: Drag and drop or click to upload your CSV
3. **Configure**: Toggle ENS onchain lookup (slower but more accurate), history saving
4. **Start Lookup**: Click "Start Lookup" and watch the progress
5. **Analyze**: Sort by Priority, Holdings, or FC Followers to find your best outreach targets
6. **Export**: Download full CSV or Twitter handles list

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Database**: Neon PostgreSQL with Drizzle ORM
- **Styling**: Tailwind CSS v4
- **UI Components**: Radix UI primitives
- **APIs**: Web3.bio, Neynar, ENS

---

## Public API

The social_graph data is available via a subscription API for developers building wallet-to-social integrations.

### Pricing

| Plan | Price | Rate Limit | Daily | Monthly | Batch Size |
|------|-------|------------|-------|---------|------------|
| Developer | $49/mo | 60/min | 5K | 50K | 50 |
| Startup | $199/mo | 300/min | 50K | 500K | 200 |
| Enterprise | $799/mo | 1000/min | Unlimited | Unlimited | 1000 |

### Authentication

Include your API key in the `Authorization` header:

```bash
curl -H "Authorization: Bearer wts_live_xxxxxxxx" \
  https://walletlink.social/api/v1/wallet/0x123...
```

### Endpoints

#### Single Wallet Lookup
```
GET /api/v1/wallet/{address}
```
Returns social profiles for a single wallet address. **1 credit**

#### Batch Lookup
```
POST /api/v1/batch
Content-Type: application/json

{ "wallets": ["0x123...", "0x456..."] }
```
Returns social profiles for multiple wallets (up to plan limit). **1 credit per wallet**

#### Reverse Twitter Lookup
```
GET /api/v1/reverse/twitter/{handle}
```
Find all wallets associated with a Twitter handle. **2 credits**

#### Reverse Farcaster Lookup
```
GET /api/v1/reverse/farcaster/{username}
```
Find all wallets associated with a Farcaster username. **2 credits**

#### Stats
```
GET /api/v1/stats
```
Get dataset statistics (total wallets, coverage by platform). **Free**

#### Usage
```
GET /api/v1/usage
```
Get your API key usage stats and rate limit status. **Free**

### Response Format

```json
{
  "data": {
    "wallet": "0x123...",
    "ens_name": "vitalik.eth",
    "twitter": { "handle": "vitalikbuterin", "url": "https://twitter.com/vitalikbuterin" },
    "farcaster": { "username": "vitalik", "followers": 123456, "fid": 5650 },
    "lens": "vitalik.lens",
    "github": "vbuterin",
    "sources": ["web3bio", "neynar", "ens"]
  },
  "meta": { "wallet": "0x123...", "found": true }
}
```

### Rate Limit Headers

All responses include rate limit headers:
- `X-RateLimit-Limit`: Requests allowed per minute
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Unix timestamp when limit resets
- `Retry-After`: Seconds to wait (only on 429 responses)

### Getting an API Key

1. Create a key: `POST /api/developer/keys` with `{ "email": "you@example.com", "name": "My App", "plan": "developer" }`
2. Save the returned `api_key` - it's only shown once
3. View plans: `GET /api/developer/plans`
4. Check usage: `GET /api/developer/usage?email=you@example.com`

---

## Changelog

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
- **Three tiers**: Free (1,000 wallets), Pro (10,000 wallets, $149), Unlimited ($420)
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

## License

MIT

## Author

made with 🌠 by [@starl3xx](https://x.com/starl3xx)
