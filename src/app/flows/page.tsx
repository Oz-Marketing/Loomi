'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AdminOnly } from '@/components/route-guard';
import { useAccount } from '@/contexts/account-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { FlowAnalytics } from '@/components/flows/flow-analytics';
import { FlowList } from '@/components/flows/flow-list';
import {
  ChartBarIcon,
  ListBulletIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { FlowIcon } from '@/components/icon-map';

// Loomi-native flows aren't wired up yet — until the LoomiFlow API
// surfaces, every flows view renders an empty list. The page survives
// so navigation and analytics chrome stay in place, ready for the
// Loomi-native source to drop in.
interface Workflow {
  id: string;
  name: string;
  status: string;
  provider?: string;
  locationId?: string;
  createdAt?: string;
  updatedAt?: string;
  accountKey?: string;
  dealer?: string;
}

type PageTab = 'analytics' | 'list';

const EMPTY_WORKFLOWS: Workflow[] = [];

const EMPTY_STATE = {
  title: 'No flows yet',
  subtitle: 'Loomi-native flows will appear here once they launch.',
};

function FlowsPageHeader({
  title,
  subtitle,
  activeTab,
  onTabChange,
  createHref,
}: {
  title: string;
  subtitle: string;
  activeTab: PageTab;
  onTabChange: (tab: PageTab) => void;
  createHref: string;
}) {
  return (
    <div className="page-sticky-header mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <FlowIcon className="w-7 h-7 text-[var(--primary)]" />
          <div>
            <h2 className="text-2xl font-bold">{title}</h2>
            <p className="text-[var(--muted-foreground)] mt-1">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 h-10">
            <button
              type="button"
              onClick={() => onTabChange('analytics')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-xs font-medium transition-colors ${
                activeTab === 'analytics'
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <ChartBarIcon className="w-3.5 h-3.5" />
              Analytics
            </button>
            <button
              type="button"
              onClick={() => onTabChange('list')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-xs font-medium transition-colors ${
                activeTab === 'list'
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <ListBulletIcon className="w-3.5 h-3.5" />
              Flows
            </button>
          </div>

          <Link
            href={createHref}
            className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
          >
            <PlusIcon className="w-4 h-4" />
            Create Flow
          </Link>
        </div>
      </div>
    </div>
  );
}

function AdminFlowsPage() {
  const [activeTab, setActiveTab] = useState<PageTab>('list');
  const subHref = useSubaccountHref();

  return (
    <div>
      <FlowsPageHeader
        title="Flows"
        subtitle="Workflows across all accounts"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        createHref={subHref('/flows/new')}
      />

      <div className="min-w-0">
        {activeTab === 'analytics' && (
          <FlowAnalytics
            workflows={EMPTY_WORKFLOWS}
            loading={false}
            showAccountBreakdown
            accountNames={{}}
          />
        )}

        {activeTab === 'list' && (
          <FlowList
            workflows={EMPTY_WORKFLOWS}
            loading={false}
            accountNames={{}}
            accountMeta={{}}
            accountProviders={{}}
            emptyState={EMPTY_STATE}
          />
        )}
      </div>
    </div>
  );
}

function AccountFlowsPage() {
  const { accountKey, accountData } = useAccount();
  const [activeTab, setActiveTab] = useState<PageTab>('list');
  const subHref = useSubaccountHref();

  const dealerName = accountData?.dealer || 'Your Sub-Account';
  const accountNames = accountKey ? { [accountKey]: dealerName } : {};

  return (
    <div>
      <FlowsPageHeader
        title="Flows"
        subtitle={`Workflows for ${dealerName}`}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        createHref={subHref('/flows/new')}
      />

      <div className="min-w-0">
        {activeTab === 'analytics' && (
          <FlowAnalytics
            workflows={EMPTY_WORKFLOWS}
            loading={false}
            showAccountBreakdown={false}
            accountNames={accountNames}
            emptyTitle={EMPTY_STATE.title}
            emptySubtitle={EMPTY_STATE.subtitle}
          />
        )}

        {activeTab === 'list' && (
          <FlowList
            workflows={EMPTY_WORKFLOWS}
            loading={false}
            accountNames={accountNames}
            accountMeta={{}}
            accountProviders={{}}
            emptyState={EMPTY_STATE}
          />
        )}
      </div>
    </div>
  );
}

export default function FlowsPage() {
  const { isAdmin, isAccount } = useAccount();

  if (isAdmin) {
    return (
      <AdminOnly>
        <AdminFlowsPage />
      </AdminOnly>
    );
  }

  if (isAccount) {
    return <AccountFlowsPage />;
  }

  return null;
}
