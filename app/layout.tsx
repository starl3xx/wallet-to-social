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
  title: 'walletlink.social — Find your DeFi users & NFT holders on Twitter',
  description:
    'Find your DeFi users and NFT holders on Twitter. Turn wallet addresses into social profiles for token holder outreach, airdrop campaigns, and DAO engagement. No sales calls—instant access.',
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
  ],
  openGraph: {
    title: 'walletlink.social — Find your DeFi users & NFT holders on Twitter',
    description:
      'Find your DeFi users and NFT holders on Twitter. Wallet-to-social lookup for token holder outreach, airdrop campaigns, and community engagement. No sales calls.',
    images: ['/icon.png'],
    type: 'website',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social — Find your DeFi users & NFT holders on Twitter',
    description:
      'Find your DeFi users and NFT holders on Twitter. Wallet-to-social lookup for token holder outreach, airdrop campaigns, and community engagement.',
    images: ['/icon.png'],
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
    'Find your DeFi users and NFT holders on Twitter. Wallet-to-social lookup tool for token holder outreach, airdrop campaigns, and DAO engagement.',
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
      price: '149',
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
        text: 'walletlink.social offers a free tier (1,000 wallets), Starter ($49 one-time for 10,000 wallets), Pro ($149 one-time for 10,000 wallets per lookup with history), and Unlimited ($420 one-time for unlimited wallets forever). All paid plans are one-time payments, not subscriptions.',
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
