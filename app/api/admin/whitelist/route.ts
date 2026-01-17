import { NextRequest, NextResponse } from 'next/server';
import {
  getWhitelistEntries,
  addToWhitelist,
  removeFromWhitelist,
  getAccessStats,
} from '@/lib/access';

export const runtime = 'nodejs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAuthorized(request: NextRequest): boolean {
  if (!ADMIN_PASSWORD) return false;
  const password = request.headers.get('x-admin-password');
  return password === ADMIN_PASSWORD;
}

// GET: List all whitelist entries
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const entries = await getWhitelistEntries();
    const stats = await getAccessStats();

    return NextResponse.json({
      entries,
      stats,
    });
  } catch (error) {
    console.error('Whitelist fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch whitelist' },
      { status: 500 }
    );
  }
}

// POST: Add entry to whitelist
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { email, wallet, note } = body;

    if (!email && !wallet) {
      return NextResponse.json(
        { error: 'Email or wallet required' },
        { status: 400 }
      );
    }

    const id = await addToWhitelist({ email, wallet, note });

    return NextResponse.json({
      id,
      message: 'Added to whitelist',
    });
  } catch (error) {
    console.error('Whitelist add error:', error);
    return NextResponse.json(
      { error: 'Failed to add to whitelist' },
      { status: 500 }
    );
  }
}

// DELETE: Remove entry from whitelist
export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'ID required' },
        { status: 400 }
      );
    }

    const removed = await removeFromWhitelist(id);

    if (!removed) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: 'Removed from whitelist',
    });
  } catch (error) {
    console.error('Whitelist remove error:', error);
    return NextResponse.json(
      { error: 'Failed to remove from whitelist' },
      { status: 500 }
    );
  }
}
