'use client';

import { createContext, useContext } from 'react';
import type { BuilderNodeData } from './types';

// Per-render context exposing builder-wide actions to deeply-nested
// node + edge components. Keeps node renderers and edge components
// from having to plumb callbacks through ReactFlow's `data` blob.

export interface BuilderContextValue {
  /** Step on the clipboard waiting to be pasted, or null. While set,
   *  edges render a "+ paste here" affordance at their midpoint. */
  clipboardNode: BuilderNodeData | null;
  /** Buttons on each node call these to copy/delete themselves. */
  onCloneNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  /** Fired when the user clicks a paste-target on an edge. */
  onPasteOnEdge: (edgeId: string) => void;
  /** Bail out of paste mode (e.g. Esc key, X chip). */
  onCancelPaste: () => void;
  /** Fired when the user clicks the hover-revealed + on an edge.
   *  Coords are viewport-space (client) so the parent can position
   *  the insert-step popover next to where the user clicked. */
  onInsertOnEdge: (edgeId: string, screenX: number, screenY: number) => void;
  /** Fired when the user clicks the + button on a leaf node (no
   *  outgoing edge). FlowBuilder opens the step picker at the given
   *  screen coords; on pick it appends a new node + edge after the
   *  source. */
  onAddAfterNode: (sourceNodeId: string, screenX: number, screenY: number) => void;
  /** Update a single node's config blob in place — used by inline-
   *  editable node types (sticky notes) that need to persist their
   *  own changes without going through the inspector. */
  onUpdateNodeConfig?: (nodeId: string, config: Record<string, unknown>) => void;
  /** Transient canvas highlight driven by the Error Log: clicking an
   *  issue outlines its node with a severity-colored ring (red=error,
   *  amber=warning). Null when nothing is highlighted. Never persisted —
   *  it's render-only state, separate from ReactFlow selection. */
  highlightedNodeId: string | null;
  highlightSeverity: 'error' | 'warning' | null;
}

const BuilderContext = createContext<BuilderContextValue>({
  clipboardNode: null,
  onCloneNode: () => undefined,
  onDeleteNode: () => undefined,
  onPasteOnEdge: () => undefined,
  onCancelPaste: () => undefined,
  onInsertOnEdge: () => undefined,
  onAddAfterNode: () => undefined,
  onUpdateNodeConfig: undefined,
  highlightedNodeId: null,
  highlightSeverity: null,
});

export const BuilderContextProvider = BuilderContext.Provider;

export function useBuilderContext(): BuilderContextValue {
  return useContext(BuilderContext);
}
