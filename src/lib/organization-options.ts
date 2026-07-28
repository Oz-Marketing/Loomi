import { selectableParentKeys, type AccountEdge } from '@/lib/account-hierarchy';

/**
 * Options for the "Organization" dropdown, shared by the two places an account
 * can be edited: the agency-side editor (`/settings/subaccounts/<key>`) and the
 * in-account one (`/settings?tab=subaccount`). They drifted once already —
 * only the second had the field at all — so the option list lives here rather
 * than in either page.
 *
 * Takes the account map straight off `useAccount()`. Sorted by display name,
 * with self and descendants removed so a cycle can't be picked.
 */
export function organizationOptions(
  accounts: Record<string, { dealer?: string | null; parentAccountKey?: string | null }>,
  accountKey: string | null | undefined,
): { key: string; label: string }[] {
  if (!accountKey) return [];
  const edges: AccountEdge[] = Object.entries(accounts).map(([key, a]) => ({
    key,
    parentAccountKey: a.parentAccountKey ?? null,
  }));
  return selectableParentKeys(edges, accountKey)
    .map((key) => ({ key, label: accounts[key]?.dealer || key }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** How many accounts roll up to `accountKey` — i.e. is it an Organization? */
export function subAccountCount(
  accounts: Record<string, { parentAccountKey?: string | null }>,
  accountKey: string | null | undefined,
): number {
  if (!accountKey) return 0;
  return Object.values(accounts).filter((a) => a.parentAccountKey === accountKey).length;
}
