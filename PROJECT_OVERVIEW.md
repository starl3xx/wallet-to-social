# PROJECT_OVERVIEW.md

> Comprehensive context document for LLMs working on walletlink.social

## Quick Summary

**walletlink.social** is a Next.js 16 application that resolves Ethereum wallet addresses to social profiles (Twitter/X, Farcaster, ENS, Lens, GitHub). Users upload a CSV of wallet addresses and receive enriched data showing which wallets have associated social accounts - useful for community outreach, airdrop targeting, and influencer identification.

**Live URL**: https://walletlink.social

---

## Product Overview

### Core Value Proposition

- Upload CSV with wallet addresses → get Twitter/Farcaster handles for those wallets
- Match rates run 16-46% depending on the chain; tools that match wallets to
  social accounts typically publish rates in the low single digits. Never cite a
  numeric industry average: see CLAUDE.md, House style.
- Credit packs priced in matches, one-time payments, no subscription. You are
  charged only for the wallets we resolve.

### Pricing and access

**Credit packs, priced in matches.** A match is a wallet resolved to an X or
Farcaster account. A wallet we cannot resolve costs nothing, which is why every
figure below is quoted against matches rather than wallets submitted.

| Pack     | Price | Matches                 | Notes                                       |
| -------- | ----- | ----------------------- | ------------------------------------------- |
| Free     | $0    | 100 per rolling 30 days | Cumulative and account-wide, not per lookup |
| Trial    | $29   | 250                     | One list, once                              |
| Campaign | $99   | 1,500                   | A launch or an airdrop                      |
| Scale    | $299  | 6,000                   | Several lists, or one large one             |
| Index    | $899  | 25,000                  | Agencies and repeat work                    |

Every pack carries all seven chains, the X list export, the wallet addresses
behind a handle, contract import, Farcaster DMs, priority score and follower
counts, deep scan with onchain ENS, and API and MCP access on the same credits.
One-time payments, not subscriptions. Credits last 12 months.

**What is free is free.** The CSV export is not gated at all (`ExportButton`
branches only the X list on `entitled`), and neither is X reachability
(`stampReachability` runs on every result set), the per-row evidence, or the
wallet count behind a handle. This paragraph sold "uncapped CSV export" as a
pack feature until 2026-08-26, and so did the buy-credits modal, `PackPricing`
on `/pricing` and six comparison pages, the schema.org FAQ answer in every
page's head, `/llms.txt`, the published docs and two lifecycle emails.

**The gate is on the fields, not on the file.** `lib/job-processor.ts` sets
`priority_score` and `fc_followers` to `undefined` for every row when
`options.paidData` is false, so a free CSV has those two headers and blank cells
beneath them. Both halves have to be said: the first correction of the paragraph
above got it wrong in the other direction, by claiming the score was in the free
CSV. Read `ExportButton` **and** `job-processor` before writing that something is
or is not included.

The prices live in `lib/packs.ts` and nowhere else: the modal, the checkout, the
comparison pages and the schema.org offers all read them, so they cannot
disagree.

**Legacy tiers are never metered.** `pro` ($99 one-time, 5,000 wallets per
lookup) and `unlimited` ($249 one-time) were sold before credits existed and
keep exactly what they bought, permanently. `unlimited` carries one condition,
an anti-enumeration ceiling of 1,000,000 wallets in a rolling 24 hours, which is
75x the largest job anyone has ever run.

**Starter was retired 2026-08-12.** It is no longer purchasable and no longer exists in code: `normalizeTier()` maps it to `free`. It was never purchased, so no account is affected.

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
│   │   ├── airstack/
│   │   ├── blaze/
│   │   ├── cookie3/          # `/vs/cookie` 308s here (see next.config.ts)
│   │   ├── formo/
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
│   ├── UpgradeModal.tsx      # Checkout modal: the four pack cards, reads lib/packs.ts
│   ├── StarterCollections.tsx # First action: run a seeded collection, brings nothing
│   ├── PackPricing.tsx       # Pack ladder on the /vs pages, reads lib/packs.ts
│   ├── AccessBanner.tsx      # Header chip, Buy credits button, account menu
│   ├── LookupHistory.tsx     # Saved lookups sidebar
│   └── admin/
│       ├── AdminNav.tsx         # The nine destinations, two groups
│       ├── FunnelPane.tsx       # The one funnel: sessions, events, gates, rates
│       └── LookupDashboard.tsx  # Usage metrics & analytics dashboard
├── lib/
│   ├── job-processor.ts      # Core lookup processing logic
│   ├── web3bio.ts            # Web3.bio API client
│   ├── neynar.ts             # Neynar API client (Farcaster)
│   ├── ens.ts                # ENS onchain lookups
│   ├── packs.ts              # The pack ladder: prices, free window, guards
│   ├── starter-collections.ts # Seed corpus as a first action; seeded contracts only
│   ├── credits.ts            # The match ledger: balance, canSubmit, charge
│   ├── access.ts             # Legacy tiers, whitelist, per-lookup limits
│   ├── stripe.ts             # Stripe checkout (tier and pack sessions)
│   ├── cache.ts              # 7-day wallet cache
│   ├── social-graph.ts       # Permanent social data storage (normalises source; see below)
│   ├── analytics.ts          # Event tracking
│   ├── ip-rate-limiter.ts    # IP-based rate limiting for UI endpoints
│   └── dashboard-analytics.ts # Admin dashboard metrics
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
    1. Check social_graph FIRST — high-quality fresh rows and persisted
       negatives ("checked, no socials", trusted for 30 days) skip all APIs
    2. Check wallet_cache (7-day TTL, includes short-term negatives)
       ↳ a fast scan (scanDepth 'fast') stops here: index only, no live
         source, no cache write, no negative persisted
    3. Run Neynar batch API (fast - 200 wallets/request)
    4. Run Web3Bio for wallets without Twitter (slow - 1 request/wallet)
    5. ENS onchain lookups (deep scan; any account holding credits and the
       legacy paid tiers, never the free allowance)
    6. Cache results; persist positives AND negatives to social_graph
       (negatives only when the full pipeline ran and no API call failed)
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

| Table                       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Key Fields                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `wallet_cache`              | 7-day TTL cache for API results                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | wallet, twitter_handle, farcaster, ens_name, cached_at                                                                            |
| — Farcaster sweep           | `social_graph` is also bulk-populated by a protocol-wide Farcaster sweep (`lib/farcaster-sweep.ts`): every FID's verified + custody ETH addresses, username, follower count. Daily incremental cron + monthly full GitHub Actions re-sweep. Swept rows are medium quality (45) until a real lookup completes the Twitter side.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |                                                                                                                                   |
| — ENS harvest               | Onchain com.twitter/com.github text records (`lib/ens-harvest.ts`): TextChanged log scan → current values via registry→resolver Multicall3 reads. User-attested, `twitter_verified`, quality 50, fill-only. Daily incremental cron from an `ingest_state` checkpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |                                                                                                                                   |
| — Ethos sweep               | Attested wallet-to-X links from an identity platform (`lib/ethos.ts`; write rules shared with the other attested sources in `lib/attested-links.ts`): the whole dataset enumerated daily in ~80 requests, no key and no metering. Fill-only, quality 45, matching what the live path computes. Its real value is `twitter_user_id`, the permanent X account id, which is the only rot detector in the pipeline. Disagreements go to `handle_conflicts`; the ingest never resolves one (see the conflict resolution row). Daily cron at 06:00 UTC.                                                                                                                                                                                                                                                                         |                                                                                                                                   |
| — Onchain attestation sweep | Wallet-to-X links published as EAS attestations on Base and Optimism (`lib/eas-attestations.ts`): two schemas, four chain/schema pairs, one adapter. Chain state, so no key, no metering and no terms. 86% of what it holds were wallets we had never seen. Daily cron 06:20 UTC.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |                                                                                                                                   |
| — Clanker sweep             | Token deploys on Base requested from an X account (`lib/clanker.ts`): the account posted and the wallet was named, so both halves are established by the act. Small (~24/day) but two thirds carry the numeric X account id. Incremental from an `ingest_state` checkpoint. Daily cron 06:40 UTC.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |                                                                                                                                   |
| — Weekly repair             | `lib/graph-repair.ts` fixes rows that contradict themselves, and only where the correct value is already in the row: an attestation flag with no handle under it, a handle in a casing reverse lookup cannot match, a `twitter_url` disagreeing with its own handle. Never deletes; every repair refuses above its own ceiling; `scripts/graph-audit.ts` reports read-only and `scripts/graph-repair.ts` dry-runs by default. Problems needing a live answer (an ENS name on two wallets, a Farcaster id under two usernames) are counted and left alone. Monday 09:00 UTC.                                                                                                                                                                                                                                               |                                                                                                                                   |
| — Conflict resolution       | `lib/conflict-resolution.ts` closes the one group of `handle_conflicts` with a single honest reading: our stored X handle is `not_found` or `unavailable` on a check no older than 7 days, the handle an attested source named is live with an id on a check no older than 7 days, and any id the source supplied equals the live one. Stale checks are re-run first through `sweepHandles` within `CONFLICT_RECHECK_CREDITS`. Accepting writes `twitter_renamed_from`, the new handle, url, id, verified flag and source, closes the conflict with `accepted-theirs: ours unreachable`, and deletes the `wallet_cache` row. One atomic statement per batch; a second run writes nothing. Both-live conflicts are never swapped. Daily cron 08:40 UTC; `scripts/resolve-handle-conflicts.ts --dry-run` for a manual pass. |                                                                                                                                   |
| `ingest_state`              | Checkpoints for ingest pipelines (name → jsonb value)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | name, value, updated_at                                                                                                           |
| `seeded_contracts`          | Contracts the daily seed cron has imported holders from (novelty selection: 30-day re-seed window)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | address+chain (pk), name, holders_imported, last_seeded_at                                                                        |
| `wallet_holdings`           | Wallet ↔ contract edges observed at seed time — the audience graph                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | wallet+contract+chain (pk), contract_type, first/last_seen_at                                                                     |
| `social_graph`              | Permanent storage of every checked wallet — positive rows carry socials; negative rows (all socials NULL, sources=['none']) mean "checked, nothing found" and suppress re-checks for 30 days                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | wallet, twitter_handle, twitter_user_id, twitter_renamed_from, farcaster, fc_followers, sources[], first_seen_at, last_checked_at |
| `handle_conflicts`          | Where two owner-attested sources name different X accounts for one wallet. Recorded by every attested ingest; resolved only where ours reaches nobody and theirs is live on recent checks (the conflict resolution row above). Measured on 250 real cases, 54% of the time our stored handle no longer resolves, and where both are live, 90% of the time ours belongs to someone who does not claim the wallet, so both-live rows are surfaced and never swapped                                                                                                                                                                                                                                                                                                                                                         | wallet+platform+their_source (pk), ours, theirs, their_user_id, resolved_at, resolution                                           |
| `lookup_jobs`               | Background job queue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | status, wallets[], processed_count, partial_results, twitter_found                                                                |
| `lookup_history`            | Saved lookup sessions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | user_id, wallet_count, results (JSONB), input_source                                                                              |
| `users`                     | User accounts. `tier` is `free` or one of the two legacy values; a pack purchase never changes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | email, tier, stripe_customer_id, wallets_used (lifetime record, gates nothing)                                                    |
| `credit_lots`               | Purchased packs, spent FIFO by expiry. One row per Stripe payment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | user_id, pack, granted, consumed, amount_cents, expires_at                                                                        |
| `credit_ledger`             | Every match debited, one row per job or API call, and the rolling 30-day free window                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | user_id, job_id, matches, wallets_submitted, paid_from, created_at                                                                |
| `whitelist`                 | Admin-granted unmetered access; `getUserAccess` reports it as `unlimited`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | email, wallet, note                                                                                                               |

### API Infrastructure Tables

| Table                   | Purpose                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `api_plans`             | Rate-limit plans (developer/startup/enterprise). Seeded, never sold on their own; a pack holder gets `developer` |
| `api_keys`              | External API keys with SHA-256 hashing. A row with `oauth_grant_id` set is an OAuth access token, not a key      |
| `api_usage`             | Per-request usage tracking                                                                                       |
| `rate_limit_buckets`    | Sliding window rate limiting                                                                                     |
| `ip_rate_limit_buckets` | IP-based rate limiting for unauthenticated endpoints (hourly buckets)                                            |

### OAuth Tables

Live credentials rather than records: read-only for CI, and deliberately absent
from the nightly dump.

| Table                          | Purpose                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `oauth_clients`                | Registered clients, and a fetch cache for client ID metadata documents (`is_cimd` tells them apart)           |
| `oauth_authorization_requests` | One row per request, from arrival through consent to spent code. `consumed_at` is what makes a replay visible |
| `oauth_grants`                 | One consent. Holds the rotating refresh token and the one it replaced, which is how a leak is recognised      |

### Analytics Tables

| Table              | Purpose                                    |
| ------------------ | ------------------------------------------ |
| `analytics_events` | User behavior tracking                     |
| `api_metrics`      | External API performance (latency, errors) |
| `daily_stats`      | Aggregated daily metrics                   |

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
- **Note**: Optional feature, available to any account holding credits (every pack includes the deep scan) and to the legacy paid tiers

---

## Key Files Deep Dive

### `lib/job-processor.ts`

The core processing engine. Key functions:

- `processJobChunk()`: Processes up to 3000 wallets per invocation
- Pipeline order: cache → neynar (fast) → web3bio (only uncovered wallets) → ens
- Tracks stats: twitterFound, farcasterFound, anySocialFound, cacheHits
- Saves partial results for resume capability

### `lib/packs.ts`

What is sold, in one place. `PACKS` (id, price in cents, matches, `priceEnvVar`), `CREDIT_LIFETIME_DAYS` (365), `FREE_MATCHES_PER_WINDOW` (100) and `FREE_WINDOW_DAYS` (30), `SUBMISSION_MULTIPLIER` (10), `LEGACY_UNLIMITED_DAILY_WALLETS` (1,000,000) and `MEASURED_MATCH_RATE` (0.237, display only, never billing). The file's comments record why each number is what it is.

### `lib/starter-collections.ts`

The first action for a visitor who has brought nothing. Reads the seed corpus (`seeded_contracts` and `wallet_holdings`, whose DDL is in `scripts/migrate-seed-tables.ts` and which are absent from `db/schema.ts`), so a run needs no upload and no paid contract import.

- `listStarterCollections(limit)`: composed over `listHolderCollections()` so the homepage cards and the `/holders` hub cannot disagree about the listing floor
- `getStarterWallets(chain, address)`: the wallets behind one collection, `STARTER_WALLET_CAP` of them. **Refuses anything that is not a row in `seeded_contracts`, before reading a wallet**, or this is a free bypass of the paid contract importer for any contract on any chain
- `STARTER_WALLET_CAP` is a quarter of `FREE_MATCHES_PER_WINDOW`. The wallet count is the worst-case spend, since every wallet in the sample might match, and the panel offers the **most** reachable collections it can find, so `MEASURED_MATCH_RATE` is the wrong estimator for it: the top card resolves 85 of its first 100 wallets. A demonstration may cost a quarter of the allowance; `scripts/check-invariants.ts` holds the ratio
- `parseStarterParam` / `buildStarterHref`: the `?collection=<chain>:<address>` link, deliberately a different parameter from `?contract=`, which sends an account with no credits to the buy-credits modal

It is **not** free of upstream calls. The seed cron writes holdings whether or not it had the budget to resolve them, so a mean of 71 wallets in a 100-wallet sample have never been checked and are resolved live, exactly as an uploaded list would be. `POST /api/jobs` takes `{ collection }` in place of `{ wallets }` and expands it at the top of the handler, so the IP limit, `canSubmit`, the per-lookup ceiling, the credit meter and the analytics all apply as they do to an upload. `input_source` is `starter_collection`, set server-side.

### `lib/social-graph.ts`

The index write: the one path that persists what a lookup found, so its failures are invisible to the user and permanent to us.

- **`source` is normalised at the boundary** with `asSourceList`, before anything reads it. The field is typed `string[]`, but our own CSV export writes it comma-joined, so a re-uploaded export sends a string back. Untreated it fails twice on the same value: `.some` throws, and spreading it stores a provenance list of single characters.
- **`db.transaction()` is called only when `supportsTransactions()` says the driver has one.** `neon-http` does not, and throws at call time, so an unconditional call makes the whole write depend on `USE_CONNECTION_POOLING`. Without it the write runs the same statements sequentially: every one is idempotent (`onConflictDoUpdate` on the wallet, append-only history), so a partial write is re-derived by the next lookup, while a throw costs the whole batch.
- **`isNonTransientError` treats a `TypeError` as permanent**, because it is a statement about this program rather than about the connection, and no retry changes it. Both 2026-08 defects were retried three times before this.

### `lib/credits.ts`

The meter:

- `getBalance(userId)`: Live lots first, otherwise the rolling free window over `credit_ledger`
- `canSubmit(userId, walletCount, tier)`: Pre-flight check; a submission may be at most remaining matches × `SUBMISSION_MULTIPLIER`
- `chargeForJob()`: Post-hoc debit when a job completes, idempotent on job id; `chargeForApiCall()`: the same per API call, charged every time
- `hasPaidAccess(userId, tier)`: The server-side feature gate (legacy tier, whitelist, or a live lot; the free allowance never counts)
- `legacyTierIsUnmetered(tier)`: `pro` and `unlimited`, which are never debited

### `lib/access.ts`

Legacy tiers and the whitelist:

- `getUserAccess(email, wallet)`: Returns tier (`free` | `pro` | `unlimited`), the per-lookup limit and the ENS flag; a whitelisted account reports as `unlimited`
- `effectiveTierForUserId(userId)`: The same answer by id, whitelist-aware
- `TIER_LIMITS`: Per-lookup wallet limits, legacy only. `free` (500) applies to anonymous callers and to the free allowance; `pro` (5,000) to the one legacy account; credits supersede it
- `normalizeTier()`: Anything unrecognised, including the retired `starter`, is `free`
- `walletsUsed` is a lifetime record of work run and gates nothing

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

| Endpoint                    | Method     | Purpose                               |
| --------------------------- | ---------- | ------------------------------------- |
| `/api/jobs`                 | POST       | Create new lookup job                 |
| `/api/starter-collections`  | GET        | Collections offered as a first action |
| `/api/jobs/[id]`            | GET        | Get job status/results                |
| `/api/history`              | GET/POST   | List/save lookup history              |
| `/api/history/[id]`         | GET/DELETE | Get/delete specific lookup            |
| `/api/checkout`             | POST       | Create Stripe checkout                |
| `/api/auth/send-magic-link` | POST       | Send login email                      |
| `/api/auth/verify`          | GET        | Verify magic link token               |

### Public API (for external developers)

| Endpoint                               | Method | Match credits                                         | Purpose                   |
| -------------------------------------- | ------ | ----------------------------------------------------- | ------------------------- |
| `/api/v1/wallet/[address]`             | GET    | 1 if it resolves, 0 if not                            | Single wallet lookup      |
| `/api/v1/batch`                        | POST   | 1/match; unresolved wallets are free                  | Batch lookup              |
| `/api/v1/reverse/twitter/[handle]`     | GET    | 1 per wallet returned, 100 per page (keyset `cursor`) | Find wallets by Twitter   |
| `/api/v1/reverse/farcaster/[username]` | GET    | 1 per wallet returned, 100 per page (keyset `cursor`) | Find wallets by Farcaster |
| `/api/v1/stats`                        | GET    | 0                                                     | Dataset statistics        |
| `/api/v1/usage`                        | GET    | 0                                                     | API key usage             |

Rate-limit units are a separate meter (reverse lookups weigh 2, batch weighs 1 per address submitted); see `docs-site/api-reference/introduction.mdx`, "Two meters".

### Onchain rail (x402)

`app/api/x402/buy/route.ts` sells a $1 Agent pack for USDC on Base with no
account: pay, and the response carries a fresh API key. Off unless `X402_PAY_TO`
is set. `lib/x402.ts` holds the protocol layer (`@x402/core` plus `@x402/evm`,
no Next peer requirement so no framework upgrade), `lib/x402-account.ts` mints
the wallet-keyed account, and `grantPackBySettlement` in `lib/credits.ts` is
idempotent on `credit_lots.settlement_id`, which holds the EIP-3009
authorization rather than the transaction hash.

The Agent pack lives in `X402_PACKS`, never in `PACKS`, so it cannot reach
Stripe checkout and cannot appear on the nine surfaces `PACK_IDS` drives.
Accounts with `users.origin = 'x402'` get no free allowance.

### MCP server (for agents)

`app/api/mcp/route.ts` exposes five tools over those six endpoints at
`https://walletlink.social/api/mcp`. It bills nothing of its own: each tool
builds a request carrying the caller's credential and hands it to the v1 handler
through `lib/mcp-call.ts`, and the handler keeps ownership of authentication,
rate limiting and the credit debit. Doing either at the MCP layer would charge
the caller twice for one tool call.

Because the handler does the recording, `api_usage.endpoint` keeps the same six
literals, so MCP traffic needs no new keys in `requests_by_endpoint`. Protocol
chatter (`initialize`, `tools/list`) reaches no handler and is bounded by IP at
120 an hour under `/api/mcp` in `lib/ip-rate-limiter.ts`, since it is the one
path no key-based limit covers. Tool descriptions live under `app/`, so
`scripts/check-design-language.mjs` greps their prose: the words it fires on are
listed in a comment at the top of the route.

### Privacy policy and retention

`app/privacy/page.tsx` is the published policy, at `/privacy`, linked from the
footer and the sitemap. Two rules govern it and both are enforced:

**Every period it states is one the code enforces.** `app/api/cron/cleanup/route.ts`
runs daily and owns all of them. Writing the policy is what surfaced that
`cleanupExpiredAuth`, `cleanupOldIpBuckets` and `cleanupAuthorizationRequests`
existed with **no caller**, so sessions, spent sign-in tokens and hourly IP
buckets had accumulated since each table was created. Analytics events had no
expiry at all and now have 400 days, the longest a browser will hold a
first-party identifier under the Chrome cap.

**The figures are imported, never restated.** The page reads `CACHE_TTL_DAYS`,
`ANALYTICS_RETENTION_DAYS`, `IP_BUCKET_RETENTION_HOURS`, `SESSION_DURATION_DAYS`,
`MAGIC_LINK_DURATION_MINUTES`, `MAGIC_LINK_RETENTION_HOURS` and
`NEGATIVE_RECHECK_DAYS`. `scripts/check-invariants.ts` asserts each is read as a
constant rather than written as a digit, that each cleanup is actually called,
and that the job is scheduled in `vercel.json`.

Processors are named by role. Identity sources are a category rather than a
list, which GDPR article 13(1)(e) permits and which keeps the CLAUDE.md rule
about never naming a data provider intact.

### OAuth 2.1 for the MCP server

Anthropic's software directory requires OAuth for an authenticated remote MCP
server (policy section 5.D), and a static bearer key does not satisfy it. The
whole authorization server is in this repo; nothing is delegated.

| File                                      | Holds                                                         |
| ----------------------------------------- | ------------------------------------------------------------- |
| `lib/oauth/metadata.ts`                   | Both discovery documents, the scope, the 401 challenge string |
| `lib/oauth/clients.ts`                    | Metadata-document fetch and validation, redirect URI matching |
| `lib/oauth/requests.ts`                   | One authorization request from arrival to spent code, PKCE    |
| `lib/oauth/grants.ts`                     | Consent, access tokens, refresh rotation, revocation          |
| `app/oauth/authorize/`                    | Validation and the consent screen                             |
| `app/api/oauth/{token,register,revoke,…}` | Token exchange, RFC 7591 registration, RFC 7009 revocation    |
| `app/api/oauth/metadata/*`                | The two documents, reached through `next.config.ts` rewrites  |

Four things worth knowing before touching any of it:

**The access token is an `api_keys` row**, carrying `oauth_grant_id`. Metering,
the three rate-limit windows, the balance check and the usage ledger all key off
that table, so this is the only shape that avoids a second copy of each. It
follows that an access token also authenticates a REST call: the five tools are
the six endpoints, so the two surfaces reach the same data on the same balance,
and `lib/oauth/grants.ts` says so rather than implying a boundary.

**The discovery documents are rewrites, not routes.** The App Router does not
route a directory whose name starts with a dot, silently: an `app/.well-known/`
route compiles and is absent from the build. Confirmed by building it.

**Refusal is a 401, never a tool error.** A 200 carrying `isError` is read by a
client as a tool that failed, so no token is refreshed and nobody is offered a
connection. A mistyped bearer key is the deliberate exception.

**The sign-in detour carries nothing a client supplied.** `/oauth/authorize`
validates and stores the request first, then refers to it by an opaque id, so
the magic-link round trip has no attacker-controlled URL to carry.
`isAllowedReturnPath` in `lib/auth.ts` accepts that one shape and no other.

Three tables (`oauth_clients`, `oauth_grants`, `oauth_authorization_requests`)
plus `api_keys.oauth_grant_id`, applied by `scripts/migrate-mcp-oauth.ts`. All
three are in `READ_ONLY_TABLES` and deliberately not in `BACKUP_TABLES`: a grant
is a live credential, and restoring one from last night would resurrect a
connection somebody revoked this morning.

`server.json` at the repo root is the registry manifest. The server is published
to the official MCP registry as `social.walletlink/wallet-identity` (reverse-DNS
of the domain, which the registry requires), verified by a DNS TXT record on the
walletlink.social apex. The Ed25519 signing key lives outside the repo at
`~/.walletlink/mcp-registry-key.pem` and is the only way to publish an update;
the Cloudflare record is commented with its location. Publish with
`mcp-publisher login dns --domain walletlink.social --private-key <hex>` then
`mcp-publisher publish`.

`docs-site/openapi.yaml` is the machine-readable description of all six: request and response schemas, both authentication forms, every error code, and the rate-limit and staleness headers. It is what the MCP server, SDK generation and agent discovery are built on, so it has its own CI gate in `.github/workflows/docs-freshness.yml`: touching a route, a validator, a plan limit or the `sources` enum requires touching the spec, and touching the spec runs `redocly lint` over it.

Farcaster usernames are validated as `[a-z0-9][a-z0-9.-]{0,31}` rather than as the fname spec, because `social_graph.farcaster` holds both fnames and attached ENS names and the reverse lookup matches on the column. See the comment on `isValidFarcasterUsername` in `lib/api-auth.ts` for the measurement behind it.

### Admin

| Endpoint                       | Purpose                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `/api/admin/dashboard`         | Usage metrics, match analytics, performance stats (supports `?period=today\|week\|month`) |
| `/api/admin/analytics/journey` | The whole funnel over one window: sessions, events, gates, paywall triggers, both rates   |
| `/api/admin/users`             | User management                                                                           |
| `/api/admin/jobs`              | Job management                                                                            |
| `/api/admin/whitelist`         | Whitelist management                                                                      |
| `/api/admin/social-graph`      | Manual wallet enrichment                                                                  |
| `/api/admin/conflicts`         | The handle conflict queue with reachability on both sides, and the resolved counts        |

`journey` replaced `analytics/funnel` and `analytics/paywall`, which the panel
called separately at two different window lengths and drew as two funnels with
two denominators. One window, chosen once by the reader, is the point of it.

**The panel has nine destinations, in two groups** (`components/admin/AdminNav.tsx`).
Analytics: Pulse, Funnel, Growth, Revenue, Health. Operations: Usage, Records,
Accounts, Data. It had thirteen, and four of the pairs answered the same question
from two places; the mapping is in the nav's own comment and in CHANGELOG.

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
STRIPE_PRICE_PACK_TRIAL=price_xxx        # $29, 250 matches
STRIPE_PRICE_PACK_CAMPAIGN=price_xxx     # $99, 1,500 matches
STRIPE_PRICE_PACK_SCALE=price_xxx        # $299, 6,000 matches
STRIPE_PRICE_PACK_INDEX=price_xxx        # $899, 25,000 matches
# STRIPE_PRICE_PRO / STRIPE_PRICE_UNLIMITED: legacy, not required; nothing sells them

# Email (Resend)
RESEND_API_KEY=...

# Optional
INNGEST_EVENT_KEY=...                    # For faster processing
INNGEST_SIGNING_KEY=...
USE_CONNECTION_POOLING=true              # Neon pooler; also the only driver with transactions
ADMIN_EMAILS=admin@example.com           # Comma-separated
X_RESOLVER_API_BASE=...                  # X account resolver origin (see lib/x-resolver.ts)
X_RESOLVER_API_KEY=...
CONFLICT_RECHECK_CREDITS=300             # Resolver credits the daily conflict resolution may spend on rechecks
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

### Adding a new pack

1. Add the entry to `PACKS` in `lib/packs.ts` with its price, match count and `priceEnvVar`
2. Create the one-off Stripe price and set that env var
3. Nothing else: the pricing modal, the checkout, the comparison pages (`PackPricing.tsx`) and the schema.org offers in `app/layout.tsx` all read `PACKS`

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
npm run db:push             # refuses; see CLAUDE.md, "Schema changes"
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

## API access (included with every pack)

The public API at `/api/v1/*` is included with every credit pack rather than sold
separately, and every call draws on the same match credits as the app: a wallet that
resolves costs one match, a miss costs nothing, and a call with no credits left returns
`402 NO_CREDITS`. Every v1 route reads **only** from `social_graph` (none of them calls
an external provider), so the marginal cost of a request is a Postgres read.

| Account                      | api_plans row | Requests/day | Max batch |
| ---------------------------- | ------------- | ------------ | --------- |
| Any pack (`CREDIT_API_PLAN`) | `developer`   | 5,000        | 50        |
| Legacy Pro                   | `developer`   | 5,000        | 50        |
| Legacy Unlimited             | `startup`     | 50,000       | 200       |

The plan comes from `apiPlanForAccount(tier, hasCredits)` in `lib/api-plans.ts` (a
legacy tier wins where it is higher) and is never read from the request: the create
endpoint previously took `plan` from the body and only checked the row existed, so a Pro
account could have asked for `enterprise` limits. Key creation in `lib/developer-auth.ts`
needs a live credit lot or a legacy tier (the free allowance is not API access); a key
outlives its credits and simply returns 402 until a pack is bought.

The `api_plans` rows are rate-limit plans, not products. Their `priceMonthly` values
(`developer` $49, `startup` $199, `enterprise` $799) date from when standalone monthly
API plans were considered; none was ever sold, and `/api/developer/plans` now publishes
the packs instead (fixed 2026-08-21).

**A lookup belongs to a visit** (`lookup_jobs.session_id`). The browser sends its
session id with the job, `/api/jobs` validates it as a UUID before use, and it is
stored on the row so `lookup_completed`, emitted minutes later by a worker, can
carry the same session as `lookup_started`. Null means no visit behind it: the
seed cron and the public API both create jobs and neither has a browser.

**The non-buyer check-in runs daily at 16:00 UTC** (`/api/cron/checkin-nonbuyers`,
`lib/checkin-campaign.ts`), five per variant per day, an hour after the welcome
sequence so an account due both gets them an hour apart. It is plain text from
`starl3xx@`, not the branded template, and it ends by running out of people.

**Stop it with a row, not a deploy.** `isPaused()` reads `ingest_state`, so one
UPDATE halts the next run:

```sql
INSERT INTO ingest_state (name, value, updated_at)
VALUES ('checkin_campaign', '{"paused":true}'::jsonb, now())
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
```

The switch fails closed: a read error returns paused, because a switch whose
failure means "carry on" is not a switch.

**A sale is booked where credits are granted** (`bookSale` in `lib/credits.ts`),
on both the Stripe and x402 rails, awaited and only on the branch that wrote.
`provisionPaidAccess` books the legacy tier purchase for the same reason. A
hand-issued credit is not a sale.

**The funnel reports sessions and engaged sessions.** Engaged means more than one
event, or one that is not a pageview. Both are shown, because the gap between
them is the finding rather than noise to be filtered out.

**There are two funnels and they are not interchangeable.** `getSessionFunnel`
counts distinct sessions that reached each step, so a ratio between two of its
steps is a ratio between two groups of people; `getUserFunnel` counts events, so
one visitor opening the pricing modal six times is six. The session funnel forces
the money tail to fall (the buy-credits modal is the only way into a Stripe
checkout) and leaves the steps above it as measured, so "saw pricing" may exceed
"got results". `payment_completed` has no session, so "paid" is joined by account
email _and_ requires the session to have reached checkout; without that second
test it counts every visit a buyer ever made.

**There is one definition of conversion**, `conversionRates` in `lib/analytics.ts`,
returning `pricingToPaid` and `lookupToPaid`. Both are `null`, never 0, when the
denominator is zero. Three panes previously computed three different rates and
called all of them "conversion rate".

**A raw-SQL window bound goes through `utcBound`.** The timestamp columns are
`timestamp without time zone` holding UTC, and interpolating a JS `Date` into a
`sql` template sends a local-offset string whose offset Postgres then discards.
Production is UTC so it never bit there, which is exactly why it needed asserting.

**Attribution is first touch, recorded once per browser** (`lib/first-touch.ts`).
The referring host, `?ref=` and the three UTM parameters are reduced to one
groupable string in `users.acquisition`, written on insert only so a later
sign-in cannot rewrite where an account came from. **Not `users.origin`**, which
says which rail minted the row and whose `'x402'` value `getBalance` reads to
withhold the free allowance. The value rides on `magic_link_tokens.acquisition`
because the browser holding the first touch is the one
that requested the link, not necessarily the one that opens it. Only the referring
**host** is kept, never the full referrer URL.

**The reverse endpoints are the differentiated part.** `handle → wallets` is a question
the accumulated graph can answer and a CSV export cannot. It draws match credits like
every other call, one per wallet returned.

**Reverse matches the second attested X account as well as the primary**
(`walletsBySecondaryHandle` in `lib/handle-reachability.ts`). It reads the same
`FROM` clause and the same source allowlist as `alsoOnXForWallets`, so a wallet
is only returned for a handle its own row displays. **Never as a correlated
`OR EXISTS`:** measured on production that scans all 5.1M graph rows and takes
19.7s against 42ms for resolving the wallets first and matching by primary key.
The free count uses `countBySecondaryHandle`, which returns a number, because
`/api/reverse` must not read a wallet address above the entitlement gate.

**The app's own door onto it discloses in two halves** (`app/api/reverse/route.ts`,
`lib/reverse-access.ts`). The **count** of wallets carrying a handle is free, keyless
and available to an anonymous caller, bounded per address at the `/api/reachability`
limit because it is the same disclosure at the same cost. The **addresses** need
`hasPaidAccess`. The locked branch returns before the row query runs, so an unentitled
caller's request never reads a wallet at all rather than reading them and declining to
print them. This is the same split `/check` publishes in prose; the public
`/v1/reverse/*` endpoints are unaffected and remain key-authenticated and metered.

---

## Recent Changes (2026-08-24)

- **The welcome sequence has two runners.** `/api/cron/welcome-first`
  (`*/5 * * * *`) sends `welcome-1` only, to accounts older than
  `FIRST_TOUCH_DELAY_MINUTES` (5) in `lib/welcome-sequence.ts`.
  `/api/cron/welcome-sequence` (15:00 UTC daily) owns days 2, 5, 9 and 14 and
  keeps a day-0 pass as the safety net. Both select through the shared
  `ELIGIBLE_USER` fragment and send through `claimAndSend`, which takes the
  `lifecycle_emails` row before sending so the overlap at 15:00 cannot double
  up. Enrollment stays automatic: an account created on or after
  `SEQUENCE_START` (2026-08-23) is in unless it opted out, holds a legacy tier,
  is whitelisted, or has bought a credit pack. `lifecycle_emails.confirmed_at`
  separates a claim from a delivery: it is written after the send succeeds, and
  `reclaimStaleClaims` deletes unconfirmed claims older than 15 minutes so a
  process killed mid-send does not leave a person permanently marked as
  emailed. Migration `scripts/migrate-lifecycle-claim.ts`.

## Recent Changes (2026-08-22)

- **Lifecycle email pipeline.** `users.email_opt_out` plus the
  `lifecycle_emails` send ledger (unique on user and email key), the
  stateless-HMAC `/api/email/unsubscribe` endpoint (GET and RFC 8058
  one-click POST), and `sendLifecycleEmail` in `lib/email.ts`
  (List-Unsubscribe headers, reply-to help@, refuses without
  `EMAIL_UNSUBSCRIBE_SECRET`). Migration:
  `scripts/migrate-email-lifecycle.ts`, run BEFORE deploy, then
  `scripts/migrate-grant-readonly.ts`. The relaunch campaign
  (`scripts/relaunch-trial-grant.ts`) grants the Trial pack to every
  never-bought account and emails them; dry-run default, nothing sent yet.
  Drafts and run order: `docs/EMAIL-SEQUENCE.md`.
- **Handle conflicts, bucket 1, resolve automatically.** `lib/conflict-resolution.ts`
  accepts the attested source's handle where ours is `not_found` or `unavailable` and
  theirs is live, both on checks no older than 7 days, and any supplied id matches. New
  column `social_graph.twitter_renamed_from` keeps the old handle
  (`scripts/migrate-handle-renames.ts`). New cron `/api/cron/resolve-conflicts` at 08:40
  UTC with `CONFLICT_RECHECK_CREDITS` (default 300) for rechecks. Manual entry
  `scripts/resolve-handle-conflicts.ts [--dry-run] [--limit N]`. Admin conflicts pane
  gains Resolved and Resolved in 7 days. Both-live conflicts are never swapped.
- **Both-live conflicts are surfaced as a second handle.** New public field
  `twitter.also` (`{ handle, url, source }`) on `/api/v1/wallet` and `/api/v1/batch`,
  present only where an unresolved conflict has both handles live and any supplied id
  matches; `source` is the public evidence class. The app result carries it as
  `twitter_also` (`lib/types.ts`), stamped in `lib/job-processor.ts` by
  `stampAlsoOnX`, shown under the X handle in `components/ResultsTable.tsx`, exported
  as a `twitter_also` CSV column and included in the X list by
  `components/ExportButton.tsx`. Read by `alsoOnXForWallets` in
  `lib/handle-reachability.ts`, one query per batch.
- **Done (2026-08-22):** every social_graph writer that carries an incoming X
  handle refuses one equal to `twitter_renamed_from`. The sweep and the live
  lookup upsert shipped with the guard (PRs #135/#136). The fill-if-empty
  ingests (`lib/ens-harvest.ts`, `lib/attested-links.ts`) gained it in the
  follow-up: their stored handle is NULL exactly on rows that were cleared, so
  an ENS text record or an attested link that still carries the dead string
  could refill it. A refused fill writes nothing, including no source label,
  no quality bump and no timestamp.

## Recent Changes (2026-08-21)

- **Credit packs replace tiers.** Four packs in `lib/packs.ts`: `trial` ($29, 250
  matches), `campaign` ($99, 1,500), `scale` ($299, 6,000), `index` ($899, 25,000).
  One-time Stripe checkout (`mode: 'payment'`, `createPackCheckoutSession`), granted as
  a `credit_lots` row. A purchase never changes `users.tier`.
- **The unit is a match**: a wallet resolved to an X handle or a Farcaster account.
  Misses cost nothing. Jobs are charged on completion (`chargeForJob`, idempotent on job
  id); API calls are charged per call (`chargeForApiCall`).
- **Credits last 12 months** (`CREDIT_LIFETIME_DAYS`), spent FIFO by expiry.
- **Free is 100 matches per rolling 30 days**, cumulative and account-wide over
  `credit_ledger` (`FREE_MATCHES_PER_WINDOW`, `FREE_WINDOW_DAYS`). The free allowance
  never unlocks the paid features.
- **Per-lookup rules** (`app/api/jobs/route.ts`): anonymous keeps `TIER_LIMITS.free`
  (500 per lookup) plus the IP rate limit, because there is no account to meter; signed
  in on the free allowance gets min(500, remaining matches × 10); a pack holder has no
  per-lookup cap, only the `SUBMISSION_MULTIPLIER` guard (at most 10× remaining matches,
  anti-enumeration, not a quota).
- **Entitlement helpers**: `hasPaidAccess`, `getBalance`, `canSubmit` and
  `legacyTierIsUnmetered` in `lib/credits.ts`; `effectiveTierForUserId` in
  `lib/access.ts`; `useCredits(signedIn).entitled` on the client. Feature gates no
  longer read `tier`.
- **API access comes with every pack** on the same credits (`CREDIT_API_PLAN`,
  `apiPlanForAccount`); `402 NO_CREDITS` when the balance is empty.
- **Two legacy accounts** (`pro`, `unlimited`) stay unmetered forever: no expiry, API
  kept. `unlimited` has one ceiling, `LEGACY_UNLIMITED_DAILY_WALLETS` (1,000,000 wallets
  per 24 hours), anti-enumeration only. Whitelisted accounts are unmetered everywhere.
- **Retired copy**, never to be reinstated: "500 wallets free", "Pro $99", "Unlimited
  $249", "Upgrade" as the verb for buying, and the monthly API plans. `PackPricing.tsx`
  renders the ladder on the `/vs` pages; the schema.org offers in `app/layout.tsx` read
  `PACKS`.

## Recent Changes (2026-08-12, later)

- **Pro is $99** (was $149) and now includes **contract import**, which previously sat
  behind the Unlimited tier
- **Free per-lookup limit is 500** (was 1,000)
- **Checkout instrumentation**: `checkout_redirected` and `checkout_failed` added, and
  `limit_hit` wired up — it was defined but never called

**Why:** 41 checkout sessions had been started with zero completions. Free offered
1,000 wallets per lookup with _unlimited_ lookups and full CSV export, so Pro added
little for most users — only 7 lookups in the product's history ever exceeded the free
ceiling, against 261 upgrade-modal views. The gap between free and paid was the problem,
not the price alone.

**Superseded 2026-08-21.** The free allowance is now cumulative and account-wide for
signed-in accounts: 100 matches per rolling 30 days, measured over `credit_ledger`.
Anonymous lookups keep the per-lookup cap and the IP rate limit, because there is no
account to meter. See the reasoning in `lib/packs.ts` under `FREE_MATCHES_PER_WINDOW`.

---

## Supported Chains (contract import)

| Chain           | Chain ID | NFT holders     | ERC-20 holders                   |
| --------------- | -------- | --------------- | -------------------------------- |
| Ethereum        | 1        | Alchemy NFT API | Moralis                          |
| Base            | 8453     | Alchemy NFT API | Moralis                          |
| Robinhood Chain | 4663     | Alchemy NFT API | Not available (no Moralis index) |

Chain constants live in `lib/chains.ts`, deliberately free of dependencies so client
components can import them without pulling `ethers` (imported by `lib/contract-holders.ts`)
into the browser bundle. Adding a network means adding an entry to `CHAIN_IDS`,
`CHAIN_LABELS`, `RPC_ENDPOINTS`, and `ALCHEMY_ENDPOINTS` — the API route and the import
modal both derive their options from `SUPPORTED_CHAINS`.

Alchemy requires each network to be enabled per-app in its dashboard; a network that is
not enabled fails with `<NETWORK>_MAINNET is not enabled for this app`.

---

## Recent Changes (2026-08-12)

- **Robinhood Chain (4663) added to contract import** — NFT holder lookups via Alchemy,
  verified exact against onchain `ownerOf` enumeration (618/618 holders, 4,444 tokens)
- **`lib/chains.ts` added** — dependency-free chain constants shared by server and client
- **ERC-20 lookups unavailable on Robinhood** — surfaced as a clear error plus a modal warning
- **`MORALIS_API_KEY` no longer required for NFT imports** — it previously 503'd the whole endpoint

## Recent Changes (2026-02-21)

- **Blog infrastructure**: New `/blog` and `/blog/[slug]` routes rendering markdown from `content/published/`
- **Blog utility**: `lib/blog.ts` using `gray-matter` + `marked` for frontmatter parsing and markdown rendering
- **Share buttons**: Twitter/X and Farcaster share buttons on results page (`components/ShareButtons.tsx`)
- **Dynamic OG images**: `opengraph-image.tsx` and `twitter-image.tsx` at root (1200x630), plus per-post OG images at `/blog/[slug]/opengraph-image.tsx`
- **Sitemap update**: Added `/blog`, blog post URLs, and missing `/vs/cookie` to sitemap
- **Footer update**: Added "Blog" link to footer navigation
- **Dependencies**: Added `gray-matter`, `marked`, `@tailwindcss/typography`

### 2025-01-21

- **Admin analytics dashboard**: New Dashboard tab with usage metrics, match analytics, and performance monitoring
- **IP-based rate limiting**: 3 requests/hour on lookup endpoints to prevent abuse
- **Dashboard analytics lib**: Time-period aggregations with comparison to previous period

### 2025-01-18

- **API pipeline optimization**: Neynar runs first, Web3Bio only for uncovered wallets
- **Starter tier**: New $49 tier with 10K cumulative wallet quota
- **Scalability fixes**: 15s API timeouts, parallel cron processing, connection pooling
- **Debounced search**: 300ms delay for large result sets

---

## Files to Update on Changes

When making significant changes, update:

1. `CHANGELOG.md` - Dated entry at the top (the changelog no longer lives in README.md)
2. `PROJECT_OVERVIEW.md` - This file (architecture, features)
3. `CLAUDE.md` - If adding new patterns or commands
