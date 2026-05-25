'use client';

import { use } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowLeftIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import type { LandingPageDetail } from '@/lib/services/landing-pages';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * PR1 stub overview. PR3 will replace with stat cards, preview thumb,
 * embed/share section, and (eventually) analytics. The route is wired
 * now so the list page's row click navigates somewhere meaningful.
 */
export default function LandingPageOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const subHref = useSubaccountHref();
  const { data, isLoading } = useSWR<{ page: LandingPageDetail }>(
    `/api/landing-pages/${id}`,
    fetcher,
  );

  return (
    <AdminOnly>
      <div className="px-8 py-8 max-w-5xl mx-auto">
        <Link
          href={subHref('/websites/landing-pages')}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-6"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          All landing pages
        </Link>

        {isLoading || !data?.page ? (
          <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
        ) : (
          <>
            <header className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-semibold capitalize">
                  {data.page.name || 'Untitled landing page'}
                </h1>
                <p className="mt-1 text-sm text-[var(--muted-foreground)] font-mono">
                  /lp/{data.page.slug}
                </p>
              </div>
              <Link
                href={subHref(`/websites/landing-pages/${id}/edit`)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90"
              >
                <PencilSquareIcon className="w-4 h-4" />
                Edit
              </Link>
            </header>

            <div className="glass-card rounded-2xl p-8 text-center">
              <h2 className="text-lg font-semibold mb-2">Overview coming in LP-PR3</h2>
              <p className="text-sm text-[var(--muted-foreground)] max-w-md mx-auto">
                Stat cards, preview thumb, embed/share section, and analytics
                will land in the next LP PR. For now, use Edit to open the
                builder workspace.
              </p>
            </div>
          </>
        )}
      </div>
    </AdminOnly>
  );
}
