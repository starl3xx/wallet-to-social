/**
 * The walletlink.social MCP server.
 *
 * Eight tools over the nine `/v1` endpoints, so an agent can resolve a wallet
 * to its social identities without a human first reading an API reference.
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
 * ## Two ways to present a credential
 *
 * A `wts_live_` key in an `Authorization` header, which is what the docs
 * describe and what every existing installation uses, and an OAuth access
 * token obtained through `/oauth/authorize`. Both are `api_keys` rows, so both
 * reach the same meter by the same path; see `lib/oauth/grants.ts`.
 *
 * The one thing this layer must do about OAuth is refuse at the transport, not
 * in a tool result. `guarded` below answers 401 with a `WWW-Authenticate`
 * header when a tool call arrives with no credential or a dead one, because a
 * 200 carrying `isError: true` is read by a client as a tool that failed: the
 * model is handed the text and the turn moves on, no token is refreshed, and
 * nobody is offered a way to connect. Only a 401 makes a client run the flow
 * and retry the same call.
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
import {
  API_PLANS,
  CREDIT_API_PLAN,
  MAX_PLAN_BATCH_SIZE,
  ESTIMATE_MIN_WALLETS,
} from '@/lib/api-plans';
import {
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  SUBMISSION_MULTIPLIER,
} from '@/lib/packs';
import {
  MATCH_SENTENCE,
  ATTESTED_SENTENCE,
  ABSENT_SENTENCE,
  REACHABILITY_SENTENCE,
  ZERO_BALANCE_SENTENCE,
  PACING_SENTENCE,
} from '@/lib/canonical-sentences';
import { isAttestedSource } from '@/lib/api-sources';
import serverManifest from '@/server.json';
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
import { POST as estimatePost } from '@/app/api/v1/estimate/route';
import { POST as jobsPost } from '@/app/api/v1/jobs/route';
import { GET as jobStatusGet } from '@/app/api/v1/jobs/[id]/route';
import { looksLikeAccessToken, validateAccessToken } from '@/lib/oauth/grants';
import { wwwAuthenticate } from '@/lib/oauth/metadata';
import { callsATool, isMetered } from '@/lib/mcp-gate';

export const runtime = 'nodejs';

/**
 * Two batch ceilings, both imported rather than written as numbers, because
 * the plan ladder (lib/api-plans.ts, gap 17) split what used to be one.
 *
 * `DEFAULT_MAX_ADDRESSES` is the default plan's ceiling, quoted in copy. The
 * input schema is capped at `MAX_PLAN_BATCH_SIZE`, the largest any plan
 * allows, because a zod cap at the default would refuse a list that a Scale
 * or Index caller's real plan accepts before the API ever saw it. The v1
 * handler enforces the caller's actual plan ceiling and refuses over it with
 * BATCH_SIZE_EXCEEDED naming the number, so the effective cap is always the
 * plan's; the schema bound is syntax, not entitlement.
 */
const DEFAULT_MAX_ADDRESSES = API_PLANS[CREDIT_API_PLAN].maxBatchSize;
const MAX_ADDRESSES = MAX_PLAN_BATCH_SIZE;

/**
 * What a client is told this server is for, before it calls anything.
 *
 * Instructions are read once, ahead of tool selection, so they carry only what
 * no single tool description can: what is in scope, where the links come from,
 * the unit the meter counts, and which direction is expensive. Anything a tool
 * can say about itself stays in that tool.
 *
 * The provenance paragraph is not decoration. A handle-to-wallet lookup with no
 * stated source reads as a deanonymiser, and this text is the first thing a
 * directory reviewer sees.
 *
 * Two numbers are interpolated and one is not. The free allowance is imported,
 * because it is exported and a change to it would otherwise make this text lie
 * silently. The 100-wallet page is written out: MAX_RESULTS is module-local to
 * both reverse routes and is not exported, and it is a different number that
 * merely happens to equal the allowance today. Welding them into one clause
 * would hide that.
 *
 * The sentences about meaning come from `lib/canonical-sentences.ts`, not from
 * here: this layer explains, so it quotes the semantic contract rather than
 * restating it. The hand-rolled versions this text used to carry had drifted
 * (two owner-attested routes where the docs enumerate more). Context around a
 * canonical sentence is fine; a second version of one is not.
 *
 * `scripts/check-design-language.mjs` greps the inside of strings, so run it
 * after any edit here.
 */
const INSTRUCTIONS = [
  'This server answers two questions about an Ethereum address: which social accounts its owner published, and which addresses a given X handle or Farcaster account is attested to. Balances, transfers and prices are a block explorer\u2019s job.',
  `${ATTESTED_SENTENCE} Nothing is inferred from a display name or a bio.`,
  `${MATCH_SENTENCE} Billing is per address, not per identity: an address carrying both an X handle and a Farcaster account costs one credit. An unpromising list is cheap to try, and splitting one saves no credits. The ceiling is ${DEFAULT_MAX_ADDRESSES} addresses per call on the default plan; a live Scale or Index pack raises it (the balance tool reports yours).`,
  `The reverse direction is the expensive one: one page of the wallets behind a handle can spend 100 credits, and the free allowance is ${FREE_MATCHES_PER_WINDOW} matches per ${FREE_WINDOW_DAYS} days. Reading the balance, the coverage figures or a list estimate costs no credits. ${ZERO_BALANCE_SENTENCE}`,
  `${REACHABILITY_SENTENCE} ${ABSENT_SENTENCE}`,
].join('\n\n');

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
  /**
   * A refusal is exactly when the caller needs the meters: a 402 carries the
   * balance (reading 0) and a 429 carries the windows, so the quota rides the
   * error text rather than being dropped with the headers. Function
   * declarations hoist, so quotaFrom being defined below is fine.
   */
  const quota = quotaFrom(result);
  const text = quota
    ? `${errorTextFrom(result)}\n\n${JSON.stringify({ quota }, null, 2)}`
    : errorTextFrom(result);
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

const NO_KEY =
  'No API key was sent. Add an Authorization header with a walletlink.social key (Bearer wts_live_...) to this server’s configuration. Keys are self-serve at https://walletlink.social for any account holding credits. An agent holding a wallet can buy a key with USDC, no account needed: POST https://walletlink.social/api/x402/buy, documented at https://docs.walletlink.social/agent-pack.';

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

  // `attested` derives from the record's evidence classes (the public
  // `sources` array, mapped through lib/api-sources.ts), never from the
  // `verified` flag. That flag is true for the onchain, manual and
  // attested-social routes, so mapping attested from it reported false on the majority
  // Farcaster-attested handles and taught agents to treat them as weak
  // evidence. The classes are recorded per wallet, not per identity, so one
  // derivation covers both x and farcaster. A record carrying no classified
  // evidence reports null: "not reported" is a different claim from "not
  // attested", and collapsing them would turn a gap in our own response into
  // a claim about the person.
  const evidence = asArray(r.sources);
  const attested =
    evidence.length === 0 ? null : evidence.some(isAttestedSource);

  const twitter = asObject(r.twitter);
  if (twitter) {
    const x: Record<string, unknown> = {
      handle: twitter.handle,
      url: twitter.url,
      attested,
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
      // The fid survives the trim because the Farcaster DM rail is addressed
      // by fid, not by username: dropping it dead-ended the one handoff this
      // record exists to enable. A username can be renamed; the fid cannot.
      fid: farcaster.fid ?? null,
      followers: farcaster.followers ?? null,
      attested,
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

/**
 * The quota the v1 handler reported, read off its response headers.
 *
 * Every metered tool result carries this, so an agent learns what its call
 * left without spending a second call to ask. The balance is the one the
 * handler read BEFORE debiting this call's matches, because what a call costs
 * is not known until it resolves: subtract `billed_matches` to know what is
 * left after it. The reset arrives as Unix seconds and leaves as ISO, which is
 * the format a model reads without arithmetic.
 *
 * Field-level absence is the honest shape here. The rate limiter runs for
 * every keyed call, so `requests_remaining_this_window` is always present on
 * a 200; the balance key is absent for the two legacy unmetered accounts,
 * which have no balance to report. An absent field, not a zero: a zero would
 * read as an empty balance. `undefined` survives as a guard for a response
 * that somehow carried neither header, and JSON.stringify then drops the
 * whole key.
 */
function quotaFrom(
  result: RouteCallResult
): Record<string, unknown> | undefined {
  const matches = result.headers.get('X-Matches-Available');
  const remaining = result.headers.get('X-RateLimit-Remaining');
  const reset = result.headers.get('X-RateLimit-Reset');
  if (matches === null && remaining === null) return undefined;

  const quota: Record<string, unknown> = {};
  if (matches !== null)
    quota.matches_available_before_this_call = Number(matches);
  if (remaining !== null)
    quota.requests_remaining_this_window = Number(remaining);
  if (reset !== null) {
    quota.window_resets_at = new Date(Number(reset) * 1000).toISOString();
  }
  return quota;
}

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
          `COST: one match credit per address that resolves to an X handle or a Farcaster account. An address that resolves to nothing is free, and so is one carrying only an ENS name, a Lens profile or a GitHub account. Up to ${DEFAULT_MAX_ADDRESSES} addresses per call on the default plan; a live Scale pack raises the ceiling to ${API_PLANS.startup.maxBatchSize} and Index to ${API_PLANS.enterprise.maxBatchSize}, and the API refuses over YOUR ceiling with BATCH_SIZE_EXCEEDED naming it. ${PACING_SENTENCE}`,
          'Each identity reports whether the address owner attested it rather than it being correlated by a third party, and each X handle reports whether it still reaches anyone: a handle can be attested and suspended, or freed and since taken by a stranger.',
          'Send every address you need in one call. Duplicates are removed before you are charged, but each copy still costs throughput.',
          'A retried call bills again: duplicates are removed inside one call, never across calls, and a tool call cannot carry an idempotency key. Before resending a call that may have gone through, read the balance instead of guessing.',
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
        /**
         * `idempotentHint: false` on every metered tool, deliberately. The
         * hint's contract is "repeating the same call has no additional
         * effect", and a repeat here debits the same matches again; declaring
         * it true invited frameworks to retry on any timeout, billing the
         * caller for each attempt. The REST batch endpoint takes an
         * Idempotency-Key header for retry-safe batches; a tool call has
         * nowhere to carry one, so the honest annotation is false and the
         * description says why.
         */
        annotations: { readOnlyHint: true, idempotentHint: false },
      },
      async ({ addresses }, ctx) => {
        const authorization = ctx.http?.req?.headers.get('authorization');
        if (!authorization) return missingKey();

        const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];

        // One address goes to the single lookup, which still returns one
        // thing the batch does not: the quality score. Staleness and
        // previously-checked now come back from both.
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
            quota: quotaFrom(result),
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
        // Negative knowledge for the misses: the batch meta maps wallet to
        // when it was last checked, for misses that were actually checked.
        const checkedMisses = asObject(meta.previously_checked) ?? {};
        const rows = asArray(data).map((row, i) => {
          const shaped = shapeRecord(row);
          if (!shaped) {
            return {
              address: unique[i],
              found: false,
              // Same shape as the single-address path below: a timestamp
              // means checked and found bare, null means never seen.
              previously_checked: checkedMisses[unique[i]] ?? null,
            };
          }
          // Per-row staleness, passed through when the API measured it.
          const raw = asObject(row);
          if (typeof raw?.stale === 'boolean') shaped.stale = raw.stale;
          return shaped;
        });

        return ok({
          requested: asNumber(meta.requested, unique.length),
          billed_matches: asNumber(meta.matched, 0),
          billing: BILLING_NOTE,
          quota: quotaFrom(result),
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
          'COST: one match credit per wallet returned, and a page holds up to 100. A handle nobody holds returns an empty list and is free. The free allowance is 100 matches per 30 days, so a single widely held handle can spend all of it in one call. Check the balance first with walletlink_account_balance if that matters. A retried call bills its returned wallets again.',
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
        // idempotentHint false: a repeat bills again. See the resolve tool.
        annotations: { readOnlyHint: true, idempotentHint: false },
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
          quota: quotaFrom(result),
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
          'COST: one match credit per wallet returned, and a page holds up to 100. A username nobody holds returns an empty list and is free. A retried call bills its returned wallets again.',
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
        // idempotentHint false: a repeat bills again. See the resolve tool.
        annotations: { readOnlyHint: true, idempotentHint: false },
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
          quota: quotaFrom(result),
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
          `COST: free on both meters. It resolves no wallet and consumes no rate limit. ${ZERO_BALANCE_SENTENCE}`,
          'addresses_with_an_identity over addresses_checked is the coverage rate. The second number is larger because it counts addresses we have looked at and found bare. The counts are refreshed daily rather than counted live; as_of says when they were taken, and asking twice in a day returns the same numbers.',
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

        const { data, meta } = envelope(result);
        const d = asObject(data) ?? {};
        return ok({
          addresses_with_an_identity: asNumber(d.total_wallets, 0),
          addresses_checked: asNumber(d.wallets_checked, 0),
          carrying: asObject(d.coverage) ?? {},
          // When the materialized counts were computed, not when this call
          // ran. See lib/coverage-stats.ts.
          as_of: asString(meta.as_of) ?? null,
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
          'matches_available is the meter that stops a metered call: at zero, the resolve and reverse tools refuse, while this tool and the coverage tool keep answering, so a drained key can always read its own meter. rate_limit_units_used is a separate count of requests and is not a credit figure.',
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
            DEFAULT_MAX_ADDRESSES
          ),
          rate_limit_units_used: asNumber(usage.total_credits, 0),
          requests_last_month: asNumber(usage.total_requests, 0),
        });
      }
    );

    // 6 --------------------------------------------------------------------
    server.registerTool(
      'walletlink_submit_job',
      {
        title: 'Submit a background lookup job',
        description: [
          'Submit a list of addresses as a background job. A job runs a deeper scan than the resolve tool: an address the index has not checked, or holds only stale answers for, is resolved against live sources, so a job can find identities the resolve tool reports as never seen. Use it for lists larger than one resolve call, or when misses are worth re-checking.',
          `COST: billed on matches exactly like resolving, when the job completes: one match credit per address that resolved to an X handle or a Farcaster account, misses free. One job may be active per account at a time; a second submission is refused until the first finishes, and the refusal names the active job id. A submission is capped at ${SUBMISSION_MULTIPLIER} times the match balance, so the worst case is bounded by what the account already holds. Submitting itself spends one request-unit of the rate window.`,
          'The submission returns a job id. Poll walletlink_job_status for progress and, on completion, the results. A job that fails is never billed.',
          'Resubmitting the same list after a job completes runs the whole job again and bills its matches again.',
        ].join('\n\n'),
        inputSchema: z.object({
          addresses: z
            .array(z.string().regex(/^0x[a-fA-F0-9]{40}$/))
            .min(1)
            .describe(
              'Ethereum addresses, each 0x followed by 40 hex characters. Case does not matter. The ceiling is the balance-derived cap, not a fixed number; a list over the cap is refused with the cap named.'
            ),
        }),
        // Not read-only: it creates a job and, on completion, a debit. Not
        // idempotent: a repeat after completion runs and bills again (a
        // repeat while one is active is refused, which is the safe half).
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async ({ addresses }, ctx) => {
        const authorization = ctx.http?.req?.headers.get('authorization');
        if (!authorization) return missingKey();

        const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];

        const result = await callRoute(jobsPost, '/api/v1/jobs', {
          method: 'POST',
          authorization,
          body: JSON.stringify({ wallets: unique }),
        });
        if (result.status !== 202) return failed(result);

        const { data } = envelope(result);
        const d = asObject(data) ?? {};
        return ok({
          job_id: asString(d.job_id) ?? null,
          status: asString(d.status) ?? 'pending',
          wallets_submitted: asNumber(d.wallets, unique.length),
          quota: quotaFrom(result),
          note: 'Poll walletlink_job_status with this job_id. Matches are billed when the job completes, at the same price as resolving.',
        });
      }
    );

    // 7 --------------------------------------------------------------------
    server.registerTool(
      'walletlink_job_status',
      {
        title: 'Check a background job',
        description: [
          'Progress and results for a job submitted with walletlink_submit_job. While the job runs it reports processed counts; on completion it reports the resolved records and what was billed.',
          `COST: free on both meters, so a drained key can still collect results it already paid for. ${ABSENT_SENTENCE}`,
          'Only jobs submitted by this account are visible; any other id answers not found.',
        ].join('\n\n'),
        inputSchema: z.object({
          job_id: z
            .string()
            .regex(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            )
            .describe('The job id returned by walletlink_submit_job.'),
          offset: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe(
              'Result row to start from, for a completed job. Pass the next_offset from a previous call to continue. Omit for the first page.'
            ),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ job_id, offset }, ctx) => {
        const authorization = ctx.http?.req?.headers.get('authorization');
        if (!authorization) return missingKey();

        /**
         * The tool asks the route for exactly the page it will show. The
         * route pages server-side, so neither the function nor this layer
         * ever holds a whole large job.
         */
        const PAGE = 100;
        const id = job_id.toLowerCase();
        const query = `?limit=${PAGE}&offset=${offset ?? 0}`;
        const result = await callRouteWithParams(
          jobStatusGet,
          `/api/v1/jobs/${id}${query}`,
          { id },
          { method: 'GET', authorization }
        );
        if (result.status !== 200) return failed(result);

        const { data, meta } = envelope(result);
        const d = asObject(data) ?? {};
        const progress = asObject(d.progress) ?? {};

        const out: Record<string, unknown> = {
          job_id: asString(d.job_id) ?? id,
          status: asString(d.status) ?? null,
          progress: {
            processed: asNumber(progress.processed, 0),
            total: asNumber(progress.total, 0),
          },
          quota: quotaFrom(result),
        };
        if (typeof d.error === 'string') out.error = d.error;

        const jobWallets = asArray(d.wallets);
        const rawResults = asArray(d.results);
        if (asString(d.status) === 'completed') {
          /**
           * A model does not need ten thousand rows in a tool result, and no
           * context window survives them. One 100-row page per call; the
           * next page is one more free call away via next_offset.
           */
          const rows = rawResults.map((row, i) => {
            const shaped = shapeRecord(row);
            if (!shaped) {
              return { address: asString(jobWallets[i]) ?? null, found: false };
            }
            return shaped;
          });
          out.billed_matches = asNumber(meta.matched, 0);
          out.billing = BILLING_NOTE;
          out.page = {
            offset: asNumber(meta.offset, 0),
            found: asNumber(meta.found, 0),
            not_found: asNumber(meta.not_found, 0),
            // null when this is the last page.
            next_offset: meta.next_offset ?? null,
          };
          out.results = rows;
        }

        return ok(out);
      }
    );

    // 8 --------------------------------------------------------------------
    server.registerTool(
      'walletlink_estimate_list',
      {
        title: 'Estimate a list before spending on it',
        description: [
          'A dry run over a list of addresses: how many are in the index, how many were checked and found bare, how many have never been seen, and the band a resolve would bill inside. Counts only, no identities. Use it to decide whether a list is worth resolving, and which tool to spend on.',
          `COST: free on the match meter, always, even at zero balance. It weighs the rate window exactly like resolving the same list (one request-unit per address), so it previews a batch at the batch’s own pace. Minimum ${ESTIMATE_MIN_WALLETS} distinct addresses, because the counts are aggregates by design; the ceiling is your plan’s batch ceiling.`,
          'Reading the band: low is exact for resolving this list now (the addresses already holding an X handle or a Farcaster account). high adds never-checked addresses at the measured overall rate; a background job resolves those against live sources, a plain resolve does not. Match rates differ several-fold by chain; the coverage tool and /v1/stats carry the measured per-chain table.',
        ].join('\n\n'),
        inputSchema: z.object({
          addresses: z
            .array(z.string().regex(/^0x[a-fA-F0-9]{40}$/))
            .min(ESTIMATE_MIN_WALLETS)
            .max(MAX_ADDRESSES)
            .describe(
              'Ethereum addresses, each 0x followed by 40 hex characters. Case does not matter.'
            ),
        }),
        // Free and read-only. idempotentHint true is honest here: a repeat
        // bills nothing, it only spends rate window.
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ addresses }, ctx) => {
        const authorization = ctx.http?.req?.headers.get('authorization');
        if (!authorization) return missingKey();

        const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];

        const result = await callRoute(estimatePost, '/api/v1/estimate', {
          method: 'POST',
          authorization,
          body: JSON.stringify({ wallets: unique }),
        });
        if (result.status !== 200) return failed(result);

        const { data } = envelope(result);
        const d = asObject(data) ?? {};
        const band = asObject(d.would_bill_estimate) ?? {};
        return ok({
          requested: asNumber(d.requested, unique.length),
          in_index: asNumber(d.in_index, 0),
          previously_checked_empty: asNumber(d.previously_checked_empty, 0),
          never_checked: asNumber(d.never_checked, 0),
          would_bill_estimate: {
            low: asNumber(band.low, 0),
            high: asNumber(band.high, 0),
            note: asString(band.note) ?? null,
          },
          billed_matches: 0,
          quota: quotaFrom(result),
        });
      }
    );
  },
  {
    /**
     * The version comes from the manifest `mcp-publisher` publishes, not from a
     * second copy typed here. It was a literal 1.0.0 while the registry had
     * moved to 1.2.0 twice over, and nothing could catch that.
     *
     * An import, never readFileSync. This resolves as a module and the bundler
     * inlines it, so no filesystem is touched at request time; server.json sits
     * at the repo root, not in public/, and a read would depend on file tracing
     * pulling a root file into the function bundle.
     *
     * No `title`. server.json's title is byte-identical to this name, so it
     * would add nothing to a client picker, and mcp-handler types serverInfo as
     * { name, version }: an inline literal carrying `title` fails with TS2353,
     * and the named const that gets around it is an indirection whose purpose
     * is invisible to the next reader.
     */
    serverInfo: { name: 'walletlink.social', version: serverManifest.version },
    // A sibling of serverInfo, not a field inside it. Nested, it typechecks and
    // is then dropped at initialize, so no client ever sees it.
    instructions: INSTRUCTIONS,
  }
);

function bearerFrom(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  return header.startsWith('Bearer ') ? header.slice(7) : header;
}

/**
 * The 401 that starts, or restarts, an OAuth connection.
 *
 * The status is the protocol signal and the body is advisory, so the body is
 * written for whoever ends up reading a log rather than for a parser.
 */
function challenge(
  error: 'invalid_token' | undefined,
  description: string
): NextResponse {
  return NextResponse.json(
    { error: error ?? 'invalid_request', error_description: description },
    {
      status: 401,
      headers: { 'WWW-Authenticate': wwwAuthenticate(error, description) },
    }
  );
}

/**
 * Decide whether this tool call may proceed, before the MCP layer sees it.
 *
 * Three outcomes, and the third is the one that took a rewrite to get right.
 *
 * **No credential at all.** Challenge. This is the lazy-authentication shape:
 * `initialize` and `tools/list` still answer anonymously, so a client can
 * connect and see the tools, and the challenge arrives only when one is
 * actually called. A client that supports OAuth turns this into a consent
 * prompt; one that does not shows the description, which names the header.
 *
 * **An OAuth access token that no longer works.** Challenge, with
 * `error="invalid_token"`. An access token lasts an hour, so this is the
 * ordinary case, not the exceptional one, and it is the whole reason the
 * refusal has to be a 401: a client refreshes reactively on this status and
 * retries the same call. Answered as a tool error instead, the connection
 * would appear to work and every call would fail an hour after it was made.
 *
 * **Anything else.** Pass it through. A `wts_live_` key, valid or mistyped,
 * belongs to somebody who copied it out of the dashboard and has no OAuth
 * connection to repair; challenging them would answer a typo with a consent
 * screen. The v1 handler tells them their key is wrong, in words, which is
 * what they need to read.
 */
async function gate(
  body: string,
  request: NextRequest
): Promise<NextResponse | null> {
  if (!callsATool(body)) return null;

  const bearer = bearerFrom(request);
  if (!bearer) {
    return challenge(
      undefined,
      // The machine path rides along: for an autonomous caller a refusal
      // without a remedy is a dead end, not a prompt. No double quotes, since
      // this string is embedded in a quoted WWW-Authenticate parameter.
      'This tool needs a walletlink.social account. Connect one, or set an Authorization header carrying an API key. An agent holding a wallet can buy a key with USDC at POST https://walletlink.social/api/x402/buy, documented at https://docs.walletlink.social/agent-pack.'
    );
  }

  if (!looksLikeAccessToken(bearer)) return null;

  const check = await validateAccessToken(bearer);
  if (check.ok) return null;

  return challenge(
    'invalid_token',
    check.reason === 'expired'
      ? 'This access token has expired. Refresh it.'
      : check.reason === 'revoked'
        ? 'This connection was revoked. Connect again.'
        : 'This access token is not recognised.'
  );
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

    // Before the IP limit, so a client whose token expired is told to refresh
    // rather than told it is sending too many requests.
    const refusal = await gate(body, request);
    if (refusal) return refusal;
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
