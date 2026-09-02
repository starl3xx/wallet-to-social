import { NextRequest, NextResponse } from 'next/server';
import {
  getUserFunnel,
  getSessionFunnel,
  getGateMetrics,
  getGateConversion,
  getAcquisitionSources,
  getPurchases,
  getAgentRail,
  conversionRates,
} from '@/lib/analytics';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

/**
 * Everything the funnel pane needs, in one call over one window.
 *
 * It replaces two endpoints that the panel called separately and drew twice.
 * `analytics/funnel` was fetched by the behaviour pane at 7 days and by the
 * revenue pane at 30, and each drew its own funnel from the answer with its own
 * denominator, so the panel showed two conversion rates and no way to tell they
 * were the same measurement over different windows. One window, chosen once by
 * the reader, is the whole point of this route.
 *
 * `previous` is the same window shifted back by its own length, and carries
 * only the two funnels plus their rates: the pane shows movement on its
 * headline tiles, and doubling the source, gate and rail queries for a delta
 * nobody asked for is where a cheap comparison stops being cheap.
 *
 * `days` is clamped rather than trusted. The session funnel groups the whole
 * event table by session id inside the range, so an unbounded value is a
 * request to scan everything ever recorded, from a query string.
 */
const MAX_DAYS = 365;

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const requested = parseInt(url.searchParams.get('days') || '28', 10);
    const days =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_DAYS)
        : 28;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // The previous window ends where this one starts. Same length, so a 28-day
    // window is compared against the 28 days before it and the weekday mix on
    // both sides matches.
    const prevEnd = new Date(startDate);
    const prevStart = new Date(startDate);
    prevStart.setDate(prevStart.getDate() - days);

    const [
      events,
      sessions,
      gates,
      gateConversion,
      sources,
      purchases,
      agents,
      prevEvents,
      prevSessions,
    ] = await Promise.all([
      getUserFunnel(startDate, endDate),
      getSessionFunnel(startDate, endDate),
      getGateMetrics(startDate, endDate),
      getGateConversion(startDate, endDate),
      getAcquisitionSources(startDate, endDate),
      getPurchases(startDate, endDate),
      getAgentRail(startDate, endDate),
      getUserFunnel(prevStart, prevEnd),
      getSessionFunnel(prevStart, prevEnd),
    ]);

    return NextResponse.json({
      days,
      events,
      sessions,
      gates,
      gateConversion,
      sources,
      purchases,
      agents,
      // Computed here rather than in the browser so the two rates have exactly
      // one definition in the codebase. See `conversionRates`.
      rates: conversionRates(events),
      previous: {
        events: prevEvents,
        sessions: prevSessions,
        rates: conversionRates(prevEvents),
      },
    });
  } catch (error) {
    console.error('Journey API error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch journey data',
      },
      { status: 500 }
    );
  }
}
