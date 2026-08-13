'use client';

/**
 * The size library, for any picker that needs it.
 *
 * One hook so every surface (the library page, the from-scratch modal, the
 * builder's Sizes panel) shows the SAME list — the bug this replaces was three
 * surfaces each deciding for themselves which sizes existed. SWR de-dupes the
 * request and revalidates after a mutation, so a size added in the builder is
 * there the next time the modal opens.
 */
import useSWR from 'swr';
import { tagFacets, type LibrarySize } from './ad-size-library';

const SIZES_URL = '/api/ad-generator/sizes';

const fetcher = async (url: string): Promise<{ sizes: LibrarySize[]; tags: string[] }> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const json = await res.json();
  return { sizes: json.sizes ?? [], tags: json.tags ?? [] };
};

export function useSizeLibrary() {
  const { data, error, isLoading, mutate } = useSWR(SIZES_URL, fetcher, {
    revalidateOnFocus: false,
  });
  const sizes = data?.sizes ?? [];
  return {
    sizes,
    /** Tag vocabulary in use, with counts — the filter chips render from this. */
    facets: tagFacets(sizes),
    /** Every tag name in use (no counts), for tag editors' suggestions. */
    allTags: data?.tags ?? [],
    /** True only before the first response — an empty library isn't loading. */
    loading: isLoading && !data,
    error,
    reload: mutate,
  };
}
