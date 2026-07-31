import { cookies } from 'next/headers';
import { getAuthSession, getAccountScope, canAccessAccount } from '@/lib/api-auth';
import { ACTIVE_ACCOUNT_COOKIE, ADMIN_VALUE } from '@/lib/active-account';
import { BudgetHub } from '../_components/budget-hub';

/**
 * Budget hub — a client's media budget for one year at a high level, and the
 * place it gets distributed from. See docs/budget-module.md.
 *
 * Server shell only: it resolves the initially-selected account from the shared
 * active-account cookie (same pattern as the initiatives page) and hands off to
 * the client component, which owns the year, the grid, and every mutation.
 */
export default async function BudgetHubPage() {
  const session = await getAuthSession();
  const scope = session ? getAccountScope(session) : [];

  const activeRaw = (await cookies()).get(ACTIVE_ACCOUNT_COOKIE)?.value ?? null;
  const initialAccountKey =
    activeRaw && activeRaw !== ADMIN_VALUE && canAccessAccount(scope, activeRaw)
      ? activeRaw
      : null;

  return <BudgetHub initialAccountKey={initialAccountKey} />;
}
