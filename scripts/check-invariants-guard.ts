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
    name: 'an unreached wallet is cached as empty (Bugbot, 2026-08-25, High)',
    file: 'lib/job-processor.ts',
    from: '            if (apiFailedWallets.has(wl)) return null;\n',
    to: '',
  },
  {
    // A real reorder, not an extra copy. The first version of this mutation
    // added a second check after the branch and left the first in place, so the
    // code stayed correct and the guard reported it undetected: a mutation that
    // introduces no defect proves nothing about the assertion above it.
    name: 'the unreached check runs after the branch that caches the negative',
    file: 'lib/job-processor.ts',
    from: '            if (apiFailedWallets.has(wl)) return null;\n            const r = results.get(wl)!;',
    to: '            const r = results.get(wl)!;\n            if (apiFailedWallets.has(wl) && r.source.length > 0) return null;',
  },

  {
    name: 'the deadline skips wallets without recording them as unreached',
    file: 'lib/web3bio.ts',
    from: '        errorCount++;\n        opts?.failedWallets?.add(wallet.toLowerCase());\n      }\n      break;',
    to: '      }\n      break;',
  },
  {
    name: 'a truncated batch is reported as an upstream failure',
    file: 'lib/web3bio.ts',
    from: '      abandonedAt !== null\n        ? `deadline: stopped at ${abandonedAt} of ${wallets.length} after ${latencyMs}ms`\n        : errorCount > 0',
    to: '      errorCount > 0',
  },
  {
    name: 'the per-request timeout goes back to fifteen seconds',
    file: 'lib/web3bio.ts',
    from: 'const API_TIMEOUT_MS = 6000;',
    to: 'const API_TIMEOUT_MS = 15000;',
  },
  {
    name: 'the deadline stops scaling with the work',
    file: 'lib/web3bio.ts',
    from: '  return Math.max(MIN_BATCH_DEADLINE_MS, waves * WAVE_BUDGET_MS);',
    to: '  return MIN_BATCH_DEADLINE_MS;',
  },
  {
    name: 'the ceiling is widened until it can never bind',
    file: 'lib/web3bio.ts',
    from: 'const WAVE_BUDGET_MS = 4000;',
    to: 'const WAVE_BUDGET_MS = 40000;',
  },

  {
    name: 'lookup_started loses its session, so the funnel cannot join a visit',
    file: 'app/api/jobs/route.ts',
    from: "    trackEvent('lookup_started', {\n      userId: effectiveUserId || email,\n      sessionId: browserSession,",
    to: "    trackEvent('lookup_started', {\n      userId: effectiveUserId || email,",
  },
  {
    name: 'the session is used for one event but never stored on the job',
    file: 'app/api/jobs/route.ts',
    // Re-anchored 2026-09-16: the anonymous match gate now sits between the
    // session line and that comment, so the old two-line anchor no longer
    // matched and the guard reported the defect undetected rather than the
    // anchor stale. The seeded defect is unchanged: delete the session from the
    // job insert and see whether anything notices.
    from: '      sessionId: browserSession,\n      // Undefined for a signed-in caller, which is what keeps the gate off it.',
    to: '      // Undefined for a signed-in caller, which is what keeps the gate off it.',
  },
  {
    name: 'a posted session id is trusted instead of validated',
    file: 'app/api/jobs/route.ts',
    from: '.test(\n        sessionId\n      )',
    to: '.test(String(Math.random()))',
  },
  {
    name: 'the partial-write completion stops carrying the session',
    file: 'lib/job-processor.ts',
    // Anchored on the comment above it, not on the line alone. `history_saved`
    // now emits the same line at the same indentation a few dozen lines up, so
    // the bare anchor matched twice and the guard reported SETUP rather than
    // testing anything. A mutation that cannot be applied protects nothing, and
    // it fails loudly here precisely so it cannot quietly stop protecting.
    from:
      '        // that survives the queue.\n' +
      '        sessionId: job.sessionId ?? undefined,',
    to: '        // that survives the queue.',
  },
  {
    name: 'history_saved stops being emitted, so the save rate reads 0% again',
    file: 'lib/job-processor.ts',
    from: "      trackEvent('history_saved', {",
    to: '      const unusedTrack = () => ({',
  },
  {
    name: 'the signup event fires on every sign-in, not only on account creation',
    file: 'lib/access.ts',
    from: '  if (existing) return existing;',
    to: '  if (existing) {\n  }',
  },
  {
    name: 'a raw-SQL window bound goes back to the local-offset Date',
    file: 'lib/analytics.ts',
    from: "return d.toISOString().replace('T', ' ').replace('Z', '');",
    to: 'return String(d);',
  },
  {
    name: 'the wall cohort reports a zero average for accounts that ran lookups (Bugbot, 2026-08-26)',
    file: 'lib/analytics.ts',
    from: 'avgLookups: mean(hitTheWallLookups, hitTheWallCount),',
    to: 'avgLookups: 0,',
  },
  {
    name: 'a cohort average goes back to being asserted from its own definition',
    file: 'lib/analytics.ts',
    from: 'avgLookups: mean(almostConvertedLookups, almostConvertedCount),',
    to: 'avgLookups: 3,',
  },
  {
    name: 'the mean of an empty cohort becomes 0 instead of unmeasured',
    file: 'lib/analytics.ts',
    from: 'const mean = (total: number, n: number) => (n > 0 ? total / n : null);',
    to: 'const mean = (total: number, n: number) => (n > 0 ? total / n : 0);',
  },
  {
    name: 'a session-funnel alias loses its quotes and folds to lower case',
    file: 'lib/analytics.ts',
    from: 'count(*) FILTER (WHERE ran_lookup)::int AS "ranLookup",',
    to: 'count(*) FILTER (WHERE ran_lookup)::int AS ranLookup,',
  },
  {
    name: 'the free count resolves wallet addresses to build itself',
    file: 'app/api/reverse/route.ts',
    from: 'await countBySecondaryHandle(handle) : 0;',
    to: '(await walletsBySecondaryHandle(handle)).length : 0;',
  },
  {
    name: 'the secondary match goes back to a correlated EXISTS over 5.1M rows',
    file: 'app/api/v1/reverse/twitter/[handle]/route.ts',
    from: 'inArray(socialGraph.wallet, secondary)',
    to: 'sql`EXISTS (SELECT 1 FROM handle_conflicts c WHERE c.wallet = ${socialGraph.wallet})`',
  },
  {
    name: 'the secondary gate drops the public source allowlist',
    file: 'lib/handle-reachability.ts',
    from: '      AND w.their_source = ANY(${sql.param(MAPPED_SOURCE_IDS)}::text[])\n',
    to: '',
  },
  {
    name: 'the count and the list stop sharing one FROM clause',
    file: 'lib/handle-reachability.ts',
    // The count lost its DISTINCT when the FROM clause gained a DISTINCT ON,
    // so this anchored on text that no longer existed and the guard reported
    // SETUP rather than testing anything.
    from: 'sql`SELECT count(*)::int AS n ${secondaryHandleFrom(normalized)}`',
    to: 'sql`SELECT count(*)::int AS n FROM handle_conflicts c WHERE lower(c.theirs) = ${normalized}`',
  },
  {
    name: 'a reverse match returns a wallet whose row shows a different second handle (Bugbot, 2026-08-27)',
    file: 'lib/handle-reachability.ts',
    from: '      ORDER BY c.wallet, (c.their_user_id IS NOT NULL) DESC, c.last_seen_at DESC\n    ) w\n    WHERE w.theirs = ${normalized}',
    to: '        AND lower(c.theirs) = ${normalized}\n      ORDER BY c.wallet, (c.their_user_id IS NOT NULL) DESC, c.last_seen_at DESC\n    ) w',
  },
  {
    name: 'the public reverse route stops filling twitter.also (Bugbot, 2026-08-27)',
    file: 'app/api/v1/reverse/twitter/[handle]/route.ts',
    from: '      also: also.get(result.wallet.toLowerCase()) ?? null,\n',
    to: '',
  },
  {
    name: 'the app reverse route stops stamping the second account',
    file: 'app/api/reverse/route.ts',
    from: '  await stampAlsoOnX(results);',
    to: '',
  },
  {
    name: 'an inert closure can never be reopened when a handle revives (Bugbot, 2026-08-27)',
    file: 'lib/conflict-resolution.ts',
    from: "       AND (o.status = 'live' OR t.status = 'live')",
    to: '       AND false',
  },
  {
    name: 'an inert conflict is closed on a stale reading',
    file: 'lib/conflict-resolution.ts',
    from: '       AND o.checked_at > now() - make_interval(days => ${recheckDays})\n',
    to: '',
  },
  {
    name: 'the both-dead close swallows a row where theirs is still live',
    file: 'lib/conflict-resolution.ts',
    // The two-line pair, because the challenger-dead close (2026-09-20)
    // carries the same t-side line and a one-line anchor seeded the defect
    // into the wrong statement.
    from: "       AND o.status IN ('not_found', 'unavailable')\n       AND t.status IN ('not_found', 'unavailable')",
    to: "       AND o.status IN ('not_found', 'unavailable')",
  },
  {
    name: 'the challenger-dead close swallows a row where theirs is still live',
    file: 'lib/conflict-resolution.ts',
    from: "       AND o.status = 'live'\n       AND t.status IN ('not_found', 'unavailable')",
    to: "       AND o.status = 'live'",
  },
  {
    name: 'the reassigned rung swaps without confirming the challenger id',
    file: 'lib/conflict-resolution.ts',
    from: '        AND ox.user_id <> g.twitter_user_id\n        AND c.their_user_id IS NOT NULL AND c.their_user_id = tx.user_id`',
    to: '        AND ox.user_id <> g.twitter_user_id`',
  },
  {
    // The removed id-anchored rung, reintroduced exactly: a branch that
    // swaps a live ours on the challenger's evidence alone. The refusal
    // assertion must catch its return.
    name: 'a swap branch appears with no condition on ours at all',
    file: 'lib/conflict-resolution.ts',
    from: "      : sql`ox.status = 'live'\n        AND ox.checked_at >= now() - make_interval(days => ${recheckDays}::int)\n        AND ox.user_id IS NOT NULL\n        AND g.twitter_user_id IS NOT NULL\n        AND ox.user_id <> g.twitter_user_id\n        AND c.their_user_id IS NOT NULL AND c.their_user_id = tx.user_id`;",
    to: '      : sql`g.twitter_user_id IS NULL\n        AND c.their_user_id IS NOT NULL AND c.their_user_id = tx.user_id`;',
  },

  {
    name: 'a gifted pack silently ends the welcome sequence again',
    file: 'lib/welcome-sequence.ts',
    from: '    WHERE cl.user_id = u.id AND cl.amount_cents > 0\n  )',
    to: '    WHERE cl.user_id = u.id\n  )',
  },
  {
    name: 'the sales email is sent to an account that already holds credits',
    file: 'lib/welcome-sequence.ts',
    from: 'AND ${REQUIRES_NO_CREDITS.has(e.key) ? HOLDS_NO_CREDITS : sql`TRUE`}',
    to: 'AND ${sql`TRUE`}',
  },
  {
    name: 'welcome-1 tells a gifted account it has the free allowance (Bugbot, 2026-08-27)',
    file: 'lib/welcome-sequence.ts',
    from: '    content: (ctx: WelcomeContext) =>\n      ctx.holdsCredits',
    to: '    content: (ctx: WelcomeContext) =>\n      false && ctx.holdsCredits',
  },
  {
    name: 'the first-touch runner sends one form of welcome-1 to everybody',
    file: 'lib/welcome-sequence.ts',
    from: '      contentFor(first, { holdsCredits: r.holdsCredits })',
    to: '      contentFor(first, { holdsCredits: false })',
  },
  {
    name: 'the check-in offers a pack to an account holding a partly-spent one',
    file: 'lib/checkin-campaign.ts',
    from: "    variant: !r.holds_lot\n      ? 'no-credits'",
    to: "    variant: r.spent_lot\n      ? 'no-credits'",
  },
  {
    name: 'a pause switch that cannot be read lets the campaign keep sending',
    file: 'lib/checkin-campaign.ts',
    from: "    console.error('check-in pause check failed, refusing to send:', error);\n    return true;",
    to: "    console.error('check-in pause check failed:', error);\n    return false;",
  },
  {
    name: 'the campaign selects its recipients before checking the pause switch',
    file: 'lib/checkin-campaign.ts',
    from: '  if (await isPaused()) {\n    outcome.paused = true;\n    return outcome;\n  }',
    to: '',
  },
  {
    name: 'the check-in ledger row is written after the send, so it records a race (Bugbot, 2026-08-27)',
    file: 'lib/checkin-campaign.ts',
    from: '    if (claim.rows.length === 0) {\n      outcome.claimedElsewhere += 1;\n      continue;\n    }',
    to: '',
  },
  {
    name: 'an unredeemed check-in claim is never freed, costing that account its email',
    file: 'lib/checkin-campaign.ts',
    from: '  outcome.reclaimed = await reclaimStaleCheckinClaims();',
    to: '',
  },
  {
    name: 'the check-in heartbeat reports ok while every send failed',
    file: 'app/api/cron/checkin-nonbuyers/route.ts',
    from: 'ok: outcome.failed === 0,',
    to: 'ok: true,',
  },
  {
    name: 'the health pane stops expecting the check-in, so its silence is invisible',
    file: 'app/api/admin/health/dependencies/route.ts',
    from: "    subtype: 'checkin_nonbuyers',",
    to: "    subtype: 'checkin_nonbuyers_unlisted',",
  },
  {
    name: 'the check-in cron drops its secret, so anyone can trigger a send',
    file: 'app/api/cron/checkin-nonbuyers/route.ts',
    from: '  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {',
    to: '  if (false && authHeader !== `Bearer ${cronSecret}`) {',
  },
  {
    name: 'the plain sender stops requiring a working unsubscribe',
    file: 'lib/email.ts',
    from: "  const unsub = unsubscribeUrl(options.to);\n  if (!unsub) {\n    console.error('EMAIL_UNSUBSCRIBE_SECRET missing: plain send refused');\n    return { success: false, error: 'Unsubscribe secret not configured' };\n  }",
    to: "  const unsub = unsubscribeUrl(options.to) ?? '';",
  },
  {
    name: 'the Stripe pack grant stops booking the sale',
    file: 'lib/credits.ts',
    from: "    await bookSale(userId, pack, amountCents, 'stripe', stripePaymentId);\n",
    to: '',
  },
  {
    name: 'the onchain pack grant stops booking the sale',
    file: 'lib/credits.ts',
    from: "    await bookSale(userId, pack, amountCents, 'x402', settlementId);\n",
    to: '',
  },
  {
    name: 'the sale is left floating, so a serverless runtime may discard it',
    file: 'lib/credits.ts',
    from: "    await bookSale(userId, pack, amountCents, 'stripe', stripePaymentId);",
    to: "    bookSale(userId, pack, amountCents, 'stripe', stripePaymentId);",
  },

  {
    name: 'a chain loses its mark, so the tile renders empty',
    file: 'components/ui/chain-marks.tsx',
    from: '  robinhood: RobinhoodMark,',
    to: '',
  },
  {
    name: 'the Base mark is put on a plate and rounded like the others',
    file: 'components/ui/chain-marks.tsx',
    from: '      <path\n        fill="#00F"',
    to: '      <rect width="24" height="24" rx="6" fill="#00F" />\n      <path\n        fill="#00F"',
  },
  {
    name: 'a plate is rounded but its clip is not, so the mark spills the corners',
    file: 'components/ui/chain-marks.tsx',
    from: '        <clipPath id={`arbitrum-one__a-${uid}`}>\n          <rect width="24" height="24" rx="6" />',
    to: '        <clipPath id={`arbitrum-one__a-${uid}`}>\n          <rect width="24" height="24" />',
  },

  {
    name: 'attribution is collected without the policy saying so',
    file: 'app/privacy/page.tsx',
    from: 'Where you arrived from.',
    to: 'How you found us.',
  },

  {
    name: 'the referrer is stored whole, query string and all',
    file: 'lib/first-touch.ts',
    from: '    host = new URL(referrer).hostname.toLowerCase();',
    to: '    host = referrer.toLowerCase();',
  },
  {
    name: 'a self-referral counts as an acquisition',
    file: 'lib/first-touch.ts',
    from: '  if (bare === self) return null;',
    to: '  if (false) return null;',
  },
  {
    name: 'campaign tags stop being sanitised',
    file: 'lib/first-touch.ts',
    from: "    .replace(/[^a-z0-9._-]/g, '')\n    .slice(0, TAG_MAX_LENGTH);",
    to: '    .slice(0, TAG_MAX_LENGTH);',
  },
  {
    name: 'the origin summary loses its length bound',
    file: 'lib/first-touch.ts',
    from: '  return summary.slice(0, ACQUISITION_MAX_LENGTH);',
    to: '  return summary;',
  },
  {
    name: 'a posted acquisition is trusted as sent',
    file: 'lib/first-touch.ts',
    from: "    .replace(/[^a-z0-9._:/-]/g, '')\n    .slice(0, ACQUISITION_MAX_LENGTH);",
    to: '    .slice(0, ACQUISITION_MAX_LENGTH);',
  },
  {
    name: 'attribution is written into the x402 rail column (Bugbot, 2026-08-25)',
    file: 'lib/access.ts',
    from: '.values({ email: normalizedEmail, acquisition: acquisition ?? null })',
    to: '.values({ email: normalizedEmail, origin: acquisition ?? null })',
  },
  {
    name: 'the free allowance stops keying on the rail column',
    file: 'lib/credits.ts',
    from: "if (account?.origin === 'x402') {",
    to: 'if (false) {',
  },
  {
    name: 'last touch wins, so every login rewrites the acquisition source',
    file: 'lib/access.ts',
    from: '  if (existing) return existing;',
    to: '  if (existing) {\n    await db.update(users).set({ acquisition: acquisition ?? null });\n    return existing;\n  }',
  },
  {
    name: 'the origin never travels with the token, so verify sees nothing',
    file: 'lib/auth.ts',
    from: '      acquisition: acquisition\n        ? acquisition.slice(0, ACQUISITION_MAX_LENGTH)\n        : null,',
    to: '',
  },

  {
    name: 'both networks get the coverage excuse again (Bugbot, 2026-08-25)',
    file: 'lib/reverse-access.ts',
    from: '    return `No wallet in the index is attested to this ${network} handle. ${MISS_EXPLANATION[platform]}`;',
    to: '    return `No wallet in the index is attested to this ${network} handle. That is a fact about our coverage, not about the account.`;',
  },
  {
    name: 'the two networks swap their miss explanations',
    file: 'lib/reverse-access.ts',
    from: '    return `No wallet in the index is attested to this ${network} handle. ${MISS_EXPLANATION[platform]}`;',
    to: "    return `No wallet in the index is attested to this ${network} handle. ${MISS_EXPLANATION[platform === 'twitter' ? 'farcaster' : 'twitter']}`;",
  },
  {
    name: 'the empty state goes back to its own copy of the Farcaster sentence',
    file: 'components/ReverseLookup.tsx',
    from: '            MISS_EXPLANATION.farcaster',
    to: "            'Farcaster coverage is complete, so this account genuinely has no addresses attached.'",
  },

  {
    name: 'the locked branch returns rows it sliced instead of never reading them',
    file: 'app/api/reverse/route.ts',
    from: '  if (!entitled) {\n    return NextResponse.json(lockedReverseBody(platform, handle, totalCount));\n  }',
    to: '',
  },
  {
    name: 'the free branch loses its rate limit, so the count enumerates the index',
    file: 'lib/ip-rate-limiter.ts',
    from: "  '/api/reverse': { limit: 60, windowHours: 1 },",
    to: '',
  },
  {
    name: 'the limiter is registered but the route stops calling it',
    file: 'app/api/reverse/route.ts',
    from: "const rate = await checkIpRateLimit(getClientIp(request), '/api/reverse');",
    to: 'const rate = { allowed: true, retryAfter: 0 };',
  },
  {
    name: 'a locked body leaks one address as a taste',
    file: 'lib/reverse-access.ts',
    from: '    results: [],',
    to: "    results: ['0x699727f9e01a822efdcf7333073f0461e5914b4e'] as never[],",
  },
  {
    name: 'the count is zeroed, so the free half stops being worth anything',
    file: 'lib/reverse-access.ts',
    from: '      total_count: Math.max(0, Math.trunc(totalCount) || 0),',
    to: '      total_count: 0,',
  },
  {
    name: 'the endpoint goes back to refusing anonymous callers',
    file: 'app/api/reverse/route.ts',
    from: '  const session = token ? await validateSession(token) : { user: null };',
    to: "  if (!token) return NextResponse.json({ error: 'Sign in to use reverse lookup' }, { status: 401 });\n  const session = await validateSession(token);",
  },

  {
    name: 'the exclusion list stops normalising case, so a contract slips back in',
    file: 'scripts/concierge-filters.ts',
    from: "const key = raw.trim().toLowerCase().replace(/^@+/, '');",
    to: 'const key = raw.trim();',
  },
  {
    name: 'only the contract counts as an identity, so a handle repeats',
    file: 'scripts/concierge-filters.ts',
    from: 'for (const identity of [\n    candidate.address,\n    candidate.handle,\n    candidate.name,\n  ]) {',
    to: 'for (const identity of [candidate.address]) {',
  },
  {
    name: 'an empty exclusion entry becomes a key that matches nothing safely',
    file: 'scripts/concierge-filters.ts',
    from: '    if (key) out.add(key);',
    to: '    out.add(String(part).toLowerCase());',
  },
  {
    name: 'exclusion runs before dedupe, so the merged copy survives',
    file: 'scripts/concierge-signals.ts',
    from: 'const fresh = [...best.values()].filter((c) => !isExcluded(c, excluded));',
    to: 'const fresh = [...best.values()];',
  },
  {
    name: 'the shortlist is sliced from the unfiltered set',
    file: 'scripts/concierge-signals.ts',
    from: 'const ranked = fresh.slice(0, limit);',
    to: 'const ranked = [...best.values()].slice(0, limit);',
  },

  {
    name: 'the Farcaster lane stops filtering by age (shipped, found 2026-08-25)',
    file: 'scripts/concierge-signals.ts',
    from: 'const ts = freshCastTime(c.timestamp, now, FARCASTER_MAX_AGE_DAYS);',
    to: "const ts =\n          typeof c.timestamp === 'number' ? new Date(c.timestamp) : null;",
  },
  {
    name: 'the lane keeps calling the gate but ignores the refusal',
    file: 'scripts/concierge-signals.ts',
    from: 'if (!ts) {\n          stale += 1;\n          continue;\n        }',
    to: 'if (!ts) {\n          stale += 1;\n        }',
  },
  {
    name: 'a missing timestamp reads as fresh',
    file: 'scripts/concierge-filters.ts',
    from: "if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;",
    to: "if (typeof raw !== 'number') return now.getTime();",
  },
  {
    name: 'the age window is compared the wrong way round',
    file: 'scripts/concierge-filters.ts',
    from: 'if (age > maxAgeDays * 24 * 60 * 60 * 1000) return null;',
    to: 'if (age < maxAgeDays * 24 * 60 * 60 * 1000) return null;',
  },
  {
    name: 'a far-future timestamp is accepted',
    file: 'scripts/concierge-filters.ts',
    from: 'if (age < -FUTURE_SKEW_MS) return null;',
    to: 'if (false) return null;',
  },
  {
    name: 'the gate refuses everything, so every refusal assertion passes',
    file: 'scripts/concierge-filters.ts',
    from: '  return new Date(raw);',
    to: '  return null;',
  },

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
    name: 'the zero-cost gate starts refusing the free endpoints again',
    file: 'lib/api-auth.ts',
    from: 'if (credits > 0 && balance.available <= 0) {',
    to: 'if (balance.available <= 0) {',
  },
  {
    name: 'the balance gate is deleted and metered calls run at zero balance',
    file: 'lib/api-auth.ts',
    from: 'if (credits > 0 && balance.available <= 0) {',
    to: 'if (false) {',
  },
  {
    name: 'the local signed-amount assertion is deleted, trusting the facilitator alone',
    file: 'app/api/x402/buy/route.ts',
    from: '  if (!signedMatches) {',
    to: '  if (false) {',
  },
  {
    name: 'the wholesale reissue answers a proof that failed',
    file: 'app/api/x402/recover/route.ts',
    from: '  if (!proof.ok) {',
    to: '  if (false) {',
  },
  {
    name: 'the wholesale reissue stops spending the challenge first',
    file: 'app/api/x402/recover/route.ts',
    from: '  if (!(await consumeChallenge(token, wallet, issuedAt))) {',
    to: '  if (false) {',
  },
  {
    name: 'the wholesale revoke loses its owner scope, revoking every account at once',
    file: 'lib/api-keys.ts',
    from: 'WHERE user_id = ${userId} AND is_active = true AND revoked_at IS NULL AND oauth_grant_id IS NULL',
    to: 'WHERE is_active = true AND revoked_at IS NULL AND oauth_grant_id IS NULL',
  },
  {
    name: 'the wholesale revoke sweeps up OAuth grant rows as a side effect',
    file: 'lib/api-keys.ts',
    from: 'WHERE user_id = ${userId} AND is_active = true AND revoked_at IS NULL AND oauth_grant_id IS NULL',
    to: 'WHERE user_id = ${userId} AND is_active = true AND revoked_at IS NULL',
  },
  {
    name: 'the Agent pack leaks into PACKS, reaching Stripe checkout',
    file: 'lib/packs.ts',
    from: 'export const PACKS: Record<PackId, Pack> = {',
    to: "export const PACKS: Record<string, Pack> = { agent: { id: 'agent' as PackId, name: 'Agent', priceCents: 100, matches: 12, fits: 'x', priceEnvVar: 'X' },",
  },
  {
    // Every one of these four is a price that renders correctly, sells
    // correctly and is wrong. They exist because three call sites find a pack
    // by walking PACK_IDS, and seven pages publish PACK_IDS[0] as the entry
    // price, on four properties nobody had written down.
    name: 'the cheapest pack undercuts the next rung per match',
    file: 'lib/packs.ts',
    from: '    priceCents: 2900,\n    matches: 250,',
    to: '    priceCents: 1500,\n    matches: 250,',
  },
  {
    name: 'the pack every surface calls the entry price is not the cheapest',
    file: 'lib/packs.ts',
    from: '    priceCents: 2900,\n    matches: 250,',
    to: '    priceCents: 10000,\n    matches: 250,',
  },
  {
    name: 'PACK_IDS stops ascending, so the pack finder recommends too large a pack',
    file: 'lib/packs.ts',
    from: '    matches: 250,\n    // ~1,055 wallets',
    to: '    matches: 2000,\n    // ~1,055 wallets',
  },
  {
    name: 'two packs resolve to the same Stripe price (the env var copy-paste)',
    file: 'lib/packs.ts',
    from: "    priceEnvVar: 'STRIPE_PRICE_PACK_TRIAL',",
    to: "    priceEnvVar: 'STRIPE_PRICE_PACK_CAMPAIGN',",
  },
  {
    // A working email, a working link, and the wrong shelf. Nothing else in
    // the repo can see it, which is why it is asserted rather than reviewed.
    name: 'the sales email goes back to naming a rung by hand',
    file: 'lib/welcome-sequence.ts',
    from: 'const ENTRY_PACK = PACKS[PACK_IDS[0]];',
    to: 'const ENTRY_PACK = PACKS.index;',
  },

  // --- the starter collection ---------------------------------------------

  {
    name: 'the starter link accepts any chain, not only a supported one',
    file: 'lib/starter-collections.ts',
    from: 'if (!SUPPORTED_CHAINS.includes(chain as SupportedChain)) return null;',
    to: '',
  },
  {
    name: 'the starter link accepts a malformed address',
    file: 'lib/starter-collections.ts',
    from: 'if (!/^0x[a-fA-F0-9]{40}$/.test(rawAddress)) return null;',
    to: '',
  },
  {
    // Not a reorder: the gate is removed outright, which is the form the naive
    // index comparison used to pass over, because indexOf answers -1 for an
    // identifier that is gone and -1 sorts before everything.
    name: 'the seeded-contract gate is dropped, so any contract can be expanded',
    file: 'lib/starter-collections.ts',
    from: '  const collection = await getHolderCollection(link.chain, link.address);\n  if (!collection) return null;',
    to: '  const collection = { name: link.address, symbol: null, address: link.address };',
  },
  {
    name: 'a starter run is sized to take the whole free allowance',
    file: 'lib/starter-collections.ts',
    from: 'export const STARTER_WALLET_CAP = Math.round(FREE_MATCHES_PER_WINDOW / 4);',
    to: 'export const STARTER_WALLET_CAP = FREE_MATCHES_PER_WINDOW;',
  },
  {
    // The mutation the first version of that assertion passed over: the call
    // stays, only the refusal goes, and `collection?.` keeps it compiling.
    name: 'the seeded-contract lookup is kept but its refusal is deleted',
    file: 'lib/starter-collections.ts',
    from: '  const collection = await getHolderCollection(link.chain, link.address);\n  if (!collection) return null;',
    to: '  const collection = await getHolderCollection(link.chain, link.address);',
  },
  {
    name: 'a collection run takes the caller’s wallets instead of the seeded list',
    file: 'app/api/jobs/route.ts',
    from: 'const wallets = starter ? starter.wallets : body.wallets;',
    to: 'const wallets = body.wallets ?? starter?.wallets;',
  },
  {
    // Anchored on the list's new last entry plus the declaration after it:
    // BACKUP_TABLES gained 'suppressed_identifiers' with removal stage 1, so
    // the old `'credit_ledger',\n];` anchor stopped matching, and both
    // arrays now end with the same entry, so the trailing context is what
    // keeps this applying to the dump list and not the read-only list.
    name: 'BACKUP_TABLES diverges from the pg_dump list',
    file: 'scripts/migrate-grant-readonly.ts',
    from: "  'suppressed_identifiers',\n];\n\nconst GRANTS",
    to: "  'suppressed_identifiers',\n  'x402_recovery_redemptions',\n];\n\nconst GRANTS",
  },

  // --- the MCP server's OAuth flow ----------------------------------------

  {
    name: 'the loopback match drops the path, so any path on a declared loopback host works',
    file: 'lib/oauth/clients.ts',
    from: "  return `http://${m[1]}${m[3] ?? ''}`;",
    to: '  return `http://${m[1]}`;',
  },
  {
    name: 'the loopback match ignores a query, so a smuggled state parameter rides along',
    file: 'lib/oauth/clients.ts',
    from: '(?::(\\d{1,5}))?(\\/[^#]*)?$/;',
    to: '(?::(\\d{1,5}))?(\\/[^?#]*)?(?:\\?[^#]*)?$/;',
  },
  {
    name: 'the consent screen names the first registered host, not the reply host of the request',
    file: 'lib/oauth/clients.ts',
    from: '    reply = new URL(redirectUri);',
    to: '    reply = new URL(client.redirectUris[0] ?? redirectUri);',
  },
  {
    name: 'any https origin is trusted for automatic error and decline redirects',
    file: 'lib/oauth/clients.ts',
    from: '      TRUSTED_REDIRECT_ORIGINS.includes(u.origin)',
    to: '      true',
  },
  {
    name: 'the consent view is built from the registered list, not the pending request',
    file: 'app/oauth/authorize/page.tsx',
    from: 'consentView(client, pending.redirectUri)',
    to: 'consentView(client, client.redirectUris[0])',
  },
  {
    name: 'the consent screen stops re-checking the redirect before it is shown',
    file: 'app/oauth/authorize/page.tsx',
    from: '  if (!redirectUriAllowed(pending.redirectUri, client.redirectUris)) {',
    to: '  if (false) {',
  },
  {
    name: 'an error is redirected to any declared address, vetted or not',
    file: 'app/oauth/authorize/page.tsx',
    from: '    if (redirectIsTrusted(redirectUri)) {',
    to: '    if (true) {',
  },
  {
    name: 'the loopback warning is never shown',
    file: 'app/oauth/authorize/ConsentScreen.tsx',
    from: '        {local && (',
    to: '        {false && (',
  },
  {
    name: 'a decline writes a nearby column instead, so the request stays pending and a reload can approve it',
    file: 'lib/oauth/requests.ts',
    from: '    .set({ codeHash: `declined:${id}`, expiresAt: sql`now()` })',
    to: '    .set({ codeExpiresAt: sql`now()` })',
  },
  {
    name: 'a decline that lost the race to an approval still reports declined',
    file: 'app/api/oauth/authorize/route.ts',
    from: '    if (!(await declineRequest(pending.id))) {',
    to: '    if (!(await declineRequest(pending.id)) && false) {',
  },
  {
    name: 'the loopback key drops the host, so a declared localhost admits 127.0.0.1 and [::1]',
    file: 'lib/oauth/clients.ts',
    from: "  return `http://${m[1]}${m[3] ?? ''}`;",
    to: "  return `http://loopback${m[3] ?? ''}`;",
  },
  {
    name: 'the loopback rule stops parsing, so a port past 65535 passes the gate and crashes later',
    file: 'lib/oauth/clients.ts',
    from: '  try {\n    new URL(uri);\n  } catch {\n    return null;\n  }\n',
    to: '',
  },
  {
    name: 'userinfo on the trusted origin itself is trusted for automatic redirects',
    file: 'lib/oauth/clients.ts',
    from: '      !u.username &&\n      !u.password &&\n',
    to: '',
  },
  {
    name: 'https loopback aliases stop being marked local, so no warning is shown',
    file: 'lib/oauth/clients.ts',
    from: '  const local = isLoopbackRedirect(redirectUri) || isLocalHostname(replyHost);',
    to: '  const local = isLoopbackRedirect(redirectUri);',
  },
  {
    name: 'a registered loopback client is named by what it calls itself',
    file: 'lib/oauth/clients.ts',
    from: "        ? 'An application on this computer'",
    to: "        ? (client.claimedName ?? 'An application on this computer')",
  },
  {
    name: 'the connection label puts the self-declared name first again',
    file: 'lib/oauth/clients.ts',
    from: '      ? `${client.displayHost} (calls itself ${client.claimedName})`',
    to: '      ? `${client.claimedName} (${client.displayHost})`',
  },
  {
    name: "a registered client's label uses the name it gave itself",
    file: 'lib/oauth/clients.ts',
    from: "  return `${reply ?? 'an unverified application'} (unverified)`;",
    to: "  return `${client.claimedName ?? reply ?? 'an unverified application'} (unverified)`;",
  },
  {
    name: 'a self-declared name is no longer capped',
    file: 'lib/oauth/clients.ts',
    from: '    .slice(0, 60)',
    to: '    .slice(0, 600)',
  },
  {
    name: 'a metadata document may declare a redirect with a fragment or userinfo again',
    file: 'lib/oauth/clients.ts',
    from: '  if (candidate.hash || candidate.username || candidate.password) {',
    to: '  if (false) {',
  },
  {
    name: 'repeated parameters stop being found',
    file: 'lib/oauth/params.ts',
    from: '  return ONCE_PARAMS.find((key) => Array.isArray(params[key])) ?? null;',
    to: '  return null;',
  },
  {
    name: 'only the first requested resource is checked',
    file: 'lib/oauth/params.ts',
    from: '  return values.every((r) => sameResource(r, ours));',
    to: '  return values.slice(0, 1).every((r) => sameResource(r, ours));',
  },
  {
    name: 'the loopback warning is shown only to verified clients, so MCP Inspector loses it',
    file: 'app/oauth/authorize/ConsentScreen.tsx',
    from: '        {local && (',
    to: '        {local && verified && (',
  },
  {
    name: 'the loopback warning names the client by the name a document claimed',
    file: 'app/oauth/authorize/ConsentScreen.tsx',
    from: 'can ask in ${subject}’s name.',
    to: 'can ask in ${claimedName ?? subject}’s name.',
  },
  {
    name: 'the page overrides the consent subject with the self-declared name',
    file: 'app/oauth/authorize/page.tsx',
    from: '        {...view}\n',
    to: '        {...view}\n        subject={client.claimedName ?? view.subject}\n',
  },
  {
    name: 'a decline is redirected to an untrusted callback',
    file: 'app/api/oauth/authorize/route.ts',
    from: '    if (!redirectIsTrusted(pending.redirectUri)) {',
    to: '    if (false) {',
  },
  {
    name: 'a loopback redirect matches any other loopback redirect',
    file: 'lib/oauth/clients.ts',
    from: '  if (declared.includes(requested)) return true;',
    to: '  if (declared.includes(requested) || isLoopbackRedirect(requested)) return true;',
  },
  {
    name: 'the sign-in return path accepts a protocol-relative URL',
    file: 'lib/auth.ts',
    from: 'const RETURN_PATH = /^\\/oauth\\/authorize\\?req=[A-Za-z0-9-]{36}$/;',
    to: 'const RETURN_PATH = /oauth\\/authorize/;',
  },
  {
    name: 'the metadata stops advertising client_id metadata documents, silently forcing registration on every connection',
    file: 'lib/oauth/metadata.ts',
    from: '    client_id_metadata_document_supported: true,',
    to: '    client_id_metadata_document_supported: false,',
  },
  {
    name: 'the token endpoint advertises client_secret_basic, which no client here can use',
    file: 'lib/oauth/metadata.ts',
    from: "    token_endpoint_auth_methods_supported: ['none'],",
    to: "    token_endpoint_auth_methods_supported: ['client_secret_basic'],",
  },
  {
    name: 'the plain PKCE method is advertised alongside S256',
    file: 'lib/oauth/metadata.ts',
    from: "    code_challenge_methods_supported: ['S256'],",
    to: "    code_challenge_methods_supported: ['S256', 'plain'],",
  },
  {
    name: 'the 401 points at a metadata path that has no rewrite',
    file: 'lib/oauth/metadata.ts',
    from: '    `resource_metadata="${getSiteUrl()}/.well-known/oauth-protected-resource/api/mcp"`',
    to: '    `resource_metadata="${getSiteUrl()}/.well-known/oauth-protected-resource/mcp"`',
  },
  {
    name: 'the PKCE transform stops hashing, so the challenge is the verifier',
    file: 'lib/oauth/requests.ts',
    from: "  return createHash('sha256').update(verifier).digest('base64url');",
    to: '  return verifier;',
  },
  {
    name: 'the PKCE comparison always succeeds',
    file: 'lib/oauth/requests.ts',
    from: '  return timingSafeEqual(computed, stored);',
    to: '  return true;',
  },
  {
    name: 'the client_id host check stops refusing link-local, reaching cloud metadata',
    file: 'lib/oauth/clients.ts',
    from: "  ['169.254.0.0', 16],\n",
    to: '',
  },
  {
    name: 'the client_id host check refuses 172.15 and 172.32 as well, an off-by-one on the private block',
    file: 'lib/oauth/clients.ts',
    from: "  ['172.16.0.0', 12],",
    to: "  ['172.0.0.0', 8],",
  },
  {
    name: 'a mixed batch skips the credential challenge by appending a handshake method',
    file: 'lib/mcp-gate.ts',
    from: '  return methods.some((method) => METERED_METHODS.has(method));',
    to: '  return methods.every((method) => METERED_METHODS.has(method));',
  },
  {
    name: 'a mixed batch skips the IP limit by appending a tool call',
    file: 'lib/mcp-gate.ts',
    from: '  return methods.every((method) => METERED_METHODS.has(method));',
    to: '  return methods.some((method) => METERED_METHODS.has(method));',
  },
  {
    name: 'the OAuth access-token prefix drifts from the one validateApiKey accepts',
    file: 'lib/oauth/grants.ts',
    from: "export const ACCESS_TOKEN_PREFIX = 'wts_mcp_';",
    to: "export const ACCESS_TOKEN_PREFIX = 'wts_oauth_';",
  },
  {
    name: 'the key cap counts OAuth access tokens, revoking a dashboard key on connect',
    file: 'lib/api-keys.ts',
    from: '        AND oauth_grant_id IS NULL\n',
    to: '',
  },
  {
    name: 'the key list shows OAuth access tokens, offering a revoke button that achieves nothing',
    file: 'lib/api-keys.ts',
    from: '.where(and(eq(apiKeys.userId, userId), isNull(apiKeys.oauthGrantId)))',
    to: '.where(eq(apiKeys.userId, userId))',
  },
  {
    name: "the session cookie becomes sameSite none, removing the consent screen's only CSRF defence",
    file: 'lib/auth.ts',
    from: "  sameSite: 'lax' as const,",
    to: "  sameSite: 'none' as const,",
  },
  {
    // Same re-anchoring as the BACKUP_TABLES divergence mutation above: the
    // dump list's last entry is now 'suppressed_identifiers'.
    name: 'a grant table joins the nightly dump, so a restore resurrects a revoked connection',
    file: 'scripts/migrate-grant-readonly.ts',
    from: "  'suppressed_identifiers',\n];\n\nconst GRANTS",
    to: "  'suppressed_identifiers',\n  'oauth_grants',\n];\n\nconst GRANTS",
  },
  {
    name: 'a refresh rotates in its own statement again, so a failed mint burns the token',
    file: 'lib/oauth/grants.ts',
    from: '  const rotated = await rotateAndMint({',
    to: '  await db.update(oauthGrants).set({ previousRefreshTokenHash: hash }).where(eq(oauthGrants.refreshTokenHash, hash));\n  const rotated = await rotateAndMint({',
  },
  {
    name: 'a refresh retires the access tokens of every grant, not the one it rotated',
    file: 'lib/oauth/grants.ts',
    from: '      WHERE oauth_grant_id IN (SELECT id FROM rotated) AND revoked_at IS NULL',
    to: '      WHERE oauth_grant_id IS NOT NULL AND revoked_at IS NULL',
  },
  {
    name: 'the rotation stops re-checking the client, so the binding fails under a race',
    file: 'lib/oauth/grants.ts',
    from: '        AND (${input.clientId}::text IS NULL OR client_id = ${input.clientId})\n',
    to: '',
  },
  {
    name: 'a refresh from another client is accepted',
    file: 'lib/oauth/grants.ts',
    from: '  if (input.clientId !== null && input.clientId !== row.clientId) {',
    to: '  if (false) {',
  },
  {
    name: 'a grant made for another server can still be refreshed',
    file: 'lib/oauth/grants.ts',
    from: "  if (!isOurResource(row.resource)) {\n    return { ok: false, reason: 'wrong_grant_resource' };",
    to: "  if (false) {\n    return { ok: false, reason: 'wrong_grant_resource' };",
  },
  {
    name: 'a refresh naming another resource is accepted',
    file: 'lib/oauth/grants.ts',
    from: '  if (!resourcesAreOurs(input.resources, row.resource!)) {',
    to: '  if (false) {',
  },
  {
    name: 'the MCP gate accepts a token issued for another server',
    file: 'lib/oauth/grants.ts',
    from: "  if (!isOurResource(row.resource)) {\n    return { ok: false, reason: 'audience' };",
    to: "  if (false) {\n    return { ok: false, reason: 'audience' };",
  },
  {
    name: 'a refresh that fails inside answers a bare 500 again',
    file: 'app/api/oauth/token/route.ts',
    from: "    { status: 503, headers: { ...NO_STORE, 'Retry-After': '5' } }",
    to: '    { status: 500, headers: NO_STORE }',
  },
  {
    name: 'the refresh drops the client_id it was sent',
    file: 'app/api/oauth/token/route.ts',
    from: "    clientId: form.get('client_id') || null,",
    to: '    clientId: null,',
  },
  {
    name: 'a wrong requested resource answers invalid_grant, not invalid_target',
    file: 'app/api/oauth/token/route.ts',
    from: "    if (result.reason === 'wrong_resource') {",
    to: '    if (false) {',
  },
  {
    name: 'a resource with a fragment is accepted',
    file: 'lib/oauth/params.ts',
    from: "      !requested.includes('#') &&\n",
    to: '',
  },
  {
    name: 'a refresh checks only the first resource value, so ours plus another server gets tokens',
    file: 'app/api/oauth/token/route.ts',
    from: "    resources: form.getAll('resource'),",
    to: "    resources: form.getAll('resource').slice(0, 1),",
  },
  {
    name: 'a bare trailing # passes the fragment rule again',
    file: 'lib/oauth/params.ts',
    from: "      !requested.includes('#') &&",
    to: '      !new URL(requested).hash &&',
  },
  {
    name: 'an empty client_id on a refresh counts as a client named nothing',
    file: 'app/api/oauth/token/route.ts',
    from: "    clientId: form.get('client_id') || null,",
    to: "    clientId: form.get('client_id'),",
  },
  {
    name: 'a refresh without client_id is refused, so hosted Claude re-consents every hour',
    file: 'lib/oauth/grants.ts',
    from: '  if (input.clientId !== null && input.clientId !== row.clientId) {',
    to: "  if (input.clientId === null) return { ok: false, reason: 'wrong_client' };\n  if (input.clientId !== null && input.clientId !== row.clientId) {",
  },
  {
    name: 'an empty resource value is compared instead of counting as absent',
    file: 'lib/oauth/params.ts',
    from: "  return values.filter((v) => v !== '');",
    to: '  return values;',
  },
  {
    name: 'an empty resource at authorization is stored as an empty string',
    file: 'app/oauth/authorize/page.tsx',
    from: '    resource: resource || mcpResource(),',
    to: '    resource: resource ?? mcpResource(),',
  },
  {
    name: 'the code exchange compares the first resource by exact string again',
    file: 'app/api/oauth/token/route.ts',
    from: "    !resourcesAreOurs(form.getAll('resource'), row.resource)",
    to: "    form.get('resource') !== null &&\n    form.get('resource') !== row.resource",
  },
  {
    name: 'a repeated token parameter is no longer found',
    file: 'lib/oauth/params.ts',
    from: '  return TOKEN_ONCE_PARAMS.find((key) => form.getAll(key).length > 1) ?? null;',
    to: '  return null;',
  },
  {
    name: 'the token endpoint stops refusing a repeated parameter',
    file: 'app/api/oauth/token/route.ts',
    from: '  if (repeated) {\n    return oauthError(',
    to: '  if (false) {\n    return oauthError(',
  },
  {
    name: 'the 503 drops Retry-After',
    file: 'app/api/oauth/token/route.ts',
    from: "    { status: 503, headers: { ...NO_STORE, 'Retry-After': '5' } }",
    to: '    { status: 503, headers: NO_STORE }',
  },
  {
    name: 'the pre-read stops matching the previous token, so a reuse is never revoked',
    file: 'lib/oauth/grants.ts',
    from: '  return sql`${oauthGrants.refreshTokenHash} = ${hash} OR ${oauthGrants.previousRefreshTokenHash} = ${hash} OR ${oauthGrants.refreshGraceHashes} @> ARRAY[${hash}]::text[]`;',
    to: '  return sql`${oauthGrants.refreshTokenHash} = ${hash}`;',
  },
  {
    name: 'the reuse and stale lookups swap columns, so a reuse answers expired and revokes nothing',
    file: 'lib/oauth/grants.ts',
    from: 'sql`${oauthGrants.previousRefreshTokenHash} = ${hash} OR ${oauthGrants.refreshGraceHashes} @> ARRAY[${hash}]::text[]`',
    to: 'sql`${oauthGrants.refreshTokenHash} = ${hash}`',
  },
  {
    name: 'a revoked grant can still be refreshed, and its new token works on /v1',
    file: 'lib/oauth/grants.ts',
    from: '        AND revoked_at IS NULL\n        AND refresh_expires_at > now()\n',
    to: '        AND refresh_expires_at > now()\n',
  },
  {
    name: 'an expired refresh token keeps working',
    file: 'lib/oauth/grants.ts',
    from: '        AND refresh_expires_at > now()\n',
    to: '',
  },
  {
    name: 'a refreshed access token lives as long as the refresh token',
    file: 'lib/oauth/grants.ts',
    from: '${CREDIT_API_PLAN}, now() + make_interval(secs => ${accessTtlS}), id\n      FROM rotated',
    to: '${CREDIT_API_PLAN}, now() + make_interval(secs => ${refreshTtlS}), id\n      FROM rotated',
  },
  {
    name: 'a JS Date expiry crosses into the rotation',
    file: 'lib/oauth/grants.ts',
    from: '          refresh_expires_at = now() + make_interval(secs => ${refreshTtlS}),',
    to: '          refresh_expires_at = ${new Date(Date.now() + REFRESH_TOKEN_TTL_MS)},',
  },
  {
    name: 'the rotation is split off as raw SQL before the statement',
    file: 'lib/oauth/grants.ts',
    from: '  const rotated = await rotateAndMint({',
    to: '  await db.execute(sql`UPDATE oauth_grants SET previous_refresh_token_hash = ${hash} WHERE refresh_token_hash = ${hash}`);\n  const rotated = await rotateAndMint({',
  },
  {
    name: 'isOurResource accepts any resource',
    file: 'lib/oauth/params.ts',
    from: '  return resource !== null && sameResource(resource, mcpResource());',
    to: '  return resource !== null;',
  },
  {
    name: 'isOurResource compares against the site, not the MCP endpoint, so every real grant fails',
    file: 'lib/oauth/params.ts',
    from: '  return resource !== null && sameResource(resource, mcpResource());',
    to: "  return resource !== null && sameResource(resource, mcpResource().replace(/\\/api\\/mcp$/, ''));",
  },
  {
    name: 'a probe with the wrong resource revokes the connection',
    file: 'lib/oauth/grants.ts',
    from: "  if (!resourcesAreOurs(input.resources, row.resource!)) {\n    return { ok: false, reason: 'wrong_resource' };",
    to: "  if (!resourcesAreOurs(input.resources, row.resource!)) {\n    await revokeGrant(row.id, 'probe');\n    return { ok: false, reason: 'wrong_resource' };",
  },
  {
    name: 'the two resource checks swap, so a grant for another server answers invalid_target',
    file: 'lib/oauth/grants.ts',
    from: "  if (!isOurResource(row.resource)) {\n    return { ok: false, reason: 'wrong_grant_resource' };\n  }\n  if (!resourcesAreOurs(input.resources, row.resource!)) {\n    return { ok: false, reason: 'wrong_resource' };\n  }",
    to: "  if (!resourcesAreOurs(input.resources, row.resource!)) {\n    return { ok: false, reason: 'wrong_resource' };\n  }\n  if (!isOurResource(row.resource)) {\n    return { ok: false, reason: 'wrong_grant_resource' };\n  }",
  },
  {
    name: 'the MCP gate lets an audience failure through',
    file: 'lib/mcp-gate.ts',
    from: "  if (cred.kind === 'dead-token') {",
    to: "  if (cred.kind === 'dead-token' && cred.reason !== 'audience') {",
  },
  {
    name: 'the code is spent before the exchange is validated (Bugbot, 2026-08-25)',
    file: 'app/api/oauth/token/route.ts',
    from: '  const loaded = await loadCode(code);',
    to: '  await redeemCode(code);\n  const loaded = await loadCode(code);',
  },
  {
    name: 'the PKCE check is dropped from the exchange',
    file: 'app/api/oauth/token/route.ts',
    from: '  if (!pkceMatches(verifier, row.codeChallenge)) {',
    to: '  if (false) {',
  },
  {
    name: 'the client binding is dropped from the exchange',
    file: 'app/api/oauth/token/route.ts',
    from: '  if (row.clientId !== clientId) {',
    to: '  if (false) {',
  },
  {
    name: 'redirect_uri is compared only when the caller supplies it (Bugbot, 2026-08-25)',
    file: 'app/api/oauth/token/route.ts',
    from: '  if (redirectUri !== row.redirectUri) {',
    to: '  if (redirectUri !== null && redirectUri !== row.redirectUri) {',
  },
  {
    name: 'createGrant prunes again, so a lost approval revokes a live connection (Bugbot, 2026-08-25)',
    file: 'lib/oauth/grants.ts',
    from: '  return grant ?? null;',
    to: '  if (grant) await pruneGrants(input.userId);\n  return grant ?? null;',
  },
  {
    name: 'a lost approval leaves its grant behind, holding a slot in the cap',
    file: 'app/api/oauth/authorize/route.ts',
    from: "    await revokeGrant(grant.id, 'approval lost its race');\n",
    to: '',
  },
  {
    name: 'every failed consume is read as a replay, revoking on a clock race (Bugbot, 2026-08-25)',
    file: 'app/api/oauth/token/route.ts',
    from: "  if (spent.outcome === 'replayed') {",
    to: "  if (spent.outcome !== 'issued') {",
  },
  {
    name: 'the code is spent in its own statement again, so a failed mint burns it',
    file: 'lib/oauth/grants.ts',
    from: '  const spent = await spendAndMint({',
    to: '  await getDb()!.execute(sql`UPDATE oauth_authorization_requests SET consumed_at = now() WHERE code_hash = ${sha256(code)}`);\n  const spent = await spendAndMint({',
  },
  {
    name: 'an expired code can be spent',
    file: 'lib/oauth/grants.ts',
    from: '        AND code_expires_at > now()\n',
    to: '',
  },
  {
    name: 'a spent code can be spent again',
    file: 'lib/oauth/grants.ts',
    from: '        AND consumed_at IS NULL\n',
    to: '',
  },
  {
    name: 'a late code brings a revoked grant back to life',
    file: 'lib/oauth/grants.ts',
    from: '      WHERE id IN (SELECT grant_id FROM consumed) AND revoked_at IS NULL',
    to: '      WHERE id IN (SELECT grant_id FROM consumed)',
  },
  {
    name: 'every grant gets a refresh hash written, offline_access or not',
    file: 'lib/oauth/grants.ts',
    from: "      SET refresh_token_hash = CASE\n            WHEN ${OFFLINE_SCOPE} = ANY (string_to_array(scope, ' '))\n            THEN ${input.refreshHash} ELSE refresh_token_hash END,",
    to: '      SET refresh_token_hash = ${input.refreshHash},',
  },
  {
    name: 'a refresh token is handed out without offline_access',
    file: 'lib/oauth/grants.ts',
    from: '      refreshToken: spent.refreshed ? refreshToken : null,',
    to: '      refreshToken,',
  },
  {
    name: 'a code spent on a revoked grant drops out of the result and reads as a replay',
    file: 'lib/oauth/grants.ts',
    from: 'FROM consumed c LEFT JOIN granted g ON g.id = c.grant_id',
    to: 'FROM consumed c JOIN granted g ON g.id = c.grant_id',
  },
  {
    name: 'a code on a revoked grant is no longer told apart, so it throws into a 503',
    file: 'lib/oauth/grants.ts',
    from: "  if (!spent.grant_id) return { outcome: 'inactive' };\n",
    to: '',
  },
  {
    name: 'every unspent code is read as a replay',
    file: 'lib/oauth/grants.ts',
    from: '  if (!spent) return { outcome: await unspentCodeReason(code) };',
    to: "  if (!spent) return { outcome: 'replayed' };",
  },
  {
    name: 'the first access token lives as long as the refresh token',
    file: 'lib/oauth/grants.ts',
    from: '${CREDIT_API_PLAN}, now() + make_interval(secs => ${accessTtlS}), id\n      FROM granted',
    to: '${CREDIT_API_PLAN}, now() + make_interval(secs => ${refreshTtlS}), id\n      FROM granted',
  },
  {
    name: 'a code spent on a revoked grant revokes it as if it were a replay',
    file: 'app/api/oauth/token/route.ts',
    from: "  if (spent.outcome === 'replayed') {",
    to: "  if (spent.outcome === 'replayed' || spent.outcome === 'inactive') {",
  },
  {
    name: 'the code exchange is returned unawaited, so its failure escapes the catch as a bare 500',
    file: 'app/api/oauth/token/route.ts',
    from: "    if (grantType === 'authorization_code') return await exchangeCode(form, ip);",
    to: "    if (grantType === 'authorization_code') return exchangeCode(form, ip);",
  },
  {
    name: 'the refresh is returned unawaited, so its failure escapes the catch as a bare 500',
    file: 'app/api/oauth/token/route.ts',
    from: "    if (grantType === 'refresh_token') return await exchangeRefresh(form, ip);",
    to: "    if (grantType === 'refresh_token') return exchangeRefresh(form, ip);",
  },
  {
    name: 'the code exchange runs outside the catch',
    file: 'app/api/oauth/token/route.ts',
    from: "  try {\n    if (grantType === 'authorization_code') return await exchangeCode(form, ip);",
    to: "  if (grantType === 'authorization_code') return await exchangeCode(form, ip);\n  try {",
  },
  {
    name: 'a token-endpoint failure answers 503 without a log line, so a persistent one is invisible',
    file: 'app/api/oauth/token/route.ts',
    from: '    console.error(\n      `Token request (${grantType}) failed on /api/oauth/token:`,\n      error\n    );\n',
    to: '',
  },
  {
    name: 'a token-endpoint failure answers a bare 500 again',
    file: 'app/api/oauth/token/route.ts',
    from: '    return tokenServiceUnavailable();\n  }\n  return oauthError(',
    to: '    throw error;\n  }\n  return oauthError(',
  },
  {
    name: 'the exchange writes the hash of the access token as the refresh hash, so the first refresh fails',
    file: 'lib/oauth/grants.ts',
    from: '    refreshHash: sha256(refreshToken),',
    to: '    refreshHash: sha256(access),',
  },
  {
    name: 'the refresh-hash CASE is inverted, so an offline grant keeps no refresh hash',
    file: 'lib/oauth/grants.ts',
    from: '            THEN ${input.refreshHash} ELSE refresh_token_hash END,',
    to: '            THEN refresh_token_hash ELSE ${input.refreshHash} END,',
  },
  {
    name: 'a refresh writes the hash of the access token as the next refresh hash',
    file: 'lib/oauth/grants.ts',
    from: '    nextHash: sha256(next),',
    to: '    nextHash: sha256(access),',
  },
  {
    name: 'the exchange result alias folds to lower case, so a committed exchange reads as failed',
    file: 'lib/oauth/grants.ts',
    from: 'g.refreshed,\n           (SELECT id FROM minted) AS minted_id',
    to: 'g.refreshed,\n           (SELECT id FROM minted) AS mintedId',
  },
  {
    name: 'the code is spent before the resource binding is checked',
    file: 'app/api/oauth/token/route.ts',
    from: "  if (\n    row.resource !== null &&\n    !resourcesAreOurs(form.getAll('resource'), row.resource)\n  ) {",
    to: "  await redeemCode(code);\n  if (\n    row.resource !== null &&\n    !resourcesAreOurs(form.getAll('resource'), row.resource)\n  ) {",
  },
  {
    name: 'a replayed code past its window reads as expired, and the Node clock decides',
    file: 'lib/oauth/requests.ts',
    from: "  if (existing.consumedAt) return 'replayed';",
    to: "  if (existing.consumedAt && existing.codeExpiresAt! > new Date()) return 'replayed';",
  },
  {
    name: 'a code that vanished reads as a replay and revokes',
    file: 'lib/oauth/requests.ts',
    from: "  if (!existing) return 'unknown';",
    to: "  if (!existing) return 'replayed';",
  },
  {
    name: 'a grace interval lets an expired code be spent',
    file: 'lib/oauth/grants.ts',
    from: '        AND code_expires_at > now()\n',
    to: "        AND code_expires_at > now() - interval '5 minutes'\n",
  },
  {
    name: 'the first access token is not linked to its grant, so a disconnect leaves it working on /v1',
    file: 'lib/oauth/grants.ts',
    from: '${accessTtlS}), id\n      FROM granted',
    to: '${accessTtlS}), NULL\n      FROM granted',
  },
  {
    name: 'a refreshed access token is not linked to its grant',
    file: 'lib/oauth/grants.ts',
    from: '${accessTtlS}), id\n      FROM rotated',
    to: '${accessTtlS}), NULL\n      FROM rotated',
  },
  {
    name: 'the balance tool drops unmetered again, so a null balance is unexplained',
    file: 'app/api/mcp/route.ts',
    from: '          unmetered: asBoolean(credits.unmetered, false),\n',
    to: '',
  },
  {
    name: '/v1 X reverse returns rows known only through correlated sources again',
    file: 'app/api/v1/reverse/twitter/[handle]/route.ts',
    from: '    eq(socialGraph.twitterHandle, normalizedHandle),\n    everySourceAttested()\n',
    to: '    eq(socialGraph.twitterHandle, normalizedHandle)\n',
  },
  {
    name: '/v1 Farcaster reverse returns correlated rows again',
    file: 'app/api/v1/reverse/farcaster/[username]/route.ts',
    from: '    eq(socialGraph.farcaster, normalizedUsername),\n    everySourceAttested()\n',
    to: '    eq(socialGraph.farcaster, normalizedUsername)\n',
  },
  {
    name: '/v1 Farcaster reverse counts every row but pages only attested ones',
    file: 'app/api/v1/reverse/farcaster/[username]/route.ts',
    from: '    .where(matchesName);',
    to: '    .where(eq(socialGraph.farcaster, normalizedUsername));',
  },
  {
    name: "the site's reverse search returns correlated rows again",
    file: 'app/api/reverse/route.ts',
    from: '  const primary = and(eq(primaryColumn, handle), everySourceAttested());',
    to: '  const primary = and(eq(primaryColumn, handle));',
  },
  {
    name: 'a row with no sources at all passes as attested',
    file: 'lib/social-graph.ts',
    from: "sql`(cardinality(array_remove(${socialGraph.sources}, 'none')) > 0 AND array_remove(${socialGraph.sources}, 'none') <@",
    to: "sql`(array_remove(${socialGraph.sources}, 'none') <@",
  },
  {
    name: 'a second account from a correlated source is matched again',
    file: 'lib/handle-reachability.ts',
    from: '      AND w.their_source = ANY(${sql.param(ATTESTED_SOURCE_ID_LIST)}::text[])\n',
    to: '',
  },
  {
    name: 'the attested filter moves before the winner pick, so a search can return a wallet showing another second handle',
    file: 'lib/handle-reachability.ts',
    from: '        AND (c.their_user_id IS NULL OR c.their_user_id = t.user_id)\n      ORDER BY c.wallet, (c.their_user_id IS NOT NULL) DESC, c.last_seen_at DESC\n    ) w',
    to: '        AND (c.their_user_id IS NULL OR c.their_user_id = t.user_id)\n        AND c.their_source = ANY(${sql.param(ATTESTED_SOURCE_ID_LIST)}::text[])\n      ORDER BY c.wallet, (c.their_user_id IS NOT NULL) DESC, c.last_seen_at DESC\n    ) w',
  },
  {
    name: 'the none marker is no longer ignored, so 71 attested rows drop out of reverse',
    file: 'lib/social-graph.ts',
    from: "array_remove(${socialGraph.sources}, 'none') <@",
    to: '${socialGraph.sources} <@',
  },
  {
    name: 'the second-account pick filters on ours again before choosing, so it can pick a conflict the display never shows',
    file: 'lib/handle-reachability.ts',
    from: '        AND (c.their_user_id IS NULL OR c.their_user_id = t.user_id)\n      ORDER BY c.wallet, (c.their_user_id IS NOT NULL) DESC, c.last_seen_at DESC\n    ) w',
    to: '        AND (c.their_user_id IS NULL OR c.their_user_id = t.user_id)\n        AND lower(c.ours) = lower(g.twitter_handle)\n      ORDER BY c.wallet, (c.their_user_id IS NOT NULL) DESC, c.last_seen_at DESC\n    ) w',
  },
  {
    name: '/check counts wallets the reverse lookup will not return',
    file: 'app/api/reachability/route.ts',
    from: '            AND ${everySourceAttested()}) AS wallets,',
    to: ') AS wallets,',
  },
  {
    name: 'the homepage hero shows a wallet the reverse lookup leaves out',
    file: 'lib/identity-hero/server.ts',
    from: '          eq(socialGraph.farcasterVerified, true),\n',
    to: '          eq(socialGraph.farcasterVerified, true)\n',
  },
  {
    name: '/v1 X reverse pages drop the attested predicate while the count keeps it',
    file: 'app/api/v1/reverse/twitter/[handle]/route.ts',
    from: '        ? matchesHandle\n        : and(matchesHandle, afterCursor)',
    to: '        ? eq(socialGraph.twitterHandle, normalizedHandle)\n        : and(eq(socialGraph.twitterHandle, normalizedHandle), afterCursor)',
  },
  {
    name: 'the refresh grace widens to a day',
    file: 'lib/oauth/grants.ts',
    from: 'export const REFRESH_REUSE_GRACE_MS = 30 * 1000;',
    to: 'export const REFRESH_REUSE_GRACE_MS = 24 * 60 * 60 * 1000;',
  },
  {
    name: 'the rotation stops stamping refresh_rotated_at, so the grace never applies',
    file: 'lib/oauth/grants.ts',
    from: '          refresh_rotated_at = now(),\n',
    to: '',
  },
  {
    name: 'a replay inside the grace revokes anyway',
    file: 'lib/oauth/grants.ts',
    from: "      return { ok: false, reason: 'just_rotated' };",
    to: "      await revokeGrant(reused.id, 'refresh token reused');\n      return { ok: false, reason: 'just_rotated' };",
  },
  {
    name: 'the grace holds off a replay on a revoked grant',
    file: 'lib/oauth/grants.ts',
    from: '    if (reused.rotatedJustNow === true && !reused.revokedAt) {',
    to: '    if (reused.rotatedJustNow === true) {',
  },
  {
    name: 'a NULL rotation stamp counts as recent, so no pre-grace grant ever revokes',
    file: 'lib/oauth/grants.ts',
    from: '    if (reused.rotatedJustNow === true && !reused.revokedAt) {',
    to: '    if (reused.rotatedJustNow !== false && !reused.revokedAt) {',
  },
  {
    name: 'the refresh grace is judged by the Node clock',
    file: 'lib/oauth/grants.ts',
    from: 'rotatedJustNow: sql<boolean>`${oauthGrants.refreshRotatedAt} > now() - make_interval(secs => ${graceS})`,',
    to: 'rotatedJustNow: sql<boolean>`${oauthGrants.refreshRotatedAt} > ${new Date(Date.now() - REFRESH_REUSE_GRACE_MS)}`,',
  },
  {
    name: 'a held-off replay answers invalid_grant, so the MCP SDK deletes the winner’s tokens',
    file: 'app/api/oauth/token/route.ts',
    from: "    if (result.reason === 'just_rotated') {",
    to: '    if (false) {',
  },
  {
    name: 'the hold-off 503 invites a retry again, which after the window revokes',
    file: 'app/api/oauth/token/route.ts',
    from: '        { status: 503, headers: NO_STORE }\n      );\n    }',
    to: "        { status: 503, headers: { ...NO_STORE, 'Retry-After': '1' } }\n      );\n    }",
  },
  {
    name: 'the hold-off 503 no longer says which 503 it is',
    file: 'app/api/oauth/token/route.ts',
    from: '          token_rotated: true,\n',
    to: '',
  },
  {
    name: 'the pre-read stops finding a token rotated out in the burst, so it answers invalid_grant',
    file: 'lib/oauth/grants.ts',
    from: ' OR ${oauthGrants.refreshGraceHashes} @> ARRAY[${hash}]::text[]`;',
    to: '`;',
  },
  {
    name: 'an older burst token revokes after the window, where it was unknown',
    file: 'lib/oauth/grants.ts',
    from: '    if (reused.direct === true) {',
    to: '    if (true) {',
  },
  {
    name: 'a burst grows without bound',
    file: 'lib/oauth/grants.ts',
    from: '${REFRESH_GRACE_HASHES - 2}',
    to: '${100000}',
  },
  {
    name: 'a burst never resets after a quiet spell',
    file: 'lib/oauth/grants.ts',
    from: '            ELSE ARRAY[${input.hash}::text]\n',
    to: '            ELSE (coalesce(refresh_grace_hashes, ARRAY[]::text[])) || ${input.hash}::text\n',
  },
  {
    name: 'the rotation stamp is commented out in SQL',
    file: 'lib/oauth/grants.ts',
    from: '          refresh_rotated_at = now(),\n',
    to: '          -- refresh_rotated_at = now(),\n',
  },
  {
    name: 'the fresh read maps revokedAt to another column',
    file: 'lib/oauth/grants.ts',
    from: '      revokedAt: oauthGrants.revokedAt,\n      rotatedJustNow',
    to: '      revokedAt: oauthGrants.lastUsedAt,\n      rotatedJustNow',
  },
  // The OAuth endpoint limits (Linear STA-39, C2). Hosted clients call the
  // token and revocation endpoints from shared outbound addresses, so the
  // token endpoint counts per connection and sorts before it charges.
  {
    name: 'a failed verifier is answered without being counted anywhere',
    file: 'app/api/oauth/token/route.ts',
    from: '  if (!pkceMatches(verifier, row.codeChallenge)) {\n    return unknownCredential(\n      ip,\n',
    to: "  if (!pkceMatches(verifier, row.codeChallenge)) {\n    return oauthError(\n      'invalid_grant',\n",
  },
  {
    name: 'the connection is counted before the caller proves it holds the verifier',
    file: 'app/api/oauth/token/route.ts',
    from: '  if (row.clientId !== clientId) {\n    return unknownCredential(',
    to: "  await checkIpRateLimit(`grant:${row.grantId ?? row.id}`, '/api/oauth/token:grant');\n  if (row.clientId !== clientId) {\n    return unknownCredential(",
  },
  {
    name: 'revocation sends each token shape to the other lookup',
    file: 'app/api/oauth/revoke/route.ts',
    from: '  if (isRefresh) {\n',
    to: '  if (!isRefresh) {\n',
  },
  {
    name: 'revocation of an access token finds its row and discards the grant id',
    file: 'app/api/oauth/revoke/route.ts',
    from: '    grantId = key?.grantId ?? null;',
    to: '    grantId = null;',
  },
  {
    name: 'the refresh-token lookup returns the user, so revoke ends nothing and one bucket covers every connection',
    file: 'lib/oauth/grants.ts',
    from: '    .select({ id: oauthGrants.id })\n    .from(oauthGrants)\n    .where(matchesRefreshHash(sha256(raw)))',
    to: '    .select({ id: oauthGrants.userId })\n    .from(oauthGrants)\n    .where(matchesRefreshHash(sha256(raw)))',
  },
  {
    name: 'revocation peeks at the token endpoint bucket, which it never charges',
    file: 'app/api/oauth/revoke/route.ts',
    from: "  const status = await getIpRateLimitStatus(ip, '/api/oauth/revoke');",
    to: "  const status = await getIpRateLimitStatus(ip, '/api/oauth/token');",
  },
  {
    name: 'revocation peeks at a bucket keyed by the token, so the limit never refuses',
    file: 'app/api/oauth/revoke/route.ts',
    from: "  const status = await getIpRateLimitStatus(ip, '/api/oauth/revoke');",
    to: "  const status = await getIpRateLimitStatus(token, '/api/oauth/revoke');",
  },
  {
    name: 'a code exchange is counted by client_id, which every user of a hosted client shares',
    file: 'app/api/oauth/token/route.ts',
    from: '    `grant:${row.grantId ?? row.id}`,',
    to: '    `client:${clientId}`,',
  },
  {
    name: 'the token endpoint charges the address before the form is parsed',
    file: 'app/api/oauth/token/route.ts',
    from: 'export async function POST(request: NextRequest): Promise<NextResponse> {\n  let form: URLSearchParams;',
    to: "export async function POST(request: NextRequest): Promise<NextResponse> {\n  await checkIpRateLimit(getClientIp(request), '/api/oauth/token');\n  let form: URLSearchParams;",
  },
  {
    name: 'a well-formed credential that names nothing is answered without being counted',
    file: 'app/api/oauth/token/route.ts',
    from: "  const limit = await checkIpRateLimit(ip, '/api/oauth/token');\n  if (!limit.allowed) {\n    return tooManyRequests(limit, 'Too many token requests from this address.');\n  }\n",
    to: '',
  },
  {
    name: 'a malformed code is read from the database again',
    file: 'app/api/oauth/token/route.ts',
    from: '  if (!isWellFormedCode(code)) {',
    to: '  if (!code) {',
  },
  {
    name: 'a malformed refresh token is looked up again',
    file: 'app/api/oauth/token/route.ts',
    from: '  if (!isWellFormedRefreshToken(token)) {',
    to: '  if (!token) {',
  },
  {
    name: 'a refresh that names a grant is counted per address again',
    file: 'app/api/oauth/token/route.ts',
    from: "    `grant:${grantId}`,\n    '/api/oauth/token:grant'",
    to: "    ip,\n    '/api/oauth/token'",
  },
  {
    name: 'a refresh token that names nothing is answered without being counted',
    file: 'app/api/oauth/token/route.ts',
    from: "    return unknownCredential(ip, 'The refresh token is unknown.');",
    to: "    return oauthError('invalid_grant', 'The refresh token is unknown.');",
  },
  {
    name: 'isWellFormedRefreshToken accepts any string, so every string costs a read',
    file: 'lib/oauth/grants.ts',
    from: '    raw.startsWith(REFRESH_TOKEN_PREFIX) &&\n    TOKEN_BODY.test(raw.slice(REFRESH_TOKEN_PREFIX.length))',
    to: '    raw.length >= 0',
  },
  {
    name: 'isWellFormedAccessToken accepts any string, so revocation looks up every one',
    file: 'lib/oauth/grants.ts',
    from: '    raw.startsWith(ACCESS_TOKEN_PREFIX) &&\n    TOKEN_BODY.test(raw.slice(ACCESS_TOKEN_PREFIX.length))',
    to: '    raw.length >= 0',
  },
  {
    name: 'isWellFormedCode accepts any string',
    file: 'lib/oauth/requests.ts',
    from: '  return /^[A-Za-z0-9_-]{43}$/.test(raw);',
    to: '  return raw.length >= 0;',
  },
  {
    // Proves the shape checks are tested against the real mints: a mint that
    // drifts from the shape would refuse every real credential as malformed.
    name: 'the code mint drifts from the shape the token endpoint accepts',
    file: 'lib/oauth/requests.ts',
    from: "  return randomBytes(32).toString('base64url');",
    to: "  return randomBytes(32).toString('hex');",
  },
  {
    name: 'the token mint drifts from the shape the token endpoint accepts',
    file: 'lib/oauth/grants.ts',
    from: "  return `${prefix}${randomBytes(32).toString('base64url')}`;",
    to: "  return `${prefix}${randomBytes(24).toString('base64url')}`;",
  },
  {
    name: 'the limiter stops finding a refresh token rotated out in the burst, so it disagrees with a refresh',
    file: 'lib/oauth/grants.ts',
    from: '    .where(matchesRefreshHash(sha256(raw)))',
    to: '    .where(eq(oauthGrants.refreshTokenHash, sha256(raw)))',
  },
  {
    name: 'registration loses its limit, an unbounded unauthenticated write',
    file: 'app/api/oauth/register/route.ts',
    from: "  const limit = await checkIpRateLimit(\n    getClientIp(request),\n    '/api/oauth/register'\n  );",
    to: '  const limit = { allowed: true, retryAfter: 0 };',
  },
  {
    name: 'registration is charged before the body is read, so a malformed request counts',
    file: 'app/api/oauth/register/route.ts',
    from: 'export async function POST(request: NextRequest): Promise<NextResponse> {\n  // RFC 7591',
    to: "export async function POST(request: NextRequest): Promise<NextResponse> {\n  await checkIpRateLimit(getClientIp(request), '/api/oauth/register');\n  // RFC 7591",
  },
  {
    name: 'registration is charged but never refused',
    file: 'app/api/oauth/register/route.ts',
    from: "  if (!limit.allowed) {\n    return NextResponse.json(\n      {\n        error: 'temporarily_unavailable',\n        error_description: 'Too many registrations from this address.',",
    to: "  if (!limit.allowed && limit.remaining < 0) {\n    return NextResponse.json(\n      {\n        error: 'temporarily_unavailable',\n        error_description: 'Too many registrations from this address.',",
  },
  {
    name: 'the authorize page loses its limit',
    file: 'app/oauth/authorize/page.tsx',
    from: "  const limit = await checkIpRateLimit(\n    clientIpFromHeaders(await headers()),\n    '/oauth/authorize'\n  );",
    to: '  const limit = { allowed: true, retryAfter: 0 };',
  },
  {
    name: 'the client is resolved before the authorize request is counted',
    file: 'app/oauth/authorize/page.tsx',
    from: "  const limit = await checkIpRateLimit(\n    clientIpFromHeaders(await headers()),\n    '/oauth/authorize'\n  );",
    to: "  await resolveClient(clientId);\n  const limit = await checkIpRateLimit(\n    clientIpFromHeaders(await headers()),\n    '/oauth/authorize'\n  );",
  },
  {
    name: 'an authorize request over the limit is sent to a reply address nobody has checked',
    file: 'app/oauth/authorize/page.tsx',
    from: '  if (!limit.allowed) {\n    const minutes',
    to: '  if (!limit.allowed) {\n    redirect(redirectUri);\n    const minutes',
  },
  {
    name: 'the consent step is counted too, so one connection costs two units',
    file: 'app/oauth/authorize/page.tsx',
    from: '  if (requestId) return renderConsent(requestId);',
    to: "  await checkIpRateLimit(clientIpFromHeaders(await headers()), '/oauth/authorize');\n  if (requestId) return renderConsent(requestId);",
  },
  {
    name: 'revocation charges every well-formed token before the lookup',
    file: 'app/api/oauth/revoke/route.ts',
    from: "  const status = await getIpRateLimitStatus(ip, '/api/oauth/revoke');",
    to: "  const status = await checkIpRateLimit(ip, '/api/oauth/revoke');",
  },
  {
    name: 'revocation refuses with 429, which RFC 7009 does not define',
    file: 'app/api/oauth/revoke/route.ts',
    from: "        status: 503,\n        headers: {\n          'Cache-Control': 'no-store',\n          'Retry-After': String(status.retryAfter",
    to: "        status: 429,\n        headers: {\n          'Cache-Control': 'no-store',\n          'Retry-After': String(status.retryAfter",
  },
  {
    name: 'revocation looks up any string, whatever its shape',
    file: 'app/api/oauth/revoke/route.ts',
    from: '  if (!isRefresh && !isWellFormedAccessToken(token)) return OK;\n',
    to: '',
  },
  {
    name: 'revocation counts a token that named a grant, at the shared address a hosted client disconnects from',
    file: 'app/api/oauth/revoke/route.ts',
    from: "  if (grantId) {\n    await revokeGrant(grantId, 'revoked by the client');\n    return OK;\n  }\n",
    to: "  await checkIpRateLimit(ip, '/api/oauth/revoke');\n  if (grantId) {\n    await revokeGrant(grantId, 'revoked by the client');\n    return OK;\n  }\n",
  },
  {
    name: 'the client address trusts the first X-Forwarded-For hop',
    file: 'lib/ip-rate-limiter.ts',
    from: '    if (hops.length) return hops[hops.length - 1];',
    to: '    if (hops.length) return hops[0];',
  },
  {
    name: 'getClientIp reads a header of its own instead of the shared rules',
    file: 'lib/ip-rate-limiter.ts',
    from: '  return clientIpFromHeaders(request.headers);',
    to: "  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';",
  },
  {
    name: 'the status read states no wait when it refuses',
    file: 'lib/ip-rate-limiter.ts',
    from: "      retryAfter,\n    };\n  } catch (error) {\n    console.error('IP rate limit status check error:', error);",
    to: "    };\n  } catch (error) {\n    console.error('IP rate limit status check error:', error);",
  },
  {
    name: 'the status read takes its bucket key from a second clock reading',
    file: 'lib/ip-rate-limiter.ts',
    from: '  const bucketKey = getHourlyBucketKey(now);\n  const previousBucketKey = getHourlyBucketKey(\n    new Date(now.getTime() - 60 * 60 * 1000)\n  );\n\n  try {',
    to: '  const bucketKey = getHourlyBucketKey();\n  const previousBucketKey = getHourlyBucketKey(\n    new Date(now.getTime() - 60 * 60 * 1000)\n  );\n\n  try {',
  },
  {
    name: '/v1 X reverse serves a key bought with USDC and no account',
    file: 'app/api/v1/reverse/twitter/[handle]/route.ts',
    from: '  if (await isWalletOnlyAccount(context.key.userId)) {',
    to: '  if (false) {',
  },
  {
    name: '/v1 Farcaster reverse serves a key bought with USDC and no account',
    file: 'app/api/v1/reverse/farcaster/[username]/route.ts',
    from: '  if (await isWalletOnlyAccount(context.key.userId)) {',
    to: '  if (false) {',
  },
  {
    name: 'an unreadable account passes as a real one, so the refusal fails open',
    file: 'lib/x402-account.ts',
    from: '  return !row || isWalletOnlyEmail(row.email);',
    to: '  return !!row && isWalletOnlyEmail(row.email);',
  },
  {
    name: 'the wallet-only test misses an upper-case synthetic email',
    file: 'lib/x402-account.ts',
    from: '    email.toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)',
    to: '    email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)',
  },
  {
    name: 'the UD signer is compared strictly, so no record validates',
    file: 'lib/ud-validations.ts',
    from: '    return signer.toLowerCase() === UD_TWITTER_SIGNER;',
    to: '    return signer === UD_TWITTER_SIGNER;',
  },
  {
    name: 'a 0x handle is hashed as text, not as the bytes UD signed',
    file: 'lib/ud-validations.ts',
    from: "        v.startsWith('0x') ? sdkHexToBytes(v) : ethers.toUtf8Bytes(v)",
    to: '        ethers.toUtf8Bytes(v)',
  },
  {
    name: 'a non-hex pair throws where the SDK reads it as 0',
    file: 'lib/ud-validations.ts',
    from: '    bytes.push(Number.isNaN(n) ? 0 : n & 0xff);',
    to: '    bytes.push(n & 0xff || 1);',
  },
  {
    name: 'the legacy CNS records are no longer scanned',
    file: 'lib/ud-validations.ts',
    from: '        [CNS_SET, KEY_HASHES],\n        [CNS_SET, null, KEY_HASHES],\n',
    to: '',
  },
  {
    name: 'a bridged domain binds to its stale Ethereum copy',
    file: 'lib/ud-validations.ts',
    from: '    const chain: UdChain = p && p.owner !== ethers.ZeroAddress ? 137 : 1;',
    to: '    const chain: UdChain = 1;',
  },
  {
    name: 'the UD harvest ingests handles that are not live',
    file: 'scripts/harvest-ud-validations.ts',
    from: "  const live = links.filter((l) => status.get(l.handle) === 'live');",
    to: '  const live = links;',
  },
  {
    name: 'a handle UD verified for several owners is ingested for all of them',
    file: 'scripts/harvest-ud-validations.ts',
    from: '    (l) => !contestedHandles.has(l.handle)',
    to: '    (l) => !!l.handle',
  },
  {
    name: 'a live lookup unmarks a handle the UD harvest ingested',
    file: 'lib/social-graph.ts',
    from: "      s === 'ud_twitter_validation' ||\n",
    to: '',
  },
  {
    name: 'loadCode judges expiry again, so two clocks decide (Bugbot, 2026-08-25)',
    file: 'lib/oauth/requests.ts',
    from: '  return row ? { ok: true, row } : { ok: false };',
    to: '  if (row?.codeExpiresAt && row.codeExpiresAt.getTime() <= Date.now())\n    return { ok: false };\n  return row ? { ok: true, row } : { ok: false };',
  },
  {
    name: 'a spent code that has aged out reports as expired, so a late replay revokes nothing',
    file: 'lib/oauth/requests.ts',
    from: "  if (existing.consumedAt) return 'replayed';\n  return 'expired';",
    to: "  if (existing.codeExpiresAt && existing.codeExpiresAt.getTime() <= Date.now())\n    return 'expired';\n  if (existing.consumedAt) return 'replayed';\n  return 'expired';",
  },
  {
    name: 'uploaded CSV columns overwrite the fields the pipeline owns (shipped, found 2026-08-25)',
    file: 'lib/job-processor.ts',
    from: '          ...walletData,\n          wallet: walletLower,\n          source: [],\n          holdings,',
    to: '          wallet: walletLower,\n          source: [],\n          holdings,\n          ...walletData,',
  },
  {
    // The 2026-08-25 job's actual failure: `.some is not a function`, thrown
    // from the write path because nothing normalised `source` before reading it.
    name: 'the index write takes source on trust, so a joined string reaches .some',
    file: 'lib/social-graph.ts',
    from: '    source: asSourceList(r.source),',
    to: '    source: r.source,',
  },
  {
    name: 'the index write calls transaction() without asking the driver, as it did on 2026-08-22',
    file: 'lib/social-graph.ts',
    from: '  if (supportsTransactions()) {\n    return await db.transaction(async (tx) => writeAll(tx));\n  }\n  return await writeAll(db);',
    to: '  return await db.transaction(async (tx) => writeAll(tx));',
  },
  {
    name: 'the transaction capability is re-derived locally instead of read from the driver module',
    file: 'lib/social-graph.ts',
    from: '  if (supportsTransactions()) {',
    to: "  if (process.env.USE_CONNECTION_POOLING === 'true') {",
  },
  {
    name: 'a TypeError from this process is retried three times against the database',
    file: 'lib/social-graph.ts',
    from: '  if (\n    error instanceof TypeError &&\n    /is not a function|is not iterable|Cannot read properties of/.test(\n      error.message\n    )\n  ) {\n    return true;\n  }',
    to: '',
  },
  {
    // The regression Bugbot caught in the first version of the classifier:
    // `neon-http` runs every query through `fetch`, and Node rejects a network
    // failure as `TypeError: fetch failed`, so the broad rule stopped retrying
    // the faults the retry exists for.
    name: 'every TypeError is called permanent, so a failed fetch is never retried',
    file: 'lib/social-graph.ts',
    from: '  if (\n    error instanceof TypeError &&\n    /is not a function|is not iterable|Cannot read properties of/.test(\n      error.message\n    )\n  ) {\n    return true;\n  }',
    to: '  if (error instanceof TypeError) return true;',
  },
  {
    name: 'the driver refusing transactions is treated as a transient fault',
    file: 'lib/social-graph.ts',
    from: "  if (message.includes('no transactions support')) return true;",
    to: '',
  },
  {
    // The way a set of refusal assertions passes while protecting nothing.
    name: 'the retry classifier is widened until every error looks permanent',
    file: 'lib/social-graph.ts',
    from: '  if (\n    error instanceof TypeError &&\n    /is not a function|is not iterable|Cannot read properties of/.test(\n      error.message\n    )\n  ) {\n    return true;\n  }',
    to: '  return true;',
  },
  {
    // The regression Bugbot caught in the fallback added by PR #201.
    name: 'a retry without a transaction restarts, double-counting lookup_count',
    file: 'lib/social-graph.ts',
    from: 'for (let i = progress?.rowsCommitted ?? 0; i < rows.length; i += 100) {',
    to: 'for (let i = 0; i < rows.length; i += 100) {',
  },
  {
    // A run that wrote 900 of 1,000 wallets and then lost the connection
    // recorded 'failed' and logged "persist completely failed".
    name: 'an exhausted retry reports a committed prefix as a total loss',
    file: 'lib/social-graph.ts',
    from: '    succeeded: committed,\n    failed: validResults.length - committed,',
    to: '    succeeded: 0,\n    failed: validResults.length,',
  },
  {
    name: 'the resume cursor is carried even where the driver rolls back, so a retry skips work',
    file: 'lib/social-graph.ts',
    from: '  const progress: WriteProgress | undefined = supportsTransactions()\n    ? undefined\n    : { rowsCommitted: 0, auditCommitted: 0 };',
    to: '  const progress: WriteProgress | undefined = {\n    rowsCommitted: 0,\n    auditCommitted: 0,\n  };',
  },
  {
    name: 'asSourceList stops recovering a joined string, so a re-uploaded export loses its evidence',
    file: 'lib/api-sources.ts',
    from: "  if (typeof value === 'string') {",
    to: '  if (false) {',
  },
  {
    name: 'asSourceList passes a string through, so spreading it yields characters',
    file: 'lib/api-sources.ts',
    from: '  if (Array.isArray(value)) {',
    to: "  if (typeof value === 'string') return value as unknown as string[];\n  if (Array.isArray(value)) {",
  },
  {
    name: 'a resumed job reloads its partial results without normalising them',
    file: 'lib/job-processor.ts',
    from: 'results.set(r.wallet, { ...r, source: asSourceList(r.source) });',
    to: 'results.set(r.wallet, r);',
  },
  {
    name: 'the admin job viewer maps over source directly again',
    file: 'app/admin/page.tsx',
    from: '{asSourceList(result.source).map((s) => (',
    to: '{result.source?.map((s) => (',
  },
  {
    name: 'the privacy policy restates a retention period as a digit instead of reading the constant',
    file: 'app/privacy/page.tsx',
    from: '`${IP_BUCKET_RETENTION_HOURS} hours`',
    to: "'24 hours'",
  },
  {
    name: 'the cleanup job stops deleting expired sessions, so the stated period is fiction',
    file: 'app/api/cron/cleanup/route.ts',
    from: '  const auth = await cleanupExpiredAuth();',
    to: '  const auth = { sessionsDeleted: 0, tokensDeleted: 0 };',
  },
  {
    name: 'the cleanup job is written but never scheduled',
    file: 'vercel.json',
    from: '      "path": "/api/cron/cleanup",',
    to: '      "path": "/api/cron/cleanup-disabled",',
  },
  {
    name: 'analytics events lose their expiry, so a browser id is kept forever',
    file: 'app/api/cron/cleanup/route.ts',
    from: '    .delete(analyticsEvents)',
    to: '    .delete(apiMetrics)',
  },
  {
    name: 'the entity is spelled out on the privacy policy instead of read from the constant',
    file: 'app/privacy/page.tsx',
    from: '          {LEGAL_ENTITY}. Write to <Mail /> about anything on this page; a',
    to: '          Starl3xx Labs LLC. Write to <Mail /> about anything on this page; a',
  },
  {
    name: 'the privacy policy is dropped from the footer, so nobody can find it',
    file: 'components/ui/site-footer.tsx',
    from: '            <FooterLink href="/privacy">Privacy</FooterLink>\n',
    to: '',
  },
  {
    name: 'a grant table is dropped from READ_ONLY_TABLES, so CI cannot read it',
    file: 'scripts/migrate-grant-readonly.ts',
    from: "  'oauth_grants',\n  'oauth_authorization_requests',",
    to: "  'oauth_authorization_requests',",
  },
  {
    name: 'the keyed job-status route hands any valid key any job',
    file: 'app/api/v1/jobs/[id]/route.ts',
    from: '  if (!job || job.userId !== context.key.userId) {',
    to: '  if (!job) {',
  },

  // --- preview builds and Neon --------------------------------------------

  {
    // The plausible "improvement": previews are everything that is not
    // production, so widen the guard. It freezes local builds too, and the
    // invariant requires the one string that is true only on a preview.
    name: 'the preview guard loosens to not-production, freezing local builds too',
    file: 'app/api/public-stats/route.ts',
    from: "process.env.VERCEL_ENV === 'preview'",
    to: "process.env.VERCEL_ENV !== 'production'",
  },
  {
    // The catastrophic direction: a truthy test is true in production as
    // well, so the live site serves frozen constants that age silently.
    name: 'the preview guard becomes a truthy test, so production serves the frozen answer',
    file: 'app/api/starter-collections/route.ts',
    from: "if (process.env.VERCEL_ENV === 'preview') {",
    to: 'if (process.env.VERCEL_ENV) {',
  },
  {
    // Re-seeded 2026-09-17. The old defect removed a preview-only branch, and
    // that branch is gone: prerendering the corpus in production while previews
    // skipped it is what failed every production build for eight days. The
    // defect worth seeding now is the reintroduction of the build-time read
    // itself, on any environment.
    name: 'holder pages go back to prerendering the whole corpus at build time',
    file: 'app/holders/[chain]/[address]/page.tsx',
    from: 'export async function generateStaticParams() {\n  return [];\n}',
    to: 'export async function generateStaticParams() {\n  const collections = await listHolderCollections();\n  return collections.map((c) => ({ chain: c.chain, address: c.address }));\n}',
  },
  {
    name: 'the hub and sitemap listing goes back to reading Neon on preview builds',
    file: 'lib/holder-pages.ts',
    from: "  if (process.env.VERCEL_ENV === 'preview') return [];\n  const db = getDb();",
    to: '  const db = getDb();',
  },

  // --- right-to-removal stage 1 -------------------------------------------

  {
    // The mutation the synthesis names first. Without the pre-flight, a
    // suppressed wallet with no cached row runs the full external pipeline,
    // and the trigger then blocks upsertNegativeWallets, so it runs it again
    // on EVERY lookup: re-collection moving from monthly to per-lookup.
    name: 'the pre-flight filter is deleted, so a suppressed wallet runs the full pipeline',
    file: 'lib/job-processor.ts',
    from:
      '    const activeWallets =\n' +
      '      suppressedWallets.size === 0\n' +
      '        ? walletsToProcess\n' +
      '        : walletsToProcess.filter(\n' +
      '            (w) => !suppressedWallets.has(w.toLowerCase())\n' +
      '          );',
    to: '    const activeWallets = walletsToProcess;',
  },
  {
    name: 'the graph-error fallback walks every submitted wallet, suppressed included',
    file: 'lib/job-processor.ts',
    from: '      walletsNeedingLookup.push(...activeWallets);',
    to: '      walletsNeedingLookup.push(...walletsToProcess);',
  },
  {
    name: 'the finalize save skips the last scrub, so a mid-job removal is written to history',
    file: 'lib/job-processor.ts',
    // Deletes the scrub but leaves the surrounding read and if-block, so
    // the assertion must anchor on the scrub statement itself rather than
    // on loadSuppressionList being called somewhere nearby.
    from:
      '    for (let i = 0; i < results.length; i++) {\n' +
      '      results[i] = scrubResultRow(results[i], suppression);\n' +
      '    }\n',
    to: '',
  },
  {
    // The recompute after the finalize scrub is what keeps billing equal
    // to what is served: without it a mid-job removal is billed as a match
    // the customer never receives, and the stats-vs-rows off-by-one is a
    // removal oracle.
    name: 'the finalize keeps pre-scrub stats, billing a match the scrub removed',
    file: 'lib/job-processor.ts',
    from: '    anySocialFound = results.filter(\n      (r) => r.twitter_handle || r.farcaster\n    ).length;\n',
    to: '',
  },
  // --- one lookup pipeline (STA-44) --------------------------------------

  {
    // The dispatch this change removed, put back beside the kick. The two
    // pipelines then race on the job row again, which is the defect.
    name: 'a job route sends the lookup event to Inngest again, so two pipelines race',
    file: 'app/api/jobs/route.ts',
    from: '      after(async () => {\n        try {\n          await processJobChunk(jobId);',
    to: "      after(async () => {\n        try {\n          await inngest.send({ name: 'wallet/lookup.requested', data: { jobId } });\n          await processJobChunk(jobId);",
  },
  {
    name: 'the Inngest route registers a lookup function again',
    file: 'app/api/inngest/route.ts',
    from: '  functions: [],',
    to: '  functions: [walletLookup],',
  },
  {
    name: 'the API route stops kicking the worker, so a large job waits for a tick',
    file: 'app/api/v1/jobs/route.ts',
    from: '    after(async () => {\n      try {\n        await processJobChunk(jobId);',
    to: '    after(async () => {\n      try {\n        void jobId;',
  },
  {
    // The race itself: a claim that ignores the lease takes a job a live
    // holder is working, so a tick and a kick run one job at once.
    name: 'the claim ignores a live lease, so the cron and a kick work one job at once',
    file: 'lib/job-processor.ts',
    from: "        inArray(lookupJobs.status, ['pending', 'processing']),\n        claimable()\n",
    to: "        inArray(lookupJobs.status, ['pending', 'processing'])\n",
  },
  {
    name: 'a refused claim still writes the row another invocation holds',
    file: 'lib/job-processor.ts',
    from: '    return { completed: false, busy: true, ...stats };',
    to: "    await db\n      .update(lookupJobs)\n      .set({ status: 'processing', updatedAt: new Date() })\n      .where(eq(lookupJobs.id, jobId));\n    return { completed: false, busy: true, ...stats };",
  },
  {
    // A lease shorter than a holder's life runs out under it, and the next
    // tick takes the job while the first is still working it.
    name: 'the lease is shorter than the routes that hold it',
    file: 'lib/job-processor.ts',
    from: 'export const LEASE_SECONDS = 330;',
    to: 'export const LEASE_SECONDS = 120;',
  },
  {
    name: 'the worker route outlives the lease it holds',
    file: 'app/api/jobs/worker/route.ts',
    from: 'export const maxDuration = 300;',
    to: 'export const maxDuration = 800;',
  },
  {
    // An undeclared duration is the platform default, which this repo cannot
    // read and Vercel has changed before.
    name: 'the API route stops declaring how long it can hold a lease',
    file: 'app/api/v1/jobs/route.ts',
    from: 'export const maxDuration = 300;\n',
    to: '',
  },
  {
    name: 'a lease that has not run out is free to take',
    file: 'lib/job-processor.ts',
    from: '    ${lookupJobs.leasedUntil} <= now()\n',
    to: '    ${lookupJobs.leasedUntil} IS NOT NULL\n',
  },
  {
    // A processing row with no lease belongs to a pre-lease holder that may
    // still be running: the Inngest step in flight at the deploy.
    name: 'a processing job with no lease is taken at once, racing the holder from before the deploy',
    file: 'lib/job-processor.ts',
    from: '      ${lookupJobs.leasedUntil} IS NULL\n      AND (',
    to: '      ${lookupJobs.leasedUntil} IS NULL\n      OR (',
  },
  {
    // The Drizzle raw-SQL trap: updated_at holds UTC wall time, and a bare
    // now() reads through the session zone.
    name: 'the pre-lease wait compares UTC wall time with the session zone',
    file: 'lib/job-processor.ts',
    from: "OR ${lookupJobs.updatedAt} < (now() AT TIME ZONE 'UTC') - make_interval",
    to: 'OR ${lookupJobs.updatedAt} < now() - make_interval',
  },
  {
    name: 'a slice keeps its lease, so the job sits out five minutes between slices',
    file: 'lib/job-processor.ts',
    from: '      // Handed back for the next slice. Now, not NULL: see claimable().\n      leasedUntil: sql`now()`,\n',
    to: '',
  },
  {
    name: 'a slice hands the lease back as NULL, which reads as a holder from before leases',
    file: 'lib/job-processor.ts',
    from: '      // Handed back for the next slice. Now, not NULL: see claimable().\n      leasedUntil: sql`now()`,\n',
    to: '      leasedUntil: null,\n',
  },
  {
    name: 'a failed job keeps its lease',
    file: 'lib/job-processor.ts',
    from: '        retryCount: job.retryCount + 1,\n        updatedAt: new Date(),\n        leasedUntil: sql`now()`,\n',
    to: '        retryCount: job.retryCount + 1,\n        updatedAt: new Date(),\n',
  },
  {
    name: 'a completed job keeps its lease',
    file: 'lib/job-processor.ts',
    from: '    matchesDelivered,\n    leasedUntil: sql`now()`,\n',
    to: '    matchesDelivered,\n',
  },
  {
    // Admitted against the wallet budget, then refused by the claim: the
    // tick spends its budget on a job it cannot work.
    name: "the worker's candidate read admits jobs another invocation holds",
    file: 'lib/job-processor.ts',
    from: ".where(and(eq(lookupJobs.status, 'processing'), claimable()))",
    to: ".where(eq(lookupJobs.status, 'processing'))",
  },
  {
    // Review of #393: the claim's WHERE was checked for its status clause
    // and claimable(), not for the row key. Without it the UPDATE leases every
    // claimable job and returns the first, and this slice works another
    // customer's wallets into this job's row.
    name: "the claim is not keyed on the job id, so one invocation leases every claimable job and works another customer's",
    file: 'lib/job-processor.ts',
    from: '      and(\n        eq(lookupJobs.id, jobId),\n        inArray(',
    to: '      and(\n        inArray(',
  },
  {
    // Review of #393: a substring check kept passing with this, and no job
    // is ever claimable again: the queue stops.
    name: 'the lease test and the no-lease test are ANDed, so no job is ever claimable',
    file: 'lib/job-processor.ts',
    from: '    ${lookupJobs.leasedUntil} <= now()\n    OR (\n',
    to: '    ${lookupJobs.leasedUntil} <= now()\n    AND (\n',
  },
  {
    // Review of #393: the fragment `<= now()` survives a suffix, and every
    // live 330-second lease is free to the next tick.
    name: 'a lease is free before it runs out',
    file: 'lib/job-processor.ts',
    from: '    ${lookupJobs.leasedUntil} <= now()\n',
    to: "    ${lookupJobs.leasedUntil} <= now() + interval '6 minutes'\n",
  },
  {
    // The finding the review confirmed: writes after the claim matched on the
    // id alone, so a holder resumed after its lease ran out cut a completed,
    // billed job back to its own stale rows.
    name: 'a write after the claim matches the job id alone, so a stale holder overwrites a completed job',
    file: 'lib/job-processor.ts',
    from: '    .where(owned(job.id, job.leaseToken!))',
    to: '    .where(eq(lookupJobs.id, job.id))',
  },
  {
    name: 'the fence drops the token, so any holder of a running job can write it',
    file: 'lib/job-processor.ts',
    from: '    eq(lookupJobs.leaseToken, token),\n',
    to: '',
  },
  {
    // A stale holder's catch would then write 'failed' over a job another
    // invocation had just completed.
    name: 'the fence drops the running check, so a stale holder can write a finished job',
    file: 'lib/job-processor.ts',
    from: "    eq(lookupJobs.leaseToken, token),\n    eq(lookupJobs.status, 'processing')\n",
    to: '    eq(lookupJobs.leaseToken, token)\n',
  },
  {
    name: 'a fenced write that matched nothing carries on, so a holder that lost the job keeps working it',
    file: 'lib/job-processor.ts',
    from: '  if (rows.length === 0) throw new LeaseLostError(job.id);\n',
    to: '',
  },
  {
    name: 'every claim keeps the old token, so a stale holder still matches the fence',
    file: 'lib/job-processor.ts',
    from: '      leaseToken: sql`gen_random_uuid()`,\n',
    to: '',
  },
  {
    name: 'a stage write bypasses the fence',
    file: 'lib/job-processor.ts',
    from: '  await writeOwned(db, job, { currentStage: stage, updatedAt: new Date() });',
    to: '  await db\n    .update(lookupJobs)\n    .set({ currentStage: stage, updatedAt: new Date() })\n    .where(eq(lookupJobs.id, job.id));',
  },
  {
    name: 'a holder that lost the job marks it failed anyway, over the invocation that holds it',
    file: 'lib/job-processor.ts',
    from: '    if (error instanceof LeaseLostError) {\n      console.warn(error.message);\n',
    to: '    if (!error) {\n      console.warn(String(error));\n',
  },
  {
    name: 'a lost lease in the failure write escapes as an error, reporting a job this holder never failed',
    file: 'lib/job-processor.ts',
    from: '      if (!(writeError instanceof LeaseLostError)) throw writeError;',
    to: '      throw writeError;',
  },
  {
    name: 'finalize charges without re-asserting the claim',
    file: 'lib/job-processor.ts',
    from: '  await writeOwned(db, job, {\n    processedCount: job.wallets.length,',
    to: '  if (options.fastMode) await writeOwned(db, job, {\n    processedCount: job.wallets.length,',
  },
  {
    // A second history row for one job, the duplicate the review found.
    name: 'finalize saves history without re-asserting the claim',
    file: 'lib/job-processor.ts',
    from: '    await renewLease(db, job);\n    try {\n      // Always keyed on the job',
    to: '    try {\n      // Always keyed on the job',
  },
  {
    name: 'finalize writes the graph without re-asserting the claim',
    file: 'lib/job-processor.ts',
    from: '    await renewLease(db, job);\n    const writeResult = await upsertSocialGraphWithRetry(',
    to: '    const writeResult = await upsertSocialGraphWithRetry(',
  },
  {
    // A slice the platform kills never reaches its catch, so without the
    // count it is retaken for as long as the upstream stays slow.
    name: 'the claim stops counting attempts, so a slice killed every time is retaken for ever',
    file: 'lib/job-processor.ts',
    from: '      sliceAttempts: sql`${lookupJobs.sliceAttempts} + 1`,\n',
    to: '',
  },
  {
    name: 'a saved slice keeps its attempt count, so ordinary progress walks a job into the cap',
    file: 'lib/job-processor.ts',
    from: '      leasedUntil: sql`now()`,\n      sliceAttempts: 0,\n    });\n\n    return {\n      completed: false,',
    to: '      leasedUntil: sql`now()`,\n    });\n\n    return {\n      completed: false,',
  },
  {
    name: 'an exhausted job keeps its count, so an admin rerun fails again at once',
    file: 'lib/job-processor.ts',
    from: '          errorMessage: message,\n          updatedAt: new Date(),\n          leasedUntil: sql`now()`,\n          sliceAttempts: 0,\n',
    to: '          errorMessage: message,\n          updatedAt: new Date(),\n          leasedUntil: sql`now()`,\n',
  },
  {
    name: 'a killed slice is retried at full size, so it is killed again the same way',
    file: 'lib/job-processor.ts',
    from: '  return CHUNK_SIZE >> Math.min(Math.max(attempts - 1, 0), 3);',
    to: '  return CHUNK_SIZE;',
  },
  {
    name: 'the slice ignores the attempt count',
    file: 'lib/job-processor.ts',
    from: '      startIndex + sliceSizeFor(job.sliceAttempts)',
    to: '      startIndex + CHUNK_SIZE',
  },
  {
    name: 'the attempt cap never fires',
    file: 'lib/job-processor.ts',
    from: '    if (job.sliceAttempts > MAX_SLICE_ATTEMPTS) {',
    to: '    if (job.sliceAttempts > MAX_SLICE_ATTEMPTS * 100) {',
  },
  {
    name: 'the attempt cap is raised until it never binds',
    file: 'lib/job-processor.ts',
    from: 'export const MAX_SLICE_ATTEMPTS = 5;',
    to: 'export const MAX_SLICE_ATTEMPTS = 500;',
  },
  {
    // The review's trigger: 60 serial batches, each able to wait out a
    // 15-second RPC timeout, outrun a 300-second invocation.
    name: 'ENS reverse resolution ignores the deadline',
    file: 'lib/ens.ts',
    from: '    if (ensPastDeadline(opts?.deadline, wallets.slice(i), opts?.failedWallets))\n      break;\n',
    to: '',
  },
  {
    name: 'ENS text records ignore the deadline',
    file: 'lib/ens.ts',
    from: '    if (\n      ensPastDeadline(\n        opts?.deadline,\n        walletsWithENS.slice(i).map(([wallet]) => wallet),\n        opts?.failedWallets\n      )\n    )\n      break;\n',
    to: '',
  },
  {
    // Bugbot's 2026-08-25 High, on the ENS side: a wallet nobody reached is
    // cached as "checked, has nothing" and stored as a negative.
    name: 'ENS wallets past the deadline are not recorded as failed, so they are cached as empty',
    file: 'lib/ens.ts',
    from: '  for (const wallet of unreached) failedWallets?.add(wallet.toLowerCase());\n',
    to: '',
  },
  {
    name: 'the worker gives ENS no deadline',
    file: 'lib/job-processor.ts',
    from: '              deadline: ensDeadline,\n',
    to: '',
  },
  {
    name: 'the worker drops what ENS skipped from the failed set, so it is stored as a negative',
    file: 'lib/job-processor.ts',
    from: '        apiFailedWallets.add(wallet);\n        if (ensDeadline === invocationDeadline) cutShort.add(wallet);',
    to: '        if (ensDeadline === invocationDeadline) cutShort.add(wallet);',
  },
  // --- the verify pass on #393 ---------------------------------------------
  {
    // Finding 6: the renewal's body was never read. A rotated token makes the
    // next fenced write find the job lost after its charge, and every job
    // then ends failed and billed.
    name: 'a renewal rotates the token, so the write after the charge finds the job lost',
    file: 'lib/job-processor.ts',
    from: '  await writeOwned(db, job, {\n    leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,\n  });\n}',
    to: '  await writeOwned(db, job, {\n    leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,\n    leaseToken: sql`gen_random_uuid()`,\n  });\n}',
  },
  {
    name: 'a renewal hands the lease back just before the history save and the graph write',
    file: 'lib/job-processor.ts',
    from: '  await writeOwned(db, job, {\n    leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,\n  });\n}',
    to: '  await writeOwned(db, job, {\n    leasedUntil: sql`now()`,\n  });\n}',
  },
  {
    name: 'a renewal is not awaited, so a holder that lost the job saves and writes the graph anyway',
    file: 'lib/job-processor.ts',
    from: '  await writeOwned(db, job, {\n    leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,\n  });\n}',
    to: '  void writeOwned(db, job, {\n    leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,\n  });\n}',
  },
  {
    name: 'a renewal swallows a lost lease',
    file: 'lib/job-processor.ts',
    from: '  await writeOwned(db, job, {\n    leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,\n  });\n}',
    to: '  await writeOwned(db, job, {\n    leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,\n  }).catch(() => {});\n}',
  },
  {
    // Finding 7: a substring check passed a conditional renewal.
    name: 'the renewal before the history save is conditional, so a stale holder saves a second copy',
    file: 'lib/job-processor.ts',
    from: '  if (options.saveToHistory) {\n    await renewLease(db, job);',
    to: '  if (options.saveToHistory) {\n    if (options.fastMode) await renewLease(db, job);',
  },
  {
    name: 'the renewal before the graph write is conditional',
    file: 'lib/job-processor.ts',
    from: '  if (positiveResults.length > 0) {\n    await renewLease(db, job);',
    to: '  if (positiveResults.length > 0) {\n    if (options.fastMode) await renewLease(db, job);',
  },
  {
    // Findings 0 and 4: without the save, a job billed and then killed goes
    // back through the providers, counts toward the cap, and can end failed
    // with the debit standing.
    name: 'the finished rows are not saved before the charge, so a job killed after it can be failed billed',
    file: 'lib/job-processor.ts',
    from: '  await writeOwned(db, job, {\n    processedCount: job.wallets.length,\n    partialResults: results,\n',
    to: '  await writeOwned(db, job, {\n',
  },
  {
    // Final check on #393: past the cap, a saved job must be finished.
    name: 'the attempt cap fails a job whose rows are all saved',
    file: 'lib/job-processor.ts',
    from: '      if (!saved) {\n        const message',
    to: '      if (true) {\n        const message',
  },
  {
    // Past the cap a billed, unsaved job must stop: retrying it for ever is
    // what an admin rerun of a billed job under a persistent error did.
    name: 'a billed job that never saves is retried past the cap for ever',
    file: 'lib/job-processor.ts',
    from: '      if (!saved) {\n        const message',
    to: '      if (!saved && !billed) {\n        const message',
  },
  {
    name: 'a billed job stopped at the cap is told to submit again, and charged twice when it does',
    file: 'lib/job-processor.ts',
    from: '        const message = billed ? BILLED_STOPPED : SLICES_EXHAUSTED;',
    to: '        const message = SLICES_EXHAUSTED;',
  },
  {
    name: 'a billed job stops at the cap with no line for ops to act on',
    file: 'lib/job-processor.ts',
    from: '        if (billed) {\n          console.error(',
    to: '        if (billed) {\n          console.log(',
  },
  {
    name: 'the charged-job answer tells the customer to submit again',
    file: 'lib/job-processor.ts',
    from: "  'Processing stopped after this lookup was charged. Contact help@walletlink.social for a rerun or a refund.';",
    to: "  'Processing stopped after this lookup was charged. Submit the list again.';",
  },
  {
    name: 'the failure path fails a job whose charge has landed',
    file: 'lib/job-processor.ts',
    from: '      if (saved || billed) {',
    to: '      if (saved) {',
  },
  {
    // The final check's finding: this is the form that read correctly and
    // never matched, because Drizzle renders both columns unqualified.
    name: 'the ledger check correlates through columns again, so it compares credit_ledger to itself',
    file: 'lib/job-processor.ts',
    from: "exists (select 1 from credit_ledger cl where cl.job_id = ${jobId}::uuid and cl.paid_from <> 'unlock')",
    // The same bug in the names in scope here: `${lookupJobs.id}` renders as
    // a bare "id", which inside the subquery is credit_ledger's own id.
    to: "exists (select 1 from credit_ledger where job_id = ${lookupJobs.id} and paid_from <> 'unlock')",
  },
  {
    name: 'an unlock row counts as the charge',
    file: 'lib/job-processor.ts',
    from: "cl.job_id = ${jobId}::uuid and cl.paid_from <> 'unlock')",
    to: 'cl.job_id = ${jobId}::uuid)',
  },
  {
    // Finding 1 of the verify pass: ungated saves carried no job id, so
    // nothing stopped a second.
    name: 'an ungated job saves history without its job id, so a second finalize saves it again',
    file: 'lib/job-processor.ts',
    from: '        { jobId: job.id, matchesDelivered, leaseToken: job.leaseToken! }\n',
    to: '        matchesDelivered !== null\n          ? { jobId: job.id, matchesDelivered, leaseToken: job.leaseToken! }\n          : undefined\n',
  },
  {
    name: "a second pass keeps the first pass's gate, so a saved copy of a gated job opens every match",
    file: 'lib/history.ts',
    from: 'DO UPDATE SET matches_delivered = excluded.matches_delivered WHERE',
    to: 'DO UPDATE SET matches_delivered = lookup_history.matches_delivered WHERE',
  },
  {
    name: "a job's history save goes back to DO NOTHING, and the gate decided later never reaches history",
    file: 'lib/history.ts',
    from: 'ON CONFLICT (job_id) DO UPDATE SET matches_delivered = excluded.matches_delivered WHERE excluded.matches_delivered IS NOT NULL AND lookup_history.matches_delivered IS DISTINCT FROM excluded.matches_delivered',
    to: 'ON CONFLICT (job_id) DO NOTHING',
  },
  {
    name: 'a gate correction counts as a save, so history_saved fires twice for one lookup',
    file: 'lib/history.ts',
    from: '  if (row) return row.inserted ? row.id : null;',
    to: '  if (row) return row.id;',
  },
  {
    // Final check on #393: the rerun's results never reached saved history.
    name: "an admin rerun keeps the old saved lookup attached, so the rerun's results are never saved",
    file: 'app/api/admin/jobs/route.ts',
    from: '      await db\n        .update(lookupHistory)\n        .set({ jobId: null })\n        .where(eq(lookupHistory.jobId, id));\n',
    to: '',
  },
  {
    name: 'history_saved counts a save that wrote nothing',
    file: 'lib/job-processor.ts',
    from: '      if (lookupId) {\n',
    to: '      if (lookupId || true) {\n',
  },
  {
    name: 'the history index is not unique, so ON CONFLICT has nothing to meet',
    file: 'scripts/migrate-job-lease.ts',
    from: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS lookup_history_job_id_key',
    to: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS lookup_history_job_id_key',
  },
  {
    // Findings 2 and 3: the admin's retry kept the kills of the run it
    // replaced, and the next claim failed the job before any work.
    name: 'an admin retry keeps the attempt count, so a job killed five times fails at its first claim',
    file: 'app/api/admin/jobs/route.ts',
    from: "          // old attempt is fenced out, since the row is no longer its token's.\n          sliceAttempts: 0,\n",
    to: "          // old attempt is fenced out, since the row is no longer its token's.\n",
  },
  {
    name: 'an admin retry keeps the old lease, so the rerun waits out a holder that is gone',
    file: 'app/api/admin/jobs/route.ts',
    from: "          // old attempt is fenced out, since the row is no longer its token's.\n          sliceAttempts: 0,\n          leasedUntil: null,\n",
    to: "          // old attempt is fenced out, since the row is no longer its token's.\n          sliceAttempts: 0,\n",
  },
  {
    // Finding 8: an unbounded budget lets a slow RPC run the slice to the kill.
    name: 'the ENS deadline is widened past the invocation',
    file: 'lib/job-processor.ts',
    from: 'export const ENS_SLICE_BUDGET_MS = 120_000;',
    to: 'export const ENS_SLICE_BUDGET_MS = 1_200_000;',
  },
  {
    // Finding 9: only `.update(lookupJobs)` was counted.
    name: 'a stage write goes through raw SQL, around the fence',
    file: 'lib/job-processor.ts',
    from: '  await writeOwned(db, job, { currentStage: stage, updatedAt: new Date() });',
    to: '  await db.execute(\n    sql`UPDATE lookup_jobs SET current_stage = ${stage} WHERE id = ${job.id}`\n  );',
  },
  {
    // Finding 10: every job path names every schema column.
    name: 'the schema names the attempt column differently from the migration',
    file: 'db/schema.ts',
    from: "    sliceAttempts: integer('slice_attempts').default(0).notNull(),",
    to: "    sliceAttempts: integer('slice_attempt').default(0).notNull(),",
  },
  {
    name: 'the migration adds an attempt column the schema does not name',
    file: 'scripts/migrate-job-lease.ts',
    from: 'ADD COLUMN IF NOT EXISTS slice_attempts integer NOT NULL DEFAULT 0',
    to: 'ADD COLUMN IF NOT EXISTS slice_attempt integer NOT NULL DEFAULT 0',
  },
  {
    // A job Inngest left mid-run: processed_count is its count, and no rows
    // were saved, so trusting it completes the job without those wallets.
    name: 'a resume trusts processed_count alone, and finishes a job without the wallets before it',
    file: 'lib/job-processor.ts',
    from: '  const job = resumeFromSavedPrefix(claimed);',
    to: '  const job = claimed;',
  },
  {
    name: 'a restart keeps the counts from the run it discards, counting matches twice',
    file: 'lib/job-processor.ts',
    from: '        twitterFound: 0,\n        farcasterFound: 0,\n        anySocialFound: 0,\n        cacheHits: 0,\n      };',
    to: '      };',
  },
  {
    // The job's wallets keep the submitted case; the saved rows are lowered.
    name: "the resume check compares case, so the worker's own progress restarts every slice",
    file: 'lib/job-processor.ts',
    from: "typeof w === 'string' ? w.toLowerCase() : w",
    to: 'w',
  },
  {
    name: 'the resume check compares lengths, so a repeated address restarts the job for ever',
    file: 'lib/job-processor.ts',
    from: '  const upTo = Math.min(job.processedCount, job.wallets.length);\n',
    to: '  const upTo = Math.min(job.processedCount, job.wallets.length);\n  if (saved.size < upTo) return { ...job, processedCount: 0 };\n',
  },
  {
    // The retention sweep nulls the wallets of a job untouched for 30 days,
    // and this runs before the failure handler exists.
    name: 'the resume check throws on a stripped wallet list, stranding the job under its lease',
    file: 'lib/job-processor.ts',
    from: "typeof w === 'string' ? w.toLowerCase() : w",
    to: '(w as string).toLowerCase()',
  },
  // --- one invocation, many slices (STA-44) -------------------------------
  // An invocation worked one slice and left the rest to the cron, so a
  // 10,000-address fast scan took four ticks. It now takes slices while its
  // budget lasts; each mutation below breaks the budget, the stop, or the
  // claim each slice goes through.
  {
    name: 'slice loop: the budget runs to the route end, so a late slice is killed before it saves',
    file: 'lib/job-processor.ts',
    from: 'export const INVOCATION_BUDGET_MS = 240_000;',
    to: 'export const INVOCATION_BUDGET_MS = 290_000;',
  },
  {
    name: 'slice loop: the budget cannot hold an ENS budget, so the first slice loses ENS to it',
    file: 'lib/job-processor.ts',
    from: 'export const INVOCATION_BUDGET_MS = 240_000;',
    to: 'export const INVOCATION_BUDGET_MS = 150_000;',
  },
  {
    // The stop condition without its estimate: the loop starts a slice at
    // 200 s of 240 and it ends at 250.
    name: 'slice loop: a slice starts with no estimate of its length, so the last one overruns the budget',
    file: 'lib/job-processor.ts',
    from: '    if (now() + estimateMs > invocationDeadline) return result;',
    to: '    if (now() > invocationDeadline) return result;',
  },
  {
    name: 'slice loop: nothing stops it for time, so it runs slices into the platform kill',
    file: 'lib/job-processor.ts',
    from: '    if (now() + estimateMs > invocationDeadline) return result;\n',
    to: '',
  },
  {
    name: 'slice loop: the budget restarts with every slice, so an invocation never runs out of it',
    file: 'lib/job-processor.ts',
    from: '  const invocationDeadline = now() + budgetMs;\n  let savedThrough = -1;\n  for (;;) {\n',
    to: '  let savedThrough = -1;\n  for (;;) {\n    const invocationDeadline = now() + budgetMs;\n',
  },
  {
    name: "slice loop: each slice is handed its own deadline, so a late slice's sources run past the invocation",
    file: 'lib/job-processor.ts',
    from: '    const result = await slice(invocationDeadline);',
    to: '    const result = await slice(now() + budgetMs);',
  },
  {
    // The lease between slices: a slice that found the job held, or lost it
    // part-way, comes back busy, and the next claim is refused the same way.
    name: 'slice loop: it keeps claiming a job another invocation holds, spinning on refused claims until the budget ends',
    file: 'lib/job-processor.ts',
    from: '    if (result.completed || result.busy || result.error !== undefined) {',
    to: '    if (result.completed || result.error !== undefined) {',
  },
  {
    name: 'slice loop: a slice that ended in an error is retried at once',
    file: 'lib/job-processor.ts',
    from: '    if (result.completed || result.busy || result.error !== undefined) {',
    to: '    if (result.completed || result.busy) {',
  },
  {
    name: 'slice loop: it takes another slice of a finished job',
    file: 'lib/job-processor.ts',
    from: '    if (result.completed || result.busy || result.error !== undefined) {',
    to: '    if (result.busy || result.error !== undefined) {',
  },
  {
    name: 'slice loop: a slice that saved nothing is taken again, and again',
    file: 'lib/job-processor.ts',
    from: '    if (result.processedCount <= savedThrough) return result;\n',
    to: '',
  },
  {
    name: 'slice loop: processJobChunk works one slice again, so a fast scan waits on the cron',
    file: 'lib/job-processor.ts',
    from: '  return runSlices(\n    (invocationDeadline) => processJobSlice(jobId, invocationDeadline),\n    budgetMs\n  );',
    to: '  return processJobSlice(jobId, Date.now() + budgetMs);',
  },
  {
    name: 'slice loop: the cron worker widens its own budget past the margin',
    file: 'app/api/jobs/worker/route.ts',
    from: '          const result = await processJobChunk(job.id);',
    to: '          const result = await processJobChunk(job.id, 600_000);',
  },
  {
    name: "slice loop: a late slice's ENS pass ignores the invocation deadline and reads into the kill",
    file: 'lib/job-processor.ts',
    from: '  return Math.min(sliceStartedAt + ENS_SLICE_BUDGET_MS, invocationDeadline);',
    to: '  return sliceStartedAt + ENS_SLICE_BUDGET_MS;',
  },
  {
    // The other half: counted from the invocation, a slice started 100 s in
    // gets 20 s of ENS, and every wallet after that is recorded unreached.
    name: "slice loop: a later slice's ENS budget is counted from the invocation, so its wallets go unreached",
    file: 'lib/job-processor.ts',
    from: '  return Math.min(sliceStartedAt + ENS_SLICE_BUDGET_MS, invocationDeadline);',
    to: '  return Math.min(\n    invocationDeadline - INVOCATION_BUDGET_MS + ENS_SLICE_BUDGET_MS,\n    invocationDeadline\n  );',
  },
  {
    name: 'slice loop: the slice gives ENS its per-slice deadline alone',
    file: 'lib/job-processor.ts',
    from: '      const ensDeadline = ensDeadlineFor(sliceStartedAt, invocationDeadline);',
    to: '      const ensDeadline = sliceStartedAt + ENS_SLICE_BUDGET_MS;',
  },
  {
    name: 'slice loop: the slice gives Web3Bio no deadline, so a late slice runs its waves into the kill',
    file: 'lib/job-processor.ts',
    from: '            deadline: invocationDeadline,\n',
    to: '',
  },
  // --- the prefix save (review of #397) -----------------------------------
  // A late slice slower than the one before it lost the tail of its Web3Bio
  // pass to the invocation deadline with every upstream healthy, and saved
  // those wallets as done. Each mutation below puts part of that back.
  {
    name: 'prefix save: the slice saves past the wallets the deadline cut, so they finish as misses never asked',
    file: 'lib/job-processor.ts',
    from: '    const newProcessedCount = startIndex + reached;',
    to: '    const newProcessedCount = startIndex + walletsToProcess.length;',
  },
  {
    name: 'prefix save: the stats count the wallets handed on, so the next slice counts them twice',
    file: 'lib/job-processor.ts',
    from: '    const chunkResults = walletsToProcess\n      .slice(0, reached)\n',
    to: '    const chunkResults = walletsToProcess\n',
  },
  {
    name: 'prefix save: the saved prefix ignores what was cut',
    file: 'lib/job-processor.ts',
    from: '  if (cutShort.size === 0) return wallets.length;\n  const at = wallets.findIndex(',
    to: '  if (cutShort.size >= 0) return wallets.length;\n  const at = wallets.findIndex(',
  },
  {
    name: 'prefix save: the saved prefix runs to the last wallet cut, not the first',
    file: 'lib/job-processor.ts',
    from: '  const at = wallets.findIndex((w) => cutShort.has(w.toLowerCase()));',
    to: '  const at = wallets.findLastIndex((w) => cutShort.has(w.toLowerCase()));',
  },
  {
    name: 'prefix save: a cut slice keeps the rows it handed on, so the next slice merges into half-done rows',
    file: 'lib/job-processor.ts',
    from: '      results.delete(wallet);\n      if (cacheHitWallets.has(wallet)) cacheHits--;',
    to: '      if (cacheHitWallets.has(wallet)) cacheHits--;',
  },
  {
    // A repeated address answers for its earlier place: dropping its row
    // leaves the saved part short a row, and the resume check restarts the job.
    name: 'prefix save: the drop takes a row the saved part still needs',
    file: 'lib/job-processor.ts',
    from: '      .filter((w) => !kept.has(w))\n',
    to: '',
  },
  {
    name: 'prefix save: cache hits keep the wallets handed on, so they are counted again',
    file: 'lib/job-processor.ts',
    from: '      if (cacheHitWallets.has(wallet)) cacheHits--;\n',
    to: '',
  },
  {
    name: 'prefix save: ENS wallets the invocation cut are saved as done',
    file: 'lib/job-processor.ts',
    from: '        if (ensDeadline === invocationDeadline) cutShort.add(wallet);\n',
    to: '',
  },
  {
    // ENS's own budget stopping it is a degraded upstream: unchecked, not
    // retried, as on main. Handing those on too would redo them every slice.
    name: "prefix save: ENS's own budget is taken for the invocation's, and its skips are retried every slice",
    file: 'lib/job-processor.ts',
    from: '        if (ensDeadline === invocationDeadline) cutShort.add(wallet);',
    to: '        cutShort.add(wallet);',
  },
  {
    name: 'prefix save: the worker gives Web3Bio no cut set, so its cut wallets are saved as done',
    file: 'lib/job-processor.ts',
    from: '            deadline: invocationDeadline,\n            cutShort,\n',
    to: '            deadline: invocationDeadline,\n',
  },
  {
    name: "prefix save: Web3Bio calls every unreached wallet cut, its own ceiling's included",
    file: 'lib/web3bio.ts',
    from: '        if (callerCuts) opts?.cutShort?.add(wallet.toLowerCase());',
    to: '        opts?.cutShort?.add(wallet.toLowerCase());',
  },
  {
    name: 'prefix save: Web3Bio never records a cut wallet',
    file: 'lib/web3bio.ts',
    from: '        if (callerCuts) opts?.cutShort?.add(wallet.toLowerCase());\n',
    to: '',
  },
  {
    name: 'prefix save: Web3Bio takes any caller deadline for a cut, even one past its own ceiling',
    file: 'lib/web3bio.ts',
    from: '    callerDeadline < startTime + batchDeadlineMs(walletCount)',
    to: '    callerDeadline > 0',
  },
  {
    name: 'slice loop: the estimate is not scaled to the next slice, so a full slice after a halved one is under-gated',
    file: 'lib/job-processor.ts',
    from: '        ? (lastSliceMs * result.nextSliceSize) / result.sliceSize\n',
    to: '        ? lastSliceMs\n',
  },
  {
    name: "slice loop: the next slice's size is reported as the one just taken",
    file: 'lib/job-processor.ts',
    from: '      nextSliceSize: Math.min(\n        sliceSizeFor(1),',
    to: '      nextSliceSize: Math.min(\n        walletsToProcess.length,',
  },
  {
    name: "slice loop: the loop's default clock is not the wall clock, so every deadline it hands a slice is in 1970 and ENS and Web3Bio reach no wallet",
    file: 'lib/job-processor.ts',
    from: '  now: () => number = Date.now\n',
    to: '  now: () => number = () => performance.now()\n',
  },
  {
    name: 'a saved or billed job handed back after an error reports no error, so the loop reclaims it at once',
    file: 'lib/job-processor.ts',
    from: "          cacheHits: job.cacheHits,\n          error: error instanceof Error ? error.message : 'Unknown error',\n        };\n      }\n      await writeOwned(db, job, {\n        status: 'failed',",
    to: "          cacheHits: job.cacheHits,\n        };\n      }\n      await writeOwned(db, job, {\n        status: 'failed',",
  },
  {
    name: 'slice loop: the scan depth page states a slice size the code does not use',
    file: 'docs-site/concepts/scan-depth.mdx',
    from: 'Every lookup works its list 3,000 addresses at a time',
    to: 'Every lookup works its list 2,000 addresses at a time',
  },
  {
    name: 'slice loop: the API description states a pass budget the code does not use',
    file: 'docs-site/openapi.yaml',
    from: 'worker takes a job 3,000 addresses at a time for up to four minutes,',
    to: 'worker takes a job 3,000 addresses at a time for up to five minutes,',
  },
  {
    name: 'slice loop: the scan depth page promises a list of any size in seconds again',
    file: 'docs-site/concepts/scan-depth.mdx',
    from: '    of 10,000 addresses comes back in seconds.',
    to: '    of any size comes back in seconds.',
  },
  {
    name: "slice loop: Web3Bio ignores the caller's deadline",
    file: 'lib/web3bio.ts',
    from: '    callerDeadline ?? Infinity',
    to: '    Infinity',
  },
  {
    name: 'slice loop: the Web3Bio batch drops the deadline it was given',
    file: 'lib/web3bio.ts',
    from: '  const deadline = waveDeadline(startTime, wallets.length, opts?.deadline);',
    to: '  const deadline = waveDeadline(startTime, wallets.length);',
  },

  {
    // The load-bearing order: suppression rows commit FIRST, then the
    // erasure. Fired without awaiting, the deletes race an in-flight sweep
    // batch that can re-insert the mapping before any guard exists.
    name: 'the erasure runs before the suppression rows exist, reopening the re-insert window',
    file: 'app/api/admin/removal/route.ts',
    from: '    outcomes = await insertSuppressions(db, targets, lane, reason);',
    to: '    outcomes = new Map();\n    void insertSuppressions(db, targets, lane, reason);',
  },
  {
    // The exact shape of propagateManualCorrection, which is correct there
    // and forbidden here: a swallowed amend failure is masked by the
    // serve-time filter forever, while the operator reads "removed".
    name: 'the jsonb amend goes fail-soft, copying the manual-correction shape',
    file: 'lib/removal-admin.ts',
    from:
      '  const historyRows = await amendSavedCopies(\n' +
      '    db,\n' +
      "    'lookup_history',\n" +
      "    'results',\n" +
      '    identifier,\n' +
      '    RESULT_MATCH_KEY[kind],\n' +
      '    RESULT_STRIP[kind],\n' +
      "    kind === 'twitter'\n" +
      '  );',
    to:
      '  const historyRows = await amendSavedCopies(\n' +
      '    db,\n' +
      "    'lookup_history',\n" +
      "    'results',\n" +
      '    identifier,\n' +
      '    RESULT_MATCH_KEY[kind],\n' +
      '    RESULT_STRIP[kind],\n' +
      "    kind === 'twitter'\n" +
      '  ).catch((error) => {\n' +
      "    console.error('lookup_history amend failed:', error);\n" +
      '    return 0;\n' +
      '  });',
  },
  {
    // The triggers only guard writes: with the forward filter gone, a
    // restored backup or a failed erasure keeps serving the mapping to
    // every keyed caller until some write happens to hit the trigger.
    name: 'the single forward lookup stops asking the suppression list',
    file: 'app/api/v1/wallet/[address]/route.ts',
    from: "  if (isKindSuppressed(suppression, 'wallet', normalizedAddress)) {\n",
    to: '  if (false) {\n',
  },
  {
    name: 'the batch serves suppressed wallets straight off the index again',
    file: 'app/api/v1/batch/route.ts',
    from: "    if (isKindSuppressed(suppression, 'wallet', r.wallet)) return false;\n",
    to: '    if (false) return false;\n',
  },
  {
    name: 'the endpoint writes its own timestamps, defeating the per-row jitter',
    file: 'lib/removal-admin.ts',
    from:
      '      INSERT INTO suppressed_identifiers (kind, identifier, reason, lane)\n' +
      '      VALUES (${t.kind}, ${t.identifier}, ${reason}, ${lane})',
    to:
      '      INSERT INTO suppressed_identifiers (kind, identifier, reason, lane, requested_at, created_at)\n' +
      '      VALUES (${t.kind}, ${t.identifier}, ${reason}, ${lane}, now(), now())',
  },
  {
    name: 'the jitter collapses to a shared now(), so co-batched rows re-join by equality',
    file: 'scripts/migrate-suppression.ts',
    from: "const JITTERED_DEFAULT = `(now() - random() * interval '4 hours')`;",
    to: 'const JITTERED_DEFAULT = `now()`;',
  },
  {
    // EXCLUDED reflects BEFORE INSERT edits, so an INSERT-only guard leaks
    // a suppressed handle back through COALESCE(EXCLUDED.x, stored.x) and
    // through every literal-set UPDATE writer.
    name: 'the guard fires on INSERT alone, so the upsert conflict branch keeps the handle',
    file: 'scripts/migrate-suppression.ts',
    from: '             BEFORE INSERT OR UPDATE ON ${a.table}',
    to: '             BEFORE INSERT ON ${a.table}',
  },
  {
    // The coverage assertion's whole reason to exist: an identity-carrying
    // table added later, with no trigger and no boundary entry, must fail
    // the build rather than quietly falsify the promise.
    name: 'a new identity-carrying table ships with no trigger and no boundary entry',
    file: 'db/schema.ts',
    from: 'export type SuppressedIdentifier = typeof suppressedIdentifiers.$inferSelect;',
    to:
      "export const probeContacts = pgTable('probe_contacts', {\n" +
      "  wallet: text('wallet').primaryKey(),\n" +
      '});\n\n' +
      'export type SuppressedIdentifier = typeof suppressedIdentifiers.$inferSelect;',
  },
  {
    name: 'a guarded table quietly leaves the attachment list',
    file: 'scripts/migrate-suppression.ts',
    from:
      '  {\n' +
      "    table: 'known_agents',\n" +
      "    fn: 'suppression_guard_skip',\n" +
      "    args: `'wallet=wallet', 'twitter=twitter_handle', 'farcaster=farcaster'`,\n" +
      '  },\n',
    to: '',
  },
  {
    name: 'the quarantine table joins the nightly dump, stretching 30 days into a 90-day artifact',
    file: 'scripts/migrate-grant-readonly.ts',
    from: "  'suppressed_identifiers',\n];\n\nconst GRANTS",
    to: "  'suppressed_identifiers',\n  'suppression_quarantine',\n];\n\nconst GRANTS",
  },
  {
    name: 'the suppression list leaves the dump, so a restore un-removes everyone who asked',
    file: 'scripts/migrate-grant-readonly.ts',
    from: "  'suppressed_identifiers',\n];\n\nconst GRANTS",
    to: '];\n\nconst GRANTS',
  },
  {
    // The refusal is deleted but the logging stays, which is how fail-open
    // usually looks in review: the error is "handled" and the stored payload
    // ships unfiltered anyway.
    name: 'a failed serve-time filter falls through to the stored payload',
    file: 'app/api/v1/jobs/[id]/route.ts',
    from:
      "      console.error('Suppression filter failed on /v1/jobs read:', error);\n" +
      '      return apiError(',
    to:
      "      console.error('Suppression filter failed on /v1/jobs read:', error);\n" +
      '      void apiError(',
  },
  {
    // The free count above the paywall becomes an existence oracle: a
    // nonzero total for a suppressed handle is exactly the confirmation the
    // calibrated-disclosure decision forbids.
    name: 'the reverse count stops asking the suppression list',
    file: 'app/api/reverse/route.ts',
    from: '    handleSuppressed = (await isSuppressed(platform, [handle])).size > 0;',
    to: '    handleSuppressed = false;',
  },

  {
    // 44.5% of the name corpus is expired and still resolving. Without this
    // block the harvest emits pairs for names anybody can buy today.
    name: 'the expiry filter is deleted, so expired names emit pairs again',
    file: 'lib/basenames.ts',
    from:
      '      if (expires <= BigInt(nowSeconds)) {\n' +
      '        drops.expired++;\n' +
      '        return;\n' +
      '      }\n',
    to: '',
  },
  {
    // Fail-open, the shape this repo keeps finding: an expiry that could not
    // be read is treated as an expiry that passed.
    name: 'an unreadable expiry becomes a pass instead of a refusal',
    file: 'lib/basenames.ts',
    from:
      '      if (expires === null) {\n' +
      '        drops.expiryUnreadable++;\n' +
      '        return;\n' +
      '      }\n',
    to: '',
  },
  {
    // The filter still runs, on the wrong name. An owner whose primary name is
    // a different name of theirs gets THAT name's expiry checked, and the
    // guard reports a clean pass over a name nobody owns.
    name: 'the recovered label is no longer hashed back to the node it came from',
    file: 'lib/basenames.ts',
    from: '      if (!name || !match || rawBaseNode(match[1]) !== n.node) {',
    to: '      if (!name || !match) {',
  },
  {
    // Back to repairing free text: `x.com/name` becomes `xcom` and an email
    // becomes a handle belonging to somebody else.
    name: 'the record normaliser stops refusing values that are not handles',
    file: 'lib/basenames.ts',
    from: '  if (!/^[A-Za-z0-9_]{1,15}$/.test(candidate))\n',
    to: '  if (false)\n',
  },
  {
    // A normaliser nothing consults is a pure function with a passing test and
    // no effect on the index.
    name: 'the pipeline stops acting on what the normaliser refused',
    file: 'lib/basenames.ts',
    from:
      '      if (normalisedRecord.handle === null) {\n' +
      "        if (normalisedRecord.reject === 'numeric') drops.handleNumeric++;\n" +
      "        else if (normalisedRecord.reject === 'tooShort') drops.handleTooShort++;\n" +
      "        else if (normalisedRecord.reject === 'reservedPath')\n" +
      '          drops.handleReservedPath++;\n' +
      '        else drops.handleMalformed++;\n' +
      '        onReject?.(raw, normalisedRecord.reject);\n' +
      '        return;\n' +
      '      }\n',
    to: '',
  },
  {
    // The defect the raw-label derivation exists for. `namehash` normalises
    // and this registrar does not, so it silently reads a DIFFERENT
    // registration's expiry: `SemperAltius` and `semperaltius` are two live
    // names with two different expiry dates.
    name: 'the label is hashed with namehash again, so the expiry is read for the wrong registration',
    file: 'lib/basenames.ts',
    from: 'const rawBaseNode = (label: string): string =>\n',
    to:
      'const rawBaseNode = (label: string): string =>\n' +
      '  ethers.namehash(`${label}.base.eth`) ??\n',
  },
  {
    // ~770 wrong pairs, each landing on a real stranger: nine of the ten
    // commonest short values in the corpus are live X accounts.
    name: 'one to three character records are accepted again',
    file: 'lib/basenames.ts',
    from: '  if (candidate.length < MIN_HANDLE_LENGTH)\n',
    to: '  if (false)\n',
  },
  {
    // `x.com/intent/user?screen_name=victim` becomes `@intent`: the right
    // answer discarded and a different real account substituted for it.
    name: 'a link to a page of X is read as a handle again',
    file: 'lib/basenames.ts',
    from: '  if (url && X_RESERVED_PATHS.has(url[1].toLowerCase()))\n',
    to: '  if (false)\n',
  },
  {
    // Relying on the trigger alone is what attaches this source's name to a
    // handle it never attested: the trigger nulls the handle, the CASE arm is
    // not taken, and the ELSE appends the source anyway.
    name: 'the name-record harvest stops filtering suppressed identifiers',
    file: 'lib/basenames.ts',
    from: '    const links = await dropSuppressed(candidateLinks, stats.dropped);',
    to: '    const links = candidateLinks;',
  },
  {
    // 42P18. The same defect that turned the Neynar credit ceiling off for 19
    // days: the checkpoint never advances and every run reports clean.
    name: 'the name-record checkpoint parameter loses its cast',
    file: 'lib/basenames.ts',
    from: "jsonb_build_object('lastBlock', ${lastBlock}::bigint)",
    to: "jsonb_build_object('lastBlock', ${lastBlock})",
  },
  {
    // 20 + 30 + 30 = 80 crosses the 70 trust line on the strength of one owner
    // publishing the same unverified handle in two places.
    name: 'a name record stacks with an ENS record and crosses the trust line',
    file: 'lib/social-graph.ts',
    from:
      "        if (!sources.includes('ens') && !sources.includes('ens_onchain'))\n" +
      '          score += 30;',
    to: '        score += 30;',
  },
  {
    // The class that says a service checked the account, for evidence where
    // nobody checked the handle at all.
    name: 'a name record is published as a service attestation',
    file: 'lib/api-sources.ts',
    from: "  basename_record: 'onchain',",
    to: "  basename_record: 'attested-social',",
  },
  {
    // The inflation review caught: the upstream evidences the ACCOUNT half
    // with a dated ledger and the WALLET half with nothing, so publishing the
    // pair as owner-attested claims a proof nobody has. It would also inflate
    // the published owner-attested share with rows nobody attested.
    name: 'the creator profile is published as owner-attested again',
    file: 'lib/api-sources.ts',
    from: "  zora_profile: 'aggregated',",
    to: "  zora_profile: 'attested-social',",
  },
  {
    // The score half of the same claim: 45 puts it with the attested sources
    // instead of with the other correlated one.
    name: 'the creator profile is scored as an attestation rather than as corroboration',
    file: 'lib/social-graph.ts',
    from: "      case 'zora_profile':\n",
    to: "      case 'zora_profile_moved':\n",
  },

  {
    // The ENS-reverse-name trap, verified live: an address the platform never
    // saw returns a record whose `handle` is a stranger's ENS name. Trusting
    // it writes that stranger into the index as an attested account name.
    name: 'the account gate falls back to the handle field, so a stranger name is read as an identity',
    file: 'lib/zora-profiles.ts',
    from:
      '  const username = asString(profile.username);\n' +
      '  const linkedWallets = profile.linkedWallets;\n' +
      '  if (\n' +
      '    username === null ||\n' +
      '    !isRecord(profile.socialAccounts) ||\n' +
      '    !isRecord(linkedWallets) ||\n' +
      '    !Array.isArray(linkedWallets.edges)\n' +
      '  ) {\n' +
      '    refusals.not_an_account++;\n' +
      '    return empty;\n' +
      '  }\n',
    to:
      '  const username = asString(profile.username) ?? asString(profile.handle);\n' +
      '  const linkedWallets = isRecord(profile.linkedWallets)\n' +
      '    ? profile.linkedWallets\n' +
      '    : { edges: [] };\n',
  },
  {
    // A custodial address the person never chose, asserted to belong to their
    // X account.
    name: 'a platform-provisioned wallet is emitted beside the account',
    file: 'lib/zora-profiles.ts',
    from: "    if (node.walletType !== 'EXTERNAL') continue;\n",
    to: '',
  },
  {
    name: 'a blocked profile is harvested anyway',
    file: 'lib/zora-profiles.ts',
    from: '  if (profile.platformBlocked === true) {',
    to: '  if (false) {',
  },
  {
    name: 'a blocked list row is no longer skipped at enumeration',
    file: 'lib/zora-profiles.ts',
    from:
      '    if (node.platformBlocked === true || creator?.platformBlocked === true) {\n' +
      '      refusals.platform_blocked++;\n' +
      '      continue;\n' +
      '    }\n',
    to: '',
  },
  {
    // The ledger is the whole attestation. Without an entry behind it, an
    // account merely sitting on a profile is an unexplained record.
    name: 'an account with no link event behind it counts as attested',
    file: 'lib/zora-profiles.ts',
    from: '  return latest !== null && latest.linked;',
    to: '  return latest === null || latest.linked;',
  },
  {
    name: 'a malformed username is repaired into a plausible stranger rather than refused',
    file: 'lib/zora-profiles.ts',
    from: '  } else if (!X_HANDLE.test(xUsername)) {',
    to: '  } else if (false) {',
  },
  {
    // Asking a third party about a suppressed address is re-collection whether
    // or not the answer is ever stored.
    name: 'the address walk asks about suppressed addresses and filters afterwards',
    file: 'scripts/harvest-zora-profiles.ts',
    from:
      '      const askable = wallets.filter(\n' +
      "        (w) => !isKindSuppressed(sets, 'wallet', w)\n" +
      '      );',
    to: '      const askable = wallets;',
  },
  {
    // What the Sybil import really did on 2026-08-22: a new attested source
    // that the figure's own list does not name makes the published share fall
    // as the index improves.
    name: 'an attested source is dropped from the published-share list',
    file: 'scripts/check-published-figures.ts',
    from: "'basename_record','owner_attested']",
    to: "'basename_record']",
  },
  {
    // The opposite direction, and the one that matters more now that the two
    // lists have legitimately diverged. Dropping an attested source makes the
    // share fall, which looks like a regression and gets investigated. ADDING
    // a correlated source makes it RISE, which looks like good news while
    // inflating a published claim that the owner attested those rows.
    name: 'a correlated source is counted towards the published owner-attested share',
    file: 'scripts/check-published-figures.ts',
    from: "'basename_record','owner_attested']",
    to: "'basename_record','owner_attested','zora_profile']",
  },
  {
    // The refused platform gets somewhere to land. Nothing else has to change
    // for a Discord identity to start reaching the graph.
    name: 'the shared link shape grows a field for the platform that was refused',
    file: 'lib/attested-links.ts',
    from:
      'export interface AttestedLink {\n' +
      '  wallet: string;\n' +
      '  handle: string;',
    to:
      'export interface AttestedLink {\n' +
      '  wallet: string;\n' +
      '  discord: string | null;\n' +
      '  handle: string;',
  },
  {
    name: 'robots.txt blocks the stylesheet, fonts and JavaScript every page renders with',
    file: 'app/robots.txt/route.ts',
    from: "const ALLOW = ['/api/public-stats', '/_next/static', '/_next/image', '/'];",
    to: "const ALLOW = ['/api/public-stats', '/'];",
  },
  {
    // The state this shipped in for one round of testing. The rules compile
    // into the manifest with the right regex and the right `has`, and never
    // run: a page always answers first, so afterFiles is never consulted.
    name: 'the negotiation rewrites move after the filesystem, where every page beats them',
    file: 'next.config.ts',
    from: '      beforeFiles: [',
    to: '      afterFiles: [',
  },
  {
    // Next anchors a `has` value at both ends, so the bare media type matches
    // only a request whose whole Accept header is those fourteen characters.
    // Fails closed, silently, for every real client.
    name: 'the Accept matcher loses the wildcards that let a real Accept header match',
    file: 'next.config.ts',
    from: "  value: '.*text/markdown.*',",
    to: "  value: 'text/markdown',",
  },
  {
    // /blog/:slug matches /blog/a-post.md with the slug "a-post.md", so
    // without this rule above it the explicit markdown URL 404s for exactly
    // the client careful enough to send both the path and the header.
    name: 'the explicit /blog/<slug>.md rewrite is dropped, leaving the path to the negotiated rule',
    file: 'next.config.ts',
    from: "          source: '/blog/:slug.md',\n",
    to: '',
  },
  {
    name: 'a markdown body is served typed as plain text, which is not negotiation',
    file: 'app/api/markdown/[[...path]]/route.ts',
    from: "      'Content-Type': 'text/markdown; charset=utf-8',\n      Vary: 'Accept',",
    to: "      'Content-Type': 'text/plain; charset=utf-8',\n      Vary: 'Accept',",
  },
  {
    // Without it a shared cache can replay one agent's markdown to the next
    // person who opens the page in a browser.
    name: 'the negotiated response stops declaring that it varies by Accept',
    file: 'app/api/markdown/[[...path]]/route.ts',
    from: "      Vary: 'Accept',\n      Link:",
    to: '      Link:',
  },
  {
    // The HTML report noindexes a placeholder-named collection. A twin that
    // does not is the same page, indexable, at a second representation.
    name: 'the markdown holder report keeps an index invitation the page refuses',
    file: 'app/api/markdown/[[...path]]/route.ts',
    from: '      noindex: !holderReportIsIndexable(collection),\n',
    to: '',
  },
  {
    // `meetsListingFloor` is two conditions, and the count is the
    // non-binding one on any large holder set: at the import cap the rate
    // floor is 100 reachable, not 20. Stating one floor teaches an agent to
    // expect reports that will never appear. Bugbot, PR #353.
    name: 'the holders twin states one listing floor where the rule has two',
    file: 'app/api/markdown/documents.ts',
    from: 'A collection is listed here once it clears both floors: at least ${LISTING_MIN_REACHABLE} reachable holders, and reachable holders at least ${Math.round(LISTING_MIN_RATE * 100)}% of the ones measured. The second is the binding one on any large holder set.',
    to: 'A collection appears here once at least ${LISTING_MIN_REACHABLE} of its holders are reachable.',
  },
  {
    // `lib/blog.ts` fills an unset description with '', not null, so a filter
    // that drops only null publishes `description: ""`: a declared field
    // asserting the post has no description. Bugbot, PR #353.
    name: 'an unset frontmatter field is published as an empty value instead of omitted',
    file: 'app/api/markdown/documents.ts',
    from: '    .filter((entry): entry is [string, string] => Boolean(entry[1]))',
    to: '    .filter((entry): entry is [string, string] => entry[1] !== null)',
  },
  {
    // A rewrite with no branch behind it answers 404 to a client that asked
    // politely for markdown, and nothing else changes.
    name: 'a negotiable path loses the handler branch that answers it',
    file: 'app/api/markdown/[[...path]]/route.ts',
    from: "  if (segments.length === 1 && first === 'pricing') {",
    to: "  if (segments.length === 1 && first === 'prices') {",
  },
  {
    // The homepage Link header is how a client that issues a HEAD, and never
    // receives a body to parse, finds the catalog at all.
    name: 'the homepage stops advertising the catalog in a Link header',
    file: 'next.config.ts',
    from: '              \'</.well-known/api-catalog>; rel="api-catalog"\',\n',
    to: '',
  },
  {
    // RFC 8288 resolves a relative reference against the request URL. Made
    // absolute, a preview deployment hands a discovery client production's
    // catalog: it resolves, it returns 200, it describes another deployment.
    name: 'the catalog link becomes absolute, so a preview advertises production',
    file: 'next.config.ts',
    from: '              \'</.well-known/api-catalog>; rel="api-catalog"\',',
    to: '              \'<https://walletlink.social/.well-known/api-catalog>; rel="api-catalog"\',',
  },
  {
    // RFC 9264 requires a relation's value to be an array "even if there is
    // only one link target object". Written as the object it obviously is,
    // the document still parses, still reads correctly to a person, and is
    // not a linkset.
    name: 'a single link target is written as an object rather than the array the format requires',
    file: 'app/api/api-catalog/route.ts',
    from:
      "      'service-doc': [\n" +
      '        {\n' +
      '          href: `${DOCS_URL}/agent-pack`,\n' +
      "          type: 'text/html',\n" +
      "          title: 'Buying credits with USDC over x402, no account',\n" +
      '        },\n' +
      '      ],',
    to:
      "      'service-doc': {\n" +
      '        href: `${DOCS_URL}/agent-pack`,\n' +
      "        type: 'text/html',\n" +
      "        title: 'Buying credits with USDC over x402, no account',\n" +
      '      },',
  },
  {
    // The media type is the specification. Served as application/json it is
    // a JSON document that happens to look like a catalog, and nothing
    // discovering it is obliged to treat it as one.
    name: 'the catalog loses the linkset media type and the RFC 9727 profile',
    file: 'app/api/api-catalog/route.ts',
    from: '    \'Content-Type\': `application/linkset+json; profile="${CATALOG_PROFILE}"`,',
    to: "    'Content-Type': 'application/json',",
  },
  {
    // A SHALL in section 2. Next derives HEAD from GET on its own, so
    // deleting the export leaves it working today and resting on a framework
    // behavior that is not in the documentation.
    name: 'the explicit HEAD handler the RFC requires is deleted as redundant',
    file: 'app/api/api-catalog/route.ts',
    from:
      'export function HEAD(): Response {\n' +
      '  return new Response(null, { headers: catalogHeaders() });\n' +
      '}\n',
    to: '',
  },
  {
    // Nothing errors: /api/api-catalog keeps answering, and the well-known
    // URI every client actually requests starts 404ing.
    name: 'the catalog stops being reachable at the well-known URI',
    file: 'next.config.ts',
    from:
      '        {\n' +
      "          source: '/.well-known/api-catalog',\n" +
      "          destination: '/api/api-catalog',\n" +
      '        },\n',
    to: '',
  },
  {
    name: 'the pages stop pointing at the catalog, leaving it to be guessed',
    file: 'app/layout.tsx',
    from: '        <link rel="api-catalog" href="/.well-known/api-catalog" />\n',
    to: '',
  },
  {
    // A typo in a hand-written URL sends a discovery client to an origin
    // this project does not control, and the document still validates.
    name: 'a catalog href points at a host the project does not own',
    file: 'app/api/api-catalog/route.ts',
    from: '          href: `${DOCS_URL}/openapi.yaml`,',
    to: "          href: 'https://docs.walletlink.example/openapi.yaml',",
  },
  {
    // Relative references resolve against whichever origin the client
    // fetched the document from, which is the same class of defect as
    // publishing a URL that redirects.
    name: 'a catalog href becomes a relative reference',
    file: 'app/api/api-catalog/route.ts',
    from: '          href: `${PRODUCTION_URL}/skill.md`,',
    to: "          href: '/skill.md',",
  },
  {
    // Paragraph (c) of the policy makes deletion the dangerous edit: an
    // omitted signal is a refusal to answer, not a quiet no, so this reads
    // as tidying and is a withdrawal.
    name: 'a content signal is deleted rather than answered, which withdraws the preference',
    file: 'app/robots.txt/route.ts',
    from: "const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=yes';",
    to: "const CONTENT_SIGNAL = 'search=yes, ai-input=yes';",
  },
  {
    // Cloudflare's own robots.txt makes exactly this mistake. The line still
    // appears in the file and still reads correctly; it is simply scoped to
    // nothing, or to whichever group happens to precede it.
    name: 'the content signal is emitted outside the group, so it scopes to no crawler',
    file: 'app/robots.txt/route.ts',
    from: "    'User-Agent: *',\n    `Content-Signal: ${CONTENT_SIGNAL}`,\n",
    to: "    'User-Agent: *',\n",
  },
  {
    // Without the definition the signal is a token nobody has agreed a
    // meaning for, and the Article 4 reservation, the only part with legal
    // weight, is gone. A paraphrase looks like an improvement.
    name: 'the content signals policy is paraphrased, dropping the Article 4 reservation',
    file: 'app/robots.txt/route.ts',
    from: '# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790 ON COPYRIGHT AND RELATED RIGHTS IN THE DIGITAL SINGLE MARKET.',
    to: '# Restrictions expressed above are a reservation of rights.',
  },
  {
    name: 'a source that reported no total has its zero published as a holder count',
    file: 'lib/holder-pages.ts',
    from:
      '  const total =\n' +
      '    collection.totalHolders !== null && collection.totalHolders > 0\n' +
      '      ? collection.totalHolders\n' +
      '      : null;',
    to: '  const total = collection.totalHolders;',
  },
  {
    name: 'a run that hit the import cap is described as a complete holder set',
    file: 'lib/holder-pages.ts',
    from: "  if (measured >= HOLDER_IMPORT_CAP) return { kind: 'capped', measured };",
    to: '',
  },
  {
    name: 'the holder page compares the two counts itself again, so prose and Dataset can drift',
    file: 'app/holders/[chain]/[address]/page.tsx',
    from:
      '  const totalHoldersIsKnown =\n' +
      "    basis.kind === 'sample' || basis.kind === 'complete';",
    to:
      '  const totalHoldersIsKnown =\n' +
      '    collection.totalHolders !== null &&\n' +
      '    collection.totalHolders > collection.holdersImported;',
  },

  {
    // The defect corrected on 2026-09-07, put back exactly. Three numbers were
    // in public circulation while the server answered eight to anyone who
    // asked it, with no credential.
    name: 'a comparison page undercounts the MCP tools again',
    file: 'app/vs/formo/page.tsx',
    from: '(eight tools, on every pack and the free allowance)',
    to: '(seven tools, on every pack and the free allowance)',
  },
  {
    // Proves the count is DERIVED. A guard holding a hardcoded 8 passes this,
    // because every copy surface still says eight while the server registers
    // seven: the tool is renamed out of the `walletlink_` namespace and stays
    // valid TypeScript.
    name: 'a tool leaves the namespace the published count is derived from',
    file: 'app/api/mcp/route.ts',
    from: "      'walletlink_account_balance',\n",
    to: "      'account_balance',\n",
  },
  {
    // The other half, and the one a stale-number check cannot catch on its
    // own: a surface stops stating the count at all. Nothing then disagrees
    // with anything, the assertion above passes over it, and that surface is
    // silently outside the guard from that day on.
    name: 'a surface stops stating the tool count, leaving nothing to be stale',
    file: 'components/ApiKeysModal.tsx',
    from: 'eight tools over the same balance.',
    to: 'tools over the same balance.',
  },

  {
    // Exactly how the fabricated dates shipped the first time, removed on
    // 2026-08-22 (CHANGELOG.md:2523): every crawler was told all 29 posts had
    // been edited today, on every request.
    name: 'the blog modification date goes back to being read from the clock',
    file: 'app/blog/[slug]/page.tsx',
    from: '    ...(post.updatedAt ? { dateModified: post.updatedAt } : {}),\n',
    to: '    dateModified: new Date().toISOString(),\n',
  },
  {
    // The value check passes over a page carrying no dates at all, so a
    // deletion has to fail separately or the structured data can quietly lose
    // the field that stops it contradicting the prose.
    name: 'a comparison page loses its publication date entirely',
    file: 'app/vs/formo/page.tsx',
    from: "  datePublished: '2026-08-22',\n",
    to: '',
  },

  {
    // The defect itself: the listing that feeds the hub, the sitemap and
    // generateStaticParams filtering on NULL alone, which published two
    // reports titled "Unknown Token holders on ...".
    name: 'the holder listing goes back to filtering on NULL alone',
    file: 'lib/holder-pages.ts',
    from: 'WHERE sc.holders_imported > 0 AND ${namedContract}',
    to: 'WHERE sc.holders_imported > 0',
  },
  {
    // The same defect one level down, where every filter in the file keeps its
    // shape: the predicate both queries call stops refusing the placeholder.
    name: 'the shared name rule decays to a NULL check',
    file: 'lib/holder-pages.ts',
    from: '  return Boolean(name && !PLACEHOLDER_NAME.test(name));',
    to: '  return Boolean(name);',
  },
  {
    // Dropping a page from the listing does not deindex it: it stays live at
    // its own URL, and a URL already submitted in a sitemap does not leave the
    // index by being withdrawn from one.
    name: 'a placeholder-named report loses the noindex that keeps it out of the index',
    file: 'app/holders/[chain]/[address]/page.tsx',
    from: '    ...(isNamed(collection.name) ? {} : { robots: { index: false } }),\n',
    to: '',
  },
  {
    // The form that reads correctly and is not. `robots: undefined` is a
    // present key, and Next merges metadata key by key, so it overrides the
    // ancestor rather than inheriting from it. This shipped once and stripped
    // the directive from all 123 named reports while looking right.
    name: 'the noindex becomes a conditional value, which strips inheritance from the named reports',
    file: 'app/holders/[chain]/[address]/page.tsx',
    from: '    ...(isNamed(collection.name) ? {} : { robots: { index: false } }),',
    to: '    robots: isNamed(collection.name) ? undefined : { index: false },',
  },
  {
    // The defect Bugbot caught on 2026-09-07, put back exactly. It read
    // correctly in the visible sentence, which passes an empty suffix, and
    // garbled the Dataset node, which is what a machine reads.
    name: 'a trailing clause follows the collection suffix and garbles the Dataset phrase',
    file: 'lib/holder-pages.ts',
    from: '      return `the ${n} ${subject.measuredNoun}${subject.ofCollection}`;',
    to: '      return `the ${n} ${subject.measuredNoun}${subject.ofCollection} the index imported`;',
  },
  // --- STA-39 C: who pays for MCP discovery ------------------------------
  {
    name: 'credentialed discovery keys on the shared egress address again',
    file: 'lib/mcp-gate.ts',
    from: '      subject: `user:${cred.userId}`,',
    to: '      subject: ip,',
  },
  {
    name: 'any credential string buys an account bucket',
    file: 'app/api/mcp/route.ts',
    from: "  return key ? { kind: 'account', userId: key.userId } : { kind: 'unverified' };",
    to: "  return { kind: 'account', userId: key?.userId ?? bearer };",
  },
  {
    name: 'an account gets less discovery headroom than a stranger',
    file: 'lib/ip-rate-limiter.ts',
    from: "  '/api/mcp:account': { limit: 600, windowHours: 1 },",
    to: "  '/api/mcp:account': { limit: 60, windowHours: 1 },",
  },
  {
    name: 'a dead access token is challenged on tool calls only again, the audited defect',
    file: 'lib/mcp-gate.ts',
    from: "  if (cred.kind === 'dead-token') {",
    to: "  if (cred.kind === 'dead-token' && body !== undefined && callsATool(body)) {",
  },
  {
    name: 'a mistyped key on a tool call is answered with a consent screen',
    file: 'lib/mcp-gate.ts',
    from: "  if (body !== undefined && callsATool(body) && cred.kind === 'none') {",
    to: "  if (body !== undefined && callsATool(body) && cred.kind !== 'account') {",
  },
  {
    name: 'a connected account is told to configure an API key again',
    file: 'lib/mcp-gate.ts',
    from: '  return `This account sent more than ${limit} connection and listing requests in the last hour. Tool calls are not counted. Try again after the time in Retry-After.`;',
    to: '  return `Too many requests (${limit}). Configure a walletlink.social API key, or try again later.`;',
  },
  {
    name: 'every caller gets the anonymous refusal text',
    file: 'lib/mcp-gate.ts',
    from: "  if (cred.kind === 'account') return accountDiscoveryLimited(limits.account);\n",
    to: '',
  },
  {
    name: 'the MCP bucket is keyed on the raw bearer string',
    file: 'app/api/mcp/route.ts',
    from: '    const limit = await checkIpRateLimit(decision.subject, decision.endpoint);',
    to: '    const limit = await checkIpRateLimit(\n      bearerFrom(request) ?? decision.subject,\n      decision.endpoint\n    );',
  },
  {
    name: 'a dead access token on GET or DELETE is read as no credential, credential read moved into the POST branch',
    file: 'app/api/mcp/route.ts',
    from: '  const cred = await credentialFor(bearerFrom(request), body);\n',
    to: "  const cred: McpCredential =\n    request.method === 'POST'\n      ? await credentialFor(bearerFrom(request), body)\n      : { kind: 'none' };\n",
  },
  {
    name: 'a dead access token on GET or DELETE is treated as no credential',
    file: 'app/api/mcp/route.ts',
    from: "  if (!bearer) return { kind: 'none' };",
    to: "  if (!bearer || body === undefined) return { kind: 'none' };",
  },
  {
    name: 'the route drops the challenge for a request with no body',
    file: 'app/api/mcp/route.ts',
    from: "  if (decision.action === 'challenge') {",
    to: "  if (decision.action === 'challenge' && body !== undefined) {",
  },
  {
    name: 'an access token names its own row, so the account bucket resets on every refresh',
    file: 'lib/oauth/grants.ts',
    from: '      userId: apiKeys.userId,',
    to: '      userId: apiKeys.id,',
  },
  {
    name: 'an API key names its own row, so each key multiplies the account bucket',
    file: 'lib/api-keys.ts',
    from: '  return found ? { keyId: found.key.id, userId: found.key.userId } : null;',
    to: '  return found ? { keyId: found.key.id, userId: found.key.id } : null;',
  },
  {
    name: 'the MCP page publishes an account limit the limiter does not enforce',
    file: 'docs-site/mcp-server.mdx',
    from: '  limit is 600 requests an hour per account. Every key and connection on the',
    to: '  limit is 1,000 requests an hour per account. Every key and connection on the',
  },
  // --- STA-40: the self-declared flag -------------------------------------
  {
    name: 'a mixed row is flagged self-declared, though another source may have supplied the handle',
    file: 'lib/api-sources.ts',
    from: 'list.every((s) => SELF_DECLARED_SOURCE_IDS.has(s))',
    to: 'list.some((s) => SELF_DECLARED_SOURCE_IDS.has(s))',
  },
  {
    name: 'the negative marker counts as a source, so no self-declared row is ever flagged',
    file: 'lib/api-sources.ts',
    from: "asSourceList(sources).filter((s) => s !== 'none');",
    to: 'asSourceList(sources);',
  },
  {
    name: 'a governance profile handle is treated as checked by the account',
    file: 'lib/api-sources.ts',
    from: "  'snapshot_profile',\n  'lens_profile',\n]);",
    to: "  'lens_profile',\n]);",
  },
  {
    name: 'the X field serves self_declared: false, which reads as confirmed',
    file: 'lib/handle-reachability.ts',
    from: '  if (input.selfDeclared) field.self_declared = true;',
    to: '  field.self_declared = !!input.selfDeclared;',
  },
  {
    name: 'the single lookup never flags a self-declared handle',
    file: 'app/api/v1/wallet/[address]/route.ts',
    from: 'selfDeclared: isSelfDeclared(result.sources),',
    to: 'selfDeclared: false,',
  },
  {
    name: 'the jobs route never flags a self-declared handle',
    file: 'app/api/v1/jobs/[id]/route.ts',
    from: 'selfDeclared: selfDeclared.has(r.wallet.toLowerCase()),',
    to: 'selfDeclared: false,',
  },
  {
    name: 'the jobs read flags a handle from a graph row about a different handle',
    file: 'lib/handle-reachability.ts',
    from: '      if (!served || row.twitter_handle.toLowerCase() !== served) continue;\n',
    to: '      if (!served) continue;\n',
  },
  {
    name: 'the MCP trim drops self_declared, so an agent never sees it',
    file: 'app/api/mcp/route.ts',
    from: '    if (twitter.self_declared === true) x.self_declared = true;\n',
    to: '',
  },
  // --- STA-39 D: the metadata fetch, spent-token cleanup, registration grants ---
  {
    name: 'the metadata request drops its pinned lookup, so the socket resolves the host on its own',
    file: 'lib/oauth/clients.ts',
    from: '        lookup: pinnedLookup(resolve),\n',
    to: '',
  },
  {
    name: 'a lookup answer is refused only when every address in it is private',
    file: 'lib/oauth/clients.ts',
    from: '        if (answer.some((a) => isPrivateAddress(a.address, a.family))) {',
    to: '        if (answer.every((a) => isPrivateAddress(a.address, a.family))) {',
  },
  {
    name: 'the connected peer is no longer checked',
    file: 'lib/oauth/clients.ts',
    from: '        if (isPrivateAddress(remote, isIP(remote))) {',
    to: '        if (false) {',
  },
  {
    name: 'the byte cap is not enforced as the body arrives',
    file: 'lib/oauth/clients.ts',
    from: '    if (received > maxBytes) {',
    to: '    if (false) {',
  },
  {
    name: 'a declared length over the cap is read anyway',
    file: 'lib/oauth/clients.ts',
    from: "  if (Number(res.headers['content-length']) > maxBytes) {",
    to: '  if (false) {',
  },
  {
    name: 'a body with a content-encoding is accepted',
    file: 'lib/oauth/clients.ts',
    from: "  if (encoding !== undefined && encoding.trim().toLowerCase() !== 'identity') {",
    to: '  if (false) {',
  },
  {
    name: 'the deadline stops at the headers, so a body that never ends holds the function',
    file: 'lib/oauth/clients.ts',
    from: "    req.on('response', (res: IncomingMessage) =>\n      readDocument(res, maxBytes, finish)\n    );",
    to: "    req.on('response', (res: IncomingMessage) => {\n      clearTimeout(deadline);\n      readDocument(res, maxBytes, finish);\n    });",
  },
  {
    name: 'link-local narrows to fe80::/16, so the rest of fe80::/10 passes',
    file: 'lib/oauth/clients.ts',
    from: "  ['fe80::', 10],",
    to: "  ['fe80::', 16],",
  },
  {
    name: 'the two address lists are merged, so the mapped-IPv4 rule refuses every IPv4 address, claude.ai included',
    file: 'lib/oauth/clients.ts',
    from: "    if (family === 4) return NON_PUBLIC_V4.check(address, 'ipv4');",
    to: "    if (family === 4)\n      return (\n        NON_PUBLIC_V4.check(address, 'ipv4') ||\n        NON_PUBLIC_V6.check(address, 'ipv4')\n      );",
  },
  {
    name: 'a client_id URL over plain http is fetched',
    file: 'lib/oauth/clients.ts',
    from: "  if (url.protocol !== 'https:') return 'a client_id URL must be https';",
    to: "  if (false) return 'a client_id URL must be https';",
  },
  {
    name: 'a client_id URL carrying credentials is fetched',
    file: 'lib/oauth/clients.ts',
    from: '  if (url.username || url.password) {',
    to: '  if (false) {',
  },
  {
    name: 'a client_id URL carrying a fragment is fetched',
    file: 'lib/oauth/clients.ts',
    from: "  if (url.hash || id.includes('#')) {",
    to: '  if (false) {',
  },
  {
    name: 'a client_id URL naming an IP address is fetched, with no resolution for the checks to attach to',
    file: 'lib/oauth/clients.ts',
    from: "  if (isIP(url.hostname.replace(/^\\[|\\]$/g, '')) !== 0) {",
    to: '  if (false) {',
  },
  {
    name: 'a client_id URL not in canonical form is fetched',
    file: 'lib/oauth/clients.ts',
    from: '  if (url.href !== id) {',
    to: '  if (false) {',
  },
  {
    name: 'the authorize page shows an error’s own text again',
    file: 'app/oauth/authorize/page.tsx',
    from: '        ? error.publicMessage\n',
    to: '        ? error.message\n',
  },
  {
    name: 'a refused registration is told about client_credentials whatever it asked for',
    file: 'lib/oauth/clients.ts',
    from: '      description: `grant_types must include authorization_code. This server issues tokens only through the authorization code flow with PKCE, renewed with refresh_token${without}${consent}.`,',
    to: "      description: `Unsupported grant_types: ${unsupported.join(', ')}. This server issues authorization codes only; there is no client_credentials grant, because every connection needs a person to consent to it.`,",
  },
  {
    name: 'a registration naming one grant this server does not issue is refused whole again',
    file: 'lib/oauth/clients.ts',
    from: "  if (!registered.includes('authorization_code')) {",
    to: "  if (unsupported.length > 0 || !registered.includes('authorization_code')) {",
  },
  {
    name: 'the metadata advertises a grant that registration does not keep',
    file: 'lib/oauth/metadata.ts',
    from: '    grant_types_supported: [...GRANT_TYPES_SUPPORTED],',
    to: "    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],",
  },
  {
    name: 'the token cleanup loses its grant fence',
    file: 'app/api/cron/cleanup/route.ts',
    from: '        WHERE oauth_grant_id IS NOT NULL\n          AND starts_with',
    to: '        WHERE starts_with',
  },
  {
    name: 'the token cleanup loses its prefix fence',
    file: 'app/api/cron/cleanup/route.ts',
    from: '\n          AND starts_with(key_prefix, ${ACCESS_TOKEN_PREFIX})',
    to: '',
  },
  {
    name: 'a spent token is aged from when it was made',
    file: 'app/api/cron/cleanup/route.ts',
    from: '          AND LEAST(expires_at, revoked_at) < now()',
    to: '          AND created_at < now()',
  },
  {
    name: 'the token retention falls below the admin window and the month',
    file: 'app/api/cron/cleanup/route.ts',
    from: 'export const OAUTH_TOKEN_RETENTION_DAYS = 400;',
    to: 'export const OAUTH_TOKEN_RETENTION_DAYS = 30;',
  },
  {
    name: 'the privacy policy restates the token period as a digit',
    file: 'app/privacy/page.tsx',
    from: '`Deleted ${OAUTH_TOKEN_RETENTION_DAYS} days after',
    to: '`Deleted 400 days after',
  },
  // --- STA-39 D review: the dropped request and every range edge ---------
  {
    name: 'a refused metadata request is rejected but never dropped, so the socket goes on to the peer',
    file: 'lib/oauth/clients.ts',
    from: '        req?.destroy();\n',
    to: '',
  },
  {
    name: 'the documentation range 203.0.113.0/24 is dropped from the refused list',
    file: 'lib/oauth/clients.ts',
    from: "  ['203.0.113.0', 24],\n",
    to: '',
  },
  {
    name: 'the private 10/8 block is narrowed to 10.0.0.0/16',
    file: 'lib/oauth/clients.ts',
    from: "  ['10.0.0.0', 8],",
    to: "  ['10.0.0.0', 16],",
  },
  {
    name: 'the local-use NAT64 prefix is dropped from the refused list',
    file: 'lib/oauth/clients.ts',
    from: "  ['64:ff9b:1::', 48],\n",
    to: '',
  },
  {
    name: 'the unique-local block is widened to fc00::/6, refusing public space',
    file: 'lib/oauth/clients.ts',
    from: "  ['fc00::', 7],",
    to: "  ['fc00::', 6],",
  },
  {
    name: 'a pass whose charge threw writes its null gate over a real one, reopening every locked match in history',
    file: 'lib/history.ts',
    from: 'excluded.matches_delivered IS NOT NULL AND lookup_history.matches_delivered',
    to: 'lookup_history.matches_delivered',
  },
  {
    name: 'the history save drops its fence, so a holder that lost the job still saves a linked copy (Bugbot, #393)',
    file: 'lib/history.ts',
    from: "\nWHERE EXISTS (SELECT 1 FROM lookup_jobs WHERE id = ${values.jobId}::uuid AND lease_token = ${leaseToken}::uuid AND status = 'processing' FOR SHARE)",
    to: '',
  },
  {
    name: 'the history fence does not lock the job row, so a save racing the admin reset lands after the detach',
    file: 'lib/history.ts',
    from: "status = 'processing' FOR SHARE)",
    to: "status = 'processing')",
  },
  {
    name: 'the history fence ignores the token, so any running attempt of the job can save',
    file: 'lib/history.ts',
    from: 'AND lease_token = ${leaseToken}::uuid ',
    to: '',
  },
  {
    name: 'a fenced save that wrote nothing is taken as agreement, so a holder that lost the job carries on',
    file: 'lib/history.ts',
    from: '  if (!held) throw new LeaseLostError(gate.jobId);\n',
    to: '',
  },
  {
    name: 'the worker logs a lost lease from the history save and carries on',
    file: 'lib/job-processor.ts',
    from: '      if (error instanceof LeaseLostError) throw error;\n',
    to: '',
  },
  {
    name: 'the admin detaches history before the reset, leaving a gap for a stale save to land linked',
    file: 'app/api/admin/jobs/route.ts',
    from: "      // Reset failed or completed job to pending to reprocess\n      const [updated] = await db\n        .update(lookupJobs)\n        .set({\n          status: 'pending',\n          errorMessage: null,\n          processedCount: 0,\n          currentStage: null,\n          partialResults: null,\n          twitterFound: 0,\n          farcasterFound: 0,\n          anySocialFound: 0,\n          cacheHits: 0,\n          startedAt: null,\n          completedAt: null,\n          updatedAt: new Date(),\n          options: updatedOptions,\n          // A clean start for the worker's claim (lib/job-processor.ts): no\n          // kills carried over from the run being retried, which would fail\n          // it at the first claim, and no lease or token. A NULL lease on a\n          // pending row is claimable at once, and a holder still running the\n          // old attempt is fenced out, since the row is no longer its token's.\n          sliceAttempts: 0,\n          leasedUntil: null,\n          leaseToken: null,\n        })\n        .where(eq(lookupJobs.id, id))\n        .returning();\n\n      if (!updated) {\n        return NextResponse.json({ error: 'Job not found' }, { status: 404 });\n      }\n\n      /**\n       * The previous run's saved lookup is detached from the job, so the\n       * rerun saves a fresh one. `lookup_history.job_id` is unique and a\n       * job's save only corrects the gate on a conflict, so without this the\n       * rerun's results would never reach the customer's saved lookups.\n       *\n       * AFTER the reset, not before. A holder still running the old attempt\n       * saves history in one statement fenced on its token, and that fence\n       * locks the job row FOR SHARE until the insert commits, so the reset\n       * above waited for any such save, and every later one finds the token\n       * gone and inserts nothing. Detaching now therefore catches every row\n       * the old attempt could write. Detaching first left a gap: a save\n       * landing between the detach and the reset still passed the fence and\n       * stayed linked (Bugbot on #393).\n       *\n       * The old copy stays as it was, results and gate. Once detached, an\n       * unlock of this job (`clearLookupGate`, keyed on job_id) reaches only\n       * the rerun's copy; a gated old copy keeps its lock.\n       */\n      await db\n        .update(lookupHistory)\n        .set({ jobId: null })\n        .where(eq(lookupHistory.jobId, id));\n",
    to: "      await db\n        .update(lookupHistory)\n        .set({ jobId: null })\n        .where(eq(lookupHistory.jobId, id));\n\n      // Reset failed or completed job to pending to reprocess\n      const [updated] = await db\n        .update(lookupJobs)\n        .set({\n          status: 'pending',\n          errorMessage: null,\n          processedCount: 0,\n          currentStage: null,\n          partialResults: null,\n          twitterFound: 0,\n          farcasterFound: 0,\n          anySocialFound: 0,\n          cacheHits: 0,\n          startedAt: null,\n          completedAt: null,\n          updatedAt: new Date(),\n          options: updatedOptions,\n          // A clean start for the worker's claim (lib/job-processor.ts): no\n          // kills carried over from the run being retried, which would fail\n          // it at the first claim, and no lease or token. A NULL lease on a\n          // pending row is claimable at once, and a holder still running the\n          // old attempt is fenced out, since the row is no longer its token's.\n          sliceAttempts: 0,\n          leasedUntil: null,\n          leaseToken: null,\n        })\n        .where(eq(lookupJobs.id, id))\n        .returning();\n\n      if (!updated) {\n        return NextResponse.json({ error: 'Job not found' }, { status: 404 });\n      }\n\n",
  },
  {
    // Bugbot on #393: the restart lived only in memory, so the cap read the
    // Inngest-shaped row (a full count, no rows) as saved and let it through.
    name: 'a restart is not written down, so the cap reads a full count with no rows as saved and retries it without bound',
    file: 'lib/job-processor.ts',
    from: '    if (job !== claimed) {\n      await writeOwned(db, job, {\n        processedCount: 0,',
    to: '    if (job !== claimed && false) {\n      await writeOwned(db, job, {\n        processedCount: 0,',
  },
  // ------------- STA-46: a removal reaches retry copies and the claim record
  {
    name: 'STA-46 a replay serves the stored body unfiltered again',
    file: 'app/api/v1/batch/route.ts',
    from: '      return NextResponse.json(replayed, {',
    to: '      return NextResponse.json(prior.response, {',
  },
  {
    name: 'STA-46 an unreadable suppression list lets the replay through unfiltered',
    file: 'app/api/v1/batch/route.ts',
    from:
      "        console.error('Suppression check failed on /v1/batch replay:', error);\n" +
      '        return apiError(',
    to:
      "        console.error('Suppression check failed on /v1/batch replay:', error);\n" +
      '        replaySuppression = new Map();\n' +
      '      }\n' +
      '      if (!replaySuppression) {\n' +
      '        return apiError(',
  },
  {
    name: 'STA-46 the removal deletes the retry copy, so the retry bills again',
    file: 'lib/removal-admin.ts',
    from:
      '        UPDATE idempotency_keys\n' +
      '        SET response = ${JSON.stringify(scrubbed)}::jsonb\n' +
      '        WHERE key_id = ${row.key_id}',
    to: '        DELETE FROM idempotency_keys\n        WHERE key_id = ${row.key_id}',
  },
  {
    name: 'STA-46 the rewrite loses its condition and can put back an older body',
    file: 'lib/removal-admin.ts',
    from: '          AND md5(response::text) = ${row.digest}\n',
    to: '',
  },
  {
    name: 'STA-46 the erase stops reaching the retry copies',
    file: 'lib/removal-admin.ts',
    from: '  const retryRows = await amendRetryCopies(db, kind, identifier);',
    to: '  const retryRows = 0;',
  },
  {
    name: 'STA-46 a lost write race is reported clean instead of re-read',
    file: 'lib/removal-admin.ts',
    from: '      row = again.rows[0];',
    to: '      row = undefined;',
  },
  {
    name: 'STA-46 a driver returning jsonb as text turns the amend into a silent no-op',
    file: 'lib/removal-admin.ts',
    from: "    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;",
    to: '    value;',
  },
  {
    name: 'STA-46 the candidate read turns case-sensitive and misses a mixed-case handle',
    file: 'lib/removal-admin.ts',
    from: '      AND strpos(lower(response::text), ${needle}) > 0',
    to: '      AND strpos(response::text, ${needle}) > 0',
  },
  {
    name: "STA-46 a removed wallet's checked stamp survives the replay",
    file: 'lib/idempotency.ts',
    from: "      ([wallet]) => !isKindSuppressed(sets, 'wallet', wallet)",
    to: '      () => true',
  },
  {
    name: 'STA-46 the replayed counts keep what the original held',
    file: 'lib/idempotency.ts',
    from:
      '      matched: data.filter(\n' +
      '        (entry) => isRecord(entry) && (entry.twitter || entry.farcaster)\n' +
      '      ).length,\n',
    to: '',
  },
  {
    name: 'STA-46 a replayed row left with no identity keeps its wallet',
    file: 'lib/idempotency.ts',
    from: '    return hasSocials ? next : null;',
    to: '    return next;',
  },
  {
    name: 'STA-46 a removed second X handle rides back in on the replay',
    file: 'lib/idempotency.ts',
    from: "        isKindSuppressed(sets, 'twitter', entry.twitter.also.handle)",
    to: '        false',
  },
  {
    name: 'STA-46 the claim is withdrawn before the amends, so a failed amend strands the signed retry',
    file: 'lib/removal-admin.ts',
    from: '  const historyRows = await amendSavedCopies(\n',
    to:
      "  if (kind === 'wallet' || kind === 'twitter') {\n" +
      '    await withdrawClaimRecords(db, kind, identifier);\n' +
      '  }\n' +
      '  const historyRows = await amendSavedCopies(\n',
  },
  {
    name: 'STA-46 an emailed removal leaves the claim record naming the pair (the gap as it was)',
    file: 'lib/removal-admin.ts',
    from: '    const claims = await withdrawClaimRecords(db, kind, identifier);',
    to: '    const claims = { withdrawn: 0, quarantined: 0 };',
  },
  {
    name: 'STA-46 an X handle removal no longer reaches the claim record',
    file: 'lib/removal-admin.ts',
    from:
      "  if (kind === 'wallet' || kind === 'twitter') {\n" +
      '    const claims = await withdrawClaimRecords(db, kind, identifier);',
    to:
      "  if (kind === 'wallet') {\n" +
      '    const claims = await withdrawClaimRecords(db, kind, identifier);',
  },
  {
    name: 'STA-46 the claim withdrawal clears the grant key, so the grant can be farmed',
    file: 'lib/removal-admin.ts',
    from:
      "      SET status        = 'withdrawn',\n" +
      '          x_user_id     = NULL,\n',
    to:
      "      SET status        = 'withdrawn',\n" +
      '          x_user_id_hmac = NULL,\n' +
      '          x_user_id     = NULL,\n',
  },
  {
    name: 'STA-46 a pending claim survives the removal and can complete after it',
    file: 'lib/removal-admin.ts',
    from:
      '      WHERE ${match}\n' +
      "        AND t.status IN ('completed', 'awaiting_x')",
    to: '      WHERE ${match}\n' + "        AND t.status = 'completed'",
  },
  {
    name: "STA-46 a pending claim's authorization is kept in quarantine",
    file: 'lib/removal-admin.ts',
    from: "      FROM snap\n      WHERE snap.status = 'completed'\n",
    to: '      FROM snap\n',
  },
  {
    name: 'STA-46 un-suppress restores a claim a sibling suppression still covers',
    file: 'lib/removal-admin.ts',
    from:
      "               OR (x.kind = 'twitter'\n" +
      "                   AND x.identifier = lower(s.row_data ->> 'x_handle'))\n",
    to: '',
  },
  {
    name: 'STA-46 the claim withdrawal loses its join and withdraws every claim in the table',
    file: 'lib/removal-admin.ts',
    from: '      FROM snap\n      WHERE g.id = snap.id\n      RETURNING g.id\n',
    to: '      FROM snap\n      RETURNING g.id\n',
  },
  {
    name: 'STA-46 the claim withdrawal clears only pending rows, so a completed claim keeps naming the pair',
    file: 'lib/removal-admin.ts',
    from: '      WHERE g.id = snap.id\n',
    to: "      WHERE g.id = snap.id AND snap.status = 'awaiting_x'\n",
  },
  {
    name: 'STA-46 a refused claim restore deletes the only quarantine copy',
    file: 'lib/removal-admin.ts',
    from: "        AND (src.row_data ->> 'id')::uuid IN (SELECT id FROM upd)\n",
    to: '',
  },
  {
    name: 'STA-46 a restored claim comes back completed with no handle',
    file: 'lib/removal-admin.ts',
    from: "            x_handle   = s.row_data ->> 'x_handle',\n",
    to: '',
  },
  {
    name: 'STA-46 un-suppressing an X handle never restores its claim',
    file: 'lib/removal-admin.ts',
    from:
      "  if (kind === 'wallet' || kind === 'twitter') {\n" +
      '    const res = (await db.execute(sql`\n' +
      '      WITH src AS (',
    to:
      "  if (kind === 'wallet') {\n" +
      '    const res = (await db.execute(sql`\n' +
      '      WITH src AS (',
  },
  {
    name: 'STA-46 a removed wallet whose only trace is its checked stamp keeps it (the body counts as unchanged)',
    file: 'lib/idempotency.ts',
    from: '    if (kept.length !== checked.length) {\n      touched = true;\n',
    to: '    if (kept.length !== checked.length) {\n',
  },
  {
    name: 'STA-46 a claim pending across a handle removal completes with that handle',
    file: 'lib/claim-callback.ts',
    from: "    const hits = await isSuppressed('twitter', [handle]);",
    to: '    const hits = new Set<string>();',
  },
  {
    name: 'STA-46 a failed handle suppression read lets the claim complete',
    file: 'lib/claim-callback.ts',
    from:
      "    console.error('claim handle suppression read failed; refusing:', error);\n" +
      "    return back('unavailable', claim.id);",
    to: "    console.error('claim handle suppression read failed; refusing:', error);",
  },
  // --- STA-45: retention the privacy page states, and identifiers in logs ---
  {
    name: 'the month bucket is aged by created_at again, so the cleanup resets a month’s quota a few days in',
    file: 'lib/rate-limiter.ts',
    from: '    OR (${r}.bucket_type = \'month\' AND ${r}.bucket_key COLLATE "C" < ${keys.month})',
    to: "    OR (${r}.bucket_type = 'month' AND ${r}.created_at < now() - make_interval(days => 2))",
  },
  {
    name: 'the month cutoff is read at now, so last month’s bucket goes the moment the month ends',
    file: 'lib/rate-limiter.ts',
    from: "    month: getBucketKey('month', cutoff),",
    to: "    month: getBucketKey('month', now),",
  },
  {
    name: 'the day comparison becomes <=, so a day’s bucket goes before two days have passed',
    file: 'lib/rate-limiter.ts',
    from: '(${r}.bucket_type = \'day\' AND ${r}.bucket_key COLLATE "C" < ${keys.day})',
    to: '(${r}.bucket_type = \'day\' AND ${r}.bucket_key COLLATE "C" <= ${keys.day})',
  },
  {
    name: 'the cleanup stops calling cleanupOldBuckets, so API buckets are kept forever',
    file: 'app/api/cron/cleanup/route.ts',
    from: '    apiBuckets = await cleanupOldBuckets(\n      API_BUCKET_RETENTION_DAYS,\n      retentionDeadline,\n      db\n    );',
    to: '    apiBuckets = 0;',
  },
  {
    name: 'the cleanup stops calling cleanExpiredCache, so the cache period is the period a row is used, not kept',
    file: 'app/api/cron/cleanup/route.ts',
    from: '    walletCacheRows = await cleanExpiredCache(retentionDeadline, db);',
    to: '    walletCacheRows = 0;',
  },
  {
    name: 'the cache delete stops re-checking the row, so an address cached again mid-batch is deleted',
    file: 'lib/cache.ts',
    from: '    WHERE w.wallet = expired.wallet AND w.cached_at < ${cutoff}',
    to: '    WHERE w.wallet = expired.wallet',
  },
  {
    name: 'cleanExpiredCache answers zero whatever it deleted',
    file: 'lib/cache.ts',
    from: '  return (result.rows ?? []).length;',
    to: '  return 0;',
  },
  {
    name: 'API usage is kept 11 months, shorter than the admin journey reads',
    file: 'app/api/cron/cleanup/route.ts',
    from: 'export const API_USAGE_RETENTION_MONTHS = 13;',
    to: 'export const API_USAGE_RETENTION_MONTHS = 11;',
  },
  {
    name: 'the usage delete names the wrong table, so api_usage is never trimmed',
    file: 'lib/retention.ts',
    from: '      DELETE FROM api_usage u USING due',
    to: '      DELETE FROM api_metrics u USING due',
  },
  {
    name: 'payment records are kept one year instead of seven',
    file: 'app/api/cron/cleanup/route.ts',
    from: 'export const PAYMENT_RECORD_RETENTION_YEARS = 7;',
    to: 'export const PAYMENT_RECORD_RETENTION_YEARS = 1;',
  },
  {
    name: 'the lot and Stripe-id purge is switched on before its replay key, loyalty count and has-bought marker outlive the lot',
    file: 'app/api/cron/cleanup/route.ts',
    from: 'export const PURCHASE_RECORD_PURGE_ENABLED = false;',
    to: 'export const PURCHASE_RECORD_PURGE_ENABLED = true;',
  },
  {
    name: 'the lot purge runs whatever the flag says',
    file: 'app/api/cron/cleanup/route.ts',
    from: '    if (PURCHASE_RECORD_PURGE_ENABLED) {',
    to: '    if (true) {',
  },
  {
    name: 'a lot past seven years is purged while it is still live',
    file: 'lib/retention.ts',
    from: '\n    AND ${r}.expires_at <= ${UTC_NOW}`;',
    to: '`;',
  },
  {
    name: 'the ledger purge forgets live lots, so it deletes the debits a live balance was drawn from',
    file: 'lib/retention.ts',
    from: '    AND NOT EXISTS (\n      SELECT 1 FROM credit_lots l\n      WHERE l.user_id = ${r}.user_id\n        AND l.created_at <= ${r}.created_at\n        AND l.expires_at > ${UTC_NOW}\n    )\n',
    to: '',
  },
  {
    name: 'the ledger purge deletes a gated job’s unlock row, so a retried unlock can charge twice',
    file: 'lib/retention.ts',
    from: "\n          OR (${r}.paid_from = 'unlock' AND j.matches_delivered IS NOT NULL))",
    to: ')',
  },
  {
    name: 'the cleanup stops reporting the cache count, so a failed branch reads as nothing to do',
    file: 'app/api/cron/cleanup/route.ts',
    from: '    walletCacheRows,\n  });',
    to: '  });',
  },
  {
    name: 'the webhook logs the buyer’s email in full',
    file: 'app/api/webhook/route.ts',
    from: 'to ${maskEmail(email)} via ${via}`',
    to: 'to ${email} via ${via}`',
  },
  {
    name: 'a purchase sign-in failure logs the buyer’s email in full',
    file: 'lib/pack-fulfilment.ts',
    from: '`No sign-in link for ${maskEmail(email)}: ${tokenResult.error}`',
    to: '`No sign-in link for ${email}: ${tokenResult.error}`',
  },
  {
    name: 'the settled-but-not-granted log prints the payer’s wallet in full',
    file: 'app/api/x402/buy/route.ts',
    from: 'payer=${maskWallet(payer)}',
    to: 'payer=${payer}',
  },
  {
    name: 'the key-reissue log prints the wallet in full',
    file: 'app/api/x402/recover/route.ts',
    from: 'key reissued wallet=${maskWallet(wallet.toLowerCase())}',
    to: 'key reissued wallet=${wallet.toLowerCase()}',
  },
  {
    name: 'the ENS failure log prints the wallet in full',
    file: 'lib/ens.ts',
    from: '`ENS lookup failed for ${maskWallet(wallet)}:`',
    to: '`ENS lookup failed for ${wallet}:`',
  },
  {
    name: 'the console net is written but never installed, so an error object prints its params raw',
    file: 'instrumentation.ts',
    from: '    redactConsole(console, format);',
    to: '    void redactConsole;',
  },
  {
    name: 'the console net installs on the edge runtime only',
    file: 'instrumentation.ts',
    from: "  if (process.env.NEXT_RUNTIME === 'nodejs') {",
    to: "  if (process.env.NEXT_RUNTIME === 'edge') {",
  },
  {
    name: 'redact looks for 64-digit hashes instead of 40-digit addresses, so no wallet is masked',
    file: 'lib/redact.ts',
    from: 'const WALLET_IN_TEXT = /\\b0x[0-9a-fA-F]{40}\\b/g;',
    to: 'const WALLET_IN_TEXT = /\\b0x[0-9a-fA-F]{64}\\b/g;',
  },
  {
    name: 'the email pattern’s local part is unbounded again, so a long log line takes quadratic time',
    file: 'lib/redact.ts',
    from: '/[A-Za-z0-9._%+-]{1,64}@',
    to: '/[A-Za-z0-9._%+-]+@',
  },
  {
    name: 'maskEmail returns the address unchanged',
    file: 'lib/redact.ts',
    from: '  return `${local.slice(0, keep)}***${email.slice(at)}`;',
    to: '  return email;',
  },
  {
    name: 'a line the net cannot format is printed raw instead of withheld',
    file: 'lib/redact.ts',
    from: "        line = '[log line withheld: it could not be formatted for redaction]';",
    to: "        line = args.map(String).join(' ');",
  },
  {
    name: 'sessions take a user agent again',
    file: 'lib/auth.ts',
    from: '  userId: string\n): Promise<{ token: string } | { error: string }> {',
    to: '  userId: string,\n  userAgent?: string\n): Promise<{ token: string } | { error: string }> {',
  },
  {
    name: 'the user-agent migration writes without --commit',
    file: 'scripts/migrate-clear-session-user-agents.ts',
    from: "  const commit = process.argv.includes('--commit');",
    to: '  const commit = true;',
  },
  {
    name: 'the month bucket is compared with the day cutoff, so the month’s quota resets every day',
    file: 'lib/rate-limiter.ts',
    from: '    OR (${r}.bucket_type = \'month\' AND ${r}.bucket_key COLLATE "C" < ${keys.month})',
    to: '    OR (${r}.bucket_type = \'month\' AND ${r}.bucket_key COLLATE "C" < ${keys.day})',
  },
  {
    name: 'the live-lot guard joins lots on the job id, so it never matches and the debits a live lot paid for go',
    file: 'lib/retention.ts',
    from: '      WHERE l.user_id = ${r}.user_id',
    to: '      WHERE l.user_id = ${r}.job_id',
  },
  {
    name: 'the job guard joins jobs on the user id, so a running job’s charge and a gated unlock go',
    file: 'lib/retention.ts',
    from: '      WHERE j.id = ${r}.job_id',
    to: '      WHERE j.id = ${r}.user_id',
  },
  {
    name: 'the live-lot guard counts a lot as live ten years past its expiry',
    file: 'lib/retention.ts',
    from: '        AND l.expires_at > ${UTC_NOW}\n',
    to: "        AND l.expires_at > ${UTC_NOW} + interval '10 years'\n",
  },
  {
    name: 'the ledger purge shortens the period to one year inside the predicate',
    file: 'lib/retention.ts',
    from: '  return sql`${r}.created_at < ${UTC_NOW} - make_interval(years => ${years})\n    AND NOT EXISTS (',
    to: '  return sql`${r}.created_at < ${UTC_NOW} - make_interval(years => ${years} - 6)\n    AND NOT EXISTS (',
  },
  {
    name: 'the cleanup ages api_usage by a literal month, not the retention constant',
    file: 'app/api/cron/cleanup/route.ts',
    from: '        deleteOldApiUsage(\n          db,\n          API_USAGE_RETENTION_MONTHS,',
    to: '        deleteOldApiUsage(\n          db,\n          1,',
  },
  {
    name: 'the cleanup purges the ledger after a literal year, not the retention constant',
    file: 'app/api/cron/cleanup/route.ts',
    from: '        deleteOldLedgerRows(\n          db,\n          PAYMENT_RECORD_RETENTION_YEARS,',
    to: '        deleteOldLedgerRows(\n          db,\n          1,',
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
