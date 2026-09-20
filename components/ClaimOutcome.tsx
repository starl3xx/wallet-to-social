'use client';

/**
 * What the person sees when X sends them back.
 *
 * The callback redirects to `/claim?claim=<outcome>`, and without this the
 * page rendered its start form again: somebody who had just signed a message
 * and consented on x.com would be shown the beginning of the flow, with
 * nothing saying whether anything was recorded. That failure already happened
 * once in this codebase, on the X list banner, and it is worth naming rather
 * than quietly fixing twice.
 *
 * ## Every outcome gets its own sentence
 *
 * A generic "something went wrong" is the wrong answer to eight different
 * situations, two of which are not wrong at all. Cancelling is a decision.
 * A claim that completed is the whole point. The rest differ in whether the
 * person should retry, wait, or write to us, and only a specific sentence can
 * say which.
 *
 * ## The parameters are removed once read
 *
 * Same rule as the X list banner: a refresh must not replay a one-time
 * outcome, and a shared URL must not carry somebody's claim id.
 */
import { useState, useEffect } from 'react';

/**
 * The tone decides the mark, and the mark is not decoration.
 *
 * `attested` green is a measured fact, which a completed claim is: the owner
 * proved both halves and the record says so. Everything else is either a
 * decision the person made or a state to act on, and neither earns green.
 */
type Tone = 'done' | 'neutral' | 'caution';

const OUTCOMES: Record<string, { tone: Tone; title: string; detail: string }> =
  {
    completed: {
      tone: 'done',
      title: 'Your address is claimed',
      detail:
        'Your proof is recorded. Where we held nothing, the record now names your account; where we held a different one, your disagreement is on file and settles when the handle we serve stops reaching anyone. If your address qualified and this was the first claim for your X account, the matches are on your balance.',
    },
    cancelled: {
      tone: 'neutral',
      title: 'You cancelled at X',
      detail:
        'No account was attached and nothing was published. The signature you made is kept with the unfinished claim, which expires after thirty minutes.',
    },
    refused: {
      tone: 'caution',
      title: 'X refused the authorization',
      detail:
        'No account was attached and nothing was published. You can start again whenever you like.',
    },
    signed_out: {
      tone: 'caution',
      title: 'You were signed out on the way back',
      detail:
        'A claim has to finish in the account that started it. Sign in and start again.',
    },
    not_found: {
      tone: 'caution',
      title: 'That claim could not be matched',
      detail:
        'It may have expired, or already been finished. Claims last thirty minutes. Starting again is safe.',
    },
    exchange_failed: {
      tone: 'caution',
      title: 'X did not complete the sign-in',
      detail:
        'No account was attached and nothing was published. This is usually temporary; trying again shortly is the right move.',
    },
    identity_failed: {
      tone: 'caution',
      title: 'We could not read your account name',
      detail:
        'You authorized us, but the account read did not come back, so nothing was published. Please try again, and write to us if it happens twice.',
    },
    invalid: {
      tone: 'caution',
      title: 'That link was incomplete',
      detail:
        'No account was attached and nothing was published. Start the claim again from this page.',
    },
    unavailable: {
      tone: 'caution',
      title: 'Claiming is unavailable right now',
      detail:
        'No account was attached and nothing was published. Please try again later.',
    },
  };

export function ClaimOutcome() {
  const [outcome, setOutcome] = useState<string | null>(null);

  /**
   * eslint-disable-next-line is deliberate and narrow, matching the reasoning
   * `XListStatus` records: reading the URL is subscribing to an external
   * system and happens once on mount. A lazy `useState` initializer would
   * read `window` during render and produce a hydration mismatch instead.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('claim');
    if (!value) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setOutcome(value);

    params.delete('claim');
    params.delete('claim_id');
    const rest = params.toString();
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (rest ? `?${rest}` : '')
    );
  }, []);

  if (!outcome) return null;

  /**
   * An outcome this build does not know is still an outcome. Saying nothing
   * would put the person back where they started, which is the defect this
   * component exists for, so an unknown value gets the honest version of the
   * message rather than silence.
   */
  const shown = OUTCOMES[outcome] ?? {
    tone: 'caution' as Tone,
    title: 'That claim did not finish',
    detail:
      'No account was attached and nothing was published. Starting again from this page is safe.',
  };

  return (
    <div
      role="status"
      className={
        shown.tone === 'done'
          ? 'mb-8 rounded-lg border border-attested bg-attested-tint p-5'
          : shown.tone === 'caution'
            ? 'mb-8 rounded-lg border border-border bg-caution-tint p-5'
            : 'mb-8 rounded-lg border border-border bg-fill-well p-5'
      }
    >
      <p className="font-medium">{shown.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{shown.detail}</p>
    </div>
  );
}
