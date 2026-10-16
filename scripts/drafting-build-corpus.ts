/**
 * Build the drafting copywriter's few-shot corpus from finals that were sent
 * from Loomi (docs/email-drafting.md §9).
 *
 * For each completed one-off blast it derives the example's "what the creative
 * said" side FROM THE FINAL ITSELF — every approved email already carries its
 * offer, headline and disclaimer — classifies it by request type, and pairs it
 * with its follow-up's subject as the urgent variation.
 *
 * Read-only against the database it is pointed at; it writes one file in the
 * repo, and only with --write. Point DATABASE_URL at the environment whose
 * finals you want (prod has them; the URL comes from the running process,
 * never a file on the droplet — see CLAUDE.md):
 *
 *   DATABASE_URL=… npx tsx --env-file=.env.local scripts/drafting-build-corpus.ts [--limit 40] [--write]
 *
 * Needs ANTHROPIC_API_KEY: one model call per final. Without --write it prints
 * what it would add.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { visibleText } from '../src/lib/drafting/compliance/html';
import type { DraftExample } from '../src/lib/drafting/corpus';
import { REQUEST_TYPES } from '../src/lib/drafting/extraction';
import { structuredCall } from '../src/lib/drafting/model';
import { followUpInfo } from '../src/lib/services/email-blasts';

const OUT = path.join(process.cwd(), 'src/lib/drafting/corpus/examples.json');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

interface Derived {
  requestType: string;
  isRealCampaign: boolean;
  reading: string[];
  headline: string;
  body: string[];
  ctas: string[];
}

const strings = { type: 'array', items: { type: 'string' } };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requestType', 'isRealCampaign', 'reading', 'headline', 'body', 'ctas'],
  properties: {
    requestType: { type: 'string', enum: [...REQUEST_TYPES] },
    isRealCampaign: { type: 'boolean' },
    reading: strings,
    headline: { type: 'string' },
    body: strings,
    ctas: strings,
  },
};

const SYSTEM = `You are given the visible text of a car dealership marketing email that was approved and sent. Split it into two parts, quoting the email's own words — never rewrite, summarize or add anything.

1. reading: what the email's main graphic would have said — the offer terms, prices, rates, dates, the vehicle or services, and the call to action — as short "Label: value" lines ("APR: 1.9% APR", "Offer ends: 10/31/2026"). Leave the legal disclaimer, the footer, addresses and unsubscribe text out.
2. The supporting copy written around it: the headline, the body paragraphs, and the button labels, exactly as they appear.

requestType: model_offer (a vehicle lease/APR/cash offer), service_special, sales_event, event_invite, announcement, conquest, or other.
isRealCampaign: false for a test send, a placeholder, or an email that is only an image with no copy.`;

async function main(): Promise<void> {
  const limit = Number(arg('limit') ?? 60);
  const blasts = await prisma.emailBlast.findMany({
    where: { status: { in: ['completed', 'partial'] }, flowNodeKey: null, automationKey: null },
    select: { id: true, name: true, subject: true, previewText: true, htmlContent: true, metadata: true, completedAt: true },
    orderBy: { completedAt: 'desc' },
  });

  const followUps = new Map<string, { subject: string; preview: string | null }[]>();
  const originals = [];
  for (const b of blasts) {
    const { resendOf } = followUpInfo(b.metadata);
    if (resendOf) {
      const list = followUps.get(resendOf) ?? [];
      list.push({ subject: b.subject, preview: b.previewText });
      followUps.set(resendOf, list);
    } else if (!/\btest\b/i.test(`${b.name ?? ''} ${b.subject}`)) {
      originals.push(b);
    }
  }
  console.log(`${blasts.length} sent blasts: ${originals.length} originals, ${followUps.size} with follow-ups.`);

  const existing: DraftExample[] = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const known = new Set(existing.map((e) => e.id));
  const added: DraftExample[] = [];
  const seenSubjects = new Set(existing.flatMap((e) => e.subjects.initial.map((s) => s.toLowerCase())));

  for (const b of originals.slice(0, limit)) {
    const id = `emailBlast:${b.id}`;
    // The same campaign sent to several stores is one example, not five.
    if (known.has(id) || seenSubjects.has(b.subject.toLowerCase())) continue;
    const text = visibleText(b.htmlContent).slice(0, 12000);
    if (text.length < 80) continue;
    const derived = await structuredCall<Derived>({
      system: SYSTEM,
      content: [{ type: 'text', text: `Subject: ${b.subject}\nPreview: ${b.previewText ?? ''}\n\nEmail text:\n${text}` }],
      schema: SCHEMA,
      effort: 'medium',
      task: `reading blast ${b.id}`,
    });
    if (!derived.isRealCampaign) continue;
    const urgent = followUps.get(b.id) ?? [];
    const example: DraftExample = {
      id,
      requestType: derived.requestType,
      reading: derived.reading,
      headline: derived.headline,
      body: derived.body,
      ctas: derived.ctas,
      subjects: { initial: [b.subject], urgent: urgent.map((u) => u.subject).filter((s) => s !== b.subject) },
      previews: {
        initial: b.previewText ? [b.previewText] : [],
        urgent: urgent.map((u) => u.preview).filter((p): p is string => !!p && p !== b.previewText),
      },
    };
    added.push(example);
    seenSubjects.add(b.subject.toLowerCase());
    console.log(`  ${derived.requestType.padEnd(16)} ${b.subject}${urgent.length ? `  (+${urgent.length} follow-up)` : ''}`);
  }

  const byType = added.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.requestType]: (acc[e.requestType] ?? 0) + 1 }), {});
  console.log(`\n${added.length} new example(s):`, byType);
  if (!has('write')) {
    console.log('Dry run — pass --write to add them to', path.relative(process.cwd(), OUT));
    return;
  }
  fs.writeFileSync(OUT, `${JSON.stringify([...existing, ...added], null, 2)}\n`);
  console.log('Wrote', path.relative(process.cwd(), OUT));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
