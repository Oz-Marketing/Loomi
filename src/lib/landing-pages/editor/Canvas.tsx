'use client';

import * as React from 'react';
import {
  ChevronUpIcon,
  ChevronDownIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  Bars3Icon,
} from '@heroicons/react/24/outline';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLandingPageEditor } from './EditorContext';
import { BLOCK_COMPONENTS } from '../components';
import { SectionBlock } from '../components/Section';
import { ColumnsBlock } from '../components/Columns';
import type { Block } from '../types';

/**
 * Editor canvas. Renders the template using the real block
 * components, wraps each block in an EditableBlock that adds:
 *  - selection ring on click
 *  - hover halo
 *  - floating control rail (drag-handle / up / down / duplicate /
 *    delete)
 *
 * Each container (top level, Section children, column-slot children)
 * is a SortableContext, so blocks reorder via drag-and-drop within
 * their immediate parent. Cross-container drags aren't supported in
 * this iteration — the DnD handler in LandingPageEditorShell rejects
 * drops that would move a block between parents.
 *
 * Page-level settings (bg, font, max width, brand color) wrap the
 * tree so the editor matches LandingPageRenderer pixel-for-pixel.
 */
type PreviewWidth = 'desktop' | 'mobile';

const MOBILE_PREVIEW_WIDTH = 390;

export function Canvas() {
  const { template, selectBlock } = useLandingPageEditor();
  const s = template.settings;
  const [previewWidth, setPreviewWidth] = React.useState<PreviewWidth>('desktop');

  const effectiveMaxWidth =
    previewWidth === 'mobile'
      ? Math.min(MOBILE_PREVIEW_WIDTH, s.contentWidth)
      : s.contentWidth;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CanvasActionBar previewWidth={previewWidth} onChange={setPreviewWidth} />
      <div
        className={`flex-1 overflow-auto bg-[var(--muted)]/30 ${
          previewWidth === 'mobile' ? 'loomi-lp-canvas-mobile' : ''
        }`}
        onClick={() => selectBlock(null)}
      >
        <style>{`
          /* Disable link navigation + form interactions inside the canvas.
             Clicks bubble to EditableBlock for selection. */
          .loomi-lp-canvas a { pointer-events: none !important; }
          .loomi-lp-canvas button:not([data-lp-editor-control]) {
            pointer-events: none !important;
          }
          .loomi-lp-canvas input,
          .loomi-lp-canvas select,
          .loomi-lp-canvas textarea {
            pointer-events: none !important;
          }
          /* Mobile preview: mirror what /lp/[slug]/layout.tsx does on
             phones so the editor preview matches the live page —
             stack columns + collapse multi-column grids. */
          .loomi-lp-canvas-mobile [data-lp-columns-row] {
            flex-direction: column !important;
          }
          .loomi-lp-canvas-mobile .loomi-lp-column {
            flex: 1 1 100% !important;
            width: 100% !important;
          }
          .loomi-lp-canvas-mobile [style*="grid-template-columns"] {
            grid-template-columns: 1fr !important;
          }
        `}</style>
        <div className="py-6">
          <div
            className="loomi-lp-canvas shadow-sm mx-auto bg-white"
            style={{
              maxWidth: `${effectiveMaxWidth}px`,
              backgroundColor: s.contentBg,
              color: s.textColor,
              fontFamily: s.fontFamily,
              borderRadius: s.contentBorderRadius ?? 0,
              ['--loomi-lp-primary' as never]: s.primaryColor,
              padding: `${s.contentPaddingTop ?? 0}px ${s.contentPaddingRight ?? 0}px ${s.contentPaddingBottom ?? 0}px ${s.contentPaddingLeft ?? 0}px`,
              margin: `${s.contentMarginTop ?? 0}px ${s.contentMarginRight ?? 0}px ${s.contentMarginBottom ?? 0}px ${s.contentMarginLeft ?? 0}px`,
              transition: 'max-width 150ms ease',
              overflow: 'hidden',
            }}
          >
          {template.blocks.length === 0 ? (
            <EmptyCanvasState />
          ) : (
            <SortableContext
              items={template.blocks.map((b) => b.id)}
              strategy={verticalListSortingStrategy}
            >
              {template.blocks.map((block, idx) => (
                <EditableBlock
                  key={block.id}
                  block={block}
                  index={idx}
                  total={template.blocks.length}
                />
              ))}
            </SortableContext>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CanvasActionBar({
  previewWidth,
  onChange,
}: {
  previewWidth: PreviewWidth;
  onChange: (w: PreviewWidth) => void;
}) {
  // Bare bar — no background, no separator. The toggle itself is the
  // only chrome on this row. Same pill-tab idiom the sidebar uses.
  return (
    <div className="flex items-center justify-center px-4 py-2 flex-shrink-0">
      <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 gap-0.5">
        <PreviewToggleButton
          active={previewWidth === 'desktop'}
          onClick={() => onChange('desktop')}
          title="Desktop preview"
          icon={<ComputerDesktopIcon className="w-3.5 h-3.5" />}
          label="Desktop"
        />
        <PreviewToggleButton
          active={previewWidth === 'mobile'}
          onClick={() => onChange('mobile')}
          title="Mobile preview"
          icon={<DevicePhoneMobileIcon className="w-3.5 h-3.5" />}
          label="Mobile"
        />
      </div>
    </div>
  );
}

function PreviewToggleButton({
  active,
  onClick,
  title,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded transition-colors ${
        active
          ? 'bg-[var(--primary)] text-white'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Recursive wrapper that adds editor affordances around any block.
 * Top-level + nested blocks share this component — the block's
 * sortable wiring uses the same id regardless of depth, because
 * each container hosts its own SortableContext.
 */
function EditableBlock({
  block,
  index,
  total,
}: {
  block: Block;
  index: number;
  total: number;
}) {
  const { selectedId, selectBlock, moveBlock, deleteBlock, duplicateBlock } =
    useLandingPageEditor();
  const selected = selectedId === block.id;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  let body: React.ReactNode = null;

  if (block.type === 'section') {
    const children = block.children ?? [];
    body = (
      <SectionBlock {...block.props}>
        {children.length === 0 ? (
          <EmptyContainerDropZone parentId={block.id} />
        ) : (
          <SortableContext
            items={children.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {children.map((child, i) => (
              <EditableBlock
                key={child.id}
                block={child}
                index={i}
                total={children.length}
              />
            ))}
          </SortableContext>
        )}
      </SectionBlock>
    );
  } else if (block.type === 'columns') {
    const columns = block.children ?? [];
    body = (
      <ColumnsBlock {...block.props}>
        {columns.map((column) => (
          <ColumnSlot key={column.id} column={column} />
        ))}
      </ColumnsBlock>
    );
  } else {
    const Component = BLOCK_COMPONENTS[block.type] as React.ComponentType<
      Record<string, unknown> & { children?: React.ReactNode }
    >;
    body = Component ? <Component {...block.props} /> : null;
  }

  return (
    <div
      ref={setNodeRef}
      className="relative group/block"
      style={{
        ...dragStyle,
        outline: selected ? '2px solid var(--primary)' : '2px solid transparent',
        outlineOffset: -2,
      }}
      onClick={(e) => {
        e.stopPropagation();
        selectBlock(block.id);
      }}
      {...attributes}
    >
      {!selected && (
        <div className="pointer-events-none absolute inset-0 opacity-0 group-hover/block:opacity-100 transition-opacity ring-1 ring-inset ring-[var(--primary)]/40" />
      )}

      {selected && (
        <div
          data-lp-editor-control
          className="absolute -top-9 right-2 z-10 flex items-center gap-0.5 px-1 py-1 rounded-md bg-[var(--card)] border border-[var(--border)] shadow-sm"
          // Stop dnd-kit from hijacking the toolbar pointer events into
          // a drag — without this, the up/down/delete buttons can
          // get swallowed by the sortable activation.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle — the only place that opts into the
              sortable listeners. The rest of the block is click-to-
              select; drag only fires when you grab this icon. */}
          <button
            type="button"
            data-lp-editor-control
            title="Drag to reorder"
            aria-label="Drag to reorder"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] cursor-grab active:cursor-grabbing"
            {...listeners}
          >
            <Bars3Icon className="w-3.5 h-3.5" />
          </button>
          <Rail
            label="Move up"
            disabled={index === 0}
            icon={<ChevronUpIcon className="w-3.5 h-3.5" />}
            onClick={() => moveBlock(block.id, 'up')}
          />
          <Rail
            label="Move down"
            disabled={index === total - 1}
            icon={<ChevronDownIcon className="w-3.5 h-3.5" />}
            onClick={() => moveBlock(block.id, 'down')}
          />
          <Rail
            label="Duplicate"
            icon={<DocumentDuplicateIcon className="w-3.5 h-3.5" />}
            onClick={() => duplicateBlock(block.id)}
          />
          <Rail
            label="Delete"
            icon={<TrashIcon className="w-3.5 h-3.5 text-rose-400" />}
            onClick={() => deleteBlock(block.id)}
          />
        </div>
      )}

      {body}
    </div>
  );
}

/**
 * Render one column inside a Columns block. The column is itself a
 * Section under the hood — we render its background/padding via
 * SectionBlock, and its children as EditableBlocks. Each column
 * carries its own SortableContext so reorder is column-scoped.
 */
function ColumnSlot({ column }: { column: Block }) {
  const children = column.children ?? [];
  return (
    <SectionBlock {...column.props}>
      {children.length === 0 ? (
        <EmptyContainerDropZone parentId={column.id} small />
      ) : (
        <SortableContext
          items={children.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {children.map((child, i) => (
            <EditableBlock
              key={child.id}
              block={child}
              index={i}
              total={children.length}
            />
          ))}
        </SortableContext>
      )}
    </SectionBlock>
  );
}

function EmptyContainerDropZone({
  parentId,
  small = false,
}: {
  parentId: string;
  small?: boolean;
}) {
  // Selecting the parent (Section / column-slot) marks it as the
  // insertion target — clicking a block in the left palette will then
  // append into THIS parent (EditorContext.insertBlock infers
  // "container selected → append-into").
  const { selectBlock, selectedId } = useLandingPageEditor();
  const active = selectedId === parentId;
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        selectBlock(parentId);
      }}
      className={`text-center font-medium rounded-md transition-colors cursor-pointer ${
        small ? 'py-4 px-3 text-[11px]' : 'py-6 px-4 text-xs'
      } ${
        active
          ? 'border-2 border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
          : 'border-2 border-dashed border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]'
      }`}
    >
      {active
        ? 'Pick a block on the left'
        : small
          ? 'Empty column — click, then add a block'
          : 'Empty section — click, then add a block from the left'}
    </div>
  );
}

function Rail({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-lp-editor-control
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--muted)] text-[var(--foreground)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {icon}
    </button>
  );
}

function EmptyCanvasState() {
  return (
    <div className="m-12 p-16 text-center rounded-lg border-2 border-dashed border-[var(--border)] text-[var(--muted-foreground)]">
      <p className="m-0 text-sm font-medium">No blocks yet.</p>
      <p className="mt-2 text-xs">
        Pick something from the panel on the left to get started.
      </p>
    </div>
  );
}
