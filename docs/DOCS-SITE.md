# Docs site (Mintlify) — setup notes

Not built yet. This records what is already wired so the build can start cold.

## Status

| Piece | State |
|---|---|
| Mintlify project | exists (`walletlink`) |
| `docs.walletlink.social` DNS | **done**, verified resolving |
| Mintlify MCP servers | **done**, in `.mcp.json` |
| Docs content | **not started** |

## DNS (added 2026-08-14, Cloudflare zone `walletlink.social`)

| Type | Name | Value |
|---|---|---|
| TXT | `_acme-challenge.docs` | `XXL5AStlV9K3tm2oItgE9A8RX23wRqrKDAXfPBdswzQ` |
| TXT | `_cf-custom-hostname.docs` | `636e4cce-2074-4b9b-860d-edffdb2bca3e` |
| CNAME | `docs` | `cname.mintlify.builders` |

The CNAME is deliberately **DNS-only, not proxied**. Proxying it would terminate
TLS at Cloudflare and break Mintlify's certificate for the custom hostname.

All three verified resolving through 1.1.1.1. Mintlify's dashboard validates the
TXT records before issuing the cert, so the domain may show pending for a while
after the records go in.

## MCP servers (`.mcp.json`, project scope)

- **`mintlify`** → `https://www.mintlify.com/docs/mcp` — Mintlify's own
  documentation. Live now, and the thing to consult when building the site
  (frontmatter, `docs.json` schema, components).
- **`walletlink-docs`** → `https://docs.walletlink.social/mcp` — our docs.
  Returns 403 until the site is actually published; it is configured ahead of
  time so it starts working the moment there is content.

`.mcp.json` is committed on purpose: it is project-scoped config, contains no
secrets, and means anyone cloning the repo gets the same servers.

## When we build it

Content worth covering, in rough priority order:

1. **API reference** — `/v1/wallet/{address}`, `/v1/batch`, the reverse lookups
   (`/v1/reverse/twitter/{handle}`, `/v1/reverse/farcaster/{username}`), auth,
   rate limits and the per-plan quotas in `lib/api-plans.ts`. This is the part
   with real commercial value: the reverse lookup is the differentiator.
2. **Data model** — what a match means, and the distinction the marketing copy
   works hard to keep straight: Farcaster coverage is complete, Twitter is
   owner-attested, and "any identity" (~23%) is not the same as "reachable on X
   or Farcaster" (~13%).
3. **Contract import** — supported chains and which holder types work where.
   Keep it derived from `SUPPORTED_CHAINS` / `ERC20_SUPPORTED_CHAINS` in
   `lib/chains.ts` rather than hand-listed; hand-listed chain copy has already
   gone stale twice.
4. **Quickstarts** — CSV upload, contract import, first API call.

Support address for the docs and the site: **help@walletlink.social**
(`gm@walletlink.social` is the friendlier general/inbound one). Both forward to
`starl3xx.mail+walletlink@gmail.com` via Cloudflare Email Routing, which was
enabled on 2026-08-14 — the rules existed before that but the DNS did not, so
mail to those addresses was being rejected.
