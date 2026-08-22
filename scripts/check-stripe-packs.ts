/**
 * Does Stripe agree with `lib/packs.ts`?
 *
 * Usage: npx tsx --env-file=.env.local scripts/check-stripe-packs.ts
 *
 * ## Why this exists
 *
 * The pack prices live in two places that cannot see each other: `lib/packs.ts`
 * decides how many matches a purchase grants, and a Stripe Price decides what
 * the buyer is charged. Nothing connects them, so they can disagree silently
 * and the first report is a customer who paid $299 and got 250 matches.
 *
 * Every failure below is one somebody will otherwise find at checkout:
 *
 * - **A recurring price.** Stripe rejects a recurring price in a
 *   `mode: 'payment'` session at creation time, so the button just errors.
 * - **A product id instead of a price id.** `prod_…` looks right and fails with
 *   an opaque Stripe error.
 * - **The wrong amount.** The most expensive kind of wrong, because it succeeds.
 * - **A test-mode price against a live key**, or the reverse. Price ids do not
 *   encode which mode they belong to, so the only way to find out is to ask.
 * - **An archived price.** Still resolvable, no longer purchasable.
 *
 * Read-only. It creates nothing and changes nothing.
 */
import Stripe from 'stripe';
import { PACKS, PACK_IDS } from '../lib/packs';

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY is required.');
    console.error(
      'It is not in .env.local. Copy it from Vercel (Settings, Environment ' +
        'Variables) or from the Stripe dashboard (Developers, API keys).'
    );
    process.exit(1);
  }

  console.log(
    `Checking against the ${key.startsWith('sk_live') ? 'LIVE' : 'TEST'} Stripe account.\n`
  );

  const stripe = new Stripe(key);
  let problems = 0;

  for (const id of PACK_IDS) {
    const pack = PACKS[id];
    const envVar = pack.priceEnvVar;
    const priceId = process.env[envVar];

    if (!priceId) {
      console.error(`  MISSING  ${pack.name}: ${envVar} is not set`);
      problems++;
      continue;
    }

    if (priceId.startsWith('prod_')) {
      console.error(
        `  WRONG ID ${pack.name}: ${envVar} holds a product id (${priceId}). ` +
          `It needs the price id, which starts price_ and is on the price ` +
          `itself rather than the product.`
      );
      problems++;
      continue;
    }

    let price: Stripe.Price;
    try {
      price = await stripe.prices.retrieve(priceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  NOT FOUND ${pack.name}: ${priceId}`);
      console.error(
        `           ${message.split('\n')[0]}\n` +
          `           If the price exists in the dashboard, it was probably ` +
          `created in the other mode: a test price is invisible to a live key.`
      );
      problems++;
      continue;
    }

    const issues: string[] = [];

    if (price.recurring) {
      issues.push(
        `it is recurring (every ${price.recurring.interval}), and a recurring ` +
          `price cannot be used in a one-time checkout. Prices cannot be ` +
          `converted: archive it and make a new one-off price.`
      );
    }
    if (price.unit_amount !== pack.priceCents) {
      issues.push(
        `Stripe charges ${fmt(price.unit_amount)} but lib/packs.ts grants ` +
          `${pack.matches.toLocaleString()} matches for ${fmt(pack.priceCents)}`
      );
    }
    if (price.currency !== 'usd') {
      issues.push(`currency is ${price.currency.toUpperCase()}, expected USD`);
    }
    if (!price.active) {
      issues.push('the price is archived, so nobody can buy it');
    }

    if (issues.length > 0) {
      console.error(`  WRONG    ${pack.name} (${priceId}):`);
      for (const issue of issues) console.error(`           ${issue}`);
      problems += issues.length;
      continue;
    }

    console.log(
      `  ok       ${pack.name.padEnd(9)} ${fmt(price.unit_amount)} one-off, ` +
        `${pack.matches.toLocaleString()} matches`
    );
  }

  console.log();
  if (problems > 0) {
    console.error(
      `${problems} problem(s). Fix them before anyone can buy a pack; ` +
        `see walletlink-stripe-vercel-setup.md.`
    );
    process.exit(1);
  }
  console.log('Stripe and lib/packs.ts agree.');
}

function fmt(cents: number | null): string {
  if (cents === null) return 'no amount';
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
