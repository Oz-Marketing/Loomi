import type { ProjectRequest } from './monday-board';
import type { FactSource } from './compliance/types';
import type { CreativeReading, ReadField, ReadingConfidence } from './reading';

/**
 * The extraction contract (docs/email-drafting.md §5): what the vision pass is
 * asked for, and how its reply becomes the `CreativeReading` everything after
 * it trusts.
 *
 * Kept apart from the model call (`extract.ts`) for the same reason the co-op
 * drafter is: the screening is testable on hand-written replies without an API
 * key, and a prompt change can't quietly relax it.
 *
 * Pure.
 */

export const REQUEST_TYPES = [
  'model_offer',
  'service_special',
  'sales_event',
  'event_invite',
  'announcement',
  'conquest',
  'other',
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/** Slice 1 drafts these; everything else stops with a note saying so. */
export const DRAFTABLE_TYPES: readonly RequestType[] = ['model_offer'];

export const OFFER_TYPES = ['lease', 'finance', 'cash', 'other'] as const;

/**
 * Field keys, in the order the subitem update lists them. A fixed vocabulary:
 * the conflict check and the fact sources key off these, and a reader that
 * invents `monthlyPayment` for `payment` would silently escape both.
 */
export const FIELD_LABELS = {
  headline: 'Headline',
  subhead: 'Subhead',
  vehicle: 'Vehicle',
  offer: 'Offer',
  payment: 'Payment',
  term: 'Term',
  apr: 'APR',
  dueAtSigning: 'Due at signing',
  msrp: 'MSRP',
  price: 'Price',
  savings: 'Savings',
  rebate: 'Rebate / cash back',
  services: 'Services featured',
  expiration: 'Offer ends',
  cta: 'Call to action',
  dealer: 'Dealer named',
  logos: 'Logos',
  other: 'Other text',
} as const;
export type FieldKey = keyof typeof FIELD_LABELS;
const FIELD_KEYS = Object.keys(FIELD_LABELS) as FieldKey[];

// ── What the model returns ───────────────────────────────────────────────────

export interface ReadReply {
  requestType: string;
  offerType: string | null;
  vehicle: { year: string | null; make: string | null; model: string | null; trim: string | null } | null;
  fields: { key: string; value: string; confidence: string; image: number }[];
  disclaimer: { text: string; confidence: string } | null;
  unreadable: string[];
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const str = { type: 'string' };

/** Structured-output schema for the vision pass. Flat, every property required. */
export const READ_REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requestType', 'offerType', 'vehicle', 'fields', 'disclaimer', 'unreadable'],
  properties: {
    requestType: { type: 'string', enum: [...REQUEST_TYPES] },
    offerType: nullable({ type: 'string', enum: [...OFFER_TYPES] }),
    vehicle: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['year', 'make', 'model', 'trim'],
      properties: { year: nullable(str), make: nullable(str), model: nullable(str), trim: nullable(str) },
    }),
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value', 'confidence', 'image'],
        properties: {
          key: { type: 'string', enum: FIELD_KEYS },
          value: str,
          confidence: { type: 'string', enum: ['high', 'low'] },
          image: { type: 'integer' },
        },
      },
    },
    disclaimer: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['text', 'confidence'],
      properties: { text: str, confidence: { type: 'string', enum: ['high', 'low'] } },
    }),
    unreadable: { type: 'array', items: str },
  },
} as const;

// ── Screening ────────────────────────────────────────────────────────────────

function confidence(raw: unknown): ReadingConfidence {
  // Anything but an explicit "high" is treated as needing a look.
  return raw === 'high' ? 'high' : 'low';
}

function clean(s: unknown): string {
  return typeof s === 'string' ? s.replace(/[ \t]+/g, ' ').trim() : '';
}

function yearOf(raw: string | null | undefined): number | null {
  const m = clean(raw).match(/^(?:19|20)\d{2}$/);
  return m ? Number(m[0]) : null;
}

/**
 * The model's reply as a `CreativeReading`.
 *
 * Unknown keys and empty values are dropped; an unknown request type becomes
 * `other` (which stops drafting rather than guessing a template). The
 * disclaimer keeps its line breaks — it is legal text and goes in verbatim.
 */
export function toReading(
  reply: ReadReply,
  meta: { model: string; readAt: string; assetIds: string[] },
): CreativeReading {
  const requestType = (REQUEST_TYPES as readonly string[]).includes(reply.requestType) ? reply.requestType : 'other';
  const fields: ReadField[] = [];
  for (const f of reply.fields ?? []) {
    if (!(FIELD_KEYS as string[]).includes(f.key)) continue;
    const value = clean(f.value);
    if (!value) continue;
    const key = f.key as FieldKey;
    fields.push({
      key,
      label: FIELD_LABELS[key],
      value,
      confidence: confidence(f.confidence),
      assetId: meta.assetIds.length > 1 ? (meta.assetIds[f.image - 1] ?? null) : (meta.assetIds[0] ?? null),
    });
  }
  // Reading order within a key, but the keys in the update's order.
  fields.sort((a, b) => FIELD_KEYS.indexOf(a.key as FieldKey) - FIELD_KEYS.indexOf(b.key as FieldKey));

  const disclaimerText = typeof reply.disclaimer?.text === 'string'
    ? reply.disclaimer.text.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n')
    : '';

  const v = reply.vehicle;
  const vehicle = v && (clean(v.make) || clean(v.model))
    ? { year: yearOf(v.year), make: clean(v.make) || null, model: clean(v.model) || null, trim: clean(v.trim) || null }
    : null;

  return {
    requestType,
    fields,
    disclaimer: disclaimerText ? { text: disclaimerText, confidence: confidence(reply.disclaimer?.confidence) } : null,
    offerType: (OFFER_TYPES as readonly string[]).includes(reply.offerType ?? '') ? reply.offerType : null,
    vehicle,
    unreadable: (reply.unreadable ?? []).map(clean).filter(Boolean),
    model: meta.model,
    readAt: meta.readAt,
  };
}

/** The first value read for `key`, or null. */
export function fieldValue(reading: CreativeReading, key: FieldKey): string | null {
  return reading.fields.find((f) => f.key === key)?.value ?? null;
}

/**
 * The trusted sources a draft's claims may come from (house rule 1): every
 * field read off the creative, the disclaimer, and the written request.
 */
export function factSources(
  reading: CreativeReading,
  request: Pick<ProjectRequest, 'details' | 'offerDisclaimer' | 'name'> | null,
): FactSource[] {
  const facts: FactSource[] = reading.fields.map((f) => ({ label: `extraction.${f.key}`, text: f.value }));
  if (reading.vehicle) {
    const { year, make, model, trim } = reading.vehicle;
    facts.push({ label: 'extraction.vehicle', text: [year, make, model, trim].filter(Boolean).join(' ') });
  }
  if (reading.disclaimer) facts.push({ label: 'extraction.disclaimer', text: reading.disclaimer.text });
  if (request?.name?.trim()) facts.push({ label: 'request.name', text: request.name });
  if (request?.details?.trim()) facts.push({ label: 'request.details', text: request.details });
  if (request?.offerDisclaimer?.trim()) facts.push({ label: 'request.offerDisclaimer', text: request.offerDisclaimer });
  return facts;
}
