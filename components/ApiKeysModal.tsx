'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  KeyRound,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { API_PLANS, apiPlanForTier } from '@/lib/api-plans';

interface ApiKeysModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier: 'free' | 'starter' | 'pro' | 'unlimited';
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

  const planId = apiPlanForTier(tier);
  const plan = planId ? API_PLANS[planId] : null;
  const hasApiAccess = !!plan;

  const activeKeys = keys.filter((k) => k.is_active);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/developer/keys');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load your API keys');
      setKeys(data.keys ?? []);
      setHasLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your API keys');
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
        const res = await fetch(`/api/developer/keys/${id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not revoke the key');
        await loadKeys();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not revoke the key');
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
      setError('Could not copy automatically. Select the key and copy it manually.');
    }
  }, [revealedKey]);

  return (
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent className="max-w-lg">
        <ModalHeader>
          <ModalTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            API keys
          </ModalTitle>
          <ModalDescription>
            {hasApiAccess
              ? 'Programmatic access to the wallet index. Keys carry your whole plan allowance, so treat them as server-side secrets.'
              : 'API access is included with Pro and Unlimited.'}
          </ModalDescription>
        </ModalHeader>

        {!hasApiAccess ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <p className="mb-3">
                The API resolves wallets to social identities in both
                directions, including reverse lookups from an 𝕏 handle or
                Farcaster username back to wallets.
              </p>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline hover:text-foreground"
              >
                Read the API reference
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {onUpgradeClick && (
              <Button
                className="w-full"
                onClick={() => {
                  handleClose();
                  onUpgradeClick();
                }}
              >
                See plans
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Plan limits, read from lib/api-plans.ts so this can never drift
                from what the rate limiter actually enforces. */}
            <div className="rounded-lg border bg-muted/40 p-3 text-xs sm:text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{plan.name} plan</span>
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-muted-foreground underline hover:text-foreground"
                >
                  Docs
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="mt-1 text-muted-foreground">
                {plan.requestsPerMinute}/min ·{' '}
                {plan.requestsPerDay < 0
                  ? 'unlimited'
                  : `${plan.requestsPerDay.toLocaleString()}/day`}{' '}
                · batch up to {plan.maxBatchSize}
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Shown exactly once, immediately after creation. */}
            {revealedKey && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-50 p-3 dark:bg-amber-500/10">
                <div className="mb-2 flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Copy this now. It is shown once and only a hash is stored, so
                    it cannot be recovered later, only replaced.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-xs">
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
