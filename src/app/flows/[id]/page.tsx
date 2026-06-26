'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  ArrowUpTrayIcon,
  Squares2X2Icon,
  ArrowPathIcon,
  ArrowRightIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  TrashIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import { FlowIcon } from '@/components/icon-map';
import { FlowDiagram, type FlowNode } from '@/components/flows/flow-diagram';
import { DeployFlowModal } from '@/components/flows/deploy-flow-modal';
import { AccountAvatar } from '@/components/account-avatar';

type DetailTab = 'overview' | 'settings';
const TABS: { key: DetailTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: Squares2X2Icon },
  { key: 'settings', label: 'Settings', icon: Cog6ToothIcon },
];

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

interface FlowParentTemplateApi {
  id: string;
  name: string;
  updatedAt: string;
}

interface FlowInstanceRefApi {
  id: string;
  accountKey: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  lastSyncedAt: string;
  outOfDate: boolean;
  activeEnrollments: number;
  updatedAt: string;
}

interface FlowDetailApi {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  accountKey: string;
  parentTemplateId: string;
  lastSyncedAt: string;
  publishedAt: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  activeEnrollments: number;
  nodes: FlowGraphNodeApi[];
  edges: FlowGraphEdgeApi[];
  parentTemplate: FlowParentTemplateApi | null;
  instances: FlowInstanceRefApi[];
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

function formatRelative(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const INSTANCE_STATUS_BADGE: Record<FlowInstanceRefApi['status'], string> = {
  active: 'bg-green-500/10 text-green-400',
  paused: 'bg-orange-500/10 text-orange-400',
  draft: 'bg-zinc-500/10 text-zinc-400',
  archived: 'bg-zinc-500/10 text-zinc-400',
};

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
  const router = useRouter();
  const { isAdmin, accounts } = useAccount();
  const { confirm, prompt } = useLoomiDialog();
  const [deployOpen, setDeployOpen] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  // Overview/Settings tab switcher. Rename + archive + delete used
  // to hide behind a header overflow menu — now they live in a
  // first-class Settings tab so admins can find them without hunting.
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  // Per-instance resync state for the Deployments list — each row's
  // Update button shows its own spinner without locking the others.
  const [resyncingInstanceIds, setResyncingInstanceIds] = useState<Set<string>>(
    () => new Set(),
  );

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

  // Re-sync handler. Two modes (server-resolved):
  //   - On a template overview: re-syncs every out-of-date instance.
  //   - On an instance overview: re-syncs that instance from its parent.
  async function handleResync() {
    if (!flow || resyncing) return;
    setResyncing(true);
    try {
      const res = await fetch(`/api/flows/${flow.id}/resync`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Sync failed');
        return;
      }
      // Templates return { flows, failures } — instances return { flow }.
      if (Array.isArray(payload.flows)) {
        const ok = payload.flows.length;
        const fail = Array.isArray(payload.failures) ? payload.failures.length : 0;
        if (ok > 0 && fail === 0) {
          toast.success(`Updated ${ok} ${ok === 1 ? 'instance' : 'instances'}.`);
        } else if (ok > 0 && fail > 0) {
          toast.warning(`Updated ${ok}; ${fail} failed.`);
        } else if (fail > 0) {
          toast.error(`All ${fail} updates failed.`);
        } else {
          toast.info('No instances needed updating.');
        }
      } else {
        toast.success('Flow synced from template.');
      }
      await mutate();
    } finally {
      setResyncing(false);
    }
  }

  // Per-instance resync — used by each row's Update button on the
  // Deployments section. Independent of the template-level handleResync
  // so partial updates don't lock the whole page.
  async function handleResyncInstance(instanceId: string) {
    if (resyncingInstanceIds.has(instanceId)) return;
    setResyncingInstanceIds((prev) => new Set(prev).add(instanceId));
    try {
      const res = await fetch(`/api/flows/${instanceId}/resync`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Sync failed');
        return;
      }
      toast.success('Instance synced from template.');
      await mutate();
    } finally {
      setResyncingInstanceIds((prev) => {
        const next = new Set(prev);
        next.delete(instanceId);
        return next;
      });
    }
  }

  async function handleRename() {
    if (!flow) return;
    const next = await prompt({
      title: 'Rename flow',
      message: 'Pick a new name for this flow.',
      defaultValue: flow.name || '',
      confirmLabel: 'Rename',
      required: true,
    });
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === flow.name) return;
    const res = await fetch(`/api/flows/${flow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Rename failed');
      return;
    }
    toast.success('Flow renamed.');
    await mutate();
  }

  // Header-menu destructive actions. After success, navigate back to
  // the flows list — there's nothing useful to show on a freshly
  // archived/deleted flow's overview.
  async function handleArchive() {
    if (!flow) return;
    const ok = await confirm({
      title: 'Archive flow?',
      message: `"${flow.name || 'Untitled flow'}" will be hidden from the flows list and auto-deleted in 30 days. Active enrollments stop on the next tick.`,
      confirmLabel: 'Archive',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/flows/${flow.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Archive failed');
      return;
    }
    toast.success('Flow archived.');
    router.push(subHref('/flows'));
  }

  async function handleDelete() {
    if (!flow) return;
    const ok = await confirm({
      title: 'Delete flow permanently?',
      message: `"${flow.name || 'Untitled flow'}" and all its steps, triggers, and enrollment history will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/flows/${flow.id}?purge=true`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || 'Delete failed');
      return;
    }
    toast.success('Flow deleted.');
    router.push(subHref('/flows'));
  }

  const outOfDateCount = flow.instances.filter((i) => i.outOfDate).length;
  const activeInstanceCount = flow.instances.filter((i) => i.status === 'active').length;
  const totalInstanceEnrollments = flow.instances.reduce(
    (sum, i) => sum + i.activeEnrollments,
    0,
  );
  const isTemplate = !flow.accountKey;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-sticky-header has-tabs">
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
                {!flow.accountKey && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-500/15 text-violet-300"
                    title="Template flows have no sub-account. Deploy them to one or more sub-accounts to start enrolling contacts."
                  >
                    <Squares2X2Icon className="w-3 h-3" />
                    Template
                  </span>
                )}
              </div>
              {flow.description && (
                <p className="text-[var(--muted-foreground)] mt-1 text-sm truncate">
                  {flow.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-end">
            {/* Templates can't be "published" the same way — they need
                to be deployed to a sub-account first. Hide the publish
                toggle on templates to keep the affordance unambiguous. */}
            {flow.accountKey && (
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
            )}
            {/* Overflow menu removed — rename/archive/delete now live
                in the Settings tab below. */}
            {isAdmin && !flow.accountKey && (
              <button
                type="button"
                onClick={() => setDeployOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
              >
                <ArrowUpTrayIcon className="w-4 h-4" />
                Deploy to Sub-Accounts
              </button>
            )}
            <Link
              href={subHref(`/flows/${flow.id}/edit`)}
              className="inline-flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
            >
              <PencilSquareIcon className="w-4 h-4" />
              Edit Flow
            </Link>
          </div>
        </div>

        {/* Tab bar — pinned inside the sticky header so it doesn't scroll away. */}
        <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            // Settings tab is admin-only — sub-account users see the
            // overview but can't archive/delete flows.
            if (tab.key === 'settings' && !isAdmin) return null;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-[var(--primary)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {isAdmin && !flow.accountKey && (
        <DeployFlowModal
          open={deployOpen}
          flowId={flow.id}
          flowName={flow.name || 'Untitled flow'}
          existingInstances={flow.instances.map((i) => ({
            id: i.id,
            accountKey: i.accountKey,
          }))}
          instanceHrefPrefix={subHref('').replace(/\/$/, '')}
          onClose={() => setDeployOpen(false)}
          onDeployed={() => {
            // Re-fetch so the adoption panel below reflects the new
            // instances immediately.
            void mutate();
          }}
        />
      )}

      {activeTab === 'settings' ? (
        <FlowSettingsTab
          flowName={flow.name || 'Untitled flow'}
          onRename={handleRename}
          onArchive={handleArchive}
          onDelete={handleDelete}
        />
      ) : (
        <>
      {/* Instance banner: "Deployed from template X". Shown on any
          flow that has a parentTemplate, regardless of role. The link
          back to the template works for sub-account users too because
          getFlow doesn't scope-check flows with no accountKey. */}
      {flow.parentTemplate && (
        <div className="glass-card rounded-xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-violet-500/15 flex items-center justify-center flex-shrink-0">
            <Squares2X2Icon className="w-4 h-4 text-violet-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[var(--foreground)]">
              Deployed from template
            </p>
            <Link
              href={subHref(`/flows/${flow.parentTemplate.id}`)}
              className="text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1 mt-0.5"
            >
              {flow.parentTemplate.name}
              <ArrowRightIcon className="w-3 h-3" />
            </Link>
            {flow.lastSyncedAt && (
              <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                Last synced {formatDate(flow.lastSyncedAt)}
              </p>
            )}
          </div>
          {isAdmin && (() => {
            const instanceOutOfDate =
              !flow.lastSyncedAt ||
              flow.parentTemplate.updatedAt > flow.lastSyncedAt;
            if (!instanceOutOfDate) {
              return (
                <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
                  <CheckCircleIcon className="w-3 h-3" />
                  Up to date
                </span>
              );
            }
            return (
              <button
                type="button"
                onClick={handleResync}
                disabled={resyncing}
                title="Re-pull the template's current graph into this instance. Preserves status, name, and triggers."
                className="inline-flex items-center gap-1.5 px-2.5 h-8 text-[11px] font-semibold rounded-md border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowPathIcon className={`w-3.5 h-3.5 ${resyncing ? 'animate-spin' : ''}`} />
                {resyncing ? 'Updating…' : 'Update from template'}
              </button>
            );
          })()}
        </div>
      )}

      {/* Template banner: "N instances need an update". Admin-only;
          surfaces when the template has been edited after at least one
          instance's lastSyncedAt. Includes a "Update all" affordance
          plus a peek at which accounts are stale. */}
      {isAdmin && !flow.accountKey && outOfDateCount > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-3">
          <div className="w-8 h-8 rounded-md bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <InformationCircleIcon className="w-4 h-4 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[var(--foreground)]">
              {outOfDateCount} {outOfDateCount === 1 ? 'instance is' : 'instances are'} out of date
            </p>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              This template has been edited since the last deploy. Push the
              latest graph to {outOfDateCount === 1 ? 'this instance' : 'these instances'} to bring them in sync.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {flow.instances
                .filter((i) => i.outOfDate)
                .slice(0, 6)
                .map((inst) => {
                  const meta = accounts[inst.accountKey];
                  if (!meta) return null;
                  return (
                    <Link
                      key={inst.id}
                      href={subHref(`/flows/${inst.id}`)}
                      className="inline-flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded-full bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] transition-colors"
                      title={`Open ${meta.dealer}'s instance`}
                    >
                      <AccountAvatar
                        name={meta.dealer}
                        logos={meta.logos}
                        size={18}
                        className="flex-shrink-0"
                      />
                      <span className="text-[10px] text-[var(--foreground)] truncate max-w-[100px]">
                        {meta.dealer}
                      </span>
                    </Link>
                  );
                })}
              {outOfDateCount > 6 && (
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  +{outOfDateCount - 6} more
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleResync}
            disabled={resyncing}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${resyncing ? 'animate-spin' : ''}`} />
            {resyncing ? 'Updating…' : `Update all (${outOfDateCount})`}
          </button>
        </div>
      )}

      {/* Stat cards. Templates show deployment-focused stats (because
          the template itself has no enrollments — they live on
          instances). Instances + standalone flows show the real
          engagement numbers from the analytics endpoint. */}
      {isTemplate ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={Squares2X2Icon}
            value={flow.instances.length.toLocaleString()}
            label="Total deployments"
            sub={flow.instances.length === 0 ? 'Not deployed yet' : 'Sub-accounts'}
            color="text-violet-400"
            bgColor="bg-violet-500/15"
          />
          <StatCard
            icon={CheckCircleIcon}
            value={activeInstanceCount.toLocaleString()}
            label="Active instances"
            sub={
              flow.instances.length > 0
                ? `of ${flow.instances.length}`
                : undefined
            }
            color="text-green-400"
            bgColor="bg-green-500/10"
          />
          <StatCard
            icon={InformationCircleIcon}
            value={outOfDateCount.toLocaleString()}
            label="Out of date"
            sub={outOfDateCount > 0 ? 'Update available' : 'All in sync'}
            color={outOfDateCount > 0 ? 'text-amber-300' : 'text-[var(--muted-foreground)]'}
            bgColor={outOfDateCount > 0 ? 'bg-amber-500/15' : 'bg-[var(--muted)]'}
          />
          <StatCard
            icon={UsersIcon}
            value={totalInstanceEnrollments.toLocaleString()}
            label="Total enrollments"
            sub="Across all instances"
            color="text-orange-400"
            bgColor="bg-orange-500/10"
          />
        </div>
      ) : (
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
      )}

      {/* Diagram + side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="glass-card rounded-xl p-3 overflow-hidden">
          <div className="flex items-center justify-between mb-2 px-1">
            <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5">
              <BoltIcon className="w-3.5 h-3.5" />
              Flow Preview
            </h3>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              Click to edit · drag to pan · scroll to zoom
            </span>
          </div>
          <FlowDiagram
            nodes={diagramNodes}
            edges={diagramEdges}
            className="h-[480px]"
            onCanvasClick={() => router.push(subHref(`/flows/${flow.id}/edit`))}
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

          {/* Engagement/Enrollment side cards only make sense for
              instances + standalone flows — templates have no
              enrollments of their own. */}
          {!isTemplate && analytics && (
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

          {!isTemplate && (
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
          )}
        </div>
      </div>

      {/* Deployments section — templates only. Per-instance rows with
          sub-account, status, sync state, enrollments, and a per-row
          Update button when the instance is out of date. */}
      {isTemplate && (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <div>
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                Deployments
              </h3>
              <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                {flow.instances.length === 0
                  ? 'No sub-accounts have this template yet.'
                  : `${flow.instances.length} sub-account${flow.instances.length === 1 ? '' : 's'}${outOfDateCount > 0 ? ` · ${outOfDateCount} out of date` : ' · all in sync'}`}
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setDeployOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
              >
                <ArrowUpTrayIcon className="w-3.5 h-3.5" />
                Deploy to more
              </button>
            )}
          </div>

          {flow.instances.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Squares2X2Icon className="w-7 h-7 text-[var(--muted-foreground)] mx-auto mb-2" />
              <p className="text-sm text-[var(--foreground)]">
                This template hasn't been deployed yet
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                Click <span className="font-semibold">Deploy to Sub-Accounts</span> in
                the header to create an instance under one or more sub-accounts.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {/* Column header */}
              <div className="grid grid-cols-[1fr_100px_140px_100px_auto] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <span>Sub-Account</span>
                <span>Status</span>
                <span>Last synced</span>
                <span className="text-right">Active</span>
                <span className="text-right w-44" />
              </div>
              {flow.instances.map((inst) => {
                const meta = accounts[inst.accountKey];
                const dealer = meta?.dealer || inst.accountKey || '—';
                const statusBadge =
                  INSTANCE_STATUS_BADGE[inst.status] || 'bg-zinc-500/10 text-zinc-400';
                const isSyncing = resyncingInstanceIds.has(inst.id);
                return (
                  <div
                    key={inst.id}
                    className="grid grid-cols-[1fr_100px_140px_100px_auto] gap-3 px-4 py-3 items-center hover:bg-[var(--muted)]/40 transition-colors"
                  >
                    <Link
                      href={subHref(`/flows/${inst.id}`)}
                      className="flex items-center gap-2 min-w-0 group"
                    >
                      <AccountAvatar
                        name={dealer}
                        accountKey={inst.accountKey}
                        logos={meta?.logos}
                        size={28}
                        className="flex-shrink-0"
                      />
                      <span className="text-sm font-medium text-[var(--foreground)] truncate group-hover:text-[var(--primary)] transition-colors">
                        {dealer}
                      </span>
                    </Link>
                    <span>
                      <span
                        className={`inline-flex items-center text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ${statusBadge}`}
                      >
                        {inst.status}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)] inline-flex items-center gap-1.5">
                      {inst.outOfDate ? (
                        <span
                          className="inline-flex items-center gap-1 text-amber-300"
                          title={`Template updated ${formatRelative(flow.updatedAt)}`}
                        >
                          <InformationCircleIcon className="w-3.5 h-3.5" />
                          Out of date
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-3.5 h-3.5" />
                          In sync
                        </span>
                      )}
                      <span className="text-[var(--muted-foreground)]/80">
                        · {inst.lastSyncedAt ? formatRelative(inst.lastSyncedAt) : 'never'}
                      </span>
                    </span>
                    <span className="text-sm tabular-nums text-right">
                      {inst.activeEnrollments > 0 ? (
                        <span className="text-[var(--foreground)]">
                          {inst.activeEnrollments.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[var(--muted-foreground)]/60">0</span>
                      )}
                    </span>
                    <span className="flex items-center justify-end gap-1.5 w-44">
                      {isAdmin && inst.outOfDate && (
                        <button
                          type="button"
                          onClick={() => handleResyncInstance(inst.id)}
                          disabled={isSyncing}
                          title="Re-pull the template's current graph into this instance"
                          className="inline-flex items-center gap-1 px-2 h-8 text-[11px] font-semibold rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <ArrowPathIcon className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                          {isSyncing ? 'Updating…' : 'Update'}
                        </button>
                      )}
                      <Link
                        href={subHref(`/flows/${inst.id}`)}
                        className="inline-flex items-center gap-1 px-2 h-8 text-[11px] font-semibold rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors"
                      >
                        Open
                        <ArrowRightIcon className="w-3 h-3" />
                      </Link>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}

/**
 * Settings tab body — admin-only destructive actions for the flow.
 * Mirrors the LP detail page's "Settings" tab shape with a danger-zone
 * card per action. Heavier-weight than a one-line button row, but
 * makes the consequences obvious (each action gets a description).
 */
function FlowSettingsTab({
  flowName,
  onRename,
  onArchive,
  onDelete,
}: {
  flowName: string;
  onRename: () => void | Promise<void>;
  onArchive: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) {
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-start gap-2 mb-3">
          <PencilIcon className="mt-0.5 w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold leading-tight">Rename</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Change the flow&rsquo;s display name. The flow id stays the same — links
              and deployed instances aren&rsquo;t affected.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onRename()}
          className="inline-flex items-center gap-1.5 px-3 h-9 text-sm rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--muted)] transition-colors"
        >
          <PencilIcon className="w-4 h-4" />
          Rename &ldquo;{flowName}&rdquo;
        </button>
      </div>

      {/* Archive — soft delete. Recoverable for 30 days. */}
      <section className="rounded-2xl p-5 border border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-2 mb-3">
          <ArchiveBoxIcon className="mt-0.5 w-4 h-4 text-amber-400 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold leading-tight text-amber-300">Archive</h3>
            <p className="text-xs text-amber-200/80 mt-0.5">
              Hide this flow from the list and stop active enrollments on the next tick.
              Recoverable for 30 days, then auto-deleted.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onArchive()}
          className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-colors"
        >
          <ArchiveBoxIcon className="w-4 h-4" />
          Archive flow
        </button>
      </section>

      {/* Danger zone — permanent delete. */}
      <section className="rounded-2xl p-5 border border-rose-500/30 bg-rose-500/5">
        <div className="flex items-start gap-2 mb-3">
          <ExclamationTriangleIcon className="mt-0.5 w-4 h-4 text-rose-400 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold leading-tight text-rose-300">Danger zone</h3>
            <p className="text-xs text-rose-200/80 mt-0.5">
              Permanently delete the flow + every step, trigger, and enrollment history
              row. Cannot be undone.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 transition-colors"
        >
          <TrashIcon className="w-4 h-4" />
          Delete forever
        </button>
      </section>
    </div>
  );
}

export default function FlowOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  // No AdminOnly guard — the /api/flows/[id] endpoint already scopes
  // by accountKey for client/admin roles, so a sub-account user only
  // ever resolves their own flows. Sub-account users should see the
  // overview for their own flows; only /edit stays admin-gated.
  return <FlowOverview flowId={id} />;
}
