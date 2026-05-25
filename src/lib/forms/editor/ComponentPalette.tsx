'use client';

import { useDraggable } from '@dnd-kit/core';
import { ComponentIcon } from '@/components/icon-map';
import { ALL_BLOCK_SCHEMAS, type BlockSchema } from '../schemas';
import type { FormBlockType } from '../types';

// Group palette by category so users see fields first, then CTAs, then
// layout. Category is declared on each BlockSchema in schemas.ts.
const CATEGORY_ORDER: BlockSchema['category'][] = ['field', 'cta', 'layout'];
const CATEGORY_LABELS: Record<BlockSchema['category'], string> = {
  field: 'Fields',
  cta: 'Submit',
  layout: 'Layout',
};

export function ComponentPalette() {
  const grouped = new Map<BlockSchema['category'], BlockSchema[]>();
  for (const schema of ALL_BLOCK_SCHEMAS) {
    if (!grouped.has(schema.category)) grouped.set(schema.category, []);
    grouped.get(schema.category)!.push(schema);
  }

  return (
    <div className="pb-4">
      {CATEGORY_ORDER.map((cat, idx) => {
        const items = grouped.get(cat);
        if (!items?.length) return null;
        return (
          <PaletteSection
            key={cat}
            title={CATEGORY_LABELS[cat]}
            schemas={items}
            noTopBorder={idx === 0}
          />
        );
      })}
    </div>
  );
}

function PaletteSection({
  title,
  schemas,
  noTopBorder = false,
}: {
  title: string;
  schemas: BlockSchema[];
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
          {schemas.map((schema) => (
            <PaletteChip key={schema.type} schema={schema} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PaletteChip({ schema }: { schema: BlockSchema }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${schema.type as FormBlockType}`,
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
        name={schema.icon}
        className="w-6 h-6 text-[var(--muted-foreground)]"
      />
      <span className="text-sm font-medium text-[var(--foreground)] text-center leading-tight">
        {schema.label}
      </span>
    </div>
  );
}
