/**
 * What Loomi read off the approved creative — the extraction
 * (docs/email-drafting.md §5), stored on `DraftRequest.extraction`.
 *
 * Every field carries how sure the reading was. A low-confidence field is
 * flagged in the update Loomi posts on the subitem, next to the template link,
 * so the person proofing compares it against the image: that is the check on
 * the reading, with no separate approval step (decided 2026-10-09).
 */

export type ReadingConfidence = 'high' | 'low';

export interface ReadField {
  /** Stable key: headline, vehicle, apr, term, payment, dueAtSigning, msrp, savings, expiration, cta… */
  key: string;
  /** As a person reads it: "APR", "Offer ends". */
  label: string;
  value: string;
  confidence: ReadingConfidence;
  /** The monday asset it was read from, when the creative is several files. */
  assetId?: string | null;
}

export interface CreativeReading {
  /** model_offer | service_special | sales_event | event_invite | announcement | conquest | other */
  requestType: string | null;
  /** In reading order — the order the update lists them. */
  fields: ReadField[];
  /** Verbatim. Null when the creative carries no disclaimer. */
  disclaimer: { text: string; confidence: ReadingConfidence } | null;
  model: string;
  readAt: string;
}

export function parseReading(raw: string | null): CreativeReading | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CreativeReading;
    return Array.isArray(parsed?.fields) ? parsed : null;
  } catch {
    return null;
  }
}
