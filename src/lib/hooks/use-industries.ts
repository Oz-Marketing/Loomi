'use client';

import useSWR from 'swr';
import { DEFAULT_INDUSTRIES } from '@/data/industry-defaults';

const fetcher = async (url: string): Promise<string[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const data = (await res.json()) as { industries?: unknown };
  return Array.isArray(data.industries) ? (data.industries.filter((x) => typeof x === 'string') as string[]) : [];
};

/**
 * The effective account "Industry" option list for dropdowns, from
 * /api/industries (AppSetting-backed). Falls back to DEFAULT_INDUSTRIES while
 * loading or on error so a dropdown is never empty. Managed via the Industries
 * settings tab.
 */
export function useIndustries(): string[] {
  const { data } = useSWR<string[]>('/api/industries', fetcher, {
    revalidateOnFocus: false,
  });
  return data && data.length ? data : DEFAULT_INDUSTRIES;
}
