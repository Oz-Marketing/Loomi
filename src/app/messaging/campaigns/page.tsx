'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { useCampaignsAggregate, useWorkflowsAggregate } from '@/hooks/use-dashboard-data';
import { AdminOnly } from '@/components/route-guard';
import { EngagementSection } from '@/components/campaigns/engagement-section';
import { CampaignPageList, type AccountMeta } from '@/components/campaigns/campaign-page-list';
import type { CampaignFilterState, CampaignFilterOptions, RepFilterOption } from '@/components/filters/campaign-toolbar';
import { CampaignFilterSidebar } from '@/components/filters/campaign-filter-sidebar';
import { DashboardToolbar, type CustomDateRange } from '@/components/filters/dashboard-toolbar';
import { DEFAULT_DATE_RANGE, getDateRangeBounds, type DateRangeKey } from '@/lib/date-ranges';
import { resolveAccountLocationId, resolveAccountProvider } from '@/lib/account-resolvers';
import {
  PaperAirplaneIcon,
  FunnelIcon,
  PlusIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { getAccountOems, industryHasBrands } from '@/lib/oems';
import PrimaryButton from '@/components/primary-button';
import { CreateCampaignModal } from '@/components/campaigns/create-campaign-modal';
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

interface AccountData {
  dealer: string;
  category?: string;
  oem?: string;
  oems?: string[];
  espProvider?: string;
  activeEspProvider?: string;
  activeLocationId?: string | null;
  state?: string;
  city?: string;
  storefrontImage?: string;
  logos?: { light?: string; dark?: string; white?: string; black?: string };
  accountRepId?: string | null;
  accountRep?: { id: string; name: string; email: string } | null;
}

type PageTab = 'analytics' | 'list';

// ── Helpers ──

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function resolveAccountLabel(
  accountKey: string,
  accountNames: Record<string, string>,
  accountMeta: Record<string, AccountMeta>,
): string {
  return accountNames[accountKey] || accountMeta[accountKey]?.dealer || accountKey;
}

function campaignAccountKey(campaign: Campaign): string | null {
  return campaign.accountKey || null;
}

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

function withCampaignErrorHint(message: string): string {
  if (message.includes('not yet supported by the IAM Service')) {
    return 'Some accounts need their GHL integration re-authorized to access campaigns. Go to each account\u2019s Settings \u2192 Integrations tab.';
  }
  if (
    message.includes('emails/schedule.readonly') ||
    message.includes('not authorized')
  ) {
    return `${message} Re-authorize the integration to grant the campaigns scope.`;
  }
  return message;
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

function AdminCampaignsPage() {
  const { data: aggData, isLoading: aggLoading } = useCampaignsAggregate();
  // wfData (workflows aggregate) only fed the legacy ESP analytics
  // overview; keep the hook around just for its loading state so the
  // initial-load spinner still respects both fetches finishing.
  const { isLoading: wfLoading } = useWorkflowsAggregate();
  const pathname = usePathname();
  // The sidebar drives view selection: /campaigns → list, /campaigns/analytics → analytics.
  // The in-page tab toggle is gone; navigation happens at the sidebar level.
  const activeTab: PageTab = pathname.endsWith('/analytics') ? 'analytics' : 'list';
  const [sideRailMounted, setSideRailMounted] = useState(false);

  // Loomi-native campaigns (EmailCampaign + SmsCampaign) — fetched
  // alongside the ESP aggregate so drafts and scheduled/sent Loomi
  // campaigns show up in the list.
  const [loomiCampaigns, setLoomiCampaigns] = useState<Campaign[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/campaigns/loomi/list')
      .then((r) => (r.ok ? r.json() : { campaigns: [] }))
      .then((data: { campaigns?: Campaign[] }) => {
        if (cancelled) return;
        setLoomiCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []);
      })
      .catch(() => {
        if (!cancelled) setLoomiCampaigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const campaigns = useMemo(() => {
    const espCampaigns = (aggData?.campaigns ?? []) as Campaign[];
    return [...loomiCampaigns, ...espCampaigns];
  }, [aggData, loomiCampaigns]);
  const accountNames = useMemo(() => {
    const names: Record<string, string> = {};
    if (aggData?.perAccount) {
      Object.entries(aggData.perAccount).forEach(([key, val]) => {
        if (val.dealer) names[key] = val.dealer;
      });
    }
    return names;
  }, [aggData]);

  const [accountMeta, setAccountMeta] = useState<Record<string, AccountMeta>>({});
  const [accountProviders, setAccountProviders] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);

  // Filter state — lifted to page level
  const [filters, setFilters] = useState<CampaignFilterState>({
    account: [],
    status: [],
    oem: [],
    industry: [],
    rep: [],
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = [filters.account, filters.status, filters.oem, filters.industry, filters.rep]
    .filter((a) => a.length > 0).length;
  const [showCreateModal, setShowCreateModal] = useState(false);


  // Side-rail mount/unmount (delayed unmount for slide-out animation)
  useEffect(() => {
    if (filtersOpen) {
      setSideRailMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setSideRailMounted(false), 260);
    return () => window.clearTimeout(timer);
  }, [filtersOpen]);

  // Sync loading state with SWR
  useEffect(() => {
    if (!aggLoading && !wfLoading) setLoading(false);
  }, [aggLoading, wfLoading]);

  // Fetch account metadata (separate from SWR-managed campaigns)
  useEffect(() => {
    let cancelled = false;

    async function loadAccountMeta() {
      try {
        const accountsHttp = await fetch('/api/accounts');
        const accountsRes = await accountsHttp.json().catch(() => ({}));

        if (cancelled) return;

        const meta: Record<string, AccountMeta> = {};
        const providers: Record<string, string> = {};
        if (accountsRes && typeof accountsRes === 'object') {
          Object.entries(accountsRes).forEach(([key, acct]) => {
            const a = acct as AccountData;
            const accountOems = getAccountOems(a);
            meta[key] = {
              dealer: a.dealer || key,
              category: a.category,
              oem: accountOems[0],
              oems: accountOems,
              state: a.state,
              city: a.city,
              storefrontImage: a.storefrontImage,
              logos: a.logos,
              locationId: resolveAccountLocationId(a) || undefined,
              accountRepId: a.accountRepId || a.accountRep?.id || null,
              accountRepName: a.accountRep?.name || null,
              accountRepEmail: a.accountRep?.email || null,
            };
            const preferredProvider = resolveAccountProvider(a, '');
            providers[key] = preferredProvider;
          });
        }
        // Merge provider info from aggregate perAccount
        if (aggData?.perAccount) {
          Object.entries(aggData.perAccount).forEach(([key, val]) => {
            if (typeof val.provider === 'string' && val.provider.trim()) {
              providers[key] = val.provider.trim();
            }
          });
        }
        setAccountMeta(meta);
        setAccountProviders(providers);
      } catch {
        // Account meta is non-critical
      }
    }

    loadAccountMeta();
    return () => { cancelled = true; };
  }, [aggData]);

  const bounds = useMemo(
    () =>
      dateRange === 'custom' && customRange
        ? getDateRangeBounds('custom', customRange.start, customRange.end)
        : getDateRangeBounds(dateRange),
    [dateRange, customRange],
  );

  const accessibleAccountKeys = useMemo(() => {
    const fromAggregate = Object.keys(accountNames);
    if (fromAggregate.length > 0) return fromAggregate;
    return Object.keys(accountMeta);
  }, [accountNames, accountMeta]);

  // Derive filter options from all accessible accounts + campaign data
  const filterOptions: CampaignFilterOptions = useMemo(() => {
    const accountsByLabel = new Map<string, CampaignFilterOptions['accounts'][number]>();
    const statuses = new Set<string>();
    const oems = new Set<string>();
    const industries = new Set<string>();

    function upsertAccountOption(label: string, key?: string) {
      if (!label) return;
      const meta = key ? accountMeta[key] : undefined;
      const existing = accountsByLabel.get(label);
      accountsByLabel.set(label, {
        label,
        key: key ?? existing?.key,
        storefrontImage: meta?.storefrontImage ?? existing?.storefrontImage,
        logos: meta?.logos ?? existing?.logos,
        city: meta?.city ?? existing?.city,
        state: meta?.state ?? existing?.state,
      });
    }

    accessibleAccountKeys.forEach((key) => {
      upsertAccountOption(resolveAccountLabel(key, accountNames, accountMeta), key);
      const meta = accountMeta[key];
      if (meta?.category && industryHasBrands(meta.category)) {
        getAccountOems(meta).forEach((brand) => oems.add(brand));
      }
      if (meta?.category) industries.add(meta.category);
    });

    campaigns.forEach((c) => {
      const accountKey = campaignAccountKey(c);
      const name = accountKey
        ? resolveAccountLabel(accountKey, accountNames, accountMeta)
        : c.dealer;
      if (name) upsertAccountOption(name, accountKey || undefined);
      if (c.status) statuses.add(capitalize(normalizeCampaignStatus(c.status)));
    });

    // Build rep options from accountMeta
    const repMap = new Map<string, RepFilterOption>();
    let unassignedRepCount = 0;
    for (const key of accessibleAccountKeys) {
      const m = accountMeta[key];
      const repId = m?.accountRepId;
      if (!repId) { unassignedRepCount++; continue; }
      const label = m.accountRepName?.trim() || m.accountRepEmail || `Rep ${repId.slice(0, 6)}`;
      const existing = repMap.get(repId);
      if (existing) { existing.accountCount++; } else { repMap.set(repId, { id: repId, label, accountCount: 1 }); }
    }
    const reps = [...repMap.values()].sort((a, b) => a.label.localeCompare(b.label));
    if (unassignedRepCount > 0) reps.push({ id: '__unassigned__', label: 'Unassigned', accountCount: unassignedRepCount });

    return {
      accounts: [...accountsByLabel.values()].sort((a, b) => a.label.localeCompare(b.label)),
      statuses: [...statuses].sort(),
      oems: [...oems].sort(),
      industries: [...industries].sort(),
      reps,
    };
  }, [campaigns, accountNames, accountMeta, accessibleAccountKeys]);

  // Apply page-level filters
  const filteredCampaigns = useMemo(() => {
    let result = campaigns;

    if (filters.account.length > 0) {
      result = result.filter(c => {
        const accountKey = campaignAccountKey(c);
        const name = accountKey
          ? resolveAccountLabel(accountKey, accountNames, accountMeta)
          : c.dealer;
        return Boolean(name && filters.account.includes(name));
      });
    }

    if (filters.status.length > 0) {
      result = result.filter(c => filters.status.includes(capitalize(normalizeCampaignStatus(c.status))));
    }

    if (filters.oem.length > 0) {
      result = result.filter(c => {
        const accountKey = campaignAccountKey(c);
        if (!accountKey) return false;
        const meta = accountMeta[accountKey];
        if (meta?.category?.trim().toLowerCase() !== 'automotive') return false;
        const brands = getAccountOems(meta);
        return brands.some((brand) => filters.oem.includes(brand));
      });
    }

    if (filters.industry.length > 0) {
      result = result.filter(c => {
        const accountKey = campaignAccountKey(c);
        if (!accountKey) return false;
        const meta = accountMeta[accountKey];
        return Boolean(meta?.category && filters.industry.includes(meta.category));
      });
    }

    if (bounds.start) {
      result = result.filter(c => inRange(c, bounds.start!, bounds.end));
    }

    return result;
  }, [campaigns, filters, accountNames, accountMeta, bounds]);

  // filteredWorkflows + the workflows aggregate fed the old ESP analytics
  // breakdown. Now that the analytics tab uses the SendGrid-sourced
  // EngagementSection, those derivations live as dead code in the older
  // CampaignPageAnalytics component (still around for now) but the
  // admin page doesn't need them anymore.

  const selectedAccountLabel = filters.account.length === 1 ? filters.account[0] : null;

  const selectedAccountKey = useMemo(() => {
    if (!selectedAccountLabel) return null;
    return (
      accessibleAccountKeys.find(
        (key) => resolveAccountLabel(key, accountNames, accountMeta) === selectedAccountLabel,
      ) || null
    );
  }, [selectedAccountLabel, accessibleAccountKeys, accountNames, accountMeta]);

  const campaignEmptyState = selectedAccountLabel
    ? {
        title: `No campaigns found for ${selectedAccountLabel}`,
        subtitle: 'Build and schedule a campaign in Loomi to get started for this account.',
        actionLabel: 'Create Campaign',
        actionHref: '/messaging/campaigns/schedule',
      }
    : filters.account.length > 1
      ? {
          title: 'No campaigns found for selected sub-accounts',
          subtitle: 'Build and schedule campaigns in Loomi to get started.',
        }
    : null;

  return (
    <div>
      {/* Sticky header with title + centered tabs + controls */}
      <div className="page-sticky-header mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <PaperAirplaneIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">
                {activeTab === 'analytics' ? 'Analytics' : 'Campaigns'}
              </h2>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
                Email + SMS/MMS {activeTab === 'analytics' ? 'performance' : 'campaigns'} across all accounts
                {filteredCampaigns.length !== campaigns.length && (
                  <span className="ml-1 tabular-nums">
                    · {filteredCampaigns.length} / {campaigns.length}
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
            {/* Date + Filters live in the header for the analytics view; on
                the list view they're rendered next to the search input
                inside CampaignPageList (passed via toolbarExtras). */}
            {activeTab === 'analytics' && (
              <>
                <DashboardToolbar
                  dateRange={dateRange}
                  onDateRangeChange={setDateRange}
                  customRange={customRange}
                  onCustomRangeChange={setCustomRange}
                  showReset={false}
                  triggerSize="header"
                />
                <button
                  type="button"
                  onClick={() => setFiltersOpen((prev) => !prev)}
                  className={`inline-flex items-center gap-2 h-10 px-3 text-sm rounded-lg border transition-colors ${
                    filtersOpen
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                      : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
                  }`}
                  aria-pressed={filtersOpen}
                >
                  <FunnelIcon className="w-4 h-4" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="w-5 h-5 rounded-full bg-[var(--primary)] text-white text-[10px] flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </>
            )}
            {/* Create Campaign lives on the list view; analytics is read-only. */}
            {activeTab !== 'analytics' && (
              <PrimaryButton type="button" onClick={() => setShowCreateModal(true)}>
                <PlusIcon className="w-4 h-4" />
                Create Campaign
              </PrimaryButton>
            )}

          </div>
        </div>
      </div>

      <CreateCampaignModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        accountKeys={selectedAccountKey ? [selectedAccountKey] : []}
      />

      {/* Dashboard-style grid: content + inline filter side rail */}
      <div className={sideRailMounted ? 'grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start' : ''}>
        {/* Main content column */}
        <div className="min-w-0">
          {/* ESP error banner removed — Loomi is the engine; missing ESP
              credentials are expected for many sub-accounts and shouldn't
              dominate the page. */}

          {activeTab === 'analytics' && (
            <EngagementSection dateRange={dateRange} customRange={customRange} />
          )}

          {activeTab === 'list' && (
            <CampaignPageList
              campaigns={filteredCampaigns}
              loading={loading}
              accountNames={accountNames}
              accountMeta={accountMeta}
              accountProviders={accountProviders}
              emptyState={campaignEmptyState}
              toolbarExtras={
                <>
                  <DashboardToolbar
                    dateRange={dateRange}
                    onDateRangeChange={setDateRange}
                    customRange={customRange}
                    onCustomRangeChange={setCustomRange}
                    showReset={false}
                    triggerSize="compact"
                  />
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                      filtersOpen
                        ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                        : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
                    }`}
                    aria-pressed={filtersOpen}
                  >
                    <FunnelIcon className="w-3.5 h-3.5" />
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="w-4 h-4 rounded-full bg-[var(--primary)] text-white text-[9px] flex items-center justify-center">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                </>
              }
            />
          )}
        </div>

        {/* Inline filter side rail */}
        {sideRailMounted && (
          <CampaignFilterSidebar
            inline
            onClose={() => setFiltersOpen(false)}
            filters={filters}
            onFiltersChange={setFilters}
            options={filterOptions}
            className={`glass-panel glass-panel-strong w-full transition-[opacity,transform,max-height] duration-300 ease-out lg:sticky lg:top-24 lg:w-[360px] ${
              filtersOpen
                ? 'pointer-events-auto max-h-[calc(100vh-8rem)] translate-x-0 opacity-100 animate-slide-in-right'
                : 'pointer-events-none max-h-0 translate-x-4 opacity-0'
            }`}
          />
        )}
      </div>
    </div>
  );
}

// ── Account Campaigns Page (single-account, read-only) ──

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

  useEffect(() => {
    if (!accountKey) return;

    let cancelled = false;
    async function load() {
      // Fetch both sources in parallel: ESP-fetched campaigns and any
      // Loomi-native drafts/scheduled/sent campaigns. Either side may
      // legitimately fail (e.g. account has no ESP connection) — we
      // surface that as a non-fatal warning while still showing the
      // Loomi campaigns the user owns.
      const [espRes, loomiRes] = await Promise.allSettled([
        fetch(`/api/esp/campaigns?accountKey=${encodeURIComponent(accountKey!)}`),
        fetch(`/api/campaigns/loomi/list?accountKey=${encodeURIComponent(accountKey!)}`),
      ]);
      if (cancelled) return;

      let espCampaigns: Campaign[] = [];
      let espErrorMessage: string | null = null;
      if (espRes.status === 'fulfilled') {
        const data = await espRes.value.json().catch(() => ({}));
        if (cancelled) return;
        if (espRes.value.ok && Array.isArray(data.campaigns)) {
          espCampaigns = data.campaigns as Campaign[];
        } else {
          espErrorMessage = typeof data.error === 'string'
            ? withCampaignErrorHint(data.error)
            : `Failed to fetch ESP campaigns (${espRes.value.status})`;
        }
      } else {
        espErrorMessage = 'Failed to fetch ESP campaigns.';
      }

      let loomiCampaigns: Campaign[] = [];
      if (loomiRes.status === 'fulfilled') {
        const data = await loomiRes.value.json().catch(() => ({}));
        if (cancelled) return;
        if (loomiRes.value.ok && Array.isArray(data.campaigns)) {
          loomiCampaigns = data.campaigns as Campaign[];
        }
      }

      setCampaigns([...loomiCampaigns, ...espCampaigns]);
      // Only flag an ESP error if we have nothing to show at all —
      // otherwise the user sees their Loomi campaigns and an
      // 'integration not connected' warning would be misleading.
      if (espErrorMessage && loomiCampaigns.length === 0) {
        setApiError(espErrorMessage);
      } else {
        setApiError(null);
      }
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [accountKey]);

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

  const hasLoomiCampaigns = useMemo(
    () =>
      campaigns.some(
        (c) => c.provider === 'loomi-email' || c.provider === 'loomi-sms',
      ),
    [campaigns],
  );

  const accountNotIntegrated = useMemo(() => {
    // If the user has Loomi-native campaigns, ESP connection state is
    // irrelevant — Loomi is the engine and we have content to show.
    if (hasLoomiCampaigns) return false;
    const message = (apiError || '').toLowerCase();
    const disconnectedConnection = accountData?.activeConnection?.connected === false;
    const missingConnectionMetadata =
      Boolean(accountData) &&
      !accountData?.activeConnection?.connected &&
      !accountData?.activeConnection?.provider &&
      !accountData?.activeEspProvider &&
      !accountData?.espProvider;
    return (
      message.includes('esp not connected') ||
      message.includes('not connected for this account') ||
      message.includes('not integrated') ||
      disconnectedConnection ||
      missingConnectionMetadata
    );
  }, [accountData, apiError, hasLoomiCampaigns]);

  const accountEmptyTitle =
    accountNotIntegrated
      ? 'Account not integrated'
      : visibleCampaigns.length === 0
      ? (userRole === 'client'
          ? 'No scheduled or sent campaigns yet'
          : 'No campaigns yet')
      : 'No campaigns match this date range';
  const accountEmptySubtitle =
    accountNotIntegrated
      ? 'Connect your ESP integration to view reporting.'
      : visibleCampaigns.length === 0
      ? (userRole === 'client'
          ? 'Scheduled and sent campaigns will appear here.'
          : 'Drafts, scheduled, and sent campaigns will all appear here.')
      : 'Try expanding the selected date range.';

  const dealerName = accountData?.dealer || 'Your Sub-Account';
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
      actionLabel: accountNotIntegrated ? 'Open Integrations' : 'Create Campaign',
      actionHref: accountNotIntegrated ? '/settings/integrations' : undefined,
      onAction: accountNotIntegrated ? undefined : () => setShowCreateModal(true),
    }),
    [accountEmptySubtitle, accountEmptyTitle, accountNotIntegrated],
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
                {activeTab === 'analytics' ? 'Analytics' : 'Campaigns'}
              </h2>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
                Email + SMS/MMS {activeTab === 'analytics' ? 'performance' : 'campaigns'} for {dealerName}
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

            {/* Create Campaign lives on the list view; analytics is read-only. */}
            {activeTab !== 'analytics' && (
              <>
                {/* Cog → messaging-scoped settings (sender identity,
                    SendGrid, suppressions). Lives inside /messaging so
                    these surfaces stay close to the surface that uses
                    them, rather than buried in the global sub-account
                    settings page. */}
                <Link
                  href={subHref('/messaging/settings')}
                  aria-label="Email settings"
                  title="Email settings"
                  className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
                >
                  <Cog6ToothIcon className="w-4 h-4" />
                </Link>
                <PrimaryButton type="button" onClick={openCreateCampaignModal}>
                  <PlusIcon className="w-4 h-4" />
                  Create Campaign
                </PrimaryButton>
              </>
            )}
          </div>
        </div>
      </div>

      <CreateCampaignModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        accountKeys={accountKey ? [accountKey] : []}
        redirectBase={subHref('/messaging/campaigns')}
      />

      <div className="min-w-0">
        {apiError && !accountNotIntegrated && (
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
          <CampaignPageList
            campaigns={dateFiltered}
            loading={loading}
            accountNames={accountNames}
            accountMeta={accountMeta}
            accountProviders={accountProviders}
            emptyState={accountListEmptyState}
            singleAccountMode
            toolbarExtras={
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
      </div>
    </div>
  );
}

// ── Exported Page ──

export default function CampaignsPage() {
  const { isAdmin, isAccount } = useAccount();

  if (isAdmin) {
    return (
      <AdminOnly>
        <AdminCampaignsPage />
      </AdminOnly>
    );
  }

  if (isAccount) {
    return <AccountCampaignsPage />;
  }

  return null;
}
