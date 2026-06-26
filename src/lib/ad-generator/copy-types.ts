/**
 * Types for AI-generated ad copy.
 *
 * The copy service writes the marketing fields a template declares
 * (`FieldSpec.copy`) plus off-image channel captions. These shapes are
 * template-agnostic, so they survive the move to data-driven templates (the
 * visual builder): only the *set* of copy fields changes, not this contract.
 */

/** A marketing field the AI should write, derived from the template's FieldSpec. */
export interface AdCopyField {
  key: string;
  label: string;
  maxLength?: number;
}

export interface AdCopyRequest {
  /** Display name of the template (prompt context). */
  templateName: string;
  /** The marketing fields to write (the template's `copy` fields). */
  copyFields: AdCopyField[];
  /**
   * All current field values — grounds the copy in the real offer (vehicle,
   * price, terms, expiration). The AI reads these to stay relevant but never
   * rewrites them; numbers + legal stay deterministic.
   */
  context: Record<string, string>;
  dealerName: string;
  /** Optional brand voice / tone, e.g. "bold", "friendly", "luxury". */
  tone?: string;
  /** Optional freeform brief from the user. */
  brief?: string;
  /** How many variations to return (clamped 1–5; default 3). */
  count?: number;
}

export interface MetaCaption {
  primaryText: string;
  headline: string;
  description: string;
}

export interface GoogleCaption {
  headlines: string[];
  descriptions: string[];
}

export interface AdCopyVariation {
  /** Values for the template's copy fields, keyed by field key. */
  fields: Record<string, string>;
  /** Off-image post text for Meta (Facebook / Instagram). */
  meta: MetaCaption;
  /** Off-image responsive-search-ad text for Google. */
  google: GoogleCaption;
}

export interface AdCopyResult {
  variations: AdCopyVariation[];
}

/** Platform caption limits — fed to the prompt and enforced on the result. */
export const META_LIMITS = { primaryText: 125, headline: 40, description: 30 } as const;
export const GOOGLE_LIMITS = {
  headline: 30,
  description: 90,
  headlineCount: 3,
  descriptionCount: 2,
} as const;
