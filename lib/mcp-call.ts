/**
 * Calls a `/v1` route handler in process, from the MCP server.
 *
 * ## Why the MCP layer authenticates nothing
 *
 * Every v1 handler already calls `authenticateApiRequest` itself and already
 * calls `trackApiUsage` itself, and `trackApiUsage` performs the credit debit.
 * A layer that did either of those on top would authenticate twice, increment
 * the rate limiter twice, and bill the caller twice for one tool call. The
 * debit is deliberately not idempotent, so the second charge would be real
 * money.
 *
 * So this layer owns neither. It builds a request carrying the caller's own
 * `Authorization` header, hands it to the handler, and reads the answer back.
 * The handler remains the single place that decides who may call, what it
 * costs, and what gets recorded.
 *
 * Three things follow from that, and each one closes a hole the design review
 * flagged:
 *
 * - `api_usage.endpoint` keeps recording the same six literals the REST
 *   surface records. Nothing keyed by tool name reaches that column, so
 *   `requests_by_endpoint` on `/v1/usage` stays the bounded set the docs
 *   promise, and a client-supplied tool name can never mint a new key.
 * - The rate limiter is entered once per tool call, at the same weight the
 *   equivalent REST call would carry, because it is the same call.
 *   Protocol chatter (`initialize`, `tools/list`) reaches no handler and so is
 *   never metered against a key at all.
 * - MCP prices identically to REST by construction rather than by a table
 *   somebody has to keep in step.
 *
 * ## Everything below is about one thing: the handler must not throw
 *
 * Over HTTP, Next runs a route handler inside its own wrapper and turns a
 * throw into a 500. Called as a plain function that wrapper is not there, so
 * an unhandled throw would escape into the MCP transport and the client would
 * see a dead session instead of a tool error. Hence the try/catch, which
 * produces the same 500 shape the HTTP path would have produced.
 */
import { NextRequest, NextResponse } from 'next/server';

/** The absolute origin every synthetic request is built against. */
const ORIGIN = 'https://walletlink.social';

export interface RouteCallResult {
  status: number;
  /** Parsed body. `null` when the response carried no JSON. */
  json: unknown;
  /**
   * The response headers, verbatim. The v1 handlers report quota there
   * (`X-RateLimit-*`, `X-Matches-Available`), and dropping them here was why
   * a tool caller needed a second call to learn what its first one left.
   */
  headers: Headers;
}

/**
 * A v1 GET handler that takes route params, or one that does not.
 *
 * Written as two shapes rather than one `any`, because the params argument is
 * the part that is easy to get wrong and the compiler is the cheapest place to
 * catch it.
 */
type ParamHandler<P> = (
  request: NextRequest,
  context: { params: Promise<P> }
) => Promise<NextResponse>;

type PlainHandler = (request: NextRequest) => Promise<NextResponse>;

async function readResponse(response: NextResponse): Promise<RouteCallResult> {
  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json, headers: response.headers };
}

/**
 * The shape a thrown handler produces, matching what the HTTP path returns.
 *
 * Not re-thrown, and not surfaced verbatim. A stack trace is neither useful to
 * a model nor safe to hand a stranger, so the caller gets the same opaque
 * message an HTTP consumer would have got, and the detail goes to the log.
 */
function internalError(error: unknown): RouteCallResult {
  console.error('MCP route call threw:', error);
  return {
    status: 500,
    json: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
    headers: new Headers(),
  };
}

function buildRequest(
  path: string,
  init: { method: string; authorization: string; body?: string }
): NextRequest {
  const headers = new Headers({ Authorization: init.authorization });
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  /**
   * The URL must be absolute: `new NextRequest('/v1/stats')` throws before a
   * request exists. It must also carry the query string, because the reverse
   * routes read `cursor` off `request.nextUrl.searchParams`, and `nextUrl` is
   * built from this string inside the constructor.
   */
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method,
    headers,
    /**
     * Omitted entirely rather than passed as null when there is no body.
     * `null` is not the same as absent here: it would be serialised, parsed
     * back to `null`, and then read for a `.wallets` property that a null has
     * no way of carrying.
     */
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

/** Calls a handler whose route has no dynamic segment. */
export async function callRoute(
  handler: PlainHandler,
  path: string,
  init: { method: string; authorization: string; body?: string }
): Promise<RouteCallResult> {
  try {
    return await readResponse(await handler(buildRequest(path, init)));
  } catch (error) {
    return internalError(error);
  }
}

/** Calls a handler whose route has a dynamic segment, such as `{address}`. */
export async function callRouteWithParams<P extends Record<string, string>>(
  handler: ParamHandler<P>,
  path: string,
  params: P,
  init: { method: string; authorization: string }
): Promise<RouteCallResult> {
  try {
    const response = await handler(buildRequest(path, init), {
      params: Promise.resolve(params),
    });
    return await readResponse(response);
  } catch (error) {
    return internalError(error);
  }
}

/**
 * The `{ error, code }` body every v1 failure carries.
 *
 * Read defensively: a 500 produced by something other than `apiError` may not
 * have it, and the fallback has to say something rather than nothing.
 */
export function errorTextFrom(result: RouteCallResult): string {
  const body = result.json;
  if (body && typeof body === 'object') {
    const { error, code } = body as { error?: unknown; code?: unknown };
    if (typeof error === 'string' && typeof code === 'string') {
      return `${error} (${code})`;
    }
    if (typeof error === 'string') return error;
  }
  return `The API answered ${result.status} with no readable message.`;
}
