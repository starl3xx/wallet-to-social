import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/ThemeProvider';
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
  title: 'Wallet to Twitter Lookup | Addressable Alternative | walletlink.social',
  description:
    'Turn wallet addresses into Twitter & Farcaster profiles instantly. No sales calls, no subscriptions. One-time payment starting at $149. Upload CSV, get socials.',
  keywords: [
    'addressable alternative',
    'wallet to twitter lookup',
    'ethereum wallet twitter',
    'wallet to social lookup',
    'farcaster wallet lookup',
    'crypto wallet social profiles',
    'web3 wallet to twitter',
    'ens to twitter',
    'token holder outreach',
  ],
  openGraph: {
    title: 'walletlink.social - Wallet to Social Lookup',
    description:
      'Find Twitter & Farcaster profiles from Ethereum wallet addresses. The simple alternative to Addressable. No subscriptions, instant access.',
    images: ['/icon.png'],
    type: 'website',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social - Wallet to Social Lookup',
    description:
      'Find Twitter & Farcaster profiles from Ethereum wallet addresses. The simple alternative to Addressable. No subscriptions, instant access.',
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
    'Turn wallet addresses into Twitter & Farcaster profiles. The simple alternative to Addressable.',
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      description: 'Up to 1,000 wallets',
    },
    {
      '@type': 'Offer',
      name: 'Pro',
      price: '149',
      priceCurrency: 'USD',
      description: 'Up to 10,000 wallets - one-time payment',
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
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
