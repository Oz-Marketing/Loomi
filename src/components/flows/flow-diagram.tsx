'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoltIcon,
  EnvelopeIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  ArrowsPointingOutIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

export type FlowNodeKind = 'trigger' | 'email' | 'sms' | 'wait' | 'audience' | 'action';

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  title: string;
  subtitle?: string;
  x: number;
  y: number;
}

export interface FlowEdge {
  from: string;
  to: string;
}

interface FlowDiagramProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  className?: string;
  // Fires on a quick click (no drag). Pan/zoom interactions are
  // suppressed so this only triggers when the user actually clicked
  // the canvas without dragging.
  onCanvasClick?: () => void;
}

// Max pixel distance between pointerdown and pointerup that still
// counts as a click rather than a pan.
const CLICK_DRAG_THRESHOLD = 5;

const NODE_W = 180;
const NODE_H = 64;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;

const KIND_STYLES: Record<FlowNodeKind, { icon: React.ComponentType<{ className?: string }>; ring: string; iconBg: string; iconColor: string }> = {
  trigger:  { icon: BoltIcon,                  ring: 'stroke-orange-400/60', iconBg: 'bg-orange-500/15', iconColor: 'text-orange-400' },
  email:    { icon: EnvelopeIcon,              ring: 'stroke-sky-400/60',    iconBg: 'bg-sky-500/15',    iconColor: 'text-sky-400' },
  sms:      { icon: ChatBubbleLeftRightIcon,   ring: 'stroke-emerald-400/60',iconBg: 'bg-emerald-500/15',iconColor: 'text-emerald-400' },
  wait:     { icon: ClockIcon,                 ring: 'stroke-amber-400/60',  iconBg: 'bg-amber-500/15',  iconColor: 'text-amber-400' },
  audience: { icon: UserGroupIcon,             ring: 'stroke-violet-400/60', iconBg: 'bg-violet-500/15', iconColor: 'text-violet-400' },
  action:   { icon: BoltIcon,                  ring: 'stroke-zinc-400/60',   iconBg: 'bg-zinc-500/15',   iconColor: 'text-zinc-400' },
};

function getBounds(nodes: FlowNode[]) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: NODE_W, maxY: NODE_H };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + NODE_W > maxX) maxX = n.x + NODE_W;
    if (n.y + NODE_H > maxY) maxY = n.y + NODE_H;
  }
  return { minX, minY, maxX, maxY };
}

export function FlowDiagram({ nodes, edges, className, onCanvasClick }: FlowDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; startX: number; startY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Fit-to-view on mount and when nodes change
  const fitView = useCallback(() => {
    if (containerSize.w === 0 || containerSize.h === 0 || nodes.length === 0) return;
    const { minX, minY, maxX, maxY } = getBounds(nodes);
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const padding = 40;
    const scaleX = (containerSize.w - padding * 2) / contentW;
    const scaleY = (containerSize.h - padding * 2) / contentH;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(scaleX, scaleY, 1)));
    const nextPan = {
      x: containerSize.w / 2 - (minX + contentW / 2) * nextZoom,
      y: containerSize.h / 2 - (minY + contentH / 2) * nextZoom,
    };
    setZoom(nextZoom);
    setPan(nextPan);
  }, [containerSize, nodes]);

  useEffect(() => {
    fitView();
  }, [fitView]);

  // Wheel zoom (anchored on cursor)
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = -e.deltaY * 0.0015;
    setZoom((prev) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * (1 + delta)));
      setPan((p) => ({
        x: cx - ((cx - p.x) * next) / prev,
        y: cy - ((cy - p.y) * next) / prev,
      }));
      return next;
    });
  }, []);

  // Pan with drag
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Ignore presses that started on a control (zoom buttons, etc.)
    // so their own click handlers run unimpeded.
    if ((e.target as HTMLElement).closest('[data-flow-control]')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
      startX: e.clientX,
      startY: e.clientY,
    };
    setIsPanning(true);
  }, [pan]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      const movedX = Math.abs(e.clientX - drag.startX);
      const movedY = Math.abs(e.clientY - drag.startY);
      const wasClick = movedX < CLICK_DRAG_THRESHOLD && movedY < CLICK_DRAG_THRESHOLD;
      dragRef.current = null;
      setIsPanning(false);
      if (wasClick && onCanvasClick) {
        onCanvasClick();
      }
    }
  }, [onCanvasClick]);

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, z * 1.2));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, z / 1.2));

  // Build node lookup for edges
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] ${className || ''}`}
      style={{
        backgroundImage:
          'radial-gradient(circle, rgba(120,120,120,0.18) 1px, transparent 1px)',
        backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        cursor: isPanning ? 'grabbing' : 'grab',
      }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Pan/zoom transform layer */}
      <div
        className="absolute inset-0 origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Edges */}
        <svg
          className="absolute inset-0 overflow-visible pointer-events-none"
          width="1"
          height="1"
        >
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-[var(--muted-foreground)]" />
            </marker>
          </defs>
          {edges.map((edge, i) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y;
            const midY = y1 + (y2 - y1) / 2;
            const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
            return (
              <path
                key={i}
                d={d}
                fill="none"
                strokeWidth={2}
                className="stroke-[var(--muted-foreground)]/50"
                markerEnd="url(#flow-arrow)"
              />
            );
          })}
        </svg>

        {/* Nodes */}
        {nodes.map((node) => {
          const style = KIND_STYLES[node.kind];
          const Icon = style.icon;
          return (
            <div
              key={node.id}
              className="absolute"
              style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
            >
              <div className="w-full h-full rounded-lg bg-[var(--card)] border border-[var(--border)] shadow-sm flex items-center gap-2 px-2.5 select-none">
                <div className={`w-9 h-9 rounded-md ${style.iconBg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-5 h-5 ${style.iconColor}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate text-[var(--foreground)]">{node.title}</div>
                  {node.subtitle && (
                    <div className="text-[10px] text-[var(--muted-foreground)] truncate">{node.subtitle}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--muted-foreground)]">
            Flow has no steps yet
          </div>
        )}
      </div>

      {/* Controls (fixed in container, not transformed) */}
      <div data-flow-control className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
        <button
          type="button"
          onClick={zoomIn}
          title="Zoom in"
          className="w-8 h-8 rounded-md bg-[var(--card)] border border-[var(--border)] flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors shadow-sm"
        >
          <MagnifyingGlassPlusIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={zoomOut}
          title="Zoom out"
          className="w-8 h-8 rounded-md bg-[var(--card)] border border-[var(--border)] flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors shadow-sm"
        >
          <MagnifyingGlassMinusIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={fitView}
          title="Fit to view"
          className="w-8 h-8 rounded-md bg-[var(--card)] border border-[var(--border)] flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] transition-colors shadow-sm"
        >
          <ArrowsPointingOutIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Zoom badge */}
      <div className="absolute bottom-3 left-3 text-[10px] tabular-nums text-[var(--muted-foreground)] bg-[var(--card)]/70 backdrop-blur-sm px-2 py-1 rounded-md border border-[var(--border)]">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}
