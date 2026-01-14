import { NextRequest, NextResponse } from 'next/server';
import { createJob } from '@/lib/job-processor';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';

interface JobRequest {
  wallets: string[];
  originalData?: Record<string, Record<string, string>>;
  saveToHistory?: boolean;
  historyName?: string;
  includeENS?: boolean;
  userId?: string;
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

    // Create job in database
    const jobId = await createJob(wallets, originalData, {
      includeENS,
      saveToHistory,
      historyName,
      userId,
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
