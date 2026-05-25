'use client';

import * as React from 'react';
import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { LandingPageEditorProvider, useLandingPageEditor } from './EditorContext';
import { Canvas } from './Canvas';
import { Sidebar } from './Sidebar';
import type { LandingPageTemplate } from '../types';

/**
 * 3-pane editor shell: block palette on the left, canvas in the
 * middle, property panel on the right. The DndContext wrapper makes
 * blocks draggable to reorder within their parent — palette-to-canvas
 * dragging stays click-to-insert for now (which suits the dense
 * marketing-block library, and dnd-kit's drag-overlay UX would need
 * more thought for blocks that take up half a screen each).
 */
export interface LandingPageEditorShellProps {
  template: LandingPageTemplate;
  onChange: (next: LandingPageTemplate) => void;
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
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: LandingPageEditorShellProps) {
  return (
    <LandingPageEditorProvider template={template} onChange={onChange}>
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
    reorderInParent,
    moveBlockTo,
  } = useLandingPageEditor();

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

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

    // Cross-container drag — the user is moving a block from one
    // Section/column slot to a different one (or out to top level).
    // Insert after the hovered block within ITS parent. cycle-prevention
    // lives in moveBlockTo (rejects dropping a Section onto its own
    // descendant — would corrupt the tree).
    moveBlockTo(activeId, {
      parentId: overParentList.parentId,
      afterId: overId,
    });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex w-full h-full min-h-0 gap-2 p-4">
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
    </DndContext>
  );
}

/**
 * Locate the sibling list containing the block with the given id.
 * Returns the parent's id (or null for top-level) plus the siblings
 * array. Used by the DnD handler to confirm same-parent drops.
 */
function findContainingList(
  blocks: import('../types').Block[],
  id: string,
): { parentId: string | null; siblings: import('../types').Block[] } | null {
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
