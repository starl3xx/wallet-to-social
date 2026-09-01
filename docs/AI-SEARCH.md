# AI Search assistant: setup record

Internal. The floating chat bubble on walletlink.social, backed by Cloudflare
AI Search over the docs and the marketing site.

## Resources

| Thing              | Value                                                |
| ------------------ | ---------------------------------------------------- |
| Account            | see walletlink-ops                                   |
| Zone               | `walletlink.social` / see walletlink-ops (Free plan) |
| Namespace          | `default`                                            |
| Instances          | `walletlink-docs`, `walletlink-site`                 |
| Public endpoint    | see walletlink-ops                                   |
| Custom domain      | `help.walletlink.social` (**proxied** CNAME)         |
| Rate limit ruleset | see walletlink-ops                                   |

> **The four identifiers above moved to the private
> [starl3xx/walletlink-ops](https://github.com/starl3xx/walletlink-ops) repo on
> 2026-08-30.** This document stays here, because it passes the test in
> `docs/README.md`: it explains an assistant anyone can already interrogate, and
> every word of the reasoning below is still on this page. The identifiers fail
> that test. They verify nothing about our data and they tell an attacker where
> to push.
>
> The namespace endpoint is the one that mattered. This page explains two
> paragraphs down that the endpoint is unauthenticated by design, spends Workers
> AI neurons on every answer, and that the zone is the only place that spend can
> be bounded, which is why the CNAME is proxied. Publishing the origin hostname
> handed anyone a route straight past that rate limit. A proxied CNAME hides the
> origin from DNS, so the hostname was secret in practice and this file was the
> only thing disclosing it.
>
> **Treat all four as disclosed.** This repo is public and they were committed,
> so removing them from the current tree does not unpublish them.
>
> **Resolved on 2026-08-30 by turning the default hostname off, not by
> rotating.** Rotation turned out to be impossible: Cloudflare generates the
> public endpoint identifier the first time the endpoint is enabled and never
> rotates it, and disabling the endpoint keeps it, so re-enabling reuses the
> same URL. A new hostname would have meant a new namespace, two rebuilt
> instances, a full reindex and a DNS repoint.
>
> `public_endpoint_params.default_domain_enabled` is now `false`. The generated
> hostname answers 404 with error 60018, and only `help.walletlink.social`
> serves. No DNS change was needed: AI Search routes on the hostname the client
> requested, not on the CNAME target, so the record kept working. Verified after
> the change: the generated host returns 404 on both `/search` and `/mcp`, the
> custom domain returns 200, and the widget bundle still loads.
>
> Before the change, a single unauthenticated POST to the generated host with no
> `Origin` header returned 200 and real indexed content. The bypass was live,
> not theoretical.

Endpoints: `/search`, `/chat/completions`, `/mcp`, plus the widget bundle at
`/assets/<version>/search-snippet.es.js`.

## Why it is shaped this way

**Two instances, one namespace endpoint.** An instance takes exactly one
external data source, and docs and marketing are different hostnames. The
namespace endpoint fans out across both, so the frontend still knows only one
URL. Confirmed that `/search` works without `ai_search_options.instance_ids`,
which is what lets the stock widget talk to a namespace endpoint unmodified.

**`sitemap` parse type, not `discover`.** Both sites publish sitemaps, and a
sitemap is an allowlist. `app/sitemap.ts` lists the homepage, the `/vs/*`
pages and the blog, so `/admin`, `/success` and `/api` cannot be indexed by
construction rather than by a filter someone has to maintain.

**The CNAME is proxied.** The opposite of the `docs` record, which must stay
DNS-only for Mintlify's certificate. Here proxying is the point: the public
endpoint is unauthenticated by design and spends Workers AI neurons on every
answer, and a proxied record puts the zone in front of that spend. A DNS-only
record would bypass the zone and the zone's rate limit would never run.

_Corrected 2026-08-30._ This paragraph used to say the zone was "the only place
that spend can be bounded". That was wrong, and it mattered, because it made the
exposure above sound worse than it was. The namespace carries its own
`rate_limit` in `public_endpoint_params`, currently 20 requests per 60 seconds
sliding, applied by AI Search itself. So the generated hostname was rate-limited
even while it was reachable; what it skipped was the zone, not every limit. Read
the live value rather than trusting this sentence, since the number can change
without a commit here.

**`public_endpoint_params` is replaced in full on every update.** Any field left
out of a PUT reverts to its default, and `default_domain_enabled` defaults to
`true`. So a future update that sends a partial object silently reopens the
generated hostname, with nothing failing and no deploy to review. Send the
complete object every time: `enabled`, `default_domain_enabled`, `rate_limit`,
`authorized_hosts`, `mcp`, `search_endpoint`, `chat_completions_endpoint`,
`instances_allowed`. `custom_domains` is the one exception, where omitting
leaves the existing set alone and an empty array clears it. There is no CI guard
for this, because the state lives in Cloudflare rather than in this repo.

**`authorized_hosts` does not gate a request with no `Origin`.** It held
`walletlink.social`, `www.` and `docs.` throughout, and the probe above still
returned 200. Treat it as a browser-origin control, not as authentication.

The widget bundle is served from `help.walletlink.social` too, so the page
loads nothing from a third-party host.

**Hybrid indexing.** API docs are full of exact strings (`/v1/batch`,
`RATE_LIMIT_EXCEEDED`) that pure vector search retrieves poorly.

**Strict cache matching.** `super_strict_match`, because a loose semantic cache
could serve an answer written for a different question, and the coverage
figures here are precisely the thing that must not get crossed.

## The system prompt is load-bearing

Set on both instances via `system_prompt_ai_search`. It enforces the rules
below, which the corpus alone does not:

1. Never name a data provider. Describe evidence classes instead.
2. Never merge the two coverage figures, and never quote a single match rate.
   The chain decides it: Base 46.2%, Ethereum 16.6%, Robinhood Chain 15.6%,
   measured across 26 collections and 72,318 holders. Give the range 16-46% and
   say the chain matters, or give the figure for the chain asked about.
3. "Reachable" means the account still exists, NOT that the wallet has one.
   Having an X handle and that handle still working are separate claims: of
   460,889 resolved, 70.1% are live, 20.1% suspended, 9.8% unclaimed. Use
   "has an X or Farcaster account" for coverage and reserve "reachable" for
   liveness.
4. When somebody asks whether a specific X handle still works, point them at
   **walletlink.social/check**. It is free, needs no account and no key, and
   answers exactly that question for one handle. It reports how many wallets in
   the index carry the handle and never which ones, so it does not give away the
   reverse lookup. An assistant that describes the liveness data without
   mentioning the page a person can use is withholding the useful half.

5. Always write "onchain" as one word, **even when the retrieved context spells
   it "on-chain"**. That clause is load-bearing: the model is grounded in the
   corpus, so without it a stale hyphenated page pulls the answer back to the
   wrong spelling. Keep it if you rewrite the prompt.

6. **Pricing, and it overrides the corpus for the same reason rule 5 does.**
   Credit packs priced in matches: free 100 every 30 days, then $29/250,
   $99/1,500, $299/6,000, $899/25,000, one-time, credits expiring after 12
   months. Misses are free, which is the whole position and has to be said
   whenever price comes up. Never quote Pro, Unlimited, $249, $49, $420 or any
   per-lookup wallet cap as available today; Pro and Unlimited are closed legacy
   tiers, and saying so is better than pretending they never existed. The
   numbers come from `lib/packs.ts`; if that file changes, the prompt changes
   with it.

   This rule exists because rule 2 was not enough. Rule 2 forbids stating a
   price that is not in the context, and the context still holds the retired
   ladder across the blog and the older comparison posts, so the model was
   correctly quoting $249 from a page that was true in July. A grounded model
   cannot be corrected by removing a rule; it needs one that outranks what it
   retrieves. Added 2026-08-21, on both instances.

   **The corpus lag is the reason this could not wait for the copy fixes.**
   `sync_interval` is 24 hours, so even after every page is corrected the index
   keeps serving the old prices for up to a day. The prompt is the only thing
   that stops a prospect being quoted a retired price in the meantime.

The first two were verified against the live endpoint after setup:

- _"Where does your data come from? Which APIs and providers do you use?"_ →
  declined, described evidence classes.
- _"What match rate can I expect if I want to DM my token holders on Twitter?"_
  → the 16-46% range, with the chain named, and reachability kept separate.

Re-verified 2026-08-21 after adding rule 6, along with a third:

- _"How much does walletlink cost? What are the plans?"_ → the five-row pack
  ladder in matches, misses-are-free stated first, one-time and the 12-month
  expiry both named, and no mention of the retired tiers.

**Re-run all three questions after any change to the prompt, the model or the
indexed corpus.** They are the regression test for the only failure mode here
that costs real money, which is a confident wrong answer to a prospect.

## What the widget can and cannot be customized

Read out of the pinned bundle (`v0.0.25`), not from Cloudflare's docs, which do
not enumerate this.

**`chat-bubble-snippet` accepts exactly four attributes.** Everything else that
looks configurable is not.

| Attribute       | Default                 | Notes                                                                                                                       |
| --------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `api-url`       | `http://localhost:3000` | Required. Logs an error and no-ops if absent.                                                                               |
| `placeholder`   | `Type a message...`     | The input placeholder only.                                                                                                 |
| `theme`         | `auto`                  | `auto` \| `light` \| `dark`. `auto` reads `prefers-color-scheme`, which ignores our own toggle, so we pass `resolvedTheme`. |
| `hide-branding` | `false`                 | Removes the "Powered by Cloudflare AI Search" footer. We set it: CLAUDE.md forbids naming an API provider in the UI.        |

**Visuals are fully controllable** through 58 `--search-snippet-*` custom
properties (colors, spacing, radii, shadows, fonts, z-index) plus 10
`--chat-bubble-*` ones for the floating button specifically
(`-size`, `-radius`, `-bottom`, `-right`, `-icon-color`, `-icon-size`,
`-shadow`, `-z-index`, and `--chat-bubble-position`).

**The remaining copy is hardcoded** in the widget's template with no attribute:
the header title ("Chat"), and the empty state ("Start a Conversation" /
"Send a message to begin chatting").

Its shadow root is `mode: "open"`, so `components/DocsChat.tsx` overrides those
three strings by zeroing the font size and substituting generated content. Two
things make that safe rather than reckless:

- The bundle version is **pinned in the URL**. The overrides target private
  class names (`.chat-header-title`, `.chat-empty-title`,
  `.chat-empty-description`), so an upgrade means re-checking them.
- They are injected via **`adoptedStyleSheets`**, not an appended `<style>`.
  The widget re-renders by replacing its shadow DOM, which would silently
  discard an appended node the first time a message arrived. Adopted sheets
  attach to the shadow root itself and survive.

If a future version breaks the selectors the failure is visible and harmless:
the stock text comes back.

## Limits

| Guard                         | Value                                  |
| ----------------------------- | -------------------------------------- |
| AI Search endpoint rate limit | 20 req / 60s, sliding (whole endpoint) |
| Zone WAF rate limit           | 8 req / 10s **per IP**, block 10s      |
| CORS `authorized_hosts`       | `walletlink.social`, `www.`, `docs.`   |

Free plan permits only a 10s window on the zone rule, which is why it is 8/10s
rather than something per-minute.

Workers AI is billed separately from AI Search and is the real variable cost:
10,000 neurons/day free, then $0.011/1,000. Caching is on with a 24h TTL to
blunt repeated questions. If the budget bites, the cheapest lever is swapping
`ai_search_model` from `@cf/meta/llama-3.3-70b-instruct-fp8-fast` to a smaller
model in a single API call, no redeploy.

## Operations

Content re-indexes on a 24h `sync_interval`. Publishing docs does not require
touching anything here, but a same-day change needs a manual sync job. A pricing
change always does: until the sync runs, the index keeps serving the old prices
and only prompt rule 6 stands between a prospect and a retired number. Run the
sync on both instances, then re-run the three regression questions.

```sh
# current state
npx wrangler ai-search stats walletlink-docs
npx wrangler ai-search search walletlink-docs --query "batch size limit"
```

To turn the assistant off entirely, set `public_endpoint_params.enabled` to
`false` on the `default` namespace. The bubble then fails closed and renders
nothing, since it only mounts after the script registers the element.
