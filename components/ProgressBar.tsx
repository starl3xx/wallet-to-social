'use client';

import { memo, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { LookupProgress } from '@/lib/types';
import type { ScanDepth } from '@/lib/scan-depth';

interface ProgressBarProps {
  progress: LookupProgress;
  displayedProcessed?: number;
  timeRemaining?: string | null;
  onCancel?: () => void;
  /**
   * Which pipeline the job is running. A fast scan never reaches the live
   * sources, so showing their stages would promise work that will not happen.
   * Defaults to a deep scan: a job restored after a page refresh has no depth
   * to hand us, and over-listing the stages is the safer of the two errors.
   */
  scanDepth?: ScanDepth;
  /**
   * Whether this account may run onchain ENS. A job that cannot use it skips
   * straight to the next stage, so leaving ENS in the list puts the current
   * stage one place further along than it is, and the paid step lights up as
   * complete for an account that never ran it.
   */
  includesEns?: boolean;
}

// Parse the current stage from the message (e.g., "Processing: ens (0/4440)")
function parseStage(message?: string): string | null {
  if (!message) return null;
  const match = message.match(/Processing:\s*(\w+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * The pipeline, in the order `job-processor.ts` actually runs it.
 *
 * It was listed as cache, Web3.bio, Farcaster, ENS, which is neither the order
 * the code runs nor the full set: the graph read that starts every job was
 * missing entirely, and `currentStageIndex` drives the completed/pending state
 * of every dot from this array, so a wrong order lights the wrong dots.
 *
 * The last stage was labelled with its vendor's name, which the UI never does.
 * It is now named for what it does. ENS and Farcaster are protocols rather than
 * vendors, and both are sold as features under those names, so they keep them.
 *
 * No per-stage glyph. Each stage carried a Unicode geometric shape (◈ ◇ ◆ ◎ ◉)
 * rendered as text, and Söhne has none of them, so every dot showed a
 * fallback-font character at an unrelated weight. A stage is a status, and the
 * product already has a status-dot vocabulary in the results gutter: filled
 * means done, hollow means not. The dots use that.
 */
const STAGES = [
  { id: 'graph', label: 'Index', live: false },
  { id: 'cache', label: 'Cache', live: false },
  { id: 'ens', label: 'ENS', live: true },
  { id: 'neynar', label: 'Farcaster', live: true },
  { id: 'web3bio', label: 'Profiles', live: true },
] as const;

export const ProgressBar = memo(function ProgressBar({
  progress,
  displayedProcessed,
  timeRemaining,
  onCancel,
  scanDepth = 'deep',
  includesEns = true,
}: ProgressBarProps) {
  // The list has to match the stages the job will actually report, because
  // `currentStageIndex` is an index into it. A stage that never runs does not
  // just sit unlit: it shifts everything after it.
  const stages = useMemo(
    () =>
      STAGES.filter((s) => {
        if (scanDepth === 'fast' && s.live) return false;
        if (s.id === 'ens' && !includesEns) return false;
        return true;
      }),
    [scanDepth, includesEns]
  );
  const processed = displayedProcessed ?? progress.processed;
  const percentage =
    progress.total > 0 ? Math.round((processed / progress.total) * 100) : 0;

  const currentStage = parseStage(progress.message);
  const isProcessing = progress.status === 'processing';
  // Looked up in the full list, not the filtered one: a job can report a stage
  // this account's list omits, and the honest thing is still to name it.
  const activeLabel = currentStage
    ? (STAGES.find((s) => s.id === currentStage)?.label ?? null)
    : null;

  // Calculate which stage index we're on
  const currentStageIndex = useMemo(() => {
    if (!currentStage) return 0;
    const idx = stages.findIndex((s) => s.id === currentStage);
    return idx >= 0 ? idx : 0;
  }, [currentStage, stages]);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Main content area */}
        <div className="p-6 pb-4">
          {/* Header with stats and cancel */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                {/* The live pulse. Green, because "the system is running" is
                    a measured fact, and the header's "wallets indexed" dot
                    on the same screen is already green. This was violet, so
                    one screen said "live" in two colours. The spinner's faded
                    track is the one exemption to the border-opacity rule: it
                    is an arc, not separation. */}
                {isProcessing && (
                  <div className="relative flex items-center justify-center w-5 h-5">
                    {/* Outer pulse ring */}
                    <span className="absolute inset-0 rounded-full bg-attested/30 animate-ping" />
                    {/* Inner spinning ring */}
                    <span className="absolute inset-0.5 rounded-full border-2 border-attested/50 border-t-attested animate-spin" />
                    {/* Center dot */}
                    <span className="relative w-1.5 h-1.5 rounded-full bg-attested" />
                  </div>
                )}
                <h3 className="text-base font-semibold tracking-[var(--tracking-lead)]">
                  {isProcessing
                    ? 'Processing'
                    : progress.status === 'complete'
                      ? 'Complete'
                      : 'Waiting'}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground font-medium tabular-nums">
                {processed.toLocaleString()} of{' '}
                {progress.total.toLocaleString()} wallets
              </p>
            </div>

            {/* The primitive as it comes: `sm` is already `h-control`, and the
                outline edge is `border-input` so it clears 3:1. No destructive
                hover: cancelling a job is not revoking or deleting anything. */}
            {isProcessing && onCancel && (
              <Button variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>

          {/* Stats row */}
          <div className="flex gap-6 mb-6">
            <StatBadge
              label="X"
              value={progress.twitterFound}
              isAnimating={isProcessing && progress.twitterFound > 0}
            />
            <StatBadge
              label="Farcaster"
              value={progress.farcasterFound}
              isAnimating={isProcessing && progress.farcasterFound > 0}
            />
          </div>

          {/* Pipeline stages.

              The row says which stage the job is in; the bar beneath says how
              far through it is. It used to do both: a second fill ran behind
              the dots to the same percentage as the bar, floored at 5% while
              processing, so at "0% complete" a violet stub already covered the
              first dot. One percentage, one fill. The dots sit on a hairline,
              and what they say is complete versus pending, not progress.
              `mb-6`, the same 24px as the two gaps above it: this was
              `mb-5`, 20px, which the nine-step scale does not have. */}
          <div className="relative mb-6">
            {/* The hairline, ending at the centres of the first and last dots. */}
            <div className="absolute inset-x-1 top-1 h-px bg-border" />

            <div className="relative flex justify-between">
              {stages.map((stage, idx) => {
                /* Gated on `isProcessing`: `currentStageIndex` falls back to 0
                   when the message names no stage, which is the case before
                   the first "Processing:" message and again once the job is
                   complete or waiting. The first is the one that should name
                   a stage (the phone shows only the active label, and showed
                   none); the other two should not light anything. */
                const isActive = isProcessing && idx === currentStageIndex;
                const isComplete =
                  idx < currentStageIndex || percentage === 100;

                return (
                  <div
                    key={stage.id}
                    className="flex flex-col items-center gap-2"
                  >
                    {/* The gutter's status dot: filled for a stage that has
                        run or is running, hollow for one still to come. No
                        growth, no shadow, no ping: press is the only transform,
                        shadows belong to the floating layer, and the spinner
                        beside the title already says "running". */}
                    <span
                      className={`h-2 w-2 rounded-full transition-control ${
                        isActive || isComplete
                          ? 'bg-accent-brand'
                          : 'bg-card ring-1 ring-inset ring-border'
                      }`}
                    />

                    {/* Stage label. Five of these do not fit across a phone,
                        and the row grew from four when the graph read was
                        added, so on a narrow screen only the stage you are on
                        is named. The dots still show the whole pipeline.

                        Full-opacity tokens only. Muted is 4.74:1 in light mode,
                        so `/50` on it cannot clear AA, and the pending labels
                        were ghosts. The active label keeps the accent because
                        it is the one thing moving; the dot carries complete
                        versus pending. */}
                    <span
                      className={`
                        whitespace-nowrap font-mono text-xs uppercase tracking-[var(--tracking-label)] transition-control
                        ${isActive ? 'text-accent-brand' : isComplete ? 'text-foreground' : 'text-muted-foreground'}
                        ${isActive ? '' : 'hidden sm:inline'}
                      `}
                    >
                      {stage.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Progress bar with percentage */}
          <div className="space-y-2">
            {/* The one fill, and it is the Progress primitive: Radix gives it
                the `progressbar` role and its value attributes, the primitive
                moves its fill by transform on the tokens. No gradient, no
                shimmer, no floor: a fill is a measurement, the delight budget
                names two places of which this is neither, and at 0% nothing
                is painted. Activity before the first result is the sweep,
                laid over the track rather than inside it because the
                primitive owns its own children. */}
            <div className="relative">
              <Progress value={percentage} aria-label="Wallets processed" />
              {isProcessing && percentage < 5 && (
                <div className="absolute inset-0 overflow-hidden rounded-full">
                  <div className="absolute h-full w-32 -left-32 animate-slide bg-gradient-to-r from-transparent via-accent-brand/40 to-transparent" />
                </div>
              )}
            </div>

            {/* Bottom stats row */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground tabular-nums">
                <span className="text-foreground font-semibold">
                  {percentage}%
                </span>
                {' complete'}
                {timeRemaining && <span> · {timeRemaining}</span>}
              </span>

              {/* Current activity indicator. The pulse is green like every
                  other live pulse on the card. The text is the stage's label,
                  not its id: the id is a pipeline marker that names a vendor
                  for two of the stages, and the UI never does that. */}
              {isProcessing && activeLabel && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-attested opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-attested" />
                  </span>
                  <span>{activeLabel}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer. One sentence, no icon: the arrow was a hand-drawn svg where
            icons are Phosphor, and the three-part flex row split into two
            ragged columns at 375px. The band is `bg-muted` at full opacity. */}
        <div className="px-6 py-3 bg-muted border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            Runs in the background. You can close this tab and find it in My
            lookups later.
          </p>
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * A running count beside a live dot.
 *
 * The dot is green: "the system is running" is a measured fact, and the header
 * says the same thing in the same colour. The figure is foreground at weight
 * 500, the table-figure cut, not violet: a count is never an affordance. There
 * is one correct colour for each, so neither is a prop.
 */
function StatBadge({
  label,
  value,
  isAnimating,
}: {
  label: string;
  value: number;
  isAnimating?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex items-center justify-center w-2 h-2 text-attested">
        {isAnimating && (
          <span className="absolute inset-0 rounded-full bg-current animate-ping opacity-40" />
        )}
        <span className="relative w-2 h-2 rounded-full bg-current" />
      </div>
      <span className="text-xs text-muted-foreground">
        <span className="font-medium tabular-nums text-foreground">
          {value.toLocaleString()}
        </span>{' '}
        {label}
      </span>
    </div>
  );
}
