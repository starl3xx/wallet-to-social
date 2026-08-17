/**
 * Every number we publish, checked against the database that produced it.
 *
 * Usage: npx tsx --env-file=.env.local scripts/check-published-figures.ts
 *
 * ## Why this exists rather than another note in CLAUDE.md
 *
 * "Keep the docs up to date" was already written down, and on 2026-08-17 the
 * docs still said we had resolved "all 440,700 distinct X handles" when we had
 * resolved 417,872. The sweep leaves failures unrecorded so they retry, so the
 * number that came back was never the number it set out to check, and the copy
 * was written from the intention.
 *
 * ## Why a PR check could not have caught it
 *
 * The index grows every day. A published figure that was exactly right when it
 * was written goes stale with no commit, no diff and no PR, which is precisely
 * the failure mode a pull-request gate cannot see. So this runs on a schedule,
 * not on a diff.
 *
 * ## Why the claims are a registry rather than a parser
 *
 * Guessing which numbers in prose are claims about our data is how you get a
 * checker that flags a version string and misses a coverage figure. Every claim
 * here is declared: where it lives, how to read the published value, and how to
 * compute the truth. Anything not declared is not checked, and that is honest in
 * a way a clever parser would not be.
 *
 * Adding a published figure means adding it here. That is the point.
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const sql = neon(process.env.DATABASE_URL!);

/** How far a published figure may drift before it is wrong. */
interface Claim {
  what: string;
  files: string[];
  /** Reads the published value. First capture group is the number. */
  pattern: RegExp;
  /** The truth, live. */
  actual: () => Promise<number>;
  /** Fractional tolerance. A rounded headline needs slack; a stated count does not. */
  tolerance: number;
  /** How the published value maps onto the actual one. */
  scale?: number;
}

const one = async (q: ReturnType<typeof sql>): Promise<number> => {
  const rows = (await q) as unknown as Array<Record<string, unknown>>;
  return Number(Object.values(rows[0] ?? {})[0] ?? 0);
};

const CLAIMS: Claim[] = [
  {
    what: 'index size, in millions',
    files: [
      'docs-site/index.mdx',
      'docs-site/concepts/scan-depth.mdx',
      'app/layout.tsx',
      'app/page.tsx',
    ],
    pattern: /([0-9]+(?:\.[0-9])?)\s*(?:million|M)[- ]wallet|([0-9]+(?:\.[0-9])?) million wallets|'([0-9]+(?:\.[0-9])?)M'/,
    actual: () => one(sql`SELECT count(*)::int FROM social_graph`),
    scale: 1_000_000,
    // A headline rounded to the nearest million is allowed to lag by half of one.
    tolerance: 0.1,
  },
  {
    what: 'wallets with an X handle, in millions',
    files: ['docs-site/concepts/coverage.mdx'],
    pattern: /([0-9]+\.[0-9]+) million wallets with a linked X handle/,
    actual: () =>
      one(sql`SELECT count(*)::int FROM social_graph WHERE twitter_handle IS NOT NULL`),
    scale: 1_000_000,
    tolerance: 0.02,
  },
  {
    what: 'distinct X handles resolved',
    files: ['docs-site/concepts/data-quality.mdx', 'docs-site/concepts/coverage.mdx'],
    pattern: /([0-9]{1,3}(?:,[0-9]{3})+) of the distinct X handles|([0-9]{1,3}(?:,[0-9]{3})+) resolved by/,
    actual: () => one(sql`SELECT count(*)::int FROM x_accounts`),
    /**
     * Tight, because this is published as an exact figure.
     *
     * It was 0.05, chosen from "it grows daily so give it room", and a
     * deliberately wrong 399,999 against a true 417,872 sailed through at 4.3%.
     * A number written out to the digit is a precise claim and deserves no
     * slack: when the sweep's retries land and this moves, the right outcome is
     * the check telling somebody to update the sentence, which is the entire
     * job. Room to drift is only appropriate for a figure that is rounded in
     * the copy, like the headline above.
     */
    tolerance: 0.02,
  },
  {
    what: 'share of resolved handles that are live',
    files: ['docs-site/concepts/data-quality.mdx', 'docs-site/concepts/coverage.mdx'],
    pattern: /\*?\*?([0-9]{2}\.[0-9])%\*?\*? (?:were )?live|\| Live \| ([0-9]{2}\.[0-9])% \|/,
    actual: async () => {
      const live = await one(
        sql`SELECT count(*)::int FROM x_accounts WHERE status = 'live'`
      );
      const total = await one(sql`SELECT count(*)::int FROM x_accounts`);
      return total === 0 ? 0 : (live / total) * 100;
    },
    tolerance: 0.05,
  },
  {
    what: 'share of X matches that are owner-attested',
    files: ['docs-site/concepts/coverage.mdx', 'app/layout.tsx'],
    pattern: /over ([0-9]{2}\.[0-9])% of/i,
    actual: async () => {
      const attested = await one(sql`
        SELECT count(*)::int FROM social_graph
        WHERE twitter_handle IS NOT NULL
          AND sources && ARRAY['farcaster_sweep','neynar','ens_onchain','ens','ethos','eas','clanker','manual']`);
      const total = await one(
        sql`SELECT count(*)::int FROM social_graph WHERE twitter_handle IS NOT NULL`
      );
      return total === 0 ? 0 : (attested / total) * 100;
    },
    // A floor claim: being ABOVE it is fine, below it is not. Checked in code.
    tolerance: 1,
  },
];

const num = (s: string) => Number(s.replace(/,/g, ''));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  let problems = 0;
  let checked = 0;

  for (const claim of CLAIMS) {
    const truth = await claim.actual();

    for (const file of claim.files) {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        console.error(`MISSING  ${file} (declared by "${claim.what}")`);
        problems++;
        continue;
      }

      const m = text.match(claim.pattern);
      if (!m) {
        /**
         * A no-match is an ERROR, not a note.
         *
         * It means one of two things and both need a person: the copy was
         * rewritten and this registry is now stale, or the figure was removed
         * and its entry should have gone with it. A guard that shrugs at a claim
         * it can no longer find checks fewer things every time somebody edits
         * prose, and reports success the whole way down.
         */
        console.error(
          `  NO MATCH ${file}: cannot find "${claim.what}". Either the copy ` +
            `changed and this registry needs updating, or the figure is gone ` +
            `and its entry should be too.`
        );
        problems++;
        continue;
      }

      checked++;
      const publishedRaw = m.slice(1).find((g) => g !== undefined)!;
      const published = num(publishedRaw) * (claim.scale ?? 1);
      const drift = Math.abs(published - truth) / (truth || 1);

      // "over N%" is a floor. Publishing 99.9 while the truth is 99.98 is
      // correct; publishing it while the truth is 94 is not.
      const isFloor = /over /i.test(m[0]);
      const ok = isFloor ? published <= truth : drift <= claim.tolerance;

      const fmt = (v: number) =>
        claim.scale ? (v / claim.scale).toFixed(2) : v.toLocaleString(undefined, { maximumFractionDigits: 1 });

      if (ok) {
        console.log(`  ok     ${file}: ${claim.what} = ${publishedRaw} (actual ${fmt(truth)})`);
      } else {
        console.error(
          `  DRIFT  ${file}: ${claim.what} published as ${publishedRaw}, actual ${fmt(truth)}` +
            (isFloor ? ' (a floor claim, and the floor is now above the truth)' : ` (${(drift * 100).toFixed(1)}% off)`)
        );
        problems++;
      }
    }
  }

  console.log(`\n${checked} published figures checked.`);
  if (problems) {
    console.error(
      `${problems} need updating. Published numbers go stale with no commit, so ` +
        `this is expected drift rather than a broken build: correct the copy and ` +
        `the figure, in the same change.`
    );
    process.exit(1);
  }
  console.log('Everything we publish still matches the database.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
