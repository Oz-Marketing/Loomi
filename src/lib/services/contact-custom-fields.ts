// Contact custom field service.
//
// Backs the admin "Blueprints" surface and the sub-account "Custom
// Fields" surface. A single Prisma model (ContactCustomField) plays
// both roles: rows with accountKey=null are admin blueprints, rows
// with a set accountKey are sub-account-owned instances. Deploying
// a blueprint duplicates the row into the target sub-account with
// parentBlueprintId set and lastSyncedAt stamped to "now".
//
// This file owns:
//   - shape validation (key format, type whitelist, options shape)
//   - blueprint CRUD + deploy + bulk-by-industry-tag
//   - instance CRUD + sync-from-blueprint
//   - "updates available" detection (parent.updatedAt > instance.lastSyncedAt)
//
// What it does NOT do:
//   - rewrite Contact.customFields when a field is renamed or deleted
//     (orphan keys are harmless — the filter engine just ignores them)
//   - participate in the filter engine wiring (that's Sprint B)

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { CONTACT_FIELDS } from '@/lib/contacts/normalize';
import {
  CUSTOM_FIELD_TYPES,
  normalizeKey as normalizeKeyImpl,
  type CreateFieldInput,
  type CustomFieldDto,
  type CustomFieldOption,
  type CustomFieldType,
  type UpdateFieldInput,
} from '@/lib/contacts/custom-field-types';

// Re-export the client-safe surface for server callers — keeps a single
// import path for `@/lib/services/contact-custom-fields` while letting
// client code import directly from the types module without dragging
// Prisma into the browser bundle.
export {
  CUSTOM_FIELD_TYPES,
  type CreateFieldInput,
  type CustomFieldDto,
  type CustomFieldOption,
  type CustomFieldType,
  type UpdateFieldInput,
} from '@/lib/contacts/custom-field-types';
export type { BulkDeployResult } from '@/lib/contacts/custom-field-types';

// ── Validation ───────────────────────────────────────────────────

export class CustomFieldValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'CustomFieldValidationError';
  }
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;

// Reserved against the canonical Contact column names + a couple of
// implementation-only sentinels. Block these so a custom field key
// never shadows a real column in the filter UI.
const RESERVED_KEYS: ReadonlySet<string> = new Set<string>([
  ...CONTACT_FIELDS,
  'id',
  'accountKey',
  'createdAt',
  'updatedAt',
  'customFields',
  'dnd',
  // Materialised messaging flags from FILTERABLE_FIELDS.
  'hasReceivedMessage',
  'hasReceivedEmail',
  'hasReceivedSms',
  'hasOpenedEmail',
  'hasClickedEmail',
  'lastMessageDate',
]);

/** Re-export of the pure normalizer for server callers that still
 *  import it from this module. The implementation lives in the
 *  client-safe types file. */
export const normalizeKey = normalizeKeyImpl;

export function validateKey(key: string): void {
  if (!key) throw new CustomFieldValidationError('Key is required', 'key');
  if (!KEY_PATTERN.test(key)) {
    throw new CustomFieldValidationError(
      'Key must start with a letter and contain only lowercase letters, digits, and underscores (max 50 chars)',
      'key',
    );
  }
  if (RESERVED_KEYS.has(key)) {
    throw new CustomFieldValidationError(
      `"${key}" is a reserved field name — pick something else`,
      'key',
    );
  }
}

function validateType(type: string): asserts type is CustomFieldType {
  if (!CUSTOM_FIELD_TYPES.includes(type as CustomFieldType)) {
    throw new CustomFieldValidationError(
      `Type must be one of: ${CUSTOM_FIELD_TYPES.join(', ')}`,
      'type',
    );
  }
}

function validateOptions(
  type: CustomFieldType,
  options: CustomFieldOption[] | null | undefined,
): CustomFieldOption[] | null {
  const isSelectish = type === 'select' || type === 'multiselect';
  if (!isSelectish) return null;
  if (!options || options.length === 0) {
    throw new CustomFieldValidationError(
      `${type} fields require at least one option`,
      'options',
    );
  }
  const seen = new Set<string>();
  for (const opt of options) {
    if (!opt || typeof opt.value !== 'string' || typeof opt.label !== 'string') {
      throw new CustomFieldValidationError(
        'Each option must have a string value and label',
        'options',
      );
    }
    if (!opt.value.trim() || !opt.label.trim()) {
      throw new CustomFieldValidationError(
        'Option value and label cannot be empty',
        'options',
      );
    }
    if (seen.has(opt.value)) {
      throw new CustomFieldValidationError(
        `Duplicate option value: "${opt.value}"`,
        'options',
      );
    }
    seen.add(opt.value);
  }
  return options;
}

function validateCsvAliases(aliases: string[] | undefined): string[] {
  if (!aliases) return [];
  if (!Array.isArray(aliases)) {
    throw new CustomFieldValidationError(
      'csvAliases must be an array of strings',
      'csvAliases',
    );
  }
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const a of aliases) {
    if (typeof a !== 'string') continue;
    const trimmed = a.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    cleaned.push(trimmed);
  }
  return cleaned;
}

// ── Serialisation ────────────────────────────────────────────────

// We accept either a row fetched via findUnique/findMany with the
// parentBlueprint include OR a row that came back from create/update
// (Prisma 7's create-with-include result type doesn't always satisfy
// the GetPayload shape). The optional parentBlueprint covers both.
type Row = Prisma.ContactCustomFieldGetPayload<Record<string, never>> & {
  parentBlueprint?: { updatedAt: Date } | null;
};

function toDto(row: Row): CustomFieldDto {
  const opts = row.options;
  const aliases = row.csvAliases;
  const parentUpdatedAt = row.parentBlueprint?.updatedAt ?? null;
  const hasUpdate =
    !!parentUpdatedAt &&
    !!row.lastSyncedAt &&
    parentUpdatedAt.getTime() > row.lastSyncedAt.getTime();

  return {
    id: row.id,
    accountKey: row.accountKey,
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type as CustomFieldType,
    options: Array.isArray(opts) ? (opts as unknown as CustomFieldOption[]) : null,
    category: row.category,
    isPii: row.isPii,
    sortOrder: row.sortOrder,
    parentBlueprintId: row.parentBlueprintId,
    hasUpdate,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    industryTag: row.industryTag,
    csvAliases: Array.isArray(aliases) ? (aliases as string[]) : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Reads ────────────────────────────────────────────────────────

/** Sub-account-scoped: all custom fields owned by this account. */
export async function listFieldsForAccount(
  accountKey: string,
): Promise<CustomFieldDto[]> {
  const rows = await prisma.contactCustomField.findMany({
    where: { accountKey },
    include: { parentBlueprint: { select: { updatedAt: true } } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toDto);
}

/** Admin-scoped: all blueprints (rows where accountKey=null). */
export async function listBlueprints(): Promise<CustomFieldDto[]> {
  const rows = await prisma.contactCustomField.findMany({
    where: { accountKey: null },
    include: { parentBlueprint: { select: { updatedAt: true } } },
    orderBy: [
      { industryTag: 'asc' },
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ],
  });
  return rows.map(toDto);
}

/** Per-blueprint adoption count for the admin list. */
export async function getBlueprintAdoption(
  blueprintIds: string[],
): Promise<Map<string, { total: number; stale: number }>> {
  if (blueprintIds.length === 0) return new Map();
  const rows = await prisma.contactCustomField.findMany({
    where: { parentBlueprintId: { in: blueprintIds } },
    include: { parentBlueprint: { select: { updatedAt: true } } },
  });
  const out = new Map<string, { total: number; stale: number }>();
  for (const id of blueprintIds) out.set(id, { total: 0, stale: 0 });
  for (const row of rows) {
    if (!row.parentBlueprintId) continue;
    const bucket = out.get(row.parentBlueprintId);
    if (!bucket) continue;
    bucket.total += 1;
    const parentUpdatedAt = row.parentBlueprint?.updatedAt;
    if (
      parentUpdatedAt &&
      row.lastSyncedAt &&
      parentUpdatedAt.getTime() > row.lastSyncedAt.getTime()
    ) {
      bucket.stale += 1;
    }
  }
  return out;
}

// ── Writes ───────────────────────────────────────────────────────

/** Create a blueprint (accountKey=null) or a sub-account-owned field. */
export async function createField(input: CreateFieldInput): Promise<CustomFieldDto> {
  const key = normalizeKey(input.key);
  validateKey(key);
  validateType(input.type);
  const options = validateOptions(input.type, input.options ?? null);
  const csvAliases = validateCsvAliases(input.csvAliases);

  // Uniqueness check at the API layer because Postgres treats NULL as
  // distinct in unique constraints — without this, two blueprints could
  // share a key.
  const existing = await prisma.contactCustomField.findFirst({
    where: { accountKey: input.accountKey, key },
    select: { id: true },
  });
  if (existing) {
    throw new CustomFieldValidationError(
      input.accountKey
        ? `A custom field with key "${key}" already exists on this sub-account`
        : `A blueprint with key "${key}" already exists`,
      'key',
    );
  }

  const row = await prisma.contactCustomField.create({
    data: {
      accountKey: input.accountKey,
      key,
      label: input.label.trim(),
      description: input.description?.trim() || null,
      type: input.type,
      options: options ? (options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      category: input.category?.trim() || null,
      isPii: input.isPii ?? false,
      sortOrder: input.sortOrder ?? 0,
      industryTag: input.industryTag?.trim() || null,
      csvAliases: csvAliases as unknown as Prisma.InputJsonValue,
    },
    include: { parentBlueprint: { select: { updatedAt: true } } },
  });
  return toDto(row);
}

export async function updateField(
  id: string,
  input: UpdateFieldInput,
): Promise<CustomFieldDto> {
  if (input.type) validateType(input.type);
  const data: Prisma.ContactCustomFieldUpdateInput = {};
  if (input.label !== undefined) data.label = input.label.trim();
  if (input.description !== undefined)
    data.description = input.description?.trim() || null;
  if (input.type !== undefined) data.type = input.type;
  if (input.options !== undefined) {
    // Need the (possibly new) type to validate options; fall back to
    // the persisted type when the caller didn't pass one.
    const targetType = input.type
      ? input.type
      : ((await prisma.contactCustomField.findUnique({
          where: { id },
          select: { type: true },
        }))?.type as CustomFieldType | undefined);
    if (!targetType) {
      throw new CustomFieldValidationError('Field not found', 'id');
    }
    const opts = validateOptions(targetType, input.options);
    data.options = opts ? (opts as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
  } else if (input.type !== undefined) {
    // Type changed but options omitted — clear options unless still
    // selectish.
    if (input.type !== 'select' && input.type !== 'multiselect') {
      data.options = Prisma.DbNull;
    }
  }
  if (input.category !== undefined)
    data.category = input.category?.trim() || null;
  if (input.isPii !== undefined) data.isPii = input.isPii;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.industryTag !== undefined)
    data.industryTag = input.industryTag?.trim() || null;
  if (input.csvAliases !== undefined) {
    data.csvAliases = validateCsvAliases(input.csvAliases) as unknown as Prisma.InputJsonValue;
  }

  const row = await prisma.contactCustomField.update({
    where: { id },
    data,
    include: { parentBlueprint: { select: { updatedAt: true } } },
  });
  return toDto(row);
}

export async function deleteField(id: string): Promise<void> {
  await prisma.contactCustomField.delete({ where: { id } });
}

// ── Blueprint deployment ─────────────────────────────────────────

/**
 * Copy a blueprint into the given sub-account, creating a new
 * instance row with parentBlueprintId set. Idempotent per
 * (blueprintId, accountKey): if the sub-account already has an
 * instance of this blueprint, returns the existing row unchanged.
 *
 * Throws CustomFieldValidationError when the sub-account has a
 * non-blueprint field with the same key (won't auto-merge).
 */
export async function deployBlueprintToAccount(
  blueprintId: string,
  accountKey: string,
): Promise<CustomFieldDto> {
  const blueprint = await prisma.contactCustomField.findUnique({
    where: { id: blueprintId },
  });
  if (!blueprint || blueprint.accountKey !== null) {
    throw new CustomFieldValidationError('Blueprint not found', 'blueprintId');
  }

  // Already deployed? Return existing.
  const existing = await prisma.contactCustomField.findFirst({
    where: { accountKey, parentBlueprintId: blueprintId },
    include: { parentBlueprint: { select: { updatedAt: true } } },
  });
  if (existing) return toDto(existing);

  // Key collision with a standalone field on this sub-account?
  const collision = await prisma.contactCustomField.findFirst({
    where: { accountKey, key: blueprint.key },
    select: { id: true },
  });
  if (collision) {
    throw new CustomFieldValidationError(
      `Sub-account already has a field with key "${blueprint.key}". Delete or rename it before deploying the blueprint.`,
      'key',
    );
  }

  const row = await prisma.contactCustomField.create({
    data: {
      accountKey,
      key: blueprint.key,
      label: blueprint.label,
      description: blueprint.description,
      type: blueprint.type,
      options:
        blueprint.options == null
          ? Prisma.DbNull
          : (blueprint.options as unknown as Prisma.InputJsonValue),
      category: blueprint.category,
      isPii: blueprint.isPii,
      sortOrder: blueprint.sortOrder,
      industryTag: blueprint.industryTag,
      csvAliases: blueprint.csvAliases as unknown as Prisma.InputJsonValue,
      parentBlueprintId: blueprint.id,
      lastSyncedAt: new Date(),
    },
    include: { parentBlueprint: { select: { updatedAt: true } } },
  });
  return toDto(row);
}

/** Deploy a blueprint to many sub-accounts in one call. */
export async function deployBlueprintToAccounts(
  blueprintId: string,
  accountKeys: string[],
): Promise<import('@/lib/contacts/custom-field-types').BulkDeployResult> {
  const result: import('@/lib/contacts/custom-field-types').BulkDeployResult = {
    deployed: 0,
    skipped: 0,
    errors: [],
  };
  for (const accountKey of accountKeys) {
    try {
      const existing = await prisma.contactCustomField.findFirst({
        where: { accountKey, parentBlueprintId: blueprintId },
        select: { id: true },
      });
      if (existing) {
        result.skipped += 1;
        continue;
      }
      await deployBlueprintToAccount(blueprintId, accountKey);
      result.deployed += 1;
    } catch (err) {
      result.errors.push({
        accountKey,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
  return result;
}

/**
 * Bulk-apply: deploy every blueprint tagged with `industryTag` to
 * every sub-account whose Account.category matches `industryTag`.
 * Skips deployments that already exist. Used by the admin "Apply
 * Automotive defaults to all Automotive sub-accounts" action.
 */
export async function applyIndustryBlueprintsToMatchingAccounts(
  industryTag: string,
): Promise<{
  blueprintCount: number;
  accountCount: number;
  deployed: number;
  skipped: number;
  errors: { accountKey: string; blueprintId: string; reason: string }[];
}> {
  const blueprints = await prisma.contactCustomField.findMany({
    where: { accountKey: null, industryTag },
    select: { id: true },
  });
  const accounts = await prisma.account.findMany({
    where: { category: industryTag },
    select: { key: true },
  });

  const out = {
    blueprintCount: blueprints.length,
    accountCount: accounts.length,
    deployed: 0,
    skipped: 0,
    errors: [] as { accountKey: string; blueprintId: string; reason: string }[],
  };

  for (const bp of blueprints) {
    for (const acct of accounts) {
      try {
        const existing = await prisma.contactCustomField.findFirst({
          where: { accountKey: acct.key, parentBlueprintId: bp.id },
          select: { id: true },
        });
        if (existing) {
          out.skipped += 1;
          continue;
        }
        await deployBlueprintToAccount(bp.id, acct.key);
        out.deployed += 1;
      } catch (err) {
        out.errors.push({
          accountKey: acct.key,
          blueprintId: bp.id,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  return out;
}

/**
 * Refresh an instance from its parent blueprint. Copies
 * label/description/type/options/category/isPii/industryTag/csvAliases
 * and stamps lastSyncedAt. Leaves sortOrder alone (sub-account UX
 * may have reordered fields locally).
 *
 * Type changes are propagated even though they may invalidate
 * existing values on contacts — the filter engine just stops matching
 * orphaned values, no data loss.
 */
export async function syncFieldFromBlueprint(
  id: string,
): Promise<CustomFieldDto> {
  const row = await prisma.contactCustomField.findUnique({
    where: { id },
    include: { parentBlueprint: true },
  });
  if (!row) {
    throw new CustomFieldValidationError('Field not found', 'id');
  }
  if (!row.parentBlueprint) {
    throw new CustomFieldValidationError(
      'Field is not derived from a blueprint',
      'parentBlueprintId',
    );
  }
  const bp = row.parentBlueprint;
  const updated = await prisma.contactCustomField.update({
    where: { id },
    data: {
      label: bp.label,
      description: bp.description,
      type: bp.type,
      options:
        bp.options == null
          ? Prisma.DbNull
          : (bp.options as unknown as Prisma.InputJsonValue),
      category: bp.category,
      isPii: bp.isPii,
      industryTag: bp.industryTag,
      csvAliases: bp.csvAliases as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    },
    include: { parentBlueprint: { select: { updatedAt: true } } },
  });
  return toDto(updated);
}
