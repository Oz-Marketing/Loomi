/**
 * Correct the Subaru VIN rule's pattern in this environment's stored co-op packs.
 *
 * WHY THIS EXISTS. `subaru-vin-required` was transcribed as `[A-Z0-9]{8}`, and
 * `matcher()` compiles every pattern case-insensitively, so any eight-letter word
 * in a disclaimer satisfied it and a Subaru ad with no VIN passed. The seed now
 * carries `VIN_TAIL_PATTERN`, but co-op packs are applied per environment and the
 * deploy does not carry them: a pack already stored keeps the old pattern.
 *
 * RE-RUNNING THE SEED IS NOT THE FIX. Its upsert rewrites the whole pack, which
 * would drop every drafted rule merged in since, and every review decision on them.
 *
 * So this changes ONE key — that rule's `pattern` — and only while it still holds
 * the old value. Every other rule, and this rule's review state, is written back
 * exactly as stored. A pattern that is neither the old one nor the new one was
 * changed by a person, and is reported rather than overwritten. Idempotent: a
 * patched pack reads as already done.
 *
 * Dry run by default:
 *   npx tsx --env-file=.env.local scripts/fix-subaru-vin-pattern.ts
 *   npx tsx --env-file=.env.local scripts/fix-subaru-vin-pattern.ts --apply
 *
 * On a droplet, export DATABASE_URL from the running app process — never from a
 * file (CLAUDE.md, "Database and deploy-time scripts") — then run the same command
 * from /var/www/loomi-studio/current, without --env-file.
 */
import { prisma } from '../src/lib/prisma';
import { VIN_TAIL_PATTERN } from '../src/lib/ad-generator/vin';

const RULE_ID = 'subaru-vin-required';
/** As first transcribed — the only value this script replaces. */
const OLD_PATTERN = '[A-Z0-9]{8}';

const apply = process.argv.includes('--apply');

type StoredRule = { id?: unknown; pattern?: unknown };

async function main() {
  const rows = await prisma.adCoopRulePack.findMany({
    where: { make: { equals: 'Subaru', mode: 'insensitive' } },
    orderBy: { version: 'asc' },
  });
  if (rows.length === 0) {
    console.log('No Subaru pack in this environment — nothing to patch.');
    return;
  }

  let patchable = 0;
  let patched = 0;
  for (const row of rows) {
    const label = `${row.make} ${row.version}${row.isActive ? '' : ' (inactive)'}`;

    // Plain JSON.parse, NOT parseCoopPack: that drops any rule entry it can't use,
    // and writing its result back would delete those entries from the pack.
    let stored: { rules?: unknown };
    try {
      stored = JSON.parse(row.rules);
    } catch {
      console.log(`${label} — the stored pack is not valid JSON; left alone.`);
      continue;
    }
    if (!Array.isArray(stored?.rules)) {
      console.log(`${label} — the stored pack has no rules array; left alone.`);
      continue;
    }
    const rules = stored.rules as (StoredRule | null)[];

    const at = rules.findIndex((r) => r?.id === RULE_ID);
    if (at < 0) {
      console.log(`${label} — no ${RULE_ID} rule.`);
      continue;
    }
    if (rules.some((r, i) => i > at && r?.id === RULE_ID)) {
      console.log(`${label} — more than one rule is ${RULE_ID}; left alone for a person to sort out.`);
      continue;
    }
    const pattern = rules[at]!.pattern;
    if (pattern === VIN_TAIL_PATTERN) {
      console.log(`${label} — already patched.`);
      continue;
    }
    if (pattern !== OLD_PATTERN) {
      console.log(
        `${label} — ${RULE_ID} has the pattern ${JSON.stringify(pattern)}, which is neither the old one nor the new one. Someone changed it; left alone.`,
      );
      continue;
    }

    patchable += 1;
    console.log(`${label} — ${RULE_ID}: ${OLD_PATTERN} → ${VIN_TAIL_PATTERN}`);
    if (!apply) continue;

    const next = JSON.stringify({
      ...stored,
      rules: rules.map((r, i) => (i === at ? { ...r, pattern: VIN_TAIL_PATTERN } : r)),
    });
    // Conditional on the text that was read, so an edit made in the review queue
    // while this runs is never written over. `updatedAt` is kept as it was:
    // loadCoopPackForReview breaks ties between active packs on it, and bumping it
    // could change which Subaru pack is in force.
    const { count } = await prisma.adCoopRulePack.updateMany({
      where: { id: row.id, rules: row.rules },
      data: { rules: next, updatedAt: row.updatedAt },
    });
    if (count === 1) {
      patched += 1;
      console.log('  ✔ patched');
    } else {
      console.log('  ✖ the pack changed while this ran, so nothing was written — run it again');
      process.exitCode = 1;
    }
  }

  if (patchable === 0) {
    console.log('\nNothing to patch.');
  } else if (apply) {
    console.log(`\nPatched: ${patched} of ${patchable} pack(s).`);
  } else {
    console.log(`\nWould patch: ${patchable} pack(s). Dry run — pass --apply to write.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
