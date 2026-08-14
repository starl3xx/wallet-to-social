# AI Search assistant — setup record

Internal. The floating chat bubble on walletlink.social, backed by Cloudflare
AI Search over the docs and the marketing site.

## Resources

| Thing | Value |
|---|---|
| Account | `7f7320799b461a1dc32c14ca69ada49c` |
| Zone | `walletlink.social` / `5f07ca0d1b1eccdb9cc6786ac47de42a` (Free plan) |
| Namespace | `default` |
| Instances | `walletlink-docs`, `walletlink-site` |
| Public endpoint | `ns-a505678a-aa07-4497-affa-40590b1f63c5.search.ai.cloudflare.com` |
| Custom domain | `help.walletlink.social` (**proxied** CNAME) |
| Rate limit ruleset | `a08dbe0efe7e496397d12b8a97b024f9` |

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
DNS-only for Mintlify's certificate. Here proxying is the entire point: the
public endpoint is unauthenticated by design and spends Workers AI neurons on
every answer, so the zone is the only place that spend can be bounded. A
DNS-only record would bypass the zone and the rate limit would never run.

The widget bundle is served from `help.walletlink.social` too, so the page
loads nothing from a third-party host.

**Hybrid indexing.** API docs are full of exact strings (`/v1/batch`,
`RATE_LIMIT_EXCEEDED`) that pure vector search retrieves poorly.

**Strict cache matching.** `super_strict_match`, because a loose semantic cache
could serve an answer written for a different question, and the coverage
figures here are precisely the thing that must not get crossed.

## The system prompt is load-bearing

Set on both instances via `system_prompt_ai_search`. It enforces two rules that
the corpus alone does not:

1. Never name a data provider. Describe evidence classes instead.
2. Never merge the two coverage figures. ~23% is any identity including ENS;
   ~13% is reachable on X or Farcaster. Outreach questions get 13%.

Both were verified against the live endpoint after setup:

- *"Where does your data come from? Which APIs and providers do you use?"* →
  declined, described evidence classes.
- *"What match rate can I expect if I want to DM my token holders on Twitter?"*
  → 13%, and explicitly distinguished it from 23%.

**Re-run those two questions after any change to the prompt, the model or the
indexed corpus.** They are the regression test for the only failure mode here
that costs real money, which is a confident wrong answer to a prospect.

## What the widget can and cannot be customized

Read out of the pinned bundle (`v0.0.25`), not from Cloudflare's docs, which do
not enumerate this.

**`chat-bubble-snippet` accepts exactly four attributes.** Everything else that
looks configurable is not.

| Attribute | Default | Notes |
|---|---|---|
| `api-url` | `http://localhost:3000` | Required. Logs an error and no-ops if absent. |
| `placeholder` | `Type a message...` | The input placeholder only. |
| `theme` | `auto` | `auto` \| `light` \| `dark`. `auto` reads `prefers-color-scheme`, which ignores our own toggle, so we pass `resolvedTheme`. |
| `hide-branding` | `false` | Removes the "Powered by Cloudflare AI Search" footer. We set it: CLAUDE.md forbids naming an API provider in the UI. |

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

| Guard | Value |
|---|---|
| AI Search endpoint rate limit | 20 req / 60s, sliding (whole endpoint) |
| Zone WAF rate limit | 8 req / 10s **per IP**, block 10s |
| CORS `authorized_hosts` | `walletlink.social`, `www.`, `docs.` |

Free plan permits only a 10s window on the zone rule, which is why it is 8/10s
rather than something per-minute.

Workers AI is billed separately from AI Search and is the real variable cost:
10,000 neurons/day free, then $0.011/1,000. Caching is on with a 24h TTL to
blunt repeated questions. If the budget bites, the cheapest lever is swapping
`ai_search_model` from `@cf/meta/llama-3.3-70b-instruct-fp8-fast` to a smaller
model in a single API call, no redeploy.

## Operations

Content re-indexes on a 24h `sync_interval`. Publishing docs does not require
touching anything here, but a same-day change needs a manual sync job.

```sh
# current state
npx wrangler ai-search stats walletlink-docs
npx wrangler ai-search search walletlink-docs --query "batch size limit"
```

To turn the assistant off entirely, set `public_endpoint_params.enabled` to
`false` on the `default` namespace. The bubble then fails closed and renders
nothing, since it only mounts after the script registers the element.
