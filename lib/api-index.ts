/**
 * The REST API's own index, answered at the base URL: GET /api/v1.
 *
 * ## Why the base URL answers at all
 *
 * llms.txt, the API reference, the OpenAPI `servers` block and the API
 * catalog's `anchor` all name https://walletlink.social/api/v1, and until
 * 2026-09-29 a GET on it returned the site's HTML 404 page. An agent told
 * "Base URL X" tries X first, and a 404 in HTML reads as "wrong URL" rather
 * than as "there is nothing at the root". So the root now answers with what a
 * client needs next: where the endpoints are, where the description is, and
 * how to authenticate.
 *
 * ## It points; it does not restate
 *
 * The layer rule in `docs/AGENT-SYSTEM.md` applies. The OpenAPI file is the
 * machine description and the reference pages are the human one; this names
 * the operations and links to both. The one thing it repeats is each
 * operation's method, path and OpenAPI `summary`, and
 * `scripts/check-invariants.ts` holds that list to the route tree under
 * `app/api/v1/` and to `docs-site/openapi.yaml` in both directions, so an
 * endpoint cannot ship, or be removed, without this list saying so.
 *
 * ## Why it lives in lib
 *
 * Next's route type check rejects any export from a route file that is not a
 * route export, the reason `lib/security-contact.ts` exists. The handler at
 * `app/api/v1/route.ts` only serializes what is built here.
 */
import { DOCS_URL, PRODUCTION_URL } from '@/lib/site-url';

export const API_BASE_URL = `${PRODUCTION_URL}/api/v1`;

interface ApiOperation {
  method: 'GET' | 'POST';
  /** Relative to the base URL, spelled exactly as `openapi.yaml` spells it. */
  path: string;
  /** The operation's OpenAPI `summary`, word for word. */
  summary: string;
  /** The reference page that documents it. */
  docsPage: string;
}

/**
 * Every operation under the base URL, in the order the OpenAPI file lists
 * them. The index itself is not in the list: it is the thing listing them.
 */
export const API_OPERATIONS: readonly ApiOperation[] = [
  {
    method: 'GET',
    path: '/wallet/{address}',
    summary: 'Look up a wallet',
    docsPage: 'wallet',
  },
  {
    method: 'POST',
    path: '/batch',
    summary: 'Look up many wallets',
    docsPage: 'batch',
  },
  {
    method: 'POST',
    path: '/jobs',
    summary: 'Submit an async lookup job',
    docsPage: 'jobs',
  },
  {
    method: 'GET',
    path: '/jobs/{id}',
    summary: 'Poll a job, read its results',
    docsPage: 'jobs',
  },
  {
    method: 'POST',
    path: '/estimate',
    summary: 'Estimate a list before spending on it',
    docsPage: 'estimate',
  },
  {
    method: 'GET',
    path: '/reverse/twitter/{handle}',
    summary: 'Wallets behind an X handle',
    docsPage: 'reverse-twitter',
  },
  {
    method: 'GET',
    path: '/reverse/farcaster/{username}',
    summary: 'Wallets behind a Farcaster username',
    docsPage: 'reverse-farcaster',
  },
  {
    method: 'GET',
    path: '/stats',
    summary: 'Index coverage',
    docsPage: 'stats',
  },
  {
    method: 'GET',
    path: '/usage',
    summary: 'Your key, balance and usage',
    docsPage: 'usage',
  },
];

/**
 * The document, in the API's own envelope: `data` and `meta`, as the OpenAPI
 * description promises of every success. `generated_at` is when the document
 * was built, which for a prerendered route is the deploy, not the request.
 */
export function apiIndexDocument(generatedAt: string) {
  return {
    data: {
      name: 'walletlink.social REST API',
      version: 'v1',
      base_url: API_BASE_URL,
      documentation: `${DOCS_URL}/api-reference/introduction`,
      openapi: `${DOCS_URL}/openapi.yaml`,
      api_catalog: `${PRODUCTION_URL}/.well-known/api-catalog`,
      authentication: {
        scheme: 'bearer',
        header: 'Authorization',
        example: 'Authorization: Bearer wts_live_xxxxxxxx',
        get_a_key: `${DOCS_URL}/quickstart#get-a-key`,
        note: 'Every endpoint below needs a key, and this index does not. Keys are self-serve for any signed-in account, free allowance included.',
      },
      endpoints: API_OPERATIONS.map((op) => ({
        method: op.method,
        path: op.path,
        url: `${API_BASE_URL}${op.path}`,
        summary: op.summary,
        documentation: `${DOCS_URL}/api-reference/${op.docsPage}`,
      })),
    },
    meta: {
      generated_at: generatedAt,
    },
  };
}
