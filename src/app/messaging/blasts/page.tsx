'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { accountSettingsHref } from '@/lib/account-settings-href';
import { EngagementSection } from '@/components/campaigns/engagement-section';
import { BlastPageList, type AccountMeta } from '@/components/campaigns/blast-page-list';
import { DashboardToolbar, type CustomDateRange } from '@/components/filters/dashboard-toolbar';
import { ListToolbar } from '@/components/list-toolbar';
import type {
  StatusFilterOption,
  StatusFilterValue,
} from '@/components/status-filter';
import { DEFAULT_DATE_RANGE, getDateRangeBounds, type DateRangeKey } from '@/lib/date-ranges';
import { resolveAccountLocationId, resolveAccountProvider } from '@/lib/account-resolvers';
import {
  PaperAirplaneIcon,
  PlusIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { getAccountOems } from '@/lib/oems';
import PrimaryButton from '@/components/primary-button';
import { CreateBlastModal } from '@/components/campaigns/create-blast-modal';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

// ── Types ──

interface Campaign {
  id: string;
  campaignId?: string;
  scheduleId?: string;
  name: string;
  status: string;
  provider?: string;
  createdAt?: string;
  updatedAt?: string;
  scheduledAt?: string;
  sentAt?: string;
  sentCount?: number;
  locationId?: string;
  accountKey?: string;
  dealer?: string;
  bulkRequestId?: string;
  parentId?: string;
}

type PageTab = 'analytics' | 'list';

/** The three mutually-exclusive views the toolbar dropdown offers over
 *  the blast list. See `campaignsView` for what each one means. */
type BlastsView = 'all' | 'archived' | 'flows';

const BLASTS_VIEW_OPTIONS: StatusFilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'archived', label: 'Archived' },
  { value: 'flows', label: 'From flows' },
];

function toBlastsView(next: StatusFilterValue): BlastsView {
  return next === 'archived' || next === 'flows' ? next : 'all';
}

// ── Helpers ──

function getCampaignDate(campaign: Campaign): Date | null {
  const raw =
    campaign.sentAt ||
    campaign.scheduledAt ||
    campaign.updatedAt ||
    campaign.createdAt;

  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function inRange(campaign: Campaign, start: Date, end: Date): boolean {
  const date = getCampaignDate(campaign);
  if (!date) return false;
  const value = date.getTime();
  return value >= start.getTime() && value <= end.getTime();
}

function normalizeCampaignStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (s.includes('complete') || s.includes('deliver') || s.includes('finish') || s.includes('sent')) return 'sent';
  if (s.includes('active') || s.includes('sched') || s.includes('queue') || s.includes('start') || s.includes('running') || s.includes('progress')) return 'scheduled';
  if (s.includes('draft')) return 'draft';
  if (s.includes('pause')) return 'paused';
  if (s.includes('stop') || s.includes('cancel') || s.includes('inactive')) return 'cancelled';
  return s || 'unknown';
}

// ── Inner Page ──

function AccountCampaignsPage() {
  const subHref = useSubaccountHref();
  const { accountKey, accountData, userRole } = useAccount();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  // The sidebar drives view selection: /campaigns → list, /campaigns/analytics → analytics.
  // The in-page tab toggle is gone; navigation happens at the sidebar level.
  const activeTab: PageTab = pathname.endsWith('/analytics') ? 'analytics' : 'list';
  const [dateRange, setDateRange] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Combined "which rows" selector behind the toolbar's dropdown. Three
  // mutually-exclusive views over one list:
  //   'all'      → live, human-composed blasts (the default)
  //   'archived' → soft-deleted blasts
  //   'flows'    → the automated sends flow email/SMS steps produced.
  //                Hidden from the default view because each row is a
  //                flow STEP, not a send: its counters roll up every
  //                enrollment that ever passed through, and it can't be
  //                edited, scheduled, duplicated, or re-sent.
  const [campaignsView, setCampaignsView] = useState<BlastsView>('all');
  const campaignsStatusFilter: 'all' | 'archived' =
    campaignsView === 'archived' ? 'archived' : 'all';
  const campaignsSource = campaignsView === 'flows' ? 'flows' : 'blasts';
  // Lifted search so the unified ListToolbar drives BlastPageList
  // from the same value.
  const [campaignsSearch, setCampaignsSearch] = useState('');

  useEffect(() => {
    if (!accountKey) return;

    let cancelled = false;
    async function load() {
      // Loomi-native is the only source now — ESP campaigns are gone.
      try {
        const res = await fetch(
          `/api/blasts/loomi/list?accountKey=${encodeURIComponent(accountKey!)}&status=${campaignsStatusFilter}&source=${campaignsSource}`,
        );
        if (cancelled) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && Array.isArray(data.campaigns)) {
          setCampaigns(data.campaigns as Campaign[]);
          setApiError(null);
        } else {
          setCampaigns([]);
          setApiError(
            typeof data.error === 'string'
              ? data.error
              : `Failed to load campaigns (${res.status})`,
          );
        }
      } catch {
        if (!cancelled) {
          setCampaigns([]);
          setApiError('Failed to load campaigns.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [accountKey, campaignsStatusFilter, campaignsSource]);

  const bounds = useMemo(
    () =>
      dateRange === 'custom' && customRange
        ? getDateRangeBounds('custom', customRange.start, customRange.end)
        : getDateRangeBounds(dateRange),
    [dateRange, customRange],
  );

  // Drafts are admin-only — the Client role should never see in-progress
  // work, just final scheduled/sent campaigns. Everyone else (admin,
  // super_admin, developer) sees the full pipeline so they can resume
  // their own drafts from this list.
  const visibleCampaigns = useMemo(
    () =>
      campaigns.filter((c) => {
        const status = normalizeCampaignStatus(c.status);
        if (userRole === 'client') {
          return status === 'scheduled' || status === 'sent';
        }
        return true;
      }),
    [campaigns, userRole],
  );

  const dateFiltered = useMemo(() => {
    let result = visibleCampaigns;
    if (bounds.start) {
      result = result.filter(c => inRange(c, bounds.start!, bounds.end));
    }
    return result;
  }, [visibleCampaigns, bounds]);

  const accountEmptyTitle =
    visibleCampaigns.length === 0
      ? (userRole === 'client'
          ? 'No scheduled or sent blasts yet'
          : 'No blasts yet')
      : 'No blasts match this date range';
  const accountEmptySubtitle =
    visibleCampaigns.length === 0
      ? (userRole === 'client'
          ? 'Scheduled and sent campaigns will appear here.'
          : 'Drafts, scheduled, and sent campaigns will all appear here.')
      : 'Try expanding the selected date range.';

  const dealerName = accountData?.dealer || 'Your Account';
  const accountProvider = resolveAccountProvider(accountData, '');
  const accountLocationId = resolveAccountLocationId(accountData);
  const accountNames = useMemo(
    () => (accountKey ? { [accountKey]: dealerName } : {}),
    [accountKey, dealerName],
  );
  const accountMeta = useMemo<Record<string, AccountMeta>>(() => {
    if (!accountKey) return {};
    const accountOems = getAccountOems(accountData);
    return {
      [accountKey]: {
        dealer: dealerName,
        category: accountData?.category,
        oem: accountOems[0],
        oems: accountOems,
        state: accountData?.state,
        city: accountData?.city,
        storefrontImage: accountData?.storefrontImage,
        logos: accountData?.logos,
        locationId: accountLocationId || undefined,
      },
    };
  }, [accountData, accountKey, accountLocationId, dealerName]);
  const accountProviders = useMemo(
    () => (accountKey && accountProvider ? { [accountKey]: accountProvider } : {}),
    [accountKey, accountProvider],
  );
  const accountListEmptyState = useMemo(
    () => ({
      title: accountEmptyTitle,
      subtitle: accountEmptySubtitle,
      actionLabel: 'Create Blast',
      onAction: () => setShowCreateModal(true),
    }),
    [accountEmptySubtitle, accountEmptyTitle],
  );

  function openCreateCampaignModal() {
    setShowCreateModal(true);
  }

  return (
    <div>
      {/* Sticky header with title + centered tabs + controls */}
      <div className="page-sticky-header mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <PaperAirplaneIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">
                {activeTab === 'analytics' ? 'Analytics' : 'Blasts'}
              </h2>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
                Email + Text {activeTab === 'analytics' ? 'performance' : 'blasts'} for {dealerName}
                {dateFiltered.length !== visibleCampaigns.length && (
                  <span className="ml-1 tabular-nums">
                    · {dateFiltered.length} / {visibleCampaigns.length}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Tab toggle removed — sidebar drives navigation between
              Campaigns (/campaigns) and Analytics (/campaigns/analytics). */}
          <div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {activeTab === 'analytics' && (
              <DashboardToolbar
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                customRange={customRange}
                onCustomRangeChange={setCustomRange}
              />
            )}

            {/* Create Blast lives on the list view; analytics is read-only. */}
            {activeTab !== 'analytics' && (
              <>
                {/* Cog → this account's Email settings (sender identity,
                    SendGrid key). It used to point into a messaging-scoped
                    settings tree; those screens are tabs on the account now,
                    which is the only place an account is configured. */}
                <Link
                  href={accountSettingsHref(accountKey ?? '', 'email')}
                  aria-label="Email settings"
                  title="Email settings"
                  className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
                >
                  <Cog6ToothIcon className="w-4 h-4" />
                </Link>
                <PrimaryButton type="button" onClick={openCreateCampaignModal}>
                  <PlusIcon className="w-4 h-4" />
                  Create Blast
                </PrimaryButton>
              </>
            )}
          </div>
        </div>
      </div>

      <CreateBlastModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        accountKeys={accountKey ? [accountKey] : []}
        redirectBase={subHref('/messaging/blasts')}
      />

      <div className="min-w-0">
        {apiError && (
          <div className="px-4 py-3 mb-4 rounded-xl border border-red-500/20 bg-red-500/10 text-sm text-red-300">
            {apiError}
          </div>
        )}

        {activeTab === 'analytics' && (
          <EngagementSection
            accountKey={accountKey || undefined}
            dateRange={dateRange}
            customRange={customRange}
          />
        )}

        {activeTab === 'list' && (
          <>
            {/* Unified toolbar — same shape as forms / flows but with
                a count text on the left instead of a Cards/Table toggle
                (campaigns has only the table view). */}
            {campaigns.length > 0 && (
              <ListToolbar
                leading={
                  <span className="text-sm text-[var(--muted-foreground)]">
                    <span className="text-[var(--foreground)] font-medium tabular-nums">
                      {dateFiltered.length}
                    </span>{' '}
                    campaign{dateFiltered.length === 1 ? '' : 's'}
                    {dateFiltered.length !== campaigns.length && (
                      <span className="opacity-60"> / {campaigns.length}</span>
                    )}
                  </span>
                }
                search={campaignsSearch}
                onSearchChange={setCampaignsSearch}
                searchPlaceholder="Search campaigns…"
                status={campaignsView}
                onStatusChange={(next) => setCampaignsView(toBlastsView(next))}
                statusOptions={BLASTS_VIEW_OPTIONS}
                trailing={
                  <DashboardToolbar
                    dateRange={dateRange}
                    onDateRangeChange={setDateRange}
                    customRange={customRange}
                    onCustomRangeChange={setCustomRange}
                    showReset={false}
                    triggerSize="compact"
                  />
                }
              />
            )}
            <BlastPageList
              campaigns={dateFiltered}
              loading={loading}
              accountNames={accountNames}
              accountMeta={accountMeta}
              accountProviders={accountProviders}
              emptyState={accountListEmptyState}
              singleAccountMode
              statusFilter={campaignsStatusFilter}
              hideToolbar={campaigns.length > 0}
              search={campaignsSearch}
              onSearchChange={setCampaignsSearch}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── Exported Page ──

/**
 * One list, scoped to the active sub-account.
 *
 * There used to be a second, near-identical component for agency scope: the
 * same three views (live / archived / flow sends) over the same endpoint, just
 * without an accountKey. Agency scope is retired, and an unscoped copy of a
 * scoped list is a maintenance liability — every fix had to be made twice.
 */
export default function CampaignsPage() {
  const { isAccount } = useAccount();
  return isAccount ? <AccountCampaignsPage /> : null;
}
