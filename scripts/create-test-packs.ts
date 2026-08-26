/**
 * Create the five pack prices in Stripe TEST mode.
 *
 * Usage: npx tsx --env-file=.env.local scripts/create-test-packs.ts
 *
 * Reads `STRIPE_TEST_SECRET_KEY`, falling back to `STRIPE_SECRET_KEY`. Two
 * names rather than one so both keys can live in `.env.local` at once: the live
 * key is what the app and `check-stripe-packs.ts` need, and swapping it back
 * and forth to run this is how the wrong one ends up in place afterwards.
 *
 * ## Why a script rather than five visits to the dashboard
 *
 * The amounts come from `lib/packs.ts`, so they cannot be mistyped, and the
 * prices cannot be created as recurring by a mis-click. Both are mistakes that
 * only surface at checkout, and one of them surfaces as a wrong charge.
 *
 * ## Why test mode needs its own prices at all
 *
 * A Stripe price belongs to one mode. A live price is invisible to a test key
 * and the reverse, so testing with card 4242 needs a second set. They are
 * separate objects with separate ids, which is why the env vars differ per
 * Vercel environment rather than being one value.
 *
 * ## Idempotent, through lookup keys
 *
 * Each price carries a lookup key (`pack_trial_test` and so on) and the script
 * reuses an existing price with that key rather than making a second one.
 * Running it twice is safe and prints the same ids. If `lib/packs.ts` has
 * changed since, the old price is archived and a new one takes over the key,
 * so the printed ids are always the ones that match the code.
 *
 * ## It refuses a live key
 *
 * Deliberately. A script that creates products is exactly the kind that should
 * not be able to touch the live catalogue by accident.
 */
import Stripe from 'stripe';
import { PACKS, PACK_IDS } from '../lib/packs';

async function main() {
  const key =
    process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error(
      'No Stripe key. Add STRIPE_TEST_SECRET_KEY=sk_test_... to .env.local.'
    );
    process.exit(1);
  }
  if (!key.startsWith('sk_test')) {
    console.error(
      'This is not a test key, and it refuses to run against live: a script\n' +
        'that creates products should not be able to reach the live catalogue\n' +
        'by accident.\n\n' +
        'Add the test key to .env.local as a SECOND variable, leaving the live\n' +
        'one where it is:\n\n' +
        '  STRIPE_TEST_SECRET_KEY=sk_test_...\n\n' +
        'Stripe: Developers, API keys, with the test-mode toggle on.'
    );
    process.exit(1);
  }

  const stripe = new Stripe(key);
  const env: string[] = [];

  for (const id of PACK_IDS) {
    const pack = PACKS[id];
    const lookupKey = `pack_${id}_test`;

    const existing = await stripe.prices.list({
      lookup_keys: [lookupKey],
      limit: 1,
    });
    const found = existing.data[0];

    // A price cannot be edited, so one that no longer matches lib/packs.ts is
    // replaced rather than reused. Its id is never printed: the env block
    // below is what gets pasted into Vercel, and a stale id in it is a wrong
    // charge at checkout.
    const stale =
      !!found && (found.unit_amount !== pack.priceCents || !!found.recurring);

    if (found && !stale) {
      console.log(`  reused  ${pack.name.padEnd(9)} ${found.id}`);
      env.push(`${pack.priceEnvVar}=${found.id}`);
      continue;
    }

    const product = stale
      ? found.product
      : (
          await stripe.products.create({
            name: `walletlink ${pack.name}`,
            description: `${pack.matches.toLocaleString()} matches. ${pack.fits}.`,
          })
        ).id;

    const price = await stripe.prices.create({
      product: typeof product === 'string' ? product : product.id,
      unit_amount: pack.priceCents,
      currency: 'usd',
      lookup_key: lookupKey,
      // Archiving a price does not release its lookup key, so replacing one
      // needs the key moved explicitly. Without this, the create fails with
      // "lookup_key already exists" and the stale price stays in place.
      transfer_lookup_key: stale,
      // No `recurring`, so this is one-off. That is the whole point.
    });

    if (stale) {
      await stripe.prices.update(found.id, { active: false });
      console.log(
        `  replaced ${pack.name.padEnd(9)} ${price.id}  (${found.id} no longer matched lib/packs.ts and is archived)`
      );
    } else {
      console.log(
        `  created ${pack.name.padEnd(9)} ${price.id}  $${pack.priceCents / 100}, ${pack.matches.toLocaleString()} matches`
      );
    }
    env.push(`${pack.priceEnvVar}=${price.id}`);
  }

  console.log('\nAdd these to Vercel, scoped to Preview only:\n');
  for (const line of env) console.log(`  ${line}`);
  console.log(
    '\nPreview only. Production keeps the live price ids, and mixing them\n' +
      'means a real card against a test price or the reverse, which fails\n' +
      'with "No such price".'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
