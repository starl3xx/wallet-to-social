/**
 * The X handles a result set can actually reach, each one once.
 *
 * ## Why this is a module and not a memo
 *
 * It was a memo inside `ExportButton`, and its own comment said the list it
 * produces is "for pasting into an X list". Now that building the list is a
 * feature rather than a manual step, two surfaces need exactly this array: the
 * handle export and the list builder. Two copies of this derivation would
 * disagree the first time either was adjusted, and they would disagree
 * silently, because the symptom is a list that is a few people short rather
 * than anything that looks broken.
 *
 * The repo already makes this argument about `resultCounts`, which is shared
 * with the stats cards and the share text so the figure on screen and the
 * figure posted cannot differ. Same reasoning, same fix.
 *
 * ## What it includes, and the three judgments in that
 *
 * **Deduplicated on the lowercased handle.** One person with several wallets is
 * several rows and one handle, which is the thing this index exists to reveal.
 * The first spelling encountered wins and row order is preserved, so whatever
 * sort the caller applied still governs who comes first.
 *
 * **Unchecked handles are included.** Only handles we have checked and found
 * unreachable are left out. Treating "never checked" as "dead" would quietly
 * shrink the list on no evidence, which is the absent-is-not-false rule this
 * codebase applies everywhere else.
 *
 * **A second attested handle goes in even when the primary does not.** A
 * primary marked `reassigned` is live and now belongs to a stranger, so it is
 * excluded; where the row also carries `twitter_also`, that handle is then the
 * only one on the row that reaches the owner. `twitter_also` is only ever set
 * where both were checked and found live, so it needs no test of its own.
 */
import type { WalletSocialResult } from './types';

export function reachableHandlesFrom(
  results: readonly WalletSocialResult[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (handle: string) => {
    const key = handle.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(handle);
  };

  for (const r of results) {
    const handle = r.twitter_handle;
    if (!handle) continue;
    const primaryReachable =
      !r.twitter_reachability || r.twitter_reachability === 'live';
    if (primaryReachable) add(handle);
    if (r.twitter_also) add(r.twitter_also.handle);
  }

  return out;
}
