/**
 * The two questions asked about a JSON-RPC body before the MCP layer sees it.
 *
 * They live here rather than beside the handler for one reason: a Next.js route
 * file may export only its handlers and its config, so a predicate defined
 * there cannot be imported by `scripts/check-invariants.ts`. The gate is the
 * part of the MCP server most worth asserting against, and an assertion that
 * cannot reach the code it is about is not an assertion.
 *
 * The two questions look similar and are opposites, which is the thing to hold
 * on to when editing either.
 */

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function methodsIn(raw: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  return calls.map((call) => {
    const method = asObject(call)?.method;
    return typeof method === 'string' ? method : '';
  });
}

/**
 * The only JSON-RPC methods that reach something which meters.
 *
 * An allowlist of the metered side, deliberately, because the first version
 * allowlisted the other side and that was the wrong way round. It named the
 * handshake methods and bounded those, so every method it had not thought of,
 * `resources/read`, `prompts/get`, `notifications/cancelled` and any string a
 * caller invented, fell through to the unbounded branch. The MCP layer refuses
 * all of those, which means they reach no meter at all, which is exactly the
 * surface the limit exists to cover.
 *
 * Listing what is metered cannot fail that way. A method missing from this set
 * is bounded, which is the safe direction, and adding one is a deliberate act
 * by somebody who has checked that it reaches a handler that charges for it.
 */
export const METERED_METHODS = new Set(['tools/call']);

/**
 * Whether every call in this body reaches a per-key meter, and may therefore
 * skip the IP limit.
 *
 * `every`, not `some`. A batch of ninety-nine `tools/list` calls with one
 * `tools/call` appended would otherwise buy the whole batch a free pass, and
 * the appended call costs an attacker nothing when the key is junk. A mixed
 * batch is therefore bounded, which costs a real client one count out of 120
 * an hour and costs that attacker the entire budget.
 *
 * A body that is not JSON, or carries no method, is not metered either: it is
 * refused before it reaches a handler, so it belongs on the bounded side.
 */
export function isMetered(raw: string): boolean {
  const methods = methodsIn(raw);
  if (methods === null || methods.length === 0) return false;
  return methods.every((method) => METERED_METHODS.has(method));
}

/**
 * Whether this body contains a `tools/call`, and therefore needs a credential.
 *
 * The opposite quantifier to `isMetered`, on purpose. That one asks whether
 * *every* call is metered so it can decide about the IP limit; this asks
 * whether *any* is, so it can decide about the 401. A batch mixing `tools/list`
 * with a `tools/call` has to be challenged, or the challenge is skipped by
 * appending a handshake method to it, which is the same mistake in the other
 * direction.
 *
 * Both are safe: a mixed batch is bounded by the IP limit *and* challenged.
 */
export function callsATool(raw: string): boolean {
  const methods = methodsIn(raw);
  if (methods === null) return false;
  return methods.some((method) => METERED_METHODS.has(method));
}
