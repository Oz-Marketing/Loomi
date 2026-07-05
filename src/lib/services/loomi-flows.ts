import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/crypto/encryption';
import { sendEmailViaSendGrid, SendGridError } from '@/lib/sending/sendgrid';
import { buildUnsubscribeFooter } from '@/lib/sending/unsubscribe-footer';
import {
  resolveTwilioConfig,
  sendSmsViaTwilio,
  TwilioError,
} from '@/lib/sending/twilio';
import {
  isLikelyDeliverableEmail,
  isLikelyDialablePhone,
  normalizeEmailAddress,
  normalizePhoneNumber,
} from '@/lib/contact-hygiene';
import { getMessagingSummaryForContacts } from '@/lib/contacts/queries';
import { listFieldsForAccount } from '@/lib/services/contact-custom-fields';
import { evaluateFilter } from '@/lib/smart-list-engine';
import {
  getFilterableFields,
  type FieldDefinition,
  type FilterDefinition,
  type FilterOperator,
} from '@/lib/smart-list-types';
import type { Contact } from '@/lib/contacts/types';
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  zonedMidnightMs,
  zonedTodayIso,
} from '@/lib/timezone';
import { nextAllowedSendTime, birthdayMatchesTarget } from '@/lib/flows/scheduling';
import { applyMergetags, type MergetagContext } from '@/lib/flows/mergetags';
import { assertSafeWebhookUrl } from '@/lib/flows/ssrf';
import { enqueueCrmDeliveryJob } from '@/lib/integrations/crm/dispatch';
import {
  ANNOTATION_NODE_TYPES,
  CRM_PUSH_PROVIDERS,
  EXECUTABLE_NODE_TYPES,
  FlowValidationError,
  validateFlowGraph,
  validateTriggersForPublish,
  collectConditionFieldKeys,
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
// EmailBlast.metadata pattern elsewhere in this repo)
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

/**
 * Returns true when another flow in the same account already uses `name`
 * (trimmed, case-insensitive). Archived flows are ignored so a name freed
 * up by archiving can be reused. `excludeId` skips the flow being renamed
 * so re-saving an unchanged name doesn't collide with itself.
 */
export async function flowNameTaken(opts: {
  name: string;
  accountKey: string | null;
  excludeId?: string;
}): Promise<boolean> {
  const name = opts.name.trim();
  if (!name) return false;
  // Normalise the account scope to null for the "global" group. Callers may
  // pass a serialized flow whose accountKey is '' (getFlow renders null as an
  // empty string), and `'' ?? null` would stay '' — which never matches the
  // NULL rows the DB actually stores, silently skipping the uniqueness check.
  const accountKey =
    typeof opts.accountKey === 'string' && opts.accountKey.trim() ? opts.accountKey : null;
  const existing = await prisma.loomiFlow.findFirst({
    where: {
      accountKey,
      name: { equals: name, mode: 'insensitive' },
      status: { not: 'archived' },
      ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existing);
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
    // Diff-based node sync (NOT delete-all + recreate). Nodes that
    // already exist are UPDATED in place so their ids survive — which
    // keeps in-flight `enrollment.currentNodeId` valid across an edit
    // (a paused→edit→resume no longer fails every enrollment) and keeps
    // per-node analytics (keyed on nodeId) attached. Only genuinely new
    // nodes (client-* ids the builder generated this session) get fresh
    // cuids; removed nodes are deleted.
    const existing = await tx.loomiFlowNode.findMany({
      where: { flowId: id },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((n) => n.id));

    const localMap = new Map<string, string>(); // posted id → db id
    const keptIds = new Set<string>();

    for (const node of graph.nodes) {
      if (node.id && existingIds.has(node.id)) {
        await tx.loomiFlowNode.update({
          where: { id: node.id },
          data: {
            type: node.type,
            config: stringifyConfig(node.config),
            x: node.x,
            y: node.y,
          },
        });
        localMap.set(node.id, node.id);
        idMap[node.id] = node.id;
        keptIds.add(node.id);
      } else {
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
        keptIds.add(created.id);
      }
    }

    // Delete nodes that are no longer in the posted graph.
    const removed = existing.filter((n) => !keptIds.has(n.id)).map((n) => n.id);
    if (removed.length > 0) {
      await tx.loomiFlowNode.deleteMany({ where: { id: { in: removed } } });
    }

    // Edges carry no stable analytics key, so rebuilding them is safe and
    // simpler than diffing. Only persist edges whose endpoints are in the
    // current node set — never store a dangling reference.
    await tx.loomiFlowEdge.deleteMany({ where: { flowId: id } });
    for (const edge of graph.edges) {
      const from = localMap.get(edge.fromNodeId) ?? edge.fromNodeId;
      const to = localMap.get(edge.toNodeId) ?? edge.toNodeId;
      if (!from || !to) continue;
      if (!keptIds.has(from) || !keptIds.has(to)) continue;
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
    include: { nodes: true, edges: true, triggers: true },
  });
  if (!flow) throw new Error('Flow not found');

  // Templates (no account) are not runnable — they're meant to be
  // deployed to a sub-account, which is where publishing happens.
  if (!flow.accountKey) {
    throw new FlowValidationError([
      {
        nodeId: null,
        message:
          'A template can’t be published directly — deploy it to a sub-account first, then publish there.',
        severity: 'error',
      },
    ]);
  }

  const graphNodes = flow.nodes.map((n) => ({
    id: n.id,
    type: n.type as NodeType,
    config: parseJson<Record<string, unknown>>(n.config, {}),
  }));

  const issues: FlowValidationIssue[] = [];

  // 1) Graph structure — every non-exit node has an outgoing edge,
  //    conditions have their branch + else edges, split weights sum to 1.
  issues.push(
    ...validateFlowGraph({
      nodes: graphNodes,
      edges: flow.edges.map((e) => ({
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        branch: e.branch,
      })),
    }).issues,
  );

  // 2) At least one enabled, fully-configured trigger — otherwise the
  //    flow goes live but silently enrolls nobody.
  const triggers = flow.triggers.map((t) => ({
    type: t.type as TriggerType,
    enabled: t.enabled,
    config: parseJson<Record<string, unknown>>(t.config, {}),
  }));
  issues.push(...validateTriggersForPublish(triggers));

  // 3) Every field referenced by a condition rule or a date trigger must
  //    exist for this account. A missing field (e.g. a template deployed
  //    to an account that never declared `deal_type`) reads undefined and
  //    silently routes every contact down the else branch — so block it.
  const knownKeys = new Set(
    (await getAccountFilterableFields(flow.accountKey)).map((f) => f.key),
  );
  const referenced = new Set<string>(collectConditionFieldKeys(graphNodes));
  for (const t of triggers) {
    if (t.type === 'date_reminder' && typeof t.config.field === 'string' && t.config.field.trim()) {
      referenced.add(t.config.field.trim());
    }
  }
  for (const key of referenced) {
    if (!knownKeys.has(key)) {
      issues.push({
        nodeId: null,
        message: `Field "${key}" isn’t defined for this account — rules or triggers using it would match nobody.`,
        severity: 'error',
        fix: `Add the custom field "${key}" to this account (Settings → Custom Fields), or fix the step/trigger that references it.`,
      });
    }
  }

  if (issues.some((i) => (i.severity ?? 'error') === 'error')) {
    throw new FlowValidationError(issues);
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

  // ── Account scoping (multi-tenant safety) ──
  // Never enroll — and therefore never message — a contact from another
  // tenant, regardless of which contactIds the caller passed (manual
  // enroll API, list trigger with a foreign listId, etc.). This is the
  // single chokepoint every enrollment path funnels through. Templates
  // (accountKey null) are not runnable and enroll nobody.
  if (!flow.accountKey) {
    return {
      enrolled: 0,
      skipped: contactIds.length,
      reason: { flow_not_account_scoped: contactIds.length },
    };
  }
  // Validate account membership in chunks — the resolvers no longer cap
  // their output (T2-e), so a list/audience/tag trigger can hand us tens
  // of thousands of ids; a single `id IN (...)` of that size risks the
  // bind-parameter ceiling and bloats the query.
  const allowedIds: string[] = [];
  for (let i = 0; i < contactIds.length; i += CONTACT_SCAN_BATCH) {
    const chunk = contactIds.slice(i, i + CONTACT_SCAN_BATCH);
    const inAccount = await prisma.contact.findMany({
      where: { id: { in: chunk }, accountKey: flow.accountKey },
      select: { id: true },
    });
    for (const c of inAccount) allowedIds.push(c.id);
  }
  const foreignCount = contactIds.length - allowedIds.length;
  contactIds = allowedIds;
  if (contactIds.length === 0) {
    return {
      enrolled: 0,
      skipped: foreignCount,
      reason: foreignCount > 0 ? { wrong_account: foreignCount } : {},
    };
  }

  const reEntry = parseFlowSettings(flow.settings).reEntry;

  // The unique([flowId, contactId]) constraint means at most one prior
  // enrollment per contact. Active → skip (already running). Non-active
  // (completed/exited/failed) → re-enter per the flow's re-entry policy
  // by RESETTING the existing row (a second row is impossible), so
  // recurring flows (anniversary, birthday, service) can fire again next
  // cycle. policy 'never' (the default) leaves a finished run closed.
  const existing = await prisma.loomiFlowEnrollment.findMany({
    where: { flowId, contactId: { in: contactIds } },
    select: { id: true, contactId: true, status: true, completedAt: true },
  });
  const existingByContact = new Map(existing.map((e) => [e.contactId, e]));

  const reason: Record<string, number> = {};
  let enrolled = 0;
  let skipped = foreignCount;
  if (foreignCount > 0) reason.wrong_account = foreignCount;
  const now = new Date();
  const cooldownMs =
    reEntry.policy === 'after-days'
      ? Math.max(0, reEntry.afterDays ?? 0) * 86_400_000
      : 0;

  for (const contactId of contactIds) {
    const prior = existingByContact.get(contactId);

    if (prior && prior.status === 'active') {
      skipped++;
      reason.already_enrolled = (reason.already_enrolled ?? 0) + 1;
      continue;
    }

    if (prior) {
      // A prior run has ended. Re-enter only if the policy allows it.
      if (reEntry.policy === 'never') {
        skipped++;
        reason.reentry_disabled = (reason.reentry_disabled ?? 0) + 1;
        continue;
      }
      if (reEntry.policy === 'after-days') {
        const since = prior.completedAt
          ? now.getTime() - prior.completedAt.getTime()
          : Number.POSITIVE_INFINITY;
        if (since < cooldownMs) {
          skipped++;
          reason.reentry_cooldown = (reason.reentry_cooldown ?? 0) + 1;
          continue;
        }
      }
      // policy 'always', or 'after-days' past the cooldown → reset the
      // row to a fresh run at the entry node. enrolledAt is bumped so the
      // date-trigger once-per-day guard (excludeEnrolledToday) treats
      // this as today's run. Clear the prior cycle's step rows so per-node
      // analytics reflect the current run (otherwise "sent" sums across
      // every cycle while "enrolled" counts the contact once, making the
      // builder's stat chips inconsistent).
      await prisma.loomiFlowEnrollmentStep.deleteMany({
        where: { enrollmentId: prior.id },
      });
      await prisma.loomiFlowEnrollment.update({
        where: { id: prior.id },
        data: {
          status: 'active',
          currentNodeId: entryNode,
          nextRunAt: now,
          enrolledAt: now,
          completedAt: null,
          triggerId: options?.triggerId ?? null,
          metadata: null,
        },
      });
      enrolled++;
      continue;
    }

    // No prior enrollment → create a fresh one.
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
      type: { in: ['list', 'audience', 'date_reminder', 'birthday', 'tag_added'] },
      // Templates (accountKey null) are never runnable — defense in depth
      // alongside the publish-time guard.
      flow: { status: 'active', accountKey: { not: null } },
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
        // Only resolve a list owned by the flow's account — don't pull a
        // foreign account's members (enrollContacts would drop them, but
        // we shouldn't load cross-tenant data in the first place).
        const list = await prisma.contactList.findUnique({
          where: { id: listId },
          select: { accountKey: true },
        });
        if (!list || !trigger.flow.accountKey || list.accountKey !== trigger.flow.accountKey) {
          continue;
        }
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
      } else if (trigger.type === 'date_reminder') {
        contactIds = await resolveDateReminderContactIds(trigger.flow, config);
      } else if (trigger.type === 'birthday') {
        contactIds = await resolveBirthdayContactIds(trigger.flow, config);
      } else if (trigger.type === 'tag_added') {
        contactIds = await resolveTagAddedContactIds(trigger.flow, config);
      }

      // Level-triggered types (list/audience/tag_added) match the SAME
      // contacts every poll for as long as the contact stays in the
      // list/audience or keeps the tag. With reEntry='always' that would
      // reset + re-run a completed enrollment every 5 minutes. Cap it to
      // once per calendar day (the date triggers already do this inside
      // their resolvers). A well-built flow drops the contact out of the
      // match at the end so this rarely bites — this is the safety net.
      if (
        contactIds.length > 0 &&
        (trigger.type === 'list' ||
          trigger.type === 'audience' ||
          trigger.type === 'tag_added')
      ) {
        const tz = await resolveFlowTimeZone(trigger.flow.accountKey);
        contactIds = await excludeEnrolledToday(trigger.flowId, contactIds, tz);
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
// Batch size for the keyset (id-cursor) scans below. Replaces the old
// `take: 10_000` cap that silently dropped every contact past the first
// 10k — a real miss for dealers with large CRMs. Memory stays bounded:
// one page is in flight at a time and callers retain only matched ids.
const CONTACT_SCAN_BATCH = 1000;

/** Keyset-paginate every contact for an account (optionally filtered),
 *  invoking `onBatch` per page. Iterates ALL matching contacts, not a
 *  capped slice. */
async function forEachContactBatch(
  accountKey: string,
  options: { where?: Prisma.ContactWhereInput; select?: Prisma.ContactSelect },
  onBatch: (batch: Array<{ id: string } & Record<string, unknown>>) => void | Promise<void>,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const args: Prisma.ContactFindManyArgs = {
      where: { accountKey, ...(options.where ?? {}) },
      orderBy: { id: 'asc' },
      take: CONTACT_SCAN_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    };
    if (options.select) args.select = { id: true, ...options.select };
    const batch = (await prisma.contact.findMany(args)) as Array<
      { id: string } & Record<string, unknown>
    >;
    if (batch.length === 0) break;
    await onBatch(batch);
    if (batch.length < CONTACT_SCAN_BATCH) break;
    cursor = batch[batch.length - 1].id;
  }
}

async function resolveAudienceContactIds(
  accountKey: string,
  filtersJson: string,
): Promise<string[]> {
  const definition = parseJson<FilterDefinition>(filtersJson, {
    version: 1,
    logic: 'AND',
    groups: [],
  });
  if (!definition.groups || definition.groups.length === 0) return [];

  const fields = await getAccountFilterableFields(accountKey);
  const matched: string[] = [];
  await forEachContactBatch(accountKey, {}, (batch) => {
    for (const c of evaluateFilter(batch as unknown as Contact[], definition, fields)) {
      matched.push(c.id);
    }
  });
  return matched;
}

/**
 * Build the merged field set for an account: the static built-in fields
 * plus the account's declared custom fields, with `isCustom` flags so
 * the filter engine routes custom-field reads through
 * `Contact.customFields`. Shared by audience resolution and mid-flow
 * condition evaluation so triggers and goal-checks speak the same
 * field/operator vocabulary as the filter builder UI.
 */
async function getAccountFilterableFields(
  accountKey: string,
): Promise<FieldDefinition[]> {
  const custom = await listFieldsForAccount(accountKey);
  return getFilterableFields(
    custom.map((cf) => ({
      key: cf.key,
      label: cf.label,
      type: cf.type,
      category: cf.category,
      options: cf.options,
    })),
  );
}

// ─────────────────────────────────────────────────────
// Date-based trigger resolution — date_reminder + birthday
//
// Enroll a contact on the calendar day an anchor date (a custom field
// like last_purchase_date, the native dateOfBirth, or a native lifecycle
// column) reaches anchor + offsetDays. Day matching runs in the account
// timezone (business tz, then Meta tz, then the agency default
// America/Denver = Mountain Time, matching the YAG spec default).
//
// `recurAnnually` matches month/day only (ignoring year) for recurring
// milestones (anniversary, birthday, service interval). Otherwise the
// full target date must equal today (one-time future milestones such as
// lease end / warranty end).
//
// Idempotency: enrolled at most once per calendar day per flow (see
// excludeEnrolledToday) so the 5-minute poll never double-fires inside
// the single-day match window and a same-day completion can't re-enroll.
// ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────
// Quiet hours — the per-flow send window (account timezone)
//
// FlowSettings.quietHours.{start,end} is the ALLOWED window (the panel
// reads "Pause sends outside this window"). Default 09:00–21:00; the YAG
// flows use 09:00–19:00 MT. Enforced before email/SMS sends only — tag
// ops, conditions, and waits are unaffected. Outside the window we push
// nextRunAt to the next window start and leave the cursor on the send
// node, so it fires at the top of the next allowed window.
// ─────────────────────────────────────────────────────

/** Before an email/SMS send: if the flow's quiet-hours window is on and
 *  we're outside it, reschedule the enrollment to the next allowed time
 *  and return true (caller should return without sending). */
async function applyQuietHoursGuard(enrollment: {
  id: string;
  flowId: string;
}): Promise<boolean> {
  const flow = await prisma.loomiFlow.findUnique({
    where: { id: enrollment.flowId },
    select: { settings: true, accountKey: true },
  });
  const quietHours = parseFlowSettings(flow?.settings).quietHours;
  if (!quietHours.enabled) return false;
  const tz = await resolveFlowTimeZone(flow?.accountKey);
  const fireAt = nextAllowedSendTime(Date.now(), tz, quietHours.start, quietHours.end);
  if (!fireAt) return false;
  await prisma.loomiFlowEnrollment.update({
    where: { id: enrollment.id },
    data: { nextRunAt: fireAt },
  });
  return true;
}

async function resolveFlowTimeZone(
  accountKey: string | null | undefined,
): Promise<string> {
  if (!accountKey) return DEFAULT_TIME_ZONE;
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { timezone: true, metaTimezone: true },
  });
  // Flows send on the business timezone; fall back to the Meta ad-account
  // zone, then the agency default (Mountain Time).
  if (isValidTimeZone(account?.timezone)) return account!.timezone!;
  if (isValidTimeZone(account?.metaTimezone)) return account!.metaTimezone!;
  return DEFAULT_TIME_ZONE;
}

function parseTriggerDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const s = String(raw).trim();
  if (!s) return null;
  // A bare YYYY-MM-DD is pinned to UTC midnight so the getUTC* day reads
  // downstream (shiftedDateParts / birthdayMatchesTarget) match the
  // intended calendar day regardless of the server's local timezone.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Calendar date (UTC Y/M/D) of anchor + N days, as a "YYYY-MM-DD" string
 *  and its "MM-DD" month/day. Anchor lifecycle/custom dates are stored
 *  date-only (midnight UTC), so UTC field reads give the intended
 *  calendar date and adding whole days never crosses a DST seam. */
function shiftedDateParts(anchor: Date, offsetDays: number): {
  iso: string;
  monthDay: string;
} {
  const t = new Date(anchor.getTime() + offsetDays * 86_400_000);
  return {
    iso: `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`,
    monthDay: `${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`,
  };
}

function readContactFieldValue(
  contact: Record<string, unknown>,
  field: string,
  isCustom: boolean,
): unknown {
  if (isCustom) {
    const blob = contact.customFields;
    return blob && typeof blob === 'object'
      ? (blob as Record<string, unknown>)[field]
      : undefined;
  }
  return contact[field];
}

/** Drop contacts already enrolled in this flow earlier the same calendar
 *  day (account tz) — gives date triggers once-per-day idempotency across
 *  the 5-min poll and blocks same-day re-entry after completion. */
async function excludeEnrolledToday(
  flowId: string,
  contactIds: string[],
  timeZone: string,
): Promise<string[]> {
  if (contactIds.length === 0) return [];
  const todayIso = zonedTodayIso(Date.now(), timeZone);
  const [y, m, d] = todayIso.split('-').map(Number);
  const todayStart = new Date(zonedMidnightMs(y, m, d, timeZone));
  const recent = await prisma.loomiFlowEnrollment.findMany({
    where: { flowId, contactId: { in: contactIds }, enrolledAt: { gte: todayStart } },
    select: { contactId: true },
  });
  const seen = new Set(recent.map((r) => r.contactId));
  return contactIds.filter((id) => !seen.has(id));
}

async function resolveDateReminderContactIds(
  flow: { id: string; accountKey: string | null },
  config: Record<string, unknown>,
): Promise<string[]> {
  if (!flow.accountKey) return [];
  const field = typeof config.field === 'string' ? config.field.trim() : '';
  if (!field) return [];
  const offsetDays = readNumber(config.offsetDays, 0);
  const recurAnnually = config.recurAnnually === true;
  // Optional secondary filter ANDed with the date match — lets two
  // triggers on the same flow target different cohorts (e.g. YAG-003's
  // aged-unit +362d vs. standard-unit +544d split on Unit Age).
  const filterDef =
    config.filter && typeof config.filter === 'object'
      ? (config.filter as FilterDefinition)
      : null;
  const hasFilter = !!filterDef?.groups?.length;

  const timeZone = await resolveFlowTimeZone(flow.accountKey);
  const todayIso = zonedTodayIso(Date.now(), timeZone);
  const todayMonthDay = todayIso.slice(5); // "MM-DD"

  const fields = await getAccountFilterableFields(flow.accountKey);
  const def = fields.find((f) => f.key === field) ?? null;
  const isCustom = def?.isCustom === true;

  const matched: string[] = [];
  await forEachContactBatch(flow.accountKey, {}, (batch) => {
    for (const contact of batch) {
      const anchor = parseTriggerDate(readContactFieldValue(contact, field, isCustom));
      if (!anchor) continue;
      const parts = shiftedDateParts(anchor, offsetDays);
      const dateMatches = recurAnnually
        ? parts.monthDay === todayMonthDay
        : parts.iso === todayIso;
      if (!dateMatches) continue;
      if (
        hasFilter &&
        evaluateFilter([contact as unknown as Contact], filterDef!, fields).length === 0
      ) {
        continue;
      }
      matched.push(contact.id);
    }
  });
  return excludeEnrolledToday(flow.id, matched, timeZone);
}

async function resolveTagAddedContactIds(
  flow: { id: string; accountKey: string | null },
  config: Record<string, unknown>,
): Promise<string[]> {
  if (!flow.accountKey) return [];
  const tag = typeof config.tag === 'string' ? config.tag.trim().toLowerCase() : '';
  if (!tag) return [];
  // Level-triggered: every contact currently carrying the tag is a
  // candidate. enrollContacts skips active enrollments + applies the
  // re-entry policy, and processFlowTriggers caps this to once/day. Flows
  // that should re-fire on re-tagging (re-entry ON) must remove the tag
  // at the end so the contact drops out and re-qualifies on the next add.
  const matched: string[] = [];
  await forEachContactBatch(flow.accountKey, { select: { tags: true } }, (batch) => {
    for (const c of batch) {
      const tags = c.tags;
      if (Array.isArray(tags) && tags.some((t) => String(t).toLowerCase() === tag)) {
        matched.push(c.id);
      }
    }
  });
  return matched;
}

async function resolveBirthdayContactIds(
  flow: { id: string; accountKey: string | null },
  config: Record<string, unknown>,
): Promise<string[]> {
  if (!flow.accountKey) return [];
  const daysBefore = readNumber(config.daysBefore, 0);
  const timeZone = await resolveFlowTimeZone(flow.accountKey);
  // Fire `daysBefore` days before the birthday: the firing date is
  // `daysBefore` days from today (account tz). birthdayMatchesTarget
  // compares month/day and fires Feb-29 contacts on Feb-28 in non-leap
  // years so they're never skipped.
  const targetIso = zonedTodayIso(Date.now() + daysBefore * 86_400_000, timeZone);

  const matched: string[] = [];
  await forEachContactBatch(
    flow.accountKey,
    { where: { dateOfBirth: { not: null } }, select: { dateOfBirth: true } },
    (batch) => {
      for (const contact of batch) {
        const dob = contact.dateOfBirth as Date | null;
        if (!dob) continue;
        if (birthdayMatchesTarget(dob, targetIso)) matched.push(contact.id);
      }
    },
  );
  return excludeEnrolledToday(flow.id, matched, timeZone);
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
// How long a tick "leases" an enrollment when it claims it. Longer than
// any single tick takes; if the tick crashes mid-execution, the lease
// expires and the row is re-picked after this window.
const CLAIM_LEASE_MS = 2 * 60 * 1000;

// Per-node retry budget. A node that throws (malformed-config evaluator,
// transient DB/provider error, a rethrown send failure) is retried with
// backoff up to this many times, then the enrollment is failed — rather
// than re-throwing every tick forever and (for send nodes) potentially
// re-sending. The counter lives in enrollment.metadata.attempts and
// resets when the contact advances to the next node.
const MAX_NODE_ATTEMPTS = 5;

export async function processEnrollmentTick(enrollmentId: string): Promise<void> {
  // ── Atomic claim ──
  // Lease the row before doing any work so two overlapping ticks (the
  // boot run racing the scheduled poll, or multiple worker instances)
  // can't both execute the same node and double-send. This compare-and-
  // swap only succeeds for one caller: the WHERE re-checks under a row
  // lock, so a concurrent claim sees the leased nextRunAt and gets
  // count=0. The node logic below overwrites nextRunAt (advance → now,
  // wait → its deadline, quiet-hours → next window), so the lease only
  // lingers if this tick crashes.
  const claim = await prisma.loomiFlowEnrollment.updateMany({
    where: { id: enrollmentId, status: 'active', nextRunAt: { lte: new Date() } },
    data: { nextRunAt: new Date(Date.now() + CLAIM_LEASE_MS) },
  });
  if (claim.count === 0) return;

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

  // Any unexpected throw from a node handler is caught below and retried
  // with backoff (bounded by MAX_NODE_ATTEMPTS) instead of looping every
  // tick forever. The case bodies `return` from the function, so the
  // catch only runs on an actual throw.
  try {
  switch (node.type) {
    case 'email': {
      // Hold the send if we're outside the flow's quiet-hours window;
      // the cursor stays on this node and fires at the next allowed time.
      if (await applyQuietHoursGuard(enrollment)) return;
      await executeEmailNode(enrollment, node);
      const next = pickNextNode(node, edgesByFromId, null);
      await advanceEnrollment(enrollmentId, next, null);
      return;
    }
    case 'sms': {
      if (await applyQuietHoursGuard(enrollment)) return;
      await executeSmsNode(enrollment, node);
      const next = pickNextNode(node, edgesByFromId, null);
      await advanceEnrollment(enrollmentId, next, null);
      return;
    }
    case 'add_tag':
    case 'remove_tag': {
      await executeTagNode(enrollment, node);
      const next = pickNextNode(node, edgesByFromId, null);
      await advanceEnrollment(enrollmentId, next, null);
      return;
    }
    case 'webhook': {
      await executeWebhookNode(enrollment, node);
      const next = pickNextNode(node, edgesByFromId, null);
      await advanceEnrollment(enrollmentId, next, null);
      return;
    }
    case 'push_to_crm': {
      await executePushToCrmNode(enrollment, node);
      const next = pickNextNode(node, edgesByFromId, null);
      await advanceEnrollment(enrollmentId, next, null);
      return;
    }
    case 'wait_until': {
      const decision = await evaluateWaitUntil(enrollment, node);
      if (decision.kind === 'wait') {
        await prisma.loomiFlowEnrollment.update({
          where: { id: enrollmentId },
          data: { nextRunAt: decision.fireAt },
        });
        return;
      }
      // 'fire' (already past target) or 'skip' (contact has no anchor
      // value). In both cases we log + advance — refusing to advance
      // on a missing anchor would strand contacts in the flow forever.
      await prisma.loomiFlowEnrollmentStep.create({
        data: {
          enrollmentId,
          nodeId: node.id,
          status: decision.kind === 'skip' ? 'skipped' : 'waited',
          metadata: decision.reason ? stringifyConfig({ reason: decision.reason }) : null,
        },
      });
      const next = pickNextNode(node, edgesByFromId, null);
      await advanceEnrollment(enrollmentId, next, null);
      return;
    }
    case 'wait': {
      const ms = readNumber(node.config.ms, 0);
      // Anchor the wait on an explicit stored deadline (metadata.waitUntil),
      // NOT on updatedAt. updatedAt is bumped by any row write — including
      // the claim/lease above — so the old "Date.now() - updatedAt"
      // approach silently re-armed the full delay on every tick.
      const meta = parseJson<{ waitUntil?: number }>(enrollment.metadata, {});
      const deadline = typeof meta.waitUntil === 'number' ? meta.waitUntil : null;
      if (deadline === null) {
        // First arrival on this wait node — set the deadline.
        const waitUntil = Date.now() + ms;
        await prisma.loomiFlowEnrollment.update({
          where: { id: enrollmentId },
          data: { nextRunAt: new Date(waitUntil), metadata: stringifyConfig({ waitUntil }) },
        });
        return;
      }
      if (Date.now() < deadline) {
        // Re-armed early (e.g. lease re-pick before the deadline).
        await prisma.loomiFlowEnrollment.update({
          where: { id: enrollmentId },
          data: { nextRunAt: new Date(deadline) },
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const meta = parseJson<{ attempts?: number; waitUntil?: number }>(
      enrollment.metadata,
      {},
    );
    const attempts = (meta.attempts ?? 0) + 1;
    if (attempts >= MAX_NODE_ATTEMPTS) {
      const failMeta = stringifyConfig({ error: message, attempts });
      await prisma.loomiFlowEnrollmentStep.create({
        data: { enrollmentId, nodeId: node.id, status: 'failed', metadata: failMeta },
      });
      await prisma.loomiFlowEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'failed', metadata: failMeta },
      });
      return;
    }
    // Keep the cursor on this node and back off; the next due tick (after
    // the claim lease expires) retries. Preserve any wait deadline.
    const backoffMs = Math.min(attempts, 6) * CLAIM_LEASE_MS;
    await prisma.loomiFlowEnrollment.update({
      where: { id: enrollmentId },
      data: {
        nextRunAt: new Date(Date.now() + backoffMs),
        metadata: stringifyConfig({ ...meta, attempts }),
      },
    });
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
      // Clear metadata so a wait node's stored deadline (or a stale
      // marker) never leaks past the node that set it.
      data: { status: 'completed', completedAt: new Date(), currentNodeId: null, metadata: null },
    });
    return;
  }
  await prisma.loomiFlowEnrollment.update({
    where: { id: enrollmentId },
    data: { currentNodeId: nextNodeId, nextRunAt: new Date(), metadata: null },
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
    hasClickedEmail: summary?.hasClickedEmail ?? false,
    lastMessageDate: summary?.lastMessageDate ?? '',
  };

  const fields = await getAccountFilterableFields(contact.accountKey);

  // Each branch is one filter group; the first whose rules match (under
  // the branch's own AND/OR logic) wins. We reuse the same engine the
  // audience/smart-list UI runs on (`evaluateFilter`) so condition nodes
  // read custom fields and support the full operator vocabulary (tags,
  // dates, booleans, relative date-age) — not just the handful the
  // worker once hard-coded. The hydrated messaging fields ride along as
  // built-in (non-custom) keys.
  for (const branch of branches) {
    if (!branch?.id || !Array.isArray(branch.rules) || branch.rules.length === 0) {
      continue;
    }
    const definition: FilterDefinition = {
      version: 1,
      logic: 'AND',
      groups: [
        {
          id: branch.id,
          logic: branch.logic ?? 'AND',
          conditions: branch.rules.map((r, i) => ({
            id: r.id ?? `${branch.id}-${i}`,
            field: r.field,
            operator: r.operator as FilterOperator,
            value: r.value ?? '',
            value2: r.value2,
          })),
        },
      ],
    };
    const matched =
      evaluateFilter([hydratedContact as unknown as Contact], definition, fields)
        .length > 0;
    if (matched) return branch.id;
  }
  return 'else';
}

// ─────────────────────────────────────────────────────
// Tag node execution — add_tag / remove_tag
//
// Mutates the contact's `tags` JSON array. Case-insensitive dedupe on
// add (existing casing preserved) and case-insensitive removal. This is
// the lifecycle state-machine primitive the flows rely on: active tags
// added at start + removed at every END, plus converted/lost/complete
// markers that downstream flows and reporting key off.
// ─────────────────────────────────────────────────────
async function executeTagNode(
  enrollment: { id: string; contactId: string },
  node: NodeForExecution,
): Promise<void> {
  const tag = String(node.config.tag || '').trim();
  if (!tag) {
    await prisma.loomiFlowEnrollmentStep.create({
      data: {
        enrollmentId: enrollment.id,
        nodeId: node.id,
        status: 'skipped',
        metadata: stringifyConfig({ reason: 'no tag configured' }),
      },
    });
    return;
  }

  const contact = await prisma.contact.findUnique({
    where: { id: enrollment.contactId },
    select: { tags: true },
  });
  if (!contact) {
    await recordStepFailure(enrollment.id, node.id, 'contact missing');
    return;
  }

  const current = Array.isArray(contact.tags)
    ? (contact.tags as unknown[]).map((t) => String(t))
    : [];
  const lower = tag.toLowerCase();
  const nextTags =
    node.type === 'add_tag'
      ? current.some((t) => t.toLowerCase() === lower)
        ? current
        : [...current, tag]
      : current.filter((t) => t.toLowerCase() !== lower);

  await prisma.contact.update({
    where: { id: enrollment.contactId },
    data: { tags: nextTags },
  });
  await prisma.loomiFlowEnrollmentStep.create({
    data: {
      enrollmentId: enrollment.id,
      nodeId: node.id,
      // Neutral status — tag ops aren't "sent"; analytics only counts
      // sent/failed/exited per node, so 'updated' is correctly ignored
      // by send metrics while still recording throughput.
      status: 'updated',
      metadata: stringifyConfig({ op: node.type, tag }),
    },
  });
}

// ─────────────────────────────────────────────────────
// Email node execution (reuses send infrastructure)
// ─────────────────────────────────────────────────────

async function executeEmailNode(
  enrollment: { id: string; contactId: string; flowId: string },
  node: NodeForExecution,
): Promise<void> {
  // Idempotency guard: if a successful send for this node already exists
  // in the current cycle (a prior tick sent then the worker crashed
  // before advancing, or an overlapping tick), skip and let the tick
  // advance — never re-send. Re-entry deletes prior-cycle steps, so a
  // 'sent' step here means "already sent this run". (Residual: a crash in
  // the sub-second window between the provider accepting and the step
  // write can still double-send; provider idempotency keys would close
  // that — tracked separately.)
  const alreadySent = await prisma.loomiFlowEnrollmentStep.findFirst({
    where: { enrollmentId: enrollment.id, nodeId: node.id, status: 'sent' },
    select: { id: true },
  });
  if (alreadySent) return;

  const templateId = node.config.templateId ? String(node.config.templateId) : null;
  const subjectOverride = node.config.subject ? String(node.config.subject) : null;

  const contact = await prisma.contact.findUnique({
    where: { id: enrollment.contactId },
    select: {
      id: true,
      accountKey: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      fullName: true,
      vehicleYear: true,
      vehicleMake: true,
      vehicleModel: true,
      dateOfBirth: true,
      customFields: true,
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

  // Personalize: substitute {{firstName}} / {{vehicleMake}} / custom-field
  // mergetags in the subject + body. (Previously only the SMS path did
  // this, so flow emails shipped literal {{…}} tokens.)
  const mergeCtx = mergetagCtx(enrollment, node, contact);
  subject = applyMergetags(subject, mergeCtx);
  html = applyMergetags(html, mergeCtx);

  // We piggyback on EmailBlastRecipient so SendGrid Event Webhook
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

  // Upsert (not create): the wrapper campaign is reused per (flow,node),
  // so on a re-entry cycle the same (campaignId, contactId, accountKey)
  // row already exists. A plain create would hit the unique constraint
  // (P2002) and get swallowed as a "send failure", silently killing
  // every recurring flow's 2nd+ send. Resetting the row treats the new
  // cycle as a fresh send. (Caveat: events join on recipientId, so
  // per-cycle open/click history collapses onto one row — acceptable
  // for the aggregate per-node stats the builder shows.)
  const recipientFullName =
    contact.fullName || `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || null;
  const recipient = await prisma.emailBlastRecipient.upsert({
    where: {
      campaignId_contactId_accountKey: {
        campaignId: wrapperCampaign.id,
        contactId: contact.id,
        accountKey: contact.accountKey,
      },
    },
    create: {
      campaignId: wrapperCampaign.id,
      contactId: contact.id,
      accountKey: contact.accountKey,
      email: recipientEmail,
      fullName: recipientFullName,
      status: 'pending',
    },
    update: {
      email: recipientEmail,
      fullName: recipientFullName,
      status: 'pending',
      messageId: null,
      sentAt: null,
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
    await prisma.emailBlastRecipient.update({
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
    await prisma.emailBlastRecipient.update({
      where: { id: recipient.id },
      data: { status: 'failed', error: errorMessage },
    });
    // Rethrow so the tick's bounded retry/backoff handles transient send
    // failures (SendGrid 5xx, timeouts) instead of silently advancing
    // past the email. Pre-send gates above (no email / DND / suppression /
    // no sender) already returned terminally and never reach here.
    throw new Error(errorMessage);
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
  // Atomic upsert on the unique flowNodeKey (ON CONFLICT) so two
  // concurrent first-sends for the same node converge on one wrapper
  // campaign instead of racing two duplicate shells (which would split
  // recipient rows + per-node analytics).
  const name = `Flow:${flowId}/Node:${nodeId}`;
  return prisma.emailBlast.upsert({
    where: { flowNodeKey: name },
    create: {
      flowNodeKey: name,
      name,
      subject: subject || 'Flow email',
      htmlContent: html || '',
      status: 'processing',
      sourceType: 'drag-drop',
      accountKeys: JSON.stringify([accountKey]),
    },
    update: {},
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
    // Count DISTINCT recipients per event type, not raw event volume:
    // a recipient row is reused across re-entry cycles and accrues
    // multiple opens/clicks, so `_count._all` made the open rate exceed
    // 100% on recurring flows. Distinct keeps opens ≤ sends.
    const events = await prisma.emailEvent.findMany({
      where: { recipientId: { in: recipientIds }, eventType: { in: ['open', 'click'] } },
      select: { recipientId: true, eventType: true },
      distinct: ['recipientId', 'eventType'],
    });
    for (const e of events) {
      if (e.eventType === 'open') totalOpens += 1;
      else if (e.eventType === 'click') totalClicks += 1;
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
 * once — matches how the EmailBlast analytics surface reads.
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

// ─────────────────────────────────────────────────────────────────
// SMS / Webhook / Wait-Until execution
//
// These three landed after the initial email-only enrollment engine.
// SMS mirrors `executeEmailNode`: load the contact, gate on DND +
// suppression, resolve per-account Twilio credentials, attach the
// send to a wrapper SmsBlast so status-callback webhooks route
// SmsEvent rows back to a real recipient. Webhook fires an HTTP
// request with mergetag-interpolated body, with a single 5xx/timeout
// retry. Wait-until anchors against a Contact date field + offset.
// ─────────────────────────────────────────────────────────────────

// applyMergetags + MergetagContext live in the pure (no-Prisma) module
// `@/lib/flows/mergetags` so they're unit-testable; imported at the top
// of this file.

/** Twilio status-callback URL keyed by accountKey so the webhook
 *  resolver pulls the right Auth Token. Returns null when no public
 *  origin is configured (local dev without a tunnel) — callbacks are
 *  noise in that mode. */
function flowStatusCallbackUrl(accountKey: string): string | undefined {
  const origin = process.env.APP_PUBLIC_URL || process.env.NEXTAUTH_URL || '';
  if (!origin) return undefined;
  return `${origin.replace(/\/$/, '')}/api/webhooks/twilio/status?accountKey=${encodeURIComponent(accountKey)}`;
}

async function executeSmsNode(
  enrollment: { id: string; contactId: string; flowId: string },
  node: NodeForExecution,
): Promise<void> {
  // Idempotency guard — see executeEmailNode: skip if this node already
  // recorded a successful send this cycle so a crash/retry can't re-text.
  const alreadySent = await prisma.loomiFlowEnrollmentStep.findFirst({
    where: { enrollmentId: enrollment.id, nodeId: node.id, status: 'sent' },
    select: { id: true },
  });
  if (alreadySent) return;

  const rawMessage = String(node.config.message || '').trim();
  if (!rawMessage) {
    await recordStepFailure(enrollment.id, node.id, 'sms node has no message body');
    return;
  }

  const contact = await prisma.contact.findUnique({
    where: { id: enrollment.contactId },
    select: {
      id: true,
      accountKey: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      fullName: true,
      vehicleYear: true,
      vehicleMake: true,
      vehicleModel: true,
      dateOfBirth: true,
      customFields: true,
      dnd: true,
    },
  });
  if (!contact) {
    await recordStepFailure(enrollment.id, node.id, 'contact missing');
    return;
  }

  const normalizedPhone = normalizePhoneNumber(contact.phone || '');
  if (!isLikelyDialablePhone(normalizedPhone)) {
    await recordStepFailure(enrollment.id, node.id, 'no dialable phone');
    return;
  }
  const dnd = contact.dnd as Record<string, unknown> | null;
  if (dnd && dnd.sms === true) {
    await recordStepFailure(enrollment.id, node.id, 'contact opted out (dnd.sms)');
    return;
  }
  const suppression = await prisma.smsSuppression.findUnique({
    where: { accountKey_phone: { accountKey: contact.accountKey, phone: normalizedPhone } },
  });
  if (suppression) {
    await recordStepFailure(enrollment.id, node.id, `suppressed: ${suppression.reason}`);
    return;
  }

  const twilio = await resolveTwilioConfig(contact.accountKey);
  if (!twilio) {
    await recordStepFailure(
      enrollment.id,
      node.id,
      'No Twilio credentials configured for this sub-account',
    );
    return;
  }

  const body = applyMergetags(rawMessage, mergetagCtx(enrollment, node, contact));

  const wrapperCampaign = await getOrCreateFlowWrapperSmsBlast(
    enrollment.flowId,
    node.id,
    body,
    contact.accountKey,
  );

  // Upsert (not create) — see executeEmailNode: the per-(flow,node)
  // wrapper campaign means re-entry cycles re-hit the same unique
  // (campaignId, contactId, accountKey) row; a create would P2002 and
  // silently kill recurring SMS sends.
  const smsRecipientFullName =
    contact.fullName || `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || null;
  const recipient = await prisma.smsBlastRecipient.upsert({
    where: {
      campaignId_contactId_accountKey: {
        campaignId: wrapperCampaign.id,
        contactId: contact.id,
        accountKey: contact.accountKey,
      },
    },
    create: {
      campaignId: wrapperCampaign.id,
      contactId: contact.id,
      accountKey: contact.accountKey,
      phone: normalizedPhone,
      fullName: smsRecipientFullName,
      status: 'pending',
    },
    update: {
      phone: normalizedPhone,
      fullName: smsRecipientFullName,
      status: 'pending',
      messageId: null,
      sentAt: null,
      error: null,
    },
  });

  try {
    const result = await sendSmsViaTwilio({
      accountSid: twilio.accountSid,
      authToken: twilio.authToken,
      from: {
        phoneNumber: twilio.phoneNumber,
        messagingServiceSid: twilio.messagingServiceSid,
      },
      to: normalizedPhone,
      body,
      statusCallback: flowStatusCallbackUrl(contact.accountKey),
    });
    await prisma.smsBlastRecipient.update({
      where: { id: recipient.id },
      data: {
        status: 'sent',
        messageId: result.messageSid,
        sentAt: new Date(),
        error: null,
      },
    });
    await prisma.loomiFlowEnrollmentStep.create({
      data: {
        enrollmentId: enrollment.id,
        nodeId: node.id,
        status: 'sent',
      },
    });
  } catch (err) {
    const errorMessage =
      err instanceof TwilioError
        ? `Twilio: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Twilio send failed';
    await prisma.smsBlastRecipient.update({
      where: { id: recipient.id },
      data: { status: 'failed', error: errorMessage },
    });
    // Rethrow so the tick's bounded retry/backoff handles transient send
    // failures instead of silently advancing past the SMS.
    throw new Error(errorMessage);
  }
}

/** Persistent wrapper-campaign per (flow node) for SMS — mirrors the
 *  email pattern so Twilio status-callback events flow back to the
 *  same SmsEvent / SmsBlastRecipient join the campaign analytics
 *  surface already understands. */
async function getOrCreateFlowWrapperSmsBlast(
  flowId: string,
  nodeId: string,
  message: string,
  accountKey: string,
): Promise<{ id: string }> {
  // Atomic upsert on the unique flowNodeKey — see the email wrapper.
  const name = `Flow:${flowId}/Node:${nodeId}`;
  return prisma.smsBlast.upsert({
    where: { flowNodeKey: name },
    create: {
      flowNodeKey: name,
      name,
      message: message || 'Flow SMS',
      status: 'processing',
      accountKeys: JSON.stringify([accountKey]),
    },
    update: {},
    select: { id: true },
  });
}

const WEBHOOK_TIMEOUT_MS = 10_000;

async function executeWebhookNode(
  enrollment: { id: string; contactId: string; flowId: string },
  node: NodeForExecution,
): Promise<void> {
  const url = String(node.config.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    await recordStepFailure(enrollment.id, node.id, 'webhook URL missing or not http(s)');
    return;
  }
  const method = String(node.config.method || 'POST').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'GET', 'DELETE'].includes(method)) {
    await recordStepFailure(enrollment.id, node.id, `unsupported method: ${method}`);
    return;
  }

  const contact = await prisma.contact.findUnique({
    where: { id: enrollment.contactId },
    select: {
      id: true,
      accountKey: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      fullName: true,
    },
  });
  if (!contact) {
    await recordStepFailure(enrollment.id, node.id, 'contact missing');
    return;
  }

  const ctx = mergetagCtx(enrollment, node, contact);

  // Apply mergetags to both the URL and the body so callers can build
  // per-contact endpoints (e.g. `https://crm/api/contacts/{{contactId}}`).
  const interpolatedUrl = applyMergetags(url, ctx);

  // Anti-SSRF: validate the (interpolated) target is a public endpoint
  // before we fetch it server-side — block localhost / cloud-metadata /
  // private ranges, including a public hostname that resolves internally.
  try {
    await assertSafeWebhookUrl(interpolatedUrl);
  } catch (err) {
    await recordStepFailure(
      enrollment.id,
      node.id,
      `webhook target blocked: ${err instanceof Error ? err.message : 'unsafe URL'}`,
    );
    return;
  }

  let body: string | undefined;
  if (method !== 'GET' && method !== 'DELETE') {
    const raw = typeof node.config.body === 'string' ? node.config.body : '';
    if (raw.trim()) {
      body = applyMergetags(raw, ctx);
      // Validate JSON-ness post-interpolation; if a mergetag broke the
      // syntax we want a clean failure rather than letting the server
      // receive malformed JSON.
      try {
        JSON.parse(body);
      } catch (err) {
        await recordStepFailure(
          enrollment.id,
          node.id,
          `webhook body is invalid JSON after mergetag interpolation: ${err instanceof Error ? err.message : 'parse error'}`,
        );
        return;
      }
    }
  }

  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      return await fetch(interpolatedUrl, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body,
        signal: controller.signal,
        // Don't follow redirects — a 3xx to an internal host would bypass
        // the SSRF check above. A webhook should post to its final URL.
        redirect: 'error',
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // One retry on timeout or 5xx — anything else (404, 422, etc.) is
  // a caller-side problem and shouldn't be retried.
  let response: Response;
  try {
    response = await attempt();
    if (response.status >= 500 && response.status < 600) {
      response = await attempt();
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      try {
        response = await attempt();
      } catch (retryErr) {
        await recordStepFailure(
          enrollment.id,
          node.id,
          `webhook timed out after ${WEBHOOK_TIMEOUT_MS}ms (retry failed: ${retryErr instanceof Error ? retryErr.message : 'unknown'})`,
        );
        return;
      }
    } else {
      await recordStepFailure(
        enrollment.id,
        node.id,
        `webhook fetch error: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return;
    }
  }

  if (!response.ok) {
    // Log the TEMPLATE url (with {{placeholders}}), not the interpolated
    // one — the interpolated URL can carry contact PII ({{email}} in a
    // path/query) that shouldn't land in the audit trail.
    await recordStepFailure(
      enrollment.id,
      node.id,
      `webhook ${method} ${url} returned ${response.status}`,
    );
    return;
  }

  await prisma.loomiFlowEnrollmentStep.create({
    data: {
      enrollmentId: enrollment.id,
      nodeId: node.id,
      status: 'sent',
      metadata: stringifyConfig({
        // Store the template URL, not the PII-interpolated one.
        url,
        method,
        status: response.status,
      }),
    },
  });
}

/**
 * push_to_crm node — hand the enrolled contact off to an API CRM (HubSpot).
 *
 * The node doesn't call the CRM inline: it creates a CrmDelivery (source
 * "flow") and enqueues the same pg-boss delivery job a form submission would,
 * so the actual upsert — and its retry/backoff — runs in the worker
 * (deliver.ts). This keeps the flow tick fast and the CRM-push logic in one
 * place. The HubSpot upsert is idempotent by email, so a contact that passes
 * through this node more than once just refreshes the same record.
 */
async function executePushToCrmNode(
  enrollment: { id: string; contactId: string },
  node: NodeForExecution,
): Promise<void> {
  // Idempotency guard (same as the email node): a 'sent' step for this node
  // in the current cycle means we already enqueued — never double-enqueue
  // (which, with deal creation on, could otherwise create duplicate deals).
  const alreadyPushed = await prisma.loomiFlowEnrollmentStep.findFirst({
    where: { enrollmentId: enrollment.id, nodeId: node.id, status: 'sent' },
    select: { id: true },
  });
  if (alreadyPushed) return;

  const provider = String(node.config.provider || '').trim() || CRM_PUSH_PROVIDERS[0];

  const contact = await prisma.contact.findUnique({
    where: { id: enrollment.contactId },
    select: { id: true, accountKey: true },
  });
  if (!contact) {
    await recordStepFailure(enrollment.id, node.id, 'contact missing');
    return;
  }

  const destination = await prisma.crmDestination.findFirst({
    where: { accountKey: contact.accountKey, provider, enabled: true },
    select: { id: true },
  });
  if (!destination) {
    // No connected CRM for this provider — skip (non-fatal) so the contact
    // keeps moving through the flow; the step log shows why nothing pushed.
    await prisma.loomiFlowEnrollmentStep.create({
      data: {
        enrollmentId: enrollment.id,
        nodeId: node.id,
        status: 'skipped',
        metadata: stringifyConfig({ reason: `no enabled ${provider} CRM connected` }),
      },
    });
    return;
  }

  const delivery = await prisma.crmDelivery.create({
    data: {
      destinationId: destination.id,
      source: 'flow',
      contactId: contact.id,
    },
    select: { id: true },
  });

  try {
    await enqueueCrmDeliveryJob(delivery.id);
  } catch (err) {
    // Don't leave an orphaned `pending` row no worker will pick up.
    await prisma.crmDelivery
      .update({
        where: { id: delivery.id },
        data: {
          status: 'failed',
          lastError: err instanceof Error ? `enqueue failed: ${err.message}` : 'enqueue failed',
        },
      })
      .catch(() => {});
    await recordStepFailure(
      enrollment.id,
      node.id,
      `failed to enqueue ${provider} push: ${err instanceof Error ? err.message : 'unknown'}`,
    );
    return;
  }

  await prisma.loomiFlowEnrollmentStep.create({
    data: {
      enrollmentId: enrollment.id,
      nodeId: node.id,
      // 'sent' = handed to the delivery worker (the async upsert happens
      // there). Mirrors how the webhook node records a successful hand-off.
      status: 'sent',
      metadata: stringifyConfig({ provider, deliveryId: delivery.id }),
    },
  });
}

/**
 * Decide what to do at a wait_until node:
 *   - 'wait': anchor date is in the future → set nextRunAt = anchor.
 *   - 'fire': anchor date is now or past → log + advance immediately.
 *   - 'skip': contact has no value for the configured field → log
 *             "skipped" and advance (we don't strand contacts forever
 *             on missing anchors; the alternative is silently failing
 *             every contact whose data is incomplete).
 */
async function evaluateWaitUntil(
  enrollment: { id: string; contactId: string },
  node: NodeForExecution,
): Promise<
  | { kind: 'wait'; fireAt: Date }
  | { kind: 'fire'; reason?: string }
  | { kind: 'skip'; reason: string }
> {
  const field = String(node.config.field || '').trim();
  if (!field) return { kind: 'skip', reason: 'wait_until missing field' };

  // Only the date fields the validator allows are pulled — keeps the
  // worker's surface area small + matches what the UI exposes.
  const contact = await prisma.contact.findUnique({
    where: { id: enrollment.contactId },
    select: {
      nextServiceDate: true,
      lastServiceDate: true,
      leaseEndDate: true,
      warrantyEndDate: true,
      purchaseDate: true,
      dateAdded: true,
    },
  });
  if (!contact) return { kind: 'skip', reason: 'contact missing' };

  const anchor = (contact as Record<string, Date | null>)[field];
  if (!anchor) return { kind: 'skip', reason: `${field} not set on contact` };

  const offsetDays = Number(node.config.offsetDays);
  const safeOffset = Number.isFinite(offsetDays) ? offsetDays : 0;
  const fireAt = new Date(anchor.getTime() + safeOffset * 24 * 60 * 60 * 1000);

  if (fireAt.getTime() <= Date.now()) {
    return { kind: 'fire', reason: 'target date already past' };
  }
  return { kind: 'wait', fireAt };
}

function mergetagCtx(
  enrollment: { id: string; contactId: string; flowId: string },
  node: NodeForExecution,
  contact: {
    accountKey: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    fullName: string | null;
    // Optional so the webhook node (which selects a leaner contact) and
    // tests can omit them; included for email/SMS personalization.
    vehicleYear?: string | null;
    vehicleMake?: string | null;
    vehicleModel?: string | null;
    dateOfBirth?: Date | null;
    customFields?: unknown;
  },
): MergetagContext {
  const ctx: MergetagContext = {
    firstName: contact.firstName ?? '',
    lastName: contact.lastName ?? '',
    fullName:
      contact.fullName?.trim() ||
      `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim(),
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    vehicleYear: contact.vehicleYear ?? '',
    vehicleMake: contact.vehicleMake ?? '',
    vehicleModel: contact.vehicleModel ?? '',
    dateOfBirth: contact.dateOfBirth ? contact.dateOfBirth.toISOString().slice(0, 10) : '',
    contactId: enrollment.contactId,
    accountKey: contact.accountKey,
    flowId: enrollment.flowId,
    enrollmentId: enrollment.id,
    nodeId: node.id,
  };
  // Spread the account's custom fields by key (snake_case, e.g.
  // {{last_purchase_date}}). Built-ins above win on key collision.
  const blob = contact.customFields;
  if (blob && typeof blob === 'object') {
    for (const [key, value] of Object.entries(blob as Record<string, unknown>)) {
      if (key in ctx) continue;
      if (value == null) continue;
      ctx[key] = typeof value === 'string' ? value : String(value);
    }
  }
  return ctx;
}
