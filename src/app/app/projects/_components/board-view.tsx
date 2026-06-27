'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
    if (!e.over) return;
    const overId = String(e.over.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Dropping on a column header/empty area → that column, at the end.
    // Dropping on/near a card → that card's column, at its slot.
    const isColumn = STATUSES.some((s) => s.key === overId);
    const destCol = isColumn ? overId : tasks.find((t) => t.id === overId)?.status ?? task.status;

    // Dest column order, excluding the dragged task, to find neighbors.
    const destItems = (byStatus[destCol] ?? []).filter((t) => t.id !== taskId);
    let index = destItems.length;
    if (!isColumn) {
      const overIdx = destItems.findIndex((t) => t.id === overId);
      if (overIdx !== -1) index = overIdx;
    }
    const before = destItems[index - 1];
    const after = destItems[index];
    let position: number;
    if (before && after) position = (before.position + after.position) / 2;
    else if (before) position = before.position + 1000;
    else if (after) position = after.position - 1000;
    else position = 0;

    if (destCol === task.status && position === task.position) return;

    mutate(
      { tasks: tasks.map((t) => (t.id === taskId ? { ...t, status: destCol, position } : t)) },
      { revalidate: false },
    );
    try {
      const res = await fetch(`/api/projects/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: destCol, position }),
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
        collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {/* Full-bleed to the surface card's edges (cancel its px-6/md:px-8
            gutter) with a soft fade so cards scroll off to the page edge
            instead of clipping inside the padding. */}
        <div className="flex flex-1 gap-3 overflow-x-auto pb-4 -mx-6 px-6 md:-mx-8 md:px-8 [mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1rem),transparent)]">
          {STATUSES.map((s) => (
            <Column key={s.key} status={s.key} label={s.label} dot={s.dot} count={byStatus[s.key]?.length ?? 0}>
              <SortableContext
                items={(byStatus[s.key] ?? []).map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {(byStatus[s.key] ?? []).map((t) => (
                  <SortableCard key={t.id} task={t} onOpen={() => router.push(`/projects/tasks/${t.id}`)} />
                ))}
              </SortableContext>
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

function SortableCard({ task, onOpen }: { task: TaskDTO; onOpen: () => void }) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
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
