# Wallet → Social Lookup

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
- **Lookup History**: Save and reload previous lookups

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

## Changelog

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
