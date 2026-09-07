import type { Metadata } from 'next';
import {
  PACKS,
  PACK_IDS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  CREDIT_LIFETIME_MONTHS,
} from '@/lib/packs';
import { CHAIN_LIST } from '@/lib/faq';
import { LEGAL_ENTITY, PRODUCTION_URL } from '@/lib/site-url';
import { Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { PageViewTracker } from '@/components/PageViewTracker';
import { DocsChat } from '@/components/DocsChat';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthProvider } from '@/components/AuthProvider';
import { UpgradeModalProvider } from '@/components/UpgradeModalProvider';
import './globals.css';
import { INDEXED_WALLETS, CHAIN_COUNT_WORD } from '@/lib/public-figures';

// Söhne is self-hosted from public/fonts and declared in globals.css, so there
// is no Google Fonts request for the body face any more. Geist Mono stays:
// Söhne has no monospace cut, and addresses need one.
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://walletlink.social'),
  title:
    'walletlink.social | Find your DeFi users, NFT holders & AI agents on Twitter & Farcaster',
  description: `Turn wallet addresses into Twitter and Farcaster profiles across ${CHAIN_COUNT_WORD} EVM chains. Backed by a ${INDEXED_WALLETS}-wallet index with complete Farcaster coverage and owner-attested Twitter matches. No sales calls, instant access.`,
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
  keywords: [
    'addressable alternative',
    'wallet to twitter lookup',
    'find nft holders twitter',
    'defi user outreach',
    'token holder outreach',
    'airdrop targeting twitter',
    'dao member twitter',
    'nft community marketing',
    'find defi users social',
    'crypto wallet social profiles',
    'ai agent wallet lookup',
    'virtuals protocol agents',
    'elizaos agent wallets',
    'identify ai agents onchain',
    'agent wallet to twitter',
    'robinhood chain nft holders',
    'find robinhood chain holders twitter',
    'base nft holder lookup',
    'multi chain wallet to social',
    'arbitrum nft holder lookup',
    'polygon token holder outreach',
    'optimism nft holders twitter',
    'bnb chain token holders',
    'find nft holders across chains',
  ],
  openGraph: {
    title:
      'walletlink.social | Find your DeFi users, NFT holders & AI agents on Twitter & Farcaster',
    description: `Turn wallet addresses into Twitter and Farcaster profiles across ${CHAIN_COUNT_WORD} EVM chains: ${CHAIN_LIST}. Backed by a ${INDEXED_WALLETS}-wallet index. No sales calls.`,
    type: 'website',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title:
      'walletlink.social | Find your DeFi users, NFT holders & AI agents on Twitter & Farcaster',
    description: `Find your DeFi users, NFT holders, and AI agents on Twitter and Farcaster. Backed by a ${INDEXED_WALLETS}-wallet identity index with complete Farcaster coverage. Wallet-to-social lookup across ${CHAIN_COUNT_WORD} EVM chains.`,
    creator: '@starl3xx',
  },
  alternates: {
    canonical: 'https://walletlink.social',
  },
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * The entity nodes, in one graph.
 *
 * ## Why an Organization exists at all now
 *
 * `sameAs` returned zero hits across the whole repo. `sameAs` and `@id` are the
 * documented entity-reconciliation inputs for Google's Knowledge Graph and
 * Bing's schema ingestion, and until this landed the only complete Organization
 * on the property was Mintlify's, anchored at the docs subdomain with no logo
 * and no `sameAs`, while eight `publisher` stubs on /vs, /blog and /holders had
 * nothing to resolve to.
 *
 * Scope it honestly: this does nothing for ChatGPT search, Perplexity or
 * Claude, which text-extract and typically drop script tags. The visible FAQ on
 * the homepage is the half that reaches those.
 *
 * ## The rules this block follows
 *
 * `legalName` and every URL come from `lib/site-url.ts`, never typed: that
 * file's header records the day the entity name was written from memory as
 * "Starl3xx Labs" on the one page where it is a legal claim. The three `sameAs`
 * profiles were each fetched and each returned 200, and each links back here,
 * which is what makes them evidence rather than assertion. The docs subdomain
 * is deliberately NOT among them: `sameAs` is for a reference page identifying
 * the entity elsewhere, not for your own site.
 */
const ORGANIZATION_ID = `${PRODUCTION_URL}/#organization`;
const WEBSITE_ID = `${PRODUCTION_URL}/#website`;
const APPLICATION_ID = `${PRODUCTION_URL}/#software`;
const PRICING_URL = `${PRODUCTION_URL}/pricing`;

const organization = {
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: 'walletlink.social',
  legalName: LEGAL_ENTITY,
  url: PRODUCTION_URL,
  // public/icon.png, 512x512, well clear of Google's 112px floor.
  logo: `${PRODUCTION_URL}/icon.png`,
  disambiguatingDescription:
    'An identity index for EVM wallet addresses: it resolves an address to the X and Farcaster accounts its owner published, and a handle back to its wallets. It is not a wallet connector and not an analytics suite.',
  sameAs: [
    'https://x.com/walletlinkETH',
    'https://farcaster.xyz/walletlink',
    'https://github.com/starl3xx/wallet-to-social',
  ],
};

const website = {
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: PRODUCTION_URL,
  name: 'walletlink.social',
  publisher: { '@id': ORGANIZATION_ID },
};

const softwareApplication = {
  '@type': 'SoftwareApplication',
  '@id': APPLICATION_ID,
  name: 'walletlink.social',
  url: PRODUCTION_URL,
  /**
   * "WebApplication" is a schema.org TYPE, not a category, and it is absent
   * from Google's enumerated `applicationCategory` list, so the field carried
   * no meaning for the one consumer it was written for.
   */
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  publisher: { '@id': ORGANIZATION_ID },
  provider: { '@id': ORGANIZATION_ID },
  isPartOf: { '@id': WEBSITE_ID },
  description: `Find your DeFi users, NFT holders, and AI agents on Twitter and Farcaster. Wallet-to-social lookup tool backed by a ${INDEXED_WALLETS}-wallet identity index with complete Farcaster coverage. Automatically identifies AI agent wallets.`,
  /**
   * Credit packs. A match is a wallet resolved to an X or Farcaster account,
   * and a miss costs nothing, which is why every price here is quoted against
   * matches rather than against wallets submitted.
   *
   * Still one-time payments. That is a real differentiator against every priced
   * competitor in the category and it is load-bearing for the /vs/ pages, so it
   * is stated in the FAQ answer (`lib/faq.ts`) rather than left to be inferred.
   *
   * Every offer carries the pricing page as its `url`, because an Offer with no
   * URL gives a consumer nowhere to send anyone, and the packs are derived from
   * `PACK_IDS` so a new pack arrives here with the rest of the site.
   */
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      url: PRICING_URL,
      description: `${FREE_MATCHES_PER_WINDOW} matches in a rolling ${FREE_WINDOW_DAYS}-day window`,
    },
    ...PACK_IDS.map((id) => ({
      '@type': 'Offer',
      name: PACKS[id].name,
      price: String(PACKS[id].priceCents / 100),
      priceCurrency: 'USD',
      url: PRICING_URL,
      description: `${PACKS[id].matches.toLocaleString('en-US')} matches, one-time payment, credits last ${CREDIT_LIFETIME_MONTHS} months`,
    })),
  ],
  /**
   * `aggregateRating` is deliberately absent.
   *
   * It said 4.8 from 50 ratings. There are no 50 ratings: the product has 102
   * accounts and one payment, and no review has ever been collected anywhere.
   * That is fabricated structured data served to Google, on a site whose entire
   * position is that it reports only what it can evidence, and it sat two
   * hundred lines from a FAQ answer about how carefully we distinguish an
   * attested handle from an inferred one.
   *
   * If ratings are ever collected, they can go back with a source behind them.
   */
};

/**
 * One graph, so the `@id` references above resolve inside the same document
 * rather than hoping a consumer merges three separate blocks.
 */
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [organization, website, softwareApplication],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* The entity graph is site-wide because the entity is. The FAQPage
            that used to sit beside it is not: it shipped on all 165 URLs,
            `/privacy` included, and it now renders with the answers on the
            homepage (`components/HomeFaq.tsx`). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <AuthProvider>
            {/* The buy-credits modal lives here rather than on the homepage
                because the shell's header opens it from every route. */}
            <UpgradeModalProvider>{children}</UpgradeModalProvider>
          </AuthProvider>
          {/* Inside ThemeProvider so the widget follows the site's own theme
              toggle, but outside AuthProvider so sign-in state does not
              re-render it. */}
          <DocsChat />
        </ThemeProvider>
        <Analytics />
        {/* Vercel's counts traffic; ours feeds the admin funnel. Both, on purpose. */}
        <PageViewTracker />
      </body>
    </html>
  );
}
