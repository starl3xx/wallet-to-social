import { NextRequest, NextResponse } from 'next/server';
import { getStaleWallets } from '@/lib/social-graph';
import { createJob } from '@/lib/job-processor';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 60; // 1 minute max

// Refresh up to 100 stale wallets per cron run
const STALE_REFRESH_LIMIT = 100;

// Only refresh wallets that have been looked up frequently (5+ times)
const MIN_LOOKUP_COUNT = 5;

/**
 * Cron job to refresh stale social graph entries.
 *
 * This job:
 * 1. Finds wallets where staleAt < now AND lookupCount > 5 (frequently accessed)
 * 2. Creates a background job to re-fetch their data
 * 3. Runs daily via Vercel Cron
 *
 * The job system will handle the actual API calls and update staleAt upon completion.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret in production
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    // Get stale wallets that are frequently accessed
    const staleWallets = await getStaleWallets(STALE_REFRESH_LIMIT, MIN_LOOKUP_COUNT);

    if (staleWallets.length === 0) {
      return NextResponse.json({
        message: 'No stale wallets to refresh',
        refreshed: 0,
      });
    }

    console.log(`Found ${staleWallets.length} stale wallets to refresh`);

    // Create a job to refresh these wallets
    // The job processor will:
    // 1. Call APIs to get fresh data
    // 2. Update the social_graph table
    // 3. Reset staleAt to 30 days in the future
    const jobId = await createJob(
      staleWallets,
      {}, // No original data - this is a refresh job
      {
        includeENS: true, // Full refresh includes ENS
        saveToHistory: false, // Don't save to user history
        canUseNeynar: true,
        canUseENS: true,
        tier: 'unlimited', // System job has full access
        inputSource: 'api',
      }
    );

    // Track the refresh event
    trackEvent('social_graph_stale', {
      metadata: {
        jobId,
        walletCount: staleWallets.length,
        minLookupCount: MIN_LOOKUP_COUNT,
      },
    });

    console.log(`Created refresh job ${jobId} for ${staleWallets.length} wallets`);

    return NextResponse.json({
      message: `Queued ${staleWallets.length} stale wallets for refresh`,
      jobId,
      walletCount: staleWallets.length,
    });
  } catch (error) {
    console.error('Stale refresh error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Refresh failed' },
      { status: 500 }
    );
  }
}

// Also support GET for manual triggering
export async function GET(request: NextRequest) {
  return POST(request);
}
