// Client-safe types + constants for contact custom fields.
//
// Lives outside `src/lib/services/` so client components can import
// CUSTOM_FIELD_TYPES, CustomFieldDto, etc. without dragging Prisma —
// and its Node-only deps like `dns` — into the browser bundle. The
// runtime DB-aware functions live in `src/lib/services/contact-custom-fields.ts`,
// which re-exports these for server callers.

export type CustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'select'
  | 'multiselect';

export const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multiselect',
] as const;

export interface CustomFieldOption {
  value: string;
  label: string;
}

export interface CustomFieldDto {
  id: string;
  accountKey: string | null;
  key: string;
  label: string;
  description: string | null;
  type: CustomFieldType;
  options: CustomFieldOption[] | null;
  category: string | null;
  isPii: boolean;
  sortOrder: number;
  parentBlueprintId: string | null;
  /** True when this instance's parent blueprint has changed since
   *  the last sync. Always false for blueprints + standalone fields. */
  hasUpdate: boolean;
  /** ISO string when this instance was last synced from its parent
   *  blueprint. Null on blueprints + standalone fields. */
  lastSyncedAt: string | null;
  industryTag: string | null;
  csvAliases: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateFieldInput {
  /** Null when creating a blueprint, set when creating a sub-account
   *  field. The API layer enforces role gating. */
  accountKey: string | null;
  key: string;
  label: string;
  description?: string | null;
  type: CustomFieldType;
  options?: CustomFieldOption[] | null;
  category?: string | null;
  isPii?: boolean;
  sortOrder?: number;
  industryTag?: string | null;
  csvAliases?: string[];
}

export interface UpdateFieldInput {
  label?: string;
  description?: string | null;
  type?: CustomFieldType;
  options?: CustomFieldOption[] | null;
  category?: string | null;
  isPii?: boolean;
  sortOrder?: number;
  industryTag?: string | null;
  csvAliases?: string[];
}

export interface BulkDeployResult {
  deployed: number;
  skipped: number;
  errors: { accountKey: string; reason: string }[];
}

/** Pure client-safe key normalizer. Mirrors the server-side rule but
 *  doesn't throw — call sites can preview the derived key live. */
export function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}
