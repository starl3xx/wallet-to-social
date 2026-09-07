import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { Eyebrow } from '@/components/ui/eyebrow';
import { PRODUCTION_URL } from '@/lib/site-url';
import { MCP_URL, mcpJsonBlock } from '@/lib/mcp-install';
import {
  API_PLANS,
  CREDIT_API_PLAN,
  ESTIMATE_MIN_WALLETS,
} from '@/lib/api-plans';
import {
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  SUBMISSION_MULTIPLIER,
  CREDIT_LIFETIME_MONTHS,
  MEASURED_MATCH_RATE,
  X402_PACKS,
  X402_MAX_QUANTITY,
  X402_LOYALTY_EVERY_N,
} from '@/lib/packs';
import {
  MATCH_SENTENCE,
  ATTESTED_SENTENCE,
  ABSENT_SENTENCE,
  REACHABILITY_SENTENCE,
  ZERO_BALANCE_SENTENCE,
  PACING_SENTENCE,
} from '@/lib/canonical-sentences';
import serverManifest from '@/server.json';

/**
 * The agent-consumption page, on the apex.
 *
 * ## Why it exists
 *
 * /mcp, /agents, /api-docs, /docs, /api, /developers and /x402 all returned
 * 404 on walletlink.social, so the answer to "how do I point an agent at this"
 * lived only on the docs subdomain, in /llms.txt and in one blog recipe. The
 * problem that creates is not authority, it is sense: every apex asset that
 * mentions an AI agent answers the OPPOSITE question. The three agent blog
 * posts and the homepage all treat an agent as the SUBJECT of a lookup (a
 * wallet that belongs to a bot, filtered out of an airdrop), and none of them
 * contains the word mcp or x402. A model resolving "walletlink + AI agent"
 * against this origin therefore retrieved the wrong sense every time. This page
 * is the other sense, stated once, where the crawl already is.
 *
 * ## It is self-canonical, deliberately
 *
 * The obvious tidy-up is to canonicalise this to
 * docs.walletlink.social/mcp-server, and that would delete the apex presence
 * that is the entire point of the page. Both stay self-canonical and link to
 * each other: this page is the short answer for somebody (or something)
 * arriving at the apex, the docs page is the reference. Neither is a copy of
 * the other, and where they say the same thing they say it from the same
 * constant or the same canonical sentence.
 *
 * ## Every figure is imported
 *
 * Nothing here is typed as a literal where a constant exists: the plan
 * ceilings from `lib/api-plans.ts`, the free allowance and the whole onchain
 * rail from `lib/packs.ts`, the registry name from the manifest
 * `mcp-publisher` publishes, the tool count from the list it labels, the
 * endpoint and the config block from
 * `lib/mcp-install.ts` (the same functions the API keys modal installs from,
 * so a copy-paste block on this page cannot drift from a real install), and the
 * sentences about meaning from `lib/canonical-sentences.ts`.
 * `scripts/check-published-figures.ts` is a declared registry rather than a
 * parser, so a number typed here would be an unwatched literal that can never
 * fail. There is one number written out, the reverse page size, and the reason
 * is recorded at the line that writes it.
 */

const CANONICAL = `${PRODUCTION_URL}/mcp`;
const BUY_URL = `${PRODUCTION_URL}/api/x402/buy`;
const DOCS_MCP = 'https://docs.walletlink.social/mcp-server';
const DOCS_AGENT_PACK = 'https://docs.walletlink.social/agent-pack';

/**
 * The default plan's batch ceiling and the two rungs a pack raises it to
 * (docs/AGENT-SYSTEM.md, gap 17). Read from the plan table rather than from the
 * copy that used to quote it, which is how a limit change once left three
 * surfaces advertising a number the API no longer enforced.
 */
const DEFAULT_MAX_ADDRESSES = API_PLANS[CREDIT_API_PLAN].maxBatchSize;
const SCALE_MAX_ADDRESSES = API_PLANS.startup.maxBatchSize;
const INDEX_MAX_ADDRESSES = API_PLANS.enterprise.maxBatchSize;

/**
 * The onchain rail, derived exactly as `app/llms.txt/route.ts` derives it, so
 * the two agent-facing surfaces cannot disagree about what a pack costs.
 */
const agentPack = X402_PACKS.agent;
const AGENT_PRICE = `$${(agentPack.priceCents / 100).toFixed(2)}`;
const AGENT_MATCHES = agentPack.matches.toLocaleString();
const AGENT_ADDRESSES = Math.round(
  agentPack.matches / MEASURED_MATCH_RATE
).toLocaleString();

/**
 * The placeholder in the config block below.
 *
 * A published block can only ever carry one: a key is shown exactly once, at
 * creation, and the one-click install paths in the API keys modal are where a
 * real key gets embedded. A page that appeared to hand out a working key would
 * install a server that fails on its first call.
 */
const PLACEHOLDER_KEY = 'wts_live_YOUR_KEY';

interface Tool {
  name: string;
  answers: string;
  cost: string;
}

/**
 * The tools, in the order an agent meets them: look, estimate, run the long
 * job, then the reverse direction, then the two meters. The costs are the
 * declared costs the tool descriptions state at the point of decision, which is
 * the property `docs/AGENT-SYSTEM.md` lists under what must not regress.
 *
 * Declared above the metadata because the count is read from the array in both
 * places. A page that said eight in its own title while listing seven is the
 * ordinary way a count goes wrong, and it goes wrong silently.
 */
/**
 * The roster, listed here because the page states each tool's cost beside it.
 *
 * It is a second copy of a list whose authority is `app/api/mcp/route.ts`,
 * and `scripts/check-invariants.ts` asserts the two hold the same tool names
 * in the same order. Every count on this page derives from `TOOLS.length`
 * rather than being typed, so the assertion is the only thing that has to
 * hold for all four of them to stay true.
 */
const TOOLS: Tool[] = [
  {
    name: 'walletlink_resolve_wallets',
    answers: 'Who is behind these addresses?',
    cost: 'One credit per address that resolves',
  },
  {
    name: 'walletlink_estimate_list',
    answers: 'What would resolving this list cost?',
    cost: 'Free on the match meter',
  },
  {
    name: 'walletlink_submit_job',
    answers: 'Run a long list, or re-check the misses against live sources',
    cost: 'One credit per address that resolves, at completion',
  },
  {
    name: 'walletlink_job_status',
    answers: 'How is that job doing, and what did it find?',
    cost: 'Free on both meters',
  },
  {
    name: 'walletlink_wallets_by_x_handle',
    answers: 'Which wallets belong to this X account?',
    cost: 'One credit per wallet returned',
  },
  {
    name: 'walletlink_wallets_by_farcaster_username',
    answers: 'Which wallets belong to this Farcaster account?',
    cost: 'One credit per wallet returned',
  },
  {
    name: 'walletlink_index_coverage',
    answers: 'How much of the index carries each identity?',
    cost: 'Free on both meters',
  },
  {
    name: 'walletlink_account_balance',
    answers: 'What is left on this key?',
    cost: 'Free on both meters',
  },
];

const SUMMARY = `${TOOLS.length} tools, one endpoint, the same credits as the REST API. OAuth or an API key, and a USDC rail for an agent with no account.`;

export const metadata: Metadata = {
  title: 'MCP server: connect an AI agent to walletlink.social',
  description: `A remote MCP server at ${MCP_URL}. ${TOOLS.length} tools that resolve wallets to the X and Farcaster accounts their owners published, over OAuth or an API key, on the same credits as the REST API. An agent holding a wallet can buy its own access with USDC and never make an account.`,
  keywords: [
    'walletlink mcp server',
    'wallet to social mcp server',
    'connect ai agent to wallet lookup',
    'mcp server ethereum address to twitter',
    'x402 usdc api credits',
    'agent pays for api with usdc',
    'model context protocol crypto wallet',
  ],
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'MCP server: connect an AI agent to walletlink.social',
    description: SUMMARY,
    url: CANONICAL,
    type: 'website',
    siteName: 'walletlink.social',
    // Declaring this block drops the root segment's opengraph-image file, so
    // the image is named here. The same one-line omission this change fixes
    // on twelve other pages would have shipped on the newest one.
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MCP server: connect an AI agent to walletlink.social',
    description: SUMMARY,
    images: ['/twitter-image'],
  },
};

/**
 * The questions asked in the consumption sense, and only that sense.
 *
 * Answers are plain strings rather than nodes so the visible copy below and the
 * FAQPage block are the same text by construction. Structured data that says
 * something the page does not is the failure mode this shape rules out.
 *
 * Scoped on purpose: nothing here restates what walletlink.social is, what a
 * match rate is or what a pack costs. Those questions belong to the sense the
 * rest of the site already answers, and a second version of them here would be
 * two pages competing to answer one query.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: 'How do I connect an AI agent to walletlink.social?',
    a: `Add ${MCP_URL} to any MCP client. A client that supports OAuth needs nothing else: the first tool call opens a consent screen, you approve, and the call continues where it left off. A client that does not takes an Authorization header carrying a walletlink.social API key, self-serve from the account menu for any account holding credits. Tool discovery needs no credential at all, so an agent can list what is on offer before anything is bought.`,
  },
  {
    q: 'Can an agent pay without an account?',
    a: `Yes. POST to ${BUY_URL} with no payment and it answers 402 with a payment challenge. Pay ${AGENT_PRICE} in USDC on Base and the response carries a fresh API key with ${AGENT_MATCHES} match credits behind it: no card, no email, no account. One settlement can buy up to ${X402_MAX_QUANTITY} packs at linear price, and the credits are the same ones a card buys, metered the same way.`,
  },
  {
    q: 'What does each tool cost?',
    a: `${MATCH_SENTENCE} Resolving bills one credit per address that resolves. A reverse lookup bills one per wallet returned, which makes it the expensive direction. The estimate, the coverage read, the balance read and the job poll are free on both meters. ${ZERO_BALANCE_SENTENCE}`,
  },
  {
    q: 'What can an OAuth connection reach?',
    a: 'It can resolve wallets in both directions, submit a background job and read the credit balance. It cannot see saved lookups, billing details or the account email, and it cannot buy credits or change anything about the account. Access is a token that lasts an hour and renews itself, and disconnecting takes effect on the next call rather than at the end of the hour.',
  },
  {
    q: 'What happens when an agent runs out of credits?',
    a: 'The metered tools refuse with NO_CREDITS, and the refusal names both purchase paths rather than leaving an autonomous caller at a dead end. The free tools keep answering, so a drained agent can still read its own meter and collect a job it already paid for. An agent holding a wallet can also top up mid-session: a buy that presents the key it is already using puts the credits on that key’s account and mints no second credential.',
  },
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
};

/** The one code surface on the page: a hairline box, mono, scrolls on its own. */
function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  );
}

export default function McpPage() {
  return (
    <PageShell>
      {/* The only structured data this page adds. The site-wide
          SoftwareApplication node already describes the product, and a second
          one here would be two answers to one question. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
          Connect an{' '}
          <em className="font-semibold not-italic text-accent-brand">agent</em>,
          not a person
        </h1>
        <p className="mb-8 max-w-[52ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
          A remote MCP server at one URL. {TOOLS.length} tools over the same
          handlers, the same key and the same credits as the REST API, so an
          agent can resolve a wallet to the accounts its owner published without
          a person reading a reference first.
        </p>

        <Eyebrow className="mb-2">Endpoint</Eyebrow>
        <CodeBlock>{MCP_URL}</CodeBlock>
        <p className="mt-3 max-w-[65ch] text-sm text-muted-foreground">
          {/* The registry name comes from the manifest mcp-publisher
              publishes, never a second copy typed here. The version is
              deliberately not quoted: server.json can be bumped in a commit
              before it is published, so a version printed on a marketing page
              is a claim about the registry that this repo cannot keep true. */}
          Streamable HTTP. Listed in the MCP registry as{' '}
          <code className="font-mono">{serverManifest.name}</code>, verified by
          DNS. Discovery is anonymous: a client can connect and list the tools
          with no credential at all, so an agent can see what is on offer before
          anything is bought. Calling a tool needs one.
        </p>

        <section className="mt-16">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            Two ways to present a credential
          </h2>
          <p className="mb-6 max-w-[65ch] text-muted-foreground">
            Both are stored the same way and both reach the same meter by the
            same path. Neither is cheaper than the other, and nothing about
            billing changes between them.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-3 pr-4 text-left font-medium"></th>
                  <th className="py-3 pr-4 text-left font-semibold">OAuth</th>
                  <th className="py-3 text-left font-semibold">API key</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b">
                  <td className="py-3 pr-4 font-medium text-foreground">
                    Set up
                  </td>
                  <td className="py-3 pr-4">Sign in when first asked</td>
                  <td className="py-3">Create a key, paste it into a config</td>
                </tr>
                <tr className="border-b">
                  <td className="py-3 pr-4 font-medium text-foreground">
                    Lives for
                  </td>
                  <td className="py-3 pr-4">An hour, renewed automatically</td>
                  <td className="py-3">Until you revoke it</td>
                </tr>
                <tr className="border-b">
                  <td className="py-3 pr-4 font-medium text-foreground">
                    Can buy credits
                  </td>
                  <td className="py-3 pr-4">
                    No, and the rail refuses it before any money moves
                  </td>
                  <td className="py-3">
                    Yes, as a top-up onto its own account
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="py-3 pr-4 font-medium text-foreground">
                    Best for
                  </td>
                  <td className="py-3 pr-4">A person using a client</td>
                  <td className="py-3">
                    A server you run, where no browser can sign in
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-[65ch] text-sm text-muted-foreground">
            An OAuth connection can resolve wallets in both directions, run a
            background job and read the balance. It cannot see saved lookups,
            billing details or the account email, and it can never buy. A tool
            call arriving with no credential, or with a token that has expired,
            is refused with a 401 and a challenge rather than a tool error, so a
            client refreshes and retries instead of handing the model a failure
            to read out.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            One config block
          </h2>
          <p className="mb-6 max-w-[65ch] text-muted-foreground">
            For a client that takes neither OAuth nor a one-click install. The
            key goes in an Authorization header, exactly as it does for the REST
            API.
          </p>
          <CodeBlock>{mcpJsonBlock(PLACEHOLDER_KEY)}</CodeBlock>
          <p className="mt-3 max-w-[65ch] text-sm text-muted-foreground">
            Replace the placeholder with a key from the account menu. A key is
            shown exactly once, so the install links that carry a live key are
            offered on the screen that creates it and nowhere else.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            The {TOOLS.length} tools, and what each costs
          </h2>
          <p className="mb-6 max-w-[65ch] text-muted-foreground">
            Every tool states its own cost in its own description, because an
            agent that cannot see the price cannot spend responsibly.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-3 pr-4 text-left font-semibold">Tool</th>
                  <th className="py-3 pr-4 text-left font-semibold">Answers</th>
                  <th className="py-3 text-left font-semibold">
                    Match credits
                  </th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                {TOOLS.map((tool) => (
                  <tr key={tool.name} className="border-b">
                    <td className="py-3 pr-4 font-mono text-xs text-foreground">
                      {tool.name}
                    </td>
                    <td className="py-3 pr-4">{tool.answers}</td>
                    <td className="py-3">{tool.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 space-y-4 text-sm text-muted-foreground">
            <p className="max-w-[65ch]">
              <span className="font-medium text-foreground">
                Resolving takes a list.
              </span>{' '}
              Up to {DEFAULT_MAX_ADDRESSES} addresses per call on the default
              plan; a live Scale pack raises the ceiling to{' '}
              {SCALE_MAX_ADDRESSES} and Index to {INDEX_MAX_ADDRESSES}, and the
              API refuses anything over your own ceiling, naming it. Billing is
              per address, not per identity: an address carrying both an X
              handle and a Farcaster account costs one credit.
            </p>
            <p className="max-w-[65ch]">
              <span className="font-medium text-foreground">
                The reverse direction is the expensive one.
              </span>{' '}
              {/* 100 is written out rather than imported, for the reason
                  app/api/mcp/route.ts records at the same number: MAX_RESULTS
                  is module-local to both reverse routes and is not exported,
                  and it merely happens to equal the free allowance today.
                  Welding the two into one clause would hide that they are
                  different facts that can move apart. */}
              One page holds up to 100 wallets and each one is a match, so a
              single widely held handle can spend the whole free allowance of{' '}
              {FREE_MATCHES_PER_WINDOW} matches per {FREE_WINDOW_DAYS} days in
              one call. Read the balance first; that read is free.
            </p>
            <p className="max-w-[65ch]">
              <span className="font-medium text-foreground">
                A job goes deeper than a resolve.
              </span>{' '}
              It resolves addresses the index has not checked against live
              sources, so it finds identities the resolve tool reports as never
              seen. One job runs per account at a time, a submission is capped
              at {SUBMISSION_MULTIPLIER} times the match balance, and the
              matches are billed when the job completes. A job that fails is
              never billed.
            </p>
            <p className="max-w-[65ch]">
              <span className="font-medium text-foreground">
                Estimate before you spend.
              </span>{' '}
              The dry run returns counts only, never identities: how many
              addresses are in the index, how many were checked and found bare,
              how many have never been seen, and the band a resolve would bill
              inside. Minimum {ESTIMATE_MIN_WALLETS} distinct addresses, free at
              any balance, and weighed against the rate window like the batch it
              previews.
            </p>
            <p className="max-w-[65ch]">
              <span className="font-medium text-foreground">Pacing.</span>{' '}
              {PACING_SENTENCE}
            </p>
            <p className="max-w-[65ch]">
              <span className="font-medium text-foreground">
                A retry is a second purchase.
              </span>{' '}
              Duplicates are removed inside one call, never across calls, and a
              tool call has nowhere to carry an idempotency key; the tools
              declare that honestly so a framework does not retry freely on a
              timeout. Before resending a call that may have gone through, read
              the balance instead of guessing.
            </p>
            <p className="max-w-[65ch]">
              <span className="font-medium text-foreground">
                At zero balance.
              </span>{' '}
              {ZERO_BALANCE_SENTENCE} So a drained agent can always read its own
              meter and collect a job it already paid for, and that zero reading
              is the signal to buy again.
            </p>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            Paying with USDC, no account
          </h2>
          <p className="mb-6 max-w-[65ch] text-muted-foreground">
            An agent holding a wallet can buy its own credits. No card, no
            email, no sign-up.
          </p>
          <CodeBlock>{`POST ${BUY_URL}`}</CodeBlock>
          <div className="mt-6 space-y-4 text-sm text-muted-foreground">
            <p className="max-w-[65ch]">
              Post with no payment and it answers 402 with a challenge
              describing what to pay. Pay {AGENT_PRICE} in USDC on Base and the
              response carries a fresh API key with {AGENT_MATCHES} match
              credits behind it, which is roughly {AGENT_ADDRESSES} resolvable
              addresses at our measured rate, or one full batch call. Any x402
              client signs and reposts for you.
            </p>
            <p className="max-w-[65ch]">
              One settlement can buy 1 to {X402_MAX_QUANTITY} packs at linear
              price, so an agent with a real list stops paying a signature per
              pack. A buy that carries a valid key in the Authorization header
              is a top-up instead: the credits land on that key’s account and no
              second key is minted, which is how an agent recovers from a
              refusal mid-session without a new credential to manage. Every{' '}
              {X402_LOYALTY_EVERY_N}th settled purchase from the same wallet
              grants one bonus pack.
            </p>
            <p className="max-w-[65ch]">
              The key is shown once and stored only as a hash, so nobody can
              produce it again, including us. If it is lost, sign a challenge
              with the wallet that paid and a new key is issued against the same
              credits: the credits belong to the account, not to the key. They
              are the same credits a card buys, metered the same way, and they
              last {CREDIT_LIFETIME_MONTHS} months.
            </p>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            What comes back
          </h2>
          <div className="space-y-4 text-muted-foreground">
            <p className="max-w-[65ch]">
              Not the raw record. The forty-odd fields per wallet are trimmed to
              the identity, whether the owner attested it, and whether the X
              handle still reaches anyone. {ATTESTED_SENTENCE}
            </p>
            <p className="max-w-[65ch]">
              {REACHABILITY_SENTENCE} {ABSENT_SENTENCE}
            </p>
            <p className="max-w-[65ch]">
              Every metered result carries the quota the call was admitted with,
              so an agent learns what it has left without spending a second call
              to ask. A refusal carries it too: the 402 reports the balance and
              the 429 reports the window and its reset.
            </p>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="mb-6 text-2xl font-light tracking-[var(--tracking-title)]">
            Questions an agent operator asks
          </h2>
          <dl className="space-y-6">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="border-b border-border pb-6">
                <dt className="mb-1 font-semibold">{q}</dt>
                <dd className="max-w-[65ch] text-muted-foreground">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-16">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            Where the detail lives
          </h2>
          <ul className="space-y-3 text-muted-foreground">
            <li className="max-w-[65ch]">
              <a
                href={DOCS_MCP}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-brand"
              >
                MCP server reference
              </a>
              : every client path, the full response shape, the error rules and
              the limits.
            </li>
            <li className="max-w-[65ch]">
              <a
                href={DOCS_AGENT_PACK}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-brand"
              >
                Agent pack over x402
              </a>
              : the payment challenge, quantity, top-ups and recovering a lost
              key.
            </li>
            <li className="max-w-[65ch]">
              <a href="/llms.txt" className="text-accent-brand">
                /llms.txt
              </a>
              : the whole product in one file, written for a model rather than a
              reader.
            </li>
            <li className="max-w-[65ch]">
              <Link href="/pricing" className="text-accent-brand">
                Pricing
              </Link>
              : what a human buys, on the same meter the tools spend.
            </li>
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
