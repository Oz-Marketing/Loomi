'use client';

import useSWR from 'swr';
import { jsonFetcher } from './fetcher';

export type AccountLogos = { light?: string; dark?: string; white?: string; black?: string } | null;

export type ProjectOptions = {
  accounts: { key: string; dealer: string; slug: string | null; logos: AccountLogos }[];
  teams: { key: string; name: string; color: string | null }[];
  users: { id: string; name: string; email: string; avatarUrl: string | null; department: string | null }[];
};

export function useProjectOptions() {
  const { data } = useSWR<ProjectOptions>('/api/projects/options', jsonFetcher, {
    revalidateOnFocus: false,
  });
  return data;
}
