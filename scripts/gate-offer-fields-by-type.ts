/**
 * Gate template elements to the offer types their field actually belongs to.
 *
 * WHY. Some offer fields only exist for certain offer types. An element bound to
 * one with no `visibleWhen` is visible on every ad, so on the offer types where
 * the value is never produced it renders as an empty box — and, until preflight
 * was taught about this, failed the ad outright with `empty_binding`. That is
 * what stopped the shared "Vehicle Offer (Builder)" template producing a single
 * lease ad.
 *
 * Preflight has since been fixed (an empty value is expected on the offer types
 * that never carry it, while still blocking the ones that do), so generation no
 * longer depends on this script. What this fixes is the remaining cosmetic half:
 * an ungated element still renders as an empty box.
 *
 * Templates are per-environment data, so run this once per environment. It is NOT
 * wired into `deploy:prepare` on purpose — the deploy's SSH step is already near
 * its time budget, and this is a one-off correction, not a per-deploy backfill.
 *
 * Idempotent: only touches elements with NO `visibleWhen` at all, so a designer's
 * own gating is never overwritten. Run:
 *
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/gate-offer-fields-by-type.ts
 *
 * Pass `--dry` to report what would change without writing.
 */
import { prisma } from '../src/lib/prisma';
import type { TemplateDoc, DocElement } from '../src/lib/ad-generator/doc-types';

const DRY = process.argv.includes('--dry');

/**
 * field key → the offer types whose ads actually carry a value for it.
 *
 * Deliberately NARROWER than the field's own `visibleWhen`, which says where a
 * value is *permitted*; this says where one is *produced*:
 *  - `costPerThousand` is derived from an APR rate + term (incentive-apply).
 *  - `msrp` is referenced by the assembled offer only for discount ("OFF MSRP")
 *    and sale price ("MSRP of …"); a lease or APR ad never prints it.
 *  - `financialInstitution` names the lender behind a finance programme.
 *  - `discountSource` qualifies a discount ("Dealer discount").
 */
const GATES: Record<string, string[]> = {
  costPerThousand: ['apr'],
  msrp: ['discount', 'sales_price'],
  financialInstitution: ['apr', 'custom'],
  discountSource: ['discount'],
};

/** The bound field key for an element, in either offer slot, or null. */
function boundKey(el: DocElement): string | null {
  const b = el.binding;
  if (b?.kind === 'field') return b.key;
  // Text is authored as a static {{token}} string, so match that shape too.
  if (b?.kind === 'static') {
    const m = /\{\{\s*((?:o2_)?[A-Za-z0-9_]+)\s*\}\}/.exec(b.value ?? '');
    return m ? m[1] : null;
  }
  return null;
}

async function main() {
  const rows = await prisma.adTemplateDoc.findMany({ select: { id: true, name: true, doc: true } });
  let scanned = 0;
  let changed = 0;

  for (const row of rows) {
    let doc: TemplateDoc;
    try {
      doc = JSON.parse(row.doc) as TemplateDoc;
    } catch {
      console.warn(`  ! ${row.name} (${row.id}) — unparseable doc, skipped`);
      continue;
    }
    if (!Array.isArray(doc.elements)) continue;
    scanned++;

    const touched: string[] = [];
    const elements = doc.elements.map((el) => {
      if (el.visibleWhen) return el;
      const key = boundKey(el);
      if (!key) return el;
      const slot = key.startsWith('o2_') ? 'o2_' : '';
      const base = key.slice(slot.length);
      const types = GATES[base];
      if (!types) return el;
      touched.push(`${el.id}→${base}[${types.join('|')}]`);
      return { ...el, visibleWhen: { field: `${slot}offerType`, in: types } };
    });
    if (!touched.length) continue;

    console.log(`  ${DRY ? 'would gate' : 'gating'} ${touched.length} element(s) in "${row.name}" (${row.id})`);
    for (const t of touched) console.log(`      ${t}`);
    changed++;
    if (DRY) continue;
    await prisma.adTemplateDoc.update({
      where: { id: row.id },
      data: { doc: JSON.stringify({ ...doc, elements }) },
    });
  }

  const noun = changed === 1 ? 'template' : 'templates';
  console.log(
    `\n${DRY ? '[dry run] ' : ''}Scanned ${scanned} template(s); ${changed} ${noun} ${DRY ? 'would be updated' : 'updated'}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
