/**
 * The claims this codebase makes about what an attacker cannot do.
 *
 * ## Why this exists
 *
 * On 2026-08-24 and 25, four separate defects shipped as far as review with the
 * same shape: a comment asserting a security property, and nothing anywhere
 * that could contradict it.
 *
 *   "possession of the payload is proof"      the fields are public onchain
 *   "an attacker also needs the reply"        they replay from their own socket
 *   "a header proves this is metered"         `Bearer hunter2` is not a key
 *   "this table is in the nightly dump"       it was in neither dump list
 *
 * Each was checkable in seconds. None was checked twice. The repo enforces
 * button radius, palette, contrast and control height on every pull request,
 * and enforced nothing about the money path.
 *
 * Every assertion below is therefore written as **the attacker**, doing the
 * thing a comment claims is impossible. A test of the happy path would have
 * passed on every one of those four days.
 *
 * ## Rules for adding to this file
 *
 * - Assert the refusal, not the success. `expect(refused)` catches a
 *   regression; `expect(worked)` catches a typo.
 * - Where a guard could pass by matching nothing, prove it can fail: the
 *   Drizzle case asserts that the NAIVE check misses what the real one finds.
 * - No database and no network. This runs on every pull request, from a fork,
 *   with no secrets.
 *
 * Run: npx tsx scripts/check-invariants.ts
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { execFileSync } from 'child_process';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { privateKeyToAccount } from 'viem/accounts';
import { namehash as ethersNamehash } from 'ethers';
import { ERC20_SUPPORTED_CHAINS, SUPPORTED_CHAINS } from '../lib/chains';
import {
  API_TIMEOUT_MS,
  batchDeadlineMs,
  MIN_BATCH_DEADLINE_MS,
} from '../lib/web3bio';
import { parseBatchByIds } from '../lib/x-accounts';
import {
  freshCastTime,
  FUTURE_SKEW_MS,
  isExcluded,
  parseExclusions,
} from './concierge-filters';
import {
  ADDRESS_SHAPE,
  lockedReverseBody,
  lockedReverseMessage,
  MISS_EXPLANATION,
} from '../lib/reverse-access';
import {
  DIRECT,
  firstTouchFrom,
  ACQUISITION_MAX_LENGTH,
  referrerHost,
  safeAcquisition,
  safeTag,
  summariseOrigin,
} from '../lib/first-touch';

/**
 * Set before anything that reads it is called.
 *
 * `secret()` in lib/x402-recovery.ts reads `process.env` per call rather than
 * at module load, so this is enough. That distinction is not academic: an
 * earlier probe in this repo set an env var below its imports, the module had
 * already captured the old value at load time, and the "read-only" probe sent
 * six live emails.
 */
process.env.X402_RECOVERY_SECRET = 'invariant-check-secret';

/**
 * And the claim flow's own secret, which must be DIFFERENT from the one above.
 *
 * Not tidiness: the assertions below check that a signature taken for one
 * flow is refused by the other, and giving both flows the same secret here
 * would leave the message-text binding as the only thing making that true.
 * The HMAC prefix would then be untested while appearing tested.
 *
 * `lib/attestation.ts` reads `process.env` per call, like its neighbour, so
 * setting it here is enough. Without it `issueClaimChallenge` returns null and
 * every assertion behind it SKIPS silently, which is how a check comes to
 * report clean over code it never ran.
 */
process.env.ATTESTATION_SECRET = 'invariant-check-claim-secret';

const failures: string[] = [];
let checked = 0;

function ok(claim: string, condition: boolean) {
  checked++;
  if (!condition) failures.push(claim);
}

/**
 * Source with its comments removed.
 *
 * An assertion that "the signup path never writes `users.origin`" matched the
 * comment explaining why it must not, which is the funniest possible way for a
 * source-level check to fail and a completely real one: prose about a
 * forbidden pattern contains the forbidden pattern. Rewording the comment to
 * satisfy a regex would be fixing the test by damaging the explanation, so the
 * regex reads code instead.
 *
 * Deliberately crude. It is not a parser and does not need to be: it runs over
 * this repository's own source, where no string literal contains `*\/`.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function main() {
  // ---------------------------------------------------------------- Drizzle
  // A unique violation must survive the ORM's error wrapper, because
  // grantPack's "already granted" answer depends on recognising one. The naive
  // check is asserted to FAIL, so this cannot pass by matching nothing.
  {
    const { isUniqueViolation } = await import('@/lib/credits');
    class DriverError extends Error {
      code?: string;
    }
    const driver = new DriverError('duplicate key value violates unique');
    driver.code = '23505';
    const wrapped = new DrizzleQueryError('insert ...', [], driver);

    ok(
      'a unique violation is recognized through the Drizzle wrapper',
      isUniqueViolation(wrapped)
    );
    ok(
      'the naive top-level code check MISSES it, so the check above is load-bearing',
      (wrapped as unknown as { code?: string }).code === undefined
    );
    ok(
      'an unrelated error is not mistaken for a duplicate',
      !isUniqueViolation(new Error('connection reset'))
    );
  }

  // ------------------------------------------------------------- Agent pack
  // It must be unreachable from Stripe checkout, which resolves a price
  // through isPackId. Separation is the gate; nothing filters it by hand.
  {
    const { isPackId, isX402PackId, PACK_IDS, X402_PACKS } =
      await import('@/lib/packs');
    ok(
      'the Agent pack cannot be bought with a card (isPackId refuses it)',
      !isPackId('agent')
    );
    ok(
      'the Agent pack is not in PACK_IDS',
      !PACK_IDS.includes('agent' as never)
    );
    ok('the Agent pack exists on the onchain rail', isX402PackId('agent'));
    ok(
      'the Agent pack still costs $1 for 12 matches',
      X402_PACKS.agent.priceCents === 100 && X402_PACKS.agent.matches === 12
    );
  }

  // ----------------------------------------------------------- the pack ladder
  // Four properties that have been true by inspection since the packs were
  // written, and that nothing checks. They are load bearing the moment a rung
  // is added, reordered or repriced: three call sites find a pack by walking
  // PACK_IDS until one is big enough, and `/pricing` plus six comparison pages
  // publish PACK_IDS[0] as the entry price. None is enforced by a type, and
  // every one is a wrong price rather than a crash, because the surfaces read
  // PACKS and render whatever is there.
  {
    const { PACKS, PACK_IDS } = await import('@/lib/packs');
    const perMatch = (id: (typeof PACK_IDS)[number]) =>
      PACKS[id].priceCents / PACKS[id].matches;

    // A buyer must never be punished for stepping up. If a small pack were
    // cheaper per match than a large one, the way to buy the large amount
    // would be to buy the small pack repeatedly, and we would have priced our
    // own ladder out of existence. Stated per match rather than as that
    // arbitrage on purpose: the repeat-purchase form rounds up, so it is the
    // weaker of the two and passes over inversions this one catches.
    ok(
      'no pack is cheaper per match than a larger one',
      PACK_IDS.every((id, i) =>
        PACK_IDS.slice(i + 1).every(
          (bigger) =>
            PACKS[bigger].matches > PACKS[id].matches &&
            perMatch(bigger) < perMatch(id)
        )
      )
    );

    // `app/pricing/page.tsx` advertises "Packs from $X" as PACK_IDS[0], and six
    // comparison pages render the same entry as their "to start" figure. A pack
    // inserted anywhere but first makes every one of those pages quote a floor
    // that is not the floor, with nothing failing.
    ok(
      'no pack is cheaper than the one every surface calls the entry price',
      PACK_IDS.every(
        (id) => PACKS[id].priceCents >= PACKS[PACK_IDS[0]].priceCents
      )
    );

    // Three call sites pick a pack with `PACK_IDS.find(p => …matches >= n)`,
    // which is only correct while PACK_IDS ascends. Asserted through that exact
    // expression rather than by re-sorting the list, so a broken order fails
    // here the same way it would fail the buyer: the finder is made to answer,
    // and its answer is compared with the true minimum.
    ok(
      'the ascending pack finder cannot return a larger pack than one that fits',
      PACK_IDS.every((id) => {
        // One below the rung, so the answer is that rung and not the one under
        // it. Asking for a rung's exact size would be satisfied by an
        // off-by-one that a real caller's arbitrary wallet count would not be.
        const target = PACKS[id].matches - 1;
        const found = PACK_IDS.find((p) => PACKS[p].matches >= target);
        const fitting = PACK_IDS.filter((p) => PACKS[p].matches >= target);
        const smallest = fitting.reduce((best, p) =>
          PACKS[p].matches < PACKS[best].matches ? p : best
        );
        return found === smallest;
      })
    );

    // The env var is written by hand per pack and is never derived from the id,
    // so two packs can name the same Stripe price with nothing to notice it.
    // That failure charges the buyer one pack's price and grants another's
    // matches, and both halves look correct in their own log line.
    ok(
      'no two packs resolve to the same Stripe price variable',
      new Set(PACK_IDS.map((id) => PACKS[id].priceEnvVar)).size ===
        PACK_IDS.length
    );

    // The day-14 email is the sequence's only ask, and it named Trial by hand.
    // That is right today and right by coincidence: Trial is the first key, not
    // the named one. Put a cheaper rung underneath and the email sells the
    // second one. It is not a crash and not a wrong price, it is a working link
    // to the wrong shelf, and nothing else in the repo can see it.
    const { WELCOME_EMAILS, contentFor } =
      await import('@/lib/welcome-sequence');
    const sales = contentFor(WELCOME_EMAILS[WELCOME_EMAILS.length - 1], {
      holdsCredits: false,
    });
    const entry = PACKS[PACK_IDS[0]];
    ok(
      'the sales email cannot name a rung that is no longer the entry',
      sales.subject.includes(String(entry.matches)) &&
        (sales.button?.label ?? '').includes(entry.name)
    );

    /**
     * An email that adapts must be true in BOTH of its forms.
     *
     * welcome-1 told a gifted account it had the rolling free allowance
     * (Bugbot, 2026-08-27). A live lot makes `hasPaidAccess` true, so that
     * reader is spending a pack, not the allowance, and the same paragraph
     * went on to sell them the features their pack had already opened.
     *
     * Asserted through the resolver rather than by reading the source, so it
     * tests what a reader receives.
     */
    const { FREE_MATCHES_PER_WINDOW } = await import('@/lib/packs');
    for (const email of WELCOME_EMAILS) {
      const paid = contentFor(email, { holdsCredits: true });
      const body = [paid.subject, ...paid.paragraphs].join(' ');
      ok(
        `${email.key} does not tell a credit-holder they are on the free allowance`,
        !new RegExp(
          `${FREE_MATCHES_PER_WINDOW}\\s+free matches|your ${FREE_MATCHES_PER_WINDOW} free`,
          'i'
        ).test(body)
      );
    }

    /**
     * And both runners must pass the reader's real state.
     *
     * The assertion above proves the copy adapts; it says nothing about
     * whether anybody asks it to. A runner that resolves with a hardcoded
     * `false` sends the free-allowance version to a credit-holder while every
     * content check still passes, so the call sites are asserted separately
     * from the content.
     */
    const seqSrc = withoutComments(
      readFileSync('lib/welcome-sequence.ts', 'utf8')
    );
    ok(
      'both runners read holdsCredits from the row',
      (seqSrc.match(/\) AS "holdsCredits"/g) ?? []).length === 2
    );
    ok(
      'and pass it through rather than a literal',
      /contentFor\(first, \{ holdsCredits: r\.holdsCredits \}\)/.test(seqSrc) &&
        /contentFor\(email, \{ holdsCredits: d\.holdsCredits \}\)/.test(
          seqSrc
        ) &&
        !/contentFor\([a-z]+, \{ holdsCredits: (true|false) \}\)/.test(seqSrc)
    );

    /**
     * A hand-issued grant must not end somebody's onboarding.
     *
     * Eligibility once excluded any account holding **any** credit lot, so
     * gifting a pack silently stopped the sequence: the account got whatever
     * campaign email came with the gift and never heard from onboarding
     * again, with nothing failing and no diff. It had cost nobody an email
     * only because every granted account so far predates `SEQUENCE_START`.
     *
     * "Bought" is `amount_cents > 0`, and holding credits is a separate
     * question that exactly one email is allowed to ask.
     */
    const seq = withoutComments(
      readFileSync('lib/welcome-sequence.ts', 'utf8')
    );
    const eligible = seq.slice(
      seq.indexOf('const ELIGIBLE_USER'),
      seq.indexOf('const HOLDS_NO_CREDITS')
    );
    ok(
      'the sequence ends only for accounts that actually bought',
      /credit_lots cl\s*WHERE cl\.user_id = u\.id AND cl\.amount_cents > 0/.test(
        eligible
      )
    );
    ok(
      'eligibility does not exclude an account merely for holding credits',
      !/NOT EXISTS \(SELECT 1 FROM credit_lots cl WHERE cl\.user_id = u\.id\)/.test(
        eligible
      )
    );
    /**
     * And the sales email still stands down for them, for its own reason: a
     * live lot makes `hasPaidAccess` true, so its ask names features that are
     * already open to the reader.
     */
    ok(
      'the sales email is the one gated on holding no credits',
      /REQUIRES_NO_CREDITS = new Set\(\['welcome-5'\]\)/.test(seq) &&
        /REQUIRES_NO_CREDITS\.has\(e\.key\) \? HOLDS_NO_CREDITS : sql`TRUE`/.test(
          seq
        )
    );
    ok(
      'the gated key is one the sequence actually contains',
      WELCOME_EMAILS.some((e) => e.key === 'welcome-5')
    );
  }

  // --------------------------------------- A check-in that read the account
  {
    /**
     * The campaign must never offer a pack to somebody already holding one.
     *
     * Measured on 2026-08-27, the single-variant version of this email would
     * have offered a $29 Trial pack to 96 accounts that were given one four
     * days earlier and had spent 3 of 25,000 matches between them. The split
     * exists for that, and its first draft reintroduced the same failure for
     * the two partly-spent accounts by keying the offer on `consumed = 0`
     * rather than on holding a lot at all.
     */
    // The campaign moved to `lib/checkin-campaign.ts` when the daily run was
    // automated, so the cron and the CLI share one implementation. These read
    // the library, not the front end: the script deliberately holds no copy
    // and no selection rules, which the assertion below states outright.
    const campaign = readFileSync('lib/checkin-campaign.ts', 'utf8');
    const code = withoutComments(campaign);
    ok(
      'the offer arm is chosen by holding nothing, never by having spent nothing',
      /variant: !r\.holds_lot\s*\?\s*'no-credits'/.test(code) &&
        !/holds_lot[\s\S]{0,80}consumed = 0/.test(code)
    );
    ok(
      'only the no-credits copy contains an offer',
      // Curly apostrophe: the copy was corrected on 2026-09-18 when the house
      // style guard learned to read template literals, and this assertion
      // quotes the sentence verbatim, so it moved with it.
      /I’d be happy to gift you a Trial pack/.test(
        campaign.slice(campaign.indexOf('function noCreditsContent'))
      ) &&
        !/gift you a Trial pack/.test(
          campaign.slice(
            campaign.indexOf('function hasCreditsContent'),
            campaign.indexOf('function noCreditsContent')
          )
        )
    );
    ok(
      'every send is archived and answerable by a person',
      /bcc: ARCHIVE_BCC/.test(code) &&
        /replyTo: REPLY_TO/.test(code) &&
        !/noreply/.test(code)
    );

    /**
     * Plain does not mean exempt: lifecycle mail with no working unsubscribe
     * is a send we must not make, whichever sender renders it.
     */
    const email = withoutComments(readFileSync('lib/email.ts', 'utf8'));
    const plain = email.slice(
      email.indexOf('export async function sendPlainEmail')
    );
    ok(
      'the plain sender refuses without the unsubscribe secret',
      /const unsub = unsubscribeUrl\(options\.to\);[\s\S]{0,200}?if \(!unsub\)[\s\S]{0,200}?return \{ success: false/.test(
        plain
      )
    );
    ok(
      'and it still sets the one-click headers',
      /'List-Unsubscribe': `<\$\{unsub\}>`/.test(plain) &&
        /'List-Unsubscribe-Post'/.test(plain)
    );

    /**
     * One implementation, now that a cron sends this unattended.
     *
     * The CLI is a front end. If it kept its own copy of the wording or its own
     * selection rules, the campaign would send two different emails depending
     * on whether a person or the scheduler pressed it, and only one of the two
     * would be the one anybody reviewed.
     */
    const cli = readFileSync('scripts/checkin-nonbuyers.ts', 'utf8');
    ok(
      'the CLI holds no copy of its own',
      !/I wanted to check in personally|gift you a Trial pack/.test(cli)
    );
    ok(
      'and no selection rules of its own',
      !/FROM users u/.test(cli) && /selectPending\(\)/.test(cli)
    );

    /**
     * The pause switch is a row, and it fails closed.
     *
     * An env var takes effect on the next deployment, so stopping an outbound
     * campaign with one means waiting for a build while it keeps sending. And a
     * switch whose read error means "carry on" is not a switch: the catch
     * returns paused.
     */
    ok(
      'the campaign can be stopped without a deploy',
      /FROM ingest_state WHERE name = 'checkin_campaign'/.test(campaign)
    );
    ok(
      'a pause switch that cannot be read stops the campaign',
      /catch[\s\S]{0,220}?refusing to send[\s\S]{0,80}?return true;/.test(
        campaign
      )
    );
    /**
     * Both positions have to exist before their order means anything.
     *
     * `indexOf` answers -1 for absent, and -1 is less than every real index,
     * so a bare `a < b` reports "the check comes first" most loudly when the
     * check has been deleted. The guard removed the pause block and this
     * passed. The same trap is documented a few hundred lines up, on the
     * assertion that had it first.
     */
    const pausePos = campaign.indexOf('if (await isPaused())');
    const selectPos = campaign.indexOf('const pending = await selectPending()');
    ok(
      'the run checks the switch before selecting anybody',
      pausePos >= 0 && selectPos >= 0 && pausePos < selectPos
    );

    /**
     * And the cron is authenticated like every other one, or the campaign is a
     * send anybody on the internet can trigger.
     */
    const cron = withoutComments(
      readFileSync('app/api/cron/checkin-nonbuyers/route.ts', 'utf8')
    );
    /**
     * The whole guard, not just the comparison inside it.
     *
     * Testing for `authHeader !== ...` alone passed while the guard read
     * `if (false && authHeader !== ...)`: the comparison survives, and the
     * refusal it belonged to does not. The condition that decides whether the
     * 401 happens is the thing worth asserting.
     */
    ok(
      'the check-in cron requires the cron secret',
      /if \(cronSecret && authHeader !== `Bearer \$\{cronSecret\}`\) \{/.test(
        cron
      ) && /status: 401/.test(cron)
    );
    ok(
      'and it is scheduled',
      /"path": "\/api\/cron\/checkin-nonbuyers"/.test(
        readFileSync('vercel.json', 'utf8')
      )
    );

    /**
     * The ledger row is a lock, not a witness.
     *
     * Writing it after the send makes the unique constraint record a race
     * instead of preventing one: a doubled cron, or a manual `--send`
     * overlapping 16:00 UTC, both select the same people, both send, and one
     * insert then no-ops. The welcome sequence moved to claim-before-send for
     * exactly this, and the pull request that shipped the old shape here
     * asserted in its own text that the two runners were safe together
     * (Bugbot, 2026-08-27).
     */
    const claimPos = campaign.indexOf('INSERT INTO lifecycle_emails');
    const sendPos = campaign.indexOf('await sendPlainEmail(');
    ok(
      'the claim is taken before the send',
      claimPos >= 0 && sendPos >= 0 && claimPos < sendPos
    );
    ok(
      'a row another runner already holds stops this one sending',
      /if \(claim\.rows\.length === 0\) \{[\s\S]{0,120}?continue;/.test(
        campaign
      )
    );
    /**
     * The reclaim exists AND runs. Two assertions, because they fail apart.
     *
     * Checking only that the DELETE is in the file passed while the call to it
     * was deleted: the mechanism sat there, invoked by nothing, and a claim
     * taken by a killed process would have blocked that account's email
     * forever. This is the third time in this file that asserting a mechanism
     * without asserting its call site let the guard through, after the UTC
     * bound helper and the cron auth guard. Assert the thing that makes it
     * happen, not the thing that could.
     */
    ok(
      'a claim that is never redeemed can be freed',
      /DELETE FROM lifecycle_emails[\s\S]{0,200}?email_key = \$\{EMAIL_KEY\}[\s\S]{0,200}?confirmed_at IS NULL[\s\S]{0,120}?failed_at IS NULL/.test(
        campaign
      )
    );
    const reclaimPos = campaign.indexOf('await reclaimStaleCheckinClaims()');
    ok(
      'and the run actually calls it, before it selects anybody',
      reclaimPos >= 0 && selectPos >= 0 && reclaimPos < selectPos
    );

    /**
     * A heartbeat that is always `ok` reports health rather than measuring it,
     * and a subtype the health pane does not list is a job whose silence looks
     * the same as never having existed.
     */
    ok(
      'the cron derives ok from the outcome rather than asserting it',
      /ok: outcome\.failed === 0/.test(cron) && !/ok: true/.test(cron)
    );
    ok(
      'the health pane expects this job, so its silence is visible',
      /subtype: 'checkin_nonbuyers'/.test(
        readFileSync('app/api/admin/health/dependencies/route.ts', 'utf8')
      )
    );
  }

  // ------------------------------------------------ the index write path
  // Two defects that each silently lost a wallet's identity rather than
  // failing loudly, both recorded against real jobs in
  // `lookup_jobs.social_graph_write_errors`, and a third that retried both.
  {
    const { isNonTransientError } = await import('@/lib/social-graph');
    const { asSourceList } = await import('@/lib/api-sources');
    const { supportsTransactions } = await import('@/db');

    // A bug in this process is never fixed by asking the database again. Both
    // real failures are asserted by their actual value: the TypeError raised
    // by calling `.some` on a string, and the driver's own refusal text.
    let typeErr: Error;
    try {
      ('web3bio,neynar' as unknown as string[]).some((s) => s === 'ens');
      typeErr = new Error('did not throw');
    } catch (e) {
      typeErr = e as Error;
    }
    ok(
      'the TypeError from a non-array source is not retried',
      typeErr instanceof TypeError && isNonTransientError(typeErr)
    );
    ok(
      'a driver with no transaction support is not retried',
      isNonTransientError(
        new Error('No transactions support in neon-http driver')
      )
    );
    // Proves the classifier has not been widened into always-true, which is
    // the way a refusal assertion passes while protecting nothing.
    ok(
      'a genuinely transient error is still retried',
      !isNonTransientError(new Error('connection reset by peer')) &&
        !isNonTransientError(new Error('fetch failed'))
    );

    /**
     * The case above was written as a plain `Error` and therefore proved
     * nothing about the real one.
     *
     * Node rejects a network failure as `TypeError: fetch failed`, and
     * `neon-http` runs every query through `fetch`, so the first version of
     * this classifier stopped retrying precisely the faults the retry exists
     * for. The assertion missed it because a plain `Error('fetch failed')` is
     * not an instance of `TypeError`, so it never reached the branch under
     * test: the wrong constructor made a passing assertion out of a real
     * regression (Bugbot, PR #201).
     *
     * Constructed the way Node constructs it, cause included.
     */
    const networkTypeError = new TypeError('fetch failed');
    (networkTypeError as { cause?: unknown }).cause = new Error('ECONNRESET');
    ok(
      'a network failure is retried even though Node raises it as a TypeError',
      networkTypeError instanceof TypeError &&
        !isNonTransientError(networkTypeError)
    );

    // The write path is the one surface that persists, so it is the one that
    // must not take `source` on trust. Asserted through the helper, on the
    // shape our own CSV export really produces.
    ok(
      'a joined source string is recovered rather than iterated as characters',
      JSON.stringify(asSourceList('web3bio,neynar')) ===
        JSON.stringify(['web3bio', 'neynar']) &&
        [...asSourceList('web3bio,neynar')].length === 2
    );

    const graphSrc = withoutComments(
      readFileSync('lib/social-graph.ts', 'utf8')
    );
    // Normalisation must happen before anything reads the field, so the guard
    // is asserted to precede the merge and the verification helpers rather
    // than merely to exist somewhere in the file.
    const normalise = 'source: asSourceList(r.source),';
    ok(
      'the write path normalises source before it merges or verifies it',
      graphSrc.includes(normalise) &&
        graphSrc.indexOf(normalise) <
          graphSrc.indexOf('mergeSources(r.source') &&
        graphSrc.indexOf(normalise) < graphSrc.indexOf('isTwitterVerified(')
    );

    // `db.transaction()` throws on neon-http at call time, so an unconditional
    // call makes the whole index write depend on an environment variable.
    ok(
      'the index write never calls transaction() without asking the driver first',
      graphSrc.includes('if (supportsTransactions()) {') &&
        graphSrc.indexOf('supportsTransactions()') <
          graphSrc.indexOf('db.transaction(')
    );
    ok(
      'there is a path that still writes when the driver has no transaction',
      graphSrc.includes('return await writeAll(db);')
    );

    // Without a rollback, a retry that restarts re-runs `lookup_count + 1` on
    // every row the failed attempt already committed. That number sets the
    // quality tier past 3 and the refresh-stale hot set past 5, so inflating
    // it promotes wallets that were written once (Bugbot, PR #201, Medium).
    ok(
      'a retry without a transaction resumes rather than restarting',
      graphSrc.includes('for (let i = progress?.rowsCommitted ?? 0;')
    );
    // The cursor must be the inverse of the rollback: carried only where there
    // is none, or a transactional retry skips work it never wrote.
    ok(
      'the resume cursor exists only when the driver cannot roll back',
      /supportsTransactions\(\)\s*\?\s*undefined\s*:\s*\{\s*rowsCommitted: 0/.test(
        graphSrc
      )
    );
    // Advanced after the statement returns, never before, or a batch that
    // threw is skipped on the retry and those wallets are lost.
    ok(
      'the cursor advances only after the write it records',
      graphSrc.indexOf(
        'if (progress) progress.rowsCommitted = i + batch.length;'
      ) > graphSrc.indexOf('.onConflictDoUpdate(')
    );
    // A committed prefix survives a failure once there is no rollback, so
    // reporting the whole batch as failed is a false statement about the index
    // and it makes job-processor's 'partial' branch unreachable for this case
    // (Bugbot, PR #201, Medium).
    ok(
      'an exhausted retry reports what committed rather than zero',
      !/succeeded: 0,\s*\n\s*failed: validResults\.length,/.test(graphSrc) &&
        /succeeded: committed,\s*\n\s*failed: validResults\.length - committed,/.test(
          graphSrc
        )
    );
    // The capability is read from the driver module rather than re-tested, or
    // the two drift and the gate starts describing a driver that is not live.
    ok(
      'the transaction capability is not re-derived from the env var locally',
      !graphSrc.includes('USE_CONNECTION_POOLING') &&
        typeof supportsTransactions() === 'boolean'
    );
  }

  // ------------------------------------------------- the starter collection
  // The first action supplies the wallet list, which is the one thing the paid
  // contract importer charges for. Everything here asserts that it can only
  // ever supply OUR list: a caller who can name any contract has turned a free
  // action into an unmetered import of somebody else's holders.
  {
    const {
      parseStarterParam,
      buildStarterHref,
      STARTER_WALLET_CAP,
      STARTER_ALLOWANCE_SHARE,
    } = await import('@/lib/starter-collections');
    const { FREE_MATCHES_PER_WINDOW } = await import('@/lib/packs');

    ok(
      'a starter link naming an unsupported chain is refused',
      parseStarterParam('solana:0x1111111111111111111111111111111111111111') ===
        null
    );
    ok(
      'a starter link naming a malformed address is refused',
      parseStarterParam('base:0xdeadbeef') === null &&
        parseStarterParam('base:not-an-address') === null
    );
    ok(
      'a starter link carrying a third segment is refused',
      parseStarterParam(
        'base:0x1111111111111111111111111111111111111111:extra'
      ) === null
    );
    // Proves the three refusals above are not passing by refusing everything,
    // which is the failure mode a set of negative assertions invites.
    ok(
      'a well-formed starter link is read, and its address normalised',
      parseStarterParam('BASE:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
        ?.address === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    // `?contract=` sends an account with no credits to the buy-credits modal.
    // A first action that landed there would be the bug it exists to fix.
    ok(
      'the starter link never builds the paid importer’s parameter',
      !buildStarterHref(
        'base',
        '0x1111111111111111111111111111111111111111'
      ).includes('contract=')
    );
    // The wallet count IS the worst-case spend, because every wallet in the
    // sample might match. Asserted as the share rather than as a number, since
    // the defect it guards is somebody making the sample bigger for a better
    // demonstration and taking the whole allowance with it.
    ok(
      'a starter run cannot spend more than a quarter of the free allowance',
      STARTER_WALLET_CAP <= FREE_MATCHES_PER_WINDOW / 4 &&
        STARTER_ALLOWANCE_SHARE <= 0.25
    );

    // Read out of the source, because both are orderings rather than values and
    // neither can be observed without a database. Comments are stripped first:
    // the prose above each one names the very identifier being searched for.
    const starterSrc = withoutComments(
      readFileSync('lib/starter-collections.ts', 'utf8')
    );

    // `before` rather than a bare index comparison, because indexOf answers -1
    // for something that is not there at all, and -1 comes before everything.
    // A deleted gate would have satisfied the naive form of both of these.
    const before = (src: string, first: string, second: string) => {
      const a = src.indexOf(first);
      const b = src.indexOf(second);
      return a !== -1 && b !== -1 && a < b;
    };

    /**
     * The featured slot is a promotion, never a bypass.
     *
     * It picks its row out of `listHolderCollections`, which applies the
     * listing floor before this module sees anything, so a pin that stops
     * qualifying drops out and the ranking fills the slot. Reading the corpus a
     * second way, or hand-building a row from the constant, would put a card on
     * the front page for a collection whose report page will not render.
     */
    const { FEATURED_STARTER } = await import('@/lib/starter-collections');
    ok(
      'the featured starter is one entry or none, never a curated list',
      FEATURED_STARTER === null ||
        (typeof FEATURED_STARTER === 'object' &&
          !Array.isArray(FEATURED_STARTER))
    );
    ok(
      'a featured starter names a supported chain and a real address',
      FEATURED_STARTER === null ||
        (SUPPORTED_CHAINS.includes(FEATURED_STARTER.chain) &&
          /^0x[0-9a-f]{40}$/.test(FEATURED_STARTER.address.toLowerCase()))
    );
    // Bounded to the function body. `FEATURED_STARTER` is declared above it, so
    // an unbounded ordering check finds the declaration and passes whatever the
    // function does.
    const listFn = starterSrc.slice(
      starterSrc.indexOf('export async function listStarterCollections')
    );
    ok(
      'the featured row comes from the floor-filtered listing',
      before(listFn, 'listHolderCollections()', 'FEATURED_STARTER')
    );
    /**
     * Promoting a collection that would have ranked anyway must cost a slot,
     * not print the same card twice. The tail is rebuilt without the featured
     * row before the slice, and dropping that filter is the defect.
     */
    ok(
      'a promoted collection is removed from the tail it was promoted out of',
      /const rest = featured \? listed\.filter\(\(c\) => !isFeatured\(c\)\) : listed;/.test(
        starterSrc
      )
    );
    // The refusal itself, not the call that feeds it. Asserting only that
    // `getHolderCollection(` precedes `wallet_holdings` passed over the real
    // defect: keeping the lookup for its name and deleting `if (!collection)
    // return null;` compiles under `collection?.`, leaves both tokens in the
    // same order, and expands any contract on any chain. The refusal has to be
    // the middle term.
    const STARTER_GATE = 'if (!collection) return null;';
    ok(
      'the seeded-row gate runs before any holder wallet is read',
      before(starterSrc, 'getHolderCollection(', STARTER_GATE) &&
        before(starterSrc, STARTER_GATE, 'wallet_holdings')
    );

    const jobsSrc = withoutComments(
      readFileSync('app/api/jobs/route.ts', 'utf8')
    );
    ok(
      'a collection is expanded before the credit meter sees the job',
      before(jobsSrc, 'getStarterWallets(', 'canSubmit(')
    );
    // A body carrying both a collection and a list of wallets must run ours.
    // Taking theirs would record a seeded contract against a job that never
    // touched it, which is a lie in the funnel and in the admin table.
    ok(
      'a caller cannot substitute their own wallets for a collection’s',
      /const wallets = starter \? starter\.wallets : body\.wallets;/.test(
        jobsSrc
      )
    );

    // The keyed job-status route. A job holds the resolved social data for
    // every wallet the submitter paid to check, so the ownership gate is the
    // whole access control: any valid key can construct the URL. Two claims,
    // both attacker-shaped. The mismatch refusal must come before anything
    // reads a result field, and it must be the same 404 a missing job
    // answers: a 403 would confirm the id exists, and a job id is the only
    // handle an enumerator needs.
    const v1JobSrc = withoutComments(
      readFileSync('app/api/v1/jobs/[id]/route.ts', 'utf8')
    );
    const V1_JOB_GATE = 'job.userId !== context.key.userId';
    ok(
      'a job another account owns is refused before any result field is read',
      before(v1JobSrc, V1_JOB_GATE, 'getJobResultsPage(')
    );
    ok(
      'the ownership refusal is the missing-job 404, never a 403 existence oracle',
      v1JobSrc.includes("'JOB_NOT_FOUND', 404") && !/\b403\b/.test(v1JobSrc)
    );
  }

  // ------------------------------------------------------ x402 settlement id
  // A payment that cannot be made idempotent must be refused rather than
  // settled, so the id is required to be derivable before anything moves.
  {
    const { settlementIdFor, payerFrom } = await import('@/lib/x402');
    ok(
      'a payload with no authorization yields no settlement id',
      settlementIdFor({ x402Version: 2, payload: {} }) === null
    );
    ok(
      'an authorization missing its nonce yields no settlement id',
      settlementIdFor({
        x402Version: 2,
        payload: { authorization: { from: '0xabc' } },
      }) === null
    );
    const id = settlementIdFor({
      x402Version: 2,
      payload: { authorization: { from: '0xAbC', nonce: '0xDEF' } },
    });
    ok(
      'the settlement id is lowercased, so case cannot mint a second lot',
      id === 'eip155:8453:0xabc:0xdef'
    );
    ok(
      'the payer is lowercased for the same reason',
      payerFrom({
        x402Version: 2,
        payload: { authorization: { from: '0xAbC' } },
      }) === '0xabc'
    );
  }

  // ------------------------------------------------------- recovery challenge
  {
    const {
      issueChallenge,
      verifyRecovery,
      challengeMessage,
      CHALLENGE_TTL_MS,
    } = await import('@/lib/x402-recovery');

    /**
     * The token for an arbitrary moment. `issueChallenge` only ever stamps
     * `Date.now()`, so testing the TTL with a correctly-signed stale challenge
     * needs the HMAC directly.
     */
    /**
     * Through the library, never a local reimplementation. The first version
     * recomputed the HMAC here and therefore verified only itself: it passed
     * while the real HMAC stopped covering the timestamp.
     */
    const tokenFor = (w: string, at: number) => issueChallenge(w, at)!.token;
    // Anvil's well-known keys. Public by design, and nothing here is funded.
    const buyer = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
    );
    const stranger = privateKeyToAccount(
      '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
    );
    const wallet = buyer.address;
    const ch = issueChallenge(wallet);
    if (!ch) throw new Error('issueChallenge returned null with a secret set');

    const sign = (a: typeof buyer, message: string) =>
      a.signMessage({ message });
    const good = await sign(buyer, ch.message);

    ok(
      'the real buyer, signing a live challenge, is accepted',
      (
        await verifyRecovery({
          wallet,
          issuedAt: ch.issuedAt,
          token: ch.token,
          signature: good,
        })
      ).ok
    );
    ok(
      'a stranger signing the same challenge is refused',
      !(
        await verifyRecovery({
          wallet,
          issuedAt: ch.issuedAt,
          token: ch.token,
          signature: await sign(stranger, ch.message),
        })
      ).ok
    );
    ok(
      'a forged token is refused even with a real signature',
      !(
        await verifyRecovery({
          wallet,
          issuedAt: ch.issuedAt,
          token: 'a'.repeat(64),
          signature: good,
        })
      ).ok
    );
    ok(
      'a tampered issued_at is refused, so the HMAC covers the timestamp',
      !(
        await verifyRecovery({
          wallet,
          issuedAt: ch.issuedAt - 1,
          token: ch.token,
          signature: good,
        })
      ).ok
    );
    /**
     * The stale challenge is signed correctly for its own timestamp.
     *
     * The first version reused `good`, a signature over a different timestamp,
     * so the request was refused by the message binding and the TTL check was
     * never reached. It passed while that check was deleted. An assertion that
     * passes for the wrong reason is the thing this file exists to stop.
     */
    const staleAt = Date.now() - CHALLENGE_TTL_MS - 60_000;
    ok(
      'a challenge older than its TTL is refused, even correctly signed',
      !(
        await verifyRecovery({
          wallet,
          issuedAt: staleAt,
          token: tokenFor(wallet, staleAt),
          signature: await sign(buyer, challengeMessage(wallet, staleAt)),
        })
      ).ok
    );
    ok(
      'the HMAC covers the timestamp: two moments give two different tokens',
      tokenFor(wallet, 1_000_000) !== tokenFor(wallet, 1_000_001)
    );
    ok(
      'the HMAC covers the wallet: two wallets give two different tokens',
      tokenFor(wallet, 1_000_000) !== tokenFor(stranger.address, 1_000_000)
    );
    /**
     * Correctly signed and correctly tokenised for its own future timestamp,
     * so the `age < 0` branch is actually reached.
     *
     * The first version reused a live token and signature with a different
     * `issuedAt`, which the HMAC refused first. It passed while the future-date
     * refusal was deleted. That is the same mistake as the stale-challenge
     * assertion made, in the assertion written immediately after it.
     */
    const futureAt = Date.now() + 60_000;
    ok(
      'a challenge dated in the future is refused, even correctly signed',
      !(
        await verifyRecovery({
          wallet,
          issuedAt: futureAt,
          token: tokenFor(wallet, futureAt),
          signature: await sign(buyer, challengeMessage(wallet, futureAt)),
        })
      ).ok
    );
    ok(
      'the signed message names the wallet, so a signature cannot be transplanted',
      ch.message.toLowerCase().includes(wallet.toLowerCase())
    );
    ok(
      'the signed message says no funds move, because a wallet shows it to a person',
      /no funds move/i.test(ch.message)
    );

    /**
     * A claim challenge and a recovery challenge are not interchangeable.
     *
     * Two flows now ask a wallet to sign, and they authorise different things:
     * one hands out an API key, the other writes an identity into the index.
     * A signature captured for either must be refused by the other, or the
     * cheaper flow becomes a way into the more expensive one.
     *
     * The separation is enforced twice and both are asserted, because either
     * alone is a single point of failure: the visible message text differs so
     * a person approving it can tell them apart, and the HMAC input is
     * prefixed so the signed bytes differ even if both secrets leaked.
     *
     * Asserted as the refusal through the real functions. Recomputing either
     * HMAC here would verify only itself, which is the mistake this whole
     * block's neighbours record having made.
     */
    const claim = await import('@/lib/attestation');
    const at = Date.now();
    const claimUser = 'invariant-check-user';
    const claimCh = claim.issueClaimChallenge(wallet, claimUser, 'claim', at);
    ok(
      'a claim challenge is issued, or the secret is simply unset',
      claim.isConfigured() ? claimCh !== null : claimCh === null
    );
    if (claimCh) {
      ok(
        'the two flows sign different text, so a person can tell them apart',
        claimCh.message !== challengeMessage(wallet, at) &&
          /identity claim/i.test(claimCh.message) &&
          !/key recovery/i.test(claimCh.message)
      );
      ok(
        'a recovery signature does not satisfy a claim, and the reverse',
        // Signed over the RECOVERY text, presented to the claim verifier.
        !(
          await claim.verifyClaim({
            wallet,
            userId: claimUser,
            intent: 'claim',
            issuedAt: at,
            token: claimCh.token,
            signature: await sign(buyer, challengeMessage(wallet, at)),
          })
        ).ok &&
          // And the claim text presented to the recovery verifier.
          !(
            await verifyRecovery({
              wallet,
              issuedAt: at,
              token: tokenFor(wallet, at),
              signature: await sign(buyer, claimCh.message),
            })
          ).ok
      );
      ok(
        'a claim signature is accepted by the flow that asked for it',
        (
          await claim.verifyClaim({
            wallet,
            userId: claimUser,
            intent: 'claim',
            issuedAt: at,
            token: claimCh.token,
            signature: await sign(buyer, claimCh.message),
          })
        ).ok
      );

      /**
       * A captured signature is useless to anybody else.
       *
       * Without the account in the HMAC a signature is a transferable bearer,
       * which is how the first version of this was wrong: the start route
       * does not spend the challenge, so ANY session presenting a captured
       * signature inside the five-minute window could open a claim for
       * somebody else's wallet. The signer does not choose which X account
       * completes the pairing, so the replay binds their address to the
       * replayer's profile, which is precisely the outcome the flow exists to
       * make impossible.
       *
       * Asserted through the real verifier with a real signature over the
       * real message: the ONLY thing different is the session.
       */
      ok(
        'a claim challenge issued to one account does not verify under another',
        !(
          await claim.verifyClaim({
            wallet,
            userId: 'a-different-account',
            intent: 'claim',
            issuedAt: at,
            token: claimCh.token,
            signature: await sign(buyer, claimCh.message),
          })
        ).ok
      );
      ok(
        'and the token itself differs per account, so the binding is in the HMAC',
        claim.issueClaimChallenge(wallet, claimUser, 'claim', at)!.token !==
          claim.issueClaimChallenge(wallet, 'somebody-else', 'claim', at)!.token
      );
      ok(
        'the claim message says no funds move and no approval is granted',
        /no funds move/i.test(claimCh.message) &&
          /no approval is granted/i.test(claimCh.message)
      );

      /**
       * Giving the record an account and taking it back are separate
       * permissions, and a signature for one must not buy the other.
       *
       * Before the intent existed both were proved by signing identical
       * bytes, so a signature gathered for either was spendable on the other
       * inside the five-minute window. The person-facing half was worse than
       * the replay: somebody withdrawing was shown the CLAIM text in their
       * wallet and asked to approve that the record "can name the account you
       * choose", which is the opposite of what they had clicked. A wallet
       * prompt is the one piece of text in this flow that a person is
       * expected to read, and it was describing the wrong act.
       *
       * Asserted as the refusal, in both directions, through the real
       * verifier with real signatures. The withdrawal challenge is built the
       * same way the withdraw route's caller builds it, so nothing here
       * recomputes what it is testing.
       */
      const withdrawCh = claim.issueClaimChallenge(
        wallet,
        claimUser,
        'withdraw',
        at
      )!;
      ok(
        'the two intents sign different text, so the wallet prompt says which one',
        withdrawCh.message !== claimCh.message &&
          /identity withdrawal/i.test(withdrawCh.message) &&
          !/identity claim/i.test(withdrawCh.message) &&
          // The sentence that is being corrected: a withdrawal must not ask
          // anybody to agree that we may name an account.
          !/name the account you choose/i.test(withdrawCh.message)
      );
      ok(
        'a withdrawal signature is refused by the claim route, and the reverse',
        // Withdrawal challenge, withdrawal signature, presented as a claim.
        !(
          await claim.verifyClaim({
            wallet,
            userId: claimUser,
            intent: 'claim',
            issuedAt: at,
            token: withdrawCh.token,
            signature: await sign(buyer, withdrawCh.message),
          })
        ).ok &&
          // And a perfectly good claim, presented as a withdrawal.
          !(
            await claim.verifyClaim({
              wallet,
              userId: claimUser,
              intent: 'withdraw',
              issuedAt: at,
              token: claimCh.token,
              signature: await sign(buyer, claimCh.message),
            })
          ).ok
      );
      ok(
        'and the token itself differs per intent, so the binding is in the HMAC',
        /**
         * The second enforcement, asserted separately because the first one
         * hides it.
         *
         * The cross-spend refusal above passes on the message text alone: a
         * signature over the withdrawal words does not verify against the
         * claim words whatever the token says. So deleting the intent from
         * the HMAC input left every assertion here green, which this check
         * found by trying it. The same shape as the neighbouring
         * per-account assertion, and for the same reason the recovery
         * separation is asserted twice: either layer alone is a single point
         * of failure, and a check that only exercises the outer one cannot
         * tell you the inner one is gone.
         */
        withdrawCh.token !==
          claim.issueClaimChallenge(wallet, claimUser, 'claim', at)!.token
      );
      ok(
        'a withdrawal signature is accepted by the flow that asked for it',
        // The matching success, so the refusals above cannot pass by
        // refusing everything.
        (
          await claim.verifyClaim({
            wallet,
            userId: claimUser,
            intent: 'withdraw',
            issuedAt: at,
            token: withdrawCh.token,
            signature: await sign(buyer, withdrawCh.message),
          })
        ).ok
      );
      ok(
        'each route states its own intent rather than reading it from the body',
        // A route that took the intent from the request would let the
        // presenter of a captured signature relabel it, which is exactly the
        // separation the two assertions above establish.
        /intent: 'claim'/.test(
          withoutComments(readFileSync('app/api/claim/start/route.ts', 'utf8'))
        ) &&
          /intent: 'withdraw'/.test(
            withoutComments(
              readFileSync('app/api/claim/withdraw/route.ts', 'utf8')
            )
          ) &&
          !/intent:\s*body\./.test(
            readFileSync('app/api/claim/withdraw/route.ts', 'utf8')
          ) &&
          !/intent:\s*body\./.test(
            readFileSync('app/api/claim/start/route.ts', 'utf8')
          )
      );
    }

    /**
     * The cutoff is frozen, and that is the entire gate.
     *
     * A signed-in free account can put a thousand addresses into the graph
     * every thirty days at no cost, so membership is abundant going forward
     * and scarce only retroactively. A cutoff derived from the clock would
     * make every wallet eligible once it had aged, which is the same as
     * having no gate while looking like one.
     */
    const attestationSrc = withoutComments(
      readFileSync('lib/attestation.ts', 'utf8')
    );
    ok(
      'the eligibility cutoff is a committed literal, never the clock',
      /export const ATTESTATION_CUTOFF = '[0-9T:\-Z.]+';/.test(
        attestationSrc
      ) &&
        !/ATTESTATION_CUTOFF[^;]*Date\.now|ATTESTATION_CUTOFF[^;]*interval/.test(
          attestationSrc
        )
    );
    /**
     * The challenge route refuses in the right order and for the right
     * reasons.
     *
     * Three refusals, and the ORDER of the first is the point. A suppressed
     * wallet is refused before a challenge exists, not after a signature
     * arrives: issuing one and refusing later means asking somebody to prove
     * control of an address so we can tell them we will not use it.
     *
     * The second is the one a happy path cannot see. `walletPredatesCutoff`
     * throws on a failed read precisely so the caller cannot quietly serve
     * `earns_credits: false`, which would tell somebody their claim earns
     * nothing because a query failed, with no way for them to know.
     */
    /**
     * A shipped consent version is never edited, only added to.
     *
     * The record stores a version id and the sha256 of the exact text, and
     * that only means something while historical entries are immutable.
     * Editing one in place leaves every row pointing at words nobody agreed
     * to, silently: the id still resolves, and the stored hash is only
     * compared if somebody thinks to compare it.
     *
     * Pinned by hash here, so an edit to a shipped version fails the build
     * rather than passing review as a wording improvement. Adding a NEW
     * version never touches this assertion, which is the behaviour it wants:
     * cheap to do the right thing, loud to do the wrong one.
     */
    {
      const consent = await import('@/lib/attestation-consent');
      ok(
        'the shipped consent text is frozen, so a stored hash still means something',
        // Every version ever shipped, not only the current one. The point is
        // that a row pointing at an OLD id still resolves to the words that
        // row agreed to, so pinning only the newest would leave exactly the
        // rows that need this unprotected.
        consent.hashForVersion('2026-09-20.1') ===
          '55f09df3aaa9f6bda212c1f28fda4e7567eae0d970424652069a9819fa9bc774' &&
          consent.hashForVersion('2026-09-20.2') ===
            '499254259e58528a8977fb2291d9ebb915d70705dee0dfb57544ca80e300e443'
      );
      ok(
        'a correction ADDS a version rather than editing one',
        // v1 promised that an owner claim takes the place of a handle we
        // already hold. The code never did that and, after review, should
        // not. The fix was a new version: v1 is still here, byte for byte,
        // which is what the pinned hash above proves.
        consent.CONSENT_VERSIONS.length >= 2 &&
          consent.CURRENT_CONSENT.id === '2026-09-20.2' &&
          /takes its place/.test(consent.CONSENT_VERSIONS[0].text) &&
          !/takes its place/.test(consent.CURRENT_CONSENT.text)
      );
      ok(
        'an unknown consent version is null rather than a throw',
        consent.hashForVersion('never-shipped') === null
      );
    }

    {
      const route = withoutComments(
        readFileSync('app/api/claim/challenge/route.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      ok(
        'a suppressed wallet is refused before a challenge is issued',
        /isSuppressed\('wallet', \[wallet\]\)/.test(route) &&
          route.indexOf('isSuppressed(') < route.indexOf('issueClaimChallenge(')
      );

      /**
       * …for a CLAIM. A withdrawal of a suppressed wallet is somebody
       * finishing the suppression, not evading it.
       *
       * The withdraw route suppresses first and erases second, and that order
       * is load-bearing: the triggers have to be in place before the rows go
       * or the next ingest writes the pair back. So a withdrawal that failed
       * after the suppression insert left the wallet suppressed with the
       * pairing still served, and the retry landed here and was told the
       * address "has been removed from the index at its owner request".
       * Success language, for a withdrawal that had removed nothing, with no
       * way for the person to tell and no way to finish it.
       *
       * Both halves are asserted because either alone permits the bug: the
       * guard has to exist AND the refusal has to sit inside it. An
       * `isSuppressed` call before the branch would refuse withdrawals again
       * while this file still found the words it was looking for.
       */
      ok(
        'a withdrawal is exempt from that refusal, so a half-finished one can be retried',
        /if \(intent === 'claim'\) \{/.test(route) &&
          route.indexOf("if (intent === 'claim') {") <
            route.indexOf('isSuppressed(') &&
          // Exactly one, so the exempted branch is the only one that checks.
          route.split('isSuppressed(').length === 2
      );
      /**
       * The invitation is one bit, and the paid product stays paid.
       *
       * Telling a caller WHICH account we hold for an address they typed
       * would be the reverse lookup, given away behind a session and ten
       * requests an hour. `/check` refuses to name wallets for exactly this
       * reason and says so on the page. So this route answers whether
       * confirming would ADD an account number and never what the handle is.
       *
       * Asserted as the refusal: the response may not carry a handle.
       */
      ok(
        'the challenge says an account number is missing without naming the account',
        /adds_account_id: idGap/.test(route) &&
          !/twitter_handle:/.test(route) &&
          !/\bhandle:/.test(route)
      );

      /**
       * The grant pays for the thing only a claim can supply.
       *
       * The cutoff alone paid for an owner attestation Farcaster mostly gives
       * us free: measured 2026-09-20, 4,708,708 wallets carry an FID and
       * 1,063,216 of those carry an X handle, against 86,894 rows anywhere
       * carrying an account number. So the gate is both halves. The cutoff
       * answers "could this evidence have been bought", the gap answers "did
       * we already have it", and either alone pays for the wrong thing.
       */
      {
        const callback = withoutComments(
          readFileSync('lib/claim-callback.ts', 'utf8')
        );
        ok(
          'a claim that adds no account number is not paid',
          /if \(!addsAccountId\) return;/.test(callback)
        );
        ok(
          'the no-credit copy never claims we hold an account number',
          /**
           * `adds_account_id` is false in four cases: we hold a number
           * already, the address carries no handle, there is no row at all,
           * or the gap read failed. Copy that reads it as the first was a
           * false statement about our own index in the other three, shown at
           * the moment somebody is asked to sign.
           *
           * Asserted as the refusal of the sentence rather than as the
           * presence of a replacement, because the defect is a claim being
           * made, and any number of honest sentences could stand in its
           * place.
           */
          !/already hold the account number/.test(
            withoutComments(readFileSync('components/ClaimFlow.tsx', 'utf8'))
          )
        );
        ok(
          'the paying gap and the quoted gap are the same gap',
          /**
           * Both sides require a handle. Without it the callback counted any
           * pre-cutoff row with a null id, including FID-only rows, ENS-only
           * rows and persisted negatives, while the challenge did not: the
           * page told those people they would earn nothing and then paid
           * them, out of a budget meant for the one thing a claim uniquely
           * supplies. Two definitions of one condition, one shown and one
           * enforced, is the shape that makes a money page lie.
           */
          /twitter_handle IS NOT NULL/.test(callback) &&
            /twitter_handle IS NOT NULL/.test(route)
        );
        ok(
          'and the cutoff still applies, so a wallet made today cannot earn one',
          // Narrowing the grant must not have swapped the anti-sybil half for
          // the useful one. Both, or an address created this morning claims an
          // unclaimed account and is paid for it.
          /walletPredatesCutoff\(wallet\)/.test(callback) &&
            /if \(!eligible\) return;/.test(callback)
        );
        ok(
          'the gap is read BEFORE the ingest that closes it',
          /**
           * `ingestLinks` writes the account id, so asking afterwards answers
           * "no gap" for precisely the claims that just filled one, and the
           * grant would never be paid to anybody.
           *
           * Anchored on the QUERY, not on `addsAccountId =`. That matched
           * `let addsAccountId = false` on the declaration line, which does
           * not move when the read does, so the first version of this check
           * passed with the read relocated below the ingest.
           */
          callback.indexOf('SELECT twitter_user_id') > -1 &&
            callback.indexOf('SELECT twitter_user_id') <
              callback.indexOf('await ingestLinks(')
        );
      }

      ok(
        'an unrecognized intent is refused rather than read as a claim',
        // The value decides which act the resulting signature can be spent
        // on, so coercing a typo to the more powerful of the two is the
        // wrong direction to fail in.
        /error: 'invalid_intent'/.test(route) &&
          route.indexOf("error: 'invalid_intent'") <
            route.indexOf('issueClaimChallenge(')
      );
      ok(
        'a failed eligibility read refuses, rather than serving earns_credits false',
        // The catch answers 503. A `catch { eligible = false }` would be the
        // silent wrong answer, and it reads as the more forgiving branch.
        /catch \{ return NextResponse\.json\( \{ error: 'unavailable'/.test(
          route
        ) && !/catch \{ eligible = false/.test(route)
      );
      /**
       * The start route's refusals, which are the ones that cost something
       * to get wrong.
       */
      const start = withoutComments(
        readFileSync('app/api/claim/start/route.ts', 'utf8')
      ).replace(/\s+/g, ' ');

      ok(
        'suppression is re-read at the signature, not trusted from the challenge',
        // A removal can land inside the person's five-minute window, and the
        // one refusal that has to be current is the one that would otherwise
        // be served from a read taken before they signed.
        /isSuppressed\('wallet', \[wallet\]\)/.test(start)
      );
      ok(
        'a stale agreement is refused rather than silently upgraded',
        // Agreeing to v1 is not agreeing to v2. A tab left open holds the old
        // text, and accepting it would record a consent to words this build
        // no longer shows anyone.
        /body\.consent_version !== CURRENT_CONSENT\.id/.test(start) &&
          /error: 'consent_stale'/.test(start)
      );
      ok(
        'every verification failure answers the same way',
        // A caller who can tell a bad token from a bad signature from an
        // expired challenge grinds against whichever is cheapest. The reason
        // is logged, never served: same rule as the X callback's not_found.
        /console\.error\(`claim verification failed: \$\{verified\.reason\}`\)/.test(
          start
        ) && !/message: verified\.reason|reason: verified\.reason/.test(start)
      );
      /**
       * The claim scope set is narrow, and `tweet.read` is not the part that
       * makes it narrow.
       *
       * Both halves asserted, because the first version got the second one
       * wrong in the direction that looks like tidying. It shipped
       * `['users.read']` with a comment claiming X requires `tweet.read` only
       * alongside `list.write`, reasoning by analogy from the other scope
       * set's comment. X's own OpenAPI description for `GET /2/users/me`
       * declares `["users.read", "tweet.read"]` in ONE security requirement,
       * so a token minted without it answers 403 to the single call this
       * whole flow exists to make, and nothing fails until a real person
       * reaches the end of the consent screen.
       */
      ok(
        'the claim scope set drops list access and keeps what /2/users/me needs',
        /const X_CLAIM_SCOPES = \['users\.read', 'tweet\.read'\] as const;/.test(
          withoutComments(readFileSync('lib/x-oauth.ts', 'utf8'))
        ) && /X_CLAIM_SCOPES\.join\(' '\)/.test(start)
      );
      ok(
        'the row is born unable to do anything',
        // Same shape as x_list_jobs: a verifier and a nonce, and only the
        // callback can move it out of awaiting_x.
        /'awaiting_x'/.test(start) &&
          /state', `claim:\$\{claimId\}\.\$\{nonce\}`/.test(start)
      );

      /**
       * One redirect URI, two flows, and the state decides which table is
       * read before anything reads one.
       *
       * Getting this wrong is quiet: the list branch would look for a claim
       * id in `x_list_jobs`, find nothing, and answer `not_found` to somebody
       * whose authorization actually succeeded. The parse is in one place so
       * the two callers cannot disagree about what a state looks like.
       */
      {
        const oauth = await import('@/lib/x-oauth');
        ok(
          'a claim state routes to the claim flow and a list state does not',
          oauth.parseCallbackState('claim:abc.def')?.flow === 'claim' &&
            oauth.parseCallbackState('abc.def')?.flow === 'list' &&
            oauth.parseCallbackState('claim:abc.def')?.id === 'abc' &&
            oauth.parseCallbackState('abc.def')?.id === 'abc'
        );
        ok(
          'a state missing either half is refused rather than half-parsed',
          oauth.parseCallbackState('claim:') === null &&
            oauth.parseCallbackState('.nonce') === null &&
            oauth.parseCallbackState('abc') === null &&
            oauth.parseCallbackState('abc.') === null
        );

        /**
         * The claim callback keeps no credential, and there is nowhere to put
         * one.
         *
         * The list callback stores a sealed token because it spends sixteen
         * minutes adding members. This flow reads the account once and is
         * finished, so the token is a liability rather than an asset.
         * Asserted as the refusal: no write of it, and no column on the table
         * that could accept one.
         */
        const cb = withoutComments(
          readFileSync('lib/claim-callback.ts', 'utf8')
        ).replace(/\s+/g, ' ');
        /**
         * A claim is routed before any shared refusal runs.
         *
         * X echoes `state` on an authorization error as well as on success,
         * so every refusal in the shared route is reachable by a claim. When
         * they ran first, somebody who cancelled a claim landed on the
         * homepage carrying `x_list`, which is the wrong page and the wrong
         * vocabulary, and the config gate refused the flow for a missing
         * secret-box key it never uses while `claim/start` checked no such
         * thing: a flow that starts and then cannot finish.
         *
         * Asserted positionally, because the defect is ordering rather than
         * absence. Every one of these was present and simply ran too early.
         */
        const shared = withoutComments(
          readFileSync('app/api/x/callback/route.ts', 'utf8')
        ).replace(/\s+/g, ' ');
        const claimBranch = shared.indexOf("parsed?.flow === 'claim'");
        const boxGate = shared.indexOf('boxConfigured()');
        const cancelRefusal = shared.indexOf("'cancelled' : 'refused'");
        const invalidRefusal = shared.indexOf("back('invalid')");
        ok(
          'a claim is routed before the shared config gate and the shared refusals',
          // Each marker must EXIST before its position means anything. An
          // indexOf that matched nothing returns -1, and `x < -1` is false,
          // so a mistyped marker fails loudly rather than passing over a
          // check it never performed.
          claimBranch > 0 &&
            boxGate > 0 &&
            cancelRefusal > 0 &&
            invalidRefusal > 0 &&
            claimBranch < boxGate &&
            claimBranch < cancelRefusal &&
            claimBranch < invalidRefusal
        );
        ok(
          'the claim flow answers its own cancel, and does not require the box',
          /input\.denied === 'access_denied' \? 'cancelled' : 'refused'/.test(
            withoutComments(readFileSync('lib/claim-callback.ts', 'utf8'))
          ) &&
            !/boxConfigured/.test(
              withoutComments(readFileSync('lib/claim-callback.ts', 'utf8'))
            )
        );

        /**
         * Every outcome the callback can redirect with is one the page can
         * say out loud.
         *
         * This failure has now happened twice in this codebase. The X list
         * banner reported a sixteen-minute job to a view the redirect had
         * already destroyed, and the first version of `/claim` ignored its
         * own return parameters entirely: somebody who had signed a message
         * and consented on x.com was shown the start form again, with nothing
         * saying whether anything was recorded.
         *
         * Derived rather than listed. The outcomes are read out of the
         * callback's own `back(...)` calls, so adding a ninth refusal there
         * fails this until the page learns to explain it, which is the whole
         * point: the list cannot drift because it is not a list.
         */
        const cbSrc = readFileSync('lib/claim-callback.ts', 'utf8');
        const outcomes = new Set(
          [...cbSrc.matchAll(/back\(\s*'([a-z_]+)'/g)].map((m) => m[1])
        );
        const panel = readFileSync('components/ClaimOutcome.tsx', 'utf8');
        const unexplained = [...outcomes].filter(
          (o) => !new RegExp(`\\b${o}:`).test(panel)
        );
        ok(
          `every claim outcome has something the page can say (unexplained: ${unexplained.join(', ') || 'none'})`,
          // The parser must find outcomes at all, or "nothing unexplained"
          // would pass by matching nothing.
          outcomes.size >= 5 && unexplained.length === 0
        );
        ok(
          'the page reads the outcome and clears it, so a refresh cannot replay one',
          /params\.get\('claim'\)/.test(panel) &&
            /params\.delete\('claim'\)/.test(panel) &&
            /params\.delete\('claim_id'\)/.test(panel)
        );

        /**
         * An owner attestation does not overwrite a handle we already serve.
         *
         * Fill-only is the decision, not a limitation: overwriting on a
         * signature alone would make "controls the private key" sufficient to
         * rewrite an identity in a product sold on not guessing, and drained
         * wallets with leaked keys are traded. The disagreement is recorded
         * and settles only once the handle we serve stops reaching anyone.
         *
         * Asserted as the refusal, because the tempting change is the one
         * that looks more respectful of the owner: a direct `social_graph`
         * UPDATE here reads as honouring their proof and is exactly what must
         * not happen. The first version of the page PROMISED that overwrite
         * while the code never did it, which is the same disagreement in the
         * other direction.
         */
        /**
         * Withdrawal exists, because the page promises it.
         *
         * Twice on the page and once in the consent text. A claim flow whose
         * withdrawal is not built is a promise the code does not keep, which
         * is the defect this file exists for, and the promise is the kind a
         * person relies on when deciding to attest at all.
         */
        const withdraw = withoutComments(
          readFileSync('app/api/claim/withdraw/route.ts', 'utf8')
        ).replace(/\s+/g, ' ');

        /**
         * And it is reachable, which is the half that makes it real.
         *
         * A finished route with no control is the shape this product already
         * carries three times over: `DELETE /api/history/[id]`, API key
         * rotation and `GET /api/developer/usage` are all built,
         * session-authorized and called by nothing. The page promises
         * withdrawal twice, so a route nobody can press would be most of the
         * way to a promise nothing keeps.
         */
        {
          const flow = withoutComments(
            readFileSync('components/ClaimFlow.tsx', 'utf8')
          );
          ok(
            'the page can actually reach the withdrawal',
            /'\/api\/claim\/withdraw'/.test(flow) &&
              // Through `switchMode`, which is the single door the mode
              // changes by: see the refusal further down that keeps it so.
              /switchMode\('withdraw'\)/.test(flow)
          );
          /**
           * And it withdraws with a wallet the person PICKED.
           *
           * The first version passed `providers[0]`, whichever extension
           * announced first, which is precisely what this file's own header
           * says is not a choice the person made. Somebody who attested with
           * a later-announced wallet could not withdraw that pairing at all.
           * The assertion pinned it, so the check would have defended the
           * bug: the same shape as the scope set that pinned a missing
           * `tweet.read`.
           */
          ok(
            'neither action picks a wallet by announcement order',
            !/providers\[0\]/.test(flow) &&
              /run\(p\.provider, mode\)/.test(flow)
          );

          /**
           * And neither is offered before we know there is a session.
           *
           * Both routes require one and the challenge answers 401 without
           * it, correctly, but that refusal used to arrive AFTER the wallet
           * prompt: somebody signed out pressed their wallet, approved a
           * connection, and only then learned an account was required. A
           * connection approval is a real thing to ask of a person, and this
           * page spent one to deliver a fact it already held.
           *
           * Asserted as the ordering, because the defect is an ordering: the
           * signed-out branch has to come before anything that offers a
           * wallet. The withdraw switch is checked separately since it sits
           * outside that chain and was the half that stayed reachable.
           */
          /**
           * And signing in from here comes back here.
           *
           * Sign-in is a magic link, so it always leaves the page and
           * `/api/auth/verify` decides where the person lands. Without a
           * return path that is the home page, which abandons the claim they
           * were part-way through. The first version of this card shipped
           * with a comment claiming the session refreshed in place and the
           * buttons simply replaced it, which was never true of a mailbox
           * round trip.
           *
           * Both halves, because the allowlist entry is useless if the value
           * never leaves the browser: the card has to ASK for the return
           * path, and the modal has to SEND it.
           */
          /**
           * The page's money sentence names the gate that exists.
           *
           * It used to say the grant was paid when a claim "adds something we
           * did not already hold", and nothing anywhere implemented that:
           * `ingestLinks`' result is discarded and `maybeGrant` reads
           * `walletPredatesCutoff`. So somebody confirming a handle we
           * already held correctly, on a pre-cutoff wallet, was paid while
           * the page told them it earned nothing. A false sentence about
           * money, next to a true one two paragraphs above saying that
           * confirming DOES add the account id.
           *
           * Asserted against the page as rendered, with the cutoff read
           * through the shared constant so the date cannot be written twice.
           *
           * The outcome banner is checked with it, because the invented
           * condition had THREE homes and fixing the two on the page would
           * have left the one a person reads last, after the trip to X, at
           * the moment they are actually wondering whether they were paid.
           * The phrase is matched wherever it appears rather than per file,
           * so a fourth copy cannot arrive quietly.
           */
          for (const copyFile of [
            'app/claim/page.tsx',
            'components/ClaimOutcome.tsx',
          ]) {
            ok(
              `${copyFile} does not describe a grant condition nothing implements`,
              !/add(s|ed) something/.test(
                withoutComments(readFileSync(copyFile, 'utf8'))
              )
            );
          }
          ok(
            'the page states the grant condition that the code actually applies',
            /ATTESTATION_CUTOFF_HUMAN/.test(
              withoutComments(readFileSync('app/claim/page.tsx', 'utf8'))
            )
          );

          /**
           * The control is above the explanation, and the explanation is
           * still on the page.
           *
           * The first version put three sections and about six hundred words
           * before the claim card, so the one thing the page exists for sat
           * below the fold. Both halves are asserted because either alone is
           * the wrong page: moving the card up and deleting the disclosures
           * would pass a layout check while removing what a person agreed to,
           * and keeping the disclosures above it is what was wrong to begin
           * with.
           *
           * The two facts that change a decision stay ABOVE the control
           * rather than behind a click: that the index is sold, and that we
           * take no access to the account. Hiding those two would be choosing
           * exactly the wrong pair to hide.
           */
          {
            const page = withoutComments(
              readFileSync('app/claim/page.tsx', 'utf8')
            );
            ok(
              'the claim control sits above the explanation',
              /**
               * BOTH operands checked for presence, not just one.
               *
               * The first version tested `indexOf('<Detail') > -1`, which is
               * the operand the comparison already rejects: `<Detail>` has to
               * exist for a real index to compare against. The one that can
               * go missing is the control, and with it absent `indexOf`
               * answers -1, which precedes every real index, so deleting the
               * claim card outright passed a check named for keeping it
               * first. The existence test landed on the safe operand, one
               * assertion above the comment describing that exact trap.
               */
              page.includes('<ClaimFlow') &&
                page.includes('<Detail') &&
                page.indexOf('<ClaimFlow') < page.indexOf('<Detail')
            );
            ok(
              'and the explanation is still on this page, not moved off it',
              // Four disclosures, on the same URL. A link to a separate FAQ
              // would satisfy a layout check and weaken the disclosure.
              (page.match(/<Detail question=/g) ?? []).length >= 4
            );
            ok(
              'the two facts that change a decision are above the control',
              /**
               * Present AND before, in that order, because `indexOf` answers
               * -1 for absent and -1 is less than every real index. Written
               * without the existence test this passed while the sentence was
               * deleted, which is the same defect this file already records
               * three times over and which I reintroduced here by hand.
               */
              page.includes('no access to your X account') &&
                page.includes('an index we sell') &&
                page.indexOf('no access to your X account') <
                  page.indexOf('<ClaimFlow') &&
                page.indexOf('an index we sell') < page.indexOf('<ClaimFlow')
            );
          }

          /**
           * The once-per-account limit counts PAID claims, not claims.
           *
           * The partial unique index is on `x_user_id_hmac` WHERE
           * `grant_claimed_at IS NOT NULL`, so a row that never earned
           * anything does not occupy the slot. Somebody whose first claim was
           * a post-cutoff address earned nothing and is still owed the grant
           * on a qualifying one later.
           *
           * The banner said "this was the first claim for your X account",
           * which is a different rule and wrong in the direction that tells
           * somebody they were not paid when they were. Asserted as the
           * refusal of that phrasing plus the presence of the real one,
           * across both surfaces that state it, because the flow line had it
           * right while the banner did not and nothing compared them.
           */
          for (const copyFile of [
            'components/ClaimFlow.tsx',
            'components/ClaimOutcome.tsx',
          ]) {
            const copy = withoutComments(readFileSync(copyFile, 'utf8'));
            ok(
              `${copyFile} counts paid claims rather than claims`,
              /been paid/.test(copy) && !/first claim/.test(copy)
            );
          }

          /**
           * And the per-address answer reaches the person.
           *
           * The challenge route computes `earns_credits` and `grant_matches`
           * and says in its own comment that it does so before anyone signs.
           * Both fields arrived and nothing read them, so the rule was stated
           * on the page while the answer for the address in hand was thrown
           * away. The rule alone cannot tell anybody which side they are on.
           */
          ok(
            'the flow reads the eligibility the challenge already answered',
            /challenge\.earns_credits/.test(flow) &&
              /challenge\.grant_matches/.test(flow)
          );

          /**
           * …and reports it as eligibility rather than as payment.
           *
           * `earns_credits` is `walletPredatesCutoff` and nothing else, while
           * `maybeGrant` can still refuse on the per-account unique index or
           * on the budget. The first version of that line said the claim
           * "credits N matches once it completes", so a second pre-cutoff
           * address claimed with an X account that had already been paid was
           * promised money and then not paid. A false statement about a
           * grant, written inside the change whose whole subject was a false
           * statement about a grant.
           *
           * Both halves: it must not read as a completion promise, and the
           * condition the response cannot see has to be named rather than
           * left out.
           */
          ok(
            'the worth line promises eligibility, not payment',
            /qualifies for \$\{challenge\.grant_matches\}/.test(flow) &&
              /per X account/.test(flow) &&
              !/credits \$\{challenge\.grant_matches\} matches once it completes/.test(
                flow
              )
          );

          /**
           * And it does not survive the action it belongs to.
           *
           * `worth` was cleared at the start of `run` and nowhere else, so a
           * cancelled claim left its credit sentence on screen and switching
           * to withdraw put it directly above a flow that pays nothing. The
           * comment on the setter already forbade that; there was simply a
           * second path to the same screen that never asked.
           *
           * Asserted as the refusal, because the fix is a single door: no
           * `setMode` outside `switchMode`, so a later control cannot change
           * the mode without carrying what goes with it.
           */
          ok(
            'nothing changes the mode without clearing what belonged to it',
            /const switchMode = useCallback/.test(flow) &&
              /switchMode\('withdraw'\)/.test(flow) &&
              /switchMode\('claim'\)/.test(flow) &&
              !/onClick=\{\(\) => setMode\(/.test(flow)
          );

          /**
           * The page can say what it already holds.
           *
           * Until this existed, `/claim` had three routes (challenge, start,
           * withdraw) and none of them could answer "have I claimed". So it
           * showed an identical card to somebody who had claimed an hour
           * earlier and somebody who never had, while promising "control of
           * your own row" and telling them to withdraw "with the same
           * wallet" without naming which. The only confirmation that ever
           * appeared was a banner whose URL parameter `ClaimOutcome` strips
           * as it reads, so one reload erased it while the row sat in the
           * database saying `completed`.
           *
           * Three halves, because each alone leaves the promise unkept: the
           * route exists, the flow reads it, and a withdrawal refetches so
           * the panel cannot keep showing a pairing that was just removed.
           */
          const mineRoute = withoutComments(
            readFileSync('app/api/claim/mine/route.ts', 'utf8')
          ).replace(/\s+/g, ' ');
          ok(
            'the page can read back what it holds for this account',
            /'\/api\/claim\/mine'/.test(flow) &&
              /export async function GET/.test(mineRoute)
          );
          ok(
            'and a withdrawal drops the removed pair before it says it did',
            // Locally first, so the panel agrees with the sentence at the
            // moment the sentence appears and owes nothing to a second
            // request that can fail. Ordering asserted, because announcing
            // first is exactly what put the removed address on screen beside
            // the word "Withdrawn".
            /setHeld\(\(current\) =>/.test(flow) &&
              // Fired, never awaited. Awaiting it put a GET on the success
              // path, so a hung `/api/claim/mine` held the card on "Checking
              // the signature…" for a withdrawal that had already succeeded.
              // The local drop above is what makes the panel correct; this
              // only reconciles whatever else moved.
              /void loadHeld\(\)/.test(flow) &&
              !/await loadHeld\(\)/.test(flow) &&
              // Against the withdrawal's OWN sentence, not a bare `setDone(`:
              // the first of those in this file is the `setDone(null)` reset
              // at the top of `run`, which precedes everything and made this
              // comparison pass while proving nothing.
              flow.indexOf('setHeld((current) =>') <
                flow.indexOf('Withdrawn. The pair is out of the index')
          );
          ok(
            'a failed read of the panel keeps what it had rather than emptying it',
            // Setting null on a refetch failure hid every remaining claim, so
            // withdrawing one address could make the others disappear.
            !/setHeld\(null\)/.test(flow)
          );
          ok(
            'the panel lists one row per address, not one per claim',
            // `start` inserts unconditionally and nothing unique-constrains a
            // completed pair, so a corrected claim leaves the old row
            // standing. Serving both counts one address as two and names a
            // pairing that has been superseded.
            /DISTINCT ON \(wallet\)/.test(mineRoute)
          );

          /**
           * It reports completed pairings and nothing else.
           *
           * `awaiting_x` is a claim in flight, so naming it would report a
           * pairing that does not exist yet, and `withdrawn` is the case
           * whose whole point is that the answer became nothing. Asserted as
           * the refusal, because the wrong filter here publishes a pairing
           * somebody asked us to stop holding, back to them, as though we
           * still did.
           */
          ok(
            'the claims it reports are the completed ones only',
            /status = 'completed'/.test(mineRoute) &&
              !/awaiting_x/.test(mineRoute) &&
              !/'withdrawn'/.test(mineRoute)
          );

          /**
           * Scoped by the session, never by a parameter, and carrying no
           * credential.
           *
           * A user id taken from the request would let anybody enumerate
           * which wallets belong to which account, which is the pairing this
           * product sells. And the panel needs no signature, verifier or
           * nonce, so returning one would be putting a credential somewhere
           * it has no reason to be: the same argument the callback makes for
           * keeping no access token.
           */
          ok(
            'it reads the session for the account and returns no credential',
            /user_id = \$\{session\.user\.id\}/.test(mineRoute) &&
              !/searchParams/.test(mineRoute) &&
              !/signature/.test(mineRoute) &&
              !/code_verifier/.test(mineRoute) &&
              !/state_nonce/.test(mineRoute)
          );

          ok(
            'signing in from the claim card returns to the claim page',
            /next="\/claim"/.test(flow) &&
              /origin: originTag\(\), next/.test(
                withoutComments(
                  readFileSync('components/AuthModal.tsx', 'utf8')
                )
              )
          );

          ok(
            'no wallet is offered before the session is known',
            flow.indexOf('!user ?') < flow.indexOf('providers === null ?') &&
              flow.indexOf('!user ?') > -1 &&
              // The switch is its own element, so its own gate.
              /\{user && providers !== null/.test(flow)
          );
        }

        /**
         * An abandoned claim does not keep a signature for ever.
         *
         * The same problem `cleanupAbandonedListJobs` was written for, one
         * flow over: a row born `awaiting_x` holds the wallet signature, the
         * PKCE verifier and the state nonce, and only a completed callback or
         * a withdrawal clears them. Somebody who closes the consent tab
         * reaches neither.
         *
         * Both halves asserted, because the sweep existing and the sweep
         * RUNNING are different facts and this repo has shipped the first
         * without the second: `lib/auth.ts` carried three cleanup functions
         * that nothing called, which is why the cleanup cron exists at all.
         */
        ok(
          'an abandoned claim is swept, and the sweep is actually called',
          /export async function cleanupAbandonedClaims/.test(cb) &&
            /signature = NULL/.test(cb) &&
            /code_verifier = NULL/.test(cb) &&
            /await cleanupAbandonedClaims\(\)/.test(
              withoutComments(
                readFileSync('app/api/cron/cleanup/route.ts', 'utf8')
              )
            )
        );

        ok(
          'a withdrawal suppresses BEFORE it erases',
          // The triggers stop a suppressed identifier landing again, so
          // erasing first leaves a window where the next ingest writes the
          // pair straight back. Withdrawing is precisely a request that this
          // stops happening.
          withdraw.indexOf('insertSuppressions(') > 0 &&
            withdraw.indexOf('insertSuppressions(') <
              withdraw.indexOf('eraseIdentifier(')
        );
        ok(
          'a withdrawal uses the signature lane, which was reserved for exactly this',
          /'wallet_sig'/.test(withdraw)
        );
        ok(
          'a withdrawal suppresses the wallet and NOT the handle',
          // Suppressing the handle would remove that account from every other
          // wallet's record. The person is withdrawing one pairing, not
          // asking to be erased from the index.
          /\[\{ kind: 'wallet', identifier: wallet \}\]/.test(withdraw) &&
            !/kind: 'twitter'/.test(withdraw)
        );
        /**
         * A withdrawal covers every row for that wallet, and the callback
         * cannot undo it afterwards.
         *
         * `start` inserts unconditionally and nothing unique-constrains a
         * completed pair, so a wallet can carry several rows. Withdrawing the
         * most recent left the earlier ones holding the handle, the account
         * id and the signature, which is the opposite of what withdrawing
         * means.
         *
         * The second half is the one with a moving part: a claim opened
         * BEFORE the withdrawal could still arrive at the callback after it
         * and re-complete the pairing. The triggers would refuse the graph
         * write, so the index would stay clean while the row said `completed`
         * and the page said the address was claimed. The gap between what we
         * tell somebody and what we did is the thing being closed.
         */
        /**
         * The clearing itself lives in `withdrawClaimRecords`, the last step
         * of the erase, since 2026-09-25: an emailed removal left the claim
         * record naming the pair because only this route cleared it. Read
         * there, and reached from here through `eraseIdentifier`.
         */
        const adminFlat = withoutComments(
          readFileSync('lib/removal-admin.ts', 'utf8')
        ).replace(/\s+/g, ' ');
        const claimFnAt = adminFlat.indexOf(
          'async function withdrawClaimRecords('
        );
        const claimFn =
          claimFnAt === -1
            ? ''
            : adminFlat.slice(
                claimFnAt,
                adminFlat.indexOf('const RESULT_MATCH_KEY', claimFnAt)
              );
        ok(
          'a withdrawal covers every row for that wallet, not just the newest',
          claimFn.includes('? sql`t.wallet = ${identifier}`') &&
            claimFn.includes("AND t.status IN ('completed', 'awaiting_x')") &&
            !/LIMIT/.test(claimFn) &&
            /await eraseIdentifier\(db, 'wallet', wallet\)/.test(withdraw)
        );
        {
          // The CALL SITE, not the identifier: `X_TOKEN_URL` appears in the
          // import first, so anchoring on the bare name compares against the
          // top of the file and the position means nothing. That mistake was
          // made twice in this file already and both times it failed loudly,
          // which is the only reason it is not in the code.
          const suppressCheck = cb.indexOf("isSuppressed('wallet'");
          const exchange = cb.indexOf('fetch(X_TOKEN_URL');
          ok(
            'a claim opened before a withdrawal cannot complete after it',
            // Before the token exchange, so a withdrawn claim costs no round
            // trip to X and mints no credential for a flow that cannot
            // finish.
            suppressCheck > 0 && exchange > 0 && suppressCheck < exchange
          );
        }

        ok(
          'a withdrawal clears the identity but keeps the grant key',
          // The HMAC outliving the identity is what stops the grant being
          // farmed by claiming and withdrawing in a loop, and it is the
          // reason the column is an HMAC rather than the id.
          /x_handle = NULL/.test(claimFn) &&
            /signature = NULL/.test(claimFn) &&
            !/x_user_id_hmac = NULL/.test(claimFn)
        );

        ok(
          'a claim writes through the shared ingest and never straight into the graph',
          /await ingestLinks\(/.test(cb) &&
            !/UPDATE social_graph/.test(cb) &&
            !/upsertManualSocialGraph/.test(cb)
        );
        ok(
          'a failure after the claim is recorded cannot 500 the OAuth return',
          // The person has finished authorizing; a throw here would turn that
          // into an error page for work they cannot retry from.
          /catch \(error\) \{ console\.error\('claim ingest failed after completion:'/.test(
            cb
          ) &&
            /catch \(error\) \{ console\.error\('claim grant path failed after completion:'/.test(
              cb
            )
        );
        ok(
          'a failed grant releases its reservation rather than locking the account out',
          // The reservation is what the once-ever index keys on, so leaving it
          // set after a failed insert marks an account permanently paid for
          // credits it never received.
          /releasing the reservation/.test(cb) &&
            /SET grant_claimed_at = NULL, granted_matches = NULL/.test(cb)
        );

        ok(
          'the claim callback never stores the access token',
          !/access_token\s*=/.test(cb) &&
            !/seal\(/.test(cb) &&
            !/access_token/.test(
              withoutComments(
                readFileSync('scripts/migrate-identity-attestations.ts', 'utf8')
              )
            )
        );
        ok(
          'and it clears the nonce in the same statement that records the account',
          /state_nonce = NULL/.test(cb) &&
            /code_verifier = NULL/.test(cb) &&
            /AND status = 'awaiting_x'/.test(cb)
        );
      }

      ok(
        'the claim surface has its own rate-limit bucket',
        /'\/api\/claim': \{ limit: \d+, windowHours: \d+ \}/.test(
          withoutComments(readFileSync('lib/ip-rate-limiter.ts', 'utf8'))
        ) &&
          /checkIpRateLimit\(getClientIp\(request\), '\/api\/claim'\)/.test(
            route
          )
      );
    }

    ok(
      'an unreadable eligibility check refuses rather than answering false',
      // The throw is the refusal. Answering false on a failed read would deny
      // a grant somebody earned, silently, on the one path where the person
      // is watching.
      /throw new Error\('Claim eligibility unavailable/.test(attestationSrc)
    );
  }

  // --------------------------------------------- the zero-cost gate's edge
  // Free endpoints answer a drained key, and metered ones refuse it. Both
  // halves live in one character of lib/api-auth.ts: `credits > 0` gates the
  // refusal on a positive declared cost. A regression to `>= 0` silently
  // re-refuses the free endpoints and re-falsifies ZERO_BALANCE_SENTENCE and
  // four docs pages; deleting the balance clause opens every metered endpoint
  // to a zero-balance key. Asserted on the exact condition, so either edit
  // fails here; the guard reintroduces both.
  {
    const auth = withoutComments(readFileSync('lib/api-auth.ts', 'utf8'));
    ok(
      'the balance refusal is gated on a positive declared cost, exactly',
      /if \(credits > 0 && balance\.available <= 0\) \{/.test(auth)
    );
    ok(
      'and the refusal it gates is still the 402',
      /if \(credits > 0 && balance\.available <= 0\) \{[\s\S]{0,900}?NO_CREDITS/.test(
        auth
      )
    );
  }

  // ------------------------------------------------- reissue requires proof
  // The recovery POST's revoke_others_and_reissue path revokes every active
  // key an account holds. The claim is that only current wallet control can
  // order it: the reissue must sit behind BOTH the signature refusal and the
  // spent-challenge refusal, and the wholesale revoke must be scoped to the
  // proven owner and spare OAuth grant rows. Asserted on the source in call
  // order, so deleting either refusal (turning it into `if (false)`) removes
  // the call text these look for and fails here. The guard reintroduces each
  // of those deletions.
  {
    const route = withoutComments(
      readFileSync('app/api/x402/recover/route.ts', 'utf8')
    );
    const post = route.slice(route.indexOf('export async function POST'));
    const proofAt = post.indexOf('if (!proof.ok)');
    const spendAt = post.indexOf('await consumeChallenge(');
    const reissueAt = post.indexOf('revokeAllAndReissueKey(');

    ok(
      'the wholesale reissue sits after the signature refusal',
      proofAt !== -1 && reissueAt > proofAt
    );
    ok(
      'the wholesale reissue sits after the challenge is spent',
      spendAt !== -1 && reissueAt > spendAt
    );
    // The refusal carries its remedy: the challenge is spent by the time the
    // cap refuses, so the message must send the caller to a FRESH challenge
    // with the flag, or they retry the dead one into CHALLENGE_SPENT.
    ok(
      'the key-cap refusal names revoke_others_and_reissue as the way out',
      /fresh challenge[\s\S]{0,120}revoke_others_and_reissue[\s\S]{0,200}KEY_CAP_REACHED/.test(
        post
      )
    );

    const keys = withoutComments(readFileSync('lib/api-keys.ts', 'utf8'));
    const from = keys.indexOf('export async function revokeAllAndReissueKey');
    const next = keys.indexOf('\nexport ', from + 1);
    const fn = keys.slice(from, next === -1 ? undefined : next);
    const flat = fn.replace(/\s+/g, ' ');

    // The exact clause, whole: dropping the owner scope revokes strangers'
    // keys on a signature over your own wallet, and dropping the grant filter
    // kills a person's connected client as a side effect. Either edit breaks
    // this string.
    ok(
      'the wholesale revoke is scoped to the proven owner and spares grant rows',
      flat.includes(
        'WHERE user_id = ${userId} AND is_active = true AND revoked_at IS NULL AND oauth_grant_id IS NULL'
      )
    );
    // One statement, so a failure between revoke and mint cannot leave an
    // account with zero keys: the two travel in one data-modifying CTE.
    ok(
      'the wholesale revoke and the mint are one atomic statement',
      fn.split('db.execute').length - 1 === 1 &&
        flat.includes('UPDATE api_keys') &&
        flat.includes('INSERT INTO api_keys')
    );
  }

  // ------------------------------------------------------------ backup lists
  // migrate-grant-readonly.ts says these "must agree" and nothing checked it.
  {
    const grants = readFileSync('scripts/migrate-grant-readonly.ts', 'utf8');
    const backup = readFileSync('.github/workflows/db-backup.yml', 'utf8');
    const declared = [
      ...(
        grants.match(/const BACKUP_TABLES = \[([\s\S]*?)\]/)?.[1] ?? ''
      ).matchAll(/'([a-z0-9_]+)'/g),
    ]
      .map((m) => m[1])
      .sort();
    const dumped = [...backup.matchAll(/-t public\.([a-z0-9_]+)/g)]
      .map((m) => m[1])
      .sort();
    ok(
      `BACKUP_TABLES and the pg_dump list name the same tables (${declared.length} vs ${dumped.length})`,
      declared.length > 0 && JSON.stringify(declared) === JSON.stringify(dumped)
    );
  }

  // ------------------------------------------------- the one recoverable secret
  /**
   * `lib/secret-box.ts` is the first thing in this repository that stores a
   * secret it can read back, so it is the first place where "the database
   * leaked" and "the credential leaked" are different sentences. These run the
   * real functions rather than reasoning about the source, because the claim
   * being made is about what AES-GCM does, and a regex cannot check that.
   *
   * The control comes first on purpose. Every assertion below says something
   * does NOT open, and each of them passes trivially if `seal` is broken and
   * everything returns null. Without a round trip proving the box works, this
   * whole block would be a guard verified only against a dead module.
   */
  {
    const box = await import('@/lib/secret-box');
    const previousKey = process.env.SECRET_BOX_KEY;
    // A real 32-byte key, not a passphrase, since the module refuses anything
    // that is not exactly 32 bytes.
    process.env.SECRET_BOX_KEY = Buffer.alloc(32, 7).toString('base64');

    const secret = 'wts_x_refresh_token_value';
    const sealed = box.seal(secret);

    ok(
      'the control: a sealed secret opens back to itself',
      sealed !== null && box.open(sealed) === secret
    );
    ok(
      'and the sealed form is not the plaintext',
      sealed !== null && !sealed.includes(secret)
    );

    /**
     * A fresh IV per call. GCM catastrophically loses confidentiality when an
     * IV repeats under one key, and the failure is silent: the ciphertexts
     * simply are what they are, and nothing in a test that only round-trips
     * would notice. Two seals of the same plaintext must differ.
     */
    ok(
      'sealing the same secret twice never produces the same ciphertext',
      sealed !== null && box.seal(secret) !== sealed
    );

    /**
     * The authentication half, which is the reason for GCM over CBC. An
     * attacker who can write to the column must not be able to substitute a
     * token we would then send to the provider as if it were the user's.
     */
    const parts = sealed!.split('.');
    const flip = (s: string) => {
      const b = Buffer.from(s, 'base64url');
      b[0] ^= 0xff;
      return b.toString('base64url');
    };
    ok(
      'a tampered ciphertext does not open',
      box.open([parts[0], parts[1], parts[2], flip(parts[3])].join('.')) ===
        null
    );
    ok(
      'a tampered authentication tag does not open',
      box.open([parts[0], parts[1], flip(parts[2]), parts[3]].join('.')) ===
        null
    );
    ok(
      'a tampered IV does not open',
      box.open([parts[0], flip(parts[1]), parts[2], parts[3]].join('.')) ===
        null
    );
    ok(
      'an unknown version is refused rather than parsed as the current one',
      box.open(['v2', parts[1], parts[2], parts[3]].join('.')) === null
    );
    ok(
      'a malformed value does not open',
      box.open('not-sealed-at-all') === null && box.open('') === null
    );

    /** A different key must not open it, which is what rotation rests on. */
    process.env.SECRET_BOX_KEY = Buffer.alloc(32, 9).toString('base64');
    ok('another key does not open it', box.open(sealed) === null);

    /**
     * The refusal that matters most operationally. With no key configured,
     * `seal` must return null so a caller cannot mistake a thrown error for
     * "encryption is off" and write the plaintext token into the column. A
     * silent plaintext write is the single worst outcome available here,
     * because nothing downstream looks wrong.
     */
    delete process.env.SECRET_BOX_KEY;
    ok(
      'with no key, sealing refuses rather than returning the plaintext',
      box.seal(secret) === null && box.isConfigured() === false
    );
    ok('with no key, opening refuses too', box.open(sealed) === null);

    /** A key of the wrong length is a misconfiguration, not a short key. */
    process.env.SECRET_BOX_KEY = Buffer.alloc(16, 7).toString('base64');
    ok(
      'a key of the wrong length is refused, not padded or truncated',
      box.isConfigured() === false && box.seal(secret) === null
    );

    /**
     * `looksSealed` is what the migration check and any future audit use to
     * ask "is this column ciphertext" without holding the key, so it must not
     * answer yes for plaintext that happens to contain dots.
     */
    ok(
      'looksSealed rejects plaintext, including dotted plaintext',
      !box.looksSealed('plain') &&
        !box.looksSealed('a.b.c.d') &&
        !box.looksSealed(null)
    );
    ok('looksSealed accepts a real sealed value', box.looksSealed(sealed));

    /** The length guard in front of timingSafeEqual, which throws without it. */
    ok(
      'secretEquals returns false on a length mismatch instead of throwing',
      box.secretEquals('abc', 'abcd') === false &&
        box.secretEquals('abc', 'abc') === true &&
        box.secretEquals('abc', 'abd') === false
    );

    if (previousKey === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = previousKey;
  }

  // ------------------------------------------- the X list builder's five ways to lose
  /**
   * Every one of these was a real defect in the first version of this worker,
   * found in review before it shipped. They are asserted rather than fixed and
   * forgotten because four of the five fail silently: the symptom is a list
   * that is short, or duplicated, or a token that outlives its job, and none
   * of those raise anything.
   */
  {
    const worker = withoutComments(
      readFileSync('lib/x-list-worker.ts', 'utf8')
    );
    const flatWorker = worker.replace(/\s+/g, ' ');

    /**
     * The claim is an UPDATE, never a SELECT.
     *
     * Reading a candidate row and advancing its cursor at the end of the tick
     * is a race with the next minute's invocation: Vercel can start it while
     * this one is in flight, both read the same offset, both add a batch, and
     * the members between the two offsets are never attempted.
     */
    ok(
      'the X list worker claims a job by UPDATE with a lease, not a bare SELECT',
      /UPDATE x_list_jobs SET status = 'running'/.test(flatWorker) &&
        /FOR UPDATE SKIP LOCKED/.test(flatWorker) &&
        /leased_until = now\(\) \+ make_interval/.test(flatWorker)
    );

    /**
     * A transient failure must not advance the cursor.
     *
     * The cursor is added + skipped + failed, so counting a timeout as
     * `failed` steps permanently past that person: one blip and they are
     * silently not in the list, indistinguishable from somebody whose account
     * genuinely could not be added.
     */
    ok(
      'a 5xx or a thrown error breaks the batch instead of counting the member',
      // BOTH branches, counted. There are two ways a member add fails without
      // being a verdict about that member, the response and the throw, and an
      // assertion satisfied by either one passes while the other silently
      // steps over somebody.
      (flatWorker.match(/transient = true; break;/g) ?? []).length === 2 &&
        /res\.status >= 500/.test(flatWorker)
    );
    ok(
      'and a job that only ever fails transiently still gives up',
      // The DECLARATION, not the identifier: the first version tested only
      // that the name appeared somewhere, which a rename of the constant
      // leaves true at every use site while the bound itself is gone.
      /const MAX_TRANSIENT_FAILURES = \d+;/.test(worker) &&
        /if \(nextTransient >= MAX_TRANSIENT_FAILURES\)/.test(flatWorker) &&
        /transient_failures = \$\{nextTransient\}/.test(flatWorker)
    );

    /**
     * One member X will not accept must not cost the list everyone behind it.
     *
     * Measured on a live job on 2026-09-20. A list of 290 stopped at 103 and
     * sat there: the cursor is added + skipped + failed, a transient failure
     * deliberately leaves it in place, and member 103 was an account X
     * refused every time. Every tick retried the same account and achieved
     * nothing, and the job was fifteen minutes from `failed` with 187 members
     * never attempted.
     *
     * The step-over has to be POSITIONAL, which is the whole content of the
     * fix. A bare counter cannot tell "failed three times at member 103" from
     * "failed once each at 103, 104 and 105", and only the first is evidence
     * about a member rather than about X.
     */
    ok(
      'an unaddable member is stepped over, and only after repeated attempts at the same position',
      /const MAX_MEMBER_ATTEMPTS = \d+;/.test(worker) &&
        // Positional: the attempt count only continues when the cursor this
        // tick stopped at is the one already under suspicion. Without the
        // stuck_cursor comparison this degrades to the bare counter that
        // cannot distinguish a bad member from a bad service.
        /const sameSpot = stalled && job\.stuck_cursor === cursorAfter;/.test(
          flatWorker
        ) &&
        /const attempts = stalled \? \(sameSpot \? job\.member_attempts \+ 1 : 1\) : 0;/.test(
          flatWorker
        ) &&
        /const stepOver = attempts >= MAX_MEMBER_ATTEMPTS;/.test(flatWorker) &&
        // And it actually advances the cursor, by counting that member failed.
        /failed_count = failed_count \+ \$\{failed\} \+ \$\{stepOver \? 1 : 0\}/.test(
          flatWorker
        )
    );

    /**
     * A step-over must NOT reset the job-level counter.
     *
     * This is the refusal that matters, and the happy path cannot see it. If
     * X is down rather than one member being unacceptable, every position
     * fails, and a step-over that cleared `transient_failures` would let the
     * job walk the entire list marking real people permanently unaddable,
     * one every MAX_MEMBER_ATTEMPTS ticks, for ever. Leaving the counter
     * running bounds the damage at MAX_TRANSIENT_FAILURES /
     * MAX_MEMBER_ATTEMPTS members before the job stops and says so.
     *
     * Asserted as the absence of a reset on the step-over branch, because the
     * defect is something being added, not something missing: any
     * `transient_failures = 0` or `nextTransient = 0` reachable from
     * `stepOver` reintroduces it.
     */
    ok(
      'stepping over a member does not clear the counter that catches an outage',
      /const nextTransient = transient && added === 0 \? job\.transient_failures \+ 1 : 0;/.test(
        flatWorker
      ) &&
        !/stepOver[^;]*transient_failures = 0/.test(flatWorker) &&
        !/if \(stepOver\) \{ nextTransient/.test(flatWorker) &&
        // The persisted value is the unmodified counter, not a reset one.
        /transient_failures = \$\{nextTransient\}/.test(flatWorker)
    );

    /**
     * Every path that leaves a job runnable releases the lease.
     *
     * The lease covers a tick in flight; it is not a pacing mechanism. A tick
     * that gives up after four seconds and leaves `leased_until` set hides the
     * row for the rest of five minutes, so the list stalls under exactly the
     * conditions where it should retry hardest: a timeout, a rate limit before
     * creation, an unreadable suppression list.
     *
     * Counted rather than merely present, because there are four such paths
     * and an assertion satisfied by one of them passes while three stall.
     */
    ok(
      'every runnable exit from a tick clears the lease',
      // Anchored on the CALL, not on the SQL string. The first version counted
      // occurrences of `leased_until = NULL`, which the helper's own body
      // keeps satisfying after every call site is deleted: it passed happily
      // with the suppression path leaving a job hidden for five minutes.
      /async function releaseLease/.test(worker) &&
        /Suppression read failed[\s\S]{0,120}await releaseLease\(job\.id\)/.test(
          worker
        ) &&
        (flatWorker.match(/leased_until = NULL/g) ?? []).length >= 4
    );

    /**
     * Progress resets the transient counter.
     *
     * The counter means consecutive ticks that achieved nothing. Incrementing
     * it whenever a tick merely ENDED on a transient failure kills a long list
     * that is adding steadily and meeting the occasional timeout, and reports
     * "too many transient failures" about a job whose every tick made
     * progress. The constant's own comment claimed this behaviour before the
     * code did it, which is the shape this file exists to refuse.
     */
    ok(
      'anything added clears the transient-failure counter',
      /transient && added === 0 \? job\.transient_failures \+ 1 : 0/.test(
        flatWorker
      )
    );

    /**
     * The cap cuts the priority tail, not an arbitrary subset.
     *
     * `WHERE handle = ANY(...)` returns rows in whatever order the plan
     * produces, and the cap takes the first N. Slicing that unordered set
     * drops people the results table showed at the top, which is the one thing
     * that would make truncating a list indefensible: the caller's array is
     * already sorted by the priority they were looking at.
     */
    {
      const listRoute = withoutComments(
        readFileSync('app/api/x/lists/route.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      ok(
        'the member list is rebuilt in the caller order before it is capped',
        /const byHandle = new Map\(/.test(listRoute) &&
          /handles \.filter\(\(h\) => byHandle\.has\(h\)\)/.test(listRoute) &&
          !/rows\.rows\.map\(\(r\) => \(\{ id: r\.user_id/.test(listRoute)
      );

      /**
       * Our own account goes in FIRST, and by id.
       *
       * First because a member added last is a member a stalled list never
       * reaches: measured on a live job that stopped at 103 of 290 on an
       * account X refused, and would have been marked failed with 187 never
       * attempted. Appending would have left us out of exactly the lists that
       * went wrong.
       *
       * By id because a handle is a string its owner can change, which is the
       * thing this codebase keeps rediscovering. Building the member from a
       * hardcoded handle would mean our own rename quietly adding a stranger
       * to every customer list.
       */
      ok(
        'the tool adds its own account first, by id, and never twice',
        // FILTERED then unconditionally prepended, which is not the same as
        // skipping the prepend when already present. Testing membership
        // against the full resolved list and truncating afterwards leaves an
        // account that is a holder but sits past the cap with neither the
        // prepend nor a place in the slice, so the list carries nobody.
        // Position must not decide whether we are in it.
        /const theirs = members\.filter\(\(m\) => m\.id !== WALLETLINK_X_USER_ID\)/.test(
          listRoute
        ) &&
          /const withUs = \[ \{ id: WALLETLINK_X_USER_ID, handle: WALLETLINK_X_HANDLE \}, \.\.\.theirs, \]/.test(
            listRoute
          ) &&
          // The prepend takes no condition at all. Asserted as the absence of
          // a ternary around it rather than of any boolean in the file: the
          // COUNTS below legitimately branch on whether we are also a holder,
          // and forbidding every flag here would block that correct fix.
          !/const withUs = \w+ \?/.test(listRoute) &&
          // Capped AFTER we are prepended, so a list can never exceed X's max
          // by carrying us on top of a full one.
          /const capped = withUs\.slice\(0, X_LIST_MEMBER_MAX\)/.test(listRoute)
      );

      /**
       * And the counts reported back stay the customer's.
       *
       * `capped` now holds a member the caller did not ask for. Reporting its
       * length as theirs makes `dropped` read -1 on any list under the cap,
       * which is the kind of number that survives review because it looks like
       * a rounding artefact rather than a miscount.
       */
      ok(
        'the counts returned to the caller exclude the member we added',
        // One subtraction, no branch. Ours is exactly one row at index 0 that
        // always survives the slice, so a conditional here could only ever be
        // wrong: the branch is what made `dropped` depend on whether we
        // happened to hold the token.
        // The three figures are read together and must account for every
        // submitted handle: members + dropped + unresolved = handles.length.
        // That only holds if `theirsIncluded` keeps our row when our account
        // is ALSO one of their holders, because then the customer submitted
        // that handle and subtracting it loses one of theirs. Without the
        // branch the sum is short by exactly one, and a confirmation screen
        // that accounts for every handle but one reads as a lookup bug.
        /const weAreAlsoAHolder = theirs\.length !== members\.length/.test(
          listRoute
        ) &&
          /const theirsIncluded = capped\.length - \(weAreAlsoAHolder \? 0 : 1\)/.test(
            listRoute
          ) &&
          /members: theirsIncluded/.test(listRoute) &&
          /dropped: members\.length - theirsIncluded/.test(listRoute) &&
          /unresolved: handles\.length - members\.length/.test(listRoute)
      );

      /**
       * No overflow-menu row owns a dialog.
       *
       * `OverflowMenu` renders its panel as `{open && ...}` and closes on any
       * click inside it: activating a row unmounts the row, as that file's own
       * comment says about focus. A `Modal` mounted by a menu item is therefore
       * destroyed in the same tick it is opened, and the symptom is a menu row
       * that does nothing whatsoever. Nothing throws, nothing logs, and the row
       * looks correctly wired at every line you would read.
       *
       * Asserted structurally: a component that renders a `MenuItem` must not
       * also render a `Modal`. The dialog goes on the page, which outlives the
       * menu.
       */
      for (const menuFile of [
        'components/XListAction.tsx',
        'components/ExportButton.tsx',
      ]) {
        // Per COMPONENT, not per file. Two components may sit in one file
        // precisely BECAUSE one is the row and the other is the dialog, which
        // is the fix rather than the defect; a file-level test calls that
        // arrangement a violation and would push the fix back out again.
        const parts = withoutComments(readFileSync(menuFile, 'utf8')).split(
          /\bexport function /
        );
        const offenders = parts
          .filter((c) => /<MenuItem[\s>]/.test(c) && /<Modal[\s>]/.test(c))
          .map((c) => c.slice(0, c.indexOf('(')).trim());
        ok(
          `${menuFile} mounts no dialog inside an overflow-menu row (${
            offenders.join(', ') || 'none'
          })`,
          offenders.length === 0
        );
      }
      /**
       * And the panel really does unmount on activation, which is what makes
       * the rule above necessary rather than stylistic.
       */
      const menuSrcFlat = withoutComments(
        readFileSync('components/ui/overflow-menu.tsx', 'utf8')
      ).replace(/\s+/g, ' ');
      ok(
        'the overflow menu still unmounts its panel and closes on a click inside it',
        /\{open && \( <div/.test(menuSrcFlat) &&
          /onClick=\{\(\) => \{ setOpen\(false\)/.test(menuSrcFlat)
      );

      /**
       * Both surfaces take the priority-ordered derivation, not the raw one.
       *
       * `reachableHandlesFrom` preserves its input's order deliberately, which
       * makes sorting the caller's job, and that is how the two callers came
       * to disagree even after the derivation was extracted to stop exactly
       * that: the export sorted first, the menu item passed the raw results,
       * and a list truncated at X's cap kept the first five thousand of an
       * unordered set while the confirmation told the customer they were the
       * highest priority. The sort is part of the derivation.
       */
      for (const caller of ['app/page.tsx', 'components/ExportButton.tsx']) {
        const src = withoutComments(readFileSync(caller, 'utf8'));
        ok(
          `${caller} takes the priority-ordered handle list, never the raw one`,
          /reachableHandlesInPriorityOrder\(/.test(src) &&
            !/reachableHandlesFrom\(/.test(src)
        );
      }

      /**
       * The priority score counts X reach, and both pipelines count it the
       * same way.
       *
       * X followers were missing from this for an ordering reason rather than
       * a decision: the score was computed mid-pipeline and `x_followers`
       * does not exist until `stampReachability` runs in finalize, so the
       * input was unavailable at the only moment anybody read it. A product
       * sold on X reach ranked on Farcaster reach alone.
       *
       * Asserted through the real function, and on the worker, which is the
       * only lookup pipeline since STA-44. There were two, and the second
       * stated the rule itself, so an API caller and a web caller could get
       * different scores for one wallet; that is now a structural refusal
       * (the one-pipeline block below) rather than a list of mirrored lines.
       */
      {
        const { calculatePriorityScore, PRIORITY_EXPLANATION } =
          await import('@/lib/csv-parser');
        ok(
          'X followers move the priority score',
          // The defect stated as a comparison: an X-only audience used to
          // score the same as no audience at all.
          calculatePriorityScore(10, 0, 10_000) >
            calculatePriorityScore(10, 0, 0) &&
            calculatePriorityScore(10, 0, 10_000) ===
              calculatePriorityScore(10, 10_000, 0)
        );
        ok(
          'reach is summed across the platforms, not maximised',
          // Both platforms beats either alone. `max` would discard the second
          // entirely, which is the other obvious shape and the wrong one.
          calculatePriorityScore(1, 10_000, 10_000) >
            calculatePriorityScore(1, 10_000, 0)
        );
        ok(
          'a row with no audience scores exactly what it always did',
          // The floor moved from one follower to zero so an absent Farcaster
          // account stops adding a phantom follower to an X account's reach.
          // The all-zero case keeps its old value, so nothing without an
          // audience moves.
          calculatePriorityScore(7, undefined, undefined) === 7 * Math.log10(2)
        );
        ok(
          'the published explanation names both platforms',
          // The sentence sits beside the arithmetic precisely so the two move
          // together; it named Farcaster alone while the code read both.
          /Farcaster and X/.test(PRIORITY_EXPLANATION)
        );

        {
          const worker = 'lib/job-processor.ts';
          const src = withoutComments(readFileSync(worker, 'utf8'));
          ok(
            `${worker} scores from X followers as well as Farcaster`,
            /x_followers\s*\n?\s*\)/.test(src)
          );
          ok(
            `${worker} stamps reachability before it scores`,
            // `x_followers` is produced by the stamp. Scoring first reads a
            // field that does not exist yet, which is exactly how X reach
            // came to be missing from this number.
            src.indexOf('stampReachability(') > -1 &&
              src.lastIndexOf('stampReachability(') <
                src.lastIndexOf('calculatePriorityScore(')
          );
        }
      }

      /**
       * And what was left out is shown before the consent screen.
       *
       * The route returned `dropped` and `unresolved` from the first version
       * and the only consumer ignored both, so a capped or partly-resolved
       * list was authorized as though it were the whole community. A value
       * computed and never read is the same defect as one never computed, and
       * it is harder to see.
       */
      const modal = withoutComments(
        readFileSync('components/XListAction.tsx', 'utf8')
      ).replace(/\s+/g, ' ');
      ok(
        'the modal reads the dropped and unresolved counts it is given',
        /json\.dropped/.test(modal) &&
          /json\.unresolved/.test(modal) &&
          /if \(dropped > 0 \|\| unresolved > 0\)/.test(modal)
      );
    }

    /**
     * The consent window is enforced where the row is READ.
     *
     * A TTL that lives only in a daily sweep is a claim the code does not
     * keep: the row sits for up to a day while the comment says thirty
     * minutes, and a confirmation tab left open overnight authorizes
     * successfully and then fails at X after the 04:00 pass cancels it
     * underneath. The callback is the authority; the sweep empties the
     * payload afterwards.
     */
    ok(
      'the callback refuses a consent request older than its stated window',
      /created_at > now\(\) - interval '30 minutes'/.test(
        withoutComments(readFileSync('app/api/x/callback/route.ts', 'utf8'))
      )
    );

    /**
     * Back cancels the row it already created.
     *
     * The confirmation exists because only the server knows how many handles
     * resolved, so the row is written before the person is asked whether to
     * go on. Without a cancel, Back left it behind and a second attempt made
     * another, and an unchecked handle counts as `unresolved`, so this is the
     * common path rather than the rare one.
     */
    {
      const statusRoute = withoutComments(
        readFileSync('app/api/x/lists/[id]/route.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      const modalSrc = withoutComments(
        readFileSync('components/XListAction.tsx', 'utf8')
      ).replace(/\s+/g, ' ');
      ok(
        'an unauthorized list job can be cancelled, and only by its owner',
        /export async function DELETE/.test(statusRoute) &&
          /AND user_id = \$\{session\.user\.id\} AND status = 'awaiting_auth'/.test(
            statusRoute
          )
      );
      ok(
        'and Back calls it rather than only forgetting the job',
        /method: 'DELETE'/.test(modalSrc) && /pending\.jobId/.test(modalSrc)
      );
    }

    /**
     * An abandoned consent screen does not keep its payload.
     *
     * A row is created `awaiting_auth` holding the member list, the PKCE
     * verifier and the state nonce, and only `finish()` clears them. Closing
     * the X tab never reaches `finish()`, so the one thing this design exists
     * for, not keeping material longer than the job needs it, quietly failed
     * in the abandoned case.
     */
    ok(
      'abandoned list jobs are purged of their members and verifier',
      /export async function cleanupAbandonedListJobs/.test(worker) &&
        /status = 'awaiting_auth'/.test(flatWorker) &&
        /cleanupAbandonedListJobs\(\)/.test(
          withoutComments(readFileSync('app/api/cron/cleanup/route.ts', 'utf8'))
        )
    );

    /**
     * A create whose reply was lost is adopted, not repeated. X has no
     * idempotency key here, so without this the customer collects duplicate
     * empty lists while members attach to whichever id was stored last.
     */
    ok(
      'the list create marks its attempt before calling X, and adopts on retry',
      /create_attempted_at = now\(\)/.test(flatWorker) &&
        /findOwnedListByName/.test(worker)
    );

    /**
     * Ending a job takes its credentials with it, on every path. Five ways to
     * finish and one statement, because a separate clear-the-token step is the
     * kind that gets added to four of them.
     */
    ok(
      'finishing a list job clears the token and the member list together',
      /SET status = \$\{status\}, error = \$\{error\}, access_token = NULL, members = '\[\]'::jsonb/.test(
        flatWorker
      )
    );
  }

  /**
   * x_list_jobs must NOT carry a suppression trigger, and this is the one
   * assertion here that refuses a fix rather than requiring one.
   *
   * `suppression_guard_skip` silently discards every later UPDATE to a guarded
   * row. On this table the most important UPDATE is the one that NULLs the
   * sealed X access token when the job ends, so a guard would preserve a
   * working third-party credential for exactly the person who asked to be
   * removed, and wedge their job in `running` while it did so. The removal
   * path is `eraseIdentifier`, which deletes the row outright.
   *
   * It reads as an obviously missing guard to anyone scanning the attachment
   * list, which is why it is written down as a refusal instead of a gap.
   */
  {
    const supp = withoutComments(
      readFileSync('scripts/migrate-suppression.ts', 'utf8')
    );
    const attachBlock =
      supp.match(
        /const ATTACHMENTS: Attachment\[\] = \[([\s\S]*?)\n\];/
      )?.[1] ?? '';
    ok(
      'x_list_jobs carries no suppression trigger, because one would preserve its token',
      attachBlock.length > 0 && !attachBlock.includes("'x_list_jobs'")
    );
    ok(
      'and the removal path deletes the row instead',
      /del\('x_list_jobs'/.test(
        withoutComments(readFileSync('lib/removal-admin.ts', 'utf8'))
      )
    );
  }

  // ------------------------------- an attested identity outranks an agent claim
  /**
   * `known_agents` is scraped from Virtuals' API, whose per-agent
   * `walletAddress` is frequently the CREATOR's wallet rather than an
   * autonomous one. Measured on 2026-09-19: of the 536 agent wallets that
   * resolve to an X handle, 492 carry an owner-attested identity that is not
   * the agent's own, and 168 graph rows had the label stored.
   *
   * Left alone the product prints a badge reading `HOWLR` beside a wallet
   * whose owner published `@thedojieth`: an inference presented over the top
   * of the strongest evidence the index holds, which is the one thing
   * CLAUDE.md says the attested treatment must never do.
   *
   * These run the real functions, because the claim is about what a row looks
   * like afterwards and every failure here is silent.
   */
  {
    const { agentClaimHolds, reconcileAgentClaim, hasAttestedIdentity } =
      await import('@/lib/agent-claim');

    /** The control: nothing attested, so the claim is the only evidence. */
    ok(
      'an agent claim stands when the owner published nothing to contradict it',
      agentClaimHolds({}, null) === true &&
        agentClaimHolds({ twitter_handle: 'someone' }, null) === true
    );

    /** The case this exists for. */
    ok(
      'an attested identity that is not the agent withdraws the claim',
      agentClaimHolds(
        { twitter_verified: true, twitter_handle: 'thedojieth' },
        'HowlrBot'
      ) === false &&
        agentClaimHolds(
          { farcaster_verified: true, farcaster: 'derek' },
          null
        ) === false
    );

    /**
     * And the case it must not break. An agent with a verified social presence
     * is a real thing: 31 of them are in the index, and a rule that took their
     * badge away would be the same error in the other direction.
     */
    ok(
      'an agent whose own account IS the attested one keeps its claim',
      agentClaimHolds(
        { twitter_verified: true, twitter_handle: 'AGGENT_ai' },
        'AGGENT_ai'
      ) === true &&
        agentClaimHolds(
          { twitter_verified: true, twitter_handle: '@aggent_ai' },
          'AGGENT_ai'
        ) === true
    );

    /**
     * An attestation that arrived on this lookup counts, even before any flag
     * is set for it.
     *
     * A live ENS resolve writes `twitter_handle` with source `ens` and never
     * touches `twitter_verified`, so a first lookup whose only attestation had
     * just arrived read as unattested, the catalog badge survived, and
     * `prepareUpsertData` then computed `twitterVerified` from that same
     * source and ORed `is_agent` into a graph that cannot take one back.
     *
     * Read through `isTwitterVerified`, the function the graph write itself
     * uses, so there is one list of attested sources rather than two that
     * drift.
     */
    ok(
      'a source the graph calls attested is attested here too',
      hasAttestedIdentity({ source: ['ens'], twitter_handle: 'someone' }) ===
        true &&
        hasAttestedIdentity({
          source: ['ens_onchain'],
          twitter_handle: 'someone',
        }) === true &&
        hasAttestedIdentity({
          source: ['graph'],
          twitter_handle: 'someone',
        }) === false &&
        hasAttestedIdentity({ source: [] }) === false
    );
    /**
     * And the source needs a handle to attest.
     *
     * `ens` is stamped on every name resolve, including one that found a name
     * and no `com.twitter` record, so reading the source alone made a wallet
     * whose owner published nothing social look attested and withdrew the
     * catalog claim from any agent that merely owns an ENS name.
     */
    ok(
      'an attested source with no handle attests nothing',
      hasAttestedIdentity({ source: ['ens'] }) === false &&
        hasAttestedIdentity({ source: ['ens_onchain'] }) === false &&
        agentClaimHolds({ source: ['ens'] }, null) === true
    );
    ok(
      'and a catalog claim is withdrawn on the strength of that source alone',
      agentClaimHolds(
        { twitter_handle: 'thedojieth', source: ['ens'] },
        'HowlrBot'
      ) === false
    );

    /**
     * `=== true`, not truthiness. `undefined` means "not known on this path",
     * and reading it as unattested would strip a claim on evidence nobody
     * looked for.
     */
    ok(
      'an unchecked row is not treated as attested',
      hasAttestedIdentity({}) === false &&
        hasAttestedIdentity({ twitter_verified: undefined }) === false &&
        hasAttestedIdentity({ twitter_verified: false }) === false
    );

    /** The claim is withdrawn, not denied: absent is not false. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = {
      wallet: '0x1',
      is_agent: true,
      agent_name: 'Prime Data AI',
      agent_verified: true,
      twitter_verified: true,
      twitter_handle: 'cryptoacv',
      source: ['graph'],
    };
    const withdrawn = reconcileAgentClaim(row, null);
    ok(
      'withdrawing a claim removes the agent fields rather than setting them false',
      withdrawn === true &&
        !('is_agent' in row) &&
        !('agent_name' in row) &&
        !('agent_verified' in row) &&
        row.twitter_handle === 'cryptoacv'
    );
  }

  /**
   * And it runs where the question can be asked.
   *
   * STEP 0 reads `known_agents` before the social graph, so nothing there
   * knows what the owner published yet. A reconciliation placed alongside the
   * detection would compare against fields that are still empty and withdraw
   * nothing, which looks exactly like a rule that is working.
   */
  {
    const jpAgent = withoutComments(
      readFileSync('lib/job-processor.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const detectIdx = jpAgent.indexOf('await detectKnownAgents(activeWallets)');
    const graphIdx = jpAgent.indexOf(
      'getSocialGraphWithQuality(activeWallets)'
    );
    const reconcileIdx = jpAgent.indexOf('reconcileAgentClaim(');
    const cacheWriteIdx = jpAgent.indexOf(
      'await cacheWalletResults(walletsToCache)'
    );
    ok(
      'the agent claim is reconciled after the graph read, not beside the detection',
      detectIdx !== -1 &&
        graphIdx !== -1 &&
        reconcileIdx !== -1 &&
        detectIdx < graphIdx &&
        graphIdx < reconcileIdx
    );
    /**
     * And OUTSIDE the uncached branch, which is what preceding the cache write
     * cost.
     *
     * Moving it next to `cacheWalletResults` put it on the uncached path only:
     * a graph hit or a cache hit never reached it, STEP 0 re-stamped
     * `is_agent` from the catalog, `mergeGraphRow` kept that stamp over a
     * backfilled row, and finalize wrote the claim into a graph that ORs it
     * and can never take one back. Covering every row is the property worth
     * pinning; the cache write preceding it is documented at the call site as
     * harmless, because every serve path merges and then reconciles.
     */
    const paidGateIdx = jpAgent.indexOf(
      'const isPaidTier = jobGetsPaidFields(options)'
    );
    ok(
      'the reconcile runs outside the uncached branch, before the paid-field gate',
      reconcileIdx !== -1 &&
        cacheWriteIdx !== -1 &&
        paidGateIdx !== -1 &&
        cacheWriteIdx < reconcileIdx &&
        reconcileIdx < paidGateIdx
    );
    /**
     * The reconcile walks THIS chunk, not every loaded row.
     *
     * `results` carries `partialResults` from every earlier chunk, while
     * `agentOwnHandles` holds only what this chunk looked up. Iterating all of
     * `results` re-checked an earlier chunk's kept claim with a missing
     * handle and deleted it, so every job past CHUNK_SIZE dropped exactly the
     * badges the rule exists to preserve, and only on the large jobs.
     */
    ok(
      'the reconcile iterates this chunk, not every row loaded from partial results',
      /for \(const rawWallet of activeWallets\)/.test(jpAgent) &&
        !/for \(const \[wallet, result\] of results\) \{ if \(reconcileAgentClaim/.test(
          jpAgent
        )
    );
    /**
     * And lowercases before either lookup. `results` is keyed by
     * `wallet.toLowerCase()` and `agentOwnHandles` by the lowercase
     * `known_agents` row, while `activeWallets` carries the customer's own
     * casing, so a mixed-case address missed both maps and skipped withdrawal
     * with no sign that it had.
     */
    /**
     * Only catalog claims are reconciled.
     *
     * A bio-keyword claim is about the Farcaster account attached to this
     * wallet, which its owner verified, so the attestation is that claim's
     * evidence rather than a contradiction of it. Putting one through the rule
     * withdraws it every time: the wallet is never in `agentOwnHandles` and
     * `farcaster_verified` is always set by then, because bio detection runs
     * after Neynar.
     */
    ok(
      'only a catalog claim is reconciled, never a bio-keyword one',
      /if \(!agentOwnHandles\.has\(wallet\)\) continue;/.test(jpAgent)
    );

    ok(
      'and lowercases the wallet before looking it up in either map',
      /const wallet = rawWallet\.toLowerCase\(\); const result = results\.get\(wallet\);/.test(
        jpAgent
      )
    );

    /**
     * A Farcaster account found through verified addresses is attested, and
     * the row has to say so or the rule above has nothing to act on. The flag
     * used to arrive only from the graph merge, so a first lookup of an unseen
     * wallet kept the badge on exactly the rows where the evidence against it
     * had just been fetched.
     */
    ok(
      'a freshly resolved Farcaster account marks the row attested',
      /farcaster_verified: data\.farcaster \? true : existing\.farcaster_verified/.test(
        jpAgent
      )
    );
  }

  // --------------------- three things the agent classification said but did not do
  /**
   * Each of these was a comment, a column or a docstring asserting behaviour
   * the code did not have, and each failed silently: a number that is merely
   * low, a field that is merely absent, a column that is merely NULL.
   */
  {
    const gateSrc = withoutComments(readFileSync('lib/match-gate.ts', 'utf8'));
    const countsSrc = readFileSync('lib/result-counts.ts', 'utf8');

    /**
     * `result-counts.ts` says of its agent tally: "Never gated: agent
     * detection is free." All six agent fields were in `LOCKED_FIELDS`, and
     * `gateResults` runs server-side before `countResults` runs in the
     * browser, so the stat tile, the "Agents only" filter and the CSV all read
     * a locked agent row as a non-agent.
     */
    const lockedBlock =
      gateSrc.match(/const LOCKED_FIELDS = \[([\s\S]*?)\] as const;/)?.[1] ??
      '';
    ok(
      'the gate withholds no agent field, because the counter says it does not',
      lockedBlock.length > 0 &&
        !/'is_agent'|'agent_name'|'agent_verified'|'agent_framework'|'agent_type'|'agent_token_symbol'/.test(
          lockedBlock
        ) &&
        /Never gated: agent detection is free/.test(countsSrc)
    );

    /**
     * The same question, asked of the public API and of the browser, must
     * answer the same way. `/api/reverse` returned all six agent fields and
     * `/v1/reverse/*` returned none, and the MCP reverse tools sit on the
     * public one, so a model could never be told a wallet was an agent while
     * the table showed a badge for it.
     */
    for (const reverseRoute of [
      'app/api/v1/reverse/twitter/[handle]/route.ts',
      'app/api/v1/reverse/farcaster/[username]/route.ts',
    ]) {
      // The GUARD together with the body, not the body alone. Asserting that
      // `item.agent = {` appears is satisfied by `if (false) { item.agent = {`,
      // which is exactly how this assertion failed its own adversarial run:
      // presence of text says nothing about whether the text can execute.
      const src = withoutComments(readFileSync(reverseRoute, 'utf8')).replace(
        /\s+/g,
        ' '
      );
      ok(
        `${reverseRoute} publishes the agent block, like every other v1 shape`,
        /if \(result\.isAgent\) \{ item\.agent = \{/.test(src) &&
          /isAgent: socialGraph\.isAgent/.test(src)
      );
    }

    /**
     * `agent_detection_source` was a column on two tables with a documented
     * four-value vocabulary and no writer anywhere. A catalog match and a
     * regex over a Farcaster bio were indistinguishable on a stored row, and
     * the only hint was `agent_verified`, which is `true` for every catalog
     * match whether or not anything verified anything.
     */
    /**
     * Both writers, not just the catalog one. `detectAgentFromBio` always
     * returned the source and the merge always dropped it, so every
     * bio-keyword row stored NULL and was indistinguishable from a catalog
     * match written before the column was filled at all, which is the exact
     * confusion filling it was meant to end.
     */
    ok(
      'a bio detection records its source, like a catalog match does',
      /agent_detection_source: bioResult\.agent_detection_source/.test(
        withoutComments(readFileSync('lib/job-processor.ts', 'utf8'))
      )
    );

    /**
     * And a withdrawal takes it with the rest. A row that still says
     * `known_list` after the claim is gone is a leftover catalog claim about
     * an address the product has just declined to call an agent.
     */
    ok(
      'withdrawing a claim clears the detection source too',
      /'agent_detection_source',/.test(
        withoutComments(readFileSync('lib/agent-claim.ts', 'utf8'))
      )
    );

    ok(
      'the detection source is written, not just declared',
      /agent_detection_source: agentData\.agent_detection_source/.test(
        withoutComments(readFileSync('lib/job-processor.ts', 'utf8'))
      ) &&
        /agentDetectionSource: r\.agent_detection_source/.test(
          withoutComments(readFileSync('lib/cache.ts', 'utf8'))
        ) &&
        /agentDetectionSource:\s*r\.agent_detection_source \?\? prev/.test(
          withoutComments(readFileSync('lib/social-graph.ts', 'utf8'))
        )
    );

    /**
     * And it comes back, which the assertion above does not cover and did not
     * catch. Every writer filled the column while all four readers dropped it:
     * `getCachedWallets` and `socialGraphToResult` each mapped the six
     * `agent_*` fields and stopped, and both merge helpers copied the same
     * six. A stored source therefore never reached a result object on a cache
     * or graph hit, so a bio-keyword row still read exactly like an unfilled
     * one and the column was dead in the direction that matters to a reader.
     *
     * Asserting the write alone is the mistake this file exists to prevent:
     * a value that is stored and never returned is indistinguishable from one
     * that was never stored.
     */
    const jobSrc = withoutComments(
      readFileSync('lib/job-processor.ts', 'utf8')
    );
    ok(
      'a stored detection source comes back on a cache or graph hit',
      /agent_detection_source:\s*row\.agentDetectionSource/.test(
        withoutComments(readFileSync('lib/cache.ts', 'utf8'))
      ) &&
        /agent_detection_source:\s*record\.agentDetectionSource/.test(
          withoutComments(readFileSync('lib/social-graph.ts', 'utf8'))
        ) &&
        // Both merge helpers, not one: `mergeGraphRow` and `mergeCacheRow`
        // carry a result forward on different hit paths, and a field restored
        // on only one of them is still lost on the other.
        (
          jobSrc.match(
            /agent_detection_source:\s*existing\.agent_detection_source \|\|/g
          ) ?? []
        ).length === 2
    );
  }

  // ------------------------------------------------------- OAuth: redirects
  // `redirectUriAllowed` is the single check standing between an authorization
  // code and whoever asked for it. Every case below is the attacker's.
  {
    const { redirectUriAllowed } = await import('@/lib/oauth/clients');
    const declared = [
      'https://claude.ai/api/mcp/auth_callback',
      'http://localhost/callback',
      'http://127.0.0.1/callback',
    ];

    ok(
      'a redirect the client never declared is refused',
      !redirectUriAllowed('https://evil.example.com/steal', declared)
    );
    ok(
      'a declared https redirect is allowed, so the check above is not vacuous',
      redirectUriAllowed('https://claude.ai/api/mcp/auth_callback', declared)
    );
    ok(
      'a loopback redirect matches with the port ignored, which native clients need',
      redirectUriAllowed('http://127.0.0.1:51837/callback', declared)
    );
    // The port is the only free component. A version that compared origins, or
    // that matched any loopback URI against any other, would send the code to
    // a path the client never named.
    ok(
      'a loopback redirect on another PATH is refused',
      !redirectUriAllowed('http://127.0.0.1:51837/evil', declared)
    );
    ok(
      'a loopback redirect on another HOST is refused',
      !redirectUriAllowed('http://169.254.169.254/callback', declared)
    );
    ok(
      'an https URI is not matched port-agnostically against a declared https URI',
      !redirectUriAllowed(
        'https://claude.ai:8443/api/mcp/auth_callback',
        declared
      )
    );
    ok(
      'a subdomain of a declared host is refused',
      !redirectUriAllowed(
        'https://claude.ai.evil.example.com/api/mcp/auth_callback',
        declared
      )
    );
  }

  // ------------------------------------------ OAuth: only the port is free
  // The loopback carve-out frees the port and nothing else: RFC 9700 section
  // 2.1 and OAuth 2.1 section 2.3.1 require an exact match otherwise. Each
  // case below smuggled something past the old comparison, which looked only
  // at scheme, host and path.
  {
    const { redirectUriAllowed } = await import('@/lib/oauth/clients');
    const cc = ['http://localhost/callback', 'http://127.0.0.1/callback'];
    for (const u of [
      'http://localhost:1234/callback?state=injected',
      'http://attacker@127.0.0.1:1/callback',
      'http://127.0.0.1:5/callback#frag',
      'http://127.1:5/callback',
      'http://LOCALHOST:5/callback',
      'http://localhost:5/callback/',
    ]) {
      ok(
        `the loopback carve-out frees only the port: ${u} is refused`,
        !redirectUriAllowed(u, cc)
      );
    }
    ok(
      'Claude Code’s shape, localhost or 127.0.0.1 on a port it chose, still matches',
      redirectUriAllowed('http://localhost:3118/callback', cc) &&
        redirectUriAllowed('http://127.0.0.1:51837/callback', cc)
    );
    ok(
      'MCP Inspector’s shape, a registered loopback with its port, still matches',
      redirectUriAllowed('http://localhost:6274/oauth/callback', [
        'http://localhost:6274/oauth/callback',
      ])
    );
    ok(
      '[::1] on a port matches its portless declaration',
      redirectUriAllowed('http://[::1]:5/callback', ['http://[::1]/callback'])
    );
    // The host is not free: a client that declared localhost did not declare
    // 127.0.0.1 or [::1] (RFC 8252 treats them as different redirects).
    const inspector = ['http://localhost:6274/oauth/callback'];
    for (const u of [
      'http://127.0.0.1:6274/oauth/callback',
      'http://[::1]:6274/oauth/callback',
    ]) {
      ok(
        `a loopback redirect on another loopback host is refused: ${u}`,
        !redirectUriAllowed(u, inspector)
      );
    }
    ok(
      'and the reverse: a declared 127.0.0.1 does not admit localhost',
      !redirectUriAllowed('http://localhost:5/callback', [
        'http://127.0.0.1/callback',
      ])
    );
    // A port past 65535 is not a port: accepting it passed the gate and then
    // crashed the error delivery with a 500.
    ok(
      'a loopback port above 65535 is refused, not crashed on later',
      !redirectUriAllowed('http://localhost:99999/callback', cc)
    );
    const { isLoopbackRedirect } = await import('@/lib/oauth/clients');
    for (const u of [
      'http://localhost/cb#x',
      'http://LOCALHOST/cb',
      'http://127.1/cb',
      'http://a@localhost/cb',
      'http://localhost:99999/cb',
      'https://localhost/cb',
    ]) {
      ok(
        `not a loopback redirect by the one shared rule: ${u}`,
        !isLoopbackRedirect(u)
      );
    }
    ok(
      'the shared rule still accepts the shapes real clients use',
      [
        'http://localhost/callback',
        'http://127.0.0.1:51837/callback',
        'http://[::1]:5/callback',
      ].every(isLoopbackRedirect)
    );
  }

  // ---------------------------------- OAuth: where an error may send a browser
  // An error or a decline is sent on to the client without a person choosing
  // it, so only to a callback somebody vetted: loopback (this computer) or a
  // known origin. A registered or self-published https address is anybody's
  // page (RFC 9700 section 4.11.2).
  {
    const { redirectIsTrusted } = await import('@/lib/oauth/clients');
    for (const u of [
      'https://evil.example.com/cb',
      'https://claude.ai.evil.example.com/api/mcp/auth_callback',
      'https://claude.ai@evil.example.com/cb',
      'http://claude.ai/api/mcp/auth_callback',
      'https://claude.ai:8443/api/mcp/auth_callback',
      'https://sub.claude.ai/cb',
    ]) {
      ok(`${u} gets no automatic redirect`, !redirectIsTrusted(u));
    }
    for (const u of [
      'https://x@claude.ai/api/mcp/auth_callback',
      'https://x:y@claude.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback#frag',
    ]) {
      ok(
        `userinfo or a fragment on the trusted origin itself is not trusted: ${u}`,
        !redirectIsTrusted(u)
      );
    }
    ok(
      'the hosted Claude callback still gets its error, or claude.ai hangs',
      redirectIsTrusted('https://claude.ai/api/mcp/auth_callback')
    );
    ok(
      'a loopback callback still gets its error, or Claude Code waits for a timeout',
      redirectIsTrusted('http://localhost:3118/callback')
    );

    const page = withoutComments(
      readFileSync('app/oauth/authorize/page.tsx', 'utf8')
    );
    const gate = page.indexOf(
      'if (!redirectUriAllowed(redirectUri, client.redirectUris))'
    );
    const calls = [...page.matchAll(/\bredirect\(/g)];
    ok(
      'the page redirects nowhere before the redirect_uri gate',
      gate > 0 && calls.every((m) => m.index! > gate)
    );
    ok(
      'the page’s only redirects are the trusted error delivery and its own consent URL',
      calls.length === 2 &&
        page.includes('redirect(`/oauth/authorize?req=${id}`)') &&
        /if \(redirectIsTrusted\(redirectUri\)\) \{[\s\S]{0,400}?redirect\(url\.toString\(\)\)/.test(
          page
        )
    );
    for (const key of ['client_id', 'redirect_uri']) {
      const at = page.indexOf(`Array.isArray(params.${key})`);
      ok(
        `a repeated ${key} renders before any client lookup`,
        at > -1 && at < page.indexOf('resolveClient(clientId)')
      );
    }
    const { repeatedParam, resourcesAreOurs, ONCE_PARAMS } =
      await import('@/lib/oauth/params');
    for (const key of ONCE_PARAMS) {
      ok(
        `a repeated ${key} is found`,
        repeatedParam({ [key]: ['a', 'b'] }) === key
      );
    }
    ok(
      'every parameter that must appear once is on the list',
      [
        'response_type',
        'code_challenge',
        'code_challenge_method',
        'state',
        'scope',
      ].every((k) => (ONCE_PARAMS as readonly string[]).includes(k))
    );
    ok(
      'a repeated resource is allowed (RFC 8707 section 2), and single values pass',
      repeatedParam({ resource: ['a', 'b'], state: 's', scope: 'x' }) === null
    );
    ok(
      'the page refuses a repeated parameter through that function',
      /const repeated = repeatedParam\(params\);\s*if \(repeated\)\s*bounce\(/.test(
        page
      )
    );
    const ours = 'https://walletlink.social/api/mcp';
    ok(
      'a resource list naming ours and another server is refused as a whole',
      !resourcesAreOurs([ours, 'https://other.example/'], ours) &&
        !resourcesAreOurs(['https://other.example/', ours], ours)
    );
    ok(
      'ours alone, repeated, with a trailing slash, or absent, is accepted',
      resourcesAreOurs(ours, ours) &&
        resourcesAreOurs([ours, `${ours}/`], ours) &&
        resourcesAreOurs(undefined, ours)
    );
    ok(
      'the page checks every resource value, not the first',
      page.includes('resourcesAreOurs(params.resource, mcpResource())')
    );
    ok(
      'a collected error is answered before any request is stored',
      page.indexOf('if (problem) return deliverError(problem)') > -1 &&
        page.indexOf('if (problem) return deliverError(problem)') <
          page.indexOf('createAuthorizationRequest(')
    );

    const post = withoutComments(
      readFileSync('app/api/oauth/authorize/route.ts', 'utf8')
    );
    const decline = post.slice(post.indexOf('if (!input.approve)'));
    ok(
      'a decline answers the request before anything is returned, and a lost race is a 409',
      /if \(!\(await declineRequest\(pending\.id\)\)\) \{\s*return fail\('This authorization request was already answered\.', 409\)/.test(
        decline
      ) &&
        decline.indexOf('declineRequest(pending.id)') <
          decline.indexOf('return NextResponse.json')
    );
    const requestsSrc = withoutComments(
      readFileSync('lib/oauth/requests.ts', 'utf8')
    );
    const declineFn = requestsSrc.slice(
      requestsSrc.indexOf('export async function declineRequest'),
      requestsSrc.indexOf('export async function issueCode')
    );
    ok(
      'a decline writes the marker issueCode requires to be NULL, so a later approval issues nothing',
      declineFn.includes('codeHash: `declined:${id}`') &&
        declineFn.includes('expiresAt: sql`now()`') &&
        !declineFn.includes('codeExpiresAt')
    );
    ok(
      'a decline touches only its own unanswered request, and reports whether it did',
      declineFn.includes('eq(oauthAuthorizationRequests.id, id)') &&
        declineFn.includes('isNull(oauthAuthorizationRequests.codeHash)') &&
        declineFn.includes('.returning()') &&
        declineFn.includes('return declined.length === 1')
    );
    ok(
      'issueCode still refuses a request whose code_hash is set',
      /export async function issueCode[\s\S]*?isNull\(oauthAuthorizationRequests\.codeHash\)/.test(
        requestsSrc
      )
    );
    ok(
      'a decline is sent back only to a trusted callback',
      /if \(!redirectIsTrusted\(pending\.redirectUri\)\) \{\s*return NextResponse\.json\(\{ declined: true \}\)/.test(
        decline
      )
    );
  }

  // ----------------------------------------- OAuth: the host the consent names
  // The MCP specification: the authorization server "MUST clearly display the
  // redirect URI hostname". A registered client may list any host, including
  // claude.ai's callback beside its own, so the screen names the reply host of
  // the request being approved and never an entry from the list.
  {
    const { consentView } = await import('@/lib/oauth/clients');
    const dcr = {
      clientId: 'wts_client_x',
      displayHost: 'an unverified application',
      claimedName: 'Claude',
      redirectUris: [
        'https://claude.ai/api/mcp/auth_callback',
        'https://evil.example.com/cb',
      ],
      isCimd: false,
    };
    const borrowed = consentView(dcr, 'https://evil.example.com/cb');
    ok(
      'a registered client that listed a borrowed host first is named by the host its reply goes to',
      borrowed?.subject === 'evil.example.com' &&
        borrowed.replyHost === 'evil.example.com'
    );
    ok(
      'a registered client’s self-declared name is never shown',
      borrowed?.claimedName === null && borrowed.verified === false
    );
    ok(
      'userinfo cannot borrow a trusted name',
      consentView(dcr, 'https://claude.ai@evil.example.com/cb')?.replyHost ===
        'evil.example.com'
    );
    ok(
      'a lookalike internationalized host is shown in ASCII',
      consentView(dcr, 'https://аpple.com/cb')?.replyHost === 'xn--pple-43d.com'
    );
    ok(
      'an unreadable reply address gives no consent view at all',
      consentView(dcr, 'not a url') === null
    );
    const claudeCode = {
      clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
      displayHost: 'claude.ai',
      claimedName: 'Claude Code',
      redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
      isCimd: true,
    };
    const cc = consentView(claudeCode, 'http://localhost:3118/callback');
    ok(
      'a loopback reply is marked local, with its port, even for a verified client',
      cc?.local === true &&
        cc.replyAuthority === 'localhost:3118' &&
        cc.subject === 'claude.ai'
    );
    const hosted = consentView(
      {
        ...claudeCode,
        clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
        claimedName: 'Claude',
        redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      },
      'https://claude.ai/api/mcp/auth_callback'
    );
    ok(
      'the hosted Claude callback is not local, so the check above is not vacuous',
      hosted?.local === false && hosted.replyHost === 'claude.ai'
    );

    // Rendered, because a prop computed right and dropped by the component
    // protects nobody.
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ConsentScreen } =
      await import('@/app/oauth/authorize/ConsentScreen');
    const render = (view: NonNullable<typeof cc>) =>
      renderToStaticMarkup(
        createElement(ConsentScreen, {
          requestId: 'req',
          ...view,
          email: null,
          keepsAccess: true,
        })
      );
    const attackHtml = render(borrowed!);
    ok(
      'the borrowed-host attack shows the real reply host and not the borrowed one',
      attackHtml.includes('evil.example.com') &&
        !attackHtml.includes('claude.ai')
    );
    const localHtml = render(cc!);
    ok(
      'a loopback reply carries the warning and names the port',
      localHtml.includes('loopback-warning') &&
        localHtml.includes('localhost:3118')
    );
    const hostedHtml = render(hosted!);
    ok(
      'the hosted callback shows claude.ai and no loopback warning',
      hostedHtml.includes('claude.ai') &&
        !hostedHtml.includes('loopback-warning')
    );

    // MCP Inspector: a registered client with a loopback reply. It must not
    // be named by what it calls itself, and it must get the warning.
    const inspectorClient = {
      clientId: 'wts_client_inspector',
      displayHost: 'an unverified application',
      claimedName: 'Claude',
      redirectUris: ['http://localhost:6274/oauth/callback'],
      isCimd: false,
    };
    const insp = consentView(
      inspectorClient,
      'http://localhost:6274/oauth/callback'
    );
    ok(
      'a registered loopback client is "An application on this computer", never its own name',
      insp?.subject === 'An application on this computer' &&
        insp.claimedName === null &&
        insp.local === true
    );
    const inspHtml = render(insp!);
    ok(
      'its screen carries the warning and the port, and never the name it gave itself',
      inspHtml.includes('loopback-warning') &&
        inspHtml.includes('localhost:6274') &&
        !inspHtml.includes('Claude')
    );
    for (const u of [
      'https://foo.localhost:8443/cb',
      'https://localhost.:8443/cb',
      'https://127.0.0.2:8443/cb',
      'https://0.0.0.0:8443/cb',
      'https://[::ffff:127.0.0.1]:8443/cb',
      'https://[::1]:8443/cb',
    ]) {
      ok(
        `a reply to ${u} is marked local, so the person is warned`,
        consentView(dcr, u)?.local === true
      );
    }
    ok(
      'an ordinary https host is not local',
      consentView(dcr, 'https://evil.example.com/cb')?.local === false
    );
    const evilCode = consentView(
      {
        clientId: 'https://evil.example/meta',
        displayHost: 'evil.example',
        claimedName: 'Claude Code',
        redirectUris: ['http://localhost/callback'],
        isCimd: true,
      },
      'http://localhost:3118/callback'
    );
    const evilHtml = render(evilCode!);
    ok(
      'the loopback warning names the verified host, not the name a document claimed',
      evilHtml.includes('evil.example’s name') &&
        !evilHtml.includes('Claude Code’s name')
    );
    const replyShown = (html: string) =>
      /data-consent="reply-host"[^>]*>([^<]*)</.exec(html)?.[1];
    ok(
      'the reply host sits in its own marked element, and it is the real one',
      replyShown(attackHtml) === 'evil.example.com' &&
        replyShown(localHtml) === 'localhost:3118' &&
        replyShown(hostedHtml) === 'claude.ai'
    );

    const page = withoutComments(
      readFileSync('app/oauth/authorize/page.tsx', 'utf8')
    );
    const consent = page.slice(page.indexOf('async function renderConsent'));
    const consentProps = consent.slice(
      consent.indexOf('<ConsentScreen'),
      consent.indexOf('/>', consent.indexOf('<ConsentScreen'))
    );
    ok(
      'the page hands the consent screen the view whole, and none of its facts from the client',
      consentProps.includes('{...view}') &&
        !/\b(subject|claimedName|verified|replyHost|replyAuthority|local)=\{/.test(
          consentProps
        )
    );
    ok(
      'the consent screen is built from the redirect in the request',
      consent.includes('consentView(client, pending.redirectUri)')
    );
    ok(
      'the redirect is checked again before a consent screen is shown',
      consent.includes(
        'redirectUriAllowed(pending.redirectUri, client.redirectUris)'
      )
    );
    ok(
      'no client is labeled by an entry in its registered list',
      !withoutComments(readFileSync('lib/oauth/clients.ts', 'utf8')).includes(
        'redirectUris.find('
      )
    );
    const post = withoutComments(
      readFileSync('app/api/oauth/authorize/route.ts', 'utf8')
    );
    const { connectionLabel, cleanClaimedName, cimdRedirectProblem } =
      await import('@/lib/oauth/clients');
    const evilCimd = {
      clientId: 'https://evil.example/meta',
      displayHost: 'evil.example',
      claimedName: 'Claude (claude.ai)',
      redirectUris: ['https://evil.example/cb'],
      isCimd: true,
    };
    ok(
      'a metadata-document label starts with its verified host, so a long name cannot push it off a one-line row',
      connectionLabel(evilCimd, 'https://evil.example/cb').startsWith(
        'evil.example (calls itself '
      )
    );
    ok(
      'a registered client is labeled by its reply host and never by its own name',
      connectionLabel(dcr, 'https://evil.example.com/cb') ===
        'evil.example.com (unverified)'
    );
    ok(
      'a metadata-document client with no name is labeled by its host alone',
      connectionLabel(
        { ...evilCimd, claimedName: null },
        'https://evil.example/cb'
      ) === 'evil.example'
    );
    ok(
      'the connection label is built by connectionLabel from the pending redirect',
      post.includes('clientLabel: connectionLabel(client, pending.redirectUri)')
    );
    ok(
      'a self-declared name loses its control, bidirectional and zero-width characters',
      cleanClaimedName('Cl\u202Eaude\u200B\u0007') === 'Claude'
    );
    ok(
      'padding and unusual spaces collapse, and a name is capped at 60 characters',
      cleanClaimedName('Claude' + '\u00a0'.repeat(80) + 'x') === 'Claude x' &&
        cleanClaimedName('a'.repeat(200))!.length === 60
    );
    ok(
      'an empty or blank name is no name at all',
      cleanClaimedName('') === null &&
        cleanClaimedName(' \u00a0 ') === null &&
        cleanClaimedName(42) === null
    );
    ok(
      'a metadata document may not declare a redirect with a fragment or userinfo on its own origin',
      cimdRedirectProblem(
        'https://evil.example/cb#x',
        'https://evil.example'
      ) !== null &&
        cimdRedirectProblem(
          'https://a@evil.example/cb',
          'https://evil.example'
        ) !== null &&
        cimdRedirectProblem(
          'https://other.example/cb',
          'https://evil.example'
        ) !== null &&
        cimdRedirectProblem('http://localhost/cb#x', 'https://evil.example') !==
          null
    );
    ok(
      'its own-origin redirect and a clean loopback pass, so the check is not vacuous',
      cimdRedirectProblem('https://evil.example/cb', 'https://evil.example') ===
        null &&
        cimdRedirectProblem(
          'http://localhost/callback',
          'https://evil.example'
        ) === null
    );
  }

  // ------------------------------------------------- OAuth: the scope refusal
  /**
   * The refusal must not contradict the metadata one hop away.
   *
   * A request naming only `offline_access` is bounced, and correctly: the rule
   * beside it is that a client cannot receive a scope it did not ask for, so
   * the read scope cannot be added on its behalf. What was wrong was the
   * sentence. It said "the only scope this server grants is wallet:read" while
   * `SUPPORTED_SCOPES` held two and the authorization server metadata
   * advertised both, so a client that read the metadata and then read the error
   * learned only that one of them was lying.
   *
   * Asserted against the constant rather than the string, so adding a third
   * scope cannot leave a message claiming there is one.
   */
  {
    const { SUPPORTED_SCOPES, MCP_SCOPE, OFFLINE_SCOPE } =
      await import('@/lib/oauth/metadata');
    const page = withoutComments(
      readFileSync('app/oauth/authorize/page.tsx', 'utf8')
    );
    /**
     * The message interpolates the constants rather than spelling the scope
     * values, which is the point: it cannot drift from them. So this looks for
     * the identifiers, not for "wallet:read". The first version of this
     * assertion searched for the values and failed on correct code, which is
     * the friendlier direction for an assertion to be wrong in.
     */
    const start = page.indexOf("'invalid_scope',");
    const refusal = page.slice(start, page.indexOf(');', start));
    ok(
      'the scope refusal does not claim this server grants only one scope',
      start > 0 &&
        SUPPORTED_SCOPES.length > 1 &&
        !/only scope this server grants/.test(page) &&
        refusal.includes('${MCP_SCOPE}') &&
        refusal.includes('${OFFLINE_SCOPE}')
    );
    ok(
      'and both advertised scopes are still the ones the gate filters on',
      SUPPORTED_SCOPES.includes(MCP_SCOPE) &&
        SUPPORTED_SCOPES.includes(OFFLINE_SCOPE) &&
        page.includes('SUPPORTED_SCOPES.filter((s) => asked.includes(s))')
    );
  }

  // --------------------------------------------------- OAuth: the return path
  // The one value that survives a round trip through a mailbox. If this widens,
  // a sign-in link becomes an open redirect carrying our own authenticity.
  {
    const { isAllowedReturnPath } = await import('@/lib/auth');
    const good = '/oauth/authorize?req=77dbc899-4894-4489-9816-46103a94ebd1';

    ok(
      'the consent path with one request id is accepted, so the checks below are not vacuous',
      isAllowedReturnPath(good)
    );

    /**
     * The second shape, and every near miss of it.
     *
     * `/claim` was added because that page asks for an account before it asks
     * for a wallet, so a signed-out person reaches sign-in from there and the
     * home page abandons what they were doing. It is compared with `===` and
     * carries no query, which is what keeps it from widening the allowlist:
     * the danger here is caller-supplied data surviving a mailbox with our
     * authenticity attached, and a literal supplies none.
     *
     * The near misses below are the whole reason this is not a `startsWith`.
     * Each is a real way a prefix test fails, and each must refuse.
     */
    ok('the claim page is accepted', isAllowedReturnPath('/claim'));
    for (const nearMiss of [
      '/claim?next=https://evil.example.com',
      '/claim/../admin',
      '/claimants',
      '/claim.evil.example.com',
      '//claim',
      '/claim#@evil.example.com',
      '/claim ',
      'claim',
    ]) {
      ok(
        `the sign-in return path refuses ${nearMiss}`,
        !isAllowedReturnPath(nearMiss)
      );
    }

    /**
     * The third shape, and the same eight near misses.
     *
     * `/dashboard` is an account surface, so the sign-in round trip is its
     * normal entry rather than an edge. It is a literal compared with `===`
     * for the same reason `/claim` is, and it earns the same refusals: every
     * one of these is a way a `startsWith` would have let caller-supplied data
     * through a mailbox with our own authenticity attached.
     */
    ok('the dashboard is accepted', isAllowedReturnPath('/dashboard'));
    for (const nearMiss of [
      '/dashboard?next=https://evil.example.com',
      '/dashboard/../admin',
      '/dashboards',
      '/dashboard.evil.example.com',
      '//dashboard',
      '/dashboard#@evil.example.com',
      '/dashboard ',
      'dashboard',
    ]) {
      ok(
        `the sign-in return path refuses ${nearMiss}`,
        !isAllowedReturnPath(nearMiss)
      );
    }

    for (const hostile of [
      'https://evil.example.com',
      '//evil.example.com',
      '/\\evil.example.com',
      'http://walletlink.social.evil.example.com',
      '/oauth/authorize?req=77dbc899-4894-4489-9816-46103a94ebd1&next=https://evil.example.com',
      '/oauth/authorize?req=../../../admin',
      '/admin',
      '/oauth/authorize',
      good + '#@evil.example.com',
    ]) {
      ok(
        `the sign-in return path refuses ${hostile}`,
        !isAllowedReturnPath(hostile)
      );
    }
  }

  // ---------------------------------------------------------- OAuth: metadata
  {
    process.env.NEXT_PUBLIC_URL = 'https://walletlink.social';
    const {
      authorizationServerMetadata,
      protectedResourceMetadata,
      wwwAuthenticate,
      MCP_SCOPE,
      OFFLINE_SCOPE,
    } = await import('@/lib/oauth/metadata');
    const as = authorizationServerMetadata();
    const prm = protectedResourceMetadata();

    // Claude picks metadata documents only when BOTH are advertised, and falls
    // back to registering a fresh client per connection when either is missing.
    // The failure is silent: connections still work, and the client table grows
    // by one row per connection forever.
    ok(
      'the metadata advertises client_id_metadata_document_supported',
      as.client_id_metadata_document_supported === true
    );
    ok(
      'the metadata advertises "none" as a token endpoint auth method',
      (as.token_endpoint_auth_methods_supported as string[]).includes('none')
    );
    ok(
      'S256 is the only PKCE method advertised, so "plain" cannot be negotiated',
      JSON.stringify(as.code_challenge_methods_supported) ===
        JSON.stringify(['S256'])
    );
    // RFC 9207. A client that records our issuer and compares it on the way
    // back cannot be talked into sending its code somewhere else, but only if
    // we tell it we send the parameter.
    ok(
      'the metadata advertises that authorization responses carry iss',
      as.authorization_response_iss_parameter_supported === true
    );
    // The MCP specification: a refresh token is not something the resource
    // requires, so advertising it here would produce an over-broad consent.
    ok(
      'offline_access is offered by the authorization server',
      (as.scopes_supported as string[]).includes(OFFLINE_SCOPE)
    );
    ok(
      'offline_access is NOT advertised as a scope the resource requires',
      !(prm.scopes_supported as string[]).includes(OFFLINE_SCOPE)
    );
    ok(
      'the resource identifier carries the MCP path, not the bare origin',
      prm.resource === 'https://walletlink.social/api/mcp'
    );
    ok(
      'the 401 challenge names the scope, so a client cannot ask for more',
      wwwAuthenticate().includes(`scope="${MCP_SCOPE}"`)
    );

    // The 401 points a client at a path that only exists because of a rewrite,
    // because the App Router will not serve a `.well-known` directory. Rename
    // the rewrite and every connection breaks with "could not reach the MCP
    // server", the authorization server never seeing a request.
    const config = readFileSync('next.config.ts', 'utf8');
    const pointer = wwwAuthenticate().match(/resource_metadata="([^"]+)"/)?.[1];
    const path = pointer ? new URL(pointer).pathname : '';
    ok(
      `the resource_metadata path (${path}) has a rewrite in next.config.ts`,
      !!path && config.includes(`source: '${path}'`)
    );
    ok(
      'the root protected-resource path also has a rewrite, for clients that probe',
      config.includes("source: '/.well-known/oauth-protected-resource'")
    );
    ok(
      'the authorization server metadata path has a rewrite',
      config.includes("source: '/.well-known/oauth-authorization-server'")
    );
  }

  // ------------------------------------- OAuth: registration grant types
  // The pure function the register route calls, never the route itself: with
  // DATABASE_URL set in a developer's shell the route would write to the
  // IP-limit table and to oauth_clients.
  {
    const { registrableGrantTypes } = await import('@/lib/oauth/clients');
    const { GRANT_TYPES_SUPPORTED, authorizationServerMetadata } =
      await import('@/lib/oauth/metadata');
    const JWT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
    const refusal = (requested: unknown) => {
      const r = registrableGrantTypes(requested);
      return r.ok ? null : r.description;
    };
    const registered = (requested: unknown) => {
      const r = registrableGrantTypes(requested);
      return r.ok ? JSON.stringify(r.grantTypes) : null;
    };

    const jwtOnly = refusal([JWT]);
    ok(
      'a registration asking only for the jwt-bearer grant is refused by name, and not told about client_credentials',
      jwtOnly !== null &&
        jwtOnly.includes(JWT) &&
        !jwtOnly.includes('client_credentials')
    );
    const credentialsOnly = refusal(['client_credentials']);
    ok(
      'a registration asking only for client_credentials is refused by name',
      credentialsOnly !== null && credentialsOnly.includes('client_credentials')
    );
    ok(
      'a registration with a refresh grant and no way to a first token is refused',
      refusal(['refresh_token']) !== null
    );
    ok(
      'a grant_types list holding a non-string is refused',
      refusal(['authorization_code', 42]) !== null
    );
    ok(
      'hosted Claude’s grant list registers, without the grant this server does not issue',
      registered(['authorization_code', 'refresh_token', JWT]) ===
        JSON.stringify(['authorization_code', 'refresh_token'])
    );
    ok(
      'MCP Inspector’s grant lists register unchanged',
      registered(['authorization_code']) ===
        JSON.stringify(['authorization_code']) &&
        registered(['authorization_code', 'refresh_token']) ===
          JSON.stringify(['authorization_code', 'refresh_token'])
    );
    ok(
      'an omitted or empty grant list registers the default',
      registered(undefined) === JSON.stringify(GRANT_TYPES_SUPPORTED) &&
        registered([]) === JSON.stringify(GRANT_TYPES_SUPPORTED)
    );
    ok(
      'the metadata advertises exactly the grants registration keeps',
      JSON.stringify(authorizationServerMetadata().grant_types_supported) ===
        JSON.stringify(GRANT_TYPES_SUPPORTED)
    );
    const registerRoute = withoutComments(
      readFileSync('app/api/oauth/register/route.ts', 'utf8')
    );
    ok(
      'the register route decides grant types with registrableGrantTypes, and the old fixed sentence is gone',
      registerRoute.includes('registrableGrantTypes(meta.grant_types)') &&
        !registerRoute.includes('no client_credentials grant')
    );
  }

  // -------------------------------------------------------------- OAuth: PKCE
  // A known-answer test from RFC 7636 appendix B, deliberately not a value this
  // repo computed. Deriving the challenge with the same function under test
  // would verify only that the function agrees with itself, which is exactly
  // how the first version of the HMAC assertion in this file passed while the
  // property it claimed to cover had been deleted.
  {
    const { s256Challenge, pkceMatches } = await import('@/lib/oauth/requests');
    const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    ok(
      'the PKCE transform matches the RFC 7636 appendix B fixture',
      s256Challenge(VERIFIER) === CHALLENGE
    );
    ok(
      'the right verifier matches its challenge, so the refusals below are not vacuous',
      pkceMatches(VERIFIER, CHALLENGE)
    );
    ok(
      'a wrong verifier is refused',
      !pkceMatches('not-the-verifier-not-the-verifier-not-x', CHALLENGE)
    );
    ok(
      'the verifier is not accepted in place of its own challenge',
      !pkceMatches(VERIFIER, VERIFIER)
    );
    ok('an empty verifier is refused', !pkceMatches('', CHALLENGE));
  }

  // ------------------------------------------------- OAuth: the CIMD fetch
  // The `client_id` URL is supplied by whoever starts a flow, and we fetch it.
  // Every range below has to stay refused or that fetch is a working request
  // forgery, and nothing about the flow would look different.
  {
    const { isPrivateAddress } = await import('@/lib/oauth/clients');
    const privateV4 = [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
    ];
    for (const address of privateV4) {
      ok(
        `${address} is refused as a client_id host`,
        isPrivateAddress(address, 4)
      );
    }
    ok(
      'a public v4 address is allowed, so the refusals above are not vacuous',
      !isPrivateAddress('104.18.32.7', 4)
    );
    for (const address of ['::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
      ok(
        `${address} is refused as a client_id host`,
        isPrivateAddress(address, 6)
      );
    }
    ok(
      'a public v6 address is allowed',
      !isPrivateAddress('2606:4700:4700::1111', 6)
    );
    // 172.15 and 172.32 sit either side of the private block. A check written
    // as `a === 172` would refuse them, which is wrong in the safe direction
    // and would hide a real off-by-one in the other.
    ok('172.15.0.1 is public', !isPrivateAddress('172.15.0.1', 4));
    ok('172.32.0.1 is public', !isPrivateAddress('172.32.0.1', 4));

    /**
     * Every refused range, written out here independently of the table in
     * lib/oauth/clients.ts, and probed at both of its edges. A range deleted
     * from the table fails its first address, one narrowed fails its last,
     * and one widened fails the public neighbor just outside it (skipped only
     * where that neighbor sits in another refused range).
     */
    const EXPECTED_V4: Array<[string, number]> = [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ];
    const EXPECTED_V6: Array<[string, number]> = [
      ['::', 96],
      ['::ffff:0:0', 96],
      ['64:ff9b::', 96],
      ['64:ff9b:1::', 48],
      ['100::', 64],
      ['2001::', 32],
      ['2001:db8::', 32],
      ['2002::', 16],
      ['fc00::', 7],
      ['fe80::', 10],
      ['fec0::', 10],
      ['ff00::', 8],
    ];
    const v4ToBig = (a: string) =>
      a.split('.').reduce((n, o) => (n << BigInt(8)) + BigInt(o), BigInt(0));
    const bigToV4 = (n: bigint) =>
      [BigInt(24), BigInt(16), BigInt(8), BigInt(0)]
        .map((s) => String((n >> s) & BigInt(255)))
        .join('.');
    const v6ToBig = (a: string) => {
      const [head, tail = ''] = a.split('::');
      const h = head ? head.split(':') : [];
      const t = a.includes('::') ? (tail ? tail.split(':') : []) : [];
      const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
      return groups.reduce(
        (n, g) => (n << BigInt(16)) + BigInt(parseInt(g, 16)),
        BigInt(0)
      );
    };
    const bigToV6 = (n: bigint) =>
      Array.from({ length: 8 }, (_, i) =>
        ((n >> BigInt(112 - 16 * i)) & BigInt(0xffff)).toString(16)
      ).join(':');
    const edges = (
      ranges: Array<[string, number]>,
      bits: number,
      toBig: (a: string) => bigint,
      toStr: (n: bigint) => string,
      family: 4 | 6
    ) => {
      const inAny = (n: bigint) =>
        ranges.some(([net, p]) => {
          const size = BigInt(1) << BigInt(bits - p);
          const start = toBig(net);
          return n >= start && n < start + size;
        });
      const max = (BigInt(1) << BigInt(bits)) - BigInt(1);
      const bad: string[] = [];
      for (const [net, p] of ranges) {
        const first = toBig(net);
        const last = first + (BigInt(1) << BigInt(bits - p)) - BigInt(1);
        for (const n of [first, last]) {
          if (!isPrivateAddress(toStr(n), family)) bad.push(`${toStr(n)} open`);
        }
        for (const n of [first - BigInt(1), last + BigInt(1)]) {
          if (n < BigInt(0) || n > max || inAny(n)) continue;
          if (isPrivateAddress(toStr(n), family)) bad.push(`${toStr(n)} shut`);
        }
      }
      return bad;
    };
    const badV4 = edges(EXPECTED_V4, 32, v4ToBig, bigToV4, 4);
    ok(
      `every refused IPv4 range holds at both edges and stops at them (${badV4.join(', ') || 'none wrong'})`,
      badV4.length === 0
    );
    const badV6 = edges(EXPECTED_V6, 128, v6ToBig, bigToV6, 6);
    ok(
      `every refused IPv6 range holds at both edges and stops at them (${badV6.join(', ') || 'none wrong'})`,
      badV6.length === 0
    );

    // The ranges added with the two-list classifier (STA-39 D). Hex and
    // compatible spellings of loopback and link-local, both NAT64 prefixes,
    // 6to4, the rest of fe80::/10, site-local, multicast, benchmarking, the
    // IETF block and documentation.
    for (const address of [
      '198.18.0.1',
      '192.0.0.8',
      '192.0.2.1',
      '240.0.0.1',
    ]) {
      ok(
        `${address} is refused as a client_id host`,
        isPrivateAddress(address, 4)
      );
    }
    for (const address of [
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '::127.0.0.1',
      '64:ff9b::a9fe:a9fe',
      '2002:7f00:1::',
      'fe90::1',
      'febf::1',
      'fec0::1',
      'ff02::1',
    ]) {
      ok(
        `${address} is refused as a client_id host`,
        isPrivateAddress(address, 6)
      );
    }
    // The public side, from the hosts that matter. BlockList answers an IPv4
    // query against an IPv6 `::ffff:0:0/96` rule too, so one list for both
    // families refuses every IPv4 address there is, claude.ai's included.
    ok(
      'claude.ai’s IPv4 address is public, so hosted Claude can load its document',
      !isPrivateAddress('160.79.104.10', 4)
    );
    ok(
      'claude.ai’s IPv6 address is public',
      !isPrivateAddress('2607:6bc0::10', 6)
    );
    ok(
      'an address whose stated family is wrong is refused, not classified',
      isPrivateAddress('104.18.32.7', 6) &&
        isPrivateAddress('2606:4700:4700::1111', 4)
    );
    ok(
      'an address that does not parse is refused',
      isPrivateAddress('not an address', 4) && isPrivateAddress('', 0)
    );
  }

  // ------------------ OAuth: the CIMD fetch connects where it checked (STA-39 D)
  // In process, with fakes for the resolver and the request: no network and
  // no database. The one real request below goes to a loopback listener this
  // block opens, and the assertion is that it is never reached.
  {
    const { EventEmitter } = await import('events');
    const { Readable } = await import('stream');
    const net = await import('net');
    const {
      pinnedLookup,
      fetchCimdDocument,
      clientIdUrlProblem,
      validateCimdDocument,
      redirectUriAllowed,
      CimdError,
      CIMD_UNREACHABLE,
    } = await import('@/lib/oauth/clients');
    type Answer = Array<{ address: string; family: number }>;
    type ClientRequest = import('http').ClientRequest;
    type RequestOptions = import('http').RequestOptions;

    const PUBLIC: Answer = [{ address: '104.18.32.7', family: 4 }];
    const PUBLIC_V6 = { address: '2606:4700:4700::1111', family: 6 };
    const METADATA: Answer = [{ address: '169.254.169.254', family: 4 }];
    const DOC_URL = new URL('https://client.example/c');
    const DOC = JSON.stringify({
      client_id: DOC_URL.href,
      redirect_uris: ['https://client.example/cb'],
    });

    /**
     * Every await in this block goes through here. A promise that never
     * settles, with nothing else scheduled, ends the process with exit code
     * 0 and no output, which would read as a pass. The timer keeps the
     * process alive and turns a hang into a value the assertions can refuse.
     */
    const settle = (p: Promise<unknown>, ms = 1500): Promise<unknown> =>
      new Promise((done) => {
        const timer = setTimeout(() => done('hung'), ms);
        p.then(
          (value) => {
            clearTimeout(timer);
            done({ value });
          },
          (error: unknown) => {
            clearTimeout(timer);
            done(error);
          }
        );
      });
    const loaded = (r: unknown) =>
      r !== null && typeof r === 'object' && 'value' in r;

    /** Answers `first` to the first question and `later` to every one after. */
    const resolver = (first: Answer, later: Answer = first) => {
      let calls = 0;
      return {
        resolve: async (): Promise<Answer> => (calls++ === 0 ? first : later),
        calls: () => calls,
      };
    };

    interface Reply {
      status?: number;
      headers?: Record<string, string>;
      /** The body in chunks; null for a body that never ends. */
      body?: string[] | null;
      /** The peer the socket reports, when not the address it was handed. */
      peer?: string;
    }

    /**
     * Stands in for `https.request` in what the fetch relies on. The socket
     * asks `options.lookup` for an address; with no lookup passed it asks the
     * system resolver, which here answers the metadata address. It emits
     * `socket`, then `connect` with `remoteAddress` set to what it was handed
     * and `remoteFamily` as the string Node uses, then answers with `reply`.
     */
    const fakeRequest = (reply: Reply = {}) => {
      const system = resolver(METADATA);
      const seen = {
        connectedTo: null as string | null,
        systemCalls: () => system.calls(),
        destroyed: false,
        responded: false,
      };
      const request = (url: URL, options: RequestOptions): ClientRequest => {
        const req = Object.assign(new EventEmitter(), {
          destroyed: false,
          destroy(error?: Error) {
            if (req.destroyed) return;
            req.destroyed = true;
            seen.destroyed = true;
            if (error) process.nextTick(() => req.emit('error', error));
          },
          end() {
            const lookup: import('net').LookupFunction =
              options.lookup ??
              ((host, _o, cb) => {
                void system.resolve().then((a) => cb(null, a));
              });
            lookup(url.hostname, { all: true }, (error, addresses) => {
              if (req.destroyed) return;
              if (error) return req.destroy(error);
              const handed = (addresses as Answer)[0].address;
              const address = reply.peer ?? handed;
              const socket = Object.assign(new EventEmitter(), {
                connecting: true,
                remoteAddress: undefined as string | undefined,
                remoteFamily: undefined as string | undefined,
              });
              req.emit('socket', socket);
              socket.remoteAddress = address;
              socket.remoteFamily = net.isIP(address) === 6 ? 'IPv6' : 'IPv4';
              socket.connecting = false;
              seen.connectedTo = address;
              socket.emit('connect');
              if (req.destroyed) return;
              const res = Object.assign(
                reply.body === null
                  ? new Readable({ read() {} })
                  : Readable.from(
                      (reply.body ?? [DOC]).map((c) => Buffer.from(c))
                    ),
                {
                  statusCode: reply.status ?? 200,
                  headers: reply.headers ?? {
                    'content-type': 'application/json',
                  },
                }
              );
              seen.responded = true;
              req.emit('response', res);
            });
          },
        });
        return req as unknown as ClientRequest;
      };
      return { request, seen };
    };

    const fetchWith = (
      reply: Reply,
      answer: Answer = PUBLIC,
      deadlineMs = 1000,
      fake = fakeRequest(reply)
    ) =>
      settle(
        fetchCimdDocument(DOC_URL, {
          resolve: resolver(answer).resolve,
          request: fake.request,
          deadlineMs,
        })
      );

    // One resolution, and the socket goes where it said. The system resolver
    // answers the metadata address, so a socket that looked the host up again
    // on its own would connect there and be counted.
    const once = resolver(PUBLIC, METADATA);
    const pinned = fakeRequest();
    const first = await settle(
      fetchCimdDocument(DOC_URL, {
        resolve: once.resolve,
        request: pinned.request,
        deadlineMs: 1000,
      })
    );
    ok(
      'the CIMD fetch resolves the host once and connects to the address it checked',
      loaded(first) &&
        once.calls() === 1 &&
        pinned.seen.systemCalls() === 0 &&
        pinned.seen.connectedTo === '104.18.32.7'
    );
    const refusedFake = fakeRequest();
    const refusedEarly = await settle(
      fetchCimdDocument(DOC_URL, {
        resolve: resolver(METADATA).resolve,
        request: refusedFake.request,
        deadlineMs: 1000,
      })
    );
    ok(
      'a host that resolves to a non-public address is refused before any connection, so the assertion above is not vacuous',
      refusedEarly instanceof CimdError && refusedFake.seen.connectedTo === null
    );

    // The same with the real https.request: a loopback listener, a resolver
    // that answers loopback, and not one connection accepted.
    let accepted = 0;
    const listener = net.createServer((socket) => {
      accepted++;
      socket.destroy();
    });
    await settle(
      new Promise<void>((r) => listener.listen(0, '127.0.0.1', () => r()))
    );
    const { port } = listener.address() as import('net').AddressInfo;
    const real = await settle(
      fetchCimdDocument(new URL(`https://localhost:${port}/c`), {
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        deadlineMs: 1000,
      }),
      3000
    );
    // A connection the kernel took is accepted on a later turn of the event
    // loop, possibly after the fetch has already refused it, so the listener
    // gets a moment to see one before it is counted.
    await settle(new Promise((r) => setTimeout(r, 150)));
    await settle(new Promise((r) => listener.close(() => r(null))));
    ok(
      'a real request to a host that resolves to loopback is refused, and the listener never sees a connection',
      real instanceof CimdError && accepted === 0
    );

    // The lookup itself: the whole answer is refused when any of it is not
    // public, and an empty one is refused too.
    const lookupWith = (
      answer: Answer,
      options: import('dns').LookupOptions = { all: true }
    ) =>
      settle(
        new Promise<{ error: Error | null; address: unknown }>((done) =>
          pinnedLookup(async () => answer)(
            'client.example',
            options,
            (error, address) => done({ error, address })
          )
        )
      ).then((r) =>
        loaded(r)
          ? (r as { value: { error: Error | null; address: unknown } }).value
          : { error: null, address: 'hung' }
      );
    const mixed = await lookupWith([
      ...PUBLIC,
      { address: '10.0.0.1', family: 4 },
    ]);
    ok(
      'a lookup answer mixing a public and a private address is refused whole',
      mixed.error instanceof CimdError
    );
    ok(
      'an empty lookup answer is refused',
      (await lookupWith([])).error instanceof CimdError
    );
    ok(
      'a lookup answer of private addresses only is refused',
      (await lookupWith(METADATA)).error instanceof CimdError
    );
    const both = await lookupWith([...PUBLIC, PUBLIC_V6]);
    ok(
      'a public answer reaches the socket whole, so the refusals above are not vacuous',
      both.error === null &&
        Array.isArray(both.address) &&
        both.address.length === 2
    );
    const v6Only = await lookupWith([...PUBLIC, PUBLIC_V6], { family: 6 });
    ok(
      'a lookup for one family is answered with an address of that family',
      v6Only.error === null && v6Only.address === PUBLIC_V6.address
    );
    ok(
      'a lookup for a family the answer does not have is refused',
      (await lookupWith(PUBLIC, { family: 6 })).error instanceof CimdError
    );

    // The peer, checked again once connected.
    const peerFake = fakeRequest({ peer: '10.0.0.1' });
    const peer = await fetchWith({ peer: '10.0.0.1' }, PUBLIC, 1000, peerFake);
    ok(
      'a socket that reports a non-public peer is dropped, even after a public lookup',
      peer instanceof CimdError &&
        peerFake.seen.destroyed &&
        !peerFake.seen.responded
    );

    // The body: one deadline, a byte cap as it arrives, identity only, no
    // redirect. Each over-cap or encoded body is valid JSON, so nothing but
    // the rule under test refuses it.
    const padded = (bytes: number) => {
      const shell = JSON.stringify({ client_id: DOC_URL.href, pad: '' });
      return shell.replace(
        '"pad":""',
        `"pad":"${'x'.repeat(bytes - shell.length)}"`
      );
    };
    const big = padded(70 * 1024);
    const bigChunks = big.match(/[\s\S]{1,7168}/g) ?? [];
    const oversizeFake = fakeRequest({ body: bigChunks });
    const oversize = await fetchWith(
      { body: bigChunks },
      PUBLIC,
      1000,
      oversizeFake
    );
    ok(
      'a 70 KiB document sent in chunks with no declared length is refused, and the request dropped',
      oversize instanceof CimdError && oversizeFake.seen.destroyed
    );
    const declared = await fetchWith({
      headers: { 'content-length': '70000' },
    });
    ok(
      'a document that declares 70000 bytes is refused before its body is read',
      declared instanceof CimdError
    );
    const gzip = await fetchWith({ headers: { 'content-encoding': 'gzip' } });
    ok(
      'a document sent with a content-encoding other than identity is refused',
      gzip instanceof CimdError
    );
    const redirected = await fetchWith({
      status: 302,
      headers: { location: 'https://elsewhere.example/c' },
    });
    ok(
      'a redirect is refused, never followed',
      redirected instanceof CimdError
    );
    const stalledFake = fakeRequest({ body: null });
    const stalled = await fetchWith({ body: null }, PUBLIC, 50, stalledFake);
    ok(
      'a body that never ends is cut off by the deadline, which does not stop at the headers, and the request dropped',
      stalled instanceof CimdError && stalledFake.seen.destroyed
    );
    const oneKib = await fetchWith({ body: [padded(1024)] });
    ok(
      'a 1 KiB document loads, so the refusals above are not vacuous',
      loaded(oneKib) &&
        (oneKib as { value: { client_id?: string } }).value.client_id ===
          DOC_URL.href
    );

    // What the page may show: one phrase for every failure to load, the
    // specific reason for a document that loaded and is wrong.
    const failures = [
      refusedEarly,
      real,
      peer,
      oversize,
      declared,
      gzip,
      redirected,
      stalled,
    ];
    ok(
      'every failure to load a document carries the same public message',
      failures.every(
        (e) => e instanceof CimdError && e.publicMessage === CIMD_UNREACHABLE
      )
    );
    const notJson = await fetchWith({ body: ['<html>'] });
    const missing = await fetchWith({ status: 404 });
    ok(
      'a document that loaded and is wrong keeps its own message, which its developer needs',
      notJson instanceof CimdError &&
        notJson.publicMessage === 'client_id document is not JSON' &&
        missing instanceof CimdError &&
        missing.publicMessage === 'client_id document answered 404'
    );
    const authorizePage = withoutComments(
      readFileSync('app/oauth/authorize/page.tsx', 'utf8')
    );
    ok(
      'the authorize page shows only a CimdError’s public message, never an error’s own text',
      /error instanceof CimdError\s*\?\s*error\.publicMessage/.test(
        authorizePage
      ) && !authorizePage.includes('error.message')
    );

    // The client_id URL, before anything is fetched.
    for (const [id, why] of [
      ['http://client.example/c', 'plain http'],
      ['https://client.example', 'no path'],
      ['https://client.example/a/../b', 'a dot segment'],
      ['https://u:p@client.example/c', 'credentials'],
      ['https://client.example/c#f', 'a fragment'],
      ['https://client.example/c#', 'an empty fragment'],
      ['https://127.0.0.1/c', 'an IPv4 literal'],
      ['https://[::1]/c', 'an IPv6 literal'],
      ['https://2130706433/c', 'an integer IPv4 literal'],
      ['https://Client.example/c', 'an uppercase host'],
      ['https://client.example:443/c', 'an explicit default port'],
    ]) {
      ok(
        `a client_id URL with ${why} is refused before anything is fetched`,
        clientIdUrlProblem(id) !== null
      );
    }

    // The two Claude documents, exactly as claude.ai served them on
    // 2026-09-24: 342 and 317 bytes, 200, no redirect, no content-encoding.
    const hosted = {
      client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
      client_name: 'Claude',
      client_uri: 'https://claude.ai',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: [
        'authorization_code',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
      ],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
    const claudeCode = {
      client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
      client_name: 'Claude Code',
      client_uri: 'https://claude.ai',
      redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
    const accepts = (id: string, doc: unknown) => {
      try {
        validateCimdDocument(id, doc);
        return true;
      } catch {
        return false;
      }
    };
    ok(
      'both claude.ai client ids pass the URL rules unchanged',
      clientIdUrlProblem(hosted.client_id) === null &&
        clientIdUrlProblem(claudeCode.client_id) === null
    );
    ok(
      'hosted Claude’s document is accepted, and its callback matches',
      accepts(hosted.client_id, hosted) &&
        redirectUriAllowed(
          'https://claude.ai/api/mcp/auth_callback',
          hosted.redirect_uris
        )
    );
    ok(
      'Claude Code’s document is accepted, and a loopback callback on any port matches',
      accepts(claudeCode.client_id, claudeCode) &&
        redirectUriAllowed(
          'http://localhost:53682/callback',
          claudeCode.redirect_uris
        )
    );
    ok(
      'a copy of hosted Claude’s document served under another client_id is refused',
      !accepts('https://client.example/c', {
        ...hosted,
        client_id: 'https://client.example/c',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      }) &&
        !accepts(hosted.client_id, {
          ...hosted,
          client_id: 'https://client.example/c',
        })
    );
    ok(
      'a copy of hosted Claude’s document with a callback on another origin is refused',
      !accepts(hosted.client_id, {
        ...hosted,
        redirect_uris: ['https://elsewhere.example/cb'],
      })
    );
    const hostedBody = JSON.stringify(hosted);
    const servedHosted = await settle(
      fetchCimdDocument(new URL(hosted.client_id), {
        resolve: resolver([
          { address: '160.79.104.10', family: 4 },
          { address: '2607:6bc0::10', family: 6 },
        ]).resolve,
        request: fakeRequest({
          body: [hostedBody.slice(0, 200), hostedBody.slice(200)],
          headers: {
            'content-type': 'application/json',
            'transfer-encoding': 'chunked',
          },
        }).request,
        deadlineMs: 1000,
      })
    );
    ok(
      'hosted Claude’s document, served chunked from claude.ai’s addresses, loads and validates',
      hostedBody.length === 342 &&
        loaded(servedHosted) &&
        accepts(hosted.client_id, (servedHosted as { value: unknown }).value)
    );

    // The shape of the request, read from the code.
    const clientsCode = withoutComments(
      readFileSync('lib/oauth/clients.ts', 'utf8')
    );
    ok(
      'the metadata fetch never uses the global fetch, which cannot take a lookup',
      !/(^|[^\w.])fetch\(/m.test(clientsCode)
    );
    ok(
      'the metadata request carries the pinned lookup and no pooled agent',
      clientsCode.includes('lookup: pinnedLookup(resolve),') &&
        clientsCode.includes('agent: false,')
    );
  }

  // ---------------------------------------------------------- OAuth: the gate
  // The two predicates are opposite quantifiers and a mixed batch is the case
  // that separates them. Both answers must be the safe one.
  {
    const { isMetered, callsATool } = await import('@/lib/mcp-gate');
    const toolCall =
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}';
    const list = '{"jsonrpc":"2.0","id":2,"method":"tools/list"}';
    const mixed = `[${list},${toolCall}]`;

    ok('a lone tools/call is metered', isMetered(toolCall));
    ok(
      'a lone tools/list is not metered, so it meets the IP limit',
      !isMetered(list)
    );
    ok(
      'a batch mixing a handshake with a tool call is NOT treated as metered',
      !isMetered(mixed)
    );
    ok(
      'a batch mixing a handshake with a tool call IS challenged for a credential',
      callsATool(mixed)
    );
    ok('a lone handshake is not challenged', !callsATool(list));
    ok(
      'an unknown method is bounded by the IP limit',
      !isMetered('{"method":"x/y"}')
    );
    ok(
      'a body that is not JSON is bounded by the IP limit',
      !isMetered('not json')
    );
    ok('an empty batch is bounded by the IP limit', !isMetered('[]'));
  }

  // ---------------------------- OAuth: who pays for discovery (STA-39 C)
  // Hosted Claude calls every MCP server from Anthropic's shared outbound
  // range, so an address-keyed bucket is one bucket for every Claude user at
  // once. A credential that works is bounded per account; anything else, a string
  // that merely looks like a credential included, stays on the address.
  {
    const g = await import('@/lib/mcp-gate');
    const { IP_RATE_LIMITS } = await import('@/lib/ip-rate-limiter');
    const init = '{"jsonrpc":"2.0","id":7,"method":"initialize","params":{}}';
    const list = '{"jsonrpc":"2.0","id":2,"method":"tools/list"}';
    const toolCall =
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}';
    const mixed = `[${list},${toolCall}]`;
    const egress = '160.79.104.10';
    const acct = (userId: string) => ({ kind: 'account' as const, userId });

    const u1 = g.decide(list, acct('u1'), egress);
    const u2 = g.decide(list, acct('u2'), egress);
    ok(
      'two Claude users behind Anthropic’s shared egress never share a discovery bucket',
      u1.action === 'limit' &&
        u2.action === 'limit' &&
        u1.subject !== u2.subject &&
        u1.subject !== egress &&
        u1.endpoint === '/api/mcp:account' &&
        u2.endpoint === '/api/mcp:account'
    );
    const junk = g.decide(list, { kind: 'unverified' }, egress);
    ok(
      'Bearer hunter2 still buys nothing: an unverified credential shares the address bucket',
      junk.action === 'limit' &&
        junk.subject === egress &&
        junk.endpoint === '/api/mcp'
    );
    ok(
      'a mixed batch from an account is bounded, not passed',
      g.decide(mixed, acct('u1'), egress).action === 'limit'
    );
    const anon = g.decide(init, { kind: 'none' }, egress);
    ok(
      'a keyless handshake is still answered, lazy authentication kept',
      anon.action === 'limit' && anon.subject === egress
    );
    const keyless = g.decide(toolCall, { kind: 'none' }, egress);
    ok(
      'a keyless tool call is challenged, with no error code (RFC 6750 3.1)',
      keyless.action === 'challenge' && keyless.error === undefined
    );
    ok(
      'a mistyped key on a tool call passes to the handler, never a consent screen',
      g.decide(toolCall, { kind: 'unverified' }, egress).action === 'pass'
    );
    ok(
      'a working credential on a tool call passes, unbounded here',
      g.decide(toolCall, acct('u1'), egress).action === 'pass'
    );
    for (const reason of [
      'expired',
      'revoked',
      'unknown',
      'audience',
    ] as const) {
      const every = [init, list, toolCall, mixed, undefined].map((body) =>
        g.decide(body, { kind: 'dead-token', reason }, egress)
      );
      ok(
        `a ${reason} access token is refused with 401 invalid_token on every method, GET and DELETE included`,
        every.every(
          (d) => d.action === 'challenge' && d.error === 'invalid_token'
        )
      );
    }
    ok(
      'an account never gets less headroom than a stranger',
      IP_RATE_LIMITS['/api/mcp:account'].limit >=
        IP_RATE_LIMITS['/api/mcp'].limit
    );

    const limits = {
      anonymous: IP_RATE_LIMITS['/api/mcp'].limit,
      account: IP_RATE_LIMITS['/api/mcp:account'].limit,
    };
    const forAccount = g.refusalFor(acct('u'), limits);
    ok(
      'a connected account is never told to configure a key it already has',
      !/API key|configure/i.test(forAccount) &&
        forAccount.includes(String(limits.account))
    );
    const forAnon = g.refusalFor({ kind: 'none' }, limits);
    ok(
      'the anonymous refusal names its limit and both ways in',
      forAnon.includes(String(limits.anonymous)) &&
        forAnon.includes('sign-in') &&
        forAnon.includes('Authorization')
    );
    const forJunk = g.refusalFor({ kind: 'unverified' }, limits);
    ok(
      'a credential that did not work is told so, with its limit',
      forJunk.includes(String(limits.anonymous)) &&
        forJunk.includes('did not carry a working')
    );
    ok(
      'a refusal answers with the request’s own id, or null when there is none',
      g.requestIdOf(list) === 2 &&
        g.requestIdOf(mixed) === null &&
        g.requestIdOf(undefined) === null &&
        g.requestIdOf('not json') === null
    );

    const route = withoutComments(readFileSync('app/api/mcp/route.ts', 'utf8'));
    const guardedFn = route.slice(route.indexOf('async function guarded('));
    const at = (needle: string) => guardedFn.indexOf(needle);
    ok(
      'the route decides and challenges before it charges any bucket',
      at('decide(') !== -1 &&
        at("decision.action === 'challenge'") !== -1 &&
        at('decide(') < at('checkIpRateLimit(') &&
        at("decision.action === 'challenge'") < at('checkIpRateLimit(')
    );
    ok(
      'a bucket is keyed on the decision, never on the raw credential',
      guardedFn.includes(
        'checkIpRateLimit(decision.subject, decision.endpoint)'
      ) && !/checkIpRateLimit\([^)]*bearer/.test(route)
    );
    ok(
      'the credential is read for every method, after the POST branch closes',
      /body = await request\.text\(\);\s*\}\s*const cred = await credentialFor\(bearerFrom\(request\), body\);/.test(
        guardedFn
      )
    );
    const credFnC = route.slice(route.indexOf('async function credentialFor('));
    ok(
      'an access token is judged before the body is looked at, so GET and DELETE with a dead token are challenged',
      /if \(!bearer\) return \{ kind: 'none' \};\s*if \(looksLikeAccessToken\(bearer\)\) \{\s*const check = await validateAccessToken\(bearer\);/.test(
        credFnC
      )
    );
    ok(
      'the route answers every challenge decision, whatever the method',
      /if \(decision\.action === 'challenge'\) \{\s*return challenge\(decision\.error, decision\.description\);/.test(
        guardedFn
      )
    );
    ok(
      'only a key that validates names an account',
      route.includes(
        "return key ? { kind: 'account', userId: key.userId } : { kind: 'unverified' };"
      )
    );
    ok(
      'the old advice to configure an API key is gone',
      !route.includes('Configure a walletlink.social API key')
    );
    // The published numbers are the configured ones. The page stated 120 as a
    // literal nothing tied to the limiter; now both are asserted.
    const mdx = readFileSync('docs-site/mcp-server.mdx', 'utf8').replace(
      /\s+/g,
      ' '
    );
    ok(
      'the MCP page states both discovery limits exactly as configured',
      mdx.includes(
        `the limit is ${IP_RATE_LIMITS['/api/mcp:account'].limit} requests an hour per account`
      ) &&
        mdx.includes(
          `the limit is ${IP_RATE_LIMITS['/api/mcp'].limit} requests an hour per IP address`
        )
    );
    const keys = withoutComments(readFileSync('lib/api-keys.ts', 'utf8'));
    ok(
      'identifying a key names the account that owns it, not the key row',
      keys.includes(
        'return found ? { keyId: found.key.id, userId: found.key.userId } : null;'
      )
    );
    ok(
      'identifying a key applies exactly the rules validating it does',
      /export async function validateApiKey[\s\S]*?await lookupActiveKey\(rawKey\)/.test(
        keys
      ) &&
        /export async function identifyApiKey[\s\S]*?await lookupActiveKey\(rawKey\)/.test(
          keys
        )
    );
  }

  // ----------------------------------------------- OAuth: the credential shape
  {
    const { ACCEPTED_KEY_PREFIXES } = await import('@/lib/api-keys');
    const { ACCESS_TOKEN_PREFIX } = await import('@/lib/oauth/grants');

    // The two are written out separately to avoid an import cycle between the
    // credential format and the credential mint, and a cycle there resolves to
    // `undefined` at run time, turning the format check into
    // `startsWith(undefined)`. They must therefore be asserted to agree.
    ok(
      'validateApiKey accepts the prefix the OAuth mint actually issues',
      ACCEPTED_KEY_PREFIXES.includes(ACCESS_TOKEN_PREFIX)
    );
    ok(
      'the dashboard key prefix is still accepted, so existing installs keep working',
      ACCEPTED_KEY_PREFIXES.includes('wts_live_')
    );
    // Neither may be a prefix of the other, or the format check stops being
    // able to say which kind of credential arrived, and so does a log line.
    // Read out of the array rather than compared against the literal, because
    // TypeScript folds a literal comparison to a constant and an assertion that
    // cannot fail at run time is not an assertion.
    const [live, oauth] = ACCEPTED_KEY_PREFIXES;
    ok(
      'neither credential prefix is a prefix of the other',
      !live.startsWith(oauth) && !oauth.startsWith(live)
    );

    // An OAuth access token must not be ranked against the account's own keys.
    // Without the exclusion, connecting a client pushes a dashboard key past
    // the cap and revokes a credential somebody is actively using.
    const keys = readFileSync('lib/api-keys.ts', 'utf8');
    // From the CTE to the UPDATE it feeds, rather than to the first closing
    // paren: the subquery contains a window function, so a lazy `\)` stops
    // inside `row_number() OVER (...)` and the match excludes the WHERE clause
    // this is about. That version of the regex passed against correct code and
    // would have passed against the bug too.
    const ranked =
      keys.match(/WITH ranked AS \(([\s\S]*?)UPDATE api_keys/)?.[1] ?? '';
    ok(
      'the key cap ranks only keys a person made, not OAuth access tokens',
      ranked.includes('oauth_grant_id IS NULL')
    );
    // Bounded to the function body, and read with comments stripped. Both
    // matter, and the second one is why this broke: `keys` above is the RAW
    // file, so the moment another function's doc comment mentioned
    // `listApiKeys` by name, the regex anchored inside that comment and ran
    // forward to a DIFFERENT function's `isNull(apiKeys.oauthGrantId)`. The
    // assertion then passed with this filter deleted. `rotateApiKey` gained
    // such a comment on 2026-08-31 and the guard caught it the same day.
    const listSrc = (() => {
      const stripped = withoutComments(keys);
      const from = stripped.indexOf('export async function listApiKeys');
      if (from === -1) return '';
      const next = stripped.indexOf('\nexport ', from + 1);
      return stripped.slice(from, next === -1 ? undefined : next);
    })();
    ok(
      'the key list hides OAuth access tokens, which nobody can copy or usefully revoke',
      /isNull\(apiKeys\.oauthGrantId\)/.test(listSrc)
    );
  }

  // -------------------------------------------------- OAuth: the CSRF argument
  // `/api/oauth/authorize` carries no CSRF token and says so, on the grounds
  // that the session cookie is not attached to a cross-site POST. That is only
  // true while the cookie says so.
  {
    const { SESSION_COOKIE_OPTIONS } = await import('@/lib/auth');
    ok(
      "the session cookie is sameSite lax or stricter, which is the consent screen's CSRF defence",
      SESSION_COOKIE_OPTIONS.sameSite === 'lax' ||
        SESSION_COOKIE_OPTIONS.sameSite === 'strict'
    );
    ok(
      'the session cookie is httpOnly, so a token cannot be read out of the page',
      SESSION_COOKIE_OPTIONS.httpOnly === true
    );
  }

  // ----------------------------------- OAuth: a refresh is one statement, bound
  // A refresh used to rotate, retire and mint in three statements. A mint that
  // failed after the rotation committed left the client holding the "previous"
  // token, and its retry revoked the connection. The rotation and the mint are
  // one statement now, and the refresh is bound to its client and resource
  // before anything is spent or revoked.
  {
    const grants = withoutComments(readFileSync('lib/oauth/grants.ts', 'utf8'));
    const rotateFn = grants.slice(
      grants.indexOf('async function rotateAndMint'),
      grants.indexOf('export async function refreshGrant')
    );
    const templates = [...rotateFn.matchAll(/sql`([\s\S]*?)`/g)].map(
      (m) => m[1]
    );
    ok(
      'the rotation and the access-token mint are one statement, so a failed mint cannot burn the refresh token',
      templates.some(
        (t) =>
          t.includes('UPDATE oauth_grants') &&
          t.includes('INSERT INTO api_keys')
      )
    );
    const rotateSql =
      templates.find((t) => t.includes('UPDATE oauth_grants')) ?? '';
    const rotatedCte = rotateSql.slice(
      rotateSql.indexOf('WITH rotated AS ('),
      rotateSql.indexOf('retired AS (')
    );
    const mintedCte = rotateSql.slice(rotateSql.indexOf('minted AS ('));
    ok(
      'the rotation matches only the current refresh token of a grant that is neither revoked nor expired',
      rotatedCte.includes('WHERE refresh_token_hash = ${input.hash}') &&
        rotatedCte.includes('AND revoked_at IS NULL') &&
        rotatedCte.includes('AND refresh_expires_at > now()')
    );
    ok(
      'old access tokens are retired only for the grant this statement rotated',
      rotateSql.includes('WHERE oauth_grant_id IN (SELECT id FROM rotated)')
    );
    ok(
      'the rotation re-checks the client inside the statement, so the binding holds under a race',
      /IS NULL OR client_id = \$\{input\.clientId\}/.test(rotatedCte)
    );
    ok(
      'the refresh token gets the refresh lifetime and the access token the access lifetime, each from Postgres',
      rotatedCte.includes(
        'refresh_expires_at = now() + make_interval(secs => ${refreshTtlS})'
      ) &&
        mintedCte.includes('now() + make_interval(secs => ${accessTtlS})') &&
        !mintedCte.includes('refreshTtlS') &&
        rotateFn.includes(
          'const refreshTtlS = Math.floor(REFRESH_TOKEN_TTL_MS / 1000);'
        ) &&
        rotateFn.includes(
          'const accessTtlS = Math.floor(ACCESS_TOKEN_TTL_MS / 1000);'
        )
    );
    ok(
      'the rotation aliases need no quoting (a folded camelCase alias reads undefined)',
      !/\bAS\s+[a-z]+[A-Z]\w*/.test(rotateSql)
    );
    ok(
      'the refreshed access token is linked to its grant, so revoking the grant ends it on /v1 too',
      /INSERT INTO api_keys \(key, key_prefix, name, user_id, plan, expires_at, oauth_grant_id\)\s*SELECT [\s\S]*?, id\s*FROM rotated/.test(
        mintedCte
      )
    );

    const refresh = grants.slice(
      grants.indexOf('export async function refreshGrant'),
      grants.indexOf('export async function revokeGrant')
    );
    ok(
      'the hashes a refresh writes are the hashes of the tokens it returns',
      rotatedCte.includes('SET refresh_token_hash = ${input.nextHash},') &&
        rotatedCte.includes('previous_refresh_token_hash = ${input.hash},') &&
        refresh.includes('nextHash: sha256(next),') &&
        refresh.includes('accessHash: hashApiKey(access),') &&
        refresh.includes('accessToken: access,') &&
        refresh.includes('refreshToken: next,')
    );
    ok(
      'no JS Date crosses into the rotation, from inside it or from its caller',
      !/new Date\(|Date\.now\(\)/.test(rotateFn + refresh)
    );
    ok(
      'refreshGrant no longer rotates or mints in separate statements, in the builder or in raw SQL',
      !/\.update\(oauthGrants\)/.test(refresh) &&
        !/UPDATE oauth_grants|INSERT INTO api_keys/i.test(refresh) &&
        !refresh.includes('mintAccessToken(') &&
        refresh.includes('await rotateAndMint(')
    );
    const at = (needle: string) => refresh.indexOf(needle);
    const beforeRotation = refresh.slice(0, at('await rotateAndMint('));
    for (const [what, needle] of [
      ['the client binding', 'input.clientId !== row.clientId'],
      ['the grant resource', 'isOurResource(row.resource)'],
      [
        'every requested resource',
        'resourcesAreOurs(input.resources, row.resource!)',
      ],
    ] as const) {
      ok(
        `${what} is checked before anything is spent or revoked`,
        beforeRotation.includes(needle)
      );
    }
    ok(
      'nothing before the rotation revokes or writes, so a probe with a wrong binding ends no connection',
      !/revokeGrant\(|revokeAccessTokens\(|\.update\(|\.insert\(|\.delete\(|\.execute\(/.test(
        beforeRotation
      )
    );
    ok(
      'a grant made for another server is recognized before the requested resource is compared, so it answers invalid_grant',
      at('isOurResource(row.resource)') < at('resourcesAreOurs(input.resources')
    );
    ok(
      'a refresh without client_id is still accepted (OAuth 2.1 section 3.2.2), which hosted Claude may rely on',
      refresh.includes(
        'if (input.clientId !== null && input.clientId !== row.clientId) {'
      ) &&
        !/input\.clientId === null|input\.clientId == null|!input\.clientId\b/.test(
          refresh
        )
    );
    ok(
      'a wrong client is refused, as wrong_client',
      /return \{ ok: false, reason: 'wrong_client' \}/.test(refresh)
    );

    // One predicate, shared with grantIdForRefreshToken, so the token
    // endpoint's limiter and revocation name the grant a refresh acts on.
    const refreshMatch = grants.slice(
      grants.indexOf('function matchesRefreshHash('),
      grants.indexOf('export async function grantIdForRefreshToken')
    );
    // Reuse detection: a presented previous token revokes the grant, read from
    // a fresh query after the rotation found nothing.
    ok(
      'the pre-read finds a grant by its current or its previous refresh token, so a reuse reaches the reuse branch',
      beforeRotation.includes('.where(matchesRefreshHash(hash))') &&
        refreshMatch.includes(
          'return sql`${oauthGrants.refreshTokenHash} = ${hash} OR ${oauthGrants.previousRefreshTokenHash} = ${hash} OR ${oauthGrants.refreshGraceHashes} @> ARRAY[${hash}]::text[]`;'
        )
    );
    const afterRotation = refresh.slice(at('await rotateAndMint('));
    const reusedAt = afterRotation.indexOf('const [reused]');
    const revokeAt = afterRotation.indexOf('await revokeGrant(');
    const reuseLookup = afterRotation.slice(reusedAt, revokeAt);
    ok(
      'a reuse is classified by a fresh read of the previous-token column, and only that revokes',
      reusedAt > -1 &&
        reusedAt < revokeAt &&
        reuseLookup.includes(
          'sql`${oauthGrants.previousRefreshTokenHash} = ${hash} OR ${oauthGrants.refreshGraceHashes} @> ARRAY[${hash}]::text[]`'
        ) &&
        !reuseLookup.includes('eq(oauthGrants.refreshTokenHash') &&
        refresh.split('revokeGrant(').length === 2 &&
        /if \(reused\.direct === true\) \{\s*await revokeGrant\(reused\.id, 'refresh token reused'\);\s*return \{ ok: false, reason: 'reused' \}/.test(
          afterRotation
        )
    );
    const staleAt = afterRotation.indexOf('const [stale]');
    ok(
      'a current token that did not rotate is read as expired, from the current-token column, without revoking',
      staleAt > revokeAt &&
        afterRotation
          .slice(staleAt, afterRotation.indexOf("reason: 'expired'"))
          .includes('eq(oauthGrants.refreshTokenHash, hash)')
    );

    const token = withoutComments(
      readFileSync('app/api/oauth/token/route.ts', 'utf8')
    );
    const exchange = token.slice(
      token.indexOf('async function exchangeRefresh')
    );
    ok(
      'the refresh passes client_id with an empty value as absent, and every resource value',
      exchange.includes("clientId: form.get('client_id') || null,\n") &&
        exchange.includes("resources: form.getAll('resource'),\n")
    );
    ok(
      'the shared answer is 503 temporarily_unavailable with Retry-After, not a bare 500',
      /function tokenServiceUnavailable\(\)[\s\S]{0,300}?'temporarily_unavailable'[\s\S]{0,200}?status: 503, headers: \{ \.\.\.NO_STORE, 'Retry-After': '5' \}/.test(
        token
      )
    );
    ok(
      'a request naming another resource answers invalid_target',
      /result\.reason === 'wrong_resource'\) \{\s*return oauthError\(\s*'invalid_target'/.test(
        exchange
      )
    );
    ok(
      'a grant made for another server answers invalid_grant, so a client starts over instead of looping',
      exchange.includes("result.reason === 'wrong_grant_resource'") &&
        !/wrong_grant_resource'\) \{\s*return oauthError\(\s*'invalid_target'/.test(
          exchange
        )
    );

    // The token endpoint: one value per parameter, and one resource rule.
    const {
      repeatedFormParam,
      TOKEN_ONCE_PARAMS,
      resourcesAreOurs,
      sentValues,
    } = await import('@/lib/oauth/params');
    for (const key of TOKEN_ONCE_PARAMS) {
      ok(
        `a repeated ${key} on a token request is found`,
        repeatedFormParam(new URLSearchParams(`${key}=a&${key}=b`)) === key
      );
    }
    ok(
      'every token parameter that must appear once is on the list',
      [
        'grant_type',
        'code',
        'code_verifier',
        'redirect_uri',
        'client_id',
        'refresh_token',
      ].every((k) => (TOKEN_ONCE_PARAMS as readonly string[]).includes(k))
    );
    ok(
      'a repeated resource on a token request is allowed, and is checked value by value instead',
      repeatedFormParam(
        new URLSearchParams('grant_type=refresh_token&resource=a&resource=b')
      ) === null
    );
    const repeatedAt = token.indexOf(
      'const repeated = repeatedFormParam(form);'
    );
    ok(
      'the token endpoint refuses a repeated parameter before either grant type is handled',
      repeatedAt > -1 &&
        repeatedAt < token.indexOf("if (grantType === 'authorization_code')") &&
        /const repeated = repeatedFormParam\(form\);\s*if \(repeated\) \{\s*return oauthError\(\s*'invalid_request'/.test(
          token
        )
    );
    const codeExchange = token.slice(
      token.indexOf('async function exchangeCode'),
      token.indexOf('async function exchangeRefresh')
    );
    ok(
      'the code exchange checks every resource value by the rule authorization and refresh use, not by exact string',
      /!resourcesAreOurs\(form\.getAll\('resource'\), row\.resource\)\s*\) \{\s*return oauthError\(\s*'invalid_target'/.test(
        codeExchange
      ) && !codeExchange.includes('resource !== row.resource')
    );
    const page = withoutComments(
      readFileSync('app/oauth/authorize/page.tsx', 'utf8')
    );
    ok(
      'an empty resource at authorization is stored as ours, not as an empty string',
      page.includes('resource: resource || mcpResource(),')
    );

    const { sameResource, isOurResource } = await import('@/lib/oauth/params');
    const { mcpResource, issuer } = await import('@/lib/oauth/metadata');
    const ours = 'https://walletlink.social/api/mcp';
    ok(
      'a parameter sent without a value counts as omitted (OAuth 2.1 section 3.2)',
      resourcesAreOurs('', ours) &&
        resourcesAreOurs(['', ours], ours) &&
        resourcesAreOurs(null, ours) &&
        JSON.stringify(sentValues(['', 'a', ''])) === '["a"]'
    );
    ok(
      'a refresh naming ours and another server is refused as a whole, in either order',
      !resourcesAreOurs([ours, 'https://evil.example/mcp'], ours) &&
        !resourcesAreOurs(['https://evil.example/mcp', ours], ours)
    );
    ok(
      'sameResource tolerates a trailing slash, host case and the default port',
      sameResource(`${ours}/`, ours) &&
        sameResource('https://WALLETLINK.social/api/mcp', ours) &&
        sameResource('https://walletlink.social:443/api/mcp', ours)
    );
    for (const r of [
      'https://www.walletlink.social/api/mcp',
      'https://wallet-to-social-git-x.vercel.app/api/mcp',
      'https://walletlink.social/api/mcp-evil',
      'https://walletlink.social/v1',
      'http://walletlink.social/api/mcp',
      'https://walletlink.social/api/mcp#frag',
      'https://walletlink.social/api/mcp#',
      'https://walletlink.social/api/mcp?#',
      'https://walletlink.social/api/mcp/#',
      'not a url',
    ]) {
      ok(`sameResource refuses ${r}`, !sameResource(r, ours));
    }
    ok('a grant with no resource is not ours', !isOurResource(null));
    ok(
      "isOurResource accepts this server's MCP endpoint, with or without a trailing slash",
      isOurResource(mcpResource()) && isOurResource(`${mcpResource()}/`)
    );
    ok(
      'isOurResource refuses another host, the bare site and a fragment',
      !isOurResource('https://wallet-to-social-git-x.vercel.app/api/mcp') &&
        !isOurResource(issuer()) &&
        !isOurResource(`${mcpResource()}#`)
    );

    const validate = grants.slice(
      grants.indexOf('export async function validateAccessToken'),
      grants.indexOf('export async function listGrants')
    );
    ok(
      'an access token names the account that owns it, not the token row',
      validate.includes('userId: apiKeys.userId') &&
        validate.includes('userId: row.userId')
    );
    ok(
      'validateAccessToken reads the grant resource and refuses a token for another server before calling it valid',
      validate.includes('resource: oauthGrants.resource') &&
        validate.indexOf('isOurResource(row.resource)') !== -1 &&
        validate.indexOf('isOurResource(row.resource)') <
          validate.lastIndexOf('return { ok: true')
    );
    const mcp = withoutComments(readFileSync('app/api/mcp/route.ts', 'utf8'));
    const credFn = mcp.slice(mcp.indexOf('async function credentialFor('));
    ok(
      'the MCP route counts a token as an account only on check.ok, never on a failure reason',
      /const check = await validateAccessToken\(bearer\);\s*return check\.ok\s*\? \{ kind: 'account', userId: check\.userId \}\s*: \{ kind: 'dead-token', reason: check\.reason \};/.test(
        credFn
      )
    );
  }

  // --------------------------------------------- OAuth: the exchange ordering
  // The first version of the token endpoint consumed the code and validated
  // afterwards. A single attempt with a wrong verifier therefore burned the
  // code AND made the real client's retry look like a replay, which revoked
  // the grant: anybody who could see a code could destroy the connection
  // behind it while holding nothing else. The order is the fix, so the order
  // is what is asserted.
  {
    const token = readFileSync('app/api/oauth/token/route.ts', 'utf8');
    const body = token.slice(
      token.indexOf('async function exchangeCode'),
      token.indexOf('async function exchangeRefresh')
    );
    const at = (needle: string) => body.indexOf(needle);

    ok(
      'the exchange reads the code before spending it',
      at('await loadCode(') !== -1 &&
        at('await redeemCode(') !== -1 &&
        at('await loadCode(') < at('await redeemCode(')
    );
    ok(
      'the client binding is checked before the code is spent',
      at('row.clientId !== clientId') !== -1 &&
        at('row.clientId !== clientId') < at('await redeemCode(')
    );
    ok(
      'the redirect binding is checked before the code is spent',
      at('redirectUri !== row.redirectUri') !== -1 &&
        at('redirectUri !== row.redirectUri') < at('await redeemCode(')
    );
    ok(
      'PKCE is checked before the code is spent',
      at('pkceMatches(') !== -1 && at('pkceMatches(') < at('await redeemCode(')
    );
    ok(
      'the resource binding is checked before the code is spent',
      at("resourcesAreOurs(form.getAll('resource'), row.resource)") !== -1 &&
        at("resourcesAreOurs(form.getAll('resource'), row.resource)") <
          at('await redeemCode(')
    );
    ok(
      'nothing is revoked before the caller has proved it is the right client',
      at('revokeGrant(') !== -1 &&
        at('await redeemCode(') !== -1 &&
        at('await redeemCode(') < at('revokeGrant(')
    );

    // A failed consume has three causes and only one of them is a replay.
    // Reading it as a boolean revoked the grant of any first exchange that
    // arrived a moment past the window, and let a replay that arrived late
    // pass without revoking anything.
    ok(
      'only a replay revokes, not every failure to spend the code',
      body.includes("spent.outcome === 'replayed'") &&
        body.indexOf("spent.outcome === 'replayed'") < at('revokeGrant(') &&
        withoutComments(body).split('revokeGrant(').length === 2
    );
    ok(
      'an expired code is answered without revoking anything',
      body.includes("spent.outcome !== 'issued'") &&
        body.indexOf('revokeGrant(') <
          body.indexOf("spent.outcome !== 'issued'")
    );

    // Two clocks decided this before: the Node clock in `loadCode` and
    // Postgres's in the UPDATE. A code near its boundary passed one and failed
    // the other, and the disagreement was read as a replay.
    const requests = readFileSync('lib/oauth/requests.ts', 'utf8');
    const loadBody = requests.slice(
      requests.indexOf('export async function loadCode'),
      requests.indexOf('export type UnspentReason')
    );
    ok(
      'loadCode judges no expiry, so one clock decides',
      loadBody.length > 0 &&
        !loadBody.includes('Date.now()') &&
        !loadBody.includes('codeExpiresAt')
    );
    // And the replay branch has to be read before the expiry branch, or a code
    // that was spent and has since aged out reports as merely expired.
    const consumeBody = requests.slice(
      requests.indexOf('export async function unspentCodeReason'),
      requests.indexOf('export async function cleanupAuthorizationRequests')
    );
    ok(
      'a spent code reports as replayed even once it has aged out',
      consumeBody.indexOf("return 'replayed'") !== -1 &&
        consumeBody.indexOf("return 'replayed'") <
          consumeBody.indexOf("return 'expired'")
    );
    ok(
      'an unknown code is unknown, a spent code is a replay at any age, and no clock is read',
      consumeBody.includes("if (!existing) return 'unknown';") &&
        consumeBody.includes("if (existing.consumedAt) return 'replayed';") &&
        (consumeBody.match(/return 'replayed'/g) ?? []).length === 1 &&
        !/Date|codeExpiresAt/.test(withoutComments(consumeBody))
    );

    // RFC 6749 section 4.1.3 requires `redirect_uri` on the exchange whenever
    // the authorization request carried one, and ours always does. Comparing
    // it only when the caller chose to send it made the binding optional at
    // the attacker's discretion, which is the same as not having it.
    ok(
      'redirect_uri is required on the exchange, not compared only when supplied',
      body.includes('if (!redirectUri)') &&
        !/redirectUri !== null &&/.test(body)
    );
  }

  // ------------------------------- OAuth: the endpoint limits (Linear STA-39)
  // Hosted clients exchange, refresh and revoke from their provider's shared
  // outbound addresses, so the token endpoint counts per connection, never
  // per address and never per client_id, and it sorts every request before it
  // charges anything. Registration charges only a write, and the two
  // endpoints that had no bound have one.
  {
    const {
      ACCESS_TOKEN_PREFIX,
      REFRESH_TOKEN_PREFIX,
      REFRESH_GRACE_HASHES,
      isWellFormedAccessToken,
      isWellFormedRefreshToken,
      newToken,
    } = await import('@/lib/oauth/grants');
    const { isWellFormedCode, newAuthorizationCode } =
      await import('@/lib/oauth/requests');
    const { IP_RATE_LIMITS, clientIpFromHeaders } =
      await import('@/lib/ip-rate-limiter');

    // The shapes, refused. Each of these reaches no row, so none may cost a
    // read or a charge.
    const initialize =
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';
    const body43 = 'A'.repeat(43);
    for (const [what, raw] of [
      ['a JSON-RPC initialize body', initialize],
      ['an empty string', ''],
      ['the prefix alone', REFRESH_TOKEN_PREFIX],
      ['the prefix and 42 characters', REFRESH_TOKEN_PREFIX + 'A'.repeat(42)],
      ['the prefix and 44 characters', REFRESH_TOKEN_PREFIX + 'A'.repeat(44)],
      ['an access token', ACCESS_TOKEN_PREFIX + body43],
      [
        'standard base64 characters',
        REFRESH_TOKEN_PREFIX + '+/' + 'A'.repeat(41),
      ],
      ['padding', REFRESH_TOKEN_PREFIX + 'A'.repeat(42) + '='],
      ['a trailing newline', REFRESH_TOKEN_PREFIX + body43 + '\n'],
    ] as const) {
      ok(
        `${what} is not a well-formed refresh token`,
        !isWellFormedRefreshToken(raw)
      );
    }
    ok(
      'a refresh token is not a well-formed access token, and a JSON-RPC body is neither',
      !isWellFormedAccessToken(REFRESH_TOKEN_PREFIX + body43) &&
        !isWellFormedAccessToken(initialize) &&
        !isWellFormedAccessToken(ACCESS_TOKEN_PREFIX)
    );
    for (const [what, raw] of [
      ['a JSON-RPC initialize body', initialize],
      ['an empty string', ''],
      ['a code containing a dot', 'A'.repeat(21) + '.' + 'A'.repeat(21)],
      ['a code of 42 characters', 'A'.repeat(42)],
      ['a code of 44 characters', 'A'.repeat(44)],
      ['a refresh token', newToken(REFRESH_TOKEN_PREFIX)],
    ] as const) {
      ok(`${what} is not a well-formed code`, !isWellFormedCode(raw));
    }

    // The shapes, accepted, through the real mints. Many draws, so every
    // character the alphabet can produce, `-` and `_` included, has appeared.
    let minted = true;
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const refresh = newToken(REFRESH_TOKEN_PREFIX);
      const access = newToken(ACCESS_TOKEN_PREFIX);
      const code = newAuthorizationCode();
      minted &&=
        isWellFormedRefreshToken(refresh) &&
        isWellFormedAccessToken(access) &&
        isWellFormedCode(code);
      for (const c of code) seen.add(c);
    }
    ok(
      'every token and code the mints produce is well formed, across the whole alphabet',
      minted && seen.has('-') && seen.has('_') && seen.size === 64
    );

    // The mints tested above are the mints in use, and the only ones.
    const requestsSrc = withoutComments(
      readFileSync('lib/oauth/requests.ts', 'utf8')
    );
    const grantsSrc = withoutComments(
      readFileSync('lib/oauth/grants.ts', 'utf8')
    );
    ok(
      'issueCode mints with newAuthorizationCode, and nothing else in requests.ts draws random bytes',
      /export async function issueCode[\s\S]*?const code = newAuthorizationCode\(\);/.test(
        requestsSrc
      ) && (requestsSrc.match(/randomBytes\(/g) ?? []).length === 1
    );
    ok(
      'every refresh and access token is minted by newToken, the one draw of random bytes in grants.ts',
      (grantsSrc.match(/randomBytes\(/g) ?? []).length === 1 &&
        (grantsSrc.match(/newToken\(REFRESH_TOKEN_PREFIX\)/g) ?? []).length ===
          2 &&
        (grantsSrc.match(/newToken\(ACCESS_TOKEN_PREFIX\)/g) ?? []).length === 2
    );

    // grantIdForRefreshToken names the grant refreshGrant would act on.
    const lookup = grantsSrc.slice(
      grantsSrc.indexOf('export async function grantIdForRefreshToken'),
      grantsSrc.indexOf('export interface IssuedTokens')
    );
    ok(
      'grantIdForRefreshToken matches by the same predicate as a refresh, the burst included, returns the grant id, and only reads',
      lookup.includes('.select({ id: oauthGrants.id })') &&
        lookup.includes('return row?.id ?? null;') &&
        lookup.includes('.where(matchesRefreshHash(sha256(raw)))') &&
        (grantsSrc.match(/matchesRefreshHash\(/g) ?? []).length === 3 &&
        !/\.update\(|\.insert\(|\.delete\(|\.execute\(|revokeGrant\(/.test(
          lookup
        )
    );

    // The token route.
    const token = withoutComments(
      readFileSync('app/api/oauth/token/route.ts', 'utf8')
    );
    const post = token.slice(
      token.indexOf('export async function POST'),
      token.indexOf('function tokenServiceUnavailable')
    );
    ok(
      'the token endpoint charges nothing before the form is parsed',
      post.includes('new URLSearchParams(') &&
        !post.includes('checkIpRateLimit(') &&
        !post.includes('unknownCredential(') &&
        post.indexOf('new URLSearchParams(') <
          post.indexOf('exchangeCode(form, ip)')
    );
    ok(
      'a public client_id never keys a limit',
      !/checkIpRateLimit\([^;]*client_?[iI]d/.test(token) &&
        Object.keys(IP_RATE_LIMITS).every((k) => !/client/i.test(k))
    );
    const grantCharges = [
      ...token.matchAll(
        /checkIpRateLimit\(\s*([^,]+),\s*'\/api\/oauth\/token:grant'\s*\)/g
      ),
    ].map((m) => m[1].trim());
    ok(
      'both grant types count a credential that names a grant against that grant',
      grantCharges.length === 2 &&
        grantCharges.every((s) => s.startsWith('`grant:${'))
    );
    const helper = token.slice(
      token.indexOf('async function unknownCredential'),
      token.indexOf('export async function POST')
    );
    ok(
      'a well-formed credential that names nothing is counted per address, then answered invalid_grant',
      /const limit = await checkIpRateLimit\(ip, '\/api\/oauth\/token'\);\s*if \(!limit\.allowed\) \{\s*return tooManyRequests\(/.test(
        helper
      ) &&
        helper.indexOf("checkIpRateLimit(ip, '/api/oauth/token')") <
          helper.indexOf("oauthError('invalid_grant', description)") &&
        (token.match(/checkIpRateLimit\(/g) ?? []).length === 3
    );
    ok(
      'a limited token request still answers 429 temporarily_unavailable with Retry-After',
      /function tooManyRequests\([\s\S]*?error: 'temporarily_unavailable'[\s\S]*?status: 429,[\s\S]*?'Retry-After': String\(limit\.retryAfter\)/.test(
        token
      )
    );

    const code = token.slice(
      token.indexOf('async function exchangeCode'),
      token.indexOf('async function exchangeRefresh')
    );
    const inCode = (needle: string) => code.indexOf(needle);
    ok(
      'a malformed code is refused invalid_grant before any read or charge',
      /if \(!isWellFormedCode\(code\)\) \{\s*return oauthError\('invalid_grant'/.test(
        code
      ) &&
        inCode('if (!isWellFormedCode(code))') > inCode('if (!redirectUri)') &&
        inCode('if (!isWellFormedCode(code))') < inCode('await loadCode(') &&
        inCode('await loadCode(') < inCode('checkIpRateLimit(')
    );
    ok(
      'a code that names nothing, or a caller that fails the client, redirect or verifier check, is counted per address; only a proven caller is counted against the connection, before anything is spent',
      /if \(!loaded\.ok\) \{\s*return unknownCredential\(ip, /.test(code) &&
        /if \(row\.clientId !== clientId\) \{\s*return unknownCredential\(\s*ip,/.test(
          code
        ) &&
        /if \(redirectUri !== row\.redirectUri\) \{\s*return unknownCredential\(\s*ip,/.test(
          code
        ) &&
        /if \(!pkceMatches\(verifier, row\.codeChallenge\)\) \{\s*return unknownCredential\(\s*ip,/.test(
          code
        ) &&
        inCode('pkceMatches(') < inCode('checkIpRateLimit(') &&
        inCode('row.clientId !== clientId') < inCode('checkIpRateLimit(') &&
        inCode('checkIpRateLimit(') < inCode('await redeemCode(') &&
        /if \(!perGrant\.allowed\) return tooManyRequests\(/.test(code)
    );
    const refresh = token.slice(
      token.indexOf('async function exchangeRefresh')
    );
    const inRefresh = (needle: string) => refresh.indexOf(needle);
    ok(
      'a malformed refresh token is refused invalid_grant before any read or charge',
      /if \(!isWellFormedRefreshToken\(token\)\) \{\s*return oauthError\('invalid_grant'/.test(
        refresh
      ) &&
        inRefresh('isWellFormedRefreshToken(token)') <
          inRefresh('grantIdForRefreshToken(')
    );
    ok(
      'a refresh token that names nothing is counted per address; one that names a grant is counted before refreshGrant decides anything',
      /if \(!grantId\) \{\s*return unknownCredential\(ip, /.test(refresh) &&
        inRefresh('grantIdForRefreshToken(') < inRefresh('checkIpRateLimit(') &&
        inRefresh('checkIpRateLimit(') < inRefresh('await refreshGrant(') &&
        /if \(!perGrant\.allowed\) return tooManyRequests\(/.test(refresh)
    );
    ok(
      'a connection’s own bucket holds several bursts of parallel refreshes',
      IP_RATE_LIMITS['/api/oauth/token:grant'].limit >= 3 * REFRESH_GRACE_HASHES
    );

    // Registration: charged after the last validation, before the write.
    const register = withoutComments(
      readFileSync('app/api/oauth/register/route.ts', 'utf8')
    );
    const registerLimit = register.indexOf('checkIpRateLimit(');
    ok(
      'registration still carries its per-address limit, charged once, after every validation and before the insert',
      /const limit = await checkIpRateLimit\(\s*getClientIp\(request\),\s*'\/api\/oauth\/register'\s*\);\s*if \(!limit\.allowed\) \{\s*return NextResponse\.json\(\s*\{\s*error: 'temporarily_unavailable',/.test(
        register
      ) &&
        register.split('checkIpRateLimit(').length === 2 &&
        register.lastIndexOf('return invalid(') < registerLimit &&
        register.lastIndexOf("'invalid_client_metadata'") < registerLimit &&
        registerLimit < register.indexOf('db.insert(oauthClients)')
    );

    // The client address: one set of rules, shared by the page and the routes.
    ok(
      'a caller-supplied first hop does not choose the bucket',
      clientIpFromHeaders(
        new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })
      ) === '203.0.113.9'
    );
    ok(
      'the platform header wins over a caller-supplied X-Forwarded-For',
      clientIpFromHeaders(
        new Headers({
          'x-vercel-forwarded-for': '198.51.100.7',
          'x-forwarded-for': '6.6.6.6',
        })
      ) === '198.51.100.7' && clientIpFromHeaders(new Headers()) === 'unknown'
    );
    const limiterSrc = withoutComments(
      readFileSync('lib/ip-rate-limiter.ts', 'utf8')
    );
    const getClientIpFn = limiterSrc.slice(
      limiterSrc.indexOf('export function getClientIp'),
      limiterSrc.indexOf('export async function checkIpRateLimit')
    );
    ok(
      'getClientIp delegates to clientIpFromHeaders and reads no header of its own',
      getClientIpFn.includes('return clientIpFromHeaders(request.headers);') &&
        !getClientIpFn.includes('.get(')
    );

    // The status read: one clock, and a wait when refused.
    const statusFn = limiterSrc.slice(
      limiterSrc.indexOf('export async function getIpRateLimitStatus'),
      limiterSrc.indexOf('export function formatRateLimitHeaders')
    );
    ok(
      'getIpRateLimitStatus reads the clock once and states the wait when it refuses',
      (statusFn.match(/new Date\(\)/g) ?? []).length === 1 &&
        !/getHourlyBucketKey\(\)|getResetTime\(\)/.test(statusFn) &&
        statusFn.includes(
          'secondsUntilNextAllowed(previousCount, count, config.limit, now)'
        ) &&
        /return \{\s*allowed,[\s\S]*?retryAfter,\s*\};/.test(statusFn)
    );

    // The authorize page: charged after the missing-parameter refusal and
    // before the client is resolved; rendered, never redirected; the consent
    // step is not charged.
    const page = withoutComments(
      readFileSync('app/oauth/authorize/page.tsx', 'utf8')
    );
    const fresh = page.slice(
      page.indexOf('export default async function AuthorizePage'),
      page.indexOf('async function renderConsent')
    );
    const consent = page.slice(page.indexOf('async function renderConsent'));
    const pageLimit = fresh.indexOf(
      "checkIpRateLimit(\n    clientIpFromHeaders(await headers()),\n    '/oauth/authorize'\n  )"
    );
    ok(
      'a fresh authorization request is counted per address after the missing-parameter refusal and before the client is resolved',
      pageLimit !== -1 &&
        pageLimit > fresh.indexOf('if (!clientId || !redirectUri)') &&
        pageLimit < fresh.indexOf('resolveClient(clientId)') &&
        fresh.indexOf('renderConsent(requestId)') < pageLimit &&
        fresh.split('checkIpRateLimit(').length === 2 &&
        !consent.includes('checkIpRateLimit(')
    );
    const refused = fresh.slice(
      fresh.indexOf('if (!limit.allowed) {'),
      fresh.indexOf('resolveClient(clientId)')
    );
    ok(
      'an authorization request over the limit renders a refusal and never redirects',
      refused.includes('<Refusal') &&
        !refused.includes('redirect(') &&
        /if \(!limit\.allowed\) \{[\s\S]*?return \(\s*<Refusal/.test(refused)
    );

    // Revocation: shape first, then the peek, then the lookup, and a charge
    // only on a miss.
    const revoke = withoutComments(
      readFileSync('app/api/oauth/revoke/route.ts', 'utf8')
    );
    const at = (needle: string) => revoke.indexOf(needle);
    const shape = at(
      'if (!isRefresh && !isWellFormedAccessToken(token)) return OK;'
    );
    ok(
      'a string that is neither token shape is answered 200 before the limiter or the database',
      revoke.includes('const isRefresh = isWellFormedRefreshToken(token);') &&
        shape !== -1 &&
        shape < at('getIpRateLimitStatus(') &&
        shape < at('getDb()')
    );
    ok(
      'revocation is refused before any lookup, so a live token and a dead one get the same answer',
      revoke.split('getIpRateLimitStatus(').length === 2 &&
        revoke.includes(
          "const status = await getIpRateLimitStatus(ip, '/api/oauth/revoke');"
        ) &&
        at('getIpRateLimitStatus(') < at('.from(') &&
        at('getIpRateLimitStatus(') < at('grantIdForRefreshToken(') &&
        /if \(!status\.allowed\) \{\s*return NextResponse\.json\([\s\S]*?status: 503,[\s\S]*?'Retry-After': String\(status\.retryAfter/.test(
          revoke
        ) &&
        !revoke.includes('status: 429')
    );
    ok(
      'revocation sends a refresh-shaped token to the grant lookup and an access-shaped token to api_keys, and keeps the grant id each finds',
      /if \(isRefresh\) \{\s*grantId = await grantIdForRefreshToken\(token\);\s*\} else \{[\s\S]*?\.from\(apiKeys\)\s*\.where\(eq\(apiKeys\.key, hashApiKey\(token\)\)\)[\s\S]*?grantId = key\?\.grantId \?\? null;\s*\}/.test(
        revoke
      )
    );
    ok(
      'revocation charges only a token that named nothing, after both lookups',
      revoke.split('checkIpRateLimit(').length === 2 &&
        at('checkIpRateLimit(') > at('.from(apiKeys)') &&
        at('checkIpRateLimit(') > at('grantIdForRefreshToken(') &&
        /if \(grantId\) \{\s*await revokeGrant\(grantId, 'revoked by the client'\);\s*return OK;\s*\}\s*await checkIpRateLimit\(ip, '\/api\/oauth\/revoke'\);\s*return OK;\s*\}\s*$/.test(
          revoke
        )
    );

    // The docs state the numbers the code enforces.
    const overview = readFileSync('PROJECT_OVERVIEW.md', 'utf8').replace(
      /\s+/g,
      ' '
    );
    ok(
      'PROJECT_OVERVIEW states each OAuth endpoint limit the limiter enforces',
      (
        [
          '/api/oauth/token:grant',
          '/api/oauth/token',
          '/api/oauth/revoke',
          '/oauth/authorize',
          '/api/oauth/register',
        ] as const
      ).every((k) =>
        overview.includes(`${IP_RATE_LIMITS[k].limit} an hour under \`${k}\``)
      )
    );
    ok(
      'the MCP server page says token requests are limited per connection',
      /token requests[^.]*limited per connection/i.test(
        readFileSync('docs-site/mcp-server.mdx', 'utf8')
      )
    );
  }

  // ------------------------------- OAuth: a code exchange is one statement
  // Spending the code, writing the refresh hash and minting the access token
  // were three statements. A failure after the spend left the code used up
  // with nothing issued, and the client's retry was read as a replay, which
  // revoked the connection it was trying to make.
  {
    const grants = withoutComments(readFileSync('lib/oauth/grants.ts', 'utf8'));
    const spendFn = grants.slice(
      grants.indexOf('async function spendAndMint'),
      grants.indexOf('export type RedeemResult')
    );
    const redeemFn = grants.slice(
      grants.indexOf('export async function redeemCode'),
      grants.indexOf('async function pruneGrants')
    );
    const spendSql =
      [...spendFn.matchAll(/sql`([\s\S]*?)`/g)]
        .map((m) => m[1])
        .find((t) => t.includes('UPDATE oauth_authorization_requests')) ?? '';
    const cte = (name: string, next: string) =>
      spendSql.slice(spendSql.indexOf(name), spendSql.indexOf(next));
    const consumedCte = cte('WITH consumed AS (', 'granted AS (');
    const grantedCte = cte('granted AS (', 'minted AS (');
    const mintedCte = cte('minted AS (', 'SELECT g.id');
    ok(
      'spending the code, writing the refresh hash and minting are one statement',
      consumedCte.length > 0 &&
        grantedCte.includes('UPDATE oauth_grants') &&
        mintedCte.includes('INSERT INTO api_keys')
    );
    ok(
      'the spend is conditional: this code, not yet spent, not expired, judged by Postgres',
      /WHERE code_hash = \$\{input\.codeHash\}\n\s*AND consumed_at IS NULL\n\s*AND code_expires_at > now\(\)\n\s*RETURNING grant_id/.test(
        consumedCte
      )
    );
    ok(
      "credentials go only to the spent code's grant, and never to a revoked one",
      grantedCte.includes(
        'WHERE id IN (SELECT grant_id FROM consumed) AND revoked_at IS NULL'
      )
    );
    ok(
      "a refresh token is written only when the grant's own scope holds offline_access",
      (
        grantedCte.match(
          /WHEN \$\{OFFLINE_SCOPE\} = ANY \(string_to_array\(scope, ' '\)\)/g
        ) ?? []
      ).length === 2 &&
        /\$\{OFFLINE_SCOPE\} = ANY \(string_to_array\(scope, ' '\)\) AS refreshed/.test(
          grantedCte
        ) &&
        redeemFn.includes(
          'refreshToken: spent.refreshed ? refreshToken : null,'
        )
    );
    ok(
      'the refresh hash written is the hash of the refresh token returned, and the key is the access token returned',
      grantedCte.includes(
        'THEN ${input.refreshHash} ELSE refresh_token_hash END'
      ) &&
        /THEN now\(\) \+ make_interval\(secs => \$\{refreshTtlS\}\)\s*ELSE refresh_expires_at END/.test(
          grantedCte
        ) &&
        redeemFn.includes('refreshHash: sha256(refreshToken),') &&
        redeemFn.includes('accessHash: hashApiKey(access),') &&
        redeemFn.includes('accessPrefix: access.slice(0, 12),') &&
        redeemFn.includes('accessToken: access,')
    );
    ok(
      'the first access token is linked to its grant, so revoking the grant ends it on /v1 too',
      /INSERT INTO api_keys \(key, key_prefix, name, user_id, plan, expires_at, oauth_grant_id\)\s*SELECT [\s\S]*?, id\s*FROM granted/.test(
        mintedCte
      )
    );
    ok(
      'the exchange aliases need no quoting, and the columns read are the columns returned',
      !/\bAS\s+[a-z]+[A-Z]\w*/.test(spendSql) &&
        /SELECT g\.id AS grant_id, g\.scope, g\.refreshed,\s*\(SELECT id FROM minted\) AS minted_id\s*FROM consumed c LEFT JOIN/.test(
          spendSql
        )
    );
    ok(
      'the refresh token gets the refresh lifetime and the access token the access lifetime, from Postgres',
      grantedCte.includes(
        'THEN now() + make_interval(secs => ${refreshTtlS})'
      ) &&
        mintedCte.includes('now() + make_interval(secs => ${accessTtlS})') &&
        !mintedCte.includes('refreshTtlS') &&
        !/new Date\(|Date\.now\(\)/.test(spendFn + redeemFn)
    );
    ok(
      'a spent code whose grant was revoked reports as spent (inactive), not as a replay that revokes',
      spendSql.includes(
        'FROM consumed c LEFT JOIN granted g ON g.id = c.grant_id'
      ) &&
        redeemFn.includes(
          "if (!spent.grant_id) return { outcome: 'inactive' };"
        )
    );
    ok(
      'the code is read back only when the statement spent nothing, and a spend with no key throws',
      redeemFn.includes(
        'if (!spent) return { outcome: await unspentCodeReason(code) };'
      ) && /if \(!spent\.minted_id\)\s*throw new Error\(/.test(redeemFn)
    );
    const beforeSpend = redeemFn.slice(
      0,
      redeemFn.indexOf('await spendAndMint(')
    );
    ok(
      'nothing writes or revokes before the statement',
      beforeSpend.length > 0 &&
        !/\.execute\(|\.update\(|\.insert\(|\.delete\(|revokeGrant\(/.test(
          beforeSpend
        )
    );
    ok(
      'no OAuth credential is minted anywhere but the two statements',
      !grants.includes('.insert(apiKeys)') &&
        !grants.includes('mintAccessToken') &&
        !grants.includes('issueInitialTokens')
    );

    const token = withoutComments(
      readFileSync('app/api/oauth/token/route.ts', 'utf8')
    );
    const exchange = token.slice(
      token.indexOf('async function exchangeCode'),
      token.indexOf('async function exchangeRefresh')
    );
    const post = token.slice(
      token.indexOf('export async function POST'),
      token.indexOf('function tokenServiceUnavailable')
    );
    ok(
      'every database call of both grant types sits under one catch that logs and answers the shared 503',
      /try \{\s*if \(grantType === 'authorization_code'\) return await exchangeCode\(form, ip\);\s*if \(grantType === 'refresh_token'\) return await exchangeRefresh\(form, ip\);\s*\} catch \(error\) \{\s*console\.error\([\s\S]{0,120}?error\s*\);\s*return tokenServiceUnavailable\(\);/.test(
        post
      ) &&
        (
          token.match(
            /exchangeCode\(form, ip\)|exchangeRefresh\(form, ip\)/g
          ) ?? []
        ).length === 2
    );
    ok(
      'a code spent on a revoked grant answers invalid_grant and revokes nothing',
      /spent\.outcome === 'inactive'\) \{\s*return oauthError\(\s*'invalid_grant'/.test(
        exchange
      ) &&
        exchange.indexOf("spent.outcome === 'inactive'") >
          exchange.indexOf('revokeGrant(')
    );
  }

  // ------------------------- OAuth: a refresh replayed moments after rotation
  // An MCP client sends one refresh per tool call that meets an expired token,
  // and the SDK refreshes on every 401 even after another call saved new
  // tokens, so one burst rotates the chain several times. Its slow members
  // presented tokens one or more steps old: the direct predecessor revoked the
  // connection, an older one answered invalid_grant, which makes the SDK
  // delete the live tokens. Now a token rotated out in the current burst is
  // held off within REFRESH_REUSE_GRACE_MS: refused, no tokens, no revoke.
  {
    const { REFRESH_REUSE_GRACE_MS, REFRESH_GRACE_HASHES } =
      await import('@/lib/oauth/grants');
    const docs = readFileSync('docs-site/mcp-server.mdx', 'utf8');
    const overview = readFileSync('PROJECT_OVERVIEW.md', 'utf8');
    ok(
      'the grace is 30 seconds over a burst of at most 10 hashes, and the docs state the same window and how to tell the hold-off apart',
      REFRESH_REUSE_GRACE_MS === 30_000 &&
        REFRESH_GRACE_HASHES === 10 &&
        /within\s+30\s+seconds of each other/.test(docs) &&
        /token_rotated/.test(docs) &&
        /30 seconds of the last rotation/.test(overview)
    );

    const grants = withoutComments(readFileSync('lib/oauth/grants.ts', 'utf8'));
    const rotateFn = grants.slice(
      grants.indexOf('async function rotateAndMint'),
      grants.indexOf('export async function refreshGrant')
    );
    // SQL line comments stripped: a stamp commented out is not a stamp.
    const rotateSql = (
      [...rotateFn.matchAll(/sql`([\s\S]*?)`/g)].map((m) => m[1])[0] ?? ''
    ).replace(/--[^\n]*/g, '');
    const setClause = rotateSql.slice(
      0,
      rotateSql.indexOf('WHERE refresh_token_hash')
    );
    ok(
      'every rotation stamps refresh_rotated_at, which starts the window',
      setClause.includes('refresh_rotated_at = now(),')
    );
    ok(
      'a rotation within the window adds the rotated-out hash to the burst, keeping the last ten; after a quiet spell it starts a new one',
      /refresh_grace_hashes = CASE\s*WHEN refresh_rotated_at > now\(\) - make_interval\(secs => \$\{graceS\}\)\s*THEN \(coalesce\(refresh_grace_hashes, ARRAY\[\]::text\[\]\)\)\[greatest\(cardinality\(refresh_grace_hashes\) - \$\{REFRESH_GRACE_HASHES - 2\}, 1\):\] \|\| \$\{input\.hash\}::text\s*ELSE ARRAY\[\$\{input\.hash\}::text\]\s*END,/.test(
        setClause
      ) &&
        rotateFn.includes(
          'const graceS = Math.floor(REFRESH_REUSE_GRACE_MS / 1000);'
        )
    );

    const refresh = grants.slice(
      grants.indexOf('export async function refreshGrant'),
      grants.indexOf('export async function revokeGrant')
    );
    const reuse = refresh.slice(refresh.indexOf('const graceS'));
    ok(
      'the window is judged by Postgres, from the rotation stamp, over the grace constant',
      reuse.startsWith(
        'const graceS = Math.floor(REFRESH_REUSE_GRACE_MS / 1000);'
      ) &&
        reuse.includes(
          'rotatedJustNow: sql<boolean>`${oauthGrants.refreshRotatedAt} > now() - make_interval(secs => ${graceS})`,'
        ) &&
        !/new Date\(|Date\.now\(\)/.test(refresh)
    );
    ok(
      'the fresh read reports the grant revocation and whether the token is the direct predecessor, from the right columns',
      reuse.includes('revokedAt: oauthGrants.revokedAt,') &&
        reuse.includes(
          'direct: sql<boolean>`${oauthGrants.previousRefreshTokenHash} = ${hash}`,'
        )
    );
    const holdAt = reuse.indexOf(
      'if (reused.rotatedJustNow === true && !reused.revokedAt) {'
    );
    const directAt = reuse.indexOf('if (reused.direct === true) {');
    ok(
      'a burst token on a live grant within the window is held off before anything revokes; a NULL stamp is never recent',
      holdAt !== -1 &&
        directAt !== -1 &&
        holdAt < directAt &&
        /if \(reused\.rotatedJustNow === true && !reused\.revokedAt\) \{\s*console\.log\([^;]*\);\s*return \{ ok: false, reason: 'just_rotated' \};\s*\}/.test(
          reuse
        )
    );
    ok(
      'after the window only the direct predecessor revokes; an older burst token stays unknown, as before',
      /if \(reused\.direct === true\) \{\s*await revokeGrant\(reused\.id, 'refresh token reused'\);/.test(
        reuse
      ) &&
        (refresh.match(/ok: true/g) ?? []).length === 1 &&
        refresh.split('revokeGrant(').length === 2
    );

    const token = withoutComments(
      readFileSync('app/api/oauth/token/route.ts', 'utf8')
    );
    const exchange = token.slice(
      token.indexOf('async function exchangeRefresh')
    );
    const held = exchange.slice(
      exchange.indexOf("if (result.reason === 'just_rotated') {"),
      exchange.indexOf("return oauthError('invalid_grant', description)")
    );
    ok(
      'a held-off replay answers 503 temporarily_unavailable marked token_rotated and without Retry-After, never invalid_grant',
      /return NextResponse\.json\(\s*\{\s*error: 'temporarily_unavailable',[\s\S]{0,400}?token_rotated: true,\s*\},\s*\{ status: 503, headers: NO_STORE \}\s*\);/.test(
        held
      ) &&
        !held.includes('Retry-After') &&
        !held.includes("oauthError('invalid_grant'")
    );

    const schema = readFileSync('db/schema.ts', 'utf8');
    const migrate = readFileSync(
      'scripts/migrate-oauth-refresh-grace.ts',
      'utf8'
    );
    const base = readFileSync('scripts/migrate-mcp-oauth.ts', 'utf8');
    ok(
      'both columns exist in the schema, are added by their migration with the GIN index, and a fresh database gets them',
      schema.includes("refreshRotatedAt: timestamp('refresh_rotated_at'),") &&
        schema.includes(
          "refreshGraceHashes: text('refresh_grace_hashes').array(),"
        ) &&
        /ADD COLUMN IF NOT EXISTS refresh_rotated_at timestamp/.test(migrate) &&
        /ADD COLUMN IF NOT EXISTS refresh_grace_hashes text\[\]/.test(
          migrate
        ) &&
        /USING gin \(refresh_grace_hashes\)/.test(migrate) &&
        base.includes('      refresh_rotated_at timestamp,\n') &&
        base.includes('      refresh_grace_hashes text[],\n') &&
        base.includes('    oauth_grants: 15,')
    );
  }

  // ------------------------- Reverse lookups need an account (Linear STA-41)
  // A handle-to-wallets search is the direction that can find a person, so it
  // needs an account somebody answers for. A key bought with USDC and no
  // account keeps the forward lookups and is refused here, before anything is
  // read or billed.
  {
    const { isWalletOnlyEmail, syntheticEmailForWallet } =
      await import('@/lib/x402-account');
    const w = '0x' + 'ab'.repeat(20);
    ok(
      'a wallet-only account is recognized by its synthetic email, in any case, and a real address never is',
      isWalletOnlyEmail(syntheticEmailForWallet(w)) &&
        isWalletOnlyEmail(syntheticEmailForWallet(w).toUpperCase()) &&
        !isWalletOnlyEmail('person@example.com') &&
        !isWalletOnlyEmail('x402.walletlink.invalid@example.com') &&
        !isWalletOnlyEmail(null)
    );
    const acct = withoutComments(readFileSync('lib/x402-account.ts', 'utf8'));
    const fn = acct.slice(
      acct.indexOf('export async function isWalletOnlyAccount'),
      acct.indexOf('export const ACCOUNT_REQUIRED_MESSAGE')
    );
    ok(
      'an account that cannot be read is treated as wallet-only, so the refusal fails closed',
      /if \(!db\) return true;/.test(fn) &&
        fn.includes('return !row || isWalletOnlyEmail(row.email);')
    );
    for (const route of [
      'app/api/v1/reverse/twitter/[handle]/route.ts',
      'app/api/v1/reverse/farcaster/[username]/route.ts',
    ]) {
      const code = withoutComments(readFileSync(route, 'utf8'));
      const gate = code.indexOf(
        'if (await isWalletOnlyAccount(context.key.userId)) {'
      );
      ok(
        `${route.split('/')[4]} reverse refuses a wallet-only key with 403 ACCOUNT_REQUIRED before it reads or bills anything`,
        gate !== -1 &&
          /if \(await isWalletOnlyAccount\(context\.key\.userId\)\) \{\s*return apiError\(ACCOUNT_REQUIRED_MESSAGE, 'ACCOUNT_REQUIRED', 403,/.test(
            code
          ) &&
          gate < code.indexOf('.from(socialGraph)') &&
          gate < code.indexOf('trackApiUsage(')
      );
    }
    const spec = readFileSync('docs-site/openapi.yaml', 'utf8');
    const errors = readFileSync('docs-site/api-reference/errors.mdx', 'utf8');
    ok(
      'the new code is documented where integrators branch on codes',
      /enum:[\s\S]*?- ACCOUNT_REQUIRED/.test(spec) &&
        (
          spec.match(
            /'403': \{ \$ref: '#\/components\/responses\/AccountRequired' \}/g
          ) ?? []
        ).length === 2 &&
        /\| `ACCOUNT_REQUIRED`\s*\| 403/.test(errors)
    );
  }

  // ------------------------------- UD's onchain X validations (Linear STA-13)
  // UD signed (token, owner, handle) for X accounts it verified in 2020 to 2023
  // and wrote the signature onchain. Five ways a naive read loses records, and
  // one source id that has to be known everywhere a live lookup recomputes a
  // row, or the next lookup of an ingested wallet unmarks its handle.
  {
    const ud = await import('@/lib/ud-validations');
    const { ethers } = await import('ethers');
    ok(
      "the signer is UD's key, compared in lowercase because the SDK constant is not valid EIP-55",
      ud.UD_TWITTER_SIGNER ===
        '0x12cfb13522F13a78b650a8bCbFCf50b7CB899d82'.toLowerCase() &&
        withoutComments(readFileSync('lib/ud-validations.ts', 'utf8')).includes(
          'return signer.toLowerCase() === UD_TWITTER_SIGNER;'
        )
    );
    ok(
      'a 0x value is hashed as bytes exactly as the SDK converts it: pairs, a non-hex pair as 0, an odd tail as its own digit',
      JSON.stringify([...ud.sdkHexToBytes('0x0aff')]) === '[10,255]' &&
        JSON.stringify([...ud.sdkHexToBytes('0xzz01')]) === '[0,1]' &&
        JSON.stringify([...ud.sdkHexToBytes('0xabc')]) === '[171,12]'
    );
    const owner = '0x' + '11'.repeat(20);
    const msg = ud.validationMessage('42', owner, '0xab');
    ok(
      'the signed message is the keccak of token, owner, key and handle, each 0x value as bytes and the rest as text',
      msg ===
        ethers.keccak256(ethers.toUtf8Bytes('42')) +
          ethers.keccak256(ethers.getBytes(owner)) +
          ethers.keccak256(ethers.toUtf8Bytes('social.twitter.username')) +
          ethers.keccak256(Uint8Array.from([0xab]))
    );
    {
      const stranger = ethers.Wallet.createRandom();
      const signature = await stranger.signMessage(
        ud.validationMessage('42', owner, 'someone')
      );
      ok(
        'a signature by anybody but UD validates nothing',
        !ud.isUdValidated({
          tokenIdDecimal: '42',
          owner,
          handle: 'someone',
          signature,
        }) &&
          !ud.isUdValidated({
            tokenIdDecimal: '42',
            owner,
            handle: 'someone',
            signature: '0xdead',
          })
      );
    }
    const lib = withoutComments(readFileSync('lib/ud-validations.ts', 'utf8'));
    ok(
      'the legacy CNS event is scanned, and a token binds to Polygon only when its Polygon owner is set',
      (lib.match(/\[CNS_SET, /g) ?? []).length === 2 &&
        lib.includes(
          'const chain: UdChain = p && p.owner !== ethers.ZeroAddress ? 137 : 1;'
        ) &&
        /getData\(string\[\] keys, uint256 tokenId\)/.test(lib)
    );
    const script = withoutComments(
      readFileSync('scripts/harvest-ud-validations.ts', 'utf8')
    );
    ok(
      'the harvest ingests only live, uncontested links, through the fill-only ingest',
      script.includes(
        "const live = links.filter((l) => status.get(l.handle) === 'live');"
      ) &&
        script.includes('(l) => !contestedHandles.has(l.handle)') &&
        script.includes('await ingestLinks(live, SOURCE);') &&
        !/upsertLinks\(|INSERT INTO social_graph/.test(script)
    );

    const { publicSources, ATTESTED_SOURCE_IDS } =
      await import('@/lib/api-sources');
    const { isTwitterVerified, calculateQualityScore } =
      await import('@/lib/social-graph');
    const quality = Number(/quality: (\d+),/.exec(script)?.[1]);
    ok(
      'the new source is known everywhere a lookup recomputes a row: its class, the attested set, the verified flag, the score its ingest writes, and the published figure',
      JSON.stringify(publicSources(['ud_twitter_validation'])) ===
        '["attested-social"]' &&
        ATTESTED_SOURCE_IDS.has('ud_twitter_validation') &&
        isTwitterVerified(['ud_twitter_validation']) &&
        calculateQualityScore(['ud_twitter_validation'], true, false) ===
          quality &&
        quality === 45 &&
        readFileSync('scripts/check-published-figures.ts', 'utf8').includes(
          "'ud_twitter_validation'"
        )
    );
  }

  // ------------------------------------------------- OAuth: the grant cap
  // Two Approve clicks: only one can issue a code, and the loser's grant has
  // to go with it. Left behind it holds a slot in the per-account cap and
  // pushes the oldest live connection out, so a double click on one screen
  // disconnects a client somewhere else.
  {
    const grants = readFileSync('lib/oauth/grants.ts', 'utf8');
    const createBody = grants.slice(
      grants.indexOf('export async function createGrant'),
      grants.indexOf('export async function enforceGrantCap')
    );
    ok(
      'createGrant does not prune, so a consent that never issued a code cannot revoke one that did',
      createBody.length > 0 && !createBody.includes('pruneGrants(')
    );

    const authorize = readFileSync('app/api/oauth/authorize/route.ts', 'utf8');
    const lost = authorize.indexOf('if (!code) {');
    const revoked = authorize.indexOf('revokeGrant(');
    ok(
      'an approval that loses the race revokes the grant it just wrote',
      lost !== -1 && revoked !== -1 && lost < revoked
    );
    ok(
      'the cap is enforced only once a code has actually been issued',
      authorize.indexOf('enforceGrantCap(') > lost
    );

    /**
     * Both doors to a key agree about who may hold one.
     *
     * They did not between the day OAuth shipped and 2026-09-21.
     * `mintAccessToken` wrote an `api_keys` row on `CREDIT_API_PLAN` with no
     * credit test, while `POST /api/developer/keys` answered 403 to any
     * account on the free allowance, and the Apify listing our own repo
     * publishes sent strangers to the door that refused them. Nothing failed:
     * each route was internally consistent and no test compared them.
     *
     * Asserted as the property rather than as the absence of one string, and
     * from the direction that can actually regress: re-adding a credit test
     * to the REST door while the OAuth door keeps minting freely.
     */
    ok(
      'the OAuth door mints a key without asking about credits',
      (grants.match(/\$\{CREDIT_API_PLAN\}/g) ?? []).length === 2 &&
        !/hasPaidAccess|onFreeAllowance/.test(grants)
    );
    const keysRoute = readFileSync('app/api/developer/keys/route.ts', 'utf8');
    ok(
      'and so the REST door does not refuse one for the lack of them',
      !/upgradeRequired/.test(keysRoute) &&
        !/needs credits/.test(keysRoute) &&
        /apiPlanForAccount\(auth\.identity\.tier\)/.test(keysRoute)
    );
    {
      const { apiPlanForAccount, CREDIT_API_PLAN } =
        await import('@/lib/api-plans');
      ok(
        'a free account resolves to a real API plan, through the function itself',
        apiPlanForAccount('free') === CREDIT_API_PLAN
      );
      ok(
        'and a legacy tier still wins where it is higher',
        apiPlanForAccount('unlimited') !== CREDIT_API_PLAN
      );
    }
  }

  // ------------------------------------------------- the source field shape
  // `source` is typed `string[]`, and that type is a claim about JSON nobody
  // validated. Our own CSV export writes it as a comma-joined string, a
  // customer re-uploaded that file, and the string was merged straight over the
  // array. Nothing threw where it happened: every later stage spreads the field,
  // and spreading a string spreads its characters, so a job's provenance
  // quietly became a list of letters. The admin viewer called `.map` and was
  // the only surface loud enough to notice.
  {
    const { asSourceList, publicSources } = await import('@/lib/api-sources');

    // The exact loop that broke: export joins, upload merges, pipeline spreads.
    const joined = 'web3bio,neynar,cache';
    ok(
      'a comma-joined source string is recovered as its list',
      JSON.stringify(asSourceList(joined)) ===
        JSON.stringify(['web3bio', 'neynar', 'cache'])
    );
    // The bug's signature, asserted directly rather than described. Iterating
    // the raw string yields 20 characters; through the coercion it yields 3.
    ok(
      'spreading a recovered source does NOT spread characters',
      [...asSourceList(joined), 'graph'].length === 4 &&
        [...joined, 'graph'].length === 21
    );
    ok(
      'an array is passed through unchanged',
      JSON.stringify(asSourceList(['a', 'b'])) === JSON.stringify(['a', 'b'])
    );
    for (const junk of [null, undefined, 42, {}, [1, 2]]) {
      ok(
        `a source of ${JSON.stringify(junk) ?? 'undefined'} becomes an empty list rather than throwing`,
        Array.isArray(asSourceList(junk))
      );
    }
    // publicSources iterated its argument directly, so a string walked
    // characters, matched no source class and returned undefined: the evidence
    // column vanished from a re-uploaded export with no error.
    ok(
      'publicSources reads a joined string rather than silently dropping it',
      publicSources('farcaster,onchain') !== undefined
    );
    ok(
      'publicSources still returns nothing for a genuinely empty source',
      publicSources([]) === undefined && publicSources(null) === undefined
    );

    /**
     * The writer, in every file that has one.
     *
     * The first version of this assertion named `lib/job-processor.ts` and
     * checked only that. Review found a second copy of the same pipeline in
     * the Inngest function (retired by STA-44), with the same bug in two more
     * object literals, on the path that every upload above the inline
     * threshold took. So the fix was in the less used branch and the
     * assertion agreed with it.
     *
     * It discovers the sites now rather than naming them. A third copy of the
     * pipeline is caught the day it is written, which is the only version of
     * this check worth having.
     */
    const writers = execFileSync(
      'grep',
      [
        '-rl',
        '--include=*.ts',
        '--include=*.tsx',
        '\\.\\.\\.walletData',
        'lib',
        'app',
        'inngest',
      ],
      { encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean);

    ok(
      `the worker is among the files that spread walletData (${writers.length} found)`,
      writers.includes('lib/job-processor.ts')
    );

    /**
     * The object literal, whole.
     *
     * The first version of this loop sliced from the opening brace to
     * `source: []` and skipped any literal where `walletData` was not in that
     * slice. In the broken ordering the spread comes *after* the initializer,
     * so the slice never contained it and the site was silently not checked:
     * the assertion passed by matching nothing, on precisely the arrangement
     * it exists to catch. The guard found that before it shipped.
     *
     * So the literal is read to its matching brace, and the ordering is
     * compared inside it.
     */
    const objectLiteralAt = (source: string, from: number): string => {
      let depth = 0;
      for (let i = from; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
          depth--;
          if (depth === 0) return source.slice(from, i + 1);
        }
      }
      return source.slice(from);
    };

    for (const file of writers) {
      const source = readFileSync(file, 'utf8');
      let searched = 0;
      let sites = 0;
      for (;;) {
        const at = source.indexOf('source: [],', searched);
        if (at === -1) break;
        searched = at + 1;
        const open = source.lastIndexOf('{', at);
        const literal = objectLiteralAt(source, open);
        const spread = literal.indexOf('...walletData');
        if (spread === -1) continue;
        sites++;
        ok(
          `${file}: uploaded columns are spread before the fields the pipeline owns (site ${sites})`,
          spread < literal.indexOf('source: [],')
        );
      }
      ok(`${file}: at least one initializer was checked`, sites > 0);

      // A resumed job reloads rows written before that fix, so every entry
      // point has to normalise or the next spread is back to characters.
      ok(
        `${file}: partial results are normalised when a job resumes`,
        /partialResults[\s\S]{0,600}?asSourceList\(r\.source\)/.test(source)
      );
    }

    // And the reader that crashed.
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    ok(
      'the admin job viewer coerces before mapping over source',
      admin.includes('asSourceList(result.source).map') &&
        !admin.includes('result.source?.map')
    );
  }

  // ------------------------------------------------- the privacy policy
  // Every retention period the policy states has to be one the code enforces.
  // A policy naming a period nothing deletes on is a claim with nothing able to
  // contradict it, which is the shape of defect this whole file exists for, and
  // this one is published rather than buried in a comment.
  {
    const privacy = readFileSync('app/privacy/page.tsx', 'utf8');
    const cleanup = readFileSync('app/api/cron/cleanup/route.ts', 'utf8');
    const vercel = readFileSync('vercel.json', 'utf8');

    // Read out of the constants, never written as digits. If somebody replaces
    // `{CACHE_TTL_DAYS}` with `7`, the policy and the cache can drift apart
    // silently and a reader has no way to know which is true.
    for (const constant of [
      'CACHE_TTL_DAYS',
      'ANALYTICS_RETENTION_DAYS',
      'IP_BUCKET_RETENTION_HOURS',
      'SESSION_DURATION_DAYS',
      'MAGIC_LINK_DURATION_MINUTES',
      'MAGIC_LINK_RETENTION_HOURS',
      'NEGATIVE_RECHECK_DAYS',
      'OAUTH_TOKEN_RETENTION_DAYS',
    ]) {
      ok(
        `the privacy policy reads ${constant} rather than restating the number`,
        privacy.includes(`{${constant}}`) || privacy.includes(`\${${constant}}`)
      );
    }

    // The three cleanups existed for months with nothing calling them, which is
    // how the policy came to need writing before any of these periods were real.
    // Below the imports, so an import that survives a deleted call does not
    // satisfy this. The first version searched the whole file and passed while
    // the call had been replaced with a literal; the guard caught it.
    const cleanupBody = cleanup.slice(cleanup.indexOf('async function run('));
    for (const fn of [
      'cleanupExpiredAuth',
      'cleanupOldIpBuckets',
      'cleanupAuthorizationRequests',
    ]) {
      ok(
        `${fn} is actually called by the cleanup job`,
        cleanupBody.includes(`${fn}(`)
      );
    }
    // The exact JSON value, not a substring of it. `/api/cron/cleanup` is a
    // prefix of `/api/cron/cleanup-disabled`, so the substring test passed
    // against a renamed and therefore unscheduled job. Also caught by the guard.
    ok(
      'the cleanup job is scheduled, not merely written',
      vercel.includes('"path": "/api/cron/cleanup"')
    );
    ok(
      'analytics events have an expiry at all',
      cleanup.includes('delete(analyticsEvents)')
    );

    // The entity is a legal claim on this page and a credit in the footer, and
    // it was written a third time from memory, wrongly, while the correct value
    // sat in two files. One constant, and nobody spells it out.
    const { LEGAL_ENTITY } = await import('@/lib/site-url');
    const namesEntity = [
      'app/privacy/page.tsx',
      'components/ui/site-footer.tsx',
      'app/llms.txt/route.ts',
    ];
    for (const file of namesEntity) {
      const source = readFileSync(file, 'utf8');
      ok(
        `${file} reads LEGAL_ENTITY rather than spelling the entity out`,
        source.includes('LEGAL_ENTITY') && !source.includes(LEGAL_ENTITY)
      );
    }

    // A policy nobody can reach is not published, and a directory submission
    // has to name a URL for it.
    const footer = readFileSync('components/ui/site-footer.tsx', 'utf8');
    const sitemap = readFileSync('app/sitemap.ts', 'utf8');
    ok(
      'the privacy policy is linked from the footer',
      footer.includes('/privacy')
    );
    ok('the privacy policy is in the sitemap', sitemap.includes('/privacy'));

    /**
     * The same test, applied to the page that acts on what the policy
     * describes.
     *
     * `/claim` shipped with a canonical URL and nothing linking to it: not
     * the footer, not the sitemap, and not the privacy section that tells
     * somebody in the index what they can do about it. Every path to the one
     * page where a person corrects or removes their own record went through
     * knowing the URL already. Declaring a canonical is asking to be indexed,
     * and the sitemap is where that request is actually made, so the two
     * disagreed.
     *
     * The privacy link is asserted separately from the other two because it
     * carries a different claim. The footer and the sitemap make the page
     * reachable; that paragraph is the only place we tell somebody who wants
     * to be removed that a faster route than email exists, and it sits in a
     * section whose whole subject is what they can do.
     */
    /**
     * Every one of these reads the markup with comments stripped, and the
     * first version of this block did not.
     *
     * `footer.includes('/claim')` passed with the link deleted, because the
     * comment above it explaining why the link is there also contains the
     * path. The check was reading its own justification. That is the defect
     * this file exists to catch, committed inside the file that catches it,
     * and it was found by deleting the link rather than by rereading the
     * assertion. Hence `href="/claim"` and `${baseUrl}/claim` rather than a
     * bare path: an anchor that only the real thing can satisfy.
     */
    const noComments = (s: string) => withoutComments(s);
    const privacyPage = readFileSync('app/privacy/page.tsx', 'utf8');
    ok(
      'the claim page is linked from the footer',
      /href="\/claim"/.test(noComments(footer))
    );
    ok(
      'the claim page is in the sitemap',
      /\$\{baseUrl\}\/claim`/.test(noComments(sitemap))
    );
    ok(
      'and the removal section offers it beside the email route',
      /href="\/claim"/.test(noComments(privacyPage)) &&
        // Beside, not instead of. Email asks nothing of the person and is the
        // only route for a handle, for a key they no longer hold, and for
        // leaving the index entirely, so a change that replaced it would be
        // removing the accessible path in favour of one that needs a wallet.
        noComments(privacyPage).includes('mailto:help@walletlink.social')
    );

    /**
     * Spent OAuth access tokens (STA-39 D). The delete cascades to a token's
     * usage, quota bucket and replay rows, so the period has two floors, and
     * the row set is fenced twice so a key a person made is never in reach.
     */
    const cleanupCode = withoutComments(cleanup);
    const runBody = cleanupCode.slice(
      cleanupCode.indexOf('async function run(')
    );
    const tokenDelete = runBody.slice(
      runBody.indexOf('DELETE FROM api_keys'),
      runBody.indexOf('RETURNING', runBody.indexOf('DELETE FROM api_keys'))
    );
    const tokenSelect = runBody.slice(
      runBody.lastIndexOf(
        'SELECT id FROM api_keys',
        runBody.indexOf('DELETE FROM api_keys')
      ),
      runBody.indexOf('DELETE FROM api_keys')
    );
    ok(
      'the token cleanup deletes only OAuth access tokens, never a key a person made',
      tokenSelect.includes('oauth_grant_id IS NOT NULL') &&
        tokenSelect.includes(
          'starts_with(key_prefix, ${ACCESS_TOKEN_PREFIX})'
        ) &&
        tokenDelete.includes('USING spent WHERE k.id = spent.id')
    );
    ok(
      'a token is aged from when it stopped working, never from when it was made',
      tokenSelect.includes(
        'LEAST(expires_at, revoked_at) < now() - make_interval(days => ${OAUTH_TOKEN_RETENTION_DAYS})'
      ) && !tokenSelect.includes('created_at')
    );
    const { ACCESS_TOKEN_PREFIX } = await import('@/lib/oauth/grants');
    ok(
      'the prefix the cleanup requires is the one access tokens carry, not the dashboard key prefix',
      ACCESS_TOKEN_PREFIX === 'wts_mcp_' &&
        !'wts_live_'.startsWith(ACCESS_TOKEN_PREFIX)
    );
    const { OAUTH_TOKEN_RETENTION_DAYS } =
      await import('@/app/api/cron/cleanup/route');
    const journeyMaxDays = Number(
      readFileSync('app/api/admin/analytics/journey/route.ts', 'utf8').match(
        /const MAX_DAYS = (\d+);/
      )?.[1]
    );
    ok(
      'the token cascade cannot erase usage an admin window still reads',
      journeyMaxDays > 0 && OAUTH_TOKEN_RETENTION_DAYS > journeyMaxDays
    );
    ok(
      'the token cascade cannot lower an account’s month quota',
      OAUTH_TOKEN_RETENTION_DAYS >= 32
    );
    const tokenAt = runBody.indexOf('DELETE FROM api_keys');
    const tryBefore = runBody.lastIndexOf('try {', tokenAt);
    ok(
      'the token cleanup sits in its own try, so a failure there abandons nothing after it',
      tryBefore !== -1 &&
        !runBody.slice(tryBefore, tokenAt).includes('catch (') &&
        runBody.indexOf('catch (error)', tokenAt) <
          runBody.indexOf('cleanupExpiredAuth(')
    );
    ok(
      'the token cleanup reports what it deleted',
      /oauthAccessTokens = deleted\.rows\.length;/.test(runBody) &&
        /\n\s*oauthAccessTokens,\n/.test(
          runBody.slice(runBody.lastIndexOf('NextResponse.json({'))
        )
    );
  }

  // ------------------------------------------ STA-45: retention the page states
  // Each period below is one the privacy page states, so each has to be one
  // the daily cleanup enforces, with the exact rows it may take and no more.
  // The statements are rendered through the real Drizzle dialect from the
  // real functions (a capturing stand-in for the database), so these read
  // the SQL the cron sends, not a copy of it.
  {
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const dialect = new PgDialect();
    type Rendered = { sql: string; params: unknown[] };
    const capture = async (
      run: (db: {
        execute: (q: unknown) => Promise<unknown>;
      }) => Promise<unknown>
    ): Promise<Rendered[]> => {
      const seen: Rendered[] = [];
      await run({
        execute: async (q: unknown) => {
          const r = dialect.sqlToQuery(q as never);
          seen.push({ sql: r.sql.replace(/\s+/g, ' '), params: r.params });
          return { rows: [{ n: 0 }] };
        },
      });
      return seen;
    };
    const retention = await import('@/lib/retention');
    const cache = await import('@/lib/cache');
    const limiter = await import('@/lib/rate-limiter');
    const route = await import('@/app/api/cron/cleanup/route');
    const UTC = "(now() AT TIME ZONE 'UTC')";

    const cleanup = readFileSync('app/api/cron/cleanup/route.ts', 'utf8');
    const code = withoutComments(cleanup);
    const run = code.slice(code.indexOf('async function run('));
    const authAt = run.indexOf('cleanupExpiredAuth(');

    /**
     * Each retention branch sits in its own try and runs before the
     * housekeeping tail, as the quarantine purge does, and reports its count.
     */
    for (const [call, field] of [
      ['deleteOldApiUsage(', 'apiUsageRows'],
      ['cleanupOldBuckets(', 'apiBuckets'],
      ['deleteOldLedgerRows(', 'creditLedgerRows'],
      ['countLotsDue(', 'purchaseRecords'],
      ['cleanExpiredCache(', 'walletCacheRows'],
    ] as const) {
      const at = run.indexOf(call);
      const tryAt = run.lastIndexOf('try {', at);
      ok(
        `the cleanup calls ${call.slice(0, -1)} in its own try, before the housekeeping tail`,
        at !== -1 &&
          at < authAt &&
          tryAt !== -1 &&
          !run.slice(tryAt, at).includes('catch (') &&
          run.indexOf('catch (error)', at) < authAt
      );
      ok(
        `the cleanup reports ${field}`,
        new RegExp(`\\n\\s*${field},\\n`).test(
          run.slice(run.lastIndexOf('NextResponse.json({'))
        )
      );
    }

    // ---- wallet_cache: the age the read path refuses, re-checked per row.
    const [cacheSql] = await capture((db) =>
      cache.deleteExpiredCacheBatch(db as never, 7)
    );
    const { CACHE_TTL_HOURS } = await import('@/lib/cache-constants');
    ok(
      'the cache delete takes rows past CACHE_TTL_HOURS and re-checks the row it deletes',
      cacheSql.sql.includes(
        `WHERE cached_at < ${UTC} - make_interval(hours => $1) LIMIT $2`
      ) &&
        cacheSql.sql.includes(
          `DELETE FROM wallet_cache w USING expired WHERE w.wallet = expired.wallet AND w.cached_at < ${UTC} - make_interval(hours => $3)`
        ) &&
        cacheSql.params[0] === CACHE_TTL_HOURS &&
        cacheSql.params[2] === CACHE_TTL_HOURS &&
        cacheSql.params[1] === 7
    );
    ok(
      'cleanExpiredCache reports what it deleted rather than a constant zero',
      !withoutComments(readFileSync('lib/cache.ts', 'utf8')).includes(
        'return 0;\n  } catch'
      ) &&
        (await cache.cleanExpiredCache(0, {
          execute: async () => ({ rows: [1, 1, 1] }),
        })) === 3
    );

    // ---- api_usage: 13 months, and never shorter than what the admin reads.
    const [usageSql] = await capture((db) =>
      retention.deleteOldApiUsage(db, route.API_USAGE_RETENTION_MONTHS, 9)
    );
    ok(
      'the api_usage delete ages rows by created_at in months, re-checked per row',
      usageSql.sql.includes(
        `SELECT id FROM api_usage WHERE created_at < ${UTC} - make_interval(months => $1) LIMIT $2`
      ) &&
        usageSql.sql.includes(
          `DELETE FROM api_usage u USING due WHERE u.id = due.id AND u.created_at < ${UTC} - make_interval(months => $3)`
        ) &&
        usageSql.params[0] === route.API_USAGE_RETENTION_MONTHS
    );
    // Postgres month arithmetic clamps to the month's last day, so the span
    // of N months varies; the SHORTEST one, over four years of start days,
    // must still exceed the admin journey's window.
    const journeyMax = Number(
      readFileSync('app/api/admin/analytics/journey/route.ts', 'utf8').match(
        /const MAX_DAYS = (\d+);/
      )?.[1]
    );
    let shortestSpan = Infinity;
    for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2028, 0, 1); t += 864e5) {
      const d = new Date(t);
      const m = d.getUTCMonth() - route.API_USAGE_RETENTION_MONTHS;
      const lastDay = new Date(
        Date.UTC(d.getUTCFullYear(), m + 1, 0)
      ).getUTCDate();
      const cutoff = Date.UTC(
        d.getUTCFullYear(),
        m,
        Math.min(d.getUTCDate(), lastDay)
      );
      shortestSpan = Math.min(shortestSpan, (t - cutoff) / 864e5);
    }
    ok(
      'every api_usage retention span is longer than the admin journey window',
      journeyMax > 0 && shortestSpan > journeyMax
    );

    // ---- rate_limit_buckets: aged by the period a bucket counts.
    const [bucketSql] = await capture((db) =>
      limiter.deleteSpentBucketsBatch(
        db as never,
        { minute: 'M', day: 'D', month: 'MO' },
        9
      )
    );
    ok(
      'the bucket delete compares each type’s key with that type’s cutoff, byte-wise',
      // Which param each placeholder is bound to, not just that one exists:
      // a month bucket compared with the day cutoff reads as spent every day.
      (['b', 't'] as const).every((a) =>
        (
          [
            ['minute', 'M'],
            ['day', 'D'],
            ['month', 'MO'],
          ] as const
        ).every(([t, key]) => {
          const m = bucketSql.sql.match(
            new RegExp(
              `bucket_type = '${t}' AND ${a}\\.bucket_key COLLATE "C" < \\$(\\d+)`
            )
          );
          return !!m && bucketSql.params[Number(m[1]) - 1] === key;
        })
      ) &&
        !bucketSql.sql.includes('<=') &&
        (bucketSql.sql.match(/COLLATE "C" < /g) ?? []).length === 6
    );
    ok(
      'the bucket delete never ages a bucket by when its row was created',
      !bucketSql.sql.includes('created_at') &&
        !bucketSql.sql.includes('updated_at') &&
        !withoutComments(readFileSync('lib/rate-limiter.ts', 'utf8'))
          .slice(
            withoutComments(
              readFileSync('lib/rate-limiter.ts', 'utf8')
            ).indexOf('export function bucketRetentionKeys')
          )
          .includes('createdAt')
    );
    // A short batch must not end a drain: a concurrent write can make one
    // batch remove fewer rows than it selected while more are still due
    // (Bugbot on #398). Only an empty batch, or the deadline, stops it.
    {
      const { drainBatches } = await import('@/lib/retention');
      const script = [5000, 4999, 5000, 0, 5000];
      let calls = 0;
      const total = await drainBatches(
        async () => script[calls++] ?? 0,
        Date.now() + 60_000
      );
      ok(
        'a drain keeps going after a short batch and stops only on an empty one',
        total === 14999 && calls === 4
      );
      let late = 0;
      await drainBatches(async () => {
        late++;
        return 5000;
      }, Date.now() - 1);
      ok('a drain past its deadline runs exactly one batch', late === 1);
    }
    ok(
      'the cleanup passes API_BUCKET_RETENTION_DAYS to cleanupOldBuckets',
      /cleanupOldBuckets\(\s*API_BUCKET_RETENTION_DAYS,/.test(run) &&
        route.API_BUCKET_RETENTION_DAYS > 0
    );
    // The statements are tested with the constants above; these check that
    // the route passes the same constants, and that no second call with a
    // literal sits beside the right one.
    ok(
      'the cleanup passes API_USAGE_RETENTION_MONTHS to its one deleteOldApiUsage call',
      /deleteOldApiUsage\(\s*db,\s*API_USAGE_RETENTION_MONTHS,/.test(run) &&
        run.split('deleteOldApiUsage(').length === 2
    );
    ok(
      'the cleanup passes PAYMENT_RECORD_RETENTION_YEARS to every payment-record call',
      [
        'deleteOldLedgerRows',
        'deleteOldLots',
        'clearOldStripeIds',
        'countLotsDue',
        'countStripeIdsDue',
      ].every(
        (f) =>
          new RegExp(
            `${f}\\(\\s*db,\\s*PAYMENT_RECORD_RETENTION_YEARS[,)]`
          ).test(run) && run.split(`${f}(`).length === 2
      )
    );
    // The account quota reads the CURRENT minute, day and month. As the
    // attacker, walk a year in 7-hour steps (every hour of the day comes up)
    // and look for a moment where the bucket being counted is older than the
    // cutoff, which would let the cleanup reset a quota mid-period.
    const iso = (t: number) => new Date(t).toISOString();
    const current = (t: number) => ({
      minute: iso(t).slice(0, 16),
      day: iso(t).slice(0, 10),
      month: iso(t).slice(0, 7),
    });
    let currentReachable = false;
    for (
      let t = Date.UTC(2026, 0, 1);
      t < Date.UTC(2027, 0, 1);
      t += 7 * 3600e3
    ) {
      const keys = limiter.bucketRetentionKeys(
        new Date(t),
        route.API_BUCKET_RETENTION_DAYS
      );
      const cur = current(t);
      if (
        cur.minute < keys.minute ||
        cur.day < keys.day ||
        cur.month < keys.month
      )
        currentReachable = true;
    }
    ok('no current bucket is ever older than its cutoff', !currentReachable);
    const at = (s: string) =>
      limiter.bucketRetentionKeys(new Date(s), route.API_BUCKET_RETENTION_DAYS);
    ok(
      'a month bucket from the 1st survives on the 25th',
      !('2026-09' < at('2026-09-25T12:00:00Z').month)
    );
    ok(
      'a month that ended less than 2 days ago survives, and one that ended 3 days ago goes',
      !('2026-08' < at('2026-09-02T23:59:00Z').month) &&
        '2026-08' < at('2026-09-04T00:00:00Z').month
    );
    ok(
      'a day that ended less than 2 days ago survives, and one past 2 days goes',
      !('2026-09-24' < at('2026-09-26T23:59:00Z').day) &&
        '2026-09-24' < at('2026-09-27T00:01:00Z').day
    );
    ok(
      'a minute that ended less than 2 days ago survives, and one past 2 days goes',
      !('2026-09-25T10:00' < at('2026-09-27T10:00:00Z').minute) &&
        '2026-09-25T10:00' < at('2026-09-27T10:02:00Z').minute
    );

    // ---- Payment records: 7 years; the ledger runs, lots and ids are gated.
    ok(
      'payment records are kept at least seven years',
      route.PAYMENT_RECORD_RETENTION_YEARS >= 7
    );
    const [ledgerSql] = await capture((db) =>
      retention.deleteOldLedgerRows(db, route.PAYMENT_RECORD_RETENTION_YEARS, 9)
    );
    // The whole predicate, for both aliases, as one golden string: a
    // prefix match let a subquery joined on the wrong column, a widened
    // expiry or a shortened period through. Every param is pinned too.
    const ledgerDue = (a: string, n: number) =>
      `${a}.created_at < ${UTC} - make_interval(years => $${n}) AND NOT EXISTS ( SELECT 1 FROM credit_lots l WHERE l.user_id = ${a}.user_id AND l.created_at <= ${a}.created_at AND l.expires_at > ${UTC} ) AND NOT EXISTS ( SELECT 1 FROM lookup_jobs j WHERE j.id = ${a}.job_id AND (j.status NOT IN ('completed', 'failed') OR (${a}.paid_from = 'unlock' AND j.matches_delivered IS NOT NULL)) )`;
    ok(
      'the ledger purge keeps a row a live lot could have paid for, a running job’s charge and a gated job’s unlock, in the batch and on the row',
      ledgerSql.sql.includes(
        `SELECT cl.id FROM credit_ledger cl WHERE ${ledgerDue('cl', 1)} LIMIT $2 )`
      ) &&
        ledgerSql.sql.includes(
          `WHERE c.id = due.id AND ${ledgerDue('c', 3)} RETURNING 1`
        ) &&
        (ledgerSql.sql.match(/NOT EXISTS/g) ?? []).length === 4 &&
        JSON.stringify(ledgerSql.params) ===
          JSON.stringify([
            route.PAYMENT_RECORD_RETENTION_YEARS,
            9,
            route.PAYMENT_RECORD_RETENTION_YEARS,
          ])
    );
    const [lotSql] = await capture((db) => retention.deleteOldLots(db, 7, 9));
    const [lotCount] = await capture((db) => retention.countLotsDue(db, 7));
    ok(
      'a lot is due only when it is past the period AND expired, in the count, the batch and on the row',
      (
        lotSql.sql.match(
          new RegExp(`expires_at <= \\(now\\(\\) AT TIME ZONE 'UTC'\\)`, 'g')
        ) ?? []
      ).length === 2 &&
        lotCount.sql.includes(`l.expires_at <= ${UTC}`) &&
        lotCount.sql.startsWith('SELECT count(*)')
    );
    const [idsSql] = await capture((db) =>
      retention.clearOldStripeIds(db, 7, 9)
    );
    ok(
      'the Stripe-id clear nulls only the two ids, never the account, its tier or paid_at',
      idsSql.sql.includes(
        'SET stripe_customer_id = NULL, stripe_payment_id = NULL'
      ) && !/DELETE|tier =|paid_at =/.test(idsSql.sql)
    );
    /**
     * The lot and Stripe-id purge is OFF until the replay key, the loyalty
     * count and "has bought" stop reading the lot (see the flag's comment).
     * Switching it on is a decision, so it is an edit here as well.
     */
    ok(
      'PURCHASE_RECORD_PURGE_ENABLED stays false',
      route.PURCHASE_RECORD_PURGE_ENABLED === false
    );
    const gateAt = run.indexOf('if (PURCHASE_RECORD_PURGE_ENABLED) {');
    const elseAt = run.indexOf('} else {', gateAt);
    ok(
      'the lot delete and the Stripe-id clear are reachable only through the flag',
      gateAt !== -1 &&
        [
          run.indexOf('deleteOldLots('),
          run.indexOf('clearOldStripeIds('),
        ].every((i) => i > gateAt && i < elseAt) &&
        run.split('deleteOldLots(').length === 2 &&
        run.split('clearOldStripeIds(').length === 2
    );

    // ---- lifecycle_emails: kept while the account exists, on purpose.
    ok(
      'the cleanup never deletes lifecycle email records',
      !/lifecycle_emails|lifecycleEmails/.test(run)
    );
  }

  // ------------------------------------------- STA-45: the session user agent
  // Nothing read it back, so it was a record of each sign-in's browser kept
  // for no purpose. It is no longer written, and the stored values are
  // cleared by a data-only migration run after the deploy.
  {
    const { createSession } = await import('@/lib/auth');
    ok(
      'createSession takes no user agent',
      createSession.length === 1 &&
        !withoutComments(readFileSync('lib/auth.ts', 'utf8')).includes(
          'userAgent'
        )
    );
    ok(
      'the sign-in route does not read the user agent',
      !withoutComments(readFileSync('app/api/auth/verify/route.ts', 'utf8'))
        .toLowerCase()
        .includes('user-agent')
    );
    const migration = withoutComments(
      readFileSync('scripts/migrate-clear-session-user-agents.ts', 'utf8')
    );
    ok(
      'the user-agent migration is a dry run unless told to commit, and only sets the column to NULL',
      migration.includes("const commit = process.argv.includes('--commit');") &&
        migration.indexOf('if (!commit)') < migration.indexOf('UPDATE') &&
        migration.includes('SET user_agent = NULL') &&
        !/DELETE|DROP|ALTER/.test(migration)
    );
  }

  // --------------------------------------------- STA-45: identifiers in logs
  // The host keeps function logs. An email or wallet printed there is a copy
  // outside every control the schema enforces, so the call sites mask what
  // they print and the console net masks what they cannot (an error object
  // printed whole: a failed Drizzle query carries its parameters).
  {
    const { maskEmail, maskWallet, redact, redactConsole } =
      await import('@/lib/redact');
    const { format } = await import('node:util');
    const wallet = '0x' + 'ab12'.repeat(10);
    const txHash = '0x' + 'cd34'.repeat(16);
    ok(
      'maskEmail keeps the first letters and the domain',
      maskEmail('alice.smith@example.com') === 'al***@example.com' &&
        maskEmail('jb@example.com') === 'j***@example.com'
    );
    ok(
      'maskWallet keeps the first 6 and last 4',
      maskWallet(wallet) === '0xab12...ab12'
    );
    const line = `paid by ${wallet} for alice.smith@example.com, tx ${txHash}, settlement base:${wallet}:${txHash}`;
    const masked = redact(line);
    ok(
      'redact masks every email and wallet in a line and leaves a 64-digit hash whole',
      !masked.includes(wallet) &&
        !masked.includes('alice.smith@') &&
        masked.includes(txHash) &&
        masked.includes('0xab12...ab12') &&
        masked.includes('al***@example.com')
    );
    ok('masking twice changes nothing', redact(masked) === masked);
    // The net runs on every log line, so it must stay linear on the input
    // a regex handles worst: a long run of address characters with no `@`.
    // Unbounded, 200,000 characters take tens of seconds; bounded, a few ms.
    const longRun = 'A'.repeat(200_000);
    const startedAt = Date.now();
    redact(longRun);
    redact('a@' + 'a.'.repeat(100_000));
    ok(
      'redact stays linear on a 200 KB run with no address in it',
      Date.now() - startedAt < 1000
    );

    // The net, attacked with the line no call site controls: a Drizzle error
    // whose params are an email and a wallet.
    const printed: string[] = [];
    const sink = {
      log: (...a: unknown[]) => printed.push(a.map(String).join(' ')),
      info: (...a: unknown[]) => printed.push(a.map(String).join(' ')),
      warn: (...a: unknown[]) => printed.push(a.map(String).join(' ')),
      error: (...a: unknown[]) => printed.push(a.map(String).join(' ')),
      debug: (...a: unknown[]) => printed.push(a.map(String).join(' ')),
    };
    redactConsole(sink, format);
    sink.error(
      'Cache write error:',
      new DrizzleQueryError(
        'insert into "users" ("email", "wallet") values ($1, $2)',
        ['alice.smith@example.com', wallet],
        new Error('duplicate key')
      )
    );
    sink.log(`granted to ${wallet}`);
    ok(
      'the console net masks an error object’s params and a plain line',
      printed.length === 2 &&
        printed.every(
          (p) => !p.includes(wallet) && !p.includes('alice.smith@example.com')
        ) &&
        printed[0].includes('al***@example.com') &&
        printed[0].includes('Cache write error:')
    );
    const withheld: string[] = [];
    const sink2 = {
      log: (...a: unknown[]) => withheld.push(a.map(String).join(' ')),
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    redactConsole(sink2, () => {
      throw new Error('unformattable');
    });
    sink2.log(`raw ${wallet}`);
    ok(
      'a line that cannot be formatted is withheld, never printed raw',
      withheld.length === 1 && !withheld[0].includes(wallet)
    );

    const instrumentation = withoutComments(
      readFileSync('instrumentation.ts', 'utf8')
    );
    ok(
      'instrumentation.ts installs the net on the Node runtime',
      /if \(process\.env\.NEXT_RUNTIME === 'nodejs'\) \{\s*const \{ format \} = await import\('node:util'\);\s*const \{ redactConsole \} = await import\('@\/lib\/redact'\);\s*redactConsole\(console, format\);\s*\}/.test(
        instrumentation
      ) &&
        existsSync('instrumentation.ts') &&
        !existsSync('src/instrumentation.ts')
    );

    /**
     * No `console.*` call interpolates a raw email or wallet. Heuristic:
     * every `${...}` and every bare argument is split into identifiers, and
     * one named like an email or a wallet must sit inside maskEmail,
     * maskWallet or redact. Read with the TypeScript parser, so a comment or
     * a string that merely mentions `${email}` is not a call.
     */
    const ts = (await import('typescript')).default;
    const RAW =
      /^(email|emails|wallet|wallets|payer|address|addresses|walletOrEns|settlementId|recipient)$/i;
    // A collection's contract address, not a person's wallet. The console
    // net still masks it in the printed line; the label beside it names it.
    const ALLOWED = new Set(['lib/seed-collections.ts::candidate.address']);
    const offenders = (file: string, source: string): string[] => {
      const out: string[] = [];
      const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
      const masked = (e: import('typescript').Node): boolean =>
        ts.isCallExpression(e) &&
        ts.isIdentifier(e.expression) &&
        ['maskEmail', 'maskWallet', 'redact'].includes(e.expression.text);
      const inspect = (e: import('typescript').Expression) => {
        if (masked(e)) return;
        const text = e.getText(sf);
        if (ALLOWED.has(`${file}::${text}`)) return;
        let raw = false;
        const walk = (n: import('typescript').Node) => {
          if (masked(n)) return;
          // A count of wallets is a number, not a wallet.
          if (
            ts.isPropertyAccessExpression(n) &&
            ['length', 'size'].includes(n.name.text)
          )
            return;
          if (ts.isIdentifier(n) && RAW.test(n.text)) raw = true;
          ts.forEachChild(n, walk);
        };
        walk(e);
        if (raw) out.push(`${file}: ${text}`);
      };
      const visit = (n: import('typescript').Node) => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          ts.isIdentifier(n.expression.expression) &&
          n.expression.expression.text === 'console'
        ) {
          for (const a of n.arguments) {
            if (ts.isTemplateExpression(a)) {
              for (const s of a.templateSpans) inspect(s.expression);
            } else if (!ts.isStringLiteralLike(a)) {
              inspect(a);
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return out;
    };
    // Prove it can fail before trusting a clean result.
    ok(
      'the log scan flags a raw email and a raw wallet, and passes masked ones',
      offenders(
        'x.ts',
        'console.log(`to ${email}`); console.error(`w=${user.wallet}`, err); console.log(`${wallets.length} of`, wallets);'
      ).length === 3 &&
        offenders(
          'x.ts',
          'console.log(`to ${maskEmail(email)} ${maskWallet(w.wallet)} ${redact(id)} ${emailKey}`);'
        ).length === 0
    );
    const files: string[] = [];
    const walkDir = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${f.name}`;
        if (f.isDirectory()) walkDir(p);
        else if (/\.tsx?$/.test(f.name)) files.push(p);
      }
    };
    for (const dir of ['app', 'lib', 'inngest']) walkDir(dir);
    let consoleCalls = 0;
    const found: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      consoleCalls += (withoutComments(src).match(/\bconsole\.\w+\(/g) ?? [])
        .length;
      found.push(...offenders(f, src));
    }
    ok(
      `no console call interpolates a raw email or wallet${found.length ? `: ${found.join('; ')}` : ''}`,
      found.length === 0 && consoleCalls > 250
    );
  }

  // ------------------------------------------- OAuth: what a restore contains
  // A grant is a live credential, not a record. Restoring one from last night
  // would resurrect a connection somebody revoked this morning, which is the
  // opposite of what a disconnect button is understood to have done.
  {
    const grants = readFileSync('scripts/migrate-grant-readonly.ts', 'utf8');
    const readOnly =
      grants.match(/const READ_ONLY_TABLES = \[([\s\S]*?)\]/)?.[1] ?? '';
    const backup =
      grants.match(/const BACKUP_TABLES = \[([\s\S]*?)\]/)?.[1] ?? '';
    for (const table of [
      'oauth_clients',
      'oauth_grants',
      'oauth_authorization_requests',
    ]) {
      ok(`${table} is readable by CI`, readOnly.includes(`'${table}'`));
      ok(`${table} is NOT in the nightly dump`, !backup.includes(`'${table}'`));
    }
  }

  // -------------------------------------- Concierge: what reaches a shortlist
  // The daily brief exists to be replied to, so a candidate on it is a candidate
  // somebody will publicly answer. The Warpcast search endpoint takes no date
  // parameter and ranks by relevance: the lane shipped returning casts from
  // February 2024 next to ones from that morning, and the comment saying the
  // lane was "live announcements" was the only thing standing in the way.
  {
    const now = new Date('2026-08-25T12:00:00Z');
    const day = 24 * 60 * 60 * 1000;
    const maxAge = 7;

    // The attacker is a stale cast trying to reach a human's reply box.
    ok(
      'a cast from 2024 is refused',
      freshCastTime(new Date('2024-02-07T05:33:00Z').getTime(), now, maxAge) ===
        null
    );
    ok(
      'a cast one day past the window is refused',
      freshCastTime(now.getTime() - (maxAge + 1) * day, now, maxAge) === null
    );

    // An absent or renamed field must not read as fresh. This is the shape the
    // gate is most likely to meet in production, because the endpoint is
    // undocumented and may rename `timestamp` without notice.
    for (const [label, raw] of [
      ['absent', undefined],
      ['null', null],
      ['a string', '1738906380000'],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ] as Array<[string, unknown]>) {
      ok(
        `a timestamp that is ${label} is refused`,
        freshCastTime(raw, now, maxAge) === null
      );
    }

    // A far-future timestamp is worse than a stale one: it sorts to the top of
    // a recency ranking and stays there every day until somebody notices.
    ok(
      'a cast dated a year ahead is refused',
      freshCastTime(now.getTime() + 365 * day, now, maxAge) === null
    );
    ok(
      'a cast just inside the skew allowance is kept',
      freshCastTime(now.getTime() + FUTURE_SKEW_MS / 2, now, maxAge) !== null
    );

    // Prove the gate can pass, or every assertion above is satisfied by a
    // function that returns null unconditionally.
    const fresh = now.getTime() - day;
    ok(
      'a cast from yesterday is kept, and keeps its own time',
      freshCastTime(fresh, now, maxAge)?.getTime() === fresh
    );

    // The lane has to actually call it. An exported predicate nothing invokes
    // is a test of itself.
    const lane = readFileSync('scripts/concierge-signals.ts', 'utf8');
    ok(
      'the Farcaster lane routes its timestamp through the gate',
      /freshCastTime\(\s*c\.timestamp/.test(lane)
    );
    ok(
      'the Farcaster lane drops what the gate refuses',
      /freshCastTime\([^)]*\);\s*if \(!ts\) \{[\s\S]{0,80}?continue;/.test(lane)
    );
    // The exclusion list is what stops a daily brief repeating itself. The
    // index lane ranks 54 collections by a score that does not move between
    // runs, so with no memory it prints the same three teams every morning.
    // A miss here is silent: it looks exactly like a prospect nobody listed.
    {
      const seen = parseExclusions(
        '0x699727F9E01A822EFDCF7333073F0461E5914B4E, @Warplets ,Kemonokaki,,'
      );

      ok('empty entries never become keys', seen.size === 3);

      // The attacker is a prospect already written up, trying for a second
      // slot by changing case, padding, or which identity it arrives under.
      ok(
        'a contract in the list is excluded whatever its case',
        isExcluded(
          { address: '0x699727f9e01a822efdcf7333073f0461e5914b4e' },
          seen
        )
      );
      ok(
        'a handle in the list is excluded without its @',
        isExcluded({ handle: 'warplets' }, seen)
      );
      ok(
        'a handle in the list is excluded with its @',
        isExcluded({ handle: '@WARPLETS' }, seen)
      );
      ok(
        'a collection name in the list is excluded',
        isExcluded({ name: ' kemonokaki ' }, seen)
      );
      ok(
        'one matching identity is enough when the others differ',
        isExcluded(
          { address: '0xdeadbeef', handle: null, name: 'Kemonokaki' },
          seen
        )
      );

      // Prove it can pass, or a function excluding everything satisfies all of
      // the above and the brief silently comes back empty every day.
      ok(
        'a prospect not in the list is kept',
        !isExcluded(
          { address: '0xabc', handle: 'someoneelse', name: 'Lil Bangers' },
          seen
        )
      );
      ok(
        'an empty list excludes nothing',
        !isExcluded({ address: '0xabc', name: 'Anything' }, new Set())
      );

      // A candidate with no identity at all must not collide with a blank key.
      ok(
        'a candidate with no identity is never excluded',
        !isExcluded({ address: null, handle: null, name: null }, seen) &&
          !isExcluded({}, parseExclusions(',  ,@,'))
      );

      // Exclusion has to happen after the lanes are merged. A candidate that
      // arrives twice merges into one entry carrying both a contract and a
      // handle, and either may be the identity the list holds; filtering the
      // raw candidates drops the copy that matched and keeps the one that did
      // not.
      const lane = readFileSync('scripts/concierge-signals.ts', 'utf8');
      const afterDedupe = lane.indexOf('const fresh = [...best.values()]');
      ok(
        'exclusion runs on the deduped set, not the raw candidates',
        afterDedupe > lane.indexOf('const best = new Map') &&
          /best\.values\(\)\]\.filter\(\(c\) => !isExcluded\(c, excluded\)\)/.test(
            lane
          )
      );
      ok(
        'the shortlist is sliced from the filtered set',
        /const ranked = fresh\.slice\(0, limit\)/.test(lane)
      );
    }
  }

  // ------------------------------------ Reverse lookup: what a free caller gets
  // The count is free and the addresses are paid. That split is published in
  // prose on /check and in /api/reachability, and until now the app's own
  // reverse lookup implemented neither half: it answered a stranger with a
  // price and nothing else. Opening it up is only safe if the free branch
  // cannot be talked into returning a wallet.
  {
    // The attacker is a caller with no credits, trying to get one address out.
    for (const total of [0, 1, 99, 100, 240, 1_000_000]) {
      const body = lockedReverseBody('twitter', 'vitalikbuterin', total);
      const wire = JSON.stringify(body);
      ok(
        `a locked body for ${total} wallets carries no address`,
        !ADDRESS_SHAPE.test(wire)
      );
      ok(
        `a locked body for ${total} wallets returns no rows`,
        body.results.length === 0 && body.meta.returned_count === 0
      );
      ok(
        `a locked body for ${total} wallets still reports the count`,
        body.meta.total_count === total
      );
    }

    // The count is the free half, so it has to survive. A function that zeroed
    // everything would pass every assertion above.
    ok(
      'the count is not silently zeroed',
      lockedReverseBody('farcaster', 'dwr', 240).meta.total_count === 240
    );

    // A negative count can only come from a bug, and it renders as "-1 wallets".
    ok(
      'a negative count floors at zero',
      lockedReverseBody('twitter', 'x', -5).meta.total_count === 0
    );

    // The copy must not promise addresses it will not deliver.
    for (const total of [0, 3]) {
      const msg = lockedReverseMessage(total, 'twitter');
      ok(
        `the locked message for ${total} carries no address`,
        !ADDRESS_SHAPE.test(msg)
      );
    }

    /**
     * A miss means opposite things on the two networks, and the product is
     * sold on the difference.
     *
     * Farcaster coverage is complete, so nothing there is a fact about the
     * account. An X handle is known only when its owner published the link, so
     * nothing there is a fact about the account. The first version of the
     * locked copy gave both networks the coverage explanation, which told
     * every locked Farcaster caller the opposite of what a paying caller is
     * told about the same handle (Bugbot, 2026-08-25).
     */
    const fcMiss = lockedReverseMessage(0, 'farcaster');
    const xMiss = lockedReverseMessage(0, 'twitter');
    ok('the two networks get different miss explanations', fcMiss !== xMiss);
    ok(
      'a Farcaster miss is explained as a fact about the account',
      fcMiss.includes(MISS_EXPLANATION.farcaster) &&
        !fcMiss.includes(MISS_EXPLANATION.twitter)
    );
    ok(
      'an X miss is explained as a gap in our evidence',
      xMiss.includes(MISS_EXPLANATION.twitter) &&
        !xMiss.includes(MISS_EXPLANATION.farcaster)
    );
    ok(
      'neither miss explanation claims completeness for X',
      !MISS_EXPLANATION.twitter.includes('complete')
    );

    // The paid empty state and the free locked answer must tell one story.
    // They were separate string literals, which is how they disagreed.
    const panel = readFileSync('components/ReverseLookup.tsx', 'utf8');
    ok(
      'the empty state reads the shared explanations rather than its own copy',
      panel.includes('MISS_EXPLANATION.farcaster') &&
        panel.includes('MISS_EXPLANATION.twitter') &&
        !panel.includes('Farcaster coverage is complete, so this account')
    );

    /**
     * The body is only half the guarantee.
     *
     * A route that read every wallet and then declined to print them would
     * satisfy every assertion above while holding the addresses in memory, one
     * stray log line from disclosure. The locked return has to come before the
     * query that selects them.
     */
    const route = readFileSync('app/api/reverse/route.ts', 'utf8');
    // Anchored on the computed count, because it is no longer the first
    // lockedReverseBody in the file: the suppression branch above the count
    // deliberately returns a zero-count locked body BEFORE any count is read
    // (a suppressed handle must never learn its own total). The paywall gate
    // is the one that reports totalCount, and it is the one these ordering
    // assertions are about.
    const lockedReturn = route.indexOf(
      'return NextResponse.json(lockedReverseBody(platform, handle, totalCount))'
    );
    const rowQuery = route.indexOf('.limit(MAX_RESULTS)');
    const countQuery = route.indexOf('COUNT(*)::int');
    ok(
      'the route has a locked return at all',
      lockedReturn > 0 && rowQuery > 0 && countQuery > 0
    );
    ok(
      'the locked branch returns before the row query runs',
      lockedReturn < rowQuery
    );
    ok(
      'the locked branch runs after the count, so it has a count to report',
      countQuery < lockedReturn
    );
    ok(
      'the locked branch is guarded by entitlement, not by session',
      /if \(!entitled\) \{\s*return NextResponse\.json\(lockedReverseBody/.test(
        route
      )
    );

    // The free branch is bounded per address, or the count becomes a way to
    // enumerate the index one handle at a time.
    // Comment-stripped, or a commented-out entry keeps the assertion green:
    // the exact trap the withoutComments docstring documents, reproduced here
    // by a mutation test against the raw read.
    const limits = withoutComments(
      readFileSync('lib/ip-rate-limiter.ts', 'utf8')
    );
    ok(
      "'/api/reverse' has an IP rate limit",
      /'\/api\/reverse':\s*\{\s*limit:/.test(limits)
    );
    ok(
      'the unentitled branch actually calls the limiter',
      /if \(!entitled\) \{[\s\S]{0,400}?checkIpRateLimit\([\s\S]{0,80}?'\/api\/reverse'\)/.test(
        route
      )
    );

    // Signing in is not what unlocks this, and the endpoint must not go back
    // to refusing anonymous callers the count that /api/reachability gives
    // them with no cookie at all.
    ok(
      'a missing session is not answered with 401',
      !/Sign in to use reverse lookup/.test(route)
    );

    /**
     * The FID enrichment endpoint spends our provider credential, one upstream
     * request per username in the body, and it shipped with no bound of any
     * kind: an anonymous POST was an open proxy for a credit pool that has
     * already been exhausted once this year.
     *
     * The order matters as much as the presence. A limiter called after the
     * upstream fetch has already paid for the request it is refusing, so the
     * refusal must come first. Both positions have to exist before `<` means
     * anything: `indexOf` answers -1 for absent, and -1 is less than every
     * real index, so a bare comparison reports "the check comes first" most
     * loudly when the check has been deleted.
     *
     * The anchor is `checkIpRateLimit(` and not the endpoint string, because
     * an earlier draft anchored on `'/api/enrich-fids'` and a mutation test
     * beat it: any benign earlier occurrence of that string (a log line, a
     * telemetry tag) satisfied the order check with the whole guard moved
     * after the fetch. The trailing paren is what keeps this anchor off the
     * import line, which reads `checkIpRateLimit,`.
     */
    const enrich = withoutComments(
      readFileSync('app/api/enrich-fids/route.ts', 'utf8')
    );
    ok(
      'both enrichment buckets exist, anonymous and signed-in',
      /'\/api\/enrich-fids':\s*\{\s*limit:/.test(limits) &&
        /'\/api\/enrich-fids:user':\s*\{\s*limit:/.test(limits)
    );
    const enrichLimitPos = enrich.indexOf('checkIpRateLimit(');
    const enrichFetchPos = enrich.indexOf('fetchFidsByUsernames(');
    ok(
      'every caller class is refused before the upstream spend',
      enrichLimitPos >= 0 &&
        enrichFetchPos >= 0 &&
        enrichLimitPos < enrichFetchPos
    );
    // The bucket counts usernames, not envelopes. A request-shaped count
    // understates the exposure by the batch factor of 100.
    ok(
      'the limiter is charged per username',
      /checkIpRateLimit\([\s\S]{0,160}?limitedUsernames\.length/.test(enrich)
    );
    ok('the refusal is a refusal, not a warning', /status: 429/.test(enrich));

    // And the spend it makes is a spend the monthly counter sees. The budget
    // exists to tell background work how much room is left, and a caller the
    // counter cannot see makes that answer wrong for everyone else.
    const fidsFn = withoutComments(readFileSync('lib/neynar.ts', 'utf8'));
    const fidsFnStart = fidsFn.indexOf(
      'export async function fetchFidsByUsernames'
    );
    const fidsSpendPos = fidsFn.indexOf('void recordSpend(usernames.length)');
    ok(
      'the per-username enrichment reports its spend',
      fidsFnStart >= 0 && fidsSpendPos > fidsFnStart
    );

    /**
     * The second attested account is searchable, and searching it discloses no
     * more than searching the primary does.
     *
     * `countBySecondaryHandle` returns a number and `walletsBySecondaryHandle`
     * returns addresses. The count belongs above the entitlement gate, because
     * an unentitled caller is told the total; the list belongs below it,
     * because the header of that route is explicit that the address query must
     * not run for them at all. The first draft of this feature resolved the
     * wallet list above the gate to build the count, which satisfied every
     * response-shape check and did exactly the work the header forbids.
     */
    const secondaryCount = route.indexOf('countBySecondaryHandle(');
    const secondaryList = route.indexOf('walletsBySecondaryHandle(');
    ok(
      'reverse matches the second attested account at all',
      secondaryCount > 0 && secondaryList > 0
    );
    ok(
      'the free count counts, and never resolves the addresses',
      secondaryCount < lockedReturn && secondaryList > lockedReturn
    );

    /**
     * Reverse and the row display share one gate.
     *
     * A wallet returned for a handle its own row does not show is worse than
     * the gap this closed: the caller is told a wallet belongs to a handle,
     * opens the row, and finds no such handle on it. Both read the same `FROM`
     * clause and the same source allowlist.
     */
    const reach = readFileSync('lib/handle-reachability.ts', 'utf8');
    const reachCode = withoutComments(reach);
    ok(
      'both secondary queries are built from one FROM clause',
      (reachCode.match(/secondaryHandleFrom\(normalized\)/g) ?? []).length === 2
    );
    ok(
      'the secondary gate filters on the public source allowlist',
      /w\.their_source = ANY\(\$\{sql\.param\(MAPPED_SOURCE_IDS\)\}/.test(
        reachCode
      )
    );
    ok(
      'the allowlist is derived from the class map, not typed out again',
      /Object\.entries\(SOURCE_CLASSES\)/.test(
        withoutComments(readFileSync('lib/api-sources.ts', 'utf8'))
      )
    );

    /**
     * Reverse lookups return attested links only (Linear STA-40).
     *
     * They promise wallets "attested to" a handle, and sources are recorded
     * per wallet, not per handle, so only a row whose every source is attested
     * can keep that promise. One predicate, used by the count and by every
     * page on all three doors, because a total that disagrees with its pages
     * is how a paginated endpoint reports wallets it will not hand out.
     */
    {
      const { ATTESTED_SOURCE_ID_LIST, ATTESTED_SOURCE_IDS } =
        await import('@/lib/api-sources');
      ok(
        'the attested list is the attested set, and names no correlated source',
        ATTESTED_SOURCE_ID_LIST.length === ATTESTED_SOURCE_IDS.size &&
          ATTESTED_SOURCE_ID_LIST.every((id) => ATTESTED_SOURCE_IDS.has(id)) &&
          !ATTESTED_SOURCE_ID_LIST.includes('web3bio') &&
          !ATTESTED_SOURCE_ID_LIST.includes('zora_profile') &&
          !ATTESTED_SOURCE_ID_LIST.includes('none')
      );
      const sg = withoutComments(readFileSync('lib/social-graph.ts', 'utf8'));
      const predStart = sg.indexOf('export function everySourceAttested()');
      const predBody = sg.slice(predStart, sg.indexOf('\n}', predStart) + 2);
      ok(
        'a row qualifies only when it has real sources and every one is attested; the none marker is ignored',
        predStart !== -1 &&
          /^export function everySourceAttested\(\) \{\s*return sql`\(cardinality\(array_remove\(\$\{socialGraph\.sources\}, 'none'\)\) > 0 AND array_remove\(\$\{socialGraph\.sources\}, 'none'\) <@ \$\{sql\.param\(ATTESTED_SOURCE_ID_LIST\)\}::text\[\]\)`;\s*\}$/.test(
            predBody
          )
      );
      const v1x = withoutComments(
        readFileSync('app/api/v1/reverse/twitter/[handle]/route.ts', 'utf8')
      );
      ok(
        '/v1 X reverse: the primary match requires an attested row, and the count and the pages share it',
        /const primary = and\(\s*eq\(socialGraph\.twitterHandle, normalizedHandle\),\s*everySourceAttested\(\)\s*\);/.test(
          v1x
        ) &&
          /\? or\(primary, inArray\(socialGraph\.wallet, secondary\)\)\s*: primary;/.test(
            v1x
          ) &&
          /\.from\(socialGraph\)\s*\.where\(matchesHandle\);/.test(v1x) &&
          /afterCursor === undefined\s*\?\s*matchesHandle\s*:\s*and\(matchesHandle, afterCursor\)/.test(
            v1x
          ) &&
          !/twitter_handle|twitterHandle\s*[=)]|ilike|lower\(\$\{socialGraph\.twitterHandle/.test(
            v1x.slice(v1x.indexOf('const primary = and('))
          ) &&
          (
            v1x.match(/eq\(socialGraph\.twitterHandle, normalizedHandle\)/g) ??
            []
          ).length === 1
      );
      const v1f = withoutComments(
        readFileSync('app/api/v1/reverse/farcaster/[username]/route.ts', 'utf8')
      );
      ok(
        '/v1 Farcaster reverse: one attested predicate for the count and every page',
        /const matchesName = and\(\s*eq\(socialGraph\.farcaster, normalizedUsername\),\s*everySourceAttested\(\)\s*\);/.test(
          v1f
        ) &&
          /\.where\(matchesName\);/.test(v1f) &&
          v1f.includes(
            'afterCursor === undefined ? matchesName : and(matchesName, afterCursor)'
          ) &&
          (v1f.match(/eq\(socialGraph\.farcaster, normalizedUsername\)/g) ?? [])
            .length === 1
      );
      const app = withoutComments(
        readFileSync('app/api/reverse/route.ts', 'utf8')
      );
      ok(
        "the site's reverse search applies the same predicate to its count and its rows",
        app.includes(
          'const primary = and(eq(primaryColumn, handle), everySourceAttested());'
        ) &&
          /\.from\(socialGraph\)\s*\.where\(primary\);/.test(app) &&
          /\.from\(socialGraph\)[\s\S]{0,200}?\.where\(matchesHandle\)/.test(
            app
          ) &&
          /\? or\(primary, inArray\(socialGraph\.wallet, secondary\)\)\s*: primary;/.test(
            app
          ) &&
          (app.match(/eq\(primaryColumn, handle\)/g) ?? []).length === 1
      );
      const pickStart = reachCode.indexOf('SELECT DISTINCT ON (c.wallet)');
      const pick = reachCode.slice(
        reachCode.indexOf('WHERE c.platform', pickStart),
        reachCode.indexOf('ORDER BY c.wallet', pickStart)
      );
      const after = reachCode.slice(
        reachCode.indexOf(') w', pickStart),
        reachCode.indexOf('`;', pickStart)
      );
      ok(
        'the second-account pick uses only the conditions the display picks with, and every other filter runs after it, as the display does',
        pickStart !== -1 &&
          pick.length > 0 &&
          !/their_source|c\.ours|c\.theirs\) <>|twitter_handle/.test(pick) &&
          /WHERE w\.theirs = \$\{normalized\}\s*AND w\.ours = w\.primary_handle\s*AND w\.theirs <> w\.primary_handle\s*AND w\.their_source = ANY\(\$\{sql\.param\(MAPPED_SOURCE_IDS\)\}::text\[\]\)\s*AND w\.their_source = ANY\(\$\{sql\.param\(ATTESTED_SOURCE_ID_LIST\)\}::text\[\]\)/.test(
            after
          )
      );
      const reachRoute = withoutComments(
        readFileSync('app/api/reachability/route.ts', 'utf8')
      );
      const hero = withoutComments(
        readFileSync('lib/identity-hero/server.ts', 'utf8')
      );
      ok(
        "/check's wallet count and the homepage hero use the reverse rule, so no surface counts a wallet reverse will not return",
        /WHERE lower\(twitter_handle\) = \$\{handle\}\s*AND \$\{everySourceAttested\(\)\}\) AS wallets/.test(
          reachRoute
        ) &&
          /eq\(socialGraph\.farcasterVerified, true\),\s*everySourceAttested\(\)/.test(
            hero
          )
      );
    }

    /**
     * The X field says when a handle rests only on owner-typed text (STA-40).
     *
     * An ENS or Basename text record, a governance profile or a
     * social-protocol profile attribute is the wallet owner's own act, which
     * is why it counts as attested, but the handle in it is a claim anyone can
     * type about any account. `self_declared` is served only when that is
     * certain: every source on the row is such a record. Sources are per
     * wallet, so a mixed row cannot say which source supplied the handle, and
     * the field is omitted rather than served as a false that would read as
     * "the account confirmed it".
     */
    {
      const {
        isSelfDeclared,
        SELF_DECLARED_SOURCE_IDS,
        MAPPED_SOURCE_IDS,
        publicSources,
      } = await import('@/lib/api-sources');
      const { publicTwitterField } = await import('@/lib/handle-reachability');
      ok(
        'a row backed only by owner-typed records is self-declared',
        isSelfDeclared(['ens']) &&
          isSelfDeclared(['basename_record', 'ens_onchain']) &&
          isSelfDeclared(['lens_profile', 'none']) &&
          isSelfDeclared(['snapshot_profile'])
      );
      ok(
        'and a mixed, empty or checked row is not',
        !isSelfDeclared(['ens', 'neynar']) &&
          !isSelfDeclared(['basename_record', 'farcaster_sweep']) &&
          !isSelfDeclared(['ethos']) &&
          !isSelfDeclared(['none']) &&
          !isSelfDeclared([]) &&
          !isSelfDeclared(null)
      );
      ok(
        'the self-declared set is exactly the five owner-typed record sources',
        SELF_DECLARED_SOURCE_IDS.size === 5 &&
          [
            'ens',
            'ens_onchain',
            'basename_record',
            'snapshot_profile',
            'lens_profile',
          ].every((id) => SELF_DECLARED_SOURCE_IDS.has(id))
      );
      // A new text-record source classed `onchain` is owner-typed by
      // definition; it must join the set, not silently read as checked.
      const onchainIds = [...MAPPED_SOURCE_IDS].filter(
        (id) => id !== 'onchain' && publicSources([id])?.[0] === 'onchain'
      );
      ok(
        'every onchain text-record source is self-declared',
        onchainIds.length >= 3 &&
          onchainIds.every((id) => SELF_DECLARED_SOURCE_IDS.has(id))
      );
      const flagged = publicTwitterField({ handle: 'a', selfDeclared: true });
      const unflagged = publicTwitterField({
        handle: 'a',
        selfDeclared: false,
      });
      ok(
        'the X field carries self_declared only when true, never as false',
        flagged.self_declared === true && !('self_declared' in unflagged)
      );

      for (const route of [
        'app/api/v1/wallet/[address]/route.ts',
        'app/api/v1/batch/route.ts',
        'app/api/v1/reverse/twitter/[handle]/route.ts',
        'app/api/v1/reverse/farcaster/[username]/route.ts',
        'app/api/wallet-socials/route.ts',
      ]) {
        const src = withoutComments(readFileSync(route, 'utf8'));
        ok(
          `${route} derives self_declared from the row's own sources`,
          /selfDeclared: isSelfDeclared\((result|row)\.sources\)/.test(src)
        );
      }
      const jobsSrc = withoutComments(
        readFileSync('app/api/v1/jobs/[id]/route.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      ok(
        'the jobs route reads self_declared from the graph, per served handle',
        jobsSrc.includes('selfDeclaredXWallets(handleRows)') &&
          jobsSrc.includes(
            'selfDeclared: selfDeclared.has(r.wallet.toLowerCase()),'
          )
      );
      const hr = withoutComments(
        readFileSync('lib/handle-reachability.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      ok(
        'the MCP record keeps self_declared through its trim',
        withoutComments(readFileSync('app/api/mcp/route.ts', 'utf8')).includes(
          'if (twitter.self_declared === true) x.self_declared = true;'
        )
      );
      ok(
        'and a graph row about a different handle never flags the served one',
        hr.includes(
          'if (!served || row.twitter_handle.toLowerCase() !== served) continue; if (isSelfDeclared(row.sources)) out.add(wallet);'
        )
      );
    }

    /**
     * A reassigned handle never carries a follower count.
     *
     * The other three unreachable states are safe by accident: `x_accounts`
     * holds no followers for a suspended or vacated handle, because there is
     * no profile left to count, and none at all for one nothing has swept.
     * `reassigned` is the exception and it is the dangerous one. The handle
     * resolves perfectly: a live account, with a real and possibly large
     * follower count, belonging to the stranger who took the name after the
     * owner renamed away from it. Publishing that number beside the wallet
     * would attach a measured-looking figure to a person who does not own the
     * address, which is the failure `lib/x-accounts.ts` opens by naming as the
     * most expensive mistake available here, with a number on it to make it
     * persuasive.
     *
     * Two ways it could come back, so both are refused. The override could
     * start selecting the column, and it could start building its record by
     * spreading the row it overrides instead of writing the three fields out.
     * The second is the likely one, because a spread is what a tidying pass
     * reaches for and it reads as obviously equivalent.
     *
     * Omitting the field outright is already impossible: `followers` is
     * required on `HandleReachability`, so tsc refuses it. This covers the two
     * shapes that type-check and are still wrong.
     */
    const overrideLoop = reachCode.slice(
      reachCode.indexOf('for (const m of moved.rows)')
    );
    const overrideBody = overrideLoop.slice(0, overrideLoop.indexOf('\n    }'));
    ok(
      'the reassigned override writes followers: null explicitly',
      overrideBody.length > 0 && /followers:\s*null/.test(overrideBody)
    );
    ok(
      'the reassigned override builds its record without a spread',
      overrideBody.length > 0 && !/\.\.\./.test(overrideBody)
    );
    ok(
      'the reassigned override never reads a follower count out of the row',
      overrideBody.length > 0 && !/m\.followers/.test(overrideBody)
    );

    /**
     * And the stamp never turns "no count" into a zero.
     *
     * `x_followers` is absent-means-unknown, like every other field on that
     * row. A bare assignment would put `null` on the result, and a column of
     * figures rendering null as 0 states an audience of nobody for a handle we
     * simply have not measured. The guard is the assignment being conditional.
     */
    ok(
      'the reachability stamp only assigns a follower count it actually has',
      (reachCode.match(/if \(hit\.followers != null\) r\.x_followers =/g) ?? [])
        .length === 2
    );

    /**
     * Never a correlated EXISTS against the graph.
     *
     * The obvious shape for this feature is `OR EXISTS (...)` bolted onto the
     * route's `WHERE`. Measured on production it defeats the index on
     * `twitter_handle`, sequentially scans all 5,117,875 graph rows and runs
     * the subplan once per row: 19.7 seconds to return two wallets, against
     * 42ms for the list-then-match shape. Both reverse routes must resolve the
     * wallets first and match them by primary key.
     */
    for (const file of [
      'app/api/reverse/route.ts',
      'app/api/v1/reverse/twitter/[handle]/route.ts',
    ]) {
      const src = withoutComments(readFileSync(file, 'utf8'));
      ok(
        `${file} matches secondary wallets by key, not by a correlated subquery`,
        /inArray\(socialGraph\.wallet, secondary\)/.test(src) &&
          !/EXISTS\s*\(/i.test(src)
      );
    }
  }

  // ------------------------------------- Conflicts nobody can ever act on
  {
    const resolution = readFileSync('lib/conflict-resolution.ts', 'utf8');
    const code = withoutComments(resolution);
    /**
     * A conflict with two dead handles is inert: it cannot be accepted, since
     * acceptance needs theirs live, and it cannot surface as a second account,
     * since that needs both live. Closing it is not deciding it, and the
     * freshness window is what separates the two: two dead readings from six
     * weeks ago are not evidence that both are dead now, because a suspension
     * gets lifted and a freed name gets taken.
     */
    ok(
      'the both-dead close requires a fresh reading on BOTH sides',
      /o\.checked_at > now\(\) - make_interval\(days => \$\{recheckDays\}\)/.test(
        code
      ) &&
        /t\.checked_at > now\(\) - make_interval\(days => \$\{recheckDays\}\)/.test(
          code
        )
    );
    ok(
      // The two dead-status tests ADJACENT, not merely present: the
      // challenger-dead close (2026-09-20) also carries a t-side dead test,
      // so existence alone stopped proving anything about this statement.
      'it closes only rows where neither side is live',
      /o\.status IN \('not_found', 'unavailable'\)\n\s+AND t\.status IN \('not_found', 'unavailable'\)/.test(
        code
      )
    );
    ok(
      'a closed-as-inert row is labelled differently from an accepted one',
      /RESOLUTION_BOTH_DEAD = 'closed: neither handle reachable'/.test(code) &&
        /RESOLUTION = 'accepted-theirs: ours unreachable'/.test(code)
    );
    ok(
      'a dry run closes nothing',
      code.indexOf('if (dryRun) return outcome;') <
        code.indexOf('closeBothDead(recheckDays)')
    );
    /**
     * Closing is only safe because it is reversible, and the reversal has to
     * be here.
     *
     * The comment on `closeBothDead` first claimed `recordConflicts` would
     * reopen a row if a side came back to life. It does not: it clears
     * `resolved_at` only when the `ours` or `theirs` strings change, and
     * liveness lives in `x_accounts`, which never touches this table. A lifted
     * suspension would have left the row closed for good (Bugbot, 2026-08-27).
     */
    ok(
      'an inert closure is reopened when either side is live again',
      /SET resolved_at = NULL,[\s\S]{0,200}?c\.resolution = \$\{RESOLUTION_BOTH_DEAD\}[\s\S]{0,200}?\(o\.status = 'live' OR t\.status = 'live'\)/.test(
        code
      )
    );
    ok(
      'the reopen runs before the close, so a revived row re-enters this run',
      code.indexOf('SET resolved_at = NULL') <
        code.indexOf('SET resolved_at = now()')
    );

    /**
     * The 2026-09-20 rungs. A close or a swap that acts on a live ours is
     * only safe under conditions the statements must carry themselves, so
     * each condition is asserted against the statement text, adjacency and
     * all, for the reason the both-dead pair above is: these SQL fragments
     * share vocabulary, and an existence test over the whole file proves
     * nothing once a string appears twice.
     */
    ok(
      'the challenger-dead close demands a live ours and a fresh-dead theirs',
      /o\.status = 'live'\n\s+AND t\.status IN \('not_found', 'unavailable'\)\n\s+AND t\.checked_at > now\(\) - make_interval\(days => \$\{recheckDays\}\)/.test(
        code
      )
    );
    ok(
      'a challenger-dead closure is labelled as ours standing, never as accepted',
      code.includes("'closed: challenger unreachable, ours stands'")
    );
    ok(
      'a challenger-dead closure reopens when the challenger is live again',
      /SET resolved_at = NULL,[\s\S]{0,300}?c\.resolution = \$\{RESOLUTION_CHALLENGER_DEAD\}[\s\S]{0,120}?t\.status = 'live'/.test(
        code
      )
    );
    ok(
      'the reassigned swap demands an id-confirmed challenger',
      /ox\.user_id <> g\.twitter_user_id\n\s+AND c\.their_user_id IS NOT NULL AND c\.their_user_id = tx\.user_id/.test(
        code
      )
    );
    /**
     * The refusal, asserted as a refusal: a live ours that cannot be shown
     * wrong is never swapped, so no acceptance rule may reference a live
     * ours without also demanding the id mismatch that shows it wrong. An
     * id-anchored rung that swapped on the challenger's evidence alone was
     * drafted and removed in review (Bugbot, 2026-09-20): a stolen wallet
     * key plus the attacker's own X account could drive it.
     */
    {
      /**
       * Asserted over the rule text itself, not over the file: extract the
       * oursRule ternary and require every acceptance branch to condition on
       * ours' own state. Re-adding the removed id-anchored rung means adding
       * a branch with no `ox.` reference, which fails the every() below; the
       * first version of this assertion opened with a clause that was always
       * true and would have passed that exact re-addition (Bugbot,
       * 2026-09-20).
       */
      const ruleStart = code.indexOf('const oursRule =');
      const ruleEnd = code.indexOf('`;', ruleStart);
      const rule = code.slice(ruleStart, ruleEnd);
      const branches = rule.split('sql`').slice(1);
      ok(
        'every acceptance branch conditions on ours, and only two exist',
        ruleStart !== -1 &&
          branches.length === 2 &&
          branches.every((b) => /ox\.status/.test(b)) &&
          /ox\.user_id <> g\.twitter_user_id/.test(branches[1] ?? '')
      );
    }
  }

  // ------------------------------- The reverse answer corroborates itself
  {
    /**
     * A wallet matched on its second handle answers with a different name in
     * `twitter.handle`. If nothing in the response then mentions the handle
     * that was searched, the caller is handed a row that looks unrelated to
     * their query, and the docs shipped with the feature say the searched name
     * appears under `twitter.also` (Bugbot, 2026-08-27).
     */
    const v1 = withoutComments(
      readFileSync('app/api/v1/reverse/twitter/[handle]/route.ts', 'utf8')
    );
    ok(
      'the public reverse route fills twitter.also',
      /alsoOnXForWallets\(/.test(v1) && /also: also\.get\(/.test(v1)
    );

    const app = withoutComments(
      readFileSync('app/api/reverse/route.ts', 'utf8')
    );
    ok(
      'the app reverse route stamps the second account',
      /await stampAlsoOnX\(results\)/.test(app)
    );
    ok(
      'it stamps before the results are persisted to history',
      app.indexOf('stampAlsoOnX(results)') < app.indexOf('saveLookup(results')
    );

    /**
     * And reverse must pick the same winner the row displays.
     *
     * `alsoOnXForWallets` keeps one conflict per wallet, ordered by account id
     * then recency. Filtering on the handle *inside* that selection returns a
     * wallet for the loser of a tie: searched B, row shows A.
     */
    const reach = withoutComments(
      readFileSync('lib/handle-reachability.ts', 'utf8')
    );
    const from = reach.slice(
      reach.indexOf('function secondaryHandleFrom'),
      reach.indexOf('function normalizeHandle')
    );
    ok(
      'the secondary gate picks one conflict per wallet, as the display does',
      /DISTINCT ON \(c\.wallet\)/.test(from) &&
        /ORDER BY c\.wallet, \(c\.their_user_id IS NOT NULL\) DESC, c\.last_seen_at DESC/.test(
          from
        )
    );
    ok(
      'the handle filter is applied after that selection, not inside it',
      from.indexOf('ORDER BY c.wallet') < from.indexOf('WHERE w.theirs =')
    );
  }

  // ------------------------------------------- Attribution: what we keep of it
  // Recording where somebody came from means holding a string another site
  // chose. The referrer is the dangerous one: other sites put search queries,
  // private document paths and their own session tokens in the URLs they link
  // from, and a full referrer would land all of it in our database under a
  // column nobody thinks of as sensitive.
  {
    const SELF = 'walletlink.social';

    // The attacker is another site's URL, trying to get its query string into
    // our database by being linked from.
    const leaky = [
      'https://mail.google.com/mail/u/0/#inbox/FMfcgz?token=SECRETVALUE',
      'https://example.com/reset-password?reset_token=abc123def456',
      'https://search.example/?q=how+to+find+a+wallet+owner',
      'https://user:hunter2@intranet.example.com/hr/salaries.pdf',
    ];
    for (const url of leaky) {
      const host = referrerHost(url, SELF);
      ok(
        `a referrer carrying a secret keeps only its host (${host})`,
        host !== null &&
          !host.includes('?') &&
          !host.includes('/') &&
          !host.includes('#') &&
          !host.includes('@') &&
          !/secret|token|salaries|how\+to/i.test(host)
      );
    }

    // Prove the gate can pass, or a function returning null always would
    // satisfy every assertion above.
    ok(
      'a plain referrer yields its host',
      referrerHost('https://warpcast.com/dwr/0x123', SELF) === 'warpcast.com'
    );
    ok(
      'www is stripped so one site is one row',
      referrerHost('https://www.warpcast.com/x', SELF) === 'warpcast.com'
    );

    // Our own pages are not an acquisition channel. Counting them would make
    // the site its own biggest referrer within a day.
    ok(
      'a self-referral is not a source',
      referrerHost(`https://${SELF}/pricing`, SELF) === null
    );
    ok(
      'a self-referral is not a source with www either',
      referrerHost(`https://www.${SELF}/pricing`, SELF) === null
    );
    for (const junk of ['', '   ', 'not a url', 'javascript:alert(1)']) {
      ok(
        `an unusable referrer (${JSON.stringify(junk)}) yields nothing`,
        referrerHost(junk, SELF) === null
      );
    }

    // Campaign tags arrive from the open internet and end up in a column, an
    // admin table and a CSV.
    ok(
      'a tag carrying markup is reduced to its safe characters',
      safeTag('<script>alert(1)</script>') === 'scriptalert1script'
    );
    ok(
      'a tag carrying a quote cannot break out',
      !(safeTag(`x' OR 1=1 --`) ?? '').includes("'")
    );
    ok(
      'a tag is length bounded',
      (safeTag('a'.repeat(500)) ?? '').length <= 64
    );
    ok(
      'an empty tag is absent rather than blank',
      safeTag('   ') === undefined
    );

    /**
     * The whole summary is bounded, because it becomes one column value.
     *
     * The host here is long but *valid*. The first version used 300 characters,
     * which fails the hostname check and drops out, so the referrer never
     * reached the summary and the total sat under the bound on its own: the
     * assertion passed with the final clamp deleted. Caught by the guard, which
     * is the entire reason it exists.
     */
    const longHost = `${'a'.repeat(60)}.example.com`;
    const monstrous = firstTouchFrom(
      `?utm_source=${'s'.repeat(400)}&utm_medium=${'m'.repeat(400)}&utm_campaign=${'c'.repeat(400)}`,
      `https://${longHost}/x`,
      SELF
    );
    ok(
      'the unclamped summary really would exceed the bound',
      `utm:${'s'.repeat(64)}/${'m'.repeat(64)}/${'c'.repeat(64)}/via:${longHost}`
        .length > ACQUISITION_MAX_LENGTH
    );
    ok(
      'an absurd query cannot produce an unbounded origin',
      summariseOrigin(monstrous).length <= ACQUISITION_MAX_LENGTH
    );

    // A visit that says nothing must say so, rather than producing an empty
    // string that reads as a missing value.
    ok(
      'a bare visit is recorded as direct',
      summariseOrigin(firstTouchFrom('', '', SELF)) === DIRECT
    );
    ok(
      'a referred visit is not recorded as direct',
      summariseOrigin(firstTouchFrom('', 'https://warpcast.com/x', SELF)) !==
        DIRECT
    );

    // What the server accepts from a client is not what the client should have
    // sent. This value arrives in a request body.
    ok(
      'a posted acquisition is sanitised, not trusted',
      !(safeAcquisition("ref:x'; DROP TABLE users; --") ?? '').includes("'")
    );
    ok(
      'a posted acquisition is length bounded',
      (safeAcquisition('x'.repeat(5000)) ?? '').length <= ACQUISITION_MAX_LENGTH
    );
    ok(
      'a non-string acquisition is refused',
      safeAcquisition({ evil: true }) === null
    );
    ok(
      'an empty acquisition is null rather than blank',
      safeAcquisition('   ') === null
    );
    ok(
      'a normal acquisition survives the sanitiser',
      safeAcquisition('ref:relaunch-2026-08/via:warpcast.com') ===
        'ref:relaunch-2026-08/via:warpcast.com'
    );

    /**
     * First touch, not last.
     *
     * Every later sign-in arrives with whatever the browser holds now, so an
     * update on an existing user would rewrite the acquisition source at every
     * login and the column would converge on whatever people last clicked.
     */
    const access = readFileSync('lib/access.ts', 'utf8');
    const fn = access.slice(
      access.indexOf('export async function getOrCreateUser')
    );
    const body = withoutComments(fn.slice(0, fn.indexOf('\n}')));
    ok(
      'getOrCreateUser returns an existing row untouched',
      /if \(existing\) return existing;/.test(body) &&
        !/update\(users\)/.test(body)
    );
    ok(
      'getOrCreateUser writes acquisition only on insert',
      /\.insert\(users\)[\s\S]{0,400}acquisition:/.test(body)
    );

    /**
     * Attribution must never reach `users.origin` (Bugbot, 2026-08-25, High).
     *
     * That column is a control flag, not a label: `getBalance` withholds the
     * free allowance when it reads `'x402'` there. The first version of this
     * feature stored first-touch attribution in it, because a query showing
     * 139 nulls in 139 rows made it look like an unused field. Unused and
     * unpopulated are different facts, and the schema comment said which one
     * it was.
     *
     * Since the value arrives in a request body, sharing the column meant a
     * posted `origin: "x402"` could mint a magic-link account that silently
     * never receives its 100 free matches.
     */
    ok(
      'the signup path never writes users.origin',
      !/\borigin:/.test(body) &&
        !/update\(users\)[\s\S]{0,200}\borigin:/.test(withoutComments(access))
    );
    const credits = readFileSync('lib/credits.ts', 'utf8');
    ok(
      'the free allowance still keys on users.origin, so the two are not one column',
      /origin === 'x402'/.test(credits)
    );
    const schema = readFileSync('db/schema.ts', 'utf8');
    ok(
      'users carries both columns, separately',
      /origin: text\('origin'\)/.test(schema) &&
        /acquisition: text\('acquisition'\)/.test(schema)
    );

    /**
     * Collecting a new category of data means saying so.
     *
     * The policy is live and enumerates what is held. A referring domain and a
     * campaign tag are not covered by "page views and product events", and
     * quietly widening collection under copy written before it is the failure
     * this asserts against.
     */
    const policy = readFileSync('app/privacy/page.tsx', 'utf8');
    ok(
      'the privacy policy discloses where-you-came-from collection',
      /Where you arrived from/.test(policy)
    );
    ok(
      'the policy states that the full referring address is not kept',
      /Never the full web address/.test(policy)
    );

    // The origin has to travel with the token, because the browser that asks
    // for a sign-in link is routinely not the one that opens it.
    const auth = readFileSync('lib/auth.ts', 'utf8');
    /**
     * Scoped to the values object, not a character window.
     *
     * The first version allowed 200 characters after `insert(magicLinkTokens)`
     * and failed on correct code, because a comment inside the object pushed
     * the field past the bound. A window that a comment can break is a window
     * that will pass the day somebody moves the field further away, too.
     */
    const insertAt = auth.indexOf('insert(magicLinkTokens)');
    const valuesObject =
      insertAt >= 0 ? auth.slice(insertAt, auth.indexOf('});', insertAt)) : '';
    ok(
      'the magic link token records the acquisition',
      valuesObject.includes('acquisition:')
    );
    ok(
      'the magic link token does not carry a rail marker field',
      !valuesObject.includes('origin:')
    );
    ok(
      'verifying a token hands the acquisition back',
      /acquisition: tokenRecord\.acquisition/.test(auth)
    );
  }

  // ------------------------------------------ Chain marks: one per chain
  // The picker renders a mark per network. TypeScript already requires
  // CHAIN_MARKS to be a full Record<SupportedChain, ...>, so a chain added
  // without one fails to compile. This is the runtime half of the same claim,
  // because a mark that is present but undefined renders an empty tile nobody
  // notices until somebody screenshots the modal.
  {
    const marks = readFileSync('components/ui/chain-marks.tsx', 'utf8');
    for (const chain of SUPPORTED_CHAINS) {
      ok(
        `${chain} has a mark in CHAIN_MARKS`,
        new RegExp(`\\b${chain}:\\s*\\w+Mark,`).test(marks)
      );
    }

    /**
     * Base is the one mark deliberately left alone.
     *
     * Its primary logo is a solid blue square (brand.base.org), so it already
     * carries its own corners. The icon set ships it knocked out of a blue
     * plate in white, which inverts the one mark that already had the right
     * silhouette, and rounding a plate it does not need would be rounding the
     * logo itself.
     */
    const baseFn = marks.slice(marks.indexOf('export function BaseMark'));
    ok(
      'the Base mark sits on no plate and is not rounded',
      !baseFn.slice(0, baseFn.indexOf('\n}')).includes('rx=')
    );

    // Every other mark's plate and its clip are rounded together. Rounding the
    // plate alone leaves the mark painting back into the corners just cut.
    //
    // Derived rather than hardcoded. This read `plates === 12` until HyperEVM
    // arrived as the eighth chain and made it 14, and a literal that has to be
    // re-typed on every chain addition is a literal that will one day be
    // re-typed to whatever the file happens to contain. Two per mark (the plate
    // and its clip) for every chain but Base, which is plateless by the
    // assertion directly above.
    const plates = (marks.match(/rx="6"/g) ?? []).length;
    const plated = SUPPORTED_CHAINS.length - 1;
    ok(
      `${plated} plates and ${plated} clips are rounded, ${plated * 2} in all`,
      plates === plated * 2
    );
  }

  // ------------------------- HyperEVM: the chain with exactly one of each
  // Three sources refuse the chain (checked 2026-08-31): the NFT API, the
  // first metered ERC-20 index and Blockscout, which has no instance for it.
  // Its NFT owners are read off the contract one token id at a time, and since
  // 2026-09-19 its ERC-20 holders come from the second metered index, which is
  // the only one that serves the chain. Both paths have failure modes the
  // redundant chains do not, and these are the ones that would ship a wrong
  // answer rather than an error.
  {
    /**
     * Bounded slices, not whole-file searches.
     *
     * Every regex below is anchored to one construct. An unbounded probe over
     * a file this commented finds its own prose: the mutation guard has already
     * caught an assertion here that matched a doc comment describing the thing
     * it meant to check, and passed while the code was broken.
     */
    const sliceBetween = (source: string, from: string, to: string) => {
      const start = source.indexOf(from);
      if (start === -1) return '';
      const end = source.indexOf(to, start + from.length);
      return end === -1 ? '' : source.slice(start, end + to.length);
    };

    const chains = withoutComments(readFileSync('lib/chains.ts', 'utf8'));
    const onchain = withoutComments(
      readFileSync('lib/onchain-holders.ts', 'utf8')
    );
    const holders = withoutComments(
      readFileSync('lib/contract-holders.ts', 'utf8')
    );

    /**
     * The list that decides whether the UI offers a token import.
     *
     * A chain listed with nothing behind it puts an ERC-20 tile in front of a
     * customer whose import throws CHAIN_NO_ERC20_SUPPORT every time. The
     * file's own rule is to keep this list in step with MORALIS_CHAIN_IDS,
     * OPENSEA_CHAIN_SLUGS and BLOCKSCOUT_BASE_URLS, and this is that rule made
     * checkable. hyperevm was kept OUT of the list until 2026-09-19 for
     * exactly this reason; the second index is what put it in.
     */
    const erc20List = sliceBetween(
      chains,
      'export const ERC20_SUPPORTED_CHAINS',
      '];'
    );
    const moralisBlock = sliceBetween(holders, 'const MORALIS_CHAIN_IDS', '};');
    const secondIndexBlock = sliceBetween(
      holders,
      'const OPENSEA_CHAIN_SLUGS',
      '};'
    );
    const blockscoutBlock = sliceBetween(
      holders,
      'const BLOCKSCOUT_BASE_URLS',
      '};'
    );
    ok(
      'hyperevm token import is listed and backed by the second index',
      erc20List.includes('hyperevm') && secondIndexBlock.includes('hyperevm:')
    );
    ok(
      'no chain is listed for ERC-20 without an index or an explorer behind it',
      ERC20_SUPPORTED_CHAINS.every(
        (c) =>
          moralisBlock.includes(`${c}:`) ||
          secondIndexBlock.includes(`${c}:`) ||
          blockscoutBlock.includes(`${c}:`)
      )
    );
    /**
     * The second index must not claim BNB Chain. Its provider does not serve
     * the chain (verified against the live /chains listing, 2026-09-19), and a
     * wrong entry would not fail loudly: the holders endpoint answers an
     * unknown chain with an ordinary error, which the ladder reads as "second
     * index failed" on every BNB import, silently spending a doomed request
     * each time.
     */
    ok(
      'bsc is kept out of the second index chain map',
      secondIndexBlock.length > 0 && !secondIndexBlock.includes('bsc:')
    );
    /**
     * The seeding policy survives the second index, in both directions.
     *
     * The second index is our own key, so the seed cron MAY use it: its
     * attempt must sit before the allowPublicFallback gate in the metered
     * catch, or seeding stays dead on every chain the first index fails on,
     * which is the 2026-08-31 outage this ladder exists to end. The public
     * explorer stays behind that gate, or background work is back to spending
     * somebody else's infrastructure.
     */
    {
      const ladder = sliceBetween(
        holders,
        'return await fetchHoldersMetered',
        'getERC20HoldersBlockscout(address, chain, limit, deadlineMs);'
      );
      const secondTry = ladder.indexOf('fetchHoldersOpenSea');
      const publicGate = ladder.indexOf(
        'options.allowPublicFallback === false'
      );
      ok(
        'the second index is tried before the public-fallback gate, and the explorer after it',
        secondTry !== -1 && publicGate !== -1 && secondTry < publicGate
      );
    }
    /**
     * Display-unit balances never take the raw-integer path. The second index
     * sends quantities already divided by decimals; BigInt('64481699964.672')
     * throws, which would silently empty the Bag column for every import the
     * second index serves, and dividing again would misstate it by orders of
     * magnitude if the value ever parsed.
     */
    {
      const bags = sliceBetween(
        holders,
        'function toBagSizes',
        'return Object.keys(out).length'
      );
      const displayBranch = bags.indexOf('isNft || displayUnits');
      const rawBranch = bags.indexOf('BigInt(');
      ok(
        'display-unit balances are numbered directly, never BigInt-divided',
        displayBranch !== -1 && rawBranch !== -1 && displayBranch < rawBranch
      );
    }
    /**
     * A rescue that never got to ask is not an empty answer. With the shared
     * deadline already spent, the second index's paging loop exits before its
     * first request, and returning that empty set as a success would skip the
     * public explorer behind it and surface to the customer as NO_HOLDERS: a
     * timeout dressed up as "this contract has no token holders". Caught by
     * review. The fetcher must throw when zero pages were fetched, and only
     * then.
     */
    {
      // The comma form is the return object; the semicolon form two hundred
      // lines earlier is the same field in the return TYPE, and ending the
      // slice there would leave the loop outside it.
      const fetcher = sliceBetween(
        holders,
        'async function fetchHoldersOpenSea',
        'balancesAreDisplayUnits: true,'
      );
      const zeroPagesThrow =
        /if \(pagesFetched === 0\) \{[\s\S]{0,200}?throw new Error/.exec(
          fetcher
        );
      ok(
        'a deadline-starved second-index attempt throws instead of answering "no holders"',
        zeroPagesThrow !== null &&
          zeroPagesThrow.index < fetcher.indexOf('return {')
      );
    }

    /**
     * Every supported chain can serve an NFT holder list some way.
     *
     * The picker is built from SUPPORTED_CHAINS, so a chain that reaches it
     * with neither an NFT-API entry nor an onchain source is a tile that fails
     * on both contract kinds while the site advertises the chain as included.
     */
    const alchemyBlock = sliceBetween(holders, 'const ALCHEMY_ENDPOINTS', '};');
    const onchainBlock = sliceBetween(onchain, 'const ONCHAIN_RPCS', '};');
    for (const chain of SUPPORTED_CHAINS) {
      ok(
        `${chain} has an NFT holder source`,
        alchemyBlock.includes(`${chain}:`) || onchainBlock.includes(`${chain}:`)
      );
    }

    /**
     * The walk starts at 0 and is bounded by supply, rather than stopping at
     * the first revert.
     *
     * On the collection this shipped for, `ownerOf(0)` reverts and
     * `ownerOf(6666)` resolves. A loop that read the first revert as the end of
     * supply would return zero holders there and report success.
     */
    const scanRange = sliceBetween(
      onchain,
      'const ids: number[] = [];',
      'const owners = new Map<number, string>();'
    );
    ok(
      'the id walk covers 0 through totalSupply inclusive',
      /for \(let id = 0; id <= supply; id\+\+\)/.test(scanRange)
    );

    /**
     * The completeness proof, which is the whole reason the module may be
     * trusted. getContractHolders derives `truncated` from totalHolders against
     * wallets.length, so a scan that stopped early would report truncated:false
     * and tell the buyer it held every holder.
     */
    const proof = sliceBetween(
      onchain,
      'if (owners.size !== supply)',
      'const bags'
    );
    ok(
      'a scan that resolved fewer owners than supply throws',
      proof.includes('HOLDER_SCAN_INCOMPLETE')
    );

    /**
     * Batch replies are matched by JSON-RPC id.
     *
     * A reordered batch read positionally yields a holder list with the right
     * cardinality and the wrong owners, and nothing downstream can detect it.
     */
    const batchRead = sliceBetween(
      onchain,
      'const byId = new Map<number, RpcReply>();',
      'return owners;'
    );
    ok(
      'batch replies are looked up by id, never by array position',
      batchRead.includes('byId.get(id)') && !/body\[\s*i\s*\]/.test(batchRead)
    );

    /** ERC-1155 has no ownerOf, so it is refused rather than half-scanned. */
    const dispatch = sliceBetween(
      holders,
      'if (hasOnchainHolderSource(chain))',
      'holdersResult = await getOnchainNftHolders'
    );
    ok(
      'ERC-1155 on an onchain-only chain is refused, not attempted',
      dispatch.includes('ERC1155_NO_ONCHAIN_ENUM')
    );

    /**
     * Every code this path throws reaches the customer as itself.
     *
     * The route matches on an exact string, so a code missing from its map
     * falls through to the generic 500 that says to try again. That is wrong
     * advice for three of these four: an ERC-1155 contract and an oversized
     * collection will still be an ERC-1155 contract and an oversized collection
     * on the next attempt. Two of the codes are also thrown carrying a
     * diagnostic suffix, which is why the route matches the leading code as
     * well as the whole string, and why that fallback is asserted here rather
     * than trusted.
     */
    const route = withoutComments(
      readFileSync('app/api/contract-holders/route.ts', 'utf8')
    );
    const errorMap = sliceBetween(
      route,
      'const errorMap: Record<string, { message: string; status: number }> = {',
      '\n    };'
    );
    const thrownCodes = new Set(
      [...onchain.matchAll(/new Error\(\s*[`'"]([A-Z][A-Z0-9_]{3,})/g)].map(
        (m) => m[1]
      )
    );
    thrownCodes.add('ERC1155_NO_ONCHAIN_ENUM');
    ok(
      'the onchain path throws codes worth mapping',
      thrownCodes.size >= 4 && thrownCodes.has('HOLDER_SCAN_INCOMPLETE')
    );
    for (const code of [...thrownCodes].sort()) {
      ok(`${code} has customer-facing copy`, errorMap.includes(`${code}: {`));
    }
    ok(
      'a suffixed code still matches its map entry',
      /errorMessage\.split\(':', 1\)\[0\]/.test(route) &&
        /\^\[A-Z\]\[A-Z0-9_\]\*\$/.test(route)
    );
    ok(
      'a permanent refusal is not sent to a retry loop',
      /COLLECTION_TOO_LARGE: \{[\s\S]{0,400}?status: 400/.test(errorMap) &&
        /ERC1155_NO_ONCHAIN_ENUM: \{[\s\S]{0,400}?status: 400/.test(errorMap)
    );

    /** A supply too large to scan is refused before any call is spent. */
    ok(
      'an oversized collection is refused before enumeration starts',
      /if \(supply > MAX_ONCHAIN_SUPPLY\) \{[\s\S]{0,400}?COLLECTION_TOO_LARGE/.test(
        onchain
      )
    );

    /**
     * The seed cron's token slot is gated on ERC20_SUPPORTED_CHAINS, not on
     * usesMeteredHolderIndex.
     *
     * That helper answers false both for "billed elsewhere" (Robinhood, which
     * has an explorer) and for "nowhere to ask" (hyperevm). Gating on it would
     * skip the budget check and walk into a certain failure, which
     * seedFirstViable then records as a holders_imported = 0 row that locks the
     * address out for FAILURE_RETRY_DAYS.
     */
    const seed = withoutComments(
      readFileSync('lib/seed-collections.ts', 'utf8')
    );
    ok(
      'the seed token slot is gated on the ERC-20 chain list',
      seed.includes('if (!ERC20_SUPPORTED_CHAINS.includes(chain)) {')
    );

    /**
     * And then refused on every metered chain the second index cannot rescue.
     *
     * The first index has answered 401 since 2026-08-31 and is not being paid
     * for. The 2026-09-18 gate retired metered-chain seeding outright; the
     * 2026-09-19 form narrows it to the chains where the rescue cannot happen
     * (BNB Chain, or a deploy with no second-index key), because everywhere
     * else `getContractHolders` now catches the 401 and serves the holders
     * from our own second index. The refusal stays at DISCOVERY, not inside
     * seedContract: a candidate never selected spends no slot, writes no
     * attempt marker, and cannot leave a zero-holder row that locks a healthy
     * token out for FAILURE_RETRY_DAYS.
     *
     * The gate reads two predicates on purpose, neither of which is the chain
     * list above it, and none of the three are in tension: the list answers
     * "does an ERC-20 index exist here", `usesMeteredHolderIndex` answers "is
     * the first index the dead one", and `secondIndexIsOnlyHolderSource`
     * answers "is the missing key the whole story". The second predicate is
     * review's addition: HyperEVM is not metered, so the metered predicate
     * alone let a keyless deploy seed it straight into
     * OPENSEA_NOT_CONFIGURED, the exact poison row this gate exists to
     * prevent, on the one chain whose only ERC-20 source is that key.
     *
     * **The rescue half must name every rung of the ladder.** It named one
     * rung from 2026-09-19 to 2026-09-21 while `getContractHolders` grew a
     * second, so BNB Chain stayed refused at discovery for a day after its
     * import path came back, and the nine named BNB tokens could not retry
     * the row they had failed on. Asserted below rather than commented,
     * because that is the shape this file exists to catch.
     */
    const seedGate =
      /if \(\s*\(usesMeteredHolderIndex\(chain\) \|\|\s*secondIndexIsOnlyHolderSource\(chain\)\)\s*&&\s*!hasSecondHolderIndex\(chain\)\s*&&\s*!hasThirdHolderIndex\(chain\)\s*\) \{[\s\S]{0,400}?continue;/.exec(
        seed
      );
    ok(
      'ERC-20 discovery on a chain no holder index can serve is refused, before a slot is spent',
      seedGate !== null &&
        seedGate.index >
          seed.indexOf('if (!ERC20_SUPPORTED_CHAINS.includes(chain)) {')
    );
    {
      const { secondIndexIsOnlyHolderSource, hasThirdHolderIndex } =
        await import('@/lib/contract-holders');
      ok(
        'hyperevm is the chain the keyless refusal exists for, and robinhood is untouched by it',
        secondIndexIsOnlyHolderSource('hyperevm') &&
          !secondIndexIsOnlyHolderSource('robinhood') &&
          !secondIndexIsOnlyHolderSource('bsc')
      );

      /**
       * Go through the predicate, never around it, and assert the refusal.
       *
       * The key is read at call time, so the two answers are taken by moving
       * the real environment variable rather than by recomputing what the
       * function does. BNB Chain is the whole point of the third rung: with a
       * key it must stop being refused, and without one it must still be
       * refused, because a keyless deploy has nowhere left to ask and would
       * write the zero-holder row this gate exists to prevent.
       */
      const chainbaseKey = process.env.CHAINBASE_API_KEY;
      try {
        process.env.CHAINBASE_API_KEY = 'test-key-not-a-real-credential';
        ok(
          'the third index rescues BNB Chain, which the second cannot serve',
          hasThirdHolderIndex('bsc') && !hasThirdHolderIndex('hyperevm')
        );
        delete process.env.CHAINBASE_API_KEY;
        ok(
          'a deploy with no third-index key still refuses BNB Chain at discovery',
          !hasThirdHolderIndex('bsc')
        );
      } finally {
        if (chainbaseKey === undefined) delete process.env.CHAINBASE_API_KEY;
        else process.env.CHAINBASE_API_KEY = chainbaseKey;
      }
    }

    // ------------------------------------------- the holder walk (2026-09-20)
    // A re-seed used to re-import the same top slice by balance forever; the
    // walk bookmark is what lets repeated slices reach a large token's tail.
    // Everything here asserts the ways a bookmark can silently lie: handed to
    // the wrong index, deleted with its progress, outranking new contracts,
    // or surviving a walk that actually finished.
    {
      /**
       * A cursor names a position in the ordering of the index that minted
       * it. The only unwrap site is the source-guarded const, and every
       * fetcher call passes that const; a second unwrap of `resume.cursor`
       * anywhere in the ladder would be a path around the guard.
       */
      ok(
        // One unwrap PER SOURCE since the third index arrived (2026-09-20),
        // each behind its own guard, and each fetcher fed only the cursor
        // its source minted: page numbers and opaque cursors must not cross.
        'every resume cursor is unwrapped behind its own source guard',
        holders.includes(
          "options.resume?.source === 'opensea' ? options.resume.cursor"
        ) &&
          holders.includes(
            "options.resume?.source === 'chainbase' ? options.resume.cursor"
          ) &&
          (holders.match(/options\.resume\.cursor/g) ?? []).length === 2 &&
          (
            holders.match(
              /fetchHoldersOpenSea\(\s*address,\s*chain,\s*limit,\s*deadlineMs,\s*resumeCursor\s*\)/g
            ) ?? []
          ).length === 3 &&
          (
            holders.match(
              /fetchHoldersChainbase\(\s*address,\s*chain,\s*limit,\s*deadlineMs,\s*chainbaseCursor\s*\)/g
            ) ?? []
          ).length === 1
      );

      /**
       * An empty page must end the walk, not bookmark it: banking zero rows
       * while returning a continuation makes the contract
       * continuation-eligible forever, a slot spent daily on nothing.
       */
      const walkLoop = sliceBetween(
        holders,
        'let nextCursor: string | null = null;',
        'if (!nextCursor) break;'
      );
      ok(
        'an empty page ends the walk instead of bookmarking it',
        /if \(rows\.length === 0\) \{\s*nextCursor = null;\s*break;/.test(
          walkLoop
        )
      );

      /** Breadth before depth: a continuation never outranks a new contract. */
      ok(
        'never-seeded candidates outrank continuations in selection',
        seed.includes('[...novel, ...continuations')
      );

      /**
       * The squeeze path must not destroy progress. unmarkSeedAttempt exists
       * to restore eligibility after a budget squeeze, and for a cursorless
       * row deletion does that; for a walk row the same DELETE would erase
       * every slice already walked, so it is fenced to NULL bookmarks and the
       * walk row is backdated instead.
       */
      ok(
        'a squeezed attempt never deletes a walk bookmark',
        /DELETE FROM seeded_contracts[\s\S]{0,200}?holders_imported = 0[\s\S]{0,80}?resume_state IS NULL/.test(
          seed
        ) &&
          /UPDATE seeded_contracts[\s\S]{0,300}?resume_state IS NOT NULL/.test(
            seed
          )
      );

      /**
       * A finished walk clears its bookmark. recordSeed writes the state from
       * this run's continuation or NULL, and the upsert must carry it: an ON
       * CONFLICT branch that forgot resume_state would freeze every walk at
       * its first bookmark while reporting progress.
       */
      ok(
        'recordSeed writes the bookmark on both insert and update, clearing it when the walk is done',
        /holders\.continuation\s*\?\s*JSON\.stringify[\s\S]{0,300}?:\s*null/.test(
          seed
        ) && seed.includes('resume_state = EXCLUDED.resume_state')
      );

      /**
       * A walk that steps off the end of the list must complete, not fail.
       * The empty final slice used to throw NO_HOLDERS before anything could
       * clear the bookmark, so the row failed into the retry loop and
       * re-stepped off the same end every lockout, occupying a daily slot
       * forever. Two halves, both required: getContractHolders only raises
       * NO_HOLDERS for a fetch that did not consume a resume cursor, and
       * seedContract's completion branch clears the bookmark BEFORE
       * recordSeed can write the failure marker.
       *
       * Both sides key on CONSUMPTION (`resumeConsumed`), never on the
       * request (`options.resume`): a revived first index can serve the call
       * without seeing the bookmark, and its empty answer is a real
       * NO_HOLDERS, not a finished walk. Keying on the request cleared the
       * bookmark and abandoned the unwalked tail; also caught in review.
       */
      ok(
        'an empty resumed slice completes the walk instead of failing it, and only when the cursor was consumed',
        /wallets\.length === 0 && !holdersResult\.resumeConsumed/.test(
          holders
        ) &&
          !/wallets\.length === 0 && !options\.resume\b/.test(holders) &&
          (() => {
            const complete = seed.indexOf(
              'walkBefore && holders.resumeConsumed && holders.wallets.length === 0'
            );
            const record = seed.indexOf('await recordSeed(');
            return complete !== -1 && record !== -1 && complete < record;
          })()
      );

      /**
       * The continue gate must sit UNDER the daily cadence. The cron is daily
       * with jitter, so consecutive token slots are routinely less than 24
       * hours apart; a bar at or above 24 hours skips the walk on every such
       * day and coverage advances every other day, which was the reviewed
       * defect.
       */
      const gateHours = /const CONTINUE_AFTER_HOURS = (\d+);/.exec(seed);
      ok(
        'the walk-continue gate is under the daily cadence, in hours',
        gateHours !== null &&
          Number(gateHours[1]) >= 1 &&
          Number(gateHours[1]) < 24 &&
          seed.includes('make_interval(hours => ${CONTINUE_AFTER_HOURS})')
      );
    }

    /**
     * And no version of that gate may take Robinhood with it.
     *
     * Robinhood seeded straight through the 2026-09-18 retirement because its
     * explorer is its own index rather than a fallback, so
     * `usesMeteredHolderIndex` is false for it. A future chain added to
     * MORALIS_CHAIN_IDS by mistake would silently retire it, so this goes
     * through the predicate rather than restating the list.
     */
    {
      const { ERC20_SUPPORTED_CHAINS } = await import('@/lib/chains');
      const { usesMeteredHolderIndex } = await import('@/lib/contract-holders');
      const stillSeeds = ERC20_SUPPORTED_CHAINS.filter(
        (c) => !usesMeteredHolderIndex(c)
      );
      ok(
        'Robinhood keeps ERC-20 seeding after the retirement, and is not alone by accident',
        stillSeeds.includes('robinhood') &&
          ERC20_SUPPORTED_CHAINS.some((c) => usesMeteredHolderIndex(c))
      );
    }
    ok(
      'hyperevm has an explicit place in SEED_ORDER',
      sliceBetween(
        seed,
        'const SEED_ORDER: SupportedChain[] = [',
        '];'
      ).includes("'hyperevm'")
    );

    /**
     * The tail of SEED_ORDER must rotate, and the head must not.
     *
     * One shared deadline over a fixed order makes the last position a
     * standing disadvantage: the same chain absorbs every overrun. The failure
     * would also be silent, because a starved slot writes no row — an absence
     * indistinguishable from a refused chain or an exhausted one, which is
     * exactly the confusion that sent the 2026-09-21 BSC investigation down
     * the wrong path. Restoring a plain walk over the ranked list brings the
     * hazard back.
     *
     * Pinning the whole list would defeat the point, so the head is asserted
     * to be a genuine prefix rather than everything.
     */
    {
      const pinned = /const PINNED_SEED_HEAD = (\d+);/.exec(seed);
      const { SUPPORTED_CHAINS } = await import('@/lib/chains');
      ok(
        'the seed tail rotates daily, so no chain is permanently last',
        pinned !== null &&
          Number(pinned[1]) > 0 &&
          Number(pinned[1]) < SUPPORTED_CHAINS.length &&
          seed.includes('const offset = tail.length > 0 ? dayIndex %') &&
          seed.includes('...tail.slice(offset)') &&
          seed.includes('...tail.slice(0, offset)')
      );
      ok(
        'a starved seed slot is reported rather than silently dropped',
        seed.includes("label === 'time budget exhausted'") &&
          seed.includes('Seed run ran out of time before')
      );
    }
  }

  // ------------------- Budget counters: an untyped parameter disables them
  // `jsonb_build_object` declares its arguments as `"any"`, so Postgres cannot
  // infer a bare placeholder and fails the whole statement at plan time with
  // 42P18. The driver sends no type hints, so it fires on every call, for every
  // value, in every environment. In `lib/neynar-budget.ts` that silently turned
  // the credit ceiling off: the counter stopped moving on 2026-08-13, the catch
  // wrote one line to a cron log, and the stale row kept reading above the
  // ceiling so the guard looked alive right up until the period key rolled and
  // it began permitting everything.
  {
    const files = [
      'lib/neynar-budget.ts',
      'lib/holder-index-budget.ts',
      'lib/clanker.ts',
      'lib/ens-harvest.ts',
      // Both new corpora checkpoint through `ingest_state`, so both are
      // exposed to 42P18. Named here rather than trusted: the list is the
      // whole coverage of this assertion, and a file left off it is a file
      // the check silently says nothing about.
      'lib/basenames.ts',
      'lib/zora-profiles.ts',
    ];
    for (const file of files) {
      const src = withoutComments(readFileSync(file, 'utf8'));
      // Each jsonb_build_object call, up to the end of its argument list. The
      // bound keeps a later cast in an unrelated clause from covering for a
      // bare parameter inside this one.
      const calls = src.match(/jsonb_build_object\([^;]{0,400}?\)\)?/g) ?? [];
      for (const [i, call] of calls.entries()) {
        ok(
          `${file}: jsonb_build_object #${i + 1} casts every parameter`,
          !/\$\{[^}]+\}(?!::)/.test(call)
        );
      }
    }

    /**
     * The counter is read and written through the same period key.
     *
     * `getPeriodSpend` matches on `value->>'period' = currentPeriod()`, so a
     * write that stamps any other period is invisible to the read and the
     * ceiling silently becomes infinite. They must both come from
     * `currentPeriod()` and nothing else.
     */
    const budget = withoutComments(
      readFileSync('lib/neynar-budget.ts', 'utf8')
    );
    const readFn = budget.slice(
      budget.indexOf('export async function getPeriodSpend'),
      budget.indexOf('export async function recordSpend')
    );
    const writeFn = budget.slice(
      budget.indexOf('export async function recordSpend')
    );
    ok(
      'the spend counter is read against currentPeriod()',
      readFn.includes('currentPeriod()')
    );
    ok(
      'the spend counter is written against the same currentPeriod()',
      writeFn.includes('currentPeriod()') && !/'20\d\d-\d\d'/.test(writeFn)
    );
  }

  // -------------- Revocation cleanup may only clear what the run looked at
  // Cleanup clears every sweep-sourced wallet ABSENT from the seen table, so
  // its blast radius is "everything not seen". That was safe only while the
  // sweep covered the whole network in one run, which had never once happened.
  // Bounding the UPDATE to the swept FID span is what lets a monthly sixth
  // clean up at all; get the bound wrong and it reads five sixths of the graph
  // as revoked.
  {
    const lib = withoutComments(readFileSync('lib/farcaster-sweep.ts', 'utf8'));
    const runner = withoutComments(
      readFileSync('scripts/farcaster-sweep.ts', 'utf8')
    );

    const cleanupFn = lib.slice(
      lib.indexOf('export async function cleanupRevokedWallets'),
      lib.indexOf('export async function sweepFidRange')
    );

    ok(
      'the cleanup UPDATE is bounded to the swept FID range',
      /AND fc_fid BETWEEN \$\{startFid\} AND \$\{endFid\}/.test(cleanupFn)
    );
    ok(
      'cleanup refuses to run without a covered range',
      /if \(!coveredRange\)[\s\S]{0,200}?throw new Error/.test(cleanupFn)
    );
    ok(
      'cleanup validates the range it was handed',
      /startFid < 1 \|\|[\s\S]{0,80}?endFid < startFid/.test(cleanupFn)
    );

    /**
     * Only a run that covered a known span completely may record what it saw,
     * and only a run that recorded what it saw can reach cleanup. A `--range`
     * validation pass over 50k FIDs must not clear revocations across a band
     * nobody meant to audit.
     */
    ok(
      'only a full sweep or a monthly slice records a seen table',
      /const tracksSeen =\s*effectiveMode === '--full' \|\| effectiveMode === '--slice';/.test(
        runner
      )
    );
    /**
     * A slice must not clear the checkpoint either, not just refrain from
     * writing one. The cleanup branch was full-sweep exclusive when its
     * unconditional clear was written; widening the gate to `tracksSeen` handed
     * that clear to the monthly cron, which would wipe an in-progress full
     * sweep's resume point every month.
     */
    ok(
      'only a full sweep clears the full-sweep checkpoint',
      /if \(effectiveMode === '--full'\) await clearSweepCheckpoint\(\);/.test(
        runner
      ) &&
        !/\n\s*await clearSweepCheckpoint\(\);\n\s*\} else if \(effectiveMode === '--resume'\)/.test(
          runner
        )
    );

    /**
     * On a signal the resume point is written BEFORE the seen table is dropped.
     * The sweep keeps inserting into that table until the process exits, so a
     * DROP racing those inserts throws into main().catch and exits before the
     * checkpoint is written. The table is litter; the resume point is a month
     * of budget.
     */
    const handler = runner.slice(
      runner.indexOf('const onSignal'),
      runner.indexOf("process.on('SIGINT'")
    );
    ok(
      'a signal saves the checkpoint before dropping the seen table',
      handler.indexOf('saveCheckpoint(') < handler.indexOf('dropSeenTable(') &&
        handler.includes('saveCheckpoint(')
    );

    ok(
      'a slice keeps no full-sweep checkpoint',
      /const tracksProgress =\s*effectiveMode === '--full' \|\| effectiveMode === '--resume';/.test(
        runner
      ) && !/tracksProgress[\s\S]{0,120}?'--slice'/.test(runner)
    );

    /**
     * The slices tile [1, max] with no gap and no overlap, for every head the
     * network can reach. A gap is a band of FIDs no monthly run ever sweeps,
     * and because cleanup is bounded to what was swept, nothing would ever
     * report it: those FIDs would simply stop being refreshed.
     */
    const { monthlySliceRange, SWEEP_SLICES } =
      await import('@/lib/farcaster-sweep');
    for (const max of [SWEEP_SLICES, 100, 3_349_441, 3_349_447, 9_999_999]) {
      let previousEnd = 0;
      let tiles = true;
      for (let i = 0; i < SWEEP_SLICES; i++) {
        // Month chosen so the index lands on i, whatever today is.
        const when = new Date(Date.UTC(2000, i, 1));
        const r = monthlySliceRange(max, when, SWEEP_SLICES);
        if (r.index !== i % SWEEP_SLICES) tiles = false;
        if (r.startFid !== previousEnd + 1) tiles = false;
        previousEnd = r.endFid;
      }
      ok(
        `slices tile 1..${max.toLocaleString()} with no gap and end on the head`,
        tiles && previousEnd === max
      );
    }
  }

  // ------------------ The sweep must never silently start over at FID 1
  // A full sweep from 1 costs more than the whole monthly background ceiling,
  // so it can never reach the FIDs above the last stop: every restart re-covers
  // the same early range and the newest FIDs stay unswept forever. The only
  // thing standing between a run and that outcome is the checkpoint, so every
  // way a run can end has to leave one.
  {
    const sweep = withoutComments(
      readFileSync('scripts/farcaster-sweep.ts', 'utf8')
    );

    // A signal must save progress. CI sends SIGTERM on cancel and on timeout,
    // and both used to discard the whole segment: the checkpoint was written in
    // exactly one branch, the budget stop.
    ok(
      'a terminating signal saves the checkpoint',
      sweep.includes("process.on('SIGTERM'") &&
        sweep.includes("process.on('SIGINT'") &&
        /onSignal[\s\S]{0,600}?saveCheckpoint\(/.test(sweep)
    );

    // Progress is written during the run, not only at the end. Without this a
    // crash or a lost network is the same as never having run.
    ok(
      'the checkpoint is written as the sweep progresses',
      /lastCheckpointedAt[\s\S]{0,300}?saveCheckpoint\(/.test(sweep)
    );

    // The periodic write keeps its own counter. Riding on the log line's
    // `lastLoggedAt` would silently stop checkpointing the moment somebody
    // changed the logging condition, and nothing would report it.
    ok(
      'the checkpoint cadence does not ride on the log cadence',
      sweep.includes('lastCheckpointedAt') &&
        !/lastLoggedAt[\s\S]{0,120}?saveCheckpoint\(/.test(sweep)
    );

    // Only a run covering the whole network may write one. A `--range`
    // validation run that budget-stopped would otherwise overwrite a real
    // full-sweep checkpoint with its own narrow span, and the next `--auto`
    // would "complete" that span, clear it, and lose the real progress.
    ok(
      'only a full sweep or a resume writes a checkpoint',
      /const saveCheckpoint[\s\S]{0,200}?if \(!tracksProgress\) return;/.test(
        sweep
      )
    );
  }

  // ------------- Reachability percentages live in the registry, not in copy
  // The counts were centralised on 2026-08-20 after one figure became three
  // different numbers across five surfaces. The percentages beside them were
  // left as literals and grew the same shape back: eleven hand-typed copies
  // that every sweep moves at once. check-published-figures verifies each of
  // them against x_accounts, so drift was caught, but caught is not prevented,
  // and eleven chores per sweep is what makes people round rather than
  // re-measure. Markdown keeps literals, because a .md cannot import; that is
  // exactly what the figures check is for.
  {
    const tsCopy = [
      'components/ReachabilityClaim.tsx',
      'lib/welcome-sequence.ts',
      'app/llms.txt/route.ts',
      'app/layout.tsx',
      'lib/faq.ts',
      'app/check/page.tsx',
    ];
    for (const file of tsCopy) {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      // Comments are stripped: a header may record what a share was on a date,
      // which is history rather than a live claim.
      const code = withoutComments(text);
      const hit = code.match(
        /\b[0-9]{1,2}\.[0-9]%\s*(?:live|suspended|unclaimed|are|names nobody|reach)/i
      );
      ok(
        `${file} takes its reachability shares from the registry`,
        hit === null
      );
    }

    /**
     * The unreachable share is derived, never typed.
     *
     * It is suspended plus unclaimed and has no independent source, so a
     * literal is a number that must agree with two others and will not when
     * either moves. Asserting the arithmetic rather than the value keeps this
     * true after the next sweep.
     */
    const figures = await import('@/lib/public-figures');
    const derived =
      Math.round(
        (Number(figures.X_SUSPENDED_PCT) + Number(figures.X_UNCLAIMED_PCT)) * 10
      ) / 10;
    ok(
      'the unreachable share equals suspended plus unclaimed',
      Number(figures.X_UNREACHABLE_PCT) === derived
    );
    ok(
      'the three reachability shares account for the whole resolved set',
      Math.abs(
        Number(figures.X_LIVE_PCT) +
          Number(figures.X_SUSPENDED_PCT) +
          Number(figures.X_UNCLAIMED_PCT) -
          100
      ) <= 0.2
    );
  }

  // -------------------------------- The funnel: a lookup belongs to a visit
  // Every lookup_started and lookup_completed row in the table, 1,597 of them,
  // had no session_id, because both are emitted server-side and nothing told
  // the server which visit it was serving. That is the join the funnel needs,
  // and without it "how many arrivals ran a lookup" is unanswerable.
  {
    const route = withoutComments(
      readFileSync('app/api/jobs/route.ts', 'utf8')
    );
    const processor = withoutComments(
      readFileSync('lib/job-processor.ts', 'utf8')
    );

    ok(
      // The pattern must be applied to the incoming value, not merely present
      // somewhere in the file.
      'the job route validates the session id before using it',
      /\.test\(\s*sessionId\s*\)/.test(route)
    );
    ok(
      'lookup_started carries the session',
      /trackEvent\('lookup_started',[\s\S]{0,200}?sessionId:/.test(route)
    );
    ok(
      /**
       * Scoped to the createJob argument, not a character window.
       *
       * A 900-character window after `createJob(` reached past the call and
       * into the `trackEvent('lookup_started')` below it, so deleting the
       * option entirely still matched the event's own `sessionId:` and the
       * assertion passed over the deletion. Caught by the guard.
       */
      'the session is stored on the job, not only used for one event',
      (() => {
        const at = route.indexOf('createJob(');
        const args = at >= 0 ? route.slice(at, route.indexOf('});', at)) : '';
        return (
          args.includes('sessionId:') &&
          /insert\(lookupJobs\)[\s\S]{0,300}?sessionId:/.test(processor)
        );
      })()
    );
    /**
     * Every emitter, checked inside its own call rather than by counting the
     * file.
     *
     * The second `lookup_completed` fires only on a partial social-graph write,
     * which is exactly the path nobody exercises by hand, so "one of them has
     * it" is not good enough. This was a pair of counts compared for equality,
     * which held only while `sessionId: job.sessionId` appeared nowhere else:
     * adding the `history_saved` emitter made the totals 3 and 2 and failed the
     * assertion over entirely correct code. Splitting on the call and asking
     * each one separately is immune both to that and to how far apart the
     * fields drift inside a call.
     */
    const emitterBodies = processor
      .split("trackEvent('")
      .slice(1)
      .map((s) => ({
        event: s.slice(0, s.indexOf("'")),
        body: s.slice(0, 400),
      }));
    const sessionCarriers = ['lookup_completed', 'history_saved'];
    for (const event of sessionCarriers) {
      const bodies = emitterBodies.filter((e) => e.event === event);
      ok(
        `every ${event} emitter reads the session off the job (${bodies.length} found)`,
        bodies.length >= 1 &&
          bodies.every((b) => b.body.includes('sessionId: job.sessionId'))
      );
    }
    ok(
      'both lookup_completed emitters are still present',
      emitterBodies.filter((e) => e.event === 'lookup_completed').length >= 2
    );
    /**
     * The save rate is a rate over an event nothing emitted.
     *
     * `history_saved` and `Analytics.historySaved` both existed from January
     * and neither was ever called, so the funnel step and the "History save
     * rate" stat were structural zeros for seven months. The worker is the
     * only pipeline since STA-44, so this is the only place it can go missing.
     */
    ok(
      'the job processor emits history_saved when a save succeeds',
      /saveLookup\([\s\S]{0,400}?trackEvent\('history_saved'/.test(processor)
    );
    ok(
      'the worker takes the session from the row, not from options',
      !/sessionId: options\.sessionId ?\?\?/.test(processor)
    );

    // ------------------------------------------------- Analytics query shape
    {
      const analytics = readFileSync('lib/analytics.ts', 'utf8');
      /**
       * SQL comments too, not only JavaScript ones.
       *
       * `withoutComments` strips `//` and block comments, and the SQL in this
       * file is inside template literals where a comment starts with `--`. The
       * alias check below failed on its first run against entirely correct
       * code, because the SQL comment *explaining* that an alias must not be
       * unquoted camelCase contains an unquoted camelCase alias. Same trap the
       * signup-origin assertion fell into, one comment syntax further down.
       */
      const code = withoutComments(analytics).replace(/--[^\n]*/g, '');

      /**
       * A window bound in raw SQL must be a UTC literal, not a JS Date.
       *
       * Drizzle sends a `Date` parameter as a local-offset string, and these
       * columns are `timestamp without time zone` holding UTC, so Postgres
       * discards the offset and the window ends however many hours early the
       * running machine is behind UTC. Production is UTC and never sees it,
       * which is why it had to be asserted rather than noticed: it silently
       * deleted the current day from every local reading of these queries.
       */
      const nakedBound = /created_at\s*[<>]=\s*\$\{(startDate|endDate)\}/;
      ok(
        'no raw-SQL window bound interpolates a JS Date directly',
        !nakedBound.test(code)
      );
      ok(
        'the naked-bound pattern matches the form it forbids, so the check above can fail',
        nakedBound.test('WHERE created_at >= ${startDate} AND x')
      );
      ok(
        'the raw-SQL bounds go through the UTC helper',
        /created_at\s*>=\s*\$\{utcBound\(startDate\)\}::timestamp/.test(code) &&
          /created_at\s*<=\s*\$\{utcBound\(endDate\)\}::timestamp/.test(code)
      );
      {
        /**
         * The helper's own output, not merely the fact that callers use it.
         *
         * This block first asserted only that every call site went through
         * `utcBound`, and the guard replaced the function body with
         * `String(d)` and passed. Both halves are needed: the call sites, so
         * nobody bypasses it, and this, so it is worth going through.
         *
         * A fixed UTC instant, so the assertion means the same thing on this
         * laptop at UTC-5 and in CI at UTC. Under `String(d)` it fails in both.
         */
        const { utcBound, getSessionFunnel } = await import('@/lib/analytics');
        const d = new Date(Date.UTC(2026, 7, 26, 19, 7, 29, 664));
        ok(
          'a window bound renders as the UTC wall clock, with no offset',
          utcBound(d) === '2026-08-26 19:07:29.664'
        );
        ok(
          'and it is not the local-time rendering, which is what was being sent',
          utcBound(d) !== String(d) && !/GMT|[+-]\d{2}:\d{2}$/.test(utcBound(d))
        );
        ok(
          'the session funnel is exported and callable',
          typeof getSessionFunnel === 'function'
        );
      }

      /**
       * An unquoted camelCase alias is folded to lower case by Postgres.
       *
       * The row is cast to an interface rather than validated, so a folded
       * alias yields `undefined` for a property TypeScript swears is a number,
       * with no error anywhere. The first draft of the session funnel shipped
       * six of them and would have rendered six blank steps.
       */
      const foldedAlias = /\bAS\s+(?!")[a-z_]*[A-Z][A-Za-z_]*/;
      ok('no raw-SQL alias is unquoted camelCase', !foldedAlias.test(code));
      ok(
        'the folded-alias pattern matches the form it forbids',
        foldedAlias.test('count(*)::int AS ranLookup,') &&
          !foldedAlias.test('count(*)::int AS "ranLookup",')
      );

      /**
       * A cohort's average is summed, never asserted from its definition.
       *
       * Three rows stated a constant in a column headed "Avg lookups", so the
       * table rendered each as a measurement: "Almost converted" reported
       * exactly 3, which is its own floor; "Hit the free wall" reported 0 for
       * accounts defined by having exhausted an allowance (Bugbot, 2026-08-26);
       * "Churned paid" reported 0 for accounts that query never sees.
       *
       * Read off the source rather than by calling it, because the cohorts need
       * a database and this file must run without one. The three accumulators
       * are what make the averages real, so their absence is the defect.
       */
      const cohorts = code.slice(
        code.indexOf('export async function getUserCohorts'),
        code.indexOf('export async function getRetentionCohorts')
      );
      ok(
        'every cohort average is divided from an accumulated total',
        /hitTheWallLookups \+= lookups/.test(cohorts) &&
          /almostConvertedLookups \+= lookups/.test(cohorts) &&
          /powerUserLookups \+= lookups/.test(cohorts)
      );
      /**
       * No bare number, not merely no zero.
       *
       * The first version of this forbade `avgLookups: 0` specifically, and the
       * guard duly replaced an accumulator with `avgLookups: 3` and went
       * undetected: forbidding the one wrong constant that was there leaves
       * every other wrong constant available. The accumulator assertion above
       * did not catch it either, because a mutation that stops *reading* an
       * accumulator leaves the `+=` line perfectly intact.
       *
       * So the rule is what the column means rather than what it once said: an
       * average is divided from a total, or it is `null`. `Tire kickers` is the
       * one cohort defined as exactly one lookup, and it still has to say
       * `null` for the empty case, so it satisfies this too.
       */
      const averages = cohorts.match(/avgLookups:[^\n]*/g) ?? [];
      ok(
        `every cohort average is a division or a null (${averages.length} cohorts)`,
        averages.length >= 5 &&
          averages.every((a) => a.includes('mean(') || a.includes('null'))
      );
      ok(
        'the average check rejects a bare literal, so it can fail',
        !['avgLookups: 3,'].every(
          (a) => a.includes('mean(') || a.includes('null')
        )
      );
      ok(
        'the empty-cohort average is null, so the mean of nothing is not a number',
        /n > 0 \? total \/ n : null/.test(cohorts)
      );
      ok(
        'the pane renders an unmeasurable cell rather than a figure',
        /avgLookups === null/.test(
          readFileSync('components/admin/GrowthRetention.tsx', 'utf8')
        )
      );

      /**
       * One definition of conversion, and no invented denominator.
       *
       * There were three rates under the word "conversion" on three panes, and
       * the Pulse tile linked to a pane that computed a different one. Zero is
       * not the answer to "what share of nobody converted".
       */
      const { conversionRates } = await import('@/lib/analytics');
      const noDenominator = conversionRates({
        paymentCompleted: 0,
        upgradeModalViewed: 0,
        lookupsStarted: 0,
      });
      ok(
        'a zero denominator yields null, never 0%',
        noDenominator.pricingToPaid === null &&
          noDenominator.lookupToPaid === null
      );
      const real = conversionRates({
        paymentCompleted: 5,
        upgradeModalViewed: 100,
        lookupsStarted: 50,
      });
      ok(
        'the two rates are computed from their own denominators',
        real.pricingToPaid === 5 && real.lookupToPaid === 10
      );
      /**
       * Scoped to the pulse function, not the file.
       *
       * The first version tested the whole file for the absence of
       * `paymentCompleted / funnel.lookupsStarted` and failed, because
       * `conversionRates` itself is the one place that division belongs. An
       * assertion that forbids a formula everywhere forbids its definition.
       */
      const pulse = code.slice(
        code.indexOf('export async function getExecutivePulse')
      );
      ok(
        'the pulse reads the shared helper rather than dividing again',
        /conversionRates\(funnel\)/.test(pulse) &&
          !/paymentCompleted \/ funnel\./.test(pulse)
      );
    }

    // ------------------------------------------------------- Signup tracking
    {
      const access = readFileSync('lib/access.ts', 'utf8');
      const code = withoutComments(access);
      /**
       * `user_registered` was declared in January and emitted by nothing, so
       * the funnel had no account step at all. It must fire once per account,
       * which means the existing-user early return has to come first: without
       * it, every sign-in would record a new signup and the step would report
       * logins.
       */
      ok(
        'account creation emits user_registered',
        /trackEvent\('user_registered'/.test(code)
      );
      ok(
        'it fires only on the create branch, after the existing-user return',
        code.indexOf('if (existing) return existing;') > 0 &&
          code.indexOf('if (existing) return existing;') <
            code.indexOf("trackEvent('user_registered'")
      );
    }

    // --------------------------------------------- A sale is booked once
    // `payment_completed` had fired once in the lifetime of the table: the only
    // emitter was on the retired tier path, so every credit pack ever sold was
    // invisible to the one query that asks whether anybody buys anything.
    const credits = withoutComments(readFileSync('lib/credits.ts', 'utf8'));
    ok(
      'the Stripe pack grant books the sale',
      /stripePaymentId,[\s\S]{0,120}?bookSale\(/.test(credits)
    );
    ok(
      'the onchain pack grant books the sale',
      /rail: 'x402',[\s\S]{0,140}?bookSale\(/.test(credits)
    );
    // `await bookSale(`, not `bookSale(`: the latter matches the function's own
    // declaration, which sits above both grants, so the comparison was against
    // the definition rather than a call and failed on correct code.
    ok(
      'the sale is booked after the insert, so a failed grant books nothing',
      credits.indexOf('insert(creditLots)') < credits.indexOf('await bookSale(')
    );
    ok(
      'a duplicate webhook cannot book a second sale',
      /isUniqueViolation\(error\)\) return false/.test(credits)
    );
    ok(
      'a hand-issued credit is not counted as a sale',
      !/pack: 'grant',[\s\S]{0,200}?bookSale\(/.test(credits)
    );
    ok(
      // Counted, not matched. `/await bookSale\(/` passed while the other
      // rail's await was deleted, and one floating promise is exactly the
      // defect: a serverless runtime may discard it when the handler returns.
      `every sale event is awaited (${(credits.match(/await bookSale\(/g) ?? []).length}/${(credits.match(/(?<!async function )bookSale\(/g) ?? []).length})`,
      (credits.match(/await bookSale\(/g) ?? []).length ===
        (credits.match(/(?<!async function )bookSale\(/g) ?? []).length &&
        (credits.match(/await bookSale\(/g) ?? []).length >= 2
    );
  }

  // ------------------------- The slow source: a ceiling, and what it must not do
  // 13 August: 30 of 33 batches failed, median 229 seconds, roughly half of
  // every batch unreached. A failing request waited the full 15s timeout and
  // waves run in series, so a 19-wave batch spent five minutes producing
  // nothing. The timeout is now 6s and the batch has a deadline.
  {
    // The ceiling has to clear a healthy batch or it truncates real work.
    // Measured over 208 healthy batches: worst was 83,716ms at 2,999 wallets.
    ok(
      'the deadline clears the worst healthy batch ever measured',
      batchDeadlineMs(2999) > 83_716
    );
    ok(
      'the deadline would have cut 13 August short',
      batchDeadlineMs(1867) < 229_064
    );
    // It scales with the work, because waves run in series.
    ok(
      'a bigger batch gets a bigger ceiling',
      batchDeadlineMs(3000) > batchDeadlineMs(300)
    );
    ok(
      'a handful of wallets is not cut off by arithmetic',
      batchDeadlineMs(1) >= 30_000 && batchDeadlineMs(0) >= 30_000
    );
    /**
     * The per-request timeout, and the one relationship that must hold.
     *
     * A single wave's worst case is one request's timeout, so the floor has to
     * leave room for at least one whole wave. If the timeout ever exceeded the
     * floor, a small batch could be abandoned before its only wave finished
     * and would return nothing while reporting wallets as unreached.
     */
    ok(
      'the floor always permits one full wave',
      API_TIMEOUT_MS < MIN_BATCH_DEADLINE_MS
    );
    // Above the worst healthy wave measured (2,790ms), and below the 15s that
    // made 13 August cost five minutes a batch.
    ok(
      'the request timeout clears the worst healthy wave with room',
      API_TIMEOUT_MS >= 2 * 2790
    );
    ok(
      'the request timeout is no longer the fifteen seconds that cost the outage',
      API_TIMEOUT_MS < 15_000
    );

    // Prove it can bind at all, or a ceiling of Infinity passes everything.
    ok(
      'the ceiling is finite and bounded',
      Number.isFinite(batchDeadlineMs(100_000)) &&
        batchDeadlineMs(2999) < 300_000
    );

    /**
     * The part that is not about speed.
     *
     * A wallet the deadline gave up on must look like "not checked", never like
     * "checked, has nothing". The pipeline persists a negative only when a run
     * completed without API failures and then trusts it for 30 days, so a
     * silent drop here would write a false negative into the graph that no
     * later lookup would correct.
     */
    const w3b = withoutComments(readFileSync('lib/web3bio.ts', 'utf8'));
    const bail = w3b.slice(w3b.indexOf('if (Date.now() >= deadline)'));
    const bailBlock = bail.slice(0, bail.indexOf('break;'));
    ok(
      'every wallet the deadline skips is recorded as failed',
      /failedWallets\?\.add\(/.test(bailBlock) &&
        /wallets\.slice\(i\)/.test(bailBlock)
    );
    ok(
      'the skipped wallets also count as errors, so the batch is not reported clean',
      /errorCount\+\+/.test(bailBlock)
    );
    /**
     * Both negatives, not just the long one (Bugbot, 2026-08-25, High).
     *
     * A wallet nobody reached must not be written as "checked, has nothing" on
     * either path. `apiFailedWallets` blocked the 30-day graph negative and not
     * the 7-day cache one: a skipped wallet has no socials and no source, so it
     * fell into the `['none']` branch and was cached as a negative that later
     * lookups trusted, skipping the APIs entirely. Guarding only the graph
     * looked complete because it is the negative anybody thinks about.
     */
    const jp = withoutComments(readFileSync('lib/job-processor.ts', 'utf8'));
    const cacheAt = jp.indexOf('const walletsToCache');
    const cacheBlock = jp.slice(
      cacheAt,
      jp.indexOf('cacheWalletResults', cacheAt)
    );
    ok(
      'an unreached wallet is never cached as a negative',
      /apiFailedWallets\.has\([a-z]+\)\)\s*return null;/.test(cacheBlock)
    );
    ok(
      'the unreached check runs before the none branch that would cache it',
      cacheBlock.indexOf('apiFailedWallets.has') <
        cacheBlock.indexOf("source: ['none']")
    );
    // Prove the none branch still exists, or the assertion above passes
    // against code that simply stopped caching negatives at all.
    ok(
      'genuine negatives are still cached',
      cacheBlock.includes("source: ['none']")
    );

    // A truncated batch and an upstream failure are different events.
    ok(
      'a batch that ran out of time says so rather than blaming the upstream',
      /abandonedAt !== null[\s\S]{0,120}?deadline: stopped at/.test(w3b)
    );
    // The deadline is checked between waves, not inside one: a wave in flight
    // is already bounded, and abandoning it discards answers already paid for.
    ok(
      'the deadline is checked before a wave starts',
      w3b.indexOf('if (Date.now() >= deadline)') <
        w3b.indexOf('const batch = wallets.slice(i, i + MAX_CONCURRENT)')
    );
  }

  // ------------------------------------------------ the overlap disclosure floor
  // The claim in lib/holder-pages.ts is that a published overlap row cannot be
  // inverted to name wallets. That is a claim about an attacker, so it is
  // asserted here rather than trusted.
  //
  // The attack it defends against: holder lists are free from any block
  // explorer, so "N wallets hold both A and B" plus two public lists is a set
  // intersection anyone can compute. At N=2 the answer is two named people. The
  // floor is the whole defence, and nothing else in the query enforces it.
  {
    const { OVERLAP_MIN_SHARED, LISTING_MIN_REACHABLE, meetsListingFloor } =
      await import('@/lib/holder-pages');
    const holderSrc = withoutComments(
      readFileSync('lib/holder-pages.ts', 'utf8')
    );
    const overlapSql = holderSrc.slice(
      holderSrc.indexOf('export async function getHolderOverlap')
    );

    ok(
      'the overlap query bounds its groups by OVERLAP_MIN_SHARED',
      /HAVING count\(\*\) >= \$\{OVERLAP_MIN_SHARED\}/.test(overlapSql)
    );
    // Assert the refusal: a floor that can be edited down to 1 is not a floor.
    // k-anonymity here has to be at least the floor the listing rule already
    // applies, or the hub publishes a crowd while a report publishes a pair.
    ok(
      'the overlap floor is at least the listing floor',
      OVERLAP_MIN_SHARED >= LISTING_MIN_REACHABLE && OVERLAP_MIN_SHARED >= 20
    );
    // The bug this replaces, asserted absent so the check above is
    // load-bearing: GROUP BY running straight into ORDER BY with nothing
    // between them is the unbounded query that shipped.
    ok(
      'no unbounded GROUP BY survives in the overlap query',
      !/GROUP BY sc\.address, sc\.chain, sc\.name\s*ORDER BY/.test(overlapSql)
    );
    /**
     * An unnamed contract reaches a page as the string "Unknown Token", which
     * is both useless to a reader and a tell that the name check is only
     * testing for NULL.
     *
     * This assertion used to read `sc.name <> 'Unknown Token'` out of the
     * overlap query, and it passed for as long as that literal sat there while
     * the LISTING query, which feeds the hub, the sitemap and
     * generateStaticParams, filtered on NULL alone and published two
     * placeholder-named reports. A guard aimed at the one site that was
     * already correct: the literal was written twice and the rule was written
     * nowhere.
     *
     * So it moves with the refactor and gains the two halves it was missing.
     * The predicate is `isNamed` and its `sc` fragment in lib/holder-pages.ts;
     * both queries are asserted to filter on the fragment rather than on a
     * spelling of their own, the predicate itself is then tried on the
     * placeholder, and the module is asserted to hold no surviving copy of the
     * literal for a third site to be written from.
     */
    ok(
      'the overlap query filters on the shared named-contract predicate',
      /\$\{namedContract\}/.test(overlapSql)
    );
    const listingSql = holderSrc.slice(
      holderSrc.indexOf('export async function listHolderCollections'),
      holderSrc.indexOf('export async function getHolderCollection')
    );
    ok(
      'the listing query filters on it too, which is where the defect was',
      listingSql.length > 200 && /\$\{namedContract\}/.test(listingSql)
    );

    // Through the code, not around it: the rule itself, tried on the
    // placeholder the seeder writes when every RPC read of name() failed.
    const { isNamed } = await import('@/lib/holder-pages');
    ok(
      'the placeholder is refused, in either case, and so is an absent name',
      !isNamed('Unknown Token') &&
        !isNamed('unknown token') &&
        !isNamed('Unknown') &&
        !isNamed(null) &&
        !isNamed(undefined) &&
        !isNamed('')
    );
    // The refusal has to stop at the word. A collection really called
    // "Unknowable Machines" is a named collection, and a rule that swallows it
    // deindexes a page that answers its query.
    ok(
      'a real name still passes, including one that merely starts with those letters',
      isNamed('Pepe') && isNamed('Unknowable Machines')
    );

    /**
     * The listing filter is not deindexing. A page dropped from the listing
     * stays live at its own URL through getHolderCollection, and a URL already
     * submitted in a sitemap does not leave the index by being withdrawn from
     * one, so the directive has to ride on the page.
     *
     * Asserted as a conditional SPREAD, not a conditional value. `robots:
     * isNamed(...) ? undefined : {...}` reads the same and is not: an
     * explicit `robots: undefined` is a present key, and Next merges metadata
     * key by key, so it overrides the ancestor's value rather than inheriting
     * it. That form silently stripped the directive from the 123 named
     * reports while looking correct. Inverting the condition also fails here,
     * which is the mistake a one-character edit makes.
     */
    const holderPage = withoutComments(
      readFileSync('app/holders/[chain]/[address]/page.tsx', 'utf8')
    );
    ok(
      'a placeholder-named report carries its own noindex, which the listing cannot supply',
      /\.\.\.\(isNamed\(collection\.name\)\s*\?\s*\{\}\s*:\s*\{\s*robots:\s*\{\s*index:\s*false\s*\}\s*\}\)/.test(
        holderPage
      )
    );
    ok(
      'no copy of the placeholder literal survives for a third rule to be written from',
      !/Unknown Token/.test(holderSrc) && !/Unknown Token/.test(holderPage)
    );

    /**
     * The "measurement in progress" note is decided by coverage alone.
     *
     * It used to also require the page to be below the listing floor, which
     * silently asserted that clearing the floor implies being measured. It does
     * not: `reachableAny` only ever undercounts, so a dense holder base clears
     * the floor on its first few hundred checked wallets and the page then
     * renders a lower bound as the collection's rate with the note suppressed.
     * Seen live on a collection at 239 of 764 checked.
     */
    /**
     * The import cap exists twice: once in the seeding pipeline that enforces
     * it, once in `lib/holder-pages.ts` so a rendered route can recognize a
     * reported total that is really the cap without importing the ingest.
     *
     * Two copies of a number drift, and this one decides whether a machine
     * readable `totalHolders` is published at all. If the seeder ever raises
     * its cap and this copy stays, the page starts asserting the old cap as a
     * real holder base for every collection that hits the new one.
     */
    /**
     * The /mcp page lists every tool with its cost, so it keeps its own copy
     * of the roster, and every count it states is derived from that copy.
     * That makes one assertion enough: if the two lists hold the same names
     * in the same order, the four counts on the page are right by
     * construction, and a ninth tool shipped without touching the page fails
     * here rather than being discovered by a reader.
     */
    const mcpRoute = withoutComments(
      readFileSync('app/api/mcp/route.ts', 'utf8')
    );
    const registered = [
      ...mcpRoute.matchAll(/registerTool\(\s*'(walletlink_[a-z_]+)'/g),
    ].map((m) => m[1]);
    const mcpPage = withoutComments(readFileSync('app/mcp/page.tsx', 'utf8'));
    const listed = [...mcpPage.matchAll(/name:\s*'(walletlink_[a-z_]+)'/g)].map(
      (m) => m[1]
    );
    ok(
      'the MCP tools were found on both surfaces at all',
      registered.length >= 8 && listed.length >= 8
    );

    // A null balance with no reason made an agent guess between "unknown" and
    // "zero" (seen live, 2026-09-24). /v1/usage says which; the tool has to
    // pass it on, and its description has to say what the pair means.
    const balanceTool = mcpRoute.slice(
      mcpRoute.indexOf("registerTool(\n      'walletlink_account_balance'"),
      mcpRoute.indexOf("registerTool(\n      'walletlink_submit_job'")
    );
    ok(
      'the balance tool passes unmetered through, so a null balance is never unexplained',
      balanceTool.length > 0 &&
        balanceTool.includes(
          'unmetered: asBoolean(credits.unmetered, false),'
        ) &&
        balanceTool.includes('matches_available: credits.available ?? null,') &&
        /unmetered is true on an account that is never debited/.test(
          balanceTool
        )
    );

    /**
     * Every tool carries its annotations in full. Claude's connector directory
     * reads the listing name from `annotations.title`, not the top-level
     * title, and flags any tool without it; it also groups tools by
     * `readOnlyHint`, and a read-only tool may run without asking. So each
     * registration states its title inside the annotations and every hint
     * explicitly, and a tool whose description charges match credits is
     * never read-only: it changes the caller's balance.
     */
    const registrations = mcpRoute
      .split(/server\.registerTool\(/)
      .slice(1)
      .map((block) => ({
        name: /^\s*'(walletlink_[a-z_]+)'/.exec(block)?.[1] ?? '',
        title: /\btitle:\s*'([^']+)'/.exec(block)?.[1] ?? '',
        annotations: /annotations:\s*\{([^}]*)\}/.exec(block)?.[1] ?? '',
        metered: /one match credit/.test(block),
      }));
    ok(
      'every MCP tool registration was parsed with a name, a title and annotations',
      registrations.length === registered.length &&
        registrations.every((r) => r.name && r.title && r.annotations)
    );
    ok(
      "every MCP tool repeats its title as annotations.title, which Claude's directory lists",
      registrations.every((r) => r.annotations.includes(`title: '${r.title}'`))
    );
    ok(
      'every MCP tool states readOnlyHint, idempotentHint and openWorldHint explicitly',
      registrations.every((r) =>
        ['readOnlyHint', 'idempotentHint', 'openWorldHint'].every((h) =>
          r.annotations.includes(`${h}:`)
        )
      )
    );
    ok(
      'every MCP tool that is not read-only also states destructiveHint',
      registrations.every(
        (r) =>
          !r.annotations.includes('readOnlyHint: false') ||
          r.annotations.includes('destructiveHint:')
      )
    );
    ok(
      'no MCP tool that charges match credits is marked read-only',
      registrations.some((r) => r.metered) &&
        registrations.every(
          (r) => !r.metered || r.annotations.includes('readOnlyHint: false')
        )
    );

    /**
     * `/skill.md` is a third surface carrying the roster, and the one handed
     * to an agent rather than read by a person.
     *
     * It keeps its own table because the cost column is editorial prose and
     * nothing on a tool definition states a price. That is the same trade the
     * `/mcp` page makes, so it takes the same assertion: a ninth tool fails
     * here rather than being discovered missing by whoever pasted the URL into
     * their agent and wondered why it could not see it.
     */
    const skillRoute = withoutComments(
      readFileSync('app/skill.md/route.ts', 'utf8')
    );
    const inSkill = [
      ...skillRoute.matchAll(/'(walletlink_[a-z_]+)',\n\s*'/g),
    ].map((m) => m[1]);
    ok(
      'the skill file lists exactly the tools the server registers',
      inSkill.length >= 8 &&
        new Set(inSkill).size === new Set(registered).size &&
        [...new Set(registered)].every((t) => inSkill.includes(t))
    );
    // Set equality, not order: the page groups the tools by what a reader
    // reaches for first, which is an editorial choice and not a drift. What
    // must never differ is the membership, because every count on the page is
    // derived from the length of this list.
    ok(
      'the /mcp page lists exactly the tools the server registers, no more and no fewer',
      registered.length === listed.length &&
        [...registered].sort().join(',') === [...listed].sort().join(',')
    );

    const { HOLDER_IMPORT_CAP } = await import('@/lib/holder-pages');
    const seedSrc = withoutComments(
      readFileSync('lib/seed-collections.ts', 'utf8')
    );
    const seedCap = seedSrc.match(/const HOLDER_CAP = (\d+);/);
    ok(
      'the seeder cap and the copy the holder page reads are the same number',
      Boolean(seedCap) && Number(seedCap![1]) === HOLDER_IMPORT_CAP
    );

    /**
     * The holder page states its measured set twice, in prose and in the
     * Dataset node, and the two used to be computed separately. They
     * disagreed on the six contracts whose reported total came back as
     * exactly the cap: the Dataset said the real base may be larger while
     * the visible sentence said "all 2,000". An answer engine quotes the
     * prose, so the page shipped the over-claim the Dataset existed to
     * prevent.
     *
     * Run against the real shapes rather than grepped, so a refactor that
     * keeps the call sites but breaks the classification still fails. The
     * inputs are the four cases production actually holds, measured on
     * 2026-09-07 over the 177 named contracts that carry imported wallets.
     */
    const { holderBasis, holderBasisPhrase, holderBasisCaveat } =
      await import('@/lib/holder-pages');
    const basisFor = (holdersImported: number, totalHolders: number | null) =>
      holderBasis({ holdersImported, totalHolders });
    ok(
      'a reported total equal to the cap and to what we imported is refused as a total',
      basisFor(2000, 2000).kind === 'capped' &&
        basisFor(2000, null).kind === 'capped' &&
        basisFor(2000, 0).kind === 'capped'
    );
    ok(
      'a zero total is read as absent, never published as a holder count',
      basisFor(659, 0).kind === 'unknownTotal' &&
        basisFor(659, null).kind === 'unknownTotal'
    );
    ok(
      'a genuine total is still a total',
      basisFor(2000, 16582).kind === 'sample' &&
        basisFor(1327, 1327).kind === 'complete'
    );
    /**
     * The cap phrasing must appear only where the cap was actually hit.
     * Before the shared predicate, every contract with no usable total was
     * described as capped at 2,000, including 44 that imported far fewer.
     */
    const caveatFor = (n: number, t: number | null) =>
      holderBasisCaveat(basisFor(n, t)) ?? '';
    ok(
      'only a run that hit the cap is described as capped',
      caveatFor(2000, 0).includes('import cap') &&
        !caveatFor(659, 0).includes('import cap') &&
        caveatFor(1327, 1327) === '' &&
        caveatFor(2000, 16582) === ''
    );
    /**
     * The two partial cases must not read as complete. Anchored on the
     * caveat existing rather than on its wording, so a rewrite of the
     * sentence keeps the assertion meaningful.
     */
    ok(
      'a measured set that is not the holder base always says so',
      caveatFor(2000, 0) !== '' && caveatFor(659, 0) !== ''
    );
    /**
     * The phrase stays a noun phrase in every case. It reads inside a
     * sentence that continues after it, and burying the hedge there is
     * what produced "the first 2,000 holders, which is the import cap, so
     * the full holder base may be larger, against the walletlink.social
     * index".
     */
    const phraseFor = (n: number, t: number | null) =>
      holderBasisPhrase(basisFor(n, t), {
        measuredNoun: 'holders',
        ofCollection: '',
      });
    /**
     * The same phrase with the suffix the Dataset actually passes.
     *
     * Asserting only the empty suffix is how a trailing clause survived
     * review: it read correctly in the visible sentence and garbled the
     * node a machine reads, which is the one surface this whole change
     * exists to get right.
     */
    const datasetPhraseFor = (n: number, t: number | null) =>
      holderBasisPhrase(basisFor(n, t), {
        measuredNoun: 'addresses',
        ofCollection: ' holding Example Collection',
      });
    ok(
      'nothing follows the collection suffix, so the Dataset phrase reads as a noun phrase too',
      [
        datasetPhraseFor(2000, 16582),
        datasetPhraseFor(1327, 1327),
        datasetPhraseFor(2000, 0),
        datasetPhraseFor(659, 0),
      ].every((p) => p.endsWith(' holding Example Collection'))
    );
    ok(
      'the measured-set phrase carries no trailing clause of its own',
      [
        phraseFor(2000, 16582),
        phraseFor(1327, 1327),
        phraseFor(2000, 0),
        phraseFor(659, 0),
        // Not a comma test: toLocaleString puts commas inside the numbers.
      ].every((p) => !/ which | so |, with /.test(p))
    );
    /**
     * Anchored on the absence of a second opinion. The drift was possible
     * because the page compared the two counts itself; if that comparison
     * comes back, the prose can disagree with the node again.
     */
    const holderBasisPage = withoutComments(
      readFileSync('app/holders/[chain]/[address]/page.tsx', 'utf8')
    );
    ok(
      'the holder page derives its measured set rather than recomputing it',
      !/totalHolders\s*[><]/.test(holderBasisPage) &&
        (holderBasisPage.match(/holderBasisPhrase\(/g) ?? []).length >= 2
    );

    const { measurementInProgress, MEASUREMENT_IN_PROGRESS_BELOW } =
      await import('@/lib/holder-pages');
    const partial = {
      holderCount: 764,
      checked: 239,
      withTwitter: 165,
      twitterVerified: 0,
      withFarcaster: 150,
      xLive: 147,
      xUnclaimed: 12,
      xSuspended: 6,
      reachableAny: 198,
      avgFcFollowers: null,
      medianFcFollowers: null,
    };
    ok(
      'a barely-checked page says so even when it clears the listing floor',
      meetsListingFloor(partial.reachableAny, partial.holderCount) &&
        measurementInProgress(partial)
    );
    ok(
      'a fully checked page carries no measurement note',
      !measurementInProgress({ ...partial, checked: partial.holderCount })
    );
    /**
     * The two questions the note used to answer at once.
     *
     * "Are these numbers quotable" is measurementInProgress; "is there a public
     * report to link" is meetsListingFloor, which is what actually puts a
     * collection on the hub and in the sitemap. They coincided only while the
     * note carried the floor inside it, and conflating them again would report
     * a live, listed report as not existing.
     */
    const concierge = withoutComments(
      readFileSync('scripts/concierge-signals.ts', 'utf8')
    );
    // Bounded to the one function. An unbounded probe over a file this
    // commented finds its own prose.
    const sliceBetween = (source: string, from: string, to: string) => {
      const start = source.indexOf(from);
      if (start === -1) return '';
      const end = source.indexOf(to, start + from.length);
      return end === -1 ? '' : source.slice(start, end + to.length);
    };
    const reportUrlFn = sliceBetween(
      concierge,
      'function reportUrlFor(',
      '\n}'
    );
    ok(
      'the report link is gated on publication, not on quotable numbers',
      reportUrlFn.includes('published') && !/\bstats\b/.test(reportUrlFn)
    );
    ok(
      'hasPublicReport is not derived from the quotable-stats value',
      !concierge.includes('hasPublicReport: Boolean(collection && stats)')
    );

    ok(
      'the coverage line is what decides the note',
      measurementInProgress({
        ...partial,
        checked:
          Math.ceil(partial.holderCount * MEASUREMENT_IN_PROGRESS_BELOW) - 1,
      }) &&
        !measurementInProgress({
          ...partial,
          checked: Math.ceil(
            partial.holderCount * MEASUREMENT_IN_PROGRESS_BELOW
          ),
        })
    );
  }

  // -------------------------------------------------- no infra ids in the repo
  // docs/README.md's public/private test is applied by a person reading a file,
  // and on 2026-08-30 that missed four Cloudflare identifiers sitting in a
  // table in a document that otherwise passes. The raw namespace endpoint was
  // the costly one: the same page explains that the endpoint is unauthenticated
  // and that the proxied CNAME is the only thing bounding Workers AI spend, so
  // the file documented the bypass next to the defence.
  //
  // These assertions match on SHAPE, never on a value. Writing the identifier
  // into the checker to detect the identifier would republish the thing it is
  // meant to remove, in a file nobody would think to look in.
  {
    const tracked = execSync('git ls-files', { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const offenders = (pattern: RegExp) =>
      tracked.filter((f) => {
        try {
          return pattern.test(readFileSync(f, 'utf8'));
        } catch {
          return false;
        }
      });

    ok(
      'no tracked file publishes an AI Search namespace endpoint',
      offenders(/ns-[0-9a-f-]{20,}\.search\.ai\.cloudflare\.com/).length === 0
    );
    // The table shape this actually shipped in: a labelled row whose value is a
    // bare 32-hex Cloudflare id. Narrow on purpose, so a commit hash or a test
    // fixture elsewhere in the repo does not fail the run.
    ok(
      'no tracked file tabulates a Cloudflare account, zone or ruleset id',
      offenders(
        /\|\s*(Account|Zone|Rate limit ruleset|Namespace id)\b[^|\n]*\|[^|\n]*\b[0-9a-f]{32}\b/i
      ).length === 0
    );
  }

  // ------------------------------------------------ the recognized seed prefix
  // lib/recognized-contracts.ts says "do not add an entry from memory". That
  // instruction is the only thing standing between this file and a page about
  // the wrong asset, and an instruction in a comment enforces nothing.
  {
    const { RECOGNIZED_CONTRACTS, recognizedCandidates } =
      await import('@/lib/recognized-contracts');
    const { SUPPORTED_CHAINS } = await import('@/lib/chains');

    ok(
      'every recognized address is a lowercase 40-hex contract address',
      RECOGNIZED_CONTRACTS.every((c) => /^0x[0-9a-f]{40}$/.test(c.address))
    );
    ok(
      'no chain lists the same contract twice',
      new Set(RECOGNIZED_CONTRACTS.map((c) => `${c.chain}:${c.address}`))
        .size === RECOGNIZED_CONTRACTS.length
    );
    ok(
      'every recognized contract names a supported chain',
      RECOGNIZED_CONTRACTS.every((c) => SUPPORTED_CHAINS.includes(c.chain))
    );
    // A zero address, a burn address or the chain's own predeploy range would
    // pass the hex check and publish a page about nothing.
    ok(
      'no recognized entry is the zero or burn address',
      !RECOGNIZED_CONTRACTS.some(
        (c) =>
          c.address === `0x${'0'.repeat(40)}` ||
          c.address === `0x${'0'.repeat(39)}1` ||
          /^0x0*dead$/.test(c.address)
      )
    );
    ok(
      'the accessor filters on both chain and kind',
      recognizedCandidates('ethereum', 'nft').every(
        (c) => c.chain === 'ethereum' && c.kind === 'nft'
      )
    );

    const seedSrc = withoutComments(
      readFileSync('lib/seed-collections.ts', 'utf8')
    );
    // The Robinhood fallback used to test `candidates.length === 0`. Prepending
    // a curated list makes that false, which would have silently narrowed the
    // one chain nobody else indexes to a handful of names. Assert the fixed
    // test is present AND the broken one is gone, because only the pair is
    // load-bearing: the old condition still reads plausibly.
    ok(
      'the Robinhood fallback tests whether discovery found nothing',
      /candidates\.length === recognizedCount && chain === 'robinhood'/.test(
        seedSrc
      )
    );
    ok(
      'the superseded length-zero fallback test is gone',
      !/candidates\.length === 0 && chain === 'robinhood'/.test(seedSrc)
    );
    // A discovery outage must not throw away names already held, but a genuine
    // nothing-to-seed must still surface as a failure.
    ok(
      'a token-discovery outage rethrows only when there is nothing to seed',
      /if \(candidates\.length === 0\) throw error;/.test(seedSrc)
    );
  }

  // ------------------------------------------------- the MCP handshake surface
  // The handshake reported version 1.0.0 while the public registry had moved
  // to 1.2.0 twice over. A literal here is a second copy of a number that
  // lives in server.json, and nothing could ever notice the two disagreeing.
  {
    const mcpSrc = withoutComments(
      readFileSync('app/api/mcp/route.ts', 'utf8')
    );
    const manifest = JSON.parse(readFileSync('server.json', 'utf8')) as {
      version?: string;
    };

    ok(
      'the MCP handshake version is read from the manifest',
      /version: serverManifest\.version/.test(mcpSrc)
    );
    ok(
      'no hardcoded version literal survives in the handshake',
      !/serverInfo: \{[^}]*version: '[0-9]/.test(mcpSrc)
    );
    ok('server.json still declares a version to read', !!manifest.version);
    // instructions is a ServerOptions field, a SIBLING of serverInfo. Nested
    // inside it the code still typechecks and the field is silently dropped at
    // initialize, so no client ever sees it and nothing fails.
    ok(
      'instructions sits beside serverInfo, not inside it',
      /serverInfo: \{[^}]*\},\s*instructions: INSTRUCTIONS/.test(
        mcpSrc.replace(/\n\s*/g, ' ')
      )
    );
  }

  // --------------------------------------------- no blended coverage anywhere
  // The house rule is that the chain decides the match rate and a single
  // blended figure is never published. app/layout.tsx carried "30.8% across
  // all three" in a site-wide FAQPage for eight days while llms.txt, the
  // README and all five comparison pages published the chain rows instead.
  // A rule that only some surfaces follow is a rule nothing enforces.
  {
    const surfaces = [
      'app/layout.tsx',
      'lib/faq.ts',
      'app/llms.txt/route.ts',
      'README.md',
      'app/pricing/page.tsx',
    ];
    const blended = surfaces.filter((f) => {
      try {
        return /across all three|blended (match )?rate/i.test(
          readFileSync(f, 'utf8')
        );
      } catch {
        return false;
      }
    });
    ok(
      `no public surface publishes a blended match rate (found in: ${blended.join(', ') || 'none'})`,
      blended.length === 0
    );
  }

  // --------------------------------------- evidence travels with the account
  // The product's central claim is that every match carries the class of
  // evidence behind it. /v1/batch returned a Farcaster account with no
  // `verified` field until 2026-08-30, so the MCP layer reported
  // `attested: null` on every multi-address result: the claim went missing
  // exactly where the volume is. Twitter had the same bug and was fixed alone.
  //
  // Asserted per route rather than centrally, because there is no shared
  // builder for the Farcaster object and the next route will be written by
  // copying one of these four.
  {
    const ROUTES = [
      'app/api/v1/batch/route.ts',
      'app/api/v1/wallet/[address]/route.ts',
      'app/api/v1/reverse/twitter/[handle]/route.ts',
      'app/api/v1/reverse/farcaster/[username]/route.ts',
    ];
    for (const file of ROUTES) {
      const src = withoutComments(readFileSync(file, 'utf8'));
      // The select list has to carry it before the response can.
      ok(
        `${file} selects farcasterVerified`,
        /farcasterVerified: socialGraph\.farcasterVerified/.test(src)
      );
      // And the emitted object has to include it. Matched inside the farcaster
      // literal specifically, so a `verified` belonging to twitter cannot
      // satisfy this.
      const emitted = src.match(/\.farcaster = \{[\s\S]*?\n\s{4,6}\}/);
      ok(
        `${file} returns verified on the farcaster object`,
        !!emitted && /\bverified:/.test(emitted[0])
      );
    }
  }

  // ------------------------------------------------ the rail declares itself
  // A discovery index lists only what declares itself. This route carried no
  // `extensions.bazaar`, so walletlink was absent from all 14,344 resources in
  // Coinbase's index, and from payai's own, while the rail was live.
  //
  // The position of the argument is the fragile part and it fails silently:
  // `createPaymentRequiredResponse(requirements, resourceInfo, error?,
  // extensions?)`. Passed third, the block lands in `error` and is rendered to
  // the buyer as a failure string instead of being indexed, with nothing
  // erroring.
  {
    const x402Src = withoutComments(
      readFileSync('app/api/x402/buy/route.ts', 'utf8')
    );

    ok(
      'the 402 declares bazaar metadata',
      /extensions\?*:?\s*\{?[\s\S]{0,40}|BAZAAR_EXTENSIONS/.test(x402Src) &&
        /bazaar:\s*\{/.test(x402Src)
    );
    ok(
      'the bazaar block carries both info and schema',
      /bazaar:\s*\{[\s\S]*?info:\s*\{/.test(x402Src) &&
        /bazaar:\s*\{[\s\S]*?schema:\s*\{/.test(x402Src)
    );
    // Fourth position, with the error slot explicitly skipped.
    ok(
      'the extensions argument sits in the fourth position',
      /createPaymentRequiredResponse\(\s*requirements,\s*resourceInfo,\s*undefined,\s*BAZAAR_EXTENSIONS/.test(
        x402Src.replace(/\n\s*/g, ' ').replace(/\s+/g, ' ')
      )
    );
    ok(
      'the resource carries tags, the only field a discovery index can filter on',
      /tags:\s*\[/.test(x402Src)
    );
    // The endpoint reads no request body: the payment is a header. An agent
    // told otherwise pays and gets nothing, so the declaration has to say so.
    ok(
      'the declared input says the payment travels in the header',
      /PAYMENT-SIGNATURE header, not in the body/.test(x402Src)
    );
    // The finding this guard exists for. `schema` describes `info` itself and
    // closes `input` with additionalProperties: false, so a key present in
    // info.input and absent from the schema makes a validating facilitator
    // drop the resource: the exact outcome the block exists to prevent, and
    // nothing local fails. Both lists are read out of the source and compared.
    {
      const flat = x402Src.replace(/\s+/g, ' ');
      const infoInput = /input: \{ type: 'http'[^}]*\}/.exec(flat)?.[0] ?? '';
      const declared =
        /required: \['type', 'method', 'bodyType', 'body'\]/.test(flat);
      const infoKeys = ['type', 'method', 'bodyType', 'body'].filter((k) =>
        new RegExp(`\\b${k}:`).test(infoInput)
      );
      ok(
        'every info.input key is declared in the schema that closes it',
        infoKeys.length === 4 &&
          declared &&
          /input: \{ type: 'object', additionalProperties: false/.test(flat)
      );
    }
  }

  // ------------------------------------------------------ key rotation is safe
  // `rotateApiKey` does not check the cap, and that is only sound while
  // rotation is count-neutral: exactly one active key retired, exactly one
  // issued. Three filters carry that property and all three were missing.
  //
  // Without them: revoke a key once, then POST the dead id N times, and the
  // account holds N+1 active keys against a cap of 10. And rotating an OAuth
  // grant minted a row with no `oauth_grant_id`, turning a one-hour access
  // token into a permanent dashboard credential.
  {
    const keys = withoutComments(readFileSync('lib/api-keys.ts', 'utf8'));
    // Bounded at the NEXT export, not at end of file. Slicing to the end swept
    // in `listApiKeys`, which carries its own `isNull(apiKeys.oauthGrantId)`,
    // so the grant-row assertion passed on a different function's code and
    // survived deleting the filter it was written to protect. Caught by
    // mutation, which is the only reason it is written this way.
    const from = keys.indexOf('export async function rotateApiKey');
    const next = keys.indexOf('\nexport ', from + 1);
    const rotate = keys.slice(from, next === -1 ? undefined : next);
    const flat = rotate.replace(/\s+/g, ' ');

    // Matched as one clause, not as four independent probes. Probing for
    // `eq(apiKeys.isActive, true)` anywhere in the function passes on the
    // conditional revoke's copy of that same expression, so deleting it from
    // the SELECT changed nothing and the assertion still went green. Also
    // caught by mutation.
    ok(
      'the select filters on id, owner, active, not-revoked and not-a-grant',
      /\.where\( and\( eq\(apiKeys\.id, keyId\), eq\(apiKeys\.userId, userId\), eq\(apiKeys\.isActive, true\), isNull\(apiKeys\.revokedAt\), isNull\(apiKeys\.oauthGrantId\) \) \)/.test(
        flat
      )
    );
    ok(
      'rotation refuses an OAuth grant row',
      /isNull\(apiKeys\.oauthGrantId\)/.test(flat)
    );
    ok(
      'ownership is enforced in SQL, not after the select',
      /eq\(apiKeys\.userId, userId\)/.test(flat)
    );
    // The interlock against two concurrent rotations minting two keys.
    ok(
      'the revoke is conditional and its result gates the insert',
      /\.where\(and\(eq\(apiKeys\.id, keyId\), eq\(apiKeys\.isActive, true\)\)\)/.test(
        flat
      ) && /retired\.length === 0/.test(flat)
    );
    // Assert the refusal: the unconditional revoke that shipped is gone.
    ok(
      'the unconditional revoke-by-id is gone',
      !/\.set\(\{ isActive: false, revokedAt: new Date\(\), \}\) \.where\(eq\(apiKeys\.id, keyId\)\)/.test(
        flat
      )
    );
    // The id had to come from somewhere: the dashboard hides grant rows, and
    // /usage handed them over.
    const usage = withoutComments(
      readFileSync('app/api/developer/usage/route.ts', 'utf8')
    );
    ok(
      'the usage route hides OAuth grant rows, as listApiKeys does',
      /isNull\(apiKeys\.oauthGrantId\)/.test(usage)
    );
  }

  // ------------------------------------------------------- the plan ladder
  // Gap 17: a pack raises rate limits for its unexpired lifetime. The claims
  // an attacker cares about: nothing a caller SENDS can pick a plan, a plan
  // name smuggled in as a pack id ladders nowhere, and the ladder never
  // demotes a plan support raised by hand.
  {
    const { planForPacks, ladderedPlanId, CREDIT_API_PLAN } =
      await import('@/lib/api-plans');

    ok(
      'an account with no packs ladders to the default plan',
      planForPacks([]) === CREDIT_API_PLAN
    );
    ok(
      'trial and campaign stay on developer',
      planForPacks(['trial', 'campaign']) === 'developer'
    );
    ok('scale ladders to startup', planForPacks(['scale']) === 'startup');
    ok('index ladders to enterprise', planForPacks(['index']) === 'enterprise');
    ok(
      'the highest unexpired pack decides',
      planForPacks(['trial', 'scale', 'index']) === 'enterprise'
    );
    // The refusal: a string that NAMES a plan is not a pack and buys nothing.
    ok(
      'a plan name presented as a pack id ladders nowhere',
      planForPacks(['enterprise', 'startup']) === CREDIT_API_PLAN
    );
    ok(
      'the onchain and hand-grant packs ladder nowhere',
      planForPacks(['agent', 'grant']) === CREDIT_API_PLAN
    );
    ok(
      'the ladder never demotes a hand-raised plan',
      ladderedPlanId('enterprise', ['trial']) === 'enterprise' &&
        ladderedPlanId('startup', []) === 'startup'
    );
    ok(
      'the ladder raises a stored developer plan for a scale buyer',
      ladderedPlanId('developer', ['scale']) === 'startup'
    );

    // The packs feeding the ladder come from credit_lots rows this server
    // read, inside the metered branch, and never from anything in the request.
    const auth = withoutComments(readFileSync('lib/api-auth.ts', 'utf8'));
    const flat = auth.replace(/\s+/g, ' ');
    ok(
      'the served plan derives from unexpiredPackIds and the stored plan id only',
      /const packs = await unexpiredPackIds\(key\.userId\);/.test(flat) &&
        /ladderedPlanId\(plan\.id, packs\)/.test(flat)
    );
    const meteredIdx = flat.indexOf('if (!legacyTierIsUnmetered(tier)) {');
    const ladderIdx = flat.indexOf('unexpiredPackIds(key.userId)');
    ok(
      'the ladder runs inside the metered branch, so the two legacy tiers keep their stored mapping',
      meteredIdx !== -1 && ladderIdx > meteredIdx
    );

    // "An expired pack entitles nothing" is a WHERE clause, and dropping the
    // expiry condition there would hand a lapsed Scale buyer startup limits
    // forever while every mapping assertion above still passed.
    const creditsFlat = withoutComments(
      readFileSync('lib/credits.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const packFnStart = creditsFlat.indexOf(
      'export async function unexpiredPackIds'
    );
    const packFnEnd = creditsFlat.indexOf(
      'return rows.map((r) => r.pack);',
      packFnStart
    );
    const packFn =
      packFnStart === -1 || packFnEnd === -1
        ? ''
        : creditsFlat.slice(packFnStart, packFnEnd);
    ok(
      'an expired pack entitles nothing: the ladder reads only unexpired lots, for the one account',
      packFn.includes('eq(creditLots.userId, userId)') &&
        packFn.includes('gt(creditLots.expiresAt, new Date())')
    );
  }

  // -------------------------------------------------- x402 growth: quantity
  // Gap 18a. The quantity decides the amount a payment must verify against
  // and the matches a grant hands out, so a value the parser cannot stand
  // behind must never survive it, and both multiplications must come from the
  // one parsed number.
  {
    const { quantityFrom } = await import('@/lib/x402');
    const { X402_MAX_QUANTITY } = await import('@/lib/packs');

    ok('no body means one pack', quantityFrom(undefined) === 1);
    ok('an absent quantity means one pack', quantityFrom({}) === 1);
    ok(
      'a quantity over the cap is refused',
      quantityFrom({ quantity: X402_MAX_QUANTITY + 1 }) === null
    );
    ok('a zero quantity is refused', quantityFrom({ quantity: 0 }) === null);
    ok(
      'a fractional quantity is refused',
      quantityFrom({ quantity: 1.5 }) === null
    );
    ok(
      'a numeric string is refused rather than coerced',
      quantityFrom({ quantity: '5' }) === null
    );
    ok('an array body is refused', quantityFrom([{ quantity: 1 }]) === null);
    ok(
      'the cap itself is accepted',
      quantityFrom({ quantity: X402_MAX_QUANTITY }) === X402_MAX_QUANTITY
    );

    const buySrc = withoutComments(
      readFileSync('app/api/x402/buy/route.ts', 'utf8')
    );
    const flat = buySrc.replace(/\s+/g, ' ');
    ok(
      'the payment requirements demand the quantity-scaled amount',
      /const totalCents = PACK\.priceCents \* quantity;/.test(flat) &&
        /price: `\$\$\{\(totalCents \/ 100\)\.toFixed\(2\)\}`/.test(flat)
    );
    ok(
      'the grant is computed from the same quantity the requirements were built from',
      /grantPackBySettlement\( userId, 'agent', settlementId, totalCents, quantity \)/.test(
        flat
      )
    );
    // The body is read for quantity alone: declared, parsed, handed to
    // quantityFrom, and never touched again, so it cannot name an account or
    // anything else.
    const parsedBodyUses = flat.match(/parsedBody/g)?.length ?? 0;
    ok(
      'the request body is read for quantity alone',
      parsedBodyUses === 3 && /quantityFrom\(parsedBody\)/.test(flat)
    );
  }

  // ---------------------------------------------------- x402 growth: top-up
  // Gap 18b. The attacker claims: a top-up must not credit an account the
  // presented key does not prove, an OAuth token must not buy, and every
  // refusal that depends on the Authorization header happens before money
  // moves.
  {
    const buySrc = withoutComments(
      readFileSync('app/api/x402/buy/route.ts', 'utf8')
    );
    const flat = buySrc.replace(/\s+/g, ' ');

    ok(
      'the top-up account comes from the validated key row, nowhere else',
      /topUp = \{ userId: keyResult\.key\.userId, keyPrefix: keyResult\.key\.keyPrefix, \};/.test(
        flat
      )
    );
    const settleIdx = flat.indexOf('server.settlePayment');
    // Gap 18a's local half: the route itself must compare the SIGNED value
    // to the quantity-scaled price before verify/settle. The facilitator
    // enforces the same equality remotely, but with quantity in play a
    // swapped or broken facilitator URL would make that remote check the
    // only thing between a one-pack signature and a 25-pack grant. -1 is
    // less than every real index, so both positions are required to exist.
    const verifyIdx = flat.indexOf('server.verifyPayment');
    // The REFUSAL is the anchor, not the comparison: `if (false)` leaves the
    // comparison text intact while the guard it fed is gone, which is the
    // exact trap this file's docstring warns about, and the guard proved it
    // by beating the comparison-anchored first draft of this assertion.
    const localRefusalIdx = flat.indexOf('if (!signedMatches) {');
    ok(
      'the signed amount is asserted locally against the scaled price',
      localRefusalIdx !== -1 &&
        flat.includes('BigInt(String(signedValue)) === expectedValue') &&
        /expectedValue = BigInt\(totalCents\) \* BigInt\(10_000\)/.test(flat)
    );
    ok(
      'and the mismatch refusal runs before any money moves',
      verifyIdx !== -1 &&
        settleIdx !== -1 &&
        localRefusalIdx !== -1 &&
        localRefusalIdx < verifyIdx &&
        localRefusalIdx < settleIdx
    );
    const oauthIdx = flat.indexOf('looksLikeAccessToken(bearer)');
    const invalidIdx = flat.indexOf("code: 'INVALID_TOPUP_KEY'");
    ok(
      'an OAuth token is refused before any money moves',
      oauthIdx !== -1 && settleIdx !== -1 && oauthIdx < settleIdx
    );
    ok(
      'an Authorization header that is not a valid key is refused before any money moves',
      invalidIdx !== -1 && invalidIdx < settleIdx
    );
    // The refusal side of "mint NO new key": the top-up branch returns before
    // the mint, with api_key null.
    const topUpBranchStart = flat.indexOf('if (topUp) {');
    const mintIdx = flat.indexOf(
      'const created = await createApiKeyIfUnderCap'
    );
    const topUpBranch = flat.slice(topUpBranchStart, mintIdx);
    ok(
      'a top-up mints no key and says so with api_key null',
      topUpBranchStart !== -1 &&
        mintIdx !== -1 &&
        topUpBranch.includes('api_key: null') &&
        !topUpBranch.includes('createApiKeyIfUnderCap')
    );
    ok(
      'a top-up never creates a wallet account as a side effect',
      /topUp \?\? \(await getOrCreateWalletAccount\(payer\)\)/.test(flat)
    );
  }

  // --------------------------------------------------- x402 growth: loyalty
  // Gap 18c. The bonus must not be grantable by replay, and the count that
  // triggers it must be the wallet's settled history alone: bonus lots carry
  // no settlement id, so they can never count toward the next bonus.
  {
    const buySrc = withoutComments(
      readFileSync('app/api/x402/buy/route.ts', 'utf8')
    );
    const flat = buySrc.replace(/\s+/g, ' ');
    ok(
      'the loyalty bonus is unreachable by replay: it runs only when the grant actually wrote',
      /if \(granted\) \{ try \{ const settled = await countSettledPurchases\(payer\);/.test(
        flat
      )
    );
    ok(
      'the bonus fires on the milestone count and grants one pack of matches',
      /settled % X402_LOYALTY_EVERY_N === 0/.test(flat) &&
        /grantCredits\( userId, PACK\.matches,/.test(flat)
    );

    const acct = withoutComments(
      readFileSync('lib/x402-account.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'the loyalty count is keyed on settlement ids naming the paying wallet',
      /\$\{BASE_MAINNET\}:\$\{wallet\.toLowerCase\(\)\}:/.test(acct) &&
        /settlementId\} LIKE \$\{prefix \+ '%'\}/.test(acct)
    );
  }

  // -------------------------------------------------------- the free dry run
  // Gap 19. The claims: the estimate can never bill, cannot be used as a
  // weightless index scan, never returns an identity, and its zod ceiling at
  // the MCP layer cannot refuse a list the caller's real plan would accept.
  {
    const { ESTIMATE_MIN_WALLETS, MAX_PLAN_BATCH_SIZE, API_PLANS } =
      await import('@/lib/api-plans');

    ok(
      'the estimate minimum keeps its counts aggregate',
      ESTIMATE_MIN_WALLETS >= 10
    );
    ok(
      'the syntactic batch ceiling is derived from the plans, not typed',
      MAX_PLAN_BATCH_SIZE ===
        Math.max(...Object.values(API_PLANS).map((p) => p.maxBatchSize))
    );

    const est = withoutComments(
      readFileSync('app/api/v1/estimate/route.ts', 'utf8')
    );
    const flat = est.replace(/\s+/g, ' ');
    ok(
      'the estimate declares zero cost and weighs the window per submitted wallet',
      /authenticateApiRequest\(request, 0, \{ rateWeight: body\.wallets\.length, \}\)/.test(
        flat
      )
    );
    ok(
      'the minimum applies to distinct wallets, so duplicates cannot shrink the aggregate',
      /uniqueWallets\.length < ESTIMATE_MIN_WALLETS/.test(flat)
    );
    // Counts out, never rows: the response carries no per-wallet array and no
    // handle field. The note may SAY the words; no key can carry them.
    const success = flat.slice(flat.indexOf('return apiSuccess'));
    ok(
      'the estimate response carries no per-wallet rows and no identity keys',
      success.length > 0 &&
        !/results:/.test(success) &&
        !/wallets:/.test(success) &&
        !/handle:/.test(success) &&
        /in_index: inIndex/.test(success)
    );

    const mcp = withoutComments(readFileSync('app/api/mcp/route.ts', 'utf8'));
    ok(
      'the MCP resolve schema is capped at the largest plan batch, so zod cannot refuse what a plan allows',
      /const MAX_ADDRESSES = MAX_PLAN_BATCH_SIZE;/.test(mcp)
    );

    /**
     * Blocking the resources a page renders with is the one edit to
     * robots.txt that fails silently: the HTML still serves, every check
     * still passes, and Googlebot quietly judges the site on a build with no
     * stylesheet and no fonts. Search Console reports it against
     * `/_next/static/...` URLs, which look like machinery rather than pages,
     * so it reads as noise.
     *
     * Anchored on the pairing, not on either list alone. `Disallow: /_next/`
     * is correct and should stay; what must never exist is that disallow
     * WITHOUT the two allows that carve the render path back out of it.
     */
    const robotsFile = withoutComments(
      readFileSync('app/robots.txt/route.ts', 'utf8')
    );
    const blocksNext = /const DISALLOW = \[[^\]]*'\/_next\/'/.test(robotsFile);
    ok(
      'robots.txt cannot block /_next/ without allowing the resources pages render with',
      !blocksNext ||
        (/const ALLOW = \[[^\]]*'\/_next\/static'/.test(robotsFile) &&
          /const ALLOW = \[[^\]]*'\/_next\/image'/.test(robotsFile))
    );

    /**
     * Two files can serve /robots.txt and only one of them carries content
     * signals.
     *
     * `app/robots.ts` is the Next metadata convention, and its serializer
     * emits User-Agent, Allow, Disallow, Crawl-delay, Host and Sitemap and
     * nothing else. Re-adding it is the natural thing to do when someone
     * wants to change an Allow rule and finds the framework's documented way
     * of doing it, and the result either collides at build time or shadows
     * the route handler with a file that has no way to express a signal.
     */
    ok(
      'the Next metadata convention has not come back alongside the route handler',
      !existsSync('app/robots.ts')
    );

    /**
     * Absence is not denial, which makes deleting a signal the dangerous
     * edit rather than the safe one.
     *
     * Paragraph (c) of the policy this file serves says an omitted signal
     * neither grants nor restricts. So trimming `ai-train=yes` out of the
     * line does not quietly become a `no`; it withdraws the site's answer
     * and leaves a crawler free to read the silence either way. All three
     * labels are asserted present with an explicit value, and the value
     * itself is deliberately NOT asserted: changing a yes to a no is a
     * decision someone can make, and deleting the label is not.
     */
    for (const label of ['search', 'ai-input', 'ai-train']) {
      ok(
        `the ${label} content signal states a value rather than being omitted`,
        new RegExp(`CONTENT_SIGNAL = '[^']*\\b${label}=(yes|no)\\b`).test(
          robotsFile
        )
      );
    }

    /**
     * `Content-Signal` is group-scoped, like `Allow`, not standalone like
     * `Sitemap`. Emitted outside a group it attaches to whichever group
     * precedes it, or to none; Cloudflare's own robots.txt makes exactly
     * that mistake. There is one group here, so the line has to sit under
     * its `User-Agent`.
     */
    ok(
      'the content signal is emitted inside the group, under its User-Agent',
      /'User-Agent: \*',\s*`Content-Signal: \$\{CONTENT_SIGNAL\}`/.test(
        robotsFile
      )
    );

    /**
     * The signal is a token; the policy is what the token means. Shipping
     * the first without the second publishes a word nobody has agreed a
     * definition for, and drops the Article 4 reservation that is the only
     * part of this with any legal weight. Asserted on the two load-bearing
     * lines, so a paraphrase fails rather than passing quietly.
     */
    ok(
      'the machine-readable signal ships with the policy text that defines it',
      robotsFile.includes(
        '# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF RIGHTS UNDER ARTICLE 4'
      ) && robotsFile.includes('# ai-train: training or fine-tuning AI models.')
    );
  }

  // ------------------------------------------- markdown content negotiation
  // Three of the four things that can break this break it silently, in the
  // direction where every page still answers correctly to a browser and the
  // feature simply never happens. Nothing throws, no log line appears, and
  // the only way to notice is to send the header and read the content type.
  {
    const config = withoutComments(readFileSync('next.config.ts', 'utf8'));
    const handler = withoutComments(
      readFileSync('app/api/markdown/[[...path]]/route.ts', 'utf8')
    );
    const documents = withoutComments(
      readFileSync('app/api/markdown/documents.ts', 'utf8')
    );

    /**
     * The failure this shipped with for one round of testing.
     *
     * An array returned from `rewrites()` becomes `afterFiles`, which is
     * consulted only when nothing in the app answered the request. Every
     * negotiable path IS a page, so the rules compiled into the manifest with
     * the right regex and the right `has`, and never once ran. `/pricing`
     * with `Accept: text/markdown` answered `text/html` with nothing
     * anywhere to say why.
     */
    ok(
      'the negotiation rewrites run before the filesystem, where a page cannot beat them',
      /beforeFiles: \[[\s\S]*?MARKDOWN_NEGOTIABLE\.map/.test(config)
    );

    /**
     * Next compiles a `has` value as `new RegExp(`^${value}$`)`, anchored at
     * both ends (`matchHas` in
     * `next/dist/shared/lib/router/utils/prepare-destination.js`). A bare
     * `text/markdown` matches only a request whose entire Accept header is
     * those fourteen characters, which no agent and no library sends. It
     * fails closed: HTML to everybody, forever, quietly.
     *
     * Asserted on the wildcards rather than on the whole string, so tightening
     * the pattern in some other correct way is still allowed and dropping the
     * anchoring escape is not.
     */
    ok(
      'the Accept matcher allows for the rest of a real Accept header on both sides',
      /value: '\.\*text\/markdown\.\*'/.test(config)
    );

    /**
     * `/blog/:slug` matches `/blog/a-post.md` with the slug "a-post.md", so
     * the explicit markdown URL has to be claimed first. A careful client
     * sends both the `.md` path and the Accept header, and that is exactly
     * the request the wrong order 404s.
     */
    const blogMd = config.indexOf("source: '/blog/:slug.md'");
    const negotiation = config.indexOf('MARKDOWN_NEGOTIABLE.map');
    ok(
      'the explicit /blog/<slug>.md rewrite is matched before the negotiated /blog/:slug',
      blogMd !== -1 && negotiation !== -1 && blogMd < negotiation
    );

    /**
     * One list in two files. A rewrite with no branch answers 404 to a client
     * that asked politely; a branch with no rewrite is unreachable code that
     * reads like a shipped feature. Both halves are checked, so neither can
     * grow alone.
     */
    const negotiable = (
      config.match(/const MARKDOWN_NEGOTIABLE = \[([\s\S]*?)\];/)?.[1] ?? ''
    )
      .split(',')
      .map((entry) => entry.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    ok(
      'the negotiable list is read, not assumed empty by a regex that stopped matching',
      negotiable.length >= 4 && negotiable.includes('/')
    );
    for (const path of negotiable) {
      // '/' is the empty-segment branch; the rest name their first segment.
      const segment = path.split('/')[1] ?? '';
      ok(
        `the handler has a branch for the negotiable path ${path}`,
        path === '/'
          ? /segments\.length === 0/.test(handler)
          : new RegExp(`first === '${segment}'`).test(handler)
      );
    }

    /**
     * The three response headers the feature IS. A markdown body typed
     * `text/html` is not content negotiation, a missing `Vary` lets a shared
     * cache replay one client's markdown to the next person's browser, and a
     * twin with no canonical is a duplicate of the page in an index.
     */
    /**
     * Matched as one ordered block, not as three independent regexes.
     *
     * The three-regex form passed while `Vary` had been deleted from the
     * markdown response, because the 404 branch four lines below also carries
     * `Vary: 'Accept'` and satisfied the test on its own. Caught by
     * `check-invariants-guard.ts` on the first run, which is what that script
     * is for.
     */
    ok(
      'a negotiated markdown response is typed, varied and pointed at its page',
      /'Content-Type': 'text\/markdown; charset=utf-8',\s*Vary: 'Accept',\s*Link: `<\$\{doc\.canonical\}>; rel="canonical"`/.test(
        handler
      )
    );

    /**
     * Both representations of one page have to agree about whether it may be
     * indexed. The HTML report carries `robots: { index: false }` for a
     * placeholder-named collection; the twin has to carry the same refusal,
     * decided by the same predicate rather than by a second reading of the
     * name.
     */
    ok(
      'a holder report that the page noindexes is noindexed in markdown too',
      /noindex: !holderReportIsIndexable\(collection\)/.test(handler) &&
        /'X-Robots-Tag': 'noindex'/.test(handler) &&
        /return isNamed\(collection\.name\);/.test(documents)
    );

    /**
     * "Aggregates only, by rule: no wallet list, no handle list." The HTML
     * report keeps that rule by never fetching one. The twin keeps it the
     * same way, so the assertion is that the loaders which return rows are
     * not in scope here at all: `getHolderStats` and `getHolderOverlap` both
     * return counts, and nothing in this file reaches past them.
     */
    ok(
      'the holder twin publishes no wallet list and no handle list',
      !/resolveWallets|social_graph|twitter_handle|wallets\b/.test(documents)
    );

    /**
     * The listing rule is two floors, and stating one of them is worse than
     * stating neither.
     *
     * `meetsListingFloor` requires `reachable >= LISTING_MIN_REACHABLE` AND
     * `reachable >= holderCount * LISTING_MIN_RATE`. The twin said only the
     * first, which is the non-binding one on any large holder set: at the
     * import cap of 2,000 the rate floor is 100 reachable, not 20, so an
     * agent reading it learned a rule that is wrong in the direction of
     * expecting reports that will never appear. Found by Bugbot on PR #353.
     *
     * Asserted against the rendered document, because the defect is what the
     * sentence says and not which constants happen to be imported.
     */
    const { holdersIndexMarkdown } =
      await import('@/app/api/markdown/documents');
    const { LISTING_MIN_REACHABLE, LISTING_MIN_RATE } =
      await import('@/lib/holder-pages');
    const listing = holdersIndexMarkdown([]);
    ok(
      'the holders twin states both listing floors, not only the count',
      listing.includes(`${LISTING_MIN_REACHABLE} reachable holders`) &&
        listing.includes(`${Math.round(LISTING_MIN_RATE * 100)}% of the ones`)
    );

    /**
     * Asserted through the builder rather than against the filter, because
     * the defect is what comes out, not how it is spelled.
     *
     * `lib/blog.ts` types `description` as `string` and fills it with
     * `data.meta_description || ''`, so a post that never set one is `''`
     * and not nullish. A filter dropping only `null` published
     * `description: ""`: a declared field asserting the post has no
     * description, where saying nothing would have been true. Found by
     * Bugbot on PR #353.
     */
    const { blogPostMarkdown } = await import('@/app/api/markdown/documents');
    const bare = blogPostMarkdown({
      slug: 'a-post',
      title: 'A post',
      // The shape `lib/blog.ts` really produces for a post with no
      // meta_description: the empty string, never null and never absent.
      description: '',
      content: '# A post\n',
      html: '<h1>A post</h1>',
      publishedAt: '2026-01-01',
    });
    ok(
      'an unset frontmatter field is omitted rather than published as an empty value',
      !/^description:/m.test(bare) && /^title: "A post"$/m.test(bare)
    );
  }

  // ------------------------------------------------- the API catalog, RFC 9727
  // Asserted through the handler, not against its source. A regex over the
  // literal would verify that the file says what it says; calling GET and
  // parsing the bytes is the only way to know a client gets a document that
  // conforms. The shape rules below are all MUSTs in RFC 9264 section 4.2,
  // and every one of them is the kind a hand-written literal breaks while
  // still parsing as JSON.
  {
    const { GET, HEAD } = await import('@/app/api/api-catalog/route');
    const { PRODUCTION_URL, DOCS_URL } = await import('@/lib/site-url');
    const res = GET();
    const body = await res.clone().text();

    ok(
      'the catalog is served as a linkset carrying the RFC 9727 profile',
      res.headers.get('content-type') ===
        'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
    );

    /**
     * Section 2 makes this a SHALL on HEAD specifically. Next derives HEAD
     * from GET on its own, so the requirement would be met today by
     * accident; the export is what stops a framework change from quietly
     * removing it, and this is what stops the export being deleted as
     * redundant.
     */
    ok(
      'HEAD answers with the api-catalog link relation, as section 2 requires',
      typeof HEAD === 'function' &&
        /rel="api-catalog"/.test(HEAD().headers.get('link') ?? '')
    );

    const doc = JSON.parse(body) as Record<string, unknown>;
    ok(
      'linkset is the sole member of the document, as RFC 9264 requires',
      Object.keys(doc).length === 1 && Array.isArray(doc.linkset)
    );

    const contexts = doc.linkset as Record<string, unknown>[];
    ok('the catalog publishes at least one API', contexts.length > 0);

    for (const context of contexts) {
      const anchor = context.anchor;
      ok(
        'every link context object carries an absolute anchor',
        typeof anchor === 'string' && anchor.startsWith('https://')
      );

      const relations = Object.keys(context).filter((key) => key !== 'anchor');
      ok(
        `${String(anchor)} declares at least one relation`,
        relations.length > 0
      );

      for (const relation of relations) {
        /**
         * The single-element array is the trap this exists for. RFC 9264
         * section 4.2.2 requires the value of a relation member to be an
         * array "even if there is only one link target object", and two of
         * the three APIs here have exactly one target per relation. Writing
         * the object directly produces a document that parses, reads
         * correctly to a person, and is not a linkset.
         */
        const targets = context[relation];
        ok(
          `${String(anchor)} states ${relation} as an array of link targets`,
          Array.isArray(targets) && targets.length > 0
        );
        for (const target of targets as Record<string, unknown>[]) {
          /**
           * `href` is a MUST, and absolute is a SHOULD that this repo treats
           * as a MUST: a relative reference in a document a client may have
           * fetched from either origin resolves differently depending on
           * which, which is the same class of defect as publishing a URL
           * that redirects.
           */
          ok(
            `${String(anchor)} ${relation} target is an absolute href`,
            typeof target.href === 'string' &&
              target.href.startsWith('https://')
          );
          /**
           * Every host in the document is one this site controls. A typo in
           * a hand-written URL is otherwise a silent redirect of a
           * discovery client to somebody else's origin.
           */
          ok(
            `${String(anchor)} ${relation} target stays on a declared origin`,
            new URL(target.href as string).origin === PRODUCTION_URL ||
              new URL(target.href as string).origin === DOCS_URL
          );
        }
      }
    }

    /**
     * The handler is unreachable at the specified URI without this rewrite,
     * because the App Router will not route a dot-prefixed segment. Nothing
     * errors when it is missing: `/api/api-catalog` keeps answering and
     * `/.well-known/api-catalog` 404s, which is the half nobody requests
     * directly and the half every client requests.
     */
    const config = withoutComments(readFileSync('next.config.ts', 'utf8'));
    ok(
      'the catalog is reachable at the well-known URI the RFC names',
      /source: '\/\.well-known\/api-catalog',\s*destination: '\/api\/api-catalog',/.test(
        config
      )
    );

    /**
     * Section 3's other half: a client holding only the origin finds the
     * catalog by following a link from the page, not by guessing the
     * well-known path. In the markup because a `Link` response header cannot
     * survive the App Router's own on a page response.
     */
    const layout = withoutComments(readFileSync('app/layout.tsx', 'utf8'));
    ok(
      'every page points at the catalog, so it can be found without guessing',
      /<link rel="api-catalog" href="\/\.well-known\/api-catalog" \/>/.test(
        layout
      )
    );

    /**
     * The other half of section 3, for the client that never reads a body.
     *
     * Asserted by running the real `headers()` rather than by matching the
     * literal, because the thing that has to be true is what a client
     * receives: one entry scoped to `/`, carrying every relation, parsed out
     * of the value the config actually produces.
     */
    interface HeaderRule {
      source: string;
      headers: { key: string; value: string }[];
    }
    const { default: nextConfig } = await import('../next.config');
    const headerRules = (await nextConfig.headers!()) as HeaderRule[];
    /**
     * Counted across every rule matching `/`, not within one of them.
     *
     * The homepage matches two: it is in `MARKDOWN_NEGOTIABLE`, so it has a
     * `Vary: Accept` rule, and it has the `Link` rule beside it. An earlier
     * version asserted one rule per source and would have failed the moment
     * those two met, which is a guard breaking on a correct change rather
     * than on a defect.
     */
    const homepageHeaders = headerRules
      .filter((rule) => rule.source === '/')
      .flatMap((rule) => rule.headers);
    const linkHeaders = homepageHeaders.filter((h) => h.key === 'Link');
    ok(
      'the homepage declares exactly one Link header',
      linkHeaders.length === 1
    );

    const linkValue = linkHeaders[0]?.value ?? '';
    for (const relation of [
      'api-catalog',
      'describedby',
      'service-desc',
      'service-doc',
    ]) {
      ok(
        `the homepage Link header carries the ${relation} relation`,
        new RegExp(`rel="${relation}"`).test(linkValue)
      );
    }

    /**
     * The catalog link is relative on purpose, and it is the one that must
     * stay that way.
     *
     * RFC 8288 resolves a relative reference against the request URL, so
     * this names whichever host served the page. Made absolute, a preview
     * deployment would hand a discovery client production's catalog, which
     * is the same class of defect as a machine-to-machine URL that
     * redirects: it resolves, it returns 200, and it describes the wrong
     * deployment.
     */
    ok(
      'the catalog is linked relatively, so a preview names its own catalog',
      linkValue.includes('</.well-known/api-catalog>; rel="api-catalog"')
    );

    /**
     * The cross-origin links have no such choice, and a relative reference
     * there would resolve against walletlink.social and 404.
     */
    ok(
      'the docs links are absolute, since a relative one would resolve to this origin',
      new RegExp(`<${DOCS_URL}/[^>]+>; rel="service-desc"`).test(linkValue) &&
        new RegExp(`<${DOCS_URL}/[^>]+>; rel="service-doc"`).test(linkValue)
    );
  }

  // ------------------------------------------- preview builds and Neon
  // docs/CI.md promises two things at once: a preview deployment never reads
  // the database at build time, and production behaves as if the frozen
  // branch did not exist. Both die to the same mutation, the guard condition
  // drifting off the one string that is true ONLY on a preview deployment.
  // `!== 'production'` freezes local builds; a truthy test freezes
  // production, which then serves constants that age silently. So the
  // assertion is exhaustive the attacker's way: every read of the variable in
  // these files must be the exact preview equality, and each file must
  // actually carry the branch (deleting it brings the starvation back).
  {
    const surfaces = [
      'app/api/public-stats/route.ts',
      'app/api/starter-collections/route.ts',
      // app/holders/[chain]/[address]/page.tsx is deliberately absent now. It
      // used to carry the preview branch and that asymmetry is what hid an
      // eight-day production outage: previews skipped the build-time read and
      // went green while production did it and timed out. It now prerenders
      // nothing on every environment alike, asserted below.
      'lib/holder-pages.ts',
    ];
    for (const file of surfaces) {
      const src = withoutComments(readFileSync(file, 'utf8'));
      const exact = src.match(/process\.env\.VERCEL_ENV === 'preview'/g) ?? [];
      const any = src.match(/VERCEL_ENV/g) ?? [];
      ok(
        `${file}: the frozen preview branch exists (a preview build must not read Neon)`,
        exact.length >= 1
      );
      ok(
        `${file}: every VERCEL_ENV read is the exact preview equality, so neither production nor a local build can take the frozen path`,
        any.length > 0 && any.length === exact.length
      );
    }

    // The frozen public-stats answer must be the published constants, not a
    // second set of hand-typed numbers: lib/public-figures.ts is the one
    // authority, and a preview that answers from anywhere else can lie
    // without any figure check noticing.
    const stats = withoutComments(
      readFileSync('app/api/public-stats/route.ts', 'utf8')
    );
    ok(
      'the preview stats answer is derived from lib/public-figures.ts, not typed beside it',
      /from '@\/lib\/public-figures'/.test(stats) &&
        /figure\(INDEXED_WALLETS\)/.test(stats)
    );
    ok(
      'the public-stats preview branch answers before the live query can run',
      stats.indexOf("=== 'preview'") !== -1 &&
        stats.indexOf("=== 'preview'") < stats.indexOf('getDb()')
    );

    /**
     * NO build prerenders holder pages, on any environment.
     *
     * This assertion used to require the opposite: a preview branch that
     * skipped the work while production did it. That asymmetry froze
     * production for eight days from 2026-09-09. The corpus grew from 66
     * collections to 158, each page reads Neon, and the parallel build crossed
     * Next's 60 second per-page export timeout; three retries later `Export
     * encountered an error` failed the whole deployment. Every pull request
     * stayed green because previews returned [] and never did the work.
     *
     * A guard that passes on every PR and fails only after merge is worse than
     * no guard, so the rule is now symmetric: nothing prerenders, anywhere, and
     * the pages render on demand under the `revalidate` above.
     */
    const holders = withoutComments(
      readFileSync('app/holders/[chain]/[address]/page.tsx', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'holder pages prerender nothing at build time, on every environment',
      /generateStaticParams\(\) \{ return \[\]; \}/.test(holders) &&
        !/VERCEL_ENV/.test(holders)
    );
    /**
     * And the route that broke first is not force-static either. A handler
     * that reads the database and is prerendered at build is the exact shape
     * that failed, so it is refused by name rather than audited case by case.
     */
    const starterRoute = withoutComments(
      readFileSync('app/api/starter-collections/route.ts', 'utf8')
    );
    ok(
      'the database-reading route is not prerendered at build time',
      !/dynamic\s*=\s*'force-static'/.test(starterRoute) &&
        /dynamic\s*=\s*'force-dynamic'/.test(starterRoute)
    );

    // The canned starter answer stays the shape the consumer hides
    // gracefully: an empty list plus the real wallet cap, never fabricated
    // collection rows a preview visitor could mistake for the corpus.
    const starter = withoutComments(
      readFileSync('app/api/starter-collections/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'the starter-collections preview answer is the empty list with the real cap, not invented rows',
      /collections: \[\], walletCap: STARTER_WALLET_CAP/.test(starter)
    );
  }

  // ---------------------------------------- right-to-removal: trigger coverage
  // Decision 2 (2026-09-02): every table that stores an identifier naming a
  // person either carries the suppression_guard trigger or is named in the
  // documented exclusion boundary in scripts/migrate-suppression.ts. The
  // attacker here is a future schema change: a new identity-carrying table
  // added without a trigger is exactly how the removal promise silently
  // becomes false again. So the identity tables are DERIVED from db/schema.ts
  // rather than listed here, and a new one must land in one of the two lists
  // or this fails.
  {
    const schemaSrc = withoutComments(readFileSync('db/schema.ts', 'utf8'));
    const migRaw = readFileSync('scripts/migrate-suppression.ts', 'utf8');
    const migCode = withoutComments(migRaw);
    const mflat = migCode.replace(/\s+/g, ' ');

    // A column that names a person, by its sql-side name. The list mirrors
    // the migration's KINDS vocabulary in the column spellings the schema
    // uses (wallet, twitter_handle, farcaster, ens_name, lens, github), plus
    // the bare handle columns: x_accounts.handle, x_handle_attempts.handle,
    // handle_conflicts.ours/theirs. All of these are text columns, which is
    // why the parse matches text('...') declarations.
    const namesAPerson = (col: string) =>
      col === 'wallet' ||
      col === 'handle' ||
      col.endsWith('_handle') ||
      col === 'farcaster' ||
      col === 'ens_name' ||
      col === 'lens' ||
      col === 'github' ||
      col === 'ours' ||
      col === 'theirs';

    const chunks = schemaSrc.split(/export const \w+ = pgTable\(/).slice(1);
    const identityTables: string[] = [];
    let parsedTables = 0;
    for (const chunk of chunks) {
      const name = chunk.match(/'([a-z0-9_]+)'/)?.[1];
      if (!name) continue;
      parsedTables++;
      const cols = [...chunk.matchAll(/\btext\('([a-z0-9_]+)'/g)].map(
        (m) => m[1]
      );
      if (cols.some(namesAPerson)) identityTables.push(name);
    }

    // Guarded: the migration's attachment list.
    const attachBlock =
      migCode.match(
        /const ATTACHMENTS: Attachment\[\] = \[([\s\S]*?)\n\];/
      )?.[1] ?? '';
    const attached = [...attachBlock.matchAll(/table: '([a-z0-9_]+)'/g)].map(
      (m) => m[1]
    );

    // Excluded: the decision 2 boundary, which is the doc block PLUS the
    // constant it explains, parsed with its comments on purpose: the
    // account/billing and jsonb-payload carve-outs live in the prose, and
    // the point of this check is that an identity table is either guarded or
    // NAMED there, in the place the next reader will look.
    const boundaryStart = migRaw.indexOf(
      'Tables that store identifiers and deliberately do NOT get the guard'
    );
    const boundaryArr = migRaw.match(
      /const SUPPRESSION_EXCLUDED_TABLES = \[([\s\S]*?)\];/
    );
    const boundaryEnd = boundaryArr
      ? migRaw.indexOf(boundaryArr[0]) + boundaryArr[0].length
      : -1;
    const boundary =
      boundaryStart !== -1 && boundaryEnd > boundaryStart
        ? migRaw.slice(boundaryStart, boundaryEnd)
        : '';
    const excluded = new Set(
      [
        ...boundary.matchAll(/'([a-z0-9_]+)'/g),
        ...boundary.matchAll(/`([a-z0-9_]+)`/g),
      ].map((m) => m[1])
    );

    // Prove the parsers can find things, so "nothing uncovered" below cannot
    // pass by matching nothing.
    ok('the schema parser sees the whole schema', parsedTables >= 30);
    ok(
      'identity detection finds the index, the handle table and a carve-out table',
      identityTables.includes('social_graph') &&
        identityTables.includes('x_accounts') &&
        identityTables.includes('users')
    );
    ok(
      'identity detection does not match everything',
      !identityTables.includes('rate_limit_buckets') &&
        !identityTables.includes('suppressed_identifiers')
    );
    ok(
      'the attachment parse found the trigger list',
      attached.length >= 7 &&
        attached.includes('social_graph') &&
        attached.includes('known_agents')
    );
    ok(
      'the boundary parse found the documented exclusions',
      excluded.has('x_handle_attempts') &&
        excluded.has('users') &&
        !excluded.has('social_graph')
    );

    const uncovered = identityTables.filter(
      (t) => !attached.includes(t) && !excluded.has(t)
    );
    ok(
      `every identity-carrying table is guarded or named in the exclusion boundary (uncovered: ${uncovered.join(', ') || 'none'})`,
      boundary.length > 0 && uncovered.length === 0
    );
    ok(
      'no guarded table is simultaneously excluded',
      attached.every((t) => !excluded.has(t))
    );

    // BEFORE UPDATE is load-bearing, not belt-and-braces: BEFORE INSERT
    // edits are reflected in EXCLUDED, so an INSERT-only guard hands a
    // suppressed handle straight back through every
    // COALESCE(EXCLUDED.x, stored.x) upsert branch and every literal-set
    // UPDATE writer.
    ok(
      'the guard is attached BEFORE INSERT OR UPDATE, not INSERT alone',
      mflat.includes('BEFORE INSERT OR UPDATE ON ${a.table}')
    );

    // The migration checks itself the refusing way, each exiting non-zero:
    // catalog set equality (the right count on the wrong tables must fail),
    // no guard on an excluded table, and an operator-only quarantine.
    const setEqIdx = mflat.indexOf(
      'JSON.stringify(wanted) !== JSON.stringify(got)'
    );
    ok(
      'the migration verifies attachment set equality and fails non-zero',
      setEqIdx !== -1 &&
        mflat.slice(setEqIdx, setEqIdx + 400).includes('process.exit(1)')
    );
    const onExclIdx = mflat.indexOf('if (onExcluded.length > 0) {');
    ok(
      'the migration refuses a guard attached to an excluded table',
      onExclIdx !== -1 &&
        mflat.slice(onExclIdx, onExclIdx + 300).includes('process.exit(1)')
    );
    const qGrantsIdx = mflat.indexOf('if (qGrants.length > 0) {');
    ok(
      'the migration revokes the quarantine table and verifies it operator-only',
      mflat.includes('REVOKE ALL ON suppression_quarantine FROM PUBLIC') &&
        qGrantsIdx !== -1 &&
        mflat.slice(qGrantsIdx, qGrantsIdx + 300).includes('process.exit(1)')
    );
  }

  // ------------------------------------------ right-to-removal: the pre-flight
  // The trigger blocks upsertNegativeWallets, so without this filter a
  // suppressed wallet with no cached row would run the FULL external pipeline
  // on every lookup: re-collection moving from monthly to per-lookup, for
  // exactly the person who objected. The refusal is the filter that drops the
  // wallet from the work list before anything reads or resolves.
  {
    const jp = withoutComments(readFileSync('lib/job-processor.ts', 'utf8'));
    const flat = jp.replace(/\s+/g, ' ');

    const filterIdx = flat.indexOf(
      'const activeWallets = suppressedWallets.size === 0 ? walletsToProcess : walletsToProcess.filter( (w) => !suppressedWallets.has(w.toLowerCase()) );'
    );
    ok(
      'the pre-flight refusal exists: suppressed wallets are dropped from the work list',
      filterIdx !== -1
    );

    const neynarIdx = flat.indexOf('? batchFetchNeynar(');
    const web3Idx = flat.indexOf('await batchFetchWeb3Bio(');
    const negIdx = flat.indexOf(
      'await upsertNegativeWallets(negativeWallets);'
    );
    ok(
      'and it runs before the external resolvers and before the negative persist',
      filterIdx !== -1 &&
        neynarIdx !== -1 &&
        web3Idx !== -1 &&
        negIdx !== -1 &&
        filterIdx < neynarIdx &&
        filterIdx < web3Idx &&
        filterIdx < negIdx
    );

    ok(
      'every pipeline consumer takes the filtered list, never the raw one',
      flat.includes('let uncachedWallets = activeWallets;') &&
        flat.includes('await detectKnownAgents(activeWallets)') &&
        flat.includes('getSocialGraphWithQuality(activeWallets)') &&
        !flat.includes('detectKnownAgents(walletsToProcess)') &&
        !flat.includes('getSocialGraphWithQuality(walletsToProcess)')
    );

    /**
     * The X follower count is stripped AFTER the stamp that produces it.
     *
     * The mid-pipeline paid-field strip clears the priority score and the
     * Farcaster count, and it runs long before `stampReachability`, which is
     * what sets `x_followers`. Stripping there would be a no-op on a field
     * nothing has written yet, and the strip would then be undone by the stamp
     * a few hundred lines later: every free and anonymous job would carry a
     * paid figure, persisted into `lookup_history.results` and served again on
     * every reopen.
     *
     * It is asserted by position rather than presence because presence is
     * exactly what the broken version has. A strip in the wrong place looks
     * completely correct at the line, reads as the obvious companion to the
     * two beside it, and the column it fails to protect is simply populated,
     * which is indistinguishable from the feature working.
     */
    const reachStampIdx = flat.indexOf('await stampReachability(results);');
    const xStripIdx = flat.indexOf('r.x_followers = undefined;');
    const paidStripIdx = flat.indexOf('result.fc_followers = undefined;');
    ok(
      'the job strips the X follower count for a job without paid fields',
      xStripIdx !== -1 && flat.includes('if (!jobGetsPaidFields(options))')
    );
    ok(
      'and it strips it after the stamp that sets it, not with the other paid fields',
      reachStampIdx !== -1 &&
        xStripIdx !== -1 &&
        paidStripIdx !== -1 &&
        paidStripIdx < reachStampIdx &&
        reachStampIdx < xStripIdx
    );
    /**
     * One rule, read from one function. Two hand-rolled copies of
     * `paidData ?? tier` is how the mid-pipeline strip and this one come to
     * disagree, and the direction that fails is toward giving paid data away.
     */
    ok(
      'every paid-field gate reads the same entitlement helper',
      /**
       * The weight is on the SECOND clause. Exactly one place may spell
       * `paidData ?? tier`; everywhere else asks the helper. A second copy of
       * that expression is how two gates come to disagree, and the direction
       * that fails is toward giving paid data away.
       *
       * The call count was pinned at two and is now a floor. Two was the
       * number of gates that happened to exist, not a rule, and adding a
       * third legitimate one (the priority score, which must not be
       * recomputed for a free job) failed an assertion about hand-rolled
       * copies by counting correct uses of the helper.
       */
      (flat.match(/jobGetsPaidFields\(options\)/g) ?? []).length >= 2 &&
        (flat.match(/options\.paidData \?\?/g) ?? []).length === 1
    );

    ok(
      'the graph-error fallback cannot walk a suppressed wallet into the pipeline',
      flat.includes('walletsNeedingLookup.push(...activeWallets);') &&
        !flat.includes('walletsNeedingLookup.push(...walletsToProcess)')
    );

    /**
     * Every path that builds display rows stamps reachability.
     *
     * `stampReachability` exists because the feature once covered
     * `/api/lookup` and not `/api/jobs`, and its docstring concluded that a
     * path nothing fails without is a path somebody forgets, so there is now
     * one function and both paths call it. There were three.
     * `app/api/reverse/route.ts` assembles the same rows out of the graph by
     * hand and called only `stampAlsoOnX`, so a reverse lookup never showed a
     * dead-handle warning, on exactly the rows most likely to need one: a
     * handle somebody searched for is a handle somebody is about to act on.
     *
     * Asserted as a pairing rather than a presence. Both are mutate-in-place
     * stamps belonging above the same `saveLookup`, and the failure is one of
     * them being there alone, which reads as complete.
     */
    for (const stampFile of [
      'lib/job-processor.ts',
      'app/api/reverse/route.ts',
    ]) {
      const stampSrc = withoutComments(readFileSync(stampFile, 'utf8'));
      ok(
        `${stampFile} stamps reachability wherever it stamps the second account`,
        stampSrc.includes('await stampAlsoOnX(results)') &&
          stampSrc.includes('await stampReachability(results)')
      );
    }

    /**
     * A removed handle takes its follower count with it.
     *
     * Run against the real `scrubResultRow` rather than read out of the
     * source, because the claim is about what a row looks like afterwards and
     * the failure mode is a field nobody remembered to add to a delete list.
     * That is exactly how this arrived: `fc_followers` is deleted beside
     * `farcaster`, and the new X count was not deleted beside the X handle, so
     * an erased identity kept a number precise enough to name the person and
     * to prove an account had been there at all.
     *
     * The positive control is the point of the second assertion. A scrub that
     * returned an empty object would satisfy every "is gone" check here and be
     * a different bug, so the untouched row must come back intact.
     */
    {
      const { scrubResultRow, SUPPRESSION_KINDS } =
        await import('@/lib/suppression');
      const sets = new Map<string, Set<string>>();
      for (const k of SUPPRESSION_KINDS) sets.set(k, new Set());
      sets.get('twitter')!.add('removedperson');

      const row = {
        wallet: '0x1111111111111111111111111111111111111111',
        twitter_handle: 'removedperson',
        twitter_url: 'https://x.com/removedperson',
        x_followers: 12345,
        farcaster: 'someoneelse',
        fc_followers: 99,
        source: ['graph'],
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scrubbed = scrubResultRow(row as any, sets as any);
      ok(
        'a suppressed X handle takes its follower count off the row',
        scrubbed.twitter_handle === undefined &&
          scrubbed.x_followers === undefined
      );
      ok(
        'and the control: an unsuppressed row keeps its counts',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (scrubResultRow(row as any, new Map() as any) as any).x_followers ===
          12345 && scrubbed.fc_followers === 99
      );

      /**
       * And the SCORE does not keep what the row gave up.
       *
       * `priority_score` reads both follower counts, and the arithmetic is
       * invertible: the customer supplied the holdings, so
       * `reach = 10^(score / holdings) - 1` recovers the follower count of an
       * account that asked to be erased. Deleting `x_followers` while leaving
       * the score is therefore the same disclosure in a harder-to-read form,
       * and the condition that recomputed it did not fire on an X
       * suppression at all, because no X term existed when it was written.
       *
       * Checked through the real function against a real recomputation, not
       * against a magic number, so the expectation cannot drift from the
       * formula.
       */
      {
        const { calculatePriorityScore } = await import('@/lib/csv-parser');
        const scored = {
          wallet: '0x2222222222222222222222222222222222222222',
          holdings: 10,
          twitter_handle: 'removedperson',
          x_followers: 10_000,
          farcaster: 'someoneelse',
          fc_followers: 50,
          priority_score: calculatePriorityScore(10, 50, 10_000),
          source: ['graph'],
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const afterX = scrubResultRow(scored as any, sets as any) as any;
        ok(
          'suppressing an X handle takes its reach out of the priority score',
          afterX.x_followers === undefined &&
            afterX.priority_score === calculatePriorityScore(10, 50, undefined)
        );

        const fcSets = new Map<string, Set<string>>();
        for (const k of SUPPRESSION_KINDS) fcSets.set(k, new Set());
        fcSets.get('farcaster')!.add('someoneelse');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const afterFc = scrubResultRow(scored as any, fcSets as any) as any;
        ok(
          'and suppressing Farcaster keeps the X reach that survives it',
          // The other half of the same mistake: recomputing with a hardcoded
          // absence dropped an audience that was never suppressed, which is
          // not a leak but is a wrong number on a column people sort by.
          afterFc.fc_followers === undefined &&
            afterFc.x_followers === 10_000 &&
            afterFc.priority_score ===
              calculatePriorityScore(10, undefined, 10_000)
        );
      }

      /**
       * The other withholding path. A locked row is a match the free
       * allowance did not cover: the identity is stripped server-side, and a
       * follower count left behind describes the identity it withheld.
       */
      const gate = readFileSync('lib/match-gate.ts', 'utf8');
      const locked =
        gate.match(/const LOCKED_FIELDS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
      ok(
        'the locked-row field list withholds both follower counts, not just one',
        /'fc_followers'/.test(locked) && /'x_followers'/.test(locked)
      );
    }

    // A suppressed HANDLE still arrives on other wallets' rows (a live
    // resolve returns whatever the upstream maps). The chunk scrub runs
    // before any stat is counted or billed; the finalize re-reads the list
    // and scrubs once more before lookup_history is written, after the
    // twitter_also stamp that could re-import one from a resurrected
    // conflict row.
    const chunkScrubIdx = flat.indexOf(
      'results.set(wallet, scrubResultRow(result, suppression));'
    );
    const statsIdx = flat.indexOf('const twitterFound =');
    ok(
      'the chunk scrub runs before match stats are counted',
      chunkScrubIdx !== -1 && statsIdx !== -1 && chunkScrubIdx < statsIdx
    );

    const firstReadIdx = flat.indexOf('await loadSuppressionList()');
    const finalReadIdx = flat.indexOf(
      'await loadSuppressionList()',
      firstReadIdx + 1
    );
    const stampIdx = flat.indexOf('await stampAlsoOnX(results);');
    const saveIdx = flat.indexOf('await saveLookup(');
    ok(
      'the finalize re-reads the list after the stamp and scrubs before the history write',
      finalReadIdx !== -1 &&
        stampIdx !== -1 &&
        saveIdx !== -1 &&
        stampIdx < finalReadIdx &&
        finalReadIdx < saveIdx &&
        flat.includes('results[i] = scrubResultRow(results[i], suppression);')
    );

    // Billing equals what is served: after the finalize scrub the match
    // stats are recounted from the scrubbed array, or a mid-job removal is
    // billed as a match the customer never receives, and the off-by-one
    // between meta stats and rows is itself a removal oracle.
    const recountIdx = flat.indexOf(
      'anySocialFound = results.filter( (r) => r.twitter_handle || r.farcaster ).length;'
    );
    ok(
      'the finalize recomputes billing stats from the scrubbed rows',
      recountIdx !== -1 &&
        recountIdx > finalReadIdx &&
        flat.includes(
          'twitterFound = results.filter((r) => r.twitter_handle).length;'
        )
    );
  }

  // ------------------------------------------ one lookup pipeline (STA-44)
  // Until 2026-09-24 every job over ten addresses was sent to an Inngest
  // function that restated the worker's pipeline, while the cron worker
  // picked the same job up each minute with no claim. The copy drifted from
  // the worker in forty mapped places (billing, the match gate, suppression,
  // fast scans, stale graph rows) and each was found and mirrored by hand, and
  // the two raced on the job row. The worker finalized nearly every such job
  // anyway. So there is one pipeline, and the assertions below are about
  // structure, not about lines kept in step: nothing sends the job anywhere
  // else, nothing registers a second pipeline, and the one pipeline cannot run
  // a job twice at once.
  {
    /**
     * Files under the code roots that contain a pattern. `grep` exits 1 when
     * nothing matches, which here is the passing answer, not an error; any
     * other failure still throws.
     */
    const filesMatching = (pattern: string): string[] => {
      try {
        return execFileSync(
          'grep',
          [
            '-rlE',
            '--include=*.ts',
            '--include=*.tsx',
            pattern,
            'app',
            'lib',
            'inngest',
            'components',
            'src',
          ],
          { encoding: 'utf8' }
        )
          .split('\n')
          .filter(Boolean);
      } catch (e) {
        if ((e as { status?: number }).status === 1) return [];
        throw e;
      }
    };

    // The search itself has to be able to find something, or both refusals
    // below pass by matching nothing.
    ok(
      'the code search finds the worker it is meant to search',
      filesMatching('processJobChunk\\(').includes('lib/job-processor.ts')
    );

    const senders = filesMatching(
      "wallet/lookup\\.requested|inngest\\.send\\(|from '@/inngest/client'"
    ).filter((f) => f !== 'app/api/inngest/route.ts');
    ok(
      `no code sends a lookup job anywhere but the worker (${senders.join(', ') || 'none'})`,
      senders.length === 0
    );

    const registrars = filesMatching('createFunction\\(');
    const inngestRoute = withoutComments(
      readFileSync('app/api/inngest/route.ts', 'utf8')
    );
    ok(
      `nothing registers a second lookup pipeline (${registrars.join(', ') || 'none'})`,
      registrars.length === 0 &&
        /functions:\s*\[\s*\]/.test(inngestRoute) &&
        !existsSync('inngest/functions/wallet-lookup.ts')
    );

    const jobRoute = withoutComments(
      readFileSync('app/api/jobs/route.ts', 'utf8')
    );
    const v1JobRoute = withoutComments(
      readFileSync('app/api/v1/jobs/route.ts', 'utf8')
    );
    for (const [name, src] of [
      ['/api/jobs', jobRoute],
      ['/v1/jobs', v1JobRoute],
    ] as const) {
      ok(
        `${name} kicks the worker after the response for a job over the inline threshold`,
        /after\(async \(\) => \{\s*try \{\s*await processJobChunk\(jobId\);/.test(
          src
        )
      );
    }

    /**
     * The lease outlives every holder. This is the whole safety argument for
     * a lease that expires on its own: a holder is killed at its route's
     * maxDuration, it claims after its invocation starts, so a lease longer
     * than any route's duration cannot run out under a live holder. Every
     * caller is discovered rather than listed, and a caller that declares no
     * duration fails, because the platform default is not a number this file
     * can read.
     */
    const jobProcessor = await import('@/lib/job-processor');
    const { LEASE_SECONDS } = jobProcessor;
    const callers = filesMatching('processJobChunk\\(').filter(
      (f) => f !== 'lib/job-processor.ts'
    );
    ok(
      `the three known callers of processJobChunk were found (${callers.length})`,
      [
        'app/api/jobs/route.ts',
        'app/api/v1/jobs/route.ts',
        'app/api/jobs/worker/route.ts',
      ].every((f) => callers.includes(f))
    );
    let shortestRoute = Infinity;
    for (const file of callers) {
      const src = withoutComments(readFileSync(file, 'utf8'));
      const declared = src.match(/export const maxDuration = (\d+);/);
      if (declared)
        shortestRoute = Math.min(shortestRoute, Number(declared[1]));
      ok(
        `${file} dies before a lease it holds can run out (maxDuration ${declared?.[1] ?? 'undeclared'} < ${LEASE_SECONDS})`,
        file.startsWith('app/') &&
          declared !== null &&
          Number(declared[1]) < LEASE_SECONDS
      );
    }
    /**
     * The ENS deadline has to fire inside the invocation, with room left for
     * Web3Bio and finalize, or it is decoration: a slow RPC then runs the
     * slice to the platform's kill, the kill loop it was written to prevent.
     * Bounded by half the shortest route that runs a slice, and by 150 s.
     */
    const { ENS_SLICE_BUDGET_MS } = jobProcessor;
    ok(
      `the ENS deadline fires well inside the shortest route (${ENS_SLICE_BUDGET_MS} ms, routes ${shortestRoute} s)`,
      ENS_SLICE_BUDGET_MS > 0 &&
        ENS_SLICE_BUDGET_MS <= 150_000 &&
        ENS_SLICE_BUDGET_MS <= (shortestRoute * 1000) / 2
    );

    /**
     * The names the SQL uses, which nothing else pins: `db.select()` and every
     * insert name each schema column, so a schema name the migration does not
     * create fails every job path after deploy.
     */
    const { getTableColumns } = await import('drizzle-orm');
    const { lookupJobs: jobsTable } = await import('@/db/schema');
    const jobCols = getTableColumns(jobsTable);
    const leaseMigration = readFileSync('scripts/migrate-job-lease.ts', 'utf8');
    ok(
      'the lease columns in the schema are the ones the migration adds',
      jobCols.leasedUntil.name === 'leased_until' &&
        jobCols.leaseToken.name === 'lease_token' &&
        jobCols.sliceAttempts.name === 'slice_attempts' &&
        leaseMigration.includes(
          'ADD COLUMN IF NOT EXISTS leased_until timestamptz'
        ) &&
        leaseMigration.includes('ADD COLUMN IF NOT EXISTS lease_token uuid') &&
        leaseMigration.includes(
          'ADD COLUMN IF NOT EXISTS slice_attempts integer NOT NULL DEFAULT 0'
        )
    );

    /**
     * The claim is one conditional UPDATE, and it is what every holder goes
     * through. Rendered through Drizzle rather than read from the source, so
     * this reads the SQL the claim actually sends.
     */
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const dialect = new PgDialect();
    const claimSql = dialect.sqlToQuery(jobProcessor.claimable());
    const flatClaim = claimSql.sql.replace(/\s+/g, ' ').trim();
    /**
     * The whole predicate, not fragments of it. A substring check passed with
     * the top-level OR turned to AND (no job ever claimable: the queue stops)
     * and with `<= now() + interval '6 minutes'` (every live lease free: the
     * race is back), because each kept the fragment it looked for.
     *
     * Read as: a lease at or past now is free; with no lease, a `pending` job
     * is free, and a `processing` one only once its last write is a lease's
     * length old, because a holder from before leases may still be running.
     */
    const EXPECTED_CLAIMABLE = `( "lookup_jobs"."leased_until" <= now() OR ( "lookup_jobs"."leased_until" IS NULL AND ( "lookup_jobs"."status" = 'pending' OR "lookup_jobs"."updated_at" < (now() AT TIME ZONE 'UTC') - make_interval(secs => $1) ) ) )`;
    ok(
      'the claim predicate is exactly: a lease at or past now, or no lease and (pending, or processing untouched for a lease length)',
      flatClaim === EXPECTED_CLAIMABLE &&
        claimSql.params.length === 1 &&
        claimSql.params[0] === LEASE_SECONDS
    );

    const processorSrc = withoutComments(
      readFileSync('lib/job-processor.ts', 'utf8')
    );
    // One slice, claim to handback. `processJobChunk` only loops over it;
    // the loop is asserted on its own below.
    const chunkFn = processorSrc.slice(
      processorSrc.indexOf('async function processJobSlice('),
      processorSrc.indexOf('function mergeGraphRow(')
    );
    const claimAt = chunkFn.indexOf('.update(lookupJobs)');
    const claimCall = chunkFn.slice(
      claimAt,
      chunkFn.indexOf('.returning()', claimAt)
    );
    ok(
      'the first write each slice makes is the claim: this job, pending or processing, and claimable',
      // The whole WHERE, id included. Without `eq(lookupJobs.id, jobId)` the
      // UPDATE leases every claimable job and returns the first, and the
      // slice then works another customer's wallets into this job's row.
      claimAt !== -1 &&
        claimAt < chunkFn.indexOf('.select(') &&
        /\.where\(\s*and\(\s*eq\(lookupJobs\.id, jobId\),\s*inArray\(lookupJobs\.status, \['pending', 'processing'\]\),\s*claimable\(\),?\s*\)\s*\)/.test(
          claimCall
        ) &&
        claimCall.includes(
          'leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`'
        )
    );
    ok(
      'every claim mints a fresh token and counts itself as an attempt',
      claimCall.includes('leaseToken: sql`gen_random_uuid()`') &&
        claimCall.includes(
          'sliceAttempts: sql`${lookupJobs.sliceAttempts} + 1`'
        )
    );
    ok(
      'nothing marks a job processing except the claim',
      (processorSrc.match(/status: 'processing'/g) ?? []).length === 1 &&
        !/startedAt: job\.startedAt \|\| new Date\(\)/.test(processorSrc)
    );

    /**
     * Every write after the claim is fenced on the claim's token.
     *
     * The lease alone is safe only while every holder stops before it runs
     * out, and a suspended invocation can resume afterwards. Its writes then
     * landed on the job by id alone: a completed, billed job cut back to the
     * stale holder's rows, or flipped to failed by its catch. Asserted as:
     * one fenced writer, rendered exactly; nothing else updates the table;
     * a write that matches nothing stops the holder; and the catch never
     * writes over a job it lost.
     */
    const ownedSql = dialect.sqlToQuery(jobProcessor.owned('j', 't'));
    ok(
      "a write after the claim matches this job, this claim's token and a running status, all three",
      ownedSql.sql.replace(/\s+/g, ' ').trim() ===
        '("lookup_jobs"."id" = $1 and "lookup_jobs"."lease_token" = $2 and "lookup_jobs"."status" = $3)' &&
        JSON.stringify(ownedSql.params) ===
          JSON.stringify(['j', 't', 'processing'])
    );
    const writerFn = processorSrc.slice(
      processorSrc.indexOf('async function writeOwned('),
      processorSrc.indexOf('async function renewLease(')
    );
    ok(
      'the one fenced writer matches on the token and stops the holder when nothing matched',
      writerFn.includes('.where(owned(job.id, job.leaseToken!))') &&
        writerFn.includes('.returning(') &&
        /if \(rows\.length === 0\) throw new LeaseLostError\(job\.id\);/.test(
          writerFn
        )
    );
    ok(
      'nothing writes a job except the claim and the fenced writer, raw SQL included',
      (processorSrc.match(/\.update\(lookupJobs\)/g) ?? []).length === 2 &&
        !/UPDATE\s+lookup_jobs/i.test(processorSrc) &&
        !/INSERT\s+INTO\s+lookup_jobs/i.test(processorSrc)
    );
    /**
     * The two helpers every fenced write goes through, pinned whole. A
     * renewal that rotated the token, handed the lease back, or was not
     * awaited all read as "a renewal" to a substring check, and each one
     * either fails every job after its charge or lets a holder that lost the
     * job charge, save and write the graph anyway.
     */
    const flatFn = (start: string, end: string): string =>
      processorSrc
        .slice(processorSrc.indexOf(start), processorSrc.indexOf(end))
        .replace(/\s+/g, ' ')
        .trim();
    ok(
      'a renewal extends this claim, under the same token, and is awaited',
      flatFn(
        'async function renewLease(',
        'export function completionStateQuery('
      ) ===
        "async function renewLease( db: any, job: Pick<LookupJob, 'id' | 'leaseToken'> ): Promise<void> { await writeOwned(db, job, { leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`, }); }"
    );
    ok(
      'a stage write is a fenced write and nothing else',
      flatFn(
        'async function updateJobStage(',
        'async function finalizeJob('
      ) ===
        "async function updateJobStage( db: any, job: Pick<LookupJob, 'id' | 'leaseToken'>, stage: string ) { await writeOwned(db, job, { currentStage: stage, updatedAt: new Date() }); }"
    );
    const catchAt = chunkFn.lastIndexOf('} catch (error) {');
    const catchBody = chunkFn.slice(catchAt);
    ok(
      'a holder that lost the job stops without writing, and never marks it failed',
      catchAt !== -1 &&
        catchBody.indexOf('if (error instanceof LeaseLostError) {') !== -1 &&
        catchBody.indexOf('if (error instanceof LeaseLostError) {') <
          catchBody.indexOf('writeOwned(') &&
        /catch \(writeError\) \{\s*if \(!\(writeError instanceof LeaseLostError\)\) throw writeError;/.test(
          catchBody
        )
    );
    const finalizeFn = processorSrc.slice(
      processorSrc.indexOf('async function finalizeJobWithResults('),
      processorSrc.indexOf('export async function createJob(')
    );
    /**
     * Each side effect that must not run twice is immediately preceded by a
     * fenced write that re-asserts the claim, as a statement of its own. A
     * substring check passed a renewal made conditional (`if (...) await
     * renewLease(...)`), which lets a stale holder charge or save anyway.
     *
     * Before the charge that write is the save of the finished rows, so a
     * job billed and then killed is found complete by the next claim.
     */
    ok(
      'the finished rows are saved, and the claim extended, immediately before the charge',
      /\n  await writeOwned\(db, job, \{\s*processedCount: job\.wallets\.length,\s*partialResults: results,\s*twitterFound,\s*farcasterFound,\s*anySocialFound,\s*cacheHits,\s*updatedAt: new Date\(\),\s*sliceAttempts: 0,\s*leasedUntil: sql`now\(\) \+ make_interval\(secs => \$\{LEASE_SECONDS\}\)`,\s*\}\);\s*(?:\/\*\*[\s\S]*?\*\/\s*)?if \(\s*options\.meteredUserId &&\s*\(await isAccountFrozen\(options\.meteredUserId\)\)\s*\) \{\s*frozenAccount = true;\s*\}\s*if \(options\.meteredUserId\) \{\s*try \{\s*const charge = await chargeForJob\(/.test(
        finalizeFn
      )
    );
    ok(
      'finalize re-asserts the claim immediately before saving history and before writing the graph, unconditionally',
      /\n  if \(options\.saveToHistory\) \{\s*await renewLease\(db, job\);\s*try \{\s*const lookupId = await saveLookup\(/.test(
        finalizeFn
      ) &&
        /\n  if \(positiveResults\.length > 0\) \{\s*await renewLease\(db, job\);\s*const writeResult = await upsertSocialGraphWithRetry\(/.test(
          finalizeFn
        ) &&
        (finalizeFn.match(/renewLease\(/g) ?? []).length === 2 &&
        (finalizeFn.match(/chargeForJob\(/g) ?? []).length === 1 &&
        (finalizeFn.match(/saveLookup\(/g) ?? []).length === 1 &&
        (finalizeFn.match(/upsertSocialGraphWithRetry\(/g) ?? []).length === 1
    );

    /**
     * A job whose charge has landed is never failed with "submit the list
     * again": the debit would stand, and the resubmission is a new job,
     * charged again. The cap and the failure path both ask what stands behind
     * the job first.
     *
     * Asserted on the SQL the question actually sends, rendered through the
     * production driver. The first version read correctly as source and never
     * matched: Drizzle rendered `${creditLedger.jobId} = ${lookupJobs.id}`
     * unqualified inside a single-table select, so the subquery compared
     * credit_ledger's own columns. The job id is now a bound parameter.
     */
    const { neon: neonHttp } = await import('@neondatabase/serverless');
    const { drizzle: drizzleHttp } = await import('drizzle-orm/neon-http');
    const dbSchema = await import('@/db/schema');
    // Renders only; nothing is sent to this address.
    const renderDb = drizzleHttp(
      neonHttp('postgresql://render:only@ep-render.invalid/db'),
      { schema: dbSchema }
    );
    const stateSql = jobProcessor.completionStateQuery(renderDb, 'J').toSQL();
    ok(
      'the billed-or-saved question binds the job id and reads the ledger the way chargeForJob writes it',
      stateSql.sql ===
        `select "processed_count" >= jsonb_array_length("wallets"), exists (select 1 from credit_ledger cl where cl.job_id = $1::uuid and cl.paid_from <> 'unlock') from "lookup_jobs" where "lookup_jobs"."id" = $2 limit $3` &&
        JSON.stringify(stateSql.params) === JSON.stringify(['J', 'J', 1]) &&
        // The key chargeForJob reads its own duplicate back by.
        /and\(eq\(creditLedger\.jobId, jobId\), ne\(creditLedger\.paidFrom, 'unlock'\)\)/.test(
          readFileSync('lib/credits.ts', 'utf8')
        )
    );
    const { BILLED_STOPPED } = jobProcessor;
    ok(
      'a billed job stopped at the cap is told to contact support, never to submit again',
      BILLED_STOPPED.includes('help@walletlink.social') &&
        !/submit/i.test(BILLED_STOPPED)
    );
    ok(
      'past the cap a saved job is finished, a billed one stops with the support answer and a log line, and only an unbilled one is told to submit again',
      /if \(job\.sliceAttempts > MAX_SLICE_ATTEMPTS\) \{\s*const \{ saved, billed \} = await completionState\(db, job\.id\);\s*if \(!saved\) \{\s*const message = billed \? BILLED_STOPPED : SLICES_EXHAUSTED;\s*if \(billed\) \{\s*console\.error\(/.test(
        chunkFn
      ) &&
        /await writeOwned\(db, job, \{\s*status: 'failed',\s*errorMessage: message,/.test(
          chunkFn
        )
    );
    ok(
      'the failure path hands a saved or billed job back rather than failing it, and reports the error, so the slice loop waits for the cron',
      /const \{ saved, billed \} = await completionState\(db, job\.id\);\s*if \(saved \|\| billed\) \{\s*await writeOwned\(db, job, \{\s*updatedAt: new Date\(\),\s*leasedUntil: sql`now\(\)`,\s*\}\);\s*return \{\s*completed: false,\s*processedCount: job\.processedCount,\s*twitterFound: job\.twitterFound,\s*farcasterFound: job\.farcasterFound,\s*anySocialFound: job\.anySocialFound,\s*cacheHits: job\.cacheHits,\s*error: error instanceof Error \? error\.message : 'Unknown error',\s*\};/.test(
        catchBody
      ) &&
        catchBody.indexOf('await completionState(db, job.id)') <
          catchBody.indexOf("status: 'failed',")
    );

    /**
     * And history is saved once per job however many times finalize runs:
     * every job's save carries its id, a second pass only brings the stored
     * gate in line with its own (and never clears one), and `history_saved`
     * counts only a row that was created. The save is also fenced on the
     * claim in the same statement: `renewLease` before it is a check, and an
     * admin rerun could reset the job and detach its old copy between that
     * check and a plain insert, leaving the stale holder's row linked and the
     * rerun able to correct only its gate (Bugbot on #393). Rendered exactly.
     */
    const historySrc = withoutComments(readFileSync('lib/history.ts', 'utf8'));
    const { historyInsertForJob } = await import('@/lib/history');
    const historyQuery = dialect.sqlToQuery(
      historyInsertForJob(
        {
          name: null,
          userId: null,
          walletCount: 0,
          twitterFound: 0,
          farcasterFound: 0,
          results: [],
          inputSource: null,
          jobId: 'J',
          matchesDelivered: 4,
        },
        'T'
      )
    );
    ok(
      "a job's lookup is saved to history once, only while the saver holds the job, and a later pass corrects only its gate",
      historyQuery.sql.replace(/\s+/g, ' ') ===
        "INSERT INTO lookup_history (name, user_id, wallet_count, twitter_found, farcaster_found, results, input_source, job_id, matches_delivered) SELECT $1::text, $2::text, $3::int, $4::int, $5::int, $6::jsonb, $7::text, $8::uuid, $9::int WHERE EXISTS (SELECT 1 FROM lookup_jobs WHERE id = $10::uuid AND lease_token = $11::uuid AND status = 'processing' FOR SHARE) ON CONFLICT (job_id) DO UPDATE SET matches_delivered = excluded.matches_delivered WHERE excluded.matches_delivered IS NOT NULL AND lookup_history.matches_delivered IS DISTINCT FROM excluded.matches_delivered RETURNING id, (xmax = 0) AS inserted" &&
        JSON.stringify(historyQuery.params) ===
          JSON.stringify([null, null, 0, 0, 0, '[]', null, 'J', 4, 'J', 'T']) &&
        /saveLookup\(\s*results,\s*options\.historyName,\s*options\.userId \|\| job\.userId \|\| undefined,\s*options\.inputSource,\s*\{ jobId: job\.id, matchesDelivered, leaseToken: job\.leaseToken! \}\s*\)/.test(
          finalizeFn
        ) &&
        /if \(row\) return row\.inserted \? row\.id : null;/.test(historySrc) &&
        /if \(lookupId\) \{\s*trackEvent\('history_saved'/.test(finalizeFn) &&
        leaseMigration.includes(
          'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS lookup_history_job_id_key ON lookup_history (job_id)'
        ) &&
        leaseMigration.includes('i.indisvalid AS valid')
    );
    ok(
      'a fenced history save that wrote nothing stops a holder that lost the job, and the worker lets it',
      // No row back means the fence refused or the gate already agreed. The
      // lease is read again to tell them apart, and a lost one is raised,
      // not logged: the history catch rethrows it so the holder stops.
      /eq\(lookupJobs\.id, gate\.jobId\),\s*eq\(lookupJobs\.leaseToken, gate\.leaseToken\),\s*eq\(lookupJobs\.status, 'processing'\)[\s\S]{0,80}?\.limit\(1\);\s*if \(!held\) throw new LeaseLostError\(gate\.jobId\);\s*return null;/.test(
        historySrc
      ) &&
        /\} catch \(error\) \{\s*if \(error instanceof LeaseLostError\) throw error;\s*console\.error\('History save error:', error\);/.test(
          finalizeFn
        )
    );

    /**
     * An admin rerun saves a fresh history row: the previous run's copy is
     * detached from the job, or the unique job id would keep the old results
     * as the only saved copy. After the reset, not before: the fenced save
     * locks the job row until it commits, so the reset waits out any save
     * the old attempt has in flight, and the detach then sees its row.
     */
    const adminJobsRaw = withoutComments(
      readFileSync('app/api/admin/jobs/route.ts', 'utf8')
    );
    const detachAt = adminJobsRaw.search(
      /\.update\(lookupHistory\)\s*\.set\(\{ jobId: null \}\)\s*\.where\(eq\(lookupHistory\.jobId, id\)\);/
    );
    const cancelAt = adminJobsRaw.indexOf("action === 'cancel'");
    ok(
      'an admin rerun detaches the previous saved lookup after it resets the job',
      detachAt !== -1 &&
        detachAt > adminJobsRaw.indexOf("status: 'pending',") &&
        (cancelAt === -1 || detachAt < cancelAt)
    );

    /**
     * Every exit hands the lease back as now, never NULL, and resets the
     * attempt count. A slice that kept the lease would hide the job for five
     * and a half minutes after every slice; a NULL on a `processing` row reads
     * as a pre-lease holder and is waited out for as long; an exit that kept
     * the count would carry kills over into the next run, and an admin rerun
     * of an exhausted job would fail again at once.
     */
    const exitWrite = (marker: string): string => {
      const at = processorSrc.indexOf(marker);
      if (at === -1) return '';
      const open = processorSrc.lastIndexOf('writeOwned(db, job, {', at);
      const close = processorSrc.indexOf('});', at);
      if (open === -1 || close === -1) return '';
      const call = processorSrc.slice(open, close);
      // The marker must sit inside this call, not after an earlier one.
      return call.includes('});') ? '' : call;
    };
    for (const [exit, marker] of [
      ['a slice that saves progress', 'partialResults: allResults,'],
      ['a job that fails', 'retryCount: job.retryCount + 1,'],
      ['a job that used up its attempts', 'errorMessage: message,'],
      ['a job that completes', "status: 'completed',"],
    ] as const) {
      const call = exitWrite(marker);
      ok(
        `${exit} hands the lease back and resets its attempts`,
        call.includes('leasedUntil: sql`now()`') &&
          call.includes('sliceAttempts: 0,')
      );
    }
    ok(
      'no exit releases the lease to NULL',
      !/leasedUntil:\s*null/.test(processorSrc)
    );
    /**
     * The admin's retry, rerun and cancel are exits too. A retry that kept
     * the count failed a job killed five times at its first claim, before any
     * work; one that kept the lease made the rerun wait out a dead holder.
     * NULL is right here, not now(): a `pending` row with no lease is
     * claimable at once, and a running holder is fenced out by the token.
     */
    const adminJobs = withoutComments(
      readFileSync('app/api/admin/jobs/route.ts', 'utf8')
    );
    const adminSet = (marker: string): string => {
      const at = adminJobs.indexOf(marker);
      if (at === -1) return '';
      const open = adminJobs.lastIndexOf('.set({', at);
      const close = adminJobs.indexOf('})', at);
      const block =
        open === -1 || close === -1 ? '' : adminJobs.slice(open, close);
      return block.includes('.set({', 1) ? '' : block;
    };
    for (const [exit, marker] of [
      ['an admin retry or rerun', "status: 'pending',"],
      ['an admin cancel', "errorMessage: 'Cancelled by admin',"],
    ] as const) {
      const block = adminSet(marker);
      ok(
        `${exit} resets the attempts and clears the lease and its token`,
        block.includes('sliceAttempts: 0,') &&
          block.includes('leasedUntil: null,') &&
          block.includes('leaseToken: null,')
      );
    }

    /**
     * A slice the platform kills never hands back, so it would be retaken
     * for as long as the upstream stays slow. Kills in a row shrink the slice
     * and then fail the job. Through the real functions and constants.
     */
    const { sliceSizeFor, MAX_SLICE_ATTEMPTS, SLICES_EXHAUSTED } = jobProcessor;
    const sizes = [1, 2, 3, 4, 5, 6, 50].map(sliceSizeFor);
    ok(
      `each killed attempt halves the next slice, to an eighth and never to nothing (${sizes.join(', ')})`,
      JSON.stringify(sizes) ===
        JSON.stringify([3000, 1500, 750, 375, 375, 375, 375])
    );
    ok(
      `a job fails after a handful of kills in a row, not never (${MAX_SLICE_ATTEMPTS})`,
      MAX_SLICE_ATTEMPTS >= 3 &&
        MAX_SLICE_ATTEMPTS <= 6 &&
        /Submit the list again\./.test(SLICES_EXHAUSTED)
    );
    /**
     * "Saved" has one meaning: every row is there to finalize from. The cap
     * reads it from the row, so a restart that `resumeFromSavedPrefix`
     * decided in memory is written to the row first, fenced, before the cap
     * or the failure path can read it. Otherwise an Inngest-shaped leftover
     * (a full count, no rows) reads as saved at the cap, falls through, and
     * starts the list again on every claim without bound (Bugbot on #393).
     */
    ok(
      'a restart is persisted before the cap reads the row, and the cap comes right after it',
      /try \{\s*if \(job !== claimed\) \{\s*await writeOwned\(db, job, \{\s*processedCount: 0,\s*partialResults: null,\s*twitterFound: 0,\s*farcasterFound: 0,\s*anySocialFound: 0,\s*cacheHits: 0,\s*updatedAt: new Date\(\),\s*\}\);\s*\}\s*if \(job\.sliceAttempts > MAX_SLICE_ATTEMPTS\) \{\s*const \{ saved, billed \} = await completionState\(db, job\.id\);/.test(
        chunkFn
      )
    );
    ok(
      'the attempt cap is checked on every claim before any work, and the slice is sized by the attempt count',
      chunkFn.indexOf('if (job.sliceAttempts > MAX_SLICE_ATTEMPTS) {') !== -1 &&
        chunkFn.indexOf('if (job.sliceAttempts > MAX_SLICE_ATTEMPTS) {') <
          chunkFn.indexOf('const options = job.options as JobOptions;') &&
        /startIndex \+ sliceSizeFor\(job\.sliceAttempts\)/.test(chunkFn) &&
        !/startIndex \+ CHUNK_SIZE/.test(chunkFn)
    );

    /**
     * ENS stops starting batches at a deadline, and what it never reached is
     * recorded as failed, so it is neither cached as empty nor stored as a
     * negative. Through the real helper; no network.
     */
    const { ensPastDeadline } = await import('@/lib/ens');
    const unreached = new Set<string>();
    const notYet =
      !ensPastDeadline(undefined, ['0xAa'], unreached) &&
      !ensPastDeadline(Date.now() + 60_000, ['0xAa'], unreached) &&
      unreached.size === 0;
    const past = ensPastDeadline(Date.now() - 1, ['0xAa', '0xBb'], unreached);
    ok(
      'past its deadline ENS stops, and records every wallet it did not reach, lowercased',
      notYet && past && unreached.has('0xaa') && unreached.has('0xbb')
    );
    const ensFlat = withoutComments(readFileSync('lib/ens.ts', 'utf8')).replace(
      /\s+/g,
      ' '
    );
    ok(
      'both ENS phases check the deadline before every batch',
      ensFlat.includes(
        'for (let i = 0; i < wallets.length; i += batchSize) { if (ensPastDeadline(opts?.deadline, wallets.slice(i), opts?.failedWallets)) break;'
      ) &&
        ensFlat.includes(
          'for (let i = 0; i < walletsWithENS.length; i += batchSize) { if ( ensPastDeadline( opts?.deadline, walletsWithENS.slice(i).map(([wallet]) => wallet), opts?.failedWallets ) ) break;'
        )
    );
    ok(
      'the worker gives ENS a deadline and its failed-wallet set, and every wallet ENS left is failed, before anything is cached or stored as a negative',
      /const ensDeadline = ensDeadlineFor\(sliceStartedAt, invocationDeadline\);\s*const ensUnreached = new Set<string>\(\);/.test(
        chunkFn
      ) &&
        processorSrc
          .replace(/\s+/g, ' ')
          .includes(
            'batchLookupENS(uncachedWallets, undefined, undefined, undefined, { deadline: ensDeadline, failedWallets: ensUnreached, })'
          ) &&
        /for \(const wallet of ensUnreached\) \{\s*apiFailedWallets\.add\(wallet\);\s*if \(ensDeadline === invocationDeadline\) cutShort\.add\(wallet\);\s*\}/.test(
          chunkFn
        ) &&
        chunkFn.indexOf('for (const wallet of ensUnreached)') >
          chunkFn.indexOf(
            'const [ensResults, neynarResults] = await Promise.all('
          ) &&
        chunkFn.indexOf('for (const wallet of ensUnreached)') <
          chunkFn.indexOf('const walletsToCache') &&
        chunkFn.indexOf('for (const wallet of ensUnreached)') <
          chunkFn.indexOf('await upsertNegativeWallets(negativeWallets);')
    );

    /**
     * One invocation keeps taking slices of a job while its budget lasts. It
     * took one and left the rest to the cron, one slice a tick, so a
     * 10,000-address fast scan, whose slices each take seconds, took four
     * ticks: about four minutes for what the docs say comes back in seconds.
     *
     * The budget ends a minute inside the shortest route that runs a slice,
     * for what still runs after it (a request a source has in flight, the
     * save, finalize, the route's own work before the loop), and so under the
     * lease. It holds a whole ENS budget twice over, so the first slice's ENS
     * pass is never cut by it and still leaves Web3Bio its room.
     */
    const { INVOCATION_BUDGET_MS, runSlices, ensDeadlineFor } = jobProcessor;
    ok(
      `the invocation budget ends a minute inside the shortest route, under the lease, with room for two ENS budgets (${INVOCATION_BUDGET_MS} ms, routes ${shortestRoute} s, lease ${LEASE_SECONDS} s)`,
      INVOCATION_BUDGET_MS > 0 &&
        INVOCATION_BUDGET_MS <= shortestRoute * 1000 - 60_000 &&
        INVOCATION_BUDGET_MS < LEASE_SECONDS * 1000 &&
        INVOCATION_BUDGET_MS >= 2 * ENS_SLICE_BUDGET_MS
    );

    /**
     * The loop, through the real function on a fake clock. Each fake slice
     * advances the clock by its duration and reports progress, as a slice
     * that saved does, unless told otherwise.
     */
    type SliceResult = Awaited<ReturnType<typeof runSlices>>;
    const T0 = 1_000_000;
    const driveSlices = async (
      budgetMs: number,
      plan: (n: number) => { ms: number; result?: Partial<SliceResult> }
    ) => {
      let clock = T0;
      const deadlines: number[] = [];
      let taken = 0;
      const last = await runSlices(
        async (deadline) => {
          deadlines.push(deadline);
          taken++;
          // A loop that would never stop is ended here, so a broken one
          // fails the counts below instead of hanging this script.
          if (taken > 100) {
            return {
              completed: true,
              processedCount: 0,
              twitterFound: 0,
              farcasterFound: 0,
              anySocialFound: 0,
              cacheHits: 0,
            };
          }
          const step = plan(taken);
          clock += step.ms;
          return {
            completed: false,
            processedCount: 3000 * taken,
            twitterFound: 0,
            farcasterFound: 0,
            anySocialFound: 0,
            cacheHits: 0,
            ...step.result,
          };
        },
        budgetMs,
        () => clock
      );
      return { taken, deadlines, last, clock };
    };
    const steady = await driveSlices(INVOCATION_BUDGET_MS, () => ({
      ms: 50_000,
    }));
    ok(
      `with 50-second slices the loop takes every slice that fits the budget and none it expects to overrun it (${steady.taken} taken, ended at ${(steady.clock - T0) / 1000} s)`,
      steady.taken === Math.floor(INVOCATION_BUDGET_MS / 50_000) &&
        steady.clock - T0 <= INVOCATION_BUDGET_MS &&
        steady.clock - T0 + 50_000 > INVOCATION_BUDGET_MS &&
        !steady.last.completed
    );
    ok(
      'every slice is given the same deadline: the invocation start plus the budget',
      steady.deadlines.length === steady.taken &&
        steady.deadlines.every((d) => d === T0 + INVOCATION_BUDGET_MS)
    );
    const fastScan = await driveSlices(INVOCATION_BUDGET_MS, (n) => ({
      ms: 5_000,
      result:
        n * 3000 >= 10_000
          ? { completed: true, processedCount: 10_000 }
          : undefined,
    }));
    ok(
      `a 10,000-address job whose slices take seconds finishes in the one invocation (${fastScan.taken} slices)`,
      fastScan.taken === 4 && fastScan.last.completed
    );
    const busy = await driveSlices(INVOCATION_BUDGET_MS, () => ({
      ms: 10,
      result: { busy: true },
    }));
    ok(
      'a slice that finds the job held, or loses it, ends the loop: no spinning on refused claims',
      busy.taken === 1 && busy.last.busy === true
    );
    const erred = await driveSlices(INVOCATION_BUDGET_MS, (n) => ({
      ms: 10,
      result: n === 2 ? { error: 'upstream exploded' } : undefined,
    }));
    ok(
      'a slice that ends in an error, even one handed back unfailed, ends the loop',
      erred.taken === 2 && erred.last.error === 'upstream exploded'
    );
    const stuck = await driveSlices(INVOCATION_BUDGET_MS, () => ({
      ms: 10,
      result: { processedCount: 3000 },
    }));
    ok('a slice that saved no progress ends the loop', stuck.taken === 2);
    const overlong = await driveSlices(INVOCATION_BUDGET_MS, () => ({
      ms: INVOCATION_BUDGET_MS + 1,
    }));
    ok(
      'the first slice always runs, and one that outran the budget is the last',
      overlong.taken === 1
    );
    /**
     * The estimate is the last slice's time scaled to the next slice's size.
     * A slice halved after a kill (1,500) is followed by a full one (3,000)
     * on the next claim, which takes about twice as long; gated on the
     * halved slice's time, it started with half the time it needed. And the
     * last, shorter piece of a list is not held back by a full slice's time.
     */
    const halved = await driveSlices(INVOCATION_BUDGET_MS, () => ({
      ms: INVOCATION_BUDGET_MS * 0.4,
      result: { sliceSize: 1500, nextSliceSize: 3000 },
    }));
    const tail = await driveSlices(INVOCATION_BUDGET_MS, (n) => ({
      ms: INVOCATION_BUDGET_MS * 0.375,
      result:
        n === 3
          ? { completed: true, processedCount: 7000 }
          : { sliceSize: 3000, nextSliceSize: n === 2 ? 1000 : 3000 },
    }));
    ok(
      `the estimate scales the last slice's time to the next slice's size (a halved slice then a full one: ${halved.taken} taken; two full then a third-size tail: ${tail.taken} taken)`,
      halved.taken === 1 && tail.taken === 3 && tail.last.completed
    );
    /**
     * Every drive above injects its clock, so the default is pinned here.
     * The slice and its sources compare the deadline the loop hands them
     * against Date.now(): on any other epoch (performance.now(), say) it
     * lands in 1970, ENS and Web3Bio stop before their first batch with every
     * wallet unreached, and the loop itself still looks healthy.
     */
    let wallDeadline = 0;
    const wallBefore = Date.now();
    await runSlices(async (deadline) => {
      wallDeadline = deadline;
      return {
        completed: true,
        processedCount: 0,
        twitterFound: 0,
        farcasterFound: 0,
        anySocialFound: 0,
        cacheHits: 0,
      };
    }, INVOCATION_BUDGET_MS);
    const wallAfter = Date.now();
    ok(
      `on its default clock the loop hands a slice a wall-clock deadline, the budget from now (${new Date(wallDeadline).toISOString()})`,
      wallDeadline >= wallBefore + INVOCATION_BUDGET_MS &&
        wallDeadline <= wallAfter + INVOCATION_BUDGET_MS
    );

    /**
     * ENS in a slice is bounded by both clocks. From the slice's own claim,
     * or a later slice would start with its ENS time spent and record every
     * wallet unreached; and never past the invocation's deadline, or a slice
     * the loop started late would read ENS into the platform's kill.
     */
    const firstEns = ensDeadlineFor(T0, T0 + INVOCATION_BUDGET_MS);
    const laterEns = ensDeadlineFor(T0 + 100_000, T0 + INVOCATION_BUDGET_MS);
    const lateEns = ensDeadlineFor(T0 + 200_000, T0 + INVOCATION_BUDGET_MS);
    ok(
      `a slice's ENS budget runs from its own claim and stops at the invocation's deadline (${[firstEns, laterEns, lateEns].map((d) => (d - T0) / 1000).join(', ')} s)`,
      firstEns === T0 + ENS_SLICE_BUDGET_MS &&
        laterEns ===
          Math.min(
            T0 + 100_000 + ENS_SLICE_BUDGET_MS,
            T0 + INVOCATION_BUDGET_MS
          ) &&
        lateEns === T0 + INVOCATION_BUDGET_MS &&
        laterEns > firstEns
    );
    const { waveDeadline } = await import('@/lib/web3bio');
    ok(
      "Web3Bio stops starting waves at its own ceiling or the caller's deadline, whichever is first",
      waveDeadline(T0, 3000) === T0 + batchDeadlineMs(3000) &&
        waveDeadline(T0, 3000, T0 + 10_000) === T0 + 10_000 &&
        waveDeadline(T0, 3000, T0 + 10_000_000) === T0 + batchDeadlineMs(3000)
    );
    const web3bioSrc = withoutComments(readFileSync('lib/web3bio.ts', 'utf8'));
    ok(
      "a slice gives every deadline-bound source the invocation's deadline, and Web3Bio uses it",
      /const deadline = waveDeadline\(startTime, wallets\.length, opts\?\.deadline\);/.test(
        web3bioSrc
      ) &&
        /batchFetchWeb3Bio\(\s*walletsNeedingWeb3Bio,\s*undefined,\s*undefined,\s*\{\s*failedWallets: apiFailedWallets,\s*deadline: invocationDeadline,\s*cutShort,\s*\}\s*\)/.test(
          chunkFn
        )
    );

    /**
     * What the invocation's deadline cut short is never saved as done.
     *
     * The review of #397: a slice the loop started late, slower than the one
     * before it, lost the tail of its Web3Bio pass to the deadline while
     * every upstream was healthy, and the slice still saved its whole list
     * as processed. Those wallets finished as plain misses, never asked. So
     * the sources say which wallets the caller's deadline (not their own
     * ceiling) kept them from, and the slice saves only up to the first.
     */
    const { cutByCaller } = await import('@/lib/web3bio');
    ok(
      "Web3Bio calls a wallet cut short only when the caller's deadline came before its own ceiling",
      cutByCaller(T0, 3000, T0 + 10_000) &&
        !cutByCaller(T0, 3000) &&
        !cutByCaller(T0, 3000, T0 + batchDeadlineMs(3000)) &&
        !cutByCaller(T0, 3000, T0 + 10_000_000)
    );
    const w3bBail = web3bioSrc.slice(
      web3bioSrc.indexOf('if (Date.now() >= deadline)')
    );
    ok(
      "Web3Bio records the wallets the caller's deadline cut, and only those, as cut short",
      /const callerCuts = cutByCaller\(startTime, wallets\.length, opts\?\.deadline\);/.test(
        web3bioSrc
      ) &&
        /for \(const wallet of wallets\.slice\(i\)\) \{\s*if \(callerCuts\) opts\?\.cutShort\?\.add\(wallet\.toLowerCase\(\)\);\s*errorCount\+\+;\s*opts\?\.failedWallets\?\.add\(wallet\.toLowerCase\(\)\);\s*\}\s*break;/.test(
          w3bBail
        ) &&
        (web3bioSrc.match(/cutShort\?\.add\(/g) ?? []).length === 1
    );
    const { reachedPrefix, unsavedTail } = jobProcessor;
    const sliceList = ['0xA1', '0xB2', '0xC3', '0xD4', '0xE5'];
    ok(
      'the saved prefix ends at the first wallet cut short, in list order, and never past the list',
      reachedPrefix(sliceList, new Set()) === 5 &&
        reachedPrefix(sliceList, new Set(['0xd4', '0xc3'])) === 2 &&
        reachedPrefix(sliceList, new Set(['0xa1'])) === 0 &&
        reachedPrefix(sliceList, new Set(['0xff'])) === 5
    );
    const dropped = unsavedTail(
      ['0xZ0', '0xC3', ...sliceList],
      2,
      sliceList,
      2
    );
    ok(
      `a slice drops the rows past its saved prefix, except a repeated address the saved part still needs (${[...dropped].join(', ')})`,
      JSON.stringify([...dropped]) === JSON.stringify(['0xd4', '0xe5']) &&
        unsavedTail(sliceList, 0, sliceList, 5).size === 0
    );
    ok(
      'a slice saves, counts and resumes from only the prefix every source was asked about, after the scrub and before the stats',
      chunkFn
        .replace(/\s+/g, ' ')
        .includes(
          'const reached = reachedPrefix(walletsToProcess, cutShort); for (const wallet of unsavedTail( allWallets, startIndex, walletsToProcess, reached )) { results.delete(wallet); if (cacheHitWallets.has(wallet)) cacheHits--; } const chunkResults = walletsToProcess .slice(0, reached) .map((w) => results.get(w.toLowerCase())!);'
        ) &&
        /const newProcessedCount = startIndex \+ reached;/.test(chunkFn) &&
        !/startIndex \+ walletsToProcess\.length/.test(chunkFn) &&
        chunkFn.indexOf('const reached = reachedPrefix(') >
          chunkFn.indexOf('scrubResultRow(result, suppression)') &&
        chunkFn.indexOf('const reached = reachedPrefix(') <
          chunkFn.indexOf('const isComplete =') &&
        /cacheHitWallets\.add\(wallet\);/.test(chunkFn) &&
        (chunkFn.match(/cutShort\.add\(/g) ?? []).length === 1
    );
    ok(
      "a slice that saved progress tells the loop its size and the next claim's, full size after the handback",
      /sliceSize: walletsToProcess\.length,\s*nextSliceSize: Math\.min\(\s*sliceSizeFor\(1\),\s*allWallets\.length - newProcessedCount\s*\),\s*\};/.test(
        chunkFn
      )
    );

    /**
     * Every slice the loop takes is claimed on its own: processJobChunk is
     * the loop over processJobSlice and nothing else, and each slice's first
     * write is the claim (asserted above), which mints a fresh token and
     * counts an attempt after the last slice's handback reset it. Pinned
     * whole, and every caller passes the job id alone, so no route can widen
     * its own budget past the margin above.
     */
    ok(
      'processJobChunk takes every slice through processJobSlice, on the default budget',
      flatFn(
        'export async function processJobChunk(',
        'async function processJobSlice('
      ) ===
        'export async function processJobChunk( jobId: string, budgetMs: number = INVOCATION_BUDGET_MS ): Promise<ProcessResult> { return runSlices( (invocationDeadline) => processJobSlice(jobId, invocationDeadline), budgetMs ); }'
    );
    const callArgs = callers.flatMap((file) =>
      [
        ...withoutComments(readFileSync(file, 'utf8')).matchAll(
          /processJobChunk\(([^)]*)\)/g
        ),
      ].map((m) => m[1].trim())
    );
    ok(
      `every route calls processJobChunk with the job id alone (${callArgs.join('; ')})`,
      callArgs.length >= 5 &&
        callArgs.every((a) => a === 'jobId' || a === 'job.id')
    );

    /**
     * The page that said a fast scan "of any size comes back in seconds" is
     * what this loop was built to make true, and it now says how, in the
     * code's own numbers: the slice size and one pass's budget.
     */
    const scanDepthPage = readFileSync(
      'docs-site/concepts/scan-depth.mdx',
      'utf8'
    );
    const minutesInWords = [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
    ][INVOCATION_BUDGET_MS / 60_000];
    const sliceInWords = sliceSizeFor(1).toLocaleString('en-US');
    ok(
      `the scan depth page states the slice size and the pass budget the code uses (${sliceInWords} addresses, ${minutesInWords} minutes)`,
      minutesInWords !== undefined &&
        scanDepthPage.includes(`list ${sliceInWords} addresses at a time`) &&
        scanDepthPage.includes(
          `keeps taking the next ${sliceInWords} for up to ${minutesInWords} minutes`
        ) &&
        !/of any size/.test(scanDepthPage)
    );
    const openapiJobs = readFileSync('docs-site/openapi.yaml', 'utf8').replace(
      /\s+/g,
      ' '
    );
    ok(
      `the API description states the same slice size and pass budget (${sliceInWords} addresses, ${minutesInWords} minutes)`,
      minutesInWords !== undefined &&
        openapiJobs.includes(
          `A worker takes a job ${sliceInWords} addresses at a time for up to ${minutesInWords} minutes`
        )
    );

    const pickerFn = processorSrc.slice(
      processorSrc.indexOf('export async function getNextPendingJobs(')
    );
    ok(
      "the worker's candidate read skips jobs another invocation holds",
      (pickerFn.match(/claimable\(\)/g) ?? []).length >= 2 &&
        !/\.where\(eq\(lookupJobs\.status, '(pending|processing)'\)\)/.test(
          pickerFn
        )
    );

    /**
     * A job the retired pipeline left part-way restarts rather than finishing
     * short. Inngest wrote `processed_count` as a count and saved no rows
     * before it finished, so trusting the count would resume past wallets
     * nobody saved. Asserted through the real function.
     */
    const { resumeFromSavedPrefix } = jobProcessor;
    type Job = Parameters<typeof resumeFromSavedPrefix>[0];
    const jobRow = (over: Partial<Job>): Job =>
      ({
        id: 'j',
        wallets: ['0xA1', '0xB2', '0xC3', '0xD4'],
        processedCount: 0,
        partialResults: null,
        twitterFound: 0,
        farcasterFound: 0,
        anySocialFound: 0,
        cacheHits: 0,
        ...over,
      }) as Job;
    const leftByInngest = resumeFromSavedPrefix(
      jobRow({
        processedCount: 3,
        twitterFound: 2,
        farcasterFound: 1,
        cacheHits: 1,
      })
    );
    ok(
      'a count with no saved rows behind it restarts at the first wallet, its counts zeroed',
      leftByInngest.processedCount === 0 &&
        leftByInngest.partialResults === null &&
        leftByInngest.twitterFound === 0 &&
        leftByInngest.farcasterFound === 0 &&
        leftByInngest.anySocialFound === 0 &&
        leftByInngest.cacheHits === 0
    );
    const mixed = resumeFromSavedPrefix(
      jobRow({
        processedCount: 4,
        partialResults: [
          { wallet: '0xa1', source: [] },
          { wallet: '0xb2', source: [] },
        ],
      })
    );
    ok('a count past the saved rows restarts too', mixed.processedCount === 0);
    const workerRow = jobRow({
      processedCount: 2,
      twitterFound: 1,
      partialResults: [
        { wallet: '0xa1', source: [] },
        { wallet: '0xb2', source: [] },
      ],
    });
    const repeated = jobRow({
      wallets: ['0xA1', '0xa1', '0xB2'],
      processedCount: 2,
      partialResults: [{ wallet: '0xa1', source: [] }],
    });
    ok(
      "the worker's own progress resumes where it stopped, a repeated address included",
      resumeFromSavedPrefix(workerRow) === workerRow &&
        resumeFromSavedPrefix(repeated) === repeated
    );
    let strippedThrew = false;
    try {
      // The retention sweep nulls the wallets of a job untouched for 30 days.
      resumeFromSavedPrefix(
        jobRow({
          wallets: [null, null] as unknown as string[],
          processedCount: 1,
        })
      );
    } catch {
      strippedThrew = true;
    }
    ok(
      'the resume check never throws, since it runs before the failure handler',
      !strippedThrew
    );
    ok(
      'processJobChunk resumes through that check, before it reads any progress',
      /const job = resumeFromSavedPrefix\(claimed\);\s*const sliceStartedAt = Date\.now\(\);\s*try \{/.test(
        chunkFn
      )
    );
  }

  // -------------------------------- right-to-removal: the operator endpoint
  // The order is the design: insert and commit the suppression rows FIRST,
  // then erase. The other way round leaves a window in which an in-flight
  // sweep batch re-inserts the mapping after the delete and before any guard
  // exists to stop it.
  {
    const route = withoutComments(
      readFileSync('app/api/admin/removal/route.ts', 'utf8')
    );
    const rflat = route.replace(/\s+/g, ' ');
    const admin = withoutComments(readFileSync('lib/removal-admin.ts', 'utf8'));
    const aflat = admin.replace(/\s+/g, ' ');

    const insertIdx = rflat.indexOf(
      'outcomes = await insertSuppressions(db, targets, lane, reason);'
    );
    const eraseIdx = rflat.indexOf('await eraseIdentifier(');
    ok(
      'the suppression rows are inserted and awaited before any erase begins',
      insertIdx !== -1 && eraseIdx !== -1 && insertIdx < eraseIdx
    );

    const insertFailIdx = rflat.indexOf(
      'catch (e) { return NextResponse.json( { error: `Failed inserting suppression rows'
    );
    ok(
      'a failed suppression insert returns before the erasure can start',
      insertFailIdx !== -1 && insertFailIdx < eraseIdx
    );

    const insFnStart = aflat.indexOf(
      'export async function insertSuppressions'
    );
    const insFnEnd = aflat.indexOf('async function quarantineDelete');
    const insFn =
      insFnStart !== -1 && insFnEnd > insFnStart
        ? aflat.slice(insFnStart, insFnEnd)
        : '';
    ok(
      'each suppression row is one statement of its own, idempotent on re-run',
      insFn.includes('for (const t of targets)') &&
        insFn.includes('ON CONFLICT (kind, identifier) DO NOTHING') &&
        insFn.split('db.execute').length - 1 === 1
    );

    // The trigger on known_agents only refuses FUTURE writes; an existing
    // curated row pairing a suppressed wallet or handle with an agent name
    // is the mapping itself and must be ERASED, in both branches. The
    // guard-without-erase gap shipped once and was caught in review.
    ok(
      'the erase reaches known_agents for a suppressed wallet and for a suppressed handle',
      aflat.includes(
        "await del('known_agents', sql`t.wallet = ${identifier}`)"
      ) &&
        aflat.includes('sql`lower(t.twitter_handle) = ${identifier}`') &&
        aflat.includes('sql`lower(t.farcaster) = ${identifier}`')
    );

    // A saved REVERSE lookup's name plus row membership IS the mapping, so
    // the per-element amend cannot make it honest; it must be deleted
    // whole, matched on the marker app/api/reverse/route.ts writes.
    ok(
      'a saved reverse lookup whose subject is the suppressed handle is deleted whole',
      aflat.includes(
        "'lookup_history', sql`t.input_source = 'reverse_lookup'"
      ) &&
        readFileSync('app/api/reverse/route.ts', 'utf8').includes(
          "'reverse_lookup'"
        )
    );

    // The jitter lives in the table DEFAULT, so the one insert path must not
    // supply the columns: an endpoint writing now() itself would silently
    // defeat the jitter for every row it inserts.
    const stmtStart = insFn.indexOf('INSERT INTO suppressed_identifiers');
    const stmtEnd = insFn.indexOf('RETURNING');
    const stmt =
      stmtStart !== -1 && stmtEnd > stmtStart
        ? insFn.slice(stmtStart, stmtEnd)
        : '';
    ok(
      'the insert names no timestamp, so the jittered defaults stay in charge',
      stmt.includes('(kind, identifier, reason, lane)') &&
        !stmt.includes('requested_at') &&
        !stmt.includes('created_at') &&
        !stmt.includes('now()')
    );
  }

  // ------------------------------------------ right-to-removal: the jsonb amend
  // Decision 5: the amend over lookup_history.results and lookup_jobs
  // payloads is NOT fail-soft. propagateManualCorrection in lib/social-graph.ts
  // logs and carries on, and that is correct THERE (the graph write already
  // happened; a stale saved lookup is where we were before the feature). Here
  // the same shape would let the serve-time filter mask a broken amend
  // forever, so a failure must abort the removal and name what remains.
  {
    const admin = withoutComments(readFileSync('lib/removal-admin.ts', 'utf8'));
    const route = withoutComments(
      readFileSync('app/api/admin/removal/route.ts', 'utf8')
    );
    const rflat = route.replace(/\s+/g, ' ');

    ok(
      'the removal module holds no fail-soft machinery: no try, no catch, no console.error',
      !admin.includes('try {') &&
        !admin.includes('.catch(') &&
        !admin.includes('console.error')
    );

    ok(
      'the erase failure path names what completed, what failed and what remains',
      rflat.includes('remaining: targets.slice(i),') &&
        rflat.includes(
          'failedAt: { kind: t.kind, identifier: t.identifier },'
        ) &&
        rflat.includes("'re-run this same request to finish the erasure.',") &&
        rflat.includes('{ status: 500 }')
    );

    // Prove the contrast is real, or the no-catch assertion above is a claim
    // about a codebase where nothing ever fails soft.
    const sgflat = withoutComments(
      readFileSync('lib/social-graph.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'propagateManualCorrection really does fail soft, so strictness here is a choice this file now defends',
      sgflat.includes(
        "console.error('propagateManualCorrection failed:', error); return amended;"
      )
    );
    ok(
      'the removal path never routes through the fail-soft propagator',
      !admin.includes('propagateManualCorrection') &&
        !route.includes('propagateManualCorrection')
    );
  }

  // --------------------------------- right-to-removal: the serve-time filter
  // Reads have no trigger. Saved payloads, and the windows where deletion has
  // not caught up (mid-removal, a backup restore), are covered only by these
  // route-level filters, so each must fail CLOSED: an unreadable suppression
  // list refuses the request, because serving stored rows unfiltered would
  // make an outage of one tiny table behave as an un-removal.
  {
    const sup = withoutComments(readFileSync('lib/suppression.ts', 'utf8'));
    ok(
      'the suppression read helpers throw on failure and never soften',
      sup.split("throw new Error('Suppression list unavailable").length - 1 ===
        2 &&
        !sup.includes('catch') &&
        !sup.includes('console.error')
    );

    const hist = withoutComments(
      readFileSync('app/api/history/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'the history list scrubs full payloads and ships the scrubbed rows',
      hist.includes(
        'const scrub = await scrubSuppressed(full.map((h) => h.results));'
      ) && hist.includes('full[i] = { ...full[i], results: scrub.rowSets[i] };')
    );
    ok(
      'a throw on the history list lands in a catch that refuses',
      hist.includes(
        "console.error('History fetch error:', error); return NextResponse.json( { error: 'Failed to fetch history' }"
      )
    );

    const histId = withoutComments(
      readFileSync('app/api/history/[id]/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'a saved lookup ships scrubbed rows and drops suppressed wallets from the enriched list',
      histId.includes(
        'await scrubSuppressed([ lookup.results as WalletSocialResult[], ])'
      ) &&
        histId.includes('results: servedResults,') &&
        histId.includes(
          'enrichedWallets = enrichedWallets.filter( (w) => !scrub.suppressedWallets.has(w.toLowerCase()) );'
        )
    );
    ok(
      'a throw on the saved-lookup read lands in a catch that refuses',
      histId.includes(
        "console.error('History fetch error:', error); return NextResponse.json( { error: 'Failed to fetch lookup' }"
      )
    );

    const jobsId = withoutComments(
      readFileSync('app/api/jobs/[id]/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const j1 = jobsId.indexOf(
      "console.error('Suppression filter failed on job results read:', error);"
    );
    ok(
      'the job read serves scrubbed rows and answers 503 when the list cannot be read',
      jobsId.includes(
        'await scrubSuppressed([ job.partialResults as WalletSocialResult[], ])'
      ) &&
        jobsId.includes('response.results = scrub.rowSets[0];') &&
        j1 !== -1 &&
        jobsId
          .slice(j1, j1 + 300)
          .includes(
            "return NextResponse.json( { error: 'Results are temporarily unavailable. Retry shortly.' }, { status: 503 } );"
          )
    );

    const v1jobs = withoutComments(
      readFileSync('app/api/v1/jobs/[id]/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const j2 = v1jobs.indexOf(
      "console.error('Suppression filter failed on /v1/jobs read:', error);"
    );
    ok(
      'the keyed job read serves scrubbed rows and answers 503 when the list cannot be read',
      v1jobs.includes(
        'const scrub = await scrubSuppressed([rows]); rows = scrub.rowSets[0];'
      ) &&
        j2 !== -1 &&
        v1jobs
          .slice(j2, j2 + 300)
          .includes(
            "return apiError( 'Results are temporarily unavailable. Retry shortly; the poll is free.', 'SERVICE_UNAVAILABLE', 503,"
          )
    );

    // Reverse lookups ask the list before any row or count is read: the free
    // count above the paywall is an existence oracle otherwise.
    const revX = withoutComments(
      readFileSync('app/api/v1/reverse/twitter/[handle]/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const cX = revX.indexOf(
      "(await isSuppressed('twitter', [normalizedHandle])).size > 0;"
    );
    const qX = revX.indexOf(
      'await walletsBySecondaryHandle(normalizedHandle);'
    );
    const eX = revX.indexOf(
      "console.error('Suppression check failed on /v1/reverse/twitter:', error);"
    );
    ok(
      'the X reverse route asks the list before any read, and refuses on a failed read',
      cX !== -1 &&
        qX !== -1 &&
        cX < qX &&
        revX.includes('if (handleSuppressed) {') &&
        eX !== -1 &&
        revX
          .slice(eX, eX + 220)
          .includes(
            "return apiError( 'Service temporarily unavailable', 'SERVICE_UNAVAILABLE', 503,"
          )
    );

    const revF = withoutComments(
      readFileSync('app/api/v1/reverse/farcaster/[username]/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const cF = revF.indexOf(
      "(await isSuppressed('farcaster', [normalizedUsername])).size > 0;"
    );
    const qF = revF.indexOf('.from(socialGraph)');
    const eF = revF.indexOf(
      "console.error('Suppression check failed on /v1/reverse/farcaster:', error);"
    );
    ok(
      'the Farcaster reverse route asks the list before any read, and refuses on a failed read',
      cF !== -1 &&
        qF !== -1 &&
        cF < qF &&
        revF.includes('if (usernameSuppressed) {') &&
        eF !== -1 &&
        revF
          .slice(eF, eF + 220)
          .includes(
            "return apiError( 'Service temporarily unavailable', 'SERVICE_UNAVAILABLE', 503,"
          )
    );

    const revApp = withoutComments(
      readFileSync('app/api/reverse/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const cA = revApp.indexOf(
      '(await isSuppressed(platform, [handle])).size > 0;'
    );
    const nA = revApp.indexOf('await countBySecondaryHandle(handle)');
    const eA = revApp.indexOf(
      "console.error('Suppression check failed on /api/reverse:', error);"
    );
    ok(
      'the app reverse route asks the list before even the free count, and a suppressed handle counts zero',
      cA !== -1 &&
        nA !== -1 &&
        cA < nA &&
        revApp.includes(
          'if (handleSuppressed) { if (!entitled) { return NextResponse.json(lockedReverseBody(platform, handle, 0)); }'
        ) &&
        eA !== -1 &&
        revApp
          .slice(eA, eA + 220)
          .includes(
            "return NextResponse.json( { error: 'Service temporarily unavailable' }, { status: 503 } );"
          )
    );
  }

  // ----------------------------- right-to-removal: the forward index reads
  // The storage triggers only guard writes. After a backup restore, or in
  // the window where an erasure failed after its suppression row committed,
  // the graph rows still exist, so every route that reads the forward index
  // and serves identity must ask the list itself: a suppressed wallet
  // answers exactly as a never-indexed one, fail closed. The live
  // `twitter_also` stamp is read AFTER the scrub on serving routes, so it
  // gets its own filter or a suppressed second handle rides back in.
  {
    const w = withoutComments(
      readFileSync('app/api/v1/wallet/[address]/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const wCheck = w.indexOf(
      "if (isKindSuppressed(suppression, 'wallet', normalizedAddress)) {"
    );
    const wQuery = w.indexOf('.from(socialGraph)');
    const wFail = w.indexOf(
      "console.error('Suppression check failed on /v1/wallet:', error);"
    );
    ok(
      'the single forward lookup refuses a suppressed wallet before the index is read, fail closed',
      wCheck !== -1 &&
        wQuery !== -1 &&
        wCheck < wQuery &&
        wFail !== -1 &&
        w.includes(
          'meta: { wallet: normalizedAddress, found: false, checked_at: null },'
        ) &&
        w.includes("!isKindSuppressed(suppression, 'twitter', alsoVal.handle)")
    );

    const b = withoutComments(
      readFileSync('app/api/v1/batch/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const bDrop = b.indexOf(
      "if (isKindSuppressed(suppression, 'wallet', r.wallet)) return false;"
    );
    const bServe = b.indexOf('reachabilityForWallets(handleRows)');
    const bFail = b.indexOf(
      "console.error('Suppression check failed on /v1/batch:', error);"
    );
    ok(
      'the batch drops suppressed wallets before anything downstream reads a row, fail closed',
      bDrop !== -1 &&
        bServe !== -1 &&
        bDrop < bServe &&
        bFail !== -1 &&
        b.includes(
          "if (isKindSuppressed(suppression, 'twitter', a.handle)) also.delete(w);"
        )
    );

    const est = withoutComments(
      readFileSync('app/api/v1/estimate/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'the estimate counts a suppressed wallet as never checked, fail closed',
      est.includes(
        "if (isKindSuppressed(suppression, 'wallet', row.wallet)) continue;"
      ) &&
        est.includes(
          "console.error('Suppression check failed on /v1/estimate:', error);"
        )
    );

    const vj = withoutComments(
      readFileSync('app/api/v1/jobs/[id]/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const vjAlso = vj.indexOf('alsoOnXForWallets(handleRows)');
    const vjFilter = vj.indexOf(
      "if (isKindSuppressed(suppressionSets, 'twitter', a.handle)) { also.delete(w); }"
    );
    ok(
      'the job read filters the live also stamp against the same list its scrub used',
      vjAlso !== -1 && vjFilter !== -1 && vjAlso < vjFilter
    );

    const rev = withoutComments(
      readFileSync('app/api/reverse/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const revStamp = rev.indexOf('await stampAlsoOnX(results);');
    const revFilter = rev.indexOf('delete r.twitter_also;');
    ok(
      'the app reverse route strips a suppressed second handle after the live stamp, fail closed',
      revStamp !== -1 &&
        revFilter !== -1 &&
        revStamp < revFilter &&
        rev.includes(
          "console.error('Suppression check failed on /api/reverse also:', error);"
        )
    );

    // The amend keeps the denormalized counts honest in the same statement:
    // stale twitter_found beside scrubbed rows is itself a removal signal.
    const adminSrc = withoutComments(
      readFileSync('lib/removal-admin.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'the amend recomputes the match counts from the scrubbed array it writes',
      adminSrc.includes('SET ${col} = s.scrubbed') &&
        adminSrc.includes('jsonb_array_elements(s.scrubbed)') &&
        adminSrc.includes('any_social_found = (SELECT count(*)::int') &&
        adminSrc.includes("countOf('twitter_handle')") &&
        adminSrc.includes("countOf('farcaster')")
    );
  }

  // ---------------- right-to-removal: API retry copies and the claim record
  /**
   * Two places a removed mapping outlived its removal, closed 2026-09-25
   * (STA-46), and asserted through the code that closes them.
   *
   * A stored `/v1/batch` response under an `Idempotency-Key` is replayable
   * for a day. It is rewritten at removal time AND every replay is filtered
   * against the live list, because a request in flight across the erase can
   * store a pre-removal body after the rewrite ran. It is never deleted: a
   * deleted key makes the retry a miss, and a miss bills again.
   *
   * And an emailed removal left the claim record (`identity_attestations`)
   * naming the pair, `completed`, because only the signed withdrawal route
   * cleared it. The clearing now lives in the erase both lanes run, as its
   * last step, so a failure before it leaves the claim retryable.
   */
  {
    const { scrubStoredBatchResponse } = await import('@/lib/idempotency');
    const { eraseIdentifier, unsuppressIdentifier } =
      await import('@/lib/removal-admin');
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const dialect = new PgDialect();
    type Sets = Parameters<typeof scrubStoredBatchResponse>[1];
    const setsOf = (entries: Array<[string, string[]]>) =>
      new Map(entries.map(([k, v]) => [k, new Set(v)])) as unknown as Sets;

    const W1 = '0x' + '1'.repeat(40);
    const W2 = '0x' + '2'.repeat(40);
    const W3 = '0x' + '3'.repeat(40);
    const stored = () => ({
      data: [
        {
          wallet: W1,
          twitter: { handle: 'alice', url: 'https://x.com/alice' },
          farcaster: { username: 'alicefc', fid: 11 },
          ens_name: 'alice.eth',
          last_updated: '2026-09-25T00:00:00.000Z',
          stale: false,
        },
        {
          wallet: W2,
          twitter: {
            handle: 'Bob',
            url: 'https://x.com/Bob',
            also: { handle: 'bobalt', url: 'https://x.com/bobalt' },
          },
          last_updated: '2026-09-25T00:00:00.000Z',
          stale: false,
        },
        null,
      ],
      meta: {
        requested: 3,
        found: 2,
        not_found: 1,
        matched: 2,
        previously_checked: { [W3]: '2026-09-20T00:00:00.000Z' },
      },
    });

    // As the replayer: the wallet was removed after the store.
    const byWallet = scrubStoredBatchResponse(
      stored(),
      setsOf([['wallet', [W1, W3]]])
    ) as ReturnType<typeof stored>;
    ok(
      'a replay after a wallet removal serves that wallet as never indexed, and its checked stamp goes too',
      byWallet.data[0] === null &&
        !JSON.stringify(byWallet).includes(W1) &&
        !JSON.stringify(byWallet).includes('alice') &&
        !JSON.stringify(byWallet).includes(W3) &&
        byWallet.meta.previously_checked === undefined
    );
    ok(
      'the replayed counts describe what is served, not what the original held',
      byWallet.meta.found === 1 &&
        byWallet.meta.not_found === 2 &&
        byWallet.meta.matched === 1 &&
        byWallet.meta.requested === 3
    );

    // The same removal where the wallet's ONLY trace is its checked stamp:
    // nothing in `data` changes, so the stamp alone has to mark the body as
    // touched, or the amend reads it as clean and every replay keeps it.
    const missInput = stored();
    const byMiss = scrubStoredBatchResponse(
      missInput,
      setsOf([['wallet', [W3]]])
    ) as ReturnType<typeof stored>;
    ok(
      'a wallet removed while a checked miss loses its stamp even when nothing else in the body changes',
      byMiss !== missInput &&
        byMiss.meta.previously_checked === undefined &&
        !JSON.stringify(byMiss).includes(W3) &&
        JSON.stringify(byMiss.data) === JSON.stringify(missInput.data) &&
        byMiss.meta.found === 2 &&
        byMiss.meta.not_found === 1 &&
        byMiss.meta.matched === 2
    );

    // A handle stored mixed case, removed lowercase, and the row it leaves
    // with no identity at all.
    const byHandle = scrubStoredBatchResponse(
      stored(),
      setsOf([['twitter', ['bob']]])
    ) as ReturnType<typeof stored>;
    ok(
      'a replay after an X handle removal drops that handle whatever its stored case, and a row left bare is a miss',
      byHandle.data[1] === null &&
        !JSON.stringify(byHandle).toLowerCase().includes('"bob"') &&
        byHandle.meta.found === 1 &&
        byHandle.meta.matched === 1
    );
    const byAlso = scrubStoredBatchResponse(
      stored(),
      setsOf([['twitter', ['bobalt']]])
    ) as ReturnType<typeof stored>;
    ok(
      'a removed second X handle leaves the replay while the first handle stays',
      !JSON.stringify(byAlso).includes('bobalt') &&
        (byAlso.data[1] as { twitter: { handle: string } }).twitter.handle ===
          'Bob'
    );
    const byOthers = scrubStoredBatchResponse(
      stored(),
      setsOf([
        ['farcaster', ['alicefc']],
        ['ens', ['alice.eth']],
        ['twitter', ['ali']],
      ])
    ) as ReturnType<typeof stored>;
    ok(
      'a removed Farcaster account and ENS name leave the replay, and a handle inside a longer one is not a match',
      !JSON.stringify(byOthers).includes('alicefc') &&
        !JSON.stringify(byOthers).includes('alice.eth') &&
        (byOthers.data[0] as { twitter: { handle: string } }).twitter.handle ===
          'alice'
    );

    // The replay path goes through it, fail closed, and serves nothing else.
    const b = withoutComments(
      readFileSync('app/api/v1/batch/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const replayAt = b.indexOf("if (prior.kind === 'replay') {");
    const replayBlock = replayAt === -1 ? '' : b.slice(replayAt);
    const rLoad = replayBlock.indexOf(
      'replaySuppression = await loadSuppressionList();'
    );
    const rFail = replayBlock.indexOf(
      "console.error('Suppression check failed on /v1/batch replay:', error); return apiError( 'Service temporarily unavailable', 'SERVICE_UNAVAILABLE', 503,"
    );
    const rScrub = replayBlock.indexOf(
      'const replayed = scrubStoredBatchResponse( prior.response, replaySuppression );'
    );
    const rTrack = replayBlock.indexOf('trackApiUsage(');
    const rServe = replayBlock.indexOf('return NextResponse.json(replayed, {');
    ok(
      'a replay is filtered against the live list before it is served, and an unreadable list refuses it unbilled',
      rLoad !== -1 &&
        rFail > rLoad &&
        rScrub > rFail &&
        rTrack > rScrub &&
        rServe > rTrack &&
        !b.includes('NextResponse.json(prior.response')
    );

    /**
     * The erase, run against a database that records every statement. The
     * candidate read returns one stored body naming the removed wallet, as
     * TEXT (a driver that hands jsonb back unparsed must not make the scrub
     * a silent no-op), and the first conditional write loses a race to a
     * body that changed underneath it.
     */
    const run = async (
      kind: 'wallet' | 'twitter' | 'farcaster',
      identifier: string,
      opts: { loseRaces: number }
    ) => {
      const sent: Array<{ sql: string; params: unknown[] }> = [];
      let races = opts.loseRaces;
      const changed = stored();
      (changed.data[1] as { ens_name?: string }).ens_name = 'arrived.eth';
      const db = {
        execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
          const q = dialect.sqlToQuery(query);
          const flat = q.sql.replace(/\s+/g, ' ').trim();
          sent.push({ sql: flat, params: q.params });
          if (
            flat.includes('FROM idempotency_keys WHERE response IS NOT NULL')
          ) {
            return {
              rows: [
                {
                  key_id: 'K',
                  idem_key: 'I',
                  response: JSON.stringify(stored()),
                  digest: 'd0',
                },
              ],
            };
          }
          if (flat.startsWith('UPDATE idempotency_keys')) {
            if (races > 0) {
              races--;
              return { rows: [] };
            }
            return { rows: [{ key_id: 'K' }] };
          }
          if (flat.includes('FROM idempotency_keys WHERE key_id =')) {
            return {
              rows: [
                { key_id: 'K', idem_key: 'I', response: changed, digest: 'd1' },
              ],
            };
          }
          if (flat.includes('FROM identity_attestations t')) {
            return { rows: [{ withdrawn: 2, quarantined: 1 }] };
          }
          return { rows: [] };
        },
      };
      let threw: unknown = null;
      let report: Awaited<ReturnType<typeof eraseIdentifier>> | null = null;
      try {
        report = await eraseIdentifier(
          db as unknown as Parameters<typeof eraseIdentifier>[0],
          kind,
          identifier
        );
      } catch (error) {
        threw = error;
      }
      return { sent, report, threw };
    };

    const walletRun = await run('wallet', W1, { loseRaces: 1 });
    const writes = walletRun.sent.filter((s) =>
      s.sql.startsWith('UPDATE idempotency_keys')
    );
    const lastWrite = writes.at(-1);
    const lastBody =
      typeof lastWrite?.params[0] === 'string' ? lastWrite.params[0] : '';
    ok(
      'a removal rewrites the stored retry copy and never deletes its key, since a deleted key bills the retry again',
      writes.length === 2 &&
        !walletRun.sent.some((s) =>
          /DELETE FROM idempotency_keys/.test(s.sql)
        ) &&
        lastBody.length > 0 &&
        !lastBody.includes(W1) &&
        !lastBody.includes('alice') &&
        walletRun.report?.steps.some(
          (s) =>
            s.table === 'idempotency_keys' &&
            s.action === 'amended' &&
            s.rows === 1
        ) === true
    );
    ok(
      'each rewrite is conditional on the body it read, and a lost race re-reads and scrubs what is there now',
      writes.every((w) =>
        w.sql.includes(
          'WHERE key_id = $2 AND idem_key = $3 AND md5(response::text) = $4'
        )
      ) &&
        writes[0]?.params[3] === 'd0' &&
        writes[1]?.params[3] === 'd1' &&
        lastBody.includes('arrived.eth')
    );
    const candidateRead = walletRun.sent.find((s) =>
      s.sql.includes('FROM idempotency_keys WHERE response IS NOT NULL')
    );
    ok(
      'the candidate read is case-insensitive over the whole stored body',
      candidateRead?.sql.includes(
        'AND strpos(lower(response::text), $1) > 0'
      ) === true && candidateRead.params[0] === W1
    );
    const stuck = await run('wallet', W1, { loseRaces: 3 });
    ok(
      'a stored copy that keeps changing under the amend aborts the removal instead of reporting it clean',
      stuck.threw instanceof Error &&
        /changed under the amend/.test((stuck.threw as Error).message)
    );

    // The claim record: reached by both kinds that can name it, last.
    const claimSql = (sent: Array<{ sql: string }>) =>
      sent.filter((s) => s.sql.includes('FROM identity_attestations t'));
    const wClaims = claimSql(walletRun.sent);
    const twitterRun = await run('twitter', 'bob', { loseRaces: 0 });
    const tClaims = claimSql(twitterRun.sent);
    const fcRun = await run('farcaster', 'bobfc', { loseRaces: 0 });
    ok(
      'an emailed removal of a wallet or an X handle withdraws the claim record, and it is the last statement of the erase',
      wClaims.length === 1 &&
        walletRun.sent.at(-1) === wClaims[0] &&
        wClaims[0].sql.includes(
          "WHERE t.wallet = $1 AND t.status IN ('completed', 'awaiting_x')"
        ) &&
        tClaims.length === 1 &&
        twitterRun.sent.at(-1) === tClaims[0] &&
        tClaims[0].sql.includes(
          "WHERE lower(t.x_handle) = $1 AND t.status IN ('completed', 'awaiting_x')"
        ) &&
        claimSql(fcRun.sent).length === 0 &&
        walletRun.report?.steps.at(-1)?.table === 'identity_attestations' &&
        walletRun.report?.steps.at(-1)?.rows === 2
    );
    const claimStmt = wClaims[0]?.sql ?? '';
    ok(
      'the withdrawal clears the handle, the account, the signature and any pending authorization, and keeps the grant key',
      claimStmt.includes(
        "SET status = 'withdrawn', x_user_id = NULL, x_handle = NULL, signature = NULL, code_verifier = NULL, state_nonce = NULL, updated_at = now()"
      ) &&
        // The join that applies the snapshot to the UPDATE. Without it the
        // UPDATE ... FROM is a cross join and withdraws every claim in the
        // table; narrowed, it leaves completed claims naming the pair. The
        // stubbed counts above cannot see either, so the text is pinned.
        claimStmt.includes('FROM snap WHERE g.id = snap.id RETURNING g.id') &&
        !claimStmt.includes('x_user_id_hmac = NULL') &&
        !/LIMIT/.test(claimStmt) &&
        !/user_id = \$/.test(claimStmt)
    );
    ok(
      'only a completed claim is copied to quarantine; a pending authorization is not kept',
      claimStmt.includes(
        "SELECT $2, $3, 'identity_attestations', snap.payload FROM snap WHERE snap.status = 'completed'"
      )
    );

    // Un-suppress puts a claim back only where no sibling suppression still
    // covers its wallet or its handle: the table has no trigger to refuse.
    // Run for both kinds that can name a claim, since each reaches it.
    const unsuppressSent = async (kind: 'wallet' | 'twitter', id: string) => {
      const sent: string[] = [];
      await unsuppressIdentifier(
        {
          execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
            const flat = dialect
              .sqlToQuery(query)
              .sql.replace(/\s+/g, ' ')
              .trim();
            sent.push(flat);
            if (flat.includes('AS past_retention')) {
              return { rows: [{ past_retention: false }] };
            }
            if (
              flat.includes('count(*)::int AS n FROM suppression_quarantine')
            ) {
              return { rows: [{ n: 1 }] };
            }
            return { rows: [] };
          },
        } as unknown as Parameters<typeof unsuppressIdentifier>[0],
        kind,
        id,
        false
      );
      return (
        sent.find((s) => s.includes('UPDATE identity_attestations g')) ?? ''
      );
    };
    const claimRestore = await unsuppressSent('wallet', W1);
    const handleRestore = await unsuppressSent('twitter', 'bob');
    ok(
      'a restored claim never re-pairs a wallet or handle that another suppression still covers',
      claimRestore.includes(
        "WHERE g.id = (s.row_data ->> 'id')::uuid AND g.status = 'withdrawn' AND g.x_handle IS NULL AND NOT EXISTS ( SELECT 1 FROM suppressed_identifiers x WHERE (x.kind = 'wallet' AND x.identifier = g.wallet) OR (x.kind = 'twitter' AND x.identifier = lower(s.row_data ->> 'x_handle')) )"
      )
    );
    ok(
      'a restored claim gets back its handle, its account id and its signature',
      claimRestore.includes(
        "SET status = 'completed', x_user_id = s.row_data ->> 'x_user_id', x_handle = s.row_data ->> 'x_handle', signature = s.row_data ->> 'signature', updated_at = now()"
      )
    );
    ok(
      'a claim copy is deleted only when its restore landed, so a refused one is kept',
      claimRestore.includes(
        "DELETE FROM suppression_quarantine q USING src WHERE q.id = src.id AND (src.row_data ->> 'id')::uuid IN (SELECT id FROM upd)"
      )
    );
    ok(
      'un-suppressing an X handle restores the claim record too',
      handleRestore.length > 0 && handleRestore === claimRestore
    );

    // The signed withdrawal reaches the claim through the same erase and no
    // longer carries a clearing statement of its own.
    const withdrawRoute = withoutComments(
      readFileSync('app/api/claim/withdraw/route.ts', 'utf8')
    );
    ok(
      'the signed withdrawal clears the claim through the shared erase, not a copy of it',
      /const erased = await eraseIdentifier\(db, 'wallet', wallet\);/.test(
        withdrawRoute
      ) && !/identity_attestations\s+SET/.test(withdrawRoute)
    );

    // A pending claim names no handle until the callback, so the removal of
    // a handle cannot reach it; the callback asks the list once it knows.
    const cbFlat = withoutComments(
      readFileSync('lib/claim-callback.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const cbIdentity = cbFlat.indexOf('handle = json.data.username;');
    const cbCheck = cbFlat.indexOf(
      "const hits = await isSuppressed('twitter', [handle]); if (hits.size > 0) return back('not_found', claim.id);"
    );
    const cbFail = cbFlat.indexOf(
      "console.error('claim handle suppression read failed; refusing:', error); return back('unavailable', claim.id);"
    );
    const cbWrite = cbFlat.indexOf('x_handle = ${handle.toLowerCase()},');
    ok(
      'a claim pending across a handle removal cannot complete with that handle, and a failed read refuses',
      cbIdentity !== -1 &&
        cbCheck > cbIdentity &&
        cbFail > cbCheck &&
        cbWrite > cbFail
    );
  }

  // -------------------------------- right-to-removal: what a restore contains
  // The asymmetry IS the restore semantics. suppressed_identifiers goes in
  // BOTH lists: a backup restored without it would un-remove every person who
  // asked to be gone, while with it the triggers re-suppress every restored
  // identity row on its next write and the pre-flight filter holds meanwhile.
  // suppression_quarantine goes in NEITHER: it holds the erased edges whole,
  // and a nightly dump would stretch the stated 30-day retention into a
  // 90-day artifact.
  {
    const grants = readFileSync('scripts/migrate-grant-readonly.ts', 'utf8');
    const readOnly = [
      ...(
        grants.match(/const READ_ONLY_TABLES = \[([\s\S]*?)\]/)?.[1] ?? ''
      ).matchAll(/'([a-z0-9_]+)'/g),
    ].map((m) => m[1]);
    const backup = [
      ...(
        grants.match(/const BACKUP_TABLES = \[([\s\S]*?)\]/)?.[1] ?? ''
      ).matchAll(/'([a-z0-9_]+)'/g),
    ].map((m) => m[1]);
    ok(
      'suppressed_identifiers is in BOTH lists, so a restore cannot un-remove people',
      readOnly.includes('suppressed_identifiers') &&
        backup.includes('suppressed_identifiers')
    );
    ok(
      'suppression_quarantine is in NEITHER list',
      !readOnly.includes('suppression_quarantine') &&
        !backup.includes('suppression_quarantine')
    );
    const yml = readFileSync('.github/workflows/db-backup.yml', 'utf8');
    ok(
      'the dump names the suppression list and never the quarantine',
      yml.includes('-t public.suppressed_identifiers') &&
        !yml.includes('-t public.suppression_quarantine')
    );
  }

  // ------------------------------------ right-to-removal: jittered timestamps
  // One request naming a wallet and a handle becomes two rows, and equal
  // insert timestamps would rebuild exactly the association the
  // one-identifier-per-row key refuses to store. The jitter is the column
  // DEFAULT, evaluated per row and per column, and everything that could
  // defeat it is asserted: the expression, both columns, the migration's own
  // catalog verification, and the schema declaration beside it.
  {
    const migCode = withoutComments(
      readFileSync('scripts/migrate-suppression.ts', 'utf8')
    );
    const mflat = migCode.replace(/\s+/g, ' ');
    ok(
      'the timestamp default is jittered and backward only',
      migCode.includes(
        "const JITTERED_DEFAULT = `(now() - random() * interval '4 hours')`;"
      )
    );
    ok(
      'both timestamp columns take the jittered default, at create and at converge',
      migCode.split('${JITTERED_DEFAULT}').length - 1 === 4
    );
    const unjIdx = mflat.indexOf('if (unjittered.length > 0) {');
    ok(
      'the migration reads the live defaults out of pg_attrdef and refuses when random() is gone',
      mflat.includes(
        "return !row || !String(row.expr).includes('random()');"
      ) &&
        unjIdx !== -1 &&
        mflat.slice(unjIdx, unjIdx + 300).includes('process.exit(1)')
    );
    const schemaSrc = withoutComments(readFileSync('db/schema.ts', 'utf8'));
    ok(
      'db/schema.ts declares the same jittered defaults',
      schemaSrc.split("default(sql`now() - random() * interval '4 hours'`)")
        .length -
        1 ===
        2
    );
  }

  // ------------------------------- Basenames: an expired name is not a claim
  /**
   * An expired basename keeps resolving. That is the whole hazard: the
   * registry still names a resolver, `addr(node)` still returns an address and
   * the text record is still readable, so an unfiltered harvest emits pairs
   * for names anybody can buy today. A uniform sample put the expired share of
   * the corpus at 44.5%, so this is not an edge case, it is nearly half the
   * input.
   *
   * The refusal is asserted where it actually decides, not merely as text
   * somewhere in the file: the drop-and-return sits immediately before the
   * ONLY `out.push` in the module, and that push is asserted to be the only
   * one. Deleting the filter, or adding a second emit path that skips it,
   * fails here.
   */
  {
    const basenames = withoutComments(readFileSync('lib/basenames.ts', 'utf8'));
    const flat = basenames.replace(/\s+/g, ' ');

    ok(
      'an expired basename cannot become a link: the refusal is the last thing before the only emit',
      flat.includes(
        'if (expires <= BigInt(nowSeconds)) { ' +
          'drops.expired++; return; } out.push(c); });'
      ) && (basenames.match(/out\.push\(/g) ?? []).length === 1
    );
    /**
     * `<=` rather than `<`, which is the registrar's own test: its
     * `onlyNonExpired` modifier reverts when `nameExpires[id] <=
     * block.timestamp`. A name inside its 90-day grace period is expired by
     * this test, and the owner has not renewed, so the record is no longer a
     * live claim.
     *
     * An unreadable expiry is the other direction of the same rule: a call
     * that failed to decode is a name whose expiry is UNKNOWN, and an unknown
     * expiry must drop rather than pass. A guard that treats a failed read as
     * a pass is the fail-open shape this repo keeps finding.
     *
     * It is counted apart from a genuine expiry, and that separation is
     * asserted too. `nameExpires` of an unregistered id returns 0, which is
     * `<= now`, so a derivation bug that computes the wrong labelhash for
     * every name would present as a high `expired` count and nothing else.
     * That is precisely how the `namehash` defect hid, and `expired` is the
     * figure the docs quote to justify the filter existing at all.
     */
    ok(
      'an expiry that could not be read is a refusal, not a pass',
      flat.includes(
        'if (expires === null) { drops.expiryUnreadable++; return; }'
      )
    );
    ok(
      'the expiry is asked of the registrar, keyed on the labelhash',
      flat.includes(
        "registrarIface.encodeFunctionData('nameExpires', [ c.labelhash, ])"
      )
    );
    /**
     * And it must be the labelhash of THIS name. `nameExpires` is keyed on the
     * label while the node is one-way, so the label is recovered through the
     * reverse record. Without the node equality an owner whose primary name is
     * a different name of theirs would have that OTHER name's expiry checked:
     * a filter that reports on the wrong name and passes.
     *
     * The equality must be rebuilt from the RAW label, never `namehash`.
     * `namehash` applies ENSIP-15 normalisation and this registrar does not,
     * so `SemperAltius` and `semperaltius` are two separately registerable
     * names that `namehash` collapses into one. An earlier version of this
     * very assertion certified the guarantee while checking it with the
     * function that breaks it, which is why the rule is asserted twice: the
     * refusal must use `rawBaseNode`, AND `namehash` must not be reachable
     * from any chain-read string in the module.
     */
    ok(
      'a label that does not hash back to this node is dropped rather than expiry-checked against the wrong name',
      flat.includes(
        'if (!name || !match || rawBaseNode(match[1]) !== n.node) { ' +
          'drops.labelUnrecovered++; continue; }'
      )
    );
    /**
     * `namehash` is allowed exactly twice, on the two constants at the top of
     * the file (`80002105.reverse` and `base.eth`), which are written here and
     * already normalised. A third call means something read off the chain is
     * being normalised before it is compared, which both mis-derives and
     * throws on labels ENSIP-15 rejects.
     */
    ok(
      'no chain-read string reaches namehash: it is used only on the two literal constants',
      (basenames.match(/ethers\.namehash\(/g) ?? []).length === 2 &&
        flat.includes("ethers.namehash('80002105.reverse')") &&
        flat.includes("ethers.namehash('base.eth')")
    );
    /**
     * And the derivation itself, checked against the chain rather than
     * restated: these are three live Base registrations whose raw and
     * lowercased labels are DIFFERENT names with different expiries. If
     * `rawBaseNode` ever agreed with `namehash` on them, the recovery would be
     * back to comparing against a node that does not exist.
     */
    const { rawBaseNodeForLabel } = await import('@/lib/basenames');
    for (const label of ['SemperAltius', 'DaanCrypto', 'Loopify']) {
      ok(
        `the node for the mixed-case label ${label} is built from the raw label, not its normalised form`,
        rawBaseNodeForLabel(label) !== ethersNamehash(`${label}.base.eth`) &&
          rawBaseNodeForLabel(label.toLowerCase()) ===
            ethersNamehash(`${label.toLowerCase()}.base.eth`)
      );
    }
  }

  // --------------------------- Basenames: junk is refused, never repaired
  /**
   * The record is free text an owner typed into a name. `cleanTwitterHandle`,
   * which every source passes through inside the ingest, DELETES invalid
   * characters and keeps what is left, so it turns a URL into `xcom` and an
   * email into a handle that belongs to a stranger. That is the right trade
   * for a value that arrived already believing it was a handle, and the wrong
   * one here.
   *
   * Asserted through `normaliseTwitterRecord` itself, and paired with what the
   * naive cleaner returns for the same input, so this cannot pass by matching
   * nothing: the assertion states both that the strict rule refuses and that
   * the lenient one invents.
   */
  {
    const { normaliseTwitterRecord } = await import('@/lib/basenames');
    const { cleanTwitterHandle } = await import('@/lib/twitter-cleaner');

    /** Every shape observed in the live corpus that is not a handle. */
    const refused: Array<[string, string]> = [
      ['', 'empty'],
      ['   ', 'empty'],
      ['bob@mail.com', 'malformed'],
      ['emrah28.base.eth', 'malformed'],
      ['@', 'malformed'],
      ['sixteencharacters', 'malformed'],
      ['1212312121', 'numeric'],
      ['666', 'numeric'],
    ];
    for (const [raw, reason] of refused) {
      const result = normaliseTwitterRecord(raw);
      ok(
        `a basename record of ${JSON.stringify(raw)} is refused as ${reason}, not repaired`,
        result.handle === null && result.reject === reason
      );
    }

    /**
     * The two forms that ARE recovered. The refusal being asserted is that the
     * raw string never survives as the handle: an `@` prefix and a profile URL
     * are unwrapped to the account they name, and anything the unwrap does not
     * leave as a bare handle still fails the shape gate above.
     */
    ok(
      'a leading @ is unwrapped rather than stored',
      normaliseTwitterRecord('@starl3xx').handle === 'starl3xx'
    );
    ok(
      'a profile URL yields the account it names, in either spelling and with or without a scheme',
      normaliseTwitterRecord('https://x.com/Cristhianrg12').handle ===
        'cristhianrg12' &&
        normaliseTwitterRecord('x.com/someone').handle === 'someone' &&
        normaliseTwitterRecord('twitter.com/someone').handle === 'someone' &&
        normaliseTwitterRecord('https://twitter.com/fooo?ref=1').handle ===
          'fooo'
    );
    /**
     * A URL whose first segment is a PAGE of the site, not a profile. Without
     * this the unwrap hands back the segment as a handle, and every one of
     * these belongs to a real and unrelated account: `x.com/logout` and
     * `x.com/home` are already in the live corpus.
     *
     * The last case is the one that matters most. `x.com/intent/user` carries
     * the correct handle in its query string, so the old rule did not merely
     * fail to read it: it discarded the right answer and substituted a
     * different real account.
     */
    const reservedPaths = [
      'https://x.com/logout',
      'https://x.com/home',
      'x.com/hashtag/Bitcoin',
      'x.com/i/spaces/1abcd',
      'twitter.com/search?q=eth',
      'x.com/settings/profile',
      'X.COM/Share?url=a',
      'x.com/intent/user?screen_name=realvictim',
    ];
    for (const raw of reservedPaths) {
      const result = normaliseTwitterRecord(raw);
      ok(
        `the site URL ${JSON.stringify(raw)} is refused rather than read as a handle`,
        result.handle === null && result.reject === 'reservedPath'
      );
    }
    /**
     * One to three characters. X requires four for a new username, so these
     * exist only as rare legacy accounts, and in a hand-typed record they are
     * placeholders that land on a stranger: nine of the ten commonest short
     * values in the corpus resolve to live X accounts. Roughly 770 wrong pairs
     * if unrefused, against 1.9% of the corpus to refuse them.
     */
    for (const raw of ['y', 'b', 'jb', 'npx', 'iii', '@ada']) {
      const result = normaliseTwitterRecord(raw);
      ok(
        `the short record ${JSON.stringify(raw)} is refused rather than landing on a stranger`,
        result.handle === null && result.reject === 'tooShort'
      );
    }
    ok(
      'four characters is still accepted, so the length rule is a floor and not a filter on real handles',
      normaliseTwitterRecord('jack').handle === 'jack' &&
        normaliseTwitterRecord('@jack').handle === 'jack'
    );
    /**
     * The load-bearing half. If these two ever agree, the strict normaliser has
     * stopped doing anything the ingest would not have done anyway, and the
     * assertions above would keep passing while a stranger's handle is written.
     */
    ok(
      'the NAIVE cleaner invents a handle for the bare-host URL, so the strict rule is load-bearing',
      cleanTwitterHandle('x.com/someone') === 'xcom' &&
        normaliseTwitterRecord('x.com/someone').handle === 'someone'
    );
    ok(
      'the NAIVE cleaner invents a handle for an email address, and this one refuses it',
      cleanTwitterHandle('bob@mail.com') === 'bobmailcom' &&
        normaliseTwitterRecord('bob@mail.com').handle === null
    );
    ok(
      'the NAIVE cleaner invents a handle for a name record, and this one refuses it',
      cleanTwitterHandle('emrah28.base.eth') === 'emrah28baseeth' &&
        normaliseTwitterRecord('emrah28.base.eth').handle === null
    );

    // Wired in with a refusal that returns. A normaliser nothing calls is a
    // pure function with a passing test and no effect on the index.
    const flat = withoutComments(
      readFileSync('lib/basenames.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'the pipeline drops a record the normaliser refused instead of falling through',
      flat.includes(
        'if (normalisedRecord.handle === null) { ' +
          "if (normalisedRecord.reject === 'numeric') drops.handleNumeric++; " +
          "else if (normalisedRecord.reject === 'tooShort') drops.handleTooShort++; " +
          "else if (normalisedRecord.reject === 'reservedPath') drops.handleReservedPath++; " +
          'else drops.handleMalformed++; ' +
          'onReject?.(raw, normalisedRecord.reject); return; }'
      )
    );
  }

  // ------------------------- Basenames: removal reaches this ingest path too
  /**
   * The storage triggers sit underneath every writer, so it is tempting to
   * treat a harvester-side suppression filter as belt and braces. For THIS
   * path it is not, and the way it fails is quiet.
   *
   * For a suppressed HANDLE the trigger nulls `NEW.twitter_handle` before the
   * `ON CONFLICT`, so the handle CASE in `lib/attested-links.ts` compares
   * against NULL, evaluates NULL rather than true, and is not taken. Control
   * reaches the ELSE, which appends this source to the `sources` of a row
   * whose handle came from somewhere else entirely. Because `basename_record`
   * maps to `onchain`, and `onchain` is inside `ATTESTED_SOURCES`, the public
   * API would then report an owner-published onchain attestation for a handle
   * this source never attested: the defect `lib/attested-links.ts` exists to
   * prevent, triggered by the act of suppressing an identifier.
   *
   * Anchored on the refusal and on its position: the filter must run BEFORE
   * the branch that writes, not merely appear in the file.
   */
  {
    const flat = withoutComments(
      readFileSync('lib/basenames.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'basename pairs pass the suppression filter before anything is written',
      flat.includes(
        'const links = await dropSuppressed(candidateLinks, stats.dropped); if (dryRun) {'
      )
    );
    ok(
      'the basename suppression filter refuses both a suppressed wallet and a suppressed handle',
      flat.includes(
        "!isKindSuppressed(sets, 'wallet', link.wallet) && " +
          "!isKindSuppressed(sets, 'twitter', link.handle)"
      )
    );
  }

  /**
   * A settled rename reaches the reader, or the column is dead again.
   *
   * `twitter_renamed_from` has been written since 2026-08-22, carries 2,208
   * rows, and was rendered nowhere. Surfacing it is only half the job: the
   * graph read maps it, and `mergeGraphRow` then rebuilds the result with
   * `...existing` and an explicit field list, so a field left off that list is
   * read out of the database and dropped one function later.
   *
   * That is not a hypothetical shape. `agent_detection_source` failed exactly
   * this way earlier the same day: three writers filled it and all four
   * readers dropped it, so a value that was stored was indistinguishable from
   * one that was never stored. Asserted as the whole trip rather than the
   * mapping alone.
   */
  {
    const graphSrc = withoutComments(
      readFileSync('lib/social-graph.ts', 'utf8')
    );
    const jobSrc = withoutComments(
      readFileSync('lib/job-processor.ts', 'utf8')
    );
    const tableSrc = withoutComments(
      readFileSync('components/ResultsTable.tsx', 'utf8')
    );
    /**
     * A previous handle is still a handle, so every path that withholds an
     * identity has to withhold this one.
     *
     * Adding a field to `WalletSocialResult` is the cheap half. Three separate
     * paths strip identities from a row and each carries its own list, so a
     * field absent from any one of them is served: `LOCKED_FIELDS` on a row
     * the customer has not paid for, `RESULT_STRIP` on a right-to-removal
     * erase, and `scrubResultRow` on the way out of a job.
     *
     * Withholding the current handle while naming the one it changed FROM
     * withholds nothing, because `twitter_renamed_from` means this same
     * account changed name. Caught in review before it shipped.
     */
    ok(
      'a locked row withholds the previous handle like any other identity',
      /'twitter_renamed_from',/.test(
        withoutComments(readFileSync('lib/match-gate.ts', 'utf8'))
      ) &&
        /delete next\.twitter_renamed_from;/.test(
          withoutComments(readFileSync('lib/suppression.ts', 'utf8'))
        )
    );

    /**
     * The previous handle and the live one stay UNCOUPLED, in both
     * directions, because they are frequently different people.
     *
     * `suppression_guard_row` states the rule in its own words: "a match on
     * it must not clear the live handle beside it, and a match on the live
     * handle must not clear it." The conflict resolver swaps when OUR handle
     * reaches nobody and another source names a live account for the wallet,
     * so the string left behind in `twitter_renamed_from` is frequently a
     * handle that never belonged to this wallet's owner.
     *
     * Asserted as the REFUSAL, because the tempting change is the one that
     * looks more private: coupling the two reads as "erase more", and it
     * would erase a stranger's handle on somebody else's removal and put this
     * file at odds with the trigger it mirrors. That coupling was written and
     * removed once already.
     */
    {
      const supp = withoutComments(
        readFileSync('lib/suppression.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      ok(
        'removing the live handle does not erase the one it replaced',
        // Its own test, on itself.
        /kindHit\(sets, 'twitter', row\.twitter_renamed_from\)/.test(supp) &&
          // And NOT taken along by the live handle's own flag.
          !/const renamedFromSuppressed = [^;]*twitterSuppressed/.test(supp) &&
          // The wallet is the one kind that does take everything, which is
          // the trigger's RETURN NULL and is not a coupling of the two.
          /const renamedFromSuppressed = walletSuppressed \|\|/.test(supp)
      );
      ok(
        'and the erase map leaves it out of the handle kind for the same reason',
        (
          withoutComments(readFileSync('lib/removal-admin.ts', 'utf8')).match(
            /'twitter_renamed_from',/g
          ) ?? []
        ).length === 1
      );
    }

    ok(
      'a settled rename survives the graph read, the merge and the panel',
      /twitter_renamed_from: record\.twitterRenamedFrom/.test(graphSrc) &&
        /twitter_renamed_from:\s*stored\.twitter_renamed_from \?\? existing\.twitter_renamed_from/.test(
          jobSrc
        ) &&
        /result\.twitter_renamed_from &&/.test(tableSrc)
    );

    /**
     * And it stays out of the public shape.
     *
     * Not caution: adding it to `/v1` is a response-shape change across every
     * reverse and lookup route, and `docs-site` plus `openapi.yaml` would have
     * to move with it. That is a decision with its own PR, and the failure
     * mode of doing it by accident is shipping an undocumented field to paying
     * customers.
     */
    ok(
      'the rename is not published on the v1 shape by accident',
      !/twitter_renamed_from/.test(
        withoutComments(readFileSync('lib/api-sources.ts', 'utf8'))
      ) &&
        !readdirSync('docs-site/api-reference', { recursive: true })
          .filter((f) => typeof f === 'string' && f.endsWith('.mdx'))
          .some((f) =>
            readFileSync(`docs-site/api-reference/${f}`, 'utf8').includes(
              'twitter_renamed_from'
            )
          )
    );
  }

  /**
   * An outage must not be able to manufacture evidence.
   *
   * The batched-by-id resolve is the only question whose answer survives a
   * rename, and its trap is not an HTTP status: this provider reports its own
   * failures as HTTP 200 with `status: "error"` (out of credits, rate limited,
   * upstream trouble). A body like that carries no `users`, so reading it as
   * an answer marks every id in the chunk as one the resolver DENIED knowing,
   * and five of those in a row retire an account that was perfectly fine.
   *
   * Asserted through `parseBatchByIds` itself rather than by matching source,
   * which is the whole reason it was extracted as a pure function: an
   * assertion that re-implements the status check verifies only itself.
   */
  {
    const errorBody = {
      status: 'error',
      msg: 'insufficient credits',
      users: [{ id: '1', userName: 'alice' }],
    };
    const unknownShape = { status: 'success' };
    const good = {
      status: 'success',
      users: [
        { id: '1', userName: 'alice' },
        { id: '2', userName: 'not a valid handle!' },
      ],
    };

    ok(
      'a provider error answered as HTTP 200 is not evidence about any id',
      // The error body even carries a plausible user. Refused on status alone,
      // because the users array of a failed call is not ours to interpret.
      parseBatchByIds(errorBody).answered === false &&
        parseBatchByIds(errorBody).resolved.size === 0
    );
    ok(
      'a success body with no users array is an unrecognized shape, not an empty answer',
      parseBatchByIds(unknownShape).answered === false
    );
    ok(
      'and a real answer resolves only what passes the handle rule',
      parseBatchByIds(good).answered === true &&
        parseBatchByIds(good).resolved.get('1') === 'alice' &&
        parseBatchByIds(good).resolved.has('2') === false
    );

    /**
     * The timeout the lift exists for. `lib/clanker.ts` passed only headers,
     * so the request inherited undici's 300s header timeout, which equals the
     * cron route's entire maxDuration: one socket that accepts and never
     * answers consumed a whole run.
     */
    const accounts = withoutComments(
      readFileSync('lib/x-accounts.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'the batched resolve bounds its own request',
      /batch_info_by_ids[\s\S]{0,200}?signal: AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/.test(
        accounts
      )
    );
    ok(
      'and there is one implementation of it, not two',
      // The copy in lib/clanker.ts is gone, not merely unused. A second
      // spelling of this parse is how one of them keeps the status check and
      // the other quietly loses it.
      !/batch_info_by_ids/.test(
        withoutComments(readFileSync('lib/clanker.ts', 'utf8'))
      )
    );
  }

  /**
   * The same defect one file over, and it was live rather than hypothetical.
   *
   * `upsertHarvestedRecords` in `lib/ens-harvest.ts` writes the handle
   * fill-if-empty: `COALESCE(social_graph.twitter_handle, EXCLUDED.twitter_handle)`
   * keeps ours whenever the row already holds one, so an ENS record naming a
   * DIFFERENT handle is refused. The `sources` and `dataQualityScore` CASEs
   * had a branch for the refused-rename case and none for that one, so the
   * row was stamped `ens_onchain` and carried through `GREATEST` for a handle
   * ENS never supplied.
   *
   * It is not a cosmetic label. `isTwitterVerified` in `lib/social-graph.ts`
   * counts `ens_onchain` as owner-attested, so the unearned source reads
   * downstream as the owner having published a handle they did not publish,
   * which is the evidence class this product is sold on.
   *
   * Counted, not merely present. There are two columns that must refuse
   * together: fixing `sources` and leaving `dataQualityScore` still inflates
   * the score of a write that did not happen, and an assertion satisfied by
   * either one passes over exactly that half-fix.
   */
  {
    const harvest = withoutComments(
      readFileSync('lib/ens-harvest.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'an ENS handle the row refuses earns no source label and no quality bump',
      (
        harvest.match(
          /WHEN social_graph\.twitter_handle IS NOT NULL AND EXCLUDED\.twitter_handle IS NOT NULL AND lower\(social_graph\.twitter_handle\) <> lower\(EXCLUDED\.twitter_handle\) AND NOT \(social_graph\.github IS NULL AND EXCLUDED\.github IS NOT NULL\) THEN social_graph\./g
        ) ?? []
      ).length === 2 &&
        // The carve-out the neighbouring branch already carries, kept rather
        // than copied away: a record that also fills github performed a real
        // write and earns both. `lib/attested-links.ts` has no github column
        // and so has no such clause, which is why this is not a verbatim copy
        // of the branch it is modelled on.
        /COALESCE\(social_graph\.github, EXCLUDED\.github\)/.test(harvest)
    );
  }

  // ------------------------- Basenames: the class and the score it is worth
  /**
   * The claim in `lib/basenames.ts` is parity with `ens_onchain`: the same
   * evidence mechanism one chain down, so the same public class and the same
   * score, deliberately below the 70 trust line because the handle half is
   * free text nobody checked.
   *
   * Both halves are asserted THROUGH the functions that decide them rather
   * than against numbers copied out of a comment, and the declared floor in
   * the adapter is compared with what the scorer computes. Those two numbers
   * disagreeing is not hypothetical: it is what shipped, at 50 declared
   * against 25 computed, with `GREATEST` in the upsert hiding it.
   */
  {
    const { publicSources, ATTESTED_SOURCES } =
      await import('@/lib/api-sources');
    const { calculateQualityScore } = await import('@/lib/social-graph');
    const classOf = (id: string) => JSON.stringify(publicSources([id]));

    ok(
      'basename_record carries exactly the public class its L1 twin carries',
      classOf('basename_record') === classOf('ens_onchain') &&
        classOf('basename_record') !== JSON.stringify(undefined)
    );
    /**
     * It is an owner-published record, so it is not `aggregated`; and it is
     * NOT the class that says a service checked the account, which is the one
     * misreading that would overstate this corpus. `onchain` sits inside
     * `ATTESTED_SOURCES` and that is deliberate: the owner did publish the
     * record. The claim the score carries, not the class, is that the handle
     * beside it was never verified.
     */
    ok(
      'basename_record is never classed as a service attestation or as correlated third-party data',
      !(publicSources(['basename_record']) ?? []).some(
        (c) =>
          c === 'attested-social' || c === 'farcaster' || c === 'aggregated'
      )
    );
    ok(
      'the public class of a name record is one the vocabulary already treats as owner-published',
      (publicSources(['basename_record']) ?? []).every((c) =>
        ATTESTED_SOURCES.has(c)
      )
    );

    const declared = Number(
      /id: 'basename_record',\s*quality: (\d+),/.exec(
        withoutComments(readFileSync('lib/basenames.ts', 'utf8'))
      )?.[1]
    );
    const computed = calculateQualityScore(['basename_record'], true, false);
    ok(
      'the score the adapter writes is the score the scorer computes, so a wallet cannot hold two',
      Number.isFinite(declared) && declared === computed
    );
    ok(
      'a name record scores exactly what its L1 twin scores',
      computed === calculateQualityScore(['ens_onchain'], true, false)
    );
    ok(
      'a wallet known only by a name record stays below the 70 trust line',
      computed < 70
    );
    /**
     * De-stacking. The same owner publishing the same unverified handle on L1
     * and on L2 is one claim written twice, so the second must add nothing:
     * 20 + 30 + 30 = 80 would cross the trust line and mark a wallet fully
     * known when its Farcaster side was never looked at.
     */
    ok(
      'a name record does not stack with either ENS record, in any combination',
      calculateQualityScore(['ens', 'basename_record'], true, false) < 70 &&
        calculateQualityScore(['ens_onchain', 'basename_record'], true, false) <
          70 &&
        calculateQualityScore(
          ['ens', 'ens_onchain', 'basename_record'],
          true,
          false
        ) < 70
    );
    /**
     * The control that stops the assertion above passing for the wrong reason.
     * Two INDEPENDENT attestations really do stack and really do reach the
     * line, so the flat 50 above is a decision this code makes rather than a
     * scorer that ignores whatever it is handed.
     */
    ok(
      'independent attestations DO stack, so the de-stacking above is a decision rather than an artifact',
      calculateQualityScore(['eas', 'clanker'], true, false) >= 70
    );

    // Same contract, same reasoning, for the creator-profile source.
    const { ZORA_PROFILE_SOURCE } = await import('@/lib/zora-profiles');
    ok(
      'the creator-profile adapter writes the score the scorer computes for it',
      ZORA_PROFILE_SOURCE.quality ===
        calculateQualityScore([ZORA_PROFILE_SOURCE.id], true, false)
    );
    ok(
      'a wallet known only by a creator profile stays below the 70 trust line',
      calculateQualityScore([ZORA_PROFILE_SOURCE.id], true, false) < 70
    );
    /**
     * And it is CORROBORATION, not attestation, which is the decision review
     * turned over. The upstream evidences the account half with a dated link
     * ledger and the wallet half with nothing at all: a linked wallet is a
     * type and an address, no signature, no event, no timestamp. A pair is
     * worth its weaker half, so the public class must stay outside
     * `ATTESTED_SOURCES` and the score must sit with the other aggregated
     * source rather than with the attested ones.
     *
     * Asserted through `publicSources` and `ATTESTED_SOURCES` rather than
     * against the literal string, so re-labelling the map fails here.
     */
    const sourcesModule = await import('@/lib/api-sources');
    const zoraClass = sourcesModule.publicSources([
      ZORA_PROFILE_SOURCE.id,
    ])?.[0];
    ok(
      'the creator-profile source is published as correlated, not as owner-attested',
      zoraClass === 'aggregated' &&
        !sourcesModule.ATTESTED_SOURCES.has(zoraClass)
    );
    ok(
      'it scores with the other correlated source, not with the attested ones',
      calculateQualityScore([ZORA_PROFILE_SOURCE.id], true, false) ===
        calculateQualityScore(['web3bio'], true, false) &&
        calculateQualityScore([ZORA_PROFILE_SOURCE.id], true, false) <
          calculateQualityScore(['opensea_profile'], true, false)
    );
  }

  // ------------------ Every attested writer records what it disagreed with
  /**
   * `lib/conflict-resolution.ts` opens by saying `handle_conflicts` rows "are
   * written by every attested ingest", and PROJECT_OVERVIEW said the same.
   * Both were false, and false in the flattering direction: only the
   * `ingestLinks` callers wrote them.
   *
   * Two attested writers of `social_graph.twitter_handle` sat outside that
   * path. `lib/ens-harvest.ts` writes `ens_onchain`, the strongest class in
   * the product, and dropped every disagreement silently. `lib/farcaster-sweep.ts`
   * did worse: it OVERWROTE the stored handle, including one an owner had
   * just signed for through `/claim`, left `owner_attested` sitting in
   * `sources` beside a handle that owner never gave, and recorded nothing.
   *
   * Asserted as the property rather than as two file names: every writer that
   * sets a twitter handle outside `ingestLinks` must call `recordConflicts`.
   * A third writer added later fails this until it does the same, which is
   * the whole point — the claim in those two files is repo-wide, so the check
   * has to be too.
   */
  {
    const ATTESTED_WRITERS = [
      'lib/ens-harvest.ts',
      'lib/farcaster-sweep.ts',
    ] as const;
    for (const file of ATTESTED_WRITERS) {
      const src = withoutComments(readFileSync(file, 'utf8'));
      ok(
        `${file} records the disagreement it found`,
        /recordConflicts\(/.test(src)
      );
      ok(
        `${file} records it BEFORE it writes`,
        // The comparison is against the handle currently stored, so running
        // it after the upsert compares the incoming handle with itself and
        // finds nothing. `ingestLinks` orders it the same way and says so.
        src.indexOf('recordConflicts(') < src.indexOf('onConflictDoUpdate')
      );
    }

    const sweep = withoutComments(
      readFileSync('lib/farcaster-sweep.ts', 'utf8')
    );
    ok(
      'the Farcaster sweep yields to attested evidence it does not speak for',
      // A Farcaster username is a name captured once with no account id and
      // no recheck; `owner_attested` is a signature taken in a session. The
      // guard is derived from the classification rather than hand-listed,
      // because a hand-copied list is how two reachability queries in this
      // repo already came to disagree.
      /OTHER_ATTESTED_SQL/.test(sweep) &&
        /ATTESTED_SOURCE_IDS/.test(sweep) &&
        // Ordering, not absence. The overwrite arm is still there and still
        // correct for a row no other attested source wrote; what matters is
        // that the guard is reached FIRST, because a CASE takes the first arm
        // that matches. Asserting the old line was gone failed here, on code
        // that was right.
        // Anchored on the GUARD, not on `OTHER_ATTESTED_SQL`. Once the
        // predicate moved into a helper, that constant's first occurrence was
        // its own definition near the top of the file, so this comparison
        // stopped describing the CASE and passed for the wrong reason.
        sweep.indexOf('YIELDS_TO_ATTESTED_SQL(') <
          sweep.indexOf(
            'WHEN EXCLUDED.twitter_handle IS NOT NULL THEN EXCLUDED.twitter_handle'
          )
    );

    const sourcesModule2 = await import('@/lib/api-sources');
    ok(
      'the attested id set excludes the aggregated source and the class aliases',
      // `zora_profile` is `aggregated`: its wallet half carries no evidence,
      // so a writer asking "did an attested source supply this" must not
      // match it. The class names are identity entries that exist so
      // `publicSources` composes with itself, and never appear in a row.
      !sourcesModule2.ATTESTED_SOURCE_IDS.has('zora_profile') &&
        !sourcesModule2.ATTESTED_SOURCE_IDS.has('onchain') &&
        !sourcesModule2.ATTESTED_SOURCE_IDS.has('farcaster') &&
        sourcesModule2.ATTESTED_SOURCE_IDS.has('owner_attested') &&
        sourcesModule2.ATTESTED_SOURCE_IDS.has('ens_onchain')
    );
    ok(
      'the curated source survives the alias filter',
      /**
       * `manual` is both a class and a real `sources` value, which the
       * classification table says in as many words. Dropping identity
       * mappings by the rule `cls === id` therefore took out the strongest
       * row in the table, and `isAttestedSourceId('manual')` answered false:
       * every writer asking whether attested evidence held a handle would
       * have been told an admin-curated one did not.
       *
       * Asserted positively AND through the helper, because the set and the
       * predicate are what callers actually use.
       */
      sourcesModule2.ATTESTED_SOURCE_IDS.has('manual') &&
        sourcesModule2.isAttestedSourceId('manual') &&
        !sourcesModule2.isAttestedSourceId('zora_profile')
    );
    ok(
      'yielding requires a handle to yield to, so an empty row still fills',
      /**
       * The guard fired on any row carrying an attested label, including rows
       * with no X handle at all: a `com.github`-only ENS harvest writes
       * `ens_onchain` and no handle. The sweep therefore refused to FILL
       * those, and the conflict query (which does require a handle) recorded
       * nothing either, so the majority attested route was dropped on exactly
       * the rows with the most room for it.
       *
       * Yielding is about not overwriting; filling an empty column overwrites
       * nothing. One predicate, used at all four sites, so the CASE arms and
       * the timestamp guard cannot disagree about what "yield" means.
       */
      /const YIELDS_TO_ATTESTED_SQL/.test(sweep) &&
        /IS NOT NULL\)`/.test(sweep) &&
        // Every use goes through it: three CASE arms and the lastUpdatedAt
        // guard. A fifth spelling is the drift this replaced.
        (sweep.match(/YIELDS_TO_ATTESTED_SQL\(/g) ?? []).length === 4
    );
    ok(
      'the sweep binds its wallet list as one array parameter',
      /**
       * `= ANY(${array})` without `sql.param` expands to one placeholder per
       * element, so `ANY` never receives an array and Postgres rejects the
       * statement. The surrounding try/catch then swallows it and the sweep
       * records no conflicts at all: the feature reads as working and does
       * nothing, which is the shape the `members -> $1` defect had.
       *
       * The repo's own pattern, in lib/clanker.ts and lib/suppression.ts.
       */
      /ANY\(\$\{sql\.param\(/.test(
        readFileSync('lib/farcaster-sweep.ts', 'utf8')
      )
    );
  }

  // ------------------ The attested set is written down in two places, in step
  /**
   * `scripts/check-published-figures.ts` carries a hand-written list of the
   * source ids that count as attested, and its own comment says it must stay
   * in step with `isTwitterVerified`. Nothing enforced that, and the failure it
   * describes has already happened once: the Sybil import added genuinely
   * attested rows that the list did not name, and the published share fell from
   * 99.9 to 99.8 with nothing actually wrong.
   *
   * A published figure that drops when the index IMPROVES is the worst kind of
   * check, because the correct response looks like the incorrect one. So the
   * two lists are read out of the two files and compared, in the direction the
   * failure runs: every source `isTwitterVerified` counts must appear in the
   * figure's list. The reverse does not hold and must not be asserted, since
   * the figure also counts the Farcaster-attested ids that live in
   * `isFarcasterVerified`.
   */
  {
    const graph = withoutComments(readFileSync('lib/social-graph.ts', 'utf8'));
    const verifiedBody = graph.slice(
      graph.indexOf('function isTwitterVerified('),
      graph.indexOf('function isFarcasterVerified(')
    );
    const attested = [...verifiedBody.matchAll(/s === '([a-z_0-9]+)'/g)].map(
      (m) => m[1]
    );
    const figures = withoutComments(
      readFileSync('scripts/check-published-figures.ts', 'utf8')
    );
    const published = [
      ...(/AND sources && ARRAY\[([^\]]*)\]/.exec(figures)?.[1] ?? '').matchAll(
        /'([a-z_0-9]+)'/g
      ),
    ].map((m) => m[1]);

    /**
     * Both extractions must find something. A regex that matches nothing would
     * make the comparison below vacuously true, which is the way a
     * source-reading assertion usually stops working.
     */
    ok(
      'both attested lists were actually read, so the comparison below is not vacuous',
      attested.length >= 10 && published.length >= 10
    );
    /**
     * The two lists answer different questions, and until 2026-09-02 every
     * source made them agree, which hid the difference.
     *
     * `isTwitterVerified` decides the `twitter_verified` COLUMN, and every
     * source ingested through `lib/attested-links.ts` must be named there or a
     * later recompute silently unverifies a handle nothing disproved. The
     * published figure states that the owner PUBLISHED the link, enumerating
     * the attested routes by name, so it may only count sources whose public
     * class is in `ATTESTED_SOURCES`.
     *
     * `zora_profile` is the first source where those diverge: it goes through
     * the shared ingest, so it is verified, and its wallet half carries no
     * evidence, so it is `aggregated` and must NOT inflate the published
     * claim. So the rule is no longer "the lists match": it is that a source
     * appears in the published figure exactly when its class is attested.
     * Read out of `lib/api-sources.ts` rather than restated here.
     */
    const sourcesFile = withoutComments(
      readFileSync('lib/api-sources.ts', 'utf8')
    );
    const classOf = (id: string): string | null =>
      new RegExp(`(?:^|\\s)'?${id}'?:\\s*'([a-z-]+)'`, 'm').exec(
        sourcesFile
      )?.[1] ?? null;

    ok(
      'the evidence class of every verified source was actually read, so the rule below is not vacuous',
      attested.filter((id) => classOf(id) !== null).length >= 10
    );
    for (const id of attested) {
      const cls = classOf(id);
      if (cls === null) continue;
      const isAttestedClass = cls !== 'aggregated';
      ok(
        `${id} is counted by the published attested-share figure exactly when its class (${cls}) is attested`,
        published.includes(id) === isAttestedClass
      );
    }
    ok(
      'the onchain corpus counts towards the published claim and the aggregated one does not',
      published.includes('basename_record') &&
        !published.includes('zora_profile') &&
        attested.includes('zora_profile')
    );
  }

  // ------------------ Creator profiles: a wallet-shaped record is not a person
  /**
   * The poisoning bug this gate exists for, verified live on 2026-09-02: an
   * address the platform has never seen returns HTTP 200 with a record that
   * has no `username`, no `socialAccounts` and no `linkedWallets`, and whose
   * `handle` field holds THAT ADDRESS'S ENS REVERSE NAME. Reading `handle` as
   * an identity value writes an unrelated stranger's name into the index as an
   * attested account name.
   *
   * The fixture below is the live shape with the stranger's name replaced, and
   * it is exercised through `readProfile` rather than described.
   */
  {
    const { readProfile } = await import('@/lib/zora-profiles');

    const EXTERNAL = '0x1111111111111111111111111111111111111111';
    const PROVISIONED = '0x2222222222222222222222222222222222222222';
    const SMART = '0x3333333333333333333333333333333333333333';

    /** The live account shape, field for field. */
    const account = (over: Record<string, unknown> = {}) => ({
      profile: {
        handle: 'creatorname',
        username: 'creatorname',
        platformBlocked: false,
        linkedWallets: {
          edges: [
            { node: { walletType: 'EXTERNAL', walletAddress: EXTERNAL } },
            { node: { walletType: 'PRIVY', walletAddress: PROVISIONED } },
            { node: { walletType: 'SMART_WALLET', walletAddress: SMART } },
          ],
        },
        socialAccounts: {
          instagram: null,
          tiktok: null,
          twitter: { username: 'creator_x', followerCount: 12, id: null },
          farcaster: { username: 'creatorfc', followerCount: 3, id: '8' },
        },
        socialAccountLinkedEvents: {
          edges: [
            {
              node: {
                platform: 'TWITTER',
                socialAccountUsername: 'creator_x',
                occurredAt: '2024-04-24T15:55:23+00:00',
                eventType: 'LINK',
              },
            },
          ],
        },
        ...over,
      },
    });

    /**
     * The live wallet-shaped record: four fields, one of them a trap.
     *
     * The name is invented rather than copied from the probe. It belongs to a
     * real person who has nothing to do with this repository, and this file is
     * public. Only the SHAPE is load-bearing: a dotted reverse name sitting in
     * the field an unwary parser reads as an account handle.
     */
    const STRANGERS_NAME = 'stranger.notarealname.eth';
    const walletShaped = {
      profile: {
        handle: STRANGERS_NAME,
        bio: '',
        platformBlocked: false,
        avatar: null,
      },
    };

    const trap = readProfile(walletShaped);
    ok(
      'an address the platform never saw yields no link at all',
      trap.links.length === 0 && trap.refusals.not_an_account === 1
    );
    ok(
      "the stranger's ENS name in the handle field never becomes a handle or a username",
      trap.username === null &&
        !JSON.stringify(trap.links).includes(STRANGERS_NAME) &&
        !JSON.stringify(trap.farcaster).includes(STRANGERS_NAME)
    );
    /**
     * Structural, and the reason the trap cannot come back by a different
     * route: the profile parser never reads `handle` at all. The list walk
     * does read it, but there it is an identifier to look an account up BY,
     * never a value written to the graph.
     */
    {
      const zora = withoutComments(
        readFileSync('lib/zora-profiles.ts', 'utf8')
      );
      const body = zora.slice(
        zora.indexOf('export function readProfile('),
        zora.indexOf('export interface ZoraListEntry')
      );
      ok(
        'the profile parser never reads the handle field, so it cannot be mistaken for an identity',
        body.length > 500 && !/\.handle\b/.test(body)
      );
    }
    ok(
      'a record whose typename says it is not an account is refused where the field is present',
      readProfile({
        profile: { ...account().profile, __typename: 'GraphQLIdentityProfile' },
      }).links.length === 0
    );
    /**
     * The control. A gate that refused everything would satisfy every
     * assertion above, and would be indistinguishable from a corpus that
     * simply produced nothing.
     */
    ok(
      'a real account still produces exactly one pair, so the gate is not refusing everything',
      readProfile(account()).links.length === 1 &&
        readProfile(account()).links[0].handle === 'creator_x'
    );

    // ------------------ Creator profiles: a provisioned wallet is not theirs
    /**
     * `linkedWallets` mixes three types and only EXTERNAL is a wallet the
     * person brought. PRIVY and SMART_WALLET are provisioned by the platform,
     * so a pair built from one asserts that a custodial address the person
     * never chose belongs to their X account. Both provisioned addresses are
     * in the fixture, so a filter that stops working emits them.
     */
    const real = readProfile(account());
    ok(
      'a platform-provisioned wallet is never emitted beside an account',
      real.links.every((l) => l.wallet !== PROVISIONED && l.wallet !== SMART) &&
        real.farcaster.every(
          (f) => f.wallet !== PROVISIONED && f.wallet !== SMART
        )
    );
    ok(
      'only the wallet the person brought is emitted',
      real.links.length === 1 && real.links[0].wallet === EXTERNAL
    );
    ok(
      'an account holding only provisioned wallets yields nothing and says why',
      (() => {
        const r = readProfile(
          account({
            linkedWallets: {
              edges: [
                { node: { walletType: 'PRIVY', walletAddress: PROVISIONED } },
                { node: { walletType: 'SMART_WALLET', walletAddress: SMART } },
              ],
            },
          })
        );
        return r.links.length === 0 && r.refusals.no_external_wallet === 1;
      })()
    );

    // --------------------------- Creator profiles: platformBlocked is honoured
    /**
     * What a true value means upstream is unverified: it was false in every
     * observation. An unknown exclusion flag has one safe reading, and it is
     * exclude.
     */
    ok(
      'a blocked profile yields no pair, whatever else it carries',
      (() => {
        const r = readProfile(account({ platformBlocked: true }));
        return r.links.length === 0 && r.refusals.platform_blocked === 1;
      })()
    );
    ok(
      'a blocked list row is skipped before its profile is ever fetched',
      withoutComments(readFileSync('lib/zora-profiles.ts', 'utf8'))
        .replace(/\s+/g, ' ')
        .includes(
          'if (node.platformBlocked === true || creator?.platformBlocked === true) ' +
            '{ refusals.platform_blocked++; continue; }'
        )
    );

    // ------------------------ Creator profiles: the ledger is the attestation
    /**
     * The evidence is the platform's own dated record that the account was
     * attached. An account present on the profile but with no LINK entry, or
     * with an UNLINK as its latest entry, is not attested and must not be
     * written.
     */
    ok(
      'an account whose latest ledger entry is an UNLINK yields no pair',
      (() => {
        const r = readProfile(
          account({
            socialAccountLinkedEvents: {
              edges: [
                {
                  node: {
                    platform: 'TWITTER',
                    socialAccountUsername: 'creator_x',
                    occurredAt: '2024-04-24T15:55:23+00:00',
                    eventType: 'LINK',
                  },
                },
                {
                  node: {
                    platform: 'TWITTER',
                    socialAccountUsername: 'creator_x',
                    occurredAt: '2025-01-02T00:00:00+00:00',
                    eventType: 'UNLINK',
                  },
                },
              ],
            },
          })
        );
        return r.links.length === 0 && r.refusals.unlinked_x_account === 1;
      })()
    );
    ok(
      'an account with no ledger entry behind it is refused rather than assumed',
      (() => {
        const r = readProfile(
          account({ socialAccountLinkedEvents: { edges: [] } })
        );
        return r.links.length === 0 && r.refusals.unlinked_x_account === 1;
      })()
    );
    /**
     * A username arriving from an OAuth connection is already a real handle,
     * so anything failing the shape test is a parse surprise. It is refused
     * rather than repaired, for the same reason as the name records above: the
     * lenient cleaner would turn it into somebody else's account.
     */
    ok(
      'a username that cannot be a handle is refused, not cleaned into a stranger',
      (() => {
        const r = readProfile(
          account({
            socialAccounts: {
              instagram: null,
              tiktok: null,
              farcaster: null,
              twitter: { username: 'x.com/someone', id: null },
            },
          })
        );
        return r.links.length === 0 && r.refusals.malformed_x_handle === 1;
      })()
    );
  }

  // ------------------------ Creator profiles: removal is a pre-flight, not a filter
  /**
   * Asking a third party about a suppressed address is re-collection whether
   * or not the answer is stored. The address walk knows the addresses before
   * it asks, so it must filter first; the list walk cannot, and filters the
   * pairs instead. Asserted as an ORDERING, because both lines existing in the
   * same file proves nothing about which one runs first.
   */
  {
    const cli = withoutComments(
      readFileSync('scripts/harvest-zora-profiles.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const filtered = cli.indexOf(
      "const askable = wallets.filter( (w) => !isKindSuppressed(sets, 'wallet', w) );"
    );
    const asked = cli.indexOf('payload = await fetchProfile(wallet);');
    ok(
      'the address walk drops suppressed addresses BEFORE it asks about them',
      filtered !== -1 && asked !== -1 && filtered < asked
    );
  }

  // ------------------------------------- Neither corpus can carry a Discord id
  /**
   * A product decision, asserted where it is structurally impossible to
   * violate rather than as a promise in a comment.
   *
   * Three layers, and the first two are the ones that hold. `social_graph` has
   * no column any Discord identity could land in, and `AttestedLink`, the only
   * shape either adapter can hand to the shared ingest, carries a wallet, an X
   * handle and an X account id and nothing else. So even an upstream that
   * started returning Discord accounts tomorrow has nowhere to put one. The
   * third layer is that neither module reads such a field today, which is the
   * weakest of the three on its own: an absence can pass by matching nothing,
   * which is exactly why it is not the assertion this rests on.
   */
  {
    const schema = readFileSync('db/schema.ts', 'utf8');
    const table =
      /export const socialGraph = pgTable\([\s\S]*?\n\);/.exec(schema)?.[0] ??
      '';
    ok(
      'the graph table has no column a Discord identity could be written to',
      table.length > 1000 && !/discord/i.test(table)
    );

    const attested = withoutComments(
      readFileSync('lib/attested-links.ts', 'utf8')
    );
    const fields = [
      ...(
        /export interface AttestedLink \{([\s\S]*?)\n\}/.exec(attested)?.[1] ??
        ''
      ).matchAll(/^\s*([A-Za-z0-9_]+)\??:/gm),
    ].map((m) => m[1]);
    ok(
      'the only shape either corpus can emit carries an X handle and nothing else',
      JSON.stringify(fields) ===
        JSON.stringify(['wallet', 'handle', 'twitterUserId'])
    );

    for (const file of ['lib/basenames.ts', 'lib/zora-profiles.ts']) {
      ok(
        `${file} reads no Discord field`,
        !/discord/i.test(withoutComments(readFileSync(file, 'utf8')))
      );
    }
    /**
     * And on the Basenames side the scan is narrowed at the source: one key
     * hash in the topic filter, one key string read back from the resolver. A
     * wider scan is how a key nobody asked for arrives.
     */
    const basenames = withoutComments(readFileSync('lib/basenames.ts', 'utf8'));
    ok(
      'the name-record scan asks for exactly one text key, at the log filter and at the read',
      basenames
        .replace(/\s+/g, ' ')
        .includes('topics: [TEXT_CHANGED_4, null, [KEY_TWITTER]],') &&
        basenames.includes("const KEY_TWITTER = ethers.id('com.twitter');") &&
        (basenames.match(/com\.twitter/g) ?? []).length === 2
    );
  }

  // ------------------------------------ the published MCP tool count is real
  /**
   * On 2026-09-07 three different numbers were in public circulation: seven on
   * /vs/formo, five in the key modal and in a published post, seven in the
   * OAuth grant rationale, eight everywhere else. The server answers eight,
   * with no credential, to anyone who asks it. An engine asked how many tools
   * the server has could reach three pages giving three answers.
   *
   * Correcting the four sentences was the small half. A ninth tool can be
   * registered today and every one of those sentences stays stale with no
   * diff, nothing failing and nobody to notice: the shape this repo already
   * paid for on the handshake version, which reported 1.0.0 while the public
   * registry had moved to 1.2.0 twice over (CHANGELOG.md:753). So the count is
   * DERIVED from the registrations, and each surface is required to state it.
   *
   * Two halves, and the second is the load-bearing one:
   *
   *   - every number word standing beside `tools` must equal the derived
   *     count, which catches a sentence left behind
   *   - every surface must still carry such a sentence at all, which catches
   *     the easier failure: a reworded or deleted line passing because the
   *     check found nothing to disagree with
   *
   * The copy is read RAW. Two of these surfaces state the count inside a block
   * comment (`lib/oauth/grants.ts` and the header of `app/api/mcp/route.ts`),
   * and those are the sentences a maintainer reads before touching the
   * surface, so they are copy like any other. The derivation reads the source
   * with comments stripped, so a commented-out registration cannot inflate it.
   *
   * CHANGELOG.md is excluded deliberately: "five tools are the six endpoints"
   * is dated history there, and correcting it would falsify the record.
   */
  {
    const names = [
      ...withoutComments(readFileSync('app/api/mcp/route.ts', 'utf8')).matchAll(
        /server\.registerTool\(\s*'(walletlink_[a-z_]+)'/g
      ),
    ].map((m) => m[1]);

    // A count of zero would let every assertion below pass by matching
    // nothing, which is how a regex-derived figure fails silently.
    ok('the MCP server registers tools this check can count', names.length > 0);
    ok(
      'no tool name is registered twice, so the count cannot be inflated',
      new Set(names).size === names.length
    );

    /**
     * Spelled from the same list `CHAIN_COUNT_WORD` is spelled from, read out
     * of lib/public-figures.ts rather than retyped here: that file keeps
     * `COUNT_WORDS` module-private, and a second copy is a second thing to
     * drift. A silent mis-parse would hand back `undefined` and spell the
     * count as a bare numeral, so the parse is proved against the exported
     * constant before it is used.
     */
    const words = [
      ...(
        /const COUNT_WORDS = \[([\s\S]*?)\];/.exec(
          readFileSync('lib/public-figures.ts', 'utf8')
        )?.[1] ?? ''
      ).matchAll(/'([a-z]+)'/g),
    ].map((m) => m[1]);
    const { CHAIN_COUNT_WORD } = await import('@/lib/public-figures');
    ok(
      'the number words parse out of lib/public-figures.ts',
      words[0] === 'zero' && words.length > names.length
    );
    ok(
      'the parsed list is the one the published chain count is spelled from',
      words[SUPPORTED_CHAINS.length] === CHAIN_COUNT_WORD
    );
    const word = words[names.length] ?? String(names.length);

    /**
     * Every place the count is published or explained. Anchored on the plural
     * `tools`, so "bill the caller twice for one tool call" and "one tool that
     * picks the endpoint" are not read as counts, and permitting an optional
     * "MCP" between the two words for `lib/oauth/grants.ts`.
     */
    const surfaces = [
      'app/llms.txt/route.ts',
      'README.md',
      'PROJECT_OVERVIEW.md',
      'docs-site/mcp-server.mdx',
      'app/api/mcp/route.ts',
      'app/vs/formo/page.tsx',
      'content/published/nine-things-to-build.md',
      'components/ApiKeysModal.tsx',
      'lib/oauth/grants.ts',
    ];
    const counted = new RegExp(
      `\\b(${words.join('|')})\\s+(MCP\\s+)?tools\\b`,
      'gi'
    );
    for (const file of surfaces) {
      const stated = [...readFileSync(file, 'utf8').matchAll(counted)].map(
        (m) => m[1].toLowerCase()
      );
      ok(
        `${file} still states how many tools the server has`,
        stated.length > 0
      );
      ok(
        `${file} states the count the server actually registers (${word})`,
        stated.every((s) => s === word)
      );
    }
  }

  // --------------------------- no structured-data date comes from the clock
  /**
   * Removed twice, on both surfaces this now covers, and reintroduced on
   * 2026-09-07 as dates a person wrote beside the edit they made:
   *
   *   - the blog JSON-LD stopped stamping `dateModified` with render time on
   *     2026-08-22 (CHANGELOG.md:2523). It was `new Date()`, so every crawler
   *     was told all 29 posts had been edited today, on every request.
   *   - the six comparison pages stopped stamping it with `new Date()` at
   *     build on 2026-08-30 (CHANGELOG.md:775), which told crawlers every one
   *     of them changed on the day of any deploy.
   *
   * The failure this refuses is invisible in review, because a date field
   * whose value is a clock read looks exactly like one whose value is a fact.
   * So it is asserted as an ALLOWLIST over the value rather than as a scan for
   * `new Date(`: a scan is satisfied by hiding the clock behind a local const,
   * and `app/blog/[slug]/page.tsx` legitimately calls `new Date(...)` a few
   * lines below to render an authored date for a reader.
   *
   * The emitters are discovered rather than listed, so a comparison page added
   * next month is covered on the day it ships.
   */
  {
    const emitters = execSync('git ls-files', { encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.tsx$/.test(f))
      .filter((f) => {
        try {
          return readFileSync(f, 'utf8').includes('application/ld+json');
        } catch {
          return false;
        }
      });
    ok('the structured-data emitters were found at all', emitters.length >= 8);

    const dateField =
      /\b(datePublished|dateModified|dateCreated|uploadDate)\s*:\s*('[^']*'|[A-Za-z_$][\w$.]*)/g;
    // The only reads permitted. Two are dates carried on the post, from
    // frontmatter a person wrote. The third is the holder set's own
    // confirmation day, `max(last_seen_at)` over the imported holdings: it is
    // measured rather than authored, but it is a property of the data and not
    // of the request, so it does not move when nothing changed. It is named
    // rather than inlined precisely so it has to appear here to be used.
    // `new Date().toISOString()` captures as `new`, which is in none of the
    // three, and so is any local const standing in for it.
    const authoredReads = new Set([
      'post.publishedAt',
      'post.updatedAt',
      'holderSetConfirmedIso',
    ]);
    let dated = 0;
    for (const file of emitters) {
      const src = withoutComments(readFileSync(file, 'utf8'));
      for (const [, field, value] of src.matchAll(dateField)) {
        dated++;
        ok(
          `${file}: ${field} is an authored date, never a clock read`,
          /^'\d{4}-\d{2}-\d{2}'$/.test(value) || authoredReads.has(value)
        );
      }
    }

    /**
     * The other half: the loop above passes over a page whose dates were
     * deleted. Each comparison page carries both, and the count is derived
     * from the pages found rather than typed, so dropping one page is a
     * deliberate edit here and losing a date from one is not.
     *
     * The holder reports are deliberately not in this set. Their date is the
     * day the holder set was last confirmed onchain, which every report shows
     * in its copy and publishes as `lastmod`, so it is measured rather than
     * authored and there is no second date to lose. What the loop above still
     * enforces there is the part that matters: that the value comes from the
     * measurement and never from the clock.
     */
    const comparisons = emitters.filter((f) =>
      /^app\/vs\/[^/]+\/page\.tsx$/.test(f)
    );
    ok(
      'the comparison pages are still where this expects them',
      comparisons.length >= 6
    );
    for (const file of comparisons) {
      const src = withoutComments(readFileSync(file, 'utf8'));
      ok(
        `${file} states when it was published and when it was last edited`,
        /datePublished:\s*'\d{4}-\d{2}-\d{2}'/.test(src) &&
          /dateModified:\s*'\d{4}-\d{2}-\d{2}'/.test(src)
      );
    }
    ok(
      'the structured data still carries dates at all',
      dated >= comparisons.length * 2 + 2
    );

    // Spread in, not set to undefined: an unrevised post publishes no
    // modification key rather than a null one.
    const blogPage = withoutComments(
      readFileSync('app/blog/[slug]/page.tsx', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'a post publishes a modification date only when a person wrote one',
      blogPage.includes(
        '...(post.updatedAt ? { dateModified: post.updatedAt } : {}),'
      )
    );

    /**
     * And the reader behind it cannot invent one. Through the code: the posts
     * are parsed, and the number carrying a modification date has to equal the
     * number of files whose frontmatter carries the key. A default of today
     * would make that 29 against 2.
     */
    const { getAllPosts } = await import('@/lib/blog');
    const posts = getAllPosts();
    const revised = posts.filter((p) => p.updatedAt);
    const authored = readdirSync('content/published').filter(
      (f) =>
        f.endsWith('.md') &&
        /^updated_date:/m.test(readFileSync(`content/published/${f}`, 'utf8'))
    );
    ok(
      'every published modification date is written in a post’s frontmatter',
      posts.length > 0 &&
        authored.length > 0 &&
        revised.length === authored.length
    );
    ok(
      'a published date is a day, not a timestamp taken from a clock',
      posts.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.publishedAt)) &&
        revised.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.updatedAt ?? ''))
    );
  }

  /**
   * The match gate cannot be out-earned.
   *
   * The claim in `lib/match-gate.ts` and `lib/credits.ts`: a job on the free
   * allowance delivers exactly the matches it billed, so a curated list of
   * known-good wallets is worth its billing cap and not ten times it (the
   * 2026-09-14 shape: 1 probe wallet, then 224 with a 99% hit rate, 223
   * matches out of a 100-match window). As the attacker: hand the gate a
   * page of pure matches and count what comes back open.
   */
  {
    const { gateResults } = await import('@/lib/match-gate');
    const curated = Array.from({ length: 224 }, (_, i) => ({
      wallet: `0x${String(i).padStart(40, '0')}`,
      twitter_handle: `handle${i}`,
      farcaster: `caster${i}`,
      fc_fid: i,
      priority_score: i,
      ens_name: `name${i}.eth`,
      source: ['graph'],
    }));

    const gate = gateResults(curated, 100);
    ok(
      'a gated job serves exactly the matches it billed, however many it found',
      gate.results.filter((r) => r.twitter_handle || r.farcaster).length ===
        100 && gate.locked === 124
    );
    ok(
      'a locked row carries no billable identity, not a hidden one',
      gate.results
        .slice(100)
        .every(
          (r) =>
            r.locked === true &&
            !('twitter_handle' in r) &&
            !('farcaster' in r) &&
            !('fc_fid' in r) &&
            !('priority_score' in r)
        )
    );
    ok(
      'a locked row keeps what was never billed',
      gate.results.slice(100).every((r) => r.ens_name && r.wallet)
    );

    // Paging is not a reset button: a page that starts past the boundary
    // opens nothing, whatever its own contents.
    const page2 = gateResults(curated.slice(0, 50), 100, 100);
    ok(
      'a paged read past the boundary cannot re-open the gate',
      page2.results.filter((r) => r.twitter_handle || r.farcaster).length ===
        0 && page2.locked === 50
    );

    // And every serve surface actually stands behind the transform. Source
    // level, comments stripped, because a gate that exists but is not called
    // is the bcc lesson again.
    const jobRoute = withoutComments(
      readFileSync('app/api/jobs/[id]/route.ts', 'utf8')
    );
    const historyRoute = withoutComments(
      readFileSync('app/api/history/[id]/route.ts', 'utf8')
    );
    const v1Route = withoutComments(
      readFileSync('app/api/v1/jobs/[id]/route.ts', 'utf8')
    );
    /**
     * A pack is metered, and the near-miss margin has a ceiling.
     *
     * Until this existed the gate armed only on `paidFrom === 'free'`, so a
     * pack job was billed for every match, `drawDown` collected what the lots
     * held and the rest was given away with no row, log or query able to see
     * it. The size of the giveaway was not incidental: `canSubmit` allows ten
     * times the balance in WALLETS, and ten times the wallets is 2.37 times
     * the matches at the measured rate, so a 250-match Trial could be shown
     * about 593 — and the contract importer asked for exactly that ceiling,
     * putting every import on the worst case by construction.
     *
     * Asserted through the real functions, as refusals: the margin is
     * bounded, it is a fraction of the REMAINING balance so it cannot be
     * farmed by an empty account, and the two questions the two bounds answer
     * are kept apart.
     */
    {
      const packs = await import('@/lib/packs');
      ok(
        'the deliverable margin is bounded and scales with what is left',
        // 250 -> 275, never the 593 the enumeration ceiling would have paid.
        packs.deliverableMatches(250) === 275 &&
          packs.deliverableMatches(0) === 0 &&
          packs.deliverableMatches(250) <
            250 * packs.SUBMISSION_MULTIPLIER * packs.MEASURED_MATCH_RATE
      );
      ok(
        'an empty balance cannot pull a list through on goodwill alone',
        // The margin is a fraction of the remainder, so it vanishes with it.
        // A flat margin would leave a spent account able to keep taking it.
        packs.deliverableMatches(0) === 0 &&
          packs.deliverableMatches(10) < packs.deliverableMatches(250)
      );
      ok(
        'the importer sizes on what a balance covers, not on the enumeration bound',
        // 250 matches is ~1,054 wallets at the measured rate, against the
        // 2,500 the anti-enumeration multiplier would have allowed. The two
        // bounds answer different questions and this keeps them apart.
        packs.walletsCoveredBy(250) < 250 * packs.SUBMISSION_MULTIPLIER &&
          packs.walletsCoveredBy(250) ===
            Math.floor(250 / packs.MEASURED_MATCH_RATE) &&
          packs.walletsCoveredBy(0) === 0
      );
      ok(
        'the estimate and the coverage bound are inverses of one rate',
        // Two surfaces disagreeing about what a list will cost is how the
        // buy modal came to know this and the submit path not to.
        packs.expectedMatches(packs.walletsCoveredBy(250)) <= 250 &&
          packs.expectedMatches(1500) ===
            Math.ceil(1500 * packs.MEASURED_MATCH_RATE)
      );

      const credits = readFileSync('lib/credits.ts', 'utf8');
      ok(
        'the debit is capped at the balance on BOTH meters',
        // `paidFrom === 'free' ? Math.min(...) : matches` is the line that
        // billed a pack for more than it held and left `drawDown` to absorb
        // the difference. Asserted as the refusal of that shape.
        /const billed = Math\.min\(matches, balance\.available\)/.test(
          credits
        ) &&
          !/paidFrom === 'free' \? Math\.min\(matches, balance\.available\)/.test(
            credits
          )
      );
      ok(
        'the shortfall from the lots is returned rather than discarded',
        // `owed` was a local the loop stopped using, which is why the
        // giveaway was invisible: nothing downstream could learn it happened.
        /async function drawDown\([^)]*\): Promise<number>/.test(credits) &&
          /return owed;/.test(credits)
      );
      ok(
        'what is given away is recorded on the row rather than inferred',
        /goodwillMatches: goodwill/.test(credits)
      );

      {
        const worker = 'lib/job-processor.ts';
        const src = withoutComments(readFileSync(worker, 'utf8'));
        ok(
          `${worker} gates a paid job as well as a free one`,
          /charge\.delivered < anySocialFound/.test(src) &&
            !/charge\.paidFrom === 'free' && charge\.billed < anySocialFound/.test(
              src
            )
        );
      }
    }

    ok(
      'the job results route gates on matches_delivered',
      jobRoute.includes('gateResults(') && jobRoute.includes('matchesDelivered')
    );
    ok(
      'the history route gates on the mirrored matches_delivered',
      historyRoute.includes('gateResults(') &&
        historyRoute.includes('matchesDelivered')
    );
    ok(
      'the v1 route gates its pages against the whole-job match count',
      v1Route.includes('countMatchedBefore(') &&
        v1Route.includes('lockedOnPage')
    );

    // A gated lookup refuses the merge PATCH, and the refusal stands before
    // the write: the client only ever holds the stripped view, so accepting
    // its payload would overwrite the stored identities for good.
    ok(
      'the history PATCH refuses to write over a gated lookup',
      historyRoute.includes('This lookup has locked matches') &&
        historyRoute.indexOf('This lookup has locked matches') <
          historyRoute.indexOf('updateLookup(')
    );

    // The unlock clears the history mirror before the job column: the job
    // column is the retry ticket, so a clear that dies must stay reachable.
    const unlockRoute = withoutComments(
      readFileSync('app/api/jobs/[id]/unlock/route.ts', 'utf8')
    );
    ok(
      'the unlock clears the mirror while the retry ticket still stands',
      unlockRoute.indexOf('clearLookupGate(') > 0 &&
        unlockRoute.indexOf('clearLookupGate(') <
          unlockRoute.indexOf('matchesDelivered: null')
    );

    /**
     * And staying anonymous is never the better deal. The anonymous gate is
     * per job with no meter behind it, so if it ever rises to the signed-in
     * window, the account gate selects for anonymity: the attacker's move
     * becomes logging out. Asserted against the imported constants, so a
     * future repricing of either side re-litigates this on its own.
     */
    const { ANON_MATCHES_PER_JOB } = await import('@/lib/match-gate');
    const { FREE_MATCHES_PER_WINDOW } = await import('@/lib/packs');
    ok(
      'an anonymous job opens fewer matches than a free account can earn',
      ANON_MATCHES_PER_JOB < FREE_MATCHES_PER_WINDOW
    );

    // The worker applies it, and is the only pipeline (STA-44); the retired
    // Inngest finalize shipped without a billing block once.
    const processorSrc = withoutComments(
      readFileSync('lib/job-processor.ts', 'utf8')
    );
    ok(
      'the worker gates anonymous jobs',
      processorSrc.includes('ANON_MATCHES_PER_JOB')
    );

    /**
     * The hour boundary is not a reset button.
     *
     * A calendar-hour bucket made "3 an hour" mean "3 before :00 and 3 more
     * after": on 2026-09-15 one IP pushed 6 lookup jobs through in 17
     * minutes by filling the 14:xx bucket at 14:58 and starting fresh at
     * 15:01. As the attacker: replay that exact burst against the sliding
     * estimate and require the fourth job refused.
     */
    const { slidingWindowCount } = await import('@/lib/ip-rate-limiter');
    const boundaryReplay = slidingWindowCount(
      3, // the 14:xx bucket they filled by 14:58
      1, // their next request, at 15:01
      new Date(Date.UTC(2026, 8, 15, 15, 1, 12))
    );
    ok(
      'a full previous hour still refuses the next request after the boundary',
      boundaryReplay > 3
    );
    ok(
      'the previous hour decays out instead of vanishing at the boundary',
      slidingWindowCount(3, 1, new Date(Date.UTC(2026, 8, 15, 15, 59, 0))) <=
        3 &&
        slidingWindowCount(3, 0, new Date(Date.UTC(2026, 8, 15, 15, 30, 0))) <
          slidingWindowCount(3, 0, new Date(Date.UTC(2026, 8, 15, 15, 5, 0)))
    );

    /**
     * retryAfter tells the truth. The claim: a caller who waits exactly as
     * told and then sends ONE request is admitted, and never a second
     * sooner. Checked by solving and then replaying: take the burst
     * refusal, wait the advertised seconds, and require the request that
     * lands then to pass and the one a minute earlier to fail.
     */
    const { secondsUntilNextAllowed } = await import('@/lib/ip-rate-limiter');
    {
      const refusedAt = new Date(Date.UTC(2026, 8, 15, 15, 1, 12));
      const wait = secondsUntilNextAllowed(3, 1, 3, refusedAt);
      const admitAt = new Date(refusedAt.getTime() + wait * 1000);
      const early = new Date(admitAt.getTime() - 60 * 1000);
      ok(
        'waiting as told admits the next request',
        slidingWindowCount(3, 1 + 1, admitAt) <= 3
      );
      ok('and not a minute sooner', slidingWindowCount(3, 1 + 1, early) > 3);
    }
    {
      // A bucket inflated past the limit by refused attempts keeps
      // refusing PAST the boundary while it decays; the old top-of-hour
      // answer expired mid-refusal.
      const now = new Date(Date.UTC(2026, 8, 15, 15, 30, 0));
      const wait = secondsUntilNextAllowed(0, 10, 3, now);
      const boundary = 30 * 60;
      ok(
        'an inflated bucket refuses past the hour boundary, and the wait says so',
        wait > boundary
      );
      const admitAt = new Date(now.getTime() + wait * 1000);
      // At the admission moment the old bucket is the decaying one and the
      // request lands as the fresh hour's first unit.
      const f = (admitAt.getUTCMinutes() * 60 + admitAt.getUTCSeconds()) / 3600;
      ok('and admits exactly then', 10 * (1 - f) + 1 <= 3);
    }

    /**
     * And it tells the truth to a caller whose request costs more than one
     * unit. `/api/enrich-fids` counts usernames, so a 100-username retry
     * needs 100 units of headroom; advising the 1-unit wait sends it back
     * early, and every refused attempt inflates the bucket it is waiting
     * on. As the attacker-shaped user: wait exactly as told, retry the SAME
     * batch, and require it admitted.
     */
    {
      const now = new Date(Date.UTC(2026, 8, 16, 10, 20, 0));
      const limit = 300;
      const wait = secondsUntilNextAllowed(0, 250, limit, now, 100);
      const naive = secondsUntilNextAllowed(0, 250, limit, now, 1);
      ok(
        'a multi-unit retry is told to wait longer than a single-unit one',
        wait > naive
      );
      const admitAt = new Date(now.getTime() + wait * 1000);
      const f = (admitAt.getUTCMinutes() * 60 + admitAt.getUTCSeconds()) / 3600;
      // At the admission moment this hour's bucket is the decaying one and
      // the retry lands as the fresh hour's first 100 units.
      ok(
        'and the batch it was holding actually fits when it gets there',
        250 * (1 - f) + 100 <= limit
      );
      ok(
        'a request larger than the whole limit is never promised admission',
        secondsUntilNextAllowed(0, 0, limit, now, limit + 1) >=
          2 * 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds())
      );
      const limiterUnits = withoutComments(
        readFileSync('lib/ip-rate-limiter.ts', 'utf8')
      );
      ok(
        'the limiter passes the units it charged into the wait it advertises',
        /secondsUntilNextAllowed\(\s*previousCount,\s*count,\s*config\.limit,\s*now,\s*units\s*\)/.test(
          limiterUnits
        )
      );
    }

    // The status read predicts the incrementing check, so the two can
    // never disagree in the fractional gap under one unit.
    {
      const t = new Date(Date.UTC(2026, 8, 15, 15, 45, 0));
      const statusAllows = slidingWindowCount(1, 2, t) + 1 <= 3;
      const checkAllows = slidingWindowCount(1, 2 + 1, t) <= 3;
      ok(
        'status and check agree in the fractional gap',
        statusAllows === checkAllows && statusAllows === false
      );
      const limiterSrc = withoutComments(
        readFileSync('lib/ip-rate-limiter.ts', 'utf8')
      );
      ok(
        'the status path actually predicts, and the check path actually solves',
        // Whitespace-tolerant: Prettier wrapped this call across five lines
        // the moment it grew a fifth argument, and a substring match on the
        // one-line form then failed over correct code. A source-level
        // assertion has to survive the formatter that is also enforced in CI.
        limiterSrc.includes('effective + 1 <= config.limit') &&
          /secondsUntilNextAllowed\(\s*previousCount/.test(limiterSrc)
      );
    }

    /**
     * The assistant classifier reads where somebody CAME FROM, not what we
     * called the campaign.
     *
     * A substring search over the whole acquisition summary would read
     * `ref:claude-launch` as an arrival from Claude: that is a campaign we
     * ran about an assistant, and counting it as one would let our own
     * marketing manufacture the channel it is trying to measure. Asserted
     * as the refusal, and through `summariseOrigin` rather than a
     * hand-written string, so the two cannot drift apart.
     */
    const {
      aiAssistantFrom,
      channelFrom,
      summariseOrigin: summarise,
    } = await import('@/lib/first-touch');
    ok(
      'a campaign tag naming an assistant is not an arrival from one',
      aiAssistantFrom(summarise({ ref: 'claude-launch' })) === null
    );
    ok(
      'the referring host on that same campaign still counts',
      aiAssistantFrom(
        summarise({ ref: 'claude-launch', referrer: 'chatgpt.com' })
      ) === 'ChatGPT'
    );
    ok(
      'a utm_source an assistant sets is read',
      aiAssistantFrom(
        summarise({ source: 'chatgpt.com', referrer: 'chatgpt.com' })
      ) === 'ChatGPT'
    );
    ok(
      'an ordinary referrer is not an assistant',
      aiAssistantFrom(summarise({ referrer: 'warpcast.com' })) === null &&
        aiAssistantFrom(summarise({})) === null
    );
    ok(
      'a lookalike host does not pass for the real one',
      aiAssistantFrom(summarise({ referrer: 'notchatgpt.com' })) === null &&
        aiAssistantFrom(summarise({ referrer: 'chatgpt.com.evil.test' })) ===
          null
    );
    ok(
      'a subdomain of a known assistant does count',
      aiAssistantFrom(summarise({ referrer: 'www2.perplexity.ai' })) ===
        'Perplexity'
    );

    /**
     * The channel classifier inherits the same trap, three rosters wide.
     *
     * `aiAssistantFrom` already refuses to read a campaign tag as an arrival.
     * `channelFrom` consults search engines and social platforms as well, so
     * the same mistake now has two more spellings: `ref:google-ads` is not a
     * Google search and `ref:farcaster-push` is not a Farcaster referral. Each
     * would let our own marketing manufacture the organic channel it exists to
     * measure, and each would look entirely plausible in the table.
     */
    ok(
      'a campaign tag naming a search engine is not a search arrival',
      channelFrom(summarise({ ref: 'google-ads' })).channel === 'campaign'
    );
    ok(
      'a campaign tag naming a platform is not an arrival from it',
      channelFrom(summarise({ ref: 'farcaster-push' })).channel === 'campaign'
    );
    /**
     * Unattributed is not direct.
     *
     * 1,489 of the 30 days to 2026-09-16 carry no origin at all, because the
     * tracker shipped after the arrivals that produced them. Folding those into
     * `direct` would invent a direct channel four times the size of the real
     * one, and every rate underneath it would be wrong in the flattering
     * direction. Nothing would error.
     */
    ok(
      'an arrival with nothing recorded is unknown, not direct',
      channelFrom(null).channel === 'unknown' &&
        channelFrom('').channel === 'unknown'
    );
    ok(
      'a measured direct arrival is direct',
      channelFrom(summarise({})).channel === 'direct'
    );
    ok(
      'a lookalike host does not pass for a search engine',
      channelFrom(summarise({ referrer: 'googleusercontent.com' })).channel ===
        'referral' &&
        channelFrom(summarise({ referrer: 'notgoogle.com' })).channel ===
          'referral'
    );
    ok(
      'a country domain of a search engine still counts',
      channelFrom(summarise({ referrer: 'google.co.uk' })).name === 'Google'
    );
    /**
     * Bing and DuckDuckGo are search, deliberately, and this is the assertion
     * that keeps the two rosters from quietly merging. Both serve assistant
     * answers on the same host as ordinary results, so counting them as
     * assistants would inflate the one channel whose small numbers are the
     * whole reason to watch it.
     */
    ok(
      'Bing is search and not an assistant',
      channelFrom(summarise({ referrer: 'bing.com' })).channel === 'search' &&
        aiAssistantFrom(summarise({ referrer: 'bing.com' })) === null
    );
    ok(
      'a measured platform beats the tag we put on the link ourselves',
      channelFrom(summarise({ ref: 'day-3', referrer: 'farcaster.xyz' }))
        .channel === 'social'
    );
    /**
     * The growth ledger goes through the classifier, not around it.
     *
     * A CASE expression naming hosts in SQL would be a second copy of the
     * roster, and drift between the two is undetectable by inspection: a
     * misclassified channel produces a plausible number rather than an error.
     */
    const growthSrc = withoutComments(readFileSync('lib/growth.ts', 'utf8'));
    ok(
      'the growth rollups classify with the shared function',
      growthSrc.includes('channelFrom(') &&
        !/CASE[\s\S]{0,400}(chatgpt|google|farcaster)/i.test(growthSrc)
    );
    /**
     * The growth ledger reads the narrow views and never the tables under
     * them.
     *
     * `scripts/migrate-growth-views.ts` argues that CI can read growth numbers
     * without being granted `users` or `analytics_events`, both of which carry
     * an email address. That argument holds only while every query here names a
     * view. Repointing one at a base table would keep working locally, where
     * the owner role reads everything, and the privacy boundary would be gone
     * with nothing to say so.
     */
    const reportSrc = withoutComments(
      readFileSync('scripts/growth-report.ts', 'utf8')
    );
    ok(
      'the growth ledger reads only the narrow views',
      growthSrc.includes('growth_page_events') &&
        growthSrc.includes('growth_accounts') &&
        !/\bFROM\s+analytics_events\b/.test(growthSrc) &&
        !/\bFROM\s+users\b/.test(growthSrc) &&
        // The report runs the same query for its own caveat, and its catch
        // swallows a permission error into a missing warning rather than a
        // failure. Same rule, and it is the file where breaking it is quiet.
        !/\bFROM\s+analytics_events\b/.test(reportSrc) &&
        !/\bFROM\s+users\b/.test(reportSrc)
    );
    /**
     * And the boundary is not undone from the other end: neither table may be
     * added to the read-only grant list. Asserted as the refusal, because
     * adding one is a two-word edit that nothing else would notice.
     */
    const grantSrc = withoutComments(
      readFileSync('scripts/migrate-grant-readonly.ts', 'utf8')
    );
    const readOnlyList = grantSrc.slice(
      grantSrc.indexOf('const READ_ONLY_TABLES'),
      grantSrc.indexOf('const BACKUP_TABLES')
    );
    ok(
      'the CI role is not granted the tables holding email addresses',
      readOnlyList.length > 100 &&
        !/'users'/.test(readOnlyList) &&
        !/'analytics_events'/.test(readOnlyList)
    );
    /**
     * The seed-coverage alarm needs its grant, and losing it is silent.
     *
     * `getSeedCoverage` reads `seeded_contracts`, and its catch returns
     * `ok: false`, which the report reads as "skip this section". So a missing
     * grant does not fail the weekly run: it deletes the alarm and leaves a
     * green build. That is the exact shape of the failure this section exists
     * to catch, which spent sixteen days invisible for the same reason.
     */
    /**
     * Anonymous throughput is bounded PER UNIT TIME, not per job.
     *
     * The old invariant compared a per-job gate with a per-window allowance,
     * which are not comparable quantities, so it reported clean while anonymous
     * callers could take 3 jobs an hour times 50 matches, about 3,600 a day,
     * for ever, against a signed-in free account's 100 per 30 days. Signing in
     * made the product a thousand times worse and the meter said nothing.
     */
    const gateMod = await import('@/lib/match-gate');
    const limiterMod = await import('@/lib/ip-rate-limiter');
    const packsMod = await import('@/lib/packs');

    const anonPerDay = gateMod.ANON_MATCHES_PER_DAY;
    const anonPerJob = gateMod.ANON_MATCHES_PER_JOB;
    const IP_RATE_LIMITS = limiterMod.IP_RATE_LIMITS;
    const jobsPerHour = IP_RATE_LIMITS['/api/jobs'].limit;
    /**
/**
     * The keyless lookup never becomes a batch endpoint.
     *
     * An array parameter is how a single-address endpoint grows into the thing
     * that is sold, and the first version took `.trim()` on whatever arrived,
     * so a posted array was a 500 rather than a 400. A 500 on malformed input
     * is how a prober learns which shapes are unhandled.
     */
    const walletToolSrc = withoutComments(
      readFileSync('app/api/wallet-socials/route.ts', 'utf8')
    );
    ok(
      'the keyless lookup accepts one address, typed, never an array',
      /typeof body\.address === 'string'/.test(walletToolSrc) &&
        !/body\.addresses/.test(walletToolSrc)
    );
    /**
     * It withholds what a pack is sold on. `lib/job-processor.ts` strips
     * follower counts and priority score from every job without `paidData`,
     * which is every anonymous and free job, so a keyless route returning them
     * would hand a stranger a field the signed-in free tier does not get.
     */
    ok(
      'the keyless lookup withholds the paid fields',
      !/fcFollowers|priority_score|priorityScore|x_followers|xFollowers/.test(
        walletToolSrc
      )
    );
    /**
     * And it fails CLOSED on suppression. Answering while the removal list is
     * unreadable is how a removed identity gets served once, which is the one
     * failure this surface must never have.
     */
    ok(
      'the keyless lookup refuses to answer when suppression is unreadable',
      /loadSuppressionList\(\)/.test(walletToolSrc) &&
        /SERVICE_UNAVAILABLE/.test(walletToolSrc)
    );
    /**
     * The daily floor is ADDED to the shared cap, never maxed against it.
     * `Math.max(50, 5)` is 50, which is no floor at all: the tool page would
     * read zero the moment the jobs rail drained the day.
     */
    const limiterSrc = withoutComments(
      readFileSync('lib/ip-rate-limiter.ts', 'utf8')
    );
    ok(
      'the free-lookup floor is added to the shared cap, not maxed against it',
      /ANON_MATCHES_PER_DAY \+ \(options\?\.floor \?\? 0\)/.test(limiterSrc)
    );

    /**
     * Every page can be skipped into, and the theme is decided before paint.
     *
     * WCAG 2.4.1 Bypass Blocks is Level A and was unmet on 19 of 20 pages: a
     * keyboard user passed four repeated header stops before reaching anything
     * the page was about. And ThemeProvider applies its class in an effect,
     * which runs after the server HTML has painted, so every visitor resolving
     * to dark met a full-page flash of the light palette on each cold
     * navigation.
     */
    const shellSrc = readFileSync('components/ui/page-shell.tsx', 'utf8');
    ok(
      'every page shell opens with a skip link into a real target',
      /href="#main"/.test(shellSrc) && /id="main"/.test(shellSrc)
    );
    const layoutSrcUi = readFileSync('app/layout.tsx', 'utf8');
    ok(
      'the theme is resolved before first paint, not in an effect',
      /classList\.add\(d\?'dark':'light'\)/.test(layoutSrcUi)
    );
    /**
     * And it resolves the SAME way ThemeProvider does. A copy of this rule
     * that read the media query first would disagree with the provider for
     * anyone who chose light on a dark machine, which is the one case the
     * stored value exists to serve.
     */
    ok(
      'the pre-paint resolve reads the stored choice before the media query',
      layoutSrcUi.indexOf("localStorage.getItem('theme')") <
        layoutSrcUi.indexOf('prefers-color-scheme: dark')
    );
    const cssSrcUi = readFileSync('app/globals.css', 'utf8');
    /**
     * Native widgets follow the theme. Without `color-scheme` a checkbox, a
     * radio and a scrollbar render light on a dark page, because they do not
     * read our tokens.
     */
    ok(
      'the dark block tells the browser its own widgets are dark',
      /color-scheme:\s*dark/.test(cssSrcUi)
    );
    /**
     * Only faces that are used are declared. `font-extrabold` had no uses at
     * all, and every `font-bold` hit in the tree is a comment recording its
     * own removal.
     */
    ok(
      'no font face is declared for a weight nothing uses',
      !/soehne-fett\.woff2/.test(cssSrcUi) &&
        !/soehne-dreiviertelfett\.woff2/.test(cssSrcUi)
    );

    /**
     * An anonymous buyer can get back to the lookup they paid to open.
     *
     * `currentJobId` is cleared the moment a job completes, and completion is
     * exactly when a gated result appears. The buy button then leaves the page,
     * so a visitor who met the match gate and either paid or cancelled returned
     * to a homepage with no memory of the lookup. History cannot recover it:
     * that route needs a session and checkout takes no account.
     *
     * Asserted as the pairing, because a hint that is remembered and never
     * cleared is its own bug: it would reinstate an old gated lookup over
     * whatever the visitor does next.
     */
    const homeSrcGate = readFileSync('app/page.tsx', 'utf8');
    ok(
      'a gated job is remembered when something is actually locked',
      /rememberGatedJob\(jobId\)/.test(homeSrcGate) &&
        /lockedMatches \?\? 0\) > 0/.test(homeSrcGate)
    );
    ok(
      'and forgotten on every path that moves on',
      (homeSrcGate.match(/forgetGatedJob\(\)/g) ?? []).length >= 4
    );
    /**
     * The restore refuses a payload it cannot honour. Job payloads are purged
     * at 30 days while the row survives, so a bare completed row would paint an
     * empty results screen over the upload form somebody came here to use.
     */
    ok(
      'the restore requires rows and a live gate, not merely a completed job',
      /data\.status !== 'completed' \|\|\s*!data\.results\?\.length/.test(
        homeSrcGate
      ) && /GATED_MAX_AGE_MS/.test(homeSrcGate)
    );

    /**
     * A withheld match is counted as found, everywhere a count is stated.
     *
     * `locked` means the row matched and the free allowance had nothing left
     * to bill it against, so the billable identities were stripped on the way
     * out. It means found-and-withheld. Every count in the product read it as
     * not-found, because every count was its own filter on `twitter_handle ||
     * farcaster`, and those are exactly the fields the gate removes.
     *
     * The damage was not cosmetic. The share text published a match rate
     * lower than the product achieved, on the surface that brings other people
     * here, so the gate was cutting the product's own social proof. The CSV
     * had no column for it, so a locked row left the building looking like a
     * wallet that never published anything: the file told the customer
     * something untrue about their own list.
     *
     * Asserted as the refusal in both directions. The counts must come from
     * the one authority, AND the surface that shows `found` must show
     * `locked` beside it, because a figure that counts withheld rows without
     * saying any are withheld is the same dishonesty pointing the other way.
     */
    /**
     * Run through the function, not over its source.
     *
     * `countResults` is pure and importable, so there is no reason to assert
     * a regex about how it is written, and one very good reason not to: the
     * first version of this block asserted `const found = reachable + locked`
     * and that line was the bug. `locked` and `reachable` are NOT disjoint,
     * because the gate strips only the billable identities and leaves ENS,
     * Lens and GitHub in place, so a locked row carrying an ENS name sits in
     * both sets and the sum published it twice. The assertion was defending
     * the defect, which is the third time that shape has appeared in this
     * repo.
     *
     * The row below is the exact counterexample: withheld, and still visibly
     * carrying a Lens profile.
     *
     * `lens`, not `ens_name`, and the first draft of this test got that wrong
     * and failed honestly. `reachable` has always counted an X handle, a
     * Farcaster account, Lens or GitHub; an ENS name alone has never been in
     * it. So an ENS-carrying locked row is not in both sets and proves
     * nothing. Lens and GitHub are the two the gate leaves behind that
     * `reachable` does count, and they are where the double count lived.
     */
    const { countResults } = await import('@/lib/result-counts');
    const gatedWithLens = countResults([
      { wallet: '0x1', lens: 'a.lens', locked: true },
      { wallet: '0x2', twitter_handle: 'b' },
      { wallet: '0x3' },
    ] as never);
    ok(
      'a locked row counts towards found, not against it',
      gatedWithLens.found === 2 && gatedWithLens.locked === 1
    );
    ok(
      'and a locked row that still shows a Lens profile is counted once, not twice',
      // reachable = the Lens row + the handle row = 2; locked = 1; a naive
      // `reachable + locked` says 3 for a three-row list holding two finds.
      gatedWithLens.reachable === 2 && gatedWithLens.found === 2
    );
    ok(
      'the match rate counts withheld rows, so a gate cannot deflate it',
      countResults([
        { wallet: '0x1', locked: true },
        { wallet: '0x2' },
      ] as never).matchRate === '50.0'
    );
    const countsSrc = withoutComments(
      readFileSync('lib/result-counts.ts', 'utf8')
    );
    const resultStatsSrc = withoutComments(
      readFileSync('components/StatsCards.tsx', 'utf8')
    );
    ok(
      'the results figure comes from the shared count, not its own filter',
      resultStatsSrc.includes('countResults(results)') &&
        !/results\.filter/.test(resultStatsSrc)
    );
    ok(
      'and a figure that counts withheld rows says how many are withheld',
      /stats\.found/.test(resultStatsSrc) &&
        /stats\.locked > 0/.test(resultStatsSrc)
    );
    const shareSrc = withoutComments(
      readFileSync('components/ShareButtons.tsx', 'utf8')
    );
    /**
     * Two separate overstatements have shipped from this file, in opposite
     * directions: `(twitter + farcaster) / total` double-counted anyone with
     * both, and the fix for that inherited the caller's gate-stripped
     * predicate. It takes the whole count set now, so there is nothing here
     * to get wrong a third time.
     */
    ok(
      'the shared figures are the found ones, computed nowhere in this file',
      /counts: ResultCounts/.test(shareSrc) &&
        shareSrc.includes('${found.toLocaleString()} found') &&
        !/\.filter\(/.test(shareSrc)
    );
    const exportSrc = withoutComments(
      readFileSync('components/ExportButton.tsx', 'utf8')
    );
    /**
     * The CSV names it. Without this column a locked row is byte-for-byte a
     * wallet with nothing published, and the customer has no way to learn
     * otherwise from the file they were handed.
     */
    ok(
      'the CSV carries a column saying which rows were withheld',
      /'locked',/.test(exportSrc) && /locked: result\.locked/.test(exportSrc)
    );

    /**
     * "Save this lookup" cannot be promised without somewhere to save it.
     *
     * The box was checked by default and signed out it saved nothing that
     * could ever be read: the job wrote a `lookup_history` row keyed to the
     * anonymous browser uuid, `/api/history` answers 401 without a session
     * and filters by the session's user id when it has one, and no path
     * adopts the row on sign-up.
     *
     * The costly half was second-order. The `beforeunload` guard stays quiet
     * when a forward lookup is saved, which is correct, so a checked box that
     * saved nothing also switched off the warning that this was the last
     * chance to export. Both halves are asserted, because fixing only the
     * copy would leave the data loss exactly where it was.
     */
    const homeSrcSave = withoutComments(readFileSync('app/page.tsx', 'utf8'));
    /**
     * Read out of the `submitJob` calls themselves, not off a loose grep.
     *
     * The first version of this asserted that the string `saveToHistory,` did
     * not appear on its own line anywhere in the file, which is true of a
     * payload field and equally true of a `useCallback` dependency array. It
     * failed on two dependency arrays that were entirely correct. An
     * assertion that cannot tell the thing it protects from the thing beside
     * it is the kind that gets weakened until it passes.
     */
    const submitCalls =
      homeSrcSave.match(/submitJob\(\{[\s\S]*?\n\s*\}\)/g) ?? [];
    const saving = submitCalls.filter((c) => /saveToHistory/.test(c));
    ok(
      'a lookup is only submitted as saved when there is an account to save it to',
      saving.length >= 2 &&
        saving.every((c) => /saveToHistory:\s*willSave/.test(c)) &&
        (
          homeSrcSave.match(
            /const willSave = saveToHistory && canSaveHistory;/g
          ) ?? []
        ).length >= 2
    );
    /**
     * The guard asks what WAS saved, never what could be saved now.
     *
     * Reading the live auth state there had it backwards in the one case it
     * matters: `/?collection=…` submits on mount while `useAuth` is still
     * loading, so a signed-in visitor on such a link sent
     * `saveToHistory: false` and stored nothing, then auth resolved and the
     * warning went quiet over a result that was never saved. Signing in after
     * a signed-out run does the same to the run already on screen.
     */
    ok(
      'and a save that cannot happen does not suppress the unload warning',
      /const savedForward = savedThisRun && reverseMeta === null;/.test(
        homeSrcSave
      ) && /setSavedThisRun\(willSave\)/.test(homeSrcSave)
    );

    /**
     * A lookup that matched nothing says why, and says it from the constants.
     *
     * A zero-result list used to render the ordinary results screen: a hero
     * reading "0 found of N wallets" over a table of dashes, and nothing
     * else. Every word was accurate, and the only conclusion available to the
     * reader was that the product does not work. It is the worst moment in
     * the funnel to say nothing, because it is the one where somebody decides
     * whether to come back.
     *
     * The second assertion is the one that will actually fire one day. The
     * panel quotes measured per-chain rates, and a rate typed into a
     * component is a rate that survives the next re-measure: that is the
     * failure `lib/public-figures.ts` exists to prevent, and the check that
     * compares published figures against the database cannot see a literal it
     * was never told about. Deriving is the only version that stays true.
     */
    const noMatchSrc = readFileSync('components/NoMatchesFound.tsx', 'utf8');
    ok(
      'a zero-match lookup explains itself rather than showing an empty table',
      /export function NoMatchesFound/.test(noMatchSrc) &&
        /resultCounts\.found === 0 && results\.length > 0/.test(
          readFileSync('app/page.tsx', 'utf8')
        )
    );
    ok(
      'and it derives its rates from public-figures rather than typing them',
      /CHAIN_MATCH_RATES/.test(noMatchSrc) &&
        !/\b(?:46\.2|16\.6|30\.8)\b/.test(withoutComments(noMatchSrc))
    );
    /**
     * Its recovery actions have to land somewhere, and the first version of
     * this assertion checked the wrong thing.
     *
     * It asserted the id `starter-collections` appears in `app/page.tsx`. It
     * did, and the link was still dead: that section is inside the `upload`
     * block, and this panel renders under `complete`, so at the moment
     * somebody clicked, the target did not exist. The hash changed, the page
     * scrolled nowhere, and nothing errored, because a dead in-page anchor
     * has no 404 behind it. The assertion checked "the id exists somewhere in
     * the file" when what mattered was "the id is mounted in the state this
     * renders in", and a grep cannot see the second one.
     *
     * So the design moved to one a grep CAN check. The panel takes a
     * callback, the page resets to `upload` and scrolls once the section has
     * mounted, and this asserts the panel contains no in-page hash link at
     * all. When an assertion cannot reach the property you want, the useful
     * move is often to change the design until it can.
     */
    ok(
      'the zero-match panel offers callbacks, never an in-page anchor',
      !/href=["'][^"']*#/.test(noMatchSrc) &&
        /onBrowseCollections/.test(noMatchSrc)
    );

    /**
     * A page that quotes a price offers a way to pay it.
     *
     * Six comparison pages rendered the whole price sheet and ended on prose:
     * PackPricing had no button, no link and no click handler, and the header
     * is not sticky, so the only buy affordance had scrolled off by the time a
     * reader reached the prices. The CTA now lives in the panel itself, once,
     * which is why /pricing no longer renders its own.
     */
    const packPricingSrc = withoutComments(
      readFileSync('components/PackPricing.tsx', 'utf8')
    );
    ok(
      'the price panel carries its own way to buy',
      packPricingSrc.includes('BuyCreditsButton')
    );
    /**
     * And the recommendation badge means what it says. It used to pick by
     * submission headroom alone, so a pack could accept a file and then run
     * out of credits inside it: a 13,294-wallet list, the largest job ever
     * run, was marked "Fits your list" on a pack whose own card said
     * "≈ 6,300 wallets" two lines below.
     */
    const modalSrc = withoutComments(
      readFileSync('components/UpgradeModal.tsx', 'utf8')
    );
    ok(
      'the fit badge tests matches as well as submission headroom',
      /PACKS\[id\]\.matches >= expectedMatches/.test(modalSrc) &&
        /Closest fit/.test(modalSrc)
    );

    /**
     * The per-match ladder is DERIVED, never typed.
     *
     * CLAUDE.md makes lib/packs.ts the only place a price lives. A discount
     * written into a component is a second price sheet, free to drift from the
     * first the moment either number moves, and the drift would be invisible:
     * a wrong percentage renders as confidently as a right one.
     */
    const packsMod2 = await import('@/lib/packs');
    ok(
      'the smallest pack shows no saving against itself',
      packsMod2.savingsVsSmallestPack('trial') === 0
    );
    ok(
      'every larger pack is genuinely cheaper per match',
      packsMod2.savingsVsSmallestPack('campaign') > 0 &&
        packsMod2.savingsVsSmallestPack('scale') >
          packsMod2.savingsVsSmallestPack('campaign') &&
        packsMod2.savingsVsSmallestPack('index') >
          packsMod2.savingsVsSmallestPack('scale')
    );
    for (const src of [
      'components/UpgradeModal.tsx',
      'components/PackPricing.tsx',
    ]) {
      const componentSrc = withoutComments(readFileSync(src, 'utf8'));
      ok(
        `${src} computes the saving rather than printing a literal`,
        componentSrc.includes('savingsVsSmallestPack(') &&
          !/\b(43|57|69)%/.test(componentSrc)
      );
    }

    /**
     * The two agent facts are never conflated.
     *
     * `KNOWN_AGENTS` is the detector's catalog (13,622, harvested from Virtuals
     * and friends) and `AGENT_WALLETS_FLAGGED` is how many wallets in our own
     * index carry the flag (242). Both true, 56-fold apart, and answering
     * different questions. `/llms.txt` published the catalog under the flagged
     * label, on the file answer engines read, and `/api/public-stats` returned
     * one or the other under a single key depending on which branch ran.
     */
    const llmsSrc = readFileSync('app/llms.txt/route.ts', 'utf8');
    ok(
      'llms.txt does not describe the agent catalog as flagged wallets',
      !/\$\{KNOWN_AGENTS\}\+? wallets are flagged/.test(llmsSrc)
    );
    const statsSrc = withoutComments(
      readFileSync('app/api/public-stats/route.ts', 'utf8')
    );
    ok(
      'public-stats falls back to the same agent fact its live branch returns',
      /agents:\s*figure\(AGENT_WALLETS_FLAGGED\)/.test(statsSrc) &&
        !/agents:\s*figure\(KNOWN_AGENTS\)/.test(statsSrc)
    );
    /**
     * And the hero sentence survives text extraction. `aria-label` on an SVG is
     * announced by a screen reader and invisible to Readability, so the most
     * quoted sentence on the domain extracted as "Turn a wallet list into the
     * and Farcaster accounts behind it".
     */
    const homeSrc = readFileSync('app/page.tsx', 'utf8');
    ok(
      'the hero names X in text, not only in an aria-label',
      /<span className="sr-only">X<\/span>/.test(homeSrc)
    );

    /**
     * The X list outcome is mounted where the callback can actually reach it.
     *
     * `/api/x/callback` redirects to the site root carrying `x_list`, and the
     * homepage boots there in `upload` with `results` empty. `XListStatus`
     * sat inside the `state === 'complete' && results.length > 0` branch,
     * which reads correctly beside the results it describes and cannot ever
     * run: the round trip discards that state on its way through x.com. A
     * list job takes about sixteen minutes and then reported nothing to
     * anybody, on every run.
     *
     * Asserted positionally, because the defect is placement rather than
     * absence: the component was present the whole time, so an assertion that
     * it exists would have passed throughout.
     *
     * It must appear before EVERY state branch, and the `upload` one carries
     * the real requirement rather than merely completing the set: that is the
     * state a callback lands in, and everything that branch renders (the
     * hero, the three input methods, the starter collections, the reverse
     * lookup, the recent wins) is above the fold of a
     * screen somebody has just been returned to the top of. Mounting this
     * unconditionally but below them is the halfway version of the same bug,
     * and it is the one that looks fixed.
     *
     * Every marker must exist before the comparisons mean anything, so a
     * rename fails loudly here rather than passing over a check it never
     * performed.
     */
    /**
     * The saved-lookups list has one home, and nothing links to its old one.
     *
     * It used to be mounted on the homepage behind `id="my-lookups"`, and both
     * `/success` and `/dashboard` routed to that anchor. The list moved to
     * `/dashboard` and a saved lookup opens at `/?lookup=<id>`; the anchor is
     * gone.
     *
     * Asserted as the refusal, because a dead in-page anchor is the quietest
     * failure in a browser: the hash changes, the page scrolls nowhere, and
     * nothing errors. The `/success` link is the expensive one, since it is
     * what a buyer sees immediately after paying to unlock a gated lookup.
     *
     * The second half is what keeps the card from quietly acquiring two homes
     * again, which is the state this change ended: if `app/page.tsx` imports
     * it, somebody has remounted it there.
     */
    {
      const sources = readdirSync('app', { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
        .map((f) => `app/${f}`)
        .concat(
          readdirSync('components', { recursive: true })
            .map(String)
            .filter((f) => f.endsWith('.tsx'))
            .map((f) => `components/${f}`)
        );

      /**
       * Comments are stripped first. Two of the files that used to link here
       * now explain in prose that they no longer do, and a check that cannot
       * tell an explanation from a link is a check people learn to silence.
       * `withoutComments` is the same tool the rest of this file uses for it.
       */
      const linkers = sources.filter((f) =>
        withoutComments(readFileSync(f, 'utf8')).includes('my-lookups')
      );
      ok(
        'nothing links or scrolls to the retired #my-lookups anchor',
        sources.length > 50 && linkers.length === 0
      );

      ok(
        'the homepage does not mount the saved-lookups card',
        !homeSrc.includes('LookupHistory')
      );

      const dashSrc = readFileSync('app/dashboard/page.tsx', 'utf8');
      ok(
        'the dashboard mounts the saved-lookups card, which is now its only home',
        dashSrc.includes('<LookupHistory') &&
          dashSrc.includes("from '@/components/LookupHistory'")
      );

      /**
       * And a row opens the lookup rather than a list of lookups. The old
       * handler pushed an anchor and discarded the id it had been handed,
       * which is exactly what made the click a no-op once the anchor went.
       */
      ok(
        'a dashboard row opens a saved lookup by id',
        /router\.push\(`\/\?lookup=\$\{encodeURIComponent\(lookupId\)\}`\)/.test(
          dashSrc
        )
      );

      /**
       * And it takes the id WITHOUT fetching the rows first.
       *
       * `onLoadLookup` makes the component fetch and hand over the results;
       * a caller that only navigates would discard them. That is not a spared
       * request: `GET /api/history/[id]` marks the lookup viewed, and
       * `enrichedWallets` is measured from that timestamp, so fetching twice
       * compares "new since last look" against a moment ago and the paid
       * new-match highlights never appear. `onSelectLookup` short-circuits
       * before the fetch, and the component must keep offering that door.
       */
      ok(
        'the dashboard selects a lookup without fetching rows it would discard',
        dashSrc.includes('onSelectLookup={') &&
          readFileSync('components/LookupHistory.tsx', 'utf8').includes(
            'if (onSelectLookup) {'
          )
      );

      /**
       * `?lookup=` is cleared everywhere the screen stops showing that lookup.
       *
       * The deep link does not clear it on read, deliberately: it is the
       * address of what is on screen rather than a payload that must not
       * replay. That bargain only holds if it stops naming a lookup the moment
       * one is no longer displayed. Left behind, it outlives the thing it
       * addresses, and the next refresh is worse than not having the feature:
       * the mount restore bails on `lookup=` by design, so instead of
       * recovering the job in progress the page reopens a lookup the person
       * had moved on from.
       *
       * Asserted as ONE rule keyed on what is displayed, not as a list of the
       * ways to leave. The first version of this enumerated three exits, and
       * review found a fourth it had missed on the same day ("Create new
       * lookup instead"), with the contract importer and the paste path behind
       * it. A list of the ways to leave a screen is never finished; the
       * condition for being on it is, so the check is that the condition is
       * what the code reads.
       *
       * Two call sites exactly: the effect that enforces the rule, and the
       * deep link's own failure path, which cannot wait for the effect because
       * a failure changes no state and would not re-run it. A third would mean
       * somebody had gone back to patching exits one at a time.
       */
      const clears = [...homeSrc.matchAll(/forgetLookupParam\(\);/g)].length;
      const flat = homeSrc.replace(/\s+/g, ' ');
      ok(
        'the lookup parameter is dropped by one rule about what is on screen, not per exit',
        clears === 2 &&
          flat.includes(
            'if (lookupDeepLinkPending.current) return; if (currentLookupId) return; forgetLookupParam(); }, [currentLookupId]);'
          )
      );

      /**
       * The flag that guards it is read during render, not set in an effect.
       *
       * This effect runs on mount and the deep-link effect waits for the
       * session first, so a flag set there is set too late: the parameter is
       * deleted before anything reads it and every dashboard row becomes a
       * silent no-op, which is the bug this whole change exists to fix. The
       * earlier version did exactly that.
       */
      ok(
        'the deep-link guard is armed from the URL before any effect runs',
        /const lookupDeepLinkPending = useRef\(\s*typeof window !== 'undefined' &&\s*new URLSearchParams\(window\.location\.search\)\.has\('lookup'\)\s*\)/.test(
          homeSrc
        )
      );

      /**
       * And a new run stops claiming to be the saved lookup it replaced.
       *
       * `currentLookupId` is what the rule above reads, and it is also what
       * gates Rename and Add addresses. Until this it survived a new run, so
       * both stayed bound to a lookup nobody was looking at and the URL went
       * on naming it. Three sites clear it: reset, a new lookup, and a starter
       * collection. Growing a lookup deliberately does not, because the same
       * lookup is still on screen, and that is the case the rule has to keep.
       */
      ok(
        'a new run stops claiming the saved lookup it replaced',
        [...homeSrc.matchAll(/setCurrentLookupId\(null\);/g)].length >= 4
      );
    }

    {
      const statusMount = homeSrc.indexOf('<XListStatus />');
      const uploadBranch = homeSrc.indexOf("{state === 'upload'");
      const processingBranch = homeSrc.indexOf("{state === 'processing'");
      const completeBranch = homeSrc.indexOf("{state === 'complete'");
      ok(
        'the X list outcome is mounted above every state branch, so a callback return shows it first',
        statusMount > 0 &&
          uploadBranch > 0 &&
          processingBranch > 0 &&
          completeBranch > 0 &&
          statusMount < uploadBranch &&
          statusMount < processingBranch &&
          statusMount < completeBranch
      );
    }

    ok(
      'anonymous daily throughput is capped below the uncapped per-job product',
      anonPerDay < jobsPerHour * 24 * anonPerJob
    );
    ok(
      'the anonymous day is not larger than a whole signed-in free window',
      anonPerDay <= packsMod.FREE_MATCHES_PER_WINDOW * packsMod.FREE_WINDOW_DAYS
    );
    /**
     * `windowHours` is decorative: the limiter hardcodes 3600 in both
     * `slidingWindowCount` and `secondsUntilNextAllowed` and reads the elapsed
     * fraction off getUTCMinutes, so 1 is the only value it implements. Writing
     * 24 there would silently buy a one-hour window, which is why the anonymous
     * day is a separate day-keyed counter. Asserted so the field cannot start
     * lying.
     */
    ok(
      'every hourly limiter entry really is hourly',
      Object.values(IP_RATE_LIMITS).every((c) => c.windowHours === 1)
    );
    /**
     * The delivery pipeline reads the reserved gate. The retired Inngest copy
     * billed nothing at all once because it mirrored a type by hand instead
     * of importing it; the worker is the only pipeline now (STA-44), so this
     * asserts the constant is no longer the value it assigns.
     */
    const workerSrc = withoutComments(
      readFileSync('lib/job-processor.ts', 'utf8')
    );
    ok(
      'the worker no longer hands out the flat per-job constant',
      !/matchesDelivered\s*=\s*ANON_MATCHES_PER_JOB/.test(workerSrc) &&
        /matchesDelivered\s*=\s*anonGate/.test(workerSrc)
    );
    /**
     * A hand-edited or stale option cannot widen the gate: the worker clamps
     * to the per-job constant. Asserted as the refusal, because the failure
     * would be a larger free tier that nothing bills for.
     */
    ok(
      'a stored gate cannot exceed the per-job ceiling',
      /Math\.min\(\s*ANON_MATCHES_PER_JOB/.test(workerSrc)
    );

    ok(
      'the seed-coverage alarm has the grant it silently depends on',
      /'seeded_contracts'/.test(readOnlyList)
    );
    /**
     * And the denominator is the list itself, never a number typed beside it.
     * A literal 64 would keep reporting 64 after somebody adds the 65th
     * contract, so the one page that never got built would be the one the
     * count could not see.
     */
    ok(
      'seed coverage counts against the recognized list, not a literal',
      growthSrc.includes('RECOGNIZED_CONTRACTS.length') &&
        !/recognized:\s*\d+/.test(growthSrc)
    );
    // Through the analytics module, not around it: the roll-up has to use
    // this classifier rather than a second copy of the host list in SQL.
    const analyticsSrc = withoutComments(
      readFileSync('lib/analytics.ts', 'utf8')
    );
    /**
     * The card headline measures what it paints.
     *
     * A bare <span> at a different weight inside the headline's flex
     * container is measured at the PARENT weight and painted at its own, so
     * every run after the emphasis word starts early and prints through the
     * last bold glyph. It shipped to X that way. Source level, because the
     * output is a PNG rendered by a library this repo cannot call directly:
     * what is checkable here is that the structure which caused it cannot
     * come back.
     */
    const cardRoute = withoutComments(
      readFileSync('app/social-card/[slug]/route.tsx', 'utf8')
    );
    /**
     * Scoped to the Headline function, not the whole file. The stat spans
     * further down carry their own weight too and are correct: each is the
     * only thing on its line, so nothing is measured against it. The defect
     * is specifically a weighted run sharing a line with unweighted text,
     * which is this function and nowhere else.
     */
    const headlineFn = cardRoute.slice(
      cardRoute.indexOf('function Headline('),
      cardRoute.indexOf('export async function GET')
    );
    ok(
      'the headline function is where this expects it',
      headlineFn.length > 200 && headlineFn.includes('parts')
    );
    ok(
      'the headline does not put the emphasis word in a bare span',
      !/<span/.test(headlineFn)
    );
    ok(
      'each headline part is its own measured box',
      (headlineFn.match(/display: 'flex'/g) ?? []).length >= 3
    );
    // And the whitespace half of the same defect stays fixed: the split
    // still hands back non-breaking spaces, which a plain space would not be.
    ok(
      'the split keeps its non-breaking spaces',
      headlineFn.includes("replace(/ $/, '\u00a0')") &&
        headlineFn.includes("replace(/^ /, '\u00a0')")
    );

    ok(
      'the acquisition roll-up classifies with the shared function',
      analyticsSrc.includes('aiAssistantFrom(') &&
        !/CASE[\s\S]{0,400}chatgpt/i.test(analyticsSrc)
    );
  }

  {
    /**
     * Revocation cleanup must stay plannable as an anti-join.
     *
     * The 2026-09-02 monthly sweep ingested perfectly and then died in
     * cleanup, and the driver's headers timeout was the symptom rather than
     * the cause. Written as `wallet NOT IN (SELECT wallet FROM <seen>)` the
     * planner builds a correlated SubPlan with a Materialize of ~805k seen
     * wallets and rescans it per candidate row over a sequential scan of
     * social_graph: measured estimated cost 74,563,713,792, which no timeout
     * would have saved. The identical predicate as NOT EXISTS plans as a
     * Parallel Hash Right Anti Join, cost 337,774, measured at 2.8 seconds.
     *
     * Asserting the refusal rather than the shape, because a happy-path test
     * passes on either spelling: both are valid SQL, both are semantically
     * correct here, and only one of them completes.
     */
    const sweepSource = readFileSync('lib/farcaster-sweep.ts', 'utf8');
    const sweep = withoutComments(sweepSource);
    const cleanup = sweep.slice(
      sweep.indexOf('export async function cleanupRevokedWallets'),
      sweep.indexOf('export async function sweepFidRange')
    );
    // SQL `--` comments survive withoutComments(), which strips JS comment
    // syntax only, and the comment beside this statement names NOT IN on
    // purpose. Testing the prose instead of the statement is the mistake this
    // file already made once: an assertion that reads its own explanation
    // verifies nothing. Strip the SQL comments and test the SQL.
    //
    // Scoped to the whole module, not to cleanupRevokedWallets, because the
    // predicate now lives in countRevocationCandidates as well: the ceiling,
    // the dry run a corrective pass asks for, and the UPDATE all read the same
    // clauses. An assertion scoped to one function would have gone on passing
    // while the other spelling came back in the other.
    const sweepSql = sweep.replace(/--[^\n]*/g, '');
    const cleanupSql = cleanup.replace(/--[^\n]*/g, '');
    ok(
      'nothing in the sweep tests the seen table with NOT IN',
      sweepSql.length > 0 &&
        !/NOT IN\s*\(/i.test(sweepSql) &&
        /NOT EXISTS\s*\(/i.test(cleanupSql) &&
        /s\.wallet = social_graph\.wallet/.test(cleanupSql)
    );

    /**
     * And the ceiling reads the same predicate the UPDATE will run.
     *
     * A dry run that recomputes the predicate rather than calling the shared
     * counter could report one number while the write does another, which is
     * the whole failure mode a ceiling exists to prevent.
     */
    ok(
      'the ceiling counts through the shared helper rather than its own copy',
      // Whitespace-tolerant on purpose: Prettier reflows this call across
      // lines as the argument list grows, and an anchor pinned to one
      // formatting fails as "(anchor drifted)" on a reformat that changed
      // nothing real. This one already did.
      /await\s+countRevocationCandidates\(\s*sweepStartedAt,\s*seenTable/.test(
        cleanup
      ) &&
        /export async function countRevocationCandidates/.test(sweep) &&
        // One in the helper, one in the UPDATE. A third means somebody kept a
        // private copy of the predicate again.
        //
        // Counted by SHAPE, not by the keyword. Counting bare `NOT EXISTS`
        // assumed this file had exactly one subject, and it stopped being
        // true the moment the sweep grew an unrelated `NOT EXISTS` to ask
        // whether an attested source holds the handle. That tripped this
        // assertion on code with no private copy of anything, which is a
        // check reporting the wrong defect rather than no defect. The
        // correlated equality against the seen table is what makes one of
        // these the revocation predicate.
        (
          sweepSql.match(
            /NOT EXISTS\s*\([\s\S]{0,200}?s\.wallet = social_graph\.wallet/g
          ) ?? []
        ).length === 2 &&
        (cleanupSql.match(/NOT EXISTS\s*\(/g) ?? []).length === 1
    );

    /**
     * And its cutoff goes through the shared UTC helper, WITH the cast.
     *
     * `last_updated_at` is `timestamp` with no time zone holding UTC, so a
     * bound JS `Date` sends its LOCAL wall-clock reading and moves the cutoff
     * by the operator's offset. East of UTC that moves it later and clears
     * rows another pipeline refreshed after the sweep began. The scheduled
     * runner is UTC, so the happy path is silent about this forever.
     *
     * `lib/analytics.ts` had already found and measured this on 2026-08-26.
     * The first version of this fix reinvented the helper locally and dropped
     * the `::timestamp` cast that its docblock calls load-bearing: without it
     * the parameter arrives untyped and the coercion depends on context. Both
     * call sites in cleanup are asserted, since the count that feeds the
     * ceiling and the UPDATE it guards must share one cutoff. A ceiling
     * computed over a different window than the write it authorizes is worse
     * than no ceiling.
     */
    const boundCallSites = sweepSource.match(
      /last_updated_at < \$\{utcBound\(sweepStartedAt\)\}::timestamp/g
    );
    ok(
      'both cleanup cutoffs go through the shared UTC helper, with the cast',
      boundCallSites?.length === 2 &&
        !/function utcWallClock/.test(sweepSource) &&
        /import \{ utcBound \} from '\.\/analytics'/.test(sweepSource)
    );

    /**
     * And it refuses an implausible number of revocations before writing any.
     *
     * Every other guard on this path compares the sweep with itself:
     * `expectedSeenCount` is the same run's `walletsUpserted`, so the 90% ratio
     * is seen against upserted and both shrink together, and `coveredRange`
     * counts FIDs requested rather than found. Meanwhile `fetchUserBatch` turns
     * a 404 and a missing `users` key into an empty array, so a burst of either
     * removes wallets from the seen set without touching `failedCalls`. Nothing
     * upstream can tell "checked, and gone" from "never really checked".
     *
     * Until 2026-09-17 that did not matter, because the statement had never
     * completed: the only `--slice` run died in it, and the runs that succeeded
     * were `--incremental`, which tracks no seen set and never cleans up. Making
     * it finish in 2.8 seconds is what turns those latent modes live, so the
     * ceiling ships in the same change as the speed-up, not after it.
     *
     * The bound must be checked BEFORE the UPDATE and must keep the seen table,
     * so assert the ordering and the refusal, not that a ceiling exists
     * somewhere in the function.
     */
    const ceilingIdx = cleanup.indexOf('MAX_REVOCATION_SHARE');
    const updateIdx = cleanup.indexOf('UPDATE social_graph');
    ok(
      'revocation cleanup refuses an implausible clear count before it writes anything',
      ceilingIdx > 0 &&
        updateIdx > 0 &&
        ceilingIdx < updateIdx &&
        /wouldClear > clearCeiling/.test(cleanup) &&
        /throw new Error\(\s*`Revocation count implausible/.test(cleanup)
    );

    /**
     * A 200 with no `users` array must not read as zero users.
     *
     * `json.users ?? []` turned an unrecognized response into a successful
     * empty batch: no `failedCalls`, no retry, nothing to notice. It feeds the
     * seen set that revocation cleanup clears *against*, so wallets missing
     * from it are read as "checked, and the account is gone". A response-shape
     * change over a stretch of batches would therefore clear live identities in
     * proportion to how much of the sweep it swallowed.
     *
     * Measured against the live endpoint on 2026-09-18: existing FIDs answer
     * 200 with `users`, a mixed batch answers 200 with `users` holding only the
     * ones that exist, and a batch where none exist answers 404. So a 200 in
     * normal operation always carries the key, and the fallback was unreachable
     * except when the contract moved, which is the only case that mattered.
     *
     * The 404 branch has to stay, separately: `getNetworkMaxFid` binary-searches
     * the frontier on "does this FID exist", and it reads that from the 404,
     * not from this line. Turning 404 into a failure would break the probe.
     */
    ok(
      'a malformed user batch is a failure, not an empty result',
      /if \(!Array\.isArray\(json\.users\)\) return null;/.test(sweep) &&
        !/json\.users \?\? \[\]/.test(sweep) &&
        /if \(res\.status === 404\) return \[\];/.test(sweep)
    );

    /**
     * And the sweep records what it did, including when it failed.
     *
     * Nothing reported the 2026-09-02 failure for fifteen days. The workflow
     * has no notification step, and `farcaster_sweep_resume` is the only row
     * `ops-status.ts` had for this pipeline, which a slice never writes: the
     * one signal an operator is told to read was incapable of showing this
     * failure and said "cleared (no resume pending)" throughout.
     *
     * The failure path is the one worth asserting, so this checks that the
     * cleanup call is wrapped, that the catch records before re-throwing, and
     * that the error is re-thrown rather than swallowed. A reporting change
     * that quietly turned a crash into a logged warning would be a worse bug
     * than the one it replaced.
     */
    const caller = withoutComments(
      readFileSync('scripts/farcaster-sweep.ts', 'utf8')
    );
    ok(
      'a sweep that fails cleanup records that, and still exits non-zero',
      /outcome: 'cleanup-failed'/.test(caller) &&
        /seenTable,/.test(
          caller.slice(caller.indexOf("outcome: 'cleanup-failed'"))
        ) &&
        /throw error;/.test(
          caller.slice(caller.indexOf("outcome: 'cleanup-failed'"))
        )
    );
    ok(
      'and it records the other endings too, so the row means "what happened" rather than "it worked"',
      /outcome: 'cleaned'/.test(caller) &&
        /outcome: 'cleanup-skipped'/.test(caller) &&
        /outcome: 'checkpointed'/.test(caller) &&
        /outcome: 'range-complete'/.test(caller)
    );

    /**
     * Every ending that clears a checkpoint must also replace the posture that
     * quoted it.
     *
     * The first version of this row missed the resumed-range case: a `--resume`
     * that finished cleared `farcaster_sweep_resume` and wrote no posture, so
     * the earlier segment's `checkpointed` row stayed and the readout went on
     * saying the last run budget-stopped after the range was actually done
     * (found by Bugbot). Stale-but-plausible is the exact failure this row
     * exists to remove, so it is worth an assertion rather than a memory.
     *
     * Scoped to the branch rather than counted across the file. The first
     * version of this assertion compared totals (`records >= clears + 1`) and
     * passed over the very defect it was written for, because removing one
     * record still left four against two clears. A count cannot say WHICH
     * branch reports, which is the only thing that matters here.
     */
    const resumeBranch = caller.slice(
      caller.lastIndexOf("else if (effectiveMode === '--resume')")
    );
    ok(
      'the resumed-range ending records too, instead of leaving the checkpointed row standing',
      resumeBranch.length > 0 &&
        /await clearSweepCheckpoint\(\)/.test(resumeBranch) &&
        /await recordSweepPosture\(/.test(resumeBranch) &&
        /outcome: 'range-complete'/.test(resumeBranch)
    );

    /**
     * The posture writer must never replace the error it is reporting.
     *
     * It is called on the failure path, where the database may be exactly what
     * is broken. If it threw there, the run would report a posture-write error
     * instead of the cleanup error that caused it, which is how an incident
     * loses its own cause.
     */
    ok(
      'recording posture cannot itself break the run',
      /export async function recordSweepPosture/.test(sweep) &&
        /try \{[\s\S]{0,600}?catch \(error\) \{[\s\S]{0,300}?console\.warn/.test(
          sweep.slice(sweep.indexOf('export async function recordSweepPosture'))
        )
    );
  }

  {
    /**
     * Reachability transitions survive the recheck wave that starts 2026-10-01.
     *
     * `persist()` upserts x_accounts in place. Until 2026-09-18 nothing
     * recorded that a status had moved: `status` was overwritten and
     * `checked_at` was stamped on every check, changed or not, and
     * `social_graph_history` does not cover this table. Of 474,140 rows, 409
     * had been rechecked, so the first wave was going to rewrite reachability
     * for every handle that moved since the first pass, unrecoverably.
     *
     * This is the same shape as the `last_live_user_id` fix already recorded in
     * that upsert's comments, on the same deadline, in a different column.
     *
     * Asserting the refusals, because the happy path passes on the broken
     * version: rows are written, statuses are current, and nothing looks wrong
     * until somebody asks when something changed and finds no answer.
     */
    /**
     * Scoped to `persist`, not to the first `ON CONFLICT (handle)` in the file.
     *
     * There are two of those, and the first belongs to a different statement.
     * The initial version of this assertion anchored on it and read a window of
     * the wrong INSERT, which is the "anchor points at something adjacent"
     * failure this file already carries scars from: it failed loudly here, but
     * the same mistake on a passing anchor is an assertion that silently
     * guards nothing.
     */
    const xAccounts = readFileSync('lib/x-accounts.ts', 'utf8');
    const xCode = withoutComments(xAccounts);
    const persistStart = xCode.indexOf('async function persist');
    const upsert = xCode.slice(
      persistStart,
      xCode.indexOf('\n}', persistStart)
    );
    ok(
      'the reachability assertions below read persist, not some other upsert',
      persistStart > 0 &&
        upsert.includes('INSERT INTO x_accounts') &&
        upsert.includes('ON CONFLICT (handle) DO UPDATE SET')
    );

    ok(
      'a reachability status change is recorded, not just overwritten',
      /status_changed_at\s*=\s*CASE/.test(upsert) &&
        /previous_status\s*=\s*CASE/.test(upsert) &&
        /EXCLUDED\.status IS DISTINCT FROM x_accounts\.status/.test(upsert)
    );

    /**
     * `IS DISTINCT FROM`, never `<>`. They agree only while `status` is NOT
     * NULL: against a NULL side `<>` yields NULL, the CASE falls to its ELSE,
     * and the transition is dropped silently. A nullable state added later
     * would reintroduce the exact bug these columns exist to prevent, through
     * the comparison operator rather than through the schema.
     */
    ok(
      'and the comparison cannot drop a transition against a null',
      !/EXCLUDED\.status\s*(<>|!=)\s*x_accounts\.status/.test(upsert)
    );

    /**
     * `checked_at` must stay unconditional. It answers "when did we last look",
     * which is true on every pass, and the recheck scheduler reads it to decide
     * what is stale. Wrapping it in the same CASE would freeze a handle that
     * never changes into permanent staleness, and it would be rechecked
     * forever: a fix for the column above that breaks the column beside it.
     */
    ok(
      'while checked_at still moves on every check, changed or not',
      /checked_at\s*=\s*now\(\)/.test(upsert) &&
        !/checked_at\s*=\s*CASE/.test(upsert)
    );
  }

  {
    /**
     * The staleness tool must not be the stalest thing in the room.
     *
     * `docs/OPERATIONS.md` sends a fresh session to `scripts/ops-status.ts`
     * for live posture, which makes every way that script can quietly lie an
     * operational risk rather than a cosmetic one. On 2026-09-17 it was lying
     * three ways at once, and all three were invisible because the output
     * still looked like a clean report.
     *
     * These assert the refusals, because the happy path passed on the day the
     * readout was wrong: it printed rows, with ages, in neat columns.
     */
    const opsStatus = readFileSync('scripts/ops-status.ts', 'utf8');
    const opsCode = withoutComments(opsStatus);

    /**
     * `ingest_state.updated_at` is `timestamp` with no time zone, so parsing
     * it in JS reads it as local time and under-reports every age by the
     * operator's UTC offset, in the direction that makes a dead cron look
     * alive. It printed a row written an hour earlier as `-4h ago`.
     */
    ok(
      'the posture reader computes ages in the database, not by parsing a zone-less timestamp',
      /EXTRACT\(EPOCH FROM \(now\(\) - updated_at\)\)/.test(opsCode) &&
        !/new Date\(/.test(opsCode) &&
        !/Date\.now\(\)/.test(opsCode)
    );

    /**
     * It used to select `posture:%` plus three literal names, and the literal
     * list went three rows out of date without a single failing run: a
     * hand-maintained allowlist inside a staleness tool is itself a thing that
     * goes stale, and the symptom is a clean report over unchecked cursors.
     */
    ok(
      'and it reads every ingest_state row rather than an allowlist that can go stale',
      /FROM ingest_state\s*\n?\s*ORDER BY name/.test(opsCode) &&
        !/name IN \(/.test(opsCode) &&
        !/LIKE 'posture:%'/.test(opsCode)
    );

    /**
     * The one pipeline with no heartbeat is the one whose as-of sentence was
     * broken: it read `as_of` out of the row's value, and `CoverageStats` has
     * no such key, so the sentence written specifically to compensate for a
     * missing heartbeat rendered a literal question mark.
     */
    ok(
      'and the coverage sentence cannot promise an as-of it reads from a key that does not exist',
      !/as_of/.test(opsCode) &&
        /v1_stats_coverage/.test(opsCode) &&
        !/CoverageStats/.test(opsCode)
    );

    /**
     * Printing every row is only an improvement while the output stays
     * readable: one row holds a rolling event list, and unbounded it buried
     * the other eleven rows in a single terminal line.
     */
    ok(
      'and an unrecognized row cannot flood the readout',
      /MAX_RAW_VALUE_CHARS/.test(opsCode) &&
        /json\.length > MAX_RAW_VALUE_CHARS/.test(opsCode)
    );

    /**
     * Read-only is load-bearing for a tool an operator is told to run against
     * the pooler URL while diagnosing. A status reader that can change what it
     * reports on is a footgun, and the file says so; this tries it.
     */
    ok(
      'and the posture reader still cannot write',
      !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i.test(opsCode)
    );
  }

  // ------------------------------------------ sanctions screening (STA-41)
  // The USDC rail screens its payer against the EVM addresses on OFAC's SDN
  // list before any money moves, a refresh never puts an empty or sharply
  // smaller list in force, a wallet listed after it bought is frozen, both
  // checkouts refuse the decided locations, and the screening record is kept
  // five years and no longer. Each claim is tried as the thing it refuses,
  // through the real functions; the route's order is read from its source,
  // because the route cannot reach its screen here without the facilitator.
  {
    const S = await import('@/lib/sanctions');
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const dialect = new PgDialect();
    type Sent = { sql: string; params: unknown[] };
    const fakeDb = (
      answer: (flat: string, params: unknown[]) => unknown,
      sent: Sent[] = []
    ) => ({
      sent,
      execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const q = dialect.sqlToQuery(query);
        const flat = q.sql.replace(/\s+/g, ' ').trim();
        sent.push({ sql: flat, params: q.params });
        return answer(flat, q.params);
      },
    });
    // A claim statement won for every name it was given (the names are its
    // first parameter), and every name a statement carries, arrays included.
    const claimWon = (params: unknown[]) => ({
      rows: ((params[0] as string[] | undefined) ?? []).map((name) => ({
        name,
      })),
    });
    const namesIn = (sent: Sent) =>
      sent.params.flatMap((p) => (Array.isArray(p) ? p : [p]));

    /**
     * A small SDN.XML in the real file's shape: OFAC's namespace, its
     * misspelled `publshInformation`, entries with an `idList` of `<id>`
     * blocks. The first three entries are real (the 2026-09-23 file), trimmed
     * of ids that do not matter here; they carry a mixed-case address, one
     * address filed under three tickers, and Tron and Bitcoin addresses that
     * must not match. The last entry is invented: an address outside any id,
     * a 64-hex transaction hash that must not match, and an escaped name.
     */
    const sdnId = (uid: number, type: string, value: string) =>
      `      <id>\n        <uid>${uid}</uid>\n        <idType>${type}</idType>\n        <idNumber>${value}</idNumber>\n      </id>\n`;
    const sdnEntry = (uid: number, names: string, ids: string, remarks = '') =>
      `  <sdnEntry>\n    <uid>${uid}</uid>\n${names}    <sdnType>Individual</sdnType>\n${remarks}    <programList>\n      <program>CYBER2</program>\n    </programList>\n    <idList>\n${ids}    </idList>\n  </sdnEntry>\n`;
    const DCA = 'Digital Currency Address - ';
    const entries = [
      sdnEntry(
        24003,
        '    <firstName>Behzad</firstName>\n    <lastName>MESRI</lastName>\n',
        sdnId(126094, 'Gender', 'Male') +
          sdnId(196516, DCA + 'XBT', '12aNKp2iDKuhEde2YfPdd4DFGenRUTKupL') +
          sdnId(
            196530,
            DCA + 'ETH',
            '0x252a8bd2319d8a555b872990601221b3a2053bce'
          ) +
          sdnId(
            196531,
            DCA + 'ETH',
            '0x1CAb8177ACe78b1B6B1c393371F4f2dCAE40CbEB'
          )
      ),
      sdnEntry(
        42498,
        '    <firstName>Hyon Sop</firstName>\n    <lastName>SIM</lastName>\n',
        sdnId(32060, 'Passport', '109484100') +
          sdnId(196597, DCA + 'TRX', 'TGXE9dGWawjfd3xqFSho1h1bRbRv9wUGrF') +
          sdnId(
            161088,
            DCA + 'ARB',
            '0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c'
          ) +
          sdnId(
            161089,
            DCA + 'BSC',
            '0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c'
          ) +
          sdnId(
            160979,
            DCA + 'ETH',
            '0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c'
          )
      ),
      sdnEntry(
        43377,
        '    <firstName>Sang Man</firstName>\n    <lastName>KIM</lastName>\n',
        sdnId(
          162812,
          DCA + 'USDT',
          '0xb6f5ec1a0a9cd1526536d3f0426c429529471f40'
        ) +
          sdnId(
            162813,
            DCA + 'USDC',
            '0xb6f5ec1a0a9cd1526536d3f0426c429529471f40'
          ) +
          sdnId(
            162810,
            DCA + 'ETH',
            '0x97b1043abd9e6fc31681635166d430a458d14f9c'
          ) +
          sdnId(
            162811,
            DCA + 'ETH',
            '0xb6f5ec1a0a9cd1526536d3f0426c429529471f40'
          )
      ),
      sdnEntry(
        99001,
        '    <lastName>EXAMPLE TRADING &amp; LOGISTICS LLC</lastName>\n',
        sdnId(99002, 'Email Address', 'ops@example.invalid'),
        '    <remarks>Funds moved in tx 0x9f2c4a7b1e0d3c5a6b8f7e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b and through 0x00000000000000000000000000000000DeaDBeef.</remarks>\n'
      ),
    ];
    const cuba =
      '  <sdnEntry>\n    <uid>36</uid>\n    <lastName>AEROCARIBBEAN AIRLINES</lastName>\n    <sdnType>Entity</sdnType>\n    <programList>\n      <program>CUBA</program>\n    </programList>\n  </sdnEntry>\n';
    const sdnXml = (body: string, count: number, date = '09/23/2026') =>
      `<?xml version="1.0" standalone="yes"?>\n<sdnList xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML">\n  <publshInformation>\n    <Publish_Date>${date}</Publish_Date>\n    <Record_Count>${count}</Record_Count>\n  </publshInformation>\n${body}</sdnList>`;
    const fixture = sdnXml(cuba + entries.join(''), 5);

    const parsed = S.parseSdnXml(fixture);
    const byAddress = new Map(parsed.addresses.map((a) => [a.address, a]));
    ok(
      'the SDN parse reads the publish date and checks the entry count',
      parsed.publishDate === '2026-09-23' && parsed.recordCount === 5
    );
    ok(
      'every EVM address in the fixture is found, and nothing else',
      JSON.stringify([...byAddress.keys()]) ===
        JSON.stringify([
          '0x00000000000000000000000000000000deadbeef',
          '0x1cab8177ace78b1b6b1c393371f4f2dcae40cbeb',
          '0x252a8bd2319d8a555b872990601221b3a2053bce',
          '0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c',
          '0x97b1043abd9e6fc31681635166d430a458d14f9c',
          '0xb6f5ec1a0a9cd1526536d3f0426c429529471f40',
        ])
    );
    ok(
      'a mixed-case address is stored lowercased, so a lowercased payer matches it',
      byAddress.has('0x1cab8177ace78b1b6b1c393371f4f2dcae40cbeb') &&
        !parsed.addresses.some((a) => /[A-F]/.test(a.address))
    );
    ok(
      'an address filed under several tickers is one row carrying all of them',
      byAddress
        .get('0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c')
        ?.tickers.join() === 'ARB,BSC,ETH' &&
        byAddress
          .get('0xb6f5ec1a0a9cd1526536d3f0426c429529471f40')
          ?.tickers.join() === 'ETH,USDC,USDT' &&
        byAddress.get('0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c')?.sdnUid ===
          '42498'
    );
    ok(
      'an EVM address outside any currency id is still listed, with no ticker',
      byAddress.get('0x00000000000000000000000000000000deadbeef')?.tickers
        .length === 0 &&
        byAddress.get('0x00000000000000000000000000000000deadbeef')?.entity ===
          'EXAMPLE TRADING & LOGISTICS LLC'
    );
    ok(
      'a 64-hex transaction hash never yields an address',
      !parsed.addresses.some((a) => a.address.startsWith('0x9f2c4a7b'))
    );
    ok(
      'a renamed currency id type does not shorten the list',
      S.parseSdnXml(
        fixture.replaceAll(
          'Digital Currency Address - ',
          'Digital Currency Address: '
        )
      ).addresses.length === 6
    );
    const parseRefuses = (xml: string) => {
      try {
        S.parseSdnXml(xml);
        return false;
      } catch (e) {
        return e instanceof S.SdnParseError;
      }
    };
    ok(
      'a truncated download is refused, not parsed as a shorter list',
      parseRefuses(fixture.slice(0, Math.floor(fixture.length * 0.6)))
    );
    // The one cut the entry count cannot see: every entry arrived and the
    // file stops before its closing tag. Only the closing-tag check refuses
    // it, so this is the assertion that check answers to.
    ok(
      'a download that stops before its closing tag is refused, even with every entry present',
      parseRefuses(fixture.replace('</sdnList>', ''))
    );
    ok(
      'a file whose entries disagree with its own Record_Count is refused',
      parseRefuses(sdnXml(cuba + entries.join(''), 6)) &&
        parseRefuses(sdnXml(entries.join(''), 5))
    );
    ok(
      'a file without a real publish date is refused',
      parseRefuses(
        fixture.replace(/<Publish_Date>[^<]*<\/Publish_Date>/, '')
      ) && parseRefuses(sdnXml(cuba + entries.join(''), 5, '02/30/2026'))
    );

    // --- the refresh guard
    const cur = (count: number, publishDate: string | null = '2026-09-23') => ({
      count,
      publishDate,
    });
    const inc = (count: number, publishDate = '2026-09-23') => ({
      count,
      publishDate,
    });
    ok(
      'an empty parse never replaces the list, not even the first one, not even when accepted',
      S.refreshRefusal(cur(124), inc(0)) === 'empty' &&
        S.refreshRefusal(cur(0, null), inc(0)) === 'empty' &&
        S.refreshRefusal(cur(124), inc(0), 0) === 'empty'
    );
    ok(
      'a drop of more than 20% is refused, and 20% or less is not',
      S.SANCTIONS_MAX_DROP === 0.2 &&
        S.refreshRefusal(cur(124), inc(98)) === 'sharp_drop' &&
        S.refreshRefusal(cur(124), inc(99)) === 'sharp_drop' &&
        S.refreshRefusal(cur(124), inc(100)) === null &&
        S.refreshRefusal(cur(124), inc(130)) === null
    );
    ok(
      'an operator accepts a large drop only by naming its exact count',
      S.refreshRefusal(cur(124), inc(40), 40) === null &&
        S.refreshRefusal(cur(124), inc(40), 41) === 'sharp_drop' &&
        S.refreshRefusal(cur(124), inc(40), null) === 'sharp_drop'
    );
    ok(
      'an older publication never replaces a newer one',
      S.refreshRefusal(cur(124), inc(124, '2026-09-20')) === 'older_publication'
    );

    // The refresh, driven through the real function with a recording database
    // and a canned download: what reaches the database decides the claim.
    const runRefresh = async (opts: {
      inForce: number;
      xml: string | Error;
      acceptCount?: number | null;
    }) => {
      const db = fakeDb((flat) => {
        if (flat.includes('FROM sanctioned_addresses) AS n')) {
          return {
            rows: [
              {
                n: opts.inForce,
                state: opts.inForce
                  ? {
                      publishDate: '2026-09-22',
                      refreshedAt: '2026-09-25T00:15:00.000Z',
                      addressCount: opts.inForce,
                    }
                  : null,
              },
            ],
          };
        }
        if (flat.startsWith('WITH incoming AS')) {
          return { rows: [{ added: 6, removed: 0, total: 6 }] };
        }
        if (flat.startsWith('WITH pairs AS (')) {
          return {
            rows: [{ matched: 0, newly_frozen: 0, keys_deactivated: 0 }],
          };
        }
        return { rows: [] };
      });
      const outcome = await S.refreshSanctionsList({
        db,
        fetchXml: async () => {
          if (opts.xml instanceof Error) throw opts.xml;
          return opts.xml;
        },
        now: new Date('2026-09-25T06:15:00.000Z'),
        acceptCount: opts.acceptCount ?? null,
      });
      const replaced = db.sent.some((s) =>
        /DELETE FROM sanctioned_addresses|INSERT INTO sanctioned_addresses/.test(
          s.sql
        )
      );
      const froze = db.sent.findIndex((s) =>
        s.sql.startsWith('WITH pairs AS (')
      );
      const replacedAt = db.sent.findIndex((s) =>
        s.sql.startsWith('WITH incoming AS')
      );
      return { outcome, replaced, froze, replacedAt, sent: db.sent };
    };

    const shrunk = await runRefresh({ inForce: 124, xml: fixture });
    ok(
      'a refresh that would shrink 124 addresses to 6 writes nothing to the list',
      shrunk.outcome.refused === 'sharp_drop' &&
        !shrunk.replaced &&
        !shrunk.outcome.ok
    );
    const emptied = await runRefresh({
      inForce: 124,
      xml: sdnXml(cuba, 1),
      acceptCount: 0,
    });
    ok(
      'a refresh that parses no address writes nothing, even with an override',
      emptied.outcome.refused === 'empty' && !emptied.replaced
    );
    const cut = await runRefresh({
      inForce: 6,
      xml: fixture.slice(0, fixture.length - 40),
    });
    ok(
      'a cut-off download writes nothing and reports the error',
      !cut.replaced &&
        !cut.outcome.ok &&
        /parse failed/.test(cut.outcome.error ?? '')
    );
    const down = await runRefresh({
      inForce: 6,
      xml: new Error('ECONNRESET'),
    });
    ok(
      'a failed download writes nothing, and the list in force ages toward the alert',
      !down.replaced &&
        !down.outcome.ok &&
        down.outcome.listAgeHours === 6 &&
        !down.outcome.alert
    );
    const accepted = await runRefresh({
      inForce: 124,
      xml: fixture,
      acceptCount: 6,
    });
    ok(
      'an accepted drop is written, whole, in one statement with the state row',
      accepted.replaced &&
        accepted.outcome.ok &&
        accepted.sent.filter(
          (s) =>
            /sanctioned_addresses/.test(s.sql) &&
            s.sql.startsWith('WITH incoming AS')
        ).length === 1 &&
        /INSERT INTO ingest_state/.test(
          accepted.sent[accepted.replacedAt]?.sql ?? ''
        )
    );
    {
      const replace = accepted.sent[accepted.replacedAt];
      const state = replace?.params.find(
        (p) => typeof p === 'string' && p.includes('refreshedAt')
      ) as string | undefined;
      ok(
        'the state row records the publish date and this refresh as its time',
        !!state &&
          JSON.parse(state).publishDate === '2026-09-23' &&
          JSON.parse(state).refreshedAt === '2026-09-25T06:15:00.000Z' &&
          replace!.params.some(
            (p) =>
              Array.isArray(p) &&
              p.includes('0x1cab8177ace78b1b6b1c393371f4f2dcae40cbeb')
          )
      );
    }
    const steady = await runRefresh({ inForce: 6, xml: fixture });
    ok(
      'every successful refresh re-checks past buyers after the new list is in force',
      steady.outcome.ok &&
        steady.replacedAt !== -1 &&
        steady.froze > steady.replacedAt
    );
    ok(
      'and a refused refresh still re-checks past buyers against the list in force',
      shrunk.froze !== -1 && emptied.froze !== -1
    );

    // --- a wallet listed after it bought
    {
      const db = fakeDb(() => ({
        rows: [{ matched: 1, newly_frozen: 1, keys_deactivated: 2 }],
      }));
      const frozen = await S.freezeListedBuyers(db, '2026-09-23');
      const freeze = db.sent[0];
      ok(
        'the freeze is one statement: it freezes the account and deactivates its keys together',
        db.sent.length === 1 &&
          /UPDATE users u SET frozen_at = now\(\), frozen_reason = /.test(
            freeze.sql
          ) &&
          /UPDATE api_keys k SET is_active = false FROM hits WHERE k\.user_id = hits\.user_id/.test(
            freeze.sql
          ) &&
          frozen.newlyFrozen === 1 &&
          frozen.keysDeactivated === 2
      );
      ok(
        'the payer is read from every x402 settlement id, whichever account it credited',
        /JOIN sanctioned_addresses s ON s\.address = split_part\(l\.settlement_id, ':', 3\)/.test(
          freeze.sql
        ) && freeze.params.includes('eip155:8453:%')
      );
      ok(
        'a freeze is stamped once and never moved, but a later key is still deactivated',
        /WHERE u\.id = hits\.user_id AND u\.frozen_at IS NULL/.test(
          freeze.sql
        ) &&
          /UPDATE api_keys k SET is_active = false FROM hits WHERE k\.user_id = hits\.user_id AND k\.is_active = true/.test(
            freeze.sql
          )
      );
      const keys = withoutComments(readFileSync('lib/api-keys.ts', 'utf8'));
      const lookup = keys.slice(
        keys.indexOf('async function lookupActiveKey('),
        keys.indexOf('export async function validateApiKey(')
      );
      ok(
        'a frozen account’s keys do not validate, whenever they were minted',
        /\.innerJoin\(users, eq\(apiKeys\.userId, users\.id\)\)/.test(lookup) &&
          /frozenAt: users\.frozenAt/.test(lookup) &&
          /if \(frozenAt\) \{\s*return null;\s*\}/.test(lookup) &&
          lookup.indexOf('if (frozenAt)') <
            lookup.indexOf('return { key, plan }')
      );
      const credits = withoutComments(readFileSync('lib/credits.ts', 'utf8'));
      const submit = credits.slice(
        credits.indexOf('export async function canSubmit('),
        credits.indexOf('async function walletsSubmittedSince(')
      );
      ok(
        'a frozen account starts no lookup, and the check comes before the unmetered tiers',
        /if \(await isAccountFrozen\(userId\)\) \{\s*return \{\s*allowed: false,/.test(
          submit
        ) &&
          submit.indexOf('isAccountFrozen(userId)') <
            submit.indexOf('legacyTierIsUnmetered(tier)')
      );
      const unlock = credits.slice(
        credits.indexOf('export async function unlockJobMatches('),
        credits.indexOf('async function drawDown(')
      );
      ok(
        'a frozen account spends no credits unlocking matches',
        /if \(await isAccountFrozen\(userId\)\) \{\s*return \{ ok: false, reason: FROZEN_ACCOUNT_MESSAGE, frozen: true \};/.test(
          unlock
        ) &&
          unlock.indexOf('isAccountFrozen(') <
            unlock.indexOf('insert(creditLedger)')
      );
    }

    // --- the route-time screen and its answers
    const FRESH = {
      publishDate: '2026-09-23',
      refreshedAt: '2026-09-25T00:15:00.000Z',
      addressCount: 124,
    };
    const screen = async (
      state: unknown,
      listed: boolean,
      fail: 'read' | 'record' | null = null,
      at = '2026-09-25T09:00:00.000Z'
    ) => {
      const db = fakeDb((flat) => {
        if (flat.startsWith('INSERT INTO sanctions_screenings')) {
          if (fail === 'record') throw new Error('insert failed');
          return { rows: [] };
        }
        if (fail === 'read') throw new Error('connection reset');
        return { rows: [{ state, listed }] };
      });
      const quiet = console.error;
      console.error = () => {};
      try {
        const result = await S.screenPayer(
          '0x4F47BC496083C727C5FBE3CE9CDF2B0F6496270C',
          db,
          new Date(at)
        );
        return { ...result, sent: db.sent };
      } finally {
        console.error = quiet;
      }
    };
    const listedRun = await screen(FRESH, true);
    const clearRun = await screen(FRESH, false);
    ok(
      'a listed payer is screened as listed, and the screening is recorded',
      listedRun.verdict === 'listed' &&
        listedRun.sent.some(
          (s) =>
            s.sql.startsWith('INSERT INTO sanctions_screenings') &&
            s.params.includes('listed') &&
            s.params.includes('2026-09-23') &&
            s.params.includes('0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c')
        )
    );
    // A refusal is recorded before verify, so anybody can make one. It is one
    // row per payer, verdict and UTC hour, with a counter: repeated refused
    // posts raise the counter and do not add rows. And the row says verify
    // was never reached: the payer was claimed by the request, not proven.
    {
      const refusal = listedRun.sent.find((s) =>
        s.sql.startsWith('INSERT INTO sanctions_screenings')
      );
      ok(
        'a refusal row is one per payer, verdict and hour, and a repeat only counts',
        /ON CONFLICT \(address, verdict, screened_hour\) WHERE NOT verify_reached DO UPDATE SET attempts = sanctions_screenings\.attempts \+ 1, last_screened_at = now\(\)$/.test(
          refusal?.sql ?? ''
        ) &&
          (refusal?.params.includes('2026-09-25T09:00:00.000Z') ?? false)
      );
      ok(
        'a refusal row records that verify was never reached',
        /VALUES \(\$\d+, \$\d+::date, \$\d+, false, \$\d+::timestamptz\)/.test(
          refusal?.sql ?? ''
        )
      );
      ok(
        'the dedupe bucket is the UTC hour the try falls in',
        S.screeningHour(new Date('2026-09-25T09:59:59.999Z')) ===
          '2026-09-25T09:00:00.000Z' &&
          S.screeningHour(new Date('2026-09-25T10:00:00.000Z')) ===
            '2026-09-25T10:00:00.000Z'
      );
      const mig = readFileSync(
        'scripts/migrate-sanctions-screening.ts',
        'utf8'
      ).replace(/\s+/g, ' ');
      ok(
        'the table enforces the dedupe and ties verify_reached to the verdict',
        /CREATE UNIQUE INDEX IF NOT EXISTS sanctions_screenings_refusal_hour_idx ON sanctions_screenings \(address, verdict, screened_hour\) WHERE NOT verify_reached/.test(
          mig
        ) && /CHECK \(verify_reached = \(verdict = 'clear'\)\)/.test(mig)
      );
    }
    ok(
      'the payer is looked up lowercased',
      listedRun.sent[0]?.params.includes(
        '0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c'
      ) ?? false
    );
    ok(
      'a clear payer is clear, and nothing is written before verify',
      clearRun.verdict === 'clear' &&
        clearRun.publishDate === '2026-09-23' &&
        clearRun.sent.length === 1 &&
        !clearRun.sent.some((s) => /INSERT|UPDATE/.test(s.sql))
    );
    {
      const recorded = async (fail: boolean, db: 'fake' | 'none' = 'fake') => {
        const fake = fakeDb(() => {
          if (fail) throw new Error('insert failed');
          return { rows: [] };
        });
        const quiet = console.error;
        console.error = () => {};
        try {
          const verdict = await S.recordClearScreening(
            '0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045',
            '2026-09-23',
            db === 'none' ? null : fake,
            new Date('2026-09-25T09:30:00.000Z')
          );
          return { verdict, sent: fake.sent };
        } finally {
          console.error = quiet;
        }
      };
      const good = await recorded(false);
      ok(
        'the clear record, written after verify, says verify was reached',
        good.verdict === 'clear' &&
          good.sent.length === 1 &&
          /^INSERT INTO sanctions_screenings \(address, list_publish_date, verdict, verify_reached, screened_hour\) VALUES \(\$1, \$2::date, 'clear', true, \$3::timestamptz\)$/.test(
            good.sent[0].sql
          ) &&
          good.sent[0].params[0] ===
            '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
      );
      ok(
        'a clear record that cannot be written is an error, so the sale is refused',
        (await recorded(true)).verdict === 'error' &&
          (await recorded(false, 'none')).verdict === 'error' &&
          S.sanctionsRefusal('error')?.status === 503
      );
    }
    ok(
      'a list last refreshed more than 7 days ago is stale; 7 days is not',
      S.SANCTIONS_REFUSE_AFTER_DAYS === 7 &&
        (await screen(FRESH, false, null, '2026-10-02T00:16:00.000Z'))
          .verdict === 'stale' &&
        (await screen(FRESH, false, null, '2026-10-02T00:14:00.000Z'))
          .verdict === 'clear'
    );
    ok(
      'a hit on an aged list is still a hit',
      (await screen(FRESH, true, null, '2026-11-01T00:00:00.000Z')).verdict ===
        'listed'
    );
    ok(
      'no list at all, or an unreadable one, is missing',
      (await screen(null, false)).verdict === 'missing' &&
        (await screen({ publishDate: 'soon' }, false)).verdict === 'missing'
    );
    ok(
      'a database error fails closed, on the read and on a refusal’s record',
      (await screen(FRESH, false, 'read')).verdict === 'error' &&
        (await screen(FRESH, true, 'record')).verdict === 'error' &&
        (await S.screenPayer('0x00', null)).verdict === 'error'
    );

    const answer = async (verdict: string) => {
      const res = S.sanctionsRefusal(verdict as never);
      return res
        ? {
            status: res.status,
            body: (await res.json()) as { error: string; code: string },
            retryAfter: res.headers.get('Retry-After'),
          }
        : null;
    };
    const listedAnswer = await answer('listed');
    ok(
      'a listed payer gets 403 SANCTIONED_PAYER and the one agreed sentence',
      listedAnswer?.status === 403 &&
        listedAnswer.body.code === 'SANCTIONED_PAYER' &&
        listedAnswer.body.error === 'This payment cannot be accepted.' &&
        Object.keys(listedAnswer.body).length === 2
    );
    ok(
      'the refusal names no list and no detail',
      !/ofac|sdn|sanction|list/i.test(listedAnswer?.body.error ?? 'ofac')
    );
    let closed = true;
    for (const v of ['stale', 'missing', 'error', 'unheard-of']) {
      const a = await answer(v);
      closed &&=
        a?.status === 503 &&
        a.body.code === 'SCREENING_UNAVAILABLE' &&
        Number(a.retryAfter) > 0;
    }
    ok(
      'a stale, missing or failed screen answers 503, and so does any verdict it has never heard of',
      closed
    );
    ok(
      'only a clear verdict lets the sale through',
      (await answer('clear')) === null
    );

    const buy = withoutComments(
      readFileSync('app/api/x402/buy/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const screenAt = buy.indexOf(
      'const screen = await screenPayer(payer); const screened = sanctionsRefusal(screen.verdict); if (screened) return screened;'
    );
    ok(
      'the buy route screens the payer the moment it is decoded',
      screenAt !== -1 &&
        screenAt > buy.indexOf('const payer = payerFrom(payload);') &&
        screenAt >
          buy.indexOf("'Payment payload carries no EIP-3009 authorization.'")
    );
    ok(
      'and before it reads a lot, verifies or settles anything',
      screenAt !== -1 &&
        screenAt < buy.indexOf('await lotForSettlement(settlementId)') &&
        screenAt < buy.indexOf('server.verifyPayment(') &&
        screenAt < buy.indexOf('server.settlePayment(') &&
        screenAt < buy.indexOf('getOrCreateWalletAccount(payer)')
    );
    {
      const recordAt = buy.indexOf(
        'const unrecorded = sanctionsRefusal( await recordClearScreening(payer, screen.publishDate) ); if (unrecorded) return unrecorded;'
      );
      const invalidAt = buy.indexOf('if (!verification.isValid) {');
      ok(
        'the clear record is written after verify passes and before settle, and a failed write refuses',
        recordAt !== -1 &&
          invalidAt !== -1 &&
          recordAt > invalidAt &&
          recordAt > buy.indexOf('server.verifyPayment(') &&
          recordAt < buy.indexOf('server.settlePayment(')
      );
    }

    // --- recovery refuses a frozen account
    {
      const recover = withoutComments(
        readFileSync('app/api/x402/recover/route.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      const frozenAt = recover.indexOf(
        "if (await isAccountFrozen(userId)) { return sanctionsRefusal('listed')!; }"
      );
      ok(
        'recovery refuses a frozen account with the buy route’s 403, before it mints anything',
        frozenAt !== -1 &&
          frozenAt < recover.indexOf('revokeAllAndReissueKey(') &&
          frozenAt < recover.indexOf('createApiKeyIfUnderCap(')
      );
      ok(
        'and only after the signature has proven the wallet, so it tells a stranger nothing',
        frozenAt > recover.indexOf('await verifyRecovery(') &&
          frozenAt > recover.indexOf('await consumeChallenge(') &&
          frozenAt >
            recover.indexOf('const userId = await walletAccount(wallet);')
      );
    }

    // --- the geoblock
    const G = await import('@/lib/geoblock');
    const at = async (country?: string, region?: string) => {
      const headers = new Headers();
      if (country) headers.set('x-vercel-ip-country', country);
      if (region) headers.set('x-vercel-ip-country-region', region);
      const res = G.checkoutGeoblock(headers);
      return res ? { status: res.status, body: await res.json() } : null;
    };
    let blocked = true;
    for (const [c, r] of [
      ['CU', undefined],
      ['IR', 'TEH'],
      ['KP', undefined],
      ['SY', 'DI'],
      ['UA', '43'],
      ['UA', '40'],
      ['UA', '14'],
      ['UA', '09'],
      ['UA', '9'],
      ['ua', '43'],
      ['ir', undefined],
    ] as Array<[string, string | undefined]>) {
      const a = await at(c, r);
      blocked &&= a?.status === 403 && a.body.code === 'REGION_RESTRICTED';
    }
    ok(
      'checkout refuses Cuba, Iran, North Korea, Syria, Crimea, Sevastopol, Donetsk and Luhansk',
      blocked
    );
    ok(
      'and lets the rest of Ukraine, a neighbour, and an unplaced request through',
      (await at('UA', '30')) === null &&
        (await at('UA')) === null &&
        (await at('RU', '43')) === null &&
        (await at('US', 'CA')) === null &&
        (await at()) === null
    );
    ok(
      'the region refusal names no list and no detail',
      (await at('IR'))?.body.error ===
        'Purchases are not available in your region.'
    );
    const geoSrc = readFileSync('lib/geoblock.ts', 'utf8');
    ok(
      'the refused locations live in one constant, marked for the lawyer',
      /export const RESTRICTED_CHECKOUT_LOCATIONS/.test(geoSrc) &&
        /STA-49/.test(geoSrc) &&
        ['CU', 'IR', 'KP', 'SY'].every((c) =>
          G.RESTRICTED_CHECKOUT_LOCATIONS.countries.includes(c)
        ) &&
        ['UA-43', 'UA-40', 'UA-14', 'UA-09'].every((r) =>
          G.RESTRICTED_CHECKOUT_LOCATIONS.regions.includes(r)
        )
    );
    const checkout = withoutComments(
      readFileSync('app/api/checkout/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    const geoFirst = (src: string, before: string[]) => {
      const at = src.indexOf(
        'const geoblocked = checkoutGeoblock(request.headers); if (geoblocked) return geoblocked;'
      );
      return at !== -1 && before.every((b) => src.indexOf(b) > at);
    };
    ok(
      'the USDC buy is geoblocked before anything is priced or signed',
      geoFirst(buy, [
        'payToAddress()',
        'readBodyCapped(',
        'await getResourceServer()',
        'screenPayer(',
      ])
    );
    ok(
      'card checkout is geoblocked before Stripe is touched',
      geoFirst(checkout, ['isStripeConfigured()', 'createPackCheckoutSession('])
    );

    // --- five years, and no longer
    {
      const db = fakeDb(() => ({ rows: [{}, {}, {}] }));
      const { SANCTIONS_SCREENING_RETENTION_YEARS } =
        await import('@/app/api/cron/cleanup/route');
      const { deleteOldScreenings, RETENTION_DELETE_BATCH } =
        await import('@/lib/retention');
      const removed = await deleteOldScreenings(
        db,
        SANCTIONS_SCREENING_RETENTION_YEARS,
        RETENTION_DELETE_BATCH
      );
      const purge = db.sent[0];
      ok(
        'screening records are kept five years',
        SANCTIONS_SCREENING_RETENTION_YEARS === 5 &&
          purge.params.includes(5) &&
          removed === 3
      );
      ok(
        'the purge takes only rows older than the period, and checks each row again before it goes',
        /^WITH due AS \( SELECT id FROM sanctions_screenings WHERE screened_at < now\(\) - make_interval\(years => \$1::int\) LIMIT \$2 \) DELETE FROM sanctions_screenings s USING due WHERE s\.id = due\.id AND s\.screened_at < now\(\) - make_interval\(years => \$3::int\) RETURNING 1$/.test(
          purge.sql
        ) &&
          purge.params[0] === 5 &&
          purge.params[2] === 5
      );
      const cleanupRun = withoutComments(
        readFileSync('app/api/cron/cleanup/route.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      const runPart = cleanupRun.slice(
        cleanupRun.indexOf('async function run(')
      );
      // The shape of every STA-45 retention branch: its own try, drained in
      // bounded batches against the shared deadline, reported by name.
      ok(
        'the daily cleanup drains the purge in its own try, inside the retention budget, and reports it',
        /let sanctionsScreenings: number \| null = null; try \{ sanctionsScreenings = await drainBatches\( \(\) => deleteOldScreenings\( db, SANCTIONS_SCREENING_RETENTION_YEARS, RETENTION_DELETE_BATCH \), retentionDeadline \); \} catch \(error\) \{ console\.error\('Sanctions screening cleanup error:', error\); \}/.test(
          runPart
        ) &&
          runPart.indexOf('const retentionDeadline') <
            runPart.indexOf('sanctionsScreenings = await') &&
          /creditLedgerRows, sanctionsScreenings, sanctionsListAlert, sanctionsFreezeAlert, sanctionsAlertRecords, purchaseRecords,/.test(
            runPart
          )
      );
    }

    // --- email alerts (a freeze, a stale list, a refused refresh)
    // Each condition emails the ops inbox at most once a day, the claim for it
    // lives in the database, and nothing about an email can block or undo the
    // freeze or the refusal it reports. Driven through the real functions
    // with a recording database and a recording sender.
    {
      const A = await import('@/lib/sanctions-alerts');
      const { OPS_ALERT_TO } = await import('@/lib/email');
      type Mail = { subject: string; text: string };
      const alertRig = (opts: {
        claim?: 'win' | 'lose' | 'throw';
        send?: 'ok' | 'fail' | 'throw';
        state?: unknown;
        readThrows?: boolean;
        pending?: unknown[];
        frozen?: boolean;
      }) => {
        const mails: Mail[] = [];
        const logged: string[] = [];
        const db = fakeDb((flat, params) => {
          if (flat.startsWith('INSERT INTO ingest_state')) {
            if (opts.claim === 'throw') throw new Error('claim failed');
            return opts.claim === 'lose' ? { rows: [] } : claimWon(params);
          }
          if (flat.startsWith('WITH pairs AS (')) {
            if (opts.readThrows) throw new Error('read failed');
            return { rows: opts.pending ?? [] };
          }
          if (flat.startsWith('SELECT frozen_at FROM users')) {
            return { rows: [{ frozen_at: opts.frozen ? new Date() : null }] };
          }
          if (flat.startsWith('SELECT value FROM ingest_state')) {
            if (opts.readThrows) throw new Error('read failed');
            return {
              rows: opts.state === undefined ? [] : [{ value: opts.state }],
            };
          }
          return { rows: [] };
        });
        const send = async (subject: string, text: string) => {
          if (opts.send === 'throw') throw new Error('provider down');
          mails.push({ subject, text });
          return opts.send === 'fail'
            ? { success: false, error: 'rejected' }
            : { success: true };
        };
        const run = async <T>(f: () => Promise<T>): Promise<T> => {
          const quiet = console.error;
          console.error = (...a: unknown[]) =>
            logged.push(a.map(String).join(' '));
          try {
            return await f();
          } finally {
            console.error = quiet;
          }
        };
        return { db, mails, logged, send, run };
      };
      const frozenTwo = [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          payer: '0x8d79c73daae8630c88de372ba8f57592fa987607',
          sdnUid: '58284',
        },
        {
          userId: '22222222-2222-4222-8222-222222222222',
          payer: '0x098b716b8aaf21512996dc57eb0615e2383e2f96',
          sdnUid: '27307',
        },
      ];
      const pendingTwo = frozenTwo.map((f) => ({
        ...f,
        publishDate: '2026-09-23',
      }));

      const fz = alertRig({ pending: pendingTwo });
      const fzResult = await fz.run(() =>
        A.alertPendingFreezes(fz.db, fz.send)
      );
      const fzMail = fz.mails[0];
      ok(
        'a freeze emails at once, one email naming each frozen account and the list in force',
        fzResult === 'sent' &&
          fz.mails.length === 1 &&
          /published 2026-09-23/.test(fzMail.text) &&
          frozenTwo.every(
            (f) =>
              fzMail.text.includes(`Account id: ${f.userId}`) &&
              fzMail.text.includes(`Matched address: ${f.payer}`) &&
              fzMail.text.includes(`SDN entry uid: ${f.sdnUid}`)
          )
      );
      ok(
        'each frozen account and listed payer is its own condition, so no freeze and no later payer is swallowed',
        fz.db.sent.filter((s) => s.sql.startsWith('INSERT INTO ingest_state'))
          .length === 1 &&
          JSON.stringify(
            fz.db.sent.find((s) => s.sql.startsWith('INSERT INTO ingest_state'))
              ?.params[0]
          ) ===
            JSON.stringify(
              frozenTwo.map(
                (f) => `alert:sanctions:freeze:${f.userId}:${f.payer}`
              )
            )
      );
      ok(
        'the freeze email carries what the operator needs and nothing else',
        !/@/.test(fzMail.text) &&
          !/amount|cents|\$\d|email/i.test(fzMail.text) &&
          (fzMail.text.match(/0x[0-9a-f]{40}/g) ?? []).length === 2
      );
      ok(
        'alerts go to the ops inbox, through the lifecycle mail’s Resend client',
        OPS_ALERT_TO === 'help@walletlink.social' &&
          /to: OPS_ALERT_TO,/.test(
            withoutComments(readFileSync('lib/email.ts', 'utf8'))
          ) &&
          /await withTimeout\(\s*resend\.emails\.send\(\{\s*from: FROM_EMAIL,\s*to: OPS_ALERT_TO,/.test(
            readFileSync('lib/email.ts', 'utf8')
          )
      );

      // The once-a-day rule, and where it is remembered.
      const claimSql = fz.db.sent.find((s) =>
        s.sql.startsWith('INSERT INTO ingest_state')
      );
      ok(
        'every condition of an email is claimed in ONE statement, as a claim that is not yet a sent marker',
        A.ALERT_REPEAT_HOURS === 24 &&
          /^INSERT INTO ingest_state \(name, value, updated_at\) SELECT t\.name, jsonb_strip_nulls\(jsonb_build_object\('claimedAt', now\(\), 'payload', t\.payload::jsonb\)\), now\(\) FROM unnest\(\$1::text\[\], \$2::text\[\]\) AS t\(name, payload\) ON CONFLICT \(name\) DO UPDATE SET/.test(
            claimSql?.sql ?? ''
          ) &&
          /RETURNING name$/.test(claimSql?.sql ?? '')
      );
      ok(
        'a row is claimable again only when sent a day ago, or never sent and its claim gone or older than five minutes',
        A.CLAIM_EXPIRY_MINUTES === 5 &&
          /WHERE \( \(ingest_state\.value->>'sentAt' IS NOT NULL AND \(ingest_state\.value->>'sentAt'\)::timestamptz <= now\(\) - make_interval\(hours => \$\d+::int\)\) OR \(ingest_state\.value->>'sentAt' IS NULL AND \(ingest_state\.value->>'claimedAt' IS NULL OR \(ingest_state\.value->>'claimedAt'\)::timestamptz <= now\(\) - make_interval\(mins => \$\d+::int\)\)\) \) RETURNING name$/.test(
            claimSql?.sql ?? ''
          ) &&
          (claimSql?.params ?? []).includes(24) &&
          (claimSql?.params ?? []).includes(5)
      );
      ok(
        'a sent email turns its claims into sent markers',
        fz.db.sent.some(
          (s) =>
            /^UPDATE ingest_state SET value = \(value - 'claimedAt'\) \|\| jsonb_build_object\('sentAt', now\(\)\)/.test(
              s.sql
            ) &&
            namesIn(s).includes(
              `alert:sanctions:freeze:${frozenTwo[0].userId}:${frozenTwo[0].payer}`
            )
        )
      );
      const dup = alertRig({ claim: 'lose', pending: pendingTwo });
      ok(
        'a condition already sent today sends nothing',
        (await dup.run(() => A.alertPendingFreezes(dup.db, dup.send))) ===
          'deduped' && dup.mails.length === 0
      );
      const noClaim = alertRig({ claim: 'throw', pending: pendingTwo });
      ok(
        'a claim that cannot be taken sends nothing and throws nothing',
        (await noClaim.run(() =>
          A.alertPendingFreezes(noClaim.db, noClaim.send)
        )) === 'failed' && noClaim.mails.length === 0
      );
      {
        const alertsSrc = withoutComments(
          readFileSync('lib/sanctions-alerts.ts', 'utf8')
        );
        ok(
          'no alert state is kept in memory',
          !/^(let|var) /m.test(alertsSrc) &&
            !/^(export )?const \w+ = new (Map|Set|WeakMap)\(/m.test(alertsSrc)
        );
      }

      // A failed email: logged, claim given back, nothing thrown.
      for (const mode of ['fail', 'throw'] as const) {
        const bad = alertRig({ send: mode, pending: pendingTwo });
        let threw = false;
        let result: unknown;
        try {
          result = await bad.run(() => A.alertPendingFreezes(bad.db, bad.send));
        } catch {
          threw = true;
        }
        ok(
          `an email that ${mode === 'fail' ? 'is rejected' : 'throws'} is logged, its claims released, and nothing thrown`,
          !threw &&
            result === 'failed' &&
            bad.logged.some((l) =>
              /\[sanctions\] alert email failed/.test(l)
            ) &&
            bad.db.sent.some(
              (s) =>
                /^UPDATE ingest_state SET value = value - 'claimedAt', updated_at = now\(\) WHERE name = ANY\(\$1::text\[\]\) AND value->>'sentAt' IS NULL$/.test(
                  s.sql
                ) && namesIn(s).length === 2
            ) &&
            !bad.db.sent.some((s) => s.sql.startsWith('DELETE'))
        );
      }

      // The stale list, read from the database.
      const stale = async (state: unknown, now: string, extra = {}) => {
        const rig = alertRig({ state, ...extra });
        const result = await rig.run(() =>
          A.alertIfListStale(rig.db, new Date(now), rig.send)
        );
        return { result, rig };
      };
      const listAt = (refreshedAt: string) => ({
        publishDate: '2026-09-23',
        refreshedAt,
        addressCount: 124,
      });
      const past = await stale(
        listAt('2026-09-24T00:00:00.000Z'),
        '2026-09-25T12:01:00.000Z'
      );
      const within = await stale(
        listAt('2026-09-24T00:00:00.000Z'),
        '2026-09-25T11:59:00.000Z'
      );
      ok(
        'a list past 36 hours without a successful refresh emails; one inside 36 hours does not',
        past.result === 'sent' &&
          /not refreshed for 36 hours/.test(past.rig.mails[0]?.subject ?? '') &&
          within.result === 'fresh' &&
          within.rig.mails.length === 0 &&
          !within.rig.db.sent.some((s) => s.sql.startsWith('INSERT'))
      );
      const none = await stale(undefined, '2026-09-25T12:00:00.000Z');
      ok(
        'no list at all emails too, keyed as the same stale condition',
        none.result === 'sent' &&
          /missing/.test(none.rig.mails[0]?.subject ?? '') &&
          none.rig.db.sent.some((s) =>
            namesIn(s).includes('alert:sanctions:stale')
          )
      );
      const unread = await stale(undefined, '2026-09-25T12:00:00.000Z', {
        readThrows: true,
      });
      ok(
        'a stale check that cannot read the list throws nothing',
        unread.result === 'failed' && unread.rig.mails.length === 0
      );

      // The refused refresh, and the whole set a run raises.
      const outcomeOf = (
        over: Partial<import('@/lib/sanctions').RefreshOutcome>
      ) =>
        ({
          ok: false,
          refused: null,
          error: null,
          publishDate: '2026-09-23',
          parsed: 89,
          previous: 124,
          added: 0,
          removed: 0,
          freeze: {
            matched: 0,
            newlyFrozen: 0,
            keysDeactivated: 0,
          },
          listAgeHours: 6,
          alert: false,
          ...over,
        }) as import('@/lib/sanctions').RefreshOutcome;
      const refusedRig = alertRig({});
      ok(
        'a refused refresh emails, with counts and no account',
        (await refusedRig.run(() =>
          A.alertRefusedRefresh(
            refusedRig.db,
            outcomeOf({ refused: 'sharp_drop' }),
            refusedRig.send
          )
        )) === 'sent' &&
          /refused: sharp_drop/.test(refusedRig.mails[0]?.subject ?? '') &&
          /acceptCount=89/.test(refusedRig.mails[0]?.text ?? '') &&
          refusedRig.db.sent.some((s) =>
            namesIn(s).includes('alert:sanctions:refused')
          )
      );
      const okRig = alertRig({});
      ok(
        'a run that was not refused sends no refused email',
        (await okRig.run(() =>
          A.alertRefusedRefresh(okRig.db, outcomeOf({ ok: true }), okRig.send)
        )) === null && okRig.mails.length === 0
      );
      {
        const all = alertRig({
          state: listAt('2026-09-25T00:15:00.000Z'),
          pending: pendingTwo,
        });
        const result = await all.run(() =>
          A.sendRefreshAlerts(
            all.db,
            outcomeOf({
              refused: 'sharp_drop',
              freeze: { matched: 2, newlyFrozen: 0, keysDeactivated: 0 },
            }),
            new Date('2026-09-25T06:15:00.000Z'),
            all.send
          )
        );
        ok(
          'one refresh run raises the pending freeze email (from the database, not from what it froze) and the refused email, and checks the list age',
          result.freeze === 'sent' &&
            result.refused === 'sent' &&
            result.stale === 'fresh' &&
            all.mails.length === 2
        );
        const broken = {
          sent: [] as unknown[],
          execute: async () => {
            throw new Error('database down');
          },
        };
        let threw = false;
        try {
          await all.run(() =>
            A.sendRefreshAlerts(
              broken,
              outcomeOf({
                refused: 'empty',
                freeze: { matched: 1, newlyFrozen: 1, keysDeactivated: 1 },
              }),
              new Date(),
              all.send
            )
          );
        } catch {
          threw = true;
        }
        ok('alerts throw nothing even when the database is down', !threw);
      }

      const cronSrc = withoutComments(
        readFileSync('app/api/cron/sanctions-refresh/route.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      const refreshAt = cronSrc.indexOf(
        'const outcome = await refreshSanctionsList({ db, acceptCount });'
      );
      const alertAt = cronSrc.indexOf(
        'const alerts = await sendRefreshAlerts(db, outcome);'
      );
      ok(
        'the refresh route emails only after the run’s writes, and still answers',
        refreshAt !== -1 &&
          alertAt > refreshAt &&
          alertAt <
            cronSrc.indexOf(
              'return NextResponse.json( { ...outcome, freeze, alerts },'
            )
      );
      ok(
        'the refresh response carries freeze counts, never the frozen accounts',
        /const freeze = outcome\.freeze && \{ matched: outcome\.freeze\.matched, newlyFrozen: outcome\.freeze\.newlyFrozen, keysDeactivated: outcome\.freeze\.keysDeactivated, \};/.test(
          cronSrc
        )
      );
      ok(
        'a refresh that fails outright still runs the stale check',
        /console\.error\('\[sanctions\] refresh failed:', error\); await sendRefreshAlerts\(db, null\);/.test(
          cronSrc
        )
      );
      const cleanupSrc = withoutComments(
        readFileSync('app/api/cron/cleanup/route.ts', 'utf8')
      );
      ok(
        'the daily cleanup watches the list too, so a refresh that stopped running still alerts',
        /const sanctionsListAlert = await alertIfListStale\(db\);/.test(
          cleanupSrc.slice(cleanupSrc.indexOf('async function run('))
        )
      );
    }

    // --- the review of 2026-09-25 (PR #400)
    // A: the payer that is screened is the payer that pays. B: a frozen
    // account has no paid entitlement and is not offered a purchase. C, F, G:
    // the freeze email is driven by database state, once per account and
    // listed payer, and cites the list in force. D: a frozen account takes no
    // new money. E: nothing in flight draws held credits. H: the screened
    // payer is an EVM address, in code and in the table.
    {
      const X = await import('@/lib/x402');
      const auth = {
        from: '0x' + '1'.repeat(40),
        to: '0x' + '2'.repeat(40),
        value: '1000000',
        validAfter: '0',
        validBefore: '9999999999',
        nonce: '0x' + '3'.repeat(64),
      };
      ok(
        'only a plain EIP-3009 authorization and its signature is screenable',
        X.isEip3009Only({
          payload: { authorization: auth, signature: '0x' },
        }) &&
          X.isEip3009Only({ payload: { authorization: auth } }) &&
          !X.isEip3009Only({
            payload: {
              authorization: auth,
              signature: '0x',
              permit2Authorization: { from: '0x' + '4'.repeat(40) },
            },
          }) &&
          !X.isEip3009Only({
            payload: { authorization: auth, signature: '0x', note: 'x' },
          }) &&
          !X.isEip3009Only({ payload: { signature: '0x' } }) &&
          !X.isEip3009Only({ payload: [auth] }) &&
          !X.isEip3009Only({})
      );
      ok(
        'a screened payer is a lowercase EVM address and nothing else',
        X.EVM_ADDRESS.test('0x' + 'a'.repeat(40)) &&
          !X.EVM_ADDRESS.test('0x' + 'a'.repeat(39)) &&
          !X.EVM_ADDRESS.test('0x' + 'a'.repeat(41)) &&
          !X.EVM_ADDRESS.test('ops@example.com') &&
          !X.EVM_ADDRESS.test('0x' + 'A'.repeat(40))
      );
      const shapeAt = buy.indexOf(
        'if (!EVM_ADDRESS.test(payer) || !isEip3009Only(payload)) {'
      );
      ok(
        'the payload shape and the payer are checked before the screen, with 400 INVALID_PAYMENT',
        shapeAt !== -1 &&
          shapeAt < buy.indexOf('await screenPayer(payer)') &&
          buy.slice(shapeAt, shapeAt + 400).includes("code: 'INVALID_PAYMENT'")
      );
      const verifiedAt = buy.indexOf(
        'if (verification.payer?.toLowerCase() !== payer) {'
      );
      ok(
        'the payer verify proved must equal the screened payer, or the sale stops before the record and settle',
        verifiedAt !== -1 &&
          verifiedAt > buy.indexOf('if (!verification.isValid) {') &&
          verifiedAt < buy.indexOf('await recordClearScreening(') &&
          verifiedAt < buy.indexOf('server.settlePayment(') &&
          /if \(verification\.payer\?\.toLowerCase\(\) !== payer\) \{ console\.error\([^)]*\); return NextResponse\.json\( \{ error: 'Payment did not verify\.', code: 'PAYMENT_INVALID' \}, \{ status: 402 \} \); \}/.test(
            buy
          )
      );
      const settledAt = buy.indexOf(
        'settlement.payer && settlement.payer.toLowerCase() !== payer'
      );
      const grantAt = buy.indexOf('await grantPackBySettlement(');
      const alertAt = buy.indexOf('await alertSettledPayerMismatch({');
      ok(
        'a settled payer that is not the screened one is logged at once and emailed only after the grant, so a slow send never holds up the lot',
        settledAt > buy.indexOf('if (!settlement.success) {') &&
          buy.indexOf('[sanctions] ALERT: settlement', settledAt) > settledAt &&
          buy.indexOf('[sanctions] ALERT: settlement', settledAt) < grantAt &&
          alertAt > grantAt &&
          alertAt < buy.indexOf('createApiKeyIfUnderCap(') &&
          buy.split('alertSettledPayerMismatch(').length === 2
      );
      const creditedAt = buy.indexOf(
        "const creditedAccount = topUp?.userId ?? (await findWalletAccount(payer)); if (creditedAccount && (await isAccountFrozen(creditedAccount))) { return sanctionsRefusal('listed')!; }"
      );
      ok(
        'a USDC buy into a frozen account is refused with the same 403, only after verify has proven the payer, and before the record and settle',
        creditedAt !== -1 &&
          creditedAt > buy.indexOf('server.verifyPayment(') &&
          creditedAt >
            buy.indexOf('if (verification.payer?.toLowerCase() !== payer) {') &&
          creditedAt < buy.indexOf('await recordClearScreening(') &&
          creditedAt < buy.indexOf('server.settlePayment(')
      );
      ok(
        'a top-up with a frozen account’s key gets the same 403, and the key still never validates',
        /const keyResult = await validateApiKey\(bearer\); if \(!keyResult\) \{ if \(await isFrozenAccountKey\(bearer\)\) \{ return sanctionsRefusal\('listed'\)!; \} return NextResponse\.json\(/.test(
          buy
        ) &&
          (() => {
            const k = withoutComments(readFileSync('lib/api-keys.ts', 'utf8'));
            const fn = k.slice(
              k.indexOf('export async function isFrozenAccountKey('),
              k.indexOf('export async function identifyApiKey(')
            );
            return (
              /return Boolean\(row\?\.frozenAt\);\s*\}\s*$/.test(fn) &&
              !/return \{ key|plan/.test(fn)
            );
          })()
      );
      {
        const acct = withoutComments(
          readFileSync('lib/x402-account.ts', 'utf8')
        );
        const find = acct.slice(
          acct.indexOf('export async function findWalletAccount('),
          acct.indexOf('export async function countSettledPurchases(')
        );
        ok(
          'finding the credited account never creates it',
          /SELECT id FROM \$\{users\} WHERE email = \$\{syntheticEmailForWallet\(wallet\)\}/.test(
            find
          ) && !/INSERT|UPDATE/.test(find)
        );
      }
      {
        const checkoutSrc = withoutComments(
          readFileSync('app/api/checkout/route.ts', 'utf8')
        ).replace(/\s+/g, ' ');
        const frozenAt = checkoutSrc.indexOf(
          "if (session.user && (await isAccountFrozen(session.user.id))) { return sanctionsRefusal('listed')!; }"
        );
        ok(
          'a signed-in frozen account gets no card checkout session, and only the session is checked',
          frozenAt !== -1 &&
            frozenAt < checkoutSrc.indexOf('createPackCheckoutSession(') &&
            frozenAt < checkoutSrc.indexOf('isStripeConfigured()') &&
            /const session = token \? await validateSession\(token\) : \{ user: null \};/.test(
              checkoutSrc
            )
        );
        const fulfil = withoutComments(
          readFileSync('lib/pack-fulfilment.ts', 'utf8')
        ).replace(/\s+/g, ' ');
        ok(
          'a card payment that lands on a frozen account is granted as usual and emailed',
          /if \(granted\) \{ await alertFrozenAccountPayment\(\{ userId: user\.id, reference: stripePaymentId,/.test(
            fulfil
          ) &&
            fulfil.indexOf('await alertFrozenAccountPayment(') >
              fulfil.indexOf('await grantPack(')
        );
      }
      {
        const A = await import('@/lib/sanctions-alerts');
        const mails: string[] = [];
        const send = async (subject: string, text: string) => {
          mails.push(`${subject}\n${text}`);
          return { success: true };
        };
        const payDb = (frozen: boolean) =>
          fakeDb((flat, params) => {
            if (flat.startsWith('SELECT frozen_at FROM users')) {
              return { rows: [{ frozen_at: frozen ? new Date() : null }] };
            }
            if (flat.startsWith('INSERT INTO ingest_state'))
              return claimWon(params);
            return { rows: [] };
          });
        const payment = {
          userId: '55555555-5555-4555-8555-555555555555',
          reference: 'pi_example',
          pack: 'trial',
          amountCents: 2900,
        };
        const clearPay = await A.alertFrozenAccountPayment(
          payment,
          payDb(false),
          send
        );
        const frozenPayDb = payDb(true);
        const frozenPay = await A.alertFrozenAccountPayment(
          payment,
          frozenPayDb,
          send
        );
        ok(
          'the frozen-payment email goes out only for a frozen account, once per payment',
          clearPay === null &&
            frozenPay === 'sent' &&
            mails.length === 1 &&
            /payment received for a frozen account/.test(mails[0]) &&
            mails[0].includes(payment.userId) &&
            mails[0].includes('pi_example') &&
            frozenPayDb.sent.some(
              (s) =>
                s.sql.startsWith('INSERT INTO ingest_state') &&
                namesIn(s).includes(
                  'alert:sanctions:frozen-payment:pi_example'
                ) &&
                namesIn(s).some(
                  (p) =>
                    typeof p === 'string' &&
                    p.includes('"reference":"pi_example"')
                )
            )
        );
        const mismatchDb = fakeDb((flat, params) =>
          flat.startsWith('INSERT INTO ingest_state')
            ? claimWon(params)
            : { rows: [] }
        );
        const mismatch = await A.alertSettledPayerMismatch(
          {
            settlementId: 'eip155:8453:0xaa:0x01',
            screenedPayer: '0x' + 'a'.repeat(40),
            settledPayer: '0x' + 'b'.repeat(40),
            transaction: '0x' + 'c'.repeat(64),
          },
          mismatchDb,
          send
        );
        ok(
          'a settled-payer mismatch emails both wallets and the settlement, once',
          mismatch === 'sent' &&
            mails[1].includes('0x' + 'a'.repeat(40)) &&
            mails[1].includes('0x' + 'b'.repeat(40)) &&
            mismatchDb.sent.some((s) =>
              namesIn(s).includes(
                'alert:sanctions:settled-payer:eip155:8453:0xaa:0x01'
              )
            )
        );

        // C and F: the pending freezes come from the database, and the list
        // date is the in-force list's, whatever the run's own download was.
        const pendingDb = fakeDb((flat, params) => {
          if (flat.startsWith('WITH pairs AS (')) {
            return {
              rows: [
                {
                  userId: '66666666-6666-4666-8666-666666666666',
                  payer: '0x' + 'd'.repeat(40),
                  sdnUid: '1',
                  publishDate: '2026-09-23',
                },
              ],
            };
          }
          if (flat.startsWith('INSERT INTO ingest_state'))
            return claimWon(params);
          if (flat.startsWith('SELECT value FROM ingest_state')) {
            return {
              rows: [
                {
                  value: {
                    publishDate: '2026-09-23',
                    refreshedAt: new Date().toISOString(),
                    addressCount: 124,
                  },
                },
              ],
            };
          }
          return { rows: [] };
        });
        const before = mails.length;
        const res = await A.sendRefreshAlerts(
          pendingDb,
          {
            ok: false,
            refused: 'older_publication',
            error: null,
            publishDate: '2026-10-01',
            parsed: 100,
            previous: 124,
            added: 0,
            removed: 0,
            freeze: { matched: 1, newlyFrozen: 0, keysDeactivated: 0 },
            listAgeHours: 1,
            alert: false,
          },
          new Date(),
          send
        );
        const freezeMail =
          mails.slice(before).find((m) => /frozen/.test(m)) ?? '';
        ok(
          'a freeze email for an account frozen earlier still goes out, citing the list in force',
          res.freeze === 'sent' &&
            /published 2026-09-23/.test(freezeMail) &&
            !freezeMail.includes('2026-10-01')
        );
        const pendingSql =
          pendingDb.sent.find((s) => s.sql.startsWith('WITH pairs AS ('))
            ?.sql ?? '';
        ok(
          'pending freezes are frozen accounts with a listed payer and no sent marker for that pair',
          pendingSql.includes("split_part(l.settlement_id, ':', 3)") &&
            /JOIN users u ON u\.id = p\.user_id AND u\.frozen_at IS NOT NULL JOIN sanctioned_addresses s ON s\.address = p\.payer WHERE NOT EXISTS \( SELECT 1 FROM ingest_state a WHERE a\.name = \$\d+::text \|\| p\.user_id::text \|\| ':' \|\| p\.payer AND \(a\.value->>'sentAt' IS NOT NULL OR \(a\.value->>'claimedAt'\)::timestamptz > now\(\) - make_interval\(mins => \$\d+::int\)\) \)/.test(
              pendingSql
            ) &&
            /\(SELECT value->>'publishDate' FROM ingest_state WHERE name = \$\d+\) AS "publishDate"/.test(
              pendingSql
            )
        );
        const cleanupRun = withoutComments(
          readFileSync('app/api/cron/cleanup/route.ts', 'utf8')
        );
        ok(
          'the daily cleanup sends pending freeze emails too',
          /const sanctionsFreezeAlert = await alertPendingFreezes\(db\);/.test(
            cleanupRun.slice(cleanupRun.indexOf('async function run('))
          )
        );
      }
      {
        // G: every listed payer of an account names the freeze.
        const db = fakeDb(() => ({
          rows: [{ matched: 1, newly_frozen: 1, keys_deactivated: 0 }],
        }));
        await S.freezeListedBuyers(db, '2026-09-23');
        ok(
          'the freeze reason names every listed payer of the account',
          /hits AS \( SELECT user_id, string_agg\(payer, ', ' ORDER BY payer\) AS payers FROM pairs GROUP BY user_id \)/.test(
            db.sent[0]?.sql ?? ''
          ) &&
            /frozen_reason = 'sanctions list match: x402 payer\(s\) ' \|\| hits\.payers/.test(
              db.sent[0]?.sql ?? ''
            )
        );
      }
      {
        // C: the seed puts the list in place and freezes nobody.
        const seedDb = fakeDb((flat) => {
          if (flat.includes('FROM sanctioned_addresses) AS n')) {
            return { rows: [{ n: 0, state: null }] };
          }
          if (flat.startsWith('WITH incoming AS')) {
            return { rows: [{ added: 6, removed: 0, total: 6 }] };
          }
          return { rows: [] };
        });
        const seeded = await S.refreshSanctionsList({
          db: seedDb,
          fetchXml: async () => fixture,
          freeze: false,
        });
        const migSrc = withoutComments(
          readFileSync('scripts/migrate-sanctions-screening.ts', 'utf8')
        ).replace(/\s+/g, ' ');
        ok(
          'the migration seed puts the list in force and freezes nobody',
          seeded.ok &&
            seeded.freeze === null &&
            !seedDb.sent.some((s) => s.sql.startsWith('WITH pairs AS (')) &&
            /refreshSanctionsList\(\{ db: drizzle\(sql\), freeze: false, \}\)/.test(
              migSrc
            )
        );
        ok(
          'the screening table refuses an address that is not an EVM address',
          /address text NOT NULL CHECK \(address ~ '\^0x\[0-9a-f\]\{40\}\$'\), list_publish_date date,/.test(
            migSrc
          )
        );
      }
      {
        // B and E: the credits gates.
        const credits = withoutComments(readFileSync('lib/credits.ts', 'utf8'));
        const paid = credits.slice(
          credits.indexOf('export async function hasPaidAccess('),
          credits.indexOf('export interface CreditBalance')
        );
        ok(
          'a frozen account has no paid entitlement, ahead of the legacy tiers',
          /if \(await isAccountFrozen\(userId\)\) return false;\s*if \(legacyTierIsUnmetered\(tier\)\) return true;/.test(
            paid
          )
        );
        for (const route of [
          'app/api/reverse/route.ts',
          'app/api/x/lists/route.ts',
          'app/api/farcaster-dm/route.ts',
          'app/api/contract-holders/route.ts',
        ]) {
          ok(
            `${route} gates its paid feature on hasPaidAccess, which a freeze closes`,
            /await hasPaidAccess\(/.test(
              withoutComments(readFileSync(route, 'utf8'))
            )
          );
        }
        ok(
          'a frozen verdict is marked, and neither submission nor unlock offers a purchase',
          /balance: EMPTY_BALANCE,\s*frozen: true,/.test(credits) &&
            /upgradeRequired: !verdict\.frozen, \.\.\.\(verdict\.frozen \? \{ code: 'ACCOUNT_SUSPENDED' \} : \{\}\),/.test(
              withoutComments(
                readFileSync('app/api/jobs/route.ts', 'utf8')
              ).replace(/\s+/g, ' ')
            ) &&
            /upgradeRequired: !verdict\.frozen, locked/.test(
              withoutComments(
                readFileSync('app/api/jobs/[id]/unlock/route.ts', 'utf8')
              )
            )
        );
        const job = credits.slice(
          credits.indexOf('export async function chargeForJob('),
          credits.indexOf('export async function chargeForApiCall(')
        );
        ok(
          'a job finishing after its freeze bills nothing and delivers nothing, ahead of every other rule',
          /^export async function chargeForJob\([^)]*\): Promise<JobCharge> \{\s*if \(await isAccountFrozen\(userId\)\) \{\s*return \{\s*billed: 0,\s*goodwill: 0,\s*delivered: 0,\s*duplicate: false,\s*paidFrom: null,\s*frozen: true,/.test(
            job
          )
        );
        const call = credits.slice(
          credits.indexOf('export async function chargeForApiCall('),
          credits.indexOf('export interface UnlockVerdict')
        );
        ok(
          'an API call finishing after its freeze draws nothing',
          call.indexOf('if (await isAccountFrozen(userId)) return 0;') !== -1 &&
            call.indexOf('if (await isAccountFrozen(userId)) return 0;') <
              call.indexOf('drawDown(')
        );
        const jp = withoutComments(
          readFileSync('lib/job-processor.ts', 'utf8')
        ).replace(/\s+/g, ' ');
        const failAt = jp.indexOf('if (frozenAccount) {');
        const failBlock = jp.slice(
          failAt,
          jp.indexOf('// Save to history if requested')
        );
        ok(
          'a job whose account froze fails with its results cleared, before history and completion',
          jp.includes('if (charge.frozen) frozenAccount = true;') &&
            failAt !== -1 &&
            failBlock.includes(
              "await writeOwned(db, job, { status: 'failed', errorMessage: FROZEN_ACCOUNT_MESSAGE, partialResults: null,"
            ) &&
            failAt < jp.indexOf('if (options.saveToHistory) {') &&
            failAt < jp.indexOf("status: 'completed'")
        );
        ok(
          'the freeze is read outside the charge’s catch-all, so a failed read hands the job back instead of completing it',
          /if \( ?options\.meteredUserId && \(await isAccountFrozen\(options\.meteredUserId\)\) ?\) \{ frozenAccount = true; \} if \(options\.meteredUserId\) \{ try \{/.test(
            jp
          )
        );
        ok(
          'a job charged before its account froze is logged and emailed for a refund decision, not called unbilled',
          /const \{ billed \} = await completionState\(db, job\.id\); if \(billed\) \{ console\.error\( `Job \$\{job\.id\} was charged before its account was frozen[^`]*needs a refund decision` \); await alertFrozenBilledJob\(\{ jobId: job\.id, userId: options\.meteredUserId!, \}\); \}/.test(
            failBlock
          )
        );
      }
      {
        // I: the public page names the list and where a 503 can come.
        const page = readFileSync('docs-site/agent-pack.mdx', 'utf8');
        ok(
          'the agent pack page names OFAC’s SDN list and puts every refusal before settlement',
          /The paying wallet is screened against OFAC’s SDN list/.test(page) &&
            /before the payment is settled/.test(page) &&
            !/before anything is\s+verified or settled/.test(page)
        );
        const ops = readFileSync('docs/OPERATIONS.md', 'utf8');
        ok(
          'the runbook says a download or parse failure is emailed only through the 36-hour alert',
          /A download\s+or parse failure is not emailed by itself/.test(ops) &&
            /shows at once as `failing`\s+on the health panel/.test(ops)
        );
      }
    }

    // --- the second review of 2026-09-25 (PR #400)
    // Alerts with a payload are durable records resent until sent; claims
    // expire; sends time out; a frozen account's paid-feature gates answer
    // without an offer to buy; a lift on legal advice sticks.
    {
      const A = await import('@/lib/sanctions-alerts');
      const E = await import('@/lib/email');
      const AF = await import('@/lib/account-freeze');

      // 7: every send is bounded.
      const hung = await E.withTimeout(
        new Promise<string>(() => {}),
        20,
        'gave up'
      );
      const quick = await E.withTimeout(
        Promise.resolve('done'),
        1000,
        'gave up'
      );
      const emailSrc = withoutComments(readFileSync('lib/email.ts', 'utf8'));
      const alertsSrc = withoutComments(
        readFileSync('lib/sanctions-alerts.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      ok(
        'an operator alert gives up after ten seconds, in the sender and around every send',
        hung === 'gave up' &&
          quick === 'done' &&
          E.OPS_ALERT_TIMEOUT_MS === 10_000 &&
          /await withTimeout\(\s*resend\.emails\.send\(/.test(emailSrc) &&
          /OPS_ALERT_TIMEOUT_MS,/.test(emailSrc) &&
          /result = await withTimeout\(send\(subject, text\), OPS_ALERT_TIMEOUT_MS, \{/.test(
            alertsSrc
          )
      );

      // 1: a record with a payload is resent from the database until sent.
      const recordRows = [
        {
          name: 'alert:sanctions:frozen-payment:pi_resend',
          payload: {
            userId: '77777777-7777-4777-8777-777777777777',
            reference: 'pi_resend',
            pack: 'trial',
            amountCents: 2900,
          },
        },
        {
          name: 'alert:sanctions:frozen-job:88888888-8888-4888-8888-888888888888',
          payload: {
            jobId: '88888888-8888-4888-8888-888888888888',
            userId: '77777777-7777-4777-8777-777777777777',
          },
        },
      ];
      const sweepDb = fakeDb((flat, params) => {
        if (flat.startsWith("SELECT name, value->'payload' AS payload")) {
          return { rows: recordRows };
        }
        if (flat.startsWith('INSERT INTO ingest_state'))
          return claimWon(params);
        return { rows: [] };
      });
      const swept: string[] = [];
      const swept1 = await A.sendUnsentAlertRecords(sweepDb, async (s, t) => {
        swept.push(`${s}\n${t}`);
        return { success: true };
      });
      const sweepSql = sweepDb.sent[0]?.sql ?? '';
      ok(
        'the sweep resends every durable record with no sent marker and no live claim, from its payload',
        swept1.sent === 2 &&
          swept.some(
            (m) =>
              /payment received for a frozen account/.test(m) &&
              m.includes('pi_resend')
          ) &&
          swept.some(
            (m) =>
              /charged before its account was frozen/.test(m) &&
              m.includes('88888888')
          ) &&
          /^SELECT name, value->'payload' AS payload FROM ingest_state WHERE name LIKE ANY\(\$1::text\[\]\) AND value->'payload' IS NOT NULL AND value->>'sentAt' IS NULL AND \(value->>'claimedAt' IS NULL OR \(value->>'claimedAt'\)::timestamptz <= now\(\) - make_interval\(mins => \$2::int\)\) ORDER BY name$/.test(
            sweepSql
          ) &&
          JSON.stringify(sweepDb.sent[0]?.params[0]) ===
            JSON.stringify([
              'alert:sanctions:settled-payer:%',
              'alert:sanctions:frozen-payment:%',
              'alert:sanctions:frozen-job:%',
            ])
      );
      const cleanupRun = withoutComments(
        readFileSync('app/api/cron/cleanup/route.ts', 'utf8')
      ).replace(/\s+/g, ' ');
      const runPart = cleanupRun.slice(
        cleanupRun.indexOf('async function run(')
      );
      ok(
        'the refresh and the daily cleanup both resend the records, and the cleanup does it after its housekeeping',
        /const records = await sendUnsentAlertRecords\(db, send\);/.test(
          alertsSrc
        ) &&
          /const sanctionsAlertRecords = await sendUnsentAlertRecords\(db\);/.test(
            runPart
          ) &&
          runPart.indexOf('await alertIfListStale(db)') >
            runPart.indexOf('.delete(analyticsEvents)') &&
          runPart.indexOf('await alertPendingFreezes(db)') >
            runPart.indexOf('await cleanupIdempotencyKeys()')
      );
      {
        const failedDb = fakeDb((flat, params) =>
          flat.startsWith('INSERT INTO ingest_state')
            ? claimWon(params)
            : { rows: [] }
        );
        const quiet = console.error;
        console.error = () => {};
        const failed = await A.alertFrozenBilledJob(
          { jobId: 'job-1', userId: 'user-1' },
          failedDb,
          async () => ({ success: false, error: 'provider down' })
        );
        console.error = quiet;
        const claim = failedDb.sent.find((s) =>
          s.sql.startsWith('INSERT INTO ingest_state')
        );
        ok(
          'a record is written with its payload before the send, and a failed send keeps it for the sweep',
          failed === 'failed' &&
            namesIn(claim!).includes('alert:sanctions:frozen-job:job-1') &&
            namesIn(claim!).some(
              (p) => typeof p === 'string' && p.includes('"jobId":"job-1"')
            ) &&
            failedDb.sent.findIndex((s) =>
              s.sql.startsWith('INSERT INTO ingest_state')
            ) <
              failedDb.sent.findIndex((s) =>
                s.sql.startsWith(
                  "UPDATE ingest_state SET value = value - 'claimedAt'"
                )
              ) &&
            !failedDb.sent.some((s) => s.sql.startsWith('DELETE'))
        );
      }

      // 6: the gates behind hasPaidAccess answer a frozen account plainly.
      const frozenRes = AF.frozenAccountResponse();
      const frozenBody = (await frozenRes.json()) as Record<string, unknown>;
      ok(
        'a frozen account’s refusal names the suspension and carries no offer to buy',
        frozenRes.status === 403 &&
          frozenBody.code === 'ACCOUNT_SUSPENDED' &&
          frozenBody.error === AF.FROZEN_ACCOUNT_MESSAGE &&
          frozenBody.message === AF.FROZEN_ACCOUNT_MESSAGE &&
          !('upgradeRequired' in frozenBody)
      );
      for (const [route, frozenCheck] of [
        [
          'app/api/reverse/route.ts',
          'if (user && (await isAccountFrozen(user.id))) return frozenAccountResponse();',
        ],
        [
          'app/api/farcaster-dm/route.ts',
          'if (await isAccountFrozen(session.user.id)) return frozenAccountResponse();',
        ],
        [
          'app/api/contract-holders/route.ts',
          'if (await isAccountFrozen(session.user.id)) return frozenAccountResponse();',
        ],
        [
          'app/api/x/lists/route.ts',
          'if (await isAccountFrozen(session.user.id)) return frozenAccountResponse();',
        ],
        [
          'app/api/history/[id]/route.ts',
          'if (await isAccountFrozen(validation.userId)) { return frozenAccountResponse(); }',
        ],
      ] as const) {
        const src = withoutComments(readFileSync(route, 'utf8')).replace(
          /\s+/g,
          ' '
        );
        const at = src.indexOf(frozenCheck);
        ok(
          `${route} answers a frozen account before its paid gate, with no offer to buy`,
          at !== -1 &&
            src.indexOf('await hasPaidAccess(', at) !== -1 &&
            src.indexOf('await hasPaidAccess(', at) - at < 300
        );
      }

      // 8: a lift on legal advice sticks for the payers it released.
      {
        const freezeDb = fakeDb(() => ({
          rows: [{ matched: 0, newly_frozen: 0, keys_deactivated: 0 }],
        }));
        await S.freezeListedBuyers(freezeDb, '2026-09-23');
        ok(
          'every freeze and every freeze email leaves out a pair released on legal advice',
          /\) lp WHERE NOT EXISTS \( SELECT 1 FROM sanctions_freeze_releases r WHERE r\.user_id = lp\.user_id AND r\.payer = lp\.payer \)/.test(
            freezeDb.sent[0]?.sql ?? ''
          ) &&
            /WITH pairs AS \(\$\{listedPayerPairs\(\)\}\)/.test(
              withoutComments(readFileSync('lib/sanctions-alerts.ts', 'utf8'))
            )
        );
        const liftDb = fakeDb(() => ({ rows: [{ released: 1, unfrozen: 1 }] }));
        const lifted = await S.liftFreeze(
          liftDb,
          '99999999-9999-4999-8999-999999999999',
          'counsel, 2026-10-01'
        );
        const liftSql = liftDb.sent[0]?.sql ?? '';
        ok(
          'a lift records every listed payer the account has now and clears the freeze, in one statement, for a frozen account only',
          liftDb.sent.length === 1 &&
            lifted.released === 1 &&
            lifted.unfrozen === 1 &&
            /WITH target AS \( SELECT id FROM users WHERE id = \$1::uuid AND frozen_at IS NOT NULL \)/.test(
              liftSql
            ) &&
            /INSERT INTO sanctions_freeze_releases \(user_id, payer, note\) SELECT p\.user_id, p\.payer, \$\d+::text FROM pairs p JOIN target t ON t\.id = p\.user_id ON CONFLICT \(user_id, payer\) DO NOTHING/.test(
              liftSql
            ) &&
            /UPDATE users u SET frozen_at = NULL,/.test(liftSql) &&
            liftDb.sent[0].params.includes('counsel, 2026-10-01')
        );
        const liftScript = withoutComments(
          readFileSync('scripts/sanctions-lift-freeze.ts', 'utf8')
        ).replace(/\s+/g, ' ');
        const migrationSrc = withoutComments(
          readFileSync('scripts/migrate-sanctions-screening.ts', 'utf8')
        ).replace(/\s+/g, ' ');
        ok(
          'the lift script writes nothing without --commit and goes through liftFreeze',
          /const commit = process\.argv\.includes\('--commit'\);/.test(
            liftScript
          ) &&
            /if \(!commit\) \{ console\.log\([\s\S]*?\); return; \}/.test(
              liftScript
            ) &&
            liftScript.indexOf('if (!commit) {') !== -1 &&
            liftScript.indexOf('if (!commit) {') <
              liftScript.indexOf('await liftFreeze(') &&
            /CREATE TABLE IF NOT EXISTS sanctions_freeze_releases \( user_id uuid NOT NULL REFERENCES users\(id\), payer text NOT NULL CHECK \(payer ~ '\^0x\[0-9a-f\]\{40\}\$'\),[\s\S]*?PRIMARY KEY \(user_id, payer\) \)/.test(
              migrationSrc
            )
        );
        const ops = readFileSync('docs/OPERATIONS.md', 'utf8').replace(
          /\s+/g,
          ' '
        );
        ok(
          'runbook step 4 lifts a freeze with the script, and says a later payer still freezes',
          /4\. Leave the account frozen until the lawyer says otherwise\. To lift it\s+on their advice, run\s+`scripts\/sanctions-lift-freeze\.ts/.test(
            ops
          ) &&
            /payer listed after the lift still freezes the\s+account/.test(ops)
        );
      }
    }

    // --- the schedule, the alert and the backup
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    ok(
      'the refresh runs every six hours',
      vercel.crons.some(
        (c) =>
          c.path === '/api/cron/sanctions-refresh' &&
          /^\d{1,2} \*\/6 \* \* \*$/.test(c.schedule)
      )
    );
    const cron = withoutComments(
      readFileSync('app/api/cron/sanctions-refresh/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'the refresh reports its real outcome to the health panel, and a failed run is not a 200',
      /eventSubtype: 'sanctions_refresh', ok: outcome\.ok,/.test(cron) &&
        /status: outcome\.ok \? 200 : 502/.test(cron)
    );
    ok(
      'an override only counts with the cron secret set',
      /cronSecret && acceptParam !== null/.test(cron)
    );
    const health = withoutComments(
      readFileSync('app/api/admin/health/dependencies/route.ts', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'the health panel alerts after 36 hours without a successful refresh',
      S.SANCTIONS_ALERT_AFTER_HOURS === 36 &&
        /subtype: 'sanctions_refresh', maxAgeHours: SANCTIONS_ALERT_AFTER_HOURS, reportsOutcome: true,/.test(
          health
        )
    );
    ok(
      'and it counts a recent freeze as something wrong',
      /recentFreezes: frozenAccounts\?\.recent \?\? null/.test(health) &&
        /!summary\.recentFreezes/.test(
          readFileSync('components/admin/DependencyHealth.tsx', 'utf8')
        )
    );
    const backupList =
      readFileSync('scripts/migrate-grant-readonly.ts', 'utf8').match(
        /const BACKUP_TABLES = \[([\s\S]*?)\]/
      )?.[1] ?? '';
    ok(
      'the screening record is in the nightly dump and the rebuildable list is not',
      /'sanctions_screenings'/.test(backupList) &&
        !/'sanctioned_addresses'/.test(backupList)
    );
  }

  if (!failures.length) {
    console.log(`invariants ok — ${checked} adversarial assertions pass`);
    process.exit(0);
  }
  console.error(
    'An invariant this codebase claims in a comment no longer holds:\n'
  );
  for (const f of failures) console.error(`  FAILED  ${f}`);
  console.error(`\n${failures.length} of ${checked} failed.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
