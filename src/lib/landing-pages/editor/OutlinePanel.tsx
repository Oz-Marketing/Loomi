'use client';

import { useLandingPageEditor } from './EditorContext';
import { BLOCK_SCHEMA_BY_TYPE } from '../schemas';
import { PaletteIcon } from './PaletteIcon';
import type { Block } from '../types';

/**
 * Tree view of the page structure. Each row is clickable and selects
 * the corresponding block on the canvas (which scrolls the property
 * panel into the block-editor view). Useful on dense pages where
 * scrolling to find a specific block is slow.
 *
 * Nested blocks (Section children, column slots, column children)
 * render with progressive indentation. We intentionally don't expose
 * the column-slot pseudo-Sections — they're structural, not editable,
 * and surfacing them clutters the tree. Their children are pulled up
 * to render as direct descendants of the Columns block.
 */
export function OutlinePanel() {
  const { template, selectedId, selectBlock } = useLandingPageEditor();

  if (template.blocks.length === 0) {
    return (
      <div className="px-4 py-6 text-xs text-[var(--muted-foreground)] text-center">
        Nothing on the page yet — add a block from the Content tab.
      </div>
    );
  }

  return (
    <ul className="py-2">
      {template.blocks.map((block) => (
        <OutlineRow
          key={block.id}
          block={block}
          depth={0}
          selectedId={selectedId}
          onSelect={selectBlock}
        />
      ))}
    </ul>
  );
}

function OutlineRow({
  block,
  depth,
  selectedId,
  onSelect,
}: {
  block: Block;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const schema = BLOCK_SCHEMA_BY_TYPE[block.type];
  const selected = selectedId === block.id;
  const isContainer = block.type === 'section' || block.type === 'columns';

  // For Columns, skip the pseudo-Section column slots and surface
  // their children directly — keeps the tree readable.
  const children: Block[] =
    block.type === 'columns'
      ? (block.children ?? []).flatMap((slot) => slot.children ?? [])
      : (block.children ?? []);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(block.id)}
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-left rounded-md transition-colors ${
          selected
            ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
            : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <PaletteIcon
          name={schema?.icon ?? 'squares-2x2'}
          className={`w-3.5 h-3.5 flex-shrink-0 ${
            selected ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'
          }`}
        />
        <span className="truncate">{schema?.label ?? block.type}</span>
        {isContainer && children.length > 0 && (
          <span className="ml-auto text-[10px] text-[var(--muted-foreground)] tabular-nums">
            {children.length}
          </span>
        )}
      </button>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <OutlineRow
              key={child.id}
              block={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
