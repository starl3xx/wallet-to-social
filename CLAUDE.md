# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run format       # Prettier format all files (enforced by CI, see below)
npm run db:push      # REFUSES. See "Schema changes" below.
npm run db:generate  # Generate Drizzle migrations
npm run db:studio    # Open Drizzle Studio GUI
```

## Architecture

This is a Next.js 16 App Router application that batch-resolves Ethereum wallet addresses to social profiles (Twitter/X and Farcaster).

### Data Flow

1. User uploads CSV with wallet addresses → `lib/csv-parser.ts` extracts wallets and detects holdings columns
2. Frontend (`app/page.tsx`) creates a job with `POST /api/jobs` (wallets and options) and polls it; the old streaming `/api/lookup` route is retired (410)
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

- `wallet_cache` - 7-day TTL cache for API results (`CACHE_TTL_HOURS` in `lib/cache.ts`)
- `lookup_history` - Saved lookup sessions with full results (JSONB)
- `social_graph` - Permanent storage of all wallets with discovered social accounts, indexed for querying
- `credit_lots` - Purchased packs, spent FIFO by expiry (`granted`, `consumed`, `expires_at`)
- `credit_ledger` - Every match debited, one row per job; also the rolling 30-day free window

### Schema changes

**Hand-written SQL in `scripts/migrate-*.ts`, run manually with the owner
`DATABASE_URL`.** That is the only sanctioned path. Every one of those scripts is
idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) and ends
with a verification query that exits non-zero if the object is absent. Follow the
pattern.

**`npm run db:push` refuses, deliberately.** Measured against production on
2026-08-24, `drizzle-kit push` wanted to run 118 statements, 58 of them
destructive, opening with `DROP TABLE ... CASCADE` on eight tables holding 4.25
million rows, none of which are in the nightly backup. It also wanted to drop two
`social_graph` indexes with no re-create, which puts a live endpoint onto a
sequential scan of 5.1 million rows. It classes the drops as data-loss and
prompts on a TTY; in CI or with `--force` it does not ask. The real command
survives as `db:push:unsafe` for a scratch database or a Neon branch. The reason
is kept in `scripts/db-push-refuses.mjs` so it cannot be deleted as a mystery.

`db:generate` produced three migration files in January 2026 and was abandoned.
There is no `db:migrate` script, the journal has never matched the database, and
`db/migrations/` is a write-only artefact. Do not start trusting it without
reconciling it first.

**Run migrations against the direct endpoint, not the pooler.** `.env.local`'s
`DATABASE_URL` is the pooler (`...-pooler...`), and Neon's pooler keeps a bare
`SET` on a shared server backend across client connections: a migration that runs
`SET lock_timeout` can leave it set on a backend the app then uses. Drop
`-pooler` from the host for DDL, and use `SET LOCAL` inside an explicit
transaction, never a bare `SET`.

**A new table needs a grant before CI can read it.** Scheduled workflows connect
as the `sweep_runner` role, not the owner, and a table created after the role
split inherits nothing. Nothing fails at creation time; it fails later, in CI,
as `permission denied for table <name>` on a run that passed locally against the
owner role. Add the table to `READ_ONLY_TABLES` in
`scripts/migrate-grant-readonly.ts` and run it with the **owner** `DATABASE_URL`.
The script is idempotent and verifies the grants it made.

This is the code-facing half of the role split. The half that says which role's
credentials live where is in the private ops repo, deliberately.

### API Integrations

- **Web3.bio** (`lib/web3bio.ts`) - Primary source for ENS, Twitter, Farcaster, Lens, GitHub
- **Neynar** (`lib/neynar.ts`) - Farcaster profiles with follower counts and verified Twitter handles
- **ENS** (`lib/ens.ts`) - Optional onchain text record lookups (slower but most accurate for Twitter)

### Priority Score

Calculated as `holdings × log₁₀(fcFollowers + 1)` to rank wallets by both token holdings and social reach.

### Pricing and entitlement

`lib/packs.ts` is the only place a price lives. The product is credit packs, bought once and metered in **matches** (a wallet resolved to an X handle or a Farcaster account; misses cost nothing). Free is 100 matches per rolling 30 days, cumulative and account-wide. Credits last 12 months. There are no subscriptions.

- A pack purchase does **not** change `users.tier`. Never gate a feature on `tier`: that refused the people who had just paid.
- Server gates use `hasPaidAccess(userId, tier)` and `canSubmit()` from `lib/credits.ts`; API calls draw the same balance through `trackApiUsage`.
- Client gates use `useCredits(signedIn).entitled` from `lib/use-credits.ts`. The free allowance feeds `available` but never `entitled`.
- `pro` and `unlimited` are closed legacy tiers held by two accounts. They stay unmetered (`legacyTierIsUnmetered`) and must keep working; do not delete the tier values or `TIER_LIMITS`. Never show them as something for sale.

## Formatting

**Prettier is enforced.** `.github/workflows/format.yml` fails a PR whose files
are not formatted; run `npm run format` and commit the result.

It was unenforced until 2026-08-24, and that was worse than either alternative.
Nothing ran it, 150 of 352 files had drifted, and `npm run format` was therefore
a trap: any invocation rewrote a wide slice of the repo, so a one-line fix
arrived as a hundred-file diff. The repo was formatted once and the gate added
in the same PR, so drift cannot accumulate again.

One thing worth knowing before you distrust a reflow. Prettier will break a JSX
line between an expression and the text beside it:

```jsx
{FREE_MATCHES_PER_WINDOW} matches in a rolling {FREE_WINDOW_DAYS}
-day window
```

That is **safe**. JSX trims the newline and indentation adjacent to an
expression, so it renders `30-day window` with no stray space. React does emit
`<!-- -->` between the adjacent text nodes as a hydration delimiter, and a
browser never renders a comment. Any tool that strips HTML tags by replacing
them with a space will turn that delimiter into a phantom space and report a
bug that no reader can see. Verify against the rendered page, not against a
regex over the markup.

## Security invariants

**A comment asserting that an attacker cannot do something is a claim, and it
belongs in `scripts/check-invariants.ts` as an assertion that tries it.**

On 2026-08-24 and 25, four defects reached review with the same shape: a
confident justification with nothing anywhere that could contradict it.

| the comment said                              | the truth                                                 |
| --------------------------------------------- | --------------------------------------------------------- |
| possession of the payment payload is proof    | every field of a settled payment is public onchain        |
| a replayer also needs to read the reply       | they replay from their own socket and get their own reply |
| an Authorization header means this is metered | `Bearer hunter2` is not a key                             |
| this table is in the nightly dump             | it was in neither dump list                               |

Each was checkable in seconds. None was checked twice, because the repo
enforced button radius and palette on every PR and nothing about the money
path.

Two rules when adding to that file:

- **Assert the refusal, not the success.** A happy-path test would have passed
  on all four of those days.
- **Go through the code, never around it.** An assertion that recomputes what
  it is testing verifies only itself. That is not hypothetical: the first
  version of the HMAC assertion did exactly that and passed while the HMAC's
  coverage of the timestamp was deleted.

`scripts/check-invariants-guard.ts` reintroduces nine real defects and requires
each to be caught, because a guard verified only against passing code proves
nothing, and this repo has had three guards report clean over live violations.
Run it after touching either file.

## Documentation Updates

**Always update documentation when making commits:**

1. **CHANGELOG.md** - Add a dated entry at the top with bullet points of changes. (This used to live in README.md; it had grown to 480 lines and buried the actual README.)
2. **PROJECT_OVERVIEW.md** - Update if changes affect:
   - Architecture or data flow
   - Database schema
   - API endpoints
   - Environment variables
   - Pack/pricing structure (`lib/packs.ts` is the source of truth)
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
matters more here: the docs are indexed and permanent. Describe _capability_
("Farcaster coverage is complete") and _evidence class_ ("attested onchain"),
never provenance. The public `sources` field is mapped through
`lib/api-sources.ts` for exactly this reason, on an allowlist so an unmapped
internal source is dropped rather than leaked.

**Never publish from `docs/`.** That folder is internal engineering notes. Only
`docs-site/` is published. The backup, restore and database-role runbook is not
in this repo at all: it lives in the private **starl3xx/walletlink-ops**, since
it is a map of which secrets exist and where each one is kept. `docs/README.md`
gives the public/private test to apply when deciding where a new document goes.

**Verify claims before publishing them.** Coverage numbers, match rates and
completeness claims should be checked against the database or `/v1/stats`, not
copied from older copy. Keep "has an identity" (~23%) and "reachable on X or
Farcaster" (~13%) distinct wherever either appears.

**Write the number that came back, not the number you set out to get.** On
2026-08-17 the docs said we had resolved "all 440,700 distinct X handles". The
sweep had resolved 417,872: it leaves transport failures unrecorded so they
retry, so its result was never going to equal its target. The copy was written
from the intention. Be most suspicious of "all", "every" and "complete" in your
own sentences, because a pipeline with a retry path does not do all of anything
on the first pass.

**Every published figure must be declared in `scripts/check-published-figures.ts`.**
It reads each number out of the copy and compares it with a live query, and a
claim it can no longer find is an error rather than a shrug. This is a scheduled
check, not a PR one, because the index grows daily: a figure goes stale with no
commit, no diff and no pull request, which no review can catch. If you publish a
new number, add it to the registry in the same change.

## UI Guidelines

- **Never reference API providers in the UI** (e.g., Web3.bio, Neynar). Use generic terms like "all data sources" instead. API details are implementation details that users don't need to see.
- **Social proof should show comparisons, not progress** - When displaying match rates (e.g., 22%), don't use progress bars (makes it look incomplete). Show the number prominently with qualitative context ("many times what typical tools publish"). **Never cite a numeric "industry average"**: the old ~2.5%/"9x avg" figure had no source and was purged from every public surface on 2026-08-22. Comparisons use our own measured figures or stay qualitative.
- **Header logo is always clickable** - Returns user to homepage from any state.
- **Sentence case for headings** - Use "My lookups" not "My Lookups". Only capitalize the first word and proper nouns.
- **Curly apostrophes in UI** - Use curly apostrophes (') not straight ones ('). Example: "We'll" not "We'll".

## Design language

**`docs/DESIGN-LANGUAGE.md` is the canonical reference for every visual decision.**
Radius, elevation, type scale, weight, tracking, spacing, control height, mono
policy, numerals, affordance, motion, icons and per-surface coverage. If a value is
not there, it should not be in the code.

The summary below covers colour only, because colour is the part with a CI guard.
Everything else is in that file.

**`npx shadcn add <x>` produces a starting point, never a finished component.**
It compiles and renders and is still wrong: library radius, library elevation,
library control height, library colour semantics. `components.json` is set to
generate Phosphor icons, and `lucide-react` is uninstalled so a stray import
fails rather than works. `baseColor` cannot be set honestly, since every value
emits the same `--primary` set the components are written against, so the guard
catches that on the output side instead. The adaptation checklist is in
`docs/DESIGN-LANGUAGE.md` under "Adding a shadcn component".

## Colour

Four semantic tokens, defined in `app/globals.css`. **Never a raw Tailwind
palette class** (`text-green-500`, `bg-blue-50`, `bg-gray-500`). An ESLint rule and
`.github/workflows/design-tokens.yml` both enforce this, across all 22 shaded
families **including the neutrals** — the guard originally listed only the 17
chromatic ones and reported clean over 18 live violations.

| Token                                 | Means                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `accent-brand`, `accent-brand-tint`   | **an affordance.** Anything you can act on: buttons, links, focus, selected, the logo       |
| `attested`, `attested-tint`           | **a measured fact.** An identity the owner published, a system that is live, a real outcome |
| `caution`, `caution-tint`             | truncated results, stale records, approaching a limit                                       |
| `destructive`                         | revoking a key, deleting a lookup                                                           |
| `muted`, `muted-foreground`, `border` | everything else, which is most of the screen                                                |

The tokens are theme-aware, so `bg-accent-brand-tint` already handles dark. A
`dark:` variant restating the same token is redundant.

**`attested` is the one to be careful with.** On a results row it is a claim about
provenance, and there it must be driven by `twitter_verified` /
`farcaster_verified`, never by `source` (which holds pipeline stage markers like
`graph` and `cache` on the forward path).

The wider rule is **green marks a measured fact, violet marks an affordance**. That
covers the row gutter dot, the live pulse, the hit rate and the whitelist chip
without a second green. What green must never mark is **an inference presented as
confirmation**, which is the distinction the product is sold on. A palette that
coloured each pricing tier differently taught users nothing; this teaches them the
one thing that matters.

One named exception: a selected platform in a segmented control takes that
platform's own colours (𝕏 white on `#0F1419`, Farcaster white on `#8A63D2`). Those
identify a platform, not an affordance.

## House style

These apply to **everything written for a human**: UI copy, docs, README, blog
posts, commit messages, JSON-LD, and the AI assistant's system prompt. Not just
the UI.

- **"onchain", never "on-chain" or "on chain".** One word, always. Same for
  "offchain". Check `On-chain` and `On-Chain` too, since a capitalized variant
  slips past a lowercase search.
- **No em dashes.** Use the mark the sentence actually wants: a colon, a
  semicolon, a comma, or brackets. Check for `&mdash;` entities as well.
- **Sentence case for headings**, in docs and README as much as in the UI.

The assistant carries the onchain rule in its system prompt explicitly,
including an instruction to apply it even when the retrieved context spells it
the other way. If you change that prompt, keep the rule (see
`docs/AI-SEARCH.md`).

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
