/**
 * Where a `client_id` comes from, and what it is allowed to claim.
 *
 * Two mechanisms, and the difference between them is the only thing a consent
 * screen can honestly show.
 *
 * **Client ID Metadata Documents.** The `client_id` is an HTTPS URL that
 * serves the client's own metadata. The document is self-asserted, so the
 * `client_name` in it means nothing; the *host* means something, because
 * somebody had to control it to serve the document. Claude Code identifies
 * itself this way, at `https://claude.ai/oauth/claude-code-client-metadata`.
 *
 * **Dynamic client registration.** RFC 7591. Anybody may post metadata and
 * receive a `client_id`. Nothing about the result is verified, including the
 * name and every URI in its list, which is why the consent screen labels a
 * registered client by the host of the reply address in the request being
 * approved, marks it unverified, and never lets it name itself.
 *
 * Kept because a client that implements neither mechanism has no other way in,
 * and the MCP specification still lists it.
 */
import { lookup as dnsLookup } from 'dns/promises';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'http';
import { request as httpsRequest } from 'https';
import { BlockList, isIP, type LookupFunction, type Socket } from 'net';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { oauthClients, type OauthClient } from '@/db/schema';
import { GRANT_TYPES_SUPPORTED } from '@/lib/oauth/metadata';

/** How long a fetched metadata document is trusted before it is re-read. */
const CIMD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A metadata document larger than this many bytes is refused. Counted on the
 * wire as it arrives, so an oversized body is dropped part way rather than
 * buffered first.
 */
const CIMD_MAX_BYTES = 64 * 1024;

/** One deadline for the whole fetch: resolution, connect, headers and body. */
const CIMD_TIMEOUT_MS = 5000;

/**
 * Sent on every metadata fetch. The global `fetch` used to send a default
 * user agent; a plain `https.request` sends none, and some CDNs refuse a
 * request without one.
 */
const CIMD_USER_AGENT = 'walletlink.social-oauth (+https://walletlink.social)';

export interface ResolvedClient {
  clientId: string;
  /**
   * What the consent screen shows as the relying party.
   *
   * For a metadata-document client this is the host of the `client_id` URL,
   * never the `client_name` field, because the field is self-asserted and the
   * host is not. For a registered client there is nothing verified to show, so
   * it is a constant: the consent screen names such a client by the reply host
   * of the request itself (see `consentView`), never by an entry in its list.
   */
  displayHost: string;
  /** The self-asserted name, shown only alongside the host, never instead of it. */
  claimedName: string | null;
  redirectUris: string[];
  isCimd: boolean;
}

// --- redirect URI matching --------------------------------------------------

/**
 * A loopback redirect, in the one shape accepted: `http`, a lowercase loopback
 * host, an optional port, and a path with no fragment. No userinfo, no
 * uppercase, no shortened IP form. Group 1 is the host, group 2 the path.
 *
 * One definition serves registration, the metadata-document check, matching
 * and the consent screen. Two looser ones used to disagree, so a URI could be
 * "loopback" at registration and not at matching.
 */
const LOOPBACK_REDIRECT =
  /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?(\/[^#]*)?$/;

/**
 * A loopback redirect with its port removed, or null for anything else.
 *
 * The whole URI must parse, which also bounds the port at 65535:
 * a string that passes here is later rebuilt with `new URL`, and one that
 * cannot be would fail there, after the gate, as a server error.
 */
function loopbackKey(uri: string): string | null {
  const m = LOOPBACK_REDIRECT.exec(uri);
  if (!m) return null;
  // WHATWG URL refuses a port past 65535, so the parse is the port bound.
  try {
    new URL(uri);
  } catch {
    return null;
  }
  return `http://${m[1]}${m[3] ?? ''}`;
}

/**
 * Whether a URI is a loopback redirect, which is how every native client
 * receives its authorization code.
 */
export function isLoopbackRedirect(uri: string): boolean {
  return loopbackKey(uri) !== null;
}

/**
 * Whether a requested `redirect_uri` is one the client declared.
 *
 * Exact string comparison, with one carve-out: a loopback redirect matches
 * with the port ignored. RFC 8252 section 7.3 requires that for the IP-literal
 * form, because a native app binds an ephemeral port at run time and cannot
 * know it at registration. Claude Code declares `http://localhost/callback`
 * and binds something like `http://localhost:3118/callback`, so the same
 * port-agnostic rule is applied to `localhost` even though section 8.3
 * discourages the name form.
 *
 * Only the port is free: everything else, path and query included, must be the
 * same string (RFC 9700 section 2.1; OAuth 2.1 section 2.3.1). So
 * `http://localhost:9/evil`, `http://localhost:9/callback?x=1` and
 * `http://localhost:9/callback/` do not match `http://localhost/callback`.
 */
export function redirectUriAllowed(
  requested: string,
  declared: string[]
): boolean {
  if (declared.includes(requested)) return true;
  const key = loopbackKey(requested);
  return key !== null && declared.some((c) => loopbackKey(c) === key);
}

/**
 * Callbacks an error or a decline may be sent to without a person choosing
 * it. Loopback always qualifies: it is this computer, not a page somebody
 * else controls, and a native client left without an answer hangs until it
 * times out. Otherwise only these origins, whatever a client registered or
 * published: a metadata document on evil.example proves only that somebody
 * controls evil.example (RFC 9700 section 4.11.2).
 */
export const TRUSTED_REDIRECT_ORIGINS: readonly string[] = [
  'https://claude.ai',
];

export function redirectIsTrusted(uri: string): boolean {
  if (isLoopbackRedirect(uri)) return true;
  try {
    const u = new URL(uri);
    return (
      !u.username &&
      !u.password &&
      !u.hash &&
      TRUSTED_REDIRECT_ORIGINS.includes(u.origin)
    );
  } catch {
    return false;
  }
}

// --- dynamic registration ---------------------------------------------------

/**
 * The grant types a registration is stored with, or why it is refused.
 *
 * Substituted, not all-or-nothing. RFC 7591 section 2 lets a server register
 * other values than the ones requested, and section 3.2.1 has it return what
 * it registered, which `app/api/oauth/register/route.ts` does. So a request
 * that names a grant this server does not issue is registered without it:
 * hosted Claude's own metadata lists `urn:ietf:params:oauth:grant-type:jwt-bearer`
 * beside the two supported grants, and the token endpoint refuses every other
 * grant anyway, so dropping it loses nothing.
 *
 * Refused: an array with a non-string entry, and a list without
 * `authorization_code`, since that client could never obtain a first token.
 * The refusal names each requested grant this server does not issue, and
 * mentions consent only when one of them issues tokens with no person present.
 *
 * Omitted, not an array, or empty: the default, both supported grants.
 */
export function registrableGrantTypes(
  requested: unknown
): { ok: true; grantTypes: string[] } | { ok: false; description: string } {
  const supported: readonly string[] = GRANT_TYPES_SUPPORTED;
  if (!Array.isArray(requested) || requested.length === 0) {
    return { ok: true, grantTypes: [...supported] };
  }
  if (!requested.every((g) => typeof g === 'string')) {
    return {
      ok: false,
      description: 'grant_types must be an array of strings.',
    };
  }
  const asked = [...new Set(requested as string[])];
  const registered = supported.filter((g) => asked.includes(g));
  const unsupported = asked.filter((g) => !supported.includes(g));
  if (!registered.includes('authorization_code')) {
    const without = unsupported.length
      ? `; it does not support ${unsupported.join(', ')}`
      : '';
    const consent = unsupported.some((g) => GRANTS_WITHOUT_A_PERSON.has(g))
      ? ', because every connection needs a person to consent to it'
      : '';
    return {
      ok: false,
      description: `grant_types must include authorization_code. This server issues tokens only through the authorization code flow with PKCE, renewed with refresh_token${without}${consent}.`,
    };
  }
  return { ok: true, grantTypes: registered };
}

/** Grants that issue a token with no person present to consent. */
const GRANTS_WITHOUT_A_PERSON = new Set([
  'client_credentials',
  'urn:ietf:params:oauth:grant-type:jwt-bearer',
]);

/**
 * Whether a host resolves to this computer, for the consent warning only.
 * Broader than the redirect rule on purpose: a registered client may use
 * https to `foo.localhost`, `127.0.0.2`, `0.0.0.0` or a mapped IPv6 loopback,
 * which browsers and operating systems deliver locally. Matching and trust
 * stay strict; this decides only whether the person is warned.
 */
export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '[::1]' || h === '[::]') return true;
  if (/^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(h)) return true;
  if (h === '0.0.0.0') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * A self-declared client name, made safe to show: control, bidirectional
 * and zero-width characters removed, unusual spaces made ordinary, runs of
 * space collapsed, and at most 60 characters. Empty becomes null. The name
 * is still only a claim; this keeps it from hiding or rearranging what sits
 * next to it.
 */
export function cleanClaimedName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g,
      ''
    )
    .replace(/[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return cleaned || null;
}

/**
 * What a connection is called under Connected applications. The verified
 * part comes first, so a long or crafted name cannot push it out of a
 * one-line row: the host for a metadata-document client, the reply host for
 * a registered one, whose own name is never used.
 */
export function connectionLabel(
  client: ResolvedClient,
  redirectUri: string
): string {
  if (client.isCimd) {
    return client.claimedName
      ? `${client.displayHost} (calls itself ${client.claimedName})`
      : client.displayHost;
  }
  const reply = consentView(client, redirectUri)?.replyHost;
  return `${reply ?? 'an unverified application'} (unverified)`;
}

/**
 * Why a redirect in a metadata document is refused, or null. A loopback
 * redirect passes on the shared rule, which already excludes a fragment and
 * userinfo; anything else must parse, sit on the document's own origin, and
 * carry no fragment and no userinfo.
 */
export function cimdRedirectProblem(
  uri: string,
  origin: string
): string | null {
  if (isLoopbackRedirect(uri)) return null;
  let candidate: URL;
  try {
    candidate = new URL(uri);
  } catch {
    return 'client_id document declares an unparseable redirect_uri';
  }
  if (candidate.origin !== origin) {
    return 'client_id document declares a redirect_uri on another origin';
  }
  if (candidate.hash || candidate.username || candidate.password) {
    return 'client_id document declares a redirect_uri with a fragment or userinfo';
  }
  return null;
}

/** What the consent screen may say about the request being approved. */
export interface ConsentView {
  /** Who is asking: a verified host, or for anything else the reply host. */
  subject: string;
  /** A metadata document's self-declared name; always null for a registered client. */
  claimedName: string | null;
  verified: boolean;
  /** The host the authorization code will be sent to. */
  replyHost: string;
  /** The same with its port, which is what tells two local programs apart. */
  replyAuthority: string;
  /** The reply goes to this computer rather than to a website. */
  local: boolean;
}

/**
 * The facts a consent screen may show for one request, taken from the
 * redirect in THAT request, never from the client's registered list. The MCP
 * specification says the authorization server "MUST clearly display the
 * redirect URI hostname", and a registered client can list anybody's host.
 *
 * Only WHATWG `URL.hostname` is used: it drops userinfo, lowercases, and
 * spells an internationalized host in punycode, so `https://claude.ai@x.example`
 * shows `x.example` and a lookalike Cyrillic host shows as `xn--`.
 */
export function consentView(
  client: ResolvedClient,
  redirectUri: string
): ConsentView | null {
  let reply: URL;
  try {
    reply = new URL(redirectUri);
  } catch {
    return null;
  }
  const replyHost = reply.hostname;
  const local = isLoopbackRedirect(redirectUri) || isLocalHostname(replyHost);
  return {
    subject: client.isCimd
      ? client.displayHost
      : local
        ? 'An application on this computer'
        : replyHost,
    claimedName: client.isCimd ? client.claimedName : null,
    verified: client.isCimd,
    replyHost,
    replyAuthority: reply.host,
    local,
  };
}

// --- fetching a metadata document -------------------------------------------

/**
 * Every address a `client_id` fetch may not connect to, one list per family.
 *
 * Two lists, never one. `BlockList` answers an IPv4 query against an IPv6
 * rule for `::ffff:0:0/96` as well, so a single list holding that rule would
 * refuse every IPv4 address there is, claude.ai's included. Each list is
 * checked only with its own family.
 *
 * IPv4: "this network", private, shared address space, loopback, link-local
 * (cloud metadata included), IETF protocol assignments, the three
 * documentation blocks, the old 6to4 relay, benchmarking, multicast, and
 * everything from 240/4 up, broadcast included.
 *
 * IPv6: the unspecified and loopback addresses with the rest of the
 * IPv4-compatible block, every IPv4-mapped address (refused outright, not
 * mapped and re-checked), both NAT64 prefixes, discard-only, Teredo,
 * documentation, 6to4, unique-local, link-local, the old site-local block
 * and multicast.
 */
function blockList(
  type: 'ipv4' | 'ipv6',
  ranges: ReadonlyArray<readonly [string, number]>
): BlockList {
  const list = new BlockList();
  for (const [network, prefix] of ranges) list.addSubnet(network, prefix, type);
  return list;
}

const NON_PUBLIC_V4 = blockList('ipv4', [
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
]);

const NON_PUBLIC_V6 = blockList('ipv6', [
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
]);

/**
 * Whether an address is one a `client_id` fetch may not connect to.
 *
 * Exported for `scripts/check-invariants.ts`, which asserts each range this
 * claims to refuse, and that claude.ai's own addresses are not among them. A
 * private-address check that quietly stopped matching a range would turn the
 * `client_id` fetch into a working request forgery, and nothing about the
 * flow would look different.
 *
 * `family` must agree with the address as `net.isIP` reads it, or the answer
 * is yes: an address that cannot be classified is refused, never let through.
 */
export function isPrivateAddress(address: string, family: number): boolean {
  try {
    if (isIP(address) !== family) return true;
    if (family === 4) return NON_PUBLIC_V4.check(address, 'ipv4');
    if (family === 6) return NON_PUBLIC_V6.check(address, 'ipv6');
  } catch {
    // An address BlockList cannot read is refused below, like any other.
  }
  return true;
}

/**
 * A metadata document that could not be used, and what the consent page may
 * say about it.
 *
 * `message` is the whole reason, for the server log. `publicMessage` is what
 * the page shows. A document that loaded and is wrong keeps its specific
 * reason there, because the developer of that client needs it. Every failure
 * to load one (resolution, a refused address, connect, TLS, the deadline, a
 * redirect, the size cap, an encoding) shows the same phrase, so the page
 * reports nothing about a request that did not complete.
 */
export class CimdError extends Error {
  readonly publicMessage: string;

  constructor(message: string, publicMessage: string = message) {
    super(message);
    this.name = 'CimdError';
    this.publicMessage = publicMessage;
  }
}

/** What the consent page says for every failure to load a document. */
export const CIMD_UNREACHABLE =
  'no usable answer came from the address it names';

function unreachable(reason: unknown): CimdError {
  const detail = reason instanceof Error ? reason.message : String(reason);
  return new CimdError(
    `client_id document could not be fetched: ${detail}`,
    CIMD_UNREACHABLE
  );
}

/**
 * Why a `client_id` URL is refused before anything is fetched, or null.
 *
 * draft-ietf-oauth-client-id-metadata-document-00 section 3: https, a path,
 * no fragment, no credentials and no dot segments. Two more rules are this
 * server's own. The host must be a name, not an IP address, because the
 * checks below are attached to resolving a name and a literal address skips
 * that step. And the URL must be exactly what WHATWG `URL` serializes it to,
 * which is also what refuses a missing path, dot segments, an uppercase or
 * internationalized host and an explicit default port. Both claude.ai client
 * ids pass unchanged, and `scripts/check-invariants.ts` asserts that.
 */
export function clientIdUrlProblem(id: string): string | null {
  let url: URL;
  try {
    url = new URL(id);
  } catch {
    return 'a client_id must be a URL';
  }
  if (url.protocol !== 'https:') return 'a client_id URL must be https';
  if (url.username || url.password) {
    return 'a client_id URL must carry no credentials';
  }
  if (url.hash || id.includes('#')) {
    return 'a client_id URL must carry no fragment';
  }
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) {
    return 'a client_id URL must name a host, not an IP address';
  }
  if (url.href !== id) {
    return 'a client_id URL must have a path and be written in canonical form';
  }
  return null;
}

/** One address a host resolved to, as `dns.lookup` reports it with `all`. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Every address a host resolves to. Replaced in the invariant checks. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: Resolver = (hostname) =>
  dnsLookup(hostname, { all: true });

function familyOf(requested: unknown): 0 | 4 | 6 {
  if (requested === 4 || requested === 'IPv4') return 4;
  if (requested === 6 || requested === 'IPv6') return 6;
  return 0;
}

/**
 * The `lookup` a metadata fetch's socket uses.
 *
 * It resolves the host once, refuses the whole answer when any address in it
 * is non-public (an empty answer too), and hands the socket only addresses it
 * has checked. The socket connects to what this returns and nothing else, so
 * the address checked is the address connected to.
 */
export function pinnedLookup(
  resolve: Resolver = systemResolver
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (answer) => {
        if (answer.length === 0) {
          return callback(unreachable('client_id host does not resolve'), '');
        }
        if (answer.some((a) => isPrivateAddress(a.address, a.family))) {
          return callback(
            unreachable('client_id host resolves to a non-public address'),
            ''
          );
        }
        const family = familyOf(options.family);
        const usable = family
          ? answer.filter((a) => a.family === family)
          : answer;
        if (usable.length === 0) {
          return callback(
            unreachable(`client_id host has no IPv${family} address`),
            ''
          );
        }
        if (options.all) return callback(null, usable);
        callback(null, usable[0].address, usable[0].family);
      },
      (error: unknown) => callback(unreachable(error), '')
    );
  };
}

/** What `fetchCimdDocument` uses. Replaced in the invariant checks, which run with no network. */
export interface CimdFetchDeps {
  resolve: Resolver;
  request: (url: URL, options: RequestOptions) => ClientRequest;
  deadlineMs: number;
  maxBytes: number;
}

const CIMD_FETCH: CimdFetchDeps = {
  resolve: systemResolver,
  request: (url, options) => httpsRequest(url, options),
  deadlineMs: CIMD_TIMEOUT_MS,
  maxBytes: CIMD_MAX_BYTES,
};

/**
 * Fetch a metadata document and parse it.
 *
 * The URL is supplied by whoever starts an authorization flow, and we fetch
 * it, so it is a server-side request forgery vector by construction. What
 * keeps it to public hosts:
 *
 * - `https.request`, not the global `fetch`, because it takes a `lookup`.
 *   `pinnedLookup` resolves the host once and checks every address, and the
 *   socket connects only to an address it returned. `agent: false`, so no
 *   pooled socket is reused without that lookup.
 * - Once connected, the peer address is checked again, and the request is
 *   dropped if it is not public.
 * - One deadline covers resolution, connect, headers and the whole body.
 * - The body is counted in bytes as it arrives and dropped past the cap. A
 *   declared length over the cap is refused before any body is read.
 * - `Accept-Encoding: identity`, and any other content-encoding is refused,
 *   so the cap counts what is parsed.
 * - A redirect is never followed: following one would let the self-reference
 *   check pass against a URL nobody named.
 *
 * Every failure to load the document is a `CimdError` whose public message
 * is `CIMD_UNREACHABLE`. A status other than 2xx, or a body that is not
 * JSON, keeps its own message.
 */
export function fetchCimdDocument(
  url: URL,
  deps: Partial<CimdFetchDeps> = {}
): Promise<unknown> {
  const { resolve, request, deadlineMs, maxBytes } = {
    ...CIMD_FETCH,
    ...deps,
  };
  return new Promise<unknown>((done, fail) => {
    let req: ClientRequest | null = null;
    let settled = false;
    const finish = (error: CimdError | null, doc?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        req?.destroy();
        fail(error);
      } else {
        done(doc);
      }
    };
    const deadline = setTimeout(
      () => finish(unreachable(`no complete answer within ${deadlineMs} ms`)),
      deadlineMs
    );

    try {
      req = request(url, {
        method: 'GET',
        lookup: pinnedLookup(resolve),
        agent: false,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          'User-Agent': CIMD_USER_AGENT,
        },
      });
    } catch (error) {
      finish(unreachable(error));
      return;
    }

    req.on('error', (error) =>
      finish(error instanceof CimdError ? error : unreachable(error))
    );
    req.on('socket', (socket: Socket) => {
      const checkPeer = () => {
        const remote = socket.remoteAddress ?? '';
        if (isPrivateAddress(remote, isIP(remote))) {
          finish(unreachable('connected to a non-public address'));
        }
      };
      if (socket.connecting) socket.once('connect', checkPeer);
      else checkPeer();
    });
    req.on('response', (res: IncomingMessage) =>
      readDocument(res, maxBytes, finish)
    );
    req.end();
  });
}

function readDocument(
  res: IncomingMessage,
  maxBytes: number,
  finish: (error: CimdError | null, doc?: unknown) => void
): void {
  res.on('error', (error) => finish(unreachable(error)));
  const status = res.statusCode ?? 0;
  if (status >= 300 && status < 400) {
    return finish(unreachable(`answered a redirect (${status})`));
  }
  if (status < 200 || status >= 300) {
    return finish(new CimdError(`client_id document answered ${status}`));
  }
  const encoding = res.headers['content-encoding'];
  if (encoding !== undefined && encoding.trim().toLowerCase() !== 'identity') {
    return finish(unreachable(`answered with content-encoding ${encoding}`));
  }
  if (Number(res.headers['content-length']) > maxBytes) {
    return finish(unreachable('declared a body over the size cap'));
  }
  const chunks: Buffer[] = [];
  let received = 0;
  res.on('data', (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.length;
    if (received > maxBytes) {
      finish(unreachable('sent a body over the size cap'));
      return;
    }
    chunks.push(bytes);
  });
  res.on('end', () => {
    let doc: unknown;
    try {
      doc = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return finish(new CimdError('client_id document is not JSON'));
    }
    finish(null, doc);
  });
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : [];
}

/**
 * Validate a fetched metadata document against the `client_id` it was
 * fetched from. Pure: no network and no database, so the invariant checks run
 * it against the real claude.ai documents.
 *
 * Two checks, both load-bearing:
 *
 * 1. **Self-reference.** The document's own `client_id` must equal the URL it
 *    was served from. Without this, any page that happens to serve JSON could
 *    be named as a client and would inherit whatever that JSON said.
 * 2. **Redirect origin.** Each declared `redirect_uri` must be same-origin
 *    with the `client_id` URL, or a loopback address. Same-origin ties the
 *    redirect to the host that proved it controls the document; the loopback
 *    exception exists because a native client cannot be same-origin with
 *    anything and RFC 8252 blesses exactly this shape. Claude Code needs it.
 */
export function validateCimdDocument(
  clientId: string,
  doc: unknown
): { client: ResolvedClient; meta: Record<string, unknown> } {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new CimdError('client_id document is not an object');
  }
  const meta = doc as Record<string, unknown>;

  if (meta.client_id !== clientId) {
    throw new CimdError('client_id document does not name itself');
  }

  const url = new URL(clientId);
  const redirectUris = asStringArray(meta.redirect_uris);
  if (redirectUris.length === 0) {
    throw new CimdError('client_id document declares no redirect_uris');
  }
  for (const uri of redirectUris) {
    const problem = cimdRedirectProblem(uri, url.origin);
    if (problem) throw new CimdError(problem);
  }

  return {
    client: {
      clientId,
      displayHost: url.host,
      claimedName: cleanClaimedName(meta.client_name),
      redirectUris,
      isCimd: true,
    },
    meta,
  };
}

/**
 * Fetch, validate and cache a Client ID Metadata Document.
 *
 * In order: the URL's shape (`clientIdUrlProblem`), the fetch
 * (`fetchCimdDocument`), the document (`validateCimdDocument`), then the
 * cache row. Every refusal is a `CimdError`.
 */
export async function fetchCimdClient(
  clientId: string
): Promise<ResolvedClient> {
  const problem = clientIdUrlProblem(clientId);
  if (problem) throw new CimdError(problem);

  const doc = await fetchCimdDocument(new URL(clientId));
  const { client: resolved, meta } = validateCimdDocument(clientId, doc);
  const redirectUris = resolved.redirectUris;

  const db = getDb();
  if (db) {
    await db
      .insert(oauthClients)
      .values({
        clientId,
        clientName: resolved.claimedName,
        clientUri: typeof meta.client_uri === 'string' ? meta.client_uri : null,
        logoUri: typeof meta.logo_uri === 'string' ? meta.logo_uri : null,
        redirectUris,
        grantTypes: asStringArray(meta.grant_types),
        scope: typeof meta.scope === 'string' ? meta.scope : null,
        isCimd: true,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: oauthClients.clientId,
        set: {
          clientName: resolved.claimedName,
          redirectUris,
          fetchedAt: new Date(),
        },
      });
  }

  return resolved;
}

function fromRow(row: OauthClient): ResolvedClient {
  if (row.isCimd) {
    return {
      clientId: row.clientId,
      displayHost: new URL(row.clientId).host,
      claimedName: cleanClaimedName(row.clientName),
      redirectUris: row.redirectUris,
      isCimd: true,
    };
  }
  // A registered client has no host that proved anything, and its list may
  // name any host at all, so nothing in it labels the client. The consent
  // screen names the reply host of the request being approved instead.
  return {
    clientId: row.clientId,
    displayHost: 'an unverified application',
    claimedName: cleanClaimedName(row.clientName),
    redirectUris: row.redirectUris,
    isCimd: false,
  };
}

/**
 * Resolve a `client_id` to something a consent screen can name.
 *
 * An HTTPS `client_id` is a metadata document: served from cache while fresh,
 * re-fetched when stale. Anything else must be a row we registered.
 */
export async function resolveClient(
  clientId: string
): Promise<ResolvedClient | null> {
  const db = getDb();
  const looksLikeUrl = clientId.startsWith('https://');

  if (db) {
    const [row] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1);

    if (row) {
      const fresh =
        !row.isCimd ||
        (row.fetchedAt !== null &&
          Date.now() - row.fetchedAt.getTime() < CIMD_TTL_MS);
      if (fresh) return fromRow(row);
    }
  }

  if (!looksLikeUrl) return null;
  return fetchCimdClient(clientId);
}
