import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { PackPricing } from '@/components/PackPricing';
import { BuyCreditsButton } from '@/components/BuyCreditsButton';
import { Button } from '@/components/ui/button';
import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import {
  PACKS,
  MEASURED_MATCH_RATE,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
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
  description:
    'Credit packs bought once, metered in matches. A match is a wallet resolved to an X or Farcaster account; misses cost nothing. Free is 100 matches every 30 days.',
  alternates: { canonical: 'https://walletlink.social/pricing' },
  openGraph: {
    title: 'walletlink.social pricing',
    description:
      'Packs from $29, bought once. You are charged for matches, not for wallets, and misses cost nothing.',
    type: 'website',
  },
};

/** The worked example, computed so a pack or rate change moves this page. */
const EXAMPLE_WALLETS = 10_000;
const EXAMPLE_MATCHES = Math.round(EXAMPLE_WALLETS * MEASURED_MATCH_RATE);

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'What is a match?',
    a: 'A wallet we resolve to an X or Farcaster account. Matches are the only thing you are charged for, on the site and through the API alike.',
  },
  {
    q: 'What does a wallet you cannot resolve cost?',
    a: 'Nothing. A low-match list spends almost none of a pack, so the honest read of your list is also the cheap one.',
  },
  {
    q: 'Is there a subscription?',
    a: 'No. A pack is a one-time payment, and credits last 12 months. When they run out, buy another pack or run on the free allowance.',
  },
  {
    q: 'What is free?',
    a: `${FREE_MATCHES_PER_WINDOW} matches every ${FREE_WINDOW_DAYS} days, on any account. The free allowance covers the small lists, and it is the honest way to check your list's match rate before you pay.`,
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
          Pay for matches, not promises.
        </h1>
        <p className="mb-10 max-w-[52ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
          Credit packs, bought once. A match is a wallet we resolve to an X or
          Farcaster account, and a wallet we cannot resolve costs nothing.
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

        <section className="mt-14">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            What a list actually costs
          </h2>
          <p className="max-w-[65ch] text-muted-foreground">
            A {EXAMPLE_WALLETS.toLocaleString()}-wallet list at the measured{' '}
            {Math.round(MEASURED_MATCH_RATE * 1000) / 10}% match rate resolves
            about {EXAMPLE_MATCHES.toLocaleString()} wallets. You are charged
            those {EXAMPLE_MATCHES.toLocaleString()} matches, the{' '}
            {PACKS.scale.name} pack covers them, and the other{' '}
            {(EXAMPLE_WALLETS - EXAMPLE_MATCHES).toLocaleString()} wallets cost
            nothing. The rate is an estimate from a measured sample; your
            chain decides your number, which is why the free allowance exists.
          </p>
        </section>

        <section className="mt-14">
          <h2 className="mb-5 text-2xl font-light tracking-[var(--tracking-title)]">
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
            <a
              href="mailto:help@walletlink.social"
              className="text-accent-brand"
            >
              help@walletlink.social
            </a>{' '}
            reaches a person.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
