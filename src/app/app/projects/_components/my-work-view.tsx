'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { STATUSES, dueState } from '@/lib/projects/ui';
import type { TaskDTO } from '@/lib/services/projects';
import { jsonFetcher } from './fetcher';
import { TaskCard } from './task-card';
import { FetchError } from './fetch-states';

type Group = { key: string; label: string; dot: string; tasks: TaskDTO[] };

function byDue(a: TaskDTO, b: TaskDTO) {
  const av = a.dueDate ? Date.parse(a.dueDate) : Infinity;
  const bv = b.dueDate ? Date.parse(b.dueDate) : Infinity;
  return av - bv;
}

export function MyWorkView() {
  const { data, isLoading, error, mutate } = useSWR<{ tasks: TaskDTO[] }>(
    '/api/projects/tasks?assigneeUserId=me',
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const tasks = data?.tasks ?? [];

  const { groups, openCount, doneCount } = useMemo(() => {
    // Active work only — done + canceled don't belong in "My Work".
    const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');
    const overdue = open.filter((t) => dueState(t.dueDate, false) === 'overdue').sort(byDue);
    const dueSoon = open.filter((t) => dueState(t.dueDate, false) === 'soon').sort(byDue);
    const flagged = new Set([...overdue, ...dueSoon].map((t) => t.id));
    const rest = open.filter((t) => !flagged.has(t.id));

    // Each task appears once: urgency sections first, then the remainder by status.
    const statusGroups: Group[] = STATUSES.filter(
      (s) => s.key !== 'done' && s.key !== 'canceled',
    )
      .map((s) => ({ key: s.key, label: s.label, dot: s.dot, tasks: rest.filter((t) => t.status === s.key) }))
      .filter((g) => g.tasks.length > 0);

    const groups: Group[] = [
      ...(overdue.length ? [{ key: 'overdue', label: 'Overdue', dot: '#ef4444', tasks: overdue }] : []),
      ...(dueSoon.length ? [{ key: 'soon', label: 'Due soon', dot: '#f59e0b', tasks: dueSoon }] : []),
      ...statusGroups,
    ];
    return {
      groups,
      openCount: open.length,
      doneCount: tasks.filter((t) => t.status === 'done').length,
    };
  }, [tasks]);

  const urgent = (k: string) => k === 'overdue' || k === 'soon';

  return (
    <div className="pb-6">
      <div className="py-6">
        <h1 className="text-xl font-semibold text-[var(--foreground)]">My Work</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Everything assigned to you across accounts and teams
          {openCount > 0 ? ` · ${openCount} open` : ''}
          {doneCount > 0 ? ` · ${doneCount} done` : ''}.
        </p>
      </div>

      {error && !data && <FetchError onRetry={() => mutate()} />}

      {!error && !isLoading && openCount === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center text-sm text-[var(--muted-foreground)]">
          You&apos;re all caught up — nothing open assigned to you.
        </div>
      )}

      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: g.dot }} />
              <h2
                className="text-sm font-medium"
                style={{ color: urgent(g.key) ? g.dot : 'var(--foreground)' }}
              >
                {g.label}
              </h2>
              <span className="text-xs text-[var(--muted-foreground)]">{g.tasks.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {g.tasks.map((t) => (
                <Link key={t.id} href={`/projects/tasks/${t.id}`} className="block">
                  <TaskCard task={t} />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
