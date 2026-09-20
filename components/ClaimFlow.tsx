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
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/inline-error';

/** The slice of EIP-1193 this flow uses. */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface Announced {
  info: { uuid: string; name: string; rdns: string };
  provider: Eip1193Provider;
}

type Stage = 'idle' | 'connecting' | 'signing' | 'starting';

export function ClaimFlow({ consentVersion }: { consentVersion: string }) {
  const [providers, setProviders] = useState<Announced[]>([]);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);

  /**
   * EIP-6963 discovery. Providers answer the request event by announcing, so
   * the listener goes up before the request goes out.
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
    return () =>
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  const claim = useCallback(
    async (provider: Eip1193Provider) => {
      setError(null);
      setStage('connecting');
      try {
        const accounts = (await provider.request({
          method: 'eth_requestAccounts',
        })) as string[];
        const wallet = accounts?.[0]?.toLowerCase();
        if (!wallet) {
          setError('That wallet did not return an address.');
          setStage('idle');
          return;
        }

        const challengeRes = await fetch(
          `/api/claim/challenge?wallet=${encodeURIComponent(wallet)}`
        );
        const challenge = await challengeRes.json();
        if (!challengeRes.ok) {
          setError(challenge.message ?? 'We could not start a claim.');
          setStage('idle');
          return;
        }

        setStage('signing');
        /**
         * `personal_sign` takes the message first and the address second,
         * which is the opposite of `eth_sign` and a common way to get a
         * confusing refusal from the wallet rather than a signature.
         */
        const signature = (await provider.request({
          method: 'personal_sign',
          params: [challenge.message, wallet],
        })) as string;

        setStage('starting');
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
      } catch (e) {
        /**
         * A rejected signature is a decision, not a fault. EIP-1193 gives it
         * code 4001, and telling somebody their signature failed when they
         * pressed Cancel is the kind of message that makes people distrust
         * the next one.
         */
        const code = (e as { code?: number })?.code;
        setError(
          code === 4001
            ? 'You cancelled that. Nothing was recorded.'
            : 'That wallet could not complete the signature.'
        );
        setStage('idle');
      }
    },
    [consentVersion]
  );

  const busy = stage !== 'idle';

  return (
    <div className="rounded-lg border border-border bg-fill-well p-5">
      <h2 className="text-lg font-medium">Start a claim</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You will sign a message with your wallet, then sign in to X. Both happen
        in this order because a signature proves the address and the sign-in
        proves the account, and the record needs the pair.
      </p>

      {providers.length === 0 ? (
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
              onClick={() => claim(p.provider)}
            >
              {p.info.name}
            </Button>
          ))}
        </div>
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
    </div>
  );
}
