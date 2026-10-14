import examples from './corpus/examples.json';

/**
 * Few-shot examples for the copywriter (docs/email-drafting.md §9).
 *
 * Built from finals that were actually sent, by `scripts/drafting-build-corpus.ts`,
 * which derives each example's "what the creative said" side from the final
 * itself. Segmented by request type, never by OEM: there are too few finals
 * per make, and the make only governs compliance, which is code.
 *
 * The file ships empty. Until it is built the copywriter runs with no examples,
 * which is weaker on voice but no weaker on facts — `claims.supported` checks
 * every number either way, including any stale price an example leaks.
 */

export interface DraftExample {
  /** `emailBlast:<id>` — where it came from. */
  id: string;
  requestType: string;
  /** What the creative said, as "Label: value" lines. */
  reading: string[];
  headline: string;
  body: string[];
  ctas: string[];
  subjects: { initial: string[]; urgent: string[] };
  previews: { initial: string[]; urgent: string[] };
}

const CORPUS = examples as DraftExample[];

/** Up to `n` examples of this request type, most complete first, stable order. */
export function pickExamples(requestType: string, n = 4): DraftExample[] {
  const score = (e: DraftExample) => (e.subjects.urgent.length ? 2 : 0) + (e.previews.initial.length ? 1 : 0);
  return CORPUS.filter((e) => e.requestType === requestType)
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
    .slice(0, n);
}

export function renderExample(e: DraftExample, i: number): string {
  const lines = [
    `<example ${i + 1}>`,
    'The creative said:',
    ...e.reading.map((l) => `  ${l}`),
    'The email:',
    `  headline: ${e.headline}`,
    ...e.body.map((p) => `  body: ${p}`),
    ...e.ctas.map((c) => `  button: ${c}`),
    ...e.subjects.initial.map((s) => `  subject (initial): ${s}`),
    ...e.subjects.urgent.map((s) => `  subject (urgent): ${s}`),
    ...e.previews.initial.map((s) => `  preview (initial): ${s}`),
    ...e.previews.urgent.map((s) => `  preview (urgent): ${s}`),
    `</example ${i + 1}>`,
  ];
  return lines.join('\n');
}
