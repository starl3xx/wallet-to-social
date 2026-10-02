import { NextRequest, NextResponse } from 'next/server';
import { trackEvent, type AnalyticsEventType } from '@/lib/analytics';
import { withCrawlerTag } from '@/lib/bots';

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
      return NextResponse.json(
        { error: 'eventType is required' },
        { status: 400 }
      );
    }

    /**
     * Tagged here, from the request's own User-Agent, never from the body.
     *
     * Every event gets `bot`, so the growth report can count a crawler's
     * session apart from a person's instead of losing it (STA-56). Tagged
     * rather than dropped: a crawler that renders the site is worth seeing,
     * and the lookups it started on 2026-09-30 were found through the page
     * views beside them. The User-Agent is read and not kept.
     */
    // Fire and forget - don't block the response
    trackEvent(eventType, {
      userId,
      sessionId,
      metadata: withCrawlerTag(metadata, request.headers.get('user-agent')),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Analytics tracking error:', error);
    return NextResponse.json({ success: true }); // Always return success to not block client
  }
}
