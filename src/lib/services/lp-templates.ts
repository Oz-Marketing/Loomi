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
  createdAt: string;
  updatedAt: string;
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── List / read ────────────────────────────────────────────────────

export async function listLpTemplatesForAccount(
  accountKey: string,
): Promise<LpTemplateSummary[]> {
  const rows = await prisma.accountLandingPageTemplate.findMany({
    where: { accountKey },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toSummary);
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
