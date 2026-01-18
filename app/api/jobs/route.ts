import { NextRequest, NextResponse } from 'next/server';
import { createJob } from '@/lib/job-processor';
import { inngest } from '@/inngest/client';
import { getUserAccess } from '@/lib/access';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';

interface JobRequest {
  wallets: string[];
  originalData?: Record<string, Record<string, string>>;
  saveToHistory?: boolean;
  historyName?: string;
  includeENS?: boolean;
  userId?: string;
  email?: string;
  wallet?: string;
  inputSource?: 'file_upload' | 'text_input' | 'api';
}

export async function POST(request: NextRequest) {
  try {
    const body: JobRequest = await request.json();
    const {
      wallets,
      originalData = {},
      saveToHistory = false,
      historyName,
      includeENS = false,
      userId,
      email,
      wallet,
      inputSource,
    } = body;

    if (!wallets || wallets.length === 0) {
      return NextResponse.json(
        { error: 'No wallets provided' },
        { status: 400 }
      );
    }

    // Check if database is configured
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured - job queue requires DATABASE_URL' },
        { status: 500 }
      );
    }

    // Check user access and tier limits
    const access = await getUserAccess(email, wallet);

    if (wallets.length > access.walletLimit) {
      // Track limit hit event
      trackEvent('limit_hit', {
        userId: email || userId,
        metadata: {
          tier: access.tier,
          limit: access.walletLimit,
          attempted: wallets.length,
        },
      });

      return NextResponse.json(
        {
          error: `${access.tier.charAt(0).toUpperCase() + access.tier.slice(1)} tier limited to ${access.walletLimit.toLocaleString()} wallets`,
          upgradeRequired: true,
          tier: access.tier,
          limit: access.walletLimit,
          requested: wallets.length,
        },
        { status: 403 }
      );
    }

    // Create job in database with tier context
    const jobId = await createJob(wallets, originalData, {
      includeENS: includeENS && access.canUseENS,
      saveToHistory,
      historyName,
      userId,
      tier: access.tier,
      canUseNeynar: access.canUseNeynar,
      canUseENS: access.canUseENS,
      inputSource,
    });

    // Track lookup started event
    trackEvent('lookup_started', {
      userId: email || userId,
      metadata: {
        jobId,
        walletCount: wallets.length,
        tier: access.tier,
        includeENS: includeENS && access.canUseENS,
        saveToHistory,
      },
    });

    // Trigger Inngest function for immediate processing
    // Falls back to cron worker if Inngest is not configured
    try {
      await inngest.send({
        name: 'wallet/lookup.requested',
        data: { jobId },
      });
    } catch (error) {
      // Inngest not configured or failed - cron worker will pick up the job
      console.log('Inngest trigger skipped (cron will process):', error instanceof Error ? error.message : error);
    }

    return NextResponse.json({
      jobId,
      status: 'pending',
      walletCount: wallets.length,
      message: 'Job queued for processing',
    });
  } catch (error) {
    console.error('Job creation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create job' },
      { status: 500 }
    );
  }
}
