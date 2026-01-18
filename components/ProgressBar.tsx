'use client';

import { memo, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { LookupProgress } from '@/lib/types';

interface ProgressBarProps {
  progress: LookupProgress;
  displayedProcessed?: number;
  timeRemaining?: string | null;
  onCancel?: () => void;
}

// Parse the current stage from the message (e.g., "Processing: ens (0/4440)")
function parseStage(message?: string): string | null {
  if (!message) return null;
  const match = message.match(/Processing:\s*(\w+)/i);
  return match ? match[1].toLowerCase() : null;
}

// Pipeline stages in order
const STAGES = [
  { id: 'cache', label: 'Cache', icon: '◈' },
  { id: 'web3bio', label: 'Web3.bio', icon: '◉' },
  { id: 'neynar', label: 'Farcaster', icon: '◎' },
  { id: 'ens', label: 'ENS', icon: '◇' },
] as const;

export const ProgressBar = memo(function ProgressBar({
  progress,
  displayedProcessed,
  timeRemaining,
  onCancel,
}: ProgressBarProps) {
  const processed = displayedProcessed ?? progress.processed;
  const percentage =
    progress.total > 0 ? Math.round((processed / progress.total) * 100) : 0;

  const currentStage = parseStage(progress.message);
  const isProcessing = progress.status === 'processing';

  // Calculate which stage index we're on
  const currentStageIndex = useMemo(() => {
    if (!currentStage) return 0;
    const idx = STAGES.findIndex((s) => s.id === currentStage);
    return idx >= 0 ? idx : 0;
  }, [currentStage]);

  return (
    <Card className="overflow-hidden border-border/50 bg-card/80 backdrop-blur-sm">
      <CardContent className="p-0">
        {/* Main content area */}
        <div className="p-6 pb-4">
          {/* Header with stats and cancel */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                {/* Animated processing indicator */}
                {isProcessing && (
                  <div className="relative flex items-center justify-center w-5 h-5">
                    {/* Outer pulse ring */}
                    <span className="absolute inset-0 rounded-full bg-chart-3/30 animate-ping" />
                    {/* Inner spinning ring */}
                    <span className="absolute inset-0.5 rounded-full border-2 border-chart-3/50 border-t-chart-3 animate-spin" />
                    {/* Center dot */}
                    <span className="relative w-1.5 h-1.5 rounded-full bg-chart-3" />
                  </div>
                )}
                <h3 className="text-base font-semibold tracking-tight">
                  {isProcessing ? 'Processing' : progress.status === 'complete' ? 'Complete' : 'Waiting'}
                </h3>
              </div>
              <p className="text-[13px] text-muted-foreground font-medium tabular-nums">
                {processed.toLocaleString()} of {progress.total.toLocaleString()} wallets
              </p>
            </div>

            {isProcessing && onCancel && (
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                className="text-xs h-8 px-3 border-border/50 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
              >
                Cancel
              </Button>
            )}
          </div>

          {/* Stats row */}
          <div className="flex gap-6 mb-6">
            <StatBadge
              label="Twitter"
              value={progress.twitterFound}
              colorClass="text-sky-400"
              isAnimating={isProcessing && progress.twitterFound > 0}
            />
            <StatBadge
              label="Farcaster"
              value={progress.farcasterFound}
              colorClass="text-violet-400"
              isAnimating={isProcessing && progress.farcasterFound > 0}
            />
          </div>

          {/* Pipeline visualization */}
          <div className="relative mb-5">
            {/* Background track */}
            <div className="absolute inset-0 h-1 top-[11px] bg-border/30 rounded-full" />

            {/* Active progress line */}
            <div
              className="absolute h-1 top-[11px] left-0 bg-gradient-to-r from-chart-3 via-chart-3 to-chart-3/50 rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${Math.max(percentage, isProcessing ? 5 : 0)}%`,
              }}
            >
              {/* Animated shimmer on progress line */}
              {isProcessing && (
                <div className="absolute inset-0 overflow-hidden rounded-full">
                  <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                </div>
              )}
            </div>

            {/* Pipeline stages */}
            <div className="relative flex justify-between">
              {STAGES.map((stage, idx) => {
                const isActive = currentStage === stage.id;
                const isComplete = idx < currentStageIndex || percentage === 100;
                const isPending = idx > currentStageIndex && percentage < 100;

                return (
                  <div
                    key={stage.id}
                    className="flex flex-col items-center gap-2"
                  >
                    {/* Stage dot */}
                    <div
                      className={`
                        relative w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                        transition-all duration-300
                        ${isActive
                          ? 'bg-chart-3 text-chart-3-foreground scale-110 shadow-lg shadow-chart-3/40'
                          : isComplete
                            ? 'bg-chart-3/80 text-chart-3-foreground'
                            : 'bg-muted text-muted-foreground'
                        }
                      `}
                    >
                      {/* Pulse ring for active stage */}
                      {isActive && isProcessing && (
                        <span className="absolute inset-0 rounded-full bg-chart-3/40 animate-ping" />
                      )}
                      <span className="relative">{stage.icon}</span>
                    </div>

                    {/* Stage label */}
                    <span
                      className={`
                        text-[10px] font-medium uppercase tracking-wider transition-colors duration-300
                        ${isActive ? 'text-chart-3' : isComplete ? 'text-foreground/70' : 'text-muted-foreground/50'}
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
            <div className="relative h-2 bg-muted/50 rounded-full overflow-hidden">
              {/* Main progress fill */}
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-chart-3/90 to-chart-3 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${percentage}%` }}
              />

              {/* Animated activity indicator when at low percentage */}
              {isProcessing && percentage < 5 && (
                <div className="absolute inset-0 overflow-hidden">
                  <div className="absolute h-full w-32 -left-32 animate-slide bg-gradient-to-r from-transparent via-chart-3/40 to-transparent" />
                </div>
              )}

              {/* Shimmer effect */}
              {isProcessing && percentage > 0 && (
                <div
                  className="absolute inset-y-0 left-0 overflow-hidden rounded-full"
                  style={{ width: `${percentage}%` }}
                >
                  <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
              )}
            </div>

            {/* Bottom stats row */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground tabular-nums">
                <span className="text-foreground font-semibold">{percentage}%</span>
                {' complete'}
                {timeRemaining && (
                  <span className="text-muted-foreground/70"> · {timeRemaining}</span>
                )}
              </span>

              {/* Current activity indicator */}
              {isProcessing && currentStage && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-chart-3 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-chart-3" />
                  </span>
                  <span className="capitalize">{currentStage}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-muted/30 border-t border-border/30">
          <p className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1">
              <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              Processing in background
            </span>
            <span className="text-muted-foreground/50">—</span>
            <span>you can close this tab and check History later</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
});

// Stat badge component with optional animation
function StatBadge({
  label,
  value,
  colorClass,
  isAnimating,
}: {
  label: string;
  value: number;
  colorClass: string;
  isAnimating?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`relative flex items-center justify-center w-2 h-2 ${colorClass}`}>
        {isAnimating && (
          <span className="absolute inset-0 rounded-full bg-current animate-ping opacity-40" />
        )}
        <span className="relative w-2 h-2 rounded-full bg-current" />
      </div>
      <span className="text-xs text-muted-foreground">
        <span className={`font-semibold tabular-nums ${colorClass}`}>
          {value.toLocaleString()}
        </span>{' '}
        {label}
      </span>
    </div>
  );
}
