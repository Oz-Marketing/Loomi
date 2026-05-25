'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { PlusIcon, RectangleStackIcon } from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import type { LandingPageSummary } from '@/lib/services/landing-pages';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * PR1 list page — minimal table of landing pages with a "New" button.
 * Cards view, table view, status filter, search, templates picker etc.
 * arrive in LP-PR3. The shape mirrors the Forms list page so the future
 * upgrade is mechanical.
 */
export default function LandingPagesPage() {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const { accountKey } = useAccount();
  const [creating, setCreating] = useState(false);

  const { data, isLoading, mutate } = useSWR<{ pages: LandingPageSummary[] }>(
    '/api/landing-pages',
    fetcher,
  );
  const pages = (data?.pages ?? []).filter(
    (p) => !accountKey || p.accountKey === accountKey,
  );

  async function createBlank() {
    if (creating) return;
    if (!accountKey) {
      toast.error('Pick an account first.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/landing-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Untitled landing page',
          accountKey,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not create landing page.');
        return;
      }
      await mutate();
      router.push(subHref(`/websites/landing-pages/${payload.page.id}/edit`));
    } finally {
      setCreating(false);
    }
  }

  return (
    <AdminOnly>
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">
              Landing Pages
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Build standalone marketing pages. Embed a Form to capture leads.
            </p>
          </div>
          <button
            type="button"
            onClick={createBlank}
            disabled={creating || !accountKey}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <PlusIcon className="w-4 h-4" />
            {creating ? 'Creating…' : 'New Landing Page'}
          </button>
        </header>

        {isLoading ? (
          <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
        ) : pages.length === 0 ? (
          <EmptyState onCreate={createBlank} creating={creating} accountReady={Boolean(accountKey)} />
        ) : (
          <PageList pages={pages} subHref={subHref} />
        )}
      </div>
    </AdminOnly>
  );
}

function EmptyState({
  onCreate,
  creating,
  accountReady,
}: {
  onCreate: () => void;
  creating: boolean;
  accountReady: boolean;
}) {
  return (
    <div className="glass-card rounded-2xl p-12 text-center flex flex-col items-center">
      <div className="w-16 h-16 rounded-2xl bg-[var(--muted)] flex items-center justify-center mb-4">
        <RectangleStackIcon className="w-8 h-8 text-[var(--muted-foreground)]" />
      </div>
      <h2 className="text-lg font-semibold mb-1">No landing pages yet</h2>
      <p className="text-sm text-[var(--muted-foreground)] max-w-md mb-6">
        Spin up a focused marketing page with hero, features, testimonials, and
        an embedded form — all in your brand. Pages publish to{' '}
        <code>/lp/&lt;slug&gt;</code>.
      </p>
      <button
        type="button"
        onClick={onCreate}
        disabled={creating || !accountReady}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        <PlusIcon className="w-4 h-4" />
        {creating ? 'Creating…' : 'Create your first landing page'}
      </button>
    </div>
  );
}

function PageList({
  pages,
  subHref,
}: {
  pages: LandingPageSummary[];
  subHref: (path: string) => string;
}) {
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--border)] bg-[var(--muted)]/40">
          <tr className="text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Slug</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => (
            <tr
              key={page.id}
              className="border-t border-[var(--border)] hover:bg-[var(--muted)]/30 transition-colors"
            >
              <td className="px-4 py-3">
                <Link
                  href={subHref(`/websites/landing-pages/${page.id}`)}
                  className="font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
                >
                  {page.name || 'Untitled'}
                </Link>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-[var(--muted-foreground)]">
                /lp/{page.slug}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    page.status === 'published'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                  }`}
                >
                  {page.status}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                {new Date(page.updatedAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
