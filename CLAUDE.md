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
   - Check `wallet_cache` table (24h TTL)
   - Fetch uncached wallets from Web3.bio API (`lib/web3bio.ts`)
   - Fetch Farcaster data from Neynar API (`lib/neynar.ts`)
   - Optionally query ENS text records onchain (`lib/ens.ts`)
   - Enrich from `social_graph` table (permanent storage)
   - Cache new results, persist positive results to social graph
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

## Changelog

**Always update the changelog in README.md when making commits.** Add a dated entry under `## Changelog` with a brief description and bullet points of changes.

## Environment Variables

Copy `.env.example` to `.env.local`:
- `DATABASE_URL` - Neon PostgreSQL connection string (enables caching/history)
- `NEYNAR_API_KEY` - Enables Farcaster lookups with follower counts
- `WEB3BIO_API_KEY` - Higher rate limits for Web3.bio
- `ALCHEMY_KEY` - Reliable ENS onchain lookups
