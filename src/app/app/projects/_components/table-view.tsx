'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ChevronUpDownIcon } from '@heroicons/react/24/outline';
import { UserAvatar } from '@/components/user-avatar';
import {
  STATUS_LABEL,
  STATUS_DOT,
  PRIORITY_META,
  formatShortDate,
  dueState,
  type PriorityKey,
} from '@/lib/projects/ui';
import type { TaskDTO } from '@/lib/services/projects';
import { jsonFetcher } from './fetcher';
import { useProjectOptions } from './use-project-options';
import { ProjectsFilterBar, matchesFilters } from './filter-bar';
import { FetchError } from './fetch-states';

type SortKey = 'title' | 'accountDealer' | 'dueDate' | 'priority' | 'status';
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function TableView() {
  const router = useRouter();
  const options = useProjectOptions();
  const [accountKey, setAccountKey] = useState('');
  const [teamKey, setTeamKey] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [priority, setPriority] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('dueDate');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  const qs = new URLSearchParams();
  if (accountKey) qs.set('accountKey', accountKey);
  if (teamKey) qs.set('teamKey', teamKey);
  const swrKey = `/api/projects/tasks${qs.toString() ? `?${qs}` : ''}`;
  const { data, isLoading, error, mutate } = useSWR<{ tasks: TaskDTO[] }>(swrKey, jsonFetcher, {
    revalidateOnFocus: false,
  });
  const tasks = data?.tasks ?? [];

  const sorted = useMemo(() => {
    const arr = tasks.filter((t) =>
      matchesFilters(t, { assigneeUserId, priority, status: statusFilter }),
    );
    arr.sort((a, b) => {
      let cmp = 0;
      if (sort === 'priority') {
        cmp = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
      } else if (sort === 'dueDate') {
        const av = a.dueDate ? Date.parse(a.dueDate) : Number.POSITIVE_INFINITY;
        const bv = b.dueDate ? Date.parse(b.dueDate) : Number.POSITIVE_INFINITY;
        cmp = av - bv;
      } else {
        cmp = String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''));
      }
      return dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [tasks, sort, dir, assigneeUserId, priority, statusFilter]);

  function toggleSort(key: SortKey) {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir('asc');
    }
  }

  return (
    <div className="pb-6">
      <ProjectsFilterBar
        options={options}
        accountKey={accountKey}
        teamKey={teamKey}
        onAccountKey={setAccountKey}
        onTeamKey={setTeamKey}
        assigneeUserId={assigneeUserId}
        onAssigneeUserId={setAssigneeUserId}
        priority={priority}
        onPriority={setPriority}
        status={statusFilter}
        onStatus={setStatusFilter}
        title="Table"
        subtitle="Every task, sortable and filterable."
      />
      {error && !data ? (
        <FetchError onRetry={() => mutate()} />
      ) : (
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full min-w-max text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
              <Th label="Task" onClick={() => toggleSort('title')} active={sort === 'title'} />
              <Th label="Account" onClick={() => toggleSort('accountDealer')} active={sort === 'accountDealer'} />
              <th className="px-3 py-2 font-medium">Team</th>
              <th className="px-3 py-2 font-medium">Assignee</th>
              <Th label="Priority" onClick={() => toggleSort('priority')} active={sort === 'priority'} />
              <Th label="Due" onClick={() => toggleSort('dueDate')} active={sort === 'dueDate'} />
              <Th label="Status" onClick={() => toggleSort('status')} active={sort === 'status'} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const pr = PRIORITY_META[t.priority as PriorityKey] ?? PRIORITY_META.medium;
              const terminal = t.status === 'done' || t.status === 'canceled';
              const due = dueState(t.dueDate, terminal);
              return (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/projects/tasks/${t.id}`)}
                  className="cursor-pointer border-b border-[var(--border)] last:border-0 transition hover:bg-[var(--muted)]/40"
                >
                  <td className="max-w-[22rem] px-3 py-2.5">
                    <span className="block truncate font-medium text-[var(--foreground)]">{t.title}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--muted-foreground)]">{t.accountDealer ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {t.teamName ? (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                        style={{ backgroundColor: t.teamColor ?? 'var(--primary)' }}
                      >
                        {t.teamName}
                      </span>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {t.assignee ? (
                      <span className="flex items-center gap-1.5">
                        <UserAvatar
                          name={t.assignee.name}
                          email={t.assignee.email}
                          avatarUrl={t.assignee.avatarUrl}
                          size={20}
                          className="h-5 w-5 rounded-full object-cover"
                        />
                        <span className="text-[var(--muted-foreground)]">{t.assignee.name}</span>
                      </span>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">Unassigned</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pr.color }} />
                      {pr.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {t.dueDate ? (
                      <span
                        className={
                          due === 'overdue'
                            ? 'text-red-500'
                            : due === 'soon'
                              ? 'text-amber-600'
                              : 'text-[var(--muted-foreground)]'
                        }
                      >
                        {formatShortDate(t.dueDate)}
                      </span>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_DOT[t.status] ?? '#94a3b8' }} />
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!isLoading && sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-sm text-[var(--muted-foreground)]">
                  No tasks match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function Th({ label, onClick, active }: { label: string; onClick: () => void; active: boolean }) {
  return (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition hover:text-[var(--foreground)] ${active ? 'text-[var(--foreground)]' : ''}`}
      >
        {label}
        <ChevronUpDownIcon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}
