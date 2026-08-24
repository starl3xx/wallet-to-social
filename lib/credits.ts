/**
 * The credit ledger: what an account may spend, and what it has spent.
 *
 * ## The two meters, and why there are two
 *
 * A **free** account has no lots. Its allowance is a rolling 30-day window over
 * `credit_ledger`, which is what makes splitting a file pointless: twenty runs
 * of 500 debit exactly what one run of 10,000 debits. The old free tier capped
 * per lookup and allowed unlimited lookups, so it capped nothing.
 *
 * A **paid** account spends from `credit_lots`, FIFO by expiry. Legacy `pro`
 * and `unlimited` accounts predate all of this and are not metered at all; see
 * `legacyTierIsUnmetered`.
 *
 * ## Charge on completion, never on submission
 *
 * The unit is a match, so the amount owed is not known until the job finishes.
 * Everything here is therefore either a *pre-flight estimate* (`canSubmit`) or a
 * *post-hoc debit* (`chargeForJob`). Nothing is reserved in between, which means
 * two jobs started at once can together overspend a balance.
 *
 * That is a deliberate trade. The alternative is holds and releases, which adds
 * a reconciliation path and a class of stuck holds, to protect against an
 * overspend bounded by one job's matches on an account that has already paid.
 * The ledger records the overspend rather than preventing it, and
 * `balance()` floors at zero so an overspent account is simply out of credits.
 */
import { getDb } from '@/db';
import { creditLots, creditLedger, users } from '@/db/schema';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import {
  CREDIT_LIFETIME_DAYS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  SUBMISSION_MULTIPLIER,
  LEGACY_UNLIMITED_DAILY_WALLETS,
  PACKS,
  type PackId,
} from '@/lib/packs';
import type { UserTier } from '@/lib/access';

/**
 * Legacy tiers bought under the old one-time model are never metered.
 *
 * `unlimited` was sold as "unlimited wallets forever" and `pro` as a one-time
 * purchase with a per-lookup limit. Neither buyer agreed to credits, and
 * retrofitting a meter onto a completed sale is the thing this codebase's whole
 * honesty position is against. They keep what they bought, permanently.
 */
export function legacyTierIsUnmetered(tier: UserTier): boolean {
  return tier === 'pro' || tier === 'unlimited';
}

/**
 * Whether paid features are unlocked for this account, server-side.
 *
 * The twin of `entitled` in lib/use-credits.ts, and it exists for the same
 * reason: every feature gate used to read `tier`, and a pack purchase never
 * changes `tier`, so the gates refused the people who had just paid. The
 * client gates were fixed first; these are the gates behind them, which are
 * the ones that matter, because a gate enforced only in the browser is a
 * suggestion.
 *
 * Paid means a legacy tier, the whitelist (which `getUserAccess` reports as
 * `unlimited`), or a live credit lot. The free allowance deliberately does not
 * count, for the reason given in use-credits.ts: those features were never
 * part of free, and adding them quietly would be a pricing change.
 */
export async function hasPaidAccess(
  userId: string,
  tier: UserTier
): Promise<boolean> {
  if (legacyTierIsUnmetered(tier)) return true;
  const balance = await getBalance(userId);
  return !balance.onFreeAllowance;
}

export interface CreditBalance {
  /** Matches available right now. Floors at zero. */
  available: number;
  /** Matches spent inside the current free window. Zero for paid accounts. */
  freeUsedThisWindow: number;
  /** When the free window rolls, or null for a paid account. */
  freeWindowResetsAt: Date | null;
  /** Live lots, soonest expiry first. Empty for a free account. */
  lots: { remaining: number; expiresAt: Date; pack: string }[];
  /** True when the account holds no lots and is spending the free allowance. */
  onFreeAllowance: boolean;
}

const EMPTY_BALANCE: CreditBalance = {
  available: 0,
  freeUsedThisWindow: 0,
  freeWindowResetsAt: null,
  lots: [],
  onFreeAllowance: true,
};

/**
 * What this account can spend, right now.
 *
 * Reads live lots first. An account with any live lot spends from lots and does
 * not also get the free allowance, because the allowance exists to let someone
 * try the product, not to top up a purchase every month.
 */
export async function getBalance(userId: string): Promise<CreditBalance> {
  const db = getDb();
  if (!db) return EMPTY_BALANCE;

  const now = new Date();

  const lots = await db
    .select({
      granted: creditLots.granted,
      consumed: creditLots.consumed,
      expiresAt: creditLots.expiresAt,
      pack: creditLots.pack,
    })
    .from(creditLots)
    .where(and(eq(creditLots.userId, userId), gt(creditLots.expiresAt, now)))
    .orderBy(asc(creditLots.expiresAt));

  const live = lots
    .map((l) => ({
      remaining: Math.max(0, l.granted - l.consumed),
      expiresAt: l.expiresAt,
      pack: l.pack,
    }))
    .filter((l) => l.remaining > 0);

  if (live.length > 0) {
    return {
      available: live.reduce((sum, l) => sum + l.remaining, 0),
      freeUsedThisWindow: 0,
      freeWindowResetsAt: null,
      lots: live,
      onFreeAllowance: false,
    };
  }

  // No live lots: the free rolling window applies.
  const windowStart = new Date(
    now.getTime() - FREE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  // Only debits that came out of the free allowance count against it. A pack
  // buyer's debits sit in the same table with `paidFrom: 'lots'`, and without
  // this filter the month after their lots ran out would count the paid spend
  // against the free window and report it exhausted. Paid use is not free use.
  const [used] = await db
    .select({
      total: sql<number>`coalesce(sum(${creditLedger.matches}), 0)::int`,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        eq(creditLedger.paidFrom, 'free'),
        gt(creditLedger.createdAt, windowStart)
      )
    );

  const spent = used?.total ?? 0;

  /**
   * When the oldest debit in the window ages out, not `now`.
   *
   * The first version computed `windowStart + FREE_WINDOW_DAYS`, and
   * `windowStart` is `now - FREE_WINDOW_DAYS`, so it always returned the
   * present moment: a reset time that says "already". Bugbot caught it.
   *
   * A rolling window does not reset all at once, it dribbles back as
   * individual debits age past the boundary. The honest single answer is when
   * the *next* one does, which is the oldest debit still inside the window plus
   * the window length. Null when nothing has been spent, because there is
   * nothing to wait for.
   */
  const [oldest] = await db
    .select({ at: creditLedger.createdAt })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        eq(creditLedger.paidFrom, 'free'),
        gt(creditLedger.createdAt, windowStart)
      )
    )
    .orderBy(asc(creditLedger.createdAt))
    .limit(1);

  return {
    available: Math.max(0, FREE_MATCHES_PER_WINDOW - spent),
    freeUsedThisWindow: spent,
    freeWindowResetsAt: oldest
      ? new Date(oldest.at.getTime() + FREE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      : null,
    lots: [],
    onFreeAllowance: true,
  };
}

export interface SubmissionVerdict {
  allowed: boolean;
  /** Why not, for the UI. Empty when allowed. */
  reason: string;
  /** The most wallets this caller may submit right now. */
  maxWallets: number;
  balance: CreditBalance;
}

/**
 * May this account submit this many wallets?
 *
 * The check is a multiple of the remaining balance rather than an equality,
 * because the caller is billed for matches and cannot know in advance how many
 * a list will produce. See `SUBMISSION_MULTIPLIER` for why 10x.
 */
export async function canSubmit(
  userId: string,
  walletCount: number,
  tier: UserTier
): Promise<SubmissionVerdict> {
  if (legacyTierIsUnmetered(tier)) {
    /**
     * The one condition on "unlimited forever", and it is an anti-enumeration
     * guard rather than a quota.
     *
     * Attaching any condition to a promise sold without one is a retraction, so
     * this is set where it cannot reach a customer: the largest job anyone has
     * ever run is 13,294 wallets, and the ceiling is 75x that per day. Somebody
     * exceeding it is walking the index, not running campaigns.
     *
     * Counted over a rolling day rather than per submission, because per
     * submission is the thing splitting a file defeats.
     */
    const today = await walletsSubmittedSince(
      userId,
      new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    if (today + walletCount > LEGACY_UNLIMITED_DAILY_WALLETS) {
      return {
        allowed: false,
        reason: `This account has submitted ${today.toLocaleString()} wallets in the last 24 hours. Unlimited has no cap on what you can look up, but it does have one on bulk extraction of the index. Get in touch and we will lift it.`,
        maxWallets: Math.max(0, LEGACY_UNLIMITED_DAILY_WALLETS - today),
        balance: EMPTY_BALANCE,
      };
    }

    return {
      allowed: true,
      reason: '',
      maxWallets: LEGACY_UNLIMITED_DAILY_WALLETS - today,
      balance: EMPTY_BALANCE,
    };
  }

  const balance = await getBalance(userId);
  const maxWallets = balance.available * SUBMISSION_MULTIPLIER;

  if (balance.available <= 0) {
    return {
      allowed: false,
      reason: balance.onFreeAllowance
        ? `The free allowance of ${FREE_MATCHES_PER_WINDOW} matches is used up for this ${FREE_WINDOW_DAYS}-day window.`
        : 'No credits left.',
      maxWallets: 0,
      balance,
    };
  }

  if (walletCount > maxWallets) {
    return {
      allowed: false,
      reason: `${walletCount.toLocaleString()} wallets needs more headroom than ${balance.available.toLocaleString()} matches allows. You can submit up to ${maxWallets.toLocaleString()} wallets.`,
      maxWallets,
      balance,
    };
  }

  return { allowed: true, reason: '', maxWallets, balance };
}

/**
 * Debit an account for a finished job.
 *
 * Idempotent on `jobId`: `credit_ledger` carries a unique index on it, so a
 * worker that resumes a job after a transport failure cannot charge twice. The
 * insert is attempted first for exactly that reason, and a duplicate is
 * swallowed rather than retried.
 *
 * Returns the matches actually debited, which is zero for an unmetered legacy
 * account and zero for a job already charged.
 */
/**
 * Wallets this account has submitted since a moment.
 *
 * Reads `credit_ledger`, which records every job's submitted count whether or
 * not anything was charged for it. That is why an unmetered account still gets
 * a ledger row: without one there is nothing to measure a daily ceiling
 * against, and the row is a usage record rather than a debit.
 */
async function walletsSubmittedSince(
  userId: string,
  since: Date
): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${creditLedger.walletsSubmitted}), 0)::int`,
    })
    .from(creditLedger)
    .where(
      and(eq(creditLedger.userId, userId), gt(creditLedger.createdAt, since))
    );

  return row?.total ?? 0;
}

export async function chargeForJob(
  userId: string,
  jobId: string,
  matches: number,
  walletsSubmitted: number,
  tier: UserTier
): Promise<number> {
  /**
   * An unmetered account is recorded but never debited.
   *
   * `paidFrom: 'legacy'` and `matches: 0`, so nothing is charged and no balance
   * moves, while `walletsSubmitted` still lands. The daily ceiling above needs
   * that number, and so does any future question about what these two accounts
   * actually cost to serve.
   */
  if (legacyTierIsUnmetered(tier)) {
    const db = getDb();
    if (!db) return 0;
    try {
      await db.insert(creditLedger).values({
        userId,
        jobId,
        matches: 0,
        walletsSubmitted,
        paidFrom: 'legacy',
      });
    } catch {
      // Already recorded for this job.
    }
    return 0;
  }

  if (matches <= 0) return 0;

  const db = getDb();
  if (!db) return 0;

  const balance = await getBalance(userId);
  const paidFrom = balance.onFreeAllowance ? 'free' : 'lots';

  try {
    await db.insert(creditLedger).values({
      userId,
      jobId,
      matches,
      walletsSubmitted,
      paidFrom,
    });
  } catch {
    // Unique violation on job_id: this job has already been charged.
    return 0;
  }

  if (paidFrom === 'lots') {
    await drawDown(userId, matches);
  }

  // `walletsUsed` predates the ledger and is a lifetime record of work run, not
  // a meter. Kept accurate rather than repurposed.
  await db
    .update(users)
    .set({ walletsUsed: sql`${users.walletsUsed} + ${walletsSubmitted}` })
    .where(eq(users.id, userId));

  return matches;
}

/**
 * Debit for an API call.
 *
 * Deliberately not `chargeForJob`. That one is idempotent on a job id, because
 * a worker resuming after a transport failure is one piece of work reaching the
 * charge point twice. Two API calls are two pieces of work and cost us twice,
 * so this has no idempotency key and is expected to charge every time.
 *
 * `jobId` is left null, which the partial unique index permits.
 */
export async function chargeForApiCall(
  userId: string,
  matches: number,
  walletsSubmitted: number,
  tier: UserTier
): Promise<number> {
  if (legacyTierIsUnmetered(tier)) return 0;
  if (matches <= 0) return 0;

  const db = getDb();
  if (!db) return 0;

  const balance = await getBalance(userId);
  const paidFrom = balance.onFreeAllowance ? 'free' : 'lots';

  await db.insert(creditLedger).values({
    userId,
    jobId: null,
    matches,
    walletsSubmitted,
    paidFrom,
  });

  if (paidFrom === 'lots') {
    await drawDown(userId, matches);
  }

  return matches;
}

/**
 * Spend `matches` across live lots, soonest expiry first.
 *
 * FIFO by expiry rather than by purchase date. They are usually the same order,
 * and where they differ, spending the soonest-to-expire first is the choice
 * that loses the customer the least. Spending newest-first would maximise what
 * expires unused, which is a design that profits from being forgotten.
 *
 * An overspend (see the module header) simply consumes every lot to its
 * granted amount and stops; `getBalance` then floors at zero.
 */
async function drawDown(userId: string, matches: number): Promise<void> {
  const db = getDb();
  if (!db) return;

  let owed = matches;
  const now = new Date();

  const lots = await db
    .select({ id: creditLots.id })
    .from(creditLots)
    .where(and(eq(creditLots.userId, userId), gt(creditLots.expiresAt, now)))
    .orderBy(asc(creditLots.expiresAt));

  for (const lot of lots) {
    if (owed <= 0) break;

    /**
     * The take is computed inside the statement, against the row as this
     * UPDATE locks it, and the amount actually taken comes back rather than
     * being assumed.
     *
     * The previous version read `granted` and `consumed` in the SELECT above
     * and computed `take` from that snapshot. Two debits in flight for the
     * same account both read the same `consumed`, both computed a take from
     * the same room, and both added it: a lot with 150 left could take two
     * debits of 100 and finish at 200 consumed against 150 granted. The
     * increment itself was atomic; the number being incremented by was stale.
     *
     * That broke the invariant this function's own docstring states, and the
     * one `granted`/`consumed` are documented with in `db/schema.ts`, with no
     * constraint anywhere to catch it. `LEAST` makes overshoot unrepresentable
     * rather than merely unlikely.
     */
    const [row] = (
      await db.execute(sql`
        WITH locked AS (
          SELECT id, granted, consumed
          FROM ${creditLots}
          WHERE id = ${lot.id}
          FOR UPDATE
        )
        UPDATE ${creditLots} cl
        SET consumed = cl.consumed + LEAST(locked.granted - locked.consumed, ${owed}::int)
        FROM locked
        WHERE cl.id = locked.id
          AND locked.consumed < locked.granted
        RETURNING LEAST(locked.granted - locked.consumed, ${owed}::int) AS taken
      `)
    ).rows as Array<{ taken: number }>;

    // No row means the lot was already full when the lock was taken, which is
    // the `room <= 0` case the loop used to test for up front. Nothing was
    // taken, so nothing is subtracted.
    owed -= Number(row?.taken ?? 0);
  }
}

/**
 * Whether an error is a Postgres unique violation, seen through Drizzle.
 *
 * Drizzle wraps every driver error in a `DrizzleQueryError` and puts the
 * original on `.cause`, so `error.code` is `undefined` and only
 * `error.cause.code` carries `23505`. A check on the top-level `code` reads as
 * correct and matches nothing, which is the worst shape a money check can have.
 * Verified against this repo's own Drizzle version rather than assumed.
 *
 * The chain is walked rather than read one level down, because a future driver
 * or pool wrapper is free to add another layer.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}

/**
 * Grant a pack. Called by the Stripe webhook.
 *
 * Idempotent on `stripePaymentId` through a unique index, which matters because
 * Stripe retries a webhook on any non-2xx and `provisionPaidCheckout` already
 * depends on the same guarantee for tier grants.
 *
 * Returns false ONLY for "this payment was already granted". Everything else
 * throws, so the webhook answers non-2xx and Stripe retries.
 */
export async function grantPack(
  userId: string,
  pack: PackId,
  stripePaymentId: string,
  amountCents: number
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const expiresAt = new Date(
    Date.now() + CREDIT_LIFETIME_DAYS * 24 * 60 * 60 * 1000
  );

  try {
    await db.insert(creditLots).values({
      userId,
      granted: PACKS[pack].matches,
      pack,
      amountCents,
      stripePaymentId,
      expiresAt,
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;

    /**
     * Anything else is not "already granted" and must not be reported as it.
     *
     * The previous version caught every error and returned false, with a
     * comment asserting the cause was a unique violation. A transient database
     * failure therefore took this path, the webhook logged "already granted"
     * and answered 2xx, Stripe never retried, and a customer who had been
     * charged received nothing. The one line in the logs said the opposite of
     * what had happened.
     *
     * Throwing means the webhook answers 500 and Stripe retries. `grantPack`
     * is idempotent, so a retry after recovery grants exactly once.
     */
    throw error;
  }
}

/**
 * Issue credits by hand: support, an apology, a trial for someone named.
 *
 * `stripePaymentId` is left null, so the unique index does not apply and a
 * grant can be repeated. `note` is required by convention rather than by the
 * type, because a hand-issued lot nobody can explain later is the thing that
 * makes a ledger untrustworthy.
 */
export async function grantCredits(
  userId: string,
  matches: number,
  note: string
): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db.insert(creditLots).values({
    userId,
    granted: matches,
    pack: 'grant',
    amountCents: 0,
    note,
    expiresAt: new Date(
      Date.now() + CREDIT_LIFETIME_DAYS * 24 * 60 * 60 * 1000
    ),
  });
}
