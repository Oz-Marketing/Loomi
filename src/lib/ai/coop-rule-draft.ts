import { getAnthropicClient, ANTHROPIC_COMPLIANCE_MODEL } from '@/lib/anthropic';
import { RULE_KINDS, RULE_KIND_META } from '@/lib/ad-generator/coop-rule-authoring';
import { knownAdDataKeys, knownOfferTypes } from '@/lib/ad-generator/coop-draft';
import type { RuleProposal, UnexpressibleProposal } from '@/lib/ad-generator/coop-draft';
import { renderPagesForPrompt } from '@/lib/ad-generator/guideline-quotes';

/**
 * Drafting co-op rules from a guideline document.
 *
 * The ONLY impure part of the drafting pipeline: it calls the model and shapes the
 * reply. It deliberately validates nothing — `coop-draft.ts` screens the output,
 * and keeping the two apart means the screening rules are testable against
 * hand-written proposals without an API key, and a prompt change can't quietly
 * relax a check.
 *
 * ── WHAT THE PROMPT IS DOING ──
 *
 * Three things carry most of the accuracy, and all three are mechanical rather
 * than rhetorical:
 *
 *   1. **The field vocabulary is supplied.** A model asked to name the field a rule
 *      applies to will otherwise invent `brandLogo` for `logoUrl` — plausible,
 *      structurally valid, and silently inert. Listing the real keys turns the
 *      commonest failure into a non-event rather than a dropped proposal.
 *   2. **The quote is mandatory and is checked.** Stated here, enforced elsewhere.
 *   3. **"Not expressible" is an available answer.** Without it, a requirement the
 *      engine cannot carry gets forced into the nearest rule kind, which is how a
 *      WRONG rule enters — the failure mode that costs a brand a month of ads.
 *
 * The document goes in the FIRST system block so it can be cached: a pass for
 * rules and a pass for disclaimer bodies read the same document, and caching only
 * works on an identical prefix, so anything task-specific has to come after it.
 */

/** Shape the model returns — flat, because nesting a rule inside a proposal
 *  measurably confuses the schema for no benefit. Restructured below. */
interface FlatProposal {
  page: number;
  quote: string;
  context?: string;
  section?: string;
  kind: string;
  severity: string;
  description: string;
  rationale?: string;
  field?: string;
  fields?: string[];
  phrase?: string;
  pattern?: string;
  offerTypes?: string[];
  minPx?: number;
  minShortEdgeFraction?: number;
  zone?: { x0: number; y0: number; x1: number; y1: number };
  minWidthFraction?: number;
  minHeightFraction?: number;
  bound?: string;
  limits?: { field?: string; literal?: number; factor?: number; op?: string; label?: string }[][];
  select?: string;
  unit?: string;
}

interface DraftReply {
  rules: FlatProposal[];
  unexpressible: UnexpressibleProposal[];
}

const SYSTEM_TASK = `You are transcribing a vehicle manufacturer's co-operative advertising guidelines into machine-checkable rules for a dealer ad generator. You are doing the reading; a human reviews every rule you propose before it takes effect.

HARD RULES — these are not style preferences:

1. Every rule MUST carry a \`quote\` — the words from the document that state the requirement — and the \`page\` those words appear on. The quote is checked against the document automatically, and a rule whose quote cannot be found is discarded before anyone reads it. Quote the sentence that states the requirement: not a heading, and not a running header or footer that repeats across many pages. At least six words, and prefer a full clause.

   THE TEXT YOU ARE READING IS MACHINE-EXTRACTED from a PDF and follows glyph positions rather than reading order. Expect words from sidebars and pull-quotes to land inside a sentence, headings to appear letter-spaced ("C L E A R S PA C E"), and lines to break mid-sentence. Read through all of that. When you quote, give the words of the sentence IN THE ORDER THE TEXT HAS THEM — the check tolerates extra interleaved words and reflowed whitespace, so you do not need to reproduce the mangling, but it cannot tolerate words that are not there. Never quote a letter-spaced heading; quote body text.
2. NEVER state a threshold, size, percentage or phrase the document does not state. If the document says a disclaimer must be "clearly legible" with no number attached, that is NOT a minimum font size rule — it is unexpressible. Inventing a plausible number is the worst possible outcome: it manufactures confidence in a compliance check and nobody goes looking for it afterwards.
3. If the document states a real requirement that none of the rule kinds can express, return it under \`unexpressible\` with the same quote discipline. That is a useful answer, not a failure. Do NOT force it into the nearest rule kind.
4. Use ONLY the ad field keys listed below. Do not invent a field name, and do not guess at one that sounds right. If a requirement is about something with no field key, it is unexpressible.
5. \`severity\`: use \`error\` when the document forbids or requires something outright, and \`warning\` when it recommends, prefers, or leaves discretion.
6. Prefer FEWER, well-founded rules. A missed rule costs a resubmission; a wrong rule silently costs a brand its entire month of advertising. When you are unsure whether the document really says it, leave it out or mark it unexpressible.
7. Write \`description\` for the dealer who gets blocked by the rule: what is required, in one plain sentence. Write \`rationale\` for the reviewer: why you read the quote that way.

ANY QUOTE SHORTER THAN SIX WORDS MUST BE PAIRED WITH \`context\`. \`context\` is a full-length quote from the SAME PAGE that establishes what the short quote means — the sentence it sits in, or the heading it sits under. Both are checked against the document and both must be on that page. A short quote with no context is discarded, so never omit it. This applies to every short quote, not only to lists:

  - A LIST ENTRY. These documents list banned wording in bulk — thirty terms under one sentence like "the following may not be used in any advertising". Make ONE rule per term, with \`quote\` as the term itself (that IS the evidence) and \`context\` as the introducing sentence. Keep \`phrase\` consistent with the term you quoted; a rule about one term supported by a quote of a different one is discarded.
  - A SHORT STANDALONE SENTENCE. Requirements are sometimes stated in four or five words ("Dealer name must appear."). Quote it, and give the surrounding sentence or its section heading as \`context\`. Do NOT pad the quote with words the document does not have — quote it short and supply the context.

PRICING FLOORS AND CAPS ARE OUT OF SCOPE for a rule. Minimum advertised price / MAAP, maximum customer down payment, maximum amount due at signing — do NOT propose these as rules. Report them under \`unexpressible\`, quoting the formula the document states and naming the figures it depends on. Those are transcribed by hand from a confirmed formula, because the manufacturers' formulas genuinely differ and a guessed one blocks real ads for a reason nobody can defend.

Match phrases, not bare words. A brand that bans "special purchase" has not banned "special financing", and a substring match on "sale" fires inside "wholesale".`;

/**
 * Ceiling for the reply. Adaptive thinking is billed against this SAME budget, so at
 * 24000 a real Mazda pass ran out and truncated mid-JSON — which surfaced only as a
 * parse error 14,000 characters in.
 */
const MAX_REPLY_TOKENS = 64000;

/**
 * Kinds a drafting pass may propose — everything except `numeric_limit`.
 *
 * TWO reasons, and they point the same way.
 *
 * POLICY: a numeric limit is a pricing floor or a down-payment cap (MAAP, the VW
 * and Kia caps). Those formulas differ per manufacturer, need figures Loomi may
 * not hold, and the standing decision is that they are transcribed by the Co-op
 * team from a confirmed formula rather than inferred from prose — see
 * docs/custom-offer-disclaimer-builder.md §5 and §10. A drafter that guesses at
 * "invoice minus allowance" produces a rule that blocks real ads for a reason
 * nobody can defend.
 *
 * PRACTICAL: `limits` is a nested array-of-array-of-object and was by far the
 * heaviest node in the output schema, which the API intermittently rejected as
 * "Schema is too complex" (see the retry helper below).
 *
 * A pricing rule the document states is still CAPTURED — as an `unexpressible`
 * note carrying the formula and its quote, which is exactly what the Co-op team
 * needs in order to type the rule.
 */
export const DRAFTABLE_KINDS = RULE_KINDS.filter((k) => k !== 'numeric_limit');

function ruleKindGuide(): string {
  const byKind = new Map(RULE_KIND_META.map((m) => [m.kind, m]));
  const lines = DRAFTABLE_KINDS.map((kind) => {
    const meta = byKind.get(kind);
    const extra = FIELD_HINTS[kind] ?? '';
    return `- \`${kind}\` — ${meta?.label ?? kind}: ${meta?.blurb ?? ''}${extra}`;
  });
  return lines.join('\n');
}

/** What each kind needs beyond the shared fields, in the drafter's terms. */
const FIELD_HINTS: Record<string, string> = {
  required_phrase: ' Needs `field` and either `phrase` or `pattern`.',
  banned_phrase: ' Needs `phrase` or `pattern`; `fields` optional (omit = every text field).',
  required_element: ' Needs `field` — the thing that must appear.',
  min_font_size:
    ' Needs `field` and `minPx` or `minShortEdgeFraction` (a share of the ad\'s short edge — the form that transfers across sizes). Only use this when the document states an actual size.',
  element_zone: ' Needs `field` and `zone` as fractions 0–1 of the ad ({x0,y0,x1,y1}).',
  min_element_size: ' Needs `field` and `minWidthFraction` or `minHeightFraction`.',
};

const PROPOSAL_PROPERTIES: Record<string, unknown> = {
  page: { type: 'integer', description: 'The 1-based page the quote appears on.' },
  quote: { type: 'string', description: 'Verbatim span from the document stating the requirement.' },
  context: {
    type: 'string',
    description:
      'Required when `quote` is a short list entry (a single prohibited term): the full sentence or heading establishing what the list is. Must be on the same page as the entry.',
  },
  section: { type: 'string', description: 'Section label as printed, e.g. "5e" or "Category 7".' },
  kind: { type: 'string', enum: [...DRAFTABLE_KINDS] },
  severity: { type: 'string', enum: ['error', 'warning'] },
  description: { type: 'string' },
  rationale: { type: 'string' },
  field: { type: 'string' },
  fields: { type: 'array', items: { type: 'string' } },
  phrase: { type: 'string' },
  pattern: { type: 'string' },
  offerTypes: { type: 'array', items: { type: 'string' } },
  minPx: { type: 'number' },
  minShortEdgeFraction: { type: 'number' },
  zone: {
    type: 'object',
    additionalProperties: false,
    required: ['x0', 'y0', 'x1', 'y1'],
    properties: {
      x0: { type: 'number' },
      y0: { type: 'number' },
      x1: { type: 'number' },
      y1: { type: 'number' },
    },
  },
  minWidthFraction: { type: 'number' },
  minHeightFraction: { type: 'number' },
};

export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rules', 'unexpressible'],
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['page', 'quote', 'kind', 'severity', 'description'],
        properties: PROPOSAL_PROPERTIES,
      },
    },
    unexpressible: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['page', 'quote', 'requirement', 'why'],
        properties: {
          page: { type: 'integer' },
          quote: { type: 'string' },
          section: { type: 'string' },
          requirement: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface DraftRulesRequest {
  make: string;
  /** Document title, for the model's orientation. The citation is built in code. */
  title: string;
  /** Per-page plain text, index 0 = page 1. From `AdGuidelineDoc.pageText`. */
  pages: string[];
}

export interface DraftRulesResult {
  proposals: RuleProposal[];
  unexpressible: UnexpressibleProposal[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}

/**
 * Ask the model for candidate rules. Returns raw proposals — NOTHING here is
 * trusted; run the result through `screenRuleProposals`.
 */
/**
 * Retry the intermittent `"Schema is too complex."` 400.
 *
 * OBSERVED, not theorised: the identical payload was rejected, then accepted, then
 * rejected again. It appears to be a server-side limit on compiling the structured-
 * output grammar that varies with load rather than with the request, so the same
 * schema is not reliably accepted or reliably refused.
 *
 * The SDK does not retry 4xx — correctly, since a 400 normally means the request is
 * wrong. This one is the exception, and it matters because a drafting pass over a
 * 50-page document is a minutes-long job that should not be thrown away by a
 * transient refusal. Everything else still fails fast.
 */
async function withSchemaRetry<T>(attempt: () => Promise<T>): Promise<T> {
  const delays = [2000, 6000, 15000];
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/schema is too complex/i.test(message) || i >= delays.length) throw err;
      console.warn(
        `[coop-rule-draft] transient "Schema is too complex" from the API; retrying in ${delays[i] / 1000}s (attempt ${i + 2}/${delays.length + 1})`,
      );
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

/** The exact request body, split out so prompt assembly is testable without a key. */
export function buildRulesDraftParams(req: DraftRulesRequest) {
  const fieldKeys = [...knownAdDataKeys()].sort();
  const offerTypes = [...knownOfferTypes()].sort();

  const document = `You are reading the following manufacturer document. Page markers are authoritative: cite the page whose marker precedes the text you quote.

DOCUMENT: ${req.title}
MANUFACTURER: ${req.make}

${renderPagesForPrompt(req.pages)}`;

  const instructions = `${SYSTEM_TASK}

RULE KINDS AVAILABLE:
${ruleKindGuide()}

AD FIELD KEYS (the only permitted values for \`field\`, \`fields\`, and a limit term's \`field\`):
${fieldKeys.join(', ')}

Notes on the field keys: \`disclaimer\` is the composed fine print. \`logoUrl\` is the manufacturer/dealer lockup image and \`dealerName\` the dealership's name — use those for brandmark and dealer-identification rules. \`vehicleImageUrl\` is the vehicle photo. \`eventLogoUrl\` is a sales-event mark. Keys beginning with an underscore are values the offer engine composes (\`_offerMain\` the headline figure, \`_offerTerms\` the terms line beneath it, \`_offerLabel\` its label); \`_o2_\`-prefixed keys are the same for a second offer on a dual-offer ad.

OFFER TYPES (for \`offerTypes\`, which narrows a rule; omit it when the rule always applies):
${offerTypes.join(', ')}

Return every rule the document supports, and every stated requirement you cannot express.`;

  return {
    model: ANTHROPIC_COMPLIANCE_MODEL,
    // Generous, because adaptive thinking is billed against this same ceiling and a
    // prohibited-terms list turns into dozens of rules. At 24000 a real Mazda pass
    // was truncated mid-JSON, which surfaced only as a parse error.
    max_tokens: MAX_REPLY_TOKENS,
    thinking: { type: 'adaptive' as const },
    output_config: {
      effort: 'high' as const,
      format: { type: 'json_schema' as const, schema: REPLY_SCHEMA as unknown as Record<string, unknown> },
    },
    system: [
      // FIRST and cached: the document is the same across every pass over it.
      { type: 'text' as const, text: document, cache_control: { type: 'ephemeral' as const } },
      { type: 'text' as const, text: instructions },
    ],
    messages: [
      {
        role: 'user' as const,
        content: `Transcribe the co-op advertising rules for ${req.make} from this document.`,
      },
    ],
  };
}

/**
 * Ask the model for candidate rules. Returns raw proposals — NOTHING here is
 * trusted; run the result through `screenRuleProposals`.
 */
export async function draftCoopRules(req: DraftRulesRequest): Promise<DraftRulesResult> {
  const client = getAnthropicClient();

  // STREAMED because the SDK refuses a non-streaming request whose `max_tokens`
  // implies it could outrun the 10-minute HTTP ceiling, which a 50-page document at
  // high effort certainly can. `client.messages.stream()` accumulates for us and
  // `finalMessage()` returns the assembled message, so there is no hand-rolled event
  // loop here to get wrong.
  const message = await withSchemaRetry(() =>
    client.messages
      .stream(buildRulesDraftParams(req), { timeout: 30 * 60 * 1000 })
      .finalMessage(),
  );

  const usage = {
    inputTokens: message.usage.input_tokens ?? 0,
    outputTokens: message.usage.output_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
  };

  // NEVER `content[0]`: thinking is on by default on this model family, so the first
  // block is a thinking block and indexing it returns nothing. Filter by type.
  const text = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Check the stop reason BEFORE parsing. A truncated reply is invalid JSON, and
  // "Unterminated string at position 14825" tells you nothing about the cause —
  // which is exactly how this was first seen.
  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `The reply was cut off at the ${MAX_REPLY_TOKENS.toLocaleString()}-token ceiling after ${usage.outputTokens.toLocaleString()} tokens (thinking counts toward it). Raise max_tokens, or split the document.`,
    );
  }
  if (message.stop_reason === 'refusal') {
    throw new Error('The model declined to answer for this document.');
  }
  if (!text.trim()) {
    throw new Error(
      `The model returned no text (stop reason: ${message.stop_reason ?? 'unknown'}) — nothing to screen.`,
    );
  }

  let reply: DraftReply;
  try {
    reply = JSON.parse(text) as DraftReply;
  } catch (err) {
    throw new Error(
      `The reply was not valid JSON (stop reason: ${message.stop_reason ?? 'unknown'}, ${text.length.toLocaleString()} chars): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    proposals: (reply.rules ?? []).map(flatten),
    unexpressible: reply.unexpressible ?? [],
    usage,
  };
}

/** Split the flat reply into the proposal envelope and the rule itself. */
function flatten(flat: FlatProposal): RuleProposal {
  const { page, quote, context, section, rationale, ...rule } = flat;
  return {
    page,
    quote,
    context,
    section,
    rationale,
    // Cast, not validate: `screenRuleProposals` is the validator. Anything wrong
    // here becomes a reported drop rather than a silent pass.
    rule: rule as unknown as RuleProposal['rule'],
  };
}
