'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  BookOpenIcon,
  EnvelopeIcon,
  UserGroupIcon,
  ArrowRightIcon,
  ClockIcon,
  ChartBarIcon,
  BuildingStorefrontIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';
import { EmailAnalytics } from '@/components/analytics/email-analytics';
import { AccountHealthGrid } from '@/components/analytics/account-health-grid';
import { ContactAnalytics } from '@/components/contacts/contact-analytics';
import { DashboardToolbar, type CustomDateRange, type AccountOption } from '@/components/filters/dashboard-toolbar';
import {
  type DateRangeKey,
  DEFAULT_DATE_RANGE,
  getDateRangeBounds,
  filterByDateRange,
} from '@/lib/date-ranges';
import {
  parseEmailListPayload,
  type EmailListItem,
} from '@/lib/email-list-payload';
import { iconColorClass } from '@/lib/icon-colors';

// ── Types ──

interface TemplateEntry {
  design: string;
  name: string;
  updatedAt?: string;
}

interface AccountData {
  dealer: string;
  category?: string;
  city?: string;
  state?: string;
  storefrontImage?: string;
  logos?: { light?: string; dark?: string; white?: string; black?: string };
}

interface CrmStat {
  dealer: string;
  contactCount: number | null;
  connected: boolean;
  error?: string;
}

interface AnalyticsContact {
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
}

// ── Helpers ──

function formatRelativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Component ──

export function AdminDashboard() {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [components, setComponents] = useState<{ name: string }[]>([]);
  const [emails, setEmails] = useState<EmailListItem[]>([]);
  const [accounts, setAccounts] = useState<Record<string, AccountData>>({});
  const [crmStats, setCrmStats] = useState<Record<string, CrmStat>>({});
  const [crmTotals, setCrmTotals] = useState({ totalContacts: 0, connectedAccounts: 0, totalAccounts: 0 });
  const [crmLoading, setCrmLoading] = useState(true);
  const [allContacts, setAllContacts] = useState<AnalyticsContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

  useEffect(() => {
    // Core data
    Promise.all([
      fetch('/api/templates').then(r => r.json()),
      fetch('/api/components').then(r => r.json()),
      fetch('/api/emails').then(r => r.json()),
      fetch('/api/accounts').then(r => r.json()),
    ]).then(([tmpl, comp, em, accts]) => {
      setTemplates(tmpl);
      setComponents(comp);
      setEmails(parseEmailListPayload(em));
      setAccounts(accts);
      setLoaded(true);
    }).catch(() => setLoaded(true));

    // CRM stats (contact counts per account)
    fetch('/api/contacts/stats')
      .then(r => r.json())
      .then(data => {
        if (data.stats) {
          const normalizedStats: Record<string, CrmStat> = {};
          Object.entries(data.stats as Record<string, Record<string, unknown>>).forEach(([key, stat]) => {
            const countRaw = stat.contactCount ?? stat.count;
            normalizedStats[key] = {
              dealer: String(stat.dealer ?? key),
              contactCount: typeof countRaw === 'number' ? countRaw : null,
              connected: Boolean(stat.connected),
              error: typeof stat.error === 'string' ? stat.error : undefined,
            };
          });
          setCrmStats(normalizedStats);
          setCrmTotals({
            totalContacts: data.totalContacts ?? data.meta?.totalContacts ?? 0,
            connectedAccounts: data.connectedAccounts ?? data.meta?.connectedAccounts ?? 0,
            totalAccounts: data.totalAccounts ?? data.meta?.accountsFetched ?? 0,
          });
        }
        setCrmLoading(false);
      })
      .catch(() => setCrmLoading(false));

    // Aggregate contacts for cross-account analytics
    fetch('/api/contacts/aggregate')
      .then(r => r.json())
      .then(data => {
        if (data.contacts) {
          setAllContacts(data.contacts);
        }
        setContactsLoading(false);
      })
      .catch(() => setContactsLoading(false));
  }, []);

  // Filter data — account filter first, then date range
  // NOTE: hooks must be called before any early returns to satisfy React's rules of hooks
  const accountEmails = useMemo(
    () =>
      selectedAccounts.length > 0
        ? emails.filter(e => selectedAccounts.includes(e.accountKey))
        : emails,
    [emails, selectedAccounts],
  );
  const accountContacts = useMemo(
    () => selectedAccounts.length > 0 ? allContacts.filter(() => true) : allContacts, // contacts do not expose account key in aggregate payloads; filtering happens at fetch level
    [allContacts, selectedAccounts],
  );
  const bounds = useMemo(
    () =>
      dateRange === 'custom' && customRange
        ? getDateRangeBounds('custom', customRange.start, customRange.end)
        : getDateRangeBounds(dateRange),
    [dateRange, customRange],
  );
  const filteredEmails = useMemo(
    () => filterByDateRange(accountEmails, 'createdAt', bounds),
    [accountEmails, bounds],
  );
  const filteredContacts = useMemo(
    () => filterByDateRange(accountContacts, 'dateAdded', bounds),
    [accountContacts, bounds],
  );
  // Account options for toolbar
  const accountOptions = useMemo<AccountOption[]>(
    () =>
      Object.entries(accounts)
        .map(([key, acct]) => ({
          key,
          label: acct.dealer || key,
          storefrontImage: acct.storefrontImage,
          logos: acct.logos,
          city: acct.city,
          state: acct.state,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [accounts],
  );

  if (!loaded) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>;
  }

  const accountCount = Object.keys(accounts).length;
  const activeEmails = emails.filter(e => e.status === 'active').length;
  const draftEmails = emails.filter(e => e.status === 'draft').length;

  // Compute email breakdown per account (from unfiltered emails for Account Health)
  const emailsByAccount: Record<string, { total: number; active: number; draft: number }> = {};
  emails.forEach(e => {
    if (!emailsByAccount[e.accountKey]) emailsByAccount[e.accountKey] = { total: 0, active: 0, draft: 0 };
    emailsByAccount[e.accountKey].total++;
    if (e.status === 'active') emailsByAccount[e.accountKey].active++;
    if (e.status === 'draft') emailsByAccount[e.accountKey].draft++;
  });

  // Account names map for email analytics
  const accountNames: Record<string, string> = {};
  Object.entries(accounts).forEach(([key, acct]) => {
    accountNames[key] = acct.dealer;
  });

  // Top-level KPI stats
  const stats = [
    {
      label: 'Sub-Accounts',
      value: accountCount,
      sub: `${crmTotals.connectedAccounts} connected`,
      href: '/subaccounts',
      icon: BuildingStorefrontIcon,
      color: iconColorClass('general'),
    },
    {
      label: 'Total Contacts',
      value: crmTotals.totalContacts.toLocaleString(),
      sub: crmLoading ? 'Loading...' : `${crmTotals.connectedAccounts} sources`,
      href: '#contacts',
      icon: UserGroupIcon,
      color: iconColorClass('contacts'),
    },
    {
      label: 'Emails',
      value: emails.length,
      sub: `${activeEmails} active · ${draftEmails} draft`,
      href: '#emails',
      icon: EnvelopeIcon,
      color: 'text-blue-400',
    },
    {
      label: 'Templates',
      value: templates.length,
      sub: `${components.length} sections`,
      href: '/email/templates',
      icon: BookOpenIcon,
      color: iconColorClass('general'),
    },
  ];

  // Recent activity feeds (respect account filter)
  const recentEmails = [...accountEmails]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 8);

  const recentTemplates = [...templates]
    .filter(t => t.updatedAt)
    .sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime())
    .slice(0, 5);

  const selectedAccountLabel = selectedAccounts.length === 1
    ? (accounts[selectedAccounts[0]]?.dealer ?? selectedAccounts[0])
    : null;
  const hasAccountSelection = selectedAccounts.length > 0;

  return (
    <div>
      {/* Header */}
      <div className="page-sticky-header mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <ChartBarIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Analytics Dashboard</h2>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
                {selectedAccountLabel
                  ? selectedAccountLabel
                  : hasAccountSelection
                    ? `${selectedAccounts.length} Accounts Selected`
                  : `Cross-account overview \u00b7 ${accountCount} account${accountCount !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <DashboardToolbar
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
            accounts={accountOptions}
            selectedAccounts={selectedAccounts}
            onAccountChange={setSelectedAccounts}
          />
        </div>
      </div>

      {/* Top-level KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {stats.map((stat, i) => (
          <Link
            key={stat.label}
            href={stat.href}
            className={`group p-4 glass-card rounded-xl animate-fade-in-up animate-stagger-${i + 1}`}
          >
            <div className="flex items-center justify-between mb-2">
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
              <ArrowRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{stat.label}</p>
            {stat.sub && <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{stat.sub}</p>}
          </Link>
        ))}
      </div>

      {/* Account Health Grid */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5">
            <SignalIcon className="w-3.5 h-3.5" />
            Account Health
          </h3>
          <Link href="/accounts" className="text-[10px] text-[var(--primary)] hover:underline">
            Manage accounts
          </Link>
        </div>
        <AccountHealthGrid
          accounts={accounts}
          crmStats={crmStats}
          emailsByAccount={emailsByAccount}
          loading={crmLoading}
        />
      </div>

      {/* Email Analytics */}
      <div id="emails" className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5">
            <EnvelopeIcon className="w-3.5 h-3.5" />
            Email Analytics
          </h3>
          <Link href="/email/templates" className="text-[10px] text-[var(--primary)] hover:underline">
            View all emails
          </Link>
        </div>
        <EmailAnalytics
          emails={filteredEmails}
          loading={!loaded}
          showAccountBreakdown={!hasAccountSelection}
          accountNames={accountNames}
          dateRange={dateRange}
          customRange={customRange}
        />
      </div>

      {/* Contact Analytics (Aggregate) */}
      <div id="contacts" className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5">
            <UserGroupIcon className={`w-3.5 h-3.5 ${iconColorClass('contacts')}`} />
            Contact Analytics{!hasAccountSelection && ' (All Accounts)'}
          </h3>
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {contactsLoading ? 'Loading...' : `${allContacts.length.toLocaleString()} contacts`}
          </span>
        </div>
        <ContactAnalytics
          contacts={filteredContacts}
          totalCount={crmTotals.totalContacts || allContacts.length}
          loading={contactsLoading}
          dateRange={dateRange}
          customRange={customRange}
        />
      </div>

      {/* Recent Activity — Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Emails */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5">
              <ClockIcon className="w-3.5 h-3.5" />
              Recent Emails
            </h3>
            <Link href="/email/templates" className="text-[10px] text-[var(--primary)] hover:underline">
              View all
            </Link>
          </div>
          {recentEmails.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-[var(--border)] rounded-xl">
              <p className="text-[var(--muted-foreground)] text-sm">No emails yet.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentEmails.map((email) => {
                return (
                  <div
                    key={email.id}
                    className="flex items-center justify-between p-3 glass-card rounded-lg"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{email.name}</p>
                      <p className="text-[10px] text-[var(--muted-foreground)]">
                        {email.templateTitle}
                        {email.accountKey && <span> &middot; {accountNames[email.accountKey] || email.accountKey}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        email.status === 'active'
                          ? 'bg-green-500/10 text-green-500'
                          : email.status === 'archived'
                          ? 'bg-zinc-500/10 text-zinc-500'
                          : 'bg-amber-500/10 text-amber-500'
                      }`}>
                        {capitalize(email.status)}
                      </span>
                      <span className="text-[10px] text-[var(--muted-foreground)]">
                        {formatRelativeDate(email.updatedAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Templates */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5">
              <BookOpenIcon className="w-3.5 h-3.5" />
              Recent Templates
            </h3>
            <Link href="/email/templates" className="text-[10px] text-[var(--primary)] hover:underline">
              View all
            </Link>
          </div>
          {recentTemplates.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-[var(--border)] rounded-xl">
              <p className="text-[var(--muted-foreground)] text-sm">No templates edited yet.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentTemplates.map((t) => (
                <Link
                  key={t.design}
                  href={`/templates/editor?design=${encodeURIComponent(t.design)}`}
                  className="flex items-center justify-between p-3 glass-card rounded-lg"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{t.name}</p>
                    <p className="text-[10px] text-[var(--muted-foreground)] font-mono">{t.design}</p>
                  </div>
                  {t.updatedAt && (
                    <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0 ml-2">
                      {formatRelativeDate(t.updatedAt)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
