'use client';

import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { LandingPageEditorProvider, useLandingPageEditor } from './EditorContext';
import { BlockPalette } from './BlockPalette';
import { Canvas } from './Canvas';
import { PropertyPanel } from './PropertyPanel';
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
}

export function LandingPageEditorShell({
  template,
  onChange,
}: LandingPageEditorShellProps) {
  return (
    <LandingPageEditorProvider template={template} onChange={onChange}>
      <DndShell />
    </LandingPageEditorProvider>
  );
}

function DndShell() {
  const { template, reorderInParent, moveBlockTo } = useLandingPageEditor();

  // PointerSensor with an 8px activation distance so a click on a
  // block selects (and never accidentally starts a drag). Drags fire
  // only after a meaningful pointer move.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

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
      <div className="flex-1 min-h-0 flex">
        <div className="w-[260px] flex-shrink-0">
          <BlockPalette />
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <Canvas />
        </div>
        <div className="w-[320px] flex-shrink-0">
          <PropertyPanel />
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
