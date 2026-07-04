/**
 * Migrate legacy LP templates (`AccountLandingPageTemplate` snapshots) into the
 * unified model: `LandingPage` rows with `isTemplate=true`, which the Templates →
 * Landing Pages tab now shows and the LP builder edits in place.
 *
 * Idempotent: each new row gets a deterministic slug `lp-tmpl-<sourceId>`, so a
 * re-run skips anything already migrated. Runs AFTER `prisma db push` in the
 * deploy (it writes the new LandingPage.category/tags columns). Leaves the source
 * rows untouched — a later cleanup can drop the retired table.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  let sources: { id: string; accountKey: string; name: string; schema: unknown; category: string | null; tags: string | null; status: string; publishedAt: Date | null; createdByUserId: string | null }[];
  try {
    sources = (await prisma.accountLandingPageTemplate.findMany()) as never;
  } catch {
    // Table already dropped / not present in this environment — nothing to do.
    console.log('[migrate-lp-templates] no AccountLandingPageTemplate table; skipping');
    return;
  }

  let created = 0;
  let skipped = 0;
  for (const src of sources) {
    const slug = `lp-tmpl-${src.id}`;
    const exists = await prisma.landingPage.findUnique({ where: { slug }, select: { id: true } });
    if (exists) { skipped += 1; continue; }
    await prisma.landingPage.create({
      data: {
        accountKey: src.accountKey,
        name: src.name,
        slug,
        isTemplate: true,
        status: src.status === 'draft' ? 'draft' : 'published',
        schema: src.schema as never,
        category: src.category ?? null,
        tags: src.tags ?? null,
        createdByUserId: src.createdByUserId ?? null,
        publishedAt: src.publishedAt ?? new Date(),
      },
    });
    created += 1;
  }
  console.log(`[migrate-lp-templates] created ${created}, skipped ${skipped} (already migrated)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[migrate-lp-templates] failed', e);
    process.exit(1);
  });
