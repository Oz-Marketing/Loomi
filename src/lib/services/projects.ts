import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getTeamNotifyTargets } from '@/lib/services/teams';
import { getCampaignWithAssets } from '@/lib/services/campaigns';
import {
  notifyTaskAssigned,
  notifyTicketFiled,
  notifyTaskComment,
} from '@/lib/notifications/projects';
import { isCreativeKind } from '@/lib/projects/ui';

/**
 * Projects service — initiatives (per-account bodies of work), tasks (the
 * tickets), comments, and the activity feed. Account-scoped on `accountKey`
 * (Account.key) like the rest of the app. A `scope` of null/[] means "all
 * accounts" (elevated roles); a non-empty array filters to those keys.
 */

type Scope = string[] | null;

function scopeWhere(scope: Scope): { accountKey?: { in: string[] } } {
  return scope && scope.length > 0 ? { accountKey: { in: scope } } : {};
}

export function canAccess(scope: Scope, accountKey: string): boolean {
  return !scope || scope.length === 0 || scope.includes(accountKey);
}

// ── Serialization (plain JSON shapes the UI consumes) ──

const TASK_INCLUDE = {
  account: { select: { dealer: true } },
  team: { select: { name: true, color: true } },
  initiative: { select: { name: true } },
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  requester: { select: { id: true, name: true } },
} as const;

type TaskRow = {
  id: string;
  accountKey: string;
  initiativeId: string | null;
  teamKey: string | null;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  priority: string;
  assigneeUserId: string | null;
  requesterUserId: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  position: number;
  completedAt: Date | null;
  linkedAssetType: string | null;
  linkedAssetId: string | null;
  details: unknown;
  createdAt: Date;
  updatedAt: Date;
  account?: { dealer: string } | null;
  team?: { name: string; color: string | null } | null;
  initiative?: { name: string } | null;
  assignee?: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  requester?: { id: string; name: string } | null;
};

export function serializeTask(t: TaskRow) {
  return {
    id: t.id,
    accountKey: t.accountKey,
    accountDealer: t.account?.dealer ?? null,
    initiativeId: t.initiativeId,
    initiativeName: t.initiative?.name ?? null,
    teamKey: t.teamKey,
    teamName: t.team?.name ?? null,
    teamColor: t.team?.color ?? null,
    title: t.title,
    description: t.description,
    kind: t.kind,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee ?? null,
    requester: t.requester ?? null,
    startDate: t.startDate ? t.startDate.toISOString() : null,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    position: t.position,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    linkedAssetType: t.linkedAssetType,
    linkedAssetId: t.linkedAssetId,
    details: (t.details as Record<string, unknown> | null) ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export type TaskDTO = ReturnType<typeof serializeTask>;

// ── Activity feed ──

export async function writeTaskActivity(input: {
  taskId: string;
  action: string;
  summary: string;
  field?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  authorUserId?: string | null;
}) {
  await prisma.taskActivity.create({
    data: {
      taskId: input.taskId,
      action: input.action,
      summary: input.summary,
      field: input.field ?? null,
      fromValue: input.fromValue ?? null,
      toValue: input.toValue ?? null,
      authorUserId: input.authorUserId ?? null,
    },
  });
}

// ── Initiatives ──

export async function listInitiatives(opts: {
  scope: Scope;
  accountKey?: string | null;
  status?: string | null;
}) {
  const where: Record<string, unknown> = {
    archivedAt: null,
    ...scopeWhere(opts.scope),
  };
  if (opts.accountKey) where.accountKey = opts.accountKey;
  if (opts.status) where.status = opts.status;

  const rows = await prisma.initiative.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    include: {
      account: { select: { dealer: true } },
      owner: { select: { id: true, name: true, avatarUrl: true, email: true } },
      _count: { select: { tasks: true } },
      tasks: { select: { status: true }, where: { archivedAt: null } },
    },
  });

  return rows.map((i) => {
    const done = i.tasks.filter((t) => t.status === 'done').length;
    return {
      id: i.id,
      accountKey: i.accountKey,
      accountDealer: i.account?.dealer ?? null,
      name: i.name,
      description: i.description,
      status: i.status,
      priority: i.priority,
      dueDate: i.dueDate ? i.dueDate.toISOString() : null,
      owner: i.owner ?? null,
      taskCount: i._count.tasks,
      doneCount: done,
      createdAt: i.createdAt.toISOString(),
    };
  });
}

const INITIATIVE_INCLUDE = {
  account: { select: { dealer: true } },
  owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
} as const;

type InitiativeRow = {
  id: string;
  accountKey: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  ownerUserId: string | null;
  details: unknown;
  account?: { dealer: string } | null;
  owner?: { id: string; name: string; email: string; avatarUrl: string | null } | null;
};

export function serializeInitiative(i: InitiativeRow) {
  return {
    id: i.id,
    accountKey: i.accountKey,
    accountDealer: i.account?.dealer ?? null,
    name: i.name,
    description: i.description,
    status: i.status,
    priority: i.priority,
    dueDate: i.dueDate ? i.dueDate.toISOString() : null,
    ownerUserId: i.ownerUserId,
    details: (i.details as Record<string, unknown> | null) ?? null,
    owner: i.owner ?? null,
  };
}

export type InitiativeDTO = ReturnType<typeof serializeInitiative>;

export async function getInitiative(id: string) {
  return prisma.initiative.findUnique({ where: { id }, include: INITIATIVE_INCLUDE });
}

export async function updateInitiative(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    status?: string;
    priority?: string;
    dueDate?: string | null;
    ownerUserId?: string | null;
  },
): Promise<InitiativeDTO> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.ownerUserId !== undefined) data.ownerUserId = patch.ownerUserId;
  if (patch.dueDate !== undefined) data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
  const row = await prisma.initiative.update({ where: { id }, data, include: INITIATIVE_INCLUDE });

  // Canceling an initiative cancels every task under it (terminal state). Skip
  // tasks already canceled/done so we don't churn them.
  if (patch.status === 'canceled') {
    await prisma.task.updateMany({
      where: { initiativeId: id, status: { notIn: ['canceled'] } },
      data: { status: 'canceled', completedAt: null },
    });
  }

  return serializeInitiative(row);
}

export async function archiveInitiative(id: string) {
  await prisma.initiative.update({
    where: { id },
    data: { archivedAt: new Date(), status: 'archived' },
  });
}

export async function createInitiative(input: {
  accountKey: string;
  name: string;
  description?: string | null;
  priority?: string;
  dueDate?: string | null;
  ownerUserId?: string | null;
  templateKey?: string | null;
  createdByUserId?: string | null;
}) {
  return prisma.initiative.create({
    data: {
      accountKey: input.accountKey,
      name: input.name.trim(),
      description: input.description ?? null,
      priority: input.priority ?? 'medium',
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      ownerUserId: input.ownerUserId ?? null,
      templateKey: input.templateKey ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

// ── Tasks ──

export async function listTasks(opts: {
  scope: Scope;
  accountKey?: string | null;
  teamKey?: string | null;
  assigneeUserId?: string | null;
  initiativeId?: string | null;
  status?: string | null;
  includeArchived?: boolean;
}): Promise<TaskDTO[]> {
  const where: Record<string, unknown> = { ...scopeWhere(opts.scope) };
  if (!opts.includeArchived) where.archivedAt = null;
  if (opts.accountKey) where.accountKey = opts.accountKey;
  if (opts.teamKey) where.teamKey = opts.teamKey;
  if (opts.assigneeUserId) where.assigneeUserId = opts.assigneeUserId;
  if (opts.initiativeId) where.initiativeId = opts.initiativeId;
  if (opts.status) where.status = opts.status;

  const rows = await prisma.task.findMany({
    where,
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    include: TASK_INCLUDE,
  });
  return rows.map(serializeTask);
}

export async function getTask(id: string): Promise<TaskDTO | null> {
  const row = await prisma.task.findUnique({ where: { id }, include: TASK_INCLUDE });
  return row ? serializeTask(row) : null;
}

export async function getTaskWithThread(id: string) {
  const task = await prisma.task.findUnique({ where: { id }, include: TASK_INCLUDE });
  if (!task) return null;
  const [comments, activity, subtasks] = await Promise.all([
    prisma.taskComment.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    }),
    prisma.taskActivity.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { author: { select: { id: true, name: true } } },
    }),
    prisma.task.findMany({
      where: { parentTaskId: id, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, status: true },
    }),
  ]);

  // Linked Loomi asset (Phase 2) — currently just the Campaign container.
  let linkedCampaign: { id: string; name: string; status: string; assetCount: number } | null = null;
  if (task.linkedAssetType === 'campaign' && task.linkedAssetId) {
    const c = await getCampaignWithAssets(task.linkedAssetId);
    if (c) linkedCampaign = { id: c.id, name: c.name, status: c.status, assetCount: c.assetCounts.total };
  }

  return {
    task: serializeTask(task),
    linkedCampaign,
    subtasks: subtasks.map((s) => ({ id: s.id, title: s.title, status: s.status })),
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      mentions: safeJsonArray(c.mentions),
      author: c.author ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
    activity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      summary: a.summary,
      authorName: a.author?.name ?? null,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function createTask(
  input: {
    accountKey: string;
    initiativeId?: string | null;
    parentTaskId?: string | null;
    teamKey?: string | null;
    title: string;
    description?: string | null;
    kind?: string;
    status?: string;
    priority?: string;
    assigneeUserId?: string | null;
    dueDate?: string | null;
  },
  authorUserId: string | null,
): Promise<TaskDTO> {
  const row = await prisma.task.create({
    data: {
      accountKey: input.accountKey,
      initiativeId: input.initiativeId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      teamKey: input.teamKey ?? null,
      title: input.title.trim(),
      description: input.description ?? null,
      kind: input.kind ?? 'generic',
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      assigneeUserId: input.assigneeUserId ?? null,
      requesterUserId: authorUserId,
      createdByUserId: authorUserId,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      position: Date.now(),
    },
    include: TASK_INCLUDE,
  });
  await writeTaskActivity({
    taskId: row.id,
    action: 'created',
    summary: 'Task created',
    authorUserId,
  });
  if (row.assigneeUserId) {
    await notifyTaskAssigned({
      assigneeUserId: row.assigneeUserId,
      byUserId: authorUserId,
      taskId: row.id,
      taskTitle: row.title,
      accountDealer: row.account?.dealer ?? null,
    });
  }
  return serializeTask(row);
}

export async function updateTask(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    teamKey?: string | null;
    kind?: string;
    status?: string;
    priority?: string;
    assigneeUserId?: string | null;
    initiativeId?: string | null;
    dueDate?: string | null;
    startDate?: string | null;
    position?: number;
    linkedAssetType?: string | null;
    linkedAssetId?: string | null;
    details?: Record<string, unknown>;
  },
  authorUserId: string | null,
): Promise<TaskDTO | null> {
  const before = await prisma.task.findUnique({ where: { id }, include: TASK_INCLUDE });
  if (!before) return null;

  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.teamKey !== undefined) data.teamKey = patch.teamKey;
  if (patch.kind !== undefined) data.kind = patch.kind;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.assigneeUserId !== undefined) data.assigneeUserId = patch.assigneeUserId;
  if (patch.initiativeId !== undefined) data.initiativeId = patch.initiativeId;
  if (patch.position !== undefined) data.position = patch.position;
  if (patch.linkedAssetType !== undefined) data.linkedAssetType = patch.linkedAssetType;
  if (patch.linkedAssetId !== undefined) data.linkedAssetId = patch.linkedAssetId;
  if (patch.dueDate !== undefined) data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
  if (patch.startDate !== undefined)
    data.startDate = patch.startDate ? new Date(patch.startDate) : null;
  if (patch.details !== undefined) {
    // Shallow-merge so per-type intake fields and _attachments coexist.
    data.details = {
      ...((before.details as Record<string, unknown> | null) ?? {}),
      ...patch.details,
    } as Prisma.InputJsonValue;
  }
  if (patch.status !== undefined) {
    data.status = patch.status;
    data.completedAt = patch.status === 'done' ? new Date() : null;
  }

  const row = await prisma.task.update({ where: { id }, data, include: TASK_INCLUDE });

  // Activity + notifications for the meaningful changes.
  if (patch.status !== undefined && patch.status !== before.status) {
    await writeTaskActivity({
      taskId: id,
      action: 'status_changed',
      field: 'status',
      fromValue: before.status,
      toValue: patch.status,
      summary: `Status: ${before.status} → ${patch.status}`,
      authorUserId,
    });
  }
  if (
    patch.assigneeUserId !== undefined &&
    patch.assigneeUserId !== before.assigneeUserId
  ) {
    await writeTaskActivity({
      taskId: id,
      action: 'assigned',
      field: 'assignee',
      fromValue: before.assigneeUserId,
      toValue: patch.assigneeUserId,
      summary: patch.assigneeUserId ? 'Reassigned' : 'Unassigned',
      authorUserId,
    });
    if (patch.assigneeUserId) {
      await notifyTaskAssigned({
        assigneeUserId: patch.assigneeUserId,
        byUserId: authorUserId,
        taskId: id,
        taskTitle: row.title,
        accountDealer: row.account?.dealer ?? null,
      });
    }
  }

  return serializeTask(row);
}

export async function archiveTask(id: string, authorUserId: string | null) {
  await prisma.task.update({ where: { id }, data: { archivedAt: new Date() } });
  await writeTaskActivity({ taskId: id, action: 'archived', summary: 'Task archived', authorUserId });
}

/**
 * Advance tasks whose linked campaign has progressed, so a ticket closes the
 * loop without anyone re-opening it. Run from the daily internal job (the
 * read-time nudge on task detail covers the instant case). Never downgrades,
 * never touches done/blocked/archived tasks.
 *   campaign 'partial' (an asset sent/published) → task 'done'
 *   campaign 'ready'   (assets generated as drafts) → task 'in_review'
 */
export async function reconcileLinkedTaskStatuses(): Promise<{ advanced: number }> {
  const linked = await prisma.task.findMany({
    where: {
      archivedAt: null,
      linkedAssetType: 'campaign',
      linkedAssetId: { not: null },
      status: { notIn: ['done', 'blocked'] },
    },
    select: { id: true, status: true, linkedAssetId: true },
  });

  let advanced = 0;
  for (const t of linked) {
    if (!t.linkedAssetId) continue;
    const campaign = await getCampaignWithAssets(t.linkedAssetId);
    if (!campaign) continue;

    let next: string | null = null;
    if (campaign.status === 'partial') next = 'done';
    else if (campaign.status === 'ready' && (t.status === 'todo' || t.status === 'in_progress'))
      next = 'in_review';

    if (next && next !== t.status) {
      await prisma.task.update({
        where: { id: t.id },
        data: { status: next, completedAt: next === 'done' ? new Date() : null },
      });
      await writeTaskActivity({
        taskId: t.id,
        action: 'status_changed',
        field: 'status',
        fromValue: t.status,
        toValue: next,
        summary: `Auto-advanced from linked campaign (${campaign.status})`,
        authorUserId: null,
      });
      advanced += 1;
    }
  }
  return { advanced };
}

/** Back-link a generated Loomi asset to a task (Phase 2 "Build it"). */
export async function linkTaskAsset(
  taskId: string,
  type: string,
  assetId: string,
  authorUserId: string | null,
  summary: string,
) {
  await prisma.task.update({
    where: { id: taskId },
    data: { linkedAssetType: type, linkedAssetId: assetId },
  });
  await writeTaskActivity({
    taskId,
    action: 'linked',
    field: 'linkedAsset',
    toValue: `${type}:${assetId}`,
    summary,
    authorUserId,
  });
}

// ── Comments ──

export async function addComment(input: {
  taskId: string;
  body: string;
  mentions?: string[];
  authorUserId: string | null;
}) {
  const mentions = [...new Set(input.mentions ?? [])];
  const comment = await prisma.taskComment.create({
    data: {
      taskId: input.taskId,
      body: input.body.trim(),
      mentions: JSON.stringify(mentions),
      authorUserId: input.authorUserId,
    },
    include: { author: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });
  await writeTaskActivity({
    taskId: input.taskId,
    action: 'commented',
    summary: 'Commented',
    authorUserId: input.authorUserId,
  });

  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { title: true, assigneeUserId: true },
  });
  if (task) {
    const notified = new Set<string>();
    for (const userId of mentions) {
      await notifyTaskComment({
        recipientUserId: userId,
        byUserId: input.authorUserId,
        taskId: input.taskId,
        taskTitle: task.title,
        mention: true,
      });
      notified.add(userId);
    }
    if (task.assigneeUserId && !notified.has(task.assigneeUserId)) {
      await notifyTaskComment({
        recipientUserId: task.assigneeUserId,
        byUserId: input.authorUserId,
        taskId: input.taskId,
        taskTitle: task.title,
        mention: false,
      });
    }
  }

  return {
    id: comment.id,
    body: comment.body,
    mentions,
    author: comment.author ?? null,
    createdAt: comment.createdAt.toISOString(),
  };
}

// ── Intake (the "submit a ticket" flow) ──

export async function createTicket(
  input: {
    // One or more accounts this ticket is for. Multiple = a joint effort across
    // those accounts (e.g. neighboring locations running a shared promotion).
    accountKeys: string[];
    initiativeId?: string | null;
    initiativeName?: string | null;
    // Explicit "wrap these tasks in a new Initiative". A ticket otherwise stays
    // a standalone Task unless it earns a container (see the rule below).
    createInitiative?: boolean;
    templateKey?: string | null;
    // One entry per involved department, each with its own task Type + the
    // per-type field values (FieldDef.key → value) captured at intake. Empty =
    // a single team-less generic task.
    departments: { teamKey: string; kind: string; details?: Record<string, unknown> }[];
    // Multi-account creative handling: 'shared' makes ONE creative task reused
    // across all accounts; 'unique' (default) makes one per account.
    creativeMode?: 'shared' | 'unique';
    title: string;
    description?: string | null;
    priority?: string;
    dueDate?: string | null;
    assigneeUserId?: string | null;
    // Ticket-level metadata (timing) + minimal billing. Stored on the initiative
    // when one is created, else on the task(s).
    meta?: Record<string, unknown> | null;
    billing?: Record<string, unknown> | null;
  },
  requesterUserId: string | null,
) {
  const accountKeys = input.accountKeys.filter(Boolean);
  if (accountKeys.length === 0) {
    throw new Error('createTicket requires at least one accountKey');
  }
  const primaryKey = accountKeys[0]!;
  const accounts = await prisma.account.findMany({
    where: { key: { in: accountKeys } },
    select: { key: true, dealer: true },
  });
  // `dealer` is the Account's display-name column (industry-agnostic — it's
  // just the account name, not automotive-specific).
  const accountNameByKey = new Map(accounts.map((a) => [a.key, a.dealer]));
  const accountNames = accountKeys.map((k) => accountNameByKey.get(k) ?? k);

  // Departments → tasks. No departments selected = one generic team-less task.
  const departments: { teamKey: string | null; kind: string; details?: Record<string, unknown> }[] =
    input.departments.length
      ? input.departments.map((d) => ({
          teamKey: d.teamKey || null,
          kind: d.kind || 'generic',
          details: d.details,
        }))
      : [{ teamKey: null, kind: 'generic' }];

  // Ticket-level details (timing + billing) — stored once, on the initiative if
  // grouped, else stashed on the task(s).
  const billing = input.billing && Object.keys(input.billing).length ? input.billing : null;
  const meta = input.meta ?? null;
  const hasMeta = !!meta && Object.values(meta).some((v) => v !== null && v !== '' && v !== false);
  const ticketDetails =
    hasMeta || billing ? { ...(meta ?? {}), ...(billing ? { billing } : {}) } : null;

  const multiAccount = accountKeys.length > 1;
  const multiDept = new Set(departments.filter((d) => d.teamKey).map((d) => d.teamKey)).size > 1;
  const creativeShared = input.creativeMode === 'shared' && multiAccount;

  // Standalone by default. A ticket earns an Initiative wrapper only when it's
  // genuinely a body of work: an existing one was chosen, a new one requested,
  // it came from a template, or it fans out across multiple departments OR
  // multiple accounts (both need coordination). A single account / single dept
  // one-off stays a flat Task.
  let initiativeId = input.initiativeId ?? null;
  if (!initiativeId) {
    const earnsInitiative =
      input.createInitiative === true ||
      !!input.templateKey ||
      multiDept ||
      multiAccount ||
      !!billing; // a billed ticket is a real project → give it a home
    if (earnsInitiative) {
      const initiative = await createInitiative({
        accountKey: primaryKey,
        name: input.initiativeName?.trim() || input.title.trim(),
        description: input.description ?? null,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        ownerUserId: requesterUserId,
        templateKey: input.templateKey ?? null,
        createdByUserId: requesterUserId,
      });
      initiativeId = initiative.id;
    }
  }

  const tasks: TaskDTO[] = [];
  for (const dept of departments) {
    // A shared creative collapses to a single task (owned by the primary
    // account, brief notes all accounts); everything else fans out per account.
    const shared = creativeShared && dept.teamKey != null && isCreativeKind(dept.kind);
    const targetKeys = shared ? [primaryKey] : accountKeys;

    // Per-type field values for this department's task(s). When the ticket isn't
    // grouped, ticket-level meta/billing rides along on the task under `_ticket`.
    const baseDetails: Record<string, unknown> = { ...(dept.details ?? {}) };
    if (!initiativeId && ticketDetails) baseDetails._ticket = ticketDetails;
    const taskDetails = Object.keys(baseDetails).length
      ? (baseDetails as Prisma.InputJsonValue)
      : undefined;

    for (const acctKey of targetKeys) {
      const description = shared
        ? `${input.description ?? ''}\n\nShared creative for: ${accountNames.join(', ')}`.trim()
        : (input.description ?? null);

      const row = await prisma.task.create({
        data: {
          accountKey: acctKey,
          initiativeId,
          teamKey: dept.teamKey,
          title: input.title.trim(),
          description,
          details: taskDetails,
          kind: dept.kind,
          status: 'todo',
          priority: input.priority ?? 'medium',
          assigneeUserId: input.assigneeUserId ?? null,
          requesterUserId,
          createdByUserId: requesterUserId,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          position: Date.now(),
        },
        include: TASK_INCLUDE,
      });
      await writeTaskActivity({
        taskId: row.id,
        action: 'created',
        summary: 'Ticket filed',
        authorUserId: requesterUserId,
      });

      const accountDealer = accountNameByKey.get(acctKey) ?? null;
      if (row.assigneeUserId) {
        await notifyTaskAssigned({
          assigneeUserId: row.assigneeUserId,
          byUserId: requesterUserId,
          taskId: row.id,
          taskTitle: row.title,
          accountDealer,
        });
      } else if (dept.teamKey) {
        const targets = await getTeamNotifyTargets(dept.teamKey);
        if (targets) {
          await notifyTicketFiled({
            recipientUserIds: targets.userIds,
            byUserId: requesterUserId,
            teamName: targets.name,
            taskId: row.id,
            taskTitle: row.title,
            accountDealer,
          });
        }
      }
      tasks.push(serializeTask(row));
    }
  }

  // Ticket-level meta/billing lives on the initiative when there is one.
  if (initiativeId && ticketDetails) {
    await prisma.initiative.update({
      where: { id: initiativeId },
      data: { details: ticketDetails as Prisma.InputJsonValue },
    });
  }

  return { initiativeId, tasks };
}
