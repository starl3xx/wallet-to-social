/**
 * How hard a lookup tries.
 *
 * This replaced two independent checkboxes, "Fast mode" and "ENS onchain
 * lookup", which asked the user to reason about the pipeline rather than about
 * what they wanted. The two were also not independent in practice: fast mode
 * skipped the slow sources, and ENS was the slowest source of all, so ticking
 * both asked for two opposite things and quietly resolved in favour of neither.
 *
 * One question with two answers replaces them, and the question is the real
 * trade: speed against coverage.
 *
 * The wire contract is unchanged. `fastMode` and `includeENS` are still what
 * `/api/jobs` receives, because the job queue, the cron refresh and the seed
 * collections all set them directly. Deriving both from one value here means
 * the interface cannot send a combination the pipeline does not understand.
 */
export type ScanDepth = 'fast' | 'deep';

export const SCAN_DEPTHS: Record<
  ScanDepth,
  {
    /** Control label, and the accessible name of the segment. */
    label: string;
    /** One line under the control, describing what the choice costs and buys. */
    blurb: string;
  }
> = {
  fast: {
    label: 'Fast',
    blurb:
      'Answers from our index only. Nothing is looked up live, so a list of any size comes back in seconds.',
  },
  deep: {
    label: 'Deep scan',
    blurb:
      'Our index plus every live source, including onchain ENS records. Slower, and finds the most.',
  },
};

/**
 * The job flags a depth resolves to.
 *
 * Tier still applies on top: the server drops ENS for an account that has not
 * paid for it, so a free user asking for a deep scan gets every source they are
 * entitled to rather than an error.
 */
export function scanDepthOptions(depth: ScanDepth): {
  fastMode: boolean;
  includeENS: boolean;
} {
  return { fastMode: depth === 'fast', includeENS: depth === 'deep' };
}
