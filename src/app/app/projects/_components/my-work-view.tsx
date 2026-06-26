'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { STATUSES } from '@/lib/projects/ui';
import type { TaskDTO } from '@/lib/services/projects';
import { jsonFetcher } from './fetcher';
import { TaskCard } from './task-card';

export function MyWorkView() {
  const { data, isLoading } = useSWR<{ tasks: TaskDTO[] }>(
    '/api/projects/tasks?assigneeUserId=me',
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const tasks = data?.tasks ?? [];

  const sections = useMemo(() => {
    return STATUSES.map((s) => ({
      ...s,
      tasks: tasks.filter((t) => t.status === s.key),
    })).filter((s) => s.tasks.length > 0);
  }, [tasks]);

  const openCount = tasks.filter((t) => t.status !== 'done').length;

  return (
    <div className="pb-6">
      <div className="py-6">
        <h1 className="text-xl font-semibold text-[var(--foreground)]">My Work</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Everything assigned to you across accounts and teams
          {openCount > 0 ? ` · ${openCount} open` : ''}.
        </p>
      </div>

      {!isLoading && tasks.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center text-sm text-[var(--muted-foreground)]">
          Nothing assigned to you right now.
        </div>
      )}

      <div className="space-y-6">
        {sections.map((s) => (
          <div key={s.key}>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.dot }} />
              <h2 className="text-sm font-medium text-[var(--foreground)]">{s.label}</h2>
              <span className="text-xs text-[var(--muted-foreground)]">{s.tasks.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {s.tasks.map((t) => (
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
