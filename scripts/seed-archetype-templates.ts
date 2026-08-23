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
 * Re-running is safe: the doc and name are rewritten from code (that is the
 * point — an archetype fix should reach the seeded rows), everything a person
 * chose in the app is preserved. Pass --dry-run to see what would change.
 *
 * NOT in the build or deploy chain, on purpose and like every other Ad Generator
 * seed: which rooftops get which templates is a per-environment decision, and a
 * deploy that quietly creates template rows in production is not one.
 *
 * Run (droplet or local):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/seed-archetype-templates.ts [accountKey] [--dry-run]
 *
 * With no accountKey: every starting point, each to the rooftop it belongs to
 * (the generic compositions are account-less, so every account sees them).
 * With one: only the starting points for that rooftop.
 */
import { prisma } from '../src/lib/prisma';
import { ARCHETYPE_STARTS, docFromStart, type ArchetypeStart } from '../src/lib/ad-generator/archetypes/registry';

/** Stable, and obviously an archetype row rather than a hand-built one. */
function docId(start: ArchetypeStart): string {
  return `arch-${start.id}`;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.find((a) => !a.startsWith('--'))?.trim();

  const starts = only ? ARCHETYPE_STARTS.filter((s) => s.accountKey === only) : ARCHETYPE_STARTS;
  if (starts.length === 0) {
    console.log(
      `No starting points for account "${only}". Known rooftops: ${[
        ...new Set(ARCHETYPE_STARTS.map((s) => s.accountKey).filter(Boolean)),
      ].join(', ')}`,
    );
    return;
  }

  let created = 0;
  let updated = 0;
  for (const start of starts) {
    const id = docId(start);
    const doc = docFromStart(start, { id });
    const existing = await prisma.adTemplateDoc.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    const where = `account=${start.accountKey ?? 'global'}, ${doc.sizes.length} sizes`;

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
      console.log(`updated ${id} (${where}, still ${existing.status})`);
      continue;
    }

    await prisma.adTemplateDoc.create({
      data: {
        id,
        name: doc.name,
        description: doc.description,
        doc: JSON.stringify(doc),
        status: 'draft',
        accountKey: start.accountKey ?? null,
        createdBy: 'seed-archetype-templates',
      },
    });
    created++;
    console.log(`created ${id} (${where}, draft)`);
  }

  if (!dryRun) console.log(`Archetype templates: ${created} created, ${updated} updated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
