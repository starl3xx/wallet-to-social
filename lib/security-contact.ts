/**
 * The security contact: where a vulnerability report goes, published as
 * /.well-known/security.txt (RFC 9116) and named again in the root SECURITY.md.
 *
 * One authority for both. The route in `app/api/security-txt` serves what
 * `securityTxt()` returns, and `scripts/check-invariants.ts` parses that
 * output and checks SECURITY.md against it, so the machine-readable file and
 * the policy a person reads cannot name different channels.
 *
 * ## The contacts, in order
 *
 * RFC 9116 section 2.5.3 makes the first Contact the preferred one, so order
 * is a statement and not a layout choice.
 *
 * 1. **GitHub private vulnerability reporting**, first. It is confidential by
 *    construction, it does not depend on the domain's mail setup, and it
 *    stands in for an Encryption field: there is no OpenPGP key to publish.
 * 2. **security@walletlink.social**, second. RFC 9116 points security
 *    addresses at the RFC 2142 conventions, which name SECURITY@, so it is
 *    the address a researcher guesses. It is an alias on the Workspace user
 *    who reads help@, not a Google Group: a new group can refuse mail from
 *    outside the domain, which would bounce exactly the senders this is for.
 *
 * help@ is deliberately absent. It is the same mailbox, so it adds no
 * redundancy, and listing it would mix the security queue into support.
 *
 * ## Unsigned
 *
 * Section 2.3 RECOMMENDS an OpenPGP cleartext signature and does not require
 * one. No key exists, and a signature from a key nobody can verify out of
 * band adds bytes, not trust. Revisit if a key is ever published.
 *
 * ## Canonical is built from PRODUCTION_URL
 *
 * Never from `getSiteUrl()`. A preview deployment serves this file too, and
 * it must not claim to be the canonical copy (the same rule as the API
 * catalog's own URL in `app/api/api-catalog/route.ts`).
 *
 * ## Renewal
 *
 * Section 2.5.5 requires Expires and recommends less than a year. A consumer
 * ignores an expired file silently, and section 5.3 prefers no file to one
 * with stale contacts. So the date is only ever moved after the contacts are
 * proven again:
 *
 * 1. send a test report to each channel from outside the domain;
 * 2. set SECURITY_CONTACT_VERIFIED to the day that passed;
 * 3. set SECURITY_TXT_EXPIRES about six months later, and always less than
 *    365 days after SECURITY_CONTACT_VERIFIED.
 *
 * The invariants check Expires against SECURITY_CONTACT_VERIFIED and never
 * against the clock, so no PR turns red because of the date it runs on. The
 * clock is checked by `.github/workflows/security-contact.yml` every Monday,
 * which fails when fewer than 30 days remain. docs/OPERATIONS.md has the
 * procedure.
 *
 * ## Why the strings below look the way they do
 *
 * `scripts/check-house-style.mjs` reads string literals under lib/, so the
 * comment lines avoid apostrophes, three dots, a spaced hyphen and the em
 * dash.
 */
import { PRODUCTION_URL } from '@/lib/site-url';

/** GitHub private vulnerability reporting. The preferred channel. */
export const SECURITY_REPORT_URL =
  'https://github.com/starl3xx/wallet-to-social/security/advisories/new';

/** The mailbox a researcher guesses first (RFC 2142). The second channel. */
export const SECURITY_EMAIL = 'security@walletlink.social';

/** GitHub renders the root SECURITY.md here. */
export const SECURITY_POLICY_URL =
  'https://github.com/starl3xx/wallet-to-social/security/policy';

/**
 * The day both channels were last proven to deliver: a test report sent from
 * outside the domain arrived. Expires is measured from this, not from today.
 */
export const SECURITY_CONTACT_VERIFIED = '2026-09-24';

/** RFC 3339, UTC. Under a year after SECURITY_CONTACT_VERIFIED. */
export const SECURITY_TXT_EXPIRES = '2027-03-31T00:00:00Z';

/** Where the file is served, and so its Canonical. */
export const SECURITY_TXT_URL = `${PRODUCTION_URL}/.well-known/security.txt`;

/**
 * The file, as RFC 9116 section 2.2 wants it: every line ends in a newline,
 * the last one included.
 */
export function securityTxt(): string {
  const lines = [
    '# Report security vulnerabilities in walletlink.social here.',
    '# The first Contact is preferred. Scope, testing rules and response times are in the policy.',
    `Contact: ${SECURITY_REPORT_URL}`,
    `Contact: mailto:${SECURITY_EMAIL}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    'Preferred-Languages: en',
    `Canonical: ${SECURITY_TXT_URL}`,
    `Policy: ${SECURITY_POLICY_URL}`,
  ];
  return `${lines.join('\n')}\n`;
}
