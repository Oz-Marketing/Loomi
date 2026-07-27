'use client';

import * as React from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import { EditorProvider, useEditor, findBlock, findParentOf, findTopLevelAncestor } from './EditorContext';
import { Canvas } from './Canvas';
import { ComponentPalette } from './ComponentPalette';
import { BlockProperties } from './BlockProperties';
import { FormSettings } from './FormSettings';
import { OutlinePanel } from './OutlinePanel';
import { FormattingToolbar } from './FormattingToolbar';
import { FormActionBar, type PreviewWidth } from './FormActionBar';
import { Squares2X2Icon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import type { FormBlockType, FormTemplate } from '../types';

const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 360;
const SIDEBAR_STEP_PX = 24;

interface FormEditorShellProps {
  template: FormTemplate;
  onChange: (next: FormTemplate) => void;

  /** Account scope — drives the media-library picker inside the Image
   *  block's property control. */
  accountKey?: string | null;

  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;

  /** Public URL for the form (e.g. /f/<slug>). Drives the "Open live form" link in the action bar. */
  publicUrl?: string | null;
  /** Iframe embed snippet — drives the copy-snippet button in the action bar. */
  embedSnippet?: string | null;
}

/**
 * Top-level shell for the forms visual editor.
 *
 * Layout:
 *   [ Left sidebar: Palette OR selected block's properties ]   [ Canvas ]
 *
 * Single shared DndContext lets users drag palette chips onto the canvas
 * AND reorder existing blocks within the canvas. Mirrors the email
 * editor's V2EditorShell — duplicated rather than shared so each surface
 * can evolve independently.
 */
export function FormEditorShell(props: FormEditorShellProps) {
  return (
    <EditorProvider
      template={props.template}
      onChange={props.onChange}
      accountKey={props.accountKey ?? null}
    >
      <DndShell {...props} />
    </EditorProvider>
  );
}

function DndShell(props: FormEditorShellProps) {
  const {
    template,
    selectedId,
    insertBlock,
    moveBlock,
    selectBlock,
    deleteBlock,
    duplicateBlock,
  } = useEditor();
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);

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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  React.useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    };

    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === 'Escape') {
        selectBlock(null);
        return;
      }
      if (!selectedId) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteBlock(selectedId);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        duplicateBlock(selectedId);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, selectBlock, deleteBlock, duplicateBlock]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
  };

  const collisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    if (within.length > 0) return within;
    return rectIntersection(args);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);

    const activeId = String(event.active.id);
    const overIdRaw = event.over ? String(event.over.id) : null;
    if (!overIdRaw) return;
    if (activeId === overIdRaw) return;

    const isPaletteChip = activeId.startsWith('palette:');
    const chipType = isPaletteChip ? (activeId.slice('palette:'.length) as FormBlockType) : null;

    if (overIdRaw === 'canvas-empty') {
      if (chipType) insertBlock(chipType, { parentId: null, afterId: null });
      return;
    }

    if (overIdRaw === 'gap:start') {
      if (chipType) {
        insertBlock(chipType, { parentId: null, afterId: null });
      } else {
        moveBlock(activeId, { parentId: null, afterId: null });
      }
      return;
    }
    if (overIdRaw.startsWith('gap:after:')) {
      const afterId = overIdRaw.slice('gap:after:'.length);
      if (chipType) {
        insertBlock(chipType, { parentId: null, afterId });
      } else {
        moveBlock(activeId, { parentId: null, afterId });
      }
      return;
    }

    if (overIdRaw.startsWith('section-empty:')) {
      const sectionId = overIdRaw.slice('section-empty:'.length);
      if (chipType) {
        insertBlock(chipType, { parentId: sectionId, afterId: null });
      } else {
        moveBlock(activeId, { parentId: sectionId, afterId: null });
      }
      return;
    }

    const overBlock = findBlock(template.blocks, overIdRaw);
    if (!overBlock) return;
    const overParent = findParentOf(template.blocks, overIdRaw);

    if (chipType) {
      // Containers (section/columns) always land at top level — never nested.
      const isContainer = chipType === 'section' || chipType === 'columns';
      if (isContainer) {
        const topLevelAncestor = findTopLevelAncestor(template.blocks, overIdRaw);
        insertBlock(chipType, {
          parentId: null,
          afterId: topLevelAncestor?.id ?? null,
        });
        return;
      }

      if (overBlock.type === 'section') {
        const lastChild = overBlock.children?.[overBlock.children.length - 1];
        insertBlock(chipType, {
          parentId: overBlock.id,
          afterId: lastChild?.id ?? null,
        });
        return;
      }
      insertBlock(chipType, {
        parentId: overParent?.id ?? null,
        afterId: overIdRaw,
      });
      return;
    }

    const activeParent = findParentOf(template.blocks, activeId);
    const sameContainer = (activeParent?.id ?? null) === (overParent?.id ?? null);

    if (sameContainer) {
      const containerBlocks = activeParent?.children ?? template.blocks;
      const without = containerBlocks.filter((b) => b.id !== activeId);
      const overIdxInWithout = without.findIndex((b) => b.id === overIdRaw);
      const afterId = overIdxInWithout === -1 ? null : without[overIdxInWithout].id;
      moveBlock(activeId, { parentId: activeParent?.id ?? null, afterId });
    } else {
      moveBlock(activeId, {
        parentId: overParent?.id ?? null,
        afterId: overIdRaw,
      });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex w-full h-full min-h-0 gap-4">
        <SidebarContent width={sidebarWidth} />

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

        <CanvasArea {...props} />
      </div>

      {activeDragId && (
        <div
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full bg-[var(--foreground)]/85 text-[var(--background)] text-[11px] font-medium shadow-lg pointer-events-none"
        >
          Drop outside the form or press <kbd className="font-mono">Esc</kbd> to cancel
        </div>
      )}

      <DragOverlay>
        {activeDragId && activeDragId.startsWith('palette:') ? (
          <DragChipPreview type={activeDragId.slice('palette:'.length)} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function CanvasArea(props: FormEditorShellProps) {
  const [previewWidth, setPreviewWidth] = React.useState<PreviewWidth>('desktop');
  const [zoom, setZoom] = React.useState(100);
  const [outlineOpen, setOutlineOpen] = React.useState(false);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="flex-1 flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)] min-w-0 min-h-0">
        <FormActionBar
          previewWidth={previewWidth}
          onChangePreviewWidth={setPreviewWidth}
          zoom={zoom}
          onZoomIn={() => setZoom((z) => Math.min(200, z + 10))}
          onZoomOut={() => setZoom((z) => Math.max(50, z - 10))}
          onZoomReset={() => setZoom(100)}
          canUndo={props.canUndo}
          canRedo={props.canRedo}
          onUndo={props.onUndo}
          onRedo={props.onRedo}
          publicUrl={props.publicUrl}
          embedSnippet={props.embedSnippet}
          outlineOpen={outlineOpen}
          onToggleOutline={() => setOutlineOpen((v) => !v)}
        />
        <div className="flex-1 min-h-0 flex overflow-hidden relative">
          <Canvas previewWidth={previewWidth} zoom={zoom} />
          <FormattingToolbar />
          {outlineOpen && <OutlinePanel onClose={() => setOutlineOpen(false)} />}
        </div>
      </div>
    </div>
  );
}

type PaletteTab = 'components' | 'settings';

function SidebarContent({ width }: { width: number }) {
  const { selectedId } = useEditor();
  const [paletteTab, setPaletteTab] = React.useState<PaletteTab>('components');

  return (
    <aside
      className="flex-shrink-0 flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)] min-h-0"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        {selectedId ? (
          <BlockProperties />
        ) : (
          <div className="flex flex-col">
            <div className="flex border-b border-[var(--border)]">
              <PaletteTabButton
                active={paletteTab === 'components'}
                onClick={() => setPaletteTab('components')}
                icon={<Squares2X2Icon className="w-4 h-4" />}
                label="Components"
              />
              <PaletteTabButton
                active={paletteTab === 'settings'}
                onClick={() => setPaletteTab('settings')}
                icon={<Cog6ToothIcon className="w-4 h-4" />}
                label="Settings"
              />
            </div>
            {paletteTab === 'components' ? <ComponentPalette /> : <FormSettings />}
          </div>
        )}
      </div>
    </aside>
  );
}

function PaletteTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 ${
        active
          ? 'border-[var(--primary)] text-[var(--foreground)]'
          : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function DragChipPreview({ type }: { type: string }) {
  return (
    <div className="px-3.5 py-2 rounded-md text-[13px] font-semibold capitalize shadow-lg bg-[var(--primary)] text-[var(--primary-foreground)]">
      {type.replace(/^field_/, '').replace(/_/g, ' ')}
    </div>
  );
}
