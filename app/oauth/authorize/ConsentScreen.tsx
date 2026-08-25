'use client';

/**
 * What a person sees before an application is allowed to spend their credits.
 *
 * ## What it names the application
 *
 * The host, always, and the self-declared name only beside it. A client that
 * published an identity document had to control that host to publish it, so the
 * host is the one fact on this screen that somebody had to earn. The name in the
 * document is a string the same party typed, and a screen that showed the name
 * instead would let anybody who can serve JSON call themselves anything.
 *
 * A client that registered dynamically earned nothing at all, so it is marked
 * as unverified and identified by where it will send the reply.
 *
 * ## Signing in happens here
 *
 * Not through a modal that loses the request. The consent URL at this point is
 * one opaque id, so it survives a trip through a mailbox unchanged, and the
 * sign-in link carries it as the only return path the verifier will accept.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { Input } from '@/components/ui/input';

export function ConsentScreen({
  requestId,
  displayHost,
  claimedName,
  verified,
  email,
  keepsAccess,
}: {
  requestId: string;
  displayHost: string;
  claimedName: string | null;
  verified: boolean;
  email: string | null;
  keepsAccess: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [sent, setSent] = useState(false);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ req: requestId, approve }),
      });
      const data = (await response.json()) as {
        redirect?: string;
        error?: string;
      };
      if (!response.ok || !data.redirect) {
        setError(data.error ?? 'That did not work. Try connecting again.');
        setBusy(false);
        return;
      }
      // A full navigation, not a router push: the destination belongs to the
      // application, which is very often a loopback port on this machine.
      window.location.href = data.redirect;
    } catch {
      setError('That did not work. Try connecting again.');
      setBusy(false);
    }
  }

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput,
          // The one return path the verifier accepts, and it names this
          // request rather than describing where to go.
          next: `/oauth/authorize?req=${requestId}`,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? 'We could not send that link.');
        setBusy(false);
        return;
      }
      setSent(true);
    } catch {
      setError('We could not send that link.');
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-[46ch] py-12">
      <div className="rounded-lg border bg-background p-6">
        <Eyebrow className="text-muted-foreground">
          Connect an application
        </Eyebrow>

        <h1 className="mt-3 text-xl font-semibold tracking-[var(--tracking-title)]">
          {displayHost} wants to use your walletlink.social account
        </h1>

        {claimedName && verified && (
          <p className="mt-1 text-sm text-muted-foreground">
            It calls itself {claimedName}.
          </p>
        )}

        {!verified && (
          <p className="mt-3 text-sm text-caution">
            This application registered itself and proved nothing. We can tell
            you where it will send the reply and no more. Approve it only if you
            started this yourself.
          </p>
        )}

        <div className="mt-5 border-t pt-5">
          <p className="text-sm font-medium">It will be able to</p>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            <li>
              Resolve wallet addresses to X, Farcaster, ENS, Lens and GitHub
              identities, in both directions.
            </li>
            <li>
              Read how many match credits you have left, and spend them. A
              resolved address costs one credit; an address that resolves to
              nobody costs nothing.
            </li>
          </ul>
          <p className="mt-3 text-sm font-medium">It will not be able to</p>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            <li>
              See your saved lookups, your billing details or your email
              address.
            </li>
            <li>Buy credits, or change anything about your account.</li>
          </ul>
        </div>

        <p className="mt-5 text-xs text-muted-foreground">
          {keepsAccess
            ? 'Access lasts until you revoke it, and every hour it renews itself in the background. You can end it at any time from your account.'
            : 'Access lasts one hour and then stops. You can end it sooner from your account.'}
        </p>

        {email ? (
          <>
            <p className="mt-5 text-sm text-muted-foreground">
              Signed in as <span className="text-foreground">{email}</span>.
            </p>
            <div className="mt-4 flex gap-3">
              <Button onClick={() => decide(true)} disabled={busy}>
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => decide(false)}
                disabled={busy}
              >
                Decline
              </Button>
            </div>
          </>
        ) : sent ? (
          <p className="mt-5 text-sm text-attested">
            Check your email. The link brings you back to this screen, and this
            request waits half an hour.
          </p>
        ) : (
          <form onSubmit={sendLink} className="mt-5">
            <label
              htmlFor="consent-email"
              className="text-sm text-muted-foreground"
            >
              Sign in to continue. We’ll send a link that returns you here.
            </label>
            <div className="mt-2 flex gap-2">
              <Input
                id="consent-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
              />
              <Button type="submit" disabled={busy}>
                Send link
              </Button>
            </div>
          </form>
        )}

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
