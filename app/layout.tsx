import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthProvider } from '@/components/AuthProvider';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://walletlink.social'),
  title: 'walletlink.social — Find your DeFi users, NFT holders & AI agents on Twitter',
  description:
    'Find your DeFi users, NFT holders, and AI agents on Twitter. Turn wallet addresses into social profiles for token holder outreach, airdrop campaigns, and DAO engagement across Ethereum, Base, and Robinhood Chain. Identify AI agent wallets from Virtuals, ElizaOS, and more. No sales calls—instant access.',
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
  ],
  openGraph: {
    title: 'walletlink.social — Find your DeFi users, NFT holders & AI agents on Twitter',
    description:
      'Find your DeFi users, NFT holders, and AI agents on Twitter. Wallet-to-social lookup across Ethereum, Base, and Robinhood Chain for token holder outreach, airdrop campaigns, and community engagement. No sales calls.',
    type: 'website',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social — Find your DeFi users, NFT holders & AI agents on Twitter',
    description:
      'Find your DeFi users, NFT holders, and AI agents on Twitter. Wallet-to-social lookup across Ethereum, Base, and Robinhood Chain for token holder outreach, airdrop campaigns, and community engagement.',
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
    'Find your DeFi users, NFT holders, and AI agents on Twitter. Wallet-to-social lookup tool for token holder outreach, airdrop campaigns, and DAO engagement. Automatically identifies AI agent wallets.',
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      description: 'Up to 1,000 wallets per lookup',
    },
    {
      '@type': 'Offer',
      name: 'Starter',
      price: '49',
      priceCurrency: 'USD',
      description: '10,000 wallets total - one-time payment',
    },
    {
      '@type': 'Offer',
      name: 'Pro',
      price: '99',
      priceCurrency: 'USD',
      description: 'Up to 10,000 wallets per lookup - one-time payment',
    },
    {
      '@type': 'Offer',
      name: 'Unlimited',
      price: '420',
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
        text: 'walletlink.social achieves a 22% average match rate, which is 9x higher than the industry average of 2.5%. This is possible by combining multiple data sources including ENS records, Farcaster verified addresses, and other onchain identity providers.',
      },
    },
    {
      '@type': 'Question',
      name: 'How much does walletlink.social cost?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'walletlink.social offers a free tier (500 wallets per lookup), Starter ($49 one-time for 10,000 wallets), Pro ($99 one-time for 10,000 wallets per lookup, contract import and full history), and Unlimited ($420 one-time for unlimited wallets forever). All paid plans are one-time payments, not subscriptions.',
      },
    },
    {
      '@type': 'Question',
      name: 'How is walletlink.social different from Addressable?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Unlike Addressable which requires sales calls and enterprise contracts, walletlink.social offers instant self-serve access. You can start for free immediately, with simple one-time pricing instead of monthly subscriptions. walletlink.social also includes Farcaster lookups which Addressable does not offer.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does walletlink.social support Farcaster?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, walletlink.social supports both Twitter/X and Farcaster lookups. It returns Farcaster usernames, follower counts, and FIDs (Farcaster IDs) which can be used for direct messaging via Warpcast or other Farcaster clients.',
      },
    },
    {
      '@type': 'Question',
      name: 'Which blockchains does walletlink.social support?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'walletlink.social supports Ethereum, Base, and Robinhood Chain. You can upload a wallet list from any of them, or import every holder of an NFT collection directly from its contract address. NFT holder import works on all three networks; ERC-20 token holder import is available on Ethereum and Base.',
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
