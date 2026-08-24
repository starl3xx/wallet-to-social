/**
 * End-to-end check of the contract-holders pipeline for a given chain.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/test-contract-holders.ts <address> <chain>
 *
 * Exercises the real getContractHolders() path — contract type detection, token
 * metadata, and holder resolution — rather than hitting the provider APIs directly.
 */

import {
  getContractHolders,
  type SupportedChain,
} from '../lib/contract-holders';

async function main() {
  const [address, chain] = process.argv.slice(2);
  if (!address || !chain) {
    console.error('Usage: test-contract-holders.ts <address> <chain>');
    process.exit(1);
  }

  const started = Date.now();
  const result = await getContractHolders(address, chain as SupportedChain);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\nchain:         ${result.chain}`);
  console.log(`token:         ${result.tokenName} (${result.tokenSymbol})`);
  console.log(`type:          ${result.contractType}`);
  console.log(`total holders: ${result.totalHolders}`);
  console.log(
    `returned:      ${result.wallets.length}${result.truncated ? ' (truncated)' : ''}`
  );
  console.log(`elapsed:       ${elapsed}s`);
  console.log(`\nfirst 5:`);
  for (const w of result.wallets.slice(0, 5)) console.log(`  ${w}`);
}

main().catch((err) => {
  console.error('\nFAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
