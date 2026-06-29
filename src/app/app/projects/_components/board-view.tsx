'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { KeyedMutator } from 'swr';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from '@/lib/toast';
import { STATUSES } from '@/lib/projects/ui';
import type { TaskDTO } from '@/lib/services/projects';
import { matchesFilters, type TaskFilters } from './filter-bar';
import { TaskCard } from './task-card';

const isColumnId = (id: string) => STATUSES.some((s) => s.key === id);

// Pointer-first collision: the droppable the cursor is actually inside wins
// (accurate for both column hover and within-column reorder). Falls back to
// rect-intersection only when the pointer is in a gap (e.g. fast drag). This
// replaces closestCorners, which lit up whichever column had the nearest corner
// even when the cursor was elsewhere. When the pointer is over a card AND its
// column at once, the card wins — so cross-column drops land between tasks
// instead of always at the end.
const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const list = hits.length > 0 ? hits : rectIntersection(args);
  const cards = list.filter((c) => !isColumnId(String(c.id)));
  return cards.length > 0 ? cards : list;
};

/**
 * Presentational kanban board — the parent (TasksView) owns the filter bar,
 * data fetch, and account scoping; this renders + drives the drag-and-drop and
 * persists status/position changes via the shared `mutate`.
 */
export function BoardBody({
  tasks,
  isLoading,
  mutate,
  filters,
}: {
  tasks: TaskDTO[];
  isLoading: boolean;
  mutate: KeyedMutator<{ tasks: TaskDTO[] }>;
  filters: TaskFilters;
}) {
  const router = useRouter();

  // Portal target for the DragOverlay — only after mount (document isn't
  // available during SSR). Portaling to <body> keeps the overlay out of the
  // board's scroll containers, so dnd-kit's fixed-position base coordinate
  // matches the card's true viewport rect instead of drifting by scrollLeft.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [activeId, setActiveId] = useState<string | null>(null);
  // Live arrangement of card ids per column DURING a drag. null when idle, when
  // we render straight from server data. While dragging, onDragOver mutates this
  // so the dragged card visibly hops into the hovered column and its cards part
  // to reveal the drop slot — enabling drop-between-cards across columns.
  const [order, setOrder] = useState<Record<string, string[]> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag: focus a card, Space to lift, arrows to move, Space to drop.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const tasksById = useMemo(() => {
    const m: Record<string, TaskDTO> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  // Server-derived card ids per column (filtered).
  const baseOrder = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const s of STATUSES) map[s.key] = [];
    for (const t of tasks) {
      if (!matchesFilters(t, filters)) continue;
      (map[t.status] ??= []).push(t.id);
    }
    return map;
  }, [tasks, filters]);

  // What we render: the live drag arrangement if mid-drag, else the server one.
  const view = order ?? baseOrder;

  // Which column an id lives in, within a given arrangement.
  function containerOf(id: string, state: Record<string, string[]>): string | null {
    if (isColumnId(id)) return id;
    for (const key of Object.keys(state)) {
      if (state[key].includes(id)) return key;
    }
    return null;
  }

  const activeTask = activeId ? tasksById[activeId] ?? null : null;
  const overCol = activeId ? containerOf(activeId, view) : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    // Snapshot the current arrangement to mutate live.
    setOrder(Object.fromEntries(Object.entries(baseOrder).map(([k, v]) => [k, [...v]])));
  }

  // Cross-column only: move the dragged card into the hovered column at the
  // pointer's slot. Same-column reordering is left to the sortable strategy's
  // visual shift and finalized in onDragEnd (the canonical dnd-kit pattern).
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    setOrder((prev) => {
      const state = prev ?? Object.fromEntries(Object.entries(baseOrder).map(([k, v]) => [k, [...v]]));
      const from = containerOf(activeIdStr, state);
      const to = containerOf(overIdStr, state);
      if (!from || !to || from === to) return state;

      const fromItems = state[from].filter((id) => id !== activeIdStr);
      const toItems = state[to].filter((id) => id !== activeIdStr);
      let insertAt = toItems.length; // empty column / over the column itself → end
      if (!isColumnId(overIdStr)) {
        const overIdx = toItems.indexOf(overIdStr);
        if (overIdx !== -1) {
          // Insert before/after the hovered card based on pointer vs its midpoint.
          const overRect = over.rect;
          const activeRect = active.rect.current.translated;
          const below =
            activeRect && overRect ? activeRect.top > overRect.top + overRect.height / 2 : false;
          insertAt = overIdx + (below ? 1 : 0);
        }
      }
      toItems.splice(insertAt, 0, activeIdStr);
      return { ...state, [from]: fromItems, [to]: toItems };
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const taskId = String(active.id);
    const state = order ?? baseOrder;
    setActiveId(null);
    setOrder(null);
    if (!over) return;
    const task = tasksById[taskId];
    if (!task) return;

    const destCol = containerOf(taskId, state) ?? task.status;
    let finalIds = [...(state[destCol] ?? [])];
    const overId = String(over.id);
    // Same-column final placement: arrayMove the dragged card to the hovered
    // card's slot (onDragOver only handled cross-column).
    if (!isColumnId(overId)) {
      const fromIdx = finalIds.indexOf(taskId);
      const toIdx = finalIds.indexOf(overId);
      if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
        finalIds = arrayMove(finalIds, fromIdx, toIdx);
      }
    }

    const idx = finalIds.indexOf(taskId);
    const before = idx > 0 ? tasksById[finalIds[idx - 1]] : undefined;
    const after = idx < finalIds.length - 1 ? tasksById[finalIds[idx + 1]] : undefined;
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
    <div className="flex min-h-0 flex-1 flex-col">
      <DndContext
        sensors={sensors}
        collisionDetection={boardCollision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setOrder(null);
        }}
      >
        {/* Full-bleed to the surface card's edges (cancel its px-6/md:px-8
            gutter) with a soft fade so cards scroll off to the page edge
            instead of clipping inside the padding. */}
        <div className="flex flex-1 gap-3 overflow-x-auto pb-4 -mx-6 px-6 md:-mx-8 md:px-8 [mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1rem),transparent)]">
          {STATUSES.map((s) => {
            const ids = view[s.key] ?? [];
            return (
              <Column
                key={s.key}
                status={s.key}
                label={s.label}
                dot={s.dot}
                count={ids.length}
                highlighted={overCol === s.key && activeId !== null}
              >
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  {ids.map((id) => {
                    const t = tasksById[id];
                    if (!t) return null;
                    return (
                      <SortableCard
                        key={id}
                        task={t}
                        onOpen={() => router.push(`/projects/tasks/${id}`)}
                      />
                    );
                  })}
                </SortableContext>
                {!isLoading && ids.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-[var(--muted-foreground)]">Nothing here</p>
                )}
              </Column>
            );
          })}
        </div>
        {mounted &&
          createPortal(
            <DragOverlay dropAnimation={null}>
              {activeTask ? (
                // No explicit width — DragOverlay sizes the wrapper to the
                // dragged card's measured rect, so the overlay sits exactly
                // under the cursor. The card's --card bg is translucent (~62%),
                // so it'd look see-through floating over the page; back it with
                // a solid --background layer (rounded to match) + shadow.
                // Tilted, grabbing cursor.
                <div className="rotate-3 cursor-grabbing rounded-xl bg-[var(--background)] shadow-2xl">
                  <TaskCard task={activeTask} />
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>
    </div>
  );
}

function Column({
  status,
  label,
  dot,
  count,
  highlighted,
  children,
}: {
  status: string;
  label: string;
  dot: string;
  count: number;
  highlighted: boolean;
  children: React.ReactNode;
}) {
  // Still a droppable (so empty columns are valid drop targets), but the
  // highlight is driven by the parent's derived overCol, not this hook's isOver
  // — `over` is usually a card, so isOver rarely matches the hovered column.
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 flex-shrink-0 flex-col rounded-2xl border p-2 transition ${
        highlighted
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
      aria-label={`${task.title} — draggable task`}
      className={`touch-none cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
        isDragging ? 'cursor-grabbing opacity-40' : ''
      }`}
    >
      <TaskCard task={task} />
    </div>
  );
}
