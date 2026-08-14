# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run format       # Prettier format all files
npm run db:push      # Push schema changes to Neon database
npm run db:generate  # Generate Drizzle migrations
npm run db:studio    # Open Drizzle Studio GUI
```

## Architecture

This is a Next.js 16 App Router application that batch-resolves Ethereum wallet addresses to social profiles (Twitter/X and Farcaster).

### Data Flow

1. User uploads CSV with wallet addresses → `lib/csv-parser.ts` extracts wallets and detects holdings columns
2. Frontend (`app/page.tsx`) calls `/api/lookup` with wallets and options
3. API route streams SSE progress events back to client while processing:
   - Check `social_graph` first — high-quality fresh rows AND persisted
     negatives ("checked, no socials", trusted 30 days) skip all API calls
   - Check `wallet_cache` table (7-day TTL, includes negative entries)
   - Fetch uncached wallets from Web3.bio API (`lib/web3bio.ts`)
   - Fetch Farcaster data from Neynar API (`lib/neynar.ts`)
   - Optionally query ENS text records onchain (`lib/ens.ts`)
   - Cache new results; persist positives and negatives to social graph
     (negatives only when the full pipeline ran without API failures)
4. Results displayed in `ResultsTable` with sorting, filtering, and export options

### Database Schema (Drizzle + Neon PostgreSQL)

- `wallet_cache` - 24-hour TTL cache for API results
- `lookup_history` - Saved lookup sessions with full results (JSONB)
- `social_graph` - Permanent storage of all wallets with discovered social accounts, indexed for querying

### API Integrations

- **Web3.bio** (`lib/web3bio.ts`) - Primary source for ENS, Twitter, Farcaster, Lens, GitHub
- **Neynar** (`lib/neynar.ts`) - Farcaster profiles with follower counts and verified Twitter handles
- **ENS** (`lib/ens.ts`) - Optional onchain text record lookups (slower but most accurate for Twitter)

### Priority Score

Calculated as `holdings × log₁₀(fcFollowers + 1)` to rank wallets by both token holdings and social reach.

## Documentation Updates

**Always update documentation when making commits:**

1. **README.md** - Add a dated entry under `## Changelog` with bullet points of changes
2. **PROJECT_OVERVIEW.md** - Update if changes affect:
   - Architecture or data flow
   - Database schema
   - API endpoints
   - Environment variables
   - Tier/pricing structure
   - Key files or their responsibilities

Keep both files in sync so LLMs have accurate context about the codebase.

### Public docs (`docs-site/`)

`docs-site/` is the published Mintlify site at docs.walletlink.social. It is a
contract with paying customers, and unlike code it fails silently: nothing
breaks when it drifts, it just starts lying.

**Every PR must make an explicit docs decision.** The PR template asks for it and
`.github/workflows/docs-freshness.yml` enforces it: a PR touching the public API
surface fails CI unless it also touches `docs-site/`, or carries the
`no-docs-needed` label.

Update the docs whenever a change moves any of:
- A response shape or field name on `/api/v1/*`
- A rate limit, credit cost, batch size or plan mapping
- An error code or status
- The supported chain list
- A published statistic or coverage claim

**Never name a data provider in `docs-site/`.** The same rule as the UI, and it
matters more here: the docs are indexed and permanent. Describe *capability*
("Farcaster coverage is complete") and *evidence class* ("attested on-chain"),
never provenance. The public `sources` field is mapped through
`lib/api-sources.ts` for exactly this reason, on an allowlist so an unmapped
internal source is dropped rather than leaked.

**Never publish from `docs/`.** That folder is internal: `SECURITY.md` holds the
backup and restore runbook. Only `docs-site/` is published.

**Verify claims before publishing them.** Coverage numbers, match rates and
completeness claims should be checked against the database or `/v1/stats`, not
copied from older copy. Keep "has an identity" (~23%) and "reachable on X or
Farcaster" (~13%) distinct wherever either appears.

## UI Guidelines

- **Never reference API providers in the UI** (e.g., Web3.bio, Neynar). Use generic terms like "all data sources" instead. API details are implementation details that users don't need to see.
- **Social proof should show comparisons, not progress** - When displaying match rates (e.g., 22%), don't use progress bars (makes it look incomplete). Instead show the number prominently with context like "9x avg" comparing to industry average (~2.5%).
- **Header logo is always clickable** - Returns user to homepage from any state.
- **Sentence case for headings** - Use "My lookups" not "My Lookups". Only capitalize the first word and proper nouns.
- **Curly apostrophes in UI** - Use curly apostrophes (') not straight ones ('). Example: "We'll" not "We'll".

## Performance Patterns

This app handles large datasets (10K+ wallets). Key patterns used:

### Component Memoization
- Wrap child components with `React.memo()` to prevent re-renders when parent state changes
- Use `useMemo` for expensive calculations (filtering, sorting, stats)
- Use `useCallback` for event handlers passed as props
- Avoid inline arrow functions in JSX props (defeats memoization)

### Table Virtualization
- `ResultsTable` uses `@tanstack/react-virtual` for large lists
- Only renders ~35 visible rows instead of 13K+ DOM elements
- CSS Grid layout (required for virtualization, can't virtualize `<tbody>`)
- 10-row overscan for smooth scrolling

### Polling Optimization
- Compare values before calling setState to avoid unnecessary re-renders
- Return same reference from functional setState when values unchanged

### Lazy Loading
- History API supports `summaryOnly=true` to fetch metadata without full JSONB results
- Full results fetched on-demand via `/api/history/[id]`

### Animation Performance
- Modal uses 2 animations (fade + scale) instead of 5
- Duration reduced to 150ms for snappier feel

## Environment Variables

Copy `.env.example` to `.env.local`:
- `DATABASE_URL` - Neon PostgreSQL connection string (enables caching/history)
- `NEYNAR_API_KEY` - Enables Farcaster lookups with follower counts
- `WEB3BIO_API_KEY` - Higher rate limits for Web3.bio
- `ALCHEMY_KEY` - Reliable ENS onchain lookups
