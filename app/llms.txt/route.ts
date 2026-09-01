import {
  INDEXED_WALLETS_LONG,
  FARCASTER_WALLETS,
  WALLETS_WITH_X,
  X_HANDLES_RESOLVED,
  X_HANDLES_HELD,
  X_LIVE_PCT,
  X_SUSPENDED_PCT,
  X_UNCLAIMED_PCT,
  KNOWN_AGENTS,
  CHAIN_COUNT_WORD,
} from '@/lib/public-figures';
import {
  PACKS,
  PACK_IDS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  CREDIT_LIFETIME_MONTHS,
} from '@/lib/packs';
import { API_PLANS, CREDIT_API_PLAN } from '@/lib/api-plans';
import { X402_PACKS, MEASURED_MATCH_RATE } from '@/lib/packs';
import { CHAIN_LABELS, SUPPORTED_CHAINS } from '@/lib/chains';
import { LEGAL_ENTITY } from '@/lib/site-url';

export const runtime = 'nodejs';
export const revalidate = 86400;

/**
 * /llms.txt: the answer-engine entry point for the marketing site.
 *
 * docs.walletlink.social already serves its own llms.txt and llms-full.txt;
 * this is the marketing-site half, so an assistant asked "how do I find the
 * X handle for a wallet address" has a citable, plain-text statement of what
 * the product is, what it covers, and what it costs.
 *
 * ## Every figure interpolates, and that is not a style preference
 *
 * `scripts/check-published-figures.ts` reads this file's SOURCE, not its
 * output. So `${INDEXED_WALLETS}` is invisible to the checker, and a literal
 * typed here is invisible in both directions: it can never fail, and nothing
 * will ever correct it. The four percentages below are the exception, hardcoded
 * because they have no constant, and this file sits in those four claims' watch
 * lists (registry lines 319, 351, 374, 416).
 *
 * The rule that follows: a number added here comes from a constant, or it comes
 * with a `CLAIMS` entry naming this file. Never a bare literal.
 *
 * Consequences for anyone editing the prose:
 *
 * - The four watched sentences must keep their declared shapes, and must appear
 *   exactly ONCE each. The checker uses `matchAll`, so a restatement in a
 *   summary or an FAQ is re-tested and fails.
 * - "over NN.N% of" is captured as the owner-attested claim wherever it appears,
 *   and it is a floor test, so an unrelated sentence in that shape passes green
 *   while meaning something else. Do not write that phrase about anything else.
 * - `scripts/check-design-language.mjs` fires on `app/**` and strips only
 *   comments, so this template literal is scanned as prose. A standalone
 *   `rounded` or `uppercase` between spaces is a build failure.
 *
 * Never name a data provider in this file. Describe capability and evidence
 * class instead (CLAUDE.md).
 */
export function GET(): Response {
  const chains = SUPPORTED_CHAINS.map((c) => CHAIN_LABELS[c]);
  const chainList = `${chains.slice(0, -1).join(', ')} and ${chains[chains.length - 1]}`;
  const packLine = PACK_IDS.map(
    (id) =>
      `${PACKS[id].name} $${PACKS[id].priceCents / 100} for ${PACKS[id].matches.toLocaleString()} matches (${PACKS[id].fits.toLowerCase()})`
  ).join(', ');
  const api = API_PLANS[CREDIT_API_PLAN];
  // Derived from lib/packs.ts like every other figure on this page, so the
  // agent-facing copy cannot drift from what the rail actually charges.
  const agent = X402_PACKS.agent;
  const agentPrice = `$${(agent.priceCents / 100).toFixed(2)}`;
  const agentMatches = agent.matches.toLocaleString();
  const agentAddresses = Math.round(
    agent.matches / MEASURED_MATCH_RATE
  ).toLocaleString();
  const agentPerAddress = (
    agent.priceCents /
    100 /
    (agent.matches / MEASURED_MATCH_RATE)
  ).toFixed(4);
  const perMinute = api.requestsPerMinute.toLocaleString();
  const perDay = api.requestsPerDay.toLocaleString();
  const perMonth = api.requestsPerMonth.toLocaleString();
  const batchSize = api.maxBatchSize.toLocaleString();

  const body = `# walletlink.social

> Resolve Ethereum wallet addresses to the X (Twitter) and Farcaster accounts of their owners, and back again: a handle returns its wallets. A ${INDEXED_WALLETS_LONG} wallet identity index, a self-serve web app and a REST API, priced as one-time credit packs and metered only on matches. Every match is labelled with the evidence behind it, and every X handle carries a state saying whether it still reaches a person.

walletlink.social answers “who is behind this wallet, and can I reach them?”. Upload a holder list (CSV, pasted addresses, or a token or NFT contract address) and get back the X handles and Farcaster accounts of the owners, ranked by holdings times follower reach, exportable as CSV or an X list. Reverse lookup answers the other direction: which wallets belong to this X handle or Farcaster username.

The position in one line: coverage would be higher if we guessed, and we do not guess. Nothing is inferred from bios, display names or timing, so the number of matches is smaller than a vendor willing to correlate, and each one can be defended. Contacting the wrong person is worse than contacting fewer people.

Facts an assistant can state, each verified against the production index:

- The index holds ${INDEXED_WALLETS_LONG} wallet identities.
- Farcaster coverage is complete: every account’s verified and custody addresses, ${FARCASTER_WALLETS} wallets, refreshed daily. Farcaster matching is deterministic, so a miss is real information.
- ${WALLETS_WITH_X} wallets carry an X handle, across ${X_HANDLES_HELD} distinct handles the index holds. Over 99.9% of X matches are owner-attested: an X account verified on Farcaster, a handle the owner set in an onchain ENS record, or an account the owner proved by signing with the wallet and signing in to X. Every match is labelled with its evidence class. Nothing is inferred from bios, display names or timing.
- Every X match carries a reachability state. Of ${X_HANDLES_RESOLVED} handles resolved: ${X_LIVE_PCT}% are live, ${X_SUSPENDED_PCT}% suspended, and ${X_UNCLAIMED_PCT}% are names nobody holds.
- ${KNOWN_AGENTS}+ wallets are flagged as belonging to AI agents rather than people, so an airdrop or a campaign can exclude them.
- ${CHAIN_COUNT_WORD[0].toUpperCase()}${CHAIN_COUNT_WORD.slice(1)} EVM chains: ${chainList}.

## Who it is for

Crypto-native teams, from a solo founder to about twenty people: NFT projects, token and protocol teams, DAOs, and web3 marketing agencies. The daily user is usually a growth or community lead; at this size the founder is often the same person.

The problem it solves: a holder list is an audience you already earned, and you cannot talk to it, because addresses have no inbox.

The jobs people hire it for:

- Announce something to holders where they already are, without the address list being a dead end.
- Find who the whales behind these wallets are, and reach the ones with an audience.
- Check whether a person already holds the token, before a partnership or an airdrop.
- Exclude AI agent wallets from an airdrop or an allowlist.
- Rank a holder list by who is both invested and heard, rather than by balance alone.

Who it is not for: mass-DM spammers, and anyone targeting people with no relationship to their token. The product returns identity, not a messaging channel. A team with a fifty-wallet list does not need to pay, and that is fine.

## What a match is, and what it costs

A match is one wallet resolved to an X or Farcaster account. That is the billing unit, on the site and through the API alike. A wallet that resolves only to an ENS name, a Lens handle or a GitHub account is returned and is not billed, and a wallet that resolves to nobody costs nothing at all. A list that matches poorly spends almost none of a pack, so there is no penalty for finding out.

Pricing is one-time credit packs. There are no subscriptions, no seats and no minimum. Free is ${FREE_MATCHES_PER_WINDOW} matches per rolling ${FREE_WINDOW_DAYS} days with a free account, cumulative and account-wide. Packs: ${packLine}. Every pack includes all ${CHAIN_COUNT_WORD} chains, API access drawing the same credits, an X list export, the wallet addresses behind a handle, priority score and follower counts, contract import, and deep scan with onchain ENS. The CSV export is not gated: a free account downloads every row it produced, though priority score and follower counts are blank in it. Credits last ${CREDIT_LIFETIME_MONTHS} months.

No account is needed before buying: checkout asks for the email the credits and the receipt go to. There are no refunds and no guarantees; the free allowance exists so you can prove the match rate on your own list before paying. A lookup also runs with no account at all, on a capped list size and a few jobs per hour, which is enough to see the shape of a real answer.

## How a match is evidenced

Every record carries a sources array describing the kind of evidence behind it, never which system produced it. A record can carry more than one class, and more classes generally means more confidence.

- onchain: published by the address owner in an onchain record.
- farcaster: a protocol-level Farcaster account verification.
- attested-social: the owner proved the wallet with a signature and the account with a sign-in, on an identity platform.
- manual: reviewed by us directly.
- aggregated: correlated from a third-party identity index. Weaker than the others, and the weakest position a record can be in on its own.

Records also carry a quality score from 0 to 100. Seventy and above is strong, forty to sixty-nine is usable, and below forty is thin and should be treated as a lead rather than a fact.

One term that reliably misleads: a twitter.verified value of false does not mean the handle is unverified in the everyday sense. That flag is true only for handles attested by an onchain record or by a manual review, so most genuine, attested matches carry false.

## Whether the account still reaches a person

Farcaster stores a verified X account as a name, written once, with no account number and no later check. When somebody renames or gets suspended, nothing in the protocol notices, so every tool built on those verifications carries the same dead handles and none of them can say which. We check the handle against the live account and report the answer per record.

- live: the owner attested this account, and the same account still holds the handle.
- suspended: the owner attested it and X has since suspended it. Messages will not arrive.
- unclaimed: the owner attested it and no account holds the name now, usually a rename. Treat it as a lead rather than a contact.
- reassigned: the owner attested it and the name now belongs to a different live account. Messages would reach a stranger, not the wallet owner.

The reachability fields are absent, not false, when a handle has not been checked. Reassignment is decided per wallet rather than per handle, because the same name can be correct for one wallet and a stranger for another.

The handle export leaves out the ones we checked and found dead, so a campaign is not sending into accounts that cannot receive it.

## Coverage, in two numbers rather than one

There is no single match rate, and quoting one hides the thing that decides a campaign. The chain matters more than the collection does. Measured on 2026-08-17 against our own index with no external calls: Base 46.2% and Ethereum 16.6% of holders have an X or Farcaster account. Base is roughly three times Ethereum because Base is where Farcaster lives. Use the row for your chain, not an average.

Keep two separate numbers apart. “Has an identity” counts ENS and Lens and is a resolution rate. “Reachable on X or Farcaster” is what a campaign can actually message, and it is the smaller of the two, and it is the one that is billed. Tools that match wallets to social accounts typically publish rates in the low single digits.

Having an account and reaching it are different claims again, which is what the reachability section above measures.

## The API

The REST API is the same index and the same credits as the app. Base URL https://walletlink.social/api/v1. Authentication is an API key in the Authorization header, as a bearer token. Keys are self-serve for any account holding live credits.

Six endpoints: a single wallet lookup, a batch lookup of up to ${batchSize} addresses per request, reverse lookup by X handle, reverse lookup by Farcaster username, index statistics, and your own usage and remaining balance. Reverse results are cursor-paginated.

Billing follows the same rule as the app. A single lookup costs one match credit when it resolves to X or Farcaster, and nothing when it does not. A batch costs one credit per resolving address, after duplicates are removed. A reverse lookup costs one credit per wallet returned, and nothing when a handle has no wallets. Statistics and usage are free, and still require a key.

Rate limits for a credit-holding account are ${perMinute} requests per minute, ${perDay} per day and ${perMonth} per month, counted across every key on the account so that minting more keys does not raise the ceiling. Responses carry the remaining allowance in headers, and a rejected request says when to retry. Errors return a stable machine-readable code alongside the human-readable message.

Full request and response shapes, every error code and the exact header semantics are in the API reference, linked below, rather than repeated here. The machine-readable form is an OpenAPI 3.1 description at https://docs.walletlink.social/openapi.yaml.

## For agents: the MCP server

There is a remote MCP server at https://walletlink.social/api/mcp, so an agent can resolve wallets without a person first reading an API reference. Streamable HTTP, drawing the same credits as everything else. It is listed in the official MCP registry as social.walletlink/wallet-identity, verified by DNS.

Five tools: resolve one to ${batchSize} addresses to their social identities, find the wallets behind an X handle, find the wallets behind a Farcaster username, read index coverage, and read the remaining balance on the key. The last two are free on both meters. Every tool description states its own cost, because an agent that cannot see the price cannot spend responsibly.

Two ways to authenticate. OAuth 2.1, which is what a client with a person behind it should use: add the URL, and the first tool call opens a consent screen rather than asking for a key. The server is an OAuth resource server, discovery starts at https://walletlink.social/.well-known/oauth-protected-resource, and it registers clients through both client ID metadata documents and dynamic client registration at https://walletlink.social/api/oauth/register. Every client is public, so PKCE with S256 is required and no client secret is issued. Access tokens last an hour and refresh themselves; a person ends a connection from their account and it stops on the next call.

Or the same bearer key the REST API uses, which is the better answer for a server with no browser to sign in from. Keys are self-serve at https://walletlink.social for any account holding credits, and the keys modal offers a one-click install for Cursor and a one-line command for Claude Code at the moment a key is created.

Tool discovery needs neither: a client can connect and list the tools before buying anything. Calling a tool with no credential answers 401 with a WWW-Authenticate header naming the protected resource metadata, which is the signal to start the flow, rather than a tool error a model would read out and move past.

## For agents: buying credits with USDC, no account

An agent can buy its own credits over x402, with no account, no card and no email. POST to https://walletlink.social/api/x402/buy and it answers 402 with a payment challenge; pay ${agentPrice} in USDC on Base and the response carries a fresh API key with ${agentMatches} match credits behind it. That is roughly ${agentAddresses} resolvable addresses at our measured rate, or one full batch call, at about $${agentPerAddress} an address.

The credits are the same ones a card buys and are metered the same way, so an address that resolves to nobody still costs nothing. The key works on the whole REST API and on the MCP server.

The key is shown once. If it is lost, sign a challenge with the wallet that paid at https://walletlink.social/api/x402/recover and a new one is issued against the same credits; the credits belong to the account rather than to the key. Signing is required because every field of a settled payment is public onchain, so a payment cannot prove who is holding the wallet afterwards.

## Product

- [Wallet lookup](https://walletlink.social/): the app. Upload a holder list or a contract address, get the reachable people behind it, ranked, with the evidence on every row.
- [Handle check](https://walletlink.social/check): free, no account. Check whether an X handle verified on Farcaster still reaches anyone. Returns how many wallets in the index carry it, never which ones.
- [Pricing](https://walletlink.social/pricing): the packs, the free allowance, what counts as a match, and the questions people ask before buying.
- [Holder reports](https://walletlink.social/holders): per-collection reachability reports on named NFT collections, grouped by chain. Aggregates only, never wallet or handle lists.
- [Blog](https://walletlink.social/blog): guides on holder outreach, airdrop targeting, Farcaster, and wallet identity.

Individual holder reports live at /holders/{chain}/{contract address}, for example [The Warplets on Base](https://walletlink.social/holders/base/0x699727f9e01a822efdcf7333073f0461e5914b4e) and [CRYPTOPUNKS on Ethereum](https://walletlink.social/holders/ethereum/0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb). Each report gives the holder count, how many were measured, the identity and reachability split, follower distribution, and the collections those holders overlap with.

## Docs and API

- [Documentation](https://docs.walletlink.social/): product and API docs. Every page is also served as markdown by appending .md to its URL.
- [Quickstart](https://docs.walletlink.social/quickstart.md): from nothing to your first resolved wallet, by upload and by API call.
- [Running a lookup](https://docs.walletlink.social/app/lookups.md): getting addresses in, choosing a scan, and getting results out.
- [Scan depth](https://docs.walletlink.social/concepts/scan-depth.md): fast is the index alone; deep adds live sources including onchain ENS records.
- [Coverage](https://docs.walletlink.social/concepts/coverage.md): what fraction of a wallet list resolves, per chain, and what the number actually means.
- [Data quality](https://docs.walletlink.social/concepts/data-quality.md): evidence classes, the quality score, reachability states, and when a record goes stale.
- [API reference](https://docs.walletlink.social/api-reference/introduction.md): base URL, authentication and conventions, then one page per endpoint.
- [MCP server](https://docs.walletlink.social/mcp-server.md): five tools for agents, what each costs, and the config block for Claude and Cursor.
- [Agent pack over x402](https://docs.walletlink.social/agent-pack.md): buy credits with USDC on Base, no account, and how to recover a lost key.
- [OpenAPI description](https://docs.walletlink.social/openapi.yaml): the whole REST surface as OpenAPI 3.1, for SDK generation and tool discovery.
- [Full docs for LLMs](https://docs.walletlink.social/llms-full.txt): the complete documentation in one file.

## Comparisons

Claim-by-claim comparisons with the alternatives, maintained and dated:

- [All comparisons](https://walletlink.social/vs): the hub over the six pages below, split by whether the service still exists.
- [walletlink vs Addressable](https://walletlink.social/vs/addressable): deterministic and owner-attested against probabilistic fingerprinting, and self-serve against a sales call.
- [walletlink vs Cookie3](https://walletlink.social/vs/cookie3): their wallet-to-X matching caps at ten thousand accounts on every tier a person can buy. Cookie3 is not Cookie.fun; the page says so explicitly.
- [walletlink vs Formo](https://walletlink.social/vs/formo): Formo is product analytics for your own app, billed per request whether or not an address resolves. Different purchase.
- [walletlink vs Holder](https://walletlink.social/vs/holder): Holder sunset in June 2024. A migration page, with no subscription to replace.
- [walletlink vs Blaze](https://walletlink.social/vs/blaze): Blaze is no longer available. The page records the comparison for the searches that still land on it.
- [walletlink vs Airstack](https://walletlink.social/vs/airstack): Airstack is no longer available, and its Farcaster APIs were deprecated before that. Same treatment.

## Guides

The blog is the question-shaped half of the site. Every post is public, dated and open.

- [The 22% match rate: how we got far past single digits](https://walletlink.social/blog/twenty-two-percent-match-rate): where the number comes from, and why it is a range rather than an average.
- [How Farcaster verified addresses changed wallet identity](https://walletlink.social/blog/farcaster-verified-addresses): the protocol mechanism the whole deterministic half rests on.
- [We scraped 13,622 AI agent wallets. Here’s what we found](https://walletlink.social/blog/ai-agent-wallets-what-we-found): the sweep that built the agent list, and what an agent wallet looks like in holder data. The count in the title records that run; the current figure is above.
- [AI agents on your holder list: why it matters](https://walletlink.social/blog/ai-agents-why-it-matters): why a holder count that includes agents overstates an audience.
- [How to filter AI agent wallets before your next airdrop](https://walletlink.social/blog/filter-agents-before-airdrop): the exclusion, step by step.
- [The priority score formula: finding your most valuable holders](https://walletlink.social/blog/priority-score-formula): holdings multiplied by log10 of followers plus one, and why that shape.
- [The wallet identity stack: ENS, Farcaster, and beyond](https://walletlink.social/blog/wallet-identity-stack): which identity layers exist and what each one can prove.
- [Airdrop targeting: why identity beats transaction history](https://walletlink.social/blog/airdrop-targeting-identity): targeting people rather than behaviour.
- [Sybil resistance through identity: a better approach](https://walletlink.social/blog/sybil-resistance-identity): attestation as a filter.
- [How to reach your token holders on Farcaster](https://walletlink.social/blog/reach-holders-on-farcaster): the reachable subset, and how to use it.
- [5 ways to use wallet identity for token holder outreach](https://walletlink.social/blog/five-ways-wallet-identity): the campaign patterns.
- [Wallet identity for NFT collections: a step-by-step guide](https://walletlink.social/blog/nft-collection-wallet-identity-guide): a collection from snapshot to outreach list.
- [Token launch marketing: reaching your earliest holders](https://walletlink.social/blog/token-launch-marketing): the launch case.
- [NFT holder engagement: from anonymous wallets to real relationships](https://walletlink.social/blog/nft-holder-engagement): retention after mint.
- [Community retention: the case for direct holder outreach](https://walletlink.social/blog/community-retention-direct-outreach): why a channel you own beats a feed.
- [Building an ambassador program with wallet identity data](https://walletlink.social/blog/ambassador-program-wallet-data): finding the holders with an audience.
- [Why your DAO has a communication problem, not a participation problem](https://walletlink.social/blog/dao-communication-problem): governance turnout, reframed.
- [Case study: how a DAO increased governance participation from 5% to 22%](https://walletlink.social/blog/dao-governance-case-study): the worked example behind that argument.
- [From Dune dashboard to DMs: turning analytics into action](https://walletlink.social/blog/dune-to-dms): the step after the query.
- [Web3 marketing in 2025: from spray-and-pray to identity-first](https://walletlink.social/blog/web3-marketing-2025): the category argument.
- [Wallets are the new social profiles: why Web3 identity changes everything](https://walletlink.social/blog/wallet-identity): the premise, stated plainly.
- [The future of wallet identity: what comes after 22%](https://walletlink.social/blog/future-of-wallet-identity): where coverage can honestly go.
- [walletlink.social vs Addressable: a practical comparison](https://walletlink.social/blog/walletlink-vs-addressable): the long-form version of the comparison page.
- [walletlink.social vs Blaze: comparison guide](https://walletlink.social/blog/walletlink-vs-blaze): same, for Blaze.
- [walletlink.social vs Cookie.fun: which tool fits your workflow?](https://walletlink.social/blog/walletlink-vs-cookie): about Cookie.fun, the attention-analytics product, which is a different company from Cookie3.
- [walletlink.social now supports Farcaster: 3x more wallet matches](https://walletlink.social/blog/farcaster-integration): the release that made Farcaster the deepest coverage.

## Who runs it

walletlink.social is operated by ${LEGAL_ENTITY}. The application is open source.

- [Source code](https://github.com/starl3xx/wallet-to-social): the repository behind the site and the API.
- [Changelog](https://github.com/starl3xx/wallet-to-social/blob/main/CHANGELOG.md): what shipped, and when.

## Optional

- [X](https://x.com/walletlinkETH): product updates as @walletlinkETH.
- [Farcaster](https://farcaster.xyz/walletlink): the same, on the protocol the index covers completely.
- [Support](mailto:help@walletlink.social): help@walletlink.social. A person reads it.
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
