'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { toast } from '@/lib/toast';
import { STATUSES } from '@/lib/projects/ui';
import type { TaskDTO } from '@/lib/services/projects';
import { jsonFetcher } from './fetcher';
import { useProjectOptions } from './use-project-options';
import { ProjectsFilterBar, matchesFilters } from './filter-bar';
import { TaskCard } from './task-card';

export function BoardView() {
  const router = useRouter();
  const options = useProjectOptions();
  const [accountKey, setAccountKey] = useState('');
  const [teamKey, setTeamKey] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [priority, setPriority] = useState('');

  const qs = new URLSearchParams();
  if (accountKey) qs.set('accountKey', accountKey);
  if (teamKey) qs.set('teamKey', teamKey);
  const swrKey = `/api/projects/tasks${qs.toString() ? `?${qs}` : ''}`;
  const { data, isLoading, mutate } = useSWR<{ tasks: TaskDTO[] }>(swrKey, jsonFetcher, {
    revalidateOnFocus: false,
  });
  const tasks = data?.tasks ?? [];

  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const byStatus = useMemo(() => {
    const map: Record<string, TaskDTO[]> = {};
    for (const s of STATUSES) map[s.key] = [];
    for (const t of tasks) {
      if (!matchesFilters(t, { assigneeUserId, priority })) continue;
      (map[t.status] ??= []).push(t);
    }
    return map;
  }, [tasks, assigneeUserId, priority]);

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const taskId = String(e.active.id);
    const overCol = e.over ? String(e.over.id) : null;
    if (!overCol) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === overCol) return;

    mutate({ tasks: tasks.map((t) => (t.id === taskId ? { ...t, status: overCol } : t)) }, { revalidate: false });
    try {
      const res = await fetch(`/api/projects/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: overCol }),
      });
      if (!res.ok) throw new Error();
      mutate();
    } catch {
      toast.error('Could not move task');
      mutate();
    }
  }

  return (
    <div className="flex h-full flex-col pb-2">
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
        title="Board"
        subtitle="Drag tasks across stages."
      />
      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex flex-1 gap-3 overflow-x-auto pb-4">
          {STATUSES.map((s) => (
            <Column key={s.key} status={s.key} label={s.label} dot={s.dot} count={byStatus[s.key]?.length ?? 0}>
              {(byStatus[s.key] ?? []).map((t) => (
                <DraggableCard key={t.id} task={t} onOpen={() => router.push(`/projects/tasks/${t.id}`)} />
              ))}
              {!isLoading && (byStatus[s.key]?.length ?? 0) === 0 && (
                <p className="px-1 py-6 text-center text-xs text-[var(--muted-foreground)]">Nothing here</p>
              )}
            </Column>
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <div className="w-72 rotate-1 opacity-95">
              <TaskCard task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({
  status,
  label,
  dot,
  count,
  children,
}: {
  status: string;
  label: string;
  dot: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 flex-shrink-0 flex-col rounded-2xl border p-2 transition ${
        isOver
          ? 'border-[var(--primary)] bg-[var(--primary)]/5'
          : 'border-[var(--border)] bg-[var(--muted)]/20'
      }`}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />
        <span className="text-sm font-medium text-[var(--foreground)]">{label}</span>
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">{count}</span>
      </div>
      <div className="flex min-h-[3rem] flex-col gap-2 px-0.5 pb-1">{children}</div>
    </div>
  );
}

function DraggableCard({ task, onOpen }: { task: TaskDTO; onOpen: () => void }) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={`cursor-pointer touch-none ${isDragging ? 'opacity-40' : ''}`}
    >
      <TaskCard task={task} />
    </div>
  );
}
