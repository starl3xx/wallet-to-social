/**
 * Does `check-invariants.ts` actually catch anything?
 *
 * The same question `check-palette-guard.mjs` asks of the palette guard, and
 * for the same reason: a guard verified only against code that already passes
 * proves nothing. This repo has now had three guards report clean over live
 * violations, twice for the palette and once for the published figures.
 *
 * The invariants guard nearly made it four. On the day it was written, three
 * of its assertions passed while the code they claimed to protect was deleted:
 *
 *   - the TTL assertion signed the wrong message, so the request was refused
 *     by the message binding and the TTL was never reached
 *   - the HMAC assertion recomputed the HMAC locally, so it verified itself
 *   - the backup assertion used `[a-z_]+`, which cannot match a table name
 *     with digits in it, and `x402_recovery_redemptions` has three
 *
 * Each mutation below reintroduces a defect that was really in this codebase,
 * or really nearly was. The guard must fail on every one of them, and the file
 * is restored afterwards whatever happens.
 *
 * Run: npx tsx scripts/check-invariants-guard.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

interface Mutation {
  name: string;
  file: string;
  from: string;
  to: string;
}

const MUTATIONS: Mutation[] = [
  {
    name: 'the naive Drizzle code check (shipped, found 2026-08-25)',
    file: 'lib/credits.ts',
    from: "if ((e as { code?: unknown }).code === '23505') return true;",
    to: 'if (false) return true;',
  },
  {
    name: 'settlementIdFor stops lowercasing',
    file: 'lib/x402.ts',
    from: 'return `${BASE_MAINNET}:${from}:${nonce}`;',
    to: 'return `${BASE_MAINNET}:${String(auth?.from)}:${nonce}`;',
  },
  {
    name: 'settlementIdFor tolerates a missing nonce',
    file: 'lib/x402.ts',
    from: 'if (!from || !nonce) return null;',
    to: 'if (!from) return null;',
  },
  {
    name: 'the recovery HMAC stops covering issuedAt',
    file: 'lib/x402-recovery.ts',
    from: '.update(`${wallet.toLowerCase()}:${issuedAt}`)',
    to: '.update(`${wallet.toLowerCase()}`)',
  },
  {
    name: 'the challenge TTL check is dropped',
    file: 'lib/x402-recovery.ts',
    from: 'if (!Number.isFinite(age) || age < 0 || age > CHALLENGE_TTL_MS) {',
    to: 'if (false) {',
  },
  {
    name: 'the future-date refusal is dropped',
    file: 'lib/x402-recovery.ts',
    from: 'if (!Number.isFinite(age) || age < 0 || age > CHALLENGE_TTL_MS) {',
    to: 'if (!Number.isFinite(age) || age > CHALLENGE_TTL_MS) {',
  },
  {
    name: 'the challenge signature check is dropped',
    file: 'lib/x402-recovery.ts',
    from: "return valid ? { ok: true } : { ok: false, reason: 'bad_signature' };",
    to: 'return { ok: true };',
  },
  {
    name: 'the token comparison is dropped',
    file: 'lib/x402-recovery.ts',
    from: 'if (a.length !== b.length || !timingSafeEqual(a, b)) {',
    to: 'if (false) {',
  },
  {
    name: 'the Agent pack leaks into PACKS, reaching Stripe checkout',
    file: 'lib/packs.ts',
    from: 'export const PACKS: Record<PackId, Pack> = {',
    to: "export const PACKS: Record<string, Pack> = { agent: { id: 'agent' as PackId, name: 'Agent', priceCents: 100, matches: 12, fits: 'x', priceEnvVar: 'X' },",
  },
  {
    name: 'BACKUP_TABLES diverges from the pg_dump list',
    file: 'scripts/migrate-grant-readonly.ts',
    from: "  'credit_ledger',\n];",
    to: "  'credit_ledger',\n  'x402_recovery_redemptions',\n];",
  },
];

function invariantsPass(): boolean {
  try {
    execFileSync('npx', ['tsx', 'scripts/check-invariants.ts'], {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function main() {
  if (!invariantsPass()) {
    console.error(
      'check-invariants.ts fails on an unmodified tree. Fix that first; this script can say nothing until it passes.'
    );
    process.exit(1);
  }

  const missed: string[] = [];

  for (const m of MUTATIONS) {
    const original = readFileSync(m.file, 'utf8');
    const occurrences = original.split(m.from).length - 1;
    if (occurrences !== 1) {
      console.error(
        `  SETUP  ${m.name}\n         its anchor appears ${occurrences} times in ${m.file}; the mutation could not be applied.`
      );
      missed.push(`${m.name} (anchor drifted)`);
      continue;
    }
    try {
      writeFileSync(m.file, original.replace(m.from, m.to));
      const stillPasses = invariantsPass();
      if (stillPasses) missed.push(m.name);
      console.log(`  ${stillPasses ? 'MISSED ' : 'caught '} ${m.name}`);
    } finally {
      // Always, including on a thrown error or a killed run. A mutation left
      // behind is a defect introduced by the thing checking for defects.
      writeFileSync(m.file, original);
    }
  }

  if (!missed.length) {
    console.log(
      `\ninvariants guard ok — all ${MUTATIONS.length} reintroduced defects were caught`
    );
    process.exit(0);
  }
  console.error(
    `\n${missed.length} of ${MUTATIONS.length} defects went undetected by check-invariants.ts:`
  );
  for (const m of missed) console.error(`  ${m}`);
  console.error(
    '\nAn assertion that passes while the code it protects is deleted is not an assertion.'
  );
  process.exit(1);
}

main();
