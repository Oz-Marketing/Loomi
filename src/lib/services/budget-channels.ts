import { prisma } from '@/lib/prisma';
import { KIND_META } from '@/lib/projects/ui';
import {
  channelRecordFromRow,
  createChannelRegistry,
  isBudgetLineType,
  isPacerPlatform,
  SEED_CHANNEL_RECORDS,
  type ChannelRecord,
  type ChannelRegistry,
} from '@/lib/budget/channel-registry';

/**
 * Server-side access to the budget channel list.
 *
 * `channelRegistry()` is the one way server code gets channel lookups. Load it
 * ONCE per service call and pass the registry down — the lookups are sync, so a
 * loop must never re-await it:
 *
 *     const ch = await channelRegistry();
 *     for (const line of lines) ch.label(line.channel);
 *
 * There is no memoisation here on purpose. It's one indexed read of a ~44-row
 * table against service calls that already issue several queries, and a cache
 * would mean an admin's rename not showing up until something expired. If it
 * ever shows up in a profile, wrapping this in React `cache()` is the drop-in
 * fix — the call sites are already shaped for it.
 */
export async function channelRegistry(): Promise<ChannelRegistry> {
  return createChannelRegistry(await listChannels());
}

/**
 * Every channel, archived included.
 *
 * Falls back to the seed when the table is EMPTY — the window between this
 * shipping and the seed script running, and any fresh dev database. An empty
 * registry would otherwise reject every channel key on write as unknown, which
 * looks exactly like data corruption. A table with rows in it is authoritative
 * even if a seed channel is missing from it: that means someone removed it.
 */
export async function listChannels(): Promise<ChannelRecord[]> {
  const rows = await prisma.budgetChannel.findMany({
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  if (rows.length === 0) return [...SEED_CHANNEL_RECORDS];
  return rows.map(channelRecordFromRow);
}

/** Rows for the settings screen, which needs the id to address them. */
export async function listChannelsForAdmin(): Promise<(ChannelRecord & { id: string })[]> {
  const rows = await prisma.budgetChannel.findMany({
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  return rows.map((r) => ({ ...channelRecordFromRow(r), id: r.id }));
}

export function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export type ChannelInput = {
  label: string;
  category: string;
  lineType?: string;
  billingKey?: string | null;
  pacer?: string | null;
  intakeKinds?: string[];
  icon?: string | null;
  externalIds?: number[];
};

/**
 * Validate the parts of a channel that other systems depend on being sane.
 *
 * `pacer` is the one worth being strict about: a typo doesn't error anywhere,
 * it just quietly stops that channel's budget reaching the pacer, and nobody
 * notices until a month's targets are short.
 */
async function validate(input: {
  lineType?: string;
  billingKey?: string | null;
  pacer?: string | null;
  category?: string;
  intakeKinds?: string[];
  externalIds?: number[];
  /** Ignore this channel's own ids when checking for external-id collisions. */
  exceptKey?: string;
}) {
  if (input.lineType !== undefined && !isBudgetLineType(input.lineType)) {
    throw new Error(`"${input.lineType}" is not a line type.`);
  }
  if (input.pacer != null && input.pacer !== '' && !isPacerPlatform(input.pacer)) {
    throw new Error(`"${input.pacer}" is not a pacer platform.`);
  }
  if (input.category !== undefined && !input.category.trim()) {
    throw new Error('A channel needs a display group.');
  }
  if (input.intakeKinds) {
    // Task kinds are code — each has its own intake form. A kind that doesn't
    // exist would offer a budget input on a form that never renders.
    const unknown = input.intakeKinds.filter((k) => !(k in KIND_META));
    if (unknown.length > 0) {
      throw new Error(`Not a task kind: ${unknown.join(', ')}.`);
    }
  }
  if (input.billingKey) {
    const card = await prisma.billingCategory.findUnique({ where: { key: input.billingKey } });
    if (!card) throw new Error(`"${input.billingKey}" is not a rate card.`);
  }
  if (input.externalIds?.length) {
    if (input.externalIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new Error('External ids must be positive whole numbers.');
    }
    // Two channels sharing an external id would make the import pick one
    // arbitrarily. Refuse rather than let real money land on a coin flip.
    const clash = await prisma.budgetChannel.findFirst({
      where: {
        externalIds: { hasSome: input.externalIds },
        ...(input.exceptKey ? { key: { not: input.exceptKey } } : {}),
      },
      select: { key: true, label: true },
    });
    if (clash) {
      throw new Error(`Those external ids are already mapped to ${clash.label} (${clash.key}).`);
    }
  }
}

export async function createChannel(
  input: ChannelInput & { key?: string },
): Promise<ChannelRecord & { id: string }> {
  const label = input.label.trim();
  if (!label) throw new Error('A channel needs a name.');

  const key = normalizeKey(input.key?.trim() || label);
  if (!key) throw new Error('That name has no letters or numbers to make a key from.');

  const clash = await prisma.budgetChannel.findUnique({ where: { key } });
  if (clash) throw new Error(`A channel with the key "${key}" already exists (${clash.label}).`);

  await validate({ ...input, lineType: input.lineType ?? 'unclassified' });

  const last = await prisma.budgetChannel.findFirst({
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const row = await prisma.budgetChannel.create({
    data: {
      key,
      label,
      category: input.category.trim(),
      lineType: input.lineType ?? 'unclassified',
      billingKey: input.billingKey || null,
      pacer: input.pacer || null,
      intakeKinds: input.intakeKinds ?? [],
      icon: input.icon || null,
      externalIds: input.externalIds ?? [],
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  return { ...channelRecordFromRow(row), id: row.id };
}

/**
 * Update a channel. `key` is deliberately not updatable: BudgetLine.channel
 * stores it as a plain string, so a rename would detach every line ever placed
 * on it. Renaming means changing `label`.
 */
export async function updateChannel(
  id: string,
  patch: Partial<ChannelInput> & { archived?: boolean },
): Promise<ChannelRecord & { id: string }> {
  const existing = await prisma.budgetChannel.findUnique({ where: { id } });
  if (!existing) throw new Error('That channel no longer exists.');

  await validate({ ...patch, exceptKey: existing.key });

  const data: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) throw new Error('A channel needs a name.');
    data.label = label;
  }
  if (patch.category !== undefined) data.category = patch.category.trim();
  if (patch.lineType !== undefined) data.lineType = patch.lineType;
  if (patch.billingKey !== undefined) data.billingKey = patch.billingKey || null;
  if (patch.pacer !== undefined) data.pacer = patch.pacer || null;
  if (patch.intakeKinds !== undefined) data.intakeKinds = patch.intakeKinds;
  if (patch.icon !== undefined) data.icon = patch.icon || null;
  if (patch.externalIds !== undefined) data.externalIds = patch.externalIds;
  if (patch.archived !== undefined) {
    data.archivedAt = patch.archived ? (existing.archivedAt ?? new Date()) : null;
  }

  const row = await prisma.budgetChannel.update({ where: { id }, data });
  return { ...channelRecordFromRow(row), id: row.id };
}

/** Persist a new display order. Ids not listed keep their position. */
export async function reorderChannels(ids: string[]): Promise<void> {
  await prisma.$transaction(
    ids.map((id, i) => prisma.budgetChannel.update({ where: { id }, data: { sortOrder: i } })),
  );
}

/**
 * How many budget lines sit on a channel — what the settings screen shows
 * before someone archives one, so the consequence is a number and not a guess.
 */
export async function channelLineCounts(): Promise<Record<string, number>> {
  const grouped = await prisma.budgetLine.groupBy({
    by: ['channel'],
    _count: { _all: true },
  });
  return Object.fromEntries(
    grouped
      .filter((g): g is typeof g & { channel: string } => g.channel != null)
      .map((g) => [g.channel, g._count._all]),
  );
}
