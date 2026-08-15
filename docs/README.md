# docs/

Internal engineering notes. **Not published.** The customer-facing Mintlify
site is built from `docs-site/`, and Mintlify's content root is set to that
directory precisely so nothing here reaches docs.walletlink.social.

| File | What it covers |
|---|---|
| `AI-SEARCH.md` | The assistant on walletlink.social: instances, endpoint, rate limits, the load-bearing system prompt, and its regression test |
| `DOCS-SITE.md` | Mintlify setup, DNS, and what the docs still need |
| `SEO-STRATEGY.md` | Keyword targets and messaging guidelines |

## The security runbook moved

`SECURITY.md` now lives in the private **[starl3xx/walletlink-ops](https://github.com/starl3xx/walletlink-ops)** repo, along with `content/drafts/` and `data/content.db`.

It was not removed because it leaked credentials. It never has: `.env` was never committed, and its passwords have always been `<GENERATE-A-STRONG-ONE>` placeholders. It moved because it is a map of which secrets exist and whether each lives in Vercel, GitHub Actions or a laptop, which has real value to an attacker and none to anyone checking our data claims.

That distinction is the rule to apply when deciding where a new document belongs:

- **Public**, if it helps someone verify what we claim about the data. `AI-SEARCH.md` stays public for exactly this reason: it documents an assistant anyone can already interrogate.
- **Private**, if it mainly tells someone where to push.

This repo stays public on purpose. walletlink's core claim is that every match carries the class of evidence behind it and none of it is inferred, and public code is what makes that claim checkable.

Those paths are gitignored here, so they remain on disk locally and the `ralph:*` scripts keep working unchanged.
