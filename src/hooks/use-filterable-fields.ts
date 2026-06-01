'use client';

// SWR-backed hook that returns the merged set of filter-builder fields
// for a given sub-account: the static built-ins (FILTERABLE_FIELDS)
// plus that account's declared custom fields.
//
// Pass `null` / `undefined` for `accountKey` to get the built-ins only
// (e.g. admin-mode views that span multiple accounts and can't pick a
// single account's customs).
//
// Cached per-account by SWR's key, so multiple consumers on the same
// page share a single fetch.

import useSWR from 'swr';
import {
  FILTERABLE_FIELDS,
  getFilterableFields,
  type FieldDefinition,
  type FilterableCustomField,
} from '@/lib/smart-list-types';
import type { CustomFieldDto } from '@/lib/contacts/custom-field-types';

const fetcher = async (url: string): Promise<CustomFieldDto[]> => {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as {
    fields?: CustomFieldDto[];
  };
  return Array.isArray(data.fields) ? data.fields : [];
};

export interface UseFilterableFieldsResult {
  fields: FieldDefinition[];
  /** True until the first network request resolves (or skipped when no
   *  accountKey is provided). */
  isLoading: boolean;
  /** True when SWR is revalidating in the background. */
  isValidating: boolean;
  /** Raw custom-field rows from the API, for callers that need more
   *  than the filter-engine subset (e.g. detail-page renderers). */
  customFields: CustomFieldDto[];
}

export function useFilterableFields(
  accountKey: string | null | undefined,
): UseFilterableFieldsResult {
  const swrKey = accountKey
    ? `/api/contact-custom-fields?accountKey=${encodeURIComponent(accountKey)}`
    : null;

  const { data, isLoading, isValidating } = useSWR<CustomFieldDto[]>(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: false,
      // Custom fields rarely change; a 60s dedupe avoids hammering
      // the API as several consumers mount simultaneously.
      dedupingInterval: 60_000,
    },
  );

  if (!accountKey) {
    return {
      fields: FILTERABLE_FIELDS,
      isLoading: false,
      isValidating: false,
      customFields: [],
    };
  }

  const customFields = data ?? [];
  const merged = getFilterableFields(
    customFields.map<FilterableCustomField>((cf) => ({
      key: cf.key,
      label: cf.label,
      type: cf.type,
      category: cf.category,
      options: cf.options,
    })),
  );

  return {
    fields: merged,
    isLoading,
    isValidating,
    customFields,
  };
}
