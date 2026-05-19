'use client';

import * as React from 'react';
import { useDroppable, useDndContext } from '@dnd-kit/core';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useEditor } from './EditorContext';

/**
 * Drop strip rendered between top-level blocks (and at the very top + bottom
 * of the canvas). Solves two pain points at once:
 *
 *   1. **Drop targeting** — the gap is its own droppable, so dropping
 *      "between" two blocks lands on a single explicit target instead of
 *      relying on closestCenter to pick the right neighbour. The strip
 *      expands during any active drag to give a fat hit area; outside of
 *      a drag it sits at ~6px so block spacing stays tight.
 *
 *   2. **Quick add** — a "+" button appears on hover (or always during a
 *      drag) that opens a tiny Section / Grid picker. Inserts a new
 *      container at this exact position so the rep doesn't have to drag
 *      from the left palette.
 *
 * Droppable ID format:
 *   - `gap:start`          → insert at the very top of the canvas
 *   - `gap:after:<blockId>` → insert immediately after that top-level block
 */
export function BlockDropGap({
  position,
  afterId = null,
}: {
  /** "start" = above first block. "after" = below the block with afterId. */
  position: 'start' | 'after';
  afterId?: string | null;
}) {
  const id =
    position === 'start' ? 'gap:start' : `gap:after:${afterId ?? ''}`;
  const { setNodeRef, isOver } = useDroppable({ id });
  const { active } = useDndContext();
  const isDragging = active != null;

  const [menuOpen, setMenuOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const { insertBlock } = useEditor();

  // Close the menu on outside click + Esc — small DIY popover, no portal.
  React.useEffect(() => {
    if (!menuOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const insertAt = (type: 'section' | 'columns') => {
    insertBlock(type, {
      parentId: null,
      afterId: position === 'start' ? null : afterId,
    });
    setMenuOpen(false);
  };

  // Use a refCallback to bind both the droppable ref and our local ref.
  const combinedRef = (node: HTMLDivElement | null) => {
    wrapperRef.current = node;
    setNodeRef(node);
  };

  return (
    <div
      ref={combinedRef}
      data-block-drop-gap=""
      className={`relative group transition-[height,margin] duration-150 ease-out ${
        isDragging ? 'h-6 my-0.5' : 'h-1.5 my-0'
      }`}
      style={{ minHeight: isDragging ? 24 : 6 }}
    >
      {/* Active drop indicator — visible when something is being dragged
          over this gap. Replaces the per-block bottom-edge line so the
          insertion preview always agrees with where the drop will land. */}
      <div
        aria-hidden="true"
        className={`absolute inset-x-3 top-1/2 -translate-y-1/2 rounded-full transition-[height,opacity] duration-150 pointer-events-none ${
          isOver
            ? 'h-1 bg-[var(--primary)] opacity-100 shadow-[0_0_10px_var(--primary)]'
            : isDragging
              ? 'h-0.5 bg-[var(--primary)]/30 opacity-100'
              : 'h-0 opacity-0'
        }`}
      />

      {/* Hover affordance: faint horizontal line + centered "+" button
          to insert a Section / Grid inline. Hidden during an active drag
          so it doesn't fight with the drop indicator. */}
      {!isDragging && (
        <div
          aria-hidden={!menuOpen}
          className={`absolute inset-x-3 top-1/2 -translate-y-1/2 flex items-center gap-2 transition-opacity duration-150 ${
            menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <div className="flex-1 h-px bg-[var(--primary)]/40" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            className="relative inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-md hover:scale-110 transition-transform"
            title="Insert Section or Grid"
            aria-label="Insert Section or Grid"
            aria-expanded={menuOpen}
          >
            <PlusIcon className="w-3.5 h-3.5" />
          </button>
          <div className="flex-1 h-px bg-[var(--primary)]/40" />
        </div>
      )}

      {/* Popover menu — positioned just above the "+" button. Two items:
          Section and Grid. Clicking either inserts at this exact position
          and closes the menu. */}
      {menuOpen && (
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-2 -translate-y-full z-30 min-w-[180px] glass-modal rounded-lg shadow-xl"
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => insertAt('section')}
            className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] rounded-t-lg transition-colors"
            role="menuitem"
          >
            <span className="font-medium">Section</span>
            <span className="block text-[10px] text-[var(--muted-foreground)] mt-0.5">
              Single-column container for components
            </span>
          </button>
          <div className="border-t border-[var(--border)]" />
          <button
            type="button"
            onClick={() => insertAt('columns')}
            className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] rounded-b-lg transition-colors"
            role="menuitem"
          >
            <span className="font-medium">Grid</span>
            <span className="block text-[10px] text-[var(--muted-foreground)] mt-0.5">
              Two-column row that stacks on mobile
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
