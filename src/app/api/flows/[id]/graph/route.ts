import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { forbidTemplateMutation } from '@/lib/flows/route-guards';
import {
  getFlow,
  updateFlowGraph,
  type NodeType,
} from '@/lib/services/loomi-flows';
// Persistence whitelist — the full set of node types the builder can
// place on the canvas. Sourced from validation.ts so it can't drift out
// of sync (a stale local copy here used to silently drop sms/add_tag/
// remove_tag nodes on save, orphaning their edges). Publish-time
// executability is enforced separately.
import { KNOWN_NODE_TYPES } from '@/lib/flows/validation';

interface IncomingNode {
  id?: string;
  type: NodeType;
  config: unknown;
  x: number;
  y: number;
}

interface IncomingEdge {
  fromNodeId: string;
  toNodeId: string;
  branch?: string | null;
}

function normalizeNodes(raw: unknown): IncomingNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes: IncomingNode[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const type = String(row.type || '');
    if (!KNOWN_NODE_TYPES.has(type as NodeType)) continue;
    nodes.push({
      id: typeof row.id === 'string' ? row.id : undefined,
      type: type as NodeType,
      config: row.config ?? {},
      x: Number(row.x ?? 0),
      y: Number(row.y ?? 0),
    });
  }
  return nodes;
}

function normalizeEdges(raw: unknown): IncomingEdge[] {
  if (!Array.isArray(raw)) return [];
  const edges: IncomingEdge[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const fromNodeId = String(row.fromNodeId || '');
    const toNodeId = String(row.toNodeId || '');
    if (!fromNodeId || !toNodeId) continue;
    edges.push({
      fromNodeId,
      toNodeId,
      branch:
        typeof row.branch === 'string'
          ? row.branch
          : row.branch === null
            ? null
            : null,
    });
  }
  return edges;
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const scope =
    session!.user.role === 'client' || session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const templateGuard = forbidTemplateMutation(existing.accountKey, scope);
  if (templateGuard) return templateGuard;

  if (existing.status === 'active') {
    return NextResponse.json(
      {
        error:
          'Pause the flow before editing its graph. (Versioning of live flows is a follow-up; v1 forces a pause.)',
      },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const nodes = normalizeNodes(body?.nodes);
  const edges = normalizeEdges(body?.edges);
  // Drop edges that reference a node not in the payload — belt-and-
  // suspenders so a dropped/unknown node can never leave a dangling edge
  // (which is what corrupted graphs when the node whitelist was stale).
  const nodeIds = new Set(nodes.map((n) => n.id).filter((v): v is string => !!v));
  const connectedEdges = edges.filter(
    (e) => nodeIds.has(e.fromNodeId) && nodeIds.has(e.toNodeId),
  );
  const { flow, idMap } = await updateFlowGraph(id, { nodes, edges: connectedEdges });
  // `idMap` lets the builder translate publish-time validation
  // errors (keyed by the new DB cuids) back to the local `client-*`
  // IDs without remounting the entire canvas.
  return NextResponse.json({ flow, idMap });
}
