import { BudgetHub } from '../_components/budget-hub';

/**
 * Budget hub — a client's media budget for one year at a high level, and the
 * place it gets distributed from. See docs/budget-module.md.
 *
 * The account comes from the global switcher via AccountContext, so this is a
 * plain shell; everything (account, year, grid, mutations) lives client-side.
 */
export default function BudgetHubPage() {
  return <BudgetHub />;
}
