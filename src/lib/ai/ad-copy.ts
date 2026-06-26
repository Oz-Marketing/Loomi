import { getAnthropicClient, ANTHROPIC_MODEL, parseAiJson } from '@/lib/anthropic';
import {
  type AdCopyRequest,
  type AdCopyResult,
  type AdCopyVariation,
  META_LIMITS,
  GOOGLE_LIMITS,
} from '@/lib/ad-generator/copy-types';

/**
 * AI ad-copy generation.
 *
 * Writes the marketing COPY for a dealer ad (the template's `copy` fields) plus
 * Meta + Google channel captions, in multiple variations. It is deliberately
 * scoped: the model writes words, never numbers or legal text. Prices, terms,
 * dates come from the offer inputs (deterministic) and the disclaimer from
 * templates (rule-based) — so nothing the AI returns can create a compliance
 * problem. Mirrors the other `src/lib/ai/*` generators (client + ANTHROPIC_MODEL
 * + JSON output via parseAiJson).
 */

const SYSTEM = `You are a senior automotive advertising copywriter for car and powersports dealerships.

Hard rules:
- Write ONLY marketing copy (hooks, taglines, post text). NEVER invent or alter prices, monthly payments, APRs, terms, due-at-signing, or dates. If you reference a number, it MUST appear verbatim in the OFFER CONTEXT — otherwise don't state a number at all.
- NEVER write legal or disclaimer text; that is handled separately.
- Respect every field's character limit exactly (hard caps, counted in characters).
- Match the dealership's brand and the requested tone. Keep it punchy and ad-appropriate.
- Output STRICT JSON only — no prose, no markdown code fences.`;

function ctxLines(context: Record<string, string>): string {
  const entries = Object.entries(context).filter(([, v]) => v != null && String(v).trim() !== '');
  if (entries.length === 0) return '(none provided)';
  return entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

function buildPrompt(req: AdCopyRequest): string {
  const count = req.count ?? 3;
  const fieldsSpec = req.copyFields
    .map(
      (f) =>
        `- "${f.key}" (${f.label})${f.maxLength ? ` — max ${f.maxLength} characters` : ''}`,
    )
    .join('\n');
  const fieldsJson = req.copyFields.map((f) => `"${f.key}": "..."`).join(', ');

  return `Generate ${count} distinct ad-copy variations for this dealership offer.

DEALER: ${req.dealerName}
TEMPLATE: ${req.templateName}
TONE: ${req.tone?.trim() || 'confident and on-brand'}
${req.brief?.trim() ? `BRIEF: ${req.brief.trim()}` : ''}

OFFER CONTEXT (facts — do not alter, and never invent numbers not listed here):
${ctxLines(req.context)}

ON-IMAGE COPY FIELDS to write (respect each max length):
${fieldsSpec}

CHANNEL CAPTIONS to write per variation:
- meta: primaryText (≤${META_LIMITS.primaryText} chars), headline (≤${META_LIMITS.headline}), description (≤${META_LIMITS.description})
- google: ${GOOGLE_LIMITS.headlineCount} headlines (≤${GOOGLE_LIMITS.headline} chars each), ${GOOGLE_LIMITS.descriptionCount} descriptions (≤${GOOGLE_LIMITS.description} each)

Return STRICT JSON in exactly this shape:
{
  "variations": [
    {
      "fields": { ${fieldsJson} },
      "meta": { "primaryText": "...", "headline": "...", "description": "..." },
      "google": { "headlines": ["...", "..."], "descriptions": ["...", "..."] }
    }
  ]
}`;
}

// ── normalization (pure; exported for tests) ───────────────────────────────

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

function clamp(v: unknown, max?: number): string {
  const t = asString(v).trim();
  return max && t.length > max ? t.slice(0, max).trim() : t;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(asString) : [];
}

/**
 * Coerce arbitrary AI JSON into the typed result: keep only the declared copy
 * fields, clamp every string to its limit, and enforce caption counts. Pure so
 * it can be unit-tested without hitting the API, and defensive so a sloppy
 * model response can never break the caller.
 */
export function normalizeCopyResult(parsed: unknown, req: AdCopyRequest): AdCopyResult {
  const count = req.count ?? 3;
  const root = (parsed ?? {}) as Record<string, unknown>;
  const rawVariations = Array.isArray(root.variations) ? root.variations : [];

  const variations: AdCopyVariation[] = [];
  for (const rv of rawVariations) {
    if (variations.length >= count) break;
    const v = (rv ?? {}) as Record<string, unknown>;
    const rawFields = (v.fields ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const f of req.copyFields) {
      fields[f.key] = clamp(rawFields[f.key], f.maxLength);
    }
    const meta = (v.meta ?? {}) as Record<string, unknown>;
    const google = (v.google ?? {}) as Record<string, unknown>;
    variations.push({
      fields,
      meta: {
        primaryText: clamp(meta.primaryText, META_LIMITS.primaryText),
        headline: clamp(meta.headline, META_LIMITS.headline),
        description: clamp(meta.description, META_LIMITS.description),
      },
      google: {
        headlines: asStringArray(google.headlines)
          .map((h) => clamp(h, GOOGLE_LIMITS.headline))
          .filter(Boolean)
          .slice(0, GOOGLE_LIMITS.headlineCount),
        descriptions: asStringArray(google.descriptions)
          .map((d) => clamp(d, GOOGLE_LIMITS.description))
          .filter(Boolean)
          .slice(0, GOOGLE_LIMITS.descriptionCount),
      },
    });
  }
  return { variations };
}

export async function generateAdCopy(req: AdCopyRequest): Promise<AdCopyResult> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(req) }],
  });
  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const parsed = parseAiJson(raw);
  return normalizeCopyResult(parsed, req);
}
