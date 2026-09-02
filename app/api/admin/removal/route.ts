import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/db';
import {
  QUARANTINE_RETENTION_DAYS,
  SUPPRESSION_LANES,
  SUPPRESSION_REASONS,
  clusteringAlarm,
  eraseIdentifier,
  insertSuppressions,
  listRecentSuppressions,
  maskIdentifier,
  normalizeRemovalTarget,
  unsuppressIdentifier,
  type RemovalReport,
  type RemovalTarget,
  type SuppressionLane,
  type SuppressionReason,
} from '@/lib/removal-admin';

export const runtime = 'nodejs';

/**
 * The operator-executed removal endpoint: stage 1 of the right-to-removal
 * system. Intake is the support inbox; the operator names the identifiers
 * the person named, and nothing about the person is recorded. The heavy
 * commentary (ordering, quarantine, jitter, the amendment) lives with the
 * work in `lib/removal-admin.ts`.
 *
 * The responses here are for the operator, who is the verified party, so
 * they are honest and itemized: how many rows each table held, what was
 * quarantined, what was amended. The email reply the requester receives is
 * a different document with the opposite rule (it never confirms whether a
 * record existed); this endpoint feeds the operator the facts, and the
 * uniform reply script decides what leaves the building.
 *
 * Rides the shared admin password like every /api/admin route; the
 * lockout and its limits are `lib/admin-auth.ts`'s.
 */

/** An email names a handful of identifiers; a list longer than this is not
 *  a removal request, it is a bulk delete wearing one's clothes. */
const MAX_TARGETS = 25;

interface PostBody {
  identifiers?: Array<{ kind?: string; identifier?: string }>;
  lane?: string;
  reason?: string;
}

export async function POST(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  let body: PostBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawTargets = body.identifiers;
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
    return NextResponse.json(
      { error: 'identifiers must be a non-empty array of {kind, identifier}' },
      { status: 400 }
    );
  }
  if (rawTargets.length > MAX_TARGETS) {
    return NextResponse.json(
      { error: `At most ${MAX_TARGETS} identifiers per request` },
      { status: 400 }
    );
  }

  const lane = (body.lane ?? 'email') as SuppressionLane;
  if (!SUPPRESSION_LANES.includes(lane)) {
    return NextResponse.json(
      { error: `lane must be one of: ${SUPPRESSION_LANES.join(', ')}` },
      { status: 400 }
    );
  }
  const reason = (body.reason ?? 'requested') as SuppressionReason;
  if (!SUPPRESSION_REASONS.includes(reason)) {
    return NextResponse.json(
      { error: `reason must be one of: ${SUPPRESSION_REASONS.join(', ')}` },
      { status: 400 }
    );
  }

  // Validate everything before writing anything, so a typo in the third
  // identifier cannot leave the first two half-processed.
  const targets: RemovalTarget[] = [];
  for (const raw of rawTargets) {
    const norm = normalizeRemovalTarget(
      String(raw?.kind ?? ''),
      String(raw?.identifier ?? '')
    );
    if (!norm.ok) {
      return NextResponse.json({ error: norm.error }, { status: 400 });
    }
    if (
      targets.some(
        (t) => t.kind === norm.kind && t.identifier === norm.identifier
      )
    ) {
      continue; // The same identifier twice in one request is one request.
    }
    targets.push({ kind: norm.kind, identifier: norm.identifier });
  }

  // Step 1: the suppression rows, inserted and committed FIRST, one
  // statement each. From this moment an in-flight sweep batch that
  // re-inserts behind the deletes below is harmless: the storage triggers
  // read these committed rows and refuse or blank the write.
  let outcomes: Map<string, 'created' | 'already-present'>;
  try {
    outcomes = await insertSuppressions(db, targets, lane, reason);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Failed inserting suppression rows: ${e instanceof Error ? e.message : String(e)}`,
        completed: [],
        remaining: targets,
      },
      { status: 500 }
    );
  }

  // Steps 2 and 3: quarantine, delete or blank, then amend the saved
  // copies. Non-fail-soft: the first failure stops the run and the response
  // names exactly what remains, because every step is idempotent and the
  // repair is to run the same request again.
  const completed: RemovalReport[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const { steps, quarantined } = await eraseIdentifier(
        db,
        t.kind,
        t.identifier
      );
      completed.push({
        kind: t.kind,
        identifier: t.identifier,
        identifierMasked: maskIdentifier(t.kind, t.identifier),
        suppression: outcomes.get(`${t.kind}:${t.identifier}`) ?? 'created',
        steps,
        quarantined,
        hadRecords:
          quarantined > 0 ||
          steps.some((s) => s.action === 'amended' && s.rows > 0),
      });
    } catch (e) {
      return NextResponse.json(
        {
          error:
            `Removal of ${t.kind} '${t.identifier}' failed: ` +
            `${e instanceof Error ? e.message : String(e)}. ` +
            'The suppression rows are committed (re-collection is already blocked); ' +
            're-run this same request to finish the erasure.',
          completed,
          failedAt: { kind: t.kind, identifier: t.identifier },
          remaining: targets.slice(i),
        },
        { status: 500 }
      );
    }
  }

  // The clustering alarm, computed after the erasure so the current batch
  // counts itself (its wallet_holdings rows are readable from quarantine).
  let alarm = null;
  try {
    alarm = await clusteringAlarm(db);
  } catch (e) {
    // The alarm is advisory; a failure to compute it must not report a
    // finished removal as failed. It is surfaced instead of swallowed.
    alarm = {
      error: `Alarm query failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return NextResponse.json({ removed: completed, alarm });
}

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  const limit = Math.min(Math.max(limitParam || 50, 1), 200);

  try {
    const [list, alarm] = await Promise.all([
      listRecentSuppressions(db, limit),
      clusteringAlarm(db),
    ]);
    return NextResponse.json({
      total: list.total,
      suppressions: list.rows,
      alarm,
      retentionDays: QUARANTINE_RETENTION_DAYS,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

interface DeleteBody {
  kind?: string;
  identifier?: string;
  acknowledgePurged?: boolean;
}

/**
 * Un-suppress: restores the quarantined rows and deletes the suppression
 * row. Operator-only in stage 1. Refuses once the quarantine copy has been
 * purged, with `acknowledgePurged` as the explicit way to lift the block
 * anyway and let re-collection rebuild what it finds.
 */
export async function DELETE(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  let body: DeleteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const norm = normalizeRemovalTarget(
    String(body.kind ?? ''),
    String(body.identifier ?? '')
  );
  if (!norm.ok) {
    return NextResponse.json({ error: norm.error }, { status: 400 });
  }

  try {
    const result = await unsuppressIdentifier(
      db,
      norm.kind,
      norm.identifier,
      body.acknowledgePurged === true
    );
    if ('refusal' in result) {
      return NextResponse.json(
        { error: result.refusal },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          `Un-suppress of ${norm.kind} '${norm.identifier}' failed: ` +
          `${e instanceof Error ? e.message : String(e)}. ` +
          'Un-restored quarantine rows are still held; re-run to finish.',
      },
      { status: 500 }
    );
  }
}
