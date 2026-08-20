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
