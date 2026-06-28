'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChatBubbleOvalLeftIcon, ChevronUpDownIcon } from '@heroicons/react/24/outline';
import { UserAvatar } from '@/components/user-avatar';
import { AccountAvatar } from '@/components/account-avatar';
import {
  STATUS_LABEL,
  STATUS_DOT,
  PRIORITY_META,
  formatShortDate,
  dueState,
  type PriorityKey,
} from '@/lib/projects/ui';
import type { TaskDTO } from '@/lib/services/projects';
import { matchesFilters, type TaskFilters } from './filter-bar';

type SortKey = 'title' | 'accountDealer' | 'dueDate' | 'priority' | 'status';
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/**
 * Presentational task table — the parent (TasksView) owns the filter bar, data
 * fetch, and account scoping; this sorts + renders the shared task list.
 */
export function TableBody({
  tasks,
  isLoading,
  filters,
}: {
  tasks: TaskDTO[];
  isLoading: boolean;
  filters: TaskFilters;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<SortKey>('dueDate');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  const sorted = useMemo(() => {
    const arr = tasks.filter((t) => matchesFilters(t, filters));
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
  }, [tasks, sort, dir, filters]);

  function toggleSort(key: SortKey) {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir('asc');
    }
  }

  return (
    // Full-bleed to the surface card's edges with a soft horizontal fade so the
    // table scrolls off to the page edge (mirrors the board's columns row).
    <div className="overflow-x-auto -mx-6 px-6 pb-2 md:-mx-8 md:px-8 [mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1rem),transparent)]">
      <table className="w-full min-w-max text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
            <Th label="Task" onClick={() => toggleSort('title')} active={sort === 'title'} />
            <th className="px-3 py-2" aria-label="Comments" />
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
                tabIndex={0}
                role="button"
                aria-label={`Open task: ${t.title}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(`/projects/tasks/${t.id}`);
                  }
                }}
                className="cursor-pointer border-b border-[var(--border)] outline-none transition last:border-0 hover:bg-[var(--muted)]/40 focus-visible:bg-[var(--muted)]/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]"
              >
                <td className="max-w-[22rem] px-3 py-2.5">
                  <span className="block truncate font-medium text-[var(--foreground)]">{t.title}</span>
                </td>
                <td className="px-3 py-2.5">
                  {t.commentCount > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-[var(--muted-foreground)]"
                      title={`${t.commentCount} comment${t.commentCount === 1 ? '' : 's'}`}
                    >
                      <ChatBubbleOvalLeftIcon className="h-4 w-4" />
                      {t.commentCount}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {t.accountDealer ? (
                    <span className="flex items-center gap-1.5">
                      <AccountAvatar
                        name={t.accountDealer}
                        accountKey={t.accountKey}
                        logos={t.accountLogos ?? undefined}
                        size={20}
                        className="h-5 w-5 flex-shrink-0 rounded object-cover"
                      />
                      <span className="text-[var(--muted-foreground)]">{t.accountDealer}</span>
                    </span>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">—</span>
                  )}
                </td>
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
              <td colSpan={8} className="px-3 py-12 text-center text-sm text-[var(--muted-foreground)]">
                No tasks match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
