import type { NextConfig } from 'next';

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
  /**
   * The OAuth discovery documents, at the paths the specifications name.
   *
   * They are rewrites rather than routes because the App Router will not route
   * a segment whose directory name begins with a dot. An `app/.well-known/`
   * route compiles, emits no warning, and is absent from the build output:
   * confirmed by building it and reading the route list, not by reading a
   * changelog. A 404 on `/.well-known/oauth-protected-resource` presents to a
   * client as "could not reach the MCP server", with the authorization server
   * never seeing a single request, so this is worth the indirection.
   *
   * Both protected-resource paths are here. RFC 9728 puts the document at the
   * root, and a client that lost the `resource_metadata` pointer from our 401
   * probes the path-suffixed form first, so a rewrite that covered only one
   * would work until the day the header went missing.
   */
  async rewrites() {
    return [
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
