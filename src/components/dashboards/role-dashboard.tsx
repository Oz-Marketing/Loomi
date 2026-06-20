'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { ApexOptions } from 'apexcharts';
import {
  ArrowPathIcon,
  BookOpenIcon,
  ChartBarIcon,
  CheckCircleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  PaperAirplaneIcon,
  SquaresPlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAccount, type AccountData } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { DashboardToolbar, type AccountOption, type CustomDateRange } from '@/components/filters/dashboard-toolbar';
import {
  type DateRangeBounds,
  type DateRangeKey,
  DATE_RANGE_PRESETS,
  DEFAULT_DATE_RANGE,
  filterByDateRange,
  getDateRangeBounds,
} from '@/lib/date-ranges';
import { parseEmailListPayload, type EmailListItem } from '@/lib/email-list-payload';
import { ContactAnalytics } from '@/components/contacts/contact-analytics';
import { CampaignPageAnalytics } from '@/components/campaigns/campaign-page-analytics';
import { AccountAvatar } from '@/components/account-avatar';
import { formatRatePct, sumCampaignEngagement } from '@/lib/campaign-engagement';
import { iconColorClassForLabel, iconColorHexForLabel } from '@/lib/icon-colors';
import {
  DashboardCustomizePanel,
  DashboardWidgetFrame,
  type DashboardWidgetDefinition,
  useDashboardCustomization,
} from '@/components/dashboards/dashboard-layout-customizer';
import {
  useContactsAggregate,
  useCampaignsAggregate,
  useWorkflowsAggregate,
  useContactStats,
} from '@/hooks/use-dashboard-data';
import { usePortfolioDashboard } from '@/hooks/use-portfolio-dashboard';
import {
  AccountHealthScoredGrid,
  AnomalyFeedWidget,
  EngagedContactsWidget,
  EngagementTimelineWidget,
  LifecycleActionCenter,
  MetaPacerSummaryWidget,
  PortfolioKpiStrip,
  RecentActivityWidget,
  RepPerformanceWidget,
  SendPipelineWidget,
  SuppressionHealthWidget,
  TopCampaignsWidget,
} from '@/components/dashboards/portfolio-widgets';

type ManagementRole = 'developer' | 'super_admin' | 'admin';

type AggregateContact = {
  id: string;
  fullName: string;
  tags: string[];
  dateAdded: string;
  source: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  lastServiceDate: string;
  nextServiceDate: string;
  leaseEndDate: string;
  warrantyEndDate: string;
  purchaseDate: string;
  _accountKey?: string;
  _dealer?: string;
};

type EspCampaign = {
  id: string;
  name: string;
  status: string;
  accountKey?: string;
  dealer?: string;
  createdAt?: string;
  updatedAt?: string;
  scheduledAt?: string;
  sentAt?: string;
  sentCount?: number;
  deliveredCount?: number;
  openedCount?: number;
  clickedCount?: number;
  repliedCount?: number;
  bouncedCount?: number;
  failedCount?: number;
  unsubscribedCount?: number;
  openRate?: number;
  clickRate?: number;
  replyRate?: number;
};

type EspWorkflow = {
  id: string;
  name: string;
  status: string;
  accountKey?: string;
  dealer?: string;
  createdAt?: string;
  updatedAt?: string;
};

type LoomiEmailCampaign = {
  id: string;
  name: string;
  subject: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  accountKeys: string[];
  createdAt: string;
  updatedAt: string;
  scheduledFor?: string;
};

type LoomiSmsCampaign = {
  id: string;
  name: string;
  message: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  accountKeys: string[];
  createdAt: string;
  updatedAt: string;
  scheduledFor?: string;
};

type ContactStatsRow = {
  dealer: string;
  contactCount: number | null;
  connected: boolean;
  cached?: boolean;
  provider?: string;
  error?: string;
};

type RepScopeOption = {
  id: string;
  label: string;
  accountCount: number;
};

type SuperAdminFilterPreset = {
  id: string;
  name: string;
  accountKeys: string[];
  repIds: string[];
  dateRange: DateRangeKey;
  customRange: { start: string; end: string } | null;
  createdAt: string;
};

const UNASSIGNED_REP_ID = '__unassigned__';
const ApexChart = dynamic(() => import('react-apexcharts'), { ssr: false });

const DATE_FIELDS_FOR_CAMPAIGNS = ['sentAt', 'scheduledAt', 'updatedAt', 'createdAt'] as const;
const DASHBOARD_DUMMY_MODE = process.env.NEXT_PUBLIC_DASHBOARD_DUMMY_DATA === '1';

function normalizeAccountOptions(accounts: Record<string, AccountData>): AccountOption[] {
  return Object.entries(accounts)
    .map(([key, account]) => ({
      key,
      label: account.dealer || key,
      storefrontImage: account.storefrontImage,
      logos: account.logos,
      city: account.city,
      state: account.state,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function firstCampaignDate(campaign: EspCampaign): string | null {
  for (const field of DATE_FIELDS_FOR_CAMPAIGNS) {
    const value = campaign[field];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function inBounds(dateValue: string | undefined | null, bounds: DateRangeBounds): boolean {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  if (!bounds.start) return date.getTime() <= bounds.end.getTime();
  return date.getTime() >= bounds.start.getTime() && date.getTime() <= bounds.end.getTime();
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function relativeTime(iso?: string): string {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase();
}

function campaignStatusLabel(status: string): string {
  const normalized = normalizeStatus(status);
  if (normalized === 'draft') return 'In Progress';
  return normalized
    .replace(/[_\s]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function intersectsAccountSet(accountKeys: string[] | undefined, scopedAccountSet: Set<string>): boolean {
  if (!Array.isArray(accountKeys) || accountKeys.length === 0) return false;
  return accountKeys.some((key) => scopedAccountSet.has(key));
}

function isDateRangeKey(value: unknown): value is DateRangeKey {
  return typeof value === 'string' && DATE_RANGE_PRESETS.some((preset) => preset.key === value);
}

function accountRepScopeId(account: AccountData | undefined): string {
  if (!account) return UNASSIGNED_REP_ID;
  const repId = account.accountRep?.id || account.accountRepId;
  if (typeof repId === 'string' && repId.trim()) return repId;
  return UNASSIGNED_REP_ID;
}

function daysAgoIso(daysAgo: number, hour = 10): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

function buildMockManagementDataset(accounts: Record<string, AccountData>) {
  const fallbackAccountKeys = ['demoAccount001', 'demoAccount002', 'demoAccount003', 'demoAccount004', 'demoAccount005'];
  const accountKeys = Object.keys(accounts).length > 0 ? Object.keys(accounts) : fallbackAccountKeys;

  const emails: EmailListItem[] = [];
  const contactStats: Record<string, ContactStatsRow> = {};
  const contacts: AggregateContact[] = [];
  const espCampaigns: EspCampaign[] = [];
  const espWorkflows: EspWorkflow[] = [];
  const loomiEmailCampaigns: LoomiEmailCampaign[] = [];
  const loomiSmsCampaigns: LoomiSmsCampaign[] = [];
  const campaignPerAccount: Record<string, { dealer: string; count: number; connected: boolean; provider: string }> = {};
  const workflowPerAccount: Record<string, { dealer: string; count: number; connected: boolean; provider: string }> = {};

  for (const [index, accountKey] of accountKeys.entries()) {
    const dealer = accounts[accountKey]?.dealer || `Demo Account ${String(index + 1).padStart(3, '0')}`;
    const connected = index % 5 !== 0;
    const totalContacts = 1300 + index * 280;

    contactStats[accountKey] = {
      dealer,
      contactCount: totalContacts,
      connected,
      cached: true,
      provider: 'loomi',
      error: connected ? undefined : 'Mock data warning',
    };

    campaignPerAccount[accountKey] = {
      dealer,
      count: 14 + index * 2,
      connected,
      provider: 'loomi',
    };

    workflowPerAccount[accountKey] = {
      dealer,
      count: 7 + index,
      connected,
      provider: 'loomi',
    };

    for (let i = 0; i < 8; i += 1) {
      const day = (index * 11 + i * 6) % 170;
      emails.push({
        id: `mock-email-${accountKey}-${i}`,
        name: `${dealer} Template ${i + 1}`,
        accountKey,
        status: i % 4 === 0 ? 'draft' : 'active',
        createdAt: daysAgoIso(day, 9),
        updatedAt: daysAgoIso(Math.max(0, day - 2), 11),
        templateId: `tpl-${accountKey}-${i}`,
        templateSlug: `service-reminder-${i + 1}`,
        templateTitle: `Service Reminder ${i + 1}`,
      });
    }

    for (let i = 0; i < 40; i += 1) {
      const day = (index * 7 + i * 3) % 180;
      contacts.push({
        id: `mock-contact-${accountKey}-${i}`,
        fullName: `${dealer} Lead ${i + 1}`,
        tags: i % 3 === 0 ? ['service'] : i % 3 === 1 ? ['sales'] : ['campaign'],
        dateAdded: daysAgoIso(day, 13),
        source: i % 2 === 0 ? 'service' : 'sales',
        vehicleMake: 'Chevrolet',
        vehicleModel: i % 2 === 0 ? 'Silverado' : 'Equinox',
        vehicleYear: String(2018 + (i % 7)),
        lastServiceDate: daysAgoIso(day + 25, 14),
        nextServiceDate: daysAgoIso(Math.max(0, day - 65), 14),
        leaseEndDate: daysAgoIso(Math.max(0, day - 220), 15),
        warrantyEndDate: daysAgoIso(Math.max(0, day - 420), 15),
        purchaseDate: daysAgoIso(day + 420, 12),
        _accountKey: accountKey,
        _dealer: dealer,
      });
    }

    for (let i = 0; i < 14; i += 1) {
      const day = (index * 5 + i * 6) % 170;
      const status = i % 4 === 0 ? 'scheduled' : i % 4 === 1 ? 'active' : 'sent';
      const sentCount = 300 + index * 65 + i * 35;
      const deliveredCount = Math.max(0, Math.round(sentCount * 0.95));
      const openedCount = Math.round(deliveredCount * (0.24 + ((i % 4) * 0.03)));
      const clickedCount = Math.round(deliveredCount * (0.06 + ((i % 3) * 0.015)));
      const repliedCount = Math.round(deliveredCount * (0.02 + ((i % 3) * 0.005)));

      espCampaigns.push({
        id: `mock-esp-campaign-${accountKey}-${i}`,
        name: `${dealer} Campaign ${i + 1}`,
        status,
        accountKey,
        dealer,
        createdAt: daysAgoIso(day + 2, 10),
        updatedAt: daysAgoIso(day, 11),
        scheduledAt: status === 'scheduled' ? daysAgoIso(Math.max(0, day - 4), 9) : undefined,
        sentAt: status === 'sent' ? daysAgoIso(day, 16) : undefined,
        sentCount,
        deliveredCount,
        openedCount,
        clickedCount,
        repliedCount,
        bouncedCount: Math.round(sentCount * 0.01),
        failedCount: Math.round(sentCount * 0.015),
        unsubscribedCount: Math.round(sentCount * 0.004),
        openRate: deliveredCount > 0 ? openedCount / deliveredCount : 0,
        clickRate: deliveredCount > 0 ? clickedCount / deliveredCount : 0,
        replyRate: deliveredCount > 0 ? repliedCount / deliveredCount : 0,
      });
    }

    for (let i = 0; i < 8; i += 1) {
      const day = (index * 8 + i * 9) % 180;
      espWorkflows.push({
        id: `mock-workflow-${accountKey}-${i}`,
        name: `${dealer} Flow ${i + 1}`,
        status: i % 3 === 0 ? 'active' : i % 3 === 1 ? 'draft' : 'paused',
        accountKey,
        dealer,
        createdAt: daysAgoIso(day + 30, 8),
        updatedAt: daysAgoIso(day, 8),
      });
    }

    for (let i = 0; i < 5; i += 1) {
      const day = (index * 6 + i * 11) % 150;
      loomiEmailCampaigns.push({
        id: `mock-loomi-email-${accountKey}-${i}`,
        name: `${dealer} Loomi Email ${i + 1}`,
        subject: `Exclusive Service Offer ${i + 1}`,
        status: i % 2 === 0 ? 'completed' : 'scheduled',
        totalRecipients: 550 + index * 80 + i * 55,
        sentCount: 510 + index * 72 + i * 45,
        failedCount: 12 + i * 2,
        accountKeys: [accountKey],
        createdAt: daysAgoIso(day + 5, 10),
        updatedAt: daysAgoIso(day, 12),
        scheduledFor: i % 2 === 1 ? daysAgoIso(Math.max(0, day - 3), 9) : undefined,
      });

      loomiSmsCampaigns.push({
        id: `mock-loomi-sms-${accountKey}-${i}`,
        name: `${dealer} Loomi SMS ${i + 1}`,
        message: `Service reminder for ${dealer}`,
        status: i % 2 === 0 ? 'completed' : 'scheduled',
        totalRecipients: 400 + index * 60 + i * 40,
        sentCount: 378 + index * 52 + i * 34,
        failedCount: 10 + i * 2,
        accountKeys: [accountKey],
        createdAt: daysAgoIso(day + 7, 9),
        updatedAt: daysAgoIso(day, 10),
        scheduledFor: i % 2 === 1 ? daysAgoIso(Math.max(0, day - 2), 9) : undefined,
      });
    }
  }

  return {
    emails,
    contactStats,
    contacts,
    espCampaigns,
    espWorkflows,
    loomiEmailCampaigns,
    loomiSmsCampaigns,
    campaignPerAccount,
    workflowPerAccount,
  };
}

function toPossessiveLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Account';
  return /s$/i.test(trimmed) ? `${trimmed}'` : `${trimmed}'s`;
}

function loadJson(url: string) {
  return fetch(url)
    .then(async (res) => {
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, json };
    })
    .catch(() => ({ ok: false, status: 0, json: { error: 'Network error' } as Record<string, unknown> }));
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
}) {
  const content = (
    <>
      <div className="mb-2 flex items-center justify-between">
        <Icon className={`h-6 w-6 ${iconColorClassForLabel(label)}`} />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{label}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{sub}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="glass-card rounded-xl p-4 transition-colors hover:bg-[var(--muted)]/40">
        {content}
      </Link>
    );
  }

  return <div className="glass-card rounded-xl p-4">{content}</div>;
}

export function RoleDashboard() {
  const { userRole, isAccount, accountKey, accountData, accounts, userEmail, userName } = useAccount();

  if (!userRole) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading dashboard...</div>;
  }

  if (userRole === 'client') {
    return <ClientRoleDashboard accountKey={accountKey} accountData={accountData} userName={userName} />;
  }

  return (
    <ManagementRoleDashboard
      role={userRole as ManagementRole}
      accounts={accounts}
      isAccountMode={isAccount}
      focusedAccountKey={accountKey}
      userEmail={userEmail}
      userName={userName}
    />
  );
}

function ManagementRoleDashboard({
  role,
  accounts,
  isAccountMode,
  focusedAccountKey,
  userEmail,
  userName,
}: {
  role: ManagementRole;
  accounts: Record<string, AccountData>;
  isAccountMode: boolean;
  focusedAccountKey: string | null;
  userEmail: string | null;
  userName: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const [filtersPanelOpen, setFiltersPanelOpen] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedRepIds, setSelectedRepIds] = useState<string[]>([]);
  const [superAdminPresetName, setSuperAdminPresetName] = useState('');
  const [superAdminPresets, setSuperAdminPresets] = useState<SuperAdminFilterPreset[]>([]);
  const [superAdminPresetsHydrated, setSuperAdminPresetsHydrated] = useState(false);
  const lastFocusedRef = useRef<string | null>(null);

  const [emails, setEmails] = useState<EmailListItem[]>([]);
  const [loomiEmailCampaigns, setLoomiEmailCampaigns] = useState<LoomiEmailCampaign[]>([]);
  const [loomiSmsCampaigns, setLoomiSmsCampaigns] = useState<LoomiSmsCampaign[]>([]);

  const [phase1Errors, setPhase1Errors] = useState<{
    emails?: string;
    loomiEmail?: string;
    loomiSms?: string;
  }>({});
  const [usingMockData, setUsingMockData] = useState(false);

  // Mock-only state (populated when DASHBOARD_DUMMY_MODE is on)
  const [mockContacts, setMockContacts] = useState<AggregateContact[]>([]);
  const [mockContactStats, setMockContactStats] = useState<Record<string, ContactStatsRow>>({});
  const [mockEspCampaigns, setMockEspCampaigns] = useState<EspCampaign[]>([]);
  const [mockEspWorkflows, setMockEspWorkflows] = useState<EspWorkflow[]>([]);

  const aggregateAccountKeys = useMemo(() => {
    const availableAccountKeys = Object.keys(accounts);
    let keys = selectedAccounts.filter((key) => availableAccountKeys.includes(key));

    if (keys.length === 0 && isAccountMode && focusedAccountKey) {
      keys = [focusedAccountKey];
    }

    if (role === 'super_admin' && selectedRepIds.length > 0) {
      const repScopedKeys = availableAccountKeys.filter((key) =>
        selectedRepIds.includes(accountRepScopeId(accounts[key])),
      );
      keys = keys.length > 0
        ? keys.filter((key) => repScopedKeys.includes(key))
        : repScopedKeys;
    }

    return [...new Set(keys)];
  }, [accounts, selectedAccounts, isAccountMode, focusedAccountKey, role, selectedRepIds]);

  // SWR hooks — wait for phase-1 load (accounts/emails) so we have the right
  // account key scope before firing expensive aggregate fetches.
  const aggregatesReady = !loading && !usingMockData;
  const contactsAgg = useContactsAggregate({
    enabled: aggregatesReady,
    accountKeys: aggregateAccountKeys,
    limitPerAccount: aggregateAccountKeys.length > 0 ? 120 : 60,
  });
  const campaignsAgg = useCampaignsAggregate({
    enabled: aggregatesReady,
    accountKeys: aggregateAccountKeys,
  });
  const workflowsAgg = useWorkflowsAggregate({
    enabled: aggregatesReady,
    accountKeys: aggregateAccountKeys,
  });
  const contactStatsHook = useContactStats({
    enabled: aggregatesReady,
    accountKeys: aggregateAccountKeys,
  });

  // Single batched fetch for every native (Loomi-side) widget. Sections
  // come back in parallel server-side; SWR de-duplicates per
  // (accountKeys, range) tuple.
  const portfolioRangeBounds = useMemo(
    () =>
      dateRange === 'custom' && customRange
        ? getDateRangeBounds('custom', customRange.start, customRange.end)
        : getDateRangeBounds(dateRange),
    [dateRange, customRange],
  );
  // Portfolio fetch is enabled as soon as the phase-1 load completes,
  // regardless of mock mode. The API route handles the
  // NEXT_PUBLIC_DASHBOARD_DUMMY_DATA=1 short-circuit server-side, so the
  // hook needs to fire to receive the mock payload.
  const portfolioHook = usePortfolioDashboard({
    enabled: !loading,
    accountKeys: aggregateAccountKeys,
    start: portfolioRangeBounds.start,
    end: portfolioRangeBounds.end,
  });

  // Bridge variables — downstream useMemos reference these exact names
  const contacts: AggregateContact[] = usingMockData
    ? mockContacts
    : (contactsAgg.data?.contacts as AggregateContact[] | undefined) ?? [];
  const contactsAggregateLoading = usingMockData ? false : !aggregatesReady || contactsAgg.isLoading;

  const espCampaigns: EspCampaign[] = usingMockData
    ? mockEspCampaigns
    : (campaignsAgg.data?.campaigns as EspCampaign[] | undefined) ?? [];

  const espWorkflows: EspWorkflow[] = usingMockData
    ? mockEspWorkflows
    : (workflowsAgg.data?.workflows as EspWorkflow[] | undefined) ?? [];

  const contactStats: Record<string, ContactStatsRow> = useMemo(() => {
    if (usingMockData) return mockContactStats;
    if (!contactStatsHook.data?.stats) return {};
    const rawStats = contactStatsHook.data.stats;
    const normalized: Record<string, ContactStatsRow> = {};
    for (const [accountKey, stat] of Object.entries(rawStats)) {
      const countRaw = stat.contactCount ?? stat.count;
      normalized[accountKey] = {
        dealer: String(stat.dealer || accountKey),
        contactCount: typeof countRaw === 'number' ? countRaw : asNumber(countRaw),
        connected: Boolean(stat.connected),
        cached: Boolean(stat.cached),
        provider: typeof stat.provider === 'string' ? stat.provider : undefined,
        error: typeof stat.error === 'string' ? stat.error : undefined,
      };
    }
    return normalized;
  }, [usingMockData, mockContactStats, contactStatsHook.data]);

  const { theme } = useTheme();
  const isDeveloper = role === 'developer';
  const isSuperAdmin = role === 'super_admin';
  const quickFilterStorageKey = `loomi_dashboard_quick_filters_v1:${(userEmail || 'anonymous').toLowerCase()}`;
  const accountKeysSignature = useMemo(() => Object.keys(accounts).sort().join('|'), [accounts]);

  const [customizePanelOpen, setCustomizePanelOpen] = useState(false);
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const [managementSideRailMounted, setManagementSideRailMounted] = useState(false);
  const [filterSideRailMounted, setFilterSideRailMounted] = useState(false);

  useEffect(() => {
    setCustomizePanelOpen(false);
    setFiltersPanelOpen(false);
    setDraggedWidgetId(null);
    setManagementSideRailMounted(false);
    setFilterSideRailMounted(false);
  }, [role, isAccountMode, focusedAccountKey]);

  const managementSideRailOpen = customizePanelOpen;

  useEffect(() => {
    if (managementSideRailOpen) {
      setManagementSideRailMounted(true);
      return;
    }

    const timer = window.setTimeout(() => setManagementSideRailMounted(false), 260);
    return () => window.clearTimeout(timer);
  }, [managementSideRailOpen]);

  useEffect(() => {
    if (filtersPanelOpen) {
      setFilterSideRailMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setFilterSideRailMounted(false), 260);
    return () => window.clearTimeout(timer);
  }, [filtersPanelOpen]);

  useEffect(() => {
    if (!filtersPanelOpen) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setFiltersPanelOpen(false);
    }
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [filtersPanelOpen]);

  useEffect(() => {
    if (!isAccountMode || !focusedAccountKey) {
      lastFocusedRef.current = null;
      setSelectedAccounts([]);
      return;
    }
    if (lastFocusedRef.current === focusedAccountKey) return;
    lastFocusedRef.current = focusedAccountKey;
    setSelectedAccounts([focusedAccountKey]);
  }, [isAccountMode, focusedAccountKey]);

  useEffect(() => {
    if (!isSuperAdmin) {
      setSelectedRepIds([]);
      setSuperAdminPresets([]);
      setSuperAdminPresetsHydrated(false);
      return;
    }

    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem(quickFilterStorageKey);
      if (!raw) {
        setSuperAdminPresets([]);
        setSuperAdminPresetsHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setSuperAdminPresets([]);
        setSuperAdminPresetsHydrated(true);
        return;
      }

      const normalized: SuperAdminFilterPreset[] = [];
      for (const row of parsed) {
        if (typeof row !== 'object' || row == null) continue;
        const candidate = row as Record<string, unknown>;
        if (!isDateRangeKey(candidate.dateRange)) continue;
        normalized.push({
          id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : 'Saved filter',
          accountKeys: Array.isArray(candidate.accountKeys) ? candidate.accountKeys.filter((key): key is string => typeof key === 'string') : [],
          repIds: Array.isArray(candidate.repIds) ? candidate.repIds.filter((id): id is string => typeof id === 'string') : [],
          dateRange: candidate.dateRange,
          customRange:
            candidate.customRange &&
            typeof candidate.customRange === 'object' &&
            typeof (candidate.customRange as Record<string, unknown>).start === 'string' &&
            typeof (candidate.customRange as Record<string, unknown>).end === 'string'
              ? {
                  start: String((candidate.customRange as Record<string, unknown>).start),
                  end: String((candidate.customRange as Record<string, unknown>).end),
                }
              : null,
          createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
        });
      }

      setSuperAdminPresets(normalized);
    } catch {
      setSuperAdminPresets([]);
    } finally {
      setSuperAdminPresetsHydrated(true);
    }
  }, [isSuperAdmin, quickFilterStorageKey]);

  useEffect(() => {
    if (!isSuperAdmin || !superAdminPresetsHydrated || typeof window === 'undefined') return;
    window.localStorage.setItem(quickFilterStorageKey, JSON.stringify(superAdminPresets));
  }, [isSuperAdmin, superAdminPresetsHydrated, quickFilterStorageKey, superAdminPresets]);

  // Mock data mode — populate mock states and skip SWR fetches
  useEffect(() => {
    if (!DASHBOARD_DUMMY_MODE) return;
    const mock = buildMockManagementDataset(accounts);
    setEmails(mock.emails);
    setMockContactStats(mock.contactStats);
    setMockContacts(mock.contacts);
    setMockEspCampaigns(mock.espCampaigns);
    setMockEspWorkflows(mock.espWorkflows);
    setLoomiEmailCampaigns(mock.loomiEmailCampaigns);
    setLoomiSmsCampaigns(mock.loomiSmsCampaigns);
    setUsingMockData(true);
    setLoading(false);
  }, [accounts]);

  // Dev fallback — if the contacts SWR aggregate errors out completely
  // we drop down to mock data so the dashboard still renders something
  // useful locally. ESP aggregate hooks no longer fire (they stub to an
  // empty payload), so they're omitted from the trigger condition.
  useEffect(() => {
    if (DASHBOARD_DUMMY_MODE || usingMockData) return;
    if (process.env.NODE_ENV !== 'development') return;
    if (contactsAgg.error && !contactsAgg.isLoading) {
      const mock = buildMockManagementDataset(accounts);
      setEmails(mock.emails);
      setMockContactStats(mock.contactStats);
      setMockContacts(mock.contacts);
      setMockEspCampaigns(mock.espCampaigns);
      setMockEspWorkflows(mock.espWorkflows);
      setLoomiEmailCampaigns(mock.loomiEmailCampaigns);
      setLoomiSmsCampaigns(mock.loomiSmsCampaigns);
          setUsingMockData(true);
    }
  }, [accounts, usingMockData, contactsAgg.error, contactsAgg.isLoading]);

  // Phase 1 — lightweight endpoints (emails, loomi campaigns, users)
  useEffect(() => {
    if (DASHBOARD_DUMMY_MODE) return;
    let cancelled = false;

    async function loadPhase1() {
      setLoading(true);
      setPhase1Errors({});

      const [
        emailRes,
        loomiEmailRes,
        loomiSmsRes,
      ] = await Promise.all([
        loadJson('/api/emails'),
        loadJson('/api/campaigns/email?limit=50'),
        loadJson('/api/campaigns/sms?limit=50'),
      ]);

      if (cancelled) return;

      const nextErrors: typeof phase1Errors = {};
      setUsingMockData(false);

      if (emailRes.ok) {
        setEmails(parseEmailListPayload(emailRes.json));
      } else {
        setEmails([]);
        nextErrors.emails = String((emailRes.json as Record<string, unknown>).error || `Error ${emailRes.status}`);
      }

      if (loomiEmailRes.ok) {
        const rows = asArray<LoomiEmailCampaign>((loomiEmailRes.json as Record<string, unknown>).campaigns);
        setLoomiEmailCampaigns(rows);
      } else {
        setLoomiEmailCampaigns([]);
        nextErrors.loomiEmail = String((loomiEmailRes.json as Record<string, unknown>).error || `Error ${loomiEmailRes.status}`);
      }

      if (loomiSmsRes.ok) {
        const rows = asArray<LoomiSmsCampaign>((loomiSmsRes.json as Record<string, unknown>).campaigns);
        setLoomiSmsCampaigns(rows);
      } else {
        setLoomiSmsCampaigns([]);
        nextErrors.loomiSms = String((loomiSmsRes.json as Record<string, unknown>).error || `Error ${loomiSmsRes.status}`);
      }

      setPhase1Errors(nextErrors);
      setLoading(false);
    }

    loadPhase1();

    return () => {
      cancelled = true;
    };
  }, [accountKeysSignature, accounts]);

  const accountOptions: AccountOption[] = useMemo(() => {
    if (Object.keys(accounts).length > 0) return normalizeAccountOptions(accounts);
    return Object.entries(contactStats)
      .map(([key, stat]): AccountOption => ({ key, label: stat.dealer || key }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [accounts, contactStats]);
  const filteredAccountOptions = useMemo(() => {
    const q = accountSearchQuery.trim().toLowerCase();
    if (!q) return accountOptions;
    return accountOptions.filter((account) => {
      const location = [account.city, account.state].filter(Boolean).join(' ');
      return account.label.toLowerCase().includes(q) || location.toLowerCase().includes(q);
    });
  }, [accountOptions, accountSearchQuery]);
  const accountNames = useMemo(
    () =>
      Object.fromEntries(
        accountOptions.map((account) => [account.key, account.label]),
      ) as Record<string, string>,
    [accountOptions],
  );

  const bounds = useMemo(
    () =>
      dateRange === 'custom' && customRange
        ? getDateRangeBounds('custom', customRange.start, customRange.end)
        : getDateRangeBounds(dateRange),
    [dateRange, customRange],
  );

  const repScopeOptions = useMemo<RepScopeOption[]>(() => {
    if (!isSuperAdmin) return [];
    const map = new Map<string, RepScopeOption>();
    let unassignedCount = 0;

    for (const account of Object.values(accounts)) {
      const repId = account.accountRep?.id || account.accountRepId;
      if (!repId) {
        unassignedCount += 1;
        continue;
      }

      const label = account.accountRep?.name?.trim() || account.accountRep?.email || `Rep ${repId.slice(0, 6)}`;
      const existing = map.get(repId);
      if (existing) {
        existing.accountCount += 1;
      } else {
        map.set(repId, { id: repId, label, accountCount: 1 });
      }
    }

    const options = [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
    if (unassignedCount > 0) {
      options.push({ id: UNASSIGNED_REP_ID, label: 'Unassigned', accountCount: unassignedCount });
    }
    return options;
  }, [accounts, isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const validRepIds = new Set(repScopeOptions.map((rep) => rep.id));
    setSelectedRepIds((prev) => prev.filter((repId) => validRepIds.has(repId)));
  }, [isSuperAdmin, repScopeOptions]);

  const accountScopeKeys = useMemo(() => {
    const availableAccountKeys = Object.keys(accounts).length > 0
      ? Object.keys(accounts)
      : Object.keys(contactStats);

    let keys =
      selectedAccounts.length > 0
        ? selectedAccounts.filter((key) => availableAccountKeys.includes(key))
        : availableAccountKeys;

    if (isSuperAdmin && selectedRepIds.length > 0) {
      keys = keys.filter((key) => selectedRepIds.includes(accountRepScopeId(accounts[key])));
    }

    return keys;
  }, [accounts, contactStats, isSuperAdmin, selectedAccounts, selectedRepIds]);

  const accountScopeSet = useMemo(() => new Set(accountScopeKeys), [accountScopeKeys]);

  const filteredEmailsByAccount = useMemo(
    () => emails.filter((email) => accountScopeSet.has(email.accountKey)),
    [emails, accountScopeSet],
  );

  const filteredContactsByAccount = useMemo(
    () => contacts.filter((contact) => accountScopeSet.has(contact._accountKey || '')),
    [contacts, accountScopeSet],
  );

  const filteredContacts = useMemo(
    () => filterByDateRange(filteredContactsByAccount, 'dateAdded', bounds),
    [filteredContactsByAccount, bounds],
  );

  const filteredEspCampaignsByAccount = useMemo(
    () =>
      espCampaigns.filter((campaign) => Boolean(campaign.accountKey && accountScopeSet.has(campaign.accountKey))),
    [espCampaigns, accountScopeSet],
  );

  const filteredEspCampaigns = useMemo(
    () =>
      filteredEspCampaignsByAccount.filter((campaign) => {
        const dateValue = firstCampaignDate(campaign);
        return inBounds(dateValue, bounds);
      }),
    [filteredEspCampaignsByAccount, bounds],
  );

  const filteredEspWorkflowsByAccount = useMemo(
    () =>
      espWorkflows.filter((workflow) => Boolean(workflow.accountKey && accountScopeSet.has(workflow.accountKey))),
    [espWorkflows, accountScopeSet],
  );

  const filteredEspWorkflows = useMemo(
    () =>
      filteredEspWorkflowsByAccount.filter((workflow) =>
        inBounds(workflow.updatedAt || workflow.createdAt, bounds),
      ),
    [filteredEspWorkflowsByAccount, bounds],
  );

  const filteredLoomiEmailCampaigns = useMemo(
    () =>
      loomiEmailCampaigns
        .filter((campaign) => intersectsAccountSet(campaign.accountKeys, accountScopeSet))
        .filter((campaign) => inBounds(campaign.updatedAt || campaign.createdAt, bounds)),
    [loomiEmailCampaigns, accountScopeSet, bounds],
  );

  const filteredLoomiSmsCampaigns = useMemo(
    () =>
      loomiSmsCampaigns
        .filter((campaign) => intersectsAccountSet(campaign.accountKeys, accountScopeSet))
        .filter((campaign) => inBounds(campaign.updatedAt || campaign.createdAt, bounds)),
    [loomiSmsCampaigns, accountScopeSet, bounds],
  );

  const scopedAccountKeys = accountScopeKeys;

  const totals = useMemo(() => {
    const connectedAccounts = scopedAccountKeys.filter((key) => contactStats[key]?.connected).length;
    const contactsTotal = scopedAccountKeys.reduce(
      (sum, key) => sum + (contactStats[key]?.contactCount || 0),
      0,
    );
    const activeEmails = filteredEmailsByAccount.filter((email) => normalizeStatus(email.status) === 'active').length;

    const engagement = sumCampaignEngagement(filteredEspCampaigns);

    return {
      accountCount: scopedAccountKeys.length,
      connectedAccounts,
      contactsTotal,
      activeEmails,
      emailCount: filteredEmailsByAccount.length,
      campaignCount: filteredEspCampaigns.length,
      workflowCount: filteredEspWorkflows.length,
      loomiCampaignCount: filteredLoomiEmailCampaigns.length + filteredLoomiSmsCampaigns.length,
      engagement,
    };
  }, [
    scopedAccountKeys,
    contactStats,
    filteredEmailsByAccount,
    filteredEspCampaigns,
    filteredEspWorkflows,
    filteredLoomiEmailCampaigns.length,
    filteredLoomiSmsCampaigns.length,
  ]);


  const welcomeName = userName?.trim() || 'there';
  const focusedAccountData = focusedAccountKey ? accounts[focusedAccountKey] : null;
  const focusedAccountName = focusedAccountKey ? (accountNames[focusedAccountKey] || focusedAccountKey) : '';
  const dashboardTitle = isAccountMode && focusedAccountName
    ? `${toPossessiveLabel(focusedAccountName)} Dashboard`
    : 'Dashboard';
  const dashboardLayoutMode = `management:${role}`;
  const dashboardLayoutScope = isAccountMode && focusedAccountKey ? `account:${focusedAccountKey}` : 'admin';

  const dashboardWidgets = useMemo<DashboardWidgetDefinition[]>(() => {
    const widgets: DashboardWidgetDefinition[] = [
      { id: 'portfolio_kpis', title: 'Portfolio KPIs', category: 'overview', description: 'Accounts, contacts, sends, and engagement at a glance.' },
      { id: 'lifecycle_alerts', title: 'Lifecycle Action Center', category: 'contacts', description: 'Service / lease / warranty windows due to fire.' },
      { id: 'engagement_timeline', title: 'Engagement Timeline', category: 'engagement', description: 'Daily delivered / opens / clicks / bounces across portfolio.' },
      { id: 'account_health', title: 'Account Health', category: 'overview', description: 'Per-account health score with send recency + engagement.' },
      { id: 'anomaly_feed', title: 'Alerts & Anomalies', category: 'operations', description: 'Auto-flagged deliverability + activity problems.' },
      { id: 'send_pipeline', title: 'Send Pipeline', category: 'operations', description: 'Scheduled, in-flight, and recently failed sends.' },
      { id: 'top_campaigns', title: 'Top Campaigns', category: 'campaigns', description: 'Best-performing campaigns in the period.' },
      { id: 'engaged_contacts', title: 'Engaged Contacts', category: 'engagement', description: 'Contacts who opened, clicked, or replied within window.' },
      { id: 'suppression_health', title: 'Suppression Health', category: 'engagement', description: 'Suppression totals + growth reasons.' },
      { id: 'recent_activity', title: 'Recent Activity', category: 'engagement', description: 'Latest campaigns, lists, imports across accounts.' },
      { id: 'meta_pacer', title: 'Meta Ads Pacer', category: 'operations', description: 'Paid media pacing per account this period.' },
      { id: 'contact_analytics', title: 'Contact Insights', category: 'contacts', description: 'Source breakdown, tags, upcoming lifecycle dates.' },
    ];
    if (role === 'super_admin' || role === 'developer') {
      widgets.splice(4, 0, { id: 'rep_performance', title: 'Rep Performance', category: 'overview', description: 'Per-rep portfolio metrics.' });
    }
    return widgets;
  }, [role]);

  const dashboardCustomization = useDashboardCustomization({
    enabled: !loading,
    mode: dashboardLayoutMode,
    scope: dashboardLayoutScope,
    widgets: dashboardWidgets,
  });
  const visibleWidgetIdSet = useMemo(
    () => new Set(dashboardCustomization.visibleWidgetIds),
    [dashboardCustomization.visibleWidgetIds],
  );
  const widgetOrderMap = useMemo(
    () => new Map(dashboardCustomization.visibleWidgetIds.map((widgetId, index) => [widgetId, index])),
    [dashboardCustomization.visibleWidgetIds],
  );

  function widgetOrder(widgetId: string): number {
    return widgetOrderMap.get(widgetId) ?? 999;
  }

  function handleWidgetDrop(targetWidgetId: string) {
    if (!draggedWidgetId) return;
    dashboardCustomization.moveWidget(draggedWidgetId, targetWidgetId);
    setDraggedWidgetId(null);
  }

  function renderManagedWidget(widgetId: string, content: ReactNode) {
    const widget = dashboardCustomization.widgetMap[widgetId];
    if (!widget || !visibleWidgetIdSet.has(widgetId)) return null;

    return (
      <DashboardWidgetFrame
        key={widgetId}
        widget={widget}
        editMode={dashboardCustomization.editMode}
        order={widgetOrder(widgetId)}
        onDragStart={setDraggedWidgetId}
        onDragOver={() => {}}
        onDrop={handleWidgetDrop}
        onHide={dashboardCustomization.hideWidget}
      >
        {content}
      </DashboardWidgetFrame>
    );
  }

  const managementCustomizePanel = (
    <DashboardCustomizePanel
      open={customizePanelOpen}
      onClose={() => {
        setCustomizePanelOpen(false);
        dashboardCustomization.setEditMode(false);
        setDraggedWidgetId(null);
      }}
      widgets={dashboardWidgets}
      hiddenWidgetIds={dashboardCustomization.hiddenWidgetIds}
      toggleWidget={dashboardCustomization.toggleWidget}
      resetLayout={dashboardCustomization.resetLayout}
      saving={dashboardCustomization.saving}
    />
  );

  const filterSidePanel = (
    <div className={`glass-panel glass-panel-strong w-full rounded-2xl flex flex-col overflow-hidden transition-[opacity,transform,max-height] duration-300 ease-out lg:sticky lg:top-24 lg:w-[360px] ${
      filtersPanelOpen
        ? 'pointer-events-auto max-h-[calc(100vh-8rem)] translate-x-0 opacity-100 animate-slide-in-right'
        : 'pointer-events-none max-h-0 translate-x-4 opacity-0'
    }`}>
      <div className="p-5 border-b border-[var(--sidebar-border-soft)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FunnelIcon className="w-5 h-5 text-black dark:text-[var(--primary)]" />
          <h3 className="text-sm font-bold tracking-tight">Filters</h3>
        </div>
        <button
          type="button"
          onClick={() => setFiltersPanelOpen(false)}
          className="p-1.5 rounded-xl text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="themed-scrollbar flex-1 space-y-5 overflow-y-auto p-4">
        {/* Sub-Account */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
              Sub-Account
            </p>
            <span className="text-[10px] text-[var(--sidebar-muted-foreground)] tabular-nums">
              {selectedAccounts.length > 0 ? `${selectedAccounts.length} selected` : `${accountOptions.length} total`}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedAccounts([])}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors ${
                selectedAccounts.length === 0
                  ? 'border-[var(--primary)]/60 bg-[var(--primary)]/14 text-[var(--primary)]'
                  : 'border-[var(--sidebar-border-soft)] text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:border-[var(--primary)]/35 hover:bg-[var(--sidebar-muted)]/70'
              }`}
            >
              All Sub-Accounts
            </button>
            {accountOptions.filter((a) => selectedAccounts.includes(a.key)).map((account) => (
              <button
                key={account.key}
                type="button"
                onClick={() => setSelectedAccounts((prev) => prev.filter((k) => k !== account.key))}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors border-[var(--primary)]/60 bg-[var(--primary)]/14 text-[var(--primary)] group"
              >
                <AccountAvatar
                  name={account.label}
                  accountKey={account.key}
                  storefrontImage={account.storefrontImage}
                  logos={account.logos}
                  size={14}
                  className="w-3.5 h-3.5 rounded-[3px] object-cover flex-shrink-0"
                />
                <span className="truncate max-w-[100px]">{account.label}</span>
                <XMarkIcon className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-muted)]/30 p-2 space-y-2">
              <div className="relative">
                <MagnifyingGlassIcon className="w-3.5 h-3.5 text-[var(--sidebar-muted-foreground)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={accountSearchQuery}
                  onChange={(e) => setAccountSearchQuery(e.target.value)}
                  placeholder="Filter sub-accounts..."
                  className="w-full h-8 rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 pl-8 pr-2 text-[11px] text-[var(--sidebar-foreground)] placeholder:text-[var(--sidebar-muted-foreground)] focus:outline-none focus:border-[var(--primary)]/60 focus:ring-1 focus:ring-[var(--primary)]/30"
                />
              </div>
              <div className="themed-scrollbar space-y-1 max-h-52 overflow-y-auto pr-1">
                {filteredAccountOptions.map((account) => {
                  const selected = selectedAccounts.includes(account.key);
                  const location = [account.city, account.state].filter(Boolean).join(', ');
                  return (
                    <button
                      key={account.key}
                      type="button"
                      onClick={() => toggleAccountFilter(account.key)}
                      className={`w-full px-2 py-1.5 rounded-lg border text-[11px] text-left flex items-center gap-2 transition-colors ${
                        selected
                          ? 'border-[var(--primary)]/45 bg-[var(--primary)]/12 text-[var(--primary)]'
                          : 'border-transparent text-[var(--sidebar-foreground)] hover:border-[var(--sidebar-border-soft)] hover:bg-[var(--sidebar-muted)]/70'
                      }`}
                    >
                      <AccountAvatar
                        name={account.label}
                        accountKey={account.key}
                        storefrontImage={account.storefrontImage}
                        logos={account.logos}
                        size={22}
                        className="w-[22px] h-[22px] rounded-md object-cover flex-shrink-0 border border-[var(--sidebar-border-soft)]"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{account.label}</span>
                        {location && (
                          <span className="block text-[10px] text-[var(--sidebar-muted-foreground)] truncate">
                            {location}
                          </span>
                        )}
                      </span>
                      {selected && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />}
                    </button>
                  );
                })}
                {filteredAccountOptions.length === 0 && (
                  <p className="px-1 py-2 text-[11px] text-[var(--sidebar-muted-foreground)]">
                    No matching sub-accounts.
                  </p>
                )}
              </div>
          </div>
        </section>

        {(isSuperAdmin || isDeveloper) && repScopeOptions.length > 0 ? (
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]">
                Account Reps
              </p>
              <span className="text-[10px] text-[var(--sidebar-muted-foreground)] tabular-nums">
                {selectedRepIds.length > 0 ? `${selectedRepIds.length} selected` : `${repScopeOptions.length} total`}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedRepIds([])}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors ${
                  selectedRepIds.length === 0
                    ? 'border-[var(--primary)]/60 bg-[var(--primary)]/14 text-[var(--primary)]'
                    : 'border-[var(--sidebar-border-soft)] text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:border-[var(--primary)]/35 hover:bg-[var(--sidebar-muted)]/70'
                }`}
              >
                All Reps
              </button>
              {repScopeOptions.filter((r) => selectedRepIds.includes(r.id)).map((rep) => (
                <button
                  key={rep.id}
                  type="button"
                  onClick={() => setSelectedRepIds((prev) => prev.filter((id) => id !== rep.id))}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors border-[var(--primary)]/60 bg-[var(--primary)]/14 text-[var(--primary)] group"
                >
                  <span className="truncate max-w-[100px]">{rep.label}</span>
                  <XMarkIcon className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-muted)]/30 p-2 space-y-1">
                <div className="themed-scrollbar space-y-1 max-h-48 overflow-y-auto pr-1">
                  {repScopeOptions.map((rep) => {
                    const selected = selectedRepIds.includes(rep.id);
                    return (
                      <button
                        key={rep.id}
                        type="button"
                        onClick={() => toggleSuperAdminRepFilter(rep.id)}
                        className={`w-full px-2 py-1.5 rounded-lg border text-[11px] text-left flex items-center justify-between gap-2 transition-colors ${
                          selected
                            ? 'border-[var(--primary)]/45 bg-[var(--primary)]/12 text-[var(--primary)]'
                            : 'border-transparent text-[var(--sidebar-foreground)] hover:border-[var(--sidebar-border-soft)] hover:bg-[var(--sidebar-muted)]/70'
                        }`}
                      >
                        <span className="truncate">{rep.label} ({rep.accountCount})</span>
                        {selected && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
            </div>
          </section>
        ) : null}

        {isSuperAdmin ? (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Quick Filters</h4>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={superAdminPresetName}
                onChange={(event) => setSuperAdminPresetName(event.target.value)}
                placeholder="Name this quick filter"
                className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={saveSuperAdminPreset}
                className="h-9 rounded-lg bg-[var(--primary)] px-3 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                Save
              </button>
            </div>

            {superAdminPresets.length === 0 ? (
              <p className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                No quick filters saved yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {superAdminPresets.map((preset) => (
                  <div key={preset.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{preset.name}</p>
                      <p className="text-[10px] text-[var(--muted-foreground)]">
                        Accounts {preset.accountKeys.length === 0 ? 'all' : preset.accountKeys.length} · Reps {preset.repIds.length === 0 ? 'all' : preset.repIds.length}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => applySuperAdminPreset(preset)}
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] transition-colors hover:bg-[var(--muted)]/30"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSuperAdminPreset(preset.id)}
                        className="rounded-md border border-rose-500/30 px-2 py-1 text-[10px] text-rose-300 transition-colors hover:bg-rose-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--sidebar-border-soft)] px-4 py-3">
        <button
          type="button"
          onClick={clearSuperAdminFilters}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          Reset All
        </button>
        <button
          type="button"
          onClick={() => setFiltersPanelOpen(false)}
          className="px-3 py-2 text-xs rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 text-white hover:bg-[var(--primary)] transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );

  const activeFilterCount = (selectedAccounts.length > 0 ? 1 : 0) + (selectedRepIds.length > 0 ? 1 : 0);

  function toggleAccountFilter(accountKey: string) {
    setSelectedAccounts((prev) =>
      prev.includes(accountKey)
        ? prev.filter((key) => key !== accountKey)
        : [...prev, accountKey],
    );
  }

  function toggleSuperAdminRepFilter(repId: string) {
    setSelectedRepIds((prev) =>
      prev.includes(repId)
        ? prev.filter((id) => id !== repId)
        : [...prev, repId],
    );
  }

  function clearSuperAdminFilters() {
    setSelectedAccounts([]);
    setSelectedRepIds([]);
  }

  function saveSuperAdminPreset() {
    const trimmedName = superAdminPresetName.trim();
    const nextPreset: SuperAdminFilterPreset = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: trimmedName || `Quick Filter ${superAdminPresets.length + 1}`,
      accountKeys: selectedAccounts.filter((key) => Boolean(accounts[key])),
      repIds: selectedRepIds.filter((id) => id === UNASSIGNED_REP_ID || repScopeOptions.some((rep) => rep.id === id)),
      dateRange,
      customRange:
        dateRange === 'custom' && customRange
          ? { start: customRange.start.toISOString(), end: customRange.end.toISOString() }
          : null,
      createdAt: new Date().toISOString(),
    };

    setSuperAdminPresets((prev) => [nextPreset, ...prev].slice(0, 12));
    setSuperAdminPresetName('');
  }

  function applySuperAdminPreset(preset: SuperAdminFilterPreset) {
    setSelectedAccounts(preset.accountKeys.filter((key) => Boolean(accounts[key])));
    setSelectedRepIds(
      preset.repIds.filter((id) => id === UNASSIGNED_REP_ID || repScopeOptions.some((rep) => rep.id === id)),
    );
    setDateRange(preset.dateRange);

    if (preset.dateRange === 'custom' && preset.customRange) {
      const start = new Date(preset.customRange.start);
      const end = new Date(preset.customRange.end);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
        setCustomRange({ start, end });
      } else {
        setCustomRange(null);
      }
    } else {
      setCustomRange(null);
    }
  }

  function deleteSuperAdminPreset(presetId: string) {
    setSuperAdminPresets((prev) => prev.filter((preset) => preset.id !== presetId));
  }

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {(() => {
              if (!isAccountMode || !focusedAccountKey) return null;
              // If a logo exists, render the bare image (no square chrome).
              // Otherwise, fall back to the generated initials avatar in a
              // square — the default AccountAvatar behavior.
              const logoSrc = theme === 'light'
                ? focusedAccountData?.logos?.dark
                : focusedAccountData?.logos?.light;
              if (logoSrc) {
                return (
                  <img
                    src={logoSrc}
                    alt={`${focusedAccountName} logo`}
                    className="h-14 w-auto max-w-[120px] flex-shrink-0 object-contain"
                  />
                );
              }
              return (
                <AccountAvatar
                  name={focusedAccountName}
                  accountKey={focusedAccountKey}
                  storefrontImage={focusedAccountData?.storefrontImage}
                  logos={focusedAccountData?.logos}
                  size={56}
                  className="h-14 w-14 flex-shrink-0 rounded-xl"
                />
              );
            })()}

            <div>
              <h2 className="text-2xl font-bold">{dashboardTitle}</h2>
              <p className="dashboard-welcome mt-0.5 text-sm font-medium text-[var(--foreground)]">Welcome, {welcomeName}!</p>
              {usingMockData ? (
                <p className="mt-1 inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                  Dummy Data Mode
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (dashboardCustomization.editMode) {
                  dashboardCustomization.setEditMode(false);
                  setCustomizePanelOpen(false);
                  setDraggedWidgetId(null);
                  return;
                }
                setFiltersPanelOpen(false);
                setFilterSideRailMounted(false);
                setManagementSideRailMounted(true);
                setCustomizePanelOpen(true);
                dashboardCustomization.setEditMode(true);
              }}
              className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
                dashboardCustomization.editMode
                  ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
              }`}
            >
              <SquaresPlusIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Customize</span>
            </button>
            <DashboardToolbar
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              customRange={customRange}
              onCustomRangeChange={setCustomRange}
              showReset={false}
              triggerSize="header"
            />
            {!isAccountMode && (
              <button
                type="button"
                onClick={() => {
                  if (filtersPanelOpen) {
                    setFiltersPanelOpen(false);
                    return;
                  }
                  dashboardCustomization.setEditMode(false);
                  setCustomizePanelOpen(false);
                  setManagementSideRailMounted(false);
                  setDraggedWidgetId(null);
                  setFiltersPanelOpen(true);
                }}
                className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
                  filtersPanelOpen
                    ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                    : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
                }`}
              >
                <FunnelIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Filters</span>
                {activeFilterCount > 0 ? (
                  <span className="rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                    {activeFilterCount}
                  </span>
                ) : null}
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="glass-card h-28 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : null}

      {!loading ? (
        <div className={(managementSideRailMounted || filterSideRailMounted) ? 'grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start' : ''}>
          <div className="flex flex-col gap-5">
            {renderManagedWidget('portfolio_kpis', (
              <PortfolioKpiStrip
                kpis={portfolioHook.data?.kpis ?? null}
                loading={portfolioHook.isLoading}
              />
            ))}

            {renderManagedWidget('lifecycle_alerts', (
              <LifecycleActionCenter
                lifecycle={portfolioHook.data?.lifecycle ?? null}
                loading={portfolioHook.isLoading}
                singleAccount={isAccountMode}
              />
            ))}

            {renderManagedWidget('engagement_timeline', (
              <EngagementTimelineWidget
                timeline={portfolioHook.data?.timeline ?? []}
                loading={portfolioHook.isLoading}
                isDark={theme === 'dark'}
              />
            ))}

            {renderManagedWidget('account_health', (
              <AccountHealthScoredGrid
                rows={portfolioHook.data?.accountHealth ?? []}
                accounts={accounts}
                loading={portfolioHook.isLoading}
              />
            ))}

            {(isSuperAdmin || isDeveloper) && renderManagedWidget('rep_performance', (
              <RepPerformanceWidget
                rows={portfolioHook.data?.repPerformance ?? []}
                loading={portfolioHook.isLoading}
              />
            ))}

            {renderManagedWidget('anomaly_feed', (
              <AnomalyFeedWidget
                anomalies={portfolioHook.data?.anomalies ?? []}
                loading={portfolioHook.isLoading}
              />
            ))}

            {renderManagedWidget('send_pipeline', (
              <SendPipelineWidget
                pipeline={portfolioHook.data?.pipeline ?? { scheduled: [], inFlight: [], recentlyFailed: [] }}
                loading={portfolioHook.isLoading}
              />
            ))}

            {renderManagedWidget('top_campaigns', (
              <TopCampaignsWidget
                campaigns={portfolioHook.data?.topCampaigns ?? []}
                loading={portfolioHook.isLoading}
              />
            ))}

            {renderManagedWidget('engaged_contacts', (
              <EngagedContactsWidget
                data={portfolioHook.data?.engagedContacts ?? { windowDays: 90, engagedTotal: 0, engagedByAccount: [] }}
                totalContacts={portfolioHook.data?.kpis?.contactsTotal ?? 0}
                loading={portfolioHook.isLoading}
                singleAccount={isAccountMode}
              />
            ))}

            {renderManagedWidget('suppression_health', (
              <SuppressionHealthWidget
                data={portfolioHook.data?.suppression ?? null}
                loading={portfolioHook.isLoading}
              />
            ))}

            {renderManagedWidget('meta_pacer', (
              <MetaPacerSummaryWidget
                rows={portfolioHook.data?.metaPacer ?? []}
                loading={portfolioHook.isLoading}
              />
            ))}

            {renderManagedWidget('recent_activity', (
              <RecentActivityWidget
                activity={portfolioHook.data?.activity ?? []}
                loading={portfolioHook.isLoading}
              />
            ))}

            {renderManagedWidget('contact_analytics', (
              <div className="glass-card rounded-2xl p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold tracking-tight">Contact insights</h3>
                  <Link href="/contacts" className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                    Open contacts →
                  </Link>
                </div>
                <ContactAnalytics
                  contacts={filteredContacts}
                  totalCount={totals.contactsTotal}
                  loading={loading || contactsAggregateLoading}
                  dateRange={dateRange}
                  customRange={customRange}
                />
              </div>
            ))}
          </div>
          {filterSideRailMounted ? filterSidePanel : managementSideRailMounted ? managementCustomizePanel : null}
        </div>
      ) : null}
    </div>
  );
}

function ClientRoleDashboard({
  accountKey,
  accountData,
  userName,
}: {
  accountKey: string | null;
  accountData: AccountData | null;
  userName: string | null;
}) {
  const subHref = useSubaccountHref();
  const [loading, setLoading] = useState(true);
  const [dateRange] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange] = useState<CustomDateRange | null>(null);

  const [espCampaigns, setEspCampaigns] = useState<EspCampaign[]>([]);
  const [loomiEmailCampaigns, setLoomiEmailCampaigns] = useState<LoomiEmailCampaign[]>([]);
  const [loomiSmsCampaigns, setLoomiSmsCampaigns] = useState<LoomiSmsCampaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [usingMockData, setUsingMockData] = useState(false);
  const { theme } = useTheme();
  const clientChartTextColor = theme === 'dark' ? '#cbd5e1' : '#334155';
  const clientChartMutedColor = theme === 'dark' ? '#94a3b8' : '#64748b';
  const clientChartGridColor = theme === 'dark' ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.24)';
  const clientChartStrokeColor = theme === 'dark' ? 'rgba(16,15,35,0.95)' : 'rgba(248,250,252,0.96)';
  const clientChartTooltipTheme: 'dark' | 'light' = theme === 'dark' ? 'dark' : 'light';
  const clientPanelClass = theme === 'dark'
    ? 'rounded-2xl border border-white/10 bg-[linear-gradient(155deg,rgba(24,24,43,0.86),rgba(31,18,42,0.82))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
    : 'rounded-2xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.44),rgba(237,243,255,0.38))] backdrop-blur-xl p-5 shadow-[0_8px_20px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]';
  const clientHeadingClass = theme === 'dark' ? 'text-white' : 'text-slate-900';
  const clientSubtleClass = theme === 'dark' ? 'text-violet-100/70' : 'text-slate-500';
  const [customizePanelOpen, setCustomizePanelOpen] = useState(false);
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const [clientSideRailMounted, setClientSideRailMounted] = useState(false);

  useEffect(() => {
    if (customizePanelOpen) {
      setClientSideRailMounted(true);
      return;
    }

    const timer = window.setTimeout(() => setClientSideRailMounted(false), 260);
    return () => window.clearTimeout(timer);
  }, [customizePanelOpen]);

  useEffect(() => {
    if (!accountKey) {
      setLoading(false);
      return;
    }
    const targetAccountKey = accountKey;

    let cancelled = false;

    async function loadClientData() {
      setLoading(true);
      setError(null);

      if (DASHBOARD_DUMMY_MODE) {
        const mockAccounts: Record<string, AccountData> = {
          [targetAccountKey]: accountData || ({ dealer: 'Demo Account' } as AccountData),
        };
        const mock = buildMockManagementDataset(mockAccounts);
        if (cancelled) return;
        setEspCampaigns(mock.espCampaigns.filter((campaign) => campaign.accountKey === targetAccountKey));
        setLoomiEmailCampaigns(mock.loomiEmailCampaigns.filter((campaign) => campaign.accountKeys.includes(targetAccountKey)));
        setLoomiSmsCampaigns(mock.loomiSmsCampaigns.filter((campaign) => campaign.accountKeys.includes(targetAccountKey)));
        setUsingMockData(true);
        setLoading(false);
        return;
      }

      // ESP-fetched campaigns are gone — only Loomi-native email + SMS
      // campaigns feed the per-account dashboard now.
      const [loomiEmailRes, loomiSmsRes] = await Promise.all([
        loadJson('/api/campaigns/email?limit=50'),
        loadJson('/api/campaigns/sms?limit=50'),
      ]);

      if (cancelled) return;

      setEspCampaigns([]);

      if (loomiEmailRes.ok) {
        const allRows = asArray<LoomiEmailCampaign>((loomiEmailRes.json as Record<string, unknown>).campaigns);
        setLoomiEmailCampaigns(allRows.filter((campaign) => asArray<string>(campaign.accountKeys).includes(targetAccountKey)));
      } else {
        setLoomiEmailCampaigns([]);
      }

      if (loomiSmsRes.ok) {
        const allRows = asArray<LoomiSmsCampaign>((loomiSmsRes.json as Record<string, unknown>).campaigns);
        setLoomiSmsCampaigns(allRows.filter((campaign) => asArray<string>(campaign.accountKeys).includes(targetAccountKey)));
      } else {
        setLoomiSmsCampaigns([]);
      }

      setUsingMockData(false);
      setLoading(false);
    }

    loadClientData();

    return () => {
      cancelled = true;
    };
  }, [accountKey, accountData]);

  useEffect(() => {
    setCustomizePanelOpen(false);
    setDraggedWidgetId(null);
    setClientSideRailMounted(false);
    clientCustomization.setEditMode(false);
  }, [accountKey]);

  const bounds = useMemo(
    () =>
      dateRange === 'custom' && customRange
        ? getDateRangeBounds('custom', customRange.start, customRange.end)
        : getDateRangeBounds(dateRange),
    [dateRange, customRange],
  );

  const filteredEspCampaigns = useMemo(
    () =>
      espCampaigns.filter((campaign) => {
        const dateValue = firstCampaignDate(campaign);
        return inBounds(dateValue, bounds);
      }),
    [espCampaigns, bounds],
  );

  const filteredLoomiEmailCampaigns = useMemo(
    () => loomiEmailCampaigns.filter((campaign) => inBounds(campaign.updatedAt || campaign.createdAt, bounds)),
    [loomiEmailCampaigns, bounds],
  );

  const filteredLoomiSmsCampaigns = useMemo(
    () => loomiSmsCampaigns.filter((campaign) => inBounds(campaign.updatedAt || campaign.createdAt, bounds)),
    [loomiSmsCampaigns, bounds],
  );

  const clientEngagement = useMemo(() => sumCampaignEngagement(filteredEspCampaigns), [filteredEspCampaigns]);

  const scheduledEsp = filteredEspCampaigns.filter((campaign) => {
    const status = normalizeStatus(campaign.status);
    return status.includes('sched') || status.includes('active') || status.includes('queue') || status.includes('progress');
  }).length;

  const sentEsp = filteredEspCampaigns.filter((campaign) => {
    const status = normalizeStatus(campaign.status);
    return status.includes('sent') || status.includes('deliver') || status.includes('complete') || status.includes('finish');
  }).length;

  const otherEsp = Math.max(0, filteredEspCampaigns.length - scheduledEsp - sentEsp);
  const clientOpenRatePct = Math.max(0, Math.min(100, Math.round((clientEngagement.openRate || 0) * 100)));
  const clientClickRatePct = Math.max(0, Math.min(100, Math.round((clientEngagement.clickRate || 0) * 100)));

  const clientStatusMix = useMemo(
    () => [
      { label: 'Scheduled', value: scheduledEsp },
      { label: 'Sent / Complete', value: sentEsp },
      { label: 'Other', value: otherEsp },
    ],
    [scheduledEsp, sentEsp, otherEsp],
  );

  const clientChannelMix = useMemo(
    () => [
      { label: 'ESP Campaigns', value: filteredEspCampaigns.length },
      { label: 'Loomi Email', value: filteredLoomiEmailCampaigns.length },
      { label: 'Loomi SMS', value: filteredLoomiSmsCampaigns.length },
    ],
    [filteredEspCampaigns.length, filteredLoomiEmailCampaigns.length, filteredLoomiSmsCampaigns.length],
  );
  const clientStatusMixLabels = useMemo(
    () => clientStatusMix.map((row) => row.label),
    [clientStatusMix],
  );
  const clientStatusMixSeries = useMemo(
    () => clientStatusMix.map((row) => row.value),
    [clientStatusMix],
  );
  const clientChannelCategories = useMemo(
    () => clientChannelMix.map((row) => row.label),
    [clientChannelMix],
  );
  const clientChannelSeries = useMemo(
    () => [{ name: 'Volume', data: clientChannelMix.map((row) => row.value) }],
    [clientChannelMix],
  );
  const clientBarGrid = useMemo(
    () => ({ borderColor: clientChartGridColor, strokeDashArray: 4 }),
    [clientChartGridColor],
  );
  const clientGaugeSeries = [clientOpenRatePct, clientClickRatePct];

  const clientGaugeOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: 'radialBar', background: 'transparent', toolbar: { show: false }, foreColor: clientChartTextColor },
      labels: ['Open Rate', 'Click Rate'],
      colors: ['#22d3ee', '#a78bfa'],
      plotOptions: {
        radialBar: {
          hollow: { size: '34%' },
          track: { background: clientChartGridColor },
          dataLabels: {
            name: { fontSize: '10px', color: clientChartMutedColor },
            value: { fontSize: '12px', color: clientChartTextColor },
            total: {
              show: true,
              label: 'Delivery',
              color: clientChartTextColor,
              formatter: () => `${Math.round((clientOpenRatePct + clientClickRatePct) / 2)}%`,
            },
          },
        },
      },
      legend: { show: true, position: 'bottom', labels: { colors: clientChartTextColor }, fontSize: '11px' },
      tooltip: { theme: clientChartTooltipTheme },
      noData: { text: 'No delivery data', style: { color: clientChartMutedColor } },
    }),
    [
      clientChartGridColor,
      clientChartMutedColor,
      clientChartTextColor,
      clientChartTooltipTheme,
      clientClickRatePct,
      clientOpenRatePct,
    ],
  );

  const clientStatusMixOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: 'donut', background: 'transparent', toolbar: { show: false }, foreColor: clientChartTextColor },
      labels: clientStatusMixLabels,
      colors: ['#3b82f6', '#60a5fa', '#93c5fd'],
      dataLabels: { enabled: false },
      stroke: { width: 2, colors: [clientChartStrokeColor] },
      legend: { show: true, position: 'bottom', labels: { colors: clientChartTextColor }, fontSize: '11px' },
      plotOptions: { pie: { donut: { size: '70%' } } },
      tooltip: { theme: clientChartTooltipTheme },
      noData: { text: 'No status mix', style: { color: clientChartMutedColor } },
    }),
    [
      clientChartMutedColor,
      clientChartStrokeColor,
      clientChartTextColor,
      clientChartTooltipTheme,
      clientStatusMixLabels,
    ],
  );

  const clientChannelOptions = useMemo<ApexOptions>(
    () => ({
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, foreColor: clientChartTextColor },
      colors: clientChannelCategories.map((label) => iconColorHexForLabel(label)),
      plotOptions: { bar: { horizontal: true, borderRadius: 6, barHeight: '58%', distributed: true } },
      dataLabels: { enabled: false },
      legend: { show: false },
      xaxis: { categories: clientChannelCategories, labels: { style: { colors: clientChartMutedColor } } },
      yaxis: { labels: { style: { colors: clientChartTextColor } } },
      grid: clientBarGrid,
      tooltip: { theme: clientChartTooltipTheme },
      noData: { text: 'No channel output', style: { color: clientChartMutedColor } },
    }),
    [
      clientBarGrid,
      clientChannelCategories,
      clientChartMutedColor,
      clientChartTextColor,
      clientChartTooltipTheme,
    ],
  );

  const clientDashboardWidgets = useMemo<DashboardWidgetDefinition[]>(
    () => [
      { id: 'client_overview', title: 'Overview', category: 'overview' },
      { id: 'client_campaigns', title: 'Campaign Performance', category: 'campaigns' },
      { id: 'client_recent', title: 'Recent Activity', category: 'engagement' },
    ],
    [],
  );
  const clientDashboardScope = accountKey ? `account:${accountKey}` : 'account:none';
  const clientCustomization = useDashboardCustomization({
    enabled: !loading,
    mode: 'client:analytics',
    scope: clientDashboardScope,
    widgets: clientDashboardWidgets,
  });
  const clientVisibleWidgetSet = useMemo(
    () => new Set(clientCustomization.visibleWidgetIds),
    [clientCustomization.visibleWidgetIds],
  );
  const clientWidgetOrderMap = useMemo(
    () => new Map(clientCustomization.visibleWidgetIds.map((widgetId, index) => [widgetId, index])),
    [clientCustomization.visibleWidgetIds],
  );

  function clientWidgetOrder(widgetId: string): number {
    return clientWidgetOrderMap.get(widgetId) ?? 999;
  }

  function handleClientWidgetDrop(targetWidgetId: string) {
    if (!draggedWidgetId) return;
    clientCustomization.moveWidget(draggedWidgetId, targetWidgetId);
    setDraggedWidgetId(null);
  }

  function renderClientWidget(widgetId: string, content: ReactNode) {
    const widget = clientCustomization.widgetMap[widgetId];
    if (!widget || !clientVisibleWidgetSet.has(widgetId)) return null;

    return (
      <DashboardWidgetFrame
        key={widgetId}
        widget={widget}
        editMode={clientCustomization.editMode}
        order={clientWidgetOrder(widgetId)}
        onDragStart={setDraggedWidgetId}
        onDragOver={() => {}}
        onDrop={handleClientWidgetDrop}
        onHide={clientCustomization.hideWidget}
      >
        {content}
      </DashboardWidgetFrame>
    );
  }

  const clientCustomizePanel = (
    <DashboardCustomizePanel
      open={customizePanelOpen}
      onClose={() => {
        setCustomizePanelOpen(false);
        clientCustomization.setEditMode(false);
        setDraggedWidgetId(null);
      }}
      widgets={clientDashboardWidgets}
      hiddenWidgetIds={clientCustomization.hiddenWidgetIds}
      toggleWidget={clientCustomization.toggleWidget}
      resetLayout={clientCustomization.resetLayout}
      saving={clientCustomization.saving}
    />
  );

  const recentActivity = useMemo(() => {
    type Row = {
      id: string;
      source: 'esp' | 'email' | 'sms';
      title: string;
      status: string;
      date: string;
      detail: string;
    };

    const espRows: Row[] = filteredEspCampaigns.map((campaign) => ({
      id: `esp-${campaign.id}`,
      source: 'esp',
      title: campaign.name,
      status: campaign.status,
      date: firstCampaignDate(campaign) || campaign.updatedAt || campaign.createdAt || '',
      detail: campaign.sentCount
        ? `${campaign.sentCount.toLocaleString()} sent`
        : 'ESP campaign',
    }));

    const emailRows: Row[] = filteredLoomiEmailCampaigns.map((campaign) => ({
      id: `email-${campaign.id}`,
      source: 'email',
      title: campaign.name || campaign.subject || 'Email Campaign',
      status: campaign.status,
      date: campaign.updatedAt || campaign.createdAt,
      detail: `${asNumber(campaign.sentCount)} sent · ${asNumber(campaign.failedCount)} failed`,
    }));

    const smsRows: Row[] = filteredLoomiSmsCampaigns.map((campaign) => ({
      id: `sms-${campaign.id}`,
      source: 'sms',
      title: campaign.name || 'SMS Campaign',
      status: campaign.status,
      date: campaign.updatedAt || campaign.createdAt,
      detail: `${asNumber(campaign.sentCount)} sent · ${asNumber(campaign.failedCount)} failed`,
    }));

    return [...espRows, ...emailRows, ...smsRows]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 12);
  }, [filteredEspCampaigns, filteredLoomiEmailCampaigns, filteredLoomiSmsCampaigns]);

  if (!accountKey || !accountData) {
    return (
      <div className="glass-card rounded-xl p-6">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">No account context is available for this user.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">Dashboard</h2>
            <p className="dashboard-welcome mt-0.5 text-sm font-medium text-[var(--foreground)]">Welcome, {userName?.trim() || 'there'}!</p>
            {usingMockData ? (
              <p className="mt-1 inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                Dummy Data Mode
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (clientCustomization.editMode) {
                  clientCustomization.setEditMode(false);
                  setCustomizePanelOpen(false);
                  setDraggedWidgetId(null);
                  return;
                }
                setClientSideRailMounted(true);
                setCustomizePanelOpen(true);
                clientCustomization.setEditMode(true);
              }}
              className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
                clientCustomization.editMode
                  ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
              }`}
            >
              <SquaresPlusIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Customize</span>
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="glass-card h-28 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : (
        <div className={clientSideRailMounted ? 'grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start' : ''}>
          <div className="flex flex-col gap-8">
            {error ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
                {error}
              </div>
            ) : null}

            {renderClientWidget('client_overview', (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard label="Campaigns" value={filteredEspCampaigns.length} icon={PaperAirplaneIcon} href={subHref('/messaging/campaigns')} />
                <StatCard label="Scheduled" value={scheduledEsp} icon={ArrowPathIcon} href={subHref('/messaging/campaigns/schedule')} />
                <StatCard label="Sent / Completed" value={sentEsp} icon={CheckCircleIcon} href={subHref('/messaging/campaigns')} />
                <StatCard label="Loomi Email" value={filteredLoomiEmailCampaigns.length} icon={BookOpenIcon} href={subHref('/messaging/campaigns')} />
                <StatCard
                  label="Loomi SMS"
                  value={filteredLoomiSmsCampaigns.length}
                  sub={`OR ${formatRatePct(clientEngagement.openRate)}`}
                  icon={ChartBarIcon}
                  href={subHref('/messaging/campaigns')}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className={clientPanelClass}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className={`text-sm font-semibold ${clientHeadingClass}`}>Delivery Pulse</h3>
                    <span className={`text-[10px] uppercase tracking-wider ${clientSubtleClass}`}>open + click</span>
                  </div>
                  <ApexChart type="radialBar" options={clientGaugeOptions} series={clientGaugeSeries} height={265} />
                </div>

                <div className={clientPanelClass}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className={`text-sm font-semibold ${clientHeadingClass}`}>Campaign Status Mix</h3>
                    <span className={`text-[10px] uppercase tracking-wider ${clientSubtleClass}`}>date range</span>
                  </div>
                  <ApexChart type="donut" options={clientStatusMixOptions} series={clientStatusMixSeries} height={265} />
                </div>

                <div className={clientPanelClass}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className={`text-sm font-semibold ${clientHeadingClass}`}>Channel Output</h3>
                    <span className={`text-[10px] uppercase tracking-wider ${clientSubtleClass}`}>by campaign type</span>
                  </div>
                  <ApexChart type="bar" options={clientChannelOptions} series={clientChannelSeries} height={265} />
                </div>
              </div>
            </div>
          ))}

          {renderClientWidget('client_campaigns', (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">ESP Campaign Performance</h3>
                <Link href={subHref('/messaging/campaigns')} className="text-[10px] text-[var(--primary)] hover:underline">
                  Open campaign center
                </Link>
              </div>
              <CampaignPageAnalytics
                campaigns={filteredEspCampaigns}
                loading={loading}
                showAccountBreakdown={false}
                emptyTitle="No ESP campaign activity for this date range"
                emptySubtitle="Try a wider date range or publish a campaign from your campaign center."
              />
            </div>
          ))}

          {renderClientWidget('client_recent', (
            <div className="glass-card rounded-xl p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Recent Campaign Activity</h3>
                <span className="text-[10px] text-[var(--muted-foreground)]">{recentActivity.length} items</span>
              </div>

              {recentActivity.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">No campaign events in this date range.</p>
              ) : (
                <div className="space-y-2">
                  {recentActivity.map((activity) => (
                    <div key={activity.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                          activity.source === 'esp'
                            ? 'bg-blue-500/10 text-blue-300'
                            : activity.source === 'email'
                                ? 'bg-cyan-500/10 text-cyan-300'
                                : 'bg-emerald-500/10 text-emerald-300'
                        }`}
                      >
                        {activity.source}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{activity.title}</p>
                        <p className="text-[10px] text-[var(--muted-foreground)]">{activity.detail}</p>
                      </div>
                      <div className="text-right text-[10px] text-[var(--muted-foreground)]">
                        <p>{campaignStatusLabel(activity.status)}</p>
                        <p>{relativeTime(activity.date)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          </div>
          {clientSideRailMounted ? clientCustomizePanel : null}
        </div>
      )}
    </div>
  );
}
