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
import { lookup } from 'dns/promises';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { oauthClients, type OauthClient } from '@/db/schema';

/** How long a fetched metadata document is trusted before it is re-read. */
const CIMD_TTL_MS = 24 * 60 * 60 * 1000;

/** A metadata document larger than this is refused rather than parsed. */
const CIMD_MAX_BYTES = 64 * 1024;

const CIMD_TIMEOUT_MS = 5000;

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
 * Exported for `scripts/check-invariants.ts`, which asserts each range this
 * claims to refuse. A private-address check that quietly stopped matching a
 * range would turn the `client_id` fetch into a working request forgery, and
 * nothing about the flow would look different.
 */
export function isPrivateAddress(address: string, family: number): boolean {
  if (family === 6) {
    const a = address.toLowerCase();
    // Loopback, link-local, unique-local, and v4-mapped forms of the same.
    if (a === '::1' || a === '::') return true;
    if (a.startsWith('fe80') || a.startsWith('fc') || a.startsWith('fd')) {
      return true;
    }
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1], 4);
    return false;
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * Refuse a `client_id` URL that resolves somewhere internal.
 *
 * The URL is supplied by whoever is starting an authorization flow, and we
 * fetch it, so it is a server-side request forgery vector by construction.
 * This resolves the hostname first and refuses every private, loopback,
 * link-local and carrier-grade range.
 *
 * What it does not stop: a hostname that answers with a public address here
 * and a private one when `fetch` resolves it again a moment later. Closing
 * that needs the socket pinned to the address checked, which Node's fetch does
 * not expose. Stated rather than papered over. The exposure it leaves is a
 * request from a Vercel function to an address in that function's own network
 * namespace, with the response never returned to the caller: a metadata
 * document that fails the self-reference check below produces the same error
 * as one that never loaded.
 */
async function assertPublicHost(url: URL): Promise<void> {
  const results = await lookup(url.hostname, { all: true });
  if (results.length === 0) throw new Error('client_id host does not resolve');
  for (const { address, family } of results) {
    if (isPrivateAddress(address, family)) {
      throw new Error('client_id host resolves to a non-public address');
    }
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : [];
}

/**
 * Fetch and validate a Client ID Metadata Document.
 *
 * Three checks, and all three are load-bearing:
 *
 * 1. **Self-reference.** The document's own `client_id` must equal the URL it
 *    was served from. Without this, any page that happens to serve JSON could
 *    be named as a client and would inherit whatever that JSON said.
 * 2. **Redirect origin.** Each declared `redirect_uri` must be same-origin
 *    with the `client_id` URL, or a loopback address. Same-origin ties the
 *    redirect to the host that proved it controls the document; the loopback
 *    exception exists because a native client cannot be same-origin with
 *    anything and RFC 8252 blesses exactly this shape. Claude Code needs it.
 * 3. **Public host.** See `assertPublicHost`.
 *
 * Redirects are not followed. A document that answers 302 is refused, because
 * following one would let the self-reference check pass against a URL nobody
 * named.
 */
export async function fetchCimdClient(
  clientId: string
): Promise<ResolvedClient> {
  const url = new URL(clientId);
  if (url.protocol !== 'https:') {
    throw new Error('A client_id URL must be https');
  }
  if (url.hash) {
    throw new Error('A client_id URL must carry no fragment');
  }
  await assertPublicHost(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CIMD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`client_id document answered ${response.status}`);
  }

  const text = await response.text();
  if (text.length > CIMD_MAX_BYTES) {
    throw new Error('client_id document is too large');
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('client_id document is not JSON');
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('client_id document is not an object');
  }
  const meta = doc as Record<string, unknown>;

  if (meta.client_id !== clientId) {
    throw new Error('client_id document does not name itself');
  }

  const redirectUris = asStringArray(meta.redirect_uris);
  if (redirectUris.length === 0) {
    throw new Error('client_id document declares no redirect_uris');
  }
  for (const uri of redirectUris) {
    const problem = cimdRedirectProblem(uri, url.origin);
    if (problem) throw new Error(problem);
  }

  const resolved: ResolvedClient = {
    clientId,
    displayHost: url.host,
    claimedName: cleanClaimedName(meta.client_name),
    redirectUris,
    isCimd: true,
  };

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
