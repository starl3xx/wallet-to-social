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
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { execFileSync } from 'child_process';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { privateKeyToAccount } from 'viem/accounts';
import { ERC20_SUPPORTED_CHAINS, SUPPORTED_CHAINS } from '../lib/chains';
import {
  API_TIMEOUT_MS,
  batchDeadlineMs,
  MIN_BATCH_DEADLINE_MS,
} from '../lib/web3bio';
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
      'a unique violation is recognised through the Drizzle wrapper',
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
      /I'd be happy to gift you a Trial pack/.test(
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
        at('await consumeCode(') !== -1 &&
        at('await loadCode(') < at('await consumeCode(')
    );
    ok(
      'the client binding is checked before the code is spent',
      at('row.clientId !== clientId') !== -1 &&
        at('row.clientId !== clientId') < at('await consumeCode(')
    );
    ok(
      'the redirect binding is checked before the code is spent',
      at('redirectUri !== row.redirectUri') !== -1 &&
        at('redirectUri !== row.redirectUri') < at('await consumeCode(')
    );
    ok(
      'PKCE is checked before the code is spent',
      at('pkceMatches(') !== -1 && at('pkceMatches(') < at('await consumeCode(')
    );
    ok(
      'nothing is revoked before the caller has proved it is the right client',
      at('revokeGrant(') !== -1 && at('await consumeCode(') < at('revokeGrant(')
    );

    // A failed consume has three causes and only one of them is a replay.
    // Reading it as a boolean revoked the grant of any first exchange that
    // arrived a moment past the window, and let a replay that arrived late
    // pass without revoking anything.
    ok(
      'only a replay revokes, not every failure to spend the code',
      body.includes("spent === 'replayed'") &&
        body.indexOf("spent === 'replayed'") < at('revokeGrant(')
    );
    ok(
      'an expired code is answered without revoking anything',
      body.includes("spent !== 'consumed'") &&
        body.indexOf('revokeGrant(') < body.indexOf("spent !== 'consumed'")
    );

    // Two clocks decided this before: the Node clock in `loadCode` and
    // Postgres's in the UPDATE. A code near its boundary passed one and failed
    // the other, and the disagreement was read as a replay.
    const requests = readFileSync('lib/oauth/requests.ts', 'utf8');
    const loadBody = requests.slice(
      requests.indexOf('export async function loadCode'),
      requests.indexOf('export type ConsumeResult')
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
      requests.indexOf('export async function consumeCode')
    );
    ok(
      'a spent code reports as replayed even once it has aged out',
      consumeBody.indexOf("return 'replayed'") <
        consumeBody.indexOf("return 'expired'")
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
     * `inngest/functions/wallet-lookup.ts`, with the same bug in two more
     * object literals, on the path that every upload above the inline
     * threshold takes. So the fix was in the less used branch and the
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
      `at least two pipelines spread walletData, and all were found (${writers.length})`,
      writers.length >= 2
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
      /c\.their_source = ANY\(\$\{sql\.param\(MAPPED_SOURCE_IDS\)\}/.test(
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
      'it closes only rows where neither side is live',
      /o\.status IN \('not_found', 'unavailable'\)/.test(code) &&
        /t\.status IN \('not_found', 'unavailable'\)/.test(code)
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

  // ------------------------- HyperEVM: the first chain with no holder index
  // Three sources refuse the chain (checked 2026-08-31): the NFT API, the
  // metered ERC-20 index and Blockscout, which has no instance for it. Its NFT
  // owners are read off the contract one token id at a time instead. That path
  // has failure modes the indexed paths do not, and these are the ones that
  // would ship a wrong answer rather than an error.
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
     * Adding hyperevm here would put an ERC-20 tile in front of a customer with
     * nothing behind it: no metered index accepts the chain and no explorer
     * serves it, so the import throws CHAIN_NO_ERC20_SUPPORT every time. The
     * file's own rule is to keep this list in step with MORALIS_CHAIN_IDS and
     * BLOCKSCOUT_BASE_URLS, and this is that rule made checkable.
     */
    const erc20List = sliceBetween(
      chains,
      'export const ERC20_SUPPORTED_CHAINS',
      '];'
    );
    ok(
      'hyperevm is kept out of ERC20_SUPPORTED_CHAINS',
      erc20List.length > 0 && !erc20List.includes('hyperevm')
    );
    ok(
      'no chain is listed for ERC-20 without a metered index or an explorer',
      ERC20_SUPPORTED_CHAINS.every(
        (c) =>
          holders.includes(`  ${c}: '0x`) ||
          holders.includes(`  ${c}: 'https://`)
      )
    );

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
    ok(
      'hyperevm has an explicit place in SEED_ORDER',
      sliceBetween(
        seed,
        'const SEED_ORDER: SupportedChain[] = [',
        '];'
      ).includes("'hyperevm'")
    );
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
     * rate" stat were structural zeros for seven months. Asserted in both
     * pipelines, because `app/api/inngest/route.ts` registers the second one
     * and a fix applied to only the first leaves it running the old behaviour.
     */
    ok(
      'the job processor emits history_saved when a save succeeds',
      /saveLookup\([\s\S]{0,400}?trackEvent\('history_saved'/.test(processor)
    );
    ok(
      'the inngest pipeline emits it too',
      /saveLookup\([\s\S]{0,400}?trackEvent\('history_saved'/.test(
        readFileSync('inngest/functions/wallet-lookup.ts', 'utf8')
      )
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
    // An unnamed counterparty reaches a page as the string "Unknown Token",
    // which is both useless to a reader and a tell that the name check is only
    // testing for NULL.
    ok(
      'a placeholder-named counterparty is excluded by name, not only by NULL',
      /sc\.name <> 'Unknown Token'/.test(overlapSql)
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

  // ------------------------------------------------ the recognised seed prefix
  // lib/recognized-contracts.ts says "do not add an entry from memory". That
  // instruction is the only thing standing between this file and a page about
  // the wrong asset, and an instruction in a comment enforces nothing.
  {
    const { RECOGNIZED_CONTRACTS, recognizedCandidates } =
      await import('@/lib/recognized-contracts');
    const { SUPPORTED_CHAINS } = await import('@/lib/chains');

    ok(
      'every recognised address is a lowercase 40-hex contract address',
      RECOGNIZED_CONTRACTS.every((c) => /^0x[0-9a-f]{40}$/.test(c.address))
    );
    ok(
      'no chain lists the same contract twice',
      new Set(RECOGNIZED_CONTRACTS.map((c) => `${c.chain}:${c.address}`))
        .size === RECOGNIZED_CONTRACTS.length
    );
    ok(
      'every recognised contract names a supported chain',
      RECOGNIZED_CONTRACTS.every((c) => SUPPORTED_CHAINS.includes(c.chain))
    );
    // A zero address, a burn address or the chain's own predeploy range would
    // pass the hex check and publish a page about nothing.
    ok(
      'no recognised entry is the zero or burn address',
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
      'app/holders/[chain]/[address]/page.tsx',
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

    // A preview build prerenders no holder pages: generateStaticParams
    // answers the empty list before the corpus listing is consulted.
    const holders = withoutComments(
      readFileSync('app/holders/[chain]/[address]/page.tsx', 'utf8')
    ).replace(/\s+/g, ' ');
    ok(
      'a preview build prerenders no holder pages (generateStaticParams answers [])',
      /if \(process\.env\.VERCEL_ENV === 'preview'\) return \[\];/.test(holders)
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

    ok(
      'the graph-error fallback cannot walk a suppressed wallet into the pipeline',
      flat.includes('walletsNeedingLookup.push(...activeWallets);') &&
        !flat.includes('walletsNeedingLookup.push(...walletsToProcess)')
    );

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
