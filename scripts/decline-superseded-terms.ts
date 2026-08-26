/**
 * Decline the one-term co-op proposals that a list rule already covers.
 *
 * WHY THIS EXISTS. Drafting used to emit one rule per banned word — Subaru produced
 * fifty-one from a single page. Those proposals are still queued, and a fresh pass
 * adds LIST rules beside them rather than replacing them: nothing can tell that one
 * twenty-eight-term rule supersedes twenty-eight single-term ones, because by id and
 * by content they are unrelated. So the queue gets bigger before it gets smaller.
 *
 * The decision itself is `findSupersededPhraseRules`, which is pure and tested. This
 * script is the DB wrapper around it, and it is deliberately narrow: only `proposed`
 * single-term rules, only where a list rule genuinely contains the term, and by
 * default only where that list rule has already been ACCEPTED. A proposed list could
 * itself be declined later, which would leave those terms covered by nothing.
 *
 * So the intended order is: accept the list rules in Settings → Co-op Guidelines
 * (four clicks for Subaru), then run this. Use --include-proposed-lists to clean up
 * before accepting, when you know you are going to.
 *
 * Rejection MARKS rather than deletes, so a later drafting pass recognises these as
 * already-decided instead of proposing them again every month.
 *
 * Dry run by default:
 *   npx tsx --env-file=.env.local scripts/decline-superseded-terms.ts
 *   npx tsx --env-file=.env.local scripts/decline-superseded-terms.ts --make Subaru --apply
 */
import { prisma } from '../src/lib/prisma';
import { parseCoopPack } from '../src/lib/ad-generator/coop-rules';
import { applyRuleReviews, findSupersededPhraseRules } from '../src/lib/ad-generator/coop-review';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const arg = (f: string) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const apply = has('--apply');
const includeProposedLists = has('--include-proposed-lists');
const onlyMake = arg('make');
/** Recorded as the reviewer. NOT a person's name: nobody read these individually,
 *  and stamping someone's name on a bulk supersede would misattribute a decision. */
const REVIEWER = 'cleanup (superseded by a list rule)';

async function main() {
  const rows = await prisma.adCoopRulePack.findMany({
    where: {
      isActive: true,
      ...(onlyMake ? { make: { equals: onlyMake, mode: 'insensitive' } } : {}),
    },
    orderBy: { make: 'asc' },
  });
  if (rows.length === 0) {
    console.log(onlyMake ? `No active pack for ${onlyMake}.` : 'No active packs.');
    return;
  }

  let total = 0;
  for (const row of rows) {
    const pack = parseCoopPack(row.rules);
    if (!pack) {
      console.log(`${row.make} ${row.version} — pack could not be read, skipped.`);
      continue;
    }

    const superseded = findSupersededPhraseRules(pack, { includeProposedLists });
    if (superseded.length === 0) continue;

    const byCover = new Map<string, typeof superseded>();
    for (const s of superseded) {
      const list = byCover.get(s.coveredBy) ?? [];
      list.push(s);
      byCover.set(s.coveredBy, list);
    }

    console.log(`\n${row.make} ${row.version} — ${superseded.length} superseded proposal(s)`);
    for (const [cover, items] of byCover) {
      const state = items[0].coverState;
      console.log(`  covered by ${cover} (${state}): ${items.length}`);
      console.log(`    ${items.map((i) => i.phrase).join(', ')}`);
    }

    if (apply) {
      const result = applyRuleReviews(
        pack,
        superseded.map((s) => ({ ruleId: s.ruleId, state: 'rejected' as const })),
        REVIEWER,
        new Date(),
      );
      await prisma.adCoopRulePack.update({
        where: { id: row.id },
        data: { rules: JSON.stringify(result.pack) },
      });
      console.log(`  ✔ declined ${result.applied.length}`);
      // Anything refused by the pure layer is a defect worth seeing, not a no-op.
      if (result.notInReview.length) {
        console.log(`  ⚠ ${result.notInReview.length} were not in review and were left alone`);
      }
    }
    total += superseded.length;
  }

  if (total === 0) {
    console.log('\nNothing superseded.');
    if (!includeProposedLists) {
      console.log('Only ACCEPTED list rules count as cover — accept them first, or pass --include-proposed-lists.');
    }
    return;
  }
  console.log(
    `\n${apply ? 'Declined' : 'Would decline'}: ${total} proposal(s) across ${rows.length} pack(s).`,
  );
  if (!apply) console.log('Dry run — pass --apply to write.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
