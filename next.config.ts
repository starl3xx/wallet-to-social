import type { NextConfig } from 'next';
/**
 * Relative, not `@/lib/site-url`. This file is loaded by Next's own config
 * loader rather than compiled with the app, and the `@/` alias is a tsconfig
 * path the app's compiler resolves. A relative specifier needs nobody's help.
 */
import { DOCS_URL } from './lib/site-url';

const nextConfig: NextConfig = {
  /**
   * `/vs/cookie` compared against Cookie.fun, which does not compete with us:
   * it indexes AI agents and gates premium analytics behind staking $COOKIE.
   * The competitor is Cookie3, a separate product that sells wallet-to-Twitter
   * matching on a price sheet, and the page was rewritten around it.
   *
   * A 308 rather than a delete: the old URL is in the sitemap Google already
   * crawled, and it is linked from four sibling pages and the footer that
   * shipped before this change. Permanent, because the page is not coming back.
   */
  async redirects() {
    return [
      {
        source: '/vs/cookie',
        destination: '/vs/cookie3',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      /**
       * Blog posts as markdown, at the URL a client guesses: /blog/<slug>.md.
       *
       * A rewrite because neither obvious path exists. A dynamic segment is a
       * whole directory name, so `app/blog/[slug].md/route.ts` is a literal
       * segment spelled "[slug].md" and matches nothing;
       * `app/blog/[slug]/route.ts` is the right segment and collides with the
       * `page.tsx` already there, which is a build error rather than a
       * fallback. So the handler lives at `app/api/blog-markdown/[slug]` and
       * this maps the public URL onto it.
       *
       * Under /api for tidiness, not for exclusion. A rewrite is resolved
       * server-side, so a crawler only ever sees /blog/<slug>.md, which
       * robots.txt allows: the `Disallow: /api/` there never reaches this
       * request. What keeps the twin out of the index is the rel="canonical"
       * Link header the handler answers with, naming the HTML page.
       *
       * `:slug` stops at the literal `.md`, because the parameter compiles to
       * a lazy `[^/#?]+?`: /blog/foo.md rewrites with slug=foo, and /blog/foo
       * does not match this rule at all and is served by the page as before.
       */
      {
        source: '/blog/:slug.md',
        destination: '/api/blog-markdown/:slug',
      },
      /**
       * The OAuth discovery documents, at the paths the specifications name.
       *
       * They are rewrites rather than routes because the App Router will not
       * route a segment whose directory name begins with a dot. An
       * `app/.well-known/` route compiles, emits no warning, and is absent
       * from the build output: confirmed by building it and reading the route
       * list, not by reading a changelog. A 404 on
       * `/.well-known/oauth-protected-resource` presents to a client as "could
       * not reach the MCP server", with the authorization server never seeing
       * a single request, so this is worth the indirection.
       *
       * Both protected-resource paths are here. RFC 9728 puts the document at
       * the root, and a client that lost the `resource_metadata` pointer from
       * our 401 probes the path-suffixed form first, so a rewrite that covered
       * only one would work until the day the header went missing.
       */
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/metadata/protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource/api/mcp',
        destination: '/api/oauth/metadata/protected-resource',
      },
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/oauth/metadata/authorization-server',
      },
      /**
       * The API catalog, RFC 9727, at the well-known URI the specification
       * names. Here for the same reason as the three rules above: the App
       * Router will not route a segment whose directory name begins with a
       * dot, so the handler lives at `app/api/api-catalog` and this maps the
       * public URL onto it.
       */
      {
        source: '/.well-known/api-catalog',
        destination: '/api/api-catalog',
      },
    ];
  },
  /**
   * `Link` headers on the homepage, RFC 8288 and RFC 9727 section 3.
   *
   * The catalog is only discoverable if something points at it, and the two
   * ways to point are the response header and the markup. Both ship: the
   * header serves a client that issues a HEAD and never parses a body, and
   * the `<link>` in `app/layout.tsx` serves one that parses HTML. The RFC's
   * own example carries both.
   *
   * ## This survives, and `Vary` in the same position does not
   *
   * Worth stating because the opposite was written down first and was wrong.
   * The markdown negotiation work measured a config `Vary` being overwritten
   * by the App Router's own, and that was generalized to `Link` without
   * testing it. It does not hold: measured in `next dev` on 2026-09-21, the
   * homepage answers with TWO `Link` lines, this one and the font preloads
   * Next emits, and a repeated field line is exactly how RFC 8288 expects
   * multiple links to arrive. `Vary` is the special case, not this.
   *
   * ## Homepage only, deliberately
   *
   * Every relation below is a statement about the origin rather than about a
   * page, and the homepage is the origin's representation. Repeating them on
   * 165 URLs would add bytes to every holder report to say something already
   * true of the site, and the site-wide half of the job is already done by
   * the `<link>` tag in the layout.
   *
   * ## Relative for our own paths, absolute for the docs host
   *
   * RFC 8288 resolves a relative reference against the request URL, so
   * `</.well-known/api-catalog>` points at whichever host served the page.
   * That is the behavior we want: on a preview deployment it names the
   * preview's own catalog, where an absolute URL would send a client to
   * production. The docs live on another origin and have no choice.
   */
  async headers() {
    return [
      {
        source: '/',
        headers: [
          {
            key: 'Link',
            value: [
              '</.well-known/api-catalog>; rel="api-catalog"',
              '</llms.txt>; rel="describedby"; type="text/plain"',
              `<${DOCS_URL}/openapi.yaml>; rel="service-desc"; type="text/yaml"`,
              `<${DOCS_URL}/api-reference/introduction>; rel="service-doc"; type="text/html"`,
            ].join(', '),
          },
        ],
      },
    ];
  },
  experimental: {
    /**
     * Next.js optimizes barrel imports for a built-in list of packages, and
     * lucide-react was on it. @phosphor-icons/react is not, and it ships 1,512
     * icons, so an unoptimized barrel import makes the compiler walk every one of
     * those modules on each build and in dev on every change.
     *
     * The ssr entrypoint the seven server components use is a separate specifier,
     * so it needs naming too.
     */
    optimizePackageImports: [
      '@phosphor-icons/react',
      '@phosphor-icons/react/dist/ssr',
    ],
  },
};

export default nextConfig;
