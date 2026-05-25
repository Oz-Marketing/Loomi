'use client';

import * as React from 'react';
import type { Block, LandingPageBlockType, LandingPageTemplate } from '../types';
import { getDefaultProps } from '../schemas';

interface EditorState {
  template: LandingPageTemplate;
  selectedId: string | null;
}

/**
 * Position within the block tree.
 *   parentId: null  → top level
 *   parentId: <id>  → child of the block with that id
 *   afterId:  null  → insert at start of parent's children
 *   afterId:  <id>  → insert after this sibling
 *   afterId:  'end' → append to parent's children (the common case)
 */
export interface InsertPosition {
  parentId: string | null;
  afterId: string | null | 'end';
}

interface EditorActions {
  selectBlock: (id: string | null) => void;
  updateBlockProps: (id: string, props: Record<string, unknown>) => void;
  updateSettings: (settings: Partial<LandingPageTemplate['settings']>) => void;
  /** Insert a new block. If `position` is omitted we infer one from
   *  the current selection: a container is inserted-into, a leaf is
   *  inserted-after. */
  insertBlock: (type: LandingPageBlockType, position?: InsertPosition) => void;
  moveBlock: (id: string, direction: 'up' | 'down') => void;
  /** Reorder a block within its current parent. `targetIndex` is the
   *  desired final position (post-removal). Used by drag-and-drop. */
  reorderInParent: (id: string, targetIndex: number) => void;
  /** Move a block to a new position anywhere in the tree. Rejects
   *  moves that would create a cycle (dropping a block onto its own
   *  descendant). Returns `false` if the move was rejected. */
  moveBlockTo: (id: string, position: InsertPosition) => boolean;
  deleteBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
}

type EditorContextValue = EditorState & EditorActions;

const Ctx = React.createContext<EditorContextValue | null>(null);

export function useLandingPageEditor(): EditorContextValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useLandingPageEditor must be used inside <LandingPageEditorProvider>');
  return ctx;
}

function generateId(): string {
  return `b-${Math.random().toString(36).slice(2, 10)}`;
}

function createBlock(type: LandingPageBlockType): Block {
  const id = generateId();
  const block: Block = { id, type, props: { ...getDefaultProps(type) } };
  if (type === 'section') block.children = [];
  if (type === 'columns') {
    const count = (block.props.columnCount as number) ?? 2;
    block.children = Array.from({ length: count }, () => ({
      id: generateId(),
      type: 'section' as LandingPageBlockType,
      props: { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 },
      children: [],
    }));
  }
  return block;
}

function deepClone(block: Block): Block {
  return {
    ...block,
    id: generateId(),
    props: { ...block.props },
    children: block.children?.map(deepClone),
  };
}

function mapBlocks(blocks: Block[], fn: (b: Block) => Block): Block[] {
  return blocks.map((b) => {
    const next = fn(b);
    if (next.children) return { ...next, children: mapBlocks(next.children, fn) };
    return next;
  });
}

function removeBlock(blocks: Block[], id: string): Block[] {
  return blocks
    .filter((b) => b.id !== id)
    .map((b) => (b.children ? { ...b, children: removeBlock(b.children, id) } : b));
}

/** Returns true if `descendantId` is the same as `ancestorId` or
 *  nested anywhere inside the subtree rooted at `ancestorId`. Used to
 *  reject drag-into-self moves. */
function isDescendant(blocks: Block[], ancestorId: string, descendantId: string): boolean {
  if (ancestorId === descendantId) return true;
  const ancestor = findBlock(blocks, ancestorId);
  if (!ancestor?.children) return false;
  const walk = (nodes: Block[]): boolean => {
    for (const n of nodes) {
      if (n.id === descendantId) return true;
      if (n.children && walk(n.children)) return true;
    }
    return false;
  };
  return walk(ancestor.children);
}

function findBlock(blocks: Block[], id: string): Block | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) {
      const inner = findBlock(b.children, id);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** Returns { parent, index } where `parent === null` indicates the
 *  block is at the top level. */
function locate(
  blocks: Block[],
  id: string,
): { parent: Block | null; index: number } | null {
  const topIdx = blocks.findIndex((b) => b.id === id);
  if (topIdx !== -1) return { parent: null, index: topIdx };
  for (const b of blocks) {
    if (!b.children) continue;
    const innerIdx = b.children.findIndex((c) => c.id === id);
    if (innerIdx !== -1) return { parent: b, index: innerIdx };
    // Recurse further (columns hold sections, sections hold leaves;
    // need to keep walking for deeper structures).
    const deeper = locate(b.children, id);
    if (deeper) return deeper;
  }
  return null;
}

/** True for blocks that semantically accept children (Section, the
 *  inner column slots that Columns generates). Columns itself is a
 *  fixed-arity grid — children are added inside one of its columns,
 *  not the block itself. */
function isContainer(block: Block): boolean {
  return block.type === 'section';
}

/** Insert `newBlock` into `blocks` at the given position, recursively
 *  walking children as needed. */
function insertAt(
  blocks: Block[],
  newBlock: Block,
  position: InsertPosition,
): Block[] {
  if (position.parentId === null) {
    return appendOrInsert(blocks, newBlock, position.afterId);
  }
  return blocks.map((b) => {
    if (b.id === position.parentId) {
      const children = b.children ?? [];
      return {
        ...b,
        children: appendOrInsert(children, newBlock, position.afterId),
      };
    }
    if (b.children) {
      return { ...b, children: insertAt(b.children, newBlock, position) };
    }
    return b;
  });
}

function appendOrInsert(
  blocks: Block[],
  newBlock: Block,
  afterId: string | null | 'end',
): Block[] {
  if (afterId === null) return [newBlock, ...blocks];
  if (afterId === 'end') return [...blocks, newBlock];
  const idx = blocks.findIndex((b) => b.id === afterId);
  if (idx === -1) return [...blocks, newBlock];
  return [...blocks.slice(0, idx + 1), newBlock, ...blocks.slice(idx + 1)];
}

interface ProviderProps {
  template: LandingPageTemplate;
  onChange: (next: LandingPageTemplate) => void;
  children: React.ReactNode;
}

export function LandingPageEditorProvider({ template, onChange, children }: ProviderProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const update = React.useCallback(
    (updater: (t: LandingPageTemplate) => LandingPageTemplate) => {
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
    (settings: Partial<LandingPageTemplate['settings']>) => {
      update((t) => ({ ...t, settings: { ...t.settings, ...settings } }));
    },
    [update],
  );

  const insertBlock = React.useCallback(
    (type: LandingPageBlockType, position?: InsertPosition) => {
      const newBlock = createBlock(type);
      update((t) => {
        // No explicit position → infer from the current selection.
        // - Container selected: insert as the last child.
        // - Leaf selected: insert after it within the same parent.
        // - Nothing selected: append to the top level.
        let resolved: InsertPosition;
        if (position) {
          resolved = position;
        } else if (selectedId) {
          const selected = findBlock(t.blocks, selectedId);
          if (selected && isContainer(selected)) {
            resolved = { parentId: selected.id, afterId: 'end' };
          } else {
            const loc = locate(t.blocks, selectedId);
            resolved = {
              parentId: loc?.parent?.id ?? null,
              afterId: selectedId,
            };
          }
        } else {
          resolved = { parentId: null, afterId: 'end' };
        }
        return { ...t, blocks: insertAt(t.blocks, newBlock, resolved) };
      });
      setSelectedId(newBlock.id);
    },
    [update, selectedId],
  );

  const moveBlock = React.useCallback(
    (id: string, direction: 'up' | 'down') => {
      update((t) => {
        const loc = locate(t.blocks, id);
        if (!loc) return t;
        const swapWith = direction === 'up' ? loc.index - 1 : loc.index + 1;
        const siblings = loc.parent?.children ?? t.blocks;
        if (swapWith < 0 || swapWith >= siblings.length) return t;
        const next = [...siblings];
        [next[loc.index], next[swapWith]] = [next[swapWith], next[loc.index]];
        if (!loc.parent) return { ...t, blocks: next };
        return {
          ...t,
          blocks: mapBlocks(t.blocks, (b) =>
            b.id === loc.parent?.id ? { ...b, children: next } : b,
          ),
        };
      });
    },
    [update],
  );

  const reorderInParent = React.useCallback(
    (id: string, targetIndex: number) => {
      update((t) => {
        const loc = locate(t.blocks, id);
        if (!loc) return t;
        const siblings = loc.parent?.children ?? t.blocks;
        if (targetIndex < 0 || targetIndex >= siblings.length) return t;
        if (targetIndex === loc.index) return t;
        const without = siblings.filter((_, i) => i !== loc.index);
        const next = [
          ...without.slice(0, targetIndex),
          siblings[loc.index],
          ...without.slice(targetIndex),
        ];
        if (!loc.parent) return { ...t, blocks: next };
        return {
          ...t,
          blocks: mapBlocks(t.blocks, (b) =>
            b.id === loc.parent?.id ? { ...b, children: next } : b,
          ),
        };
      });
    },
    [update],
  );

  const moveBlockTo = React.useCallback(
    (id: string, position: InsertPosition): boolean => {
      // Reject drag-into-self / drag-into-descendant. Without this
      // check, moving a Section onto one of its child leaves would
      // remove the Section from the tree and then fail to re-insert
      // (because the target parent no longer exists), corrupting the
      // template.
      if (position.parentId && isDescendant(template.blocks, id, position.parentId)) {
        return false;
      }
      const source = findBlock(template.blocks, id);
      if (!source) return false;
      update((t) => {
        const without = removeBlock(t.blocks, id);
        return { ...t, blocks: insertAt(without, source, position) };
      });
      return true;
    },
    [template, update],
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
        const loc = locate(t.blocks, id);
        if (!loc) return t;
        const source = findBlock(t.blocks, id);
        if (!source) return t;
        const copy = deepClone(source);
        return {
          ...t,
          blocks: insertAt(t.blocks, copy, {
            parentId: loc.parent?.id ?? null,
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
    selectBlock: setSelectedId,
    updateBlockProps,
    updateSettings,
    insertBlock,
    moveBlock,
    reorderInParent,
    moveBlockTo,
    deleteBlock,
    duplicateBlock,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
