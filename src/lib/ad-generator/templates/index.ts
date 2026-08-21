import type { AdTemplate } from '../types';
import type { TemplateDoc } from '../doc-types';
import { singleOfferTemplate, dualOfferTemplate, singleOfferDoc, dualOfferDoc } from './offer-docs';
import { vehicleOfferDoc } from './vehicle-offer-doc';
import { vehicleOffer } from './vehicle-offer';
import { vehicleDualOffer } from './vehicle-dual-offer';
import { vehicleOfferDocTemplate } from './vehicle-offer-doc';

/**
 * Code-defined template registry. Templates are data-driven TemplateDocs
 * rendered by `renderDoc`, so this imports safely on both client (preview +
 * form fields) and server (Puppeteer render).
 *
 * `AD_TEMPLATES` is what's OFFERED in the picker — the two offer templates built
 * on the background-as-layer system (full-bleed image element + scrim). The
 * older code-render templates are retired from the picker but stay RESOLVABLE
 * (see `getTemplate`) so ads already created from them still render.
 */
export const AD_TEMPLATES: AdTemplate[] = [singleOfferTemplate, dualOfferTemplate];

const RETIRED_TEMPLATES: AdTemplate[] = [vehicleOffer, vehicleDualOffer, vehicleOfferDocTemplate];

/** Every resolvable template (offered + retired) — for rendering existing ads. */
export const ALL_TEMPLATES: AdTemplate[] = [...AD_TEMPLATES, ...RETIRED_TEMPLATES];

export function getTemplate(id: string): AdTemplate | undefined {
  return ALL_TEMPLATES.find((t) => t.id === id);
}

/**
 * The underlying TemplateDoc for a code template, where one exists.
 *
 * Rendering only ever needs the AdTemplate wrapper, but anything that has to
 * INSPECT a design — which layers are clips, how they're stacked — needs the doc
 * itself. The two oldest templates are hand-written render functions with no doc
 * behind them, so they're absent here and simply can't produce video.
 */
export const CODE_TEMPLATE_DOCS: Record<string, TemplateDoc> = {
  [singleOfferDoc.id]: singleOfferDoc,
  [dualOfferDoc.id]: dualOfferDoc,
  [vehicleOfferDoc.id]: vehicleOfferDoc,
};

export function getTemplateDoc(id: string): TemplateDoc | undefined {
  return CODE_TEMPLATE_DOCS[id];
}
