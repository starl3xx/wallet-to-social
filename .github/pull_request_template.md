## What changed

<!-- One or two sentences. What does this do that main does not? -->

## Docs

<!--
Required. docs.walletlink.social is a contract with paying customers, and it
does not break loudly when it goes stale.

Pick one. If the first box is checked, CI will also require a docs-site/ change.
-->

- [ ] Docs updated in `docs-site/` (say which pages below)
- [ ] No docs change needed, because this is invisible to API consumers

<!--
If a public response shape, limit, error code, credit cost or supported chain
moved, the docs need it. If you are unsure whether something is user-visible,
it is.

To skip the CI check, add the `no-docs-needed` label.
-->

## Checks

- [ ] `npx tsc --noEmit` passes (`npm run build` does **not** typecheck)
- [ ] Claims made in UI copy or docs are true as of this PR
