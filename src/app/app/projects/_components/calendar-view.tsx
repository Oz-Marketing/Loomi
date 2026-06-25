'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { TaskDTO } from '@/lib/services/projects';
import { jsonFetcher } from './fetcher';
import { useProjectOptions } from './use-project-options';
import { ProjectsFilterBar, matchesFilters } from './filter-bar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CalendarView() {
  const router = useRouter();
  const options = useProjectOptions();
  const [accountKey, setAccountKey] = useState('');
  const [teamKey, setTeamKey] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [priority, setPriority] = useState('');
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const qs = new URLSearchParams();
  if (accountKey) qs.set('accountKey', accountKey);
  if (teamKey) qs.set('teamKey', teamKey);
  const swrKey = `/api/projects/tasks${qs.toString() ? `?${qs}` : ''}`;
  const { data } = useSWR<{ tasks: TaskDTO[] }>(swrKey, jsonFetcher, { revalidateOnFocus: false });
  const tasks = data?.tasks ?? [];

  const { weeks, monthLabel, month } = useMemo(() => {
    const year = cursor.getFullYear();
    const m = cursor.getMonth();
    const gridStart = new Date(year, m, 1 - new Date(year, m, 1).getDay());
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
    }
    const w: Date[][] = [];
    for (let i = 0; i < 6; i++) w.push(days.slice(i * 7, i * 7 + 7));
    return {
      weeks: w,
      month: m,
      monthLabel: cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  }, [cursor]);

  const tasksByDay = useMemo(() => {
    const map: Record<string, TaskDTO[]> = {};
    for (const t of tasks) {
      if (!t.dueDate) continue;
      if (!matchesFilters(t, { assigneeUserId, priority })) continue;
      const key = ymd(new Date(t.dueDate));
      (map[key] ??= []).push(t);
    }
    return map;
  }, [tasks, assigneeUserId, priority]);

  const todayKey = ymd(new Date());

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
        title="Calendar"
        subtitle="Tasks plotted by due date."
      />

      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]"
          aria-label="Previous month"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <span className="min-w-[10rem] text-center text-sm font-medium text-[var(--foreground)]">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]"
          aria-label="Next month"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            const d = new Date();
            setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
          }}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]"
        >
          Today
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
        <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--muted)]/30 text-center text-[11px] font-medium text-[var(--muted-foreground)]">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map((day) => {
            const key = ymd(day);
            const inMonth = day.getMonth() === month;
            const dayTasks = tasksByDay[key] ?? [];
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={`min-h-[6.5rem] border-b border-r border-[var(--border)] p-1.5 ${
                  inMonth ? '' : 'bg-[var(--muted)]/20'
                }`}
              >
                <div className="mb-1 flex justify-end">
                  <span
                    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] ${
                      isToday
                        ? 'bg-[var(--primary)] font-semibold text-white'
                        : inMonth
                          ? 'text-[var(--foreground)]'
                          : 'text-[var(--muted-foreground)]'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayTasks.slice(0, 3).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => router.push(`/projects/tasks/${t.id}`)}
                      className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] text-white transition hover:opacity-90"
                      style={{ backgroundColor: t.teamColor ?? 'var(--primary)' }}
                      title={t.title}
                    >
                      {t.title}
                    </button>
                  ))}
                  {dayTasks.length > 3 && (
                    <span className="block px-1 text-[10px] text-[var(--muted-foreground)]">
                      +{dayTasks.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
