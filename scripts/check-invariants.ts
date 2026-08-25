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
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { privateKeyToAccount } from 'viem/accounts';

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

    // The writer. Uploaded columns are spread FIRST so a column name cannot
    // overwrite a field this function computed. `wallet` and `holdings` had the
    // same exposure as `source`.
    const processor = readFileSync('lib/job-processor.ts', 'utf8');
    const init = processor.slice(
      processor.indexOf('for (const wallet of walletsToProcess) {'),
      processor.indexOf('const neynarApiKey')
    );
    ok(
      'uploaded CSV columns are spread before the fields the pipeline owns',
      init.indexOf('...walletData') !== -1 &&
        init.indexOf('...walletData') < init.indexOf('source: []') &&
        init.indexOf('...walletData') < init.indexOf('wallet: walletLower')
    );
    // A resumed job reloads rows written before that fix, so the entry point
    // has to normalise too or the next spread is back to characters.
    ok(
      'partial results are normalised when a job resumes',
      /partialResults[\s\S]{0,400}?asSourceList\(r\.source\)/.test(processor)
    );

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
