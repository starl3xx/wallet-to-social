/**
 * A second X account attested for the same wallet, where both accounts are
 * live.
 *
 * The index holds one X handle per wallet. When another source attests a
 * different handle for the same wallet, and both handles still reach someone,
 * there is no evidence for swapping them: the owner published both, at
 * different times, to different places. So the stored handle stays primary and
 * the other travels alongside it, because a list built to reach people should
 * carry both ways of reaching this one.
 *
 * `source` is the public evidence class from `lib/api-sources.ts`, never the
 * name of the service that attested it. Where the stored handle is dead and
 * the other is live the conflict is resolved instead, and this never appears.
 */
export interface TwitterAlso {
  handle: string;
  url: string;
  source: string;
}

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
  twitter_reachability?: 'live' | 'suspended' | 'unclaimed' | 'reassigned';
  /**
   * A second live X account attested for this wallet. Absent for nearly every
   * row; present only where the stored handle and another attested handle
   * both reach someone. See `TwitterAlso`.
   */
  twitter_also?: TwitterAlso;
  // Agent detection metadata
  is_agent?: boolean;
  agent_name?: string;
  agent_framework?: string;
  agent_type?: string;
  agent_token_symbol?: string;
  agent_verified?: boolean;
  // Farcaster bio (used for agent detection, not displayed)
  fc_bio?: string;
  // Preserved columns from original CSV. `TwitterAlso` is in the union only
  // because an index signature must admit every declared property, and
  // `twitter_also` is the one that is an object.
  [key: string]: string | number | boolean | string[] | TwitterAlso | undefined;
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
