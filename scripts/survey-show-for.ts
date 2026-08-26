/**
 * What retiring "Show For" would cost, per template — the survey behind the
 * Phase 4b decision. See docs/ad-generator-archetypes.md §8.
 *
 *   npx tsx -r dotenv/config scripts/survey-show-for.ts
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/survey-show-for.ts
 *
 * Reads the code-defined templates always, and the saved ones when a database is
 * reachable. Prints, worst first: templates whose Show For gating carries CONTENT
 * (a person has to decide), then those that are a mechanical plate migration, then
 * the ones the deletion costs nothing.
 *
 * READ ONLY. Nothing is written, and nothing is changed — this exists to inform a
 * decision, not to make one.
 */
import { prisma } from '../src/lib/prisma';
import { CODE_TEMPLATE_DOCS } from '../src/lib/ad-generator/templates';
import { youngSubaruOfferDocs } from '../src/lib/ad-generator/templates/young-subaru-offers';
import { surveyLibrary, summarizeLibrary, type ShowForReport } from '../src/lib/ad-generator/show-for-survey';
import type { TemplateDoc } from '../src/lib/ad-generator/doc-types';

function parseDoc(raw: string): TemplateDoc | null {
  try {
    const v = JSON.parse(raw) as TemplateDoc;
    return Array.isArray(v?.sizes) && Array.isArray(v?.elements) && v?.layouts ? v : null;
  } catch {
    return null;
  }
}

/** Saved templates, if there is a database to read. A missing one is not an error:
 *  the code library alone still answers the question for the shipped templates. */
async function savedDocs(): Promise<{ docs: TemplateDoc[]; reachable: boolean }> {
  try {
    const rows = await prisma.adTemplateDoc.findMany({
      select: { id: true, name: true, doc: true, status: true },
      orderBy: { updatedAt: 'desc' },
    });
    const docs: TemplateDoc[] = [];
    for (const row of rows) {
      const doc = parseDoc(row.doc);
      if (doc) docs.push({ ...doc, id: row.id, name: row.name || doc.name });
    }
    return { docs, reachable: true };
  } catch {
    return { docs: [], reachable: false };
  }
}

function printReport(r: ShowForReport, origin: string) {
  const mark = r.verdict === 'needs_decision' ? '!' : r.verdict === 'plate_migration' ? '~' : ' ';
  console.log(`\n${mark} ${r.name}  [${origin}]`);
  console.log(`  ${r.summary}`);
  for (const g of r.gated) {
    const kind = g.plateLike ? 'plate' : 'CONTENT';
    console.log(
      `    ${kind.padEnd(7)} ${g.name.padEnd(28)} shows ${g.shows.padEnd(22)} for ${g.types.join('/')}`,
    );
  }
}

async function main() {
  const code: TemplateDoc[] = [...Object.values(CODE_TEMPLATE_DOCS), ...youngSubaruOfferDocs];
  const { docs: saved, reachable } = await savedDocs();
  const origin = new Map<string, string>();
  for (const d of code) origin.set(d.id, 'code');
  for (const d of saved) origin.set(d.id, 'saved');

  const reports = surveyLibrary([...code, ...saved]);

  console.log('Retiring "Show For" — what each template would cost\n');
  console.log(summarizeLibrary(reports));
  if (!reachable) {
    console.log('\n(No database reachable — code-defined templates only. Point DATABASE_URL at an');
    console.log(' environment to include the templates people have actually built there.)');
  }

  for (const verdict of ['needs_decision', 'plate_migration', 'unaffected'] as const) {
    const group = reports.filter((r) => r.verdict === verdict);
    if (!group.length) continue;
    const heading = {
      needs_decision: 'NEEDS A DECISION — the gating carries content, not plate copies',
      plate_migration: 'MECHANICAL — one offer plate replaces the gated set',
      unaffected: 'UNAFFECTED — no offer-type gating at all',
    }[verdict];
    console.log(`\n${'─'.repeat(72)}\n${heading}`);
    for (const r of group) printReport(r, origin.get(r.templateId) ?? '?');
  }

  const plates = reports.filter((r) => r.verdict === 'plate_migration');
  const layers = plates.reduce((n, r) => n + r.gated.length, 0);
  if (layers) {
    console.log(
      `\n${'─'.repeat(72)}\nThe mechanical half is ${layers} layers across ${plates.length} template${plates.length === 1 ? '' : 's'}.`,
    );
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
