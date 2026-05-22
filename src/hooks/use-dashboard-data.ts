'use client';

import useSWR from 'swr';

// Minimal contact shape returned by /api/contacts/aggregate. Mirrors the
// fields the dashboard consumers actually read — we don't surface the
// full ESP-era normalized contact anywhere in the dashboard now.
type DashboardContact = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  tags: string[];
  dateAdded: string;
  source: string;
};

// ── Fetcher ──

async function jsonFetcher<T = unknown>(url: string): Promise<T> {
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

// ── Shared Config ──

const DASHBOARD_SWR_CONFIG = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 60_000,
  errorRetryCount: 1,
} as const;

type DashboardAggregateOptions = {
  enabled?: boolean;
  accountKeys?: string[];
  limitPerAccount?: number;
};

function buildDashboardUrl(path: string, options: DashboardAggregateOptions): string {
  const params = new URLSearchParams();

  if (options.accountKeys && options.accountKeys.length > 0) {
    params.set('accountKeys', options.accountKeys.join(','));
  }
  if (typeof options.limitPerAccount === 'number') {
    params.set('limitPerAccount', String(options.limitPerAccount));
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

// ── Response Types ──

type PerAccountEntry = {
  dealer: string;
  count: number;
  connected: boolean;
  provider: string;
};

export type ContactsAggregateResponse = {
  contacts: (DashboardContact & { _accountKey?: string; _dealer?: string })[];
  perAccount: Record<string, PerAccountEntry>;
  errors: Record<string, string>;
  meta: { totalContacts: number; accountsFetched: number };
};

// Campaigns/workflows aggregates used to come from the ESP layer. With the
// ESP teardown those endpoints are gone, so the hooks resolve to empty
// shapes — keeping the same response surface lets consumers keep their
// existing destructure/render code without conditional branches.
export type CampaignsAggregateResponse = {
  campaigns: never[];
  perAccount: Record<string, PerAccountEntry>;
  errors: Record<string, string>;
  meta: { totalCampaigns: number; accountsFetched: number };
};

export type WorkflowsAggregateResponse = {
  workflows: never[];
  perAccount: Record<string, PerAccountEntry>;
  errors: Record<string, string>;
  meta: { totalWorkflows: number; accountsFetched: number };
};

export type ContactStatsEntry = {
  dealer: string;
  count: number;
  contactCount?: number;
  connected: boolean;
  cached: boolean;
  provider: string;
  error?: string;
};

export type ContactStatsResponse = {
  stats: Record<string, ContactStatsEntry>;
  meta: { totalContacts: number; connectedAccounts: number; accountsFetched: number };
};

// ── Hooks ──

export function useContactsAggregate(options: DashboardAggregateOptions = {}) {
  const enabled = options.enabled ?? true;
  return useSWR<ContactsAggregateResponse>(
    enabled ? buildDashboardUrl('/api/contacts/aggregate', options) : null,
    jsonFetcher,
    DASHBOARD_SWR_CONFIG,
  );
}

const EMPTY_CAMPAIGNS_AGGREGATE: CampaignsAggregateResponse = {
  campaigns: [],
  perAccount: {},
  errors: {},
  meta: { totalCampaigns: 0, accountsFetched: 0 },
};

const EMPTY_WORKFLOWS_AGGREGATE: WorkflowsAggregateResponse = {
  workflows: [],
  perAccount: {},
  errors: {},
  meta: { totalWorkflows: 0, accountsFetched: 0 },
};

// ESP campaigns/workflows aggregates are gone. The hooks survive as
// thin stubs that immediately resolve to empty data so existing call
// sites (loading flags, perAccount maps, etc.) keep working while we
// migrate consumers to Loomi-native sources.
export function useCampaignsAggregate(_options: DashboardAggregateOptions = {}) {
  void _options;
  return {
    data: EMPTY_CAMPAIGNS_AGGREGATE,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: async () => EMPTY_CAMPAIGNS_AGGREGATE,
  } as const;
}

export function useWorkflowsAggregate(_options: DashboardAggregateOptions = {}) {
  void _options;
  return {
    data: EMPTY_WORKFLOWS_AGGREGATE,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: async () => EMPTY_WORKFLOWS_AGGREGATE,
  } as const;
}

export function useContactStats(options: DashboardAggregateOptions = {}) {
  const enabled = options.enabled ?? true;
  return useSWR<ContactStatsResponse>(
    enabled ? buildDashboardUrl('/api/contacts/stats', options) : null,
    jsonFetcher,
    DASHBOARD_SWR_CONFIG,
  );
}
