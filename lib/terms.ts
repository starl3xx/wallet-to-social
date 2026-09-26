import { PRODUCTION_URL } from '@/lib/site-url';

/**
 * The version of the terms of service in force, and the one place it is set.
 *
 * ## Why a purchase records it
 *
 * Decided 2026-09-25 (Linear STA-47): a footer link for everyone, and an
 * explicit agreement where money changes hands. The card checkout asks for an
 * unchecked "I agree" box to be ticked before it will open Stripe. The onchain
 * buy cannot add a required field without breaking the agents that already
 * call it, so its 402 challenge discloses the terms instead, and paying is the
 * acceptance. Either way the lot the purchase creates records which terms were
 * agreed to and when, in `credit_lots.terms_version` and `terms_accepted_at`.
 * A record of acceptance that cannot say WHICH terms were accepted is a
 * timestamp and nothing more.
 *
 * ## What the other forms say, and why they record nothing
 *
 * Decided 2026-09-26. The checkbox is an agreement to the terms and names
 * only them: a privacy policy is a notice of what we do with data, not
 * something a buyer agrees to, so the checkout links it on a line of its own,
 * outside the label. Signing in shows a notice under the form, "By continuing
 * you agree to the Terms and acknowledge the Privacy Policy"
 * (`components/SignInNotice.tsx`), and records nothing: acceptance is
 * recorded at purchase, where the terms page says it is.
 *
 * ## Why an ISO date
 *
 * The terms page says when it was last updated, and the version is that date,
 * so the page cannot print one date while purchases record another. The page
 * imports `TERMS_UPDATED` below rather than typing its own, and
 * `scripts/check-invariants.ts` refuses a second copy anywhere. A date sorts,
 * needs no registry, and names the day to read the page at in git history.
 *
 * ## Changing the terms
 *
 * Change this constant in the same commit as the page. A checkout opened under
 * the old version and paid after the deploy still records the old one: the
 * version travels in the Stripe metadata written when the buyer ticked the
 * box, not in whatever code happens to be live when the webhook lands. A
 * browser still showing the old version is refused at checkout and asked to
 * reload, so nobody is recorded as agreeing to terms their page never showed.
 */
export const TERMS_VERSION = '2026-09-25';

export const TERMS_PATH = '/terms';

/** The privacy policy, which the checkout and sign-in link as a notice. */
export const PRIVACY_PATH = '/privacy';

/** Absolute, for the surfaces a machine reads: the x402 challenge, errors. */
export const TERMS_URL = `${PRODUCTION_URL}${TERMS_PATH}`;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const VERSION_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether a value is a terms version: an ISO date that exists on a calendar.
 *
 * The shape alone would accept `2026-02-30`, and a version is a claim about
 * which page somebody read. The date is rebuilt and compared, so a day that
 * rolls over into the next month is refused rather than silently moved.
 */
export function isTermsVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = VERSION_SHAPE.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() + 1 === Number(m[2]) &&
    d.getUTCDate() === Number(m[3])
  );
}

/**
 * "25 September 2026": the version as the terms page prints it.
 *
 * Formatted by hand rather than through `toLocaleDateString`, so the server
 * render and the browser cannot disagree about a locale.
 */
function updatedLabel(version: string): string {
  const [year, month, day] = version.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export const TERMS_UPDATED = updatedLabel(TERMS_VERSION);

/** Which terms a purchase agreed to, and when. */
export interface TermsAcceptance {
  version: string;
  acceptedAt: Date;
}

/**
 * The acceptance as Stripe metadata, for the session and its PaymentIntent.
 *
 * Both, for the reason `metadata.pack` is on both: the webhook has two
 * provisioning paths and either may be the one that fires, and the success
 * page's poll is a third. An acceptance visible on only one of them is a
 * purchase recorded without it.
 */
export function termsMetadata(acceptance: TermsAcceptance): {
  terms_version: string;
  terms_accepted_at: string;
} {
  return {
    terms_version: acceptance.version,
    terms_accepted_at: acceptance.acceptedAt.toISOString(),
  };
}

/**
 * The acceptance a paid Stripe session or PaymentIntent carries, or null.
 *
 * Null is not a refusal. By the time this runs the buyer has paid, and a
 * purchase is granted whatever this returns: a session opened before the
 * checkbox shipped carries no acceptance, and taking the money while
 * withholding the credits over a missing record would be the worse failure.
 * The lot then records NULL, which says truthfully that no agreement was
 * captured, rather than stamping a version nobody was shown.
 *
 * Any version is accepted, not only the current one: a session opened under
 * the previous terms and paid after they changed agreed to the previous terms.
 */
export function termsAcceptanceFrom(
  metadata: Record<string, string> | null | undefined
): TermsAcceptance | null {
  const version = metadata?.terms_version;
  const at = metadata?.terms_accepted_at;
  if (!isTermsVersion(version) || typeof at !== 'string') return null;
  const acceptedAt = new Date(at);
  if (Number.isNaN(acceptedAt.getTime())) return null;
  return { version, acceptedAt };
}

/**
 * The acceptance an onchain payment carries: the payment itself.
 *
 * The 402 challenge names `TERMS_URL` and `TERMS_VERSION` before anything is
 * signed, so a settled payment is an agreement to the version in force when it
 * settled. Called by the grant, which runs directly after settlement.
 */
export function acceptanceByPayment(at: Date = new Date()): TermsAcceptance {
  return { version: TERMS_VERSION, acceptedAt: at };
}

/**
 * The two `credit_lots` columns, from an acceptance or its absence.
 *
 * One function, so a lot always carries both or neither: a version with no
 * time, or a time with no version, is a record nobody can stand behind.
 */
export function termsColumns(acceptance: TermsAcceptance | null): {
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
} {
  return acceptance
    ? {
        termsVersion: acceptance.version,
        termsAcceptedAt: acceptance.acceptedAt,
      }
    : { termsVersion: null, termsAcceptedAt: null };
}
