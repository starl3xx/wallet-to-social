'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useTheme } from '@/components/ThemeProvider';

/**
 * Floating docs assistant, backed by Cloudflare AI Search over
 * docs.walletlink.social and the marketing site.
 *
 * Everything loads from help.walletlink.social, our own hostname, rather than
 * the generated *.search.ai.cloudflare.com one. That record is deliberately
 * proxied, so both the bundle and every query pass through our zone and hit the
 * per-IP rate limit before they reach AI Search. The public endpoint is
 * unauthenticated by design and spends Workers AI allowance on every answer, so
 * the zone is the only place that spend can be bounded.
 */
const ENDPOINT = 'https://help.walletlink.social';

// Pinned. The text overrides below target the widget's internal class names,
// which are private API. Pinning is what makes that safe: an upgrade is a
// deliberate act that comes with re-checking those selectors.
const SNIPPET_VERSION = 'v0.0.25';

const HIDDEN_PREFIXES = ['/admin', '/success'];

const PLACEHOLDER = 'Ask about coverage, pricing, or the API';

/**
 * The widget exposes exactly four attributes: api-url, placeholder, theme and
 * hide-branding. Everything else visual is CSS custom properties, and the
 * remaining copy is hardcoded in its template.
 *
 * Its shadow root is `mode: "open"`, so the copy is still reachable. These rules
 * blank the hardcoded strings and substitute ours through generated content.
 *
 * Delivered via adoptedStyleSheets rather than an appended <style>: the widget
 * re-renders by replacing its shadow DOM, which would discard an appended node
 * the first time a message arrived. Adopted sheets attach to the shadow root
 * itself and survive that.
 */
const OVERRIDES = `
  .chat-header-title,
  .chat-empty-title,
  .chat-empty-description {
    /* font-size collapses the original text so it contributes no layout.
       visibility removes it from the accessibility tree: hiding it visually
       alone would leave a screen reader announcing the stock copy while
       sighted users saw ours. Both properties are needed, for two different
       audiences. */
    font-size: 0;
    visibility: hidden;
  }

  /* visibility is inherited, and descendants may override it, so the
     replacement text and the header icon are put back explicitly. */
  .chat-header-title::after,
  .chat-empty-title::before,
  .chat-empty-description::before,
  .chat-header-title svg {
    visibility: visible;
  }

  .chat-header-title::after {
    content: "walletlink assistant";
    font-size: var(--search-snippet-font-size-lg);
    font-weight: var(--search-snippet-font-weight-bold);
  }
  .chat-empty-title::before {
    content: "Ask a question";
    font-size: var(--search-snippet-font-size-lg);
    font-weight: var(--search-snippet-font-weight-medium);
  }
  .chat-empty-description::before {
    content: "Coverage, pricing, or anything in the API docs";
    font-size: var(--search-snippet-font-size-sm);
  }
`;

export function DocsChat() {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const hostRef = useRef<HTMLElement | null>(null);

  const hidden = HIDDEN_PREFIXES.some(
    (p) => pathname === p || pathname?.startsWith(`${p}/`)
  );

  // The shadow root only exists once the element upgrades, which happens after
  // the module registers it, so this polls briefly rather than assuming.
  const applyOverrides = useCallback(() => {
    const host = hostRef.current;
    if (!host?.shadowRoot) return false;
    const root = host.shadowRoot;
    if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in root)) {
      return true; // Nothing to do on a browser without adopted sheets.
    }
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(OVERRIDES);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return true;
  }, []);

  useEffect(() => {
    if (hidden) return;
    if (applyOverrides()) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      // Generous window: the loader is lazyOnload, so on a slow connection the
      // module can land well after first paint.
      if (applyOverrides() || Date.now() - started > 30_000) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [hidden, applyOverrides]);

  if (hidden) return null;

  return (
    <>
      <Script
        id="cf-ai-search-snippet"
        type="module"
        src={`${ENDPOINT}/assets/${SNIPPET_VERSION}/search-snippet.es.js`}
        strategy="lazyOnload"
      />
      {/* Rendered unconditionally rather than gated on a script-load callback.
          Custom elements upgrade themselves: the browser walks the document and
          upgrades any matching tag the moment customElements.define runs, so a
          tag that exists before its definition is the normal case, not a broken
          one. Gating on next/script's onReady added a failure mode the platform
          already handles, and it fired unreliably under lazyOnload, which left
          the element registered but never inserted and no bubble on the page.
          Before upgrade it is an empty inline element with no content, so there
          is nothing to see and nothing to shift. */}
      <chat-bubble-snippet
          ref={hostRef}
          api-url={`${ENDPOINT}/`}
          placeholder={PLACEHOLDER}
          // Follows the site's own toggle rather than the OS setting. The
          // widget defaults to "auto", which reads prefers-color-scheme and
          // would show a light bubble on a manually darkened site.
          theme={resolvedTheme}
          // CLAUDE.md: never reference an API provider in the UI. The default
          // footer reads "Powered by Cloudflare AI Search", which is precisely
          // that, on the most customer-visible surface we have.
          hide-branding="true"
          style={
            {
              '--search-snippet-primary-color': 'var(--accent-brand)',
              '--search-snippet-primary-hover': 'var(--accent-brand-hover)',
              '--chat-bubble-button-size': '56px',
              '--chat-bubble-button-icon-color': 'var(--accent-brand-foreground)',
            } as React.CSSProperties
          }
        />
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
        ref?: React.Ref<HTMLElement>;
        'api-url': string;
        placeholder?: string;
        theme?: 'light' | 'dark' | 'auto';
        'hide-branding'?: string;
      };
    }
  }
}
