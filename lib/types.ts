export interface WalletSocialResult {
  wallet: string;
  ens_name?: string;
  twitter_handle?: string;
  twitter_url?: string;
  farcaster?: string;
  farcaster_url?: string;
  fc_followers?: number;
  fc_fid?: number;
  holdings?: number;
  priority_score?: number;
  lens?: string;
  github?: string;
  source: string[];
  // Agent detection metadata
  is_agent?: boolean;
  agent_name?: string;
  agent_framework?: string;
  agent_type?: string;
  agent_token_symbol?: string;
  agent_verified?: boolean;
  // Farcaster bio (used for agent detection, not displayed)
  fc_bio?: string;
  // Preserved columns from original CSV
  [key: string]: string | number | boolean | string[] | undefined;
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
