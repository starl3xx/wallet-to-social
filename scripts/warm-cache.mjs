#!/usr/bin/env node
/**
 * Fills the page cache after a production deploy, before crawlers do.
 *
 * Holder reports (`app/holders/[chain]/[address]/page.tsx`) prerender nothing
 * at build time and cache each render for an hour. Every deployment starts
 * with an empty cache, and main deploys several times a day (36 production
 * deployments in the seven days to 2026-09-29). Measured on 2026-09-29: one
 * uncached report takes 2.3 to 3.8 s, eight fetched at once take 4.5 to 31.3 s
 * each (median about 16 s), and a cached one takes 0.16 s. A crawler that
 * arrives first pays for the renders; this pays for them instead, two at a
 * time, right after the deploy goes live.
 *
 * Three steps, each bounded, because nothing waits on this and nothing may
 * keep it running:
 *
 *   1. Wait for the domain to serve the new deployment. Vercel reports a
 *      deployment done when it is built, and warming the domain a moment
 *      before it moves would fill the old deployment's cache. The page names
 *      its deployment in every asset URL (`?dpl=dpl_…`, skew protection), and
 *      the commit's `Vercel` status names the same id in its link. At most
 *      ALIAS_WAIT_MS, then it warms whatever is live.
 *   2. Read the sitemap: SITEMAP_ATTEMPTS tries, no more.
 *   3. GET each page, CONCURRENCY at a time, each cut off at
 *      REQUEST_TIMEOUT_MS, and start none after WARM_BUDGET_MS. A lane pauses
 *      after a stale answer (warmPaced), so background renders stay near
 *      CONCURRENCY too.
 *
 * The bounds add up to less than the workflow's timeout-minutes, which is
 * only the backstop; `scripts/check-invariants.ts` adds them up.
 *
 * It logs counts, the cache status Vercel reported and the slowest paths.
 * Never a page body: the body is read to the end, because a streamed render
 * is complete only when its stream is, and then dropped.
 *
 * A page that errors or times out is a warning, not a failure: the deploy is
 * live before this starts, and the next visitor renders that page as they
 * would have anyway.
 *
 * Run: node scripts/warm-cache.mjs
 * CI: .github/workflows/cache-warm.yml, after each successful production
 * deployment. Without DEPLOY_SHA (a local run) step 1 is skipped.
 */
import { appendFileSync } from 'fs';
import { pathToFileURL } from 'url';

/** The live site. `scripts/check-invariants.ts` holds it to PRODUCTION_URL. */
export const ORIGIN = 'https://walletlink.social';

/** Warmed first, whatever the sitemap says. */
export const FIXED_PATHS = ['/', '/pricing', '/mcp', '/vs', '/blog'];
export const HUB_PATH = '/holders';

/**
 * Two at a time. Eight at once is what took a median of 16 s a page; one at a
 * time took 2.3 to 3.8 s, a normal render.
 */
export const CONCURRENCY = 2;
export const REQUEST_TIMEOUT_MS = 60_000;
export const WARM_BUDGET_MS = 15 * 60_000;
export const ALIAS_WAIT_MS = 5 * 60_000;
export const ALIAS_POLL_MS = 15_000;
export const SITEMAP_ATTEMPTS = 3;
export const SITEMAP_BACKOFF_MS = 10_000;
export const STATUS_TIMEOUT_MS = 30_000;
/** About one uncached render; see warmPaced. */
export const STALE_PAUSE_MS = 3_000;

const SLOW_MS = 10_000;
const USER_AGENT =
  'walletlink-cache-warm (+https://github.com/starl3xx/wallet-to-social/blob/main/.github/workflows/cache-warm.yml)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/**
 * The pages to warm, in order: the fixed pages, the hub, then every holder
 * report in the sitemap, highest sitemap priority first, so that a run cut
 * short by its budget has done the reports with the most reachable people.
 * Only URLs on `origin` are taken; a sitemap entry anywhere else is skipped.
 */
export function warmTargets(sitemapXml, origin = ORIGIN) {
  const reports = [];
  for (const entry of sitemapXml.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
    const loc = entry.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    let url;
    try {
      url = new URL(loc);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (!/^\/holders\/[^/]+\/[^/]+$/.test(url.pathname)) continue;
    const priority = Number(
      entry.match(/<priority>\s*([0-9.]+)\s*<\/priority>/)?.[1] ?? 0
    );
    reports.push({ path: url.pathname, priority });
  }
  reports.sort((a, b) => b.priority - a.priority);
  return [
    ...new Set([...FIXED_PATHS, HUB_PATH, ...reports.map((r) => r.path)]),
  ];
}

/**
 * Runs `worker` over `items`, at most `limit` at a time, and starts nothing
 * once `deadline` (epoch ms) has passed. Results come back in item order; an
 * item that was never started is left `undefined`.
 */
export async function runPool(items, limit, worker, deadline = Infinity) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      if (Date.now() >= deadline) return;
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, lane)
  );
  return results;
}

/** One GET, cut off at `timeoutMs` including the body. Never throws. */
export async function warmOne(
  path,
  { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS, origin = ORIGIN } = {}
) {
  const started = Date.now();
  try {
    const res = await fetchImpl(origin + path, {
      headers: { accept: 'text/html', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.arrayBuffer();
    return {
      path,
      status: res.status,
      cache: res.headers.get('x-vercel-cache') ?? '-',
      ms: Date.now() - started,
    };
  } catch (e) {
    return {
      path,
      status: 0,
      cache: '-',
      ms: Date.now() - started,
      error: e?.name === 'TimeoutError' ? 'timeout' : 'network error',
    };
  }
}

/**
 * warmOne, then a pause when Vercel answered STALE.
 *
 * A stale page is served at once and rendered again in the background, so
 * without the pause a lane would ask for its next page while that render is
 * still running. Over a stale cache (a re-run, hours after the deploy) that
 * starts a background render per answer, as fast as the answers come back:
 * 186 in 16 s, measured on 2026-09-29. Right after a deploy the reports
 * should answer MISS, and a lane already waits for a MISS to render, so there
 * this changes nothing.
 *
 * @param {string} path
 * @param {Parameters<typeof warmOne>[1] & { pauseMs?: number }} [options]
 */
export async function warmPaced(path, options = {}) {
  const { pauseMs = STALE_PAUSE_MS, ...rest } = options;
  const result = await warmOne(path, rest);
  if (result.cache === 'STALE') await sleep(pauseMs);
  return result;
}

/**
 * The Vercel deployment id the commit's newest successful `Vercel` status
 * links to, as the page spells it (`dpl_…`), or null.
 */
export function deploymentIdFromStatuses(statuses) {
  const status = (Array.isArray(statuses) ? statuses : []).find(
    (s) => s?.context === 'Vercel' && s?.state === 'success'
  );
  const id = String(status?.target_url ?? '')
    .split('/')
    .pop();
  return id && /^[A-Za-z0-9]+$/.test(id) ? `dpl_${id}` : null;
}

/**
 * The deployment id a page's asset URLs carry, or null. Matched on the word,
 * not on `?` or `&`: in an attribute the separator is written `&amp;`.
 */
export function deploymentIdInHtml(html) {
  return html.match(/\bdpl=(dpl_[A-Za-z0-9]+)/)?.[1] ?? null;
}

/**
 * Polls `origin` until it serves `expectedId`, for at most `waitMs`.
 *
 * `live` is true when it does, false when the wait ran out, and null when the
 * page names no deployment at all (skew protection off), which no amount of
 * waiting would change.
 */
export async function waitForDeployment(
  expectedId,
  {
    fetchImpl = fetch,
    waitMs = ALIAS_WAIT_MS,
    pollMs = ALIAS_POLL_MS,
    origin = ORIGIN,
  } = {}
) {
  const started = Date.now();
  for (;;) {
    let seen = null;
    let named = true;
    try {
      const res = await fetchImpl(`${origin}/`, {
        headers: { accept: 'text/html', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const html = await res.text();
      seen = deploymentIdInHtml(html);
      named = !(res.ok && seen === null);
    } catch {
      // A failed probe says nothing about which deployment is live.
    }
    const waitedMs = Date.now() - started;
    if (seen === expectedId) return { live: true, seen, waitedMs };
    if (!named) return { live: null, seen, waitedMs };
    if (waitedMs + pollMs > waitMs) return { live: false, seen, waitedMs };
    await sleep(pollMs);
  }
}

/** The sitemap's text, or null after `attempts` failed tries. */
export async function fetchSitemap({
  fetchImpl = fetch,
  attempts = SITEMAP_ATTEMPTS,
  backoffMs = SITEMAP_BACKOFF_MS,
  origin = ORIGIN,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchImpl(`${origin}/sitemap.xml`, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return await res.text();
    } catch {
      // Tried again below, up to `attempts` times in all.
    }
    if (attempt < attempts) await sleep(backoffMs);
  }
  return null;
}

async function expectedDeploymentId(repo, sha, token) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/commits/${sha}/statuses?per_page=100`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      }
    );
    return res.ok ? deploymentIdFromStatuses(await res.json()) : null;
  } catch {
    return null;
  }
}

async function main() {
  const lines = [];
  const say = (line) => {
    console.log(line);
    lines.push(line);
  };
  const warn = (line) => {
    console.log(`::warning::${line}`);
    lines.push(`Warning: ${line}`);
  };

  const sha = process.env.DEPLOY_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  if (sha && repo) {
    const expected = await expectedDeploymentId(
      repo,
      sha,
      process.env.GITHUB_TOKEN
    );
    if (!expected) {
      warn(
        `No successful Vercel status on ${sha.slice(0, 7)} names a deployment, so this cannot tell which one is live. Warming now.`
      );
    } else {
      const { live, seen, waitedMs } = await waitForDeployment(expected);
      if (live === true) {
        say(`${ORIGIN} serves ${expected} (waited ${seconds(waitedMs)}).`);
      } else if (live === null) {
        warn(
          `${ORIGIN}/ names no deployment in its asset URLs, so this cannot tell which one is live. Warming now.`
        );
      } else {
        warn(
          `${ORIGIN} still serves ${seen ?? 'an unreadable page'} after ${seconds(waitedMs)}, not ${expected}. Warming whatever is live.`
        );
      }
    }
  }

  const xml = await fetchSitemap();
  if (xml === null) {
    warn(
      `${ORIGIN}/sitemap.xml did not load in ${SITEMAP_ATTEMPTS} tries. Warming the fixed pages and the hub only.`
    );
  }
  const targets = warmTargets(xml ?? '');
  const reports = targets.filter((p) => p.startsWith(`${HUB_PATH}/`)).length;
  if (xml !== null && reports === 0) {
    warn(
      `${ORIGIN}/sitemap.xml loaded but lists no holder reports. Warming the fixed pages and the hub only.`
    );
  }
  say(
    `Warming ${targets.length} pages (${reports} holder reports), ${CONCURRENCY} at a time, ${seconds(REQUEST_TIMEOUT_MS)} per request, ${WARM_BUDGET_MS / 60_000} minute budget.`
  );

  const started = Date.now();
  const results = await runPool(
    targets,
    CONCURRENCY,
    (path) => warmPaced(path),
    started + WARM_BUDGET_MS
  );
  const done = results.filter(Boolean);
  const ok = done.filter((r) => r.status >= 200 && r.status < 300);
  const failed = done.filter((r) => !(r.status >= 200 && r.status < 300));
  const slow = ok.filter((r) => r.ms > SLOW_MS);
  const skipped = targets.length - done.length;
  const byCache = {};
  for (const r of done) byCache[r.cache] = (byCache[r.cache] ?? 0) + 1;
  const times = done.map((r) => r.ms).sort((a, b) => a - b);
  const at = (q) =>
    times[Math.min(times.length - 1, Math.floor(q * times.length))];

  say(
    `Warmed ${done.length} of ${targets.length} in ${seconds(Date.now() - started)}: ${ok.length} ok (${slow.length} over ${seconds(SLOW_MS)}), ${failed.length} failed, ${skipped} not started.`
  );
  if (times.length) {
    say(`Median ${seconds(at(0.5))}, p90 ${seconds(at(0.9))}.`);
  }
  say(
    `x-vercel-cache: ${
      Object.entries(byCache)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}`)
        .join(', ') || 'none'
    }.`
  );
  const slowest = [...done].sort((a, b) => b.ms - a.ms).slice(0, 5);
  if (slowest.length) {
    say('Slowest:');
    for (const r of slowest) {
      say(
        `  ${seconds(r.ms).padStart(7)}  ${r.error ?? r.status}  ${r.cache}  ${r.path}`
      );
    }
  }
  // One annotation per failed page, up to ten: a run against a site that is
  // down would otherwise raise one for every page in the sitemap.
  for (const r of failed.slice(0, 10)) {
    warn(`${r.path}: ${r.error ?? `HTTP ${r.status}`}.`);
  }
  if (failed.length > 10) warn(`${failed.length - 10} more pages failed.`);
  if (skipped) {
    warn(
      `${skipped} pages were not started within the ${WARM_BUDGET_MS / 60_000} minute budget; their first visitor renders them.`
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Cache warm\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
