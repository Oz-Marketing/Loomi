'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
// @xyflow/react CSS is imported globally in app/globals.css so our
// dark-mode chrome overrides win the cascade — see the comment there.
import { toast } from 'sonner';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  Cog6ToothIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { BuilderInspector } from './BuilderInspector';
import { NODE_TYPES } from './BuilderNodes';
import { BuilderContextProvider } from './BuilderContext';
import { PasteableEdge } from './PasteableEdge';
import { InsertStepMenu } from './InsertStepMenu';
import { BuilderActionBar } from './BuilderActionBar';
import { autoLayout } from './autoLayout';
import { FlowAiPanel } from './FlowAiPanel';
import { IconRail, type RailFeature } from './IconRail';
import { FeatureDrawer } from './FeatureDrawer';
import { BuilderPopout } from './BuilderPopout';
import { FlowSettingsPanel } from './FlowSettingsPanel';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';
import {
  validateFlowGraph,
  type FlowValidationIssue,
  type NodeType,
} from '@/lib/flows/validation';
import type { FlowAiAction, FlowSnapshot } from '@/lib/ai/flow-tools';
import {
  NODE_META,
  type BuilderNodeData,
  type BuilderNodeStats,
  type BuilderNodeType,
  type FlowApiDetail,
  type FlowApiTrigger,
} from './types';

// Register the paste-aware edge as the default `default` edge type so
// every existing edge gets paste-target rendering during paste mode.
const EDGE_TYPES = { default: PasteableEdge } as const;

const statsFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json() as Promise<{ byNode: Record<string, BuilderNodeStats> }>;
};

// Default config for a freshly-dropped node. Mirrors what the
// inspector forms expect so the node renders with a sensible
// summary right away even before the user clicks it.
const DEFAULT_NODE_CONFIG: Record<BuilderNodeType, Record<string, unknown>> = {
  trigger: {},
  email: { subject: '', templateId: '', html: '' },
  sms: { message: '' },
  add_tag: { tag: '' },
  remove_tag: { tag: '' },
  update_field: { field: '', value: '' },
  add_to_list: { listId: '' },
  remove_from_list: { listId: '' },
  add_note: { note: '' },
  create_task: { title: '', dueAt: '' },
  wait: { ms: 60 * 60 * 1000 }, // 1 hour
  wait_until: { field: '', offsetDays: 0 },
  condition: {
    branches: [
      { id: 'a', label: 'Branch A', logic: 'AND', rules: [] },
      { id: 'b', label: 'Branch B', logic: 'AND', rules: [] },
    ],
    fallbackLabel: 'else',
  },
  split: { weights: [0.5, 0.5], labels: ['a', 'b'] },
  webhook: { url: '', method: 'POST', body: '' },
  push_to_crm: { provider: 'hubspot' },
  exit: {},
  sticky_note: { text: '', color: 'yellow' },
};

function detailToReactFlow(detail: FlowApiDetail): {
  nodes: Node<BuilderNodeData>[];
  edges: Edge[];
} {
  return {
    nodes: detail.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.x, y: n.y },
      data: { type: n.type, config: n.config ?? {} },
    })),
    edges: detail.edges.map((e) => ({
      id: e.id,
      source: e.fromNodeId,
      target: e.toNodeId,
      sourceHandle: e.branch ?? undefined,
      label: e.branch ?? undefined,
      type: 'default',
    })),
  };
}

export function FlowBuilder({ flowId }: { flowId: string }) {
  return (
    <ReactFlowProvider>
      <FlowBuilderInner flowId={flowId} />
    </ReactFlowProvider>
  );
}

// Inspector popout anchored to the selected node's LIVE position. The
// viewport subscription lives here (not in FlowBuilderInner) so only
// this thin wrapper re-renders as the canvas pans/zooms — the popout
// tracks the node instead of sitting statically over the canvas, and the
// heavy inspector content (passed as `children`, a stable element from
// the parent) is not re-rendered on every pan frame.
function NodeAnchoredInspector({
  node,
  containerBounds,
  onClose,
  children,
}: {
  node: Node<BuilderNodeData>;
  containerBounds?: { width: number; height: number };
  onClose: () => void;
  children: React.ReactNode;
}) {
  const viewport = useViewport();
  const nodeWidth = node.measured?.width ?? 240;
  // Flow coords → canvas-wrapper pixels via the live viewport transform.
  // Anchored just off the node's top-right; BuilderPopout flips/clamps
  // into bounds if there isn't room on that side.
  const x = (node.position.x + nodeWidth) * viewport.zoom + viewport.x + 16;
  const y = node.position.y * viewport.zoom + viewport.y;
  return (
    <BuilderPopout
      x={x}
      y={y}
      width={440}
      containerBounds={containerBounds}
      onClose={onClose}
    >
      {children}
    </BuilderPopout>
  );
}

function FlowBuilderInner({ flowId }: { flowId: string }) {
  const { screenToFlowPosition, zoomIn, zoomOut, fitView, setCenter } = useReactFlow();

  const [detail, setDetail] = useState<FlowApiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node<BuilderNodeData>>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Transient canvas highlight driven by the Error Log: clicking an issue
  // outlines its node (red=error, amber=warning) on top of the pan. Kept
  // out of `nodes` so it never marks the flow dirty or burns an undo slot;
  // surfaced to node renderers via BuilderContext.
  const [highlight, setHighlight] = useState<{
    nodeId: string;
    severity: 'error' | 'warning';
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [triggers, setTriggers] = useState<FlowApiTrigger[]>([]);

  // ── Iris ──
  // When open, the left rail shows the chat panel instead of the active
  // FeatureDrawer. The empty-state hero on the canvas opens this panel
  // pre-filled with the user's prompt.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string | undefined>(undefined);
  // Sticky "user wants the manual canvas" flag — once the user clicks
  // "Add New Trigger" in the empty-state, we don't snap back to the hero
  // even though the graph is still trivial. They can still open AI from
  // the top-bar button.
  const [emptyStateDismissed, setEmptyStateDismissed] = useState(false);

  // ── Left rail / drawer state ──
  // `activeDrawer` is null when no drawer is open, or one of the
  // RailFeature kinds that map to a FeatureDrawer (notes / error_log /
  // version_history). `iris` flows through `aiOpen` above so the
  // existing chat-panel mount stays intact.
  type DrawerFeature = Exclude<RailFeature, 'sticky_notes' | 'stats' | 'iris'>;
  const [activeDrawer, setActiveDrawer] = useState<DrawerFeature | null>(null);
  // Settings cog popout — top-right of the canvas. Open state is local;
  // when open we render FlowSettingsPanel inside a BuilderPopout.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Stats overlay toggle — when on, per-node stat chips render on
  // executable nodes (already in BuilderNodes.tsx; this gates them).
  const [statsOverlayOn, setStatsOverlayOn] = useState(true);

  // ── Clipboard for clone → paste ──
  // The clone button on each node stashes the node's `data` here.
  // While set, every edge renders a "paste here" affordance via the
  // PasteableEdge component, and clicking one inserts a fresh node
  // (new id, copied config) between the edge's source and target.
  const [clipboardNode, setClipboardNode] = useState<BuilderNodeData | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Maps server-side DB cuid → local client-side node id (often the
  // `client-*` UUID for nodes the user created in this session, but
  // also covers the case where the local id IS a cuid — for nodes
  // that were loaded with the flow). Populated on every saveGraph
  // response so publish-time validation errors (keyed by DB cuids)
  // can be translated back to local IDs and painted on the canvas.
  const serverToLocalIdRef = useRef<Map<string, string>>(new Map());

  // ── Undo / redo history ──
  // In-memory snapshot stack of {nodes, edges}. We push debounced
  // snapshots when the graph changes, and the undo/redo handlers
  // restore them. `applyingHistoryRef` blocks the snapshot effect
  // from re-recording the very snapshot we just applied.
  type HistorySnapshot = { nodes: Node<BuilderNodeData>[]; edges: Edge[] };
  const HISTORY_LIMIT = 50;
  const historyRef = useRef<{ stack: HistorySnapshot[]; index: number }>({
    stack: [],
    index: -1,
  });
  const applyingHistoryRef = useRef(false);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSignatureRef = useRef<string>('');
  const [historyVersion, setHistoryVersion] = useState(0);

  const cloneSnapshot = useCallback(
    (n: Node<BuilderNodeData>[], e: Edge[]): HistorySnapshot => ({
      // JSON round-trip is good enough — node/edge data is pure
      // serialisable config + transient stats/errors. Refs (functions,
      // class instances) aren't part of the model.
      nodes: JSON.parse(JSON.stringify(n)),
      edges: JSON.parse(JSON.stringify(e)),
    }),
    [],
  );

  // Snapshot-eligibility signature. Strips the transient bits we don't
  // want recorded as undoable changes: `selected`, `measured`/dimensions,
  // and `data.stats` / `data.errors` (which get refreshed by SWR or
  // cleared by edit handlers, not by the user). Without this, clicking
  // a node to open the inspector would burn a history slot.
  const meaningfulSignature = useCallback(
    (n: Node<BuilderNodeData>[], e: Edge[]): string => {
      const stripped = {
        n: n.map((node) => ({
          id: node.id,
          type: node.type,
          position: node.position,
          data: {
            type: node.data.type,
            config: node.data.config,
          },
        })),
        e: e.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          branch: (edge.data as { branch?: string } | undefined)?.branch ?? null,
        })),
      };
      return JSON.stringify(stripped);
    },
    [],
  );

  // Snapshot debounced 500ms after the last meaningful change so we
  // get one history entry per "edit burst" rather than one per
  // keystroke. Bails out when the change is selection-only / stat-only
  // (signature unchanged), so opening the inspector doesn't consume
  // an undo slot.
  useEffect(() => {
    if (loading) return;
    if (applyingHistoryRef.current) {
      // We just restored a snapshot — record its signature as the
      // current "last meaningful state" so the next edit registers
      // against it. Reset the flag for subsequent user edits.
      applyingHistoryRef.current = false;
      lastSignatureRef.current = meaningfulSignature(nodes, edges);
      return;
    }
    const sig = meaningfulSignature(nodes, edges);
    if (sig === lastSignatureRef.current) return;
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      const h = historyRef.current;
      const snap = cloneSnapshot(nodes, edges);
      // Drop any forward redo branch — making a new edit invalidates it.
      h.stack = h.stack.slice(0, h.index + 1);
      h.stack.push(snap);
      if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
      h.index = h.stack.length - 1;
      lastSignatureRef.current = sig;
      setHistoryVersion((v) => v + 1);
    }, 500);
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    };
  }, [nodes, edges, loading, cloneSnapshot, meaningfulSignature]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    h.index--;
    const snap = h.stack[h.index];
    applyingHistoryRef.current = true;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setDirty(true);
    setHistoryVersion((v) => v + 1);
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index++;
    const snap = h.stack[h.index];
    applyingHistoryRef.current = true;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setDirty(true);
    setHistoryVersion((v) => v + 1);
  }, [setNodes, setEdges]);

  const canUndo = historyRef.current.index > 0;
  const canRedo = historyRef.current.index < historyRef.current.stack.length - 1;
  // `historyVersion` is only read here to force a re-render when the
  // ref-driven history changes — otherwise canUndo/canRedo would be
  // stale on the buttons.
  void historyVersion;

  // ── Live validation ──
  // Re-validates whenever the graph changes so the Error Log drawer
  // (and the rail badge) always reflects the current state without
  // requiring a publish attempt. Sticky-note nodes are skipped by the
  // validator itself.
  const liveIssues = useMemo<FlowValidationIssue[]>(() => {
    const graphNodes = nodes
      // Strip sticky notes — the validator's annotation exemption
      // would skip them anyway, but filtering up front keeps the
      // NodeType cast clean.
      .filter((n) => n.data.type !== 'sticky_note')
      .map((n) => ({
        id: n.id,
        type: n.data.type as NodeType,
        config: n.data.config,
      }));
    const graphEdges = edges.map((e) => ({
      fromNodeId: e.source,
      toNodeId: e.target,
      // Branch lives in `sourceHandle` — that's the canonical field both
      // load (detailToReactFlow), save (saveGraph), and onConnect use.
      // Reading `data.branch` here was the outlier: loaded edges (and
      // even freshly-connected ones) carry the branch on `sourceHandle`,
      // not `data.branch`, so validation saw every condition branch as
      // unconnected and falsely blocked publish.
      branch:
        (e.sourceHandle as string | null) ??
        (e.data as { branch?: string } | undefined)?.branch ??
        null,
    }));
    return validateFlowGraph({ nodes: graphNodes, edges: graphEdges }).issues;
  }, [nodes, edges]);

  const errorCount = useMemo(
    () => liveIssues.filter((i) => (i.severity ?? 'error') === 'error').length,
    [liveIssues],
  );

  // Friendly label for an issue's node — used in the Error Log entries.
  const issueNodeLabel = useCallback(
    (nodeId: string): string => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return 'Step';
      const cfgLabel =
        typeof node.data.config?.label === 'string' && node.data.config.label
          ? (node.data.config.label as string)
          : '';
      const typeLabel = NODE_META[node.data.type]?.label || node.data.type;
      return cfgLabel || typeLabel;
    },
    [nodes],
  );

  // Centers a node on the canvas and opens its inspector. Used by the
  // Error Log drawer when the user clicks an issue.
  const focusNode = useCallback(
    (nodeId: string, severity: 'error' | 'warning' = 'error') => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const w = node.measured?.width ?? 240;
      const h = node.measured?.height ?? 80;
      setCenter(node.position.x + w / 2, node.position.y + h / 2, {
        zoom: 1.1,
        duration: 300,
      });
      setSelectedNodeId(nodeId);
      // Paint a severity-colored ring on the target so it's obvious which
      // node the issue points at, not just where the canvas panned.
      setHighlight({ nodeId, severity });
    },
    [nodes, setCenter],
  );

  // Drop the highlight once it stops being meaningful: the user closed the
  // Error Log, fixed the issue (so it left liveIssues), or deleted the node.
  // This keeps the colored ring from lingering after the problem is gone.
  useEffect(() => {
    if (!highlight) return;
    const stillFlagged = liveIssues.some((i) => i.nodeId === highlight.nodeId);
    if (activeDrawer !== 'error_log' || !stillFlagged) setHighlight(null);
  }, [highlight, liveIssues, activeDrawer]);

  // Keyboard: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z (or Cmd/Ctrl+Y) = redo.
  // Suppressed when focus is inside a form field so typing isn't hijacked.
  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    };
    const handler = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // Live per-node stats overlay. Polls every 30s; pauses while the
  // tab is hidden so we don't spam the API. We only show the overlay
  // once a flow has been published at least once — the chip layer
  // would just be a row of zeros on a fresh draft.
  const everPublished = !!detail?.publishedAt;
  const { data: statsData } = useSWR<{ byNode: Record<string, BuilderNodeStats> }>(
    everPublished ? `/api/flows/${flowId}/node-stats` : null,
    statsFetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
    },
  );
  const statsByNode = statsData?.byNode;

  // When stats refresh, merge them into every matching node's `data`
  // so the renderer (BuilderNodes.tsx) can show chips. We do this
  // here rather than in the renderer so a stats refresh doesn't
  // re-mount the inspector or trip dirty-state autosave.
  //
  // When the rail's Stats View toggle is off, we explicitly clear
  // `data.stats` on every node so the renderer's chip block disappears.
  useEffect(() => {
    if (!statsOverlayOn) {
      setNodes((existing) =>
        existing.some((n) => n.data.stats !== undefined)
          ? existing.map((n) =>
              n.data.stats === undefined
                ? n
                : { ...n, data: { ...n.data, stats: undefined } },
            )
          : existing,
      );
      return;
    }
    if (!statsByNode) return;
    setNodes((existing) =>
      existing.map((n) => {
        const next = statsByNode[n.id];
        if (n.data.stats === next) return n;
        return { ...n, data: { ...n.data, stats: next } };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsByNode, statsOverlayOn]);

  // ── Initial load ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/flows/${flowId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load flow');
        const data = await r.json();
        return data.flow as FlowApiDetail;
      })
      .then((flow) => {
        if (cancelled) return;
        setDetail(flow);
        const next = detailToReactFlow(flow);
        setNodes(next.nodes);
        setEdges(next.edges);
        setTriggers(flow.triggers);
      })
      .catch((err) => {
        toast.error(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId, setNodes, setEdges]);


  // Any meaningful edit invalidates the last publish attempt's
  // per-node errors — the red highlights should melt away as the user
  // fixes things. We only react to dirty flipping to `true` (React
  // diffs the value, so re-setting true is a no-op).
  useEffect(() => {
    if (!dirty) return;
    setNodes((existing) =>
      existing.some((n) => n.data.errors)
        ? existing.map((n) =>
            n.data.errors ? { ...n, data: { ...n.data, errors: undefined } } : n,
          )
        : existing,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // ── Debounced autosave ──
  useEffect(() => {
    if (!dirty) return;
    if (!detail) return;
    if (detail.status === 'active') return; // graph edits blocked while active

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveGraph();
    }, 3000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, dirty]);

  // ── Wrapped change handlers that flip the dirty bit ──
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<BuilderNodeData>>[]) => {
      onNodesChangeBase(changes);
      // Skip dirty-flag flip for selection-only changes; we don't want
      // a single click to trigger an autosave.
      if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) {
        setDirty(true);
      }
    },
    [onNodesChangeBase],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChangeBase(changes);
      if (changes.some((c) => c.type !== 'select')) setDirty(true);
    },
    [onEdgesChangeBase],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      // For condition / split, the sourceHandle ('yes'/'no'/'a'/'b')
      // doubles as the branch label persisted to the edge.
      const branch = connection.sourceHandle || undefined;
      setEdges((eds) =>
        addEdge(
          { ...connection, label: branch, type: 'default' } as Connection,
          eds,
        ),
      );
      setDirty(true);
    },
    [setEdges],
  );

  // ── Palette drop → create node ──
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // The dropEffect must be compatible with the dragstart's
    // `effectAllowed` or the browser rejects the drop silently
    // (onDrop never fires). Sticky-note drags from the icon rail
    // set `effectAllowed = 'copy'`; we have to mirror that here.
    // For any other drag source we keep `move` so canvas-internal
    // node reordering reads correctly.
    if (e.dataTransfer.types.includes('application/loomi-sticky-note')) {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      // Drop a real sticky-note annotation at the click position.
      // Sticky notes are standalone nodes — no handles, no edges,
      // validator exempts them via ANNOTATION_NODE_TYPES.
      if (e.dataTransfer.getData('application/loomi-sticky-note')) {
        const position = screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        });
        const id = `client-${crypto.randomUUID()}`;
        const newNote: Node<BuilderNodeData> = {
          id,
          type: 'sticky_note',
          position,
          data: {
            type: 'sticky_note',
            config: { ...DEFAULT_NODE_CONFIG.sticky_note },
          },
        };
        setNodes((existing) => existing.concat(newNote));
        setDirty(true);
        setEmptyStateDismissed(true);
        return;
      }
      const type = e.dataTransfer.getData('application/loomi-flow-node') as BuilderNodeType;
      if (!type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = `client-${crypto.randomUUID()}`;
      const newNode: Node<BuilderNodeData> = {
        id,
        type,
        position,
        data: { type, config: { ...DEFAULT_NODE_CONFIG[type] } },
      };
      setNodes((existing) => existing.concat(newNode));
      setSelectedNodeId(id);
      setDirty(true);
      // A drag-drop from the palette is the user committing to the
      // manual canvas — dismiss the empty-state hero if it was still up.
      setEmptyStateDismissed(true);
    },
    [screenToFlowPosition, setNodes],
  );

  // ── Inspector edits ──
  const handleConfigChange = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      setNodes((existing) =>
        existing.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, config } } : n,
        ),
      );
      // If a condition's branches changed (a branch was deleted or its id
      // renamed), prune any outgoing edge whose sourceHandle no longer maps
      // to a live branch. Otherwise it lingers as an orphan that the worker
      // could route contacts down via the outgoing[0] fallback.
      const branches = Array.isArray((config as { branches?: unknown }).branches)
        ? (config as { branches: Array<{ id?: unknown }> }).branches
        : null;
      if (branches) {
        const valid = new Set<string>(['else']); // implicit fallback handle
        for (const b of branches) if (typeof b?.id === 'string') valid.add(b.id);
        setEdges((existing) =>
          existing.filter(
            (e) =>
              e.source !== nodeId ||
              !e.sourceHandle ||
              valid.has(e.sourceHandle as string),
          ),
        );
      }
      setDirty(true);
    },
    [setNodes, setEdges],
  );

  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      setNodes((existing) => existing.filter((n) => n.id !== nodeId));
      setEdges((existing) =>
        existing.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      setDirty(true);
    },
    [selectedNodeId, setNodes, setEdges],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: Node[] }) => {
      setSelectedNodeId(selected[0]?.id ?? null);
    },
    [],
  );

  // ── Inspector popout positioning ──
  // The inspector lives in a click-anchored popout (replacing the old
  // right-side slide-out). `inspectorPos` is the mouse coordinate of
  // the node click, expressed relative to the canvas wrapper. Cleared
  // whenever selection clears.
  const [inspectorPos, setInspectorPos] = useState<
    { x: number; y: number } | null
  >(null);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, _node: Node) => {
      // Translate the viewport mouse position into wrapper-relative
      // coords. The popout's positioned parent is the canvas wrapper,
      // so it expects offsets from the wrapper's top-left.
      const wrapper = reactFlowWrapper.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      setInspectorPos({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [],
  );

  // Inspector close handler. Clearing ReactFlow's `selected` flag on
  // every node fires onSelectionChange with an empty array, which in
  // turn nulls selectedNodeId — which we mirror with inspectorPos so
  // the popout unmounts in lockstep.
  const handleCloseInspector = useCallback(() => {
    setNodes((existing) => existing.map((n) => ({ ...n, selected: false })));
    setInspectorPos(null);
  }, [setNodes]);

  // Belt-and-suspenders: if selection clears via some other path
  // (Esc, programmatic deselect), drop the inspector position too.
  useEffect(() => {
    if (!selectedNodeId) setInspectorPos(null);
  }, [selectedNodeId]);

  // ── Clone / paste handlers ──
  const handleCloneNode = useCallback(
    (nodeId: string) => {
      const source = nodes.find((n) => n.id === nodeId);
      if (!source) return;
      // Deep-copy config only — stats/errors are runtime overlays that
      // shouldn't carry over to the clone.
      setClipboardNode({
        type: source.data.type,
        config: JSON.parse(JSON.stringify(source.data.config ?? {})),
      });
      toast.success(`Step copied — click any connection to paste it.`);
    },
    [nodes],
  );

  const handleCancelPaste = useCallback(() => {
    setClipboardNode(null);
  }, []);

  // Shared "insert this node into the gap of an edge" routine used by
  // both paste-on-edge and the hover-+ insert menu. Returns the new
  // node id (selection target) or null if the edge / nodes are gone.
  //
  // After inserting, we run the dagre auto-layout so the inserted
  // node and everything downstream gets respaced. Without this, the
  // new node would sit on top of the existing ones at the edge's
  // midpoint — that's the "squishy" effect the user was hitting.
  const insertNodeOnEdge = useCallback(
    (edgeId: string, nodeData: BuilderNodeData): string | null => {
      const edge = edges.find((e) => e.id === edgeId);
      if (!edge) return null;
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode) return null;

      const midX = (sourceNode.position.x + targetNode.position.x) / 2;
      const midY = (sourceNode.position.y + targetNode.position.y) / 2;
      const newId = `client-${crypto.randomUUID()}`;
      const newNode: Node<BuilderNodeData> = {
        id: newId,
        type: nodeData.type,
        position: { x: midX, y: midY },
        data: {
          type: nodeData.type,
          config: JSON.parse(JSON.stringify(nodeData.config ?? {})),
        },
      };

      const nextNodes = nodes.concat(newNode);
      const nextEdges = edges
        .filter((e) => e.id !== edgeId)
        .concat([
          // Source → new node. Carry the original source handle so
          // condition branch labels ('yes'/'no'/...) survive the
          // insertion.
          {
            id: `e-${edge.source}-${newId}`,
            source: edge.source,
            target: newId,
            sourceHandle: edge.sourceHandle ?? undefined,
            label: edge.label,
            type: 'default',
          },
          // New node → target. Plain edge.
          {
            id: `e-${newId}-${edge.target}`,
            source: newId,
            target: edge.target,
            type: 'default',
          },
        ]);

      // Auto-layout the whole graph so the insertion doesn't pile
      // nodes on top of each other. Triggered inline (not as a
      // separate setNodes pass) so the layout reflects the post-insert
      // graph in one render.
      const laidOut = autoLayout(nextNodes, nextEdges);
      setNodes(laidOut);
      setEdges(nextEdges);
      setSelectedNodeId(newId);
      setDirty(true);
      return newId;
    },
    [edges, nodes, setNodes, setEdges],
  );

  // Manual auto-format trigger — wired to the button in the bottom
  // action bar. Same dagre pass, applied to the current graph.
  const handleAutoFormat = useCallback(() => {
    setNodes((existing) => autoLayout(existing, edges));
    setDirty(true);
  }, [edges, setNodes]);

  // ── Iris plumbing ──
  // Snapshot the live canvas + trigger state for the chat panel. Pulled
  // every turn so the model never reasons about stale state.
  const getAiSnapshot = useCallback((): FlowSnapshot => {
    return {
      flowId,
      status: detail?.status ?? 'draft',
      accountKey: detail?.accountKey ?? null,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.type,
        config: (n.data.config ?? {}) as Record<string, unknown>,
        x: n.position.x,
        y: n.position.y,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        branch: (e.sourceHandle as string | null) ?? null,
      })),
      triggers: triggers.map((t) => ({
        id: t.id,
        type: t.type,
        config: t.config,
        enabled: t.enabled,
      })),
    };
  }, [flowId, detail, nodes, edges, triggers]);

  // Apply the model's ordered action list. Each branch goes through the
  // same setNodes/setEdges/triggers calls a user click would — so dirty
  // bit flips, autosave debounce kicks in, and the history snapshot
  // collapses the whole burst into one undoable step (the snapshot
  // debounce is 500ms; multiple AI actions land within that window).
  const applyAiActions = useCallback(
    async (actions: FlowAiAction[]) => {
      // Map "temp" trigger ids the server invents (ai-trigger-*) to the
      // real cuid the trigger API hands back after we POST. Subsequent
      // set_trigger_config / remove_trigger actions in the same batch
      // reference the temp id, so we have to resolve through this.
      const triggerIdMap = new Map<string, string>();
      const resolveTriggerId = (id: string): string => triggerIdMap.get(id) ?? id;

      // Local copies of triggers state — we mutate this as we go and
      // push it through setTriggers at the end of each action that
      // touches triggers, since react state batching would otherwise
      // hide intermediate updates from subsequent actions in the same
      // loop iteration.
      let currentTriggers = triggers.slice();
      const commitTriggers = (next: FlowApiTrigger[]) => {
        currentTriggers = next;
        setTriggers(next);
      };

      for (const action of actions) {
        switch (action.type) {
          case 'add_node': {
            const { id, nodeType, config, x, y } = action.node;
            setNodes((existing) =>
              existing.concat({
                id,
                type: nodeType,
                position: { x, y },
                data: { type: nodeType, config },
              }),
            );
            setDirty(true);
            break;
          }
          case 'remove_node': {
            setNodes((existing) => existing.filter((n) => n.id !== action.nodeId));
            setEdges((existing) =>
              existing.filter((e) => e.source !== action.nodeId && e.target !== action.nodeId),
            );
            if (selectedNodeId === action.nodeId) setSelectedNodeId(null);
            setDirty(true);
            break;
          }
          case 'update_node_config': {
            setNodes((existing) =>
              existing.map((n) =>
                n.id === action.nodeId ? { ...n, data: { ...n.data, config: action.config } } : n,
              ),
            );
            setDirty(true);
            break;
          }
          case 'connect_nodes': {
            const { id, source, target, branch } = action.edge;
            setEdges((existing) =>
              existing.concat({
                id,
                source,
                target,
                sourceHandle: branch ?? undefined,
                label: branch ?? undefined,
                type: 'default',
              }),
            );
            setDirty(true);
            break;
          }
          case 'disconnect_edge': {
            setEdges((existing) => existing.filter((e) => e.id !== action.edgeId));
            setDirty(true);
            break;
          }
          case 'run_auto_layout': {
            setNodes((existing) => autoLayout(existing, edges));
            setDirty(true);
            break;
          }
          case 'apply_generated_graph': {
            const nextNodes: Node<BuilderNodeData>[] = action.nodes.map((n) => ({
              id: n.id,
              type: n.type,
              position: { x: n.x, y: n.y },
              data: { type: n.type, config: n.config },
            }));
            const nextEdges: Edge[] = action.edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.branch ?? undefined,
              label: e.branch ?? undefined,
              type: 'default',
            }));
            // Run dagre so the freshly-generated graph isn't a pile on
            // top of (0, 0).
            const laidOut = autoLayout(nextNodes, nextEdges);
            setNodes(laidOut);
            setEdges(nextEdges);
            setSelectedNodeId(null);
            setDirty(true);
            // Reset triggers — apply_generated_graph is a full replace.
            // Remove the existing trigger rows on the server, then add
            // the new ones so server state matches.
            for (const t of currentTriggers) {
              await fetch(`/api/flows/${flowId}/triggers/${t.id}`, { method: 'DELETE' }).catch(
                () => undefined,
              );
            }
            const created: FlowApiTrigger[] = [];
            for (const t of action.triggers) {
              const res = await fetch(`/api/flows/${flowId}/triggers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: t.triggerType,
                  config: t.config,
                  enabled: t.enabled,
                }),
              });
              if (res.ok) {
                const payload = await res.json();
                created.push(payload.trigger as FlowApiTrigger);
                triggerIdMap.set(t.tempId, payload.trigger.id);
              }
            }
            commitTriggers(created);
            break;
          }
          case 'add_trigger': {
            const { tempId, triggerType, config, enabled } = action.trigger;
            const res = await fetch(`/api/flows/${flowId}/triggers`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: triggerType, config, enabled }),
            });
            if (res.ok) {
              const payload = await res.json();
              const created = payload.trigger as FlowApiTrigger;
              triggerIdMap.set(tempId, created.id);
              commitTriggers(currentTriggers.concat(created));
            }
            break;
          }
          case 'remove_trigger': {
            const realId = resolveTriggerId(action.triggerId);
            const res = await fetch(`/api/flows/${flowId}/triggers/${realId}`, {
              method: 'DELETE',
            });
            if (res.ok) {
              commitTriggers(currentTriggers.filter((t) => t.id !== realId));
            }
            break;
          }
          case 'set_trigger_config': {
            const realId = resolveTriggerId(action.triggerId);
            const body: Record<string, unknown> = {};
            if (action.config !== undefined) body.config = action.config;
            if (action.enabled !== undefined) body.enabled = action.enabled;
            const res = await fetch(`/api/flows/${flowId}/triggers/${realId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (res.ok) {
              const payload = await res.json();
              const updated = payload.trigger as FlowApiTrigger;
              commitTriggers(currentTriggers.map((t) => (t.id === realId ? updated : t)));
            }
            break;
          }
        }
      }
    },
    // We intentionally depend on `triggers` here so the local snapshot at
    // the top of the function is fresh; the rest of the setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flowId, triggers, selectedNodeId, edges],
  );

  // Open the AI panel, optionally seeded with a starter prompt from the
  // empty-state hero. The panel auto-sends a queued initial prompt.
  const openAiPanel = useCallback((initial?: string) => {
    setAiInitialPrompt(initial);
    setAiOpen(true);
    // Opening AI implicitly closes whatever other drawer was up — the
    // left rail can only show one panel at a time.
    setActiveDrawer(null);
  }, []);

  // ── Rail dispatch ──
  // Each rail icon has its own semantics. We keep the dispatch here
  // (rather than in IconRail) so the actions can read/mutate FlowBuilder
  // state without prop-drilling individual callbacks.
  const onSelectRailFeature = useCallback(
    (feature: RailFeature) => {
      if (feature === 'iris') {
        if (aiOpen) setAiOpen(false);
        else openAiPanel();
        return;
      }
      if (feature === 'stats') {
        setStatsOverlayOn((v) => !v);
        return;
      }
      if (feature === 'sticky_notes') {
        // Drag-only — handled by onDragStart in IconRail. A click on
        // it (instead of drag) is a no-op until we wire a creation
        // flow / placement hint.
        return;
      }
      // notes | error_log | version_history → toggle the drawer.
      // Opening any of these auto-closes the AI panel.
      setActiveDrawer((cur) => (cur === feature ? null : feature));
      if (aiOpen) setAiOpen(false);
    },
    [aiOpen, openAiPanel],
  );

  // Sticky-note drag source — sets the dataTransfer payload that the
  // canvas `onDrop` reads. Sticky notes themselves aren't wired up
  // yet (no node type, no persistence); for now drop produces a
  // toast.
  const onStickyNoteDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/loomi-sticky-note', '1');
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  // Empty-state heuristic: a fresh flow has nothing but a trigger and
  // (optionally) an exit, with no real configuration. We surface a hero
  // INSIDE the canvas (as ReactFlow custom nodes — see displayedNodes
  // below) so the AI prompt feels like part of the flow rather than
  // chrome floating over it.
  const showEmptyHero = useMemo(() => {
    if (loading || !detail) return false;
    if (emptyStateDismissed) return false;
    if (nodes.length === 0) return true;
    if (nodes.length > 2) return false;
    return nodes.every((n) => n.data.type === 'trigger' || n.data.type === 'exit');
  }, [loading, detail, nodes, emptyStateDismissed]);

  // Empty-state "Add New Trigger" click. The phantom
  // trigger_placeholder fires this; we set the sticky dismiss flag
  // (so showEmptyHero stays false) and select the now-visible real
  // trigger node so its inspector popout opens.
  const dismissEmptyAndOpenTrigger = useCallback(() => {
    setEmptyStateDismissed(true);
    const trigger = nodes.find((n) => n.data.type === 'trigger');
    if (trigger) {
      setNodes((existing) =>
        existing.map((n) => ({ ...n, selected: n.id === trigger.id })),
      );
      setSelectedNodeId(trigger.id);
    }
  }, [nodes, setNodes]);

  // Empty-state morph + phantom. While showEmptyHero is true:
  //  1. The real trigger node renders as the AI hero (type='ai_prompt')
  //     at its natural position — so fitView centers there and a save
  //     still persists the underlying trigger.
  //  2. A phantom `trigger_placeholder` node is injected below it
  //     containing the "Or" divider and the dashed "Add New Trigger"
  //     card (see EmptyStateNodes.tsx).
  //  3. The real exit renders as the small END pill.
  const displayedNodes = useMemo(() => {
    if (!showEmptyHero) return nodes;

    const trigger = nodes.find((n) => n.data.type === 'trigger');
    const anchorX = trigger?.position.x ?? 80;
    const anchorY = trigger?.position.y ?? 80;

    const morphed = nodes.map((n) => {
      if (n.data.type === 'trigger') {
        return {
          ...n,
          type: 'ai_prompt',
          draggable: false,
          selectable: false,
          data: {
            ...n.data,
            // AiPromptNode reads `onAsk` off node.data to fire the
            // chat panel with the user's prompt. The type field on
            // data stays 'trigger' so a future save would still see
            // the underlying node as a trigger.
            onAsk: (prompt: string) => openAiPanel(prompt),
          } as BuilderNodeData,
        };
      }
      if (n.data.type === 'exit') {
        return {
          ...n,
          type: 'end_placeholder',
          draggable: false,
          selectable: false,
        };
      }
      return n;
    });

    // Phantom "Or" + "Add New Trigger" placeholder sitting below the
    // morphed AI card. Width ≈ 260, AI card ≈ 560 — center it on the
    // AI card's centerline. AI card extends to ~y=400 from anchor 80;
    // the halo's `blur-3xl` softens to nothing by ~30px past the card
    // edge, so y-offset 360 lands the "Or" divider ~40px clear of
    // both. Explicit width/height makes fitView's bounding box
    // include this node from the very first render.
    const placeholderNode: Node<BuilderNodeData> = {
      id: '__trigger_placeholder',
      type: 'trigger_placeholder',
      position: { x: anchorX + 150, y: anchorY + 360 },
      width: 260,
      height: 110,
      draggable: false,
      selectable: false,
      data: {
        type: 'trigger_placeholder' as BuilderNodeData['type'],
        config: {},
        onAdd: dismissEmptyAndOpenTrigger,
      } as unknown as BuilderNodeData,
    };

    // Also pin a width/height on the morphed AI prompt so the same
    // first-render fitView knows its bounds. AiPromptNode renders a
    // 560-wide card; height ~320 accounts for title + input + chips
    // + padding.
    const morphedWithBounds = morphed.map((n) =>
      n.type === 'ai_prompt'
        ? { ...n, width: 560, height: 320 }
        : n,
    );

    return [...morphedWithBounds, placeholderNode];
  }, [nodes, showEmptyHero, openAiPanel, dismissEmptyAndOpenTrigger]);

  // Hide the trigger→exit edge while in empty-state so the AI card and
  // (optional) END pill don't have a stray curve drawn between them.
  const displayedEdges = useMemo(() => {
    if (!showEmptyHero) return edges;
    return edges.map((e) => ({ ...e, hidden: true }));
  }, [edges, showEmptyHero]);

  // ReactFlow's `fitView` prop fires once on mount — at which point
  // `nodes` is still empty (the fetch hasn't returned). When the flow
  // loads, we inject phantom empty-state nodes (or real nodes), and
  // when the user later dismisses empty-state by adding a step, the
  // visible content shifts again. The viewport stays put across all of
  // these by default, so we re-fit on every transition: initial load
  // (loading: true→false) and empty-state crossings (showEmptyHero
  // true↔false).
  //
  // `maxZoom: 1.15` keeps the empty-state hero from filling the entire
  // viewport when it's the only visible node — ReactFlow's default
  // would zoom in until the single card occupies all available space.
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(
      () => fitView({ padding: 0.25, duration: 200, maxZoom: 1.15 }),
      80,
    );
    return () => clearTimeout(timer);
  }, [loading, showEmptyHero, fitView]);

  const handlePasteOnEdge = useCallback(
    (edgeId: string) => {
      if (!clipboardNode) return;
      const inserted = insertNodeOnEdge(edgeId, clipboardNode);
      if (inserted) setClipboardNode(null);
    },
    [clipboardNode, insertNodeOnEdge],
  );

  // `insertTarget` drives the step-picker popover. Two modes:
  //   - `edge`: the user hit the hover-+ on an edge; we splice the
  //     new node between source/target via insertNodeOnEdge.
  //   - `after-node`: the user hit the + button below a node; we
  //     append a new node after the source (if leaf) or splice into
  //     its first outgoing edge (if it already has one).
  // Pane-click inserter intentionally removed — adds visual ambiguity
  // and conflicts with the deselect-on-pane-click UX.
  type InsertTarget =
    | { kind: 'edge'; edgeId: string; clientX: number; clientY: number }
    | { kind: 'after-node'; nodeId: string; clientX: number; clientY: number };
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null);

  const handleInsertOnEdge = useCallback(
    (edgeId: string, clientX: number, clientY: number) => {
      setInsertTarget({ kind: 'edge', edgeId, clientX, clientY });
    },
    [],
  );

  const handleAddAfterNode = useCallback(
    (nodeId: string, clientX: number, clientY: number) => {
      setInsertTarget({ kind: 'after-node', nodeId, clientX, clientY });
    },
    [],
  );

  const handleInsertStep = useCallback(
    (type: BuilderNodeType) => {
      if (!insertTarget) return;
      const meta = NODE_META[type];
      if (!meta.executable) {
        toast.error(`${meta.label} isn't available yet.`);
        return;
      }
      if (insertTarget.kind === 'edge') {
        insertNodeOnEdge(insertTarget.edgeId, {
          type,
          config: { ...DEFAULT_NODE_CONFIG[type] },
        });
      } else {
        // "After-node" insert. If the source node already has an
        // outgoing edge, splice into the first one (preserve handle
        // labels for branch edges). If it's a leaf, just append.
        const sourceId = insertTarget.nodeId;
        const outgoing = edges.find((e) => e.source === sourceId);
        if (outgoing) {
          insertNodeOnEdge(outgoing.id, {
            type,
            config: { ...DEFAULT_NODE_CONFIG[type] },
          });
        } else {
          const source = nodes.find((n) => n.id === sourceId);
          if (!source) {
            setInsertTarget(null);
            return;
          }
          const newId = `client-${crypto.randomUUID()}`;
          const newNode: Node<BuilderNodeData> = {
            id: newId,
            type,
            position: {
              x: source.position.x,
              y: source.position.y + 180,
            },
            data: { type, config: { ...DEFAULT_NODE_CONFIG[type] } },
          };
          setNodes((existing) => existing.concat(newNode));
          setEdges((existing) =>
            existing.concat({
              id: `e-${sourceId}-${newId}`,
              source: sourceId,
              target: newId,
              type: 'default',
            }),
          );
          setSelectedNodeId(newId);
          setDirty(true);
          setEmptyStateDismissed(true);
        }
      }
      setInsertTarget(null);
    },
    [insertTarget, insertNodeOnEdge, nodes, edges, setNodes, setEdges],
  );

  // Esc cancels paste mode. Listening on window so it works regardless
  // of where focus is.
  useEffect(() => {
    if (!clipboardNode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setClipboardNode(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clipboardNode]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId, nodes],
  );

  // Keep the previously-selected node mounted briefly after deselect so
  // the inspector's slide-out animation has content to display. Otherwise
  // the panel would slide out empty as soon as the selection clears.
  const [lingeringInspectorNode, setLingeringInspectorNode] =
    useState<Node<BuilderNodeData> | null>(null);

  useEffect(() => {
    if (selectedNode) {
      setLingeringInspectorNode(selectedNode);
      return;
    }
    const timer = setTimeout(() => setLingeringInspectorNode(null), 220);
    return () => clearTimeout(timer);
  }, [selectedNode]);

  const inspectorOpen = !!selectedNode;
  const inspectorNode = selectedNode ?? lingeringInspectorNode;

  // ── Save / publish / pause / duplicate / archive ──
  async function saveGraph() {
    if (!detail) return;
    setSaving(true);
    try {
      const payload = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.data.type,
          config: n.data.config,
          x: n.position.x,
          y: n.position.y,
        })),
        edges: edges.map((e) => ({
          fromNodeId: e.source,
          toNodeId: e.target,
          branch: (e.sourceHandle as string | null) ?? null,
        })),
      };
      const res = await fetch(`/api/flows/${flowId}/graph`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Save failed');
        return;
      }
      const data = await res.json();
      const flow = data.flow as FlowApiDetail;
      setDetail(flow);
      // Capture the server's localId → cuid mapping so publish-time
      // validation errors (which come back keyed by DB cuids) can be
      // translated back to the local node IDs. We deliberately don't
      // setNodes/setEdges with the server's new IDs because rewriting
      // node.id would remount ReactFlow's internal state and wipe the
      // `selected` flag on whichever node is currently chosen.
      const idMap = (data.idMap ?? {}) as Record<string, string>;
      const reverse = new Map<string, string>();
      for (const [localId, serverId] of Object.entries(idMap)) {
        reverse.set(serverId, localId);
      }
      serverToLocalIdRef.current = reverse;
      setDirty(false);
      // Refresh the per-node stats overlay (chips on email/condition
      // nodes). Stats are attached via a separate useEffect that
      // merges them into `node.data.stats`.
      if (flow.publishedAt) {
        void globalMutate(`/api/flows/${flowId}/node-stats`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (dirty) await saveGraph();
    setBusy(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/publish`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const issues: Array<{ nodeId: string | null; message: string }> =
          Array.isArray(payload.issues) ? payload.issues : [];

        // Group messages by node id; null-id issues are graph-level
        // problems (e.g. "must contain a trigger") and only get a
        // toast since there's no specific node to highlight. The
        // validator keys nodeIds with the DB cuid — translate back to
        // the local id via serverToLocalIdRef (populated on save), so
        // freshly-created `client-*` nodes still get their red rings.
        const reverse = serverToLocalIdRef.current;
        const byNode = new Map<string, string[]>();
        const graphLevel: string[] = [];
        for (const issue of issues) {
          if (issue.nodeId) {
            const localId = reverse.get(issue.nodeId) ?? issue.nodeId;
            const arr = byNode.get(localId) ?? [];
            arr.push(issue.message);
            byNode.set(localId, arr);
          } else {
            graphLevel.push(issue.message);
          }
        }

        // Paint matching nodes red on the canvas. Non-matching nodes
        // get their `errors` cleared in the same pass so prior runs
        // don't leave stale red rings on nodes that are now valid.
        setNodes((existing) =>
          existing.map((n) => {
            const nodeErrors = byNode.get(n.id);
            if (!nodeErrors && !n.data.errors) return n;
            return {
              ...n,
              data: { ...n.data, errors: nodeErrors },
            };
          }),
        );

        // Toast covers either graph-level issues (no node to highlight)
        // OR the unstructured-error fallback when the server returned
        // something other than `issues`.
        if (graphLevel.length > 0) {
          toast.error(`Cannot publish: ${graphLevel.join('; ')}`);
        } else if (byNode.size > 0) {
          toast.error(
            `${byNode.size} step${byNode.size === 1 ? '' : 's'} need${byNode.size === 1 ? 's' : ''} attention — see the highlighted nodes.`,
          );
        } else {
          toast.error(payload.error || 'Publish failed');
        }
        return;
      }
      if (detail) setDetail({ ...detail, status: 'active' });
      // Clear any leftover red highlights from a prior failed publish.
      setNodes((existing) =>
        existing.map((n) =>
          n.data.errors ? { ...n, data: { ...n.data, errors: undefined } } : n,
        ),
      );
      toast.success('Flow published — contacts will start enrolling on the next tick.');
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    setBusy(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/pause`, { method: 'POST' });
      if (!res.ok) {
        toast.error('Pause failed');
        return;
      }
      if (detail) setDetail({ ...detail, status: 'paused' });
      toast.success('Flow paused.');
    } finally {
      setBusy(false);
    }
  }

  // duplicate + archive handlers were dropped when those buttons came
  // out of the top bar. The API routes still exist — wire them back up
  // when an overflow menu or list-page bulk-actions return.

  async function renameFlow(name: string) {
    const res = await fetch(`/api/flows/${flowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error('Rename failed');
      return;
    }
    const payload = await res.json();
    if (detail) setDetail({ ...detail, name: payload.flow.name });
  }

  if (loading || !detail) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p className="text-sm text-[var(--muted-foreground)]">Loading flow…</p>
      </div>
    );
  }

  return (
    // Full-screen dotted canvas. Every other UI surface (title group,
    // icon rail, drawer, action bar, popouts) floats on top as a
    // frosted-glass card. The canvas wrapper is the positioned parent
    // for all of them, so absolute positions resolve to viewport
    // coords. `bg-[var(--card)]` is the dotted-canvas base; ReactFlow's
    // Background dots sit on top of it.
    <div
      ref={reactFlowWrapper}
      className="relative h-screen w-screen overflow-hidden bg-[var(--card)]"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <BuilderContextProvider
        value={{
          clipboardNode,
          onCloneNode: handleCloneNode,
          onDeleteNode: handleNodeDelete,
          onPasteOnEdge: handlePasteOnEdge,
          onCancelPaste: handleCancelPaste,
          onInsertOnEdge: handleInsertOnEdge,
          onAddAfterNode: handleAddAfterNode,
          onUpdateNodeConfig: handleConfigChange,
          highlightedNodeId: highlight?.nodeId ?? null,
          highlightSeverity: highlight?.severity ?? null,
        }}
      >
          {/* Floating title group, top-left. Back arrow + editable
              title only; status + save state live elsewhere. */}
          <FloatingTitleGroup flow={detail} onRename={renameFlow} />

          {/* Floating settings cog, top-right. Mirrors the title
              group chrome on the opposite corner. Click → opens the
              FlowSettingsPanel in a BuilderPopout. */}
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Flow settings"
            aria-label="Flow settings"
            aria-pressed={settingsOpen}
            className={`absolute top-4 right-4 z-20 inline-flex items-center justify-center w-10 h-10 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-md transition-colors ${
              settingsOpen
                ? 'text-[var(--primary)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <Cog6ToothIcon className="w-5 h-5" />
          </button>

          {/* Icon rail floats on the left edge, vertically centered.
              Hidden while a drawer / AI panel is open — the drawer's
              own close button brings it back. */}
          {!activeDrawer && !aiOpen && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 z-20">
              <IconRail
                activeDrawer={activeDrawer}
                toggleStates={{ iris: aiOpen, stats: statsOverlayOn }}
                onSelect={onSelectRailFeature}
                onStickyNoteDragStart={onStickyNoteDragStart}
                badges={{ error_log: errorCount }}
              />
            </div>
          )}

          {/* Drawer / AI panel floats on the left, sitting inside the
              canvas's bounds. Top inset clears the title group; bottom
              inset clears the action bar. */}
          {(aiOpen || activeDrawer) && (
            <div className="absolute left-4 top-20 bottom-24 z-20 flex animate-drawer-slide-in">
              {aiOpen ? (
                <FlowAiPanel
                  flowId={flowId}
                  getSnapshot={getAiSnapshot}
                  onApplyActions={applyAiActions}
                  onClose={() => setAiOpen(false)}
                  initialPrompt={aiInitialPrompt}
                />
              ) : activeDrawer ? (
                <FeatureDrawer
                  feature={activeDrawer}
                  onClose={() => setActiveDrawer(null)}
                  issues={activeDrawer === 'error_log' ? liveIssues : undefined}
                  nodeLabel={activeDrawer === 'error_log' ? issueNodeLabel : undefined}
                  onFocusNode={activeDrawer === 'error_log' ? focusNode : undefined}
                />
              ) : null}
            </div>
          )}

          {clipboardNode && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--primary)] text-white text-xs font-semibold shadow-md">
              <span>
                {NODE_META[clipboardNode.type].label} on clipboard — click any
                connection to paste
              </span>
              <button
                type="button"
                onClick={handleCancelPaste}
                className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-white/15 transition-colors"
                title="Cancel paste (Esc)"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {/* `displayedNodes` / `displayedEdges` carry phantom empty-state
              nodes when showEmptyHero is true and the real trigger + exit
              are flagged `hidden: true`. Outside empty-state they pass
              through unchanged. */}
          <ReactFlow
            nodes={displayedNodes}
            edges={displayedEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onNodeClick={onNodeClick}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.15 }}
            nodesDraggable={detail.status !== 'active'}
            nodesConnectable={detail.status !== 'active'}
            elementsSelectable
          >
            <Background gap={16} size={1} color="var(--canvas-dot)" />
            <MiniMap pannable zoomable />
          </ReactFlow>

          {/* Bottom action bar — viewport + undo/redo + auto-format +
              save + Draft/Publish toggle, in one floating cluster. */}
          <BuilderActionBar
            onZoomIn={() => zoomIn()}
            onZoomOut={() => zoomOut()}
            onFitView={() => fitView({ padding: 0.2, duration: 200 })}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            onAutoFormat={handleAutoFormat}
            onSave={() => void saveGraph()}
            saving={saving}
            dirty={dirty}
            isActive={detail.status === 'active'}
            onPublish={publish}
            onPause={pause}
            busy={busy}
          />

          {/* Inspector popout — anchored to the selected node's live
              position so it pans/zooms with the node instead of staying
              static over the canvas. BuilderPopout flips into bounds if
              the node sits too close to an edge. */}
          {inspectorOpen &&
            inspectorNode &&
            inspectorPos &&
            // Sticky notes are inline-editable on the card itself
            // (color picker, trash, drag handle, textarea), so they
            // never open the right-side inspector popout.
            inspectorNode.data.type !== 'sticky_note' && (
            <NodeAnchoredInspector
              node={inspectorNode}
              containerBounds={
                reactFlowWrapper.current
                  ? {
                      width: reactFlowWrapper.current.clientWidth,
                      height: reactFlowWrapper.current.clientHeight,
                    }
                  : undefined
              }
              onClose={handleCloseInspector}
            >
              <BuilderInspector
                selectedNode={inspectorNode}
                nodes={nodes}
                onChange={handleConfigChange}
                onDelete={handleNodeDelete}
                onClose={handleCloseInspector}
                flowId={flowId}
                accountKey={detail.accountKey || null}
                triggers={triggers}
                onTriggersChanged={setTriggers}
              />
            </NodeAnchoredInspector>
          )}

          {/* Flow-level settings popout — anchored top-right just
              under the cog button. */}
          {settingsOpen && (
            <BuilderPopout
              x={
                reactFlowWrapper.current
                  ? reactFlowWrapper.current.clientWidth - 16
                  : 800
              }
              y={64}
              anchor="top-right"
              width={400}
              containerBounds={
                reactFlowWrapper.current
                  ? {
                      width: reactFlowWrapper.current.clientWidth,
                      height: reactFlowWrapper.current.clientHeight,
                    }
                  : undefined
              }
              onClose={() => setSettingsOpen(false)}
            >
              <FlowSettingsPanel
                flowId={flowId}
                initial={detail.settings}
                onSaved={(next) => setDetail({ ...detail, settings: next })}
                onClose={() => setSettingsOpen(false)}
              />
            </BuilderPopout>
          )}
      </BuilderContextProvider>

      {insertTarget && (
        <InsertStepMenu
          clientX={insertTarget.clientX}
          clientY={insertTarget.clientY}
          onPick={handleInsertStep}
          onClose={() => setInsertTarget(null)}
        />
      )}
    </div>
  );
}

// ── Floating title group ──
// Replaces the prior 3-column top bar. Sits in the canvas's top-left
// as a single frosted-glass card with: back arrow + editable flow
// title. Status pill and saved indicator were dropped — the bottom
// action bar's save button (CloudIcon → amber → pulsing) is the
// single source of truth for save state. Publish lives there too.
function FloatingTitleGroup({
  flow,
  onRename,
}: {
  flow: FlowApiDetail;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(flow.name);
  useEffect(() => setName(flow.name), [flow.name]);
  const subHref = useSubaccountHref();

  return (
    <header className="absolute top-4 left-4 z-20 inline-flex items-center gap-2 px-2 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-md">
      <Link
        href={subHref(`/flows/${flow.id}`)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-md hover:bg-[var(--muted)] transition-colors flex-shrink-0"
        title="Back to flow overview"
      >
        <ArrowLeftIcon className="w-5 h-5" />
      </Link>
      {/* Title — inline-editable. Hover shows the border so the
          editability is discoverable; focus tints to primary. */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name !== flow.name) onRename(name);
        }}
        className="text-base font-semibold bg-transparent border border-transparent hover:border-[var(--border)] focus:border-[var(--primary)] rounded-md px-2 py-1.5 outline-none min-w-[200px] max-w-[360px]"
      />
    </header>
  );
}

