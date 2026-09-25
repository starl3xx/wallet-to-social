/**
 * Masks email addresses and wallet addresses in server log lines.
 *
 * The host keeps function logs, and a log line is a copy of whatever it
 * printed, held outside every control the schema enforces. Two kinds of line
 * put customer identifiers there:
 *
 * - a line that interpolates one on purpose ("Granted 250 matches to
 *   <email>"). These call `maskEmail` or `maskWallet` at the call site, and
 *   `scripts/check-invariants.ts` refuses a `console.*` call that
 *   interpolates a raw email or wallet variable.
 * - an error object printed whole. A failed Drizzle query carries its
 *   parameters in its message (`DrizzleQueryError`: "Failed query: ...
 *   params: ..."), so a cache write that fails prints every wallet in the
 *   batch, and a failed signup prints the email. No call site can mask
 *   those, so `redactConsole` below masks every line the server prints,
 *   installed once per server instance by `instrumentation.ts`.
 *
 * What survives is what debugging needs: the first letters of an email and
 * its whole domain, and the first 6 and last 4 characters of a wallet
 * (`0x1234...abcd`), which is enough to match a log line against a row an
 * operator already holds. Neither mask can match its own pattern again, so
 * masking twice changes nothing: a call site that masks and the console net
 * that masks again print the same line.
 *
 * No Node imports, so any module can use the helpers; `redactConsole` takes
 * the formatter as an argument for the same reason.
 */

/**
 * An email address inside free text. Deliberately loose: a false positive
 * masks something that was not an email, which costs a little debugging
 * context; a false negative prints somebody's address.
 *
 * Every repeat is bounded, and that is load-bearing. With `+` in place of
 * `{1,64}`, each start position in a long run of letters (a base64 blob, a
 * long token) scans to the end of the run looking for an `@`, which is
 * quadratic: a 40 KB run took a second and a 400 KB one would take minutes,
 * on every log line that printed it. Bounded, the same 40 KB takes about
 * 10 ms. The bounds are the RFC limits (64 for the local part, 63 per
 * domain label) plus room for subdomains, so no real address is missed.
 */
const EMAIL_IN_TEXT =
  /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;

/**
 * An EVM address inside free text: exactly 40 hex digits after `0x`. The
 * word boundaries keep a 64-digit transaction hash or EIP-3009 nonce whole,
 * because the character after the 40th digit is another hex digit.
 */
const WALLET_IN_TEXT = /\b0x[0-9a-fA-F]{40}\b/g;

/** `alice.smith@example.com` becomes `al***@example.com`. */
export function maskEmail(email: string | null | undefined): string {
  if (email === null || email === undefined) return String(email);
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  // Two letters when the local part is long enough that two do not give most
  // of it away; one otherwise.
  const keep = local.length > 4 ? 2 : 1;
  return `${local.slice(0, keep)}***${email.slice(at)}`;
}

/** `0x1234567890...abcd` (42 characters) becomes `0x1234...abcd`. */
export function maskWallet(wallet: string | null | undefined): string {
  if (wallet === null || wallet === undefined) return String(wallet);
  // Too short to hide anything by eliding the middle: mask it all.
  if (wallet.length <= 12) return '***';
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

/** Every email and every wallet address in `text`, masked. */
export function redact(text: string): string {
  return text
    .replace(EMAIL_IN_TEXT, (email) => maskEmail(email))
    .replace(WALLET_IN_TEXT, (wallet) => maskWallet(wallet));
}

/** The console methods a server log line comes out of. */
export const REDACTED_CONSOLE_METHODS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
] as const;

const INSTALLED = Symbol.for('walletlink.redactConsole');

/**
 * Route every line `target` prints through `redact`.
 *
 * `format` is `util.format` from Node, which is what `console.log` itself
 * uses to turn its arguments into a line, so the printed text is the same
 * text the console would have printed, masked. An error object is formatted
 * with its stack, its cause and its own fields (a Drizzle error's `params`
 * among them) before the mask runs, which is the point.
 *
 * A line that cannot be formatted is withheld rather than printed raw: the
 * fallback for a privacy control cannot be the thing it controls. Installing
 * twice is a no-op, because a dev server can run `register` more than once.
 */
export function redactConsole(
  target: Pick<Console, (typeof REDACTED_CONSOLE_METHODS)[number]>,
  format: (...args: unknown[]) => string
): void {
  const marked = target as unknown as Record<symbol, boolean>;
  if (marked[INSTALLED]) return;
  marked[INSTALLED] = true;

  for (const method of REDACTED_CONSOLE_METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      let line: string;
      try {
        line = redact(format(...args));
      } catch {
        line = '[log line withheld: it could not be formatted for redaction]';
      }
      original(line);
    };
  }
}
