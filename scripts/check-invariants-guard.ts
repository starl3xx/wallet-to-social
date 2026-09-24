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
    from: '  if (a === 169 && b === 254) return true;',
    to: '  if (false) return true;',
  },
  {
    name: 'the client_id host check refuses 172.15 and 172.32 as well, an off-by-one on the private block',
    file: 'lib/oauth/clients.ts',
    from: '  if (a === 172 && b >= 16 && b <= 31) return true;',
    to: '  if (a === 172) return true;',
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
    from: '      sql`${oauthGrants.refreshTokenHash} = ${hash} OR ${oauthGrants.previousRefreshTokenHash} = ${hash} OR ${oauthGrants.refreshGraceHashes} @> ARRAY[${hash}]::text[]`',
    to: '      eq(oauthGrants.refreshTokenHash, hash)',
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
    file: 'app/api/mcp/route.ts',
    from: '  if (check.ok) return null;',
    to: "  if (check.ok || check.reason === 'audience') return null;",
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
    from: "    if (grantType === 'authorization_code') return await exchangeCode(form);",
    to: "    if (grantType === 'authorization_code') return exchangeCode(form);",
  },
  {
    name: 'the refresh is returned unawaited, so its failure escapes the catch as a bare 500',
    file: 'app/api/oauth/token/route.ts',
    from: "    if (grantType === 'refresh_token') return await exchangeRefresh(form);",
    to: "    if (grantType === 'refresh_token') return exchangeRefresh(form);",
  },
  {
    name: 'the code exchange runs outside the catch',
    file: 'app/api/oauth/token/route.ts',
    from: "  try {\n    if (grantType === 'authorization_code') return await exchangeCode(form);",
    to: "  if (grantType === 'authorization_code') return await exchangeCode(form);\n  try {",
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
    from: ' OR ${oauthGrants.refreshGraceHashes} @> ARRAY[${hash}]::text[]`\n    )\n    .limit(1);\n  if (!row) return',
    to: '`\n    )\n    .limit(1);\n  if (!row) return',
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
    name: 'the Inngest pipeline overwrites owned fields again (Bugbot, 2026-08-25)',
    file: 'inngest/functions/wallet-lookup.ts',
    from: '              ...walletData,\n              wallet: walletLower,\n              source: [],\n              holdings,',
    to: '              wallet: walletLower,\n              source: [],\n              holdings,\n              ...walletData,',
  },
  {
    name: 'the Inngest batch initializer overwrites owned fields again',
    file: 'inngest/functions/wallet-lookup.ts',
    from: '                ...walletData,\n                wallet: walletLower,\n                source: [],\n                holdings,',
    to: '                wallet: walletLower,\n                source: [],\n                holdings,\n                ...walletData,',
  },
  {
    name: 'the Inngest path reloads its partial results without normalising them',
    file: 'inngest/functions/wallet-lookup.ts',
    from: 'resultsMap.set(r.wallet, { ...r, source: asSourceList(r.source) });',
    to: 'resultsMap.set(r.wallet, r);',
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
