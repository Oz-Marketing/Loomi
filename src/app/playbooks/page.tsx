import { notFound } from 'next/navigation';
import { playbooksAllowed } from '@/lib/playbooks/access';
import { PlaybookAudit } from './_components/playbook-audit';

/**
 * Playbooks — Phase 0 coverage audit (docs/playbooks.md).
 *
 * Server gate only; the matrix itself is fetched client-side. The gate runs
 * server-side so a direct URL can't reach a screen that enumerates every
 * account's configuration when the nav link is hidden.
 */
export default async function PlaybooksPage() {
  if (!(await playbooksAllowed())) notFound();
  return <PlaybookAudit />;
}
