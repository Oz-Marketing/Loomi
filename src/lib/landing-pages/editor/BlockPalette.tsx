'use client';

import * as React from 'react';
import { ALL_BLOCK_SCHEMAS, type BlockSchema } from '../schemas';
import { useLandingPageEditor } from './EditorContext';
import { PaletteIcon } from './PaletteIcon';

const CATEGORY_ORDER: BlockSchema['category'][] = ['marketing', 'content', 'layout', 'embed'];
const CATEGORY_LABEL: Record<BlockSchema['category'], string> = {
  marketing: 'Marketing',
  content: 'Content',
  layout: 'Layout',
  embed: 'Embed',
};

/**
 * Left-side palette of available blocks. Click a block to append it
 * to the bottom of the canvas (or after the currently-selected block
 * if one is selected). PR2 ships the click affordance; a true drag-
 * from-palette is a follow-up.
 */
export function BlockPalette() {
  const { insertBlock } = useLandingPageEditor();

  const groups = React.useMemo(() => {
    const buckets: Record<BlockSchema['category'], BlockSchema[]> = {
      marketing: [],
      content: [],
      layout: [],
      embed: [],
    };
    for (const schema of ALL_BLOCK_SCHEMAS) {
      buckets[schema.category].push(schema);
    }
    return buckets;
  }, []);

  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Click a block to add it to the canvas. Hover a block on the canvas to
          see its edit controls.
        </p>
      </div>
      {CATEGORY_ORDER.map((cat) => (
        <div key={cat} className="px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] mb-2">
            {CATEGORY_LABEL[cat]}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {groups[cat].map((schema) => (
              <button
                key={schema.type}
                type="button"
                onClick={() => insertBlock(schema.type)}
                className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors group"
                title={schema.description}
              >
                <PaletteIcon name={schema.icon} className="w-5 h-5 text-[var(--muted-foreground)] group-hover:text-[var(--primary)]" />
                <span className="text-[11px] font-medium text-center leading-tight">
                  {schema.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
