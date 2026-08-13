/**
 * Measure the FULL-pipeline match rate on a random sample of real holders.
 *
 * benchmark-match-rate.ts measures what our own graph resolves with zero
 * external calls. This measures what the product actually delivers to a user
 * today — graph plus live web3.bio, Neynar and ENS enrichment — so the two can
 * be compared directly and the site's headline match-rate claim can be checked
 * against something reproducible.
 *
 * Sampling rather than running all ~32k holders keeps the provider spend small.
 * A simple random sample of n from the pooled holder set gives a binomial
 * estimate; the 95% CI is printed so the claim can be stated honestly.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/benchmark-pipeline-sample.ts [n] [seed]
 */
import { batchFetchWeb3Bio } from '../lib/web3bio';
import { batchFetchNeynar } from '../lib/neynar';
import { batchLookupENS } from '../lib/ens';
import { getContractHolders } from '../lib/contract-holders';
import type { SupportedChain } from '../lib/chains';

const SAMPLE = Number(process.argv[2] ?? 500);
const SEED = Number(process.argv[3] ?? 42);

// The exact collections measured by benchmark-match-rate.ts, recorded so this
// sample is drawn from the same population and the two numbers are comparable.
const COLLECTIONS: Array<{ chain: SupportedChain; address: string; name: string }> = [
  { chain: 'ethereum', address: '0x160629982602c135a92775e33771938d02dd79a5', name: 'Fuego' },
  { chain: 'ethereum', address: '0x201ed6c53fe2ab2eaa7550a3cff0c06bf410781c', name: 'ROCKATERAL' },
  { chain: 'ethereum', address: '0xa9cadbc8364cd1dd6c6c9f4172ab80d09b5c1ca3', name: 'Unusual Society' },
  { chain: 'ethereum', address: '0x38793a3fdfd098e820ddf59706280681354341fc', name: 'BRAINROT' },
  { chain: 'ethereum', address: '0x160960fe96d3d61d606c4ce5d39d0bb63758303a', name: 'Rilato' },
  { chain: 'ethereum', address: '0xe21ebcd28d37a67757b9bc7b290f4c4928a430b1', name: 'The Saudis' },
  { chain: 'ethereum', address: '0xed346cef754407662144336fd2835d3600168d1f', name: 'Compas' },
  { chain: 'ethereum', address: '0x155ae5eec7bf1dc2dbee07ef0577fa74e8d8ecb8', name: 'Rock Bottom' },
  { chain: 'ethereum', address: '0xb8ea78fcacef50d41375e44e6814ebba36bb33c4', name: 'Good Vibes Club' },
  { chain: 'robinhood', address: '0xd6577124f96394faee65afd2408f2ffa88445f63', name: 'Spritehood Wisp' },
  { chain: 'robinhood', address: '0x93facfffc40edd42898aa74a1f2ba8ff28662799', name: 'fuwa' },
  { chain: 'robinhood', address: '0xf08c65564eb07d880021105489552080b08e4319', name: 'Robinhood Punks' },
  { chain: 'robinhood', address: '0xb92a3a91849ebff6ed2ecc4a8a79c62a5106c7aa', name: 'RoboBrokers' },
  { chain: 'robinhood', address: '0x14924807ff03f410f0965a25d66bf44e1e926841', name: 'H00dle' },
  { chain: 'robinhood', address: '0xe3b34c4bb0f12c82143745eee6a6cf4e3154b1fa', name: 'CASHCAT' },
  { chain: 'robinhood', address: '0x0130adfd81393dcb5f510469635413bae1cd6402', name: 'Script Kiddies' },
  { chain: 'robinhood', address: '0xc06a2fa2dc084017e5c06a1ed0941042ab363784', name: 'Hoodrats' },
  { chain: 'robinhood', address: '0x57069d845701b50f41327362c1c23789043f8dec', name: 'PitBoys' },
];

/** Deterministic PRNG so a stated sample can be reproduced exactly. */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  console.log(`Pooling holders from ${COLLECTIONS.length} collections…`);
  const pool = new Set<string>();
  for (const c of COLLECTIONS) {
    try {
      const held = await getContractHolders(c.address, c.chain, 10000);
      held.wallets.forEach((w) => pool.add(w.toLowerCase()));
      process.stdout.write(`  ${c.name}: ${held.wallets.length}\n`);
    } catch (e) {
      console.log(`  ${c.name}: SKIPPED (${(e as Error).message})`);
    }
  }

  const all = [...pool].sort(); // sort for determinism before seeded shuffle
  console.log(`\nPooled ${all.length.toLocaleString()} unique holders`);

  // Seeded Fisher-Yates, then take the first n
  const rnd = mulberry32(SEED);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const sample = all.slice(0, Math.min(SAMPLE, all.length));
  console.log(`Sampling ${sample.length} (seed=${SEED})\n`);

  const neynarKey = process.env.NEYNAR_API_KEY;
  if (!neynarKey) throw new Error('NEYNAR_API_KEY required');

  console.log('Running live pipeline…');
  const web3bio = await batchFetchWeb3Bio(sample);
  console.log(`  web3.bio: ${web3bio.size} responded`);
  const neynar = await batchFetchNeynar(sample, neynarKey);
  console.log(`  neynar:   ${neynar.size} responded`);
  const ens = await batchLookupENS(sample);
  console.log(`  ens:      ${ens.size} responded\n`);

  let twitter = 0;
  let farcaster = 0;
  let either = 0;
  let anyIdentity = 0;

  for (const w of sample) {
    const b = web3bio.get(w);
    const n = neynar.get(w);
    const e = ens.get(w);

    const tw = b?.twitter_handle || n?.twitter_handle || e?.twitter || null;
    const fc = b?.farcaster || n?.farcaster || null;
    const other = b?.ens_name || e?.ensName || b?.lens || b?.github || e?.github || null;

    if (tw) twitter++;
    if (fc) farcaster++;
    if (tw || fc) either++;
    if (tw || fc || other) anyIdentity++;
  }

  const n = sample.length;
  const ci = (k: number) => {
    const p = k / n;
    const se = Math.sqrt((p * (1 - p)) / n);
    return `${(p * 100).toFixed(1)}% ±${(1.96 * se * 100).toFixed(1)}`;
  };

  console.log(`FULL PIPELINE on n=${n} random holders (18 collections, 2 chains)`);
  console.log(`  Twitter/X:              ${twitter}  ${ci(twitter)}`);
  console.log(`  Farcaster:              ${farcaster}  ${ci(farcaster)}`);
  console.log(`  X or Farcaster:         ${either}  ${ci(either)}`);
  console.log(`  Any identity (incl ENS/Lens/GitHub): ${anyIdentity}  ${ci(anyIdentity)}`);
  console.log(`\n95% confidence intervals, normal approximation.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
