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
  title: 'walletlink.social',
  description:
    'Find 𝕏/Twitter + Farcaster profiles from Ethereum wallet addresses',
  openGraph: {
    title: 'walletlink.social',
    description: 'Find 𝕏/Twitter + Farcaster profiles from Ethereum wallet addresses',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary',
    title: 'walletlink.social',
    description: 'Find 𝕏/Twitter + Farcaster profiles from Ethereum wallet addresses',
    images: ['/icon.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
