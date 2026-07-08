/**
 * Ad Generator template model.
 *
 * A template is a PURE function of (data, size) → HTML. The same function backs
 * both the live browser preview and the server-side Puppeteer render, so what
 * you see is pixel-identical to what you download. Keep templates free of any
 * Node/browser-only imports so they bundle on both sides.
 *
 * This is the reimagined replacement for the legacy Oz Dealer Tools offer
 * builder: instead of a freeform canvas editor, designers author constrained,
 * data-driven templates and users fill a guided form. Quality is guaranteed by
 * the template.
 */

export interface AdSize {
  id: string;
  label: string;
  width: number;
  height: number;
}

export type FieldType = 'text' | 'textarea' | 'number' | 'color' | 'image' | 'date' | 'select';

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  /** Optional grouping for the form UI, e.g. "Offer", "Vehicle", "Brand". */
  group?: string;
  placeholder?: string;
  help?: string;
  /** For `select` fields. */
  options?: { value: string; label: string }[];
  /** Max characters — a fit hint for on-canvas text and the constraint the AI
   *  copywriter must respect. Carries over to data-driven templates. */
  maxLength?: number;
  /**
   * This field holds marketing COPY the AI may write — as opposed to DATA
   * (price, terms, VIN) or LEGAL (the disclaimer), which the AI must never
   * touch. "Write with AI" fills exactly the fields a template marks `copy`.
   * When templates move from code to a `TemplateDoc` authored in the visual
   * builder, each text binding carries this same flag, so the copy service
   * and UI keep working unchanged.
   */
  copy?: boolean;
  /**
   * Show this field only when another field's value is one of `in` — e.g. the
   * APR-rate field is visible only when `offerType` is `apr`. Lets one template
   * carry per-offer-type fields without separate templates. Carries over to
   * data-driven templates (a binding can hold the same condition).
   */
  visibleWhen?: { field: string; in: string[] };
  /**
   * For `image` fields: where the picture comes from. `manual` (default) =
   * upload / media library / URL. `evox` = the client picks a vehicle + paint
   * color from EVOX (jellybean photography); the manual inputs are hidden.
   * `both` = offer manual inputs AND the EVOX picker. Lets a designer wire any
   * image field to the vehicle-image API without hardcoding the `vehicleImageUrl`
   * key — the designer picks API vs manual per field.
   */
  imageSource?: 'manual' | 'evox' | 'both';
  /**
   * Who fills this field in on the creative form. `client` (default) → the
   * client sees + edits it. `internal` → only managers/designers (hidden from
   * clients). Designer-set, per field — replaces the old hardcoded, automotive-
   * centric client/manager split so any template's client-facing fields are the
   * ones the designer marks `client`. (Managers always see every field.)
   */
  audience?: 'client' | 'internal';
}

export type AdData = Record<string, string>;

/** Whether `field` is shown to a client (non-manager) on the creative form. */
export function isClientField(field: FieldSpec): boolean {
  return (field.audience ?? 'client') === 'client';
}

/** True if `field` should be shown given the current form `data`. */
export function isFieldVisible(field: FieldSpec, data: AdData): boolean {
  if (!field.visibleWhen) return true;
  return field.visibleWhen.in.includes(data[field.visibleWhen.field] ?? '');
}

export interface AdTemplate {
  id: string;
  name: string;
  description: string;
  /** Industries this template is tagged for (account `category` values), for
   *  library filtering. Empty/undefined → global to every industry. */
  industries?: string[];
  /** Shared template taxonomy — category + tags for library organization. */
  category?: string;
  tags?: string[];
  /** Output sizes this template supports (square, landscape, story, …). */
  sizes: AdSize[];
  /** Field definitions that drive the generated form. */
  fields: FieldSpec[];
  /** Sensible starting values so the preview renders something real immediately. */
  defaults: AdData;
  /** Pure render: merged data + a size → a full HTML document sized to the ad. */
  render: (data: AdData, size: AdSize) => string;
}
