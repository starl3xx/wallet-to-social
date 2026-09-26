/**
 * Where checkout does not sell, by the buyer's IP (Linear STA-41, decided
 * 2026-09-25).
 *
 * Both checkouts refuse a buyer whose IP locates to a comprehensively
 * sanctioned country or region: the USDC buy (`/api/x402/buy`) and card
 * checkout (`/api/checkout`). Nothing else reads this. The rest of the site,
 * the docs and the free reads stay open everywhere; only a sale is refused.
 *
 * The location is Vercel's, from the edge: `x-vercel-ip-country` is the ISO
 * 3166-1 alpha-2 country, and `x-vercel-ip-country-region` is the region part
 * of the ISO 3166-2 code alone (`43`, not `UA-43`), so the two are joined
 * here. Vercel sets both itself on every request it serves. When they are
 * absent (a local run, or an IP Vercel cannot place) the sale goes ahead: the
 * wallet screen in `lib/sanctions.ts` is the control that fails closed, and
 * this one refines it.
 */
import { NextResponse } from 'next/server';

/**
 * The refused locations. The one place they live.
 *
 * The lawyer may adjust this list (Linear STA-49); change it here and both
 * checkouts follow.
 */
export const RESTRICTED_CHECKOUT_LOCATIONS: {
  /** ISO 3166-1 alpha-2. Cuba, Iran, North Korea, Syria. */
  countries: readonly string[];
  /** ISO 3166-2. Crimea, Sevastopol, Donetsk, Luhansk. */
  regions: readonly string[];
} = {
  countries: ['CU', 'IR', 'KP', 'SY'],
  regions: ['UA-43', 'UA-40', 'UA-14', 'UA-09'],
};

/** What a refused buyer is told. No list named, no detail given. */
export const REGION_RESTRICTED_MESSAGE =
  'Purchases are not available in your region.';

/** Whether a country and region pair is refused. Case-insensitive. */
export function isRestrictedLocation(
  country: string | null,
  region: string | null
): boolean {
  const c = (country ?? '').trim().toUpperCase();
  if (!c) return false;
  if (RESTRICTED_CHECKOUT_LOCATIONS.countries.includes(c)) return true;
  const r = (region ?? '').trim().toUpperCase();
  if (!r) return false;
  // ISO 3166-2 region parts for Ukraine are two digits; a bare `9` is `09`.
  const code = r.includes('-') ? r : `${c}-${/^\d$/.test(r) ? `0${r}` : r}`;
  return RESTRICTED_CHECKOUT_LOCATIONS.regions.includes(code);
}

/**
 * The 403 for a request from a refused location, or null to let it through.
 * Called first in each checkout, before anything is priced or signed.
 */
export function checkoutGeoblock(headers: Headers): NextResponse | null {
  if (
    !isRestrictedLocation(
      headers.get('x-vercel-ip-country'),
      headers.get('x-vercel-ip-country-region')
    )
  ) {
    return null;
  }
  return NextResponse.json(
    { error: REGION_RESTRICTED_MESSAGE, code: 'REGION_RESTRICTED' },
    { status: 403 }
  );
}
