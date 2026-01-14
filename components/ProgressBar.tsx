'use client';

import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { LookupProgress } from '@/lib/types';

interface ProgressBarProps {
  progress: LookupProgress;
  displayedProcessed?: number;
  timeRemaining?: string | null;
  onCancel?: () => void;
}

export function ProgressBar({ progress, displayedProcessed, timeRemaining, onCancel }: ProgressBarProps) {
  const processed = displayedProcessed ?? progress.processed;
  const percentage =
    progress.total > 0
      ? Math.round((processed / progress.total) * 100)
      : 0;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                Processing {processed.toLocaleString()} /{' '}
                {progress.total.toLocaleString()} wallets
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Found {progress.twitterFound.toLocaleString()} Twitter handles,{' '}
                {progress.farcasterFound.toLocaleString()} Farcaster profiles
              </p>
            </div>
            {progress.status === 'processing' && onCancel && (
              <Button variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>

          <Progress value={percentage} className="h-2" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {percentage}% complete
              {timeRemaining && ` · ${timeRemaining}`}
            </span>
            {progress.message && (
              <span className="text-muted-foreground">{progress.message}</span>
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center pt-2 border-t">
            Processing in background — you can close this tab and check History later
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
