import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { batchFetchWeb3Bio } from '@/lib/web3bio';
import { batchFetchNeynar } from '@/lib/neynar';
import { batchLookupENS } from '@/lib/ens';
import { getCachedWallets, cacheWalletResults } from '@/lib/cache';
import { saveLookup } from '@/lib/history';
import {
  upsertSocialGraph,
  getSocialGraphData,
  socialGraphToResult,
} from '@/lib/social-graph';
import {
  findHoldingsColumn,
  parseHoldingsValue,
  calculatePriorityScore,
} from '@/lib/csv-parser';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import {
  checkIpRateLimit,
  getClientIp,
  formatRateLimitHeaders,
} from '@/lib/ip-rate-limiter';
import type { WalletSocialResult } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

interface LookupRequest {
  wallets: string[];
  originalData?: Record<string, Record<string, string>>;
  saveToHistory?: boolean;
  historyName?: string;
  includeENS?: boolean;
}

export async function POST(request: NextRequest) {
  // Check for authenticated session - authenticated users bypass IP rate limits
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await validateSession(sessionToken) : { user: null };

  // Apply IP rate limiting only for unauthenticated requests
  if (!session.user) {
    const clientIp = getClientIp(request);
    const rateLimitResult = await checkIpRateLimit(clientIp, '/api/lookup');

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Sign in for unlimited access.',
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: formatRateLimitHeaders(rateLimitResult),
        }
      );
    }
  }
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
        const {
          wallets,
          originalData = {},
          saveToHistory = false,
          historyName,
          includeENS = false,
        } = body;

        if (!wallets || wallets.length === 0) {
          sendEvent('error', { message: 'No wallets provided' });
          controller.close();
          return;
        }

        const results = new Map<string, WalletSocialResult>();
        const neynarApiKey = process.env.NEYNAR_API_KEY;
        const dbConfigured = !!process.env.DATABASE_URL;

        // Detect holdings column from original data
        const firstWallet = wallets[0]?.toLowerCase();
        const firstData = originalData[firstWallet] || {};
        const dataColumns = Object.keys(firstData);
        const holdingsColumn = findHoldingsColumn(dataColumns);

        // Initialize results with original data and parsed holdings
        for (const wallet of wallets) {
          const walletLower = wallet.toLowerCase();
          const walletData = originalData[walletLower] || {};

          // Parse holdings from the detected column
          let holdings: number | undefined;
          if (holdingsColumn && walletData[holdingsColumn]) {
            holdings =
              parseHoldingsValue(walletData[holdingsColumn]) ?? undefined;
          }

          results.set(walletLower, {
            wallet: walletLower,
            source: [],
            holdings,
            ...walletData,
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
            uncachedWallets = wallets.filter(
              (w) => !cached.has(w.toLowerCase())
            );

            sendEvent('progress', {
              stage: 'cache',
              processed: wallets.length,
              total: wallets.length,
              twitterFound: Array.from(cached.values()).filter(
                (r) => r.twitter_handle
              ).length,
              farcasterFound: Array.from(cached.values()).filter(
                (r) => r.farcaster
              ).length,
              message: `Cache: ${cacheHits} hits, ${uncachedWallets.length} to lookup`,
            });
          } catch (error) {
            console.error('Cache error:', error);
            sendEvent('warning', {
              message: 'Cache unavailable, fetching all wallets',
            });
          }
        }

        // Only fetch uncached wallets
        if (uncachedWallets.length > 0) {
          // ENS lookups (optional, most reliable for Twitter)
          if (includeENS) {
            sendEvent('progress', {
              stage: 'ens',
              processed: 0,
              total: uncachedWallets.length,
              twitterFound: 0,
              farcasterFound: 0,
              message: 'Starting ENS onchain lookups...',
            });

            try {
              const ensResults = await batchLookupENS(
                uncachedWallets,
                (processed, found) => {
                  sendEvent('progress', {
                    stage: 'ens',
                    processed,
                    total: uncachedWallets.length,
                    twitterFound: found,
                    farcasterFound: 0,
                    message: `ENS: ${processed}/${uncachedWallets.length} processed`,
                  });
                }
              );

              // Merge ENS results (highest priority for Twitter)
              for (const [wallet, data] of ensResults) {
                const existing = results.get(wallet)!;
                results.set(wallet, {
                  ...existing,
                  ens_name: data.ensName || existing.ens_name,
                  twitter_handle: data.twitter || existing.twitter_handle,
                  twitter_url: data.twitterUrl || existing.twitter_url,
                  github: data.github || existing.github,
                  source: [...existing.source, 'ens'],
                });
              }
            } catch (error) {
              console.error('ENS lookup error:', error);
              sendEvent('warning', {
                message: 'ENS lookup failed - continuing with other sources',
              });
            }
          }

          // Web3.bio lookups
          sendEvent('progress', {
            stage: 'web3bio',
            processed: 0,
            total: uncachedWallets.length,
            twitterFound: 0,
            farcasterFound: 0,
            message: 'Starting Web3.bio lookups...',
          });

          const web3BioResults = await batchFetchWeb3Bio(
            uncachedWallets,
            (processed, found) => {
              sendEvent('progress', {
                stage: 'web3bio',
                processed,
                total: uncachedWallets.length,
                twitterFound: found,
                farcasterFound: 0,
                message: `Web3.bio: ${processed}/${uncachedWallets.length} processed`,
              });
            }
          );

          // Merge Web3.bio results (fills gaps from ENS)
          for (const [wallet, data] of web3BioResults) {
            const existing = results.get(wallet)!;
            results.set(wallet, {
              ...existing,
              ens_name: existing.ens_name || data.ens_name,
              twitter_handle: existing.twitter_handle || data.twitter_handle,
              twitter_url: existing.twitter_url || data.twitter_url,
              farcaster: data.farcaster || existing.farcaster,
              farcaster_url: data.farcaster_url || existing.farcaster_url,
              lens: data.lens || existing.lens,
              github: existing.github || data.github,
              source: existing.source.includes('web3bio')
                ? existing.source
                : [...existing.source, 'web3bio'],
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
                  twitter_handle:
                    existing.twitter_handle || data.twitter_handle,
                  twitter_url: existing.twitter_url || data.twitter_url,
                  farcaster: data.farcaster || existing.farcaster,
                  farcaster_url: data.farcaster_url || existing.farcaster_url,
                  fc_followers: data.fc_followers,
                  fc_fid: data.fc_fid,
                  source: existing.source.includes('neynar')
                    ? existing.source
                    : [...existing.source, 'neynar'],
                });
              }
            } catch (error) {
              console.error('Neynar fetch error:', error);
              sendEvent('warning', {
                message: 'Neynar API error - continuing with other results',
              });
            }
          } else {
            sendEvent('warning', {
              message:
                'Neynar API key not configured - skipping Farcaster lookups',
            });
          }

          // Cache newly fetched results
          if (dbConfigured) {
            try {
              const newResults = uncachedWallets
                .map((w) => results.get(w.toLowerCase())!)
                .filter(
                  (r) => r.source.length > 0 && !r.source.includes('cache')
                );

              if (newResults.length > 0) {
                await cacheWalletResults(newResults);
                sendEvent('info', {
                  message: `Cached ${newResults.length} new results`,
                });
              }
            } catch (error) {
              console.error('Cache write error:', error);
            }
          }
        }

        // Enrich results with social graph data (backfill gaps from permanent storage)
        if (dbConfigured) {
          try {
            const graphData = await getSocialGraphData(wallets);

            if (graphData.size > 0) {
              let enriched = 0;
              for (const [wallet, result] of results) {
                const stored = graphData.get(wallet);
                if (stored) {
                  const storedData = socialGraphToResult(stored);
                  let wasEnriched = false;

                  // Only fill gaps - don't overwrite fresh API data
                  if (!result.ens_name && storedData.ens_name) {
                    result.ens_name = storedData.ens_name;
                    wasEnriched = true;
                  }
                  if (!result.twitter_handle && storedData.twitter_handle) {
                    result.twitter_handle = storedData.twitter_handle;
                    result.twitter_url = storedData.twitter_url;
                    wasEnriched = true;
                  }
                  if (!result.farcaster && storedData.farcaster) {
                    result.farcaster = storedData.farcaster;
                    result.farcaster_url = storedData.farcaster_url;
                    result.fc_followers = storedData.fc_followers;
                    result.fc_fid = storedData.fc_fid;
                    wasEnriched = true;
                  }
                  if (!result.lens && storedData.lens) {
                    result.lens = storedData.lens;
                    wasEnriched = true;
                  }
                  if (!result.github && storedData.github) {
                    result.github = storedData.github;
                    wasEnriched = true;
                  }

                  if (wasEnriched) {
                    result.source = [...result.source, 'graph'];
                    enriched++;
                  }

                  results.set(wallet, result);
                }
              }

              if (enriched > 0) {
                sendEvent('info', {
                  message: `Enriched ${enriched} results from social graph`,
                });
              }
            }
          } catch (error) {
            console.error('Social graph enrichment error:', error);
          }
        }

        // Calculate priority scores for all results
        for (const [wallet, result] of results) {
          result.priority_score = calculatePriorityScore(
            result.holdings,
            result.fc_followers
          );
          results.set(wallet, result);
        }

        // Calculate final stats
        const finalResults = Array.from(results.values());
        const twitterCount = finalResults.filter(
          (r) => r.twitter_handle
        ).length;
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

        // Persist positive results to social graph (permanent storage)
        if (dbConfigured) {
          try {
            const positiveResults = finalResults.filter(
              (r) =>
                r.twitter_handle ||
                r.farcaster ||
                r.lens ||
                r.github ||
                r.ens_name
            );

            if (positiveResults.length > 0) {
              const saved = await upsertSocialGraph(positiveResults);
              if (saved > 0) {
                sendEvent('info', {
                  message: `Updated ${saved} entries in social graph`,
                });
              }
            }
          } catch (error) {
            console.error('Social graph persist error:', error);
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
          message:
            error instanceof Error ? error.message : 'Unknown error occurred',
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
