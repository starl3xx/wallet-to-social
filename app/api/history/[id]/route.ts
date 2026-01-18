import { NextRequest, NextResponse } from 'next/server';
import { getLookupById, updateLookup, updateLookupName } from '@/lib/history';
import type { WalletSocialResult } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  try {
    const { id } = await params;
    const lookup = await getLookupById(id);

    if (!lookup) {
      return NextResponse.json(
        { error: 'Lookup not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ results: lookup.results });
  } catch (error) {
    console.error('History fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lookup' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  try {
    const { id } = await params;
    const body = await request.json();

    // Check if lookup exists
    const existing = await getLookupById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Lookup not found' },
        { status: 404 }
      );
    }

    // Handle name update
    if (typeof body.name === 'string') {
      const success = await updateLookupName(id, body.name);
      if (!success) {
        return NextResponse.json(
          { error: 'Failed to update lookup name' },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true });
    }

    // Handle results update
    const results: WalletSocialResult[] = body.results;
    if (!results || !Array.isArray(results)) {
      return NextResponse.json(
        { error: 'Invalid request - must include name or results' },
        { status: 400 }
      );
    }

    // Update the lookup
    const success = await updateLookup(id, results);

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to update lookup' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('History update error:', error);
    return NextResponse.json(
      { error: 'Failed to update lookup' },
      { status: 500 }
    );
  }
}
