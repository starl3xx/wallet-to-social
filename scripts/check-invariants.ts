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
import { execFileSync } from 'child_process';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { privateKeyToAccount } from 'viem/accounts';
import {
  freshCastTime,
  FUTURE_SKEW_MS,
  isExcluded,
  parseExclusions,
} from './concierge-filters';
import {
  CHAIN_LABELS,
  CHAIN_TILE_LABELS,
  SUPPORTED_CHAINS,
  TILE_LABEL_MAX_CHARS,
} from '../lib/chains';
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
    ok(
      'the key list hides OAuth access tokens, which nobody can copy or usefully revoke',
      /listApiKeys[\s\S]*?isNull\(apiKeys\.oauthGrantId\)/.test(keys)
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
    const lockedReturn = route.indexOf(
      'return NextResponse.json(lockedReverseBody'
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
    const limits = readFileSync('lib/ip-rate-limiter.ts', 'utf8');
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

  // ------------------------------------- Chain tiles: a control cannot grow
  // The network picker is a grid of `h-control` tiles, 34px, three across in a
  // modal. "Robinhood Chain" needed a little more than the ~103px of text a
  // tile gives, wrapped to two lines and broke out of the one height every
  // control in this product shares. `control-height` renders three pages and
  // this modal is not one of them, so nothing caught it.
  {
    for (const chain of SUPPORTED_CHAINS) {
      const tile = CHAIN_TILE_LABELS[chain];
      ok(
        `${chain} has a tile label`,
        typeof tile === 'string' && tile.length > 0
      );
      ok(
        `${chain}'s tile label fits a control (${tile?.length} chars)`,
        (tile?.length ?? 99) <= TILE_LABEL_MAX_CHARS
      );
      ok(
        `${chain} still has a full label for surfaces with room`,
        typeof CHAIN_LABELS[chain] === 'string' &&
          CHAIN_LABELS[chain].length > 0
      );
    }

    // The shortening is for the tile only. Everywhere with room keeps the name.
    ok(
      'the full chain name is not shortened at the source',
      CHAIN_LABELS.robinhood === 'Robinhood Chain'
    );
    ok(
      'the tile label is the one that was shortened',
      CHAIN_TILE_LABELS.robinhood === 'Robinhood'
    );

    // Prove the bound can fail, or a max of 99 would satisfy every assertion.
    ok(
      'the full name would fail the tile bound',
      CHAIN_LABELS.robinhood.length > TILE_LABEL_MAX_CHARS
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
