import type { Metadata } from 'next';
import { Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { DocsChat } from '@/components/DocsChat';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthProvider } from '@/components/AuthProvider';
import './globals.css';

// Söhne is self-hosted from public/fonts and declared in globals.css, so there
// is no Google Fonts request for the body face any more. Geist Mono stays:
// Söhne has no monospace cut, and addresses need one.
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://walletlink.social'),
  title: 'walletlink.social | Find your DeFi users, NFT holders & AI agents on Twitter & Farcaster',
  description:
    'Turn wallet addresses into Twitter and Farcaster profiles across seven EVM chains. Backed by a 4.7M-wallet index with complete Farcaster coverage and owner-attested Twitter matches. No sales calls, instant access.',
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
    title: 'walletlink.social | Find your DeFi users, NFT holders & AI agents on Twitter & Farcaster',
    description:
      'Turn wallet addresses into Twitter and Farcaster profiles across seven EVM chains: Ethereum, Base, Robinhood Chain, Arbitrum, Polygon, Optimism and BNB Chain. Backed by a 4.7M-wallet index. No sales calls.',
    type: 'website',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social | Find your DeFi users, NFT holders & AI agents on Twitter & Farcaster',
    description:
      'Find your DeFi users, NFT holders, and AI agents on Twitter and Farcaster. Backed by a 4.7M-wallet identity index with complete Farcaster coverage. Wallet-to-social lookup across seven EVM chains.',
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
  description:
    'Find your DeFi users, NFT holders, and AI agents on Twitter and Farcaster. Wallet-to-social lookup tool backed by a 4.7M-wallet identity index with complete Farcaster coverage. Automatically identifies AI agent wallets.',
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      description: 'Up to 500 wallets per lookup',
    },
    {
      '@type': 'Offer',
      name: 'Pro',
      price: '99',
      priceCurrency: 'USD',
      description: 'Up to 5,000 wallets per lookup, contract import and API access - one-time payment',
    },
    {
      '@type': 'Offer',
      name: 'Unlimited',
      price: '249',
      priceCurrency: 'USD',
      description: 'Unlimited wallets forever - one-time payment',
    },
  ],
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.8',
    ratingCount: '50',
  },
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
        text: 'walletlink.social averages a 22% match rate, roughly 9x the industry average of 2.5%. Farcaster matches are deterministic: the index covers the complete Farcaster protocol (every account’s verified and custody addresses, refreshed daily), so if a wallet belongs to a Farcaster user, we find it. Twitter matches are resolved through several independent routes and every match is labelled with the evidence behind it. Over 99.9% come from owner-attested routes: an X account verified on Farcaster, or a handle the owner set in an onchain ENS record. The remainder is correlated from identity indexes and labelled as such. Nothing is inferred from display names, bios or timing.',
      },
    },
    {
      '@type': 'Question',
      name: 'How much does walletlink.social cost?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'walletlink.social offers a free tier (500 wallets per lookup), Pro ($99 one-time for 5,000 wallets per lookup with contract import, API access including reverse lookup from any Farcaster handle to its wallets, and full history), and Unlimited ($249 one-time for unlimited wallets forever). Both paid plans are one-time payments, not subscriptions.',
      },
    },
    {
      '@type': 'Question',
      name: 'How is walletlink.social different from Addressable?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Unlike Addressable which requires sales calls and enterprise contracts, walletlink.social offers instant self-serve access. You can start for free immediately, with simple one-time pricing instead of monthly subscriptions. Addressable’s matched-owner counts are built with probabilistic “fingerprinting”; walletlink.social never fingerprints. Over 99.9% of Twitter matches are owner-attested (Farcaster verifications and onchain ENS records), the rest are correlated from identity indexes and labelled as such, and every match carries the class of evidence behind it so you can set your own threshold. The index covers 4.7M wallets with complete Farcaster coverage.',
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
        text: 'The index covers 4.7 million wallets with at least one linked social identity. Farcaster coverage is complete: every account’s verified and custody addresses, refreshed daily. Over 1 million wallets have a linked Twitter handle, nearly all of them owner-attested, most via an X account verified on Farcaster and the rest from onchain ENS records.',
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
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      </head>
      <body
        className={`${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
          {/* Inside ThemeProvider so the widget follows the site's own theme
              toggle, but outside AuthProvider so sign-in state does not
              re-render it. */}
          <DocsChat />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
