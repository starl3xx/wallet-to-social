'use client';

import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  MagnifyingGlass as Search,
  CircleNotch as Loader2,
  User,
  Briefcase,
  Wallet,
  X,
} from '@phosphor-icons/react';
import { shortId } from './format';
import { Empty } from './PaneState';

interface SearchResult {
  type: 'user' | 'job' | 'lookup';
  id: string;
  title: string;
  subtitle: string;
  metadata?: Record<string, string | number>;
}

interface UniversalSearchProps {
  password: string;
  onResultClick?: (result: SearchResult) => void;
}

export function UniversalSearch({
  password,
  onResultClick,
}: UniversalSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    const searchResults: SearchResult[] = [];

    try {
      // Search users by email
      if (query.includes('@')) {
        const usersRes = await fetch('/api/admin/users', {
          headers: { 'x-admin-password': password },
        });
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          const matchedUsers = usersData.users.filter(
            (u: { email: string; tier: string; id: string }) =>
              u.email.toLowerCase().includes(query.toLowerCase())
          );
          searchResults.push(
            ...matchedUsers.map(
              (u: { email: string; tier: string; id: string }) => ({
                type: 'user' as const,
                id: u.id,
                title: u.email,
                subtitle: `Tier: ${u.tier}`,
              })
            )
          );
        }
      }

      // Search jobs by ID
      if (query.length >= 8) {
        const jobsRes = await fetch('/api/admin/jobs', {
          headers: { 'x-admin-password': password },
        });
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          const matchedJobs = jobsData.jobs.filter(
            (j: { id: string; status: string; walletCount: number }) =>
              j.id.toLowerCase().includes(query.toLowerCase())
          );
          searchResults.push(
            ...matchedJobs.map(
              (j: { id: string; status: string; walletCount: number }) => ({
                type: 'job' as const,
                id: j.id,
                title: `Job ${shortId(j.id)}`,
                subtitle: `Status: ${j.status} · ${j.walletCount} wallets`,
              })
            )
          );
        }
      }

      // Search history by user ID or name
      const historyRes = await fetch(
        `/api/admin/history?userId=${encodeURIComponent(query)}`,
        { headers: { 'x-admin-password': password } }
      );
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        searchResults.push(
          ...historyData.entries
            .slice(0, 5)
            .map(
              (h: {
                id: string;
                name: string;
                walletCount: number;
                userId: string;
              }) => ({
                type: 'lookup' as const,
                id: h.id,
                title: h.name || `Lookup ${shortId(h.id)}`,
                subtitle: `${h.walletCount} wallets · User: ${h.userId ? shortId(h.userId) : 'unknown'}`,
              })
            )
        );
      }

      setResults(searchResults);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }, [query, password]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      search();
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setSearched(false);
  };

  const ResultIcon = ({ type }: { type: string }) => {
    switch (type) {
      case 'user':
        return <User className="h-4 w-4" />;
      case 'job':
        return <Briefcase className="h-4 w-4" />;
      case 'lookup':
        return <Wallet className="h-4 w-4" />;
      default:
        return <Search className="h-4 w-4" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-4 w-4" />
          Universal search
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              placeholder="Search users, jobs, wallets, or emails…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pr-8"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          <Button
            onClick={search}
            disabled={loading || !query.trim()}
            aria-label="Search"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Search className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </div>

        {searched && (
          <div className="mt-4">
            {results.length === 0 ? (
              <Empty>No results found for &ldquo;{query}&rdquo;</Empty>
            ) : (
              <div className="space-y-2">
                {/* `hover:bg-muted`, the fill every outline and ghost control
                    hovers to. `accent` is the unadapted shadcn token, a grey
                    under a name that reads like a brand one. */}
                {results.map((result) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    className="w-full text-left p-3 rounded-lg border border-input hover:bg-muted transition-control"
                    onClick={() => onResultClick?.(result)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-1 text-muted-foreground">
                        <ResultIcon type={result.type} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {result.title}
                          </span>
                          <Badge tone="muted">{result.type}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {result.subtitle}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4">
          Search by email, job ID, user ID, or wallet address
        </p>
      </CardContent>
    </Card>
  );
}
