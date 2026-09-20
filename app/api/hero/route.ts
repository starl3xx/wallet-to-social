import { NextResponse } from 'next/server';
import { readHeroSnapshot } from '@/lib/identity-hero/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const snapshot = await readHeroSnapshot();
    if (!snapshot || snapshot.accounts.length < 2)
      return NextResponse.json(
        { error: 'Snapshot unavailable' },
        { status: 503, headers }
      );
    return NextResponse.json(snapshot, { headers });
  } catch {
    return NextResponse.json(
      { error: 'Snapshot unavailable' },
      { status: 503, headers }
    );
  }
}
