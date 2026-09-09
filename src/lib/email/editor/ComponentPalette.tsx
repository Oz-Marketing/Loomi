'use client';

import { useDraggable } from '@dnd-kit/core';
import { ComponentIcon } from '@/components/icon-map';
import { componentSchemas } from '@/lib/component-schemas';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
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
    <div className="pb-4">
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
      <div className="px-4 pt-1">
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
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={block.description ?? block.name}
      className={`relative flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)] hover:bg-[var(--accent)] transition-colors select-none ${
        isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-grab'
      }`}
    >
      <Squares2X2Icon className="w-6 h-6 text-[var(--muted-foreground)]" />
      {/* Names are designer-authored and can be long, where the built-in chips
          are one word — so this one truncates rather than reflowing the grid. */}
      <span className="w-full truncate text-center text-sm font-medium text-[var(--foreground)]">
        {block.name}
      </span>
      {/* A repeating block behaves differently once the run fills it — one copy
          per offer — so it says so before someone drops in six of them. */}
      {block.repeatOver === 'offer' && (
        <span className="absolute right-1.5 top-1.5 rounded bg-[var(--primary)]/12 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-[var(--primary)]">
          Per offer
        </span>
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
      <div className="px-4 pt-1">
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
