import type { Metadata } from 'next';
import {
  PACKS,
  PACK_IDS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
} from '@/lib/packs';
import { Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { PageViewTracker } from '@/components/PageViewTracker';
import { DocsChat } from '@/components/DocsChat';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthProvider } from '@/components/AuthProvider';
import './globals.css';
import {
  INDEXED_WALLETS,
  INDEXED_WALLETS_LONG,
  WALLETS_WITH_X,
} from '@/lib/public-figures';

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
  description: `Turn wallet addresses into Twitter and Farcaster profiles across seven EVM chains. Backed by a ${INDEXED_WALLETS}-wallet index with complete Farcaster coverage and owner-attested Twitter matches. No sales calls, instant access.`,
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
    description: `Turn wallet addresses into Twitter and Farcaster profiles across seven EVM chains: Ethereum, Base, Robinhood Chain, Arbitrum, Polygon, Optimism and BNB Chain. Backed by a ${INDEXED_WALLETS}-wallet index. No sales calls.`,
    type: 'website',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title:
      'walletlink.social | Find your DeFi users, NFT holders & AI agents on Twitter & Farcaster',
    description: `Find your DeFi users, NFT holders, and AI agents on Twitter and Farcaster. Backed by a ${INDEXED_WALLETS}-wallet identity index with complete Farcaster coverage. Wallet-to-social lookup across seven EVM chains.`,
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

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'walletlink.social',
  applicationCategory: 'WebApplication',
  operatingSystem: 'Web',
  description: `Find your DeFi users, NFT holders, and AI agents on Twitter and Farcaster. Wallet-to-social lookup tool backed by a ${INDEXED_WALLETS}-wallet identity index with complete Farcaster coverage. Automatically identifies AI agent wallets.`,
  /**
   * Credit packs. A match is a wallet resolved to an X or Farcaster account,
   * and a miss costs nothing, which is why every price here is quoted against
   * matches rather than against wallets submitted.
   *
   * Still one-time payments. That is a real differentiator against every priced
   * competitor in the category and it is load-bearing for the /vs/ pages, so it
   * is stated in the FAQ answer below rather than left to be inferred.
   */
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      description: '100 matches every 30 days',
    },
    ...PACK_IDS.map((id) => ({
      '@type': 'Offer',
      name: PACKS[id].name,
      price: String(PACKS[id].priceCents / 100),
      priceCurrency: 'USD',
      description: `${PACKS[id].matches.toLocaleString()} matches, one-time payment, credits last 12 months`,
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

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is walletlink.social?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'walletlink.social is a wallet-to-social lookup tool that helps you find Twitter handles and Farcaster profiles for Ethereum wallet addresses. Upload a list of wallets and instantly get their linked social accounts for token holder outreach, airdrop campaigns, and community engagement.',
      },
    },
    {
      '@type': 'Question',
      name: 'What is the match rate for wallet-to-social lookups?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'There is no single match rate, and the chain matters more than anything else. Measured across 26 collections and 72,318 holders on 2026-08-17, against our own index with no external calls: Base 46.2%, Ethereum 16.6%, Robinhood Chain 15.6%, and 30.8% across all three. Base is roughly three times Ethereum because Base is where Farcaster lives. The industry average sits near 2.5%, so even the lowest chain here is six times that. Farcaster matches are deterministic: the index covers the complete Farcaster protocol (every account’s verified and custody addresses, refreshed daily), so if a wallet belongs to a Farcaster user, we find it. Twitter matches are resolved through several independent routes and every match is labelled with the evidence behind it. Over 99.9% come from owner-attested routes: an X account verified on Farcaster, a handle the owner set in an onchain ENS record, or an account the owner proved by signing with the wallet and signing in to X. The remainder is correlated from identity indexes and labelled as such. Nothing is inferred from display names, bios or timing.',
      },
    },
    {
      '@type': 'Question',
      name: 'How much does walletlink.social cost?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: `walletlink.social charges for matches, not for wallets: a match is a wallet we resolve to an X or Farcaster account, and a wallet we cannot resolve costs nothing. The free tier gives ${FREE_MATCHES_PER_WINDOW} matches every ${FREE_WINDOW_DAYS} days. Credit packs are ${PACK_IDS.map((id) => `${PACKS[id].name} at $${PACKS[id].priceCents / 100} for ${PACKS[id].matches.toLocaleString()} matches`).join(', ')}. Every pack includes all seven chains, uncapped CSV export, API access, reverse lookup from a handle to its wallets, deep scan with onchain ENS, and X reachability on every match. All packs are one-time payments, not subscriptions, and credits last 12 months.`,
      },
    },
    {
      '@type': 'Question',
      name: 'How is walletlink.social different from Addressable?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: `Unlike Addressable which requires sales calls and enterprise contracts, walletlink.social offers instant self-serve access. You can start for free immediately, with simple one-time pricing instead of monthly subscriptions. Addressable’s matched-owner counts are built with probabilistic “fingerprinting”; walletlink.social never fingerprints. Over 99.9% of Twitter matches are owner-attested (Farcaster verifications, onchain ENS records, and accounts proven by wallet signature), the rest are correlated from identity indexes and labelled as such, and every match carries the class of evidence behind it so you can set your own threshold. The index covers ${INDEXED_WALLETS} wallets with complete Farcaster coverage.`,
      },
    },
    {
      '@type': 'Question',
      name: 'Does walletlink.social support Farcaster?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. Farcaster is walletlink.social’s deepest coverage. The index includes the complete Farcaster protocol: every account’s verified and custody addresses with usernames and follower counts, refreshed daily. Lookups return usernames, follower counts, and FIDs, and reverse lookup (handle → wallets) works for any Farcaster user.',
      },
    },
    {
      '@type': 'Question',
      name: 'How many wallets does walletlink.social cover?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: `The index covers ${INDEXED_WALLETS_LONG} wallets with at least one linked social identity. Farcaster coverage is complete: every account’s verified and custody addresses, refreshed daily. Over ${WALLETS_WITH_X} wallets have a linked Twitter handle, nearly all of them owner-attested: an X account verified on Farcaster, a handle the owner set in an onchain ENS record, or an account the owner proved by signing with the wallet and signing in to X.`,
      },
    },
    {
      '@type': 'Question',
      name: 'Which blockchains does walletlink.social support?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'walletlink.social supports seven EVM chains: Ethereum, Base, Robinhood Chain, Arbitrum, Polygon, Optimism and BNB Chain. You can upload a wallet list from any of them, or import every holder of an NFT collection or ERC-20 token directly from its contract address. Both import types work on every supported network.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can walletlink.social identify AI agent wallets?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, walletlink.social automatically identifies AI agent wallets from platforms like Virtuals Protocol, ElizaOS, and Olas. Agent wallets are flagged with their name, framework, and token symbol. This helps you distinguish between human users and AI agents in your wallet lists.',
      },
    },
  ],
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      </head>
      <body className={`${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
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
