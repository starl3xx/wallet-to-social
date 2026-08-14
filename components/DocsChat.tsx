'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';

/**
 * Floating docs assistant, backed by Cloudflare AI Search over
 * docs.walletlink.social and the marketing site.
 *
 * Everything loads from help.walletlink.social, our own hostname, rather than
 * the generated *.search.ai.cloudflare.com one. That record is deliberately
 * proxied, so both the 115 KB bundle and every query pass through our zone and
 * hit the per-IP rate limit before they reach AI Search. The public endpoint is
 * unauthenticated by design, and it spends our Workers AI allowance on every
 * answer, so the zone is the only place that spend can be bounded.
 */
const ENDPOINT = 'https://help.walletlink.social';
const SNIPPET_VERSION = 'v0.0.25';

// Routes where a support bubble is noise rather than help. `/admin` is ours,
// and `/success` is a post-payment confirmation where the only useful action is
// the one already on screen.
const HIDDEN_PREFIXES = ['/admin', '/success'];

export function DocsChat() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  const hidden = HIDDEN_PREFIXES.some(
    (p) => pathname === p || pathname?.startsWith(`${p}/`)
  );

  // The custom element only upgrades once the module has registered it. Without
  // gating on that, React renders an unknown tag that stays an empty inline box
  // until the script lands.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.customElements?.get('chat-bubble-snippet')) setReady(true);
  }, []);

  if (hidden) return null;

  return (
    <>
      <Script
        id="cf-ai-search-snippet"
        type="module"
        src={`${ENDPOINT}/assets/${SNIPPET_VERSION}/search-snippet.es.js`}
        // lazyOnload keeps 115 KB off the critical path. The bubble is a
        // secondary affordance; it must not compete with the lookup UI for
        // bandwidth on a first paint.
        strategy="lazyOnload"
        onReady={() => setReady(true)}
      />
      {ready && (
        <chat-bubble-snippet
          api-url={`${ENDPOINT}/`}
          style={
            {
              '--search-snippet-primary-color': '#10b981',
            } as React.CSSProperties
          }
        />
      )}
    </>
  );
}

// React 19 moved the JSX namespace off the global scope and onto the `react`
// module, so the old `declare global { namespace JSX }` form no longer
// registers custom elements and the tag fails to typecheck.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'chat-bubble-snippet': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        'api-url': string;
      };
    }
  }
}
