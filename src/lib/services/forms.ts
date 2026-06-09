import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  emptyFormTemplate,
  isV1FormTemplate,
  parseFormTemplate,
  type FormTemplate,
} from '@/lib/forms/types';
import { isValidSlug, slugify } from '@/lib/forms/schemas';

export type FormStatus = 'draft' | 'published';

export class FormServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'FormServiceError';
  }
}

export interface FormSummary {
  id: string;
  accountKey: string;
  name: string;
  slug: string;
  status: FormStatus;
  submissionCount: number;
  listId: string;
  /** When true, submissions are forwarded as ADF leads to the account's
   *  configured CRM destination(s). */
  forwardToCrm: boolean;
  /** When true, this row is a reusable template rather than a live form. */
  isTemplate: boolean;
  createdByUserId: string;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Parsed FormTemplate — included on every list response so the
   *  card view can render a preview thumbnail without an extra
   *  per-card fetch. Falls back to an empty template if the row's
   *  schema JSON is malformed. */
  schema: FormTemplate;
}

export interface FormEmbedSnippets {
  /** Auto-resizing script-tag embed (recommended). */
  script: string;
  /** Fixed-height iframe embed (fallback for locked-down CMSes). */
  iframe: string;
  /** Public URL of the form (useful for sharing without embedding). */
  publicUrl: string;
}

export interface FormDetail extends FormSummary {
  schema: FormTemplate;
  redirectUrl: string;
  successMessage: string;
  /** Recommended embed snippet (script tag with auto-resizing iframe). */
  embedSnippet: string;
  /** All embed variants — UI shows both with their own copy buttons. */
  embedSnippets: FormEmbedSnippets;
}

export interface FormSubmissionRow {
  id: string;
  formId: string;
  contactId: string;
  contact: {
    id: string;
    email: string;
    phone: string;
    fullName: string;
  } | null;
  data: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  referrer: string;
  createdAt: string;
}

const DEFAULT_SUCCESS_MESSAGE = 'Thanks! We received your submission.';
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function clampPage(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function clampPageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

function dateToIso(value: Date | null | undefined): string {
  return value ? value.toISOString() : '';
}

function parseJsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toSummary(row: {
  id: string;
  accountKey: string | null;
  name: string;
  slug: string;
  status: string;
  submissionCount: number;
  listId: string | null;
  forwardToCrm: boolean;
  isTemplate?: boolean;
  createdByUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  schema?: Prisma.JsonValue;
}): FormSummary {
  return {
    id: row.id,
    // System/library templates have no owning account — surface '' so
    // existing string consumers keep working; the requesting view knows
    // the scope it asked for.
    accountKey: row.accountKey ?? '',
    name: row.name,
    slug: row.slug,
    status: row.status === 'published' ? 'published' : 'draft',
    submissionCount: row.submissionCount,
    listId: row.listId ?? '',
    forwardToCrm: row.forwardToCrm,
    isTemplate: row.isTemplate ?? false,
    createdByUserId: row.createdByUserId ?? '',
    schema:
      row.schema !== undefined
        ? (parseFormTemplate(row.schema as unknown) ?? emptyFormTemplate())
        : emptyFormTemplate(),
    publishedAt: dateToIso(row.publishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: {
  id: string;
  accountKey: string | null;
  name: string;
  slug: string;
  status: string;
  schema: Prisma.JsonValue;
  redirectUrl: string | null;
  successMessage: string | null;
  listId: string | null;
  forwardToCrm: boolean;
  submissionCount: number;
  createdByUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): FormDetail {
  const parsed = parseFormTemplate(row.schema) ?? emptyFormTemplate();
  const snippets = getEmbedSnippets(row.slug);
  return {
    ...toSummary(row),
    schema: parsed,
    redirectUrl: row.redirectUrl ?? '',
    successMessage: row.successMessage ?? DEFAULT_SUCCESS_MESSAGE,
    embedSnippet: snippets.script,
    embedSnippets: snippets,
  };
}

function whereForScope(accountKeys?: string[] | null, accountKey?: string | null) {
  if (accountKey) return { accountKey };
  if (accountKeys && accountKeys.length > 0) return { accountKey: { in: accountKeys } };
  return {};
}

export async function listForms(options?: {
  accountKeys?: string[] | null;
  accountKey?: string | null;
  page?: number;
  pageSize?: number;
  /** When true, list only templates. When false/undefined, list only
   *  live forms (templates are always excluded from the normal list). */
  isTemplate?: boolean;
  /** 'system' → only account-less system/library templates (accountKey
   *  null). Otherwise scoped to accountKey/accountKeys as usual. */
  scope?: 'system';
}): Promise<{ forms: FormSummary[]; page: number; pageSize: number; total: number }> {
  const page = clampPage(options?.page);
  const pageSize = clampPageSize(options?.pageSize);
  const isTemplate = options?.isTemplate === true;
  const where =
    options?.scope === 'system'
      ? { isTemplate, accountKey: null }
      : {
          ...whereForScope(options?.accountKeys ?? null, options?.accountKey ?? null),
          isTemplate,
        };

  const [rows, total] = await Promise.all([
    prisma.form.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.form.count({ where }),
  ]);

  return {
    forms: rows.map(toSummary),
    page,
    pageSize,
    total,
  };
}

export async function ensureUniqueSlug(slug: string, excludeId?: string): Promise<string> {
  const base = slugify(slug) || 'untitled-form';
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await prisma.form.findFirst({
      where: {
        slug: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

export async function createForm(input: {
  // Null only for a system/library template (accountKey-less); live forms
  // and sub-account templates always supply a real account.
  accountKey: string | null;
  name: string;
  createdByUserId?: string | null;
  /** Pre-built FormTemplate to seed the new form. Defaults to empty. */
  schema?: FormTemplate;
  /** When true, the new row is a reusable template, not a live form. */
  isTemplate?: boolean;
}): Promise<FormDetail> {
  const name = input.name.trim();
  if (!name) throw new FormServiceError('name is required');

  if (input.accountKey) {
    const account = await prisma.account.findUnique({
      where: { key: input.accountKey },
      select: { key: true },
    });
    if (!account) throw new FormServiceError('Account not found', 404);
  } else if (!input.isTemplate) {
    // Only system templates may be account-less.
    throw new FormServiceError('accountKey is required');
  }

  const slug = await ensureUniqueSlug(slugify(name) || 'untitled-form');
  const schema = (input.schema ?? emptyFormTemplate()) as unknown as Prisma.InputJsonValue;
  const created = await prisma.form.create({
    data: {
      accountKey: input.accountKey,
      name,
      slug,
      status: 'draft',
      schema,
      isTemplate: input.isTemplate ?? false,
      successMessage: DEFAULT_SUCCESS_MESSAGE,
      createdByUserId: input.createdByUserId ?? null,
    },
  });

  return toDetail(created);
}

/**
 * Clone an existing form's schema into a new template row (isTemplate=true),
 * scoped to the same account. Templates carry no submissions, list binding,
 * or CRM forwarding — just the name + design. Returns the new template.
 */
export async function saveFormAsTemplate(input: {
  formId: string;
  accountKeys: string[] | null;
  name?: string;
  createdByUserId?: string | null;
}): Promise<FormDetail> {
  const source = await prisma.form.findUnique({ where: { id: input.formId } });
  if (!source) throw new FormServiceError('Form not found', 404);
  if (
    input.accountKeys &&
    input.accountKeys.length > 0 &&
    (source.accountKey == null || !input.accountKeys.includes(source.accountKey))
  ) {
    throw new FormServiceError('Form not found', 404);
  }

  const schema = parseFormTemplate(source.schema) ?? emptyFormTemplate();
  const name = (input.name?.trim() || `${source.name} (Template)`).slice(0, 200);

  return createForm({
    accountKey: source.accountKey,
    name,
    schema,
    isTemplate: true,
    createdByUserId: input.createdByUserId ?? null,
  });
}

/**
 * Copy a template (typically a system/library template) into a target
 * sub-account as that account's own template. Used by the "Copy into this
 * account" action in the Templates → Forms library view.
 */
export async function copyFormTemplateToAccount(input: {
  sourceId: string;
  targetAccountKey: string;
  accountKeys: string[] | null;
  createdByUserId?: string | null;
}): Promise<FormDetail> {
  const source = await prisma.form.findUnique({ where: { id: input.sourceId } });
  if (!source || !source.isTemplate) {
    throw new FormServiceError('Template not found', 404);
  }
  // Account-scoped templates require source-account access; null-account
  // system/library templates stay copyable by anyone (the common case). A
  // scoped caller must not be able to clone another account's template by id.
  if (
    source.accountKey != null &&
    input.accountKeys &&
    input.accountKeys.length > 0 &&
    !input.accountKeys.includes(source.accountKey)
  ) {
    throw new FormServiceError('Template not found', 404);
  }
  const schema = parseFormTemplate(source.schema) ?? emptyFormTemplate();
  return createForm({
    accountKey: input.targetAccountKey,
    name: source.name,
    schema,
    isTemplate: true,
    createdByUserId: input.createdByUserId ?? null,
  });
}

export async function getForm(
  id: string,
  accountKeys?: string[] | null,
): Promise<FormDetail | null> {
  const row = await prisma.form.findUnique({ where: { id } });
  if (!row) return null;
  if (
    accountKeys &&
    accountKeys.length > 0 &&
    (row.accountKey == null || !accountKeys.includes(row.accountKey))
  ) {
    return null;
  }
  return toDetail(row);
}

export async function getPublishedFormBySlug(slug: string): Promise<FormDetail | null> {
  const row = await prisma.form.findUnique({ where: { slug } });
  if (!row || row.status !== 'published' || row.isTemplate) return null;
  return toDetail(row);
}

/**
 * Public-render lookup by id: returns a form only if it's published.
 * Used by the landing-page server renderer to pre-fetch the schema of
 * `embedded_form` blocks so they render inline (no client round-trip,
 * no auth required on the public LP).
 */
export async function getPublishedFormById(id: string): Promise<FormDetail | null> {
  const row = await prisma.form.findUnique({ where: { id } });
  if (!row || row.status !== 'published' || row.isTemplate) return null;
  return toDetail(row);
}

export async function updateForm(
  id: string,
  accountKeys: string[] | null,
  patch: {
    name?: unknown;
    slug?: unknown;
    status?: unknown;
    schema?: unknown;
    redirectUrl?: unknown;
    successMessage?: unknown;
    listId?: unknown;
    forwardToCrm?: unknown;
  },
): Promise<FormDetail> {
  const existing = await prisma.form.findUnique({ where: { id } });
  if (!existing) throw new FormServiceError('Form not found', 404);
  if (
    accountKeys &&
    accountKeys.length > 0 &&
    (existing.accountKey == null || !accountKeys.includes(existing.accountKey))
  ) {
    throw new FormServiceError('Form not found', 404);
  }

  const data: Prisma.FormUpdateInput = {};

  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string' || !patch.name.trim()) {
      throw new FormServiceError('name must be a non-empty string');
    }
    data.name = patch.name.trim();
  }

  if (patch.slug !== undefined) {
    if (typeof patch.slug !== 'string') {
      throw new FormServiceError('slug must be a string');
    }
    const nextSlug = slugify(patch.slug);
    if (!isValidSlug(nextSlug)) {
      throw new FormServiceError('slug must be 2-80 lowercase letters, numbers, or hyphens');
    }
    data.slug = await ensureUniqueSlug(nextSlug, id);
  }

  if (patch.status !== undefined) {
    if (patch.status !== 'draft' && patch.status !== 'published') {
      throw new FormServiceError('status must be draft or published');
    }
    data.status = patch.status;
    if (patch.status === 'published' && !existing.publishedAt) {
      data.publishedAt = new Date();
    }
  }

  if (patch.schema !== undefined) {
    if (!isV1FormTemplate(patch.schema)) {
      throw new FormServiceError('schema must be a v1 FormTemplate');
    }
    data.schema = patch.schema as unknown as Prisma.InputJsonValue;
  }

  if (patch.redirectUrl !== undefined) {
    if (patch.redirectUrl !== null && typeof patch.redirectUrl !== 'string') {
      throw new FormServiceError('redirectUrl must be a string or null');
    }
    const value = typeof patch.redirectUrl === 'string' ? patch.redirectUrl.trim() : '';
    if (value && !/^https?:\/\//i.test(value)) {
      throw new FormServiceError('redirectUrl must start with http:// or https://');
    }
    data.redirectUrl = value || null;
  }

  if (patch.successMessage !== undefined) {
    if (patch.successMessage !== null && typeof patch.successMessage !== 'string') {
      throw new FormServiceError('successMessage must be a string or null');
    }
    const value =
      typeof patch.successMessage === 'string'
        ? patch.successMessage.trim()
        : '';
    data.successMessage = value || DEFAULT_SUCCESS_MESSAGE;
  }

  if (patch.listId !== undefined) {
    if (patch.listId === null || patch.listId === '') {
      data.list = { disconnect: true };
    } else if (typeof patch.listId === 'string') {
      const list = await prisma.contactList.findUnique({
        where: { id: patch.listId },
        select: { id: true, accountKey: true },
      });
      if (!list || list.accountKey !== existing.accountKey) {
        throw new FormServiceError('listId must belong to the form account');
      }
      data.list = { connect: { id: list.id } };
    } else {
      throw new FormServiceError('listId must be a string or null');
    }
  }

  if (patch.forwardToCrm !== undefined) {
    if (typeof patch.forwardToCrm !== 'boolean') {
      throw new FormServiceError('forwardToCrm must be a boolean');
    }
    data.forwardToCrm = patch.forwardToCrm;
  }

  const updated = await prisma.form.update({ where: { id }, data });
  return toDetail(updated);
}

export async function deleteForm(id: string, accountKeys: string[] | null): Promise<void> {
  const existing = await prisma.form.findUnique({
    where: { id },
    select: { id: true, accountKey: true },
  });
  if (!existing) throw new FormServiceError('Form not found', 404);
  if (
    accountKeys &&
    accountKeys.length > 0 &&
    (existing.accountKey == null || !accountKeys.includes(existing.accountKey))
  ) {
    throw new FormServiceError('Form not found', 404);
  }
  await prisma.form.delete({ where: { id } });
}

function publicHost(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://studio.loomilm.com').replace(
    /\/+$/,
    '',
  );
}

/**
 * Returns both embed variants for a form slug.
 *
 * - `script` — recommended. Single <script> tag that injects an
 *   iframe and resizes it via postMessage as the form's content
 *   changes. Looks inline on customer sites, no CSS leakage.
 * - `iframe` — fallback. Plain iframe with fixed height for
 *   environments that strip <script> tags (locked-down CMSes,
 *   email signature blocks, etc.).
 */
export function getEmbedSnippets(slug: string): FormEmbedSnippets {
  const host = publicHost();
  return {
    script: `<script src="${host}/loomi-form.js" data-form="${slug}" async></script>`,
    iframe: `<iframe src="${host}/f/${slug}?embed=1" width="100%" height="600" style="border:0;display:block;width:100%;" loading="lazy"></iframe>`,
    publicUrl: `${host}/f/${slug}`,
  };
}

/** Back-compat — returns the recommended (script) snippet. */
export function getEmbedSnippet(slug: string): string {
  return getEmbedSnippets(slug).script;
}

export async function listFormSubmissions(options: {
  formId: string;
  accountKeys: string[] | null;
  page?: number;
  pageSize?: number;
}): Promise<{
  submissions: FormSubmissionRow[];
  page: number;
  pageSize: number;
  total: number;
}> {
  const form = await prisma.form.findUnique({
    where: { id: options.formId },
    select: { id: true, accountKey: true },
  });
  if (!form) throw new FormServiceError('Form not found', 404);
  if (
    options.accountKeys &&
    options.accountKeys.length > 0 &&
    (form.accountKey == null || !options.accountKeys.includes(form.accountKey))
  ) {
    throw new FormServiceError('Form not found', 404);
  }

  const page = clampPage(options.page);
  const pageSize = clampPageSize(options.pageSize);
  const [rows, total] = await Promise.all([
    prisma.formSubmission.findMany({
      where: { formId: options.formId },
      include: {
        contact: {
          select: { id: true, email: true, phone: true, fullName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.formSubmission.count({ where: { formId: options.formId } }),
  ]);

  return {
    submissions: rows.map((row) => ({
      id: row.id,
      formId: row.formId,
      contactId: row.contactId ?? '',
      contact: row.contact
        ? {
            id: row.contact.id,
            email: row.contact.email ?? '',
            phone: row.contact.phone ?? '',
            fullName: row.contact.fullName ?? '',
          }
        : null,
      data: parseJsonObject(row.data),
      ipAddress: row.ipAddress ?? '',
      userAgent: row.userAgent ?? '',
      referrer: row.referrer ?? '',
      createdAt: row.createdAt.toISOString(),
    })),
    page,
    pageSize,
    total,
  };
}
