'use client';

import type { AnalyticsEventType } from './analytics';

// Get or create a session ID for tracking
function getSessionId(): string {
  if (typeof window === 'undefined') return '';

  let sessionId = sessionStorage.getItem('analytics_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('analytics_session_id', sessionId);
  }
  return sessionId;
}

// Get user ID from localStorage
function getUserId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return localStorage.getItem('user_id') || localStorage.getItem('user_email') || undefined;
}

// Track an analytics event from the client
export async function trackClientEvent(
  eventType: AnalyticsEventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const userId = getUserId();
    const sessionId = getSessionId();

    // Fire and forget - don't await
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType,
        userId,
        sessionId,
        metadata,
      }),
    }).catch(() => {
      // Silently ignore errors
    });
  } catch {
    // Silently ignore errors - analytics should never break the app
  }
}

// Convenience functions for common events
export const Analytics = {
  pageView: (path: string) => trackClientEvent('page_view', { path }),

  csvUpload: (fileSize: number, rowCount: number) =>
    trackClientEvent('csv_upload', { fileSize, rowCount }),

  lookupStarted: (walletCount: number, tier: string, includeENS: boolean) =>
    trackClientEvent('lookup_started', { walletCount, tier, includeENS }),

  lookupCompleted: (walletCount: number, matchRate: number, durationMs: number) =>
    trackClientEvent('lookup_completed', { walletCount, matchRate, durationMs }),

  exportClicked: (format: 'csv' | 'twitter', resultCount: number) =>
    trackClientEvent('export_clicked', { format, resultCount }),

  historySaved: (lookupId: string, walletCount: number) =>
    trackClientEvent('history_saved', { lookupId, walletCount }),

  upgradeModalViewed: (trigger: string, currentTier: string) =>
    trackClientEvent('upgrade_modal_viewed', { trigger, currentTier }),

  checkoutStarted: (tier: 'starter' | 'pro' | 'unlimited') =>
    trackClientEvent('checkout_started', { tier }),

  limitHit: (tier: string, limit: number, attempted: number) =>
    trackClientEvent('limit_hit', { tier, limit, attempted }),
};
