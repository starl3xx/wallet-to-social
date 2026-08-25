/**
 * RFC 9728 protected resource metadata.
 *
 * Served here and reached at `/.well-known/oauth-protected-resource` through a
 * rewrite in `next.config.ts`, because the App Router will not route a segment
 * whose directory name begins with a dot: an `app/.well-known/` route compiles,
 * emits no warning, and is simply absent from the build. Verified by building
 * it. The rewrite covers the path-suffixed form as well, since a client whose
 * `resource_metadata` pointer went missing probes that one first.
 */
import { NextResponse } from 'next/server';
import { protectedResourceMetadata } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(protectedResourceMetadata(), {
    headers: {
      // Claude caches discovery globally for about five minutes. Matching that
      // keeps a metadata change reaching clients in minutes rather than
      // whenever a CDN happens to expire.
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
