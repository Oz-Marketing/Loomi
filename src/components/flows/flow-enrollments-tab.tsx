'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  ClockIcon,
  CursorArrowRaysIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  StopCircleIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';

// ── API shapes (mirrors listFlowEnrollments in services/loomi-flows) ──

interface EnrollmentStepApi {
  id: string;
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  status: string;
  branch: string;
  executedAt: string;
  detail: string;
}

interface EnrollmentApi {
  id: string;
  contactId: string;
  contactName: string;
  contactEmail: string;
  status: 'active' | 'completed' | 'exited' | 'failed';
  enrolledAt: string;
  completedAt: string;
  nextRunAt: string;
  currentNodeId: string;
  currentNodeLabel: string;
  sends: number;
  opens: number;
  clicks: number;
  bounces: number;
  failures: number;
  lastActivityAt: string;
  steps: EnrollmentStepApi[];
}

interface EnrollmentsApi {
  enrollments: EnrollmentApi[];
  total: number;
  counts: { active: number; completed: number; exited: number; failed: number; all: number };
}

type StatusKey = '' | 'active' | 'completed' | 'exited' | 'failed';

const PAGE_SIZE = 25;

const STATUS_META: Record<
  Exclude<StatusKey, ''>,
  { label: string; badge: string; icon: React.ComponentType<{ className?: string }> }
> = {
  active:    { label: 'Active',    badge: 'bg-orange-500/10 text-orange-400', icon: ClockIcon },
  completed: { label: 'Completed', badge: 'bg-green-500/10 text-green-400',   icon: CheckCircleIcon },
  exited:    { label: 'Exited',    badge: 'bg-zinc-500/10 text-zinc-400',     icon: StopCircleIcon },
  failed:    { label: 'Failed',    badge: 'bg-red-500/10 text-red-400',       icon: ExclamationTriangleIcon },
};

// Step statuses the worker writes (see processEnrollmentTick). 'updated'
// covers the non-messaging contact ops — tag/list/field writes and task
// creation — which aren't "sent" and shouldn't read as such.
const STEP_META: Record<string, { label: string; dot: string }> = {
  sent:     { label: 'Sent',    dot: 'bg-sky-400' },
  updated:  { label: 'Applied', dot: 'bg-blue-400' },
  branched: { label: 'Branched', dot: 'bg-amber-400' },
  waited:   { label: 'Waited',  dot: 'bg-zinc-400' },
  skipped:  { label: 'Skipped', dot: 'bg-zinc-500' },
  exited:   { label: 'Exited',  dot: 'bg-zinc-400' },
  failed:   { label: 'Failed',  dot: 'bg-red-400' },
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${res.status}`);
  }
  return res.json();
};

function formatDateTime(iso?: string): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
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

/**
 * Per-contact history for one flow.
 *
 * The flow's stat cards answer "how is this doing"; this answers "did
 * Dana get the email, and if not, why not" — which is the question you
 * actually have once a flow is live. Every row expands into the step
 * timeline the worker recorded for that contact.
 */
export function FlowEnrollmentsTab({ flowId }: { flowId: string }) {
  const [status, setStatus] = useState<StatusKey>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Debounce the search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  if (status) query.set('status', status);
  if (search) query.set('search', search);

  const { data, error, isLoading } = useSWR<EnrollmentsApi>(
    `/api/flows/${flowId}/enrollments?${query.toString()}`,
    fetcher,
    // Enrollments advance on the worker's tick, so keep them fresh while
    // the tab is open without the user reaching for reload.
    { refreshInterval: 30_000, keepPreviousData: true },
  );

  const rows = data?.enrollments ?? [];
  const counts = data?.counts;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filters = useMemo(
    () =>
      [
        { key: '' as StatusKey, label: 'All', count: counts?.all },
        { key: 'active' as StatusKey, label: 'Active', count: counts?.active },
        { key: 'completed' as StatusKey, label: 'Completed', count: counts?.completed },
        { key: 'exited' as StatusKey, label: 'Exited', count: counts?.exited },
        { key: 'failed' as StatusKey, label: 'Failed', count: counts?.failed },
      ].filter((f) => f.key === '' || f.key === status || (f.count ?? 0) > 0),
    [counts, status],
  );

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (error) {
    return (
      <div className="glass-card rounded-xl p-10 text-center">
        <p className="text-sm text-red-400">
          Failed to load enrollments: {error.message}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar — status chips + contact search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {filters.map((f) => {
            const active = status === f.key;
            return (
              <button
                key={f.key || 'all'}
                type="button"
                onClick={() => {
                  setStatus(f.key);
                  setPage(0);
                }}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium rounded-lg border transition-colors ${
                  active
                    ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                    : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]'
                }`}
              >
                {f.label}
                {f.count !== undefined && (
                  <span className="tabular-nums opacity-70">{f.count.toLocaleString()}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or email…"
            className="w-56 pl-8 pr-2 h-8 rounded-lg border border-[var(--border)] bg-[var(--input)] text-xs placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        {/* Column header */}
        <div className="grid grid-cols-[24px_1fr_110px_1fr_150px_110px] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)]">
          <span />
          <span>Contact</span>
          <span>Status</span>
          <span>Current step</span>
          <span className="text-right">Engagement</span>
          <span className="text-right">Enrolled</span>
        </div>

        {isLoading && rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
            Loading enrollments…
          </p>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <UsersIcon className="w-7 h-7 text-[var(--muted-foreground)] mx-auto mb-2" />
            <p className="text-sm text-[var(--foreground)]">
              {search || status ? 'No enrollments match this filter' : 'Nobody has entered this flow yet'}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              {search || status
                ? 'Try clearing the search or picking a different status.'
                : 'Contacts appear here as soon as a trigger enrolls them.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <EnrollmentRow
                key={row.id}
                row={row}
                expanded={expanded.has(row.id)}
                onToggle={() => toggleExpanded(row.id)}
              />
            ))}
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted-foreground)]">
          <span className="tabular-nums">
            {(page * PAGE_SIZE + 1).toLocaleString()}–
            {Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()} of{' '}
            {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2.5 h-8 rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="px-2.5 h-8 rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EnrollmentRow({
  row,
  expanded,
  onToggle,
}: {
  row: EnrollmentApi;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = STATUS_META[row.status] ?? STATUS_META.active;
  const StatusIcon = meta.icon;
  const enrolled = formatDateTime(row.enrolledAt);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full grid grid-cols-[24px_1fr_110px_1fr_150px_110px] gap-3 px-4 py-3 items-center text-left hover:bg-[var(--muted)]/40 transition-colors"
      >
        <span className="text-[var(--muted-foreground)]">
          {expanded ? (
            <ChevronDownIcon className="w-4 h-4" />
          ) : (
            <ChevronRightIcon className="w-4 h-4" />
          )}
        </span>

        <span className="min-w-0">
          <span className="block text-sm font-medium text-[var(--foreground)] truncate">
            {row.contactName || row.contactEmail || 'Unnamed contact'}
          </span>
          {row.contactName && row.contactEmail && (
            <span className="block text-[11px] text-[var(--muted-foreground)] truncate">
              {row.contactEmail}
            </span>
          )}
        </span>

        <span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.badge}`}
          >
            <StatusIcon className="w-3 h-3" />
            {meta.label}
          </span>
        </span>

        <span className="min-w-0 text-xs text-[var(--muted-foreground)] truncate">
          {row.status === 'active'
            ? row.currentNodeLabel || 'Waiting to start'
            : row.steps.length > 0
              ? `Ended at ${row.steps[row.steps.length - 1].nodeLabel}`
              : '—'}
          {row.status === 'active' && row.nextRunAt && (
            <span className="block text-[10px] opacity-70">
              next {formatRelative(row.nextRunAt)}
            </span>
          )}
        </span>

        <span className="flex items-center justify-end gap-2.5 text-xs tabular-nums">
          <EngagementStat
            icon={EnvelopeIcon}
            value={row.sends}
            label={`${row.sends} email${row.sends === 1 ? '' : 's'} sent to this contact by this flow`}
          />
          <EngagementStat
            icon={EyeIcon}
            value={row.opens}
            label={`Opened ${row.opens} of them`}
            highlight={row.opens > 0}
          />
          <EngagementStat
            icon={CursorArrowRaysIcon}
            value={row.clicks}
            label={`Clicked a link in ${row.clicks} of them`}
            highlight={row.clicks > 0}
          />
          {(row.failures > 0 || row.bounces > 0) && (
            <EngagementStat
              icon={ExclamationTriangleIcon}
              value={row.failures + row.bounces}
              label={
                row.bounces > 0
                  ? `${row.bounces} bounced, ${row.failures} step${row.failures === 1 ? '' : 's'} failed`
                  : `${row.failures} step${row.failures === 1 ? '' : 's'} failed — expand for the reason`
              }
              danger
            />
          )}
        </span>

        <span className="text-right leading-tight">
          <span className="block text-xs text-[var(--muted-foreground)]">
            {enrolled?.date ?? '—'}
          </span>
          <span className="block text-[10px] text-[var(--muted-foreground)]">
            {enrolled?.time ?? ''}
          </span>
        </span>
      </button>

      {expanded && <StepTimeline steps={row.steps} status={row.status} />}
    </div>
  );
}

function EngagementStat({
  icon: Icon,
  value,
  label,
  highlight,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  const tone = danger
    ? 'text-red-400'
    : highlight
      ? 'text-[var(--foreground)]'
      : 'text-[var(--muted-foreground)]/60';
  return (
    <Tooltip label={label}>
      <span className={`inline-flex items-center gap-1 ${tone}`}>
        <Icon className="w-3.5 h-3.5" />
        {value.toLocaleString()}
      </span>
    </Tooltip>
  );
}

/** The worker's step log for one contact, oldest first. This is the
 *  "what actually happened" record — including the reason a step
 *  skipped or failed, which is otherwise invisible. */
function StepTimeline({
  steps,
  status,
}: {
  steps: EnrollmentStepApi[];
  status: EnrollmentApi['status'];
}) {
  if (steps.length === 0) {
    return (
      <div className="px-12 pb-4 -mt-1">
        <p className="text-[11px] text-[var(--muted-foreground)]">
          {status === 'active'
            ? 'Enrolled, but no step has run yet — the worker picks this up on its next tick.'
            : 'No steps were recorded for this enrollment.'}
        </p>
      </div>
    );
  }

  return (
    <ol className="px-12 pb-4 -mt-1 space-y-1.5">
      {steps.map((step) => {
        const meta = STEP_META[step.status] ?? { label: step.status, dot: 'bg-zinc-400' };
        const when = formatDateTime(step.executedAt);
        return (
          <li key={step.id} className="flex items-start gap-2.5 text-[11px]">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
            <span className="min-w-0 flex-1">
              <span className="text-[var(--foreground)]">{step.nodeLabel}</span>
              <span className="text-[var(--muted-foreground)]"> · {meta.label}</span>
              {step.branch && (
                <span className="text-[var(--muted-foreground)]"> → {step.branch}</span>
              )}
              {step.detail && (
                <span
                  className={`block ${step.status === 'failed' ? 'text-red-400' : 'text-[var(--muted-foreground)]'}`}
                >
                  {step.detail}
                </span>
              )}
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)] whitespace-nowrap flex-shrink-0">
              {when ? `${when.date}, ${when.time}` : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
