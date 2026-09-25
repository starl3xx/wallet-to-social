/**
 * Runs once per server instance, before any request is handled.
 *
 * It installs the log redaction in `lib/redact.ts`: every line the Node
 * runtime prints through `console` has its email addresses and wallet
 * addresses masked before it reaches the host's function logs. The call
 * sites that print an identifier on purpose mask it themselves; this is the
 * net for the lines no call site controls, an error object printed whole
 * being the common one (a failed Drizzle query carries its parameters in its
 * message).
 *
 * Node only. The edge routes (the social cards and the Open Graph images)
 * print no identifiers, and `node:util` does not exist there.
 */
export async function register() {
  // The shape Next documents: the build replaces NEXT_RUNTIME per runtime, so
  // the edge bundle drops this branch and never sees `node:util`.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { format } = await import('node:util');
    const { redactConsole } = await import('@/lib/redact');
    redactConsole(console, format);
  }
}
