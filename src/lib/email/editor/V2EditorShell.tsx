'use client';

import * as React from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import { EditorProvider, useEditor, findBlock, findParentOf, findTopLevelAncestor } from './EditorContext';
import { Canvas } from './Canvas';
import { ComponentPalette } from './ComponentPalette';
import { BlockProperties } from './BlockProperties';
import { EmailSettings } from './EmailSettings';
import { OutlinePanel } from './OutlinePanel';
import { FormattingToolbar } from './FormattingToolbar';
import { ActionBar, type PreviewWidth } from './ActionBar';
import { Squares2X2Icon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import type { BlockType, EmailTemplate } from '../types';
import type { PreviewContact } from '@/lib/preview-variables';

interface V2EditorShellProps {
  template: EmailTemplate;
  onChange: (next: EmailTemplate) => void;

  // Optional action bar wiring — passed from the editor page so the existing
  // global state (history, contacts, copy) integrates without duplication.
  previewContacts?: PreviewContact[];
  selectedContactId?: string | null;
  onSelectContact?: (id: string) => void;
  onReloadContacts?: () => void;
  contactsLoading?: boolean;
  previewValues?: Record<string, string>;

  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;

  onCopyHtml?: () => void;
  copied?: boolean;
}

/**
 * Top-level shell for the v2 visual editor.
 *
 * Layout:
 *   [ Left sidebar: Palette OR selected block's properties ]   [ Canvas ]
 *
 * Single shared DndContext lets users drag palette chips onto the canvas
 * AND reorder existing blocks within the canvas.
 */
export function V2EditorShell(props: V2EditorShellProps) {
  return (
    <EditorProvider template={props.template} onChange={props.onChange}>
      <DndShell {...props} />
    </EditorProvider>
  );
}

function DndShell(props: V2EditorShellProps) {
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  // Keyboard shortcuts: Delete / Backspace = delete selected, Cmd+D = duplicate, Esc = deselect.
  // Disabled while focus is in form fields so prop editing isn't disrupted.
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

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);

    const activeId = String(event.active.id);
    const overIdRaw = event.over ? String(event.over.id) : null;
    if (!overIdRaw) return;
    if (activeId === overIdRaw) return;

    const isPaletteChip = activeId.startsWith('palette:');
    const chipType = isPaletteChip ? (activeId.slice('palette:'.length) as BlockType) : null;

    // Empty top-level canvas
    if (overIdRaw === 'canvas-empty') {
      if (chipType) insertBlock(chipType, { parentId: null, afterId: null });
      return;
    }

    // Empty section
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

    // Palette-chip drop on a real block
    if (chipType) {
      // Containers (Section / Grid) always drop at TOP LEVEL — never nest them
      // inside another section or grid. Place near the dropped-on block by
      // walking up to its top-level ancestor and inserting after it.
      const isContainer = chipType === 'section' || chipType === 'columns';
      if (isContainer) {
        const topLevelAncestor = findTopLevelAncestor(template.blocks, overIdRaw);
        insertBlock(chipType, {
          parentId: null,
          afterId: topLevelAncestor?.id ?? null,
        });
        return;
      }

      // Non-container chips: dropping onto a section appends to its children
      if (overBlock.type === 'section') {
        const lastChild = overBlock.children?.[overBlock.children.length - 1];
        insertBlock(chipType, {
          parentId: overBlock.id,
          afterId: lastChild?.id ?? null,
        });
        return;
      }
      // Otherwise insert after the over block, in its container
      insertBlock(chipType, {
        parentId: overParent?.id ?? null,
        afterId: overIdRaw,
      });
      return;
    }

    // Existing block reorder
    const activeParent = findParentOf(template.blocks, activeId);
    const sameContainer = (activeParent?.id ?? null) === (overParent?.id ?? null);

    if (sameContainer) {
      const containerBlocks = activeParent?.children ?? template.blocks;
      const without = containerBlocks.filter((b) => b.id !== activeId);
      const overIdxInWithout = without.findIndex((b) => b.id === overIdRaw);
      const afterId = overIdxInWithout === -1 ? null : without[overIdxInWithout].id;
      moveBlock(activeId, { parentId: activeParent?.id ?? null, afterId });
    } else {
      // Cross-container: place active after over block in over's parent
      moveBlock(activeId, {
        parentId: overParent?.id ?? null,
        afterId: overIdRaw,
      });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex w-full h-full min-h-0 bg-[var(--background)]">
        {/* Left sidebar: Palette OR Properties */}
        <SidebarContent />

        {/* Canvas area — action bar + canvas */}
        <CanvasArea {...props} />
      </div>

      <DragOverlay>
        {activeDragId && activeDragId.startsWith('palette:') ? (
          <DragChipPreview type={activeDragId.slice('palette:'.length)} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function CanvasArea(props: V2EditorShellProps) {
  const [previewWidth, setPreviewWidth] = React.useState<PreviewWidth>('desktop');
  const [zoom, setZoom] = React.useState(100);
  const [outlineOpen, setOutlineOpen] = React.useState(false);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <ActionBar
        previewContacts={props.previewContacts}
        selectedContactId={props.selectedContactId}
        onSelectContact={props.onSelectContact}
        onReloadContacts={props.onReloadContacts}
        contactsLoading={props.contactsLoading}
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
        onCopyHtml={props.onCopyHtml}
        copied={props.copied}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen((v) => !v)}
      />
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        <Canvas
          previewWidth={previewWidth}
          zoom={zoom}
          previewValues={props.previewValues}
        />
        {/* Floating, centered formatting pill — only renders for text/heading blocks */}
        <FormattingToolbar />
        {outlineOpen && <OutlinePanel onClose={() => setOutlineOpen(false)} />}
      </div>
    </div>
  );
}

type PaletteTab = 'components' | 'settings';

function SidebarContent() {
  const { selectedId } = useEditor();
  const [paletteTab, setPaletteTab] = React.useState<PaletteTab>('components');

  return (
    <aside className="w-[360px] flex-shrink-0 border-r border-[var(--border)] overflow-y-auto bg-[var(--card)]">
      {selectedId ? (
        <BlockProperties />
      ) : (
        <div className="flex flex-col">
          {/* Top tabs: Components / Settings */}
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
          {paletteTab === 'components' ? <ComponentPalette /> : <EmailSettings />}
        </div>
      )}
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
      {type}
    </div>
  );
}
