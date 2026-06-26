'use client';

import Link from 'next/link';
import { PlusIcon } from '@heroicons/react/24/outline';
import { STATUSES } from '@/lib/projects/ui';
import type { ProjectOptions } from './use-project-options';

const PRIORITIES = ['urgent', 'high', 'medium', 'low'];

/**
 * Shared filter row for the board, table, and calendar. Account + team are
 * always shown; assignee / priority / status selects appear only when their
 * change handler is provided (board hides status — it's the column axis).
 */
export function ProjectsFilterBar({
  options,
  accountKey,
  teamKey,
  onAccountKey,
  onTeamKey,
  assigneeUserId,
  onAssigneeUserId,
  priority,
  onPriority,
  status,
  onStatus,
  title,
  subtitle,
}: {
  options: ProjectOptions | undefined;
  accountKey: string;
  teamKey: string;
  onAccountKey: (v: string) => void;
  onTeamKey: (v: string) => void;
  assigneeUserId?: string;
  onAssigneeUserId?: (v: string) => void;
  priority?: string;
  onPriority?: (v: string) => void;
  status?: string;
  onStatus?: (v: string) => void;
  title: string;
  subtitle?: string;
}) {
  const selectClass = 'loomi-input !w-auto !py-1.5 text-xs';
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 py-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--foreground)]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--muted-foreground)]">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={accountKey}
          onChange={(e) => onAccountKey(e.target.value)}
          className={selectClass}
          aria-label="Filter by account"
        >
          <option value="">All accounts</option>
          {options?.accounts.map((a) => (
            <option key={a.key} value={a.key}>
              {a.dealer}
            </option>
          ))}
        </select>
        <select
          value={teamKey}
          onChange={(e) => onTeamKey(e.target.value)}
          className={selectClass}
          aria-label="Filter by team"
        >
          <option value="">All teams</option>
          {options?.teams.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
        {onAssigneeUserId && (
          <select
            value={assigneeUserId ?? ''}
            onChange={(e) => onAssigneeUserId(e.target.value)}
            className={selectClass}
            aria-label="Filter by assignee"
          >
            <option value="">Anyone</option>
            <option value="__unassigned__">Unassigned</option>
            {options?.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        {onPriority && (
          <select
            value={priority ?? ''}
            onChange={(e) => onPriority(e.target.value)}
            className={selectClass}
            aria-label="Filter by priority"
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        )}
        {onStatus && (
          <select
            value={status ?? ''}
            onChange={(e) => onStatus(e.target.value)}
            className={selectClass}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)] transition hover:opacity-90"
        >
          <PlusIcon className="h-4 w-4" />
          New ticket
        </Link>
      </div>
    </div>
  );
}

/** Client-side predicate matching the optional assignee/priority/status filters. */
export function matchesFilters(
  t: { assignee: { id: string } | null; priority: string; status: string },
  f: { assigneeUserId?: string; priority?: string; status?: string },
): boolean {
  if (f.assigneeUserId) {
    if (f.assigneeUserId === '__unassigned__') {
      if (t.assignee) return false;
    } else if (t.assignee?.id !== f.assigneeUserId) {
      return false;
    }
  }
  if (f.priority && t.priority !== f.priority) return false;
  if (f.status && t.status !== f.status) return false;
  return true;
}
