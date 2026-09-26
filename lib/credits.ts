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
import { trackEvent } from '@/lib/analytics';
import { creditLots, creditLedger, users } from '@/db/schema';
import { and, asc, eq, gt, ne, sql } from 'drizzle-orm';
import {
  CREDIT_LIFETIME_DAYS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  SUBMISSION_MULTIPLIER,
  deliverableMatches,
  LEGACY_UNLIMITED_DAILY_WALLETS,
  PACKS,
  X402_PACKS,
  type PackId,
  type X402PackId,
} from '@/lib/packs';
import type { UserTier } from '@/lib/access';
import { FROZEN_ACCOUNT_MESSAGE, isAccountFrozen } from '@/lib/account-freeze';

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
  // A frozen account has no paid entitlement at all, legacy tier or not: this
  // is the one gate behind every paid feature a session reaches
  // (lib/account-freeze.ts).
  if (await isAccountFrozen(userId)) return false;
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

  /**
   * No live lots. The free rolling window applies, unless this account only
   * exists because a wallet paid.
   *
   * An x402 account cannot be created without a settled payment, so there is
   * no faucet at signup. The faucet is on the other side: once the purchased
   * lot is spent or expires, inheriting 100 matches per 30 days would mean $1
   * once buys a free allowance for as long as the wallet cares to keep asking,
   * and wallets are free to create. The free allowance exists to show a person
   * their real match rate before they pay. This account has already paid.
   */
  const [account] = await db
    .select({ origin: users.origin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (account?.origin === 'x402') {
    return {
      available: 0,
      freeUsedThisWindow: 0,
      freeWindowResetsAt: null,
      lots: [],
      onFreeAllowance: false,
    };
  }

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

/**
 * The distinct packs behind an account's unexpired lots, spent or not.
 *
 * This feeds the plan ladder (`ladderedPlanId` in lib/api-plans.ts, gap 17 of
 * docs/AGENT-SYSTEM.md), and it deliberately does NOT filter on remaining
 * credits: what a pack buys is twelve months of its rate-limit preset, the
 * same twelve months its credits live, so a Scale buyer keeps startup limits
 * after the last credit is spent and loses them when the lot expires. The
 * balance gate is a separate and stricter check; an account with packs and no
 * credits still refuses every metered call.
 *
 * Distinct pack names, not lots, because the ladder only needs to know which
 * rungs the account has bought.
 */
export async function unexpiredPackIds(userId: string): Promise<string[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .selectDistinct({ pack: creditLots.pack })
    .from(creditLots)
    .where(
      and(eq(creditLots.userId, userId), gt(creditLots.expiresAt, new Date()))
    );

  return rows.map((r) => r.pack);
}

export interface SubmissionVerdict {
  allowed: boolean;
  /** Why not, for the UI. Empty when allowed. */
  reason: string;
  /** The most wallets this caller may submit right now. */
  maxWallets: number;
  balance: CreditBalance;
  /** The account is frozen: buying more would not help, so no upsell. */
  frozen?: true;
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
  // First, ahead of the unmetered tiers: a frozen account starts nothing.
  if (await isAccountFrozen(userId)) {
    return {
      allowed: false,
      reason: FROZEN_ACCOUNT_MESSAGE,
      maxWallets: 0,
      balance: EMPTY_BALANCE,
      frozen: true,
    };
  }

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
 * Returns what happened rather than a bare number, because the caller gates
 * delivery on it: `billed` is the matches actually debited, `duplicate` says
 * a resumed job reached here twice (nothing was charged and nothing about
 * delivery may change), and `paidFrom` names the meter. On the free
 * allowance, `billed` is capped at the remaining window: the caller shows
 * exactly `billed` matches and locks the rest, so a 224-wallet list cannot
 * pull 222 matches out of a 100-match allowance.
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

export interface JobCharge {
  /** Matches actually debited against the balance. */
  billed: number;
  /**
   * Matches delivered past `billed` and not charged for, because a match rate
   * is unknowable before a job runs and a near miss should not be punished.
   * Recorded rather than absorbed, so what we give away is countable.
   */
  goodwill: number;
  /**
   * What the owner may be shown: `billed + goodwill`. Everything past it is
   * locked, on the free allowance and on a pack alike. This is the number the
   * caller builds the gate from, and it is separate from `billed` because
   * those two stopped being the same thing when goodwill arrived.
   */
  delivered: number;
  /** True when this job already carries a debit; nothing changed. */
  duplicate: boolean;
  paidFrom: 'free' | 'lots' | 'legacy' | null;
  /**
   * The account was frozen while the job ran: nothing billed, nothing
   * delivered, and the caller fails the job (lib/job-processor.ts).
   */
  frozen?: true;
}

export async function chargeForJob(
  userId: string,
  jobId: string,
  matches: number,
  walletsSubmitted: number,
  tier: UserTier
): Promise<JobCharge> {
  /**
   * A job that was accepted before its account was frozen and finishes
   * after: nothing is billed from the held credits and nothing is delivered,
   * ahead of every other rule, the unmetered tiers included.
   */
  if (await isAccountFrozen(userId)) {
    return {
      billed: 0,
      goodwill: 0,
      delivered: 0,
      duplicate: false,
      paidFrom: null,
      frozen: true,
    };
  }

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
    // `delivered: matches` on every path that does not charge: the caller
    // gates on `delivered`, so a 0 here would lock a job precisely because we
    // failed to bill it.
    if (!db)
      return {
        billed: 0,
        goodwill: 0,
        delivered: matches,
        duplicate: false,
        paidFrom: null,
      };
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
      return {
        billed: 0,
        goodwill: 0,
        delivered: matches,
        duplicate: true,
        paidFrom: 'legacy',
      };
    }
    return {
      billed: 0,
      goodwill: 0,
      delivered: matches,
      duplicate: false,
      paidFrom: 'legacy',
    };
  }

  if (matches <= 0)
    return {
      billed: 0,
      goodwill: 0,
      delivered: 0,
      duplicate: false,
      paidFrom: null,
    };

  const db = getDb();
  if (!db)
    return {
      billed: 0,
      goodwill: 0,
      delivered: matches,
      duplicate: false,
      paidFrom: null,
    };

  const balance = await getBalance(userId);
  const paidFrom = balance.onFreeAllowance ? 'free' : 'lots';

  /**
   * The free allowance bills what it delivers and no more.
   *
   * `canSubmit` bounds wallets at ten times the remaining balance because a
   * match rate is unknowable in advance, so a job can legitimately find more
   * matches than the window has left. The old behavior delivered them all and
   * floored the meter at zero, which made a curated list worth up to ten
   * times the allowance. Now the debit is capped at what remains, the caller
   * locks everything past it, and `billed` can be 0 when a sibling job
   * drained the window between submit and finish; the row still lands, for
   * idempotency and the wallets-submitted record.
   *
   * Lots now work the same way, which they did not.
   *
   * A pack buyer used to be billed in full and shown everything, and
   * `drawDown` quietly absorbed whatever the lots could not cover. Because
   * `canSubmit` allows ten times the balance in WALLETS, and ten times the
   * wallets is 2.37 times the matches at the measured rate, that made a Trial
   * pack worth up to 593 matches instead of 250, every time, and the contract
   * importer asked for exactly the ceiling so it landed there by
   * construction. The ledger recorded the full number, the lots paid what
   * they had, and nothing compared the two.
   *
   * So both rails bill what the balance holds and deliver a fixed margin past
   * it. The margin exists because a match rate cannot be known before the job
   * runs and a near miss is not abuse; it is a fraction of the remaining
   * balance, so it shrinks as a pack empties.
   */
  const billed = Math.min(matches, balance.available);
  const goodwill = Math.min(
    matches - billed,
    deliverableMatches(balance.available) - balance.available
  );
  const delivered = billed + goodwill;

  try {
    await db.insert(creditLedger).values({
      userId,
      jobId,
      matches: billed,
      goodwillMatches: goodwill,
      walletsSubmitted,
      paidFrom,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    /**
     * This job already carries a debit: a resumed job reaching the charge
     * twice. Recover what the first pass decided rather than answering
     * zero, because the caller rebuilds the gate from this answer on its
     * retry path and a zero would serve a gated job ungated.
     */
    const [existing] = await db
      .select({
        matches: creditLedger.matches,
        goodwillMatches: creditLedger.goodwillMatches,
        paidFrom: creditLedger.paidFrom,
      })
      .from(creditLedger)
      .where(
        and(eq(creditLedger.jobId, jobId), ne(creditLedger.paidFrom, 'unlock'))
      )
      .limit(1);
    const wasBilled = existing?.matches ?? 0;
    const wasGoodwill = existing?.goodwillMatches ?? 0;
    return {
      billed: wasBilled,
      goodwill: wasGoodwill,
      // Rebuilt from the row rather than recomputed from the balance, which
      // has moved since: recomputing would widen or narrow the gate on a
      // retry and show a different set of rows than the first pass did.
      delivered: wasBilled + wasGoodwill,
      duplicate: true,
      paidFrom: (existing?.paidFrom as JobCharge['paidFrom']) ?? null,
    };
  }

  if (paidFrom === 'lots') {
    /**
     * Only `billed` is drawn, and the shortfall is now checked rather than
     * discarded. Because `billed` is capped at the balance above, the lots
     * can always cover it and this should be zero; a non-zero value means a
     * concurrent job moved the balance between the read and the draw, which
     * is worth a line in the log rather than silence.
     */
    const uncovered = await drawDown(userId, billed);
    if (uncovered > 0) {
      console.error(
        `credit drawdown short by ${uncovered} on job ${jobId}: a concurrent job moved the balance`
      );
    }
  }

  // `walletsUsed` predates the ledger and is a lifetime record of work run, not
  // a meter. Kept accurate rather than repurposed.
  await db
    .update(users)
    .set({ walletsUsed: sql`${users.walletsUsed} + ${walletsSubmitted}` })
    .where(eq(users.id, userId));

  return { billed, goodwill, delivered, duplicate: false, paidFrom };
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

  // A call that was in flight when its account was frozen: the held credits
  // are not drawn (lib/account-freeze.ts).
  if (await isAccountFrozen(userId)) return 0;

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

export interface UnlockVerdict {
  ok: boolean;
  /** Why not, for the UI. Empty when ok. */
  reason: string;
  /** The account is frozen: no upsell. */
  frozen?: true;
}

/**
 * Pay for the locked remainder of a gated job.
 *
 * Draws from lots only, never the free allowance: the gate exists because the
 * allowance ran out, and a rolling window that refills cannot be allowed to
 * slow-drip a job past the gate. The way through is a pack, which is what
 * the lock screen sells.
 *
 * Idempotent per job via the partial unique index on `credit_ledger`
 * (`paid_from = 'unlock'`): a double-clicked button inserts once, and the
 * duplicate returns ok without a second draw-down so the caller can still
 * clear `matches_delivered` if the first attempt died between the debit and
 * the clear.
 */
export async function unlockJobMatches(
  userId: string,
  jobId: string,
  matches: number
): Promise<UnlockVerdict> {
  if (matches <= 0) return { ok: true, reason: '' };

  const db = getDb();
  if (!db) return { ok: false, reason: 'Database not configured.' };

  // A frozen account's credits are held (lib/account-freeze.ts).
  if (await isAccountFrozen(userId)) {
    return { ok: false, reason: FROZEN_ACCOUNT_MESSAGE, frozen: true };
  }

  const balance = await getBalance(userId);
  if (balance.onFreeAllowance || balance.available < matches) {
    return {
      ok: false,
      reason: `Unlocking ${matches.toLocaleString()} matches needs a pack with at least that many left. You have ${balance.onFreeAllowance ? 0 : balance.available.toLocaleString()}.`,
    };
  }

  try {
    await db.insert(creditLedger).values({
      userId,
      jobId,
      matches,
      walletsSubmitted: 0,
      paidFrom: 'unlock',
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // This job was already unlocked and already paid for; the caller may
      // still need to finish the clears, so this is ok, not a refusal.
      return { ok: true, reason: '' };
    }
    console.error('Unlock ledger write failed:', error);
    return { ok: false, reason: 'Unlock failed. Retry shortly.' };
  }

  await drawDown(userId, matches);
  return { ok: true, reason: '' };
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
async function drawDown(userId: string, matches: number): Promise<number> {
  const db = getDb();
  if (!db) return matches;

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

  /**
   * What the lots could not cover, returned rather than dropped.
   *
   * `owed` used to be a local the loop simply stopped using, so a job billed
   * for more than the account held left the ledger saying one number and the
   * lots another, with nothing anywhere recording the difference and no query
   * able to surface it: `getBalance` floors at zero and `LEAST` clamps each
   * take, so the shortfall was invisible by construction. Callers now decide
   * what it means instead of never learning it happened.
   */
  return owed;
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
export function isUniqueViolation(error: unknown): boolean {
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
/**
 * Book the sale where the credits are granted.
 *
 * The same decision `provisionPaidAccess` records in `lib/access.ts`: booked
 * here rather than at the call sites, so a grant cannot happen without the
 * sale being recorded. There it covers the legacy tier purchase, which two
 * accounts ever made; this covers the product actually being sold.
 *
 * That gap is why `payment_completed` had fired exactly once in the lifetime
 * of the table. The event existed, the funnel read it, and the only code
 * emitting it was on the retired path, so every credit pack ever bought was
 * invisible to the one query that asks whether anybody buys anything.
 *
 * Awaited, not floating. A serverless runtime is free to discard a promise the
 * handler did not wait for, which is how the payment_intent path came to record
 * nothing at all.
 *
 * Only on the branch that actually wrote. A repeat webhook or a replayed
 * settlement returns false above without reaching here, so a retry cannot book
 * a second sale for one payment.
 */
async function bookSale(
  userId: string,
  pack: string,
  amountCents: number,
  rail: 'stripe' | 'x402',
  reference: string
): Promise<void> {
  await trackEvent('payment_completed', {
    userId,
    metadata: { pack, amountCents, rail, reference },
  });
}

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
    await bookSale(userId, pack, amountCents, 'stripe', stripePaymentId);
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
 * The lot a settled onchain payment already bought, if it bought one.
 *
 * Read before anything is verified or settled, because settlement is the step
 * that cannot be repeated: the EIP-3009 authorization is spent onchain the
 * first time, so a second `settlePayment` for the same payload fails. Without
 * this lookup a caller who lost the response, or whose grant failed after the
 * money moved, would retry into a settlement error and never reach the
 * idempotent grant that exists to serve exactly them.
 */
export async function lotForSettlement(
  settlementId: string
): Promise<{ userId: string } | null> {
  const db = getDb();
  if (!db) return null;

  const [lot] = await db
    .select({ userId: creditLots.userId })
    .from(creditLots)
    .where(eq(creditLots.settlementId, settlementId))
    .limit(1);

  return lot ?? null;
}

/**
 * Grant an Agent pack against a settled onchain payment.
 *
 * The twin of `grantPack`, and separate from it for the same reason
 * `settlement_id` is a separate column: an onchain sale must never be
 * countable as a card sale. `rail` says which one paid, and `amountCents`
 * records what was actually charged in cents rather than what the price list
 * says, exactly as the Stripe path does.
 *
 * Idempotent on `settlementId`, which is the EIP-3009 authorization the payer
 * signed (`<network>:<from>:<nonce>`) and not the transaction hash. The hash is
 * unknown on a facilitator timeout and can name an unmined transaction on a
 * `settlement_pending`, so keying on it would double-grant in exactly the case
 * the key exists to cover. The authorization is fixed before settlement is
 * attempted, and USDC refuses to honour it twice.
 *
 * `quantity` scales one settlement to N packs at linear price (gap 18):
 * `granted` and `amountCents` both scale by it, and it comes from the SAME
 * request body the payment requirements were built from, so a payload that
 * verified against a 3-pack requirement can only ever grant 3 packs. One lot
 * rather than N, because the lot is the record of one settlement.
 *
 * Returns false only for "this settlement was already granted". Everything else
 * throws, so a caller that has taken somebody's money finds out.
 */
export async function grantPackBySettlement(
  userId: string,
  pack: X402PackId,
  settlementId: string,
  amountCents: number,
  quantity: number = 1
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error('No database: cannot record a settled payment.');

  const expiresAt = new Date(
    Date.now() + CREDIT_LIFETIME_DAYS * 24 * 60 * 60 * 1000
  );

  try {
    await db.insert(creditLots).values({
      userId,
      granted: X402_PACKS[pack].matches * quantity,
      pack,
      amountCents,
      settlementId,
      rail: 'x402',
      expiresAt,
    });
    await bookSale(userId, pack, amountCents, 'x402', settlementId);
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
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
