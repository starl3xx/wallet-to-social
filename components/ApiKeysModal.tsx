'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InlineError } from '@/components/ui/inline-error';
import { XMark } from '@/components/ui/brand-marks';
import {
  ArrowSquareOut,
  Copy,
  Check,
  CircleNotch as Loader2,
  Warning as AlertTriangle,
  Trash as Trash2,
} from '@phosphor-icons/react';
import { API_PLANS, apiPlanForAccount } from '@/lib/api-plans';
import type { UserTier } from '@/lib/access';
import { cn } from '@/lib/utils';

interface ApiKeysModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier: UserTier;
  /** Whether credits back this account. See lib/use-credits.ts. */
  entitled?: boolean;
  onUpgradeClick?: () => void;
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
}

const DOCS_URL = 'https://docs.walletlink.social/api-reference/introduction';

/**
 * The one treatment for a text link that leaves the site: the `link` Button
 * at `inline` size, so it is violet with an underline on hover like every
 * other link in a sentence, and `ArrowSquareOut` at 12px, the one leave-site
 * glyph (site-footer carries the same). Two links here had two treatments
 * between them, one in foreground and one in muted, both underlined at rest.
 *
 * `size-3`, which is `h-3 w-3`, because Button sizes any SVG child without a
 * `size-` class to 16px and that rule outranks the icon's own classes.
 * `gap-1`, because the 8px a button puts between an icon and its label is
 * too wide for an arrow trailing a word.
 */
function DocsLink({
  children,
  className,
}: {
  children: React.ReactNode;
  /** Type comes from the surrounding text; `cn` lets it beat the base. */
  className?: string;
}) {
  return (
    <Button
      asChild
      variant="link"
      size="inline"
      className={cn('gap-1', className)}
    >
      <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
        {children}
        <ArrowSquareOut className="size-3" aria-hidden />
      </a>
    </Button>
  );
}

function formatDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ApiKeysModal({
  open,
  onOpenChange,
  tier,
  entitled = false,
  onUpgradeClick,
}: ApiKeysModalProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  // Separates "nothing here" from "not asked yet". Without it the first paint
  // renders an empty array as a settled answer, so an account with keys is
  // briefly told it has none.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The one and only time the raw key exists in the client. Deliberately not
  // persisted anywhere: no localStorage, no history entry, and cleared when the
  // modal closes. The server stores a hash, so this really is unrecoverable.
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  // apiPlanForAccount, not apiPlanForTier: a pack buyer's tier is `free`, and
  // the description two hundred lines below already tells them API access comes
  // with credits. The gate has to agree with the copy.
  const planId = apiPlanForAccount(tier, entitled);
  const plan = planId ? API_PLANS[planId] : null;
  const hasApiAccess = !!plan;

  const activeKeys = keys.filter((k) => k.is_active);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/developer/keys');
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || 'Could not load your API keys');
      setKeys(data.keys ?? []);
      setHasLoaded(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not load your API keys'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && hasApiAccess) loadKeys();
  }, [open, hasApiAccess, loadKeys]);

  const handleClose = useCallback(() => {
    // Refuse to close while a key is being minted. The server creates it
    // regardless of what the client does, and it is returned exactly once, so
    // closing here would leave a real key that nobody ever saw: unusable,
    // unrecoverable, and still consuming one of the ten active slots. A blocked
    // dismiss for a moment is much cheaper than a phantom key.
    if (creating) return;
    setRevealedKey(null);
    setNewKeyName('');
    setError(null);
    setConfirmRevokeId(null);
    setCopied(false);
    onOpenChange(false);
  }, [creating, onOpenChange]);

  const handleCreate = useCallback(async () => {
    const name = newKeyName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/developer/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the key');
      setRevealedKey(data.key.api_key);
      setNewKeyName('');
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the key');
    } finally {
      setCreating(false);
    }
  }, [newKeyName, creating, loadKeys]);

  const handleRevoke = useCallback(
    async (id: string) => {
      setRevokingId(id);
      setError(null);
      try {
        const res = await fetch(`/api/developer/keys/${id}`, {
          method: 'DELETE',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not revoke the key');
        await loadKeys();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Could not revoke the key'
        );
      } finally {
        setRevokingId(null);
        setConfirmRevokeId(null);
      }
    },
    [loadKeys]
  );

  const handleCopy = useCallback(async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked by permissions or a non-secure context. The
      // key is selectable in the field either way, so this is not fatal.
      setError(
        'Could not copy automatically. Select the key and copy it manually.'
      );
    }
  }, [revealedKey]);

  return (
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent className="max-w-lg">
        <ModalHeader>
          <ModalTitle>API keys</ModalTitle>
          <ModalDescription>
            {hasApiAccess
              ? 'Programmatic access to the wallet index. Keys draw on your whole credit balance, so treat them as server-side secrets.'
              : 'API access comes with credits, and draws on the same balance. Buy a pack to get a key.'}
          </ModalDescription>
        </ModalHeader>

        {!hasApiAccess ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted p-4 text-sm">
              {/* The mark, not the 𝕏 character: Söhne has no U+1D54F, so the
                  character fell back to another face and sat visibly thinner
                  than the words around it. Sized and aligned as the home
                  page sets it in copy. */}
              <p className="mb-3">
                The API resolves wallets to social identities in both
                directions, including reverse lookups from an{' '}
                <XMark className="inline h-3 w-3 align-[-0.1em]" label="X" />{' '}
                handle or Farcaster username back to wallets.
              </p>
              <DocsLink>Read the API reference</DocsLink>
            </div>
            {onUpgradeClick && (
              <ModalFooter>
                <Button
                  onClick={() => {
                    handleClose();
                    onUpgradeClick();
                  }}
                >
                  Buy credits
                </Button>
              </ModalFooter>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Rate limits, read from lib/api-plans.ts so this can never drift
                from what the rate limiter actually enforces. These bound the
                burst; the match balance bounds the total. */}
            <div className="rounded-lg border border-border bg-muted p-4 text-xs sm:text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Rate limits</span>
                <DocsLink className="text-xs sm:text-sm">Docs</DocsLink>
              </div>
              <p className="mt-1 text-muted-foreground">
                {plan.requestsPerMinute}/min ·{' '}
                {plan.requestsPerDay < 0
                  ? 'unlimited'
                  : `${plan.requestsPerDay.toLocaleString()}/day`}{' '}
                · batch up to {plan.maxBatchSize}
              </p>
            </div>

            {/* The one inline error shape; see components/ui/inline-error.tsx. */}
            {error && <InlineError>{error}</InlineError>}

            {/* Shown exactly once, immediately after creation. */}
            {revealedKey && (
              <div className="rounded-lg bg-caution-tint p-3">
                <div className="mb-2 flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-caution" />
                  <p className="text-xs text-caution">
                    Copy this now. It is shown once and only a hash is stored,
                    so it cannot be recovered later, only replaced.
                  </p>
                </div>
                {/* `break-all`, not `overflow-x-auto`: a sideways scroll hides
                    part of the key behind a gesture on the one screen where
                    the person must see all of it, and a key has no word
                    boundaries to wrap at. `select-all` so one tap takes the
                    whole value when the clipboard is blocked. The Copy button
                    stays the primary way out. */}
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 select-all break-all rounded-sm border bg-background px-2 py-1.5 font-mono text-xs">
                    {revealedKey}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopy}
                    aria-label="Copy API key"
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Existing keys */}
            {loading && !hasLoaded ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : hasLoaded && activeKeys.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No active keys yet. Create one below to start using the API.
              </p>
            ) : (
              <ul className="space-y-2">
                {activeKeys.map((key) => (
                  <li
                    key={key.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{key.name}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {key.prefix}…
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Created {formatDate(key.created_at)}
                        {key.last_used_at
                          ? ` · last used ${formatDate(key.last_used_at)}`
                          : ' · never used'}
                      </p>
                    </div>
                    {confirmRevokeId === key.id ? (
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={revokingId === key.id}
                          onClick={() => handleRevoke(key.id)}
                        >
                          {revokingId === key.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Revoke'
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmRevokeId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="flex-shrink-0"
                        onClick={() => setConfirmRevokeId(key.id)}
                        aria-label={`Revoke ${key.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Create */}
            <div className="space-y-2 border-t pt-4">
              <label htmlFor="api-key-name" className="text-sm font-medium">
                Create a key
              </label>
              <div className="flex gap-2">
                <Input
                  id="api-key-name"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                  }}
                  placeholder="production"
                  maxLength={64}
                />
                <Button
                  onClick={handleCreate}
                  disabled={!newKeyName.trim() || creating}
                  className="flex-shrink-0"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Create'
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {creating
                  ? 'Creating your key. Keep this open, it is shown only once.'
                  : 'Name it after where it runs, so a leaked key is easy to trace. Up to 10 active keys.'}
              </p>
            </div>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
