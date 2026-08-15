/**
 * Backfill the fixed system-field schema into existing template docs.
 *
 * WHY THIS IS NEEDED. `blankTemplateDoc` stamps `fields: SYSTEM_FIELDS` into a
 * doc at CREATION, and `adTemplateFromDoc` then reads `doc.fields` back. So a
 * doc's field list is frozen at the moment it was made: adding a field to
 * `SYSTEM_FIELDS` reaches new docs and nothing else. Every template already in
 * the library keeps the schema it was born with.
 *
 * That is how the Program fields (dealer invoice, advertising allowance,
 * selling price, customer down, the lease fees…) came to exist in code, pass
 * their tests, and still be invisible in the app — no live template carried
 * them, so nobody could type one in, and the Audi/VW disclaimer bodies that
 * depend on them would have rendered their tokens raw.
 *
 * WHAT IT DOES. For each `AdTemplateDoc`, appends any system field the doc is
 * missing, matched by `key`. Existing entries are left exactly as they are —
 * a designer may have edited a label or a placeholder, and this is not the
 * place to overrule that. Field ORDER is preserved and additions go on the end,
 * so no form is reshuffled; new groups (Program) simply appear last.
 *
 * Idempotent: a second run reports nothing to do.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *   npx tsx --env-file=.env.local scripts/backfill-doc-system-fields.ts
 *   npx tsx --env-file=.env.local scripts/backfill-doc-system-fields.ts --apply
 */
import { prisma } from '../src/lib/prisma';
import { SYSTEM_FIELDS, SYSTEM_FIELD_DEFAULTS } from '../src/lib/ad-generator/system-fields';
import type { TemplateDoc } from '../src/lib/ad-generator/doc-types';
import type { FieldSpec } from '../src/lib/ad-generator/types';

const APPLY = process.argv.includes('--apply');

async function main() {
  const rows = await prisma.adTemplateDoc.findMany({ select: { id: true, name: true, doc: true } });
  let changed = 0;

  for (const row of rows) {
    let doc: TemplateDoc;
    try {
      doc = JSON.parse(row.doc) as TemplateDoc;
    } catch {
      console.warn(`SKIP ${row.id} (${row.name}) — doc is not valid JSON`);
      continue;
    }

    const fields: FieldSpec[] = Array.isArray(doc.fields) ? doc.fields : [];
    const have = new Set(fields.map((f) => f?.key).filter(Boolean));
    const missing = SYSTEM_FIELDS.filter((f) => !have.has(f.key));
    if (missing.length === 0) {
      console.log(`ok   ${row.id} (${row.name}) — already complete`);
      continue;
    }

    // Seed defaults only for keys the doc has no value for, so a designer's
    // chosen default is never replaced by the canonical placeholder.
    const defaults: Record<string, string> = { ...(doc.defaults ?? {}) };
    for (const f of missing) {
      if (!(f.key in defaults) && f.key in SYSTEM_FIELD_DEFAULTS) {
        defaults[f.key] = SYSTEM_FIELD_DEFAULTS[f.key];
      }
    }

    const next: TemplateDoc = { ...doc, fields: [...fields, ...missing], defaults };
    changed++;
    console.log(
      `${APPLY ? 'FIX ' : 'WOULD'} ${row.id} (${row.name}) — +${missing.length}: ${missing.map((f) => f.key).join(', ')}`,
    );
    if (APPLY) {
      await prisma.adTemplateDoc.update({ where: { id: row.id }, data: { doc: JSON.stringify(next) } });
    }
  }

  console.log(
    `\n${rows.length} docs, ${changed} ${APPLY ? 'updated' : 'would change'}.` +
      (APPLY || changed === 0 ? '' : ' Re-run with --apply to write.'),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
