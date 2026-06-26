'use client';

import { UserAvatar } from '@/components/user-avatar';
import type { TaskDTO } from '@/lib/services/projects';
import {
  PRIORITY_META,
  KIND_META,
  kindLabel,
  formatShortDate,
  dueState,
  type PriorityKey,
} from '@/lib/projects/ui';

/** Presentational task card — parents own click/drag behavior. */
export function TaskCard({ task, showAccount = true }: { task: TaskDTO; showAccount?: boolean }) {
  const pr = PRIORITY_META[task.priority as PriorityKey] ?? PRIORITY_META.medium;
  const isDone = task.status === 'done';
  const due = dueState(task.dueDate, isDone);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 transition hover:border-[var(--primary)]/50 hover:shadow-sm">
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-2 w-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: pr.color }}
          title={`${pr.label} priority`}
        />
        <p className="flex-1 text-sm font-medium leading-snug text-[var(--foreground)] line-clamp-2">
          {task.title}
        </p>
      </div>

      {(task.teamName || KIND_META[task.kind]?.launch || (showAccount && task.accountDealer)) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.teamName && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: task.teamColor ?? 'var(--primary)' }}
            >
              {task.teamName}
            </span>
          )}
          {KIND_META[task.kind]?.launch && (
            <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
              {kindLabel(task.kind)}
            </span>
          )}
          {showAccount && task.accountDealer && (
            <span className="max-w-[10rem] truncate text-[11px] text-[var(--muted-foreground)]">
              {task.accountDealer}
            </span>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between">
        {task.dueDate ? (
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
              due === 'overdue'
                ? 'bg-red-500/10 text-red-500'
                : due === 'soon'
                  ? 'bg-amber-500/10 text-amber-600'
                  : 'text-[var(--muted-foreground)]'
            }`}
          >
            {formatShortDate(task.dueDate)}
          </span>
        ) : (
          <span />
        )}
        {task.assignee ? (
          <UserAvatar
            name={task.assignee.name}
            email={task.assignee.email}
            avatarUrl={task.assignee.avatarUrl}
            size={20}
            className="h-5 w-5 rounded-full object-cover"
          />
        ) : (
          <span className="text-[11px] text-[var(--muted-foreground)]">Unassigned</span>
        )}
      </div>
    </div>
  );
}
