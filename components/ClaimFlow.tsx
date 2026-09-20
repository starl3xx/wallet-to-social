'use client';

/**
 * Connect a wallet, sign the challenge, and hand off to X.
 *
 * ## No wallet library, on purpose
 *
 * There is no wagmi, no RainbowKit and no WalletConnect anywhere in this app,
 * and this adds none of them. What the flow needs is one signature from a
 * browser extension, which EIP-6963 and EIP-1193 give directly: the provider
 * announces itself, `eth_requestAccounts` names the address and
 * `personal_sign` signs the text. A connector library is worth its weight when
 * an app is transacting across chains and sessions; here it would be a
 * dependency, a bundle and a config surface for two RPC calls.
 *
 * ## EIP-6963 rather than `window.ethereum`
 *
 * `window.ethereum` is whichever extension won the race to define it, which
 * with two wallets installed is not a choice the person made. EIP-6963 asks
 * every provider to announce itself and lets them pick.
 *
 * There is deliberately NO fallback to the legacy global. A wallet that does
 * not announce itself gets the empty state below, which says so and says what
 * to do, and that is a better outcome than silently signing with whichever
 * extension happened to win: this flow writes an identity, and the address it
 * writes must be one the person chose. An earlier draft of this comment
 * claimed the fallback existed while the code had none, which is the defect
 * shape `scripts/check-invariants.ts` exists for.
 *
 * ## What the page does NOT do
 *
 * It does not verify the signature. That is the server's job and doing it here
 * as well would be a second implementation of the thing that matters, in the
 * place an attacker controls.
 */
import { useState, useEffect, useCallback } from 'react';
import { SignIn } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/inline-error';
import { AuthModal } from '@/components/AuthModal';
import { useAuth } from '@/components/AuthProvider';

/** The slice of EIP-1193 this flow uses. */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface Announced {
  info: { uuid: string; name: string; rdns: string };
  provider: Eip1193Provider;
}

type Stage = 'idle' | 'connecting' | 'signing' | 'starting';

/**
 * What to say when the WALLET refused, which is not the same as a failure.
 *
 * EIP-1193 gives a user rejection code 4001. Telling somebody their signature
 * failed when they pressed Cancel is the kind of message that teaches people
 * to distrust the next prompt, so a rejection says it was a rejection and
 * says nothing was recorded.
 */
function walletFailure(e: unknown, step: 'connect' | 'sign'): string {
  if ((e as { code?: number })?.code === 4001) {
    return step === 'connect'
      ? 'You closed your wallet without connecting. Nothing was recorded.'
      : 'You cancelled that. Nothing was recorded.';
  }
  return step === 'connect'
    ? 'That wallet could not connect.'
    : 'That wallet could not complete the signature.';
}

export function ClaimFlow({ consentVersion }: { consentVersion: string }) {
  /**
   * `null` means "not asked yet", which is a different state from "asked and
   * nobody answered" and has to render differently.
   *
   * An empty array from the first paint told every visitor to install a
   * wallet, including the ones who had one: this is a client component, so
   * the static HTML and the first client render both happen before discovery
   * can have run. On a slow load that message sat there long enough to be
   * believed and acted on.
   */
  const [providers, setProviders] = useState<Announced[] | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /**
   * Which action the wallet buttons perform.
   *
   * A mode rather than a second row of buttons, because BOTH actions need the
   * person to choose a wallet and the choice is the same list either way.
   * The first version hardcoded `providers[0]` for withdrawing, which is
   * whichever extension announced first: exactly the thing this file's own
   * header says is not a choice the person made, one function further down.
   * Somebody who attested with a later-announced wallet could not withdraw
   * that pairing at all.
   */
  const [mode, setMode] = useState<'claim' | 'withdraw'>('claim');
  /**
   * The account half, known before the wallet is touched.
   *
   * Both routes behind this require a session, and without one the challenge
   * answers 401. That refusal is correct, but it arrived AFTER the wallet
   * prompt: somebody signed out pressed their wallet, approved a connection,
   * and only then learned an account was required. A connection approval is a
   * real thing to ask of somebody, and spending one to discover a fact the
   * page already had is the wrong order.
   *
   * `isLoading` gets its own branch for the reason `providers === null` does:
   * "not answered yet" is not "answered no", and rendering the signed-out
   * state during the session fetch would tell a signed-in person to sign in.
   */
  const { user, isLoading: authLoading } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  /**
   * Whether THIS address earns the grant, once the challenge has answered.
   *
   * Its own state rather than part of `done` or `error`, because it is
   * neither: a claim that earns nothing is not a failure and must not be
   * rendered as one, which is what the challenge route's own comment says
   * about the field this reads.
   */
  const [worth, setWorth] = useState<string | null>(null);

  /**
   * EIP-6963 discovery. Providers answer the request event by announcing, so
   * the listener goes up before the request goes out.
   *
   * Announcements are synchronous in practice, but the empty result is only
   * COMMITTED after a turn of the event loop: a provider that announces a
   * tick late would otherwise be reported as absent and then appear, which
   * reads as the page changing its mind.
   */
  useEffect(() => {
    const seen = new Map<string, Announced>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Announced>).detail;
      if (!detail?.info?.uuid) return;
      seen.set(detail.info.uuid, detail);
      setProviders([...seen.values()]);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const settle = window.setTimeout(() => {
      setProviders((current) => current ?? [...seen.values()]);
    }, 300);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
    };
  }, []);

  const run = useCallback(
    async (provider: Eip1193Provider, mode: 'claim' | 'withdraw') => {
      setError(null);
      setDone(null);
      // Cleared with the rest, so a second attempt with a different wallet
      // cannot leave the first wallet's answer on screen beside it.
      setWorth(null);
      setStage('connecting');

      /**
       * The wallet calls get their own try, and nothing else is inside it.
       *
       * One try around the whole path reported a failed fetch, a bad JSON
       * body and anything after a successful signature as "that wallet could
       * not complete the signature", which is wrong in the most confusing
       * direction: it blames the wallet for our own network, and it says the
       * signature failed in cases where it succeeded.
       */
      let wallet: string;
      try {
        const accounts = (await provider.request({
          method: 'eth_requestAccounts',
        })) as string[];
        const first = accounts?.[0]?.toLowerCase();
        if (!first) {
          setError('That wallet did not return an address.');
          setStage('idle');
          return;
        }
        wallet = first;
      } catch (e) {
        setError(walletFailure(e, 'connect'));
        setStage('idle');
        return;
      }

      try {
        /**
         * The intent travels with the request, so the challenge that comes
         * back can only be spent on the thing this button does. It also
         * decides the text the wallet shows, which is the half the person
         * reads: withdrawing used to display the claim message and ask them
         * to agree the record "can name the account you choose".
         */
        const challengeRes = await fetch(
          `/api/claim/challenge?wallet=${encodeURIComponent(wallet)}&intent=${mode}`
        );
        const challenge = await challengeRes.json();
        if (!challengeRes.ok) {
          setError(challenge.message ?? 'We could not start a claim.');
          setStage('idle');
          return;
        }

        /**
         * What this claim is worth, on screen before anything is approved.
         *
         * The challenge route computes `earns_credits` and `grant_matches`
         * and says in its own comment that it does so "before anyone signs",
         * which was true of the response and not of the page: both fields
         * arrived and nothing read them, so the one moment the answer was
         * useful passed in silence. The page states the rule; this states
         * which side of it THIS address falls on, which the rule alone
         * cannot tell anybody.
         *
         * Claims only. A withdrawal earns nothing and is not meant to, so
         * quoting a reward beside it would be answering a question nobody
         * asked while taking something back.
         */
        if (mode === 'claim') {
          setWorth(
            challenge.earns_credits
              ? `We already knew this address, so this claim credits ${challenge.grant_matches} matches once it completes.`
              : 'We first saw this address after the cutoff, so this claim earns no credits. It still corrects the record.'
          );
        }

        setStage('signing');
        /**
         * `personal_sign` takes the message first and the address second,
         * which is the opposite of `eth_sign` and a common way to get a
         * confusing refusal from the wallet rather than a signature.
         *
         * Its own try, so a rejection here is reported as a rejection and a
         * failure after it is not reported as one.
         */
        let signature: string;
        try {
          signature = (await provider.request({
            method: 'personal_sign',
            params: [challenge.message, wallet],
          })) as string;
        } catch (e) {
          setError(walletFailure(e, 'sign'));
          setStage('idle');
          return;
        }

        setStage('starting');

        /**
         * Withdrawing ends here. It needs no consent version, because taking
         * something back is not agreeing to anything, and no trip to X,
         * because the account half is what is being removed.
         */
        if (mode === 'withdraw') {
          const res = await fetch('/api/claim/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallet,
              issued_at: challenge.issued_at,
              token: challenge.token,
              signature,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setError(json.message ?? 'That withdrawal could not be completed.');
            setStage('idle');
            return;
          }
          setDone(
            'Withdrawn. The pair is out of the index, and this address will not be collected again.'
          );
          setStage('idle');
          return;
        }

        const startRes = await fetch('/api/claim/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet,
            issued_at: challenge.issued_at,
            token: challenge.token,
            signature,
            consent_version: consentVersion,
          }),
        });
        const started = await startRes.json();
        if (!startRes.ok || !started.authorize_url) {
          setError(started.message ?? 'That claim could not be started.');
          setStage('idle');
          return;
        }

        /**
         * A full navigation, not a popup, for the reason the X list flow
         * gives: a popup is blocked often enough that the failure would be
         * invisible, and a consent screen is a page somebody should see at
         * full size with the address bar showing.
         */
        window.location.href = started.authorize_url;
      } catch {
        /**
         * Everything in this try is ours: a fetch, a JSON body, a redirect.
         * None of it is the wallet's doing, so none of it says the wallet
         * failed.
         *
         * It does NOT say nothing was recorded, which the first version did.
         * A request that fails in flight may have been served, so an
         * unfinished claim row can exist; what is certainly true is that no
         * account was attached and nothing reached the index. Saying the
         * stronger thing would be guessing about state we cannot see from
         * here.
         */
        setError('We could not reach the server. Nothing was published.');
        setStage('idle');
      }
    },
    [consentVersion]
  );

  const busy = stage !== 'idle';

  return (
    <div className="rounded-lg border border-border bg-fill-well p-5">
      {/* The heading and the description follow the mode, because the two
          modes take different steps and describing the wrong one is how a
          person ends up waiting for a trip to X that a withdrawal never
          makes. The buttons relabelled here before this text did, which is
          the more misleading half of the two: the instruction is what
          somebody reads to know what is about to happen. */}
      <h2 className="text-lg font-medium">
        {mode === 'withdraw' ? 'Withdraw a claim' : 'Start a claim'}
      </h2>
      {mode === 'withdraw' ? (
        <p className="mt-2 text-sm text-muted-foreground">
          You will sign a message with the wallet you claimed with, and that is
          the whole step. There is no trip to X: the account half is what is
          being removed, so nothing needs to prove it again.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          You will sign a message with your wallet, then sign in to X. Both
          happen in this order because a signature proves the address and the
          sign-in proves the account, and the record needs the pair.
        </p>
      )}

      {/* The account is checked before the wallet, because it is the half we
          can know without asking anybody for anything. */}
      {authLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">One moment…</p>
      ) : !user ? (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">
            A claim belongs to an account, so this needs you signed in. We say
            so here rather than after your wallet asks: approving a connection
            only to be told an account is required spends a prompt on something
            this page already knew.
          </p>
          {/* Soft, not the filled primary, on the LookupHistory precedent: the
              header already carries a Sign in of its own, and two filled
              violet buttons in one view makes neither of them the action. */}
          <Button
            size="sm"
            variant="soft"
            className="mt-3"
            onClick={() => setAuthOpen(true)}
          >
            <SignIn className="h-4 w-4" aria-hidden />
            Sign in
          </Button>
        </div>
      ) : providers === null ? (
        /* Asked, not yet answered. Saying nothing here is the point: the
           alternative told everybody to install a wallet before discovery
           had run. */
        <p className="mt-4 text-sm text-muted-foreground">
          Looking for a wallet…
        </p>
      ) : providers.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No browser wallet announced itself. Install one, or open this page in
          a wallet&rsquo;s own browser. Smart-contract wallets are not supported
          yet: we can only verify a signature made by an ordinary account.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {providers.map((p) => (
            <Button
              key={p.info.uuid}
              variant="outline"
              disabled={busy}
              onClick={() => run(p.provider, mode)}
            >
              {mode === 'withdraw'
                ? `Withdraw with ${p.info.name}`
                : p.info.name}
            </Button>
          ))}
        </div>
      )}

      {/* A mode switch rather than a second control, so both actions get the
          same wallet choice. It is a link rather than a button of equal
          weight: the page should not present taking something back as the
          same size of choice as giving it. It stays on THIS page because the
          page promises withdrawal twice, and a promise whose control lives
          elsewhere is barely a promise.

          Behind the session too. Withdrawing needs one exactly as claiming
          does (the route matches on the session's own user id), so offering
          the switch to somebody signed out would be offering a second action
          that ends at the same 401 as the first. */}
      {user && providers !== null && providers.length > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {mode === 'claim' ? (
            <>
              Claimed before and changed your mind?{' '}
              <Button
                variant="link"
                size="inline"
                disabled={busy}
                onClick={() => setMode('withdraw')}
              >
                Withdraw instead
              </Button>
              , with the same wallet you used.
            </>
          ) : (
            <>
              Withdrawing removes the pair and stops us collecting it again.{' '}
              <Button
                variant="link"
                size="inline"
                disabled={busy}
                onClick={() => setMode('claim')}
              >
                Go back to claiming
              </Button>
              .
            </>
          )}
        </p>
      )}

      {done && (
        <p role="status" className="mt-3 text-sm text-attested">
          {done}
        </p>
      )}

      {/* Above the stage line, because it is the thing worth reading while
          the wallet prompt is open, and `muted` rather than `attested`: this
          is what a claim WOULD be worth, not a measured outcome, and green
          here would mark an expectation as a fact on the one page whose
          subject is that distinction. */}
      {worth && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {worth}
        </p>
      )}

      {busy && (
        <p className="mt-3 text-sm text-muted-foreground">
          {stage === 'connecting' && 'Waiting for your wallet…'}
          {stage === 'signing' && 'Approve the message in your wallet…'}
          {stage === 'starting' && 'Checking the signature…'}
        </p>
      )}

      {error && (
        <div className="mt-3">
          <InlineError>{error}</InlineError>
        </div>
      )}

      {/* `next` is the whole point of opening the modal here.

          Sign-in is a magic link, so it always leaves the page: the person
          reads the mail, presses the link, and `/api/auth/verify` decides
          where they land. Without a return path that is the home page, which
          abandons the thing they were doing. An earlier version of this
          comment claimed the session refreshed in place and the buttons
          simply replaced this card, which was never true of a mailbox round
          trip and is the defect shape scripts/check-invariants.ts exists for.

          `/claim` is one of the two paths `isAllowedReturnPath` accepts. It
          is checked there and not here, because the server's check is the one
          an attacker has to get past. */}
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} next="/claim" />
    </div>
  );
}
