'use client';

import * as React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ComponentIcon } from '@/components/icon-map';
import { componentSchemas } from '@/lib/component-schemas';
import type { BlockType } from '../types';

const COMPONENT_BLOCKS: BlockType[] = [
  'logo',
  'heading',
  'text',
  'image',
  'button',
  'divider',
  'spacer',
  'social',
];

const CONTAINER_BLOCKS: BlockType[] = ['section', 'columns'];

export function ComponentPalette() {
  return (
    <div className="pb-4">
      <PaletteSection title="Containers" types={CONTAINER_BLOCKS} />
      <PaletteSection title="Components" types={COMPONENT_BLOCKS} noTopBorder />
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
