import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
