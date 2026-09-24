/**
 * `/skill.md`: the agent skill, at a URL somebody can paste.
 *
 * The distribution shape people actually use is a plain URL handed to an
 * agent, as in "install the walletlink skill: https://walletlink.social/skill.md".
 * It is the same idea as `llms.txt` and aimed at a different reader: `llms.txt`
 * tells a crawler what the site is, this tells an agent how to *operate* the
 * product, and the frontmatter is what lets a skill runtime load it by name.
 *
 * ## Why this is generated rather than a file
 *
 * A skill that quotes a price, an allowance or a coverage figure is published
 * copy, and this repo has one rule for published copy: never type a number,
 * derive it. Every figure below comes from `lib/public-figures.ts`,
 * `lib/packs.ts` or `lib/chains.ts`, and the sentences that define a match, an
 * attested identity, absence and reachability come from
 * `lib/canonical-sentences.ts`, which is the same source the UI, the docs and
 * the welcome emails read. A static file would have been a fifth copy of all
 * of it, drifting the first time anything was re-measured, and
 * `scripts/check-published-figures.ts` cannot see a literal it was never told
 * about.
 *
 * The plugin repo keeps its own copy for the marketplace, because a plugin is
 * a git tree and the entry is SHA-pinned. That copy is the one to regenerate
 * from this route when it next moves, not the other way round: it has already
 * drifted once, spelling "labelled" for months after the house style settled
 * on American English, which is exactly what deriving prevents here.
 *
 * ## The tool table
 *
 * Kept by hand, with its costs, because a cost sentence is editorial and there
 * is no machine-readable price beside each tool to read. `check-invariants`
 * asserts that its names are exactly the set the MCP server registers, the
 * same way the `/mcp` page is asserted, so a ninth tool fails there rather
 * than being discovered missing by a reader.
 */
import {
  INDEXED_WALLETS_LONG,
  CHAIN_MATCH_RATES,
  CHAIN_MATCH_RATES_MEASURED_ON,
} from '@/lib/public-figures';
import {
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  CREDIT_LIFETIME_MONTHS,
  PACKS,
  PACK_IDS,
} from '@/lib/packs';
import {
  MATCH_SENTENCE,
  ATTESTED_SENTENCE,
  ABSENT_SENTENCE,
  REACHABILITY_SENTENCE,
} from '@/lib/canonical-sentences';
import { CHAIN_COUNT_WORD } from '@/lib/public-figures';

export const runtime = 'nodejs';

/**
 * Tool name to what it does and what it costs.
 *
 * The names are asserted against the MCP server's registrations. The cost
 * column is prose on purpose: "1 credit per address that resolves, misses
 * free" is the sentence a caller needs, and no field on the tool definition
 * says it.
 */
const TOOLS: Array<[name: string, does: string, cost: string]> = [
  [
    'walletlink_resolve_wallets',
    'One or more addresses to their identities',
    '1 credit per address that resolves to an X or Farcaster account; misses free',
  ],
  [
    'walletlink_wallets_by_x_handle',
    'X handle to the wallets behind it',
    '1 credit per wallet returned, up to 100 a page',
  ],
  [
    'walletlink_wallets_by_farcaster_username',
    'Farcaster username to its wallets',
    '1 credit per wallet returned, up to 100 a page',
  ],
  [
    'walletlink_index_coverage',
    'How much of the index carries each identity type',
    'Free',
  ],
  [
    'walletlink_account_balance',
    'Credits left and rate-limit standing',
    'Free',
  ],
  [
    'walletlink_submit_job',
    'A deep scan of a large list: live resolution on wallets the index has not checked',
    'Billed as matches when the job completes, same price as resolving',
  ],
  [
    'walletlink_job_status',
    'Progress and paged results for a submitted job',
    'Free',
  ],
  [
    'walletlink_estimate_list',
    'A quote before the spend: how many of a list are in the index and what a resolve would bill',
    'Free; minimum ten distinct wallets; counts only',
  ],
];

export async function GET() {
  const entry = PACKS[PACK_IDS[0]];
  const toolRows = TOOLS.map(
    ([name, does, cost]) => `| \`${name}\` | ${does} | ${cost} |`
  ).join('\n');

  const body = `---
name: walletlink
description: >-
  Resolve Ethereum wallet addresses to the social accounts their owners
  published (X, Farcaster, ENS, Lens, GitHub), and find the wallets attested to
  an X handle or Farcaster username. Use when a task involves identifying who
  is behind a wallet address, reaching the holders of a token or NFT
  collection, or mapping a social handle back to its addresses.
homepage: https://walletlink.social
---

# walletlink

walletlink.social answers two questions about an Ethereum address: which social
accounts its owner published, and which addresses a given X handle or Farcaster
account is attested to. Balances, transfers and prices are a block explorer’s
job, not this server’s.

${ATTESTED_SENTENCE} Nothing is inferred from a display name or a bio. This
distinction is the product: \`attested: true\` is the owner’s own claim,
\`attested: false\` means the record rests on correlation alone, and
\`attested: null\` means the record carried no classified evidence, which is a
different claim from "not attested".

The index holds ${INDEXED_WALLETS_LONG} wallets across ${CHAIN_COUNT_WORD} chains.

## Connecting

The server speaks MCP over HTTP at \`https://walletlink.social/api/mcp\`.

Discovery (\`initialize\`, \`tools/list\`) needs no credential. Tool calls need
one of:

- **OAuth**: clients that follow the MCP authorization specification get a
  consent screen on the first tool call. No key to manage.
- **API key**: an \`Authorization: Bearer wts_live_<key>\` header. Keys are
  self-serve at https://walletlink.social for any signed-in account, free allowance included.
  **Use this if you are running inside a chat host.** Some cannot open a
  consent screen at all (X and Grok report \`no_auth_link\`), so OAuth can
  never complete there however many times it is retried. The symptom is
  specific and worth recognizing: every tool is listed, because discovery
  needs no credential, and then every call reports that a sign-in is still
  needed no matter how often the user authorizes. That is a host that cannot
  start a sign-in, not a sign-in that failed. Ask the user for a key instead
  of retrying the connection.
- **x402**: an autonomous agent can buy access with USDC on Base, no account
  needed. That key resolves addresses; the two reverse lookups need an account
  and answer it with 403 ACCOUNT_REQUIRED. See
  https://docs.walletlink.social/agent-pack.

## The tools

| Tool | What it does | Cost |
| --- | --- | --- |
${toolRows}

"Who is 0xabc?" is one \`walletlink_resolve_wallets\` call with one address. A
holder list is the same call with up to 50 addresses; send them all in one call
rather than splitting, since splitting saves no credits. A batch spends one
request-unit per address of the per-minute window, so pace multi-batch runs a
minute apart and read the reset time from the quota block every result carries.

The reverse direction is the expensive one: a single widely held handle can
spend 100 credits in one page. Call \`walletlink_account_balance\` first when
that matters, or \`walletlink_estimate_list\` for a free count before anything
is billed.

For a list above 50 addresses, or when never-checked wallets deserve a live
resolution, submit a job instead. It runs the full pipeline in the background
and bills matches only at completion; a failed job is never billed. One job may
be active per account, and completed results arrive one 100-row page per call
until \`next_offset\` is null.

## What it costs

${MATCH_SENTENCE}

The free allowance is ${FREE_MATCHES_PER_WINDOW} matches per rolling ${FREE_WINDOW_DAYS} days. Beyond that, credits are bought once and last ${CREDIT_LIFETIME_MONTHS} months; the entry pack is ${entry.matches} matches for $${entry.priceCents / 100}. There are no subscriptions.

## Reading results

- ${ABSENT_SENTENCE}
- \`found: false\` with \`previously_checked\` set means the index looked at
  that address before and found nothing. Neither case is charged.
- \`stale: true\` marks a record past its freshness window; it is still served.
- ${REACHABILITY_SENTENCE}
- Farcaster usernames can carry a \`.eth\` suffix. Pass them whole: stripping
  the suffix finds nothing.

## What to expect from a list

The chain decides the match rate more than the collection does. Measured on ${CHAIN_MATCH_RATES_MEASURED_ON}: ${CHAIN_MATCH_RATES.base.either_pct}% of ${CHAIN_MATCH_RATES.base.holders.toLocaleString()} Base holders were reachable on X or Farcaster, against ${CHAIN_MATCH_RATES.ethereum.either_pct}% of ${CHAIN_MATCH_RATES.ethereum.holders.toLocaleString()} on Ethereum. A list from a low-attestation community can legitimately come back nearly empty, and that is an answer about the list rather than a failure.

Full reference: https://docs.walletlink.social
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
