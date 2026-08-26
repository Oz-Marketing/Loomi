'use client';

import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { LandingPageEditorProvider, useLandingPageEditor } from './EditorContext';
import { Canvas } from './Canvas';
import { Sidebar } from './Sidebar';
import { PaletteIcon } from './PaletteIcon';
import { BLOCK_SCHEMA_BY_TYPE } from '../schemas';
import type { Block, LandingPageBlockType, LandingPageTemplate } from '../types';

/**
 * 3-pane editor shell: block palette on the left, canvas in the
 * middle, property panel on the right. A single shared DndContext
 * handles both palette-to-canvas drops (insert a new block) and
 * within-canvas reordering (move an existing block). Palette chips
 * carry id `palette:<type>`; existing blocks carry their own id from
 * useSortable in EditableBlock — handleDragEnd splits on that prefix.
 */
export interface LandingPageEditorShellProps {
  template: LandingPageTemplate;
  onChange: (next: LandingPageTemplate) => void;
  /** Account scope — drives the media-library picker inside the
   *  Image block's property control. */
  accountKey?: string | null;
  /** Undo/redo plumbing — surfaced in the canvas action bar, the
   *  same way the forms editor's FormActionBar exposes them. */
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

// Sidebar width constants — same shape as the forms editor.
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_STEP_PX = 24;

export function LandingPageEditorShell({
  template,
  onChange,
  accountKey,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: LandingPageEditorShellProps) {
  return (
    <LandingPageEditorProvider template={template} onChange={onChange} accountKey={accountKey}>
      <DndShell
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    </LandingPageEditorProvider>
  );
}

function DndShell({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: Pick<LandingPageEditorShellProps, 'canUndo' | 'canRedo' | 'onUndo' | 'onRedo'>) {
  const {
    template,
    selectedId,
    selectBlock,
    deleteBlock,
    duplicateBlock,
    insertBlock,
    reorderInParent,
    moveBlockTo,
  } = useLandingPageEditor();
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);

  // ── Resizable sidebar ──
  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH);
  const [isResizingSidebar, setIsResizingSidebar] = React.useState(false);
  const resizeStartRef = React.useRef<{ x: number; width: number } | null>(null);

  const clampSidebarWidth = React.useCallback(
    (desired: number) =>
      Math.round(Math.min(Math.max(desired, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH)),
    [],
  );

  const handleResizerMouseDown = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      resizeStartRef.current = { x: e.clientX, width: sidebarWidth };
      setIsResizingSidebar(true);
    },
    [sidebarWidth],
  );

  const adjustSidebarWidth = React.useCallback(
    (delta: number) => setSidebarWidth((prev) => clampSidebarWidth(prev + delta)),
    [clampSidebarWidth],
  );

  React.useEffect(() => {
    if (!isResizingSidebar || typeof window === 'undefined') return;
    const handleMouseMove = (e: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      setSidebarWidth(clampSidebarWidth(start.width + (e.clientX - start.x)));
    };
    const stopResizing = () => {
      resizeStartRef.current = null;
      setIsResizingSidebar(false);
    };
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResizing);
    window.addEventListener('blur', stopResizing);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('blur', stopResizing);
    };
  }, [isResizingSidebar, clampSidebarWidth]);

  // PointerSensor with an 8px activation distance so a click on a
  // block selects (and never accidentally starts a drag). Drags fire
  // only after a meaningful pointer move.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Block-level keyboard shortcuts. Bail when focus is inside a
  // text field — those handle their own Delete/Backspace/etc.
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === 'Escape') {
        if (selectedId) {
          event.preventDefault();
          selectBlock(null);
        }
        return;
      }

      if (!selectedId) return;

      // Cmd/Ctrl+D — duplicate. Browser default "bookmark page"
      // would otherwise fire; we preempt.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateBlock(selectedId);
        return;
      }

      // Delete / Backspace — remove the selected block.
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteBlock(selectedId);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, selectBlock, deleteBlock, duplicateBlock]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };
  const handleDragCancel = () => setActiveDragId(null);

  // Prefer pointerWithin so the thin drop gaps + section-empty zones
  // are easy hit targets; fall back to rectIntersection when the
  // pointer is outside any droppable (matches the forms editor).
  const collisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    if (within.length > 0) return within;
    return rectIntersection(args);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const isPaletteChip = activeId.startsWith('palette:');
    const chipType = isPaletteChip
      ? (activeId.slice('palette:'.length) as LandingPageBlockType)
      : null;

    // ── Palette chip → insert a new block ──
    if (chipType) {
      if (overId === 'canvas-empty') {
        insertBlock(chipType, { parentId: null, afterId: 'end' });
        return;
      }
      if (overId === 'gap:start') {
        insertBlock(chipType, { parentId: null, afterId: null });
        return;
      }
      if (overId.startsWith('gap:after:')) {
        const afterId = overId.slice('gap:after:'.length);
        insertBlock(chipType, { parentId: null, afterId });
        return;
      }
      if (overId.startsWith('section-empty:')) {
        const sectionId = overId.slice('section-empty:'.length);
        insertBlock(chipType, { parentId: sectionId, afterId: 'end' });
        return;
      }

      // Dropped onto an existing block (its useSortable id).
      const overBlock = findBlock(template.blocks, overId);
      if (!overBlock) return;

      // Containers (Section, Columns) always land at top level after
      // the dropped-on block's top-level ancestor — nesting a Section
      // inside another Section is not allowed in the LP schema.
      if (chipType === 'section' || chipType === 'columns') {
        const topAncestor = findTopLevelAncestor(template.blocks, overId);
        insertBlock(chipType, {
          parentId: null,
          afterId: topAncestor?.id ?? 'end',
        });
        return;
      }

      // Leaf chip dropped onto a Section → insert as last child of
      // that section.
      if (overBlock.type === 'section') {
        insertBlock(chipType, { parentId: overBlock.id, afterId: 'end' });
        return;
      }

      // Leaf chip dropped onto a leaf → insert after it in the same
      // parent (works for both top-level and nested leaves).
      const containing = findContainingList(template.blocks, overId);
      insertBlock(chipType, {
        parentId: containing?.parentId ?? null,
        afterId: overId,
      });
      return;
    }

    // ── Existing block → reorder / move ──
    // Drops on gaps and empty containers move the block to that exact
    // position. moveBlockTo guards against cycle-creating moves
    // (dropping a Section onto its own descendant).
    if (overId === 'gap:start') {
      moveBlockTo(activeId, { parentId: null, afterId: null });
      return;
    }
    if (overId.startsWith('gap:after:')) {
      const afterId = overId.slice('gap:after:'.length);
      moveBlockTo(activeId, { parentId: null, afterId });
      return;
    }
    if (overId.startsWith('section-empty:')) {
      const sectionId = overId.slice('section-empty:'.length);
      moveBlockTo(activeId, { parentId: sectionId, afterId: 'end' });
      return;
    }

    const activeParentList = findContainingList(template.blocks, activeId);
    const overParentList = findContainingList(template.blocks, overId);
    if (!activeParentList || !overParentList) return;

    // Same-parent reorder — preferred fast path since it doesn't
    // require remove-then-insert.
    if (activeParentList.parentId === overParentList.parentId) {
      const targetIndex = activeParentList.siblings.findIndex(
        (b) => b.id === overId,
      );
      if (targetIndex === -1) return;
      reorderInParent(activeId, targetIndex);
      return;
    }

    // Cross-container drag — moving a block from one Section/column
    // slot to a different one (or out to top level). Insert after the
    // hovered block within ITS parent.
    moveBlockTo(activeId, {
      parentId: overParentList.parentId,
      afterId: overId,
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      // Re-measure droppable rects on each drag move — the drop gaps
      // start at h-0 and expand to h-6 once a drag begins. The default
      // WhileDragging strategy caches rects at drag start, before the
      // gaps have re-rendered, so drops would never register on them.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex w-full h-full min-h-0 gap-4">
        <div
          className="flex-shrink-0 min-h-0 flex"
          style={{ width: `${sidebarWidth}px` }}
        >
          <Sidebar />
        </div>

        {/* Resize handle — drag to expand/contract the sidebar.
            Keyboard-accessible (Arrow keys nudge in SIDEBAR_STEP_PX
            steps when focused). Matches the forms editor pattern. */}
        <div
          role="separator"
          aria-label="Resize sidebar and canvas panes"
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          tabIndex={0}
          onMouseDown={handleResizerMouseDown}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              adjustSidebarWidth(-SIDEBAR_STEP_PX);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              adjustSidebarWidth(SIDEBAR_STEP_PX);
            }
          }}
          className={`group flex-shrink-0 self-stretch w-2 -mx-1 rounded cursor-col-resize transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] ${
            isResizingSidebar ? 'bg-[var(--primary)]/15' : 'hover:bg-[var(--muted)]'
          }`}
          title="Drag to resize sidebar"
        >
          <span
            className={`mx-auto block h-full w-[2px] rounded-full transition-colors ${
              isResizingSidebar
                ? 'bg-[var(--primary)]'
                : 'bg-[var(--border)] group-hover:bg-[var(--primary)]'
            }`}
          />
        </div>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)]">
          <Canvas canUndo={canUndo} canRedo={canRedo} onUndo={onUndo} onRedo={onRedo} />
        </div>
      </div>

      <DragOverlay>
        {activeDragId && activeDragId.startsWith('palette:') ? (
          <PaletteDragPreview
            type={activeDragId.slice('palette:'.length) as LandingPageBlockType}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function PaletteDragPreview({ type }: { type: LandingPageBlockType }) {
  const schema = BLOCK_SCHEMA_BY_TYPE[type];
  return (
    <div className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-[12px] font-semibold shadow-lg bg-[var(--primary)] text-[var(--primary-foreground)]">
      {schema ? <PaletteIcon name={schema.icon} className="w-4 h-4" /> : null}
      <span>{schema?.label ?? type}</span>
    </div>
  );
}

/**
 * Locate the sibling list containing the block with the given id.
 * Returns the parent's id (or null for top-level) plus the siblings
 * array. Used by the DnD handler to confirm same-parent drops.
 */
function findContainingList(
  blocks: Block[],
  id: string,
): { parentId: string | null; siblings: Block[] } | null {
  if (blocks.some((b) => b.id === id)) {
    return { parentId: null, siblings: blocks };
  }
  for (const b of blocks) {
    if (!b.children) continue;
    if (b.children.some((c) => c.id === id)) {
      return { parentId: b.id, siblings: b.children };
    }
    const deeper = findContainingList(b.children, id);
    if (deeper) return deeper;
  }
  return null;
}

/** Walk the tree to find a block by id. */
function findBlock(blocks: Block[], id: string): Block | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) {
      const inner = findBlock(b.children, id);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** Find the top-level block that contains (or equals) the given id.
 *  Used when a palette container chip (Section / Columns) is dropped
 *  onto a nested block — the new container goes after the top-level
 *  ancestor instead of being nested inside it. */
function findTopLevelAncestor(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children && containsId(b.children, id)) return b;
  }
  return null;
}

function containsId(blocks: Block[], id: string): boolean {
  for (const b of blocks) {
    if (b.id === id) return true;
    if (b.children && containsId(b.children, id)) return true;
  }
  return false;
}
