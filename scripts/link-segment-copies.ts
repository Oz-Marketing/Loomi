/**
 * Link existing per-account segment copies back to their group original.
 *
 * WHY THIS EXISTS. "Also create in…" makes one independent segment per
 * account and records the original in `Audience.sourceAudienceId`, which is
 * what lets the original's editor offer "push these changes to the copies"
 * after a save. Copies made before that link was written (Young Automotive
 * Group's "All Sales & Service", fanned out to 36 rooftops on 2026-10-13)
 * have it null, so saving at the group changes the group alone and nothing
 * says so.
 *
 * This sets `sourceAudienceId` and NOTHING else — no filter, name or
 * description is touched. A copy whose definition drifted is still linked;
 * it shows as "Out of date" and is only rewritten if someone pushes.
 * Candidates are same-named, unlinked segments in accounts BELOW the
 * source's account (planRelink in src/lib/segments/relink.ts). Idempotent:
 * a re-run reports every copy as already linked.
 *
 * Dry run by default:
 *   npx tsx --env-file=.env.local scripts/link-segment-copies.ts --source <audienceId>
 *   npx tsx --env-file=.env.local scripts/link-segment-copies.ts --source <audienceId> --apply
 *
 * On a droplet, export DATABASE_URL from the running app process — never from a
 * file (CLAUDE.md, "Database and deploy-time scripts") — then run the same command
 * from /var/www/loomi-studio/current, without --env-file.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { expandWithDescendants } from '../src/lib/account-hierarchy';
import { planRelink } from '../src/lib/segments/relink';

const apply = process.argv.includes('--apply');
const sourceFlag = process.argv.indexOf('--source');
const sourceId = sourceFlag >= 0 ? process.argv[sourceFlag + 1] : undefined;

const SELECT = {
  id: true,
  name: true,
  description: true,
  filters: true,
  icon: true,
  color: true,
  accountKey: true,
  sourceAudienceId: true,
} as const;

async function main() {
  if (!sourceId || sourceId.startsWith('--')) {
    console.error('Usage: link-segment-copies.ts --source <audienceId> [--apply]');
    process.exitCode = 1;
    return;
  }

  const source = await prisma.audience.findUnique({ where: { id: sourceId }, select: SELECT });
  if (!source) {
    console.error(`No segment with id ${sourceId}.`);
    process.exitCode = 1;
    return;
  }
  if (!source.accountKey) {
    console.error(`"${source.name}" is org-wide; it has no accounts below it to have copies in.`);
    process.exitCode = 1;
    return;
  }
  if (source.sourceAudienceId) {
    console.error(`"${source.name}" is itself a copy (of ${source.sourceAudienceId}); pass the original.`);
    process.exitCode = 1;
    return;
  }

  const edges = await prisma.account.findMany({ select: { key: true, parentAccountKey: true } });
  const descendantKeys = expandWithDescendants(edges, [source.accountKey]).filter(
    (k) => k !== source.accountKey,
  );
  const candidates = await prisma.audience.findMany({
    where: { name: source.name },
    select: SELECT,
    orderBy: { accountKey: 'asc' },
  });

  const plan = planRelink({ source, candidates, descendantKeys });

  console.log(`Source: "${source.name}" (${source.id}) on ${source.accountKey}`);
  console.log(`Accounts below it: ${descendantKeys.length}`);
  for (const { segment, reason } of plan.skipped) {
    console.log(`  skip  ${segment.accountKey ?? '(org-wide)'}  ${segment.id}  — ${reason}`);
  }
  const matching = new Set(plan.matching.map((s) => s.id));
  for (const seg of plan.link) {
    console.log(`  link  ${seg.accountKey}  ${seg.id}${matching.has(seg.id) ? '' : '  (definition differs — will show Out of date)'}`);
  }
  console.log(
    `${plan.link.length} to link (${plan.matching.length} up to date), ${plan.skipped.length} skipped.`,
  );

  if (plan.link.length === 0) return;
  if (!apply) {
    console.log('Dry run — re-run with --apply to write.');
    return;
  }

  // One statement, and re-checks the null so a copy linked between the read
  // and the write is never re-pointed.
  const linkIds = plan.link.map((s) => s.id);
  const updated = await prisma.$executeRaw(Prisma.sql`
    UPDATE "Audience"
    SET "sourceAudienceId" = ${source.id}
    WHERE "id" IN (${Prisma.join(linkIds)})
      AND "sourceAudienceId" IS NULL
  `);
  console.log(`Linked ${updated}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
