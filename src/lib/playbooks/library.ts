/**
 * The agency-wide creative playbook library — the only module that reads or
 * writes `Playbook` rows.
 *
 * Kept separate from `creative.ts` (pure resolution) for the same reason
 * `context.ts` is the audit's only prisma module: everything worth testing
 * stays testable without a database.
 */
import { prisma } from '@/lib/prisma';
import {
  parseDefinition,
  definitionHash,
  type CreativeDefinition,
} from './creative';

export interface PlaybookSummary {
  id: string;
  key: string;
  name: string;
  scope: string;
  scopeValue: string | null;
  version: number;
  definition: CreativeDefinition;
  definitionHash: string;
  published: boolean;
  /** How many accounts follow it — the "is this real" signal in the list. */
  appliedCount: number;
  updatedAt: string;
}

/** Slugify a name into a stable key, like `AlertRule.key`. */
export function playbookKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Every playbook, newest first.
 *
 * `publishedOnly` is what the account picker passes: a half-built playbook
 * must never be selectable, or a rooftop ends up pointed at a template that
 * isn't finished.
 */
export async function listPlaybooks(
  opts: { publishedOnly?: boolean } = {},
): Promise<PlaybookSummary[]> {
  const rows = await prisma.playbook.findMany({
    where: {
      scope: 'creative',
      ...(opts.publishedOnly ? { publishedAt: { not: null } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      key: true,
      name: true,
      scope: true,
      scopeValue: true,
      version: true,
      definition: true,
      definitionHash: true,
      publishedAt: true,
      updatedAt: true,
      // Counted in one query rather than per row — the audit's own lesson about
      // a per-account loop over 38 rooftops.
      _count: { select: { configs: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    scope: r.scope,
    scopeValue: r.scopeValue,
    version: r.version,
    definition: parseDefinition(r.definition),
    definitionHash: r.definitionHash,
    published: r.publishedAt !== null,
    appliedCount: r._count.configs,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createPlaybook(input: {
  name: string;
  scopeValue?: string | null;
  definition: CreativeDefinition;
  publish?: boolean;
  userId?: string | null;
}): Promise<PlaybookSummary> {
  const base = playbookKey(input.name) || 'playbook';
  // Collisions are likely — "Chevrolet Monthly Offer" is a name two people
  // reach for. Suffix rather than reject, so naming never blocks the save.
  let key = base;
  for (let n = 2; await prisma.playbook.findUnique({ where: { key } }); n += 1) {
    key = `${base}-${n}`;
  }

  const created = await prisma.playbook.create({
    data: {
      key,
      name: input.name.trim() || 'Untitled playbook',
      scope: 'creative',
      scopeValue: input.scopeValue?.trim() || null,
      definition: JSON.stringify(input.definition),
      definitionHash: definitionHash(input.definition),
      publishedAt: input.publish ? new Date() : null,
      createdByUserId: input.userId ?? null,
    },
    select: { id: true },
  });

  const all = await listPlaybooks();
  return all.find((p) => p.id === created.id)!;
}

export async function updatePlaybook(
  id: string,
  patch: {
    name?: string;
    scopeValue?: string | null;
    definition?: CreativeDefinition;
    publish?: boolean;
  },
): Promise<PlaybookSummary | null> {
  const existing = await prisma.playbook.findUnique({
    where: { id },
    select: { definitionHash: true, version: true },
  });
  if (!existing) return null;

  const nextHash = patch.definition ? definitionHash(patch.definition) : existing.definitionHash;
  // Only a real content change bumps the version. Renaming a playbook, or
  // re-saving it untouched, must not mark every rooftop as behind — the hash is
  // order-normalized precisely so this comparison is trustworthy.
  const changed = nextHash !== existing.definitionHash;

  await prisma.playbook.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() || 'Untitled playbook' } : {}),
      ...(patch.scopeValue !== undefined ? { scopeValue: patch.scopeValue?.trim() || null } : {}),
      ...(patch.definition
        ? { definition: JSON.stringify(patch.definition), definitionHash: nextHash }
        : {}),
      ...(changed ? { version: existing.version + 1 } : {}),
      ...(patch.publish === true ? { publishedAt: new Date() } : {}),
      ...(patch.publish === false ? { publishedAt: null } : {}),
    },
  });

  const all = await listPlaybooks();
  return all.find((p) => p.id === id) ?? null;
}

/**
 * Delete a playbook. Accounts following it keep their creative — the FK is
 * `onDelete: SetNull` and the config columns already hold the real values, so
 * deleting a playbook unlinks rooftops rather than blanking their setup.
 */
export async function deletePlaybook(id: string): Promise<void> {
  await prisma.playbook.delete({ where: { id } });
}
