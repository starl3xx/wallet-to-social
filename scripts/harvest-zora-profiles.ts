/**
 * Creator-profile harvest.
 *
 * Reads the keyless profile API described in `lib/zora-profiles.ts` and hands
 * the wallet-to-X pairs it produces to the shared attested-link ingest
 * (`lib/attested-links.ts`), which owns the fill-only rule, the agreement
 * gate, conflict recording and the quality contract. Everything this script
 * adds is enumeration, pacing, budgeting and the checkpoint.
 *
 * ## Two walks, and why both exist
 *
 * `--mode explore` walks a creator list newest-first and resolves each account
 * it finds. This is discovery: it reaches accounts the index has never seen.
 * Roughly a fifth of the general population carries an X account and about a
 * quarter of those brought their own wallet, so most requests find nothing,
 * which is the cost of discovery rather than a fault.
 *
 * `--mode wallets` asks about the addresses the index already holds. Measured
 * on a random sample, about one address in seventeen resolves to an account,
 * and every one of those resolved through the person's own EXTERNAL wallet
 * rather than a provisioned one, because the index is made of EOAs. Fewer
 * rows per request than discovery on paper, but every hit is a wallet this
 * index already cares about, and a hit that names a different handle from the
 * stored one is recorded as a conflict, which the explore walk cannot produce
 * for an address it has never seen.
 *
 * Both are budgeted and checkpointed and neither depends on the other.
 *
 * ## Why a workflow and not a cron route
 *
 * The measured ceiling is about one request per second (a 429 carries no reset
 * time, and a sustained five per second sheds a third of its traffic), so a
 * useful pass is tens of minutes. That does not fit a 300-second serverless
 * cron. It runs as a scheduled workflow with a request budget, the same shape
 * as the Snapshot profile harvest.
 *
 * ## What a run refuses to do
 *
 * The checkpoint advances only over a page every profile in which was
 * answered. When the upstream stops answering, the run finishes the page it is
 * on, ingests what it already read (the ingest is idempotent, so re-reading
 * costs nothing but the requests), leaves the cursor where it was and stops.
 * The next run retries the same page. A page that fails the same way every
 * week is therefore visible as a cursor that does not move, rather than as a
 * gap nobody can see.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/harvest-zora-profiles.ts                      # dry run, explore
 *   npx tsx --env-file=.env.local scripts/harvest-zora-profiles.ts --mode wallets
 *   npx tsx --env-file=.env.local scripts/harvest-zora-profiles.ts --commit
 *   npx tsx scripts/harvest-zora-profiles.ts --parse-only --max-requests 21   # no database
 *
 * Flags:
 *   --mode explore|wallets   which walk to run (default explore)
 *   --commit                 write; without it nothing is written and no
 *                            checkpoint is saved
 *   --max-requests N         request budget for this run (default 500). Counts
 *                            list pages and profile reads alike, since the rate
 *                            limit does not distinguish them; a request that
 *                            had to be retried still counts once, so the budget
 *                            bounds the work asked for rather than the packets
 *   --list-type NAME         explore only; one of the walkable lists
 *   --after CURSOR           explore only; start cursor, for inspecting a page.
 *                            Refused with --commit, so it cannot overwrite the
 *                            scheduled walk's saved position
 *   --since-wallet 0x...     wallets only; start address, overriding the checkpoint
 *   --wallet-batch N         wallets only; addresses per checkpoint (default 50)
 *   --parse-only             explore only; read and print, touch no database
 */

import {
  ingestLinks,
  dedupeByWallet,
  classifyLinks,
  type AttestedLink,
} from '../lib/attested-links';
import { loadSuppressionList, isKindSuppressed } from '../lib/suppression';
import {
  ZORA_PROFILE_SOURCE,
  WALKABLE_LIST_TYPES,
  DEFAULT_LIST_TYPE,
  EXPLORE_PAGE_SIZE,
  ZORA_REFUSALS,
  ZoraTransportError,
  addAudit,
  addRefusals,
  auditFarcaster,
  emptyFarcasterAudit,
  emptyRefusalTally,
  fetchListPage,
  fetchProfile,
  getExploreCheckpoint,
  getWalletsCheckpoint,
  markExploreComplete,
  markWalletsComplete,
  nextWalletPage,
  readProfile,
  saveExploreCheckpoint,
  saveWalletsCheckpoint,
  type RefusalTally,
  type ZoraFarcasterObservation,
  type ZoraListType,
} from '../lib/zora-profiles';

interface Args {
  mode: 'explore' | 'wallets';
  commit: boolean;
  maxRequests: number;
  listType: ZoraListType;
  after: string | null;
  sinceWallet: string | null;
  walletBatch: number;
  parseOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mode: 'explore',
    commit: false,
    maxRequests: 500,
    listType: DEFAULT_LIST_TYPE,
    after: null,
    sinceWallet: null,
    walletBatch: 50,
    parseOnly: false,
  };
  const takesValue = new Set([
    '--mode',
    '--max-requests',
    '--list-type',
    '--after',
    '--since-wallet',
    '--wallet-batch',
  ]);

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--commit') {
      args.commit = true;
      continue;
    }
    if (flag === '--parse-only') {
      args.parseOnly = true;
      continue;
    }
    if (!takesValue.has(flag)) throw new Error(`Unknown flag: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    i++;

    if (flag === '--mode') {
      if (value !== 'explore' && value !== 'wallets') {
        throw new Error(`--mode must be explore or wallets, got ${value}`);
      }
      args.mode = value;
    } else if (flag === '--list-type') {
      const match = WALKABLE_LIST_TYPES.find((t) => t === value);
      if (!match) {
        throw new Error(
          `--list-type must be one of ${WALKABLE_LIST_TYPES.join(', ')}. ` +
            'The other lists either stop dead at a fixed leaderboard or answer ' +
            'with HTTP 504, so a walk over one would report a finished sweep ' +
            'over a couple of hundred rows.'
        );
      }
      args.listType = match;
    } else if (flag === '--after') {
      args.after = value;
    } else if (flag === '--since-wallet') {
      if (!/^0x[0-9a-f]{40}$/.test(value)) {
        throw new Error('--since-wallet needs a lowercase 0x address');
      }
      args.sinceWallet = value;
    } else {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`${flag} needs a positive integer`);
      }
      if (flag === '--max-requests') args.maxRequests = n;
      else args.walletBatch = n;
    }
  }

  /**
   * `--after` overrides where a run STARTS but not where it saves, so an
   * ad-hoc `--commit --after <cursor>` would write its own position over the
   * scheduled walk's and silently discard however far that walk had got.
   * Refusing the combination is the whole fix: `--after` stays available for
   * inspecting a page (with `--parse-only` or without `--commit`), and the
   * checkpoint keeps exactly one writer.
   *
   * This is not hypothetical operator error. Stepping past a page that keeps
   * failing is the documented use for `--after`, and it is the same gesture.
   */
  if (args.after !== null && args.commit) {
    throw new Error(
      '--after cannot be combined with --commit: a manual start cursor would ' +
        'overwrite the scheduled walk position and lose its progress. Run it ' +
        'without --commit to inspect the page, or let the checkpoint drive.'
    );
  }

  if (args.parseOnly) {
    if (args.commit)
      throw new Error('--parse-only cannot be combined with --commit');
    if (args.mode !== 'explore') {
      throw new Error(
        '--parse-only works only with --mode explore: the wallets walk reads ' +
          'its addresses from the database.'
      );
    }
  }
  return args;
}

interface Totals {
  requests: number;
  /** Accounts read through the profile endpoint. */
  profiles: number;
  /** Profile reads that produced at least one pair. */
  accountsWithPair: number;
  links: number;
  contested: number;
  rejected: number;
  newWallets: number;
  filled: number;
  agree: number;
  conflicts: number;
}

function emptyTotals(): Totals {
  return {
    requests: 0,
    profiles: 0,
    accountsWithPair: 0,
    links: 0,
    contested: 0,
    rejected: 0,
    newWallets: 0,
    filled: 0,
    agree: 0,
    conflicts: 0,
  };
}

/**
 * Drop pairs naming a suppressed address or a suppressed handle.
 *
 * The database triggers refuse these rows anyway; filtering here means the
 * counts a run prints describe what it actually contributed, and it keeps a
 * suppressed identifier out of the conflict table, which the trigger reaches
 * but a reader of this log would not expect the ingest to have offered.
 */
async function dropSuppressed(
  links: AttestedLink[],
  refusals: RefusalTally
): Promise<AttestedLink[]> {
  if (links.length === 0) return links;
  const sets = await loadSuppressionList();
  const kept = links.filter(
    (link) =>
      !isKindSuppressed(sets, 'wallet', link.wallet) &&
      !isKindSuppressed(sets, 'twitter', link.handle)
  );
  refusals.suppressed += links.length - kept.length;
  return kept;
}

async function commitPage(
  links: AttestedLink[],
  totals: Totals,
  commit: boolean
): Promise<void> {
  if (links.length === 0) return;
  if (commit) {
    const stats = await ingestLinks(links, ZORA_PROFILE_SOURCE);
    totals.links += stats.links;
    totals.contested += stats.contested;
    totals.rejected += stats.rejected;
    totals.newWallets += stats.newWallets;
    totals.filled += stats.filled;
    totals.agree += stats.agree;
    totals.conflicts += stats.conflicts;
    return;
  }
  // The dry run goes through the same dedupe and the same read-only
  // classification the commit path uses, so its numbers are the numbers.
  const { links: deduped, contested, rejected } = dedupeByWallet(links);
  const counts = await classifyLinks(deduped);
  totals.links += deduped.length;
  totals.contested += contested;
  totals.rejected += rejected;
  totals.newWallets += counts.newWallets;
  totals.filled += counts.wouldFill;
  totals.agree += counts.agree;
  totals.conflicts += counts.disagree;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.parseOnly && !process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL is required. Use --parse-only to read the API without it.'
    );
    process.exit(1);
  }

  const totals = emptyTotals();
  const refusals = emptyRefusalTally();
  const audit = emptyFarcasterAudit();
  let stoppedOnFailure = false;
  let exhausted = false;

  const label = args.parseOnly
    ? 'PARSE ONLY'
    : args.commit
      ? 'COMMIT'
      : 'dry run';

  if (args.mode === 'explore') {
    const perPage = 1 + EXPLORE_PAGE_SIZE;
    if (args.maxRequests < perPage) {
      throw new Error(
        `--max-requests must be at least ${perPage} in explore mode: one list ` +
          `page plus up to ${EXPLORE_PAGE_SIZE} profile reads. A budget that ` +
          'stops mid-page would leave the cursor behind work already paid for.'
      );
    }

    let cursor = args.after;
    if (!args.parseOnly && cursor === null) {
      const checkpoint = await getExploreCheckpoint();
      if (checkpoint) {
        if (checkpoint.listType !== args.listType) {
          throw new Error(
            `The checkpoint is a position in ${checkpoint.listType} and this run ` +
              `walks ${args.listType}. A cursor from one list means nothing in ` +
              'another. Pass --after to start somewhere explicit, or run the ' +
              'list the checkpoint belongs to.'
          );
        }
        cursor = checkpoint.cursor;
      }
    }

    console.log(
      `${label}: ${args.listType}, from ${cursor ?? 'the newest row'}, ` +
        `max ${args.maxRequests} requests`
    );

    while (totals.requests + perPage <= args.maxRequests) {
      const page = await fetchListPage(args.listType, cursor);
      totals.requests++;
      addRefusals(refusals, page.refusals);

      const links: AttestedLink[] = [];
      const observed: ZoraFarcasterObservation[] = [];
      let pageFailed = false;

      for (const entry of page.entries) {
        let payload: unknown;
        try {
          payload = await fetchProfile(entry.username);
          totals.requests++;
        } catch (err) {
          if (!(err instanceof ZoraTransportError)) throw err;
          totals.requests++;
          refusals.transport_failure++;
          console.warn(`  ${entry.username}: ${err.message}`);
          pageFailed = true;
          break;
        }

        totals.profiles++;
        const reading = readProfile(payload);
        addRefusals(refusals, reading.refusals);
        if (reading.links.length > 0) totals.accountsWithPair++;
        links.push(...reading.links);
        observed.push(...reading.farcaster);

        if (args.parseOnly) {
          for (const link of reading.links) {
            console.log(`  pair  ${link.wallet}  @${link.handle}`);
          }
        }
      }

      if (args.parseOnly) {
        // No database, so no dedupe and no classification: the count is the
        // pairs read, which is what a parse check is being asked to prove.
        totals.links += links.length;
      } else {
        const kept = await dropSuppressed(links, refusals);
        await commitPage(kept, totals, args.commit);
        addAudit(audit, await auditFarcaster(observed));
      }

      if (pageFailed) {
        stoppedOnFailure = true;
        break;
      }

      if (page.endCursor === null || !page.hasNextPage) {
        exhausted = true;
        if (args.commit) await markExploreComplete(args.listType);
        break;
      }
      cursor = page.endCursor;
      if (args.commit) await saveExploreCheckpoint(args.listType, cursor);
      console.log(
        `  ${totals.requests} requests, ${totals.profiles} profiles, ` +
          `${totals.accountsWithPair} with a pair`
      );
    }
  } else {
    if (args.maxRequests < args.walletBatch) {
      throw new Error(
        '--max-requests must be at least --wallet-batch, or no batch can ' +
          'finish and the checkpoint can never advance.'
      );
    }

    let cursor = args.sinceWallet ?? (await getWalletsCheckpoint()) ?? '';
    console.log(
      `${label}: addresses after ${cursor || 'the first'}, ` +
        `max ${args.maxRequests} requests, ${args.walletBatch} per checkpoint`
    );

    while (totals.requests + args.walletBatch <= args.maxRequests) {
      const wallets = await nextWalletPage(cursor, args.walletBatch);
      if (wallets.length === 0) {
        exhausted = true;
        if (args.commit) await markWalletsComplete();
        break;
      }
      const pageEnd = wallets[wallets.length - 1];

      /**
       * Filtered BEFORE the request, not after. Asking a third party about a
       * suppressed address is re-collection whether or not the answer is
       * stored, which is the pre-flight rule in `lib/suppression.ts`.
       */
      const sets = await loadSuppressionList();
      const askable = wallets.filter(
        (w) => !isKindSuppressed(sets, 'wallet', w)
      );
      refusals.suppressed += wallets.length - askable.length;

      const links: AttestedLink[] = [];
      const observed: ZoraFarcasterObservation[] = [];
      let pageFailed = false;

      for (const wallet of askable) {
        let payload: unknown;
        try {
          payload = await fetchProfile(wallet);
          totals.requests++;
        } catch (err) {
          if (!(err instanceof ZoraTransportError)) throw err;
          totals.requests++;
          refusals.transport_failure++;
          console.warn(`  ${wallet}: ${err.message}`);
          pageFailed = true;
          break;
        }

        totals.profiles++;
        const reading = readProfile(payload);
        addRefusals(refusals, reading.refusals);
        if (reading.links.length > 0) totals.accountsWithPair++;
        links.push(...reading.links);
        observed.push(...reading.farcaster);
      }

      const kept = await dropSuppressed(links, refusals);
      await commitPage(kept, totals, args.commit);
      addAudit(audit, await auditFarcaster(observed));

      if (pageFailed) {
        stoppedOnFailure = true;
        break;
      }

      cursor = pageEnd;
      if (args.commit) await saveWalletsCheckpoint(cursor);
      console.log(
        `  ${totals.requests} requests, ${totals.profiles} profiles, ` +
          `${totals.accountsWithPair} with a pair, at ${cursor}`
      );
    }
  }

  if (stoppedOnFailure) {
    console.log(
      '\nStopped: the API stopped answering. The checkpoint was left where it ' +
        'was, so the next run retries the same page. A cursor that does not ' +
        'move week after week is a page that needs a look, not a quiet gap.'
    );
  } else if (exhausted) {
    console.log(
      '\nReached the end of the walk.' +
        (args.commit
          ? ' The checkpoint was reset to the start, because both walks move ' +
            'away from where new rows appear and a finished walk that kept ' +
            'its cursor would find nothing ever again.'
          : '')
    );
  } else {
    console.log(
      `\nRequest budget (${args.maxRequests}) reached; re-run to continue from ` +
        'the checkpoint.'
    );
  }

  const refused: Record<string, number> = {};
  for (const reason of ZORA_REFUSALS) {
    if (refusals[reason] !== 0) refused[reason] = refusals[reason];
  }

  console.log('Totals:', JSON.stringify(totals, null, 2));
  console.log('Refused:', JSON.stringify(refused, null, 2));
  if (!args.parseOnly) {
    console.log(
      'Farcaster audit (read only, nothing written):',
      JSON.stringify(audit, null, 2)
    );
  }

  if (!args.commit && !args.parseOnly) {
    console.log(
      '\nDry run: nothing written, no checkpoint saved. Re-run with --commit. ' +
        '(In dry run "conflicts" counts disagreements found.)'
    );
  }

  /**
   * A run that gave up on the upstream exits red, even though what it read was
   * ingested and the checkpoint is correct.
   *
   * This runs unattended. A stopped walk that exits 0 looks exactly like a
   * healthy one in the workflow list, and the only visible symptom would be a
   * cursor that stopped moving, which nobody is watching. The same reasoning
   * makes the attested sweeps answer 502 on an empty read rather than 200.
   */
  if (stoppedOnFailure) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
