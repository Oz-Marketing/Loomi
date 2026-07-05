'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import {
  MegaphoneIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { FlowIcon } from '@/components/icon-map';

// ── Types ──

interface Campaign {
  id: string;
  name: string;
  status: string;
  accountKey?: string;
  dealer?: string;
}

interface Workflow {
  id: string;
  name: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  accountKey?: string;
  dealer?: string;
}

interface CampaignListProps {
  campaigns: Campaign[];
  workflows: Workflow[];
  loading?: boolean;
  accountNames?: Record<string, string>;
}

type TabKey = 'campaigns' | 'workflows';

// ── Helpers ──

const STATUS_BADGE: Record<string, string> = {
  sent:       'bg-green-500/10 text-green-400',
  scheduled:  'bg-blue-500/10 text-blue-400',
  draft:      'bg-zinc-500/10 text-zinc-400',
  paused:     'bg-orange-500/10 text-orange-400',
  cancelled:  'bg-red-500/10 text-red-400',
};

function normalizeStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (s.includes('complete') || s.includes('deliver') || s.includes('finish') || s.includes('sent')) return 'sent';
  if (s.includes('active') || s.includes('sched') || s.includes('queue') || s.includes('start') || s.includes('running') || s.includes('progress')) return 'scheduled';
  if (s.includes('draft')) return 'draft';
  if (s.includes('pause')) return 'paused';
  if (s.includes('stop') || s.includes('cancel') || s.includes('inactive')) return 'cancelled';
  return s;
}

function statusBadgeClass(status: string): string {
  return STATUS_BADGE[normalizeStatus(status)] || 'bg-zinc-500/10 text-zinc-400';
}

function statusLabel(status: string): string {
  const normalized = normalizeStatus(status);
  if (normalized === 'draft') return 'In Progress';
  const withSpaces = normalized.replace(/_/g, ' ');
  return withSpaces.replace(/\b\w/g, (char) => char.toUpperCase());
}

function accountKeyForRecord(record: { accountKey?: string }): string | null {
  return record.accountKey || null;
}

// ── Component ──

export function BlastList({
  campaigns,
  workflows,
  loading,
  accountNames,
}: CampaignListProps) {
  const [tab, setTab] = useState<TabKey>('campaigns');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }>; count: number }[] = [
    { key: 'campaigns', label: 'Email Blasts', icon: MegaphoneIcon, count: campaigns.length },
    { key: 'workflows', label: 'Workflows', icon: FlowIcon, count: workflows.length },
  ];

  const filteredCampaigns = useMemo(() => {
    if (!debouncedSearch) return campaigns;
    const q = debouncedSearch.toLowerCase();
    return campaigns.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.status.toLowerCase().includes(q) ||
      statusLabel(c.status).toLowerCase().includes(q) ||
      (c.dealer || '').toLowerCase().includes(q)
    );
  }, [campaigns, debouncedSearch]);

  const filteredWorkflows = useMemo(() => {
    if (!debouncedSearch) return workflows;
    const q = debouncedSearch.toLowerCase();
    return workflows.filter(w =>
      w.name.toLowerCase().includes(q) ||
      w.status.toLowerCase().includes(q) ||
      (w.dealer || '').toLowerCase().includes(q)
    );
  }, [workflows, debouncedSearch]);

  if (loading) {
    return (
      <div className="glass-card rounded-xl p-6 animate-pulse">
        <div className="w-40 h-5 bg-[var(--muted)] rounded mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="w-48 h-4 bg-[var(--muted)] rounded" />
              <div className="w-20 h-4 bg-[var(--muted)] rounded" />
              <div className="flex-1" />
              <div className="w-16 h-4 bg-[var(--muted)] rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const activeItems = tab === 'campaigns' ? filteredCampaigns : filteredWorkflows;

  return (
    <div className="glass-card rounded-xl overflow-hidden animate-fade-in-up animate-stagger-3">
      {/* Tabs + Search */}
      <div className="flex items-center justify-between gap-4 px-4 pt-4 pb-2">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === t.key
                  ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              <span className="ml-1 tabular-nums opacity-60">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="relative">
          <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-44 pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
      </div>

      {/* List */}
      <div className="px-4 pb-4">
        {activeItems.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--muted-foreground)]">
              {debouncedSearch
                ? `No ${tab === 'campaigns' ? 'campaigns' : 'workflows'} match "${debouncedSearch}"`
                : `No ${tab === 'campaigns' ? 'campaigns' : 'workflows'} found`}
            </p>
          </div>
        ) : (
          <div className="space-y-1 mt-2">
            {/* Header row */}
            <div className="flex items-center gap-4 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              <span className="flex-1">Name</span>
              <span className="w-28">Sub-Account</span>
              <span className="w-20 text-center">Status</span>
              {tab === 'workflows' && <span className="w-24 text-right">Updated</span>}
            </div>

            {activeItems.map((item) => {
              const accountKey = accountKeyForRecord(item);
              const accountName =
                (accountKey && accountNames?.[accountKey]) ||
                item.dealer ||
                accountKey ||
                '—';

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-4 px-3 py-2.5 rounded-lg hover:bg-[var(--muted)] transition-colors group"
                >
                  <span className="flex-1 text-sm font-medium truncate">{item.name || '(Untitled)'}</span>
                  <span className="w-28 text-xs text-[var(--muted-foreground)] truncate">{accountName}</span>
                  <span className="w-20 flex justify-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClass(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </span>
                  {tab === 'workflows' && (
                    <span className="w-24 text-xs text-[var(--muted-foreground)] text-right tabular-nums">
                      {('updatedAt' in item && item.updatedAt) ? formatDate(item.updatedAt as string) : '—'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}
