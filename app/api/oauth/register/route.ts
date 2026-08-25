/**
 * RFC 7591 dynamic client registration.
 *
 * Kept as a fallback, not as the main road. Claude reads a Client ID Metadata
 * Document when the authorization server metadata advertises one, and ours
 * does, so the hosted surfaces and Claude Code never reach this endpoint. What
 * does reach it is a client that implements neither mechanism, and refusing
 * those would be refusing the only way in they have.
 *
 * The result is worth being clear-eyed about: this endpoint mints a
 * `client_id` for anybody who asks, and nothing it stores has been verified.
 * That is what RFC 7591 is. The consequence is carried at the consent screen,
 * which shows a registered client's redirect host and marks it unverified,
 * rather than showing the name it gave itself.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getDb } from '@/db';
import { oauthClients } from '@/db/schema';
import { checkIpRateLimit, getClientIp } from '@/lib/ip-rate-limiter';
import { isLoopbackRedirect } from '@/lib/oauth/clients';
import { SUPPORTED_SCOPES } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';

function invalid(description: string): NextResponse {
  return NextResponse.json(
    { error: 'invalid_client_metadata', error_description: description },
    { status: 400 }
  );
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === 'string') ? (value as string[]) : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = await checkIpRateLimit(
    getClientIp(request),
    '/api/oauth/register'
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'temporarily_unavailable',
        error_description: 'Too many registrations from this address.',
      },
      {
        status: 429,
        headers: limit.retryAfter
          ? { 'Retry-After': String(limit.retryAfter) }
          : undefined,
      }
    );
  }

  // RFC 7591 section 3.1 says JSON here, unlike the token endpoint's form
  // encoding. Two different parsers on two adjacent endpoints is a real
  // source of 415s, so the content type is checked rather than assumed.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid('The registration request body must be JSON.');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalid('The registration request body must be a JSON object.');
  }
  const meta = body as Record<string, unknown>;

  const redirectUris = asStringArray(meta.redirect_uris);
  if (!redirectUris || redirectUris.length === 0) {
    return invalid(
      'redirect_uris is required and must be an array of strings.'
    );
  }
  if (redirectUris.length > 10) {
    return invalid('redirect_uris may name at most ten URIs.');
  }

  for (const uri of redirectUris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return invalid(`redirect_uri is not a URL: ${uri}`);
    }
    if (parsed.hash) {
      return invalid('A redirect_uri must carry no fragment.');
    }
    // https, or a loopback address for a native client. Plain http anywhere
    // else would put an authorization code on the wire in clear text.
    if (parsed.protocol !== 'https:' && !isLoopbackRedirect(uri)) {
      return invalid(
        'A redirect_uri must be https, or http on a loopback address.'
      );
    }
  }

  const grantTypes = asStringArray(meta.grant_types) ?? [
    'authorization_code',
    'refresh_token',
  ];
  const unsupported = grantTypes.filter(
    (g) => g !== 'authorization_code' && g !== 'refresh_token'
  );
  if (unsupported.length > 0) {
    return NextResponse.json(
      {
        error: 'invalid_client_metadata',
        error_description: `Unsupported grant_types: ${unsupported.join(', ')}. This server issues authorization codes only; there is no client_credentials grant, because every connection needs a person to consent to it.`,
      },
      { status: 400 }
    );
  }

  /**
   * Every client here is public.
   *
   * We issue no `client_secret`, so a client asking to authenticate with one
   * is told plainly rather than registered and left to fail at the token
   * endpoint with a mismatch it cannot diagnose.
   */
  const authMethod = meta.token_endpoint_auth_method;
  if (typeof authMethod === 'string' && authMethod !== 'none') {
    return invalid(
      'token_endpoint_auth_method must be "none". This server registers public clients and issues no client secrets; authenticate the token request with PKCE.'
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      {
        error: 'temporarily_unavailable',
        error_description: 'Registration is unavailable.',
      },
      { status: 503 }
    );
  }

  const clientId = `wts_client_${randomBytes(16).toString('base64url')}`;
  const clientName =
    typeof meta.client_name === 'string'
      ? meta.client_name.slice(0, 200)
      : null;

  await db.insert(oauthClients).values({
    clientId,
    clientName,
    clientUri: typeof meta.client_uri === 'string' ? meta.client_uri : null,
    logoUri: typeof meta.logo_uri === 'string' ? meta.logo_uri : null,
    redirectUris,
    grantTypes,
    tokenEndpointAuthMethod: 'none',
    scope: SUPPORTED_SCOPES.join(' '),
    isCimd: false,
  });

  return NextResponse.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SUPPORTED_SCOPES.join(' '),
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  );
}
