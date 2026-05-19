'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useAccount } from '@/contexts/account-context';
import {
  EnvelopeIcon,
  BookOpenIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  UserGroupIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline';
import { FlowIcon } from '@/components/icon-map';
import { ContactAnalytics } from '@/components/contacts/contact-analytics';
import { ContactListCompact } from '@/components/contacts/contact-list-compact';
import { EmailAnalytics } from '@/components/analytics/email-analytics';
import { CampaignAnalytics } from '@/components/campaigns/campaign-analytics';
import { FlowAnalytics } from '@/components/flows/flow-analytics';
import { DashboardToolbar, type CustomDateRange } from '@/components/filters/dashboard-toolbar';
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
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

interface TemplateEntry {
  design: string;
  name: string;
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

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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

export function AccountDashboard() {
  const { accountKey, accountData } = useAccount();
  const href = useSubaccountHref();
  const [emails, setEmails] = useState<EmailListItem[]>([]);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [allContacts, setAllContacts] = useState<AnalyticsContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [espCampaigns, setEspCampaigns] = useState<{ id: string; name: string; status: string }[]>([]);
  const [espWorkflows, setEspWorkflows] = useState<{ id: string; name: string; status: string }[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);

  useEffect(() => {
    if (!accountKey) return;
    Promise.all([
      fetch(`/api/emails?accountKey=${accountKey}`).then(r => r.json()),
      fetch('/api/templates').then(r => r.ok ? r.json() : []),
    ]).then(([em, tmpl]) => {
      setEmails(parseEmailListPayload(em));
      setTemplates(Array.isArray(tmpl) ? tmpl : []);
      setLoaded(true);
    }).catch(() => setLoaded(true));

    // Fetch all contacts for analytics
    setContactsLoading(true);
    fetch(`/api/esp/contacts?accountKey=${accountKey}&all=true`)
      .then(r => r.json())
      .then(data => {
        if (data.contacts) {
          setAllContacts(data.contacts);
          setContactCount(data.meta?.total ?? data.contacts.length);
        }
        setContactsLoading(false);
      })
      .catch(() => setContactsLoading(false));

    // Fetch ESP campaigns + workflows for this account
    setCampaignsLoading(true);
    Promise.all([
      fetch(`/api/esp/campaigns?accountKey=${accountKey}`).then(r => r.json()),
      fetch(`/api/esp/workflows?accountKey=${accountKey}`).then(r => r.json()),
    ]).then(([campaignData, workflowData]) => {
      if (campaignData.campaigns) setEspCampaigns(campaignData.campaigns);
      if (workflowData.workflows) setEspWorkflows(workflowData.workflows);
      setCampaignsLoading(false);
    }).catch(() => setCampaignsLoading(false));
  }, [accountKey]);

  // Filter data by selected date range for analytics sections
  // NOTE: hooks must be called before any early returns to satisfy React's rules of hooks
  const bounds = useMemo(
    () =>
      dateRange === 'custom' && customRange
        ? getDateRangeBounds('custom', customRange.start, customRange.end)
        : getDateRangeBounds(dateRange),
    [dateRange, customRange],
  );
  const filteredEmails = useMemo(
    () => filterByDateRange(emails, 'createdAt', bounds),
    [emails, bounds],
  );
  const filteredContacts = useMemo(
    () => filterByDateRange(allContacts, 'dateAdded', bounds),
    [allContacts, bounds],
  );

  if (!loaded || !accountData || !accountKey) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>;
  }

  const accountCategory = accountData.category || 'General';
  const activeEmails = emails.filter(e => e.status === 'active').length;
  const draftEmails = emails.filter(e => e.status === 'draft').length;

  // Recent emails
  const recentEmails = [...emails]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const hasContacts = contactCount !== null;

  const stats = [
    {
      label: 'Active Emails',
      value: activeEmails,
      sub: draftEmails > 0 ? `${draftEmails} draft` : undefined,
      href: href('/templates'),
      icon: CheckCircleIcon,
      color: 'text-green-400',
    },
    {
      label: 'Total Emails',
      value: emails.length,
      href: href('/templates'),
      icon: EnvelopeIcon,
      color: 'text-blue-400',
    },
    {
      label: 'Templates',
      value: templates.length,
      href: '/templates',
      icon: BookOpenIcon,
      color: iconColorClass('general'),
    },
    ...(hasContacts
      ? [
          {
            label: 'Contacts',
            value: contactCount!,
            sub: undefined as string | undefined,
            href: '#contacts',
            icon: UserGroupIcon,
            color: iconColorClass('contacts'),
          },
        ]
      : []),
  ];

  return (
    <div>
      {/* Client header */}
      <div className="page-sticky-header mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-xl bg-[var(--primary)]"
            >
              {accountData.dealer.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-2xl font-bold">{accountData.dealer}</h2>
              <p className="text-[var(--muted-foreground)] text-sm">
                {accountCategory}
              </p>
            </div>
          </div>
          <DashboardToolbar
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
          />
        </div>
      </div>

      {/* Stats */}
      <div className={`grid gap-3 mb-8 ${hasContacts ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
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
            <p className="text-2xl font-bold">{stat.value.toLocaleString()}</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{stat.label}</p>
            {stat.sub && <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{stat.sub}</p>}
          </Link>
        ))}
      </div>

      {/* Contact Analytics */}
      {(hasContacts || contactsLoading) && (
        <div id="contacts" className="mb-8">
          <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5 mb-4">
            <UserGroupIcon className={`w-3.5 h-3.5 ${iconColorClass('contacts')}`} />
            Contact Analytics
          </h3>
          <ContactAnalytics
            contacts={filteredContacts}
            totalCount={contactCount ?? 0}
            loading={contactsLoading}
            dateRange={dateRange}
            customRange={customRange}
          />
        </div>
      )}

      {/* Email Analytics */}
      {emails.length > 0 && (
        <div id="emails" className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5">
              <EnvelopeIcon className="w-3.5 h-3.5" />
              Email Analytics
            </h3>
            <Link href={href('/templates')} className="text-[10px] text-[var(--primary)] hover:underline">
              View all emails
            </Link>
          </div>
          <EmailAnalytics emails={filteredEmails} loading={!loaded} dateRange={dateRange} customRange={customRange} />
        </div>
      )}

      {/* ESP Campaign Analytics */}
      {(espCampaigns.length > 0 || campaignsLoading) && (
        <div id="campaigns" className="mb-8">
          <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5 mb-4">
            <PaperAirplaneIcon className={`w-3.5 h-3.5 ${iconColorClass('campaigns')}`} />
            ESP Campaigns
          </h3>
          <CampaignAnalytics
            campaigns={espCampaigns}
            workflows={[]}
            loading={campaignsLoading}
          />
        </div>
      )}

      {/* Flow Analytics (ESP Workflows) */}
      {(espWorkflows.length > 0 || campaignsLoading) && (
        <div id="flows" className="mb-8">
          <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5 mb-4">
            <FlowIcon className={`w-3.5 h-3.5 ${iconColorClass('flows')}`} />
            Flows
          </h3>
          <FlowAnalytics
            workflows={espWorkflows}
            loading={campaignsLoading}
          />
        </div>
      )}

      {/* Quick actions */}
      <div className="flex gap-3 mb-8">
        <Link
          href="/templates"
          className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[var(--primary)] text-white font-medium text-sm hover:opacity-90 transition-opacity"
        >
          <BookOpenIcon className="w-4 h-4" />
          Browse Templates
        </Link>
        <Link
          href={href('/templates')}
          className="flex-1 flex items-center justify-center gap-2 py-3 px-4 glass-card rounded-xl font-medium text-sm"
        >
          <EnvelopeIcon className="w-4 h-4" />
          View Templates
        </Link>
      </div>

      {/* Contact List */}
      {hasContacts && (
        <div className="mb-8">
          <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5 mb-3">
            <UserGroupIcon className={`w-3.5 h-3.5 ${iconColorClass('contacts')}`} />
            All Contacts
          </h3>
          <ContactListCompact accountKey={accountKey} />
        </div>
      )}

      {/* Recent emails */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5">
          <ClockIcon className="w-3.5 h-3.5" />
          Recent Emails
        </h3>
        <Link href={href('/templates')} className="text-[10px] text-[var(--primary)] hover:underline">
          View all
        </Link>
      </div>
      {recentEmails.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-[var(--muted-foreground)] text-sm">No emails yet.</p>
          <Link href="/templates" className="text-[var(--primary)] text-sm mt-2 inline-block hover:underline">
            Browse templates to get started
          </Link>
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
  );
}
