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
 * name, which is why a registered client is labelled by its redirect host and
 * marked unverified on the consent screen rather than trusted to name itself.
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
   * host is not. For a registered client there is nothing verified to show.
   */
  displayHost: string;
  /** The self-asserted name, shown only alongside the host, never instead of it. */
  claimedName: string | null;
  redirectUris: string[];
  isCimd: boolean;
}

// --- redirect URI matching --------------------------------------------------

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/**
 * Whether a URI is a loopback redirect, which is how every native client
 * receives its authorization code.
 */
export function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return (
      u.protocol === 'http:' &&
      isLoopbackHost(u.hostname === '::1' ? '[::1]' : u.hostname)
    );
  } catch {
    return false;
  }
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
 * The carve-out is scheme, host and path: a loopback match still requires all
 * three to be equal, so `http://localhost:9/evil` does not match
 * `http://localhost/callback`. Only the port is free.
 */
export function redirectUriAllowed(
  requested: string,
  declared: string[]
): boolean {
  if (declared.includes(requested)) return true;

  let want: URL;
  try {
    want = new URL(requested);
  } catch {
    return false;
  }
  if (!isLoopbackRedirect(requested)) return false;

  return declared.some((candidate) => {
    if (!isLoopbackRedirect(candidate)) return false;
    let have: URL;
    try {
      have = new URL(candidate);
    } catch {
      return false;
    }
    return (
      have.protocol === want.protocol &&
      have.hostname === want.hostname &&
      have.pathname === want.pathname
    );
  });
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
    if (isLoopbackRedirect(uri)) continue;
    let candidate: URL;
    try {
      candidate = new URL(uri);
    } catch {
      throw new Error(
        'client_id document declares an unparseable redirect_uri'
      );
    }
    if (candidate.origin !== url.origin) {
      throw new Error(
        'client_id document declares a redirect_uri on another origin'
      );
    }
  }

  const resolved: ResolvedClient = {
    clientId,
    displayHost: url.host,
    claimedName: typeof meta.client_name === 'string' ? meta.client_name : null,
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
      claimedName: row.clientName,
      redirectUris: row.redirectUris,
      isCimd: true,
    };
  }
  // A registered client has no host that proved anything, so the consent
  // screen is shown the one host it will actually send the code to.
  let host = 'an unverified application';
  try {
    const first = row.redirectUris.find((u) => !isLoopbackRedirect(u));
    if (first) host = new URL(first).host;
  } catch {
    /* leave the fallback */
  }
  return {
    clientId: row.clientId,
    displayHost: host,
    claimedName: row.clientName,
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
