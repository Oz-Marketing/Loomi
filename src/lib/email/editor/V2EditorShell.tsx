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
import { CustomBlocksProvider } from './CustomBlocksContext';
import { Canvas } from './Canvas';
import { ComponentPalette, type CustomBlockSummary } from './ComponentPalette';
import { BlockProperties } from './BlockProperties';
import { EmailSettings } from './EmailSettings';
import { OutlinePanel } from './OutlinePanel';
import { FormattingToolbar } from './FormattingToolbar';
import { ActionBar, type PreviewWidth } from './ActionBar';
import { Squares2X2Icon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import type { Block, BlockType, EmailTemplate } from '../types';
import type { PreviewContact } from '@/lib/preview-variables';

const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 360;
const SIDEBAR_STEP_PX = 24;

interface V2EditorShellProps {
  template: EmailTemplate;
  onChange: (next: EmailTemplate) => void;

  /** Account scope — drives the media-library picker inside the Image
   *  block's property control. */
  accountKey?: string | null;

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
    <EditorProvider
      template={props.template}
      onChange={props.onChange}
      accountKey={props.accountKey ?? null}
    >
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
    insertBlocks,
    accountKey,
  } = useEditor();
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);

  // ── saved reusable blocks ──
  //
  // Fetched once here rather than in the palette, because BOTH the list and the
  // drop handler need them: the palette renders the names, the handler needs the
  // subtree to insert. `subtrees` is a ref, not state — the drop handler reads
  // it during an event, and a re-render between fetch and drop would otherwise
  // be the difference between a block landing and nothing happening.
  const [customBlocks, setCustomBlocks] = React.useState<CustomBlockSummary[]>([]);
  const customBlocksRef = React.useRef<Map<string, Block[]>>(new Map());
  const loadCustomBlocks = React.useCallback(() => {
    const qs = accountKey ? `?accountKey=${encodeURIComponent(accountKey)}` : '';
    fetch(`/api/email-blocks${qs}`)
      .then((r) => (r.ok ? r.json() : { blocks: [] }))
      .then((j) => {
        const rows: Array<CustomBlockSummary & { doc?: string }> = Array.isArray(j.blocks) ? j.blocks : [];
        const map = new Map<string, Block[]>();
        for (const row of rows) {
          try {
                const parsed = JSON.parse(row.doc ?? '{}') as { blocks?: Block[] };
            if (Array.isArray(parsed.blocks) && parsed.blocks.length) {
              // Stamp the repeat onto the ROOT block of the inserted copy. The
              // template stores the block's content inline (copy-on-insert), so
              // without this the document has no way to say "this subtree is the
              // per-offer card" and the run would fall back to the built-in one.
              // Stamp the ROOT of the inserted copy with where it came from:
              // the name so the editor can label it, and the repeat so the run
              // can find it. The template stores block content inline, so
              // without these the document has no memory of either.
              const roots = parsed.blocks.map((b, i) =>
                i === 0
                  ? {
                      ...b,
                      props: {
                        ...b.props,
                        customBlockName: row.name,
                        ...(row.repeatOver ? { repeatOver: row.repeatOver } : {}),
                      },
                    }
                  : b,
              );
              map.set(row.id, roots);
            }
          } catch {
            // A block whose payload won't parse is simply not offered — better
            // than a chip that drops nothing.
          }
        }
        customBlocksRef.current = map;
        setCustomBlocks(rows.filter((r) => map.has(r.id)));
      })
      .catch(() => {
        customBlocksRef.current = new Map();
        setCustomBlocks([]);
      });
  }, [accountKey]);
  React.useEffect(() => loadCustomBlocks(), [loadCustomBlocks]);

  // Resizable sidebar — mirrors the HTML editor's split-pane resize behavior.
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

  const handleDragCancel = () => {
    setActiveDragId(null);
  };

  // Collision detection: prefer pointerWithin (only registers a hit if
  // the cursor is actually inside a droppable's rect), with
  // rectIntersection as a fallback for the thin drop-gap strips. When
  // the cursor is outside every droppable — i.e. dragged into the
  // sidebar, action bar, or canvas gutter — neither returns a match,
  // so `event.over` is null and the drop cancels cleanly. Replaces
  // closestCenter, which always picked the nearest block no matter how
  // far the cursor was.
  const collisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    if (within.length > 0) return within;
    return rectIntersection(args);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);

    const activeId = String(event.active.id);
    const overIdRaw = event.over ? String(event.over.id) : null;
    if (!overIdRaw) return; // pointer was outside any droppable — cancel
    if (activeId === overIdRaw) return;

    const isPaletteChip = activeId.startsWith('palette:');
    const chipType = isPaletteChip ? (activeId.slice('palette:'.length) as BlockType) : null;
    // A saved reusable block, dragged from the Custom blocks section. Its
    // subtree was fetched when the palette rendered, so dropping it is
    // synchronous like any other chip.
    const customId = activeId.startsWith('custom:') ? activeId.slice('custom:'.length) : null;
    const customBlocks = customId ? customBlocksRef.current.get(customId) : null;
    const isChip = !!chipType || !!customBlocks;

    /**
     * Place whatever is being dragged FROM the palette at `position`.
     *
     * One function so the seven drop targets below don't each have to know the
     * difference between a built-in chip and a saved block — a branch repeated
     * seven times is a branch that will be added to six of them next time.
     */
    const placeChip = (position: { parentId: string | null; afterId: string | null }) => {
      if (chipType) insertBlock(chipType, position);
      else if (customBlocks) insertBlocks(customBlocks, position);
    };

    // Empty top-level canvas
    if (overIdRaw === 'canvas-empty') {
      if (isChip) placeChip({ parentId: null, afterId: null });
      return;
    }

    // Between-block drop gaps — explicit insertion points at the top of
    // the canvas (`gap:start`) and after each top-level block
    // (`gap:after:<id>`). Containers + atoms both land at the exact
    // position; the indicator's location and the drop location agree by
    // construction.
    if (overIdRaw === 'gap:start') {
      if (isChip) {
        placeChip({ parentId: null, afterId: null });
      } else {
        moveBlock(activeId, { parentId: null, afterId: null });
      }
      return;
    }
    if (overIdRaw.startsWith('gap:after:')) {
      const afterId = overIdRaw.slice('gap:after:'.length);
      if (isChip) {
        placeChip({ parentId: null, afterId });
      } else {
        moveBlock(activeId, { parentId: null, afterId });
      }
      return;
    }

    // Empty section
    if (overIdRaw.startsWith('section-empty:')) {
      const sectionId = overIdRaw.slice('section-empty:'.length);
      if (isChip) {
        placeChip({ parentId: sectionId, afterId: null });
      } else {
        moveBlock(activeId, { parentId: sectionId, afterId: null });
      }
      return;
    }

    const overBlock = findBlock(template.blocks, overIdRaw);
    if (!overBlock) return;
    const overParent = findParentOf(template.blocks, overIdRaw);

    // Palette-chip drop on a real block
    if (isChip) {
      // Containers (Section / Grid) always drop at TOP LEVEL — never nest them
      // inside another section or grid. Place near the dropped-on block by
      // walking up to its top-level ancestor and inserting after it.
      //
      // A saved custom block counts as a container: it is a lockup of several
      // blocks, usually wrapped in a section, and nesting one inside another
      // section is how a card ends up inside a card.
      const isContainer = chipType === 'section' || chipType === 'columns' || !!customBlocks;
      if (isContainer) {
        const topLevelAncestor = findTopLevelAncestor(template.blocks, overIdRaw);
        placeChip({
          parentId: null,
          afterId: topLevelAncestor?.id ?? null,
        });
        return;
      }

      // Non-container chips: dropping onto a section appends to its children
      if (overBlock.type === 'section') {
        const lastChild = overBlock.children?.[overBlock.children.length - 1];
        placeChip({
          parentId: overBlock.id,
          afterId: lastChild?.id ?? null,
        });
        return;
      }
      // Otherwise insert after the over block, in its container
      placeChip({
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
    <CustomBlocksProvider refresh={loadCustomBlocks}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex w-full h-full min-h-0 gap-4">
          {/* Left sidebar: Palette OR Properties */}
          <SidebarContent width={sidebarWidth} customBlocks={customBlocks} />

          {/* Resize handle between sidebar and canvas */}
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

          {/* Canvas area — action bar + canvas */}
          <CanvasArea {...props} />
        </div>

        {/* Cancel hint — only shown while a drag is in flight. Reminds
            reps that releasing outside the email body (or hitting Esc)
            aborts the drop cleanly. */}
        {activeDragId && (
          <div
            aria-live="polite"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full bg-[var(--foreground)]/85 text-[var(--background)] text-[11px] font-medium shadow-lg pointer-events-none"
          >
            Drop outside the email or press <kbd className="font-mono">Esc</kbd> to cancel
          </div>
        )}

        <DragOverlay>
          {activeDragId && activeDragId.startsWith('palette:') ? (
            <DragChipPreview type={activeDragId.slice('palette:'.length)} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </CustomBlocksProvider>
  );
}

function CanvasArea(props: V2EditorShellProps) {
  const [previewWidth, setPreviewWidth] = React.useState<PreviewWidth>('desktop');
  const [zoom, setZoom] = React.useState(100);
  const [outlineOpen, setOutlineOpen] = React.useState(false);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="flex-1 flex flex-col border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)] min-w-0 min-h-0">
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
    </div>
  );
}

type PaletteTab = 'components' | 'settings';

function SidebarContent({ width, customBlocks }: { width: number; customBlocks: CustomBlockSummary[] }) {
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
            {paletteTab === 'components' ? <ComponentPalette customBlocks={customBlocks} /> : <EmailSettings />}
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
      {type}
    </div>
  );
}
