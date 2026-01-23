import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/farcaster-dm
 * Proxy for Warpcast DM API to handle CORS
 *
 * Actions:
 * - test: Test if API key is valid
 * - send: Send a DM to a user
 */
export async function POST(request: Request) {
  try {
    const { action, apiKey, recipientFid, message, idempotencyKey } = await request.json();

    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 400 });
    }

    if (action === 'test') {
      // Test API key by fetching user profile
      const response = await fetch('https://api.warpcast.com/v2/me', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          valid: true,
          username: data.result?.user?.username
        });
      }

      if (response.status === 401) {
        return NextResponse.json({ valid: false, error: 'Invalid API key' });
      }

      return NextResponse.json({
        valid: false,
        error: `Warpcast API error: ${response.status}`
      });
    }

    if (action === 'send') {
      if (!recipientFid || !message) {
        return NextResponse.json(
          { error: 'recipientFid and message required' },
          { status: 400 }
        );
      }

      const response = await fetch('https://api.warpcast.com/v2/ext-send-direct-cast', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipientFid,
          message,
          idempotencyKey: idempotencyKey || crypto.randomUUID(),
        }),
      });

      if (response.ok) {
        return NextResponse.json({ success: true });
      }

      // Parse error response
      let errorMessage = `Warpcast API error: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.errors?.[0]?.message) {
          errorMessage = errorData.errors[0].message;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch {
        // Use default error message
      }

      return NextResponse.json({ success: false, error: errorMessage });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Farcaster DM proxy error:', error);
    return NextResponse.json(
      { error: 'Request failed' },
      { status: 500 }
    );
  }
}
