'use client';

import * as React from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { useEditor } from './EditorContext';
import { EditableBlock } from './EditableBlock';
import { BlockDropGap } from './BlockDropGap';
import { BLOCK_COMPONENTS } from '../components';
import type { Block, FormTemplate } from '../types';
import type { PreviewWidth } from './FormActionBar';

interface CanvasProps {
  previewWidth?: PreviewWidth;
  zoom?: number;
  previewValues?: Record<string, string>;
}

function applyPreviewSubstitution(
  value: string,
  values: Record<string, string>,
): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (match, rawKey) => {
    const key = String(rawKey).trim();
    if (key in values) return values[key];
    return match;
  });
}

function substituteProps(
  props: Record<string, unknown>,
  values: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string') {
      out[k] = applyPreviewSubstitution(v, values);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * The visual canvas. Renders the email's blocks as live React (not raw HTML),
 * so click/hover/drag interact with React event handlers naturally.
 *
 * Wraps the block list in <SortableContext> for reordering. The outer DndContext
 * (provided by V2EditorShell) handles both palette-to-canvas drops and
 * within-canvas reordering.
 */
export function Canvas({ previewWidth = 'desktop', zoom = 100, previewValues }: CanvasProps = {}) {
  const { template, selectBlock } = useEditor();
  const blockIds = template.blocks.map((b) => b.id);

  // Empty-canvas drop target — accepts palette chips when no blocks exist yet.
  const { setNodeRef: setEmptyDropRef, isOver: isEmptyOver } = useDroppable({
    id: 'canvas-empty',
  });

  const effectiveWidth =
    previewWidth === 'mobile'
      ? Math.min(375, template.settings.contentWidth)
      : template.settings.contentWidth;

  // Per-side spacing — same fallback shape FormRenderer uses, so the
  // editor canvas matches what the public page + overview thumbnail
  // render. `??` covers older schemas that predate these fields.
  const s = template.settings;
  const canvasMargin = `${s.contentMarginTop ?? 32}px ${s.contentMarginRight ?? 32}px ${s.contentMarginBottom ?? 32}px ${s.contentMarginLeft ?? 32}px`;
  const canvasPadding = `${s.contentPaddingTop ?? 32}px ${s.contentPaddingRight ?? 32}px ${s.contentPaddingBottom ?? 32}px ${s.contentPaddingLeft ?? 32}px`;

  const ctxValue: PreviewSubstitutionContextValue = {
    previewValues: previewValues && Object.keys(previewValues).length > 0 ? previewValues : null,
  };

  return (
    <div
      onClick={() => selectBlock(null)}
      className={`loomi-v2-canvas flex-1 overflow-auto${
        previewWidth === 'mobile' ? ' loomi-v2-canvas-mobile' : ''
      }`}
      style={{
        minHeight: '100%',
        backgroundColor: template.settings.bodyBg,
        padding: canvasMargin,
      }}
    >
      {/* Disable link navigation + form interactions inside the canvas —
          clicks bubble to EditableBlock for select/drag. Mobile preview:
          stack ColumnsBlock columns the same way the public renderer will. */}
      <style>{`
        .loomi-v2-canvas a { pointer-events: none !important; cursor: inherit !important; }
        /* Make form inputs preview-only inside the editor canvas — clicks
           bubble to EditableBlock for selection, and we don't want users
           typing into "placeholder" inputs during design. */
        .loomi-v2-canvas input,
        .loomi-v2-canvas select,
        .loomi-v2-canvas textarea,
        .loomi-v2-canvas button[type="submit"] {
          pointer-events: none !important;
        }
        .loomi-v2-canvas-mobile .loomi-form-stack {
          flex-basis: 100% !important;
          width: 100% !important;
        }
        .loomi-v2-canvas-mobile [data-form-columns-row] {
          flex-direction: column !important;
        }
      `}</style>
      <div
        style={{
          width: '100%',
          maxWidth: `${effectiveWidth}px`,
          margin: '0 auto',
          backgroundColor: template.settings.contentBg,
          fontFamily: template.settings.fontFamily,
          color: template.settings.textColor,
          padding: canvasPadding,
          transform: `scale(${zoom / 100})`,
          transformOrigin: 'top center',
          transition: 'max-width 150ms ease, transform 120ms ease',
        }}
      >
        <PreviewSubstitutionContext.Provider value={ctxValue}>
          <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
            {template.blocks.length === 0 ? (
              <div ref={setEmptyDropRef}>
                <EmptyCanvas highlight={isEmptyOver} />
              </div>
            ) : (
              <>
                {/* Drop gap above the first block — accepts drops AND
                    surfaces the inline "+" Section/Grid quick-add. */}
                <BlockDropGap position="start" />
                {template.blocks.map((block) => (
                  <React.Fragment key={block.id}>
                    <EditableBlock block={block}>
                      <RenderedBlock block={block} settings={template.settings} />
                    </EditableBlock>
                    {/* Gap below each block — same droppable + "+" pattern. */}
                    <BlockDropGap position="after" afterId={block.id} />
                  </React.Fragment>
                ))}
              </>
            )}
          </SortableContext>
        </PreviewSubstitutionContext.Provider>
      </div>
    </div>
  );
}

interface PreviewSubstitutionContextValue {
  previewValues: Record<string, string> | null;
}

const PreviewSubstitutionContext = React.createContext<PreviewSubstitutionContextValue>({
  previewValues: null,
});

// ── Block rendering inside the editor canvas ──

function RenderedBlock({ block, settings }: { block: Block; settings: FormTemplate['settings'] }) {
  const Component = BLOCK_COMPONENTS[block.type] as React.ComponentType<any> | undefined;
  const { previewValues } = React.useContext(PreviewSubstitutionContext);
  if (!Component) {
    return (
      <div style={{ padding: 12, color: '#900', fontFamily: 'monospace', fontSize: 12 }}>
        Unknown block type: {block.type}
      </div>
    );
  }

  const props = previewValues ? substituteProps(block.props, previewValues) : block.props;

  if (block.type === 'section') {
    const children = block.children ?? [];
    return (
      <Component {...props}>
        <SortableContext
          items={children.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {children.length === 0 ? (
            <SectionEmptyDropZone sectionId={block.id} />
          ) : (
            children.map((child) => (
              <EditableBlock key={child.id} block={child}>
                <RenderedBlock block={child} settings={settings} />
              </EditableBlock>
            ))
          )}
        </SortableContext>
      </Component>
    );
  }

  if (block.type === 'columns') {
    const columnSections = block.children ?? [];
    return (
      <Component {...props}>
        {columnSections.map((columnSection) => (
          <ColumnSlot
            key={columnSection.id}
            columnSection={columnSection}
            settings={settings}
          />
        ))}
      </Component>
    );
  }

  return <Component {...props} />;
}

/** Drop slot for a single column inside a Columns block. */
function ColumnSlot({
  columnSection,
  settings,
}: {
  columnSection: Block;
  settings: FormTemplate['settings'];
}) {
  const children = columnSection.children ?? [];
  return (
    <SortableContext
      items={children.map((c) => c.id)}
      strategy={verticalListSortingStrategy}
    >
      {children.length === 0 ? (
        <SectionEmptyDropZone sectionId={columnSection.id} small />
      ) : (
        children.map((child) => (
          <EditableBlock key={child.id} block={child}>
            <RenderedBlock block={child} settings={settings} />
          </EditableBlock>
        ))
      )}
    </SortableContext>
  );
}

/**
 * Empty-section drop zone — gives users somewhere to drop the first child block
 * into an otherwise empty section.
 */
function SectionEmptyDropZone({
  sectionId,
  small = false,
}: {
  sectionId: string;
  small?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `section-empty:${sectionId}` });
  return (
    <div
      ref={setNodeRef}
      className={`text-center font-medium rounded-md transition-colors ${
        small ? 'py-5 px-3 text-[11px]' : 'py-6 px-4 text-xs'
      } ${
        isOver
          ? 'border-2 border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
          : 'border-2 border-dashed border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]'
      }`}
    >
      {isOver ? 'Drop here' : small ? 'Drop component' : 'Drag a component into this section'}
    </div>
  );
}

function EmptyCanvas({ highlight = false }: { highlight?: boolean }) {
  return (
    <div
      className={`m-6 p-16 text-center rounded-lg transition-colors ${
        highlight
          ? 'border-2 border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
          : 'border-2 border-dashed border-[var(--border)] text-[var(--muted-foreground)]'
      }`}
    >
      <p className="m-0 text-sm font-medium">
        {highlight ? 'Drop here' : 'Drag a component here to get started.'}
      </p>
      {!highlight && (
        <p className="mt-2 text-xs">Use the panel on the left.</p>
      )}
    </div>
  );
}
