/**
 * Dealer-saved Landing Page templates.
 *
 * Lifecycle:
 *   1. Dealer hits "Save as template" on an LP → snapshot of the
 *      schema lands here.
 *   2. The New Landing Page modal lists these next to the built-in
 *      presets (`LP_TEMPLATE_PRESETS`). Creating from a saved
 *      template deep-clones the schema into a new LP.
 *   3. Dealer can delete from the modal's per-template menu.
 *
 * Templates are account-scoped (one account's templates don't leak
 * to another). They don't have a publish lifecycle — they're
 * design-time only.
 */
import type { AccountLandingPageTemplate } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  parseLandingPageContent,
  type LandingPageContent,
} from '@/lib/landing-pages/types';

export class LpTemplateServiceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'LpTemplateServiceError';
  }
}

export interface LpTemplateSummary {
  id: string;
  accountKey: string;
  name: string;
  description: string | null;
  /** Parsed schema — same shape as LandingPage.schema. */
  schema: LandingPageContent;
  sourceLpId: string | null;
  /** Publish lifecycle (shared across all template kinds). */
  status: 'draft' | 'published';
  /** Shared template taxonomy. */
  category: string | null;
  tags: string[];
  createdByUserId: string | null;
  /** Resolved author display info (template card). Null until resolved. */
  createdByName: string | null;
  createdByImage: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseTagsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function toSummary(row: AccountLandingPageTemplate): LpTemplateSummary {
  // Fall back to an empty-ish blocks template if the row's schema
  // is somehow malformed — better than the modal crashing.
  const parsed = parseLandingPageContent(row.schema) ?? {
    version: '1',
    settings: {} as never,
    blocks: [],
  } as unknown as LandingPageContent;
  return {
    id: row.id,
    accountKey: row.accountKey,
    name: row.name,
    description: row.description,
    schema: parsed,
    sourceLpId: row.sourceLpId,
    status: row.status === 'published' ? 'published' : 'draft',
    category: row.category ?? null,
    tags: parseTagsJson(row.tags),
    createdByUserId: row.createdByUserId,
    createdByName: null,
    createdByImage: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Resolve author display info (name + avatar) for a set of summaries by user id. */
async function attachAuthors(summaries: LpTemplateSummary[]): Promise<LpTemplateSummary[]> {
  const ids = [...new Set(summaries.map((s) => s.createdByUserId).filter((v): v is string => !!v))];
  if (ids.length === 0) return summaries;
  try {
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarUrl: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const s of summaries) {
      const u = s.createdByUserId ? byId.get(s.createdByUserId) : undefined;
      if (u) {
        s.createdByName = u.name ?? null;
        s.createdByImage = u.avatarUrl ?? null;
      }
    }
  } catch {
    /* best-effort */
  }
  return summaries;
}

/** Update a template's shared taxonomy + publish state (from the template card). */
export async function updateLpTemplate(
  id: string,
  accountKeys: string[] | null,
  patch: { category?: unknown; tags?: unknown; status?: unknown },
): Promise<LpTemplateSummary> {
  const row = await prisma.accountLandingPageTemplate.findUnique({ where: { id } });
  if (!row) throw new LpTemplateServiceError('Template not found.', 404);
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(row.accountKey)) {
    throw new LpTemplateServiceError('Template not found.', 404);
  }
  const data: Record<string, unknown> = {};
  if (patch.category !== undefined) {
    data.category = typeof patch.category === 'string' && patch.category.trim() ? patch.category.trim() : null;
  }
  if (patch.tags !== undefined) {
    data.tags = Array.isArray(patch.tags)
      ? JSON.stringify(patch.tags.filter((t): t is string => typeof t === 'string'))
      : null;
  }
  if (patch.status !== undefined) {
    if (patch.status !== 'draft' && patch.status !== 'published') {
      throw new LpTemplateServiceError('status must be draft or published');
    }
    data.status = patch.status;
    if (patch.status === 'published' && !row.publishedAt) data.publishedAt = new Date();
  }
  const updated = await prisma.accountLandingPageTemplate.update({ where: { id }, data });
  return toSummary(updated);
}

// ── List / read ────────────────────────────────────────────────────

export async function listLpTemplatesForAccount(
  accountKey: string,
): Promise<LpTemplateSummary[]> {
  const rows = await prisma.accountLandingPageTemplate.findMany({
    where: { accountKey },
    orderBy: { createdAt: 'desc' },
  });
  return attachAuthors(rows.map(toSummary));
}

export async function getLpTemplate(
  id: string,
  accountKeys: string[] | null,
): Promise<LpTemplateSummary | null> {
  const row = await prisma.accountLandingPageTemplate.findUnique({ where: { id } });
  if (!row) return null;
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(row.accountKey)) {
    return null;
  }
  return toSummary(row);
}

// ── Create / delete ────────────────────────────────────────────────

export async function createLpTemplateFromLandingPage(input: {
  /** Source LP — its account + schema seed the new template. */
  lpId: string;
  accountKeys: string[] | null;
  name: string;
  description?: string;
  createdByUserId?: string;
}): Promise<LpTemplateSummary> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new LpTemplateServiceError('Template name is required.');
  }
  if (trimmedName.length > 120) {
    throw new LpTemplateServiceError('Template name is too long (max 120 chars).');
  }

  const lp = await prisma.landingPage.findUnique({ where: { id: input.lpId } });
  if (!lp) throw new LpTemplateServiceError('Source landing page not found.', 404);
  // An account template must attach to an account, so a null-account
  // (system/library) LP can't seed one. This guard also blocks a scoped
  // caller from snapshotting another account's LP by id (source-account
  // scope check), and narrows accountKey to non-null for the create below.
  const sourceAccountKey = lp.accountKey;
  if (
    sourceAccountKey == null ||
    (input.accountKeys &&
      input.accountKeys.length > 0 &&
      !input.accountKeys.includes(sourceAccountKey))
  ) {
    throw new LpTemplateServiceError('Source landing page not found.', 404);
  }

  // Snapshot the schema. Deep-clone via JSON roundtrip — Prisma's
  // JsonValue is plain data, no Maps / Sets / functions.
  const schema = JSON.parse(JSON.stringify(lp.schema));

  const row = await prisma.accountLandingPageTemplate.create({
    data: {
      accountKey: sourceAccountKey,
      name: trimmedName,
      description:
        typeof input.description === 'string' && input.description.trim().length > 0
          ? input.description.trim().slice(0, 500)
          : null,
      schema,
      sourceLpId: lp.id,
      createdByUserId: input.createdByUserId,
    },
  });
  return toSummary(row);
}

export async function deleteLpTemplate(
  id: string,
  accountKeys: string[] | null,
): Promise<void> {
  const row = await prisma.accountLandingPageTemplate.findUnique({ where: { id } });
  if (!row) throw new LpTemplateServiceError('Template not found.', 404);
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(row.accountKey)) {
    throw new LpTemplateServiceError('Template not found.', 404);
  }
  await prisma.accountLandingPageTemplate.delete({ where: { id } });
}
