# docs/

Internal engineering notes. **Not published.** The customer-facing Mintlify
site is built from `docs-site/`, and Mintlify's content root is set to that
directory precisely so nothing here reaches docs.walletlink.social.

| File                 | What it covers                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `AGENT-SYSTEM.md`    | The design authority for the agent surface: the layer tower, the physics, the gap register, and the roadmap                   |
| `AI-SEARCH.md`       | The assistant on walletlink.social: instances, endpoint, rate limits, the load-bearing system prompt, and its regression test |
| `CI.md`              | Every CI gate: trigger, dependencies, deterministic or environmental, what a red means, local repro                           |
| `DESIGN-LANGUAGE.md` | The canonical reference for every visual decision: radius, elevation, type, spacing, colour, motion, per-surface coverage     |
| `DOCS-SITE.md`       | Mintlify setup, DNS, and what the docs still need                                                                             |
| `EMAIL-SEQUENCE.md`  | Lifecycle email: the relaunch campaign record and the live welcome sequence                                                   |
| `OPERATIONS.md`      | Live posture per pipeline, the PR protocol (Bugbot included), and standing constraints                                        |
| `SEO-STRATEGY.md`    | Keyword targets and messaging guidelines                                                                                      |

## The security runbook moved

`SECURITY.md` now lives in the private **[starl3xx/walletlink-ops](https://github.com/starl3xx/walletlink-ops)** repo, along with `content/drafts/` and `data/content.db`.

It was not removed because it leaked credentials. It never has: `.env` was never committed, and its passwords have always been `<GENERATE-A-STRONG-ONE>` placeholders. It moved because it is a map of which secrets exist and whether each lives in Vercel, GitHub Actions or a laptop, which has real value to an attacker and none to anyone checking our data claims.

That distinction is the rule to apply when deciding where a new document belongs:

- **Public**, if it helps someone verify what we claim about the data. `AI-SEARCH.md` stays public for exactly this reason: it documents an assistant anyone can already interrogate.
- **Private**, if it mainly tells someone where to push.

**The test applies per fact, not per file.** On 2026-08-30 `AI-SEARCH.md` was
found to be carrying four Cloudflare identifiers: the account, the zone, the
rate-limit ruleset, and the raw namespace endpoint. The document passes the test
and stayed. The identifiers fail it and moved to walletlink-ops. The endpoint
was the one that mattered, because that same page explains that the endpoint is
unauthenticated and that the proxied CNAME is the only thing bounding Workers AI
spend, so publishing the origin hostname documented the bypass alongside the
defence. A file can be correctly public and still contain a line that is not, so
read a document fact by fact before concluding it passes.

This repo stays public on purpose. walletlink's core claim is that every match carries the class of evidence behind it and none of it is inferred, and public code is what makes that claim checkable.

Those paths are gitignored here, so they remain on disk locally and the `ralph:*` scripts keep working unchanged.
