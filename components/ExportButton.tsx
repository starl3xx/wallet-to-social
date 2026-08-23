'use client';

import { memo, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { XMark } from '@/components/ui/brand-marks';
import { DownloadSimple, Lock } from '@phosphor-icons/react';
import { exportToCSV } from '@/lib/csv-parser';
import { Analytics } from '@/lib/client-analytics';
import type { WalletSocialResult } from '@/lib/types';
import { publicSources } from '@/lib/api-sources';

interface ExportButtonProps {
  results: WalletSocialResult[];
  extraColumns?: string[];
  disabled?: boolean;
  /**
   * Whether paid features are unlocked, decided by the caller.
   *
   * Was `userTier`, and reading entitlement off a tier stopped working the day
   * packs shipped: a pack purchase leaves `users.tier` as `free`, so this
   * component locked the X list export for someone who
   * had just paid for it.
   */
  entitled?: boolean;
  onUpgradeClick?: (source?: string) => void;
  lookupName?: string | null;
  /**
   * Called after a file is handed to the browser. The caller uses it to drop
   * its unsaved-results navigation guard: once the results exist as a file,
   * leaving the page destroys nothing.
   */
  onExported?: () => void;
}

export const ExportButton = memo(function ExportButton({
  results,
  extraColumns = [],
  disabled,
  entitled = false,
  onUpgradeClick,
  lookupName,
  onExported,
}: ExportButtonProps) {
  const isPaidTier = entitled;

  // Generate filename base from lookup name or default
  const getFilenameBase = (prefix: string) => {
    const date = new Date().toISOString().slice(0, 10);
    if (lookupName) {
      // Sanitize lookup name for filename: replace special chars, limit length
      const sanitized = lookupName
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase()
        .slice(0, 50);
      return `${sanitized}-${date}`;
    }
    return `${prefix}-${date}`;
  };

  // Memoize sorted results - only recalculate when results change
  const sortedResults = useMemo(
    () =>
      [...results].sort(
        (a, b) => (b.priority_score || 0) - (a.priority_score || 0)
      ),
    [results]
  );

  const handleExportCSV = () => {
    // Track export click
    Analytics.exportClicked('csv', results.length);

    const headers = [
      'wallet',
      'ens_name',
      'holdings',
      ...extraColumns.filter(
        (col) =>
          !col.toLowerCase().includes('value') &&
          !col.toLowerCase().includes('balance') &&
          !col.toLowerCase().includes('holdings')
      ),
      'twitter_handle',
      'twitter_url',
      // Blank where we have not checked. An empty cell is honest about not
      // knowing; writing "false" there would claim we looked and it failed.
      'twitter_reachable',
      // A second live X account attested for the wallet, where one exists.
      // Named like its siblings and like the API's `twitter.also`, so a file
      // and a response describe the same fact under the same name.
      'twitter_also',
      'farcaster',
      'farcaster_url',
      'fc_fid',
      'fc_followers',
      'priority_score',
      'lens',
      'github',
      'source',
      'is_agent',
      'agent_name',
      'agent_framework',
      'agent_token_symbol',
    ];

    const data = sortedResults.map((result) => ({
      ...result,
      holdings: result.holdings?.toFixed(2) || '',
      priority_score: result.priority_score?.toFixed(2) || '',
      // Evidence classes, never the internal pipeline identifiers. The export
      // is handed to the customer as a file, so it is the same disclosure
      // surface as an API response and gets the same treatment.
      source: (publicSources(result.source) ?? []).join(','),
      // 'true' / 'false' / '' for unchecked, and the word rather than a status
      // code because this cell is read by a person in a spreadsheet. The detail
      // of WHY it is unreachable lives in the API, not here.
      twitter_reachable: result.twitter_reachability
        ? result.twitter_reachability === 'live'
          ? 'true'
          : 'false'
        : '',
      // The handle alone. The URL is derivable and the evidence class is
      // already the `source` column's vocabulary; a spreadsheet cell wants
      // one value.
      twitter_also: result.twitter_also?.handle ?? '',
      is_agent: result.is_agent ? 'true' : '',
      agent_name: result.agent_name || '',
      agent_framework: result.agent_framework || '',
      agent_token_symbol: result.agent_token_symbol || '',
    }));

    const csv = exportToCSV(data, headers);

    // Create and trigger download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${getFilenameBase('walletlink-export')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onExported?.();
  };

  /**
   * The handles this export will actually contain: reachable, and each one once.
   *
   * One person with several wallets is several rows and one handle, which is
   * the thing this index exists to reveal, so a per-row list repeated them. The
   * file is for pasting into an X list, where a repeat is at best noise.
   *
   * Deduped on the lowercased handle because X handles are case-insensitive and
   * our sources do not agree on casing; the first spelling encountered is the
   * one exported, and row order is preserved so the priority sort still governs
   * who appears first.
   *
   * The button's count is derived from this same array rather than counted
   * separately. It used to be rows-with-handles minus rows-unreachable, which
   * after deduping would have promised more handles than the file delivers.
   *
   * A row's second attested handle (`twitter_also`) goes in too, after the
   * primary so the priority order still holds. This list exists to reach
   * people, and that handle is a second way of reaching the same one. It is
   * only ever present where it was checked and found live, so it needs no
   * reachability test here, and it goes in even when the primary is left out:
   * a primary marked `reassigned` is live but now a stranger's, and the
   * second handle is then the only one on the row that reaches the owner.
   */
  const reachableHandles = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (handle: string) => {
      const key = handle.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(handle);
    };
    for (const r of sortedResults) {
      const handle = r.twitter_handle;
      if (!handle) continue;
      const primaryReachable =
        !r.twitter_reachability || r.twitter_reachability === 'live';
      if (primaryReachable) add(handle);
      if (r.twitter_also) add(r.twitter_also.handle);
    }
    return out;
  }, [sortedResults]);

  /**
   * The handle list is the one that gets acted on.
   *
   * A CSV is read; this file is pasted into an outreach tool. So handles we have
   * checked and found unreachable are left out of it. Around a third of attested
   * Farcaster X handles reach nobody, and a suspended account wastes a send
   * while a freed handle may now belong to a stranger, which is worse.
   *
   * Only handles we have actually checked are excluded. An unchecked handle
   * still goes in the file: we have no reason to withhold it, and treating "not
   * checked" as "dead" would quietly shrink the list on no evidence.
   */
  const handleExportTwitterList = () => {
    const twitterHandles = reachableHandles.map((h) => `@${h}`);

    // Defensive only: the button is disabled when there is nothing to export.
    if (twitterHandles.length === 0) return;

    // Track export click
    Analytics.exportClicked('twitter', twitterHandles.length);

    // Create text file with one handle per line
    const content = twitterHandles.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${getFilenameBase('twitter-handles')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onExported?.();
  };

  /**
   * Distinct handles left out, counted the same way as the ones going in.
   *
   * Counting rows here while counting handles above would put two different
   * units in one sentence: "export 40 handles, 12 left out" where the 12 are
   * rows is simply a different measurement, and several of those rows can be
   * one person's dead handle held across several wallets.
   */
  const unreachableCount = useMemo(() => {
    /**
     * Left out means left out of THIS file, so the exported set decides.
     *
     * One handle can appear on several wallets and disagree with itself: live
     * on one row, dead on another. Counting the two sets independently put such
     * a handle in both, and the tooltip then reported it as going in and being
     * left out at once. Any row saying it reaches somebody is enough to export
     * it, so it is not left out.
     */
    const exported = new Set(reachableHandles.map((h) => h.toLowerCase()));
    const dead = new Set<string>();
    for (const r of results) {
      if (!r.twitter_handle) continue;
      if (!r.twitter_reachability || r.twitter_reachability === 'live')
        continue;
      const key = r.twitter_handle.toLowerCase();
      if (exported.has(key)) continue;
      dead.add(key);
    }
    return dead.size;
  }, [results, reachableHandles]);

  const reachableCount = reachableHandles.length;

  return (
    <div className="flex gap-2">
      {/* The two states of the list button differ only in the leading icon and
          the count. Both say "X": the platform is named one way everywhere in
          the product, and the mark is `XMark`, never the U+1D54F character, which
          Söhne does not carry. Icons carry no margin of their own; the Button's
          `gap-2` owns the distance, as it does for every other button. */}
      {isPaidTier ? (
        <Button
          variant="outline"
          onClick={handleExportTwitterList}
          disabled={disabled || reachableCount === 0}
          title={
            unreachableCount > 0
              ? `Export ${reachableCount} reachable handles. ${unreachableCount} left out: the owner attested them and they no longer reach anyone.`
              : `Export ${reachableCount} X handles`
          }
        >
          <XMark className="h-4 w-4" />
          {/* The reachable count, not the total: the button exports that many.
              A label counting handles it deliberately leaves out is a label
              that quietly disagrees with the file it produces. */}
          Export X list ({reachableCount})
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() => onUpgradeClick?.('export-x')}
          title="Buy credits to export the X list"
        >
          <Lock className="h-4 w-4" aria-hidden />
          Export X list
        </Button>
      )}
      <Button
        onClick={handleExportCSV}
        disabled={disabled || results.length === 0}
      >
        <DownloadSimple className="h-4 w-4" aria-hidden />
        Export CSV
      </Button>
    </div>
  );
});
