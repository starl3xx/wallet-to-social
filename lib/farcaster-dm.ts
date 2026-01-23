/**
 * Farcaster DM sending library
 * Uses server proxy to avoid CORS issues with Warpcast API
 * API key is passed through but never stored on server
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
 * Send a single Farcaster DM via server proxy (avoids CORS issues)
 * Returns { success: true } or { success: false, error: string }
 */
export async function sendFarcasterDM(
  apiKey: string,
  recipientFid: number,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const idempotencyKey = generateIdempotencyKey();

  try {
    const response = await fetch('/api/farcaster-dm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'send',
        apiKey,
        recipientFid,
        message,
        idempotencyKey,
      }),
    });

    const data = await response.json();

    if (data.success) {
      return { success: true };
    }

    return { success: false, error: data.error || 'Unknown error' };
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

  // Helper to emit progress with new object reference (required for React re-render)
  const emitProgress = () => {
    onProgress({
      ...progress,
      failedRecipients: [...progress.failedRecipients],
      log: [...progress.log],
    });
  };

  emitProgress();

  for (let i = 0; i < recipients.length; i++) {
    // Check for cancellation
    if (signal?.aborted) {
      progress.status = 'cancelled';
      emitProgress();
      return progress;
    }

    const recipient = recipients[i];
    const renderedMessage = renderTemplate(messageTemplate, recipient);
    progress.currentUsername = recipient.username;
    emitProgress();

    let success = false;
    let lastError: string | undefined;
    let backoff = INITIAL_BACKOFF_MS;

    // Retry logic with exponential backoff
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        progress.status = 'cancelled';
        emitProgress();
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
        emitProgress();
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

    emitProgress();

    // Rate limit delay before next DM
    if (i < recipients.length - 1) {
      await sleep(DM_DELAY_MS);
    }
  }

  progress.status = 'complete';
  progress.currentUsername = undefined;
  emitProgress();

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
 * Keys typically start with wc_secret_ followed by a long hex string
 */
export function validateApiKey(apiKey: string): boolean {
  // Accept wc_secret_ prefix format or general long alphanumeric
  if (apiKey.startsWith('wc_secret_')) {
    return apiKey.length >= 40;
  }
  return apiKey.length >= 20 && /^[a-zA-Z0-9_-]+$/.test(apiKey);
}

/**
 * Test API key - validates format for wc_secret_ keys
 * The /v2/me endpoint doesn't work with Direct Cast API keys,
 * so we validate format and test on first actual send
 */
export async function testApiKey(apiKey: string): Promise<{ valid: boolean; error?: string; username?: string }> {
  // For wc_secret_ keys, just validate format - API test doesn't work
  if (apiKey.startsWith('wc_secret_')) {
    if (validateApiKey(apiKey)) {
      return { valid: true };
    }
    return { valid: false, error: 'Invalid key format' };
  }

  // For other key formats, try the API test
  try {
    const response = await fetch('/api/farcaster-dm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'test',
        apiKey,
      }),
    });

    const data = await response.json();

    if (data.valid) {
      return { valid: true, username: data.username };
    }
    return { valid: false, error: data.error || 'Invalid API key' };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
