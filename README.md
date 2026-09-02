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

The chain decides this more than the collection does: Base sits at the top of that range because Base is where Farcaster lives, Ethereum near the bottom. The measured per-chain table lives in the [coverage docs](https://docs.walletlink.social/concepts/coverage). Use your chain’s figure, not an average.

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
| **Agent detection**  | 13,622+ known AI agent wallets flagged                                                            |
| **Reverse lookup**   | X handle or Farcaster username back to wallets                                                    |
| **Public API**       | Included with every pack, drawing the same credits; self-serve keys                               |
| **MCP server**       | Eight tools at `/api/mcp`, OAuth or the same key, same balance; listed in the MCP registry        |
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

Every pack includes the same features; packs differ only in how many matches they hold. `lib/packs.ts` is the source of truth: the pricing modal, the checkout, the comparison pages and the schema.org offers all read from it.

---

## API, MCP and the agent rail

Three doors into the same index, drawing the same match balance. The full reference, including credit costs, rate limits and error codes, is at **[docs.walletlink.social](https://docs.walletlink.social/api-reference/introduction)**; the README does not restate it.

**REST.** Keys are self-serve from the account menu for any account holding credits. A call draws credits only for wallets that resolve.

```bash
curl https://walletlink.social/api/v1/wallet/0xd8da...96045 \
  -H "Authorization: Bearer wts_live_YOUR_KEY"
```

**MCP.** `https://walletlink.social/api/mcp`, eight tools over the same endpoints, with a bearer key or an OAuth 2.1 connection. Listed in the official MCP registry as `social.walletlink/wallet-identity`. The design rationale (why the access token is an `api_keys` row, why the server bills nothing of its own) lives in the header of `app/api/mcp/route.ts`.

**Onchain rail.** `POST /api/x402/buy` sells a $1 Agent pack for USDC on Base with no account, no card and no email: pay, and the response carries a fresh API key. `/api/x402/recover` reissues a key to the wallet that paid, on a signed challenge.

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

Negatives are persisted deliberately. “Checked, nothing there” is an answer worth keeping, and it is what stops the pipeline paying repeatedly to rediscover the same absence.

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

## Public on purpose

This repo is public deliberately. The product’s core claim is that every match carries the class of evidence behind it and none of it is inferred, and public code is what makes that claim checkable. What stays out is equally deliberate: `docs/` is internal and never published, and operational secrets live in a private ops repo.

---

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in what you need
npm run dev
```

Open [localhost:3000](http://localhost:3000). The app runs without a database; caching, history and the API need one. `.env.example` documents every variable: `DATABASE_URL` enables anything stateful, the Stripe keys enable payments, and identity-source credentials are listed beside their entries.

---

## Commands

```bash
npm run dev            # dev server
npm run build          # production build (typechecks as part of the build)
npm run typecheck      # tsc --noEmit, the faster standalone check
npm run preflight      # every CI gate that needs no database, no Chrome and no secrets
npm run lint           # ESLint
npm run format         # Prettier (CI enforces formatting)

npm run db:push        # refuses; schema changes are hand-written SQL, see CLAUDE.md
npm run db:studio      # Drizzle Studio
```

`npm run check:<guard>` runs one gate alone (palette, design, contrast, og, invariants, figures, height); `package.json` names them all.

---

## Contributing

Changes go through a branch and a PR, never straight to `main`. The PR template asks for an explicit docs decision and CI enforces it: a PR touching the public API surface fails unless `docs-site/` moves with it, or carries the `no-docs-needed` label.

See [CLAUDE.md](CLAUDE.md) for conventions, including house style (sentence case headings, curly apostrophes, “onchain” as one word).

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## License

AGPL-3.0. See [LICENSE](LICENSE).

## Author

made with 🌠 by [@starl3xx](https://x.com/starl3xx)
