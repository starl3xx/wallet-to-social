export interface WalletSocialResult {
  wallet: string;
  ens_name?: string;
  twitter_handle?: string;
  twitter_url?: string;
  farcaster?: string;
  farcaster_url?: string;
  fc_followers?: number;
  lens?: string;
  github?: string;
  source: string[];
  // Preserved columns from original CSV
  [key: string]: string | number | string[] | undefined;
}

export interface LookupProgress {
  total: number;
  processed: number;
  twitterFound: number;
  farcasterFound: number;
  status: 'idle' | 'processing' | 'complete' | 'error' | 'cancelled';
  message?: string;
}

export interface LookupStats {
  totalWallets: number;
  twitterFound: number;
  farcasterFound: number;
  lensFound: number;
  githubFound: number;
  uniqueSocials: number;
}
