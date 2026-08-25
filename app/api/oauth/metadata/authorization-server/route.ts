/**
 * RFC 8414 authorization server metadata.
 *
 * Reached at `/.well-known/oauth-authorization-server` through a rewrite; see
 * the sibling route for why a `.well-known` directory under `app/` cannot serve
 * it. The issuer is the bare origin, so this is the only correct location for
 * it and there is no path-suffixed variant to serve.
 */
import { NextResponse } from 'next/server';
import { authorizationServerMetadata } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(authorizationServerMetadata(), {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
