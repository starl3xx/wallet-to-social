/**
 * How many of the X handles we serve still reach an account?
 *
 * Usage: npx tsx --env-file=.env.local scripts/check-handle-liveness.ts
 *
 * READ ONLY. It samples and reports; it writes nothing. The sweep that acts on
 * this lives elsewhere.
 *
 * Result on 2026-08-16, n=3,000: **8.47% of rows reach nobody**, 95% CI 7.52%
 * to 9.52%, which is about 88,000 of the 1,043,512 sweep-sourced rows. All
 * three bases agreed to within 0.02 points and no check was unresolved.
 *
 * It measures a FLOOR, not the total. A handle that resolves to the wrong
 * person passes this test and is the failure that actually costs a customer
 * something. Only an independent account id can catch that, and we hold one for
 * 81,412 of 1,143,547 rows.
 *
 * Replaces a 300-row estimate that was quoted more precisely than it earned.
 * Three things are different here.
 *
 * **Bigger sample.** 3,000 rows rather than 300, which takes the 95% interval
 * from about six points wide to about two.
 *
 * **People as well as rows.** The graph is row-weighted: one person with forty
 * wallets is forty rows, so 300 rows were never 300 independent observations.
 * Both rates are reported, and the per-person one is the honest basis for a
 * confidence interval. The per-row one is what a customer actually experiences,
 * because they look up wallets.
 *
 * **A control that runs throughout.** If x.com starts refusing us partway
 * through, every remaining handle looks dead and the result is garbage that
 * looks like a finding. A known-live and a known-dead handle are re-checked
 * every 250 requests, and the run aborts if either flips.
 */
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CONCURRENCY = 4;
const SAMPLE = 3000;
const CONTROL_EVERY = 250;

const LIVE_CONTROL = 'jack';
const DEAD_CONTROL = 'zzzznotarealhandle99123';

async function status(handle: string): Promise<boolean | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://x.com/${encodeURIComponent(handle)}`, {
        headers: { 'User-Agent': UA },
      });
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}

/** Wilson score interval, which behaves at small p where the normal one does not. */
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / d), Math.min(1, (centre + spread) / d)];
}

async function main() {
  const live = await status(LIVE_CONTROL);
  const dead = await status(DEAD_CONTROL);
  console.log(`controls: live=${live} dead=${dead}`);
  if (live !== true || dead !== false) throw new Error('controls failed at start');

  const rows = (await sql`
    SELECT wallet, twitter_handle, fc_fid, sources
    FROM social_graph
    WHERE twitter_handle IS NOT NULL AND 'farcaster_sweep' = ANY(sources)
    ORDER BY random() LIMIT ${SAMPLE}
  `) as unknown as Array<{
    wallet: string;
    twitter_handle: string;
    fc_fid: number | null;
    sources: string[];
  }>;

  const fids = new Set(rows.map((r) => r.fc_fid).filter((f) => f !== null));
  const handles = new Set(rows.map((r) => r.twitter_handle.toLowerCase()));
  console.log(
    `\nsample: ${rows.length} rows, ${fids.size} distinct Farcaster ids, ${handles.size} distinct handles`
  );

  const verdict = new Map<string, boolean | null>();
  let done = 0;
  let aborted = false;

  const queue = [...handles];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length && !aborted) {
        const h = queue.shift()!;
        verdict.set(h, await status(h));
        done++;
        if (done % CONTROL_EVERY === 0) {
          const [l, d] = await Promise.all([status(LIVE_CONTROL), status(DEAD_CONTROL)]);
          if (l !== true || d !== false) {
            console.error(`\nCONTROL FAILED at ${done} (live=${l} dead=${d}). Aborting.`);
            aborted = true;
            return;
          }
          process.stdout.write(`  ${done}/${handles.size} checked, controls ok\n`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    })
  );
  if (aborted) throw new Error('aborted: x.com stopped answering reliably mid-run');

  const finalLive = await status(LIVE_CONTROL);
  const finalDead = await status(DEAD_CONTROL);
  console.log(`controls at end: live=${finalLive} dead=${finalDead}`);
  if (finalLive !== true || finalDead !== false) throw new Error('controls failed at end');

  // Per distinct handle.
  let hDead = 0,
    hLive = 0,
    hUnknown = 0;
  for (const h of handles) {
    const v = verdict.get(h);
    if (v === null || v === undefined) hUnknown++;
    else if (v) hLive++;
    else hDead++;
  }

  // Per row, which is what a customer meets.
  let rDead = 0,
    rLive = 0,
    rUnknown = 0;
  for (const r of rows) {
    const v = verdict.get(r.twitter_handle.toLowerCase());
    if (v === null || v === undefined) rUnknown++;
    else if (v) rLive++;
    else rDead++;
  }

  // Per person, the least clustered basis.
  const perFid = new Map<number, boolean | null>();
  for (const r of rows) {
    if (r.fc_fid === null) continue;
    const v = verdict.get(r.twitter_handle.toLowerCase());
    if (!perFid.has(r.fc_fid)) perFid.set(r.fc_fid, v ?? null);
  }
  let fDead = 0,
    fLive = 0;
  for (const v of perFid.values()) {
    if (v === false) fDead++;
    else if (v === true) fLive++;
  }

  const report = (label: string, k: number, n: number) => {
    const [lo, hi] = wilson(k, n);
    console.log(
      `${label.padEnd(26)} ${k}/${n} = ${((k / n) * 100).toFixed(2)}%   95% CI ` +
        `${(lo * 100).toFixed(2)}% to ${(hi * 100).toFixed(2)}%`
    );
  };

  console.log(`\n${'─'.repeat(72)}\nHandles that no longer reach an account\n${'─'.repeat(72)}`);
  report('per distinct handle', hDead, hDead + hLive);
  report('per person (FID)', fDead, fDead + fLive);
  report('per row (customer view)', rDead, rDead + rLive);
  console.log(`unresolved: ${hUnknown} handles, ${rUnknown} rows`);

  const [pop] = (await sql`
    SELECT count(*)::int AS n FROM social_graph
    WHERE twitter_handle IS NOT NULL AND 'farcaster_sweep' = ANY(sources)`) as unknown as Array<{
    n: number;
  }>;
  const [lo, hi] = wilson(rDead, rDead + rLive);
  console.log(
    `\nApplied to ${pop.n.toLocaleString()} sweep-sourced rows:\n` +
      `  ${Math.round((rDead / (rDead + rLive)) * pop.n).toLocaleString()} rows ` +
      `(range ${Math.round(lo * pop.n).toLocaleString()} to ${Math.round(hi * pop.n).toLocaleString()})`
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
