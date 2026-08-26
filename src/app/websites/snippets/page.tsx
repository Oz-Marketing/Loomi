'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  PlusIcon,
  Squares2X2Icon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import type { AccountSnippetSummary } from '@/lib/services/account-snippets';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

type SnippetKind = 'header' | 'footer' | 'disclaimer' | 'generic';

const KIND_OPTIONS: { value: SnippetKind; label: string; hint: string }[] = [
  { value: 'header', label: 'Header', hint: 'Logo + nav at the top of each page.' },
  { value: 'footer', label: 'Footer', hint: 'Links, contact info, copyright at the bottom.' },
  { value: 'disclaimer', label: 'Disclaimer', hint: 'Legal copy reused across pages.' },
  { value: 'generic', label: 'Generic', hint: 'Anything else (testimonial set, badge row, etc.).' },
];

const KIND_LABEL: Record<string, string> = {
  header: 'Header',
  footer: 'Footer',
  disclaimer: 'Disclaimer',
  generic: 'Generic',
};

const KIND_COLOR: Record<string, string> = {
  header: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  footer: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  disclaimer: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  generic: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30',
};

/**
 * Snippets list — account-scoped reusable bundles of LP blocks.
 * Mirrors the LP list page but simpler: no publish toggle, no
 * analytics, no public URL. Each card links to /websites/snippets/[id]/edit.
 */
export default function SnippetsPage() {
  const { accountKey } = useAccount();
  const { confirm } = useLoomiDialog();
  const subHref = useSubaccountHref();
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const { data, error, mutate, isLoading } = useSWR<{ snippets: AccountSnippetSummary[] }>(
    '/api/account-snippets',
    fetcher,
  );
  const snippets = data?.snippets ?? [];

  const visible = useMemo(() => {
    let next = snippets;
    if (accountKey) next = next.filter((s) => s.accountKey === accountKey);
    if (search.trim()) {
      const q = search.toLowerCase();
      next = next.filter((s) => s.name.toLowerCase().includes(q));
    }
    return next;
  }, [snippets, accountKey, search]);

  async function destroy(snippet: AccountSnippetSummary) {
    const ok = await confirm({
      title: `Delete "${snippet.name || 'Untitled'}"?`,
      message:
        'This removes the reusable block permanently. Any landing pages still referencing it will show a "missing" placeholder.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/account-snippets/${snippet.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Could not delete.');
      return;
    }
    toast.success('Reusable block deleted.');
    await mutate();
  }

  return (
    <AdminOnly>
      <div>
        <div className="page-sticky-header mb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Squares2X2Icon className="w-7 h-7 text-[var(--primary)]" />
              <div>
                <h2 className="text-2xl font-bold">Reusable blocks</h2>
                <p className="text-[var(--muted-foreground)] mt-1">
                  Headers, footers, disclaimers — save once, drop into any landing page.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              disabled={!accountKey}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PlusIcon className="w-4 h-4" />
              New reusable block
            </button>
          </div>
        </div>

        {snippets.length > 0 && (
          <div className="mb-4">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reusable blocks…"
              className="w-full max-w-sm px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--input)] focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
        )}

        {error ? (
          <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">
            Reusable blocks could not be loaded.
          </div>
        ) : isLoading ? (
          <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
        ) : snippets.length === 0 ? (
          <EmptyState onCreate={() => setNewOpen(true)} accountReady={!!accountKey} />
        ) : visible.length === 0 ? (
          <FilterEmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {visible.map((s) => (
              <SnippetCard
                key={s.id}
                snippet={s}
                editHref={subHref(`/websites/snippets/${s.id}/edit`)}
                onDelete={() => destroy(s)}
              />
            ))}
          </div>
        )}
      </div>

      {newOpen && accountKey && (
        <NewSnippetModal
          accountKey={accountKey}
          onClose={() => setNewOpen(false)}
          onCreated={async (id) => {
            setNewOpen(false);
            await mutate();
            window.location.href = subHref(`/websites/snippets/${id}/edit`);
          }}
        />
      )}
    </AdminOnly>
  );
}

function SnippetCard({
  snippet,
  editHref,
  onDelete,
}: {
  snippet: AccountSnippetSummary;
  editHref: string;
  onDelete: () => void;
}) {
  const kindClass = KIND_COLOR[snippet.kind] ?? KIND_COLOR.generic;
  return (
    <div className="glass-card group relative rounded-xl overflow-hidden transition-all hover:border-[var(--primary)]/40 hover:shadow-lg">
      <Link href={editHref} className="absolute inset-0 z-0" aria-label={`Edit ${snippet.name}`} />
      <div className="relative z-10 p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold truncate" title={snippet.name}>
              {snippet.name || 'Untitled'}
            </h3>
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
              {snippet.blockCount} {snippet.blockCount === 1 ? 'block' : 'blocks'} ·{' '}
              {formatRelativeDate(snippet.updatedAt)}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${kindClass}`}
          >
            {KIND_LABEL[snippet.kind] ?? snippet.kind}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-3 pointer-events-auto">
          <Link
            href={editHref}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
          >
            <PencilSquareIcon className="w-3.5 h-3.5" />
            Edit
          </Link>
          <CardMenu onDelete={onDelete} />
        </div>
      </div>
    </div>
  );
}

function CardMenu({ onDelete }: { onDelete: () => void }) {
  // Tiny version of the LP card menu — only Delete for now since
  // Duplicate / Save as template don't really make sense for what's
  // already a reusable bundle.
  const [open, setOpen] = useState(false);
  const ref = useMemo(() => ({ current: null as HTMLDivElement | null }), []);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const setRef = (node: HTMLDivElement | null) => {
    ref.current = node;
  };

  return (
    <div ref={setRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="More actions"
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <EllipsisVerticalIcon className="w-4 h-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-40 glass-dropdown shadow-lg p-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-xs rounded-md text-rose-300 hover:bg-rose-500/10 transition-colors"
          >
            <TrashIcon className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function NewSnippetModal({
  accountKey,
  onClose,
  onCreated,
}: {
  accountKey: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SnippetKind>('header');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/account-snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey, name: name.trim(), kind }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not create.');
        return;
      }
      onCreated(payload.snippet.id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card rounded-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-semibold">New reusable block</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              Build it once, drop it into any landing page via the Reusable block.
            </p>
          </div>
          <div className="px-5 py-4 space-y-4">
            <label className="block">
              <span className="block text-sm font-medium mb-1">Name</span>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Site footer"
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--input)] focus:outline-none focus:border-[var(--primary)]"
              />
            </label>
            <fieldset>
              <legend className="block text-sm font-medium mb-1">Kind</legend>
              <div className="grid grid-cols-2 gap-2">
                {KIND_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex flex-col gap-0.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      kind === opt.value
                        ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                        : 'border-[var(--border)] hover:bg-[var(--muted)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={opt.value}
                      checked={kind === opt.value}
                      onChange={() => setKind(opt.value)}
                      className="sr-only"
                    />
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-[11px] text-[var(--muted-foreground)] leading-snug">
                      {opt.hint}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-lg hover:bg-[var(--muted)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-3 py-1.5 text-sm rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EmptyState({
  onCreate,
  accountReady,
}: {
  onCreate: () => void;
  accountReady: boolean;
}) {
  return (
    <div className="glass-card rounded-2xl p-12 text-center flex flex-col items-center">
      <div className="w-16 h-16 rounded-2xl bg-[var(--muted)] flex items-center justify-center mb-4">
        <Squares2X2Icon className="w-8 h-8 text-[var(--muted-foreground)]" />
      </div>
      <h2 className="text-lg font-semibold mb-1">No reusable blocks yet</h2>
      <p className="text-sm text-[var(--muted-foreground)] max-w-md mb-6">
        Save a header, footer, or disclaimer once. Reference it from any landing page via
        the Reusable block — edit it in one place to update every page that uses it.
      </p>
      <button
        type="button"
        onClick={onCreate}
        disabled={!accountReady}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        <PlusIcon className="w-4 h-4" />
        Create your first reusable block
      </button>
    </div>
  );
}

function FilterEmptyState() {
  return (
    <div className="glass-card rounded-2xl p-10 text-center text-sm text-[var(--muted-foreground)]">
      No reusable blocks match the current search.
    </div>
  );
}

function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (diffMs < hour) return 'just now';
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  const days = Math.floor(diffMs / day);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
