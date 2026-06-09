'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { BoltIcon } from '@heroicons/react/24/outline';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { FlowCard } from '@/components/flows/flow-card';

interface FlowApiRow {
  id: string;
  name: string;
  description: string;
  status: string;
  accountKey: string;
  parentTemplateId: string;
  createdAt: string;
  updatedAt: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

/**
 * Flows tab of the unified /templates page. Lists reusable flow
 * templates (flows with no accountKey — global, opt-in to adopt) as
 * cards; clicking a card opens the flow builder. Uses the dedicated
 * ?templates=1 endpoint so scoping is handled server-side.
 */
export function FlowTemplatesTab() {
  const router = useRouter();
  const subHref = useSubaccountHref();
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useSWR<{ flows: FlowApiRow[] }>(
    '/api/flows?templates=1&status=all',
    fetcher,
  );

  const flows = data?.flows ?? [];

  if (error) {
    return (
      <div className="glass-card rounded-2xl p-6 text-sm text-rose-300">
        Flow templates could not be loaded.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="glass-card rounded-xl h-40 animate-pulse bg-[var(--muted)]/30"
          />
        ))}
      </div>
    );
  }

  if (flows.length === 0) {
    return (
      <div className="glass-card rounded-2xl px-6 py-14 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--muted)] flex items-center justify-center mx-auto mb-4">
          <BoltIcon className="w-7 h-7 text-[var(--muted-foreground)]" />
        </div>
        <h3 className="text-lg font-semibold">No flow templates yet</h3>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Publish a flow as a template from the Flows page to reuse it here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {flows.map((flow) => (
        <FlowCard
          key={flow.id}
          workflow={{
            id: flow.id,
            name: flow.name,
            status: flow.status,
            createdAt: flow.createdAt,
            updatedAt: flow.updatedAt,
          }}
          showAccount={false}
          isMenuOpen={menuOpenId === flow.id}
          isStatusUpdating={false}
          onToggleMenu={(w) =>
            setMenuOpenId((cur) => (cur === w.id ? null : w.id))
          }
          hrefBuilder={(w) => subHref(`/flows/${w.id}/edit`)}
          onEdit={(w) => router.push(subHref(`/flows/${w.id}/edit`))}
        />
      ))}
    </div>
  );
}
