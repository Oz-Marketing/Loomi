import type { AdTemplate } from '../types';
import { vehicleOffer } from './vehicle-offer';
import { vehicleDualOffer } from './vehicle-dual-offer';
import { vehicleOfferDocTemplate } from './vehicle-offer-doc';

/**
 * Code-defined template registry (Phase 1). Templates are pure data→HTML, so
 * this imports safely on both client (preview + form fields) and server
 * (Puppeteer render). A future phase moves templates into the DB so designers
 * can author them in-app.
 *
 * `vehicleOfferDocTemplate` is the same template re-authored as a data-driven
 * TemplateDoc (the builder renderer) — registered so it can be rendered next to
 * the code template for a parity check.
 */
export const AD_TEMPLATES: AdTemplate[] = [vehicleOffer, vehicleDualOffer, vehicleOfferDocTemplate];

export function getTemplate(id: string): AdTemplate | undefined {
  return AD_TEMPLATES.find((t) => t.id === id);
}
