/**
 * Client-side Farcaster DM sending library
 * Uses Warpcast API directly from browser - user's API key never touches server
 */

import type { WalletSocialResult } from './types';

export interface DMRecipient {
  fid: number;
  username: string;
  wallet: string;
  holdings?: number;
  ens?: string;
}

export interface DMLogEntry {
  timestamp: string;
  fid: number;
  username: string;
  status: 'sent' | 'failed';
  error?: string;
  message: string; // Rendered message with variables
}

export interface DMProgress {
  total: number;
  sent: number;
  failed: number;
  status: 'idle' | 'sending' | 'paused' | 'complete' | 'cancelled';
  currentUsername?: string;
  failedRecipients: DMRecipient[];
  log: DMLogEntry[];
}

// Rate limiting configuration
const DM_DELAY_MS = 250; // 250ms between DMs (~4/second)
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/**
 * Generate a UUID v4 for idempotency keys
 */
function generateIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Truncate wallet address for display (0x1234...5678)
 */
function truncateWallet(wallet: string): string {
  if (!wallet || wallet.length < 10) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

/**
 * Format holdings number with commas and reasonable precision
 */
function formatHoldings(holdings: number | undefined): string {
  if (holdings === undefined || holdings === null) return '';
  if (holdings >= 1000000) {
    return `${(holdings / 1000000).toFixed(2)}M`;
  }
  if (holdings >= 1000) {
    return `${(holdings / 1000).toFixed(2)}K`;
  }
  return holdings.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Render template variables in a message
 * Supported: {{username}}, {{holdings}}, {{ens}}, {{wallet}}
 */
export function renderTemplate(template: string, recipient: DMRecipient): string {
  return template
    .replace(/\{\{username\}\}/gi, recipient.username || '')
    .replace(/\{\{holdings\}\}/gi, formatHoldings(recipient.holdings))
    .replace(/\{\{ens\}\}/gi, recipient.ens || '')
    .replace(/\{\{wallet\}\}/gi, truncateWallet(recipient.wallet));
}

/**
 * Extract DM-eligible recipients from lookup results
 * Only includes wallets with fc_fid set (they have Farcaster accounts)
 */
export function extractDMRecipients(results: WalletSocialResult[]): DMRecipient[] {
  return results
    .filter((r) => r.fc_fid && r.farcaster)
    .map((r) => ({
      fid: r.fc_fid!,
      username: r.farcaster!,
      wallet: r.wallet,
      holdings: r.holdings,
      ens: r.ens_name,
    }));
}

/**
 * Send a single Farcaster DM via Warpcast API
 * Returns { success: true } or { success: false, error: string }
 */
export async function sendFarcasterDM(
  apiKey: string,
  recipientFid: number,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const idempotencyKey = generateIdempotencyKey();

  try {
    const response = await fetch('https://api.warpcast.com/v2/ext-send-direct-cast', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipientFid,
        message,
        idempotencyKey,
      }),
    });

    if (response.ok) {
      return { success: true };
    }

    // Handle specific error codes
    if (response.status === 401) {
      return { success: false, error: 'Invalid API key' };
    }
    if (response.status === 429) {
      return { success: false, error: 'Rate limited' };
    }
    if (response.status === 400) {
      // Try to parse error message
      try {
        const data = await response.json();
        return { success: false, error: data.message || 'Bad request (user may not accept DMs)' };
      } catch {
        return { success: false, error: 'Bad request (user may not accept DMs)' };
      }
    }

    return { success: false, error: `HTTP ${response.status}` };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send DMs to a batch of recipients with progress updates
 * Supports cancellation via AbortSignal
 */
export async function sendBatchDMs(
  apiKey: string,
  recipients: DMRecipient[],
  messageTemplate: string,
  onProgress: (progress: DMProgress) => void,
  signal?: AbortSignal
): Promise<DMProgress> {
  const progress: DMProgress = {
    total: recipients.length,
    sent: 0,
    failed: 0,
    status: 'sending',
    failedRecipients: [],
    log: [],
  };

  onProgress(progress);

  for (let i = 0; i < recipients.length; i++) {
    // Check for cancellation
    if (signal?.aborted) {
      progress.status = 'cancelled';
      onProgress(progress);
      return progress;
    }

    const recipient = recipients[i];
    const renderedMessage = renderTemplate(messageTemplate, recipient);
    progress.currentUsername = recipient.username;
    onProgress(progress);

    let success = false;
    let lastError: string | undefined;
    let backoff = INITIAL_BACKOFF_MS;

    // Retry logic with exponential backoff
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        progress.status = 'cancelled';
        onProgress(progress);
        return progress;
      }

      const result = await sendFarcasterDM(apiKey, recipient.fid, renderedMessage);

      if (result.success) {
        success = true;
        break;
      }

      lastError = result.error;

      // Don't retry on auth errors or bad requests
      if (result.error === 'Invalid API key') {
        // Fatal error - stop all sending
        progress.status = 'cancelled';
        progress.log.push({
          timestamp: new Date().toISOString(),
          fid: recipient.fid,
          username: recipient.username,
          status: 'failed',
          error: 'Invalid API key - stopping all DMs',
          message: renderedMessage,
        });
        progress.failed++;
        progress.failedRecipients.push(recipient);
        onProgress(progress);
        return progress;
      }

      if (result.error?.includes('Bad request')) {
        // Don't retry bad requests
        break;
      }

      // Rate limited or transient error - backoff and retry
      if (attempt < MAX_RETRIES - 1) {
        await sleep(Math.min(backoff, MAX_BACKOFF_MS));
        backoff *= 2;
      }
    }

    // Log result
    const logEntry: DMLogEntry = {
      timestamp: new Date().toISOString(),
      fid: recipient.fid,
      username: recipient.username,
      status: success ? 'sent' : 'failed',
      error: success ? undefined : lastError,
      message: renderedMessage,
    };
    progress.log.push(logEntry);

    if (success) {
      progress.sent++;
    } else {
      progress.failed++;
      progress.failedRecipients.push(recipient);
    }

    onProgress(progress);

    // Rate limit delay before next DM
    if (i < recipients.length - 1) {
      await sleep(DM_DELAY_MS);
    }
  }

  progress.status = 'complete';
  progress.currentUsername = undefined;
  onProgress(progress);

  return progress;
}

/**
 * Export DM log as CSV string
 */
export function exportLogAsCSV(log: DMLogEntry[]): string {
  const headers = ['timestamp', 'fid', 'username', 'status', 'error', 'message'];
  const escapeCSV = (value: string | number | undefined): string => {
    if (value === undefined || value === null) return '';
    const str = String(value);
    // Escape quotes and wrap in quotes if contains comma, quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = log.map((entry) =>
    headers.map((h) => escapeCSV(entry[h as keyof DMLogEntry])).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Validate Warpcast API key format
 */
export function validateApiKey(apiKey: string): boolean {
  // Warpcast API keys are typically long alphanumeric strings
  return apiKey.length >= 20 && /^[a-zA-Z0-9_-]+$/.test(apiKey);
}

/**
 * Test API key by making a simple authenticated request
 */
export async function testApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // Use the user profile endpoint to test the key
    const response = await fetch('https://api.warpcast.com/v2/me', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return { valid: true };
    }
    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
    }
    return { valid: false, error: `Unexpected response: ${response.status}` };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
