import { NextRequest, NextResponse } from 'next/server';
import {
  getKnownAgents,
  addKnownAgent,
  removeKnownAgent,
} from '@/lib/agent-detection';

export const runtime = 'nodejs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAuthorized(request: NextRequest): boolean {
  if (!ADMIN_PASSWORD) return false;
  const password = request.headers.get('x-admin-password');
  return password === ADMIN_PASSWORD;
}

// GET: List all known agents
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const agents = await getKnownAgents();
    return NextResponse.json({ agents, count: agents.length });
  } catch (error) {
    console.error('Known agents fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch known agents' },
      { status: 500 }
    );
  }
}

// POST: Add or update a known agent
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { wallet, name, framework, agentType, tokenSymbol, twitterHandle, farcaster } = body;

    if (!wallet || !name) {
      return NextResponse.json(
        { error: 'Wallet and name are required' },
        { status: 400 }
      );
    }

    // Validate wallet format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    const agent = await addKnownAgent({
      wallet,
      name,
      framework,
      agentType,
      tokenSymbol,
      twitterHandle,
      farcaster,
    });

    if (!agent) {
      return NextResponse.json(
        { error: 'Failed to add agent' },
        { status: 500 }
      );
    }

    return NextResponse.json({ agent, message: 'Agent added/updated' });
  } catch (error) {
    console.error('Known agent add error:', error);
    return NextResponse.json(
      { error: 'Failed to add known agent' },
      { status: 500 }
    );
  }
}

// DELETE: Remove a known agent
export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const wallet = searchParams.get('wallet');

    if (!wallet) {
      return NextResponse.json(
        { error: 'Wallet address required' },
        { status: 400 }
      );
    }

    const removed = await removeKnownAgent(wallet);

    if (!removed) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: 'Agent removed' });
  } catch (error) {
    console.error('Known agent remove error:', error);
    return NextResponse.json(
      { error: 'Failed to remove known agent' },
      { status: 500 }
    );
  }
}
