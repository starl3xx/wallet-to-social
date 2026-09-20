'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * The addresses this account has claimed.
 *
 * ## Why it is here rather than only on /claim
 *
 * `/api/claim/mine` answers "what do you hold for me", and the only surface
 * rendering it is the card that creates claims. That is the wrong home for it:
 * a record of what the product holds about you belongs where you look for your
 * account, not inside the flow that adds to it.
 *
 * `/claim` keeps its own copy of the panel rather than handing the read off.
 * That is deliberate and it is also load-bearing: an invariant asserts that
 * `components/ClaimFlow.tsx` still contains the literal `'/api/claim/mine'`,
 * on the grounds that the page must be able to read back what it holds. This
 * component is a second reader, not a replacement.
 *
 * ## Two rules inherited from that panel
 *
 * A failed read keeps what it had rather than emptying the list, because a
 * blank panel says "we hold nothing about you", which is a different and
 * worse answer than "we could not check just now".
 *
 * `attested` green is correct here and almost nowhere else on this page: a
 * completed claim is a measured fact, published by the owner. It never marks
 * an expectation, a balance or a pending state.
 */

interface Claim {
  wallet: string;
  handle: string | null;
  granted_matches: number;
  completed_at: string | null;
}

const DATE = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function ClaimedAddresses() {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Written as a `.then` chain rather than an awaited helper so no setState
    // runs synchronously in the effect body, which is the cascading render
    // React objects to. `lib/use-credits.ts` has the same shape for the same
    // reason.
    let cancelled = false;
    // No query parameter, ever. The route reads the session, and an endpoint
    // that took an id would let anybody enumerate which wallets belong to
    // which account. An invariant fails CI if one is added.
    fetch('/api/claim/mine')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('read failed'))))
      .then((d: { claims?: Claim[] }) => {
        if (cancelled) return;
        setClaims(Array.isArray(d.claims) ? d.claims : []);
        setFailed(false);
      })
      .catch(() => {
        // Keep whatever the panel already had. Never setClaims(null) here: a
        // blank panel says "we hold nothing about you", which is a different
        // and worse answer than "we could not check just now".
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const held = claims ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claimed addresses</CardTitle>
        <CardDescription>
          Addresses you have proved you control. A claim is published under your
          own name and can be withdrawn from the claim page with the same
          wallet.
        </CardDescription>
        <CardAction>
          <Button variant="soft" size="sm" asChild>
            <Link href="/claim">Claim an address</Link>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        {claims === null && !failed && (
          <p className="text-sm text-muted-foreground">One moment…</p>
        )}

        {failed && held.length === 0 && (
          <p className="text-sm text-muted-foreground">
            We could not read your claims just now. Nothing has changed.
          </p>
        )}

        {claims !== null && held.length === 0 && !failed && (
          <p className="text-sm text-muted-foreground">
            You have not claimed an address yet.
          </p>
        )}

        {held.length > 0 && (
          <ul className="space-y-2">
            {held.map((c) => (
              <li
                key={c.wallet}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border px-4 py-3"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 flex-none rounded-full bg-attested"
                    aria-hidden
                  />
                  <span
                    className="font-mono text-sm text-foreground"
                    title={c.wallet}
                  >
                    {`${c.wallet.slice(0, 6)}…${c.wallet.slice(-4)}`}
                  </span>
                  {c.handle && (
                    <span className="font-mono text-sm text-muted-foreground">
                      @{c.handle}
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {c.completed_at
                    ? DATE.format(new Date(c.completed_at))
                    : 'Date unknown'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
