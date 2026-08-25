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

  // --- the MCP server's OAuth flow ----------------------------------------

  {
    name: 'the redirect check compares origins, so any path on a declared host works',
    file: 'lib/oauth/clients.ts',
    from: '      have.pathname === want.pathname',
    to: '      true',
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
    name: 'a grant table joins the nightly dump, so a restore resurrects a revoked connection',
    file: 'scripts/migrate-grant-readonly.ts',
    from: "  'credit_ledger',\n];",
    to: "  'credit_ledger',\n  'oauth_grants',\n];",
  },
  {
    name: 'the code is spent before the exchange is validated (Bugbot, 2026-08-25)',
    file: 'app/api/oauth/token/route.ts',
    from: '  const loaded = await loadCode(code);',
    to: '  await consumeCode(code);\n  const loaded = await loadCode(code);',
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
    from: "  if (spent === 'replayed') {",
    to: "  if (spent !== 'consumed') {",
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
