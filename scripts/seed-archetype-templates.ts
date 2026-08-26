/**
 * Seed the ARCHETYPE starting points as Ad Generator templates.
 *
 * Each row is `docFromStart(...)` — the same doc the builder's "start from a
 * layout" produces, so a designer opening one gets exactly what they would get
 * by picking it, already laid out on every channel it names.
 *
 * WHY SEED AT ALL, given the picker exists. The picker is for starting a new
 * design; these rows are for the ones a rooftop RUNS. Automation looks up a
 * published template by make and usage, and a template nobody has saved cannot
 * be looked up. Seeding them makes the composition the default answer rather
 * than something each designer rebuilds.
 *
 * DRAFTS, deliberately. Publishing is a decision — the topo texture still has to
 * be dropped in from Textures, and co-op approval is per make and goes stale —
 * so this never publishes and never un-publishes. An existing row's status,
 * sharing and taxonomy are left exactly as they are.
 *
 * RE-RUNNING NEVER OVERWRITES A DESIGNER. The point of seeding is that an
 * archetype fix reaches the seeded rows — but only the rows nobody has touched.
 * Each seeded doc records the design hash it was written with; on a re-run, a row
 * whose current design still matches that hash is rewritten from code, and one
 * that has moved is LEFT ALONE and reported. A designer who opens a seeded
 * template and repositions half of it owns it from that moment.
 *
 * Status, sharing, category and tags are never touched either way. Pass --dry-run
 * to see what would change.
 *
 * NOT in the build or deploy chain, on purpose and like every other Ad Generator
 * seed: which rooftops get which templates is a per-environment decision, and a
 * deploy that quietly creates template rows in production is not one.
 *
 * Run (droplet or local):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/seed-archetype-templates.ts [--dry-run] [--force]
 *
 * Every starting point is seeded once, globally: the compositions paint from
 * whichever account an ad is for, so there is nothing per-rooftop to seed.
 * `--force` rewrites even an edited row — say it deliberately, and only when the
 * archetype fix matters more than whatever a designer did to that template.
 */
import { prisma } from '../src/lib/prisma';
import { ARCHETYPE_STARTS, docFromStart, type ArchetypeStart } from '../src/lib/ad-generator/archetypes/registry';
import {
  keepContent,
  parseStoredDoc,
  seedOwnership,
  stampSeeded,
} from '../src/lib/ad-generator/archetypes/seed-stamp';

/** Stable, and obviously an archetype row rather than a hand-built one. */
function docId(start: ArchetypeStart): string {
  return `arch-${start.id}`;
}

// `stampSeeded` / `seedOwnership` (imported) decide whether a row is still this
// script's to rewrite. They live in `archetypes/seed-stamp.ts` so they can be
// tested — silently reverting a designer's afternoon is the worst thing this
// script could do, which makes it the last logic that should sit untested here.

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const starts = ARCHETYPE_STARTS;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const start of starts) {
    const id = docId(start);
    const fresh = docFromStart(start, { id });
    const existing = await prisma.adTemplateDoc.findUnique({
      where: { id },
      select: { id: true, status: true, doc: true },
    });
    // The design comes from code; the sample content stays whatever the row has.
    const doc = stampSeeded(keepContent(fresh, existing ? parseStoredDoc(existing.doc) : null));
    const where = `${doc.sizes.length} sizes`;

    // A row a designer has worked on is theirs. The archetype fix does not reach
    // it, and saying so is the point — silently reverting somebody's afternoon is
    // the worst outcome available here.
    const hand = existing ? seedOwnership(existing.doc) : { edited: false, reason: '' };
    if (existing && hand.edited && !force) {
      skipped++;
      console.log(`skipped ${id} — ${hand.reason}. Pass --force to overwrite it.`);
      continue;
    }

    if (dryRun) {
      console.log(`${existing ? 'would update' : 'would create'} ${id} (${where})`);
      continue;
    }

    if (existing) {
      await prisma.adTemplateDoc.update({
        where: { id },
        data: {
          // The design comes from code. Status, sharing, category and tags do
          // not — whoever set those in the app decided them.
          name: doc.name,
          description: doc.description,
          doc: JSON.stringify(doc),
        },
      });
      updated++;
      console.log(
        `updated ${id} (${where}, still ${existing.status})${hand.edited ? ' — FORCED over a designer edit' : ''}`,
      );
      continue;
    }

    await prisma.adTemplateDoc.create({
      data: {
        id,
        name: doc.name,
        description: doc.description,
        doc: JSON.stringify(doc),
        status: 'draft',
        accountKey: null,
        createdBy: 'seed-archetype-templates',
      },
    });
    created++;
    console.log(`created ${id} (${where}, draft)`);
  }

  if (!dryRun) {
    console.log(
      `Archetype templates: ${created} created, ${updated} updated, ${skipped} left to their designer.`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
