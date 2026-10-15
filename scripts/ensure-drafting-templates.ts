/**
 * Seed the shared starter drafting template for every request type
 * (docs/email-drafting.md §4.1), so the template library shows them before the
 * first draft runs. Create-only and idempotent: a starter someone restyled is
 * never touched. The drafter also does this itself before each draft.
 *
 *   npx tsx --env-file=.env.local scripts/ensure-drafting-templates.ts
 */
import { prisma } from '../src/lib/prisma';
import { ensureStarterTemplates } from '../src/lib/drafting/drafting-templates';

ensureStarterTemplates()
  .then((made) => console.log(made ? `Created ${made} starter drafting template(s).` : 'Every request type already has its starter.'))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
