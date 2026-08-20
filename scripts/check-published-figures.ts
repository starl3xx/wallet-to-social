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
  /** Fractional tolerance, used only when `kind` is 'rounded'. */
  tolerance: number;
  /**
   * 'rounded' for a headline that is deliberately imprecise, 'ceiling' for a
   * count that only grows and must never be overstated.
   */
  kind?: 'rounded' | 'ceiling';
  /**
   * How far a ceiling claim may fall BEHIND the truth before it is stale.
   *
   * A ceiling passes whenever published <= truth, because understating a count
   * that only grows is safe. Safe is not the same as true. On 2026-08-20 the
   * resolved-handle figure had been 417,872 across five surfaces for three days
   * while the database held 428,059, and every weekly run would have reported
   * green forever: the claim can only fail by growing, and it never grows.
   *
   * So a ceiling gets a second bound in the other direction. Falling behind is
   * not an error the way overstating is, but it is copy nobody has looked at,
   * and this check exists to make somebody look.
   */
  staleBelow?: number;
  /**
   * Contexts where a number that looks like this claim is a different fact.
   *
   * A dated record of one past run is not a claim about the current total. The
   * first sweep resolved 417,998 handles in a four-hour window on 2026-08-17,
   * and `lib/x-accounts.ts` says so twice while explaining why the staleness
   * threshold is per handle. That sentence is correct and must stay correct: it
   * is the evidence for a design decision, and rewriting history so a regex is
   * happy would be the worse trade.
   *
   * Tested against a window around the match, so an occurrence is skipped when
   * it is anchored to a specific run rather than asserting a running total.
   * An exemption has to be honest about what it exempts, which is why these are
   * narrow phrases rather than a file-level opt-out.
   */
  ignoreNear?: RegExp[];
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
      'README.md',
      // app/layout.tsx is deliberately absent: it interpolates the constant, so
      // the literal exists in exactly one file. That is the point of the
      // constant, and this check noticed the moment it became true.
      'lib/public-figures.ts',
    ],
    /**
     * Anchored on the index context. The first version matched any
     * "N million wallets" and happily read "1.1 million wallets have a linked
     * Twitter handle" as the index size, reporting 77% drift against a figure
     * that was never that claim.
     */
    pattern: /([0-9]+(?:\.[0-9])?)\s*(?:million|M)[- ]wallet index|([0-9]+(?:\.[0-9])?) million wallets that we resolved|([0-9]+(?:\.[0-9])?) million wallet identities|INDEXED_WALLETS = '([0-9]+(?:\.[0-9])?)M'|INDEXED_WALLETS_LONG = '([0-9]+(?:\.[0-9])?) million'|Resolve against a ([0-9]+(?:\.[0-9])?)M-wallet/,
    /**
     * The SAME predicate /api/public-stats uses, and not `count(*)`.
     *
     * Counting every row includes 235,858 persisted negatives: wallets we
     * checked and found nothing for. A negative is a real record and it is not
     * a wallet resolved to anybody, so it does not belong in a coverage figure.
     * Using the wrong one here is exactly how "5 million" reached the docs while
     * the homepage correctly said 4.8M.
     */
    actual: () =>
      one(sql`SELECT count(*)::int FROM social_graph
              WHERE twitter_handle IS NOT NULL OR farcaster IS NOT NULL
                 OR ens_name IS NOT NULL OR lens IS NOT NULL OR github IS NOT NULL`),
    scale: 1_000_000,
    /**
     * Tight enough that "5" cannot stand in for 4.81, and now tight enough that
     * "4.7" cannot either.
     *
     * It was 0.1, and at that width the docs kept saying "5 million" against a
     * true 4.81 and passed at 3.9% off. A figure published to one decimal is
     * precise enough to be read as different, so the check has to treat it that
     * way.
     *
     * Then 0.03, which Bugbot showed was still too loose once the Farcaster
     * claim existed: 4.7 against a true 4.813 is 2.35% off and passed, so the
     * index size could be "corrected" into the Farcaster figure and the check
     * would agree. The rule a tolerance has to satisfy is not "is this close
     * enough to be honest" but "is this tighter than the distance to the
     * nearest value it could be confused with". That distance is 2.1 to 2.4%
     * here, so 1% is the widest defensible band.
     */
    tolerance: 0.01,
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
    what: 'wallets with an X handle, stated in app copy',
    // Same reason as above: layout.tsx interpolates it now.
    files: ['lib/public-figures.ts'],
    pattern: /([0-9]+\.[0-9]+) million wallets have a linked Twitter handle|WALLETS_WITH_X = '([0-9]+\.[0-9]+) million'/,
    actual: () =>
      one(sql`SELECT count(*)::int FROM social_graph WHERE twitter_handle IS NOT NULL`),
    scale: 1_000_000,
    tolerance: 0.03,
  },
  {
    what: 'distinct X handles resolved',
    files: [
      'docs-site/concepts/data-quality.mdx',
      'docs-site/concepts/coverage.mdx',
      /**
       * `components/ReachabilityClaim.tsx` is deliberately absent, for the same
       * reason `app/layout.tsx` is absent from the index-size claim above: it
       * interpolates `X_HANDLES_RESOLVED` now, so the literal exists in exactly
       * one file. That is the point of the constant.
       */
      'lib/public-figures.ts',
      'README.md',
      'docs/AI-SEARCH.md',
      /**
       * A doc comment, declared deliberately, against this file's own rule that
       * a comment is not published copy.
       *
       * That rule earns its place in the undeclared SWEEP, where scanning prose
       * about a figure would flag every explanation. It is the wrong rule for a
       * DECLARED claim. This header stated "we resolved all 440,700 distinct
       * handles" for a day after the docs had been corrected to 417,872, and
       * nothing caught it, because the only files anybody thought to declare
       * were the ones a customer reads. A number asserted as fact in the module
       * that defines the feature is a claim; whoever reads it next will repeat
       * it.
       */
      'lib/handle-reachability.ts',
      /**
       * Added after Bugbot pointed out that this module asserted its own
       * 417,872 in the present tense, outside both claims, three commits after
       * the same literal was corrected everywhere a customer reads it. A
       * consolidation that leaves one copy behind has not consolidated
       * anything; it has just moved where the next wrong number will come from.
       */
      'lib/x-accounts.ts',
    ],
    /**
     * Matched by neighbourhood, not by sentence.
     *
     * Five surfaces write this five ways: "417,872 of the distinct X handles",
     * "417,872 resolved by", "Of 417,872 checked", "Of 417,872 X handles
     * resolved", "417,872 resolved,". Enumerating phrasings meant README was
     * silently unchecked, and an overstated 999,999 passed. A number followed
     * within a short window by "resolved" or "checked" is the claim, whatever
     * the sentence around it.
     */
    pattern:
      /X_HANDLES_RESOLVED = '([0-9]{1,3}(?:,[0-9]{3})+)'|(?<=(?:resolved|checked)\s{0,3})([0-9]{1,3}(?:,[0-9]{3})+)|([0-9]{1,3}(?:,[0-9]{3})+)(?=[\s\S]{0,25}?(?:resolved|checked))/,
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
     *
     * A CEILING, not a tolerance. This count only grows, so publishing fewer
     * than we hold understates and is safe, while publishing more is false. The
     * 0.02 band this had allowed 8,357 handles of error in a figure written out
     * to the digit, which is exactly the slack the comment above says it does
     * not get.
     */
    tolerance: 0,
    kind: 'ceiling',
    ignoreNear: [
      // "The first full sweep resolved 417,998 handles inside a four-hour
      // window on 2026-08-17" and "Measured over all 417,998 rows". Both are
      // that one run, quoted as evidence for the per-handle threshold.
      /first full sweep/i,
      /Measured over all/i,
    ],
    /**
     * Two per cent of 428,059 is roughly 8,600 handles, which the daily cron
     * takes a while to add. Tight enough that a figure cannot sit three days
     * stale as this one did, loose enough that the weekly run is not a standing
     * chore.
     */
    staleBelow: 0.02,
  },
  {
    /**
     * The denominator, declared because it was already three numbers.
     *
     * 446,070 in one module header, 446,043 in the docs and in a second module
     * header, 446,329 in the database. Nothing checked it, because only the
     * numerator was ever declared, and a coverage percentage is only as honest
     * as the number underneath it.
     *
     * `[\s*]+` rather than a space between every word of the anchor phrase:
     * two of the three surfaces are doc comments, so the phrase can wrap across
     * a line and pick up a leading `*`. A plain space stops matching the moment
     * somebody reflows a paragraph, and a claim that quietly stops being
     * checked is the failure this whole file exists to prevent. It happened
     * here, in this commit, to this pattern.
     */
    what: 'distinct X handles held',
    files: [
      'docs-site/concepts/coverage.mdx',
      'lib/public-figures.ts',
      'lib/handle-reachability.ts',
      // Same omission as the numerator above, and the same fix.
      'lib/x-accounts.ts',
    ],
    pattern:
      /X_HANDLES_HELD = '([0-9]{1,3}(?:,[0-9]{3})+)'|([0-9]{1,3}(?:,[0-9]{3})+)(?=[\s\S]{0,30}?distinct[\s*]+handles[\s*]+(?:the[\s*]+index[\s*]+holds|we[\s*]+hold))/,
    actual: () =>
      one(sql`SELECT count(DISTINCT lower(twitter_handle))::int FROM social_graph
              WHERE twitter_handle IS NOT NULL`),
    tolerance: 0,
    kind: 'ceiling',
    staleBelow: 0.02,
  },
  {
    /**
     * One digit from the index size and a different fact entirely.
     *
     * 4.7M is the Farcaster half, 4.8M is every wallet with any identity. Only
     * the second was declared, so the blog post and `lib/eas-attestations.ts`
     * carried an undeclared 4.7M that read exactly like a stale 4.8M. It is
     * neither. It is correct, and it was one careless edit away from being
     * "corrected" into the wrong number.
     */
    what: 'Farcaster wallets, in millions',
    files: [
      'content/published/twenty-two-percent-match-rate.md',
      'lib/eas-attestations.ts',
      'lib/public-figures.ts',
    ],
    pattern:
      /FARCASTER_WALLETS = '([0-9]+\.[0-9]) million'|([0-9]+\.[0-9])M wallets, refreshed daily|([0-9]+\.[0-9]) million Farcaster wallets/,
    actual: () =>
      one(sql`SELECT count(*)::int FROM social_graph WHERE farcaster IS NOT NULL`),
    scale: 1_000_000,
    /**
     * 1%, not 3%, and the reason is the entire point of this entry.
     *
     * Bugbot caught the first version: this claim exists to stop 4.7 being
     * "corrected" into the 4.8 any-identity figure, and at 0.03 that exact
     * mix-up passed, because 4.8 against a true 4.6996 is only 2.14% off. A
     * guard whose tolerance is wider than the gap it guards does nothing.
     *
     * The two figures are 2.1 to 2.4% apart depending on direction, so the
     * band has to sit under that. At 1%: 4.7 passes at 0.01% off, 4.8 fails at
     * 2.14%, which is the behaviour asked for.
     */
    tolerance: 0.01,
  },
  {
    what: 'share of resolved handles that are live',
    files: [
      'docs-site/concepts/data-quality.mdx',
      'docs-site/concepts/coverage.mdx',
      'components/ReachabilityClaim.tsx',
    ],
    pattern: /\*?\*?([0-9]{2}\.[0-9])%\*?\*? (?:were |are )?live|\| Live \| ([0-9]{2}\.[0-9])% \||([0-9]{2}\.[0-9])% live/,
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
    /**
     * Declared rather than exempted.
     *
     * These two sat in NOT_A_COVERAGE_CLAIM with the note "covered by the
     * reachability split", and they were not: only the live share was declared,
     * so the suspended and unclaimed figures could drift anywhere in the copy
     * while the sweep stayed green. An exemption that claims something is
     * checked elsewhere has to be true.
     */
    what: 'share of resolved handles that are suspended',
    files: [
      'docs-site/concepts/data-quality.mdx',
      'docs-site/concepts/coverage.mdx',
      'components/ReachabilityClaim.tsx',
      'README.md',
      'docs/AI-SEARCH.md',
    ],
    pattern: /([0-9]{2}\.[0-9])%\s+suspended|\| Suspended \| ([0-9]{2}\.[0-9])% \|/,
    actual: async () => {
      const n = await one(
        sql`SELECT count(*)::int FROM x_accounts WHERE status = 'unavailable'`
      );
      const total = await one(sql`SELECT count(*)::int FROM x_accounts`);
      return total === 0 ? 0 : (n / total) * 100;
    },
    tolerance: 0.05,
  },
  {
    what: 'share of resolved handles whose name nobody holds',
    files: [
      'docs-site/concepts/data-quality.mdx',
      'docs-site/concepts/coverage.mdx',
      'components/ReachabilityClaim.tsx',
      'README.md',
      'docs/AI-SEARCH.md',
    ],
    // "9.7% unclaimed", "9.7% names nobody holds" and "9.7% are names nobody
    // holds" are the three phrasings in use. Matching the figure and a nearby
    // keyword is more durable than trying to enumerate the prose.
    pattern: /([0-9]\.[0-9])% (?:are )?(?:unclaimed|no longer|names nobody)|\| Name no longer in use \| ([0-9]\.[0-9])% \|/,
    actual: async () => {
      const n = await one(
        sql`SELECT count(*)::int FROM x_accounts WHERE status = 'not_found'`
      );
      const total = await one(sql`SELECT count(*)::int FROM x_accounts`);
      return total === 0 ? 0 : (n / total) * 100;
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

/**
 * Figures no query can settle.
 *
 * The match rates are not properties of the database. 23.7% any-identity, and
 * the ~13% reachable figure beside it, came from a random sample of 600 holders
 * drawn from 26,619 across 18 collections on two chains. There is no SELECT that
 * returns them, and inventing one would be worse than leaving them undeclared:
 * the closest query, the share of index rows carrying a handle, measures index
 * composition rather than what a customer's list will match, and a green tick
 * against the wrong predicate is a lie with a checkmark on it.
 *
 * So they are checked the only two honest ways. The published figure must still
 * equal what the measurement produced, which catches an edit that changed the
 * number without redoing the work. And the measurement must not be too old,
 * which catches the real failure: a sample taken once, quoted for a year, while
 * the index it sampled tripled.
 */
interface Measurement {
  what: string;
  /** Where the measurement is recorded, with the date it was taken. */
  recordedIn: string;
  /** Reads the measurement date. First capture group is an ISO date. */
  datePattern: RegExp;
  /**
   * The rates the measurement produced, READ OUT OF THE RECORD.
   *
   * The first version of this hardcoded the expected value here in the checker,
   * which Bugbot caught: a hardcoded expectation checks that the copy still
   * matches the checker, not that it matches the measurement. Change the
   * measured rate in the record and the check stays green, which is precisely
   * the failure this guard was added to catch. Both halves now come from the
   * record, so there is one authority and the checker is not it.
   */
  rates: Record<string, RegExp>;
  /** Re-measure after this many days. */
  maxAgeDays: number;
  /** How to repeat it. Printed on failure, because the fix is to run this. */
  by: string;
  /** Surfaces publishing a figure derived from it, and which rate each states. */
  published: { file: string; pattern: RegExp; rate: string }[];
}

const MEASUREMENTS: Measurement[] = [
  {
    what: 'pipeline match rate, by sample',
    recordedIn: 'docs/SEO-STRATEGY.md',
    datePattern: /\*\*Match rate, verified ([0-9]{4}-[0-9]{2}-[0-9]{2}):\*\*/,
    /**
     * Four months. The sample is expensive enough that monthly is a chore
     * nobody will do, and the index grows fast enough that a year-old sample
     * describes a different product.
     */
    maxAgeDays: 120,
    by: 'npx tsx --env-file=.env.local scripts/benchmark-pipeline-sample.ts',
    /**
     * Two rates, kept apart on purpose. CLAUDE.md requires it: "has an
     * identity" counts ENS and Lens and is a resolution rate; "reachable on X
     * or Farcaster" is what a campaign can actually message. Roughly a factor
     * of two between them, so publishing the first where the second belongs
     * overstates an audience by half.
     */
    rates: {
      anyIdentity: /verified [0-9-]{10}:\*\* ([0-9]{2}\.[0-9])% any-identity/,
      reachable: /"reachable on X or Farcaster" \(~([0-9]{2})%\)/,
    },
    published: [
      {
        file: 'app/opengraph-image.tsx',
        // The share card is the first thing anyone sees, and this figure was
        // the only number on it that nothing checked.
        pattern: /<span[^>]*>([0-9]{2})%<\/span>\s*<span[^>]*>\s*have an X or Farcaster account/,
        rate: 'reachable',
      },
      {
        /**
         * The blog table stating the sample's headline figure, which the first
         * version of this entry left out. It is the one surface that publishes
         * the any-identity rate to a decimal, so it is the one most obviously
         * wrong if the sample is re-run and the post is not.
         */
        file: 'content/published/twenty-two-percent-match-rate.md',
        pattern: /\*\*Any identity\*\*[^|]*\| \*\*([0-9]{2}\.[0-9])%\*\*/,
        rate: 'anyIdentity',
      },
    ],
  },
];

/**
 * NOT declared, and said out loud rather than quietly.
 *
 * "22%" appears in roughly ten blog posts as the conservative end of the
 * interval above. It is not registered here, because the same two digits also
 * carry unrelated facts in the same folder: a case study's governance
 * participation went from 5.2% to 22.4%, and a pattern loose enough to catch
 * the match rate catches that too, then reports it as drift. Declaring them
 * properly means one entry per post with a phrase-anchored pattern, which is a
 * job rather than a line, and pretending otherwise would be the kind of
 * exemption this file already refuses elsewhere.
 */
const KNOWN_UNDECLARED = [
  'the 22% match rate repeated across content/published/*.md',
];

const num = (s: string) => Number(s.replace(/,/g, ''));

function checkMeasurements(): number {
  let problems = 0;

  for (const m of MEASUREMENTS) {
    let record: string;
    try {
      record = readFileSync(m.recordedIn, 'utf8');
    } catch {
      console.error(`MISSING  ${m.recordedIn} (records "${m.what}")`);
      return problems + 1;
    }

    const dated = record.match(m.datePattern);
    if (!dated) {
      console.error(
        `  NO DATE  ${m.recordedIn}: cannot find when "${m.what}" was measured.`
      );
      problems++;
      continue;
    }

    const ageDays = Math.floor(
      (Date.now() - Date.parse(dated[1])) / 86_400_000
    );
    if (ageDays > m.maxAgeDays) {
      console.error(
        `  OLD    ${m.what}: measured ${dated[1]}, ${ageDays} days ago ` +
          `(limit ${m.maxAgeDays}). Re-run: ${m.by}`
      );
      problems++;
    } else {
      console.log(
        `  ok     ${m.recordedIn}: ${m.what} measured ${dated[1]}, ${ageDays}d old`
      );
    }

    // The measured values, read out of the record rather than from this file.
    const measured: Record<string, string> = {};
    for (const [name, pattern] of Object.entries(m.rates)) {
      const hit = record.match(pattern);
      if (!hit) {
        console.error(
          `  NO RATE  ${m.recordedIn}: cannot read the "${name}" rate. The ` +
            `record was reworded, or the rate is gone.`
        );
        problems++;
        continue;
      }
      measured[name] = hit[1];
      console.log(`  ok     ${m.recordedIn}: ${name} measured at ${hit[1]}%`);
    }

    for (const p of m.published) {
      const expected = measured[p.rate];
      // Already reported as NO RATE. Saying it twice per surface adds noise.
      if (expected === undefined) continue;

      let text: string;
      try {
        text = readFileSync(p.file, 'utf8');
      } catch {
        console.error(`MISSING  ${p.file} (publishes "${m.what}")`);
        problems++;
        continue;
      }
      const hit = text.match(p.pattern);
      if (!hit) {
        console.error(
          `  NO MATCH ${p.file}: cannot find the published "${p.rate}" figure.`
        );
        problems++;
      } else if (hit[1] !== expected) {
        console.error(
          `  DRIFT  ${p.file}: "${p.rate}" published as ${hit[1]}, measured ` +
            `${expected} in ${m.recordedIn}. One of the two was edited alone.`
        );
        problems++;
      } else {
        console.log(`  ok     ${p.file}: ${p.rate} = ${hit[1]} (as measured)`);
      }
    }
  }

  return problems;
}

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

      // matchAll, not match. `String.match` without /g returns only the FIRST
      // hit, so a file repeating a figure (metadata, Open Graph, Twitter card,
      // JSON-LD and FAQ copy all carry the index size) had every later instance
      // unchecked. The check could pass while published text still lied.
      const global = new RegExp(claim.pattern.source, claim.pattern.flags.replace('g', '') + 'g');

      /**
       * Exemptions are applied BEFORE the no-match test, not inside the loop
       * after it.
       *
       * Bugbot caught the other order: the test asked whether the regex found
       * anything, then the loop skipped the exempted ones. A file whose every
       * hit is exempt therefore satisfied the test and compared nothing, so it
       * passed green with zero verification. `lib/x-accounts.ts` sits exactly
       * there: reword its one live sentence and only the two dated historical
       * figures still match, both exempt, and the file goes quiet instead of
       * failing. That is the precise outcome the no-match error exists to
       * prevent, reintroduced by the fix for a different problem.
       *
       * Filtering first means the question the test asks is the right one: not
       * "did the regex hit anything" but "is there a live claim here to check".
       */
      const all = [...text.matchAll(global)].filter((hit) => {
        if (!claim.ignoreNear?.length) return true;
        // A 120-character window each side: wide enough to see the sentence the
        // figure sits in, narrow enough not to reach the next one.
        const at = hit.index ?? 0;
        const around = text.slice(Math.max(0, at - 120), at + 120);
        return !claim.ignoreNear.some((re) => re.test(around));
      });

      if (all.length === 0) {
        /**
         * A no-match is an ERROR, not a note.
         *
         * It means one of three things and all need a person: the copy was
         * rewritten and this registry is now stale, the figure was removed and
         * its entry should have gone with it, or every occurrence left is
         * exempt and the file no longer states the claim at all. A guard that
         * shrugs at a claim it can no longer find checks fewer things every
         * time somebody edits prose, and reports success the whole way down.
         */
        console.error(
          `  NO MATCH ${file}: no live "${claim.what}" to check. The copy ` +
            `changed and this registry needs updating, the figure is gone and ` +
            `its entry should be too, or every occurrence is exempt.`
        );
        problems++;
        continue;
      }

      const fmt = (v: number) =>
        claim.scale ? (v / claim.scale).toFixed(2) : v.toLocaleString(undefined, { maximumFractionDigits: 1 });

      // Already filtered above, so every hit here is a live claim.
      for (const hit of all) {
        checked++;
        const publishedRaw = hit.slice(1).find((g) => g !== undefined)!;
        const published = num(publishedRaw) * (claim.scale ?? 1);
        const drift = Math.abs(published - truth) / (truth || 1);

        /**
         * Three kinds of claim, because one tolerance cannot serve them.
         *
         * `floor` is "over N%": above the truth is wrong, below is fine.
         * `ceiling` is a count that only ever grows, like handles resolved.
         * Publishing fewer than we have understates and is safe; publishing
         * more is false. A symmetric tolerance on those was documented as
         * "exact figures get no slack" and still allowed 2% either way, which
         * on 417,872 is 8,357 handles.
         * `rounded` is a headline like "4.8M", where slack is the point.
         */
        const isFloor = /over /i.test(hit[0]);
        const kind = isFloor ? 'floor' : (claim.kind ?? 'rounded');
        const overstated = published > truth;
        // A ceiling that has fallen further behind than its own bound allows.
        // Not false, just unlooked-at, and reported as its own kind of problem
        // so the fix is obvious from the line.
        const stale =
          kind === 'ceiling' &&
          claim.staleBelow !== undefined &&
          !overstated &&
          drift > claim.staleBelow;
        const ok =
          kind === 'floor'
            ? published <= truth
            : kind === 'ceiling'
              ? !overstated && !stale
              : drift <= claim.tolerance;

        if (ok) {
          console.log(`  ok     ${file}: ${claim.what} = ${publishedRaw} (actual ${fmt(truth)})`);
        } else if (stale) {
          console.error(
            `  STALE  ${file}: ${claim.what} published as ${publishedRaw}, actual ` +
              `${fmt(truth)} (${(drift * 100).toFixed(1)}% behind, limit ` +
              `${(claim.staleBelow! * 100).toFixed(0)}%). Not wrong, just old.`
          );
          problems++;
        } else {
          console.error(
            `  DRIFT  ${file}: ${claim.what} published as ${publishedRaw}, actual ${fmt(truth)}` +
              (kind === 'rounded'
                ? ` (${(drift * 100).toFixed(1)}% off)`
                : ' (published claims more than the database holds)')
          );
          problems++;
        }
      }
    }
  }

  problems += checkMeasurements();

  const undeclared = sweepForUndeclared();
  problems += undeclared;

  for (const known of KNOWN_UNDECLARED) {
    console.log(`  note   not declared, deliberately: ${known}`);
  }

  console.log(`\n${checked} published figures checked.`);
  if (undeclared) console.error(`${undeclared} figure(s) published but never declared.`);
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

/* ------------------------------------------------------------------ */
/* The inverse check: a figure nobody declared                         */
/* ------------------------------------------------------------------ */

/**
 * Checking declared claims is only half the job.
 *
 * A registry catches a declared figure that drifts. It cannot catch a NEW
 * figure somebody writes into a page tomorrow, and that is how "22%" reached 19
 * blog posts and their meta descriptions while every declared number passed.
 *
 * So this sweeps the copy surfaces for anything shaped like one of our claims
 * and errors on anything not accounted for. Adding a number to a page means
 * adding it here, which is the friction that keeps every surface saying the
 * same thing.
 */
const COPY_SURFACES = [
  'README.md',
  'docs/AI-SEARCH.md',
  'lib/public-figures.ts',
  'components/ReachabilityClaim.tsx',
  'app/layout.tsx',
];

/** Shapes that read as one of our coverage claims. */
const FIGURE_SHAPES = [
  /\b[0-9]{1,2}(?:\.[0-9])?%\s*(?:match|reachab|of wallets|of the|live|suspended|unclaimed)/gi,
  /\b[0-9](?:\.[0-9])?\s*(?:M|million)[- ]wallet/gi,
  /\b[0-9](?:\.[0-9]+)? million wallets/gi,
  // A stated count. Without this the sweep could not see "417,872" at all, so a
  // figure written into a page with no declaration was invisible in BOTH
  // directions: undeclared, and unmatched by any claim.
  /(?<=(?:resolved|checked)\s{0,3})[0-9]{1,3}(?:,[0-9]{3})+|\b[0-9]{1,3}(?:,[0-9]{3})+(?=[\s\S]{0,40}?(?:resolved|checked|handles))/g,
];

/**
 * Figures that are real but are not claims about our coverage.
 *
 * Each needs to be here for a reason a reader would accept, not because it was
 * noisy. A growing list is a signal the shapes above are too broad.
 */
const NOT_A_COVERAGE_CLAIM = [
  // The industry baseline we compare against. Not our figure, and not ours to
  // verify against our own database.
  /2\.5%\s*(?:industry|average)/i,
];

function sweepForUndeclared(): number {
  const declared = CLAIMS.flatMap((c) => c.files);
  let found = 0;

  for (const file of COPY_SURFACES) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    /**
     * A comment is not published copy.
     *
     * `lib/public-figures.ts` explains in its header why the figure is 4.8M and
     * what went wrong before, which is prose about a claim rather than a claim.
     * Scanning it flagged the explanation as an undeclared figure, which would
     * have taught everyone to stop writing explanations.
     */
    if (/\.tsx?$/.test(file)) {
      text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
    }

    /**
     * Where the declared claims actually sit in this file.
     *
     * The first version asked "does any claim declare this file", which meant
     * one declared figure made every other figure in that file pass. Injecting
     * "77% match rate" and "9.9M-wallet index" into the README proved it: both
     * sailed through because the README has a declared claim elsewhere in it.
     * Coverage has to be per match, not per file.
     */
    const claimedRanges: Array<[number, number]> = [];
    for (const c of CLAIMS) {
      if (!c.files.includes(file)) continue;
      /**
       * matchAll, matching the forward check.
       *
       * This used String.match and recorded only the first hit per claim, so a
       * file declaring the same figure twice had the second fall outside every
       * window and get reported as undeclared. `lib/public-figures.ts` states
       * the index size as both a short and a long form, and the forward check
       * validates both. A sweep that then calls one of them undeclared teaches
       * people to silence it with an exemption, which is how a guard stops
       * guarding.
       */
      const g = new RegExp(c.pattern.source, c.pattern.flags.replace('g', '') + 'g');
      for (const dm of text.matchAll(g)) {
        if (dm.index !== undefined) claimedRanges.push([dm.index, dm.index + dm[0].length]);
      }
    }

    for (const shape of FIGURE_SHAPES) {
      for (const m of text.matchAll(shape)) {
        const hit = m[0];
        const at = m.index ?? -1;
        if (NOT_A_COVERAGE_CLAIM.some((ok) => ok.test(hit))) continue;
        const covered = claimedRanges.some(([lo, hi]) => at >= lo - 60 && at <= hi + 60);
        if (covered) continue;
        console.error(
          `  UNDECLARED ${file}: "${hit.trim()}" is not in the registry. ` +
            `Add it to CLAIMS with the query that proves it, or to ` +
            `NOT_A_COVERAGE_CLAIM with a reason.`
        );
        found++;
      }
    }
  }
  void declared;
  return found;
}
