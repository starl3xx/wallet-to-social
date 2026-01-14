import { NextRequest } from 'next/server';
import { batchFetchWeb3Bio, type Web3BioResult } from '@/lib/web3bio';
import { batchFetchNeynar, type NeynarResult } from '@/lib/neynar';
import type { WalletSocialResult } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

interface LookupRequest {
  wallets: string[];
  originalData?: Record<string, Record<string, string>>;
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const body: LookupRequest = await request.json();
        const { wallets, originalData = {} } = body;

        if (!wallets || wallets.length === 0) {
          sendEvent('error', { message: 'No wallets provided' });
          controller.close();
          return;
        }

        const results = new Map<string, WalletSocialResult>();
        const neynarApiKey = process.env.NEYNAR_API_KEY;

        let web3BioProcessed = 0;
        let web3BioFound = 0;
        let neynarProcessed = 0;
        let neynarFound = 0;

        // Initialize results with original data
        for (const wallet of wallets) {
          const walletLower = wallet.toLowerCase();
          results.set(walletLower, {
            wallet: walletLower,
            source: [],
            ...(originalData[walletLower] || {}),
          });
        }

        sendEvent('progress', {
          stage: 'web3bio',
          processed: 0,
          total: wallets.length,
          twitterFound: 0,
          farcasterFound: 0,
          message: 'Starting Web3.bio lookups...',
        });

        // Fetch from Web3.bio
        const web3BioResults = await batchFetchWeb3Bio(wallets, (processed, found) => {
          web3BioProcessed = processed;
          web3BioFound = found;
          sendEvent('progress', {
            stage: 'web3bio',
            processed,
            total: wallets.length,
            twitterFound: found,
            farcasterFound: 0,
            message: `Web3.bio: ${processed}/${wallets.length} processed`,
          });
        });

        // Merge Web3.bio results
        for (const [wallet, data] of web3BioResults) {
          const existing = results.get(wallet)!;
          results.set(wallet, {
            ...existing,
            ens_name: data.ens_name || existing.ens_name,
            twitter_handle: data.twitter_handle || existing.twitter_handle,
            twitter_url: data.twitter_url || existing.twitter_url,
            farcaster: data.farcaster || existing.farcaster,
            farcaster_url: data.farcaster_url || existing.farcaster_url,
            lens: data.lens || existing.lens,
            github: data.github || existing.github,
            source: [...existing.source, 'web3bio'],
          });
        }

        // Fetch from Neynar if API key is configured
        if (neynarApiKey) {
          sendEvent('progress', {
            stage: 'neynar',
            processed: 0,
            total: wallets.length,
            twitterFound: web3BioFound,
            farcasterFound: 0,
            message: 'Starting Neynar lookups...',
          });

          try {
            const neynarResults = await batchFetchNeynar(
              wallets,
              neynarApiKey,
              (processed, found) => {
                neynarProcessed = processed;
                neynarFound = found;
                sendEvent('progress', {
                  stage: 'neynar',
                  processed,
                  total: wallets.length,
                  twitterFound: web3BioFound,
                  farcasterFound: found,
                  message: `Neynar: ${processed}/${wallets.length} processed`,
                });
              }
            );

            // Merge Neynar results
            for (const [wallet, data] of neynarResults) {
              const existing = results.get(wallet)!;
              results.set(wallet, {
                ...existing,
                twitter_handle: existing.twitter_handle || data.twitter_handle,
                twitter_url: existing.twitter_url || data.twitter_url,
                farcaster: data.farcaster || existing.farcaster,
                farcaster_url: data.farcaster_url || existing.farcaster_url,
                fc_followers: data.fc_followers,
                source: existing.source.includes('neynar')
                  ? existing.source
                  : [...existing.source, 'neynar'],
              });
            }
          } catch (error) {
            console.error('Neynar fetch error:', error);
            sendEvent('warning', {
              message: 'Neynar API error - continuing with Web3.bio results only',
            });
          }
        } else {
          sendEvent('warning', {
            message: 'Neynar API key not configured - skipping Farcaster lookups',
          });
        }

        // Calculate final stats
        const finalResults = Array.from(results.values());
        const twitterCount = finalResults.filter((r) => r.twitter_handle).length;
        const farcasterCount = finalResults.filter((r) => r.farcaster).length;

        sendEvent('complete', {
          results: finalResults,
          stats: {
            total: wallets.length,
            twitterFound: twitterCount,
            farcasterFound: farcasterCount,
            lensFound: finalResults.filter((r) => r.lens).length,
            githubFound: finalResults.filter((r) => r.github).length,
          },
        });
      } catch (error) {
        console.error('Lookup error:', error);
        sendEvent('error', {
          message: error instanceof Error ? error.message : 'Unknown error occurred',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
