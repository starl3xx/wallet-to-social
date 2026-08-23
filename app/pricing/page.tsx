import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { PackPricing } from '@/components/PackPricing';
import { BuyCreditsButton } from '@/components/BuyCreditsButton';
import { Button } from '@/components/ui/button';
import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import {
  PACKS,
  PACK_IDS,
  MEASURED_MATCH_RATE,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  CREDIT_LIFETIME_MONTHS,
} from '@/lib/packs';

/**
 * The pricing page. Until 2026-08-22 the packs rendered only inside the
 * buy-credits modal and on the six /vs pages, so a person searching
 * "walletlink pricing", or an AI agent shortlisting tools, found nothing at
 * a URL. This page is the linkable answer.
 *
 * Every number is a constant: packs and the free allowance from
 * `lib/packs.ts` through `PackPricing`, the worked example computed from
 * `MEASURED_MATCH_RATE` (a display estimate that never bills anyone). Typed
 * figures are how the /vs pages once drifted, and this page repeats none of
 * that.
 *
 * The FAQ here is visible prose for the reader on this page. The site-wide
 * FAQPage JSON-LD in `app/layout.tsx` already carries the pricing answer for
 * crawlers, so this page adds no second structured-data block to disagree
 * with it.
 */
export const metadata: Metadata = {
  title: 'Pricing',
  description: `Credit packs bought once, metered in matches. A match is a wallet resolved to an X or Farcaster account; misses cost nothing. Free is ${FREE_MATCHES_PER_WINDOW} matches in a rolling ${FREE_WINDOW_DAYS}-day window.`,
  alternates: { canonical: 'https://walletlink.social/pricing' },
  openGraph: {
    title: 'walletlink.social pricing',
    description: `Packs from $${PACKS[PACK_IDS[0]].priceCents / 100}, bought once. You are charged for matches, not for wallets, and misses cost nothing.`,
    type: 'website',
  },
};

/** The worked example, computed so a pack or rate change moves this page. */
const EXAMPLE_WALLETS = 10_000;
const EXAMPLE_MATCHES = Math.round(EXAMPLE_WALLETS * MEASURED_MATCH_RATE);
const COVERING_PACK =
  PACK_IDS.map((id) => PACKS[id]).find((p) => p.matches >= EXAMPLE_MATCHES) ??
  PACKS.index;

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'What is a match?',
    a: 'A wallet we resolve to an X or Farcaster account. Matches are the only thing you are charged for, on the site and through the API alike.',
  },
  {
    q: 'What does a wallet you cannot resolve cost?',
    a: 'Nothing. A list that matches poorly spends almost none of a pack, so there is no penalty for finding out.',
  },
  {
    q: 'Is there a subscription?',
    a: `No. A pack is a one-time payment, and credits last ${CREDIT_LIFETIME_MONTHS} months. When they run out, buy another pack or run on the free allowance.`,
  },
  {
    q: 'Is there a refund?',
    a: 'No. Check first instead: the free allowance shows your list’s real match rate before you spend anything, and misses cost nothing either way.',
  },
  {
    q: 'What is free?',
    a: `${FREE_MATCHES_PER_WINDOW} matches in a rolling ${FREE_WINDOW_DAYS}-day window, on every account. Small lists never need a pack.`,
  },
  {
    q: 'How do I buy?',
    a: 'The Buy credits button asks for the email your credits and receipt go to, then Stripe collects the card. No account is needed before you buy; the credits wait on the email you gave.',
  },
];

export default function PricingPage() {
  return (
    <PageShell>
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
          Pay per{' '}
          <em className="font-semibold not-italic text-accent-brand">match</em>.
          Misses cost nothing.
        </h1>
        <p className="mb-12 max-w-[52ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
          Credit packs, bought once. A match is a wallet we resolve to an X or
          Farcaster account, and each match carries its evidence. The free
          allowance shows your match rate before you pay.
        </p>

        <PackPricing />

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <BuyCreditsButton>Buy credits</BuyCreditsButton>
          <Button variant="outline" asChild>
            <Link href="/">
              Run a free lookup
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>

        <section className="mt-16">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            What a list actually costs
          </h2>
          <p className="max-w-[65ch] text-muted-foreground">
            A {EXAMPLE_WALLETS.toLocaleString()}-wallet list at the measured{' '}
            {Math.round(MEASURED_MATCH_RATE * 1000) / 10}% match rate resolves
            about {EXAMPLE_MATCHES.toLocaleString()} wallets. You are charged
            those {EXAMPLE_MATCHES.toLocaleString()} matches, the{' '}
            {COVERING_PACK.name} pack covers them, and the other{' '}
            {(EXAMPLE_WALLETS - EXAMPLE_MATCHES).toLocaleString()} wallets cost
            nothing. The rate is an estimate from a measured sample; your
            chain decides your number, which is why the free allowance exists.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="mb-6 text-2xl font-light tracking-[var(--tracking-title)]">
            Questions people ask before buying
          </h2>
          <dl className="space-y-6">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="border-b border-border pb-6">
                <dt className="mb-1 font-semibold">{q}</dt>
                <dd className="max-w-[65ch] text-muted-foreground">{a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-sm text-muted-foreground">
            Something else?{' '}
            {/* The link variant at inline size: the one treatment for a text
                link inside a sentence, and it brings the underline affordance
                and the focus ring a bare anchor here lacked. */}
            <Button asChild variant="link" size="inline">
              <a href="mailto:help@walletlink.social">help@walletlink.social</a>
            </Button>{' '}
            reaches a person.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
