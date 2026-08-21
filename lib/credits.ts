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
  const [used] = await db
    .select({
      total: sql<number>`coalesce(sum(${creditLedger.matches}), 0)::int`,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        gt(creditLedger.createdAt, windowStart)
      )
    );

  const spent = used?.total ?? 0;
  return {
    available: Math.max(0, FREE_MATCHES_PER_WINDOW - spent),
    freeUsedThisWindow: spent,
    freeWindowResetsAt: new Date(
      windowStart.getTime() + FREE_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ),
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
    return {
      allowed: true,
      reason: '',
      maxWallets: Number.POSITIVE_INFINITY,
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
export async function chargeForJob(
  userId: string,
  jobId: string,
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
    .select({
      id: creditLots.id,
      granted: creditLots.granted,
      consumed: creditLots.consumed,
    })
    .from(creditLots)
    .where(and(eq(creditLots.userId, userId), gt(creditLots.expiresAt, now)))
    .orderBy(asc(creditLots.expiresAt));

  for (const lot of lots) {
    if (owed <= 0) break;
    const room = lot.granted - lot.consumed;
    if (room <= 0) continue;
    const take = Math.min(room, owed);
    await db
      .update(creditLots)
      .set({ consumed: sql`${creditLots.consumed} + ${take}` })
      .where(eq(creditLots.id, lot.id));
    owed -= take;
  }
}

/**
 * Grant a pack. Called by the Stripe webhook.
 *
 * Idempotent on `stripePaymentId` through a unique index, which matters because
 * Stripe retries a webhook on any non-2xx and `provisionPaidCheckout` already
 * depends on the same guarantee for tier grants.
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
  } catch {
    // Unique violation on stripe_payment_id: already granted.
    return false;
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
