'use client';

import * as React from 'react';
import { useEditor } from './EditorContext';
import { ComponentIcon } from '@/components/icon-map';
import { componentSchemas } from '@/lib/component-schemas';
import type { Block } from '../types';
import { ChevronRightIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

interface OutlinePanelProps {
  onClose: () => void;
}

/**
 * Floating tree view of every block in the email. Clicking a row selects
 * that block (which switches the sidebar to its property editor).
 */
export function OutlinePanel({ onClose }: OutlinePanelProps) {
  const { template, selectedId, selectBlock } = useEditor();
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on Escape or click outside
  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', handleKey);
    // Use a microtask delay so the toggle button's own click doesn't immediately close us
    const t = setTimeout(() => window.addEventListener('mousedown', handleClick), 0);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mousedown', handleClick);
      clearTimeout(t);
    };
  }, [onClose]);

  const handleSelect = (id: string) => {
    selectBlock(id);
  };

  return (
    <div
      ref={ref}
      className="absolute top-2 left-2 z-30 w-[280px] max-h-[calc(100%-1rem)] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl"
    >
      <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground)]">
          Outline
        </h3>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {countBlocks(template.blocks)} blocks
        </span>
      </div>
      {template.blocks.length === 0 ? (
        <div className="p-4 text-xs text-[var(--muted-foreground)] text-center">
          No blocks yet — drag one onto the canvas.
        </div>
      ) : (
        <div className="py-1.5">
          {template.blocks.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              depth={0}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Internals ────────────────────────────────────────────────────

function countBlocks(blocks: Block[]): number {
  let count = blocks.length;
  for (const b of blocks) {
    if (b.children) count += countBlocks(b.children);
  }
  return count;
}

interface BlockRowProps {
  block: Block;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function BlockRow({ block, depth, selectedId, onSelect }: BlockRowProps) {
  const isSelected = block.id === selectedId;
  const hasChildren = !!block.children && block.children.length > 0;
  const [expanded, setExpanded] = React.useState(true);

  const schema = componentSchemas[block.type];
  const label = getBlockLabel(block);

  const indent = 8 + depth * 14;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(block.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(block.id);
          }
        }}
        className={`group flex items-center gap-1.5 py-1.5 pr-2 cursor-pointer text-sm transition-colors ${
          isSelected
            ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
            : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
        }`}
        style={{ paddingLeft: indent }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="flex-shrink-0 w-4 h-4 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            {expanded ? (
              <ChevronDownIcon className="w-3 h-3" />
            ) : (
              <ChevronRightIcon className="w-3 h-3" />
            )}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        <span className="flex-shrink-0 inline-flex items-center text-[var(--muted-foreground)]">
          <ComponentIcon name={schema?.icon || ''} className="w-3.5 h-3.5" />
        </span>
        <span className="text-xs font-semibold capitalize text-[var(--foreground)] flex-shrink-0">
          {schema?.label || block.type}
        </span>
        {label && (
          <span className="text-xs text-[var(--muted-foreground)] truncate min-w-0">
            — {label}
          </span>
        )}
      </div>
      {hasChildren && expanded && (
        <>
          {block.children!.map((child) => (
            <BlockRow
              key={child.id}
              block={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </>
  );
}

/** Get a short preview label from the block's content props (e.g. heading text). */
function getBlockLabel(block: Block): string | null {
  const text = block.props.text;
  if (typeof text === 'string' && text.trim()) {
    const trimmed = text.trim();
    return trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed;
  }
  if (block.type === 'image' || block.type === 'logo') {
    const src = block.props.src;
    if (typeof src === 'string' && src) {
      try {
        const url = new URL(src);
        return url.hostname;
      } catch {
        return src.length > 40 ? src.slice(0, 40) + '…' : src;
      }
    }
  }
  if (block.type === 'spacer') {
    const h = block.props.height;
    if (typeof h === 'number' || typeof h === 'string') return `${h}px`;
  }
  if (block.type === 'columns') {
    const c = block.props.columnCount;
    return c ? `${c} columns` : null;
  }
  return null;
}
