/** One-time bootstrap or manual refresh; writes only landing_identity_hero_v1. */
import { refreshHeroSnapshot } from '../lib/identity-hero/server';
const snapshot = await refreshHeroSnapshot();
console.log(
  JSON.stringify({
    checkedAt: snapshot.checkedAt,
    profiles: snapshot.accounts.map((p) => ({
      id: p.id,
      wallets: p.wallets.length,
    })),
    sample: !!snapshot.sample,
  })
);
