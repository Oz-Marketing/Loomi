/**
 * Apply a drafting run's output to this environment's rule packs.
 *
 * DRY RUN BY DEFAULT — pass `--apply` to write. Same convention as the other
 * backfills, for the same reason: the interesting output is what it WOULD do.
 *
 * Drafting and writing are separate steps on purpose. A pass over a document costs
 * an API call and a few minutes; applying its JSON costs nothing and can be repeated
 * per environment. So a document is drafted ONCE, the artifact is reviewed as a file,
 * and staging and production then receive byte-identical rules. Re-drafting per
 * environment would spend twice and — worse — could produce two different sets of
 * rules for the same document.
 *
 * Every rule lands as `reviewState: 'proposed'`, which evaluates as NOTHING. So
 * applying a draft cannot change what any ad is checked against; it only fills the
 * review queue. See coop-draft-merge.ts for why this merges rather than writing a
 * new row (short version: a new row would shadow the make's existing pack).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/apply-coop-draft.ts drafts/*.json
 *   npx tsx --env-file=.env.local scripts/apply-coop-draft.ts drafts/mazda.json --apply
 *
 * On a droplet (co-op data is per-environment and the deploy does not carry it):
 *   cd /var/www/loomi-studio/current && set -a && source shared/.env.local && set +a && \
 *     NODE_ENV=production npx tsx scripts/apply-coop-draft.ts /tmp/drafts/*.json --apply
 */
import * as fs from 'node:fs';
import { prisma } from '../src/lib/prisma';
import { loadCoopPackForReview } from '../src/lib/ad-generator/coop-pack-store';
import { mergeDraftedRules, type MergeSkip } from '../src/lib/ad-generator/coop-draft-merge';
import { splitByReviewState } from '../src/lib/ad-generator/coop-pack-store';
import type { AcceptedRule } from '../src/lib/ad-generator/coop-draft';

interface DraftFile {
  make: string;
  title: string;
  sourceDocId?: string | null;
  accepted: AcceptedRule[];
  notes?: unknown[];
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const files = args.filter((a) => !a.startsWith('--'));
const versionArg = args.find((a) => a.startsWith('--version='))?.split('=')[1];

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** Deterministic fallback version for a make that has no pack yet. */
function draftVersion(): string {
  // Taken from the file, never `new Date()`: re-applying the same artifact must
  // target the same pack rather than creating a new one tomorrow.
  return versionArg ?? 'ai-draft';
}

async function main() {
  if (files.length === 0) {
    bail('Usage: apply-coop-draft.ts <draft.json...> [--apply] [--version=X]');
  }

  let totalAdded = 0;
  let totalSkipped = 0;

  for (const file of files) {
    if (!fs.existsSync(file)) bail(`No such file: ${file}`);
    const draft = JSON.parse(fs.readFileSync(file, 'utf8')) as DraftFile;
    if (!draft.make || !Array.isArray(draft.accepted)) {
      bail(`${file} is not a drafting run output (needs "make" and "accepted").`);
    }

    // ── "no pack" must be PROVEN, not inferred from a null ──
    //
    // loadCoopPackForReview is deliberately resilient: an unreachable or unmigrated
    // table resolves to null so generation degrades to "no checks" rather than
    // failing. That is right for a reader and WRONG here — a transient read failure
    // would look like "this make has no pack", and we would create a second row that
    // shadows the real one. So the existence question is asked directly, and any
    // error propagates and aborts instead of being read as absence.
    const rowCount = await prisma.adCoopRulePack.count({
      where: { make: { equals: draft.make, mode: 'insensitive' }, isActive: true },
    });
    const existing = await loadCoopPackForReview(draft.make);
    if (rowCount > 0 && !existing) {
      bail(
        `${draft.make} has ${rowCount} active pack row(s) but none could be loaded — ` +
          'the stored JSON is probably unparseable. Refusing to write: creating a pack ' +
          'now would shadow the existing one. Fix or deactivate that row first.',
      );
    }
    const before = existing ? splitByReviewState(existing.pack) : null;
    const merged = mergeDraftedRules(existing?.pack ?? null, draft.accepted, {
      make: draft.make,
      version: existing?.pack.version ?? draftVersion(),
      source: draft.title,
      sourceDocId: draft.sourceDocId ?? undefined,
    });

    const target = existing
      ? `${draft.make} "${existing.pack.version}" (${before?.accepted.rules.length ?? 0} accepted, ${before?.proposedCount ?? 0} proposed)`
      : `${draft.make} — NEW pack "${draftVersion()}"`;

    console.log(`\n${target}`);
    console.log(`  ${file}`);
    console.log(`  + ${merged.added.length} proposed`);
    if (merged.skipped.length) {
      const by: Record<string, number> = {};
      for (const s of merged.skipped) by[s.reason] = (by[s.reason] ?? 0) + 1;
      console.log(
        `  skipped ${merged.skipped.length}: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')}`,
      );
      // Malformed is a defect upstream, not a duplicate — always show those.
      for (const s of merged.skipped.filter((x: MergeSkip) => x.reason === 'malformed')) {
        console.log(`    MALFORMED ${s.ruleId}: ${s.description.slice(0, 110)}`);
      }
    }
    totalAdded += merged.added.length;
    totalSkipped += merged.skipped.length;

    if (!apply) continue;
    if (merged.added.length === 0) {
      console.log('  nothing to write');
      continue;
    }

    if (existing) {
      // Update the JSON only. `verified` is NOT touched: it records that a human
      // checked the ACCEPTED rules, and adding proposals does not change that.
      await prisma.adCoopRulePack.update({
        where: { id: existing.id },
        data: { rules: JSON.stringify(merged.pack) },
      });
      console.log(`  ✔ updated pack ${existing.id}`);
    } else {
      const row = await prisma.adCoopRulePack.create({
        data: {
          make: draft.make,
          version: draftVersion(),
          source: draft.title,
          // A pack born entirely from drafts has had nothing checked by anyone.
          verified: false,
          isActive: true,
          rules: JSON.stringify(merged.pack),
        },
      });
      console.log(`  ✔ created pack ${row.id}`);
    }
  }

  console.log(
    `\n${apply ? 'Applied' : 'Would apply'}: ${totalAdded} proposed rule(s) across ${files.length} file(s), ${totalSkipped} skipped.`,
  );
  if (!apply) console.log('Dry run — pass --apply to write.');
  else console.log('All added rules are PROPOSED: nothing evaluates until a human accepts it.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exit(1);
});
