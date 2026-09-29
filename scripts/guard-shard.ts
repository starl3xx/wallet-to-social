/**
 * Which mutations one CI shard of the invariants guard runs (Linear STA-53).
 *
 * The guard runs the whole of `check-invariants.ts` once per mutation, one
 * mutation at a time, so its time is the mutation count times one invariants
 * run: about 5 seconds each, and 880 mutations took 50 to 95 minutes on a
 * runner by September 2026, growing with every mutation added. CI now splits
 * the list across parallel jobs. A local run with no flag still runs all of
 * them.
 *
 * Its own module so `check-invariants.ts` can test the split without starting
 * the guard, which runs on import.
 */

export interface Shard {
  /** 0-based. */
  index: number;
  total: number;
}

/** No `--shard` flag: the whole list, as a local run has always done. */
export const WHOLE: Shard = { index: 0, total: 1 };

/**
 * `--shard=i/N` from the arguments, or WHOLE when there is none.
 *
 * Throws on anything malformed rather than guessing, because a guessed shard
 * is a silent subset: a typo that ran nothing would report every mutation
 * caught.
 */
export function parseShard(args: readonly string[]): Shard {
  const flags = args.filter((a) => a.startsWith('--shard'));
  if (flags.length === 0) return WHOLE;
  if (flags.length > 1) throw new Error('--shard was given more than once');
  const m = /^--shard=(\d+)\/(\d+)$/.exec(flags[0]);
  if (!m) {
    throw new Error(`--shard must look like --shard=0/8, not ${flags[0]}`);
  }
  const index = Number(m[1]);
  const total = Number(m[2]);
  if (total < 1 || index >= total) {
    throw new Error(
      `--shard=${index}/${total}: the index must be 0 to ${total - 1}`
    );
  }
  return { index, total };
}

/**
 * Round-robin rather than contiguous blocks. Neighbouring mutations are often
 * on the same file and cost about the same, so dealing them out one at a time
 * keeps the shards close in length.
 */
export function inShard(position: number, shard: Shard): boolean {
  return position % shard.total === shard.index;
}
