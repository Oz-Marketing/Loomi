'use client';

// Sub-account suppression list management.
//
// The SendGrid Event webhook auto-populates this table from bounces,
// spam reports, and unsubscribes (see /api/webhooks/sendgrid/events).
// This UI gives ops a way to inspect what's been suppressed, search by
// email, and manually add or remove entries when a customer reaches out.
//
// Removing a suppression is a trust call — it doesn't audit-trail. If
// that becomes a need we can layer in a SuppressionEvent table later.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  NoSymbolIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import PrimaryButton from '@/components/primary-button';

interface SuppressionsTabProps {
  accountKey: string;
}

interface SuppressionRow {
  id: string;
  email: string;
  reason: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  rows: SuppressionRow[];
  total: number;
  limit: number;
  offset: number;
  reasonCounts: Record<string, number>;
}

const PAGE_SIZE = 50;

const REASON_META: Record<
  string,
  { label: string; badgeClass: string; description: string }
> = {
  bounce: {
    label: 'Bounce',
    badgeClass: 'bg-amber-500/10 text-amber-400',
    description: 'Hard bounce from the recipient mail server.',
  },
  spamreport: {
    label: 'Spam report',
    badgeClass: 'bg-red-500/10 text-red-400',
    description: 'Recipient marked the email as spam.',
  },
  unsubscribe: {
    label: 'Unsubscribe',
    badgeClass: 'bg-violet-500/10 text-violet-400',
    description: 'Recipient unsubscribed via list-unsubscribe.',
  },
  manual: {
    label: 'Manual',
    badgeClass: 'bg-zinc-500/10 text-zinc-400',
    description: 'Added by an operator from this UI.',
  },
};

function reasonBadge(reason: string) {
  const meta = REASON_META[reason] || {
    label: reason,
    badgeClass: 'bg-zinc-500/10 text-zinc-400',
    description: '',
  };
  return meta;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SuppressionsTab({ accountKey }: SuppressionsTabProps) {
  const { confirm } = useLoomiDialog();

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  // Manual add state
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // Debounce search so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 when filter changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, reasonFilter]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (reasonFilter) params.set('reason', reasonFilter);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String((page - 1) * PAGE_SIZE));
      const res = await fetch(
        `/api/accounts/${accountKey}/suppressions?${params.toString()}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as ListResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suppressions');
    } finally {
      setLoading(false);
    }
  }, [accountKey, debouncedSearch, reasonFilter, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleAdd() {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${accountKey}/suppressions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reason: 'manual' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to add');
      }
      setNewEmail('');
      setShowAdd(false);
      toast.success(`Suppressed ${email}`);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(row: SuppressionRow) {
    const ok = await confirm({
      title: 'Remove suppression?',
      message: `${row.email} will be eligible for campaigns again. If they bounced or marked as spam in the past, re-sending may damage deliverability.`,
      destructive: true,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/accounts/${accountKey}/suppressions/${row.id}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to remove');
      }
      toast.success(`Removed ${row.email}`);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    }
  }

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  }, [data]);

  return (
    <div className="space-y-4">
      {/* ── Header card ── */}
      <section className="glass-section-card rounded-xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
            <NoSymbolIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[var(--foreground)]">Suppression List</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Emails on this list are dropped from every campaign batch before send.
              Bounces, spam reports, and unsubscribes auto-populate here.
            </p>
          </div>
          <PrimaryButton onClick={() => setShowAdd((v) => !v)}>
            <PlusIcon className="w-4 h-4" />
            Add manually
          </PrimaryButton>
        </div>

        {/* Manual add form */}
        {showAdd && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-3 mb-3">
            <div className="flex items-end gap-2 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="someone@example.com"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAdd();
                    }
                  }}
                  className="w-full rounded-lg bg-[var(--input)] border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
                />
              </div>
              <PrimaryButton onClick={handleAdd} disabled={!newEmail.trim() || saving}>
                {saving ? 'Adding…' : 'Add to list'}
              </PrimaryButton>
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setNewEmail('');
                }}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
                aria-label="Cancel"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Reason filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setReasonFilter('')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              reasonFilter === ''
                ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            All
            <span className="tabular-nums text-[10px] opacity-70">
              {data ? data.total : '—'}
            </span>
          </button>
          {(['bounce', 'spamreport', 'unsubscribe', 'manual'] as const).map((r) => {
            const meta = reasonBadge(r);
            const count = data?.reasonCounts[r] ?? 0;
            const active = reasonFilter === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setReasonFilter(active ? '' : r)}
                title={meta.description}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  active
                    ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                    : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {meta.label}
                <span className="tabular-nums text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Search + table ── */}
      <section className="glass-section-card rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email…"
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {data ? `${data.total.toLocaleString()} suppressed` : '—'}
          </p>
        </div>

        {loading ? (
          <div className="px-4 py-10 text-center text-xs text-[var(--muted-foreground)]">
            Loading…
          </div>
        ) : error ? (
          <div className="px-4 py-6 flex items-start gap-2 text-xs text-red-300 bg-red-500/5">
            <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <NoSymbolIcon className="w-8 h-8 mx-auto text-[var(--muted-foreground)] opacity-40 mb-2" />
            <p className="text-sm font-medium text-[var(--foreground)]">
              {debouncedSearch || reasonFilter
                ? 'No suppressions match this filter'
                : 'No suppressions yet'}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-md mx-auto">
              {debouncedSearch || reasonFilter
                ? 'Try a different search or filter.'
                : "Bounces and spam reports will land here automatically once your campaigns start sending. You can also add an email manually using the button above."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                  <th className="text-left px-4 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Email
                  </th>
                  <th className="text-left px-3 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="text-left px-3 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Source
                  </th>
                  <th className="text-left px-3 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Added
                  </th>
                  <th className="w-14 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const meta = reasonBadge(row.reason);
                  return (
                    <tr key={row.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/40 transition-colors">
                      <td className="px-4 py-2.5 align-middle">
                        <span className="text-sm font-mono">{row.email}</span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.badgeClass}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className="text-xs text-[var(--muted-foreground)] capitalize">
                          {row.source}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {formatDate(row.createdAt)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-middle text-right">
                        <button
                          type="button"
                          onClick={() => handleRemove(row)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:text-red-400 hover:border-red-500/40 transition-colors"
                          aria-label="Remove suppression"
                          title="Remove suppression"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-between">
            <p className="text-[11px] text-[var(--muted-foreground)]">
              {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–
              {Math.min(page * PAGE_SIZE, data.total).toLocaleString()} of {data.total.toLocaleString()}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors"
              >
                Prev
              </button>
              <span className="text-xs text-[var(--muted-foreground)] px-2 tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2 py-1 text-xs rounded-md border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--muted)] transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
