'use client';

import { useCallback, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { XMark } from '@/components/ui/brand-marks';
import { CircleNotch, MagnifyingGlass, SealCheck, Question, Warning } from '@phosphor-icons/react';

/**
 * Check one X handle against what we resolved, with no account and no key.
 *
 * ## Why the states are coloured the way they are
 *
 * `attested` green marks a **measured fact**, never an inference presented as
 * confirmation, which is the distinction the product is sold on. So green is
 * reserved for `live`: we asked X and it answered. `caution` carries suspended
 * and unclaimed, which are also measured but are the states that cost a
 * customer something. **Unchecked is deliberately neutral**: it is the one
 * answer where we know nothing, and colouring it either way would be the exact
 * error the page exists to disprove.
 */

type State = 'live' | 'suspended' | 'unclaimed' | 'unchecked' | 'unknown';

interface Answer {
  handle: string;
  state: State;
  label: string;
  detail: string;
  wallets: number;
  checkedAt: string | null;
}

/**
 * One row per state, so the treatment is a lookup rather than a chain of
 * ternaries that can disagree with itself as states are added.
 */
const TREATMENT: Record<State, { tone: string; tint: string; Icon: typeof SealCheck }> = {
  live: { tone: 'text-attested', tint: 'bg-attested-tint', Icon: SealCheck },
  suspended: { tone: 'text-caution', tint: 'bg-caution-tint', Icon: Warning },
  unclaimed: { tone: 'text-caution', tint: 'bg-caution-tint', Icon: Warning },
  unchecked: { tone: 'text-muted-foreground', tint: 'bg-muted', Icon: Question },
  unknown: { tone: 'text-muted-foreground', tint: 'bg-muted', Icon: Question },
};

export function ReachabilityChecker() {
  const [value, setValue] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Guards against an earlier request resolving after a later one. */
  const seq = useRef(0);

  const check = useCallback(async () => {
    const handle = value.trim();
    if (!handle || loading) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reachability?handle=${encodeURIComponent(handle)}`);
      const body = await res.json();
      if (mine !== seq.current) return;
      if (!res.ok) {
        setError(body.error ?? 'Check failed');
        setAnswer(null);
      } else {
        setAnswer(body);
      }
    } catch {
      if (mine === seq.current) {
        setError('Check failed. Try again in a moment.');
        // Clear the previous answer too, as the non-OK branch does. Leaving it
        // put a red failure message beside a stale result card, which reads as
        // "this handle failed" rather than "the check did not complete".
        setAnswer(null);
      }
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [value, loading]);

  const shown = answer ? TREATMENT[answer.state] ?? TREATMENT.unknown : null;

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <div className="relative flex-1">
          {/* Beside bare text an icon identifies; inside the field it marks the
              field's job, which is what a search affordance is for. */}
          <XMark className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="jack"
            aria-label="X handle to check"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            // Mono because a handle is machine data occupying its own element.
            className="pl-9 font-mono"
          />
        </div>
        <Button type="submit" disabled={loading || !value.trim()} className="sm:w-auto">
          {loading ? (
            <CircleNotch className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <MagnifyingGlass className="h-4 w-4" aria-hidden />
          )}
          Check
        </Button>
      </form>

      {error && (
        <p role="status" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {answer && shown && (
        <div role="status" className="rounded-lg border border-border p-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span
                className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${shown.tint}`}
              >
                <shown.Icon className={`h-5 w-5 ${shown.tone}`} weight="fill" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <p className="font-mono text-sm text-muted-foreground">@{answer.handle}</p>
                <p className={`text-lg font-medium ${shown.tone}`}>{answer.label}</p>
              </div>
            </div>

            <p className="max-w-[68ch] text-sm text-muted-foreground">{answer.detail}</p>

            {answer.state !== 'unknown' && (
              <dl className="flex flex-wrap gap-x-10 gap-y-3 border-t border-border pt-4">
                <div className="flex flex-col gap-0.5">
                  <dt className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    Wallets carrying it
                  </dt>
                  <dd className="text-sm tabular-nums">{answer.wallets.toLocaleString()}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    Last checked
                  </dt>
                  <dd className="text-sm tabular-nums">
                    {answer.checkedAt
                      ? new Date(answer.checkedAt).toISOString().slice(0, 10)
                      : 'never'}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
