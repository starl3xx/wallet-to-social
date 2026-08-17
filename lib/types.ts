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
  /**
   * Whether each identity was attested by the address owner rather than
   * correlated from an index.
   *
   * `undefined` is a third state and means "not known on this path", not
   * "false". Rows resolved without touching the social graph carry no
   * verification information at all, and rendering that as unattested would be
   * a claim the record does not make. Anything reading these must distinguish
   * absent from false.
   */
  twitter_verified?: boolean;
  farcaster_verified?: boolean;
  /**
   * Whether the attested X handle still reaches anyone: 'live', 'suspended' or
   * 'unclaimed'.
   *
   * Undefined follows the same rule as the flags above: it means "not checked",
   * not "unreachable". Roughly a third of attested Farcaster X handles reach
   * nobody, and this is the only field that says so.
   */
  twitter_reachability?: 'live' | 'suspended' | 'unclaimed';
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
