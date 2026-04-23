'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Copy, Check, Trash2, Plus, Key, BarChart3, BookOpen, AlertTriangle, RefreshCw, Play, Zap } from 'lucide-react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  last_used_at?: string;
  expires_at?: string;
  revoked_at?: string;
};

type UsageData = {
  totals: {
    total_requests: number;
    total_credits: number;
    total_wallets: number;
    avg_latency_ms: number;
  };
  keys: Array<{
    key: { id: string; name: string; prefix: string; plan: string };
    plan_limits: {
      requests_per_minute: number;
      requests_per_day: number | string;
      requests_per_month: number | string;
      max_batch_size: number;
    };
    rate_limits: {
      month: { limit: number; remaining: number; reset_at: string } | null;
    };
    usage: {
      total_requests: number;
      total_credits: number;
    };
  }>;
};

type NewKeyResult = {
  id: string;
  name: string;
  prefix: string;
  plan: string;
  api_key: string;
  created_at: string;
};

const PLAN_OPTIONS = [
  { value: 'developer', label: 'Developer', desc: '1K req/mo · 100 batch size' },
  { value: 'startup', label: 'Startup', desc: '10K req/mo · 500 batch size' },
  { value: 'enterprise', label: 'Enterprise', desc: 'Unlimited · 1K batch size' },
];

const PLAN_LIMITS: Record<string, { rpm: number; rpd: string; rpm_label: string; batch: number }> = {
  developer:  { rpm: 10,   rpd: '1,000',     rpm_label: '1,000/mo',      batch: 100  },
  startup:    { rpm: 60,   rpd: '10,000',    rpm_label: '10,000/mo',     batch: 500  },
  enterprise: { rpm: 600,  rpd: 'Unlimited', rpm_label: 'Unlimited/mo',  batch: 1000 },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ${className}`}
      title="Copy to clipboard"
    >
      {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function CodeBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group rounded-lg bg-[#0d1117] border border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <span className="text-xs text-white/40 font-mono">{lang}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm font-mono text-green-400 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DeveloperPage() {
  const { user, isLoading } = useAuth();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);

  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // Create key form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyPlan, setNewKeyPlan] = useState('developer');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResult | null>(null);

  // Revoke
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Docs tab
  const [docsTab, setDocsTab] = useState<'curl' | 'js'>('curl');

  // Playground
  const [playKey, setPlayKey] = useState('');
  const [playWallets, setPlayWallets] = useState(
    '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045\n0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'
  );
  const [playFresh, setPlayFresh] = useState(false);
  const [playLoading, setPlayLoading] = useState(false);
  const [playResult, setPlayResult] = useState<{
    status: number;
    latencyMs: number;
    body: unknown;
  } | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const email = user?.email;

  const fetchKeys = useCallback(async () => {
    if (!email) return;
    setKeysLoading(true);
    setKeysError(null);
    try {
      const res = await fetch(`/api/developer/keys?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load keys');
      setKeys(data.keys || []);
    } catch (e: unknown) {
      setKeysError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setKeysLoading(false);
    }
  }, [email]);

  const fetchUsage = useCallback(async () => {
    if (!email) return;
    setUsageLoading(true);
    try {
      const res = await fetch(`/api/developer/usage?email=${encodeURIComponent(email)}&period=month`);
      if (res.ok) {
        const data = await res.json();
        setUsage(data);
      }
    } catch {
      // usage is optional — silently skip
    } finally {
      setUsageLoading(false);
    }
  }, [email]);

  useEffect(() => {
    if (email) {
      fetchKeys();
      fetchUsage();
    }
  }, [email, fetchKeys, fetchUsage]);

  // Auto-fill playground key from first active key
  useEffect(() => {
    if (!playKey && keys.length > 0) {
      const first = keys.find((k) => k.is_active && !k.revoked_at);
      if (first) setPlayKey(`${first.prefix}••••••••`);
    }
  }, [keys, playKey]);

  const handleCreateKey = async () => {
    if (!email || !newKeyName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/developer/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: newKeyName.trim(), plan: newKeyPlan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create key');
      setNewKeyResult(data.key);
      setNewKeyName('');
      setShowCreateForm(false);
      await fetchKeys();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const handlePlaygroundSend = async () => {
    const rawKey = playKey.trim();
    if (!rawKey || rawKey.includes('•')) {
      setPlayError('Enter your full API key (starting with wl_)');
      return;
    }
    // Parse wallet addresses
    const wallets = playWallets
      .split(/[\n,]+/)
      .map((w) => w.trim())
      .filter((w) => /^0x[0-9a-fA-F]{40}$/.test(w));
    if (wallets.length === 0) {
      setPlayError('No valid wallet addresses found. Each address should start with 0x and be 42 characters.');
      return;
    }
    setPlayLoading(true);
    setPlayResult(null);
    setPlayError(null);
    const t0 = Date.now();
    try {
      const res = await fetch('/api/v1/batch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${rawKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ wallets, fresh: playFresh }),
      });
      const latencyMs = Date.now() - t0;
      let body: unknown;
      try { body = await res.json(); } catch { body = null; }
      setPlayResult({ status: res.status, latencyMs, body });
    } catch (e: unknown) {
      setPlayError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setPlayLoading(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!email) return;
    if (!confirm('Revoke this key? Apps using it will stop working immediately.')) return;
    setRevokingId(keyId);
    try {
      const res = await fetch(`/api/developer/keys/${keyId}?email=${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchKeys();
        await fetchUsage();
      }
    } finally {
      setRevokingId(null);
    }
  };

  // ── Loading / unauthed states ─────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <Key className="size-10 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Developer portal</h1>
        <p className="text-muted-foreground max-w-sm">
          Sign in to manage your API keys and view usage statistics.
        </p>
        <Link href="/">
          <Button>Go to app →</Button>
        </Link>
      </div>
    );
  }

  // ── Docs code samples ─────────────────────────────────────────────────────

  const curlExample = `curl -X POST https://walletlink.social/api/v1/batch \\
  -H "Authorization: Bearer wl_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "wallets": [
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B"
    ],
    "fresh": false
  }'`;

  const jsExample = `const response = await fetch('https://walletlink.social/api/v1/batch', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer wl_your_key_here',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    wallets: [
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
    ],
    fresh: false,
  }),
});

const { data, meta } = await response.json();
// data[].address, data[].twitter, data[].farcaster
// meta: { requested, found, not_found }`;

  const responseExample = `{
  "data": [
    {
      "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      "twitter": { "handle": "VitalikButerin", "name": "vitalik.eth" },
      "farcaster": { "username": "vitalik.eth", "fid": 5650, "followers": 280000 },
      "ens": "vitalik.eth"
    }
  ],
  "meta": {
    "requested": 2,
    "found": 1,
    "not_found": 1
  }
}`;

  // ── Render ────────────────────────────────────────────────────────────────

  const activeKeys = keys.filter((k) => k.is_active && !k.revoked_at);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="border-b border-border sticky top-0 z-10 bg-background/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/" className="font-semibold text-foreground hover:opacity-80 transition-opacity">
              walletlink.social
            </Link>
            <Link href="/developer" className="text-accent-brand font-medium">
              API
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground hidden sm:block">{user.email}</span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10 space-y-12">
        {/* Page heading */}
        <div>
          <h1 className="text-3xl font-semibold mb-2">Developer portal</h1>
          <p className="text-muted-foreground">
            Manage your API keys and integrate wallet-to-social lookups into your app.
          </p>
        </div>

        {/* ── Usage stats ─────────────────────────────────────────────────────── */}
        {(usage || usageLoading) && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="size-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Usage this month</h2>
            </div>
            {usageLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-3.5 animate-spin" /> Loading stats…
              </div>
            ) : usage ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Total requests" value={usage.totals.total_requests.toLocaleString()} />
                <StatCard label="Credits used" value={usage.totals.total_credits.toLocaleString()} />
                <StatCard label="Wallets looked up" value={usage.totals.total_wallets.toLocaleString()} />
                <StatCard
                  label="Avg latency"
                  value={`${usage.totals.avg_latency_ms}ms`}
                  sub="across all keys"
                />
              </div>
            ) : null}
            {usage && usage.keys.map((k) => {
              const monthLimit = k.rate_limits.month;
              if (!monthLimit) return null;
              const pct = monthLimit.limit > 0 ? Math.round((1 - monthLimit.remaining / monthLimit.limit) * 100) : 0;
              return (
                <div key={k.key.id} className="mt-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{k.key.name} <span className="text-muted-foreground font-normal">({k.key.prefix}…)</span></span>
                    <span className="text-xs text-muted-foreground capitalize">{k.key.plan} plan</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full bg-accent-brand rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                    <span>{monthLimit.remaining.toLocaleString()} remaining</span>
                    <span>{monthLimit.limit.toLocaleString()} total</span>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* ── API Keys ────────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Key className="size-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold">API keys</h2>
              {activeKeys.length > 0 && (
                <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                  {activeKeys.length}
                </span>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => { setShowCreateForm(true); setNewKeyResult(null); setCreateError(null); }}
              disabled={showCreateForm}
            >
              <Plus className="size-3.5" /> New key
            </Button>
          </div>

          {/* New key revealed */}
          {newKeyResult && (
            <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/5 p-5 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Save your key — it won&apos;t be shown again</p>
                  <p className="text-xs text-muted-foreground">Copy it now and store it somewhere safe.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-[#0d1117] border border-white/10 px-4 py-3">
                <code className="flex-1 text-sm font-mono text-green-400 break-all">{newKeyResult.api_key}</code>
                <CopyButton text={newKeyResult.api_key} />
              </div>
              <div className="text-xs text-muted-foreground">
                Key name: <span className="text-foreground">{newKeyResult.name}</span> · Plan: <span className="text-foreground capitalize">{newKeyResult.plan}</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setNewKeyResult(null)}>
                Done, I&apos;ve saved it
              </Button>
            </div>
          )}

          {/* Create form */}
          {showCreateForm && (
            <div className="mb-4 rounded-xl border border-border bg-card p-5 space-y-4">
              <h3 className="text-sm font-semibold">Create new API key</h3>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Key name</label>
                <Input
                  placeholder="e.g. Production, My App, Testing"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateKey()}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Plan</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PLAN_OPTIONS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setNewKeyPlan(p.value)}
                      className={`text-left rounded-lg border p-3 transition-colors ${
                        newKeyPlan === p.value
                          ? 'border-accent-brand bg-accent-brand/5'
                          : 'border-border hover:border-border/80 bg-background'
                      }`}
                    >
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              {createError && (
                <p className="text-sm text-destructive">{createError}</p>
              )}
              <div className="flex gap-2">
                <Button onClick={handleCreateKey} disabled={creating || !newKeyName.trim()}>
                  {creating ? 'Creating…' : 'Create key'}
                </Button>
                <Button variant="ghost" onClick={() => { setShowCreateForm(false); setCreateError(null); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Keys list */}
          {keysLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <RefreshCw className="size-3.5 animate-spin" /> Loading keys…
            </div>
          ) : keysError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {keysError}
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <Key className="size-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No API keys yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => {
                const isRevoked = !key.is_active || !!key.revoked_at;
                return (
                  <div
                    key={key.id}
                    className={`rounded-xl border p-4 flex items-start justify-between gap-4 transition-opacity ${
                      isRevoked ? 'opacity-50 border-border' : 'border-border bg-card'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{key.name}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                            isRevoked
                              ? 'bg-secondary text-muted-foreground'
                              : 'bg-green-500/10 text-green-600 dark:text-green-400'
                          }`}
                        >
                          {isRevoked ? 'Revoked' : key.plan}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-muted-foreground font-mono">{key.prefix}••••••••</code>
                        <CopyButton text={key.prefix} />
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                        <span>Created {new Date(key.created_at).toLocaleDateString()}</span>
                        {key.last_used_at && (
                          <span>Last used {new Date(key.last_used_at).toLocaleDateString()}</span>
                        )}
                        {key.revoked_at && (
                          <span>Revoked {new Date(key.revoked_at).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    {!isRevoked && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleRevoke(key.id)}
                        disabled={revokingId === key.id}
                        title="Revoke key"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                      >
                        {revokingId === key.id ? (
                          <RefreshCw className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Batch API docs ───────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <BookOpen className="size-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Batch API reference</h2>
          </div>

          {/* Endpoint */}
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold bg-accent-brand text-accent-brand-foreground px-2 py-0.5 rounded">
                  POST
                </span>
                <code className="text-sm font-mono text-foreground">
                  https://walletlink.social/api/v1/batch
                </code>
                <CopyButton text="https://walletlink.social/api/v1/batch" className="ml-auto" />
              </div>
              <p className="text-sm text-muted-foreground">
                Resolve up to your plan&apos;s batch limit of wallet addresses to Twitter/X handles, Farcaster profiles, and ENS names in a single request.
              </p>
            </div>

            {/* Auth */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Authentication</h3>
              <CodeBlock
                lang="http"
                code={`Authorization: Bearer wl_your_key_here`}
              />
              <p className="text-xs text-muted-foreground mt-2">
                Pass your API key in the <code className="text-xs">Authorization</code> header on every request.
              </p>
            </div>

            {/* Request body */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Request body</h3>
              <CodeBlock
                lang="json"
                code={`{
  "wallets": ["0x...", "0x..."],  // Required. Array of EVM addresses.
  "fresh": false                  // Optional. true = bypass cache (costs more).
}`}
              />
            </div>

            {/* Code examples */}
            <div>
              <div className="flex items-center gap-1 mb-3">
                <h3 className="text-sm font-semibold mr-2">Code examples</h3>
                {(['curl', 'js'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setDocsTab(t)}
                    className={`text-xs px-3 py-1 rounded-md transition-colors ${
                      docsTab === t
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t === 'curl' ? 'cURL' : 'JavaScript'}
                  </button>
                ))}
              </div>
              {docsTab === 'curl' ? (
                <CodeBlock lang="bash" code={curlExample} />
              ) : (
                <CodeBlock lang="javascript" code={jsExample} />
              )}
            </div>

            {/* Response */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Response</h3>
              <CodeBlock lang="json" code={responseExample} />
            </div>

            {/* Plan limits table */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Plan limits</h3>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plan</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monthly requests</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Max batch size</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rate limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(PLAN_LIMITS).map(([plan, limits], i) => (
                      <tr key={plan} className={i < Object.keys(PLAN_LIMITS).length - 1 ? 'border-b border-border' : ''}>
                        <td className="px-4 py-3 capitalize font-medium">{plan}</td>
                        <td className="px-4 py-3 text-muted-foreground">{limits.rpm_label}</td>
                        <td className="px-4 py-3 text-muted-foreground">{limits.batch} wallets</td>
                        <td className="px-4 py-3 text-muted-foreground">{limits.rpm} req/min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Error codes */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Error codes</h3>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['401', 'Missing or invalid API key'],
                      ['403', 'Key revoked or plan inactive'],
                      ['429', 'Rate limit exceeded — back off and retry'],
                      ['400', 'Bad request — check wallets array format'],
                      ['503', 'Service temporarily unavailable'],
                    ].map(([code, desc], i, arr) => (
                      <tr key={code} className={i < arr.length - 1 ? 'border-b border-border' : ''}>
                        <td className="px-4 py-3">
                          <code className="font-mono text-xs">{code}</code>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* ── Interactive playground ──────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <Zap className="size-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Try it</h2>
            <span className="text-xs text-muted-foreground">— live batch lookup against the real API</span>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-5">
            {/* API key input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">API key</label>
              <Input
                value={playKey}
                onChange={(e) => setPlayKey(e.target.value)}
                placeholder="wl_your_key_here"
                className="font-mono text-sm"
                type="password"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Uses your real key — counts against your plan credits.
              </p>
            </div>

            {/* Wallets textarea */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Wallet addresses <span className="text-muted-foreground font-normal">(one per line or comma-separated)</span>
              </label>
              <textarea
                value={playWallets}
                onChange={(e) => setPlayWallets(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                placeholder={`0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045\n0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B`}
              />
              <p className="text-xs text-muted-foreground">
                {playWallets.split(/[\n,]+/).map((w) => w.trim()).filter((w) => /^0x[0-9a-fA-F]{40}$/.test(w)).length} valid address(es) detected
              </p>
            </div>

            {/* Options row */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={playFresh}
                  onChange={(e) => setPlayFresh(e.target.checked)}
                  className="rounded"
                />
                <span>Fresh lookup</span>
                <span className="text-xs text-muted-foreground">(bypass cache)</span>
              </label>
              <Button
                onClick={handlePlaygroundSend}
                disabled={playLoading}
                size="sm"
                className="gap-1.5"
              >
                {playLoading ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {playLoading ? 'Sending…' : 'Send request'}
              </Button>
            </div>

            {/* Error */}
            {playError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {playError}
              </div>
            )}

            {/* Result */}
            {playResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span
                    className={`font-mono font-semibold ${
                      playResult.status >= 200 && playResult.status < 300
                        ? 'text-green-500'
                        : 'text-destructive'
                    }`}
                  >
                    {playResult.status}
                  </span>
                  <span>{playResult.latencyMs}ms</span>
                  {(() => {
                    const meta = playResult.body && typeof playResult.body === 'object' && 'meta' in playResult.body
                      ? (playResult.body as { meta: { found?: number; requested?: number } }).meta
                      : null;
                    return meta ? (
                      <span>{meta.found ?? 0} / {meta.requested ?? 0} matched</span>
                    ) : null;
                  })()}
                </div>
                <CodeBlock
                  lang="json"
                  code={JSON.stringify(playResult.body, null, 2)}
                />
              </div>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="text-xs text-muted-foreground pb-8 flex gap-4">
          <Link href="/" className="hover:text-foreground transition-colors">← Back to app</Link>
          <a href="mailto:jake@walletlink.social" className="hover:text-foreground transition-colors">Support</a>
        </footer>
      </main>
    </div>
  );
}
