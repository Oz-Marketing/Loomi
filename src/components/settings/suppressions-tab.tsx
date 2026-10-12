'use client';

// Account suppression list management.
//
// The SendGrid Event webhook auto-populates the email list from bounces,
// spam reports, and unsubscribes (see /api/webhooks/sendgrid/events); STOP
// replies and undeliverable numbers land on the SMS list. This UI gives ops a
// way to inspect what's been suppressed, search it, add an address by hand,
// and import a whole list of opt-outs from another system (GoHighLevel, as
// every blast moves off it) — anyone who opted out there must never be
// mailed or texted from Loomi.
//
// Removing a suppression is a trust call — it doesn't audit-trail. If
// that becomes a need we can layer in a SuppressionEvent table later.
//
// Removal clears BOTH sides: the local EmailSuppression row and the
// address on SendGrid's own suppression list. Clearing only ours left
// SendGrid silently dropping every message, so the report read "sent"
// while the customer received nothing. Only email rows can be removed
// here; a texting opt-out is the person's own STOP far more often than not.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NoSymbolIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
  PlusIcon,
  ArrowUpTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import PrimaryButton from '@/components/primary-button';
import { Collapse } from '@/components/ui/collapse';
import { HelpTip } from '@/components/ui/help-tip';

interface SuppressionsTabProps {
  accountKey: string;
}

type Channel = 'email' | 'sms';

interface SuppressionRow {
  id: string;
  /** Set on email rows. */
  email?: string;
  /** Set on SMS rows. */
  phone?: string;
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
  stop: {
    label: 'STOP',
    badgeClass: 'bg-violet-500/10 text-violet-400',
    description: 'The person texted STOP.',
  },
  undelivered: {
    label: 'Undeliverable',
    badgeClass: 'bg-amber-500/10 text-amber-400',
    description: 'Carriers refused texts to this number.',
  },
  manual: {
    label: 'Manual',
    badgeClass: 'bg-zinc-500/10 text-zinc-400',
    description: 'Opted out by staff in Loomi, or imported from another system.',
  },
  'crm-optout': {
    label: 'CRM opt-out',
    badgeClass: 'bg-sky-500/10 text-sky-400',
    description: "Marked do-not-contact in the dealer's CRM.",
  },
};

const CHANNEL_REASONS: Record<Channel, string[]> = {
  email: ['bounce', 'spamreport', 'unsubscribe', 'manual', 'crm-optout'],
  sms: ['stop', 'undelivered', 'manual', 'crm-optout'],
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
  const [channel, setChannel] = useState<Channel>('email');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  // Which panel is open under the header: add one address, or import a list.
  const [panel, setPanel] = useState<'add' | 'import' | null>(null);
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
  }, [debouncedSearch, reasonFilter, channel]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('channel', channel);
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
  }, [accountKey, channel, debouncedSearch, reasonFilter, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function switchChannel(next: Channel) {
    if (next === channel) return;
    setChannel(next);
    setReasonFilter('');
    setSearch('');
  }

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
      setPanel(null);
      toast.success(`Suppressed ${email}`);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(row: SuppressionRow) {
    const email = row.email ?? '';
    const ok = await confirm({
      title: 'Remove suppression?',
      message: `${email} will be eligible for campaigns again. If they bounced or marked as spam in the past, re-sending may damage deliverability.`,
      destructive: true,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/accounts/${accountKey}/suppressions/${row.id}`,
        { method: 'DELETE' },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || 'Failed to remove');
      }
      // The local row is gone either way. If SendGrid's own list still
      // holds the address it will keep dropping the mail, so say so —
      // a plain success toast here would be actively misleading.
      if (body?.sendgridCleared === false) {
        toast.error(
          `Removed ${email} from Loomi, but SendGrid's suppression list `
          + 'could not be cleared. Remove it in SendGrid → Suppressions or '
          + 'mail to this address will keep being dropped.',
        );
      } else {
        toast.success(`Removed ${email}`);
      }
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    }
  }

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  }, [data]);

  const filterChipClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
      active
        ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
        : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
    }`;

  return (
    <div className="space-y-4">
      {/* ── Header card ── */}
      <section className="glass-section-card rounded-xl p-6">
        <div className="flex items-start gap-3 mb-4 flex-wrap">
          <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
            <NoSymbolIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[var(--foreground)]">Suppression List</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Addresses on these lists are skipped by every campaign before it sends.
              Bounces, spam reports, unsubscribes and STOP replies land here automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPanel((p) => (p === 'import' ? null : 'import'))}
              aria-expanded={panel === 'import'}
              className={`inline-flex items-center gap-2 h-10 px-4 text-sm font-medium rounded-lg border transition-colors ${
                panel === 'import'
                  ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10'
                  : 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]/50'
              }`}
            >
              <ArrowUpTrayIcon className="w-4 h-4" />
              Import list
            </button>
            <PrimaryButton
              onClick={() => setPanel((p) => (p === 'add' ? null : 'add'))}
              aria-expanded={panel === 'add'}
            >
              <PlusIcon className="w-4 h-4" />
              Add manually
            </PrimaryButton>
          </div>
        </div>

        {/* Manual add form */}
        <Collapse open={panel === 'add'} unmountOnClose>
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
                  setPanel(null);
                  setNewEmail('');
                }}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
                aria-label="Cancel"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </Collapse>

        {/* Bulk import */}
        <Collapse open={panel === 'import'} unmountOnClose>
          <ImportOptOutsPanel
            accountKey={accountKey}
            onClose={() => setPanel(null)}
            onImported={() => void reload()}
          />
        </Collapse>

        {/* Channel + reason filter chips */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-xs" role="group" aria-label="Channel">
            {(['email', 'sms'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => switchChannel(c)}
                aria-pressed={channel === c}
                className={`px-3 py-1.5 transition-colors ${
                  channel === c
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {c === 'email' ? 'Email' : 'SMS'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setReasonFilter('')}
              className={filterChipClass(reasonFilter === '')}
            >
              All
              <span className="tabular-nums text-[10px] opacity-70">
                {data ? data.total : '—'}
              </span>
            </button>
            {CHANNEL_REASONS[channel].map((r) => {
              const meta = reasonBadge(r);
              const count = data?.reasonCounts[r] ?? 0;
              const active = reasonFilter === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReasonFilter(active ? '' : r)}
                  title={meta.description}
                  className={filterChipClass(active)}
                >
                  {meta.label}
                  <span className="tabular-nums text-[10px] opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
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
              placeholder={channel === 'email' ? 'Search email…' : 'Search phone…'}
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
          <div className="px-4 py-12 text-center animate-fade-in-up">
            <NoSymbolIcon className="w-8 h-8 mx-auto text-[var(--muted-foreground)] opacity-40 mb-2" />
            <p className="text-sm font-medium text-[var(--foreground)]">
              {debouncedSearch || reasonFilter
                ? 'No suppressions match this filter'
                : 'No suppressions yet'}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-md mx-auto">
              {debouncedSearch || reasonFilter
                ? 'Try a different search or filter.'
                : channel === 'email'
                  ? 'Bounces and spam reports will land here automatically once your campaigns start sending. You can also add an email manually or import a list using the buttons above.'
                  : 'STOP replies and undeliverable numbers will land here automatically once your texts start sending. You can also import a list of phone numbers using the button above.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto animate-fade-in-up">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                  <th className="text-left px-4 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    {channel === 'email' ? 'Email' : 'Phone'}
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
                        <span className="text-sm font-mono">{row.email ?? row.phone}</span>
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
                        {row.email && (
                          <button
                            type="button"
                            onClick={() => handleRemove(row)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:text-red-400 hover:border-red-500/40 transition-colors"
                            aria-label="Remove suppression"
                            title="Remove suppression"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
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

// ── Import ──

type ImportChannels = 'both' | 'email' | 'sms';

interface ImportPreview {
  emails: string[];
  phones: string[];
  invalid: { count: number; samples: string[] };
  optOutColumns: string[];
  notOptedOutRows: number;
  rowCount: number;
  hasHeader: boolean;
  alreadySuppressed: { email: number; sms: number };
  groupAccounts: number;
  batchSize: number;
}

interface ImportTotals {
  added: number;
  alreadySuppressed: number;
  invalid: number;
}

interface ImportResult {
  email: ImportTotals;
  sms: ImportTotals;
}

const EMPTY_TOTALS: ImportTotals = { added: 0, alreadySuppressed: 0, invalid: 0 };

/**
 * Paste or upload a list of opt-outs, preview what it comes to, then import.
 *
 * The preview is the server's reading of the file — the same parser the
 * import trusts — and the import sends its normalized addresses back in
 * batches sized to the group, so a list of tens of thousands never rides on
 * one request.
 */
function ImportOptOutsPanel({
  accountKey,
  onClose,
  onImported,
}: {
  accountKey: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [channels, setChannels] = useState<ImportChannels>('both');
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importing = progress !== null;

  // Any change to the input voids the preview: what's on screen must be
  // exactly what an import would write.
  function changeText(next: string, name: string | null) {
    setText(next);
    setFileName(name);
    setPreview(null);
    setResult(null);
    setChannels('both');
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    try {
      changeText(await file.text(), file.name);
    } catch {
      toast.error("Couldn't read that file.");
    } finally {
      // Let the same file be picked again after an edit.
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function runPreview() {
    if (!text.trim()) return;
    setPreviewing(true);
    setResult(null);
    try {
      const res = await fetch(`/api/accounts/${accountKey}/suppressions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview', text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Preview failed');
      setPreview(body as ImportPreview);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  // Only a plain list holding both kinds needs the question: an export's
  // opt-out columns already say which channel each row opted out of.
  const ambiguous =
    !!preview &&
    preview.emails.length > 0 &&
    preview.phones.length > 0 &&
    preview.optOutColumns.length === 0;

  const chosen = useMemo(() => {
    if (!preview) return { emails: [] as string[], phones: [] as string[] };
    return {
      emails: !ambiguous || channels !== 'sms' ? preview.emails : [],
      phones: !ambiguous || channels !== 'email' ? preview.phones : [],
    };
  }, [preview, ambiguous, channels]);
  const chosenTotal = chosen.emails.length + chosen.phones.length;
  const alreadyChosen = preview
    ? (chosen.emails.length > 0 ? preview.alreadySuppressed.email : 0) +
      (chosen.phones.length > 0 ? preview.alreadySuppressed.sms : 0)
    : 0;

  async function runImport() {
    if (!preview || chosenTotal === 0) return;
    const size = Math.max(1, preview.batchSize);
    const batches: { emails: string[]; phones: string[] }[] = [];
    for (let i = 0; i < chosen.emails.length; i += size) {
      batches.push({ emails: chosen.emails.slice(i, i + size), phones: [] });
    }
    for (let i = 0; i < chosen.phones.length; i += size) {
      batches.push({ emails: [], phones: chosen.phones.slice(i, i + size) });
    }

    const totals: ImportResult = { email: { ...EMPTY_TOTALS }, sms: { ...EMPTY_TOTALS } };
    let done = 0;
    setProgress({ done, total: chosenTotal });
    try {
      for (const batch of batches) {
        const res = await fetch(`/api/accounts/${accountKey}/suppressions/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'commit', ...batch }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Import failed');
        for (const c of ['email', 'sms'] as const) {
          totals[c].added += body?.[c]?.added ?? 0;
          totals[c].alreadySuppressed += body?.[c]?.alreadySuppressed ?? 0;
          totals[c].invalid += body?.[c]?.invalid ?? 0;
        }
        done += batch.emails.length + batch.phones.length;
        setProgress({ done, total: chosenTotal });
      }
      setResult(totals);
      setPreview(null);
      const added = totals.email.added + totals.sms.added;
      toast.success(`Imported ${added.toLocaleString()} new opt-out${added === 1 ? '' : 's'}.`);
    } catch (err) {
      // Every batch that landed stays landed, and a re-run skips what's
      // already suppressed — so finishing is just importing again.
      const message = err instanceof Error ? err.message : 'Import failed';
      toast.error(
        `${message}. ${done.toLocaleString()} of ${chosenTotal.toLocaleString()} were imported first — `
        + 'import again to finish; addresses already suppressed are skipped.',
      );
    } finally {
      setProgress(null);
      onImported();
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-4 mb-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
          Import opt-outs
          <HelpTip title="Import opt-outs" iconClassName="w-3.5 h-3.5">
            <p>
              Bring opt-outs over from another system, such as GoHighLevel. Paste emails or
              phone numbers — one per line or comma-separated — or upload a CSV.
            </p>
            <p>
              A full contact export works too: if it has <strong>DND</strong> or{' '}
              <strong>Unsubscribed</strong> columns, only the rows they mark as opted out are
              imported, on the channels they name.
            </p>
            <p>
              Imported opt-outs apply to every account in this group, and they can&apos;t be
              turned off from a contact&apos;s page. Remove an email here if it was imported by
              mistake.
            </p>
          </HelpTip>
        </span>
        <button
          type="button"
          onClick={onClose}
          disabled={importing}
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors disabled:opacity-50"
          aria-label="Close import"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => changeText(e.target.value, null)}
        rows={5}
        disabled={importing}
        spellCheck={false}
        placeholder={'jane@example.com\n(801) 555-0134\n…or upload a CSV export'}
        className="w-full resize-y rounded-lg bg-[var(--input)] border border-[var(--border)] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 disabled:opacity-60"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]/50 transition-colors disabled:opacity-50"
        >
          <DocumentTextIcon className="w-4 h-4" />
          Upload CSV
        </button>
        {fileName && (
          <span className="text-[11px] text-[var(--muted-foreground)] truncate max-w-[240px]" title={fileName}>
            {fileName}
          </span>
        )}
        <button
          type="button"
          onClick={() => void runPreview()}
          disabled={!text.trim() || previewing || importing}
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {previewing ? (
            <ArrowPathIcon className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircleIcon className="w-4 h-4" />
          )}
          {previewing ? 'Reading…' : 'Preview'}
        </button>
      </div>

      {preview && (
        <div className="space-y-3 animate-fade-in-up">
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            <ImportStat label="Emails" value={preview.emails.length} />
            <ImportStat label="Phone numbers" value={preview.phones.length} />
            <ImportStat label="Already suppressed" value={alreadyChosen} />
            <ImportStat label="Couldn't read" value={preview.invalid.count} warn={preview.invalid.count > 0} />
          </div>

          {preview.optOutColumns.length > 0 && (
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Read the opt-out column{preview.optOutColumns.length === 1 ? '' : 's'}{' '}
              {preview.optOutColumns.map((c) => `"${c}"`).join(', ')}.{' '}
              {preview.notOptedOutRows > 0 &&
                `${preview.notOptedOutRows.toLocaleString()} row${preview.notOptedOutRows === 1 ? '' : 's'} not marked as opted out ${preview.notOptedOutRows === 1 ? 'was' : 'were'} skipped.`}
            </p>
          )}

          {preview.invalid.count > 0 && (
            <p className="text-[11px] text-amber-300">
              Skipped {preview.invalid.count.toLocaleString()} value{preview.invalid.count === 1 ? '' : 's'} that
              {preview.invalid.count === 1 ? " isn't" : " aren't"} an email or phone number:{' '}
              <span className="font-mono">{preview.invalid.samples.join(', ')}</span>
              {preview.invalid.count > preview.invalid.samples.length ? ', …' : ''}
            </p>
          )}

          {ambiguous && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                Opt out of
                <HelpTip title="Opt out of" iconClassName="w-3.5 h-3.5">
                  <p>
                    This list has both emails and phone numbers. An email is only ever opted out
                    of email, and a phone number of texts — choose which of them to import.
                  </p>
                </HelpTip>
              </span>
              <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-xs" role="group" aria-label="Opt out of">
                {([
                  ['both', 'Email and SMS'],
                  ['email', 'Email only'],
                  ['sms', 'SMS only'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setChannels(value)}
                    aria-pressed={channels === value}
                    className={`px-2.5 py-1.5 transition-colors ${
                      channels === value
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <PrimaryButton onClick={() => void runImport()} disabled={chosenTotal === 0 || importing}>
              {importing
                ? 'Importing…'
                : `Import ${chosenTotal.toLocaleString()} opt-out${chosenTotal === 1 ? '' : 's'}`}
            </PrimaryButton>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              {preview.groupAccounts > 1
                ? `Applies to all ${preview.groupAccounts} accounts in this group.`
                : 'Applies to this account.'}
            </p>
          </div>
        </div>
      )}

      {progress && (
        <div className="space-y-1.5 animate-fade-in-up" role="status">
          <div className="h-1.5 rounded-full bg-[var(--muted)] overflow-hidden">
            <div
              className="h-full bg-[var(--primary)] transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
            Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()}…
          </p>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-xs space-y-1 animate-fade-in-up" role="status">
          {(['email', 'sms'] as const)
            .filter((c) => result[c].added + result[c].alreadySuppressed + result[c].invalid > 0)
            .map((c) => (
              <p key={c} className="text-[var(--foreground)]">
                <span className="font-semibold">{c === 'email' ? 'Email' : 'SMS'}:</span>{' '}
                {result[c].added.toLocaleString()} added · {result[c].alreadySuppressed.toLocaleString()} already
                suppressed{result[c].invalid > 0 ? ` · ${result[c].invalid.toLocaleString()} couldn't be read` : ''}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

function ImportStat({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        warn ? 'border-amber-500/30 bg-amber-500/5' : 'border-[var(--border)] bg-[var(--card)]'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${warn ? 'text-amber-300' : 'text-[var(--foreground)]'}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
