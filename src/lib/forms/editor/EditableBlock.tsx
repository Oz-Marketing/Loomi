'use client';

import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEditor } from './EditorContext';
import type { Block } from '../types';
import {
  Bars3Icon,
  TrashIcon,
  DocumentDuplicateIcon,
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
    moveBlockUp,
    moveBlockDown,
  } = useEditor();

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
    transition,
    cursor: 'grab',
    opacity: isDragging ? 0.4 : 1,
    // Outline (not inset boxShadow) so the selection ring sits on top of section/grid backgrounds.
    outline: isSelected
      ? '2px solid var(--primary)'
      : showHover
        ? '1px solid var(--primary)'
        : 'none',
    outlineOffset: isSelected || showHover ? '-2px' : 0,
    transitionProperty: 'outline-color, opacity',
    transitionDuration: '120ms',
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
          className="absolute -top-[26px] left-0 px-2.5 py-1 rounded-t-md text-[11px] font-semibold uppercase tracking-wider text-[var(--primary-foreground)] bg-[var(--primary)] opacity-70 pointer-events-none z-[9]"
          style={{ fontFamily: 'inherit' }}
        >
          {block.type}
        </div>
      )}

      {/* Floating toolbar — visible when selected */}
      {isSelected && (
        <div
          role="toolbar"
          aria-label="Block actions"
          className="absolute -top-[36px] right-0 flex items-center gap-1 px-2 py-1.5 rounded-t-md bg-[var(--primary)] text-[var(--primary-foreground)] z-10 shadow-md"
          style={{ fontFamily: 'inherit', fontSize: 13 }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          // dnd-kit's PointerSensor listens for pointerdown — stopping it here keeps
          // toolbar buttons clickable instead of being hijacked into a drag.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="px-2 text-xs font-semibold capitalize tracking-wide">
            {block.type}
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
          <ToolbarBtn title="Delete" onClick={() => deleteBlock(block.id)} aria-label="Delete">
            <TrashIcon className="w-4 h-4" />
          </ToolbarBtn>
        </div>
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
