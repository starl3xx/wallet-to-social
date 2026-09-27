import { PRIVACY_PATH, TERMS_PATH } from '@/lib/terms';
import { cn } from '@/lib/utils';

/**
 * The line under every sign-in form: the terms, and the privacy policy.
 *
 * A notice, not an agreement (decided 2026-09-26, STA-47). It asks for no
 * tick and records nothing; the agreement that is recorded is the one made at
 * purchase. "Acknowledge" for the privacy policy, because a policy is a
 * statement of what we do, not a promise the reader makes.
 *
 * One component, so every sign-in form says the same sentence.
 * `scripts/check-invariants.ts` finds the forms by what they call, the
 * magic-link route, and refuses one that does not render this.
 *
 * Both links open a new tab, so reading them does not throw away the address
 * already typed or, on the consent screen, the request waiting behind it.
 */
export function SignInNotice({ className }: { className?: string }) {
  return (
    <p
      data-notice="sign-in"
      className={cn('text-xs text-muted-foreground', className)}
    >
      By continuing you agree to the{' '}
      <a
        href={TERMS_PATH}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-brand underline underline-offset-4"
      >
        Terms
      </a>{' '}
      and acknowledge the{' '}
      <a
        href={PRIVACY_PATH}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-brand underline underline-offset-4"
      >
        Privacy Policy
      </a>
      .
    </p>
  );
}
