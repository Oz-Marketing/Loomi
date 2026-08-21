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
  resolveVersionBump,
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
    select: SUMMARY_SELECT,
  });

  return rows.map(toSummary);
}

/** Shape one row into a summary. Shared so create/update/list agree exactly. */
function toSummary(r: {
  id: string;
  key: string;
  name: string;
  scope: string;
  scopeValue: string | null;
  version: number;
  definition: string;
  definitionHash: string;
  publishedAt: Date | null;
  updatedAt: Date;
  _count: { configs: number };
}): PlaybookSummary {
  return {
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
  };
}

const SUMMARY_SELECT = {
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
} as const;

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

  const data = {
    name: input.name.trim() || 'Untitled playbook',
    scope: 'creative',
    scopeValue: input.scopeValue?.trim() || null,
    definition: JSON.stringify(input.definition),
    definitionHash: definitionHash(input.definition),
    publishedAt: input.publish ? new Date() : null,
    createdByUserId: input.userId ?? null,
    updatedByUserId: input.userId ?? null,
  };

  // The scan above is not a lock, so two people pressing New at the same moment
  // both find the same key free and one of them loses on the unique index. That
  // surfaced as a generic 500 on a button whose whole job is "make me a row", so
  // a P2002 just takes the next suffix and tries again — the same retry
  // `createEmailTemplate` uses for its slug.
  let attemptKey = key;
  for (let attempt = 0, n = 2; attempt < 6; attempt += 1) {
    try {
      return toSummary(
        await prisma.playbook.create({
          data: { ...data, key: attemptKey },
          select: SUMMARY_SELECT,
        }),
      );
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        attemptKey = `${base}-${n}`;
        n += 1;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Could not allocate a unique playbook key');
}

export async function updatePlaybook(
  id: string,
  patch: {
    name?: string;
    scopeValue?: string | null;
    definition?: CreativeDefinition;
    publish?: boolean;
    userId?: string | null;
  },
): Promise<PlaybookSummary | null> {
  const existing = await prisma.playbook.findUnique({
    where: { id },
    select: { definitionHash: true, version: true },
  });
  if (!existing) return null;

  // Only a real content change bumps the version — the rule lives in
  // `resolveVersionBump` so it is provable without a database.
  const bump = resolveVersionBump({
    currentVersion: existing.version,
    currentHash: existing.definitionHash,
    nextDefinition: patch.definition,
  });

  await prisma.playbook.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() || 'Untitled playbook' } : {}),
      ...(patch.scopeValue !== undefined ? { scopeValue: patch.scopeValue?.trim() || null } : {}),
      ...(patch.definition
        ? { definition: JSON.stringify(patch.definition), definitionHash: bump.hash }
        : {}),
      ...(bump.bumped ? { version: bump.version } : {}),
      ...(patch.publish === true ? { publishedAt: new Date() } : {}),
      ...(patch.publish === false ? { publishedAt: null } : {}),
      // Stamped on EVERY save, including a rename that doesn't bump the version.
      // "Who touched this platform config, and when" is the question an audit
      // trail exists to answer, and a rename is a change someone made.
      ...(patch.userId !== undefined ? { updatedByUserId: patch.userId } : {}),
    },
  });

  // Re-read just this row rather than the whole library.
  const row = await prisma.playbook.findUnique({ where: { id }, select: SUMMARY_SELECT });
  return row ? toSummary(row) : null;
}

/**
 * Delete a playbook. Accounts following it keep their creative — the FK is
 * `onDelete: SetNull` and the config columns already hold the real values, so
 * deleting a playbook unlinks rooftops rather than blanking their setup.
 */
export async function deletePlaybook(id: string): Promise<boolean> {
  // deleteMany, not delete: a double-click, or two people on the same screen,
  // otherwise turns the second request into a P2025 and a 500 on a button whose
  // job is already done. `false` lets the caller answer 404 instead.
  const { count } = await prisma.playbook.deleteMany({ where: { id } });
  return count > 0;
}
