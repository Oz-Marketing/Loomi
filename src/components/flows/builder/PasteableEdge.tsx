'use client';

import { useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import {
  ClipboardDocumentCheckIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { useBuilderContext } from './BuilderContext';

// Default edge variant for the flow builder. Two affordances live at
// the bezier midpoint:
//
// 1. **Paste here** — when something is on the clipboard, every edge
//    shows a button to drop the cloned step between source and target.
// 2. **Hover +** — when nothing is on the clipboard, hovering the edge
//    surface reveals a small `+` button; clicking opens a popover the
//    parent renders, letting the user insert a new step at this gap.
//
// The hover state is gated by a tiny delay so the user can move from
// the edge path to the floating button without it disappearing
// underneath them (the button lives in a portal, so there's no shared
// DOM hover region).

export function PasteableEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
    label,
  } = props;
  const { clipboardNode, onPasteOnEdge, onInsertOnEdge } = useBuilderContext();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const [hovered, setHovered] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showHover() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHovered(true);
  }
  function hideHover() {
    // Small delay so the user can travel from the SVG path to the
    // portaled button without losing the hover state in between.
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHovered(false), 80);
  }

  const pasteMode = !!clipboardNode;

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />

      {/* Wider invisible hit-area path makes the thin visible edge
          easier to hover. 28px works well — wide enough that even
          fast cursor passes register, narrow enough that nearby
          parallel edges don't bleed into each other. Only mounted
          when not in paste mode (paste has its own button). */}
      {!pasteMode && (
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={28}
          onMouseEnter={showHover}
          onMouseLeave={hideHover}
          style={{ cursor: 'pointer' }}
        />
      )}

      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="pointer-events-none text-[10px] font-medium text-[var(--muted-foreground)] bg-[var(--card-strong)] backdrop-blur-md px-1.5 py-0.5 rounded border border-[var(--border)]"
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}

      {pasteMode && (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={() => onPasteOnEdge(id)}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] text-[10px] font-semibold shadow-md hover:opacity-90 transition-opacity"
          >
            <ClipboardDocumentCheckIcon className="w-3 h-3" />
            Paste here
          </button>
        </EdgeLabelRenderer>
      )}

      {/* Hover-revealed + insertion button. Always mounted (so the
          opacity transition animates), gated by `hovered`. */}
      {!pasteMode && (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={(e) => onInsertOnEdge(id, e.clientX, e.clientY)}
            onMouseEnter={showHover}
            onMouseLeave={hideHover}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: hovered ? 'all' : 'none',
            }}
            title="Insert step here"
            className={`nodrag nopan inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--card-strong)] border border-[var(--border)] text-[var(--foreground)] shadow-md hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all ${
              hovered ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
            }`}
          >
            <PlusIcon className="w-3 h-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
