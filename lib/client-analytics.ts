'use client';

import type { AnalyticsEventType } from './analytics';
import type { PaidTier } from '@/lib/access';
import type { PackId } from '@/lib/packs';

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
  return (
    localStorage.getItem('user_id') ||
    localStorage.getItem('user_email') ||
    undefined
  );
}

// Track an analytics event from the client
export async function trackClientEvent(
  eventType: AnalyticsEventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const userId = getUserId();
    const sessionId = getSessionId();
    const body = JSON.stringify({ eventType, userId, sessionId, metadata });

    // `keepalive` matters for events fired immediately before navigating away —
    // checkout_redirected is sent and then window.location.href is set, and a
    // plain fetch is commonly aborted on unload, which would lose exactly the
    // event we added to tell "reached Stripe" apart from "checkout errored".
    // sendBeacon is preferred where available since it is designed for this.
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      const queued = navigator.sendBeacon(
        '/api/analytics/track',
        new Blob([body], { type: 'application/json' })
      );
      if (queued) return;
    }

    // Fire and forget - don't await
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Silently ignore errors
    });
  } catch {
    // Silently ignore errors - analytics should never break the app
  }
}

// Convenience functions for common events
export const Analytics = {
  // `ref` is the campaign tag from a ?ref= query param, when one is present:
  // the join between "we sent a link" and "somebody arrived through it".
  pageView: (path: string, ref?: string | null) =>
    trackClientEvent('page_view', ref ? { path, ref } : { path }),

  csvUpload: (fileSize: number, rowCount: number) =>
    trackClientEvent('csv_upload', { fileSize, rowCount }),

  lookupStarted: (walletCount: number, tier: string, includeENS: boolean) =>
    trackClientEvent('lookup_started', { walletCount, tier, includeENS }),

  lookupCompleted: (
    walletCount: number,
    matchRate: number,
    durationMs: number
  ) =>
    trackClientEvent('lookup_completed', {
      walletCount,
      matchRate,
      durationMs,
    }),

  exportClicked: (
    format: 'csv' | 'twitter' | 'share_twitter' | 'share_farcaster',
    resultCount: number
  ) => trackClientEvent('export_clicked', { format, resultCount }),

  historySaved: (lookupId: string, walletCount: number) =>
    trackClientEvent('history_saved', { lookupId, walletCount }),

  upgradeModalViewed: (trigger: string, currentTier: string) =>
    trackClientEvent('upgrade_modal_viewed', { trigger, currentTier }),

  /**
   * `sku` is a pack id now, and was a tier id before packs existed.
   *
   * Kept as one event rather than split into `pack_checkout_started`, because
   * the funnel question is "how many people who opened the modal reached
   * Stripe", and that question does not care what they were buying. Splitting
   * would break the comparison across the pricing change, which is the one
   * comparison worth having.
   *
   * The property stays named `tier` in the payload for the same reason: 261
   * historical modal views and their downstream events are keyed on it, and
   * renaming the field would orphan them.
   */
  checkoutStarted: (sku: PaidTier | PackId) =>
    trackClientEvent('checkout_started', { tier: sku }),

  /** Fired once Stripe has actually handed us a session URL. */
  checkoutRedirected: (sku: PaidTier | PackId) =>
    trackClientEvent('checkout_redirected', { tier: sku }),

  /** Fired when checkout never reached Stripe, with the reason. */
  checkoutFailed: (sku: PaidTier | PackId, reason: string) =>
    trackClientEvent('checkout_failed', { tier: sku, reason }),

  limitHit: (tier: string, limit: number, attempted: number) =>
    trackClientEvent('limit_hit', { tier, limit, attempted }),
};
