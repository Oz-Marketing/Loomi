import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/crypto/encryption';
import { sendEmailViaSendGrid, SendGridError } from '@/lib/sending/sendgrid';
import { buildUnsubscribeFooter } from '@/lib/sending/unsubscribe-footer';
import {
  isLikelyDeliverableEmail,
  normalizeEmailAddress,
} from '@/lib/contact-hygiene';
import { getMessagingSummaryForContacts } from '@/lib/contacts/queries';
import {
  ANNOTATION_NODE_TYPES,
  EXECUTABLE_NODE_TYPES,
  FlowValidationError,
  validateFlowGraph,
  type FlowValidationIssue,
  type NodeType,
  type TriggerType,
} from '@/lib/flows/validation';

// Re-export so existing callers keep working.
export {
  ANNOTATION_NODE_TYPES,
  EXECUTABLE_NODE_TYPES,
  FlowValidationError,
  validateFlowGraph,
};
export type { FlowValidationIssue, NodeType, TriggerType };

// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────

export type FlowStatus = 'draft' | 'active' | 'paused' | 'archived';
export type EnrollmentStatus = 'active' | 'completed' | 'exited' | 'failed';

export interface FlowSummary {
  id: string;
  name: string;
  description: string;
  status: FlowStatus;
  accountKey: string;
  publishedAt: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Derived: count of nodes attached to this flow. */
  nodeCount: number;
  /** Derived: count of active enrollments. */
  activeEnrollments: number;
  /** Set on template instances (deploys); empty string on templates +
   *  standalone flows. */
  parentTemplateId: string;
  /** Last time an instance's graph was sync'd from its parent
   *  template. Empty string when not applicable. */
  lastSyncedAt: string;
}

/** Lineage info for a flow that was deployed from a template. */
export interface FlowParentTemplate {
  id: string;
  name: string;
  /** When the parent template was last edited. Compared against the
   *  instance's lastSyncedAt to compute outOfDate. */
  updatedAt: string;
}

/** One adoption row for a template — describes one of its deployed
 *  instances. Surfaced on FlowDetail (when the flow is a template) and
 *  used to power the adoption column + "update available" banner. */
export interface FlowInstanceRef {
  id: string;
  accountKey: string;
  status: FlowStatus;
  lastSyncedAt: string;
  /** True when the parent template has been updated since the last
   *  sync (template.updatedAt > instance.lastSyncedAt). */
  outOfDate: boolean;
  /** Count of active enrollments on this instance. Lets the template
   *  overview show per-deploy engagement at a glance. */
  activeEnrollments: number;
  /** Last time the instance was edited — drives the "edited X ago"
   *  hint in the deployments list. */
  updatedAt: string;
}

export interface FlowGraphNode {
  id: string;
  type: NodeType;
  config: Record<string, unknown>;
  x: number;
  y: number;
}

export interface FlowGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branch: string | null;
}

export interface FlowTrigger {
  id: string;
  type: TriggerType;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface FlowDetail extends FlowSummary {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  triggers: FlowTrigger[];
  settings: FlowSettings;
  /** Populated when this flow was deployed from a template. */
  parentTemplate: FlowParentTemplate | null;
  /** Populated when this flow IS a template — one entry per deployed
   *  instance. Empty array on instances + standalone flows. */
  instances: FlowInstanceRef[];
}

// ── Flow-level settings ──
//
// JSON blob on LoomiFlow.settings. Every field is optional with a
// sensible default so an unset settings string === "use defaults".
// The worker reads these to apply re-entry guards, quiet-hour pauses,
// goal exits, max-duration timeouts, and DND handling per enrollment.

export type ReEntryPolicy = 'never' | 'after-days' | 'always';
export type DndHandling = 'skip' | 'pause' | 'exit';
export type GoalType = 'tag-added' | 'field-set';

export interface FlowSettings {
  reEntry: {
    policy: ReEntryPolicy;
    /** Cooldown in days when policy === 'after-days'. */
    afterDays?: number;
  };
  quietHours: {
    enabled: boolean;
    /** 24h "HH:mm" in the account's local timezone. */
    start: string;
    end: string;
  };
  goal: {
    enabled: boolean;
    type: GoalType;
    /** Tag name when type === 'tag-added'; "field=value" when
     *  type === 'field-set'. */
    value: string;
  };
  maxDuration: {
    enabled: boolean;
    days: number;
  };
  dndHandling: DndHandling;
}

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  reEntry: { policy: 'never' },
  quietHours: { enabled: false, start: '09:00', end: '21:00' },
  goal: { enabled: false, type: 'tag-added', value: '' },
  maxDuration: { enabled: false, days: 30 },
  dndHandling: 'skip',
};

function parseFlowSettings(raw: string | null | undefined): FlowSettings {
  const parsed = parseJson<Partial<FlowSettings>>(raw, {});
  return {
    reEntry: { ...DEFAULT_FLOW_SETTINGS.reEntry, ...(parsed.reEntry ?? {}) },
    quietHours: {
      ...DEFAULT_FLOW_SETTINGS.quietHours,
      ...(parsed.quietHours ?? {}),
    },
    goal: { ...DEFAULT_FLOW_SETTINGS.goal, ...(parsed.goal ?? {}) },
    maxDuration: {
      ...DEFAULT_FLOW_SETTINGS.maxDuration,
      ...(parsed.maxDuration ?? {}),
    },
    dndHandling: parsed.dndHandling ?? DEFAULT_FLOW_SETTINGS.dndHandling,
  };
}

// ─────────────────────────────────────────────────────
// JSON helpers (Prisma stores config blobs as Strings to
// avoid Json column quirks across providers — matches the
// EmailCampaign.metadata pattern elsewhere in this repo)
// ─────────────────────────────────────────────────────

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function stringifyConfig(config: unknown): string {
  if (config == null) return '{}';
  if (typeof config === 'string') return config;
  return JSON.stringify(config);
}

function toFlowSummary(row: {
  id: string;
  name: string;
  description: string | null;
  status: string;
  accountKey: string | null;
  parentTemplateId?: string | null;
  lastSyncedAt?: Date | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { nodes: number; enrollments?: number };
  // when caller didn't request _count we compute downstream
  nodeCount?: number;
  activeEnrollments?: number;
}): FlowSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    status: row.status as FlowStatus,
    accountKey: row.accountKey || '',
    parentTemplateId: row.parentTemplateId || '',
    lastSyncedAt: row.lastSyncedAt?.toISOString() || '',
    publishedAt: row.publishedAt?.toISOString() || '',
    archivedAt: row.archivedAt?.toISOString() || '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    nodeCount: row.nodeCount ?? row._count?.nodes ?? 0,
    activeEnrollments: row.activeEnrollments ?? 0,
  };
}

// ─────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────

/** Status filter passed to listFlows from the API. `all` means
 *  "everything except archived" (the default — keeps soft-deleted rows
 *  out of view). `draft` covers both 'draft' and 'paused' DB statuses
 *  since we no longer surface 'paused' as its own state in the UI. */
export type FlowStatusFilter = 'all' | 'draft' | 'published' | 'archived';

function statusFilterWhere(filter: FlowStatusFilter | undefined): Record<string, unknown> {
  switch (filter) {
    case 'draft':
      return { status: { in: ['draft', 'paused'] } };
    case 'published':
      return { status: 'active' };
    case 'archived':
      return { status: 'archived' };
    case 'all':
    case undefined:
    default:
      return { status: { not: 'archived' } };
  }
}

export async function listFlows(options?: {
  accountKeys?: string[] | null;
  /** Pre-merge call sites still pass includeArchived — when true,
   *  treated as { statusFilter: 'all' } modulo archived inclusion.
   *  New callers should prefer statusFilter. */
  includeArchived?: boolean;
  statusFilter?: FlowStatusFilter;
}): Promise<FlowSummary[]> {
  const where: Record<string, unknown> = {};
  if (options?.accountKeys && options.accountKeys.length > 0) {
    where.accountKey = { in: options.accountKeys };
  }
  // Status filter takes precedence; fall back to the legacy
  // includeArchived behaviour so existing callers don't break.
  if (options?.statusFilter) {
    Object.assign(where, statusFilterWhere(options.statusFilter));
  } else if (!options?.includeArchived) {
    where.status = { not: 'archived' };
  }

  const rows = await prisma.loomiFlow.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }],
    include: { _count: { select: { nodes: true } } },
  });

  if (rows.length === 0) return [];

  // Count active enrollments per flow in a single grouped query so
  // we don't N+1 when there are dozens of flows.
  const enrollmentCounts = await prisma.loomiFlowEnrollment.groupBy({
    by: ['flowId'],
    where: {
      flowId: { in: rows.map((r) => r.id) },
      status: 'active',
    },
    _count: { _all: true },
  });
  const enrollmentByFlow = new Map(
    enrollmentCounts.map((c) => [c.flowId, c._count._all]),
  );

  return rows.map((row) =>
    toFlowSummary({
      ...row,
      activeEnrollments: enrollmentByFlow.get(row.id) ?? 0,
    }),
  );
}

export async function getFlow(
  id: string,
  accountKeys?: string[] | null,
): Promise<FlowDetail | null> {
  const row = await prisma.loomiFlow.findUnique({
    where: { id },
    include: {
      nodes: true,
      edges: true,
      triggers: true,
      _count: { select: { nodes: true } },
      // Parent template (only set on deployed instances) — used to
      // surface the "Deployed from template X" banner + drive the
      // outOfDate check via updatedAt.
      parentTemplate: { select: { id: true, name: true, updatedAt: true } },
      // Deployed instances (only populated on templates) — used to
      // power the adoption + "update available" banners. Skip archived
      // instances so deleted-but-not-purged copies don't bloat the
      // list.
      instances: {
        where: { status: { not: 'archived' } },
        select: {
          id: true,
          accountKey: true,
          status: true,
          lastSyncedAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!row) return null;
  if (
    accountKeys &&
    accountKeys.length > 0 &&
    row.accountKey &&
    !accountKeys.includes(row.accountKey)
  ) {
    return null;
  }

  const activeEnrollments = await prisma.loomiFlowEnrollment.count({
    where: { flowId: row.id, status: 'active' },
  });

  const parentTemplate: FlowParentTemplate | null = row.parentTemplate
    ? {
        id: row.parentTemplate.id,
        name: row.parentTemplate.name,
        updatedAt: row.parentTemplate.updatedAt.toISOString(),
      }
    : null;

  // Per-instance enrollment counts in one grouped query so the
  // template overview can show engagement per deploy without
  // round-tripping once per instance.
  const instanceEnrollmentCounts =
    row.instances.length > 0
      ? await prisma.loomiFlowEnrollment.groupBy({
          by: ['flowId'],
          where: {
            flowId: { in: row.instances.map((i) => i.id) },
            status: 'active',
          },
          _count: { _all: true },
        })
      : [];
  const instanceEnrollmentByFlow = new Map(
    instanceEnrollmentCounts.map((c) => [c.flowId, c._count._all]),
  );

  // Templates always have row.accountKey === null. We still compute
  // the adoption list unconditionally so consumers don't have to
  // branch — it'll be empty for non-templates anyway.
  const instances: FlowInstanceRef[] = row.instances.map((inst) => {
    const lastSyncedAt = inst.lastSyncedAt?.toISOString() || '';
    // outOfDate iff the parent has been edited *after* the last sync.
    // No sync timestamp → treat as out of date so the user is nudged
    // to do an initial sync. (In practice deploys stamp this so it
    // shouldn't be empty, but legacy rows could lack it.)
    const outOfDate = lastSyncedAt
      ? row.updatedAt.toISOString() > lastSyncedAt
      : true;
    return {
      id: inst.id,
      accountKey: inst.accountKey || '',
      status: inst.status as FlowStatus,
      lastSyncedAt,
      outOfDate,
      activeEnrollments: instanceEnrollmentByFlow.get(inst.id) ?? 0,
      updatedAt: inst.updatedAt.toISOString(),
    };
  });

  return {
    ...toFlowSummary({ ...row, activeEnrollments }),
    nodes: row.nodes.map((n) => ({
      id: n.id,
      type: n.type as NodeType,
      config: parseJson<Record<string, unknown>>(n.config, {}),
      x: n.x,
      y: n.y,
    })),
    edges: row.edges.map((e) => ({
      id: e.id,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      branch: e.branch,
    })),
    triggers: row.triggers.map((t) => ({
      id: t.id,
      type: t.type as TriggerType,
      config: parseJson<Record<string, unknown>>(t.config, {}),
      enabled: t.enabled,
    })),
    settings: parseFlowSettings(row.settings),
    parentTemplate,
    instances,
  };
}

export async function createFlow(data: {
  name: string;
  description?: string;
  accountKey?: string | null;
  createdByUserId?: string | null;
}): Promise<FlowDetail> {
  // Every new flow gets a default Trigger node so the canvas isn't a
  // blank slate; the user adds outgoing edges from this seed.
  const flow = await prisma.loomiFlow.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      accountKey: data.accountKey ?? null,
      createdByUserId: data.createdByUserId ?? null,
      status: 'draft',
      nodes: {
        create: [
          {
            type: 'trigger',
            config: '{}',
            x: 80,
            y: 80,
          },
        ],
      },
    },
    include: { nodes: true, edges: true, triggers: true },
  });

  const detail = await getFlow(flow.id);
  if (!detail) throw new Error('Failed to load freshly-created flow');
  return detail;
}

export async function updateFlow(
  id: string,
  data: {
    name?: string;
    description?: string | null;
    settings?: FlowSettings;
  },
): Promise<FlowSummary> {
  const row = await prisma.loomiFlow.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.settings !== undefined
        ? { settings: JSON.stringify(data.settings) }
        : {}),
    },
    include: { _count: { select: { nodes: true } } },
  });
  return toFlowSummary(row);
}

// Atomic graph replacement. The builder posts the entire node+edge
// list on save; we wipe and recreate inside one transaction so an
// in-flight enrollment can never see a half-written graph.
export async function updateFlowGraph(
  id: string,
  graph: {
    nodes: { id?: string; type: NodeType; config: unknown; x: number; y: number }[];
    edges: { fromNodeId: string; toNodeId: string; branch?: string | null }[];
  },
): Promise<{ flow: FlowDetail; idMap: Record<string, string> }> {
  // Build a map: client-provided node id (or generated index key) → real cuid.
  // We let Prisma assign cuids on insert so we don't have to trust the client.
  // Returned to the caller so the builder can translate publish-time
  // validation errors (keyed by the new DB cuids) back to the local
  // `client-*` IDs without having to re-render the entire canvas.
  const idMap: Record<string, string> = {};
  await prisma.$transaction(async (tx) => {
    await tx.loomiFlowEdge.deleteMany({ where: { flowId: id } });
    await tx.loomiFlowNode.deleteMany({ where: { flowId: id } });

    const localMap = new Map<string, string>();
    for (const node of graph.nodes) {
      const created = await tx.loomiFlowNode.create({
        data: {
          flowId: id,
          type: node.type,
          config: stringifyConfig(node.config),
          x: node.x,
          y: node.y,
        },
      });
      if (node.id) {
        localMap.set(node.id, created.id);
        idMap[node.id] = created.id;
      }
    }

    for (const edge of graph.edges) {
      const from = localMap.get(edge.fromNodeId) ?? edge.fromNodeId;
      const to = localMap.get(edge.toNodeId) ?? edge.toNodeId;
      // Drop edges that point to nodes that vanished mid-edit — the
      // builder shouldn't ever ship these but we guard so we don't
      // store dangling FK strings.
      if (!from || !to) continue;
      await tx.loomiFlowEdge.create({
        data: {
          flowId: id,
          fromNodeId: from,
          toNodeId: to,
          branch: edge.branch ?? null,
        },
      });
    }

    await tx.loomiFlow.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  });

  const detail = await getFlow(id);
  if (!detail) throw new Error('Flow vanished mid-update');
  return { flow: detail, idMap };
}

export async function publishFlow(id: string): Promise<FlowSummary> {
  const flow = await prisma.loomiFlow.findUnique({
    where: { id },
    include: { nodes: true, edges: true },
  });
  if (!flow) throw new Error('Flow not found');

  // Validate graph before publishing — every non-exit node needs at
  // least one outgoing edge; condition needs both yes/no; split needs
  // weights summing to 1. Returning here surfaces a 400 in the API.
  const validation = validateFlowGraph({
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      type: n.type as NodeType,
      config: parseJson(n.config, {}),
    })),
    edges: flow.edges.map((e) => ({
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      branch: e.branch,
    })),
  });
  if (!validation.ok) {
    throw new FlowValidationError(validation.issues);
  }

  const updated = await prisma.loomiFlow.update({
    where: { id },
    data: {
      status: 'active',
      publishedAt: flow.publishedAt ?? new Date(),
      archivedAt: null,
    },
    include: { _count: { select: { nodes: true } } },
  });
  return toFlowSummary(updated);
}

export async function pauseFlow(id: string): Promise<FlowSummary> {
  const updated = await prisma.loomiFlow.update({
    where: { id },
    data: { status: 'paused' },
    include: { _count: { select: { nodes: true } } },
  });
  return toFlowSummary(updated);
}

export async function archiveFlow(id: string): Promise<FlowSummary> {
  const updated = await prisma.loomiFlow.update({
    where: { id },
    data: { status: 'archived', archivedAt: new Date() },
    include: { _count: { select: { nodes: true } } },
  });
  return toFlowSummary(updated);
}

// Inverse of archiveFlow. Pops the row back to 'draft' (the UI's
// unified inactive state — 'paused' is no longer surfaced as a
// distinct vocabulary) and clears the archivedAt timestamp so the
// 30-day purge job leaves it alone.
export async function restoreFlow(id: string): Promise<FlowSummary> {
  const updated = await prisma.loomiFlow.update({
    where: { id },
    data: { status: 'draft', archivedAt: null },
    include: { _count: { select: { nodes: true } } },
  });
  return toFlowSummary(updated);
}

// Hard-delete archived flows older than the retention window. Cascades
// wipe nodes/edges/triggers/enrollments and orphan any instances via
// the SetNull rule on parentTemplateId. Invoked by the daily purge
// job. Returns the deleted-row count for logging.
export async function purgeOldArchivedFlows(
  retentionDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.loomiFlow.deleteMany({
    where: {
      status: 'archived',
      archivedAt: { not: null, lt: cutoff },
    },
  });
  return result.count;
}

export async function duplicateFlow(
  id: string,
  options?: {
    name?: string;
    createdByUserId?: string | null;
    /** When provided, the clone is created under this accountKey
     *  instead of inheriting the source's. Pass `null` to explicitly
     *  detach (i.e. clone an account flow as a template). */
    accountKeyOverride?: string | null;
    /** JSON-serialisable metadata to stamp on the clone — used by
     *  template deploys to record arbitrary annotation data
     *  (parentTemplateId now lives on its own column, but this
     *  stays available for free-form notes). */
    metadata?: Record<string, unknown>;
    /** Whether to carry over the source flow's settings JSON. Default
     *  false to preserve existing duplicateFlow callers' behaviour;
     *  template → instance deploys flip this to true so quiet hours,
     *  goal config, etc. propagate. */
    preserveSettings?: boolean;
    /** Stamp parent template lineage on the clone. Used by template
     *  deploys so adoption + re-push can find instances later. */
    parentTemplateId?: string | null;
  },
): Promise<FlowDetail> {
  const source = await getFlow(id);
  if (!source) throw new Error('Source flow not found');

  const accountKey =
    options?.accountKeyOverride === undefined
      ? source.accountKey || null
      : options.accountKeyOverride;

  const clone = await prisma.loomiFlow.create({
    data: {
      name: options?.name ?? `${source.name} (copy)`,
      description: source.description || null,
      accountKey,
      createdByUserId: options?.createdByUserId ?? null,
      status: 'draft',
      sourceAudienceId: null,
      sourceFilter: null,
      metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
      settings: options?.preserveSettings ? JSON.stringify(source.settings) : null,
      parentTemplateId: options?.parentTemplateId ?? null,
      // Stamp lastSyncedAt at create time on instances so the
      // "update available" banner only triggers if the template is
      // edited *after* this deploy.
      lastSyncedAt: options?.parentTemplateId ? new Date() : null,
    },
  });

  // Map old node id → new node id so cloned edges reattach to clones.
  const idMap = new Map<string, string>();
  for (const node of source.nodes) {
    const created = await prisma.loomiFlowNode.create({
      data: {
        flowId: clone.id,
        type: node.type,
        config: stringifyConfig(node.config),
        x: node.x,
        y: node.y,
      },
    });
    idMap.set(node.id, created.id);
  }

  for (const edge of source.edges) {
    const from = idMap.get(edge.fromNodeId);
    const to = idMap.get(edge.toNodeId);
    if (!from || !to) continue;
    await prisma.loomiFlowEdge.create({
      data: {
        flowId: clone.id,
        fromNodeId: from,
        toNodeId: to,
        branch: edge.branch,
      },
    });
  }

  for (const trigger of source.triggers) {
    await prisma.loomiFlowTrigger.create({
      data: {
        flowId: clone.id,
        type: trigger.type,
        // Cloned triggers default to disabled so the duplicate can't
        // immediately start enrolling contacts before the user reviews.
        enabled: false,
        config: stringifyConfig(trigger.config),
      },
    });
  }

  const detail = await getFlow(clone.id);
  if (!detail) throw new Error('Failed to load duplicate flow');
  return detail;
}

// ─────────────────────────────────────────────────────
// Template deploys
// ─────────────────────────────────────────────────────
//
// A "template" is a flow with no accountKey. Deploying duplicates it
// once per target sub-account, stamps parentTemplateId into the
// instance's metadata, and preserves the template's settings JSON so
// quiet hours / goals / re-entry policy carry over.

export interface DeployResult {
  /** Created flow instances, one per target account. */
  flows: FlowDetail[];
  /** Per-account failures (key → error message). Successes are in
   *  `flows`; this surfaces partial-failure cases to the UI. */
  failures: Array<{ accountKey: string; error: string }>;
}

export async function deployFlowToAccounts(
  sourceFlowId: string,
  targetAccountKeys: string[],
  options?: { createdByUserId?: string | null },
): Promise<DeployResult> {
  const source = await getFlow(sourceFlowId);
  if (!source) throw new Error('Source flow not found');
  if (source.accountKey) {
    throw new Error(
      'Only template flows (no accountKey) can be deployed to sub-accounts.',
    );
  }

  const flows: FlowDetail[] = [];
  const failures: Array<{ accountKey: string; error: string }> = [];

  // De-dupe targets so accidental double-selects don't create two
  // copies in the same account.
  const uniqueTargets = [...new Set(targetAccountKeys)];

  for (const accountKey of uniqueTargets) {
    try {
      const instance = await duplicateFlow(sourceFlowId, {
        name: source.name,
        createdByUserId: options?.createdByUserId ?? null,
        accountKeyOverride: accountKey,
        preserveSettings: true,
        parentTemplateId: sourceFlowId,
        metadata: {
          deployedAt: new Date().toISOString(),
        },
      });
      flows.push(instance);
    } catch (err) {
      failures.push({
        accountKey,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { flows, failures };
}

/**
 * Re-syncs an instance flow from its parent template — replaces the
 * instance's nodes, edges, and settings with the template's current
 * state. Preserves the instance's identity (id, accountKey, name,
 * status, triggers). Used by the "Update instances" affordance on
 * template overviews.
 *
 * Rejects if the flow has no parentTemplateId (i.e. isn't a deployed
 * instance) or if the parent has been deleted.
 */
export async function syncFlowFromTemplate(instanceId: string): Promise<FlowDetail> {
  const instance = await prisma.loomiFlow.findUnique({
    where: { id: instanceId },
    select: { id: true, parentTemplateId: true },
  });
  if (!instance) throw new Error('Instance flow not found');
  if (!instance.parentTemplateId) {
    throw new Error('Flow is not a template instance — nothing to sync from.');
  }
  const template = await getFlow(instance.parentTemplateId);
  if (!template) {
    throw new Error('Parent template no longer exists.');
  }

  // Wipe the instance graph + replace from the template in a single
  // transaction so a partial replay can't leave the instance in a
  // half-rebuilt state.
  await prisma.$transaction(async (tx) => {
    await tx.loomiFlowEdge.deleteMany({ where: { flowId: instanceId } });
    await tx.loomiFlowNode.deleteMany({ where: { flowId: instanceId } });

    // Re-create nodes; keep a local id map so edges reattach.
    const idMap = new Map<string, string>();
    for (const node of template.nodes) {
      const created = await tx.loomiFlowNode.create({
        data: {
          flowId: instanceId,
          type: node.type,
          config: stringifyConfig(node.config),
          x: node.x,
          y: node.y,
        },
      });
      idMap.set(node.id, created.id);
    }
    for (const edge of template.edges) {
      const from = idMap.get(edge.fromNodeId);
      const to = idMap.get(edge.toNodeId);
      if (!from || !to) continue;
      await tx.loomiFlowEdge.create({
        data: { flowId: instanceId, fromNodeId: from, toNodeId: to, branch: edge.branch },
      });
    }

    // Mirror template settings so quiet hours / goal / re-entry
    // policy stays in sync. Triggers, name, status, accountKey are
    // explicitly NOT touched — they belong to the instance.
    await tx.loomiFlow.update({
      where: { id: instanceId },
      data: {
        settings: JSON.stringify(template.settings),
        lastSyncedAt: new Date(),
      },
    });
  });

  const refreshed = await getFlow(instanceId);
  if (!refreshed) throw new Error('Failed to reload instance after sync.');
  return refreshed;
}

/**
 * Convenience: re-sync every instance of a template that is currently
 * out-of-date. Returns a deploy-style summary of successes + failures
 * so the UI can present partial outcomes.
 */
export async function syncAllOutOfDateInstances(
  templateId: string,
): Promise<DeployResult> {
  const template = await getFlow(templateId);
  if (!template) throw new Error('Template not found');
  if (template.accountKey) {
    throw new Error('Only template flows can be bulk-sync\'d.');
  }
  const targets = template.instances.filter((i) => i.outOfDate);
  const flows: FlowDetail[] = [];
  const failures: Array<{ accountKey: string; error: string }> = [];
  for (const target of targets) {
    try {
      const synced = await syncFlowFromTemplate(target.id);
      flows.push(synced);
    } catch (err) {
      failures.push({
        accountKey: target.accountKey,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
  return { flows, failures };
}

// ─────────────────────────────────────────────────────
// Triggers
// ─────────────────────────────────────────────────────

export async function listTriggers(flowId: string): Promise<FlowTrigger[]> {
  const rows = await prisma.loomiFlowTrigger.findMany({
    where: { flowId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((t) => ({
    id: t.id,
    type: t.type as TriggerType,
    config: parseJson<Record<string, unknown>>(t.config, {}),
    enabled: t.enabled,
  }));
}

export async function createTrigger(
  flowId: string,
  data: { type: TriggerType; config?: unknown; enabled?: boolean },
): Promise<FlowTrigger> {
  const created = await prisma.loomiFlowTrigger.create({
    data: {
      flowId,
      type: data.type,
      config: stringifyConfig(data.config ?? {}),
      enabled: data.enabled ?? true,
    },
  });
  return {
    id: created.id,
    type: created.type as TriggerType,
    config: parseJson<Record<string, unknown>>(created.config, {}),
    enabled: created.enabled,
  };
}

export async function updateTrigger(
  triggerId: string,
  data: { config?: unknown; enabled?: boolean },
): Promise<FlowTrigger> {
  const updated = await prisma.loomiFlowTrigger.update({
    where: { id: triggerId },
    data: {
      ...(data.config !== undefined ? { config: stringifyConfig(data.config) } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    },
  });
  return {
    id: updated.id,
    type: updated.type as TriggerType,
    config: parseJson<Record<string, unknown>>(updated.config, {}),
    enabled: updated.enabled,
  };
}

export async function deleteTrigger(triggerId: string): Promise<void> {
  await prisma.loomiFlowTrigger.delete({ where: { id: triggerId } });
}

// ─────────────────────────────────────────────────────
// Enrollment
// ─────────────────────────────────────────────────────

/**
 * Find the entry node for a flow (the `trigger` type) and the node
 * the first outgoing edge points to — that's where new enrollments
 * start. Returns null if the graph doesn't have a trigger node or
 * the trigger has no outgoing edge yet (flow isn't ready to enroll).
 */
async function findEntryAdvanceNodeId(flowId: string): Promise<string | null> {
  const triggerNode = await prisma.loomiFlowNode.findFirst({
    where: { flowId, type: 'trigger' },
  });
  if (!triggerNode) return null;
  const firstEdge = await prisma.loomiFlowEdge.findFirst({
    where: { flowId, fromNodeId: triggerNode.id },
    orderBy: { createdAt: 'asc' },
  });
  return firstEdge?.toNodeId ?? null;
}

/**
 * Enroll a batch of contacts into a flow. Skips contacts already
 * enrolled (active) or that the suppression list / DND state blocks.
 * Returns the count of newly-created enrollments.
 */
export async function enrollContacts(
  flowId: string,
  contactIds: string[],
  options?: { triggerId?: string | null },
): Promise<{ enrolled: number; skipped: number; reason: Record<string, number> }> {
  if (contactIds.length === 0) {
    return { enrolled: 0, skipped: 0, reason: {} };
  }

  const flow = await prisma.loomiFlow.findUnique({ where: { id: flowId } });
  if (!flow) throw new Error('Flow not found');
  if (flow.status !== 'active') {
    return {
      enrolled: 0,
      skipped: contactIds.length,
      reason: { flow_not_active: contactIds.length },
    };
  }

  const entryNode = await findEntryAdvanceNodeId(flowId);
  if (!entryNode) {
    return {
      enrolled: 0,
      skipped: contactIds.length,
      reason: { flow_no_entry: contactIds.length },
    };
  }

  // Pull already-enrolled contacts in one query to skip them.
  const existing = await prisma.loomiFlowEnrollment.findMany({
    where: { flowId, contactId: { in: contactIds }, status: 'active' },
    select: { contactId: true },
  });
  const alreadyEnrolled = new Set(existing.map((e) => e.contactId));

  const reason: Record<string, number> = {};
  let enrolled = 0;
  let skipped = 0;
  const now = new Date();

  for (const contactId of contactIds) {
    if (alreadyEnrolled.has(contactId)) {
      skipped++;
      reason.already_enrolled = (reason.already_enrolled ?? 0) + 1;
      continue;
    }
    try {
      await prisma.loomiFlowEnrollment.create({
        data: {
          flowId,
          contactId,
          triggerId: options?.triggerId ?? null,
          status: 'active',
          currentNodeId: entryNode,
          nextRunAt: now,
        },
      });
      enrolled++;
    } catch (err) {
      // Unique constraint races (someone enrolled them on the
      // previous tick) → treat as already enrolled, not an error.
      skipped++;
      const code = (err as { code?: string }).code;
      if (code === 'P2002') {
        reason.race_already_enrolled = (reason.race_already_enrolled ?? 0) + 1;
      } else {
        reason.create_failed = (reason.create_failed ?? 0) + 1;
      }
    }
  }

  return { enrolled, skipped, reason };
}

// ─────────────────────────────────────────────────────
// Event-driven enrollment — form_submission
// ─────────────────────────────────────────────────────

/**
 * Enroll a contact into every active flow that has an enabled
 * `form_submission` trigger pointing at the given form.
 *
 * Called by the forms submit pipeline (src/lib/forms/submit.ts) right
 * after a Contact is upserted from a submission. The trigger poll
 * worker doesn't process this trigger type — submissions are the only
 * source of enrollments for `form_submission` triggers.
 *
 * Returns a summary across all triggers fired. Soft-fails on
 * individual flow errors so one misconfigured flow doesn't block
 * enrollment into other flows attached to the same form.
 */
export async function enrollContactForFormSubmission(args: {
  formId: string;
  contactId: string;
  /** Account scope guard — only triggers on flows in this account fire. */
  accountKey: string;
}): Promise<{
  triggersFired: number;
  enrolled: number;
  skipped: number;
}> {
  const { formId, contactId, accountKey } = args;

  // Pull every enabled form_submission trigger across active flows in
  // the matching account. We filter on `accountKey` here rather than
  // relying on UI gating because a form could theoretically be linked
  // to a flow in another account if someone hand-crafts the trigger.
  const triggers = await prisma.loomiFlowTrigger.findMany({
    where: {
      enabled: true,
      type: 'form_submission',
      flow: { status: 'active', accountKey },
    },
    select: { id: true, flowId: true, config: true },
  });

  let totalEnrolled = 0;
  let totalSkipped = 0;
  let firedCount = 0;

  for (const trigger of triggers) {
    const config = parseJson<Record<string, unknown>>(trigger.config, {});
    if (config.formId !== formId) continue;
    firedCount += 1;

    try {
      const result = await enrollContacts(trigger.flowId, [contactId], {
        triggerId: trigger.id,
      });
      totalEnrolled += result.enrolled;
      totalSkipped += result.skipped;
    } catch (err) {
      console.error(
        `[loomi-flows] form_submission enrollment failed for trigger ${trigger.id}`,
        err,
      );
      totalSkipped += 1;
    }
  }

  return { triggersFired: firedCount, enrolled: totalEnrolled, skipped: totalSkipped };
}

// ─────────────────────────────────────────────────────
// Trigger polling — runs every 5min in the worker
// ─────────────────────────────────────────────────────

/**
 * Pull every enabled `list` and `audience` trigger across active flows
 * and enroll contacts that match but aren't already enrolled. `manual`
 * triggers do nothing here — they fire via the /enroll API. `event`
 * triggers are deferred (no event ingestion source yet).
 */
export async function processFlowTriggers(): Promise<{
  enrolled: number;
  triggersProcessed: number;
}> {
  const triggers = await prisma.loomiFlowTrigger.findMany({
    where: {
      enabled: true,
      type: { in: ['list', 'audience'] },
      flow: { status: 'active' },
    },
    include: { flow: true },
  });

  let totalEnrolled = 0;
  for (const trigger of triggers) {
    try {
      const config = parseJson<Record<string, unknown>>(trigger.config, {});
      let contactIds: string[] = [];

      if (trigger.type === 'list') {
        const listId = typeof config.listId === 'string' ? config.listId : null;
        if (!listId) continue;
        const memberships = await prisma.contactListMembership.findMany({
          where: { listId },
          select: { contactId: true },
        });
        contactIds = memberships.map((m) => m.contactId);
      } else if (trigger.type === 'audience') {
        // Audience triggers reuse the saved-filter contact resolver:
        // pull all contacts in scope, then evaluate the filter client-
        // side. We do this in batches to avoid loading huge result sets
        // into memory; v1 caps at the first 10k contacts per account.
        const audienceId = typeof config.audienceId === 'string' ? config.audienceId : null;
        if (!audienceId) continue;
        const audience = await prisma.audience.findUnique({ where: { id: audienceId } });
        if (!audience) continue;
        if (!trigger.flow.accountKey) continue;
        contactIds = await resolveAudienceContactIds(
          trigger.flow.accountKey,
          audience.filters,
        );
      }

      if (contactIds.length === 0) continue;
      const result = await enrollContacts(trigger.flowId, contactIds, {
        triggerId: trigger.id,
      });
      totalEnrolled += result.enrolled;
    } catch (err) {
      console.error(
        `[loomi-flows] trigger ${trigger.id} (${trigger.type}) failed`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { enrolled: totalEnrolled, triggersProcessed: triggers.length };
}

/**
 * Server-side audience resolution. The browser smart-list-engine works
 * on already-fetched Contact arrays; here we replicate the key cases
 * with raw Prisma queries so the worker doesn't need to load the
 * client-only smart-list-engine module (which imports browser types).
 *
 * v1 supports the simplest evaluator: load every contact for the
 * account and run the same JS predicate logic that smart-list-engine
 * would. Scaled accounts (10k+ contacts) will want SQL translation
 * later; for now we cap at 10k rows so a giant filter doesn't OOM
 * the worker.
 */
async function resolveAudienceContactIds(
  accountKey: string,
  filtersJson: string,
): Promise<string[]> {
  const definition = parseJson<{
    logic?: 'AND' | 'OR';
    groups?: Array<{
      logic?: 'AND' | 'OR';
      conditions?: Array<{
        field: string;
        operator: string;
        value?: unknown;
        value2?: unknown;
      }>;
    }>;
  }>(filtersJson, { groups: [] });

  if (!definition.groups || definition.groups.length === 0) return [];

  const contacts = await prisma.contact.findMany({
    where: { accountKey },
    take: 10_000,
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      tags: true,
      source: true,
      city: true,
      state: true,
      vehicleMake: true,
      vehicleModel: true,
      vehicleYear: true,
    },
  });

  const matched: string[] = [];
  for (const contact of contacts) {
    const groupResults = definition.groups.map((group) => {
      if (!group.conditions || group.conditions.length === 0) return true;
      const conditionResults = group.conditions.map((c) =>
        evaluatePredicate(contact, c.field, c.operator, c.value, c.value2),
      );
      return (group.logic ?? 'AND') === 'AND'
        ? conditionResults.every(Boolean)
        : conditionResults.some(Boolean);
    });
    const all = (definition.logic ?? 'AND') === 'AND'
      ? groupResults.every(Boolean)
      : groupResults.some(Boolean);
    if (all) matched.push(contact.id);
  }
  return matched;
}

function evaluatePredicate(
  contact: Record<string, unknown>,
  field: string,
  operator: string,
  value: unknown,
  value2: unknown,
): boolean {
  const raw = contact[field];
  switch (operator) {
    case 'equals':
      return String(raw ?? '').toLowerCase() === String(value ?? '').toLowerCase();
    case 'not_equals':
      return String(raw ?? '').toLowerCase() !== String(value ?? '').toLowerCase();
    case 'contains':
      return String(raw ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());
    case 'starts_with':
      return String(raw ?? '').toLowerCase().startsWith(String(value ?? '').toLowerCase());
    case 'is_set':
      return raw !== null && raw !== undefined && raw !== '';
    case 'is_not_set':
      return raw === null || raw === undefined || raw === '';
    case 'in': {
      const list = Array.isArray(value) ? value : [];
      return list.map((v) => String(v).toLowerCase()).includes(String(raw ?? '').toLowerCase());
    }
    case 'between': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return false;
      return n >= Number(value) && n <= Number(value2);
    }
    case 'has_tag': {
      const tags = Array.isArray(raw) ? raw : [];
      return tags.map((t) => String(t).toLowerCase()).includes(String(value ?? '').toLowerCase());
    }
    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────
// Execution engine — processes enrollments tick-by-tick
// ─────────────────────────────────────────────────────

interface NodeForExecution {
  id: string;
  type: NodeType;
  config: Record<string, unknown>;
}

async function loadFlowExecutionState(flowId: string): Promise<{
  nodesById: Map<string, NodeForExecution>;
  edgesByFromId: Map<string, { toNodeId: string; branch: string | null }[]>;
}> {
  const [nodes, edges] = await Promise.all([
    prisma.loomiFlowNode.findMany({ where: { flowId } }),
    prisma.loomiFlowEdge.findMany({ where: { flowId } }),
  ]);
  const nodesById = new Map<string, NodeForExecution>();
  for (const n of nodes) {
    nodesById.set(n.id, {
      id: n.id,
      type: n.type as NodeType,
      config: parseJson<Record<string, unknown>>(n.config, {}),
    });
  }
  const edgesByFromId = new Map<string, { toNodeId: string; branch: string | null }[]>();
  for (const e of edges) {
    const arr = edgesByFromId.get(e.fromNodeId) ?? [];
    arr.push({ toNodeId: e.toNodeId, branch: e.branch });
    edgesByFromId.set(e.fromNodeId, arr);
  }
  return { nodesById, edgesByFromId };
}

/**
 * Advance a single enrollment one step. Returns the new currentNodeId
 * + nextRunAt + status the caller will write back. We avoid mutating
 * the DB inline so the caller can wrap multiple ticks in retry logic.
 *
 * Wait nodes return `{ nextRunAt: future }` and keep the cursor on the
 * wait node; the next tick picks the wait node up again, finds the
 * delay has elapsed, and advances. This avoids needing a separate
 * "wait-fired" event source.
 */
export async function processEnrollmentTick(enrollmentId: string): Promise<void> {
  const enrollment = await prisma.loomiFlowEnrollment.findUnique({
    where: { id: enrollmentId },
  });
  if (!enrollment) return;
  if (enrollment.status !== 'active') return;
  if (!enrollment.currentNodeId) {
    await prisma.loomiFlowEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'completed', completedAt: new Date() },
    });
    return;
  }

  const { nodesById, edgesByFromId } = await loadFlowExecutionState(enrollment.flowId);
  const node = nodesById.get(enrollment.currentNodeId);
  if (!node) {
    // Graph mutated underneath us — bail rather than loop forever.
    await prisma.loomiFlowEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: 'failed',
        metadata: stringifyConfig({ error: 'current node missing from graph' }),
      },
    });
    return;
  }

  switch (node.type) {
    case 'email': {
      await executeEmailNode(enrollment, node);
      const next = pickNextNode(node, edgesByFromId, null);
      await advanceEnrollment(enrollmentId, next, null);
      return;
    }
    case 'wait': {
      const ms = readNumber(node.config.ms, 0);
      // Has the wait elapsed? If not, push nextRunAt to fire time and
      // leave the cursor on this node.
      const sinceMs = Date.now() - new Date(enrollment.updatedAt).getTime();
      if (sinceMs < ms) {
        await prisma.loomiFlowEnrollment.update({
          where: { id: enrollmentId },
          data: { nextRunAt: new Date(Date.now() + (ms - sinceMs)) },
        });
        return;
      }
      await prisma.loomiFlowEnrollmentStep.create({
        data: { enrollmentId, nodeId: node.id, status: 'waited' },
      });
      const next = pickNextNode(node, edgesByFromId, null);
      await advanceEnrollment(enrollmentId, next, null);
      return;
    }
    case 'condition': {
      const branch = await evaluateConditionBranch(enrollment, node);
      const next = pickNextNode(node, edgesByFromId, branch);
      await prisma.loomiFlowEnrollmentStep.create({
        data: { enrollmentId, nodeId: node.id, status: 'branched', branch },
      });
      await advanceEnrollment(enrollmentId, next, branch);
      return;
    }
    case 'split': {
      const weights = Array.isArray(node.config.weights)
        ? (node.config.weights as unknown[]).map((w) => Number(w) || 0)
        : [];
      const labels = Array.isArray(node.config.labels)
        ? (node.config.labels as unknown[]).map((l) => String(l))
        : [];
      const branch = pickWeightedBranch(weights, labels);
      const next = pickNextNode(node, edgesByFromId, branch);
      await prisma.loomiFlowEnrollmentStep.create({
        data: { enrollmentId, nodeId: node.id, status: 'branched', branch },
      });
      await advanceEnrollment(enrollmentId, next, branch);
      return;
    }
    case 'exit': {
      await prisma.loomiFlowEnrollmentStep.create({
        data: { enrollmentId, nodeId: node.id, status: 'exited' },
      });
      await prisma.loomiFlowEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'completed', completedAt: new Date(), currentNodeId: null },
      });
      return;
    }
    case 'trigger': {
      // Trigger nodes are entry points; we shouldn't normally land on
      // one mid-flow, but if we do, just advance to the first edge.
      const next = pickNextNode(node, edgesByFromId, null);
      await advanceEnrollment(enrollmentId, next, null);
      return;
    }
    default: {
      // New node types (sms, add_tag, ...) reach the canvas but their
      // execution paths haven't landed yet. validateFlowGraph blocks
      // publish for these, but we still guard at runtime so a flow
      // that snuck through doesn't pin a worker slot indefinitely.
      // Fail the enrollment with a clear marker so the user can see
      // exactly which step is unsupported.
      await prisma.loomiFlowEnrollmentStep.create({
        data: {
          enrollmentId,
          nodeId: node.id,
          status: 'failed',
          metadata: stringifyConfig({
            reason: `Node type "${node.type}" is not executable yet`,
          }),
        },
      });
      await prisma.loomiFlowEnrollment.update({
        where: { id: enrollmentId },
        data: {
          status: 'failed',
          metadata: stringifyConfig({
            error: `Node type "${node.type}" is not executable yet`,
          }),
        },
      });
      return;
    }
  }
}

function pickNextNode(
  node: NodeForExecution,
  edgesByFromId: Map<string, { toNodeId: string; branch: string | null }[]>,
  preferredBranch: string | null,
): string | null {
  const outgoing = edgesByFromId.get(node.id);
  if (!outgoing || outgoing.length === 0) return null;
  if (preferredBranch) {
    const match = outgoing.find((e) => e.branch === preferredBranch);
    if (match) return match.toNodeId;
  }
  return outgoing[0].toNodeId;
}

function pickWeightedBranch(weights: number[], labels: string[]): string {
  if (weights.length === 0) return 'a';
  const total = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (total <= 0) return labels[0] ?? 'a';
  let target = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    const w = Math.max(0, weights[i]);
    if (target < w) return labels[i] ?? `b${i}`;
    target -= w;
  }
  return labels[labels.length - 1] ?? 'a';
}

async function advanceEnrollment(
  enrollmentId: string,
  nextNodeId: string | null,
  _branch: string | null,
): Promise<void> {
  if (!nextNodeId) {
    await prisma.loomiFlowEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'completed', completedAt: new Date(), currentNodeId: null },
    });
    return;
  }
  await prisma.loomiFlowEnrollment.update({
    where: { id: enrollmentId },
    data: { currentNodeId: nextNodeId, nextRunAt: new Date() },
  });
}

function readNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ─────────────────────────────────────────────────────
// Condition evaluator
// ─────────────────────────────────────────────────────

interface ConditionRule {
  id?: string;
  field: string;
  operator: string;
  value?: string;
  value2?: string;
}

interface ConditionBranchCfg {
  id: string;
  label?: string;
  logic?: 'AND' | 'OR';
  rules: ConditionRule[];
}

interface ConditionCfg {
  branches?: ConditionBranchCfg[];
  fallbackLabel?: string;
}

/**
 * Evaluate a condition node's branches against the contact and return
 * the id of the branch the enrollment should follow ('else' if nothing
 * matches). Branches evaluate top-to-bottom and the first match wins.
 *
 * Each rule is one field/operator/value check against the contact.
 * Operators line up with the existing `smart-list-types` definitions
 * (text/date/tags/boolean) so the inspector UI and the worker speak
 * the same vocabulary.
 */
async function evaluateConditionBranch(
  enrollment: { id: string; contactId: string },
  node: NodeForExecution,
): Promise<string> {
  const cfg = (node.config as ConditionCfg) ?? {};
  const branches = Array.isArray(cfg.branches) ? cfg.branches : [];
  if (branches.length === 0) return 'else';

  const contact = await prisma.contact.findUnique({
    where: { id: enrollment.contactId },
  });
  if (!contact) return 'else';

  // Hydrate messaging fields (hasReceivedEmail/Sms/Message,
  // hasOpenedEmail, lastMessageDate) that the rule evaluator may
  // reference. These are materialised at read time — they aren't
  // columns on Contact — so without this step those rules would
  // always evaluate as undefined → falsy.
  const summaries = await getMessagingSummaryForContacts(
    contact.accountKey,
    [contact.id],
  );
  const summary = summaries.get(contact.id);
  const hydratedContact: Record<string, unknown> = {
    ...contact,
    hasReceivedMessage: summary?.hasReceivedMessage ?? false,
    hasReceivedEmail: summary?.hasReceivedEmail ?? false,
    hasReceivedSms: summary?.hasReceivedSms ?? false,
    hasOpenedEmail: summary?.hasOpenedEmail ?? false,
    lastMessageDate: summary?.lastMessageDate ?? '',
  };

  for (const branch of branches) {
    if (!branch?.id || !Array.isArray(branch.rules) || branch.rules.length === 0) {
      continue;
    }
    const results = branch.rules.map((r) => evaluateContactRule(hydratedContact, r));
    const matched = (branch.logic ?? 'AND') === 'AND'
      ? results.every(Boolean)
      : results.some(Boolean);
    if (matched) return branch.id;
  }
  return 'else';
}

function evaluateContactRule(
  contact: Record<string, unknown>,
  rule: ConditionRule,
): boolean {
  const raw = contact[rule.field];
  const value = String(rule.value ?? '').toLowerCase();
  const rawStr = raw == null ? '' : String(raw).toLowerCase();

  switch (rule.operator) {
    // ── text ──
    case 'contains':
      return rawStr.includes(value);
    case 'not_contains':
      return !rawStr.includes(value);
    case 'equals':
      return rawStr === value;
    case 'not_equals':
      return rawStr !== value;
    case 'is_empty':
      return rawStr === '';
    case 'is_not_empty':
      return rawStr !== '';

    // ── date ──
    case 'before':
    case 'after': {
      const target = parseDateValue(rule.value);
      const actual = parseDateValue(raw);
      if (!target || !actual) return false;
      return rule.operator === 'before'
        ? actual.getTime() < target.getTime()
        : actual.getTime() > target.getTime();
    }
    case 'between': {
      const lo = parseDateValue(rule.value);
      const hi = parseDateValue(rule.value2);
      const actual = parseDateValue(raw);
      if (!lo || !hi || !actual) return false;
      const t = actual.getTime();
      return t >= lo.getTime() && t <= hi.getTime();
    }
    case 'within_days': {
      const days = Number(rule.value);
      if (!Number.isFinite(days)) return false;
      const actual = parseDateValue(raw);
      if (!actual) return false;
      const now = Date.now();
      const diffMs = Math.abs(actual.getTime() - now);
      return diffMs <= days * 86_400_000;
    }
    case 'overdue': {
      const actual = parseDateValue(raw);
      if (!actual) return false;
      return actual.getTime() < Date.now();
    }

    // ── tags ──
    case 'includes_any':
    case 'includes_all':
    case 'excludes': {
      const tags = Array.isArray(raw)
        ? raw.map((t) => String(t).toLowerCase())
        : [];
      const targets = String(rule.value ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (targets.length === 0) return rule.operator === 'excludes';
      if (rule.operator === 'includes_any') return targets.some((t) => tags.includes(t));
      if (rule.operator === 'includes_all') return targets.every((t) => tags.includes(t));
      return !targets.some((t) => tags.includes(t));
    }

    // ── boolean ──
    case 'is_true':
      return raw === true || rawStr === 'true' || rawStr === '1';
    case 'is_false':
      return raw === false || rawStr === 'false' || rawStr === '0' || rawStr === '';

    default:
      return false;
  }
}

function parseDateValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────
// Email node execution (reuses send infrastructure)
// ─────────────────────────────────────────────────────

async function executeEmailNode(
  enrollment: { id: string; contactId: string; flowId: string },
  node: NodeForExecution,
): Promise<void> {
  const templateId = node.config.templateId ? String(node.config.templateId) : null;
  const subjectOverride = node.config.subject ? String(node.config.subject) : null;

  const contact = await prisma.contact.findUnique({
    where: { id: enrollment.contactId },
    select: {
      id: true,
      accountKey: true,
      email: true,
      firstName: true,
      lastName: true,
      fullName: true,
      dnd: true,
    },
  });

  if (!contact) {
    await recordStepFailure(enrollment.id, node.id, 'contact missing');
    return;
  }
  const recipientEmail = normalizeEmailAddress(contact.email || '');
  if (!isLikelyDeliverableEmail(recipientEmail)) {
    await recordStepFailure(enrollment.id, node.id, 'no deliverable email');
    return;
  }
  const dnd = contact.dnd as Record<string, unknown> | null;
  if (dnd && dnd.email === true) {
    await recordStepFailure(enrollment.id, node.id, 'contact opted out (dnd.email)');
    return;
  }

  const suppression = await prisma.emailSuppression.findUnique({
    where: { accountKey_email: { accountKey: contact.accountKey, email: recipientEmail } },
  });
  if (suppression) {
    await recordStepFailure(enrollment.id, node.id, `suppressed: ${suppression.reason}`);
    return;
  }

  const sender = await resolveSenderForAccount(contact.accountKey);
  if (!sender || !sender.sendgridApiKey || !sender.senderEmail) {
    await recordStepFailure(
      enrollment.id,
      node.id,
      'No SendGrid key or sender email configured for this sub-account',
    );
    return;
  }

  let html = '';
  let subject = subjectOverride || '';
  if (templateId) {
    const template = await prisma.template.findUnique({ where: { id: templateId } });
    if (template) {
      html = template.content || '';
      if (!subject) subject = template.title || '';
    }
  }
  if (!html) {
    // Inline node-provided HTML/subject fallback so the user can
    // start sending without binding a Template row (useful for tests).
    html = String(node.config.html || '');
    if (!subject) subject = String(node.config.subject || 'Untitled');
  }

  // We piggyback on EmailCampaignRecipient so SendGrid Event Webhook
  // events flow into the same EmailEvent table that powers the
  // condition evaluator. The "campaign" wrapping is a no-op shell —
  // one row per flow email send, created on demand and reused.
  const wrapperCampaign = await getOrCreateFlowWrapperCampaign(
    enrollment.flowId,
    node.id,
    subject,
    html,
    contact.accountKey,
  );

  const recipient = await prisma.emailCampaignRecipient.create({
    data: {
      campaignId: wrapperCampaign.id,
      contactId: contact.id,
      accountKey: contact.accountKey,
      email: recipientEmail,
      fullName: contact.fullName || `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || null,
      status: 'pending',
    },
  });

  try {
    const result = await sendEmailViaSendGrid({
      apiKey: sender.sendgridApiKey,
      from: { email: sender.senderEmail, name: sender.senderName || undefined },
      replyTo: sender.replyTo ? { email: sender.replyTo } : undefined,
      to: { email: recipientEmail, name: recipient.fullName || undefined },
      subject,
      html,
      text: stripHtml(html),
      categories: ['loomi', 'loomi-flow', `flow:${enrollment.flowId}`, `node:${node.id}`],
      customArgs: {
        flowId: enrollment.flowId,
        enrollmentId: enrollment.id,
        nodeId: node.id,
        campaignId: wrapperCampaign.id,
        recipientId: recipient.id,
        accountKey: contact.accountKey,
      },
      ...(sender.unsubscribeFooter ? { unsubscribe: sender.unsubscribeFooter } : {}),
    });
    await prisma.emailCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: 'sent',
        messageId: result.messageId || null,
        sentAt: new Date(),
      },
    });
    await prisma.loomiFlowEnrollmentStep.create({
      data: {
        enrollmentId: enrollment.id,
        nodeId: node.id,
        status: 'sent',
        emailRecipientId: recipient.id,
      },
    });
  } catch (err) {
    const errorMessage =
      err instanceof SendGridError
        ? `SendGrid: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Failed to send email';
    await prisma.emailCampaignRecipient.update({
      where: { id: recipient.id },
      data: { status: 'failed', error: errorMessage },
    });
    await recordStepFailure(enrollment.id, node.id, errorMessage);
  }
}

async function recordStepFailure(
  enrollmentId: string,
  nodeId: string,
  reason: string,
): Promise<void> {
  await prisma.loomiFlowEnrollmentStep.create({
    data: {
      enrollmentId,
      nodeId,
      status: 'failed',
      metadata: stringifyConfig({ reason }),
    },
  });
}

// Persistent wrapper-campaign per (flow node) — one shell row that
// every send for this node attaches recipients to. Lets the existing
// SendGrid webhook handler and EmailEvent dedupe path keep working
// without flow-specific branches.
async function getOrCreateFlowWrapperCampaign(
  flowId: string,
  nodeId: string,
  subject: string,
  html: string,
  accountKey: string,
): Promise<{ id: string }> {
  const name = `Flow:${flowId}/Node:${nodeId}`;
  const existing = await prisma.emailCampaign.findFirst({
    where: { name },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.emailCampaign.create({
    data: {
      name,
      subject: subject || 'Flow email',
      htmlContent: html || '',
      status: 'processing',
      sourceType: 'drag-drop',
      accountKeys: JSON.stringify([accountKey]),
    },
    select: { id: true },
  });
}

interface AccountSenderIdentity {
  replyTo: string | null;
  senderEmail: string | null;
  senderName: string | null;
  sendgridApiKey: string | null;
  unsubscribeFooter: { html: string; text: string } | null;
}

async function resolveSenderForAccount(
  accountKey: string,
): Promise<AccountSenderIdentity | null> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: {
      dealer: true,
      senderEmail: true,
      senderName: true,
      replyToEmail: true,
      sendgridApiKey: true,
      address: true,
      city: true,
      state: true,
      postalCode: true,
    },
  });
  if (!account) return null;

  let sendgridApiKey: string | null = null;
  if (account.sendgridApiKey) {
    try {
      sendgridApiKey = decryptToken(account.sendgridApiKey);
    } catch (err) {
      console.error(
        `[loomi-flows] failed to decrypt SendGrid key for ${accountKey}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const unsubscribeFooter = buildUnsubscribeFooter({
    dealer: account.dealer || '',
    address: account.address,
    city: account.city,
    state: account.state,
    postalCode: account.postalCode,
  });

  return {
    replyTo: account.replyToEmail || null,
    senderEmail: account.senderEmail || null,
    senderName: account.senderName || null,
    sendgridApiKey,
    unsubscribeFooter,
  };
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────
// Top-level worker entry points
// ─────────────────────────────────────────────────────

export async function processDueFlowEnrollments(options?: {
  limit?: number;
}): Promise<{ processed: number }> {
  const limit = Math.max(1, Math.min(100, options?.limit ?? 25));
  const now = new Date();
  const due = await prisma.loomiFlowEnrollment.findMany({
    where: {
      status: 'active',
      flow: { status: 'active' },
      nextRunAt: { lte: now },
    },
    orderBy: { nextRunAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  for (const row of due) {
    try {
      await processEnrollmentTick(row.id);
    } catch (err) {
      console.error(
        `[loomi-flows] tick failed for enrollment ${row.id}`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { processed: due.length };
}

// ─────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────

export async function getFlowAnalytics(flowId: string): Promise<{
  active: number;
  completed: number;
  exited: number;
  failed: number;
  totalSends: number;
  totalOpens: number;
  totalClicks: number;
}> {
  const grouped = await prisma.loomiFlowEnrollment.groupBy({
    by: ['status'],
    where: { flowId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count._all;

  const sentSteps = await prisma.loomiFlowEnrollmentStep.findMany({
    where: { enrollment: { flowId }, status: 'sent' },
    select: { emailRecipientId: true },
  });
  const recipientIds = sentSteps
    .map((s) => s.emailRecipientId)
    .filter((id): id is string => Boolean(id));

  let totalOpens = 0;
  let totalClicks = 0;
  if (recipientIds.length > 0) {
    const events = await prisma.emailEvent.groupBy({
      by: ['eventType'],
      where: { recipientId: { in: recipientIds } },
      _count: { _all: true },
    });
    for (const e of events) {
      if (e.eventType === 'open') totalOpens = e._count._all;
      if (e.eventType === 'click') totalClicks = e._count._all;
    }
  }

  return {
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    exited: counts.exited ?? 0,
    failed: counts.failed ?? 0,
    totalSends: recipientIds.length,
    totalOpens,
    totalClicks,
  };
}

// ─────────────────────────────────────────────────────
// Per-node stats (powers the builder's live overlay)
// ─────────────────────────────────────────────────────

export interface NodeStats {
  total: number;
  /** Email-only: how many sends succeeded for this node. */
  sent?: number;
  /** Email-only: distinct recipients with at least one open event. */
  opened?: number;
  /** Email-only: distinct recipients with at least one click event. */
  clicked?: number;
  /** Email-only: distinct recipients with at least one bounce event. */
  bounced?: number;
  /** Any-node: step rows with status='failed'. */
  failed?: number;
  /** Condition/split: counts of contacts that took each branch. */
  branches?: Record<string, number>;
  /** Trigger-only: total enrollments through this flow. */
  enrolled?: number;
  /** Exit-only: completed enrollments via this node. */
  completed?: number;
}

/**
 * Aggregate execution stats per node id. Used by the builder's overlay
 * to show "1,240 sent · 67% open · 23% click" type chips on top of
 * each node once a flow is live (or has historic enrollments).
 *
 * Open / click / bounce counts are per *distinct recipient*, not per
 * raw event, so multiple opens of the same email by one person count
 * once — matches how the EmailCampaign analytics surface reads.
 */
export async function getFlowNodeStats(
  flowId: string,
): Promise<Record<string, NodeStats>> {
  const byNode: Record<string, NodeStats> = {};

  // 1) Step groups: count rows per (node, status, branch). Covers
  //    every non-trigger node — email sends, condition/split branches,
  //    exit completions, failures, etc.
  const stepGroups = await prisma.loomiFlowEnrollmentStep.groupBy({
    by: ['nodeId', 'status', 'branch'],
    where: { enrollment: { flowId } },
    _count: { _all: true },
  });
  for (const g of stepGroups) {
    const stats = byNode[g.nodeId] ?? { total: 0 };
    stats.total += g._count._all;
    if (g.status === 'sent') stats.sent = (stats.sent ?? 0) + g._count._all;
    if (g.status === 'failed') stats.failed = (stats.failed ?? 0) + g._count._all;
    if (g.status === 'exited') stats.completed = (stats.completed ?? 0) + g._count._all;
    if (g.branch) {
      stats.branches = stats.branches ?? {};
      stats.branches[g.branch] = (stats.branches[g.branch] ?? 0) + g._count._all;
    }
    byNode[g.nodeId] = stats;
  }

  // 2) Email engagement: for every (nodeId, emailRecipientId) pair,
  //    look up its events in one grouped query and roll up distinct
  //    open / click / bounce counts.
  const sentSteps = await prisma.loomiFlowEnrollmentStep.findMany({
    where: {
      enrollment: { flowId },
      status: 'sent',
      emailRecipientId: { not: null },
    },
    select: { nodeId: true, emailRecipientId: true },
  });
  const recipientIds = sentSteps
    .map((s) => s.emailRecipientId)
    .filter((id): id is string => Boolean(id));

  if (recipientIds.length > 0) {
    const events = await prisma.emailEvent.findMany({
      where: {
        recipientId: { in: recipientIds },
        eventType: { in: ['open', 'click', 'bounce'] },
      },
      select: { recipientId: true, eventType: true },
    });

    // recipientId → Set of event types seen (dedupes raw event volume).
    const eventsByRecipient = new Map<string, Set<string>>();
    for (const e of events) {
      if (!e.recipientId) continue;
      const set = eventsByRecipient.get(e.recipientId) ?? new Set<string>();
      set.add(e.eventType);
      eventsByRecipient.set(e.recipientId, set);
    }

    for (const step of sentSteps) {
      if (!step.emailRecipientId) continue;
      const eventTypes = eventsByRecipient.get(step.emailRecipientId);
      if (!eventTypes) continue;
      const stats = byNode[step.nodeId] ?? { total: 0 };
      if (eventTypes.has('open')) stats.opened = (stats.opened ?? 0) + 1;
      if (eventTypes.has('click')) stats.clicked = (stats.clicked ?? 0) + 1;
      if (eventTypes.has('bounce')) stats.bounced = (stats.bounced ?? 0) + 1;
      byNode[step.nodeId] = stats;
    }
  }

  // 3) Trigger node: total enrollments (no step row exists for the
  //    trigger itself — the entry is implicit).
  const triggerNode = await prisma.loomiFlowNode.findFirst({
    where: { flowId, type: 'trigger' },
    select: { id: true },
  });
  if (triggerNode) {
    const enrolled = await prisma.loomiFlowEnrollment.count({ where: { flowId } });
    const existing = byNode[triggerNode.id] ?? { total: 0 };
    byNode[triggerNode.id] = { ...existing, enrolled };
  }

  return byNode;
}

// Graph validation lives in @/lib/flows/validation (client-safe).
// FlowValidationIssue, FlowValidationError, validateFlowGraph, plus
// the NodeType / TriggerType unions are re-exported from this module
// at the top of the file for backwards compatibility.
