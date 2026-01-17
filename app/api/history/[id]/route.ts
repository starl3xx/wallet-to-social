import { NextRequest, NextResponse } from 'next/server';
import { getLookupById } from '@/lib/history';

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
