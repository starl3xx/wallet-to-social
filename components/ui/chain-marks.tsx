/**
 * The seven network marks, as their owners publish them.
 *
 * ## Where these come from
 *
 * Extracted from `@web3icons/core` 4.0.55 (MIT) and inlined, so the marks are
 * versioned in this repository and nothing joins the runtime bundle. They are
 * the real assets, not redrawings: an earlier pass drew them by eye to decide
 * the layout, and every one of those was replaced before this shipped.
 *
 * ## What was changed, and what was not
 *
 * Six of the seven sit knocked out of a full-bleed coloured square that the
 * icon set composes as a container. That container is rounded to 6px, which is
 * `--radius-sm`, the token this product already uses for badges and inline
 * code. The clip path is rounded with it: rounding the plate alone leaves the
 * mark painting back into the corners that were just cut.
 *
 * **Base is untouched.** Its primary mark is a solid blue square, confirmed
 * against brand.base.org/core-identifiers, so it already carries its own
 * corners and needs no plate. Putting Base on a blue plate and knocking it out
 * in white, which is what the icon set ships, inverts the one mark that already
 * had the right silhouette.
 *
 * No logo geometry and no brand colour is altered anywhere here. Base's
 * guidelines are explicit and the others read the same way: do not distort, do
 * not recolour, do not rotate. Arbitrum's plate is `#213147` because navy is
 * their primary and `#12AAFF` is the accent inside the mark; it looks darker
 * than its neighbours because it is, not because something is missing.
 */
'use client';

import { useId } from 'react';
import type { SupportedChain } from '@/lib/chains';

interface MarkProps {
  className?: string;
}

/** Ethereum. */
export function EthereumMark({ className }: MarkProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <g clipPath={`url(#ethereum__a-${uid})`}>
        <rect width="24" height="24" rx="6" fill="#000" />
        <path fill="#8FFCF3" d="M12 4v5.912l5 2.237z" />
        <path fill="#CABCF8" d="m12 4-5 8.148 5-2.235z" />
        <path fill="#CBA7F5" d="M12 15.98V20l5-6.92z" />
        <path fill="#74A0F3" d="M12 20v-4.02l-5-2.9z" />
        <path fill="#CBA7F5" d="m12 15.049 5-2.9-5-2.236z" />
        <path fill="#74A0F3" d="m7 12.149 5 2.9V9.913z" />
        <path
          fill="#202699"
          fillRule="evenodd"
          d="m12 15.048-5-2.9L12 4l5 8.148zm-4.67-3.136 4.588-7.475v5.435zm-.068.204 4.656-2.068v4.768zm4.816-2.068v4.768l4.653-2.7zm0-.176 4.588 2.04-4.588-7.475z"
          clipRule="evenodd"
        />
        <path
          fill="#202699"
          fillRule="evenodd"
          d="m12 15.917-5-2.84L12 20l5-6.924zm-4.44-2.341 4.36 2.48v3.56zm4.519 2.48v3.56l4.36-6.04z"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id={`ethereum__a-${uid}`}>
          <rect width="24" height="24" rx="6" />
        </clipPath>
      </defs>
    </svg>
  );
}

/** Base. */
export function BaseMark({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path
        fill="#00F"
        d="M3 4.706c0-.585 0-.877.11-1.101.106-.215.28-.39.496-.495C3.83 3 4.122 3 4.706 3h14.588c.585 0 .876 0 1.101.11.215.105.389.28.494.495.111.225.111.517.111 1.101v14.588c0 .585 0 .876-.11 1.101-.106.215-.28.389-.495.494-.225.111-.517.111-1.101.111H4.706c-.585 0-.876 0-1.101-.11a1.08 1.08 0 0 1-.494-.495C3 20.17 3 19.878 3 19.294z"
      />
    </svg>
  );
}

/** Robinhood Chain. */
export function RobinhoodMark({ className }: MarkProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <g clipPath={`url(#robinhood__a-${uid})`}>
        <rect width="24" height="24" rx="6" fill="#CF0" />
        <path
          fill="#1C180D"
          d="M5.597 20h.37c.067 0 .134-.032.157-.086C8.918 13.13 11.958 9.77 13.866 7.76c.078-.086.045-.15-.068-.15h-3.41a.4.4 0 0 0-.315.15l-2.446 2.889c-.359.428-.448.824-.448 1.39v2.954c-.797 2.13-1.302 3.574-1.672 4.88-.023.083.011.128.09.128M17.905 4.43c-.527-.534-2.906-.555-4.006-.149a2.2 2.2 0 0 0-.55.31 28 28 0 0 0-2.322 2.12c-.079.074-.045.149.067.149h3.782c.347 0 .55.193.55.524v4.066c0 .107.09.14.156.043l2.278-2.835c.37-.46.483-.6.584-1.242.134-.941.056-2.386-.54-2.985m-4.88 10.787 1.559-2.45a.4.4 0 0 0 .045-.193V8.486c0-.107-.079-.15-.157-.064-2.345 2.493-4.174 5.115-5.868 8.272-.043.079.01.15.112.117l3.5-1.027c.395-.116.618-.268.808-.567"
        />
      </g>
      <defs>
        <clipPath id={`robinhood__a-${uid}`}>
          <rect width="24" height="24" rx="6" />
        </clipPath>
      </defs>
    </svg>
  );
}

/** Arbitrum. */
export function ArbitrumMark({ className }: MarkProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <g clipPath={`url(#arbitrum-one__a-${uid})`}>
        <rect width="24" height="24" rx="6" fill="#213147" />
        <path
          fill="#fff"
          d="m13.203 13.216-.787 2.124a.27.27 0 0 0 0 .183l1.354 3.655 1.565-.89-1.879-5.072c-.042-.117-.21-.117-.253 0m1.577-3.573a.135.135 0 0 0-.253 0l-.787 2.124a.27.27 0 0 0 0 .183l2.217 5.985 1.565-.89z"
        />
        <path
          fill="#fff"
          d="M11.999 4.991a.24.24 0 0 1 .111.03l5.969 3.393a.22.22 0 0 1 .112.19v6.787a.22.22 0 0 1-.112.19l-5.969 3.395a.2.2 0 0 1-.111.029.24.24 0 0 1-.113-.03l-5.968-3.39a.22.22 0 0 1-.112-.19v-6.79a.22.22 0 0 1 .112-.19l5.969-3.393a.23.23 0 0 1 .111-.03m0-.991c-.213 0-.426.054-.616.163L5.416 7.556a1.21 1.21 0 0 0-.616 1.05v6.787c0 .433.234.834.616 1.05l5.968 3.394a1.25 1.25 0 0 0 1.232 0l5.968-3.394a1.21 1.21 0 0 0 .616-1.05V8.606a1.21 1.21 0 0 0-.616-1.05l-5.97-3.393A1.24 1.24 0 0 0 11.998 4"
        />
        <path
          fill="#fff"
          d="m8.052 17.943.55-1.482 1.105.905-1.034.93zm3.445-9.823H9.984a.27.27 0 0 0-.254.175l-3.243 8.757 1.565.89L11.623 8.3a.132.132 0 0 0-.127-.179"
        />
        <path
          fill="#fff"
          d="M14.144 8.12h-1.513a.27.27 0 0 0-.253.175l-3.704 10 1.565.89 4.032-10.886a.133.133 0 0 0-.127-.179"
        />
      </g>
      <defs>
        <clipPath id={`arbitrum-one__a-${uid}`}>
          <rect width="24" height="24" rx="6" />
        </clipPath>
      </defs>
    </svg>
  );
}

/** Polygon. */
export function PolygonMark({ className }: MarkProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <g clipPath={`url(#polygon__a-${uid})`}>
        <rect width="24" height="24" rx="6" fill={`url(#polygon__b-${uid})`} />
        <path
          fill="#fff"
          d="m15.88 14.86 3.794-2.165a.64.64 0 0 0 .326-.558v-4.33a.64.64 0 0 0-.326-.556L15.88 5.086a.66.66 0 0 0-.65 0L11.432 7.25a.64.64 0 0 0-.325.557v7.737l-2.662 1.517-2.661-1.517v-3.036l2.661-1.517 1.755 1.001V9.958l-1.43-.816a.66.66 0 0 0-.65 0l-3.796 2.165a.64.64 0 0 0-.325.557v4.33c0 .229.124.442.325.557l3.796 2.165c.2.114.45.114.65 0l3.796-2.165a.64.64 0 0 0 .325-.557V8.455l.048-.026 2.613-1.49 2.661 1.516v3.036l-2.661 1.517-1.753-.999v2.037l1.427.814a.66.66 0 0 0 .651 0z"
        />
      </g>
      <defs>
        <linearGradient
          id={`polygon__b-${uid}`}
          x1="3.948"
          x2="19.217"
          y1="16.617"
          y2="7.645"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="#A726C1" />
          <stop offset=".88" stop-color="#803BDF" />
          <stop offset="1" stop-color="#7B3FE4" />
        </linearGradient>
        <clipPath id={`polygon__a-${uid}`}>
          <rect width="24" height="24" rx="6" />
        </clipPath>
      </defs>
    </svg>
  );
}

/** Optimism. */
export function OptimismMark({ className }: MarkProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <g clipPath={`url(#optimism__a-${uid})`}>
        <rect width="24" height="24" rx="6" fill="#FE0420" />
        <path
          fill="#fff"
          fillRule="evenodd"
          d="M4.859 15.378q.87.622 2.233.622 1.647 0 2.633-.745.984-.754 1.385-2.277.24-.933.413-1.923.056-.353.056-.59 0-.776-.4-1.331a2.4 2.4 0 0 0-1.1-.845Q9.381 7.999 8.5 8q-3.238 0-4.018 3.055a36 36 0 0 0-.423 1.923 4 4 0 0 0-.058.6q0 1.166.859 1.8m4.133-2.467c-.22.851-.824 1.405-1.74 1.405-.907 0-1.216-.613-1.053-1.405q.206-1.078.412-1.822c.236-.919.792-1.405 1.74-1.405.903 0 1.198.605 1.042 1.405a26 26 0 0 1-.401 1.822m3.469 3.01a.24.24 0 0 0 .19.078h1.514a.33.33 0 0 0 .212-.079.33.33 0 0 0 .122-.206l.479-2.24h1.54c.973 0 1.733-.471 2.29-.891q.848-.63 1.125-1.943.068-.309.067-.595 0-.992-.756-1.52Q18.496 8 17.26 8h-2.962a.33.33 0 0 0-.212.08.33.33 0 0 0-.122.206l-1.538 7.428a.28.28 0 0 0 .034.206m5.413-5.304c-.14.612-.673 1.172-1.3 1.172h-1.28l.441-2.105h1.336c.455 0 .835.09.835.59q0 .148-.032.343"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id={`optimism__a-${uid}`}>
          <rect width="24" height="24" rx="6" />
        </clipPath>
      </defs>
    </svg>
  );
}

/** BNB Chain. */
export function BnbMark({ className }: MarkProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <g clipPath={`url(#binance-smart-chain__a-${uid})`}>
        <rect width="24" height="24" rx="6" fill="#F0B90B" />
        <path
          fill="#fff"
          d="M7.635 6.449 12 4l4.364 2.449-1.6.907L12 5.809 9.24 7.356zm8.73 3.093-1.6-.906L12 10.182 9.24 8.636l-1.605.906v1.81l2.756 1.546v3.089l1.609.906 1.604-.906v-3.09l2.76-1.546zm0 4.903V12.63l-1.6.907v1.809zm1.141.64-2.76 1.542v1.813l4.365-2.453v-4.898l-1.605.902zm-1.604-7.09 1.6.907v1.81l1.609-.903V7.996l-1.605-.907L15.902 8zm-5.511 9.29v1.808L12 20l1.604-.907V17.29l-1.604.9-1.605-.907zM7.635 14.44l1.6.907v-1.81l-1.6-.906v1.813zm2.756-6.444L12 8.902l1.604-.906L12 7.089 10.395 8zm-3.898.906 1.605-.906-1.6-.907L4.888 8v1.813l1.605.903zm0 3.09-1.604-.903v4.898l4.364 2.453v-1.818L6.498 15.08v-3.093z"
        />
      </g>
      <defs>
        <clipPath id={`binance-smart-chain__a-${uid}`}>
          <rect width="24" height="24" rx="6" />
        </clipPath>
      </defs>
    </svg>
  );
}

/**
 * Keyed by `SupportedChain`, so a chain added to `lib/chains.ts` without a mark
 * is a type error rather than a blank tile nobody notices.
 */
export const CHAIN_MARKS: Record<
  SupportedChain,
  (props: MarkProps) => React.JSX.Element
> = {
  ethereum: EthereumMark,
  base: BaseMark,
  robinhood: RobinhoodMark,
  arbitrum: ArbitrumMark,
  polygon: PolygonMark,
  optimism: OptimismMark,
  bsc: BnbMark,
};
