'use client';

/**
 * Turning a result set into an X list, from the menu and back again.
 *
 * Two exports because the feature is two things separated by a trip through
 * x.com. `XListMenuItem` describes the list and hands the browser to X;
 * `XListStatus` is what the person comes back to, driven entirely by the query
 * parameters the callback redirects with, so it works on a cold page load in a
 * new tab rather than only inside the session that started it.
 *
 * ## Why the name is capped at 25 in the input
 *
 * X's limit, enforced in three places on purpose: `maxLength` here so it cannot
 * be typed, a check in the route so it cannot be posted, and a CHECK on the
 * column so it cannot be stored. The input is the only one of the three a
 * person ever sees, and the other two exist because a job that runs for sixteen
 * minutes and is then refused by X for a 26-character name is a bad way to
 * learn about a limit.
 */
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MenuItem } from '@/components/ui/overflow-menu';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { XMark } from '@/components/ui/brand-marks';
import { Lock, WarningCircle } from '@phosphor-icons/react';

/** X's own limits, restated here only for the input attributes. */
const NAME_MAX = 25;
const DESCRIPTION_MAX = 100;

export function XListMenuItem({
  handles,
  defaultName,
  entitled,
  onUpgradeClick,
}: {
  handles: string[];
  defaultName?: string;
  entitled: boolean;
  onUpgradeClick?: (source?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (handles.length === 0) return null;

  if (!entitled) {
    return (
      <MenuItem onClick={() => onUpgradeClick?.('x-list')}>
        <Lock className="h-4 w-4" aria-hidden />
        Create X list
      </MenuItem>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/x/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          isPrivate,
          handles,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.authorize_url) {
        setError(json.message || 'The list could not be started.');
        setBusy(false);
        return;
      }
      /**
       * A full navigation, not a popup. A popup is blocked often enough that
       * the failure would be invisible, and X's consent screen is a page a
       * person should see at full size with the address bar showing, since
       * the whole question it asks is whether to trust this site.
       */
      window.location.href = json.authorize_url;
    } catch {
      setError('The list could not be started.');
      setBusy(false);
    }
  };

  return (
    <>
      <MenuItem
        onClick={() => {
          setName(defaultName?.slice(0, NAME_MAX) ?? '');
          setOpen(true);
        }}
      >
        <XMark className="h-4 w-4" />
        Create X list ({handles.length.toLocaleString()})
      </MenuItem>

      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Create an X list</ModalTitle>
            <ModalDescription>
              {handles.length.toLocaleString()} reachable handles, added to a
              list in your own X account. You&rsquo;ll authorize with X on the
              next screen.
            </ModalDescription>
          </ModalHeader>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="x-list-name"
                className="mb-1.5 block text-sm font-medium"
              >
                List name
              </label>
              <Input
                id="x-list-name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="Loopers on X"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {name.length}/{NAME_MAX}
              </p>
            </div>

            <div>
              <label
                htmlFor="x-list-description"
                className="mb-1.5 block text-sm font-medium"
              >
                Description{' '}
                <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="x-list-description"
                value={description}
                maxLength={DESCRIPTION_MAX}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Holders, found onchain"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent-brand)]"
              />
              Keep the list private
            </label>

            {/* X adds one member per request at 300 per fifteen minutes, which
                is 20 a minute sustained, and the worker adds 20 per
                one-minute tick to match. So the estimate is simply members
                divided by 20.

                It was `ceil(n / 300) * 15 - 14`, which assumes a burst of 300
                followed by a wait. The worker does not do that, and the
                formula said one minute for a 300-member list that takes
                fifteen. It was right at 319, which is the size it was written
                against. Said before the click either way, because a large
                list is genuinely slow and that is not a surprise worth
                saving. */}
            <p className="text-xs text-muted-foreground">
              X allows 20 additions a minute, so this takes about{' '}
              {Math.max(1, Math.ceil(handles.length / 20))} minutes. You can
              close this page; the list keeps building.
            </p>

            {error && (
              <p className="flex items-start gap-2 text-sm text-caution">
                <WarningCircle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  weight="fill"
                  aria-hidden
                />
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={busy || name.trim().length === 0}
              >
                {busy ? 'Starting…' : 'Continue to X'}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}

interface JobStatus {
  status: string;
  list_name: string;
  url: string | null;
  added: number;
  skipped: number;
  failed: number;
  total: number;
  error: string | null;
  rate_limited_until: string | null;
}

/**
 * What the person comes back to.
 *
 * Reads the callback's own query parameters rather than any state this app
 * kept, because the round trip may land in a different tab, after a restart, or
 * an hour later. A job id in the URL and a session cookie are the only two
 * things guaranteed to still be there.
 */
export function XListStatus() {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);

  /**
   * eslint-disable-next-line is deliberate and narrow.
   *
   * `react-hooks/set-state-in-effect` exists to catch state derived from other
   * state, which should be computed during render instead. This is the case
   * the rule's own text carves out: reading the URL is subscribing to an
   * external system, and it happens exactly once on mount.
   *
   * The alternative, a lazy `useState` initializer, reads `window` during
   * render and so renders differently on the server than on the client, which
   * trades a lint warning for a hydration mismatch.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const o = params.get('x_list');
    if (!o) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setOutcome(o);
    setJobId(params.get('x_list_job'));

    /**
     * The parameters are removed from the address bar once read, so a refresh
     * does not replay a one-time outcome and a shared URL does not carry
     * somebody's job id.
     */
    params.delete('x_list');
    params.delete('x_list_job');
    const rest = params.toString();
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (rest ? `?${rest}` : '')
    );
  }, []);

  const poll = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`/api/x/lists/${jobId}`);
      if (!res.ok) return;
      setJob(await res.json());
    } catch {
      // A failed poll is not a failed job. The next tick tries again.
    }
  }, [jobId]);

  /**
   * Poll once immediately, then every five seconds until the job settles.
   *
   * The immediate call is what stops the banner sitting on "Building your X
   * list" with no numbers for the first five seconds, which is exactly when
   * somebody is looking at it, having just arrived from x.com.
   *
   * `poll` is async, so its `setJob` runs in a promise continuation rather
   * than synchronously in the effect body; the rule cannot see that and flags
   * the call site. Suppressed narrowly rather than restructured, because every
   * restructuring either delays the first paint or moves the fetch into render.
   */
  useEffect(() => {
    if (!jobId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async, see above
    poll();
    const done = job?.status === 'completed' || job?.status === 'failed';
    if (done) return;
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [jobId, poll, job?.status]);

  if (!outcome) return null;

  if (outcome === 'cancelled') return null;

  if (outcome !== 'queued') {
    return (
      <div className="mb-4 rounded-lg border border-border bg-caution-tint px-4 py-3 text-sm">
        The X list could not be started. Nothing was added to your account.
      </div>
    );
  }

  const pct =
    job && job.total > 0 ? Math.round((job.added / job.total) * 100) : 0;

  return (
    <div className="mb-4 rounded-lg border border-border px-4 py-3 text-sm">
      {job?.status === 'completed' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {job.list_name} is ready: {job.added.toLocaleString()} added
          </span>
          {job.skipped + job.failed > 0 && (
            <span className="text-muted-foreground">
              ({(job.skipped + job.failed).toLocaleString()} could not be added)
            </span>
          )}
          {job.url && (
            <Button asChild variant="link" size="inline">
              <a href={job.url} target="_blank" rel="noopener noreferrer">
                Open on X
              </a>
            </Button>
          )}
        </div>
      ) : job?.status === 'failed' ? (
        <span>
          The X list stopped: {job.error ?? 'unknown reason'}.{' '}
          {job.added > 0 &&
            `${job.added.toLocaleString()} were added before it did.`}
        </span>
      ) : (
        <span>
          Building {job?.list_name ?? 'your X list'}
          {job
            ? `: ${job.added.toLocaleString()} of ${job.total.toLocaleString()}`
            : ''}
          {pct > 0 ? ` (${pct}%)` : ''}
          {job?.rate_limited_until ? ', waiting for X' : '…'}
        </span>
      )}
    </div>
  );
}
