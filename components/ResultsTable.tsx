'use client';

import { useState, useMemo, useCallback, memo, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, Lock, WarningCircle } from '@phosphor-icons/react';
import type { WalletSocialResult } from '@/lib/types';
import {
  REACHABILITY_LABEL,
  REACHABILITY_DETAIL,
} from '@/lib/handle-reachability';

type Attestation = 'attested' | 'matched' | 'none' | 'unknown';

/**
 * Three real states plus an unknown, because collapsing them lies in one
 * direction or the other.
 *
 * - `attested`  at least one identity the owner published themselves.
 * - `matched`   identities exist, none of them owner-attested.
 * - `none`      no identity at all. Gets no mark: a hollow dot here would
 *               describe an empty row as an index match.
 * - `unknown`   the row never touched the social graph, so verification is
 *               absent rather than false. Also gets no mark, for the same
 *               reason: absence of evidence is not evidence of absence.
 */
function attestationOf(r: WalletSocialResult): Attestation {
  const hasIdentity = !!(
    r.twitter_handle ||
    r.farcaster ||
    r.ens_name ||
    r.lens ||
    r.github
  );
  if (!hasIdentity) return 'none';

  if (r.twitter_verified === true || r.farcaster_verified === true)
    return 'attested';

  // An explicit false on either flag means the graph was consulted and said no.
  // Both undefined means nobody ever asked.
  const wasChecked =
    r.twitter_verified !== undefined || r.farcaster_verified !== undefined;
  return wasChecked ? 'matched' : 'unknown';
}

/**
 * The handle, and whether it still reaches anyone.
 *
 * Reachability is a SEPARATE axis from the gutter dot beside it. The dot says
 * how the identity was established; this says whether it still works. A handle
 * can be perfectly attested and completely dead, which is exactly the case worth
 * showing, and folding the two into one mark would destroy the distinction the
 * product is sold on.
 *
 * An unreachable handle is not a link. A suspended account goes to a suspension
 * notice, and a freed handle may now belong to somebody else entirely, so the
 * one thing a click must not do is present a stranger as the wallet's owner.
 */
const TwitterCell = memo(function TwitterCell({
  result,
}: {
  result: WalletSocialResult;
}) {
  const handle = result.twitter_handle!;
  const reach = result.twitter_reachability;

  if (reach && reach !== 'live') {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-caution"
        title={REACHABILITY_DETAIL[reach]}
      >
        <WarningCircle className="h-3 w-3" weight="fill" aria-hidden />
        <span className="line-through decoration-caution/50">@{handle}</span>
        <span className="sr-only">{REACHABILITY_LABEL[reach]}</span>
      </span>
    );
  }

  return (
    <a
      href={result.twitter_url || `https://x.com/${handle}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-brand hover:underline"
      title={reach === 'live' ? REACHABILITY_DETAIL.live : undefined}
    >
      @{handle}
    </a>
  );
});

/**
 * Custom hook for debouncing a value
 * Prevents expensive operations (like filtering 10K rows) on every keystroke
 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

interface ResultsTableProps {
  results: WalletSocialResult[];
  extraColumns?: string[];
  /**
   * Whether paid features are unlocked, decided by the caller.
   *
   * Was `userTier`, and reading entitlement off a tier stopped working the day
   * packs shipped: a pack purchase leaves `users.tier` as `free`, so this
   * component locked FC followers and priority score for someone who
   * had just paid for it.
   */
  entitled?: boolean;
  onUpgradeClick?: () => void;
  enrichedWallets?: Set<string>; // Wallets that have been enriched since last view
  /**
   * Header for the holdings column.
   *
   * "Holdings" is right for an uploaded CSV, where the column may hold a USD
   * value or anything else the customer chose. A contract import is always a
   * token balance or an item count, so it says "Bag". Same column, same sort,
   * same priority score; only the word changes, because only the word can be
   * wrong.
   */
  holdingsLabel?: string;
}

type SortField =
  | 'wallet'
  | 'twitter_handle'
  | 'farcaster'
  | 'fc_followers'
  | 'ens_name'
  | 'holdings'
  | 'priority_score';
type SortDirection = 'asc' | 'desc';

const ROW_HEIGHT = 44; // Fixed row height for virtualization

/**
 * The header's height, fixed for the same reason the rows' is. The header
 * scrolls inside the same container as the rows, stuck to its top, so the
 * virtualiser has to be told how far down the list starts (`scrollMargin`),
 * and that number has to be the one the header actually renders at. It is
 * `--h-ctl`: every cell in it is a sort button, and a control in a row
 * resolves to that height. A height derived from padding would drift the day
 * the label size changed, and every row would land a few pixels off.
 */
const HEADER_HEIGHT = 34;

/** The attestation gutter: one dot wide. Also the wallet column's sticky offset. */
const GUTTER_WIDTH = 18;

/**
 * Row fills, opaque. They were `/30` tints over a transparent row, which is
 * the same colour on the page, but the gutter and wallet cells now pin to the
 * left edge and inherit the row's fill to mask the columns sliding beneath
 * them. A translucent fill lets those columns show through the pinned cells,
 * so each tint is composited on the page here instead. Hover is `hover:`, not
 * a class toggled in JS, so touch devices never latch it.
 */
const ROW_FILL =
  'bg-background hover:bg-[color-mix(in_oklab,var(--muted)_30%,var(--background))]';
const ROW_FILL_ENRICHED =
  'bg-[color-mix(in_oklab,var(--accent-brand-tint)_30%,var(--background))] hover:bg-accent-brand-tint dark:hover:bg-[color-mix(in_oklab,var(--accent-brand-tint)_50%,var(--background))]';

/**
 * A sortable column header. The cell carries the ARIA sort state, and a real
 * button inside it carries the click: these were divs with `onClick`, which a
 * mouse could use and nothing else could. No tab stop, no Enter or Space, no
 * `aria-sort`. The button fills the cell so the whole header stays the target.
 * Its focus ring is inset because the header sits flush against the frame's
 * top edge, where an outer ring would be clipped by the scroller.
 *
 * `uppercase` is inherited from the header row, which is where `font-mono`
 * sits too; the pair stays together there.
 */
function SortHeader({
  field,
  label,
  title,
  sortField,
  sortDirection,
  onSort,
  className,
  style,
}: {
  field: SortField;
  label: string;
  title?: string;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const isSorted = sortField === field;
  const Arrow = sortDirection === 'asc' ? ArrowUp : ArrowDown;
  return (
    <div
      role="columnheader"
      aria-sort={
        isSorted
          ? sortDirection === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
      className={className}
      style={style}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        title={title}
        className="transition-control flex h-full w-full items-center gap-1 px-4 text-left outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-accent-brand/50"
      >
        {label}
        {isSorted && <Arrow className="h-3 w-3" aria-hidden />}
      </button>
    </div>
  );
}

export const ResultsTable = memo(function ResultsTable({
  results,
  extraColumns = [],
  entitled = false,
  onUpgradeClick,
  enrichedWallets,
  holdingsLabel = 'Holdings',
}: ResultsTableProps) {
  const isPaidTier = entitled;
  const [search, setSearch] = useState('');
  // Debounce search to prevent re-filtering on every keystroke (300ms delay)
  const debouncedSearch = useDebouncedValue(search, 300);
  const [showOnlyTwitter, setShowOnlyTwitter] = useState(false);
  const [showTopInfluencers, setShowTopInfluencers] = useState(false);
  const [showOnlyAgents, setShowOnlyAgents] = useState(false);
  const [sortField, setSortField] = useState<SortField>('priority_score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);

  // Check if any results have holdings data
  const hasHoldings = useMemo(
    () => results.some((r) => r.holdings !== undefined && r.holdings > 0),
    [results]
  );

  // Filter extra columns once
  const filteredExtraColumns = useMemo(
    () =>
      extraColumns.filter(
        (col) =>
          !col.toLowerCase().includes('value') &&
          !col.toLowerCase().includes('balance') &&
          !col.toLowerCase().includes('holdings') &&
          // Same reason as the three above: this one is rendered as the
          // holdings column, so listing it again as an extra column would
          // print every bag twice.
          !col.toLowerCase().includes('bag')
      ),
    [extraColumns]
  );

  const filteredAndSorted = useMemo(() => {
    let filtered = results;

    // Apply Twitter filter
    if (showOnlyTwitter) {
      filtered = filtered.filter((r) => r.twitter_handle);
    }

    // Apply Top Influencers filter (1K+ FC followers)
    if (showTopInfluencers) {
      filtered = filtered.filter(
        (r) => r.fc_followers !== undefined && r.fc_followers >= 1000
      );
    }

    // Apply Agents only filter
    if (showOnlyAgents) {
      filtered = filtered.filter((r) => r.is_agent === true);
    }

    // Apply search filter (using debounced value to prevent lag on every keystroke)
    if (debouncedSearch) {
      const searchLower = debouncedSearch.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.wallet.toLowerCase().includes(searchLower) ||
          r.ens_name?.toLowerCase().includes(searchLower) ||
          r.twitter_handle?.toLowerCase().includes(searchLower) ||
          r.farcaster?.toLowerCase().includes(searchLower)
      );
    }

    // Apply sorting
    filtered = [...filtered].sort((a, b) => {
      let aVal: string | number | undefined;
      let bVal: string | number | undefined;

      switch (sortField) {
        case 'fc_followers':
          aVal = a.fc_followers ?? 0;
          bVal = b.fc_followers ?? 0;
          break;
        case 'holdings':
          aVal = a.holdings ?? 0;
          bVal = b.holdings ?? 0;
          break;
        case 'priority_score':
          aVal = a.priority_score ?? 0;
          bVal = b.priority_score ?? 0;
          break;
        default:
          aVal = a[sortField] as string | undefined;
          bVal = b[sortField] as string | undefined;
      }

      if (aVal === undefined && bVal === undefined) return 0;
      if (aVal === undefined) return 1;
      if (bVal === undefined) return -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const comparison = String(aVal).localeCompare(String(bVal));
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [
    results,
    debouncedSearch,
    showOnlyTwitter,
    showTopInfluencers,
    showOnlyAgents,
    sortField,
    sortDirection,
  ]);

  // Virtualizer for efficient rendering of large lists
  const virtualizer = useVirtualizer({
    count: filteredAndSorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10, // Render 10 extra rows above/below viewport
    // The header is in the scroll content, above the list, so row offsets
    // start this far down. `start` includes it; the transform subtracts it.
    scrollMargin: HEADER_HEIGHT,
  });

  const handleSort = useCallback((field: SortField) => {
    setSortField((currentField) => {
      if (currentField === field) {
        setSortDirection((dir) => (dir === 'asc' ? 'desc' : 'asc'));
        return field;
      }
      // Default to descending for numeric fields
      if (
        field === 'fc_followers' ||
        field === 'holdings' ||
        field === 'priority_score'
      ) {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
      return field;
    });
  }, []);

  const truncateWallet = (wallet: string) => {
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  };

  const formatHoldings = (value: number | undefined) => {
    if (value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPriorityScore = (value: number | undefined) => {
    if (value === undefined || value === 0) return '-';
    return value.toFixed(1);
  };

  // Memoize max score calculation
  const maxScore = useMemo(
    () => Math.max(...results.map((r) => r.priority_score || 0), 1),
    [results]
  );

  const getPriorityLevel = useCallback(
    (score: number | undefined): number => {
      if (score === undefined || score === 0) return 0;
      const normalizedScore = score / maxScore;
      if (normalizedScore >= 0.8) return 5;
      if (normalizedScore >= 0.6) return 4;
      if (normalizedScore >= 0.4) return 3;
      if (normalizedScore >= 0.2) return 2;
      return 1;
    },
    [maxScore]
  );

  const PriorityIndicator = memo(function PriorityIndicator({
    score,
  }: {
    score: number | undefined;
  }) {
    const level = getPriorityLevel(score);
    if (level === 0) return <span className="text-muted-foreground">-</span>;

    return (
      <div
        className="flex items-center gap-0.5 cursor-help"
        title={`Priority: ${formatPriorityScore(score)} (Based on holdings × follower reach)`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`w-1 h-3 rounded-sm ${
              i < level ? 'bg-accent-brand' : 'bg-muted'
            }`}
          />
        ))}
        <span className="ml-2 text-xs text-muted-foreground">
          {formatPriorityScore(score)}
        </span>
      </div>
    );
  });

  const handleCopyWallet = useCallback(async (wallet: string) => {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopiedWallet(wallet);
      setTimeout(() => setCopiedWallet(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  /**
   * Minimum track widths, in px, in column order. The grid template and the
   * grid's own `min-width` both come from this list, so the grid can never be
   * narrower than the tracks it declares. A grid narrower than its tracks
   * overflows its box without widening it, which is how the phone view clipped
   * four columns behind an `overflow-hidden` frame and offered no scrollbar.
   * With a real width the frame gets a real `scrollWidth` instead.
   */
  const { gridTemplate, gridMinWidth, columnCount } = useMemo(() => {
    const tracks = [
      GUTTER_WIDTH, // attestation gutter
      120, // wallet
      100, // ENS
      ...(hasHoldings ? [100] : []),
      ...filteredExtraColumns.map(() => 80),
      120, // Twitter
      120, // Farcaster
      100, // FC followers
      140, // priority
    ];
    return {
      gridTemplate: tracks
        .map((min, i) => (i === 0 ? `${min}px` : `minmax(${min}px, 1fr)`))
        .join(' '),
      gridMinWidth: tracks.reduce((sum, min) => sum + min, 0),
      columnCount: tracks.length,
    };
  }, [hasHoldings, filteredExtraColumns]);

  const isEmpty = filteredAndSorted.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder="Search wallet, ENS, or handle..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button
          variant={showOnlyTwitter ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowOnlyTwitter(!showOnlyTwitter)}
        >
          {showOnlyTwitter ? 'Showing Twitter only' : 'Show only with Twitter'}
        </Button>
        <Button
          variant={showTopInfluencers ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowTopInfluencers(!showTopInfluencers)}
        >
          {showTopInfluencers ? 'Top influencers (1K+)' : 'Top influencers'}
        </Button>
        {results.some((r) => r.is_agent) && (
          <Button
            variant={showOnlyAgents ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowOnlyAgents(!showOnlyAgents)}
          >
            {showOnlyAgents ? 'Showing agents only' : 'Agents only'}
          </Button>
        )}
        <span className="text-sm text-muted-foreground">
          {filteredAndSorted.length.toLocaleString()} results
        </span>
      </div>

      {/* One template, used by the header and every row. It was duplicated,
          which is how a grid drifts: change one and the columns silently stop
          lining up.

          The leading 18px is the attestation gutter. It reads the
          twitter_verified / farcaster_verified flags, never `source`: that
          field holds pipeline stage markers like 'graph' and 'cache' on the
          forward path, so deriving provenance from it reported owner-attested
          identities as unattested. */}

      {/* One scroll container, both axes. This is the product's one genuine
          data table, which is the only place the design language allows a
          sideways scroll: its rows are virtualised at a fixed height, so a
          stacked reflow would need variable heights and a second table, and
          the reflowed form of this data already exists as the CSV.

          The header lives inside the scroller, stuck to its top, so it pans
          with the rows: a header outside the scroller keeps its columns
          where they were while the rows move under it. The virtualiser
          measures this element, so it has to be the one that scrolls
          vertically. Its height caps at the header plus 600px of rows. */}
      <div
        ref={parentRef}
        className="overflow-auto rounded-lg border border-border"
        style={{ maxHeight: HEADER_HEIGHT + 600 }}
      >
        <div
          role="table"
          aria-rowcount={filteredAndSorted.length + 1}
          aria-colcount={columnCount}
          style={{ minWidth: gridMinWidth }}
        >
          {/* Header */}
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-20 grid border-b border-border bg-background font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground"
            style={{
              gridTemplateColumns: gridTemplate,
              height: HEADER_HEIGHT,
            }}
          >
            {/* Attestation gutter. Empty on screen: the column is a legend for
                the rows, and a label here would crowd 18px. A screen reader
                still needs the column named, so the name is visually hidden.
                Pinned to the left edge with the wallet beside it, so a row
                keeps its identity while the identities scroll. */}
            <div role="columnheader" className="sticky left-0 z-10 bg-inherit">
              <span className="sr-only">Attested</span>
            </div>
            <SortHeader
              field="wallet"
              label="Wallet"
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              className="sticky z-10 bg-inherit"
              style={{ left: GUTTER_WIDTH }}
            />
            <SortHeader
              field="ens_name"
              label="ENS"
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
            {hasHoldings && (
              <SortHeader
                field="holdings"
                label={holdingsLabel}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
            )}
            {filteredExtraColumns.map((col) => (
              <div
                key={col}
                role="columnheader"
                className="flex items-center px-4"
              >
                {/* A CSV header is customer data with no length bound, and
                    this row has a fixed height it must not change. */}
                <span className="truncate">{col}</span>
              </div>
            ))}
            <SortHeader
              field="twitter_handle"
              label="Twitter"
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
            <SortHeader
              field="farcaster"
              label="Farcaster"
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
            <SortHeader
              field="fc_followers"
              label="FC Followers"
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
            <SortHeader
              field="priority_score"
              label="Priority"
              title="Based on holdings × follower reach"
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
          </div>

          {/* Virtualized body */}
          {isEmpty ? (
            <div role="row" aria-rowindex={2}>
              <div
                role="cell"
                aria-colspan={columnCount}
                className="py-8 text-center text-muted-foreground"
              >
                No results found
              </div>
            </div>
          ) : (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const result = filteredAndSorted[virtualRow.index];
                const isEnriched = enrichedWallets?.has(
                  result.wallet.toLowerCase()
                );
                return (
                  <div
                    key={result.wallet}
                    role="row"
                    aria-rowindex={virtualRow.index + 2}
                    /* `transition-[background-color]`, not `transition-control`:
                       that utility also transitions `transform`, and a virtualised
                       row is positioned by one, so a re-sort would slide every row
                       to its new place. Background colour is the only thing a
                       virtualised row may animate. */
                    className={`absolute top-0 left-0 grid w-full items-center border-b border-border transition-[background-color] ${
                      isEnriched ? ROW_FILL_ENRICHED : ROW_FILL
                    }`}
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start - HEADER_HEIGHT}px)`,
                      gridTemplateColumns: gridTemplate,
                    }}
                  >
                    {/* Attestation gutter. Filled means the owner published at
                        least one of these identities; hollow means they were
                        matched. Rows with no identity, and rows the graph never
                        saw, get nothing rather than a mark that would overstate
                        what is known. The title carries the same fact in words,
                        so nothing depends on distinguishing two colours. */}
                    {/* Centred, not pinned with a top padding.
                        `pt-3` aligned the dot with the address at exactly one
                        row height and drifted at any other, because every other
                        cell is centred by the row's own `items-center` while
                        this one measured from the top edge. */}
                    {/* The gutter and the wallet are sticky on the left, and
                        `self-stretch` so their inherited fill covers the whole
                        row height: a cell sized to its content would mask only
                        an 8px strip of the columns sliding beneath it. */}
                    <div
                      role="cell"
                      className="sticky left-0 z-10 flex items-center justify-center self-stretch bg-inherit"
                    >
                      {(() => {
                        const state = attestationOf(result);
                        if (state === 'attested') {
                          return (
                            <span
                              className="h-2 w-2 rounded-full bg-attested"
                              title="Owner-attested: this identity was published by the address owner"
                            />
                          );
                        }
                        if (state === 'matched') {
                          return (
                            <span
                              className="h-2 w-2 rounded-full ring-1 ring-inset ring-border"
                              title="Matched from the index, not owner-attested"
                            />
                          );
                        }
                        return null;
                      })()}
                    </div>

                    {/* Wallet */}
                    <div
                      role="cell"
                      className="sticky z-10 flex items-center self-stretch bg-inherit px-4 font-mono text-xs"
                      style={{ left: GUTTER_WIDTH }}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          className="relative hover:text-accent-brand cursor-pointer transition-colors"
                          onClick={() => handleCopyWallet(result.wallet)}
                          title={`${result.wallet}\nClick to copy`}
                        >
                          {truncateWallet(result.wallet)}
                          {copiedWallet === result.wallet && (
                            /* bg-foreground/text-background, not bg-black/text-white. The
                               dark theme's background is itself near-black, so a literally
                               black toast on it had no edge at all. */
                            <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-foreground text-background text-xs px-2 py-1 rounded-sm whitespace-nowrap z-10">
                              Copied!
                            </span>
                          )}
                        </button>
                        {result.is_agent && (
                          <span
                            /* One meaning, one colour: "agent" is a single fact, and the
                               five framework branches this replaces resolved to three
                               colours with three of them identical. Capped and truncated
                               because agent_name is third-party data with no length bound,
                               and this row has a fixed 44px height it must not change. */
                            className="shrink-0 max-w-[12ch] truncate whitespace-nowrap rounded-sm bg-accent-brand-tint px-1.5 py-0.5 text-xs font-medium text-accent-brand"
                            title={[
                              result.agent_name,
                              result.agent_framework &&
                                `Framework: ${result.agent_framework}`,
                              result.agent_type && `Type: ${result.agent_type}`,
                              result.agent_token_symbol,
                            ]
                              .filter(Boolean)
                              .join(' | ')}
                          >
                            {result.agent_name || 'Agent'}
                          </span>
                        )}
                        {isEnriched && (
                          <span className="px-1.5 py-0.5 text-xs font-medium rounded-sm bg-accent-brand text-accent-brand-foreground">
                            NEW
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ENS */}
                    <div
                      role="cell"
                      className="px-4 py-2 font-mono text-xs truncate"
                    >
                      {result.ens_name || '-'}
                    </div>

                    {/* Holdings */}
                    {hasHoldings && (
                      <div
                        role="cell"
                        className="px-4 py-2 font-mono text-xs tabular-nums"
                      >
                        {formatHoldings(result.holdings)}
                      </div>
                    )}

                    {/* Extra columns */}
                    {filteredExtraColumns.map((col) => (
                      <div
                        key={col}
                        role="cell"
                        className="px-4 py-2 text-sm truncate"
                      >
                        {(result[col] as string) || '-'}
                      </div>
                    ))}

                    {/* Twitter */}
                    <div role="cell" className="px-4 py-2 font-mono text-xs">
                      {result.twitter_handle ? (
                        <TwitterCell result={result} />
                      ) : (
                        '-'
                      )}
                    </div>

                    {/* Farcaster */}
                    <div role="cell" className="px-4 py-2 font-mono text-xs">
                      {result.farcaster ? (
                        <a
                          href={
                            result.farcaster_url ||
                            `https://warpcast.com/${result.farcaster}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-brand hover:underline"
                        >
                          @{result.farcaster}
                        </a>
                      ) : (
                        '-'
                      )}
                    </div>

                    {/* FC Followers */}
                    {/* tabular-nums, not font-mono: a follower count is a figure to
                        compare down a column, not an identifier to read. Söhne's
                        tnum substitutes .lt glyphs at a uniform 608 units, so the
                        digits align without changing face. */}
                    <div role="cell" className="px-4 py-2 text-sm tabular-nums">
                      {isPaidTier ? (
                        result.fc_followers !== undefined ? (
                          result.fc_followers.toLocaleString()
                        ) : (
                          '-'
                        )
                      ) : (
                        <button
                          onClick={onUpgradeClick}
                          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                          title="Buy credits to see FC followers"
                        >
                          <Lock className="h-3 w-3" />
                          <span className="text-xs">Locked</span>
                        </button>
                      )}
                    </div>

                    {/* Priority */}
                    <div role="cell" className="px-4 py-2 text-sm">
                      {isPaidTier ? (
                        <PriorityIndicator score={result.priority_score} />
                      ) : (
                        <button
                          onClick={onUpgradeClick}
                          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                          title="Buy credits to see priority score"
                        >
                          <Lock className="h-3 w-3" />
                          <span className="text-xs">Locked</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
