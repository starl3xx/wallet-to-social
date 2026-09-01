/**
 * The same figure check, against the social queue instead of the repository.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/check-queue-figures.ts
 *   npx tsx --env-file=.env.local scripts/check-queue-figures.ts --fail-on-stale
 *
 * ## Why this exists
 *
 * `check-published-figures.ts` guards every surface in this repository, and the
 * social queue is not in this repository. On 2026-09-01 it held 119 drafts, all
 * of them written by hand months apart, every figure in them a literal that no
 * check had ever read. Two were wrong by the time anybody looked: one still
 * offered "we're at seven" chains after the eighth shipped, and one said "4.7M
 * wallets we've already resolved" when 4.7M is the Farcaster subset and
 * resolved is 4.8M. That second one is not a stale number, it is two adjacent
 * true facts swapped, which is exactly the confusion the comment above
 * FARCASTER_WALLETS was written to prevent.
 *
 * Neither would have been caught by anything. They were found by reading.
 *
 * ## What it does NOT do
 *
 * It does not edit drafts. A figure in published copy has one right answer and
 * a script may fix it; a figure in a draft sits inside a sentence somebody
 * wrote, and the fix is usually a rewrite rather than a substitution. RH 38
 * needed its verb changed, not its number. So this reports and a person edits.
 *
 * ## Reading the whole thread, not the preview
 *
 * The list endpoint returns a `preview` field holding only the first post. A
 * previous audit read those and passed a queue whose later posts carried the
 * old X coverage figure, because a thread's claims are mostly not in its first
 * post. Every draft is therefore fetched individually and every entry of
 * `platforms.*.posts[]` is scanned.
 */
import { CLAIMS, FIGURE_SHAPES } from './check-published-figures';

const API = 'https://api.typefully.com/v2';
const SOCIAL_SET = Number(process.env.TYPEFULLY_SOCIAL_SET ?? '278688');

/** Statuses worth checking. A published post cannot be fixed by editing it. */
const CHECKABLE = new Set(['draft', 'scheduled', 'planned']);

interface DraftPost {
  text?: string;
}
interface DraftDetail {
  id: number;
  draft_title: string | null;
  status: string;
  scheduled_date: string | null;
  platforms?: Record<string, { posts?: DraftPost[] } | undefined>;
}

async function api<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      `${path}: ${res.status} ${(await res.text()).slice(0, 200)}`
    );
  }
  return (await res.json()) as T;
}

/** Every post body in a draft, across every platform it targets. */
function bodies(draft: DraftDetail): string[] {
  const out: string[] = [];
  for (const platform of Object.values(draft.platforms ?? {})) {
    for (const post of platform?.posts ?? []) {
      if (post?.text) out.push(post.text);
    }
  }
  return out;
}

async function main() {
  const key = process.env.TYPEFULLY_API_KEY;
  if (!key) {
    /**
     * Absent credentials are not a failure.
     *
     * The queue is a different system with a different secret, and a pull
     * request from a fork has neither. Failing here would teach people that a
     * red figures job means "no token", which is how a guard stops being read.
     */
    console.log('TYPEFULLY_API_KEY not set: queue check skipped.');
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  /**
   * Resolve every claim once. Each `actual()` carries its own query and its own
   * connection from the module it is defined in, which is the point: the claim
   * and the proof of the claim stay together, so this script cannot check a
   * figure against a query somebody rewrote here.
   */
  const actuals = new Map<string, number>();
  for (const claim of CLAIMS) {
    try {
      actuals.set(claim.what, await claim.actual());
    } catch {
      // A claim whose query needs something this script has not wired up is
      // skipped rather than reported as a queue problem.
    }
  }

  const list = await api<{ results: Array<{ id: number; status: string }> }>(
    `/social-sets/${SOCIAL_SET}/drafts?limit=50`,
    key
  );
  const checkable = list.results.filter((d) => CHECKABLE.has(d.status));

  let flagged = 0;
  let scanned = 0;

  for (const stub of checkable) {
    const draft = await api<DraftDetail>(
      `/social-sets/${SOCIAL_SET}/drafts/${stub.id}?exclude_comment_markers=true`,
      key
    );
    const text = bodies(draft).join('\n\n');
    if (!text) continue;
    scanned++;

    const label = draft.draft_title ?? `draft ${draft.id}`;
    const armed = draft.status === 'scheduled';

    for (const claim of CLAIMS) {
      const actual = actuals.get(claim.what);
      if (actual === undefined) continue;
      const m = text.match(claim.pattern);
      if (!m) continue;
      const raw = m.slice(1).find((g) => g !== undefined);
      if (raw === undefined) continue;
      const published = Number(raw.replace(/,/g, '')) * (claim.scale ?? 1);
      if (!Number.isFinite(published) || published === 0) continue;

      /**
       * A trailing "+" makes a figure a floor, not an estimate.
       *
       * "13,000+ known agent wallets" against a live 13,622 is true, and
       * reporting it as 4.6% behind is how a guard trains people to skim past
       * it. The registry already writes this claim as `13K+` for the same
       * reason. A floor is only ever wrong by overstating.
       */
      const isFloor = new RegExp(
        `${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\+`
      ).test(text);

      const off = Math.abs(published - actual) / actual;
      if (published > actual) {
        console.error(
          `  ${armed ? 'ARMED ' : ''}OVERSTATES  ${label}: ${claim.what} ` +
            `says ${raw}, actual ${actual.toLocaleString()}` +
            (isFloor ? ' (a floor claim, and it does not hold)' : '')
        );
        flagged++;
      } else if (off > 0.02 && !isFloor) {
        console.warn(
          `  ${armed ? 'ARMED ' : ''}STALE       ${label}: ${claim.what} ` +
            `says ${raw}, actual ${actual.toLocaleString()} ` +
            `(${(off * 100).toFixed(1)}% behind)`
        );
        flagged++;
      }
    }

    // A figure shape with no claim behind it is the same undeclared-number
    // problem the repository sweep reports, one system over.
    for (const shape of FIGURE_SHAPES) {
      const hits = [...text.matchAll(shape)].map((h) => h[0].trim());
      for (const hit of new Set(hits)) {
        const covered = CLAIMS.some((c) => c.pattern.test(hit));
        if (!covered) {
          console.log(`  undeclared  ${label}: "${hit}"`);
        }
      }
    }
  }

  console.log(
    `\n${scanned} queued drafts scanned across ${checkable.length} checkable.`
  );
  if (flagged === 0) {
    console.log('Nothing in the queue contradicts the database.');
    return;
  }
  console.log(
    `${flagged} need a person. A draft states a figure inside a sentence, so ` +
      `the fix is usually a rewrite and not a substitution: RH 38 needed its ` +
      `verb changed, not its number.`
  );
  if (process.argv.includes('--fail-on-stale')) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
