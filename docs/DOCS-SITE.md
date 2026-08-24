# Docs site (Mintlify) — setup notes

Content lives in **`docs-site/`**, not in this folder.

## Status

| Piece                        | State                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Mintlify project             | exists (`walletlink`)                                                                               |
| `docs.walletlink.social` DNS | **done**, verified resolving                                                                        |
| Mintlify MCP servers         | **done**, in `.mcp.json`                                                                            |
| Docs content                 | **live and maintained**, in `docs-site/`                                                            |
| Mintlify GitHub sync         | **connected**, content root `docs-site/`; a merge to `main` publishes (verified current 2026-08-22) |
| Freshness enforcement        | **done** — PR template + `.github/workflows/docs-freshness.yml`                                     |

## `docs-site/` vs `docs/`

Two folders, and mixing them up publishes internal material.

- **`docs-site/`** is the published site. Safe for customers.
- **`docs/`** (this folder) is internal engineering notes. It must never be the
  Mintlify content root.

When connecting Mintlify's GitHub app, set the content directory to
`docs-site/`. The default of repository root would publish this file and every
other note in this folder.

The database role-split runbook and the backup/restore procedure used to sit
here as `SECURITY.md`. They now live in the private **starl3xx/walletlink-ops**
repo and are gitignored here, so a checkout of this repository will not contain
them. See `README.md` in this folder for the rule that decides where a new
document belongs.

## What is written

13 pages. `index`, `quickstart`, two concept pages, and a nine-page API
reference covering all six `/v1` endpoints, plus rate limits and error codes.

Response shapes were read off the route handlers rather than off README, which
had drifted: it advertised the API plans as standalone monthly subscriptions
($49/$199/$799), which `lib/api-plans.ts` marks "seeded but not sold". Fixed
2026-08-21: README now carries the pack model, and
`/api/developer/plans` publishes the packs instead of the monthly plan prices.

What the code enforces, and what the docs describe: `apiPlanForAccount()` grants
the `developer` plan to any account holding credits (`CREDIT_API_PLAN`), and
`TIER_API_PLAN` still grants `developer`/`startup` to the two legacy Pro and
Unlimited accounts, whichever is higher. Every API call draws the same match
credits as the app and returns `402 NO_CREDITS` on an empty balance. The docs
describe the credit-holding case first and name the legacy tiers as legacy.

## Known gaps the docs work surfaced

1. **No key-management UI.** Resolved. `components/ApiKeysModal.tsx` is reachable
   from the account menu, and `POST /api/developer/keys` is gated on a live
   credit balance or a legacy paid tier (`lib/developer-auth.ts`). The quickstart
   now says keys are self-serve and that API access comes with every pack. Kept
   here so the gap list stays honest about what it once said.
2. **`requests_by_endpoint` has unbounded cardinality.** Resolved. The write
   sites store the route template (`/v1/wallet/{address}` and the two reverse
   twins), the `withApiAuth` wrapper derives it with `routeTemplate()` in
   `lib/api-usage.ts`, and `scripts/migrate-endpoint-templates.ts` rewrote the
   history, which also removed customer query targets from the analytics
   table. Kept here so the gap list stays honest about what it once said.
3. **No pagination on reverse lookups.** Resolved. Both `/v1/reverse` routes
   take a `cursor` query parameter and return `meta.next_cursor`, a keyset
   cursor over (`fc_followers DESC NULLS LAST`, `wallet ASC`) in
   `lib/reverse-cursor.ts`. Adding the ORDER BY also ended the arbitrary
   100-row slice the routes served before. Kept here so the gap list stays
   honest about what it once said.

## DNS (added 2026-08-14, Cloudflare zone `walletlink.social`)

| Type  | Name                       | Value                                         |
| ----- | -------------------------- | --------------------------------------------- |
| TXT   | `_acme-challenge.docs`     | `XXL5AStlV9K3tm2oItgE9A8RX23wRqrKDAXfPBdswzQ` |
| TXT   | `_cf-custom-hostname.docs` | `636e4cce-2074-4b9b-860d-edffdb2bca3e`        |
| CNAME | `docs`                     | `cname.mintlify.builders`                     |

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

**`/mcp` is therefore a reserved path on the docs site.** Mintlify serves its
own documentation-search MCP endpoint there, and it wins: a page at
`docs-site/mcp.mdx` is shadowed, and a browser asking for
`https://docs.walletlink.social/mcp` gets `{"error":{"code":-32000,"message":
"Method not allowed."}}` rather than the page. It was published that way for
about an hour, with the dead URL in the MCP registry listing, before anybody
loaded it. Our own page lives at `/mcp-server`.

Static files in `docs-site/` are served from the docs root, so
`docs-site/openapi.yaml` is public at
`https://docs.walletlink.social/openapi.yaml` with no navigation entry and no
auto-generated endpoint pages. That is the reason the spec is not registered in
`docs.json`: registering it would generate a page per endpoint, duplicating the
nine hand-written ones, and it is already reachable without doing so.

`.mcp.json` is committed on purpose: it is project-scoped config, contains no
secrets, and means anyone cloning the repo gets the same servers.

## Still to write

1. **Contract import guide** — supported chains and which holder types work
   where. Derive it from `SUPPORTED_CHAINS` / `ERC20_SUPPORTED_CHAINS` in
   `lib/chains.ts` rather than hand-listing; hand-listed chain copy has already
   gone stale twice. `lib/chains.ts` is in the docs-freshness watch list for
   this reason.
2. **CSV upload guide** — column detection, priority scoring, export formats.
3. **Client libraries or an OpenAPI spec.** The reference is hand-written MDX.
   A generated spec would remove a whole class of drift, and Mintlify can render
   one directly.

## Verified facts behind the coverage claims

Checked against production on 2026-08-14, not copied from older copy:

- `MAX(fc_fid)` = 3,346,331, with 4,699,430 wallets carrying an FID.
- Distinct FIDs per 250k bucket run 247.5k–250k across every bucket from 0 to
  3.25M. No gap. Farcaster coverage really is contiguous and complete, so the
  claim on the marketing site is accurate.
- This supersedes the older note that the sweep was stalled at FID 2,396,590.
  The daily incremental cron closed that gap.

Re-run before republishing any coverage number:

```sh
node --input-type=module --env-file=.env.local -e "
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
console.log(await sql\`SELECT (fc_fid/250000)*250000 AS bucket, COUNT(DISTINCT fc_fid) AS fids
  FROM social_graph WHERE fc_fid IS NOT NULL GROUP BY 1 ORDER BY 1\`);
"
```

Support address for the docs and the site: **help@walletlink.social**
(`gm@walletlink.social` is the friendlier general/inbound one). Both forward to
`starl3xx.mail+walletlink@gmail.com` via Cloudflare Email Routing, which was
enabled on 2026-08-14 — the rules existed before that but the DNS did not, so
mail to those addresses was being rejected.
