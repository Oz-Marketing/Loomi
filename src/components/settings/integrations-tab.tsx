'use client';

import { useAccount } from '@/contexts/account-context';
import { ReportingIntegrationCards } from '@/components/reporting-integration-cards';

// ════════════════════════════════════════
// Integrations Tab (account-scoped)
// ════════════════════════════════════════
export function IntegrationsTab() {
  const { accountKey } = useAccount();
  if (!accountKey) {
    return <div className="text-[var(--muted-foreground)]">Select an account to manage its integrations.</div>;
  }
  // ReportingIntegrationCards renders bare card buttons (no wrapper) — give them
  // a responsive grid so they don't flow inline and wrap unevenly.
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <ReportingIntegrationCards accountKey={accountKey} />
    </div>
  );
}
