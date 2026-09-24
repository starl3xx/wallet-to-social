/**
 * The security contact, RFC 9116, served at /.well-known/security.txt.
 *
 * ## Why the handler is not at the well-known path
 *
 * The same reason as the API catalog beside it: the App Router will not route
 * a segment whose directory name begins with a dot, which `next.config.ts`
 * records for the OAuth discovery documents. So the handler lives here and a
 * rewrite maps the public URL onto it. The legacy `/security.txt` is a 308 to
 * the well-known URI, not a second copy, because a copy served from another
 * path would fail its own Canonical field (section 2.5.2).
 *
 * ## Why the document is built in lib
 *
 * `lib/security-contact.ts` holds the fields and the builder. Next's route
 * type check rejects any export from this file that is not a route export,
 * and the invariants need the same constants to check SECURITY.md against.
 *
 * ## The media type is the specification
 *
 * Section 3 requires `text/plain` with a `charset` of `utf-8`. A file served
 * without it is a file a strict consumer may refuse.
 *
 * ## No HEAD export
 *
 * RFC 9116 has no HEAD rule, unlike the catalog's RFC, and Next derives HEAD
 * from GET on its own (measured, see `app/api/api-catalog/route.ts`).
 */
import { securityTxt } from '@/lib/security-contact';

export const runtime = 'nodejs';

/**
 * Static, and safe to be: the document is constants and nothing else, so Next
 * prerenders it at build and Vercel serves it from the edge. A new Expires
 * therefore ships with the deploy that carries it.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(securityTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
