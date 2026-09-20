'use client';

import { useEffect, useRef, useState } from 'react';

/** Native DOM/canvas, isolated styles, Walletlink's existing dark theme tokens. */
export function IdentityHero() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const abort = new AbortController();
    let cleanup: (() => void) | undefined;
    async function load() {
      try {
        const [
          response,
          { mountGraph },
          { markup, styles },
          { heroSnapshotSchema },
        ] = await Promise.all([
          fetch('/api/hero', {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
            cache: 'no-store',
          }),
          import('./identity-hero/controller.js'),
          import('./identity-hero/template'),
          import('@/lib/identity-hero/types'),
        ]);
        if (!response.ok) throw new Error('Snapshot unavailable');
        const data = heroSnapshotSchema.parse(await response.json());
        if (abort.signal.aborted || !element) return;
        const root =
          element.shadowRoot || element.attachShadow({ mode: 'open' });
        // Only repository-owned markup/style enters this template. Data is escaped by the controller.
        root.innerHTML = `<style>${styles}</style>${markup}`;
        cleanup = mountGraph(root, data);
        setStatus('ready');
      } catch {
        if (!abort.signal.aborted) setStatus('error');
      }
    }
    void load();
    return () => {
      abort.abort();
      cleanup?.();
    };
  }, [attempt]);
  return (
    <section
      aria-label="Walletlink identity graph"
      className="identity-hero dark relative overflow-hidden rounded-lg border border-border bg-background text-foreground"
    >
      <div ref={host} />
      {status !== 'ready' && (
        <div
          className="flex min-h-[466px] max-[647px]:min-h-[830px] items-center justify-center p-6 text-center text-sm text-muted-foreground"
          role="status"
        >
          {status === 'loading' ? (
            'Loading indexed connections…'
          ) : (
            <div>
              <p>
                The graph preview is temporarily unavailable. You can still try
                your wallet list below.
              </p>
              <button
                className="mt-3 underline underline-offset-4"
                onClick={() => {
                  setStatus('loading');
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
