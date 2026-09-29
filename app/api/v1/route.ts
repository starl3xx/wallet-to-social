/**
 * GET /api/v1: the index at the base URL, so the URL every reference gives as
 * "Base URL" answers instead of returning the site's HTML 404.
 *
 * The document and the reasoning are in `lib/api-index.ts`. This file only
 * serves it.
 *
 * ## No key, no meter
 *
 * It names public URLs and resolves nothing, so it needs no key and draws on
 * neither meter, like `/.well-known/api-catalog`. Every operation it lists
 * still needs one.
 *
 * ## `Link` headers, RFC 8631
 *
 * `service-desc` and `service-doc` from an API's root are exactly the case
 * RFC 8631 describes, and `api-catalog` is RFC 9727's. A client that issues a
 * HEAD and never reads a body still learns where to go.
 */
import { NextResponse } from 'next/server';
import { apiIndexDocument } from '@/lib/api-index';
import { DOCS_URL } from '@/lib/site-url';

export const runtime = 'nodejs';

/**
 * Static, and safe to be: constants only, no request, no database. Next
 * prerenders it at build and Vercel serves it from the edge.
 */
export const dynamic = 'force-static';

/**
 * The same open CORS every route under `/api/v1` declares. The OpenAPI
 * description promises `OPTIONS` on every path, and this is a path.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

const LINKS = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  `<${DOCS_URL}/openapi.yaml>; rel="service-desc"; type="text/yaml"`,
  `<${DOCS_URL}/api-reference/introduction>; rel="service-doc"; type="text/html"`,
].join(', ');

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export function GET(): NextResponse {
  return NextResponse.json(apiIndexDocument(new Date().toISOString()), {
    headers: {
      ...corsHeaders,
      Link: LINKS,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
