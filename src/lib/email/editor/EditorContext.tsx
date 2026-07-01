'use client';

import * as React from 'react';
import type { Block, EmailTemplate, BlockType } from '../types';

/** Shape of the editor's shared state. */
interface EditorState {
  template: EmailTemplate;
  selectedId: string | null;
  hoveredId: string | null;
  /** Account scope — drives the media-library picker inside the
   *  Image block's property control. Null for global context. */
  accountKey: string | null;
}

/**
 * Position within the block tree.
 * - parentId: null = top-level; otherwise the id of a section block whose children are the target list
 * - afterId: null = insert at start of the parent; otherwise insert immediately after this block id
 */
export interface BlockPosition {
  parentId: string | null;
  afterId: string | null;
}

interface EditorActions {
  selectBlock: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  updateBlockProps: (id: string, props: Record<string, unknown>) => void;
  updateSettings: (settings: Partial<EmailTemplate['settings']>) => void;
  updateMeta: (meta: { subject?: string; preheader?: string }) => void;
  insertBlock: (type: BlockType, position: BlockPosition) => void;
  moveBlock: (id: string, position: BlockPosition) => void;
  moveBlockUp: (id: string) => void;
  moveBlockDown: (id: string) => void;
  deleteBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
}

type EditorContextValue = EditorState & EditorActions;

const Ctx = React.createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useEditor must be used inside <EditorProvider>');
  return ctx;
}

export function findBlock(blocks: Block[], id: string): Block | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) {
      const found = findBlock(b.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function generateId(): string {
  return `b-${Math.random().toString(36).slice(2, 10)}`;
}

interface ProviderProps {
  template: EmailTemplate;
  onChange: (next: EmailTemplate) => void;
  /** Account this email template belongs to. Drives the media-library
   *  picker scope in the image property control. */
  accountKey?: string | null;
  children: React.ReactNode;
}

export function EditorProvider({ template, onChange, accountKey = null, children }: ProviderProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  const update = React.useCallback(
    (updater: (current: EmailTemplate) => EmailTemplate) => {
      onChange(updater(template));
    },
    [template, onChange],
  );

  const updateBlockProps = React.useCallback(
    (id: string, props: Record<string, unknown>) => {
      update((t) => ({
        ...t,
        blocks: mapBlocks(t.blocks, (b) =>
          b.id === id ? { ...b, props: { ...b.props, ...props } } : b,
        ),
      }));
    },
    [update],
  );

  const updateSettings = React.useCallback(
    (settings: Partial<EmailTemplate['settings']>) => {
      update((t) => ({ ...t, settings: { ...t.settings, ...settings } }));
    },
    [update],
  );

  const updateMeta = React.useCallback(
    (meta: { subject?: string; preheader?: string }) => {
      update((t) => ({ ...t, ...meta }));
    },
    [update],
  );

  const insertBlock = React.useCallback(
    (type: BlockType, position: BlockPosition) => {
      const newBlock = createBlock(type);
      update((t) => ({
        ...t,
        blocks: insertAtPosition(t.blocks, newBlock, position),
      }));
      setSelectedId(newBlock.id);
    },
    [update],
  );

  const moveBlock = React.useCallback(
    (id: string, position: BlockPosition) => {
      update((t) => {
        const block = findBlock(t.blocks, id);
        if (!block) return t;
        const without = removeBlock(t.blocks, id);
        return { ...t, blocks: insertAtPosition(without, block, position) };
      });
    },
    [update],
  );

  const moveBlockUp = React.useCallback(
    (id: string) => {
      const parent = findParentOf(template.blocks, id);
      const siblings = parent?.children ?? template.blocks;
      const idx = siblings.findIndex((b) => b.id === id);
      if (idx <= 0) return; // already at top
      const beforePrev = siblings[idx - 2]?.id ?? null;
      moveBlock(id, { parentId: parent?.id ?? null, afterId: beforePrev });
    },
    [template, moveBlock],
  );

  const moveBlockDown = React.useCallback(
    (id: string) => {
      const parent = findParentOf(template.blocks, id);
      const siblings = parent?.children ?? template.blocks;
      const idx = siblings.findIndex((b) => b.id === id);
      if (idx === -1 || idx >= siblings.length - 1) return; // already at bottom
      const next = siblings[idx + 1]?.id;
      if (!next) return;
      moveBlock(id, { parentId: parent?.id ?? null, afterId: next });
    },
    [template, moveBlock],
  );

  const deleteBlock = React.useCallback(
    (id: string) => {
      update((t) => ({ ...t, blocks: removeBlock(t.blocks, id) }));
      setSelectedId((prev) => (prev === id ? null : prev));
    },
    [update],
  );

  const duplicateBlock = React.useCallback(
    (id: string) => {
      update((t) => {
        const parent = findParentOf(t.blocks, id);
        const block = findBlock(t.blocks, id);
        if (!block) return t;
        const copy = deepCloneBlock(block);
        return {
          ...t,
          blocks: insertAtPosition(t.blocks, copy, {
            parentId: parent?.id ?? null,
            afterId: id,
          }),
        };
      });
    },
    [update],
  );

  const value: EditorContextValue = {
    template,
    selectedId,
    hoveredId,
    accountKey,
    selectBlock: setSelectedId,
    setHovered: setHoveredId,
    updateBlockProps,
    updateSettings,
    updateMeta,
    insertBlock,
    moveBlock,
    moveBlockUp,
    moveBlockDown,
    deleteBlock,
    duplicateBlock,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ── Block list helpers (top-level only — nested children edits TBD) ──

function mapBlocks(blocks: Block[], fn: (b: Block) => Block): Block[] {
  return blocks.map((b) => {
    const next = fn(b);
    if (next.children) return { ...next, children: mapBlocks(next.children, fn) };
    return next;
  });
}

function insertAt(blocks: Block[], newBlock: Block, afterId: string | null): Block[] {
  if (afterId === null) return [newBlock, ...blocks];
  const idx = blocks.findIndex((b) => b.id === afterId);
  if (idx === -1) return [...blocks, newBlock];
  return [...blocks.slice(0, idx + 1), newBlock, ...blocks.slice(idx + 1)];
}

/** Insert into top-level OR into a specific section's children, based on position.parentId. */
function insertAtPosition(blocks: Block[], newBlock: Block, position: BlockPosition): Block[] {
  if (position.parentId === null) {
    return insertAt(blocks, newBlock, position.afterId);
  }
  return blocks.map((b) => {
    if (b.id !== position.parentId) {
      // Recurse so we find the parent at any depth
      if (b.children) return { ...b, children: insertAtPosition(b.children, newBlock, position) };
      return b;
    }
    const currentChildren = b.children ?? [];
    return { ...b, children: insertAt(currentChildren, newBlock, position.afterId) };
  });
}

function removeBlock(blocks: Block[], id: string): Block[] {
  return blocks
    .filter((b) => b.id !== id)
    .map((b) => (b.children ? { ...b, children: removeBlock(b.children, id) } : b));
}

/** Find the immediate parent block of `id`, if any. Returns null if `id` is top-level or absent. */
export function findParentOf(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.children?.some((c) => c.id === id)) return b;
    if (b.children) {
      const inner = findParentOf(b.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * Walk up from a (possibly nested) block id to find its top-level ancestor —
 * i.e. the block in `blocks` whose subtree contains `id`. Returns null if
 * `id` isn't in the tree.
 */
export function findTopLevelAncestor(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children && containsBlock(b.children, id)) return b;
  }
  return null;
}

function containsBlock(blocks: Block[], id: string): boolean {
  for (const b of blocks) {
    if (b.id === id) return true;
    if (b.children && containsBlock(b.children, id)) return true;
  }
  return false;
}

function deepCloneBlock(block: Block): Block {
  return {
    ...block,
    id: generateId(),
    props: { ...block.props },
    children: block.children?.map(deepCloneBlock),
  };
}

function getBlockDefaults(type: BlockType): Record<string, unknown> {
  // Mirrors src/lib/email/schemas.ts — kept here to avoid circular imports during edits.
  switch (type) {
    case 'section':
      return { paddingTop: 32, paddingBottom: 32, paddingLeft: 32, paddingRight: 32, gap: 0 };
    case 'columns':
      return { columnCount: 2, gap: 16, valign: 'top', paddingTop: 16, paddingBottom: 16, paddingLeft: 16, paddingRight: 16, stackOnMobile: true };
    case 'heading':
      return { text: 'Your headline here', level: 1, color: '#1a1a1a', fontSize: 32, fontWeight: 700, align: 'left', marginBottom: 16 };
    case 'text':
      return { text: 'Your message goes here.', color: '#3a3a3a', fontSize: 15, lineHeight: 1.6, align: 'left', marginBottom: 16 };
    case 'image':
      return { align: 'center', borderRadius: 0 };
    case 'button':
      return { text: 'Click here', url: '#', bgColor: '#1a1a1a', textColor: '#ffffff', paddingX: 28, paddingY: 14, borderRadius: 4, align: 'left' };
    case 'spacer':
      return { height: 24 };
    case 'divider':
      return { color: '#e5e5e5', thickness: 1, style: 'solid', marginTop: 16, marginBottom: 16 };
    case 'logo':
      return { width: 140, align: 'center' };
    case 'social':
      // Links are edited as flat link{n}-platform / link{n}-url props via the
      // properties panel (component-schemas) and resolved by SocialBlock, so we
      // don't seed a links[] array here — doing so previously shadowed the
      // panel's edits and rendered phantom empty icons.
      return {
        iconSize: 28,
        spacing: 8,
        align: 'center',
        variant: 'color',
      };
    default:
      return {};
  }
}

/** Build a fresh Block — including auto-created sub-children for compound types. */
function createBlock(type: BlockType): Block {
  const id = generateId();
  const props = getBlockDefaults(type);
  const block: Block = { id, type, props };

  if (type === 'section') {
    block.children = [];
  } else if (type === 'columns') {
    const columnCount = (props.columnCount as number) ?? 2;
    block.children = Array.from({ length: columnCount }, () => ({
      id: generateId(),
      type: 'section' as BlockType,
      props: { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 },
      children: [],
    }));
  }

  return block;
}
