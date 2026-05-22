'use client';

import useSWR from 'swr';

// Mirror the server-side types from /api/dashboard/portfolio. Kept in
// sync manually rather than imported because the route file is server-
// only and pulls in prisma.

export type PortfolioKpis = {
  accountsTotal: number;
  accountsActive: number;
  contactsTotal: number;
  contactsAdded: number;
  emailsSent: number;
  smsSent: number;
  emailDelivered: number;
  emailOpens: number;
  emailClicks: number;
  emailBounces: number;
  emailSpamReports: number;
  emailUnsubscribes: number;
  smsDelivered: number;
  smsFailed: number;
  smsStops: number;
  emailDeliveryRate: number;
  emailOpenRate: number;
  emailClickRate: number;
  emailBounceRate: number;
  emailSpamRate: number;
  smsDeliveryRate: number;
  suppressionsAdded: number;
};

export type EngagementTimelinePoint = {
  date: string;
  emailDelivered: number;
  emailOpens: number;
  emailClicks: number;
  emailBounces: number;
  smsDelivered: number;
};

export type EngagedContactsBreakdown = {
  windowDays: number;
  engagedTotal: number;
  engagedByAccount: Array<{
    accountKey: string;
    dealer: string;
    engagedCount: number;
    totalCount: number;
    rate: number;
  }>;
};

export type LifecycleAlertsResult = {
  service: {
    dueIn30: number;
    dueIn60: number;
    dueIn90: number;
    byAccount: Array<{ accountKey: string; dealer: string; dueIn30: number; dueIn60: number; dueIn90: number }>;
  };
  lease: {
    endingIn30: number;
    endingIn60: number;
    endingIn90: number;
    byAccount: Array<{ accountKey: string; dealer: string; endingIn30: number; endingIn60: number; endingIn90: number }>;
  };
  warranty: {
    expiringIn30: number;
    expiringIn60: number;
    expiringIn90: number;
    byAccount: Array<{ accountKey: string; dealer: string; expiringIn30: number; expiringIn60: number; expiringIn90: number }>;
  };
};

export type PipelineCampaign = {
  id: string;
  channel: 'email' | 'sms';
  name: string;
  status: string;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  accountKeys: string[];
  error: string | null;
  updatedAt: string;
};

export type SendPipelineResult = {
  scheduled: PipelineCampaign[];
  inFlight: PipelineCampaign[];
  recentlyFailed: PipelineCampaign[];
};

export type AccountHealthRow = {
  accountKey: string;
  dealer: string;
  contactCount: number;
  sentInPeriod: number;
  deliveredInPeriod: number;
  opensInPeriod: number;
  clicksInPeriod: number;
  bouncesInPeriod: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  suppressionGrowth: number;
  lastSentAt: string | null;
  daysSinceLastSend: number | null;
  healthScore: number;
};

export type AnomalyAlert = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  accountKey: string;
  dealer: string;
  href?: string;
  timestamp: string;
};

export type TopCampaignRow = {
  campaignId: string;
  campaignName: string;
  channel: 'email';
  accountKeys: string[];
  sent: number;
  delivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
  openRate: number;
  clickRate: number;
  sentAt: string | null;
};

export type ActivityEntry = {
  id: string;
  kind: 'campaign-launched' | 'campaign-scheduled' | 'campaign-failed' | 'list-created' | 'contact-imported';
  title: string;
  detail: string;
  accountKey: string;
  dealer: string;
  timestamp: string;
};

export type RepPerformanceRow = {
  repId: string | null;
  repName: string;
  accountCount: number;
  contactCount: number;
  sentInPeriod: number;
  deliveredInPeriod: number;
  opensInPeriod: number;
  clicksInPeriod: number;
  openRate: number;
  clickRate: number;
  averageHealthScore: number;
};

export type SuppressionHealthResult = {
  emailTotal: number;
  smsTotal: number;
  emailAddedInPeriod: number;
  smsAddedInPeriod: number;
  emailReasons: Array<{ reason: string; count: number }>;
  smsReasons: Array<{ reason: string; count: number }>;
};

export type MetaPacerSummaryRow = {
  accountKey: string;
  dealer: string;
  baseBudgetGoal: number;
  addedBudgetGoal: number;
  totalBudgetGoal: number;
  actualSpend: number;
  pacingPct: number;
  adCount: number;
  period: string;
};

export type PortfolioDashboardData = {
  meta: {
    accountKeys: string[];
    start: string;
    end: string;
    engagedWindowDays: number;
    role: string;
  };
  kpis: PortfolioKpis | null;
  timeline: EngagementTimelinePoint[];
  engagedContacts: EngagedContactsBreakdown;
  lifecycle: LifecycleAlertsResult | null;
  pipeline: SendPipelineResult;
  accountHealth: AccountHealthRow[];
  anomalies: AnomalyAlert[];
  topCampaigns: TopCampaignRow[];
  activity: ActivityEntry[];
  repPerformance: RepPerformanceRow[];
  suppression: SuppressionHealthResult | null;
  metaPacer: MetaPacerSummaryRow[];
  errors?: Record<string, string>;
};

async function jsonFetcher(url: string): Promise<PortfolioDashboardData> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      typeof (body as Record<string, unknown>).error === 'string'
        ? ((body as Record<string, unknown>).error as string)
        : `Error ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

type Options = {
  enabled?: boolean;
  accountKeys?: string[];
  start?: Date | null;
  end?: Date | null;
  engagedWindowDays?: number;
};

function buildUrl(options: Options): string {
  const params = new URLSearchParams();
  if (options.accountKeys && options.accountKeys.length > 0) {
    params.set('accountKeys', options.accountKeys.join(','));
  }
  if (options.start) params.set('start', options.start.toISOString());
  if (options.end) params.set('end', options.end.toISOString());
  if (typeof options.engagedWindowDays === 'number') {
    params.set('engagedWindowDays', String(options.engagedWindowDays));
  }
  const query = params.toString();
  return query ? `/api/dashboard/portfolio?${query}` : '/api/dashboard/portfolio';
}

export function usePortfolioDashboard(options: Options = {}) {
  const enabled = options.enabled ?? true;
  return useSWR<PortfolioDashboardData>(
    enabled ? buildUrl(options) : null,
    jsonFetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30_000,
      errorRetryCount: 1,
    },
  );
}
