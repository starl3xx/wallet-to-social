# Security policy

This policy covers walletlink.social and the code in this repository. It says how to report a vulnerability, what is in scope, how to test, and what happens after you report.

## Reporting a vulnerability

Report privately. Never report a vulnerability in a public issue, pull request or discussion.

1. **Preferred: a private report on GitHub.** Open one at
   <https://github.com/starl3xx/wallet-to-social/security/advisories/new>.
   Only you and the maintainers can read it, and it does not depend on email.
2. **Or email <help@walletlink.social>.** Put “Security” in the subject.

The same channels, in the same order, are published for machines at <https://walletlink.social/.well-known/security.txt> (RFC 9116).

Include:

- the URL, endpoint or file affected;
- the steps to reproduce it;
- the impact, as you understand it;
- the test account you used, if any.

Never send a complete key or token. Its prefix and its last four characters are enough to identify it.

## Scope

In scope:

- the walletlink.social web app, including sign-in and the account pages;
- the REST API under `/api/v1/`;
- the MCP server at `/api/mcp`;
- the OAuth authorization server: `/oauth/authorize`, `/api/oauth/*` and the `/.well-known/oauth-*` documents;
- the USDC credit purchase under `/api/x402/`;
- the removal flow at `/claim`;
- the code in this repository;
- the Grok plugin at <https://github.com/starl3xx/walletlink-grok-plugin>.

Reports about any other walletlink.social subdomain use the same channels.

Out of scope:

- denial of service, volume or load testing, and rate-limit findings with no security impact;
- social engineering, physical attacks and spam;
- output from an automated scanner with no demonstrated impact, and a missing header with no working exploit;
- third-party services, unless our integration causes the issue;
- the hosted platforms behind docs.walletlink.social and help.walletlink.social (send a content error on either to help@walletlink.social);
- disputes about the accuracy of the data, and removal requests (use <https://walletlink.social/claim> or help@walletlink.social).

## Testing rules

- Use only an account you own.
- Never access, change or spend another person’s account, API keys, credits, lookups or connections.
- Never send a sign-in email to an address you do not own.
- Never obtain credits without paying for them.
- Stop at the smallest proof that shows the issue. Do not keep access, move on to other systems, or copy index data.

Publishing a security contact is not permission to test. These rules are the permission, and nothing beyond them is allowed.

## What to expect

- An acknowledgment within 5 business days.
- An assessment within 15 business days: whether we can reproduce the issue, and how severe we think it is.
- Updates until it is fixed.
- Coordinated disclosure when the fix ships, or 90 days after your report, whichever comes first.
- Credit in the published advisory, if you want it.

## Safe harbor

If you act in good faith and within the testing rules above, we will treat your research as authorized, and we will not bring or support legal action against you for it. If you are unsure whether something is allowed, ask first through one of the channels above.

## Rewards

There is no bug bounty, and reports are not paid.

## Supported versions

Only the deployed service, built from the `main` branch, is supported. There are no released versions to patch.
