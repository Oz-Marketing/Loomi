'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  PencilSquareIcon,
  UsersIcon,
  CheckCircleIcon,
  PauseCircleIcon,
  DocumentTextIcon,
  ArchiveBoxIcon,
  EnvelopeIcon,
  CursorArrowRaysIcon,
  EyeIcon,
  ChartBarIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { AdminOnly } from '@/components/route-guard';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { FlowIcon } from '@/components/icon-map';
import { FlowDiagram, type FlowNode } from '@/components/flows/flow-diagram';

// Types mirror the API shape (loomi-flows service serializes nulls to
// empty strings + ISO strings for dates).
interface FlowGraphNodeApi {
  id: string;
  type: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
}

interface FlowGraphEdgeApi {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branch: string | null;
}

interface FlowDetailApi {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  accountKey: string;
  publishedAt: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  activeEnrollments: number;
  nodes: FlowGraphNodeApi[];
  edges: FlowGraphEdgeApi[];
}

interface FlowAnalyticsApi {
  active: number;
  completed: number;
  exited: number;
  failed: number;
  totalSends: number;
  totalOpens: number;
  totalClicks: number;
}

const STATUS_META: Record<FlowDetailApi['status'], { label: string; badge: string; icon: React.ComponentType<{ className?: string }> }> = {
  active:   { label: 'Active',   badge: 'bg-green-500/10 text-green-400',   icon: CheckCircleIcon },
  paused:   { label: 'Paused',   badge: 'bg-orange-500/10 text-orange-400', icon: PauseCircleIcon },
  draft:    { label: 'Draft',    badge: 'bg-zinc-500/10 text-zinc-400',     icon: DocumentTextIcon },
  archived: { label: 'Archived', badge: 'bg-zinc-500/10 text-zinc-400',     icon: ArchiveBoxIcon },
};

// Map the service NodeType to the diagram's color-coded kinds. The
// diagram only renders a small palette; anything that doesn't map gets
// the neutral 'action' chip.
function mapNodeKind(type: string): FlowNode['kind'] {
  if (type === 'trigger') return 'trigger';
  if (type === 'email') return 'email';
  if (type === 'sms') return 'sms';
  if (type === 'wait' || type === 'wait_until') return 'wait';
  if (type === 'add_to_list' || type === 'remove_from_list') return 'audience';
  return 'action';
}

function humanizeNodeType(type: string): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${res.status}`);
  }
  return res.json();
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PublishSwitch({
  active,
  updating,
  onToggle,
}: {
  active: boolean;
  updating: boolean;
  onToggle: (next: 'active' | 'paused') => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={updating}
      onClick={() => onToggle(active ? 'paused' : 'active')}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? 'bg-green-500' : 'bg-[var(--muted)] border border-[var(--border)]'
      } ${updating ? 'animate-pulse' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          active ? 'translate-x-[22px]' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
  sub,
  color,
  bgColor,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | string;
  label: string;
  sub?: string;
  color: string;
  bgColor: string;
}) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className={`w-8 h-8 rounded-lg ${bgColor} flex items-center justify-center mb-2`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{sub}</p>}
    </div>
  );
}

function FlowOverview({ flowId }: { flowId: string }) {
  const subHref = useSubaccountHref();

  const { data: flowData, error: flowError, isLoading: flowLoading, mutate } = useSWR<{ flow: FlowDetailApi }>(
    `/api/flows/${flowId}`,
    fetcher,
  );
  const { data: analyticsData } = useSWR<{ analytics: FlowAnalyticsApi }>(
    `/api/flows/${flowId}/analytics`,
    fetcher,
  );

  const flow = flowData?.flow;
  const analytics = analyticsData?.analytics;

  const diagramNodes = useMemo<FlowNode[]>(() => {
    if (!flow) return [];
    return flow.nodes.map((n) => ({
      id: n.id,
      kind: mapNodeKind(n.type),
      title: typeof n.config?.label === 'string' && n.config.label
        ? (n.config.label as string)
        : humanizeNodeType(n.type),
      subtitle: typeof n.config?.subtitle === 'string'
        ? (n.config.subtitle as string)
        : undefined,
      x: n.x,
      y: n.y,
    }));
  }, [flow]);

  const diagramEdges = useMemo(() => {
    if (!flow) return [];
    return flow.edges.map((e) => ({ from: e.fromNodeId, to: e.toNodeId }));
  }, [flow]);

  if (flowError) {
    return (
      <div className="glass-card rounded-xl p-10 text-center">
        <p className="text-sm text-red-400">Failed to load flow: {flowError.message}</p>
        <Link
          href={subHref('/flows')}
          className="inline-flex items-center gap-1.5 mt-4 px-3 h-9 text-xs rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" />
          Back to flows
        </Link>
      </div>
    );
  }

  if (flowLoading || !flow) {
    return (
      <div className="glass-card rounded-xl p-10 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">Loading flow…</p>
      </div>
    );
  }

  const statusMeta = STATUS_META[flow.status] || STATUS_META.draft;
  const StatusIcon = statusMeta.icon;

  const totalEnrollments = analytics
    ? analytics.active + analytics.completed + analytics.exited + analytics.failed
    : flow.activeEnrollments;
  const completionRate = analytics && totalEnrollments > 0
    ? Math.round((analytics.completed / totalEnrollments) * 100)
    : 0;

  async function handleToggle(next: 'active' | 'paused') {
    if (!flow) return;
    const endpoint = next === 'active'
      ? `/api/flows/${flow.id}/publish`
      : `/api/flows/${flow.id}/pause`;
    const res = await fetch(endpoint, { method: 'POST' });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      if (payload.issues && Array.isArray(payload.issues)) {
        toast.error(
          `Cannot publish: ${payload.issues.map((i: { message: string }) => i.message).join('; ')}`,
        );
      } else {
        toast.error(payload.error || 'Status update failed');
      }
      return;
    }
    toast.success(next === 'active' ? 'Flow published' : 'Flow paused');
    await mutate();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-sticky-header">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={subHref('/flows')}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors flex-shrink-0"
              aria-label="Back to flows"
            >
              <ArrowLeftIcon className="w-4 h-4" />
            </Link>
            <FlowIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-bold truncate">{flow.name || 'Untitled flow'}</h2>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${statusMeta.badge}`}
                >
                  <StatusIcon className="w-3 h-3" />
                  {statusMeta.label}
                </span>
              </div>
              {flow.description && (
                <p className="text-[var(--muted-foreground)] mt-1 text-sm truncate">
                  {flow.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-end">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted-foreground)]">
                {flow.status === 'active' ? 'Published' : 'Unpublished'}
              </span>
              <PublishSwitch
                active={flow.status === 'active'}
                updating={false}
                onToggle={handleToggle}
              />
            </div>
            <Link
              href={subHref(`/flows/${flow.id}/edit`)}
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
            >
              <PencilSquareIcon className="w-4 h-4" />
              Edit Flow
            </Link>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={UsersIcon}
          value={(analytics?.active ?? flow.activeEnrollments).toLocaleString()}
          label="Currently enrolled"
          sub={analytics ? `${totalEnrollments.toLocaleString()} all-time` : undefined}
          color="text-orange-400"
          bgColor="bg-orange-500/10"
        />
        <StatCard
          icon={ChartBarIcon}
          value={analytics ? `${completionRate}%` : '—'}
          label="Completion rate"
          sub={analytics ? `${analytics.completed.toLocaleString()} completed` : undefined}
          color="text-green-400"
          bgColor="bg-green-500/10"
        />
        <StatCard
          icon={EnvelopeIcon}
          value={(analytics?.totalSends ?? 0).toLocaleString()}
          label="Emails sent"
          color="text-sky-400"
          bgColor="bg-sky-500/10"
        />
        <StatCard
          icon={EyeIcon}
          value={(analytics?.totalOpens ?? 0).toLocaleString()}
          label="Email opens"
          sub={analytics ? `${analytics.totalClicks.toLocaleString()} clicks` : undefined}
          color="text-emerald-400"
          bgColor="bg-emerald-500/10"
        />
      </div>

      {/* Diagram + side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="glass-card rounded-xl p-3 overflow-hidden">
          <div className="flex items-center justify-between mb-2 px-1">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5">
              <BoltIcon className="w-3.5 h-3.5" />
              Flow Preview
            </h3>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              Drag to pan · scroll to zoom
            </span>
          </div>
          <FlowDiagram
            nodes={diagramNodes}
            edges={diagramEdges}
            className="h-[480px]"
          />
        </div>

        <div className="space-y-3">
          <div className="glass-card rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
              Details
            </h3>
            <dl className="space-y-2.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)]">Created</dt>
                <dd className="text-right">{formatDate(flow.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)]">Last updated</dt>
                <dd className="text-right">{formatDate(flow.updatedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)]">Published</dt>
                <dd className="text-right">{formatDate(flow.publishedAt || undefined)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)]">Steps</dt>
                <dd className="text-right tabular-nums">{flow.nodeCount}</dd>
              </div>
            </dl>
          </div>

          {analytics && (
            <div className="glass-card rounded-xl p-4">
              <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
                Enrollment Breakdown
              </h3>
              <dl className="space-y-2.5 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted-foreground)]">Active</dt>
                  <dd className="text-right tabular-nums">{analytics.active.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted-foreground)]">Completed</dt>
                  <dd className="text-right tabular-nums">{analytics.completed.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted-foreground)]">Exited</dt>
                  <dd className="text-right tabular-nums">{analytics.exited.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted-foreground)]">Failed</dt>
                  <dd className="text-right tabular-nums inline-flex items-center gap-1">
                    {analytics.failed > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
                    {analytics.failed.toLocaleString()}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          <div className="glass-card rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">
              Engagement
            </h3>
            <dl className="space-y-2.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)] inline-flex items-center gap-1">
                  <EnvelopeIcon className="w-3 h-3" />
                  Sends
                </dt>
                <dd className="text-right tabular-nums">{(analytics?.totalSends ?? 0).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)] inline-flex items-center gap-1">
                  <EyeIcon className="w-3 h-3" />
                  Opens
                </dt>
                <dd className="text-right tabular-nums">{(analytics?.totalOpens ?? 0).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)] inline-flex items-center gap-1">
                  <CursorArrowRaysIcon className="w-3 h-3" />
                  Clicks
                </dt>
                <dd className="text-right tabular-nums">{(analytics?.totalClicks ?? 0).toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FlowOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <AdminOnly>
      <FlowOverview flowId={id} />
    </AdminOnly>
  );
}
