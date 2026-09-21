/**
 * The API catalog, RFC 9727, served at /.well-known/api-catalog.
 *
 * Three APIs are published here and they are discovered three different ways
 * today: the REST API from the docs site, the MCP server from a registry row,
 * and the x402 rail from a sentence in the agent pack. A client that has only
 * the origin has no way to learn that any of them exist. This is that way.
 *
 * ## Why the handler is not at the well-known path
 *
 * The App Router will not route a segment whose directory name begins with a
 * dot, which `next.config.ts` already records for the three OAuth discovery
 * documents: an `app/.well-known/` route compiles, emits no warning, and is
 * absent from the build output. So the handler lives here and a rewrite maps
 * the public URL onto it, exactly as those three do.
 *
 * ## The media type is the specification
 *
 * `application/linkset+json` is a MUST in RFC 9727 section 4.2, and the
 * `profile` parameter naming RFC 9727 is a SHOULD in the same section. Both
 * are below. A catalog served as `application/json` is a JSON document that
 * happens to look like a catalog, and nothing discovering it is obliged to
 * treat it as one.
 *
 * ## HEAD is exported rather than inherited
 *
 * Section 2 requires a HEAD request to answer with a `Link` header carrying
 * the `api-catalog` relation. Next does derive HEAD from GET on its own,
 * measured against `/llms.txt` on a dev server: same headers, no body, 200.
 * Exporting it anyway costs four lines and takes a requirement of the
 * specification off a framework behavior that is not in its documentation.
 *
 * ## Shape
 *
 * `{ "linkset": [ ... ] }` with `linkset` as the sole member, one link
 * context object per API, `anchor` an absolute URI, and every relation a
 * member whose value is an ARRAY of link target objects even when there is
 * one (RFC 9264 sections 4.2.1 to 4.2.3). The single-element arrays below are
 * required, not a style choice.
 */
import { DOCS_URL, PRODUCTION_URL } from '@/lib/site-url';

export const runtime = 'nodejs';

/**
 * Static, and safe to be: nothing here reads a request, a database or the
 * filesystem. The document is two constants and a set of literal paths, so
 * Next prerenders it once at build and Vercel serves it from the edge.
 */
export const dynamic = 'force-static';

/**
 * The profile URI that says this linkset is an API catalog.
 *
 * RFC 9727 section 4.2 gives the exact value. It rides on the `Content-Type`
 * as a media type parameter, not as a link relation, which is the part that
 * is easy to get subtly wrong.
 */
const CATALOG_PROFILE = 'https://www.rfc-editor.org/info/rfc9727';

/** Where the document lives, which is also its own `anchor` for nothing. */
const CATALOG_URL = `${PRODUCTION_URL}/.well-known/api-catalog`;

/**
 * The three APIs, with the relations RFC 8631 defines and RFC 9727 appendix
 * A.1 demonstrates:
 *
 *   service-desc  a description for a machine (the OpenAPI file, the skill)
 *   service-doc   documentation for a person
 *   service-meta  further metadata for a machine
 *
 * Every URL below was checked on 2026-09-21 to answer without a redirect in
 * front of it, because `lib/site-url.ts` records what a machine-to-machine URL
 * pointing at a redirect cost this product once already.
 *
 * ## Two things that look wrong and are not
 *
 * **`/api/v1` answers 404 to a GET.** An `anchor` is a link context: RFC 9264
 * section 4.2.2 requires a URI reference and says nothing about dereferencing
 * one. This is the API's base URI, the same string the OpenAPI `servers`
 * block declares, and it identifies the API precisely. The endpoints under it
 * are the OpenAPI file's job to enumerate, and it does.
 *
 * **The MCP and x402 anchors answer 405 to a GET.** Both are POST-only, so
 * 405 is the endpoint saying it exists and that GET is not how you use it.
 *
 * ## Two omissions, both deliberate
 *
 * **No `status`.** RFC 9727 lists it as optional and there is no public
 * health endpoint to point it at: `/api/admin/health/dependencies` is admin
 * gated and `/api/v1/stats` needs a key. `/api/public-stats` is keyless and
 * would resolve, but it reports index coverage rather than service health,
 * and a `status` link pointing at it would describe it as something it is
 * not. An endpoint invented to fill a field in a catalog is the wrong reason
 * to open a public endpoint. Revisit by adding a real health check, not by
 * relabeling this one.
 *
 * **No `service-desc` on the x402 rail.** It has no static machine
 * description, because the protocol is that a POST with no payment answers
 * 402 with a `PAYMENT-REQUIRED` header describing what to pay. RFC 9727
 * section 4.1 contemplates exactly this: metadata the Publisher does not put
 * in the catalog SHOULD be available at the endpoint URI, and here it is.
 */
const CATALOG = {
  linkset: [
    {
      anchor: `${PRODUCTION_URL}/api/v1`,
      'service-desc': [
        {
          href: `${DOCS_URL}/openapi.yaml`,
          type: 'text/yaml',
          title: 'OpenAPI 3.1 description of the walletlink.social REST API',
        },
      ],
      'service-doc': [
        {
          href: `${DOCS_URL}/api-reference/introduction`,
          type: 'text/html',
          title: 'REST API reference',
        },
      ],
    },
    {
      anchor: `${PRODUCTION_URL}/api/mcp`,
      'service-desc': [
        {
          href: `${PRODUCTION_URL}/skill.md`,
          type: 'text/markdown',
          title: 'Agent skill: what the tools do and what each one costs',
        },
      ],
      'service-doc': [
        {
          href: `${DOCS_URL}/mcp-server`,
          type: 'text/html',
          title: 'MCP server documentation',
        },
      ],
      'service-meta': [
        {
          href: `${PRODUCTION_URL}/.well-known/oauth-protected-resource`,
          type: 'application/json',
          title: 'OAuth 2.0 protected resource metadata, RFC 9728',
        },
      ],
    },
    {
      anchor: `${PRODUCTION_URL}/api/x402/buy`,
      'service-doc': [
        {
          href: `${DOCS_URL}/agent-pack`,
          type: 'text/html',
          title: 'Buying credits with USDC over x402, no account',
        },
      ],
    },
  ],
};

/**
 * `Link: rel="api-catalog"` on the catalog's own responses.
 *
 * Required on HEAD by section 2, and carried on GET too because a client that
 * already has the document loses nothing by being told where it lives. The
 * relation is registered, so the bare token is correct and no URI is needed.
 */
function catalogHeaders(): Record<string, string> {
  return {
    'Content-Type': `application/linkset+json; profile="${CATALOG_PROFILE}"`,
    Link: `<${CATALOG_URL}>; rel="api-catalog"`,
    'Cache-Control': 'public, max-age=3600, s-maxage=86400',
  };
}

export function GET(): Response {
  return new Response(`${JSON.stringify(CATALOG, null, 2)}\n`, {
    headers: catalogHeaders(),
  });
}

export function HEAD(): Response {
  return new Response(null, { headers: catalogHeaders() });
}
