import { NextRequest } from 'next/server';
import { batchFetchWeb3Bio } from '@/lib/web3bio';
import { batchFetchNeynar } from '@/lib/neynar';
import { getCachedWallets, cacheWalletResults } from '@/lib/cache';
import { saveLookup } from '@/lib/history';
import type { WalletSocialResult } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

interface LookupRequest {
  wallets: string[];
  originalData?: Record<string, Record<string, string>>;
  saveToHistory?: boolean;
  historyName?: string;
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
        const { wallets, originalData = {}, saveToHistory = false, historyName } = body;

        if (!wallets || wallets.length === 0) {
          sendEvent('error', { message: 'No wallets provided' });
          controller.close();
          return;
        }

        const results = new Map<string, WalletSocialResult>();
        const neynarApiKey = process.env.NEYNAR_API_KEY;
        const dbConfigured = !!process.env.DATABASE_URL;

        // Initialize results with original data
        for (const wallet of wallets) {
          const walletLower = wallet.toLowerCase();
          results.set(walletLower, {
            wallet: walletLower,
            source: [],
            ...(originalData[walletLower] || {}),
          });
        }

        // Check cache first
        let uncachedWallets = wallets;
        let cacheHits = 0;

        if (dbConfigured) {
          sendEvent('progress', {
            stage: 'cache',
            processed: 0,
            total: wallets.length,
            twitterFound: 0,
            farcasterFound: 0,
            message: 'Checking cache...',
          });

          try {
            const cached = await getCachedWallets(wallets);
            cacheHits = cached.size;

            // Merge cached results
            for (const [wallet, data] of cached) {
              const existing = results.get(wallet)!;
              results.set(wallet, {
                ...existing,
                ...data,
                source: [...data.source, 'cache'],
              });
            }

            // Filter to uncached wallets only
            uncachedWallets = wallets.filter(w => !cached.has(w.toLowerCase()));

            sendEvent('progress', {
              stage: 'cache',
              processed: wallets.length,
              total: wallets.length,
              twitterFound: Array.from(cached.values()).filter(r => r.twitter_handle).length,
              farcasterFound: Array.from(cached.values()).filter(r => r.farcaster).length,
              message: `Cache: ${cacheHits} hits, ${uncachedWallets.length} to lookup`,
            });
          } catch (error) {
            console.error('Cache error:', error);
            sendEvent('warning', { message: 'Cache unavailable, fetching all wallets' });
          }
        }

        // Only fetch uncached wallets
        if (uncachedWallets.length > 0) {
          sendEvent('progress', {
            stage: 'web3bio',
            processed: 0,
            total: uncachedWallets.length,
            twitterFound: 0,
            farcasterFound: 0,
            message: 'Starting Web3.bio lookups...',
          });

          // Fetch from Web3.bio
          const web3BioResults = await batchFetchWeb3Bio(uncachedWallets, (processed, found) => {
            sendEvent('progress', {
              stage: 'web3bio',
              processed,
              total: uncachedWallets.length,
              twitterFound: found,
              farcasterFound: 0,
              message: `Web3.bio: ${processed}/${uncachedWallets.length} processed`,
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
              total: uncachedWallets.length,
              twitterFound: web3BioResults.size,
              farcasterFound: 0,
              message: 'Starting Neynar lookups...',
            });

            try {
              const neynarResults = await batchFetchNeynar(
                uncachedWallets,
                neynarApiKey,
                (processed, found) => {
                  sendEvent('progress', {
                    stage: 'neynar',
                    processed,
                    total: uncachedWallets.length,
                    twitterFound: web3BioResults.size,
                    farcasterFound: found,
                    message: `Neynar: ${processed}/${uncachedWallets.length} processed`,
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

          // Cache newly fetched results
          if (dbConfigured) {
            try {
              const newResults = uncachedWallets
                .map(w => results.get(w.toLowerCase())!)
                .filter(r => r.source.length > 0 && !r.source.includes('cache'));

              if (newResults.length > 0) {
                await cacheWalletResults(newResults);
                sendEvent('info', { message: `Cached ${newResults.length} new results` });
              }
            } catch (error) {
              console.error('Cache write error:', error);
            }
          }
        }

        // Calculate final stats
        const finalResults = Array.from(results.values());
        const twitterCount = finalResults.filter((r) => r.twitter_handle).length;
        const farcasterCount = finalResults.filter((r) => r.farcaster).length;

        // Save to history if requested
        let historyId: string | undefined;
        if (saveToHistory && dbConfigured) {
          try {
            const savedId = await saveLookup(finalResults, historyName);
            if (savedId) historyId = savedId;
          } catch (error) {
            console.error('History save error:', error);
          }
        }

        sendEvent('complete', {
          results: finalResults,
          stats: {
            total: wallets.length,
            twitterFound: twitterCount,
            farcasterFound: farcasterCount,
            lensFound: finalResults.filter((r) => r.lens).length,
            githubFound: finalResults.filter((r) => r.github).length,
            cacheHits,
          },
          historyId,
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
