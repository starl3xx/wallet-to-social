'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowsClockwise as RefreshCw,
  CircleNotch as Loader2,
} from '@phosphor-icons/react';
import type {
  ClusterAlarm,
  RemovalReport,
  SuppressionKind,
  SuppressionLane,
  SuppressionListRow,
  SuppressionReason,
} from '@/lib/removal-admin';
import { Stat } from './Stat';
import { RefreshButton } from './RefreshButton';
import { Banner } from './Banner';
import { Empty, Loading } from './PaneState';

/**
 * The operator console for the right-to-removal system: stage 1.
 *
 * There is no queue to show. Intake is the support inbox and execution is
 * this pane, so "pending" is whatever is sitting in mail, and the pane shows
 * instead what exists: the recent suppressions, the un-suppress action, and
 * the clustering alarm.
 *
 * Two disclosure rules meet here and they point in opposite directions. The
 * operator is the verified party, so the execution result is honest and
 * itemized: which tables held rows, what was quarantined, what was amended.
 * The person who wrote in gets the uniform reply script, which never
 * confirms whether a record existed. The pane states that boundary next to
 * the result, because the result is exactly the thing the reply must not
 * paraphrase.
 *
 * Identifiers in the list are masked for display (the row is identifiable
 * to the operator, not to a screenshot); the full value rides in state for
 * the un-suppress action.
 */

/**
 * Type-only imports keep these option lists honest: a value outside the
 * vocabulary `lib/removal-admin.ts` exports fails the build. The runtime
 * authority is the CHECK constraints the suppression migration installs.
 */
const KINDS: SegmentedOption<SuppressionKind>[] = [
  { value: 'wallet', label: 'Wallet', content: 'Wallet' },
  { value: 'twitter', label: 'X handle', content: 'X' },
  { value: 'farcaster', label: 'Farcaster', content: 'FC' },
  { value: 'ens', label: 'ENS name', content: 'ENS' },
  { value: 'lens', label: 'Lens', content: 'Lens' },
  { value: 'github', label: 'GitHub', content: 'GitHub' },
];

/**
 * Stage 1 writes only these two: `wallet_sig` and `handle_proof` are the
 * stage 2 self-serve lanes (the endpoint accepts all four so stage 2 needs
 * no vocabulary change, but nothing verifies a signature or a posted nonce
 * yet, and a lane must record how a request was actually verified).
 */
const LANES: SegmentedOption<SuppressionLane>[] = [
  { value: 'email', label: 'Email lane', content: 'Email' },
  { value: 'legal', label: 'Legal', content: 'Legal' },
];

const REASONS: SegmentedOption<SuppressionReason>[] = [
  { value: 'requested', label: 'Requested', content: 'Requested' },
  { value: 'operator', label: 'Operator', content: 'Operator' },
  { value: 'legal', label: 'Legal', content: 'Legal' },
];

interface AlarmState extends Partial<ClusterAlarm> {
  error?: string;
}

interface PaneData {
  total: number;
  suppressions: SuppressionListRow[];
  alarm: AlarmState;
  retentionDays: number;
}

interface PostResult {
  removed: RemovalReport[];
  alarm: AlarmState | null;
}

export function RemovalPane({ password }: { password: string }) {
  const [data, setData] = useState<PaneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The execution form.
  const [kind, setKind] = useState<SuppressionKind>('wallet');
  const [identifier, setIdentifier] = useState('');
  const [lane, setLane] = useState<SuppressionLane>('email');
  const [reason, setReason] = useState<SuppressionReason>('requested');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PostResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Un-suppress state: which row is in flight, and a purged-copy refusal
  // waiting for the operator to acknowledge.
  const [unsuppressing, setUnsuppressing] = useState<string | null>(null);
  const [purgedPrompt, setPurgedPrompt] = useState<{
    kind: SuppressionKind;
    identifier: string;
    message: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/removal?limit=50', {
        headers: { 'x-admin-password': password },
      });
      if (!res.ok) throw new Error('Failed to fetch removal data');
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const execute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setSubmitting(true);
    setActionError(null);
    setNotice(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/removal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password,
        },
        body: JSON.stringify({
          identifiers: [{ kind, identifier: identifier.trim() }],
          lane,
          reason,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        // A failed run still reports what it completed; the suppression
        // rows are committed, so the message says to re-run, not to panic.
        setActionError(payload.error ?? 'Removal failed');
        return;
      }
      setResult(payload);
      setIdentifier('');
      fetchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Removal failed');
    } finally {
      setSubmitting(false);
    }
  };

  const unsuppress = async (
    targetKind: SuppressionKind,
    targetIdentifier: string,
    acknowledgePurged = false
  ) => {
    const key = `${targetKind}:${targetIdentifier}`;
    setUnsuppressing(key);
    setActionError(null);
    setNotice(null);
    setPurgedPrompt(null);
    try {
      const res = await fetch('/api/admin/removal', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password,
        },
        body: JSON.stringify({
          kind: targetKind,
          identifier: targetIdentifier,
          acknowledgePurged,
        }),
      });
      const payload = await res.json();
      if (res.status === 409) {
        setPurgedPrompt({
          kind: targetKind,
          identifier: targetIdentifier,
          message: payload.error ?? 'The quarantine copy has been purged.',
        });
        return;
      }
      if (!res.ok) {
        setActionError(payload.error ?? 'Un-suppress failed');
        return;
      }
      const restoredRows = (payload.restored ?? []).reduce(
        (sum: number, s: { rows: number }) => sum + s.rows,
        0
      );
      const keptRows = (payload.kept ?? []).reduce(
        (sum: number, s: { rows: number }) => sum + s.rows,
        0
      );
      const base =
        restoredRows > 0
          ? `Un-suppressed; ${restoredRows} quarantined row${restoredRows === 1 ? '' : 's'} processed.`
          : 'Un-suppressed. Nothing restored from quarantine.';
      setNotice(
        keptRows > 0
          ? // The server's note says why and what to do; it is the authority.
            `${base} ${keptRows} cop${keptRows === 1 ? 'y' : 'ies'} kept: ${payload.note ?? 'blocked by another suppression; re-run after lifting it.'}`
          : restoredRows > 0
            ? `${base} Anything still covered by another suppression stays out.`
            : 'Un-suppressed. Nothing was held in quarantine, so the identity returns only as re-collection finds it.'
      );
      fetchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Un-suppress failed');
    } finally {
      setUnsuppressing(null);
    }
  };

  if (loading && !data) return <Loading />;

  if (error && !data) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const alarm = data.alarm;
  const retention = data.retentionDays;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
          Removal
        </h2>
        <RefreshButton onClick={fetchData} loading={loading} />
      </div>

      {/* The clustering alarm. A warning, never a block: the operator sees
          it beside the form before executing the next request. */}
      {alarm.error ? (
        <p className="text-sm text-caution">
          The clustering alarm query failed, so the figures below are absent
          rather than measured: {alarm.error}
        </p>
      ) : (
        alarm.warning && (
          <Banner tone="error">
            <p>
              {alarm.starterHits} suppressed wallet
              {alarm.starterHits === 1 ? '' : 's'} in the trailing{' '}
              {alarm.windowDays} days belong to seeded collections
              {alarm.clusters && alarm.clusters.length > 0 && (
                <>
                  {': '}
                  {alarm.clusters
                    .map((c) => `${c.name} (${c.suppressed})`)
                    .join(', ')}
                </>
              )}
              . A burst aimed at one collection&rsquo;s holders is the griefing
              shape; review the requests before executing more. This warns and
              never blocks.
            </p>
          </Banner>
        )
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat
          label="Suppressions"
          value={data.total.toLocaleString()}
          note="all time"
        />
        <Stat
          label="Starter-collection hits"
          value={alarm.starterHits?.toLocaleString() ?? 'n/a'}
          note={`trailing ${alarm.windowDays ?? '?'} days, warns at ${alarm.threshold ?? '?'}`}
        />
        <Stat
          label="Quarantine window"
          value={`${retention} days`}
          note="then the copy is purged"
        />
      </div>

      {/* The execution form. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execute a removal</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={execute} className="space-y-4">
            <div className="space-y-2">
              <Segmented
                ariaLabel="Identifier kind"
                value={kind}
                onChange={setKind}
                options={KINDS}
                className="w-full"
              />
              <Input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  kind === 'wallet'
                    ? '0x… address, exactly as the request names it'
                    : 'Handle or name, without the @'
                }
                aria-label="Identifier"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                ariaLabel="Verification lane"
                value={lane}
                onChange={setLane}
                options={LANES}
              />
              <Segmented
                ariaLabel="Reason"
                value={reason}
                onChange={setReason}
                options={REASONS}
              />
              <Button type="submit" disabled={submitting || !identifier.trim()}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                Suppress and erase
              </Button>
            </div>
          </form>
          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            One request naming several identifiers is executed one identifier at
            a time, here: each becomes its own suppression row, timestamps are
            jittered, and nothing stored joins them. The suppression row commits
            before any deletion, so a sweep batch racing these deletes
            re-inserts nothing. Rows land in quarantine for {retention} days
            before the erasure is final.
          </p>
        </CardContent>
      </Card>

      {actionError && (
        <Banner tone="error">
          <p>{actionError}</p>
        </Banner>
      )}
      {notice && (
        <Banner tone="success">
          <p>{notice}</p>
        </Banner>
      )}

      {/* The purged-copy refusal, with the explicit acknowledgement. */}
      {purgedPrompt && (
        <Card>
          <CardContent>
            <p className="text-sm">{purgedPrompt.message}</p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  unsuppress(purgedPrompt.kind, purgedPrompt.identifier, true)
                }
              >
                Lift the block anyway
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPurgedPrompt(null)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* The itemized result of the last execution: the operator's honest
          view, and the input to the uniform reply. */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last execution</CardTitle>
          </CardHeader>
          <CardContent>
            {result.removed.map((r) => (
              <div key={`${r.kind}:${r.identifier}`} className="mb-4 last:mb-0">
                <p className="text-sm">
                  {/* Masked, same as the table below: the execution result is
                      the screen an operator most likely screenshots. */}
                  <span className="font-mono text-xs">
                    {r.identifierMasked}
                  </span>{' '}
                  ({r.kind}):{' '}
                  {r.suppression === 'created'
                    ? 'suppression created'
                    : 'already suppressed'}
                  , {r.quarantined} row{r.quarantined === 1 ? '' : 's'}{' '}
                  quarantined,{' '}
                  {r.hadRecords ? 'records were held' : 'no records were held'}.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Table</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Rows</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.steps.map((s, i) => (
                      <TableRow key={`${s.table}-${s.action}-${i}`}>
                        <TableCell className="font-mono text-xs">
                          {s.table}
                        </TableCell>
                        <TableCell>{s.action}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.rows.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
            <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
              This itemization is for you. The reply to the requester uses the
              uniform script, which acknowledges the suppression and never says
              whether records existed; don&rsquo;t paraphrase these numbers into
              the mail.
            </p>
          </CardContent>
        </Card>
      )}

      {/* The record: recent suppressions, masked, with the un-suppress
          action. No pending count exists in stage 1; intake is the inbox. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent suppressions</CardTitle>
        </CardHeader>
        <CardContent>
          {data.suppressions.length === 0 ? (
            <Empty>No suppressions recorded</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Identifier</TableHead>
                  <TableHead>Lane</TableHead>
                  <TableHead>Created (day)</TableHead>
                  <TableHead>Quarantine expires</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.suppressions.map((s) => {
                  const key = `${s.kind}:${s.identifier}`;
                  return (
                    <TableRow key={key}>
                      <TableCell>{s.kind}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {s.identifierMasked}
                      </TableCell>
                      <TableCell>{s.lane}</TableCell>
                      <TableCell className="tabular-nums">
                        {s.createdDay}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {s.quarantineExpires ??
                          (s.quarantineRows === 0 ? 'nothing held' : '')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={unsuppressing !== null}
                          onClick={() => unsuppress(s.kind, s.identifier)}
                        >
                          {unsuppressing === key ? (
                            <Loader2
                              className="h-4 w-4 animate-spin"
                              aria-hidden
                            />
                          ) : null}
                          Un-suppress
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            Identifiers are masked for display; the un-suppress action carries
            the full value. The stored timestamps are jittered by design, so
            rows from one request can&rsquo;t be rejoined by timestamp and the
            day shown is approximate. &ldquo;Nothing held&rdquo; means the index
            had no rows for the identifier when it was suppressed, or the{' '}
            {retention}-day quarantine has already been purged.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
