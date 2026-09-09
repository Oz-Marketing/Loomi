'use client';

import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEditor } from './EditorContext';
import { SaveBlockModal } from './SaveBlockModal';
import { CUSTOM_BLOCK_NAME_PROP } from '@/lib/ad-generator/automation/offer-bindings';
import type { Block } from '../types';
import {
  Bars3Icon,
  TrashIcon,
  DocumentDuplicateIcon,
  Squares2X2Icon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';

interface EditableBlockProps {
  block: Block;
  children: React.ReactNode;
}

/**
 * Wraps a rendered block with click-to-select, hover/selection outline,
 * full-block drag-to-reorder, drop indicator line, and a floating toolbar
 * (move up/down, drag handle, duplicate, delete) when selected.
 */
export function EditableBlock({ block, children }: EditableBlockProps) {
  const {
    selectedId,
    hoveredId,
    selectBlock,
    setHovered,
    deleteBlock,
    duplicateBlock,
    accountKey,
    moveBlockUp,
    moveBlockDown,
  } = useEditor();
  const [savingBlock, setSavingBlock] = React.useState(false);

  /**
   * A subtree inserted from the Custom blocks palette.
   *
   * It is an ordinary section once inserted — copy-on-insert is deliberate, so a
   * designer can adapt it here without touching the saved original — which left
   * nothing on screen to say "this came from a block". The name and a green
   * treatment give it back an identity, so a card is recognisable among the
   * plain sections around it.
   */
  const customName =
    typeof block.props[CUSTOM_BLOCK_NAME_PROP] === 'string'
      ? (block.props[CUSTOM_BLOCK_NAME_PROP] as string).trim()
      : '';
  const isCustom = customName.length > 0;
  const accent = isCustom ? 'var(--adgen-custom-block)' : 'var(--primary)';
  const label = customName || block.type;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: block.id });

  const isSelected = selectedId === block.id;
  const isHovered = hoveredId === block.id;
  const showHover = isHovered && !isSelected;

  const wrapperStyle: React.CSSProperties = {
    position: 'relative',
    transform: CSS.Transform.toString(transform),
    // Merge dnd-kit's transform transition with our outline/opacity ones in
    // the single `transition` shorthand. Mixing the shorthand with the
    // longhand transitionProperty/transitionDuration warns in React (and can
    // cause one to clobber the other on rerender), so keep it all shorthand.
    transition: [transition, 'outline-color 120ms', 'opacity 120ms']
      .filter(Boolean)
      .join(', '),
    cursor: 'grab',
    opacity: isDragging ? 0.4 : 1,
    // Outline (not inset boxShadow) so the selection ring sits on top of section/grid backgrounds.
    outline: isSelected
      ? `2px solid ${accent}`
      : showHover
        ? `1px solid ${accent}`
        : 'none',
    outlineOffset: isSelected || showHover ? '-2px' : 0,
  };

  return (
    <div
      ref={setNodeRef}
      style={wrapperStyle}
      data-block-id={block.id}
      data-block-type={block.type}
      onClick={(e) => {
        e.stopPropagation();
        selectBlock(block.id);
      }}
      onMouseEnter={() => setHovered(block.id)}
      onMouseLeave={() => setHovered(null)}
      {...attributes}
      {...listeners}
    >
      {/* Hover label (subtle when not selected) */}
      {showHover && (
        <div
          aria-hidden="true"
          className="absolute -top-[26px] left-0 px-2.5 py-1 rounded-t-md text-[11px] font-semibold uppercase tracking-wider text-white opacity-70 pointer-events-none z-[9]"
          style={{ fontFamily: 'inherit', background: accent }}
        >
          {label}
        </div>
      )}

      {/* Floating toolbar — visible when selected */}
      {isSelected && (
        <div
          role="toolbar"
          aria-label="Block actions"
          className="absolute -top-[36px] right-0 flex items-center gap-1 px-2 py-1.5 rounded-t-md text-white z-10 shadow-md"
          style={{ fontFamily: 'inherit', fontSize: 13, background: accent }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          // dnd-kit's PointerSensor listens for pointerdown — stopping it here keeps
          // toolbar buttons clickable instead of being hijacked into a drag.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span
            className={`px-2 text-xs font-semibold tracking-wide ${isCustom ? '' : 'capitalize'}`}
            title={isCustom ? 'Inserted from a custom block' : undefined}
          >
            {label}
          </span>
          <span className="w-px h-4 bg-white/25 mx-0.5" />
          <ToolbarBtn title="Drag to reorder (or drag the block itself)" aria-label="Drag indicator" cursor="grab">
            <Bars3Icon className="w-4 h-4" />
          </ToolbarBtn>
          <ToolbarBtn title="Move up" onClick={() => moveBlockUp(block.id)} aria-label="Move up">
            <ChevronUpIcon className="w-4 h-4" />
          </ToolbarBtn>
          <ToolbarBtn title="Move down" onClick={() => moveBlockDown(block.id)} aria-label="Move down">
            <ChevronDownIcon className="w-4 h-4" />
          </ToolbarBtn>
          <ToolbarBtn title="Duplicate" onClick={() => duplicateBlock(block.id)} aria-label="Duplicate">
            <DocumentDuplicateIcon className="w-4 h-4" />
          </ToolbarBtn>
          {/* CONTAINERS ONLY. A saved block is a LOCKUP — a card with a
              picture, a figure and its legal line — and saving a bare text
              block produces a one-line entry that clutters the palette without
              being reusable. Wrapping the card in a Section is how you build one
              anyway: the stock OEM offer card is a section. Same rule the ad
              builder follows, where a block is a saved cluster rather than a
              single element. */}
          {CONTAINER_TYPES.has(block.type) && (
            <ToolbarBtn
              title="Save as custom block"
              onClick={() => setSavingBlock(true)}
              aria-label="Save as custom block"
            >
              <Squares2X2Icon className="w-4 h-4" />
            </ToolbarBtn>
          )}
          <ToolbarBtn title="Delete" onClick={() => deleteBlock(block.id)} aria-label="Delete">
            <TrashIcon className="w-4 h-4" />
          </ToolbarBtn>
        </div>
      )}

      {savingBlock && (
        <SaveBlockModal
          block={block}
          accountKey={accountKey}
          onSaved={() => setSavingBlock(false)}
          onCancel={() => setSavingBlock(false)}
        />
      )}

      {/* Block content */}
      {children}

      {/* Drop indicator — shown below when something is being dragged onto this block */}
      {isOver && !isDragging && (
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 -bottom-0.5 h-[3px] rounded-sm bg-[var(--primary)] z-[8] pointer-events-none"
          style={{ boxShadow: '0 0 6px var(--primary)' }}
        />
      )}
    </div>
  );
}

// ── Toolbar button component ──

interface ToolbarBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  cursor?: React.CSSProperties['cursor'];
}

const ToolbarBtn = React.forwardRef<HTMLButtonElement, ToolbarBtnProps>(
  function ToolbarBtn({ children, cursor, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className="inline-flex items-center justify-center p-1.5 rounded-md text-[var(--primary-foreground)] hover:bg-white/15 transition-colors"
        style={cursor ? { cursor } : undefined}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

/** Block types a custom block can be saved from. */
const CONTAINER_TYPES = new Set(['section', 'columns']);
