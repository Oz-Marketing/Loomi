'use client';

import { use } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { LandingPageRenderer } from '@/lib/landing-pages/render';
import type { LandingPageDetail } from '@/lib/services/landing-pages';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * PR1 builder stub — renders the page using the placeholder block
 * components so the visual scaffold is walkable end-to-end. PR2
 * replaces this with the real drag-and-drop builder shell (block
 * palette on the left, canvas in the middle, properties on the right).
 */
export default function LandingPageBuilderPage({
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
      <div className="px-6 py-4 flex items-center justify-between border-b border-[var(--border)] flex-shrink-0">
        <Link
          href={subHref(`/websites/landing-pages/${id}`)}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to overview
        </Link>
        <div className="text-sm font-medium capitalize">
          {data?.page?.name || 'Loading…'}
        </div>
        <div className="text-xs text-[var(--muted-foreground)]">
          Builder UI lands in LP-PR2
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-[var(--muted)]/30">
        <div className="max-w-5xl mx-auto py-8 px-6">
          {isLoading || !data?.page ? (
            <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
          ) : (
            <div className="rounded-xl overflow-hidden shadow-sm">
              <LandingPageRenderer template={data.page.schema} />
            </div>
          )}
        </div>
      </div>
    </AdminOnly>
  );
}
