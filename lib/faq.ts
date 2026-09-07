import {
  PACKS,
  PACK_IDS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  CREDIT_LIFETIME_MONTHS,
} from '@/lib/packs';
import {
  INDEXED_WALLETS,
  INDEXED_WALLETS_LONG,
  WALLETS_WITH_X,
  CHAIN_COUNT_WORD,
  CHAIN_MATCH_RATES,
  CHAIN_MATCH_RATES_MEASURED_ON,
} from '@/lib/public-figures';
import { SUPPORTED_CHAINS, CHAIN_LABELS } from '@/lib/chains';
import { PRODUCTION_URL } from '@/lib/site-url';

/**
 * The answers, once.
 *
 * ## Why this file exists
 *
 * These pairs lived inside `faqSchema` in `app/layout.tsx`, which meant 5,397
 * bytes of the best-written prose on the domain existed only inside a
 * `<script type="application/ld+json">`, and shipped on all 165 URLs including
 * `/privacy`. Readability-style extractors drop script elements, so the
 * crawlers that text-extract very likely never saw any of it, and the apex
 * (the URL an engine fetches first for "what is walletlink.social") stripped to
 * about 1,100 characters of chrome: less than any other page on the site.
 *
 * So the prose is rendered where a reader and an extractor can both see it
 * (`components/HomeFaq.tsx`), and the FAQPage JSON-LD is built from the same
 * array by `faqPageJsonLd()` below. One source, two projections. Typed
 * duplicates are how the /vs pages drifted before, and a visible answer that
 * disagrees with the structured one beside it is worse than either alone.
 *
 * Google removed the FAQ rich result on 2026-05-07, so the structured half is
 * entity data for the Knowledge Graph and Bing's ingestion, not a rich-result
 * play. The visible half is the part that pays.
 *
 * ## The rules that apply here
 *
 * This is published copy, so house style is not optional: no em dashes,
 * "onchain" is one word, curly apostrophes, and no data provider is ever
 * named. Every figure is interpolated from `lib/packs.ts`,
 * `lib/public-figures.ts` and `lib/chains.ts` rather than typed, which is why
 * the only numeral written by hand in this file is the attested share, and
 * that one is declared in `scripts/check-published-figures.ts`.
 */

/**
 * A block of one answer.
 *
 * An answer is a list of blocks rather than a string because the match-rate
 * answer is a lead plus a table, and a table flattened into a paragraph is
 * exactly the 250-word wall this extraction exists to break up. `blockText`
 * below is the one place that turns a block back into the plain sentence the
 * JSON-LD needs, so the two halves cannot say different things.
 */
export type FaqBlock =
  | { kind: 'p'; text: string }
  | {
      kind: 'table';
      caption: string;
      /** The first column labels the row; the rest are the measured cells. */
      columns: readonly string[];
      rows: readonly (readonly string[])[];
    };

export type FaqEntry = {
  /** Stable anchor, so a specific answer can be linked to and cited. */
  id: string;
  question: string;
  answer: readonly FaqBlock[];
};

/**
 * The supported chains as an English list.
 *
 * Derived here and imported by `app/layout.tsx` for the OpenGraph description,
 * rather than each building its own: it was computed in both, and while two
 * derivations of one constant cannot disagree on the chains, they can and do
 * disagree on the wording. `app/llms.txt/route.ts` still has a third; the
 * natural home for all three is `lib/chains.ts`, which is outside this change.
 */
export const CHAIN_LIST = SUPPORTED_CHAINS.map((c) => CHAIN_LABELS[c])
  .join(', ')
  .replace(/, ([^,]+)$/, ' and $1');

/**
 * The measured sample, summed from the record rather than restated.
 *
 * The old answer typed "26 collections and 72,318 holders on 2026-08-17" three
 * numbers wide. All three are already in `CHAIN_MATCH_RATES`, so a re-measure
 * that updated the constant would have left this copy behind, which is the
 * failure mode `lib/public-figures.ts` exists to prevent.
 */
const MEASURED_CHAINS = Object.keys(
  CHAIN_MATCH_RATES
) as (keyof typeof CHAIN_MATCH_RATES)[];

const SAMPLE_COLLECTIONS = MEASURED_CHAINS.reduce(
  (n, c) => n + CHAIN_MATCH_RATES[c].collections,
  0
);

const SAMPLE_HOLDERS = MEASURED_CHAINS.reduce(
  (n, c) => n + CHAIN_MATCH_RATES[c].holders,
  0
);

/**
 * `en-US` explicitly, not the ambient locale.
 *
 * This copy renders on the server and again in the browser. A bare
 * `toLocaleString()` takes whichever locale each side happens to have, and the
 * two disagree on the thousands separator often enough to produce a hydration
 * mismatch on a number nobody would think to check.
 */
const group = (n: number) => n.toLocaleString('en-US');

export const FAQ: readonly FaqEntry[] = [
  {
    id: 'what-is-walletlink',
    question: 'What is walletlink.social?',
    answer: [
      {
        kind: 'p',
        text: 'walletlink.social is a wallet-to-social lookup tool that helps you find Twitter handles and Farcaster profiles for Ethereum wallet addresses. Upload a list of wallets and instantly get their linked social accounts for token holder outreach, airdrop campaigns, and community engagement.',
      },
    ],
  },
  {
    id: 'match-rate',
    question: 'What is the match rate for wallet-to-social lookups?',
    answer: [
      {
        kind: 'p',
        text: 'There is no single match rate, and the chain matters more than anything else. Use the row for your chain rather than an average: an average of these collections describes no collection in particular.',
      },
      {
        kind: 'table',
        caption: `Measured on ${CHAIN_MATCH_RATES_MEASURED_ON} across ${SAMPLE_COLLECTIONS} collections and ${group(SAMPLE_HOLDERS)} holders, against our own index with no external calls.`,
        columns: ['Chain', 'Holders measured', 'Matched to X or Farcaster'],
        rows: MEASURED_CHAINS.map((c) => [
          CHAIN_LABELS[c],
          group(CHAIN_MATCH_RATES[c].holders),
          `${CHAIN_MATCH_RATES[c].either_pct}%`,
        ]),
      },
      {
        kind: 'p',
        text: 'Base is roughly three times Ethereum because Base is where Farcaster lives. Tools that match wallets to social accounts typically publish rates in the low single digits, so even the lowest chain here clears that by a wide margin.',
      },
      {
        kind: 'p',
        text: 'Farcaster matches are deterministic: the index covers the complete Farcaster protocol (every account’s verified and custody addresses, refreshed daily), so if a wallet belongs to a Farcaster user, we find it.',
      },
      {
        kind: 'p',
        text: 'Twitter matches are resolved through several independent routes and every match is labelled with the evidence behind it. Over 99.9% come from owner-attested routes: an X account verified on Farcaster, a handle the owner set in an onchain ENS record, or an account the owner proved by signing with the wallet and signing in to X. The remainder is correlated from identity indexes and labelled as such. Nothing is inferred from display names, bios or timing.',
      },
    ],
  },
  {
    id: 'cost',
    question: 'How much does walletlink.social cost?',
    answer: [
      {
        kind: 'p',
        text: `walletlink.social charges for matches, not for wallets: a match is a wallet we resolve to an X or Farcaster account, and a wallet we cannot resolve costs nothing. The free tier gives ${FREE_MATCHES_PER_WINDOW} matches every ${FREE_WINDOW_DAYS} days. Credit packs are ${PACK_IDS.map(
          (id) =>
            `${PACKS[id].name} at $${PACKS[id].priceCents / 100} for ${group(PACKS[id].matches)} matches`
        ).join(
          ', '
        )}. Every pack includes contract import on all ${CHAIN_COUNT_WORD} chains, the X list export, the wallet addresses behind a handle, priority score and follower counts, deep scan with onchain ENS, and API and MCP access on the same credits. The CSV export and X reachability are not gated: a free lookup exports every row it produced. All packs are one-time payments, not subscriptions, and credits last ${CREDIT_LIFETIME_MONTHS} months.`,
      },
    ],
  },
  {
    id: 'vs-addressable',
    question: 'How is walletlink.social different from Addressable?',
    answer: [
      {
        kind: 'p',
        text: `Unlike Addressable which requires sales calls and enterprise contracts, walletlink.social offers instant self-serve access. You can start for free immediately, with simple one-time pricing instead of monthly subscriptions. Addressable’s matched-owner counts are built with probabilistic “fingerprinting”; walletlink.social never fingerprints. Over 99.9% of Twitter matches are owner-attested (Farcaster verifications, onchain ENS records, and accounts proven by wallet signature), the rest are correlated from identity indexes and labelled as such, and every match carries the class of evidence behind it so you can set your own threshold. The index covers ${INDEXED_WALLETS} wallets with complete Farcaster coverage.`,
      },
    ],
  },
  {
    id: 'farcaster',
    question: 'Does walletlink.social support Farcaster?',
    answer: [
      {
        kind: 'p',
        text: 'Yes. Farcaster is walletlink.social’s deepest coverage. The index includes the complete Farcaster protocol: every account’s verified and custody addresses with usernames and follower counts, refreshed daily. Lookups return usernames, follower counts, and FIDs, and reverse lookup (handle → wallets) works for any Farcaster user.',
      },
    ],
  },
  {
    id: 'coverage',
    question: 'How many wallets does walletlink.social cover?',
    answer: [
      {
        kind: 'p',
        text: `The index covers ${INDEXED_WALLETS_LONG} wallets with at least one linked social identity. Farcaster coverage is complete: every account’s verified and custody addresses, refreshed daily. Over ${WALLETS_WITH_X} wallets have a linked Twitter handle, nearly all of them owner-attested: an X account verified on Farcaster, a handle the owner set in an onchain ENS record, or an account the owner proved by signing with the wallet and signing in to X.`,
      },
    ],
  },
  {
    id: 'chains',
    question: 'Which blockchains does walletlink.social support?',
    answer: [
      {
        kind: 'p',
        text: `walletlink.social supports ${CHAIN_COUNT_WORD} EVM chains: ${CHAIN_LIST}. You can upload a wallet list from any of them, or import every holder of an NFT collection or ERC-20 token directly from its contract address. Both import types work on every supported network.`,
      },
    ],
  },
  {
    id: 'agent-wallets',
    question: 'Can walletlink.social identify AI agent wallets?',
    answer: [
      {
        kind: 'p',
        text: 'Yes, walletlink.social automatically identifies AI agent wallets from platforms like Virtuals Protocol, ElizaOS, and Olas. Agent wallets are flagged with their name, framework, and token symbol. This helps you distinguish between human users and AI agents in your wallet lists.',
      },
    ],
  },
  {
    // The namesake question. `app/llms.txt/route.ts` carries the same
    // correction in the same voice for an agent reading the text file; this
    // is the half a person asking an assistant "what is walletlink" gets
    // back. Deliberately last: it is the only answer here that spends its
    // words on what we are not.
    id: 'not-coinbase-walletlink',
    question: 'Is walletlink.social the same as WalletLink by Coinbase?',
    answer: [
      {
        kind: 'p',
        text: 'No. WalletLink was the wallet-connection protocol Coinbase shipped and later renamed to the Coinbase Wallet SDK, and it connects a wallet to a website. walletlink.social is an identity index: it answers who is behind a wallet address, and which wallets a social handle is attested to. Different job, unrelated projects.',
      },
    ],
  },
];

/**
 * One block as the plain sentence the structured data carries.
 *
 * A table row becomes "<chain>: <n> holders measured, <n> matched to X or
 * Farcaster.", built from the same cells the visible table renders, so the
 * JSON-LD cannot fall behind the page it sits on. Written without a worked
 * example on purpose: a figure in a comment is a figure the undeclared-figure
 * sweep has to account for, and this one would be a copy of the constant two
 * hundred lines above it.
 */
function blockText(block: FaqBlock): string {
  if (block.kind === 'p') return block.text;
  const headings = block.columns.slice(1);
  const rows = block.rows.map((row) => {
    const cells = headings
      .map((h, i) => `${row[i + 1]} ${h.charAt(0).toLowerCase()}${h.slice(1)}`)
      .join(', ');
    return `${row[0]}: ${cells}.`;
  });
  return [block.caption, ...rows].join(' ');
}

/** One answer as plain text, for `acceptedAnswer.text`. */
export function faqAnswerText(entry: FaqEntry): string {
  return entry.answer.map(blockText).join(' ');
}

/**
 * The FAQPage node, for the homepage and nowhere else.
 *
 * It used to be emitted from the root layout, which put an FAQPage on every
 * URL on the site, most of which have no FAQ on them. It belongs on the one
 * page that renders these answers.
 *
 * `/pricing` deliberately does not get a second one: `app/pricing/page.tsx`
 * records the decision, and `scripts/check-invariants.ts` records the
 * eight-day blended-rate incident that a single FAQ authority prevents.
 */
export function faqPageJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${PRODUCTION_URL}/#faq`,
    url: PRODUCTION_URL,
    mainEntity: FAQ.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faqAnswerText(entry),
      },
    })),
  };
}
