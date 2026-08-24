/**
 * The walletlink.social MCP server.
 *
 * Five tools over the six `/v1` endpoints, so an agent can resolve a wallet to
 * its social identities without a human first reading an API reference.
 *
 * ## It authenticates nothing and bills nothing
 *
 * Each tool builds a request carrying the caller's own bearer key and hands it
 * to the v1 handler, which already owns authentication, rate limiting and the
 * credit debit. See `lib/mcp-call.ts` for why doing any of that here would
 * charge the caller twice for one tool call.
 *
 * A consequence worth stating: `initialize` and `tools/list` reach no handler,
 * so a client with no key, or with an empty balance, can still discover what
 * this server offers. A discovery handshake that answered 402 would look to
 * every client like a server that is simply broken.
 *
 * Anonymous discovery is therefore unmetered against any key, which is what
 * the IP limit below is for.
 *
 * ## A note for whoever edits the tool descriptions
 *
 * `scripts/check-design-language.mjs` walks `app/` and greps every line that is
 * not a comment, including the inside of a string. It cannot tell a Tailwind
 * class from an English word, so ordinary prose fails CI. Confirmed to fire
 * here: the standalone word `rounded`, the word for capital letters, and any
 * hyphenated `text-primary` / `to-primary` / `from-primary` / `border-primary`.
 * Run `node scripts/check-design-language.mjs` after any copy edit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { API_PLANS, CREDIT_API_PLAN } from '@/lib/api-plans';
import { checkIpRateLimit, getClientIp } from '@/lib/ip-rate-limiter';
import {
  callRoute,
  callRouteWithParams,
  errorTextFrom,
  type RouteCallResult,
} from '@/lib/mcp-call';
import { GET as walletGet } from '@/app/api/v1/wallet/[address]/route';
import { POST as batchPost } from '@/app/api/v1/batch/route';
import { GET as reverseTwitterGet } from '@/app/api/v1/reverse/twitter/[handle]/route';
import { GET as reverseFarcasterGet } from '@/app/api/v1/reverse/farcaster/[username]/route';
import { GET as statsGet } from '@/app/api/v1/stats/route';
import { GET as usageGet } from '@/app/api/v1/usage/route';

export const runtime = 'nodejs';

/**
 * The batch ceiling every credit pack carries, imported rather than written as
 * 50. The API enforces `context.plan.maxBatchSize`, and a literal here would
 * be a second copy of a number that lives in `lib/api-plans.ts`.
 */
const MAX_ADDRESSES = API_PLANS[CREDIT_API_PLAN].maxBatchSize;

// --- result helpers ---------------------------------------------------------

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(payload: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * A failed call is a tool error, never a transport error.
 *
 * The v1 handlers answer 401, 402, 429 and 400 with a message written for a
 * human. Letting those statuses reach the MCP client would end the JSON-RPC
 * session in most of them, and the person on the other end would see a broken
 * connection rather than "no credits left, buy a pack". So the HTTP result is
 * always 200 at this layer, and the failure travels as content the model can
 * read out.
 */
function failed(result: RouteCallResult): ToolResult {
  return {
    content: [{ type: 'text', text: errorTextFrom(result) }],
    isError: true,
  };
}

const NO_KEY =
  'No API key was sent. Add an Authorization header with a walletlink.social key (Bearer wts_live_...) to this server’s configuration. Keys are self-serve at https://walletlink.social for any account holding credits.';

function missingKey(): ToolResult {
  return { content: [{ type: 'text', text: NO_KEY }], isError: true };
}

// --- reading an API body ----------------------------------------------------

/**
 * The v1 responses are `unknown` at this boundary and stay that way.
 *
 * Casting the envelope to a hand-written interface would be a claim the
 * compiler cannot check: nothing here parsed the JSON against a schema, so an
 * interface would be a comment with syntax. These four readers narrow one
 * value at a time and fall back rather than throw, which is the honest shape
 * for data that arrived as text.
 */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** `data` and `meta`, the two keys every v1 success carries. */
function envelope(result: RouteCallResult): {
  data: unknown;
  meta: Record<string, unknown>;
} {
  const body = asObject(result.json) ?? {};
  return { data: body.data, meta: asObject(body.meta) ?? {} };
}

// --- response shaping -------------------------------------------------------

/**
 * One index record, trimmed for a model.
 *
 * The API returns up to forty fields per wallet. Handing all of them to a
 * language model spends context on `reachability_checked_at` and
 * `agent_framework` to answer "who is this address". What survives is the
 * identity, whether the owner attested it, and whether the X handle still
 * reaches anyone, which is the one field here that no competing source has.
 */
function shapeRecord(raw: unknown): Record<string, unknown> | null {
  const r = asObject(raw);
  if (!r) return null;
  const out: Record<string, unknown> = { address: r.wallet };

  if (r.ens_name) out.ens = r.ens_name;

  const twitter = asObject(r.twitter);
  if (twitter) {
    const x: Record<string, unknown> = {
      handle: twitter.handle,
      url: twitter.url,
      attested: twitter.verified === true,
    };
    // Omitted when the handle has not been resolved, exactly as the API omits
    // it. A `false` here would read as "does not reach anyone", which is a
    // different and much stronger claim than "not checked".
    if (typeof twitter.reachable === 'boolean') {
      x.reaches_someone = twitter.reachable;
      x.reachability = twitter.reachability;
    }
    const also = asObject(twitter.also);
    if (also) x.second_account = also.handle;
    out.x = x;
  }

  const farcaster = asObject(r.farcaster);
  if (farcaster) {
    out.farcaster = {
      username: farcaster.username,
      url: farcaster.url,
      followers: farcaster.followers ?? null,
      // Absent on a many-address request, where the API does not return it.
      // Reported as null rather than false for the same reason as above.
      attested:
        typeof farcaster.verified === 'boolean' ? farcaster.verified : null,
    };
  }

  if (r.lens) out.lens = r.lens;
  if (r.github) out.github = r.github;
  if (r.sources) out.evidence = r.sources;
  if (asObject(r.agent)?.is_agent === true) out.is_agent = true;

  return out;
}

/** Whether a record is billable: an X handle or a Farcaster account. */
function isMatch(shaped: Record<string, unknown> | null): boolean {
  return !!shaped && (!!shaped.x || !!shaped.farcaster);
}

const BILLING_NOTE =
  'Charged one match credit per address that resolved to an X handle or a Farcaster account. Addresses that resolved to nothing, and those carrying only an ENS name, a Lens profile or a GitHub account, were not charged.';

// --- the server -------------------------------------------------------------

const handler = createMcpHandler(
  (server) => {
    // 1 --------------------------------------------------------------------
    server.registerTool(
      'walletlink_resolve_wallets',
      {
        title: 'Resolve wallets to social identities',
        description: [
          'Resolve one or more Ethereum addresses to the social identities attached to them: X handle, Farcaster account, ENS name, Lens profile, GitHub account.',
          `COST: one match credit per address that resolves to an X handle or a Farcaster account. An address that resolves to nothing is free, and so is one carrying only an ENS name, a Lens profile or a GitHub account. Up to ${MAX_ADDRESSES} addresses per call.`,
          'Each identity reports whether the address owner attested it rather than it being correlated by a third party, and each X handle reports whether it still reaches anyone: a handle can be attested and suspended, or freed and since taken by a stranger.',
          'Send every address you need in one call. Duplicates are removed before you are charged, but each copy still costs throughput.',
        ].join('\n\n'),
        inputSchema: z.object({
          addresses: z
            .array(z.string().regex(/^0x[a-fA-F0-9]{40}$/))
            .min(1)
            .max(MAX_ADDRESSES)
            .describe(
              'Ethereum addresses, each 0x followed by 40 hex characters. Case does not matter.'
            ),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ addresses }, ctx) => {
        const authorization = ctx.http?.req?.headers.get('authorization');
        if (!authorization) return missingKey();

        const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];

        // One address goes to the single lookup, which returns more: a quality
        // score, a staleness flag, and whether we have checked the address
        // before. The batch endpoint returns none of those.
        if (unique.length === 1) {
          const result = await callRouteWithParams(
            walletGet,
            `/api/v1/wallet/${unique[0]}`,
            { address: unique[0] },
            { method: 'GET', authorization }
          );
          if (result.status !== 200) return failed(result);

          const { data, meta } = envelope(result);
          const shaped = shapeRecord(data);
          return ok({
            requested: 1,
            billed_matches: isMatch(shaped) ? 1 : 0,
            billing: BILLING_NOTE,
            results: shaped
              ? [
                  {
                    ...shaped,
                    quality_score:
                      asObject(asObject(data)?.quality)?.score ?? null,
                    stale: meta.stale ?? null,
                  },
                ]
              : [
                  {
                    address: unique[0],
                    found: false,
                    // Separates an address we have looked at and found bare
                    // from one we have never seen. Neither is charged.
                    previously_checked: meta.checked_at ?? null,
                  },
                ],
          });
        }

        const result = await callRoute(batchPost, '/api/v1/batch', {
          method: 'POST',
          authorization,
          body: JSON.stringify({ wallets: unique }),
        });
        if (result.status !== 200) return failed(result);

        const { data, meta } = envelope(result);
        const rows = asArray(data).map((row, i) => {
          const shaped = shapeRecord(row);
          return shaped ?? { address: unique[i], found: false };
        });

        return ok({
          requested: asNumber(meta.requested, unique.length),
          billed_matches: asNumber(meta.matched, 0),
          billing: BILLING_NOTE,
          results: rows,
        });
      }
    );

    // 2 --------------------------------------------------------------------
    server.registerTool(
      'walletlink_wallets_by_x_handle',
      {
        title: 'Find wallets behind an X handle',
        description: [
          'Find every wallet in the index attested to an X account. The reverse of resolving an address.',
          'COST: one match credit per wallet returned, and a page holds up to 100. A handle nobody holds returns an empty list and is free. The free allowance is 100 matches per 30 days, so a single widely held handle can spend all of it in one call. Check the balance first with walletlink_account_balance if that matters.',
          'Results are ordered by Farcaster follower count, highest first. When more_pages is true, pass next_cursor back to continue.',
        ].join('\n\n'),
        inputSchema: z.object({
          handle: z
            .string()
            .regex(/^@?[a-zA-Z0-9_]{1,15}$/)
            .describe(
              'An X handle, 1 to 15 letters, numbers or underscores. A leading @ is accepted. Case does not matter.'
            ),
          cursor: z
            .string()
            .optional()
            .describe(
              'The next_cursor from a previous call, passed back unchanged. Omit for the first page.'
            ),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ handle, cursor }, ctx) => {
        const authorization = ctx.http?.req?.headers.get('authorization');
        if (!authorization) return missingKey();

        const clean = handle.replace(/^@/, '').toLowerCase();
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        const result = await callRouteWithParams(
          reverseTwitterGet,
          `/api/v1/reverse/twitter/${clean}${query}`,
          { handle: clean },
          { method: 'GET', authorization }
        );
        if (result.status !== 200) return failed(result);

        const { data, meta } = envelope(result);
        const returned = asNumber(meta.returned_count, 0);
        return ok({
          handle: asString(meta.handle) ?? clean,
          total_wallets: asNumber(meta.total_count, 0),
          returned,
          billed_matches: returned,
          more_pages: asBoolean(meta.truncated, false),
          next_cursor: asString(meta.next_cursor) ?? null,
          wallets: asArray(data).map(shapeRecord).filter(Boolean),
        });
      }
    );

    // 3 --------------------------------------------------------------------
    server.registerTool(
      'walletlink_wallets_by_farcaster_username',
      {
        title: 'Find wallets behind a Farcaster username',
        description: [
          'Find every wallet in the index attested to a Farcaster account.',
          'COST: one match credit per wallet returned, and a page holds up to 100. A username nobody holds returns an empty list and is free.',
          'Pass the username whole, including any .eth suffix: an ENS name attached to a Farcaster account is a large share of the index, and stripping the suffix will find nothing. Results are ordered by follower count, highest first.',
        ].join('\n\n'),
        inputSchema: z.object({
          username: z
            .string()
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,31}$/)
            .describe(
              'A Farcaster username, such as dwr or vitalik.eth. 1 to 32 characters of letters, numbers, dots and hyphens, starting with a letter or a number.'
            ),
          cursor: z
            .string()
            .optional()
            .describe(
              'The next_cursor from a previous call, passed back unchanged. Omit for the first page.'
            ),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ username, cursor }, ctx) => {
        const authorization = ctx.http?.req?.headers.get('authorization');
        if (!authorization) return missingKey();

        const clean = username.toLowerCase();
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        const result = await callRouteWithParams(
          reverseFarcasterGet,
          `/api/v1/reverse/farcaster/${clean}${query}`,
          { username: clean },
          { method: 'GET', authorization }
        );
        if (result.status !== 200) return failed(result);

        const { data, meta } = envelope(result);
        const returned = asNumber(meta.returned_count, 0);
        return ok({
          username: asString(meta.username) ?? clean,
          total_wallets: asNumber(meta.total_count, 0),
          returned,
          billed_matches: returned,
          more_pages: asBoolean(meta.truncated, false),
          next_cursor: asString(meta.next_cursor) ?? null,
          wallets: asArray(data).map(shapeRecord).filter(Boolean),
        });
      }
    );

    // 4 --------------------------------------------------------------------
    server.registerTool(
      'walletlink_index_coverage',
      {
        title: 'Index coverage',
        description: [
          'How much of the index carries each identity type. Use it to judge whether a lookup is worth making before making it.',
          'COST: free on both meters. It resolves no wallet and consumes no rate limit.',
          'addresses_with_an_identity over addresses_checked is the coverage rate. The second number is larger because it counts addresses we have looked at and found bare. This runs a live count over the whole index, so it is slow enough not to poll.',
        ].join('\n\n'),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (ctx) => {
        const authorization = ctx.http?.req?.headers.get('authorization');
        if (!authorization) return missingKey();

        const result = await callRoute(statsGet, '/api/v1/stats', {
          method: 'GET',
          authorization,
        });
        if (result.status !== 200) return failed(result);

        const d = asObject(envelope(result).data) ?? {};
        return ok({
          addresses_with_an_identity: asNumber(d.total_wallets, 0),
          addresses_checked: asNumber(d.wallets_checked, 0),
          carrying: asObject(d.coverage) ?? {},
          note: 'The carrying buckets overlap: one address can hold several identities.',
        });
      }
    );

    // 5 --------------------------------------------------------------------
    server.registerTool(
      'walletlink_account_balance',
      {
        title: 'Match credit balance',
        description: [
          'How many match credits the configured key has left, and how much of the request allowance it has used.',
          'COST: free on both meters. Call it before a reverse lookup, which can spend up to 100 credits in one go.',
          'matches_available is the meter that stops a call: at zero, every tool here answers that there are no credits left. rate_limit_units_used is a separate count of requests and is not a credit figure.',
        ].join('\n\n'),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (ctx) => {
        const authorization = ctx.http?.req?.headers.get('authorization');
        if (!authorization) return missingKey();

        const result = await callRoute(usageGet, '/api/v1/usage', {
          method: 'GET',
          authorization,
        });
        if (result.status !== 200) return failed(result);

        const d = asObject(envelope(result).data) ?? {};
        const credits = asObject(d.credits) ?? {};
        const limits = asObject(d.plan_limits) ?? {};
        const usage = asObject(d.usage) ?? {};
        return ok({
          matches_available: credits.available ?? null,
          on_free_allowance: asBoolean(credits.on_free_allowance, false),
          free_window_resets_at: credits.free_window_resets_at ?? null,
          requests_per_minute: limits.requests_per_minute ?? null,
          max_addresses_per_call: asNumber(
            limits.max_batch_size,
            MAX_ADDRESSES
          ),
          rate_limit_units_used: asNumber(usage.total_credits, 0),
          requests_last_month: asNumber(usage.total_requests, 0),
        });
      }
    );
  },
  {
    serverInfo: { name: 'walletlink.social', version: '1.0.0' },
  }
);

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
const METERED_METHODS = new Set(['tools/call']);

/**
 * Whether every call in this body reaches a per-key meter.
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
function isMetered(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length === 0) return false;
  return calls.every((call) => {
    const method = asObject(call)?.method;
    return typeof method === 'string' && METERED_METHODS.has(method);
  });
}

/**
 * Bounds the one surface no key can bound.
 *
 * A tool call carries the caller's key into a v1 handler, which meters it per
 * key on three windows. Protocol chatter reaches no handler, so nothing meters
 * it, and `initialize` and `tools/list` answer without a key on purpose. That
 * is a real unauthenticated endpoint and it gets a real bound.
 *
 * The test is the JSON-RPC method, deliberately not the presence of an
 * `Authorization` header. Gating on the header was the first version and it
 * was wrong twice over: any junk string in that header removed the only cap on
 * discovery, and a header proves nothing about whether a request will ever
 * reach something that meters. `Bearer hunter2` is not a key, and treating it
 * as evidence of metering left the endpoint uncapped to anyone who sent one.
 *
 * Everything is bounded here except a body whose calls are all `tools/call`.
 * That one skips it because it reaches `validateApiKey`, which is a format
 * check, a hash and one indexed read before it refuses, and that costs us less
 * than the bucket write this would add. What it must not do is cost a paying
 * caller their allowance for sharing an address with a stranger.
 */
async function guarded(request: NextRequest): Promise<Response> {
  // GET opens a stream and DELETE tears a session down. Neither carries a
  // JSON-RPC body, and neither reaches a handler.
  let metered = false;
  let body: string | undefined;

  if (request.method === 'POST') {
    // Read once and rebuild: the handler needs this stream too, and a stream
    // can only be drained a single time.
    body = await request.text();
    metered = isMetered(body);
  }

  if (!metered) {
    const limit = await checkIpRateLimit(getClientIp(request), '/api/mcp');
    if (!limit.allowed) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message:
              'Too many requests to this endpoint. Configure a walletlink.social API key, or try again later.',
          },
          id: null,
        },
        {
          status: 429,
          headers: limit.retryAfter
            ? { 'Retry-After': String(limit.retryAfter) }
            : undefined,
        }
      );
    }
  }

  if (body === undefined) return handler(request);

  return handler(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    })
  );
}

export { guarded as GET, guarded as POST, guarded as DELETE };
