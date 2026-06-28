'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { ViewColumnsIcon, TableCellsIcon } from '@heroicons/react/24/outline';
import type { TaskDTO } from '@/lib/services/projects';
import { useAccount } from '@/contexts/account-context';
import { jsonFetcher } from './fetcher';
import { useProjectOptions } from './use-project-options';
import { ProjectsFilterBar, type TaskFilters } from './filter-bar';
import { FetchError } from './fetch-states';
import { BoardBody } from './board-view';
import { TableBody } from './table-view';

type ViewMode = 'board' | 'table';
const VIEW_STORAGE_KEY = 'projects-tasks-view';

/**
 * Unified Tasks page: one filter bar + one data fetch, with a Board ⇆ Table
 * toggle. Both views share the same SWR cache and filters, so switching is
 * instant and never resets the user's filters. The chosen view is reflected in
 * the URL (`?view=`) for shareability and remembered in localStorage.
 */
export function TasksView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const options = useProjectOptions();

  const paramView = searchParams.get('view');
  const [view, setView] = useState<ViewMode>(paramView === 'table' ? 'table' : 'board');

  // No explicit ?view in the URL → restore the last-used view from localStorage.
  useEffect(() => {
    if (paramView === 'table' || paramView === 'board') return;
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_STORAGE_KEY) : null;
    if (saved === 'table' || saved === 'board') setView(saved);
    // Run once on mount; paramView is the initial URL state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectView(v: ViewMode) {
    setView(v);
    if (typeof window !== 'undefined') window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    const next = new URLSearchParams(searchParams.toString());
    next.set('view', v);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  // Shared per-view filters (all multi-select, all applied client-side).
  const [accountKeys, setAccountKeys] = useState<string[]>([]);
  const [teamKeys, setTeamKeys] = useState<string[]>([]);
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const { accountKey: globalAccountKey, isAdmin } = useAccount();

  // The fetch is scoped server-side only by the GLOBAL account (one account in
  // account mode, all-in-scope for admins). The per-view multi-selects refine
  // the result client-side.
  const serverAccount = isAdmin ? '' : globalAccountKey ?? '';
  const swrKey = `/api/projects/tasks${serverAccount ? `?accountKey=${encodeURIComponent(serverAccount)}` : ''}`;
  const { data, isLoading, error, mutate } = useSWR<{ tasks: TaskDTO[] }>(swrKey, jsonFetcher, {
    revalidateOnFocus: false,
  });
  const tasks = data?.tasks ?? [];

  const filters: TaskFilters = useMemo(
    () => ({
      // Account multi-select only applies for admins (account-mode is locked + hidden).
      accountKeys: isAdmin ? accountKeys : [],
      teamKeys,
      assigneeUserIds,
      // Status is a table-only filter — the board uses status as its columns.
      statuses: view === 'table' ? statuses : [],
      priorities,
      search,
    }),
    [isAdmin, accountKeys, teamKeys, assigneeUserIds, statuses, priorities, search, view],
  );

  return (
    <div className="flex h-full flex-col pb-2">
      <ProjectsFilterBar
        options={options}
        accountKeys={accountKeys}
        teamKeys={teamKeys}
        onAccountKeys={setAccountKeys}
        onTeamKeys={setTeamKeys}
        assigneeUserIds={assigneeUserIds}
        onAssigneeUserIds={setAssigneeUserIds}
        priorities={priorities}
        onPriorities={setPriorities}
        // Status filter is table-only — the board uses status as its columns.
        statuses={view === 'table' ? statuses : undefined}
        onStatuses={view === 'table' ? setStatuses : undefined}
        showAccountSelect={isAdmin}
        viewToggle={<ViewToggle view={view} onChange={selectView} />}
        search={search}
        onSearch={setSearch}
        title="Tasks"
        subtitle={
          view === 'board' ? 'Drag tasks across stages.' : 'Every task, sortable and filterable.'
        }
      />
      {error && !data ? (
        <FetchError onRetry={() => mutate()} />
      ) : view === 'board' ? (
        <BoardBody tasks={tasks} isLoading={isLoading} mutate={mutate} filters={filters} />
      ) : (
        <div className="pb-6">
          <TableBody tasks={tasks} isLoading={isLoading} filters={filters} />
        </div>
      )}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const item =
    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]';
  const active = 'bg-[var(--background)] text-[var(--foreground)] shadow-sm';
  const idle = 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]';
  return (
    <div
      role="group"
      aria-label="Switch view"
      className="inline-flex items-center gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-0.5"
    >
      <button
        type="button"
        onClick={() => onChange('board')}
        aria-pressed={view === 'board'}
        className={`${item} ${view === 'board' ? active : idle}`}
      >
        <ViewColumnsIcon className="h-4 w-4" />
        Board
      </button>
      <button
        type="button"
        onClick={() => onChange('table')}
        aria-pressed={view === 'table'}
        className={`${item} ${view === 'table' ? active : idle}`}
      >
        <TableCellsIcon className="h-4 w-4" />
        Table
      </button>
    </div>
  );
}
