/**
 * Strip Python's inline `(?i)` from co-op rule patterns stored in this environment.
 *
 * WHY THIS EXISTS. A drafted rule could carry a pattern like `(?i)political|…`.
 * JavaScript can't compile it, so `matcher()` gave up on the rule and a
 * `banned_phrase` was skipped without a word: accepted or not, it never fired. New
 * drafts are fixed on the way in; this repairs what is already stored. The decision
 * is `planInlineFlagRepair` (src/lib/ad-generator/coop-pattern-repair.ts), which is
 * pure and tested. This is the DB wrapper around it.
 *
 * RE-RUNNING A SEED IS NOT THE FIX. `seed-coop-pack-*.ts` upserts the whole pack,
 * which drops every drafted rule and every review decision on them.
 *
 * It changes one key — `pattern` — and only on phrase rules whose pattern begins
 * `(?i)`. By default only PROPOSED and REJECTED rules: they evaluate as nothing, so
 * repairing them changes no ad. An ACCEPTED rule (or a hand-written one, which counts
 * as accepted) has never fired; repairing it switches it on, so it is listed and held
 * unless you pass --include-accepted. A pattern that stays invalid without `(?i)` is
 * reported and left alone.
 *
 * Each write is conditional on the text that was read, so an edit made in the review
 * queue while this runs is never written over. `updatedAt` is kept as it was:
 * loadCoopPackForReview breaks ties between active packs on it, and bumping it could
 * change which pack is in force. Cached template checks are left alone — they
 * evaluate design rules only, and phrase rules are content rules.
 *
 * Dry run by default:
 *   npx tsx --env-file=.env.local scripts/fix-coop-inline-flags.ts
 *   npx tsx --env-file=.env.local scripts/fix-coop-inline-flags.ts --apply
 * Add --make Subaru to touch one make, and --include-accepted to repair enforced
 * rules too.
 *
 * On a droplet, export DATABASE_URL from the running app process — never from a file
 * (CLAUDE.md, "Database and deploy-time scripts") — then run the same command from
 * /var/www/loomi-studio/current, without --env-file.
 */
import { prisma } from '../src/lib/prisma';
import { planInlineFlagRepair } from '../src/lib/ad-generator/coop-pattern-repair';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const includeAccepted = argv.includes('--include-accepted');
const makeAt = argv.indexOf('--make');
const onlyMake = makeAt >= 0 ? argv[makeAt + 1] : undefined;

async function main() {
  if (makeAt >= 0 && (!onlyMake || onlyMake.startsWith('--'))) {
    throw new Error('--make needs a make, e.g. --make Subaru');
  }
  const rows = await prisma.adCoopRulePack.findMany({
    where: onlyMake ? { make: { equals: onlyMake, mode: 'insensitive' } } : {},
    orderBy: [{ make: 'asc' }, { version: 'asc' }],
  });
  if (rows.length === 0) {
    console.log(onlyMake ? `No ${onlyMake} pack in this environment.` : 'No co-op packs in this environment.');
    return;
  }

  let toRepair = 0;
  let repaired = 0;
  let held = 0;
  let stillInvalid = 0;
  for (const row of rows) {
    const label = `${row.make} ${row.version}${row.isActive ? '' : ' (inactive)'}`;
    const plan = planInlineFlagRepair(row.rules, { includeAccepted });
    if (plan.unreadable) {
      console.log(`${label} — ${plan.unreadable}; left alone.`);
      continue;
    }
    if (plan.repairs.length === 0) {
      console.log(`${label} — nothing to repair.`);
      continue;
    }

    console.log(`\n${label}`);
    for (const r of plan.repairs) {
      console.log(`  ${r.ruleId}  (${r.kind}, ${r.reviewState}, ${r.severity})`);
      console.log(`    ${JSON.stringify(r.from)} → ${JSON.stringify(r.to)}`);
      if (r.action === 'held') {
        console.log(
          `    HELD — it is ${r.reviewState}, so the repaired pattern would start enforcing. Pass --include-accepted to repair it.`,
        );
      } else if (r.action === 'still_invalid') {
        console.log(`    LEFT ALONE — still invalid without (?i): ${r.problem}. Needs a person.`);
      }
    }
    const count = plan.repairs.filter((r) => r.action === 'repair').length;
    toRepair += count;
    held += plan.repairs.filter((r) => r.action === 'held').length;
    stillInvalid += plan.repairs.filter((r) => r.action === 'still_invalid').length;
    if (!apply || !plan.next) continue;

    const { count: written } = await prisma.adCoopRulePack.updateMany({
      where: { id: row.id, rules: row.rules },
      data: { rules: plan.next, updatedAt: row.updatedAt },
    });
    if (written === 1) {
      repaired += count;
      console.log(`  ✔ repaired ${count}`);
    } else {
      console.log('  ✖ the pack changed while this ran, so nothing was written — run it again');
      process.exitCode = 1;
    }
  }

  console.log('');
  if (toRepair === 0) console.log('Nothing to repair.');
  else if (apply) console.log(`Repaired: ${repaired} of ${toRepair} pattern(s).`);
  else console.log(`Would repair: ${toRepair} pattern(s). Dry run — pass --apply to write.`);
  if (held) {
    console.log(
      `Held: ${held} accepted or hand-written rule(s), which would start enforcing once repaired. Pass --include-accepted to repair them too.`,
    );
  }
  if (stillInvalid) console.log(`Left alone: ${stillInvalid} pattern(s) still invalid without (?i).`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
