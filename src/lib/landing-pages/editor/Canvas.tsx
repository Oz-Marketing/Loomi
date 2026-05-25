'use client';

import * as React from 'react';
import {
  ChevronUpIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useLandingPageEditor } from './EditorContext';
import { BLOCK_COMPONENTS } from '../components';
import { SectionBlock } from '../components/Section';
import { ColumnsBlock } from '../components/Columns';
import type { Block } from '../types';

/**
 * Editor canvas. Renders the template using the real block
 * components, but wraps each block in an EditableBlock that adds:
 *  - selection ring on click
 *  - hover halo
 *  - floating control rail (up/down/duplicate/delete)
 *
 * Section blocks recurse into EditableBlocks for their children, so
 * a heading sitting inside a section can be clicked and edited
 * directly. Columns render each column's contents the same way.
 *
 * Page-level settings (bg, font, max width, brand color) wrap the
 * tree so the editor matches LandingPageRenderer pixel-for-pixel.
 */
export function Canvas() {
  const { template, selectBlock } = useLandingPageEditor();
  const s = template.settings;

  return (
    <div
      className="flex-1 overflow-auto bg-[var(--muted)]/30"
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
      `}</style>
      <div className="py-6">
        <div
          className="loomi-lp-canvas shadow-sm mx-auto bg-white"
          style={{
            maxWidth: `${s.contentWidth}px`,
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
            template.blocks.map((block, idx) => (
              <EditableBlock
                key={block.id}
                block={block}
                index={idx}
                total={template.blocks.length}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Recursive wrapper that adds editor affordances around any block.
 * - Leaf blocks render their component as-is.
 * - Section blocks render their children as EditableBlocks (or an
 *   empty-drop-zone when childless).
 * - Columns render each of their column slots, with EditableBlocks
 *   inside each column.
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

  let body: React.ReactNode = null;

  if (block.type === 'section') {
    const children = block.children ?? [];
    body = (
      <SectionBlock {...block.props}>
        {children.length === 0 ? (
          <EmptyContainerDropZone parentId={block.id} />
        ) : (
          children.map((child, i) => (
            <EditableBlock
              key={child.id}
              block={child}
              index={i}
              total={children.length}
            />
          ))
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
      className="relative group/block"
      style={{
        outline: selected ? '2px solid var(--primary)' : '2px solid transparent',
        outlineOffset: -2,
      }}
      onClick={(e) => {
        e.stopPropagation();
        selectBlock(block.id);
      }}
    >
      {!selected && (
        <div className="pointer-events-none absolute inset-0 opacity-0 group-hover/block:opacity-100 transition-opacity ring-1 ring-inset ring-[var(--primary)]/40" />
      )}

      {selected && (
        <div
          data-lp-editor-control
          className="absolute -top-9 right-2 z-10 flex items-center gap-0.5 px-1 py-1 rounded-md bg-[var(--card)] border border-[var(--border)] shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
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
 * SectionBlock, and its children as EditableBlocks. Selecting a
 * child works the same as a top-level selection.
 *
 * The column wrapper isn't independently selectable to keep the UX
 * simple: users edit the parent Columns block (column count, gap,
 * align) and the leaf blocks inside the columns. The pseudo-Section
 * column is structural, not editorial.
 */
function ColumnSlot({ column }: { column: Block }) {
  const children = column.children ?? [];
  return (
    <SectionBlock {...column.props}>
      {children.length === 0 ? (
        <EmptyContainerDropZone parentId={column.id} small />
      ) : (
        children.map((child, i) => (
          <EditableBlock
            key={child.id}
            block={child}
            index={i}
            total={children.length}
          />
        ))
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
  // append into THIS parent, since EditorContext.insertBlock infers
  // "container selected → append-into".
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
