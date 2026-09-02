<div align="center">
  <img src="public/icon.png" alt="walletlink.social" width="120" />

  <h1>walletlink.social</h1>

  <p><strong>Turn wallet addresses into the people behind them, and reach them where they already are</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js 16" />
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Neon-00E599?style=flat-square&logo=postgresql&logoColor=white" alt="Neon Postgres" />
    <img src="https://img.shields.io/badge/Farcaster-855DCD?style=flat-square" alt="Farcaster" />
    <img src="https://img.shields.io/badge/Vercel-000?style=flat-square&logo=vercel" alt="Vercel" />
  </p>

  <p>
    <a href="https://walletlink.social">App</a> &middot;
    <a href="https://docs.walletlink.social">Docs</a> &middot;
    <a href="https://docs.walletlink.social/api-reference/introduction">API</a> &middot;
    <a href="https://x.com/walletlinkETH">@walletlinkETH</a>
  </p>
</div>

---

## How it works

```
Wallet list in (CSV · contract address · paste)
  ├─ Resolve against a 4.8M-wallet identity index
  ├─ Farcaster: complete protocol coverage, refreshed daily
  ├─ X handles: attested first, labelled always, never inferred
  ├─ Rank by holdings × follower reach
  └─ Export CSV, or an X list ready to import
```

It also runs backwards: give it an X handle or a Farcaster username and it returns the wallets attached to that person.

---

## Coverage, stated honestly

The number most tools quote is the one that flatters them. Two numbers matter here, and conflating them will make you plan a campaign you cannot run.

| Question                                                           | Answer            |
| ------------------------------------------------------------------ | ----------------- |
| Wallets with an X or Farcaster account                             | 16-46% by chain   |
| What tools that match wallets to social accounts typically publish | low single digits |

The chain decides this more than the collection does: measured across 26 collections and 72,318 holders, Base runs 46.2% and Ethereum 16.6%, because Base is where Farcaster lives. Use your chain's figure, not an average.

Having an account and reaching it are different claims. Of 460,889 X handles resolved, 70.1% are live, 20.1% suspended and 9.8% are names nobody holds. Matches carry that answer wherever the handle has been resolved.

| Network       | Nature of the match                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Farcaster** | Complete. Every account and its addresses, refreshed daily. Matching is deterministic, so a miss is real information rather than missing information.                                                                                                                                                                                                                                            |
| **X**         | Attested first, labelled always. Over 99.9% of handles were published by the wallet owner themselves: a Farcaster verification, an onchain ENS record, an attested-social sign-in, or a manually verified record. Anything else is correlated and labelled so in its evidence class, so a match always tells you how it was established. Nothing is inferred from display names, bios or timing. |

Coverage would be higher if we guessed. Contacting the wrong person is worse than contacting fewer people.

---

## Features

|                      |                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| **Three ways in**    | CSV upload, contract import (holders fetched for you), or pasted addresses                        |
| **Eight chains**     | Ethereum, Base, Robinhood Chain, Arbitrum, Polygon, Optimism, BNB Chain, HyperEVM (NFT only)      |
| **Priority scoring** | `holdings × log₁₀(followers + 1)`, weighting reach and stake together                             |
| **Agent detection**  | 13,000+ known AI agent wallets flagged                                                            |
| **Reverse lookup**   | X handle or Farcaster username back to wallets                                                    |
| **Public API**       | Included with every pack, drawing the same credits; self-serve keys                               |
| **MCP server**       | Five tools at `/api/mcp`, OAuth or the same key, same balance; listed in the MCP registry         |
| **Onchain rail**     | `$1` Agent pack for USDC on Base at `/api/x402/buy`, no account; key recovery by wallet signature |
| **Exports**          | Full CSV sorted by priority, or a plain handle list for an X list import                          |

---

## Pricing

Credit packs, bought once and metered in **matches**. A match is a wallet resolved to an X handle or a Farcaster account; a wallet that resolves to nothing costs nothing. Credits last 12 months from purchase. There are no subscriptions.

| Pack     | Price | Matches                 | Fits                            |
| -------- | ----- | ----------------------- | ------------------------------- |
| Free     | $0    | 100 per rolling 30 days | Trying it on a real list        |
| Trial    | $29   | 250                     | One list, once                  |
| Campaign | $99   | 1,500                   | A launch or an airdrop          |
| Scale    | $299  | 6,000                   | Several lists, or one large one |
| Index    | $899  | 25,000                  | Agencies and repeat work        |

Every pack includes the same features (contract import, reverse lookup, deep ENS resolution, follower counts, priority score, X list export, lookup history, and API plus MCP access on the same credits). Packs differ only in how many matches they hold. `lib/packs.ts` is the source of truth: the pricing modal, the checkout, the comparison pages and the schema.org offers all read from it.

---

## Architecture

```
CSV / contract / paste
        ↓
  lib/csv-parser.ts ──── detects wallet + holdings columns
        ↓
  /api/jobs ──────────── creates a job; lib/job-processor.ts runs it in chunks, the client polls
        ↓
  ┌─ social_graph ─────── fresh rows and persisted negatives short-circuit
  ├─ wallet_cache ─────── 7-day TTL, negatives included
  └─ resolution pipeline  identity sources, then optional ENS text records
        ↓
  social_graph ─────────── positives and negatives persisted
        ↓
  ResultsTable ─────────── virtualized, sortable, exportable
```

Negatives are persisted deliberately. "Checked, nothing there" is an answer worth keeping, and it is what stops the pipeline paying repeatedly to rediscover the same absence.

---

## Tech stack

| Layer           | Tech                                                                 |
| --------------- | -------------------------------------------------------------------- |
| Framework       | Next.js 16, App Router                                               |
| Database        | Neon PostgreSQL, Drizzle ORM                                         |
| Styling         | Tailwind CSS v4                                                      |
| UI              | Radix primitives                                                     |
| Background jobs | Inngest                                                              |
| Payments        | Stripe                                                               |
| Docs            | Mintlify at [docs.walletlink.social](https://docs.walletlink.social) |
| Assistant       | Cloudflare AI Search, served from `help.walletlink.social`           |
| Hosting         | Vercel                                                               |

---

## Project structure

```
app/
  api/v1/           public API (wallet, batch, reverse, stats, usage)
  api/developer/    API key management
  api/cron/         scheduled ingest and refresh
  vs/               competitor comparison pages
components/         UI, including ApiKeysModal and DocsChat
lib/                resolution pipeline, chains, plans, rate limiting
docs-site/          published Mintlify docs  ← customer-facing
docs/               internal runbooks        ← never published
```

`docs-site/` and `docs/` are deliberately separate. `docs/` holds operational runbooks and is not the Mintlify content root.

---

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in what you need
npm run dev
```

Open [localhost:3000](http://localhost:3000). The app runs without a database; caching, history and the API need one.

---

## Commands

```bash
npm run dev          # dev server
npm run build        # production build (does NOT typecheck)
npx tsc --noEmit     # typecheck — run this, the build will not catch type errors
npm run lint         # ESLint
npm run format       # Prettier

npm run db:push      # refuses; schema changes are hand-written SQL, see CLAUDE.md
npm run db:studio    # Drizzle Studio
```

---

## Environment variables

| Variable                                                   | Required              | Purpose                                               |
| ---------------------------------------------------------- | --------------------- | ----------------------------------------------------- |
| `DATABASE_URL`                                             | for anything stateful | Neon connection string                                |
| `STRIPE_SECRET_KEY`                                        | for payments          | checkout                                              |
| `STRIPE_WEBHOOK_SECRET`                                    | for payments          | webhook verification                                  |
| `STRIPE_PRICE_PACK_TRIAL`, `_CAMPAIGN`, `_SCALE`, `_INDEX` | for payments          | one Stripe Price id per pack, named in `lib/packs.ts` |
| `ADMIN_PASSWORD`                                           | for `/admin`          | fails closed when unset                               |
| `CRON_SECRET`                                              | for cron              | guards `/api/cron/*`                                  |
| `INNGEST_EVENT_KEY`                                        | optional              | faster batch processing                               |
| `INNGEST_SIGNING_KEY`                                      | optional              | as above                                              |

Identity-source credentials are listed in `.env.example`.

---

## Public API

Full reference at **[docs.walletlink.social](https://docs.walletlink.social/api-reference/introduction)**. Keys are self-serve from the account menu for any account holding credits. The two legacy Pro and Unlimited accounts keep their existing access unchanged.

```bash
curl https://walletlink.social/api/v1/wallet/0xd8da...96045 \
  -H "Authorization: Bearer wts_live_YOUR_KEY"
```

The API is measured twice. **Match credits** are the ones you bought, and a call draws them only for wallets that resolve. **Rate-limit units** are separate, are not bought, and bound how fast you may call.

| Endpoint                               | Match credits                                    | Rate-limit units        |
| -------------------------------------- | ------------------------------------------------ | ----------------------- |
| `GET /v1/wallet/{address}`             | 1 if the address resolves, 0 if not              | 1                       |
| `POST /v1/batch`                       | 1 per address that resolves, after deduplication | 1 per address submitted |
| `GET /v1/reverse/twitter/{handle}`     | 1 per wallet returned, up to 100                 | 2                       |
| `GET /v1/reverse/farcaster/{username}` | 1 per wallet returned, up to 100                 | 2                       |
| `GET /v1/stats`                        | 0                                                | 0                       |
| `GET /v1/usage`                        | 0                                                | 0                       |

A call made with no match credits left returns `402` with code `NO_CREDITS`.

| Account          | API plan  | Rate    | Daily  | Batch |
| ---------------- | --------- | ------- | ------ | ----- |
| Any pack         | Developer | 60/min  | 5,000  | 50    |
| Legacy Pro       | Developer | 60/min  | 5,000  | 50    |
| Legacy Unlimited | Startup   | 300/min | 50,000 | 200   |

`lib/api-plans.ts` is the single source of truth for these numbers (`CREDIT_API_PLAN` for pack holders, `TIER_API_PLAN` for the two legacy accounts), and the rate limiter reads the same module.

## Onchain rail (x402)

`POST /api/x402/buy` sells a $1 Agent pack for USDC on Base with no account, no card and no email: pay, and the response carries a fresh API key. 12 matches, about 51 resolvable addresses at the measured rate, roughly $0.0198 an address. A pack rather than per-call pricing, because the `exact` scheme charges before anything resolves and this product is sold on misses being free.

Off unless `X402_PAY_TO` is set. A payment rail with a default address is a rail that pays somebody else.

The Agent pack lives in `X402_PACKS`, never `PACKS`, so `isPackId()` refuses it and it cannot be bought with a card or appear on the nine surfaces `PACK_IDS` drives. Payments are idempotent on the EIP-3009 authorization, not the transaction hash: the hash is unknown when a facilitator times out.

`GET/POST /api/x402/recover` reissues a key to the wallet that paid, on a signed challenge. Signing is required because every field of a settled payment is public onchain, so nothing in a payment can prove who holds the wallet afterwards. Needs `X402_RECOVERY_SECRET`.

## MCP server

`https://walletlink.social/api/mcp`, five tools over the same six endpoints. Remote, on the same balance as the REST API. Listed in the official MCP registry as `social.walletlink/wallet-identity`, verified by DNS rather than by GitHub, so the namespace is the domain.

### Two ways in

A bearer key, which is what a server you run yourself should use, and an OAuth 2.1 connection, which is what a client with a person behind it should use.

The OAuth half is a full authorization server, not a delegation: `/.well-known/oauth-protected-resource` (RFC 9728) names the issuer, `/.well-known/oauth-authorization-server` (RFC 8414) names the endpoints, and both are rewrites in `next.config.ts` because the App Router will not route a directory whose name begins with a dot. Clients register through client ID metadata documents or dynamic registration (RFC 7591); both are public clients, so PKCE with `S256` is required and no secret is issued. The consent screen is `/oauth/authorize`.

**The access token is an `api_keys` row.** That is the design rather than a shortcut: metering, the three rate-limit windows, the balance check and the usage ledger all key off that table, and a second credential type would have needed a second copy of every one of them, which is where the meter starts disagreeing with itself. What an access token needs was already columns there. `expires_at` bounds it to an hour, `revoked_at` ends it, and the one new column, `oauth_grant_id`, is what tells it from a key somebody pasted into a config file. The consequence, written down rather than implied: an access token also authenticates a plain REST call, because it is the same credential type. The five tools are the six endpoints, so there is nothing on one surface that is not on the other.

Refusing has to happen at the transport. A tool call with no credential, or with an expired or revoked token, answers 401 with `WWW-Authenticate`; a 200 carrying a tool error is read by a client as a tool that failed, so no token is refreshed and nobody is offered a way to connect. A mistyped bearer key is deliberately not treated that way: it reaches the API and comes back as readable text, which is what somebody who has just pasted one needs.

Refresh tokens rotate, and the value each one replaced is kept. Presenting the replaced one is proof of a leak rather than a bad string, because the real client already exchanged it, and that revokes the whole grant. A replayed authorization code does the same.

### It bills nothing of its own

Each tool carries the caller's credential into the v1 handler, which already owns authentication, rate limiting and the debit. Doing either at the MCP layer would charge twice for one tool call. `app/api/mcp/route.ts` says why at length.

Discovery answers without a key, so a client can list the tools before buying anything. That is the one unauthenticated surface, and it is bounded by IP rather than by key.

The keys modal offers **Add to Cursor** and **Copy Claude Code command** on the screen where a new key is shown, since that is the only place a working one-click link can be built.

---

## Contributing

Changes go through a branch and a PR, never straight to `main`. The PR template asks for an explicit docs decision and CI enforces it: a PR touching the public API surface fails unless `docs-site/` moves with it, or carries the `no-docs-needed` label.

See [CLAUDE.md](CLAUDE.md) for conventions, including house style (sentence case headings, curly apostrophes, "onchain" as one word).

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## License

MIT

## Author

made with 🌠 by [@starl3xx](https://x.com/starl3xx)
