/**
 * Whether a PR is actually ready to merge, answered in one command.
 *
 * Usage: npm run pr:status 291
 *
 * ## Why this exists
 *
 * The PR page shows a row of checkmarks, and on two separate occasions in one
 * day that row was reassuring and wrong in different ways. Both are cheap to
 * check and neither is visible without asking a specific question, so the
 * question is asked here instead of remembered.
 *
 * **Bugbot reports `neutral`, and the UI renders it as `skipping`.** It reads
 * as "nothing to do". It is emitted both when Bugbot genuinely had nothing to
 * say and when it found real defects, and the only way to tell is the check
 * run's own summary, which the PR page does not show. Eleven real defects
 * arrived behind that label on 2026-09-19, including a follower count left on
 * a removed person's row and a suppression trigger that would have preserved a
 * live third-party token for exactly the person asking to be removed.
 *
 * **A conflicting PR runs no workflows at all.** GitHub builds a
 * `pull_request` run against the computed merge commit, so when that merge
 * cannot be computed nothing triggers: not a queued run, not a failed one,
 * nothing. The checks already on the PR are whatever ran on an older head, and
 * they look perfectly green. The same day, that cost an hour and produced a
 * confident and wrong report that GitHub Actions was down, because "no runs
 * anywhere in the repo" is also what a repository whose only open PR is
 * conflicting looks like when its workflows are `pull_request`-triggered.
 *
 * ## What it refuses
 *
 * It exits non-zero and says why. Nothing here is advisory: every condition it
 * reports is one where merging is either impossible or would merge over an
 * unread finding.
 */
import { execFileSync } from 'child_process';

interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  output?: { title?: string | null; summary?: string | null };
}

function gh(args: string[]): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function fail(lines: string[]): never {
  console.error('\nNOT READY TO MERGE\n');
  for (const l of lines) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
}

async function main() {
  const number = process.argv[2];
  if (!number || !/^\d+$/.test(number)) {
    console.error('Usage: npm run pr:status <pr-number>');
    process.exit(1);
  }

  const pr = JSON.parse(
    gh([
      'pr',
      'view',
      number,
      '--json',
      'headRefOid,state,isDraft,mergeable,mergeStateStatus,title,baseRefName',
    ])
  ) as {
    headRefOid: string;
    state: string;
    isDraft: boolean;
    mergeable: string;
    mergeStateStatus: string;
    title: string;
    baseRefName: string;
  };

  const head = pr.headRefOid;
  console.log(`\n#${number} ${pr.title}`);
  console.log(
    `  base ${pr.baseRefName}  head ${head.slice(0, 7)}  ${pr.state}`
  );
  console.log(`  mergeable: ${pr.mergeable} (${pr.mergeStateStatus})\n`);

  const problems: string[] = [];

  if (pr.state !== 'OPEN') problems.push(`state is ${pr.state}, not OPEN.`);
  if (pr.isDraft) problems.push('PR is a draft.');

  /**
   * The conflict check comes FIRST, and before anything is said about the
   * checks, because a conflict explains a missing check and no amount of
   * staring at the check list explains a conflict.
   */
  if (pr.mergeable === 'CONFLICTING') {
    problems.push(
      'CONFLICTING with the base branch. This is almost certainly why any',
      'workflow looks missing: GitHub runs pull_request workflows against the',
      'computed merge commit, so a conflict means nothing triggers at all,',
      'and the checks shown are whatever ran on an older head. Merge the base',
      'branch in (not a rebase, which needs a force-push) and push.'
    );
  }

  const runs = JSON.parse(
    gh([
      'api',
      `repos/{owner}/{repo}/commits/${head}/check-runs`,
      '--jq',
      '.check_runs',
    ])
  ) as CheckRun[];

  if (runs.length === 0) {
    problems.push(
      `No check runs exist on the head commit ${head.slice(0, 7)} at all.`
    );
  }

  const pending = runs.filter((r) => r.status !== 'completed');
  const failed = runs.filter(
    (r) =>
      r.status === 'completed' &&
      r.conclusion !== null &&
      !['success', 'skipped', 'neutral'].includes(r.conclusion)
  );

  /**
   * The neutral ones are read, not counted.
   *
   * A neutral conclusion is the one that renders as `skipping`, and its
   * summary is the only place the finding count appears. Anything that is not
   * plainly "no issues found" is treated as unread work.
   */
  const neutral = runs.filter(
    (r) => r.status === 'completed' && r.conclusion === 'neutral'
  );

  console.log(`  check runs on this head: ${runs.length}`);
  for (const r of runs) {
    const state = r.status === 'completed' ? r.conclusion : r.status;
    console.log(`    ${state?.padEnd(12)} ${r.name}`);
  }

  for (const r of neutral) {
    const summary = (r.output?.summary ?? '').replace(/\s+/g, ' ');
    const found = summary.match(/found (\d+) potential issue/i);
    const unresolved = summary.match(/(\d+) previously reported/i);
    const clean = /no issues found/i.test(summary);

    console.log(`\n  ${r.name} is neutral. Its own summary says:`);
    console.log(`    ${summary.slice(0, 300) || '(no summary)'}`);

    if (!clean || found) {
      problems.push(
        `${r.name} reports neutral, which the PR page renders as "skipping",`,
        `and its summary is NOT a clean pass${
          found ? `: ${found[1]} potential issue(s)` : ''
        }${unresolved ? `, ${unresolved[1]} previously reported unresolved` : ''}.`,
        'Read the review comments before merging:',
        `  gh api repos/{owner}/{repo}/pulls/${number}/comments --jq '.[] | .body'`
      );
    }
  }

  if (pending.length > 0) {
    problems.push(
      `${pending.length} check(s) still running: ${pending
        .map((r) => r.name)
        .join(', ')}.`
    );
  }
  if (failed.length > 0) {
    problems.push(
      `${failed.length} check(s) not green: ${failed
        .map((r) => `${r.name} (${r.conclusion})`)
        .join(', ')}.`
    );
  }

  if (problems.length > 0) fail(problems);

  console.log('\nREADY: mergeable, every check on this head is green, and no');
  console.log('neutral conclusion is hiding a finding.\n');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
