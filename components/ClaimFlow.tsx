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

/** One completed pairing, as `GET /api/claim/mine` reports it. */
interface Held {
  wallet: string;
  handle: string | null;
  granted_matches: number;
  completed_at: string | null;
}

/**
 * An address in the shape a person can compare against their wallet.
 *
 * Both ends kept, never a prefix: the first four characters of an address are
 * shared by a great many of them, and the point of showing it at all is that
 * somebody can tell WHICH of their wallets this is.
 */
function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

/** The day it happened, or nothing, rather than a guess. */
function heldOn(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
}

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
   * What we already hold for this account.
   *
   * `null` is "not asked yet", the same distinction `providers` draws and for
   * the same reason: an empty array renders "you have not claimed anything",
   * which is a statement, and making it before the fetch answers would be
   * telling somebody who claimed an hour ago that they had not.
   *
   * It lives here rather than in a sibling component so that a withdrawal can
   * refetch it. A list owned elsewhere would still be showing the pairing
   * that was just removed, on the same screen as the sentence saying it was
   * removed, which is the kind of contradiction this flow keeps being audited
   * for.
   */
  const [held, setHeld] = useState<Held[] | null>(null);

  /**
   * A failed read leaves what we already knew, and never invents an answer.
   *
   * The first version set `null` on failure, which is right for the first
   * load (no panel, because nothing was learned) and wrong for every later
   * one: a refetch that failed after a withdrawal hid EVERY remaining claim,
   * so removing one pairing could make somebody's other addresses vanish.
   * Leaving the previous array alone is the smaller error, and the withdrawal
   * path below drops the removed wallet itself rather than relying on this.
   */
  const loadHeld = useCallback(async () => {
    try {
      const res = await fetch('/api/claim/mine');
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.claims)) setHeld(json.claims);
    } catch {
      // Same reasoning: keep what we had.
    }
  }, []);

  /**
   * Only once there is a session to read them for.
   *
   * Signing out clears nothing here on purpose: the panel is gated on `user`
   * where it renders, so a stale array cannot reach the screen. Changing
   * account refires this (the dependency is the user) and the fetch replaces
   * the array with the new session's.
   *
   * The disable is the narrow one `ClaimOutcome` already carries, and for a
   * reason the rule itself states: its second permitted shape is to
   * "subscribe for updates from some external system, calling setState in a
   * callback function". `loadHeld` sets state after an await, so nothing here
   * is synchronous and no cascading render is possible; the lint cannot see
   * through the async boundary to tell. Restructuring to satisfy it would
   * mean fetching somewhere that is not mount, which is worse code to quiet
   * a rule that is not describing this.
   */
  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    void loadHeld();
  }, [user, loadHeld]);

  /**
   * The only way the mode changes, so what belongs to the old one goes with
   * it.
   *
   * `worth` was cleared at the start of `run` and nowhere else, so a claim
   * that failed or was cancelled left its credit sentence on screen, and
   * switching to withdraw put "qualifies for 250 matches" directly above a
   * flow that pays nothing. The comment on `setWorth` already said a
   * withdrawal must not quote a reward; the code just had a second path to
   * the same screen that never asked it.
   *
   * The error and the outcome go too. Both describe the action that was on
   * screen a moment ago, and carrying "you cancelled that" into the other
   * mode attributes it to the wrong thing.
   */
  const switchMode = useCallback((to: 'claim' | 'withdraw') => {
    setMode(to);
    setWorth(null);
    setError(null);
    setDone(null);
  }, []);

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
         *
         * QUALIFIES, never "credits". `earns_credits` is `walletPredatesCutoff`
         * and nothing else, while `maybeGrant` can still refuse on the
         * per-account unique index or the budget. The first version of this
         * line said the claim "credits N matches once it completes", so a
         * second pre-cutoff address claimed with an X account that had
         * already been paid was promised money and then not paid: a false
         * statement about a grant, inside the change whose whole subject is
         * a false statement about a grant. The address test is the only part
         * this response can answer, so it is the only part this sentence
         * asserts, and the condition it cannot see is named rather than
         * omitted.
         */
        if (mode === 'claim') {
          setWorth(
            challenge.earns_credits
              ? `We already knew this address, so it qualifies for ${challenge.grant_matches} matches. One claim is paid per X account, so this credits nothing if you have already been paid for one.`
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
          /**
           * The panel loses this pairing BEFORE the sentence claiming it did.
           *
           * Refetch-then-announce still put the removed address on screen
           * beside "Withdrawn" for the length of a round trip, and a refetch
           * that failed left it there indefinitely. Dropping it locally
           * first makes the panel agree with the message at the moment the
           * message appears, and owes nothing to a second request; the
           * refetch that follows only reconciles the rest.
           */
          setHeld((current) =>
            current ? current.filter((h) => h.wallet !== wallet) : current
          );
          setDone(
            'Withdrawn. The pair is out of the index, and this address will not be collected again.'
          );
          setStage('idle');
          /**
           * Reconciled after the fact, and deliberately not awaited.
           *
           * Awaiting it put a GET on the success path: a slow or hung
           * `/api/claim/mine` left the card reading "Checking the signature…"
           * with every control disabled, for a withdrawal that had already
           * succeeded. The panel is already correct without it, because the
           * line above drops the removed pair locally; this only catches
           * anything else that moved, so it can take as long as it likes.
           */
          void loadHeld();
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
    [consentVersion, loadHeld]
  );

  const busy = stage !== 'idle';

  return (
    <div className="rounded-lg border border-border bg-fill-well p-5">
      {/* What we hold, above the thing that asks for more.

          Until this existed the page showed an identical card to somebody
          who had claimed an hour earlier and somebody who never had, and the
          only confirmation that ever appeared was a banner whose URL
          parameter is stripped as it is read. One reload and there was no
          way to learn what happened, while the row sat in the database
          saying completed.

          `attested` is right here and is right nowhere else on this card: a
          completed claim is a measured fact, published by the owner, which is
          exactly what that token is reserved for. The eligibility line above
          stays muted because it is an expectation. */}
      {user && held && held.length > 0 && (
        <div className="mb-5 rounded-lg border border-attested bg-attested-tint p-4">
          <p className="text-sm font-medium">
            {held.length === 1
              ? 'You have claimed one address'
              : `You have claimed ${held.length} addresses`}
          </p>
          <ul className="mt-2 space-y-1">
            {held.map((h) => (
              <li key={h.wallet} className="text-sm text-muted-foreground">
                <span className="font-mono">{shortWallet(h.wallet)}</span>
                {h.handle ? ` names @${h.handle}` : ' is claimed'}
                {heldOn(h.completed_at) ? `, ${heldOn(h.completed_at)}` : ''}
                {/* Said only where it happened. A claim that earned nothing
                    is not a failure, and printing "0 matches" beside it
                    would read as one. */}
                {h.granted_matches > 0
                  ? `, and earned ${h.granted_matches} matches`
                  : ''}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            To remove one, switch to withdrawing below and sign with that same
            address.
          </p>
        </div>
      )}

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
                onClick={() => switchMode('withdraw')}
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
                onClick={() => switchMode('claim')}
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
