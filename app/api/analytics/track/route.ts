import { NextRequest, NextResponse } from 'next/server';
import { trackEvent, type AnalyticsEventType } from '@/lib/analytics';

export const runtime = 'nodejs';

interface TrackRequest {
  eventType: AnalyticsEventType;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body: TrackRequest = await request.json();
    const { eventType, userId, sessionId, metadata } = body;

    if (!eventType) {
      return NextResponse.json({ error: 'eventType is required' }, { status: 400 });
    }

    // Fire and forget - don't block the response
    trackEvent(eventType, { userId, sessionId, metadata });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Analytics tracking error:', error);
    return NextResponse.json({ success: true }); // Always return success to not block client
  }
}
