import type { DraftCopy } from './assemble';
import { DEALER_ABBREVIATIONS } from './compliance/rules/brand';
import type { FactSource, Violation } from './compliance/types';
import { pickExamples, renderExample, type DraftExample } from './corpus';
import { renderGuidelinePages, type CoopUnmet, type GuidelinePage } from './guidelines';
import { CTA_PURPOSES, CTA_PURPOSE_KEYS, type CtaPurpose } from './links';
import { structuredCall } from './model';
import type { CreativeReading } from './reading';

/**
 * DRAFT (docs/email-drafting.md §4, stage 6): the model writes the supporting
 * copy, the subject lines and the preview text — and nothing else. Code
 * assembles the email (`assemble.ts`), so a disclaimer, URL or footer can't be
 * written wrong because the model never writes one.
 *
 * The house rules are in the prompt so the first draft is usually clean, but
 * they're enforced by the registry, not by this prompt. `repair` is the one
 * second chance: the failed lines go back with what was wrong.
 */

interface CopyReply {
  headline: string;
  body: string[];
  ctas: { label: string; purpose: string }[];
  heroAlt: string;
  subjects: { initial: string[]; urgent: string[] };
  previews: { initial: string[]; urgent: string[] };
  notes: string[];
  coopUnmet: CoopUnmet[];
}

const strings = { type: 'array', items: { type: 'string' } };
const options = {
  type: 'object',
  additionalProperties: false,
  required: ['initial', 'urgent'],
  properties: { initial: strings, urgent: strings },
};

export const COPY_REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'body', 'ctas', 'heroAlt', 'subjects', 'previews', 'notes', 'coopUnmet'],
  properties: {
    headline: { type: 'string' },
    body: strings,
    ctas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'purpose'],
        properties: { label: { type: 'string' }, purpose: { type: 'string', enum: CTA_PURPOSE_KEYS } },
      },
    },
    heroAlt: { type: 'string' },
    subjects: options,
    previews: options,
    notes: strings,
    coopUnmet: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requirement', 'document', 'page', 'quote'],
        properties: {
          requirement: { type: 'string' },
          document: { type: 'string' },
          page: { type: 'integer' },
          quote: { type: 'string' },
        },
      },
    },
  },
} as const;

/** Rules whose errors the copywriter can fix by rewriting. Others are code's or data's. */
export const COPY_RULE_IDS = new Set([
  'claims.supported',
  'copy.dealer-name-in-full',
  'copy.subject-and-preview-options',
  'oem.mazda.no-exclusivity',
  'oem.honda.no-uppercase-name',
]);

export interface CopyBrief {
  dealer: string;
  oems: string[];
  reading: CreativeReading;
  facts: FactSource[];
  request: { project: string | null; details: string; audience: string; runDates: string | null };
  /** The make's co-op banned phrases, when it has a pack. */
  bannedPhrases: string[];
  /** Pages of the make's co-op guidelines, for a co-op request. Empty otherwise. */
  guidelines: GuidelinePage[];
  /** Button purposes the account has a link for. Others go to the homepage. */
  linkedPurposes: CtaPurpose[];
}

export function copySystem(oems: string[]): string {
  const brand: string[] = [];
  const sells = (m: string) => oems.some((o) => o.toLowerCase() === m.toLowerCase());
  if (sells('Mazda')) brand.push('Mazda: never "exclusive" in any form, and avoid "VIP", "only at", "invitation only".');
  if (sells('Honda')) brand.push('Honda: never write the name in capitals ("HONDA"). Write "Honda".');
  return `You write the supporting copy for a car dealership's marketing email. The email's main image is an approved graphic that already carries the offer, the headline and the legal disclaimer. Your copy sits around it: a short headline, one to three short paragraphs, one or two button labels, the image's alt text, subject lines and preview text.

FACTS ARE FIXED. Every price, payment, rate, term, date, percentage, model year and make you write must appear in the FACTS you are given, in the same kind ("$3,500" needs "$3,500"; "1.9%" needs "1.9%"). Do not round, total, compare, or restate a figure differently. Never mention an incentive, rebate, model, trim or date that isn't in the facts. When in doubt, leave the number out — the image already shows it. Code checks every number you write against the facts and rejects the draft on any mismatch.

YOU NEVER WRITE: a disclaimer or fine print, a URL, a phone number, an address, or a footer. Code adds those.

HOUSE RULES
- Write the dealership's name in full, exactly as given. Never shorten it, and never use ${DEALER_ABBREVIATIONS.join(', ')}.
- American English. Plain, warm, specific; no exclamation-mark pileups, no ALL CAPS words.
${brand.map((b) => `- ${b}`).join('\n')}

WHAT TO RETURN
- headline: under 70 characters.
- body: one to three paragraphs, each one to three sentences.
- ctas: one or two buttons, each a label under 24 characters ("Shop Now", "Value Your Trade") and the purpose of the page it should open, from the list you're given. Prefer purposes the dealership has a link for; a button whose purpose has no link opens the homepage.
- heroAlt: what the image says, briefly, for someone who can't see it.
- subjects: three "initial" subject lines for the first send and two "urgent" ones for the last-chance follow-up, all different, under 60 characters.
- previews: two "initial" and two "urgent" preview lines, all different, under 100 characters, each adding to its subject rather than repeating it.
- notes: anything a person should know — a fact you needed and didn't have, or a co-op wording you avoided. Empty when there is nothing.
- coopUnmet: only when manufacturer guideline pages are given. Each requirement on those pages that applies to this email and that your copy can't satisfy — because it needs a fact you don't have, or something only the graphic or its disclaimer could carry (you can't change either). Give the requirement in one plain sentence, the document title and page exactly as labeled, and a quote of at least six words copied exactly from that page. Satisfy what you can in the copy instead of listing it. Empty when there is nothing, or when no pages are given.`;
}

function factsBlock(brief: CopyBrief): string {
  const lines = brief.facts.map((f) => `[${f.label}] ${f.text}`);
  return `FACTS (the only source of figures, dates and makes):\n${lines.join('\n')}`;
}

export function copyPrompt(brief: CopyBrief, examples: DraftExample[]): string {
  const r = brief.request;
  const parts = [
    `Dealership: ${brief.dealer}${brief.oems.length ? ` (sells ${brief.oems.join(', ')})` : ''}`,
    `Request type: ${brief.reading.requestType ?? 'unknown'}`,
    r.project ? `Request: ${r.project}` : '',
    r.audience ? `Audience: ${r.audience}` : '',
    r.runDates ? `Runs: ${r.runDates}` : '',
    `Button purposes:\n${CTA_PURPOSE_KEYS.map(
      (p) => `- ${p}: ${CTA_PURPOSES[p].label}${p === 'homepage' || brief.linkedPurposes.includes(p) ? '' : ' (no link on file — opens the homepage)'}`,
    ).join('\n')}`,
    factsBlock(brief),
    brief.bannedPhrases.length
      ? `This is co-op advertising. The manufacturer's guidelines ban these phrases — don't use them:\n${brief.bannedPhrases.join('; ')}`
      : '',
    brief.guidelines.length
      ? `This is co-op advertising. The manufacturer's guidelines for it, the pages that bear on an offer email — follow them in your copy where you can:\n\n${renderGuidelinePages(brief.guidelines)}`
      : '',
    examples.length
      ? `Emails like this one that were approved and sent, for voice and structure only. Their figures belong to other offers; never reuse them:\n\n${examples.map(renderExample).join('\n\n')}`
      : '',
    'Write the copy for this email.',
  ];
  return parts.filter(Boolean).join('\n\n');
}

function toCopy(reply: CopyReply): DraftCopy & { coopUnmet: CoopUnmet[] } {
  const clean = (xs: string[] | undefined) => (xs ?? []).map((s) => s.trim()).filter(Boolean);
  return {
    headline: reply.headline.trim(),
    body: clean(reply.body).slice(0, 3),
    ctas: (reply.ctas ?? [])
      .map((c) => ({ label: (c.label ?? '').trim(), purpose: c.purpose }))
      .filter((c) => c.label)
      .slice(0, 2),
    heroAlt: reply.heroAlt.trim(),
    subjects: [
      ...clean(reply.subjects?.initial).map((text) => ({ text, kind: 'initial' as const })),
      ...clean(reply.subjects?.urgent).map((text) => ({ text, kind: 'urgent' as const })),
    ],
    previews: [
      ...clean(reply.previews?.initial).map((text) => ({ text, kind: 'initial' as const })),
      ...clean(reply.previews?.urgent).map((text) => ({ text, kind: 'urgent' as const })),
    ],
    notes: clean(reply.notes),
    coopUnmet: (reply.coopUnmet ?? []).filter((u) => u.requirement?.trim()),
  };
}

export interface CopyResult {
  copy: DraftCopy;
  /** Co-op requirements the copy couldn't meet, uncited until `coopNotes` checks them. */
  coopUnmet: CoopUnmet[];
  exampleIds: string[];
  system: string;
  prompt: string;
}

export async function writeCopy(brief: CopyBrief): Promise<CopyResult> {
  const examples = pickExamples(brief.reading.requestType ?? 'other');
  const system = copySystem(brief.oems);
  const prompt = copyPrompt(brief, examples);
  const reply = await structuredCall<CopyReply>({
    system,
    content: [{ type: 'text', text: prompt }],
    schema: COPY_REPLY_SCHEMA as unknown as Record<string, unknown>,
    effort: 'high',
    task: 'writing the copy',
  });
  const { coopUnmet, ...copy } = toCopy(reply);
  return { copy, coopUnmet, exampleIds: examples.map((e) => e.id), system, prompt };
}

/** One rewrite, told exactly which lines failed and why. */
export async function repairCopy(first: CopyResult, violations: Violation[]): Promise<CopyResult> {
  const c = first.copy;
  const previous = [
    `headline: ${c.headline}`,
    ...c.body.map((p) => `body: ${p}`),
    ...c.ctas.map((b) => `button: ${b.label} (${b.purpose})`),
    `heroAlt: ${c.heroAlt}`,
    ...c.subjects.map((s) => `subject (${s.kind}): ${s.text}`),
    ...c.previews.map((p) => `preview (${p.kind}): ${p.text}`),
  ].join('\n');
  const problems = violations.map((v) => `- ${v.message}${v.excerpt ? ` (${v.excerpt})` : ''}`).join('\n');
  const prompt = `${first.prompt}\n\nYour previous copy was rejected by the checks:\n${problems}\n\nPrevious copy:\n${previous}\n\nWrite it again, fixing every problem. Change only what you must.`;
  const reply = await structuredCall<CopyReply>({
    system: first.system,
    content: [{ type: 'text', text: prompt }],
    schema: COPY_REPLY_SCHEMA as unknown as Record<string, unknown>,
    effort: 'high',
    task: 'rewriting the copy',
  });
  const { coopUnmet, ...copy } = toCopy(reply);
  return { ...first, copy, coopUnmet, prompt };
}
