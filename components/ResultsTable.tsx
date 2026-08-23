'use client';

import { useState, useMemo, useCallback, memo, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, Lock, WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
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
 *
 * A row can carry a second attested handle beneath the first, where both
 * reach someone (`twitter_also`). It is a fact about the wallet, not a
 * control: muted mono, no badge, no link, and the title says what it means.
 * The stored handle stays primary because nothing in the data prefers one
 * over the other, and a second link in the cell would suggest that it does.
 */
const TwitterCell = memo(function TwitterCell({
  result,
}: {
  result: WalletSocialResult;
}) {
  const handle = result.twitter_handle!;
  const reach = result.twitter_reachability;
  const also = result.twitter_also;

  const primary =
    reach && reach !== 'live' ? (
      <span
        className="inline-flex items-center gap-1.5 text-caution"
        title={REACHABILITY_DETAIL[reach]}
      >
        <WarningCircle className="h-3 w-3" weight="fill" aria-hidden />
        <span className="line-through decoration-caution/50">@{handle}</span>
        <span className="sr-only">{REACHABILITY_LABEL[reach]}</span>
      </span>
    ) : (
      /* The link variant at inline size: the one treatment for a text link in
         a cell. The face comes from the cell, since `cn` lets `font-mono
         text-xs` beat the variant's base. */
      <Button
        asChild
        variant="link"
        size="inline"
        className="font-mono text-xs"
      >
        <a
          href={result.twitter_url || `https://x.com/${handle}`}
          target="_blank"
          rel="noopener noreferrer"
          title={reach === 'live' ? REACHABILITY_DETAIL.live : undefined}
        >
          @{handle}
        </a>
      </Button>
    );

  if (!also) return primary;

  /* Two 12px lines at their own 16px leading is 32px, inside the 44px row.
     The second line truncates and carries its full text in the title, since a
     handle is third-party data and the row's height is fixed. */
  return (
    <span className="flex min-w-0 flex-col items-start">
      {primary}
      <span
        className="truncate text-muted-foreground"
        title="A second X account attested by the wallet owner; both reach someone"
      >
        also @{also.handle}
      </span>
    </span>
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
  onUpgradeClick?: (source?: string) => void;
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
 * The one empty-cell mark, an en dash. Every empty cell renders this constant:
 * the grid shipped an en dash in locked cells beside a hyphen everywhere else,
 * two empty-state marks in one table.
 */
const EMPTY_CELL = '–';

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
 * A filter toggle that is on: the outline button with the brand edge, the
 * tint fill and the brand text, which is the segmented control's selected
 * treatment and the Rename pill's resting one. Hover stays on the tint, since
 * hover changes colour only and the outline's own `hover:bg-accent` would
 * have flashed a selected pill grey. `cn` merges these over the variant's.
 */
const FILTER_ON =
  'border-accent-brand bg-accent-brand-tint text-accent-brand hover:bg-accent-brand-tint hover:text-accent-brand dark:bg-accent-brand-tint dark:hover:bg-accent-brand-tint';

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
      {/* The label face is restated on the button: Tailwind's preflight sets
          text-transform: none on every button, so the header row's transform
          does not reach it. */}
      <button
        type="button"
        onClick={() => onSort(field)}
        title={title}
        className="transition-control flex h-full w-full items-center gap-1 px-4 text-left font-mono uppercase tracking-[var(--tracking-label)] outline-none hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {label}
        {/* One arrow, always mounted while sorted, rotating between the two
            directions: a selected state moves, it does not teleport. The rows
            beneath stay instant, so this is the one place a sort change shows. */}
        {isSorted && (
          <ArrowUp
            className={cn(
              'sort-arrow h-3 w-3',
              sortDirection === 'desc' && 'rotate-180'
            )}
            aria-hidden
          />
        )}
      </button>
    </div>
  );
}

/**
 * The header of a column the account has not paid for, and that column's one
 * upgrade affordance.
 *
 * Every cell beneath it used to carry its own muted "Locked" button: sixteen
 * identical upgrade controls on one screen, each painted in the colour of text
 * you cannot act on, each discoverable only by hovering. One control per
 * column, here, and the cells show a dash in muted, which is what muted means.
 *
 * Not a sort header: nothing visible is there to sort. The control is an
 * action, so it resets the row's mono uppercase to sentence-case sans; the
 * lock is allowed because it sits inside a control. `size-3` rather than
 * `h-3 w-3` on it, because the Button base forces any svg without a `size-`
 * class to 16px, and a 16px lock beside 12px text in a 34px header is the
 * wrong scale. The row's widths are measured with this control in place (see
 * the track list below).
 */
function LockedHeader({
  label,
  feature,
  gate,
  onUpgradeClick,
}: {
  label: string;
  /** Finishes the sentence "Buy credits to see …" in the control's title. */
  feature: string;
  /** Analytics name for this gate; see UpgradeModalProvider. */
  gate: string;
  onUpgradeClick?: (source?: string) => void;
}) {
  return (
    <div role="columnheader" className="flex items-center gap-3 px-4">
      <span className="truncate">{label}</span>
      <Button
        variant="link"
        size="inline"
        onClick={() => onUpgradeClick?.(gate)}
        title={`Buy credits to see ${feature}`}
        className="font-sans text-xs normal-case tracking-[var(--tracking-body)]"
      >
        <Lock className="size-3" aria-hidden />
        Unlock
      </Button>
    </div>
  );
}

/** What a locked column's cells show: a dash, in the colour of text you cannot act on. */
function LockedCell() {
  return <span className="text-muted-foreground">{EMPTY_CELL}</span>;
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
          r.twitter_also?.handle.toLowerCase().includes(searchLower) ||
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
    return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  };

  /* A plain decimal in the browser locale, like every other figure here. The
     column may hold a USD value, a token balance or an item count, so a
     currency style would claim a unit the data never stated: a bag of 1,000
     tokens is not "$1,000.00". */
  const formatHoldings = (value: number | undefined) => {
    if (value === undefined) return EMPTY_CELL;
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPriorityScore = (value: number | undefined) => {
    if (value === undefined || value === 0) return EMPTY_CELL;
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
    if (level === 0)
      return <span className="text-muted-foreground">{EMPTY_CELL}</span>;

    /* The bars are foreground, not violet: a priority score is a computed
       figure, neither an affordance nor an attested fact, and violet on it
       said "you can act on this". The score is a table figure, so it takes
       the figure cut, 500 tabular. The bars own their own `gap-0.5` and the
       outer row its `gap-2`; a margin on the figure was adding to the gap. */
    return (
      <div
        className="flex items-center gap-2 cursor-help"
        title={`Priority: ${formatPriorityScore(score)} (Based on holdings × follower reach)`}
      >
        <div className="flex items-center gap-0.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={`w-1 h-3 rounded-sm ${
                i < level ? 'bg-foreground' : 'bg-muted'
              }`}
            />
          ))}
        </div>
        <span className="font-medium tabular-nums">
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
    /* The two paid columns are measured, not guessed, because their headers
       are the widest things in the row. In headless Chrome with Geist Mono at
       12px, uppercase, 0.14em tracking: "FARCASTER FOLLOWERS" is 169px and
       "PRIORITY" 71px. Add 32px of cell padding, then either the sort arrow
       (4px gap + 12px) when entitled, or the Unlock control (12px gap + 12px
       lock + 8px gap + 37px "Unlock" in Söhne at 12px/500) when locked. The
       header row is a fixed 34px, so a label that does not fit does not wrap,
       it clips. */
    const tracks = [
      GUTTER_WIDTH, // attestation gutter
      120, // wallet
      100, // ENS
      ...(hasHoldings ? [100] : []),
      ...filteredExtraColumns.map(() => 80),
      120, // X handle
      120, // Farcaster
      isPaidTier ? 220 : 272, // Farcaster followers
      isPaidTier ? 140 : 176, // priority
    ];
    return {
      gridTemplate: tracks
        .map((min, i) => (i === 0 ? `${min}px` : `minmax(${min}px, 1fr)`))
        .join(' '),
      gridMinWidth: tracks.reduce((sum, min) => sum + min, 0),
      columnCount: tracks.length,
    };
  }, [hasHoldings, filteredExtraColumns, isPaidTier]);

  const isEmpty = filteredAndSorted.length === 0;

  return (
    <div className="space-y-4">
      {/* Filters. Each toggle keeps one label, named for what it does, and
          says whether it is on through `aria-pressed` and the selected
          treatment the segmented control uses: outline with the brand edge,
          tint fill, brand text. They used to flip to the filled variant and
          reword themselves by state ("Top influencers" became "Top influencers
          (1K+)"), so a filter that was on became a second solid violet pill
          and the row shifted as the text changed width. Filled is reserved
          for the one primary action, which is Export CSV above.

          The result count is not in this row. On a phone the input takes a
          line, the pills a second, and the count sat alone on a third; it is
          a caption of the table and sits beneath it. */}
      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder="Search wallet, ENS, or handle…"
          aria-label="Search results"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button
          variant="outline"
          size="sm"
          aria-pressed={showOnlyTwitter}
          className={cn(showOnlyTwitter && FILTER_ON)}
          onClick={() => setShowOnlyTwitter(!showOnlyTwitter)}
        >
          With X handle
        </Button>
        {/* Gated with the paid columns it filters on: an ungated toggle told
            a free user which wallets clear 1K followers, leaking the locked
            fc_followers signal one bit at a time (decided 2026-08-22). */}
        {isPaidTier ? (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showTopInfluencers}
            className={cn(showTopInfluencers && FILTER_ON)}
            onClick={() => setShowTopInfluencers(!showTopInfluencers)}
          >
            Top influencers (1K+)
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            title="Buy credits to filter by follower reach"
            onClick={() => onUpgradeClick?.('filter-influencers')}
          >
            <Lock className="size-3" aria-hidden />
            Top influencers (1K+)
          </Button>
        )}
        {results.some((r) => r.is_agent) && (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showOnlyAgents}
            className={cn(showOnlyAgents && FILTER_ON)}
            onClick={() => setShowOnlyAgents(!showOnlyAgents)}
          >
            Agents only
          </Button>
        )}
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
            className="sticky top-0 z-20 grid border-b border-border bg-background font-mono text-xs uppercase tracking-[var(--tracking-label)] text-muted-foreground"
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
            {/* The platform is "X" and "Farcaster" is never abbreviated: one
                screen named the same platform four ways (Twitter, the U+1D54F
                character, X, FC). */}
            <SortHeader
              field="twitter_handle"
              label="X handle"
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
            {isPaidTier ? (
              <SortHeader
                field="fc_followers"
                label="Farcaster followers"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
            ) : (
              <LockedHeader
                label="Farcaster followers"
                feature="Farcaster followers"
                gate="column-followers"
                onUpgradeClick={onUpgradeClick}
              />
            )}
            {isPaidTier ? (
              <SortHeader
                field="priority_score"
                label="Priority"
                title="Based on holdings × follower reach"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
            ) : (
              <LockedHeader
                label="Priority"
                feature="the priority score"
                gate="column-priority"
                onUpgradeClick={onUpgradeClick}
              />
            )}
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
                       virtualised row may animate. The duration and curve are
                       stated because Tailwind's bare default is 150ms on its own
                       ease, neither of which the system has. */
                    className={`absolute top-0 left-0 grid w-full items-center border-b border-border transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-out-soft)] ${
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
                        what is known. The title carries the same fact in words
                        for a mouse, and the visually hidden text carries it to
                        screen readers and touch, where a title never surfaces:
                        nothing depends on distinguishing two colours. */}
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
                            >
                              <span className="sr-only">Owner-attested</span>
                            </span>
                          );
                        }
                        if (state === 'matched') {
                          return (
                            <span
                              className="h-2 w-2 rounded-full ring-1 ring-inset ring-border"
                              title="Matched from the index, not owner-attested"
                            >
                              <span className="sr-only">
                                Matched from the index
                              </span>
                            </span>
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
                        {/* The link variant at inline size, which is the one
                            treatment for a text control in a cell and brings
                            the focus ring with it. Foreground rather than the
                            variant's brand colour: the address is the row's
                            identity and reads as data, and muted would say it
                            cannot be acted on. Hover goes to brand, colour
                            only. */}
                        <Button
                          variant="link"
                          size="inline"
                          className="relative font-mono text-xs text-foreground hover:text-accent-brand"
                          onClick={() => handleCopyWallet(result.wallet)}
                          title={`${result.wallet}\nClick to copy`}
                        >
                          {truncateWallet(result.wallet)}
                          {copiedWallet === result.wallet && (
                            /* bg-foreground/text-background, not bg-black/text-white. The
                               dark theme's background is itself near-black, so a literally
                               black toast on it had no edge at all.

                               role="status" so the copy is announced, not only
                               shown. Below the address, not above: the cell
                               is its own sticky z-10 stacking context, so no
                               z-index inside it can clear the header row's
                               z-20, and above-the-address put the first
                               visible row's toast behind the header. Beneath,
                               it overlaps only the next row and needs no
                               z-fight. The fade is opacity only, on the toast
                               itself: the virtualised row beneath may animate
                               nothing beyond background colour, and the static
                               centering transform stays untouched. */
                            <span
                              role="status"
                              className="fade-in-fast absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-foreground text-background text-xs px-2 py-1 rounded-sm whitespace-nowrap z-30"
                            >
                              Copied!
                            </span>
                          )}
                        </Button>
                        {/* Both chips are the Badge primitive. One meaning,
                            one colour: "agent" is a single fact, and the five
                            framework branches this replaces resolved to three
                            colours with three of them identical. Badge caps at
                            12ch and truncates, because agent_name is
                            third-party data with no length bound and this row
                            has a fixed 44px height it must not change. "New"
                            was a solid brand fill in capitals, the paint
                            of a filled button on a fact. */}
                        {result.is_agent && (
                          <Badge
                            tone="brand"
                            className="shrink-0"
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
                          </Badge>
                        )}
                        {isEnriched && (
                          <Badge tone="brand" className="shrink-0">
                            New
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* ENS */}
                    <div
                      role="cell"
                      className="px-4 py-2 font-mono text-xs truncate"
                    >
                      {result.ens_name || EMPTY_CELL}
                    </div>

                    {/* Holdings. Two cuts in this row, one per kind of value:
                        identifiers (wallet, ENS, X handle, Farcaster) are
                        12px mono, because they are read; figures (holdings,
                        Farcaster followers, priority) are 14px sans at 500
                        with tabular numerals, because they are compared down
                        a column. This one is a figure. */}
                    {hasHoldings && (
                      <div
                        role="cell"
                        className="px-4 py-2 text-sm font-medium tabular-nums"
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
                        {(result[col] as string) || EMPTY_CELL}
                      </div>
                    ))}

                    {/* X handle. `py-1` where every other cell has `py-2`:
                        the row centres its cells, so vertical padding on a
                        one-line cell changes nothing you can see, and this is
                        the one cell that can hold two lines. Two lines at
                        16px plus `py-2` is 48px inside a 44px row, and the
                        second line would cross the row's border. */}
                    <div role="cell" className="px-4 py-1 font-mono text-xs">
                      {result.twitter_handle ? (
                        <TwitterCell result={result} />
                      ) : (
                        EMPTY_CELL
                      )}
                    </div>

                    {/* Farcaster */}
                    <div role="cell" className="px-4 py-2 font-mono text-xs">
                      {result.farcaster ? (
                        <Button
                          asChild
                          variant="link"
                          size="inline"
                          className="font-mono text-xs"
                        >
                          <a
                            href={
                              result.farcaster_url ||
                              `https://warpcast.com/${result.farcaster}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            @{result.farcaster}
                          </a>
                        </Button>
                      ) : (
                        EMPTY_CELL
                      )}
                    </div>

                    {/* Farcaster followers */}
                    {/* tabular-nums, not font-mono: a follower count is a figure to
                        compare down a column, not an identifier to read. Söhne's
                        tnum substitutes .lt glyphs at a uniform 608 units, so the
                        digits align without changing face. Weight 500 is the
                        table-figure cut.

                        A locked cell is a dash in muted and nothing else. The
                        column's one upgrade control is in its header. */}
                    <div
                      role="cell"
                      className="px-4 py-2 text-sm font-medium tabular-nums"
                    >
                      {isPaidTier ? (
                        result.fc_followers !== undefined ? (
                          result.fc_followers.toLocaleString()
                        ) : (
                          EMPTY_CELL
                        )
                      ) : (
                        <LockedCell />
                      )}
                    </div>

                    {/* Priority */}
                    <div role="cell" className="px-4 py-2 text-sm">
                      {isPaidTier ? (
                        <PriorityIndicator score={result.priority_score} />
                      ) : (
                        <LockedCell />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* The count, as a caption of the table it counts. */}
      <p className="text-xs text-muted-foreground tabular-nums">
        {filteredAndSorted.length.toLocaleString()} results
      </p>
    </div>
  );
});
