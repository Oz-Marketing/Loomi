'use client';

import { useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ComponentIcon } from '@/components/icon-map';
import { componentSchemas } from '@/lib/component-schemas';
import { PencilSquareIcon, Squares2X2Icon, TrashIcon } from '@heroicons/react/24/outline';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { toast } from '@/lib/toast';
import { useRefreshCustomBlocks } from './CustomBlocksContext';
import type { BlockType } from '../types';

/** A saved reusable block, as the palette needs it. */
export interface CustomBlockSummary {
  id: string;
  name: string;
  description: string | null;
  repeatOver: string | null;
}

const COMPONENT_BLOCKS: BlockType[] = [
  'logo',
  'heading',
  'text',
  'image',
  'button',
  'divider',
  'spacer',
  'social',
  // 'offers' — the built-in OEM slot — is DELIBERATELY not offered any more.
  //
  // It places a card whose layout lives in `offerSection()`, which a designer
  // cannot change. The replacement is the seeded "OEM offer card" custom block
  // below: the same design, but theirs to restyle. The block TYPE stays
  // registered and rendering, because shells authored before this still contain
  // one and must keep working — this only stops new ones being created.
];

const CONTAINER_BLOCKS: BlockType[] = ['section', 'columns'];

/**
 * `customBlocks` is owned by the shell, not fetched here: the DROP handler needs
 * each block's full subtree to insert it, and one fetch feeding both is the only
 * way the list a designer sees and the thing that lands on the canvas cannot
 * disagree.
 */
export function ComponentPalette({ customBlocks = [] }: { customBlocks?: CustomBlockSummary[] }) {
  const custom = customBlocks;

  return (
    <div>
      <PaletteSection title="Containers" types={CONTAINER_BLOCKS} />
      <PaletteSection title="Components" types={COMPONENT_BLOCKS} noTopBorder />
      <CustomBlockSection blocks={custom} />
    </div>
  );
}

/**
 * Blocks designers saved themselves.
 *
 * Hidden entirely when there are none: an empty section with a "you have no
 * blocks" line is noise in a palette someone is using to build, and the way to
 * make one is over on the canvas, not here.
 */
function CustomBlockSection({ blocks }: { blocks: CustomBlockSummary[] }) {
  if (blocks.length === 0) return null;
  return (
    <div>
      <div className="px-4 pt-5 pb-2.5 border-t border-[var(--border)]">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--foreground)]">
          Custom blocks
        </h3>
      </div>
      <div className="px-4 pb-5 pt-1">
        {/* Same 2-up grid as Containers and Components — a saved block is
            another thing you drag onto the canvas, so it should not look like a
            different kind of control. */}
        <div className="grid grid-cols-2 gap-2.5">
          {blocks.map((b) => (
            <CustomChip key={b.id} block={b} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CustomChip({ block }: { block: CustomBlockSummary }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `custom:${block.id}`,
  });
  const { confirm } = useLoomiDialog();
  const refresh = useRefreshCustomBlocks();
  // Renaming happens IN the tile rather than in a dialog: the name is the only
  // field, and a modal to change one word is more ceremony than the edit.
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(block.name);
  // Guards the double-commit: blur fires when Enter moves focus away, so
  // without this the same rename is sent twice.
  const committed = useRef(false);

  const rename = async () => {
    if (committed.current) return;
    committed.current = true;
    const trimmed = draft.trim();
    setRenaming(false);
    // Empty or unchanged is a cancel, not a failed save.
    if (!trimmed || trimmed === block.name) {
      setDraft(block.name);
      return;
    }
    try {
      const res = await fetch(`/api/email-blocks/${block.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      refresh();
    } catch (err) {
      toast.error(`Couldn't rename: ${err instanceof Error ? err.message : 'unknown error'}`);
      setDraft(block.name);
    }
  };

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    committed.current = false;
    setDraft(block.name);
    setRenaming(true);
  };

  /**
   * Remove the block from the palette.
   *
   * HERE as well as in the editor because the two are different acts: deleting
   * the copy on the canvas removes it from one email, and this stops it being
   * offered at all. Without this the only way to retire a mistyped or
   * superseded block was to leave it in the list forever.
   *
   * Templates already built with it are untouched — insert COPIES the subtree
   * in, so nothing downstream is holding a reference to this row.
   */
  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: 'Delete block',
      message: `Delete the block “${block.name}”? Templates already built with it are unaffected.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/email-blocks/${block.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      refresh();
      toast.success('Block deleted');
    } catch (err) {
      toast.error(`Couldn't delete block: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={block.description ?? block.name}
      // Green, like the block wears on the canvas once it lands. The palette
      // and the canvas are the same object seen twice, and a tile that borrows
      // the primary makes a saved block look like another built-in component.
      className={`group relative flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-lg border border-[color-mix(in_srgb,var(--adgen-custom-block)_35%,transparent)] bg-[var(--card)] hover:border-[var(--adgen-custom-block)] hover:bg-[var(--accent)] transition-colors select-none ${
        isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-grab'
      }`}
    >
      <Squares2X2Icon className="w-6 h-6 text-[var(--adgen-custom-block)]" />
      {/* Names are designer-authored and can be long, where the built-in chips
          are one word — so this one truncates rather than reflowing the grid. */}
      {renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void rename();
            else if (e.key === 'Escape') {
              // Mark committed so the blur this causes does not save anyway.
              committed.current = true;
              setDraft(block.name);
              setRenaming(false);
            }
          }}
          // The tile is a dnd-kit draggable, so a press inside the field would
          // otherwise start a drag instead of placing the caret.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="w-full min-w-0 rounded border border-[var(--adgen-custom-block)] bg-[var(--background)] px-1.5 py-0.5 text-center text-sm font-medium text-[var(--foreground)] outline-none"
        />
      ) : (
        <span className="w-full truncate text-center text-sm font-medium text-[var(--foreground)]">
          {block.name}
        </span>
      )}
      {/* A repeating block behaves differently once the run fills it — one copy
          per offer — so it says so before someone drops in six of them. */}
      {block.repeatOver === 'offer' && (
        <span className="absolute right-1.5 top-1.5 rounded bg-[color-mix(in_srgb,var(--adgen-custom-block)_18%,transparent)] px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-[var(--adgen-custom-block)]">
          Per offer
        </span>
      )}
      {/* Bottom-left, clear of the "Per offer" badge, and revealed on hover so
          a grid of blocks reads as things to drag rather than things to delete.
          `onPointerDown` is stopped because the tile is a dnd-kit draggable —
          without it, pressing the button starts a drag and the click never
          lands. */}
      {!renaming && (
        <div className="absolute bottom-1 left-1 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={startRename}
            onPointerDown={(e) => e.stopPropagation()}
            title={`Rename “${block.name}”`}
            aria-label={`Rename ${block.name}`}
            className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <PencilSquareIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={remove}
            onPointerDown={(e) => e.stopPropagation()}
            title={`Delete “${block.name}”`}
            aria-label={`Delete ${block.name}`}
            className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function PaletteSection({
  title,
  types,
  noTopBorder = false,
}: {
  title: string;
  types: BlockType[];
  noTopBorder?: boolean;
}) {
  return (
    <div>
      <div
        className={`px-4 pt-5 pb-2.5 ${
          noTopBorder ? '' : 'border-t border-[var(--border)]'
        }`}
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--foreground)]">
          {title}
        </h3>
      </div>
      <div className="px-4 pb-5 pt-1">
        <div className="grid grid-cols-2 gap-2.5">
          {types.map((type) => (
            <PaletteChip key={type} type={type} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PaletteChip({ type }: { type: BlockType }) {
  const schema = componentSchemas[type];
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)] hover:bg-[var(--accent)] transition-colors select-none ${
        isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-grab'
      }`}
    >
      <ComponentIcon
        name={schema?.icon || ''}
        className="w-6 h-6 text-[var(--muted-foreground)]"
      />
      <span className="text-sm font-medium text-[var(--foreground)] capitalize">
        {schema?.label || type}
      </span>
    </div>
  );
}
