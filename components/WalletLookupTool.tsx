'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Button, FOCUS_RING } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Analytics } from '@/lib/client-analytics';

/**
 * The answer machine at the top of /find-twitter-account-from-wallet-address.
 *
 * Every free tool page that ranks does the same three things above the fold:
 * one input whose placeholder shows the SHAPE of the accepted value, one
 * button, and a clickable example beside them. The example is the part people
 * skip and it is the one that matters: most visitors arrive without an address
 * to hand, and a tool that cannot demonstrate itself to them is a landing page.
 *
 * The answer renders in place, under the input, on the same screen. It is never
 * a navigation.
 */

/** A well known address, so the example answers rather than misses. */
const EXAMPLE = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

interface Answer {
  data: {
    wallet: string;
    attested?: boolean;
    ens_name?: string;
    lens?: string;
    github?: string;
    sources?: string[];
    twitter?: {
      handle: string;
      url?: string;
      verified?: boolean;
      reachability?: string;
    };
    farcaster?: {
      username: string;
      url?: string;
      fid?: number;
      verified?: boolean;
    };
  } | null;
  wallet: string;
  found: boolean;
  checked_at: string | null;
}

/**
 * All four states, named the way the product names them.
 *
 * `reassigned` is the one that gets left out of summaries, and it is the harm
 * case: the handle is live, somebody is behind it, and it is not the person who
 * attested it. A tool that showed three states would quietly present the
 * dangerous one as fine.
 */
const REACHABILITY: Record<string, { label: string; tone: string }> = {
  live: { label: 'live', tone: 'text-attested' },
  suspended: { label: 'suspended', tone: 'text-caution' },
  unclaimed: { label: 'nobody holds it', tone: 'text-caution' },
  reassigned: { label: 'held by someone else now', tone: 'text-caution' },
};

export function WalletLookupTool() {
  const [address, setAddress] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const response = await fetch('/api/wallet-socials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: trimmed }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error ?? 'Something went wrong. Try again.');
        return;
      }
      const result = json as Answer;
      setAnswer(result);
      Analytics.walletPreviewLookup(result.found);
    } catch {
      setError('Could not reach the lookup. Check your connection and retry.');
    } finally {
      setBusy(false);
    }
  }, []);

  const tryExample = useCallback(() => {
    setAddress(EXAMPLE);
    void run(EXAMPLE);
  }, [run]);

  return (
    <div className="mt-6">
      <form
        /**
         * Submit stays enabled on an empty field, and validates on submit.
         *
         * It used to carry `disabled={!address.trim()}`, which reads as a
         * courtesy and is not one. `disabled` takes a button out of the tab
         * order in every browser, so the keyboard user tabbing this page did
         * not find a dimmed button to wonder about: they found no button, and
         * the page's single action was invisible to them. A reader that did
         * reach it got "dimmed" with no reason attached, because a disabled
         * control cannot explain itself.
         *
         * Pressing it empty now says what is missing and puts the cursor in
         * the field to fix it, which is the same information the dimming was
         * gesturing at, in a form that can actually be heard.
         */
        onSubmit={(e) => {
          e.preventDefault();
          if (!address.trim()) {
            setError('Enter a wallet address to look up.');
            setAnswer(null);
            inputRef.current?.focus();
            return;
          }
          void run(address);
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <Input
          ref={inputRef}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          // The placeholder shows the shape of the value, not an instruction.
          placeholder="0x…"
          aria-label="Wallet address"
          // Only while the field is the thing that is wrong. An error from the
          // server is about the address, not about the input, and marking the
          // field invalid for it would send a reader to re-edit a value that
          // is fine.
          aria-invalid={Boolean(error) && !address.trim()}
          aria-describedby={error ? 'lookup-error' : undefined}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 font-mono"
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Looking up…' : 'Look up'}
        </Button>
      </form>

      <p className="mt-2 text-sm text-muted-foreground">
        Free, no account, one address at a time. Or{' '}
        <button
          type="button"
          onClick={tryExample}
          className={`underline underline-offset-2 hover:text-foreground ${FOCUS_RING}`}
        >
          try an example
        </button>
        .
      </p>

      {error && (
        // `alert`, not `status`: this is the answer to something the visitor
        // just pressed, and it has to arrive before they move on.
        <p
          id="lookup-error"
          role="alert"
          className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm"
        >
          {error}
        </p>
      )}

      {answer && !answer.found && (
        /**
         * The miss is the common case and the real conversion moment. Most
         * wallets never published anything, so a miss is a fact about the
         * wallet rather than a failure of the lookup, and saying so is what
         * keeps the page honest when it is wrong for the visitor.
         */
        <div className="mt-4 rounded-lg border border-border bg-muted p-4">
          <p className="font-semibold">
            No published identity for this wallet.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            That usually means the owner never published one, not that the
            lookup failed. Nothing here is guessed from a bio or a post, so a
            wallet with nothing attested returns nothing.
          </p>
          <p className="mt-3 text-sm">
            <Link
              href="/check"
              className={`underline underline-offset-2 ${FOCUS_RING}`}
            >
              Try the other direction
            </Link>{' '}
            if you have a handle instead, or{' '}
            <Link
              href="/"
              className={`underline underline-offset-2 ${FOCUS_RING}`}
            >
              run a whole list
            </Link>
            .
          </p>
        </div>
      )}

      {answer?.found && answer.data && (
        <div className="mt-4 rounded-lg border border-border bg-surface-raised p-4">
          <dl className="space-y-3">
            {answer.data.twitter && (
              <div>
                <dt className="text-sm text-muted-foreground">X handle</dt>
                <dd className="flex flex-wrap items-baseline gap-2">
                  <a
                    href={answer.data.twitter.url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`font-semibold underline underline-offset-2 ${FOCUS_RING}`}
                  >
                    @{answer.data.twitter.handle}
                  </a>
                  {answer.data.twitter.reachability && (
                    <span
                      className={`text-sm ${
                        REACHABILITY[answer.data.twitter.reachability]?.tone ??
                        'text-muted-foreground'
                      }`}
                    >
                      {REACHABILITY[answer.data.twitter.reachability]?.label ??
                        answer.data.twitter.reachability}
                    </span>
                  )}
                </dd>
              </div>
            )}

            {answer.data.farcaster && (
              <div>
                <dt className="text-sm text-muted-foreground">Farcaster</dt>
                <dd>
                  <a
                    href={answer.data.farcaster.url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`font-semibold underline underline-offset-2 ${FOCUS_RING}`}
                  >
                    {answer.data.farcaster.username}
                  </a>
                </dd>
              </div>
            )}

            {answer.data.ens_name && (
              <div>
                <dt className="text-sm text-muted-foreground">ENS</dt>
                <dd className="font-semibold">{answer.data.ens_name}</dd>
              </div>
            )}

            {answer.data.sources && (
              <div>
                <dt className="text-sm text-muted-foreground">Evidence</dt>
                <dd className="text-sm">
                  {answer.data.sources.join(', ')}
                  {answer.data.attested
                    ? ': published by the owner'
                    : ': correlated, not owner-published'}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
