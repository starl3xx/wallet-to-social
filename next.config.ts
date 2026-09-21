import type { NextConfig } from 'next';
/**
 * Relative, not `@/lib/site-url`. This file is loaded by Next's own config
 * loader rather than compiled with the app, and the `@/` alias is a tsconfig
 * path the app's compiler resolves. A relative specifier needs nobody's help.
 */
import { DOCS_URL } from './lib/site-url';

/**
 * The pages that answer markdown when a client asks for it.
 *
 * One list, read twice below: once to build the rewrite that swaps in the
 * markdown handler, once to put `Vary: Accept` on the HTML the same paths
 * serve. Two hand-kept lists would drift, and the drift is invisible from
 * either side: a path negotiating without `Vary` is a cache poisoning waiting
 * for a shared cache that does not key on Accept by default, and a path with
 * `Vary` and no rewrite declares a variance that never happens.
 *
 * A path is on this list only if `app/api/markdown/documents.ts` can build
 * its document from the same source the page renders from. Editorial pages
 * (`/vs/*`, `/privacy`) are deliberately absent: their content has no source
 * but the page, so a twin would be a second copy. `scripts/check-invariants.ts`
 * asserts this list and the handler's branches are the same set.
 */
const MARKDOWN_NEGOTIABLE = [
  '/',
  '/pricing',
  '/blog',
  '/blog/:slug',
  '/holders',
  '/holders/:chain/:address',
];

/**
 * Anchored at both ends by Next, which is the whole reason for the `.*`.
 *
 * `matchHas` in `next/dist/shared/lib/router/utils/prepare-destination.js`
 * compiles this as `new RegExp(\`^${value}$\`)`. A bare `text/markdown`
 * would therefore match only a request whose Accept header is exactly those
 * fourteen characters and nothing else, which no real client sends: every
 * agent and every library sends a list. It would have failed closed, serving
 * HTML to everyone forever with nothing in any log to say so.
 */
const ACCEPTS_MARKDOWN = {
  type: 'header',
  key: 'accept',
  value: '.*text/markdown.*',
} as const;

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
    return {
      /**
       * `beforeFiles`, which is the whole reason this is an object and not
       * the array it used to be.
       *
       * An array returned from `rewrites()` becomes `afterFiles`, and
       * `afterFiles` rules are only consulted once nothing in the app
       * answered the request. Every page below negotiates from a URL that IS
       * a page, so an `afterFiles` rule for `/pricing` is dead code: the page
       * matches first, always, and the rewrite is never reached. Measured,
       * not reasoned about: the rules compiled into
       * `.next/dev/routes-manifest.json` with the correct regex and the
       * correct `has`, and `/pricing` with `Accept: text/markdown` still
       * answered `text/html`.
       *
       * `beforeFiles` runs ahead of the filesystem, which is what a
       * representation swap needs. It is safe here only because every rule
       * carries `has`: a request that does not ask for markdown matches
       * nothing and reaches the page exactly as before.
       */
      beforeFiles: [
        /**
         * Blog posts as markdown, at the URL a client guesses:
         * /blog/<slug>.md.
         *
         * A rewrite because neither obvious path exists. A dynamic segment is
         * a whole directory name, so `app/blog/[slug].md/route.ts` is a
         * literal segment spelled "[slug].md" and matches nothing;
         * `app/blog/[slug]/route.ts` is the right segment and collides with
         * the `page.tsx` already there, which is a build error rather than a
         * fallback. So the handler lives at `app/api/blog-markdown/[slug]`
         * and this maps the public URL onto it.
         *
         * Under /api for tidiness, not for exclusion. A rewrite is resolved
         * server-side, so a crawler only ever sees /blog/<slug>.md, which
         * robots.txt allows: the `Disallow: /api/` there never reaches this
         * request. What keeps the twin out of the index is the rel="canonical"
         * Link header the handler answers with, naming the HTML page.
         *
         * `:slug` stops at the literal `.md`, because the parameter compiles
         * to a lazy `[^/#?]+?`: /blog/foo.md rewrites with slug=foo, and
         * /blog/foo does not match this rule at all and is served by the page
         * as before.
         *
         * It moved here from `afterFiles` with the negotiation rules, and it
         * has to stay ABOVE them. `/blog/:slug` matches `/blog/a-post.md`
         * with the slug "a-post.md", so with the negotiation rule first, a
         * request for the explicit markdown URL carrying `Accept:
         * text/markdown`, which is exactly what a careful client sends, would
         * rewrite to `/api/markdown/blog/a-post.md`, find no post under that
         * slug, and answer 404. It would have kept working for everyone who
         * asked less carefully.
         *
         * Moving it changed nothing else: no page and no file has ever
         * matched `/blog/<slug>.md`, so before or after the filesystem check
         * it resolves the same way.
         */
        {
          source: '/blog/:slug.md',
          destination: '/api/blog-markdown/:slug',
        },
        ...MARKDOWN_NEGOTIABLE.map((source) => ({
          source,
          has: [ACCEPTS_MARKDOWN],
          destination: `/api/markdown${source === '/' ? '' : source}`,
        })),
      ],
      afterFiles: [
        /**
         * The OAuth discovery documents, at the paths the specifications
         * name.
         *
         * They are rewrites rather than routes because the App Router will
         * not route a segment whose directory name begins with a dot. An
         * `app/.well-known/` route compiles, emits no warning, and is absent
         * from the build output: confirmed by building it and reading the
         * route list, not by reading a changelog. A 404 on
         * `/.well-known/oauth-protected-resource` presents to a client as
         * "could not reach the MCP server", with the authorization server
         * never seeing a single request, so this is worth the indirection.
         *
         * Both protected-resource paths are here. RFC 9728 puts the document
         * at the root, and a client that lost the `resource_metadata` pointer
         * from our 401 probes the path-suffixed form first, so a rewrite that
         * covered only one would work until the day the header went missing.
         *
         * These stay in `afterFiles`, where they have always been: no page
         * competes for these paths, so running before the filesystem would
         * buy nothing and widen what runs ahead of every request.
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
         * dot, so the handler lives at `app/api/api-catalog` and this maps
         * the public URL onto it. `afterFiles` like its neighbours, because
         * no page competes for the path.
         */
        {
          source: '/.well-known/api-catalog',
          destination: '/api/api-catalog',
        },
      ],
    };
  },
  /**
   * `Vary: Accept` on the HTML half of every negotiated page.
   *
   * Vercel's CDN already includes Accept in its cache key without being
   * asked, so this is not what stops a browser being handed markdown from
   * Vercel's own edge. It is for every cache between there and the client:
   * a corporate proxy, a library's HTTP cache, the browser's own. Without
   * it, one agent's markdown request can be replayed to the next person who
   * opens the page in a browser.
   *
   * The markdown responses declare it too, in `app/api/markdown`. Both halves
   * of a negotiated pair have to say it; a `Vary` on one representation says
   * nothing about the other.
   */
  /**
   * A second rule for `/`, and Next applies both.
   *
   * The homepage is in `MARKDOWN_NEGOTIABLE`, so it already has a `Vary`
   * rule above; this adds `Link` beside it rather than folding the two
   * together, because they are answers to different questions and the
   * negotiation list should not have to know about link relations.
   *
   * ## `Link` headers, RFC 8288 and RFC 9727 section 3
   *
   * The catalog is only discoverable if something points at it, and the two
   * ways to point are this header and the markup. Both ship: the header
   * serves a client that issues a HEAD and never receives a body to parse,
   * and the `<link>` in `app/layout.tsx` serves one that parses HTML. The
   * RFC's own example carries both.
   *
   * ## This survives, and `Vary` in the same position does not
   *
   * Worth stating because the opposite was written down first and was wrong.
   * The `Vary` above is measured to be overwritten by the App Router's own,
   * and that was generalized to `Link` without testing it. It does not hold:
   * measured in `next dev` on 2026-09-21, the homepage answers with TWO
   * `Link` lines, this one and the font preloads Next emits, which is
   * exactly how RFC 8288 expects multiple links to arrive. `Vary` is the
   * special case, not this.
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
      ...MARKDOWN_NEGOTIABLE.map((source) => ({
        source,
        headers: [{ key: 'Vary', value: 'Accept' }],
      })),
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
